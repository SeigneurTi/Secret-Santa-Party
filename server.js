const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Postgres ----------

// Exemple de config : DATABASE_URL=postgres://user:pass@host:port/dbname
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === 'false'
      ? false
      : {
          rejectUnauthorized: false
        }
});

// Petit helper pratique
async function query(text, params) {
  const res = await pool.query(text, params);
  return res;
}

// ---------- Uploads ----------

const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path
      .basename(file.originalname || 'photo', ext)
      .replace(/[^a-z0-9_-]/gi, '_')
      .toLowerCase();
    const unique = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    cb(null, `${base}_${unique}${ext}`);
  }
});

const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Helpers: IDs & Codes ----------

function randomId(prefix = 'd') {
  return (
    prefix +
    '_' +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  );
}

function randomCode(length = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

// ---------- Derangement ----------

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateDerangement(participantIds) {
  if (participantIds.length < 2) {
    throw new Error('Il faut au moins 2 participants pour lancer le tirage.');
  }
  let attempts = 0;
  while (attempts < 10000) {
    attempts++;
    const shuffled = shuffle(participantIds);
    let valid = true;
    for (let i = 0; i < participantIds.length; i++) {
      if (participantIds[i] === shuffled[i]) {
        valid = false;
        break;
      }
    }
    if (valid) {
      const map = {};
      for (let i = 0; i < participantIds.length; i++) {
        map[participantIds[i]] = shuffled[i];
      }
      return map;
    }
  }
  throw new Error('Impossible de générer un tirage valide. Réessayez.');
}

// ---------- API routes ----------

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Healthcheck DB error', err);
    res.status(500).json({ status: 'error', db: 'error', error: err.message });
  }
});

// Upload d'une photo (admin)
app.post('/api/upload-photo', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu.' });
  }
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// Créer un nouveau tirage
app.post('/api/draws', async (req, res) => {
  const { title, budget } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Le titre du tirage est obligatoire.' });
  }

  const id = randomId('draw');
  const adminCode = randomCode(20);
  const publicCode = randomCode(20);
  const now = new Date().toISOString();

  try {
    await query(
      `
      INSERT INTO draws (id, title, budget, admin_code, public_code, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'draft', $6, $6)
    `,
      [id, title.trim(), budget != null && budget !== '' ? Number(budget) : null, adminCode, publicCode, now]
    );

    res.json({
      id,
      title: title.trim(),
      budget: budget != null && budget !== '' ? Number(budget) : null,
      adminCode,
      publicCode
    });
  } catch (err) {
    console.error('Error creating draw', err);
    res.status(500).json({ error: 'Erreur lors de la création du tirage.' });
  }
});

// Récupérer un tirage via adminCode (détails complets)
app.get('/api/draws/by-admin/:adminCode', async (req, res) => {
  const { adminCode } = req.params;
  try {
    const drawRes = await query('SELECT * FROM draws WHERE admin_code = $1', [adminCode]);
    if (drawRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tirage introuvable.' });
    }
    const draw = drawRes.rows[0];

    const participantsRes = await query(
      'SELECT * FROM participants WHERE draw_id = $1 ORDER BY created_at ASC',
      [draw.id]
    );
    const participants = participantsRes.rows;

    res.json({
      id: draw.id,
      title: draw.title,
      budget: draw.budget,
      adminCode: draw.admin_code,
      publicCode: draw.public_code,
      status: draw.status,
      participants: participants.map((p) => ({
        id: p.id,
        name: p.name,
        photoUrl: p.photo_url,
        assignedParticipantId: p.assigned_participant_id,
        hasDrawn: p.has_drawn,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      }))
    });
  } catch (err) {
    console.error('Error get draw by admin', err);
    res.status(500).json({ error: 'Erreur lors de la récupération du tirage.' });
  }
});

// Ajouter / remplacer les participants via adminCode
app.post('/api/draws/:adminCode/participants', async (req, res) => {
  const { adminCode } = req.params;
  const { participants } = req.body || {};

  if (!Array.isArray(participants) || participants.length < 2) {
    return res.status(400).json({
      error: 'Merci de fournir au moins 2 participants.'
    });
  }

  const cleaned = participants
    .map((p) => ({
      name: (p.name || '').toString().trim(),
      photoUrl: (p.photoUrl || '').toString().trim()
    }))
    .filter((p) => p.name.length > 0);

  if (cleaned.length < 2) {
    return res.status(400).json({
      error: 'Merci de fournir au moins 2 participants avec un nom non vide.'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const drawRes = await client.query('SELECT * FROM draws WHERE admin_code = $1 FOR UPDATE', [
      adminCode
    ]);
    if (drawRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tirage introuvable.' });
    }
    const draw = drawRes.rows[0];

    // Supprimer les participants existants
    await client.query('DELETE FROM participants WHERE draw_id = $1', [draw.id]);

    const now = new Date().toISOString();

    // Insérer les nouveaux participants
    const inserted = [];
    for (const p of cleaned) {
      const pid = randomId('p');
      await client.query(
        `
        INSERT INTO participants (id, draw_id, name, photo_url, has_drawn, created_at, updated_at)
        VALUES ($1, $2, $3, $4, FALSE, $5, $5)
      `,
        [pid, draw.id, p.name, p.photoUrl || null, now]
      );
      inserted.push({
        id: pid,
        name: p.name,
        photoUrl: p.photoUrl || null,
        assignedParticipantId: null,
        hasDrawn: false,
        createdAt: now,
        updatedAt: now
      });
    }

    // Repasse le tirage en draft
    await client.query(
      'UPDATE draws SET status = $1, updated_at = $2 WHERE id = $3',
      ['draft', now, draw.id]
    );

    await client.query('COMMIT');

    res.json({
      id: draw.id,
      title: draw.title,
      budget: draw.budget,
      status: 'draft',
      participants: inserted
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error set participants', err);
    res.status(500).json({ error: "Erreur lors de l'enregistrement des participants." });
  } finally {
    client.release();
  }
});

// Lancer le tirage (générer le dérangement)
app.post('/api/draws/:adminCode/start', async (req, res) => {
  const { adminCode } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const drawRes = await client.query('SELECT * FROM draws WHERE admin_code = $1 FOR UPDATE', [
      adminCode
    ]);
    if (drawRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tirage introuvable.' });
    }
    const draw = drawRes.rows[0];

    const participantsRes = await client.query(
      'SELECT id FROM participants WHERE draw_id = $1 ORDER BY created_at ASC',
      [draw.id]
    );
    const ids = participantsRes.rows.map((r) => r.id);

    if (ids.length < 2) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Il faut au moins 2 participants pour lancer le tirage.'
      });
    }

    const derangementMap = generateDerangement(ids);
    const now = new Date().toISOString();

    // Appliquer les attributions
    for (const pid of ids) {
      const assignedId = derangementMap[pid] || null;
      await client.query(
        `
        UPDATE participants
        SET assigned_participant_id = $1,
            has_drawn = FALSE,
            updated_at = $2
        WHERE id = $3
      `,
        [assignedId, now, pid]
      );
    }

    await client.query(
      'UPDATE draws SET status = $1, updated_at = $2 WHERE id = $3',
      ['ready', now, draw.id]
    );

    await client.query('COMMIT');

    res.json({
      id: draw.id,
      title: draw.title,
      budget: draw.budget,
      status: 'ready',
      publicCode: draw.public_code
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error start draw', err);
    res.status(500).json({ error: err.message || 'Erreur lors du tirage.' });
  } finally {
    client.release();
  }
});

// Réinitialiser le tirage (garder les participants mais enlever les attributions)
app.post('/api/draws/:adminCode/reset', async (req, res) => {
  const { adminCode } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const drawRes = await client.query('SELECT * FROM draws WHERE admin_code = $1 FOR UPDATE', [
      adminCode
    ]);
    if (drawRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tirage introuvable.' });
    }
    const draw = drawRes.rows[0];

    const participantsCountRes = await client.query(
      'SELECT COUNT(*) FROM participants WHERE draw_id = $1',
      [draw.id]
    );
    const count = Number(participantsCountRes.rows[0].count || 0);
    if (count < 2) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Il faut au moins 2 participants pour réinitialiser le tirage.'
      });
    }

    const now = new Date().toISOString();

    await client.query(
      `
      UPDATE participants
      SET assigned_participant_id = NULL,
          has_drawn = FALSE,
          updated_at = $1
      WHERE draw_id = $2
    `,
      [now, draw.id]
    );

    await client.query(
      'UPDATE draws SET status = $1, updated_at = $2 WHERE id = $3',
      ['draft', now, draw.id]
    );

    await client.query('COMMIT');

    res.json({
      id: draw.id,
      title: draw.title,
      budget: draw.budget,
      status: 'draft'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error reset draw', err);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation du tirage.' });
  } finally {
    client.release();
  }
});

// Récupérer le tirage pour les participants via publicCode (données limitées)
app.get('/api/draws/by-public/:publicCode', async (req, res) => {
  const { publicCode } = req.params;
  try {
    const drawRes = await query('SELECT * FROM draws WHERE public_code = $1', [publicCode]);
    if (drawRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tirage introuvable.' });
    }
    const draw = drawRes.rows[0];

    const participantsRes = await query(
      'SELECT * FROM participants WHERE draw_id = $1 ORDER BY created_at ASC',
      [draw.id]
    );
    const participants = participantsRes.rows.map((p) => ({
      id: p.id,
      name: p.name,
      photoUrl: p.photo_url,
      hasDrawn: p.has_drawn
    }));

    res.json({
      id: draw.id,
      title: draw.title,
      budget: draw.budget,
      status: draw.status,
      participants
    });
  } catch (err) {
    console.error('Error get draw by public', err);
    res.status(500).json({ error: 'Erreur lors du chargement du tirage.' });
  }
});

// Faire / revoir le tirage pour un participant via publicCode
app.post('/api/draws/:publicCode/draw', async (req, res) => {
  const { publicCode } = req.params;
  const { participantId } = req.body || {};

  if (!participantId) {
    return res.status(400).json({ error: 'participantId est obligatoire.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const drawRes = await client.query('SELECT * FROM draws WHERE public_code = $1 FOR UPDATE', [
      publicCode
    ]);
    if (drawRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tirage introuvable.' });
    }
    const draw = drawRes.rows[0];

    if (draw.status !== 'ready') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Le tirage n’est pas encore prêt.' });
    }

    const participantRes = await client.query(
      'SELECT * FROM participants WHERE id = $1 AND draw_id = $2 FOR UPDATE',
      [participantId, draw.id]
    );
    if (participantRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Participant introuvable.' });
    }
    const participant = participantRes.rows[0];

    const receiverRes = await client.query(
      'SELECT * FROM participants WHERE id = $1',
      [participant.assigned_participant_id]
    );
    if (receiverRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Aucune personne assignée à ce participant.' });
    }
    const receiver = receiverRes.rows[0];

    const alreadyDrawn = participant.has_drawn;

    if (!alreadyDrawn) {
      const now = new Date().toISOString();
      await client.query(
        'UPDATE participants SET has_drawn = TRUE, updated_at = $1 WHERE id = $2',
        [now, participant.id]
      );
      await client.query('UPDATE draws SET updated_at = $1 WHERE id = $2', [now, draw.id]);
    }

    await client.query('COMMIT');

    res.json({
      alreadyDrawn,
      participant: {
        id: participant.id,
        name: participant.name,
        photoUrl: participant.photo_url
      },
      receiver: {
        id: receiver.id,
        name: receiver.name,
        photoUrl: receiver.photo_url
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error participant draw', err);
    res.status(500).json({ error: 'Erreur lors du tirage.' });
  } finally {
    client.release();
  }
});

// Fallback: renvoyer index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Secret Santa app listening on port ${PORT}`);
});
