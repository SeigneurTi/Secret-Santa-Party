const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
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

// ---------- Helpers: DB ----------

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify({ draws: {} }, null, 2), 'utf-8');
  }
}

function loadDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw || '{"draws": {}}');
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

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

function findDrawByAdminCode(db, adminCode) {
  return Object.values(db.draws).find((d) => d.adminCode === adminCode) || null;
}

function findDrawByPublicCode(db, publicCode) {
  return Object.values(db.draws).find((d) => d.publicCode === publicCode) || null;
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Upload d'une photo (admin)
app.post('/api/upload-photo', upload.single('photo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Aucun fichier reçu.' });
  }
  // L'URL sera servie statiquement depuis /public
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// Créer un nouveau tirage
app.post('/api/draws', (req, res) => {
  const { title, budget } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Le titre du tirage est obligatoire.' });
  }

  const db = loadDb();
  const id = randomId('draw');
  let adminCode = randomCode(20);
  let publicCode = randomCode(20);

  const existingCodes = new Set();
  Object.values(db.draws).forEach((d) => {
    existingCodes.add(d.adminCode);
    existingCodes.add(d.publicCode);
  });
  while (existingCodes.has(adminCode)) {
    adminCode = randomCode(20);
  }
  while (existingCodes.has(publicCode)) {
    publicCode = randomCode(20);
  }

  const draw = {
    id,
    title: title.trim(),
    budget: budget != null && budget !== '' ? Number(budget) : null,
    adminCode,
    publicCode,
    status: 'draft', // draft | ready | closed
    participants: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  db.draws[id] = draw;
  saveDb(db);

  res.json({
    id: draw.id,
    title: draw.title,
    budget: draw.budget,
    adminCode: draw.adminCode,
    publicCode: draw.publicCode
  });
});

// Récupérer un tirage via adminCode (détails complets)
app.get('/api/draws/by-admin/:adminCode', (req, res) => {
  const { adminCode } = req.params;
  const db = loadDb();
  const draw = findDrawByAdminCode(db, adminCode);
  if (!draw) {
    return res.status(404).json({ error: 'Tirage introuvable.' });
  }
  res.json({
    id: draw.id,
    title: draw.title,
    budget: draw.budget,
    adminCode: draw.adminCode,
    publicCode: draw.publicCode,
    status: draw.status,
    participants: draw.participants
  });
});

// Ajouter / remplacer les participants via adminCode
app.post('/api/draws/:adminCode/participants', (req, res) => {
  const { adminCode } = req.params;
  const { participants } = req.body || {};

  if (!Array.isArray(participants) || participants.length < 2) {
    return res.status(400).json({
      error: 'Merci de fournir au moins 2 participants.'
    });
  }

  const db = loadDb();
  const draw = findDrawByAdminCode(db, adminCode);
  if (!draw) {
    return res.status(404).json({ error: 'Tirage introuvable.' });
  }

  // On repasse le tirage en "draft" si les participants sont modifiés
  draw.status = 'draft';

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

  draw.participants = cleaned.map((p) => ({
    id: randomId('p'),
    name: p.name,
    photoUrl: p.photoUrl || null,
    assignedParticipantId: null,
    hasDrawn: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }));

  draw.updatedAt = new Date().toISOString();
  db.draws[draw.id] = draw;
  saveDb(db);

  res.json({
    id: draw.id,
    title: draw.title,
    budget: draw.budget,
    status: draw.status,
    participants: draw.participants
  });
});

// Lancer le tirage (générer le dérangement)
app.post('/api/draws/:adminCode/start', (req, res) => {
  const { adminCode } = req.params;
  const db = loadDb();
  const draw = findDrawByAdminCode(db, adminCode);
  if (!draw) {
    return res.status(404).json({ error: 'Tirage introuvable.' });
  }

  if (!draw.participants || draw.participants.length < 2) {
    return res.status(400).json({
      error: 'Il faut au moins 2 participants pour lancer le tirage.'
    });
  }

  const participantIds = draw.participants.map((p) => p.id);
  try {
    const derangementMap = generateDerangement(participantIds);
    draw.participants = draw.participants.map((p) => ({
      ...p,
      assignedParticipantId: derangementMap[p.id] || null,
      hasDrawn: false,
      updatedAt: new Date().toISOString()
    }));
    draw.status = 'ready';
    draw.updatedAt = new Date().toISOString();
    db.draws[draw.id] = draw;
    saveDb(db);

    res.json({
      id: draw.id,
      title: draw.title,
      budget: draw.budget,
      status: draw.status,
      publicCode: draw.publicCode
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Erreur lors du tirage.' });
  }
});

// Réinitialiser le tirage (garder les participants mais enlever les attributions)
app.post('/api/draws/:adminCode/reset', (req, res) => {
  const { adminCode } = req.params;
  const db = loadDb();
  const draw = findDrawByAdminCode(db, adminCode);
  if (!draw) {
    return res.status(404).json({ error: 'Tirage introuvable.' });
  }

  if (!draw.participants || draw.participants.length < 2) {
    return res.status(400).json({
      error: 'Il faut au moins 2 participants pour réinitialiser le tirage.'
    });
  }

  draw.participants = draw.participants.map((p) => ({
    ...p,
    assignedParticipantId: null,
    hasDrawn: false,
    updatedAt: new Date().toISOString()
  }));
  draw.status = 'draft';
  draw.updatedAt = new Date().toISOString();
  db.draws[draw.id] = draw;
  saveDb(db);

  res.json({
    id: draw.id,
    title: draw.title,
    budget: draw.budget,
    status: draw.status
  });
});

// Récupérer le tirage pour les participants via publicCode (données limitées)
app.get('/api/draws/by-public/:publicCode', (req, res) => {
  const { publicCode } = req.params;
  const db = loadDb();
  const draw = findDrawByPublicCode(db, publicCode);
  if (!draw) {
    return res.status(404).json({ error: 'Tirage introuvable.' });
  }

  const participantsForClient = draw.participants.map((p) => ({
    id: p.id,
    name: p.name,
    photoUrl: p.photoUrl,
    hasDrawn: p.hasDrawn
  }));

  res.json({
    id: draw.id,
    title: draw.title,
    budget: draw.budget,
    status: draw.status,
    participants: participantsForClient
  });
});

// Faire / revoir le tirage pour un participant via publicCode
app.post('/api/draws/:publicCode/draw', (req, res) => {
  const { publicCode } = req.params;
  const { participantId } = req.body || {};

  if (!participantId) {
    return res.status(400).json({ error: 'participantId est obligatoire.' });
  }

  const db = loadDb();
  const draw = findDrawByPublicCode(db, publicCode);
  if (!draw) {
    return res.status(404).json({ error: 'Tirage introuvable.' });
  }

  if (draw.status !== 'ready') {
    return res.status(400).json({ error: 'Le tirage n’est pas encore prêt.' });
  }

  const participant = draw.participants.find((p) => p.id === participantId);
  if (!participant) {
    return res.status(404).json({ error: 'Participant introuvable.' });
  }

  const receiver = draw.participants.find((p) => p.id === participant.assignedParticipantId);
  if (!receiver) {
    return res.status(500).json({ error: 'Aucune personne assignée à ce participant.' });
  }

  const alreadyDrawn = participant.hasDrawn;

  if (!alreadyDrawn) {
    participant.hasDrawn = true;
    participant.updatedAt = new Date().toISOString();
    draw.updatedAt = new Date().toISOString();
    db.draws[draw.id] = draw;
    saveDb(db);
  }

  res.json({
    alreadyDrawn,
    participant: {
      id: participant.id,
      name: participant.name,
      photoUrl: participant.photoUrl
    },
    receiver: {
      id: receiver.id,
      name: receiver.name,
      photoUrl: receiver.photoUrl
    }
  });
});

// Fallback: renvoyer index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Secret Santa app listening on port ${PORT}`);
});
