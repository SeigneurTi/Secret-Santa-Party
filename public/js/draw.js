document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const publicCode = params.get('code');

  const drawTitle = document.getElementById('drawTitle');
  const drawBudget = document.getElementById('drawBudget');
  const drawError = document.getElementById('drawError');
  const drawContent = document.getElementById('drawContent');

  const chooserSection = document.getElementById('chooserSection');
  const participantsGrid = document.getElementById('participantsGrid');
  const drawBtn = document.getElementById('drawBtn');

  const animationSection = document.getElementById('animationSection');
  const animationCard = document.getElementById('animationCard');
  const animationName = document.getElementById('animationName');

  const resultSection = document.getElementById('resultSection');
  const resultTitle = document.getElementById('resultTitle');
  const receiverName = document.getElementById('receiverName');
  const receiverMessage = document.getElementById('receiverMessage');
  const receiverPhoto = document.getElementById('receiverPhoto');
  const backToChooserBtn = document.getElementById('backToChooserBtn');

  if (!publicCode) {
    drawTitle.textContent = 'Code manquant dans le lien';
    drawError.classList.remove('hidden');
    return;
  }

  // Verrou par session / navigateur
  const lockKey = 'secret_santa_lock_' + publicCode;

  let participants = [];
  let animationInterval = null;
  let lockedParticipantId = localStorage.getItem(lockKey) || null;
  let selectedParticipantId = lockedParticipantId || null;

  function show(el) {
    el.classList.remove('hidden');
  }

  function hide(el) {
    el.classList.add('hidden');
  }

  function resetAnimation() {
    if (animationInterval) {
      clearInterval(animationInterval);
      animationInterval = null;
    }
    animationName.textContent = '...';
    animationCard.classList.remove('shake');
    void animationCard.offsetWidth;
    animationCard.classList.add('shake');
  }

  function initialsFromName(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function updateSelectedCardStyles() {
    const cards = participantsGrid.querySelectorAll('.participant-card');
    cards.forEach((card) => {
      const id = card.dataset.id;
      if (id === selectedParticipantId) {
        card.classList.add('participant-card--selected');
      } else {
        card.classList.remove('participant-card--selected');
      }
    });
  }

  function renderParticipantsGrid() {
    participantsGrid.innerHTML = '';

    participants.forEach((p) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'participant-card';
      card.dataset.id = p.id;

      // 1) Cas “verrou local” : ce navigateur est déjà associé à une autre personne
      const lockedOther = lockedParticipantId && p.id !== lockedParticipantId;

      // 2) Cas “déjà tiré globalement” : la personne a déjà tiré sur un autre appareil
      const drawnElsewhere =
        p.hasDrawn === true && (!lockedParticipantId || p.id !== lockedParticipantId);

      const shouldDisable = lockedOther || drawnElsewhere;

      if (shouldDisable) {
        card.classList.add('participant-card--locked-other');
        card.disabled = true;
      }

      // Photo ou initiales
      if (p.photoUrl) {
        const img = document.createElement('img');
        img.src = p.photoUrl;
        img.alt = p.name;
        img.className = 'participant-card__photo';
        card.appendChild(img);
      } else {
        const initials = document.createElement('div');
        initials.className = 'participant-card__initials';
        initials.textContent = initialsFromName(p.name);
        card.appendChild(initials);
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'participant-card__name';
      nameEl.textContent = p.name;
      card.appendChild(nameEl);

      const tagEl = document.createElement('div');
      tagEl.className = 'participant-card__tag';
      if (p.hasDrawn) {
        tagEl.textContent = 'Déjà tiré';
      } else {
        tagEl.textContent = 'Disponible';
      }
      card.appendChild(tagEl);

      card.addEventListener('click', () => {
        // Normalement déjà géré par disabled, mais on garde une sécurité
        if (drawnElsewhere) {
          alert(
            'Cette personne a déjà fait son tirage sur un autre appareil.\n' +
              'Choisis ton propre nom pour participer.'
          );
          return;
        }

        if (lockedOther) {
          alert(
            "Cet appareil est déjà associé à un autre participant pour ce tirage.\n" +
              'Tu peux seulement revoir le tirage de cette personne.'
          );
          return;
        }

        selectedParticipantId = p.id;
        updateSelectedCardStyles();
        drawBtn.disabled = false;
      });

      participantsGrid.appendChild(card);
    });

    // Sur un navigateur déjà verrouillé, on pré-sélectionne la carte
    if (lockedParticipantId) {
      selectedParticipantId = lockedParticipantId;
      updateSelectedCardStyles();
      drawBtn.disabled = false;
    } else {
      drawBtn.disabled = !selectedParticipantId;
    }
  }

  async function loadDraw() {
    try {
      const res = await fetch(`/api/draws/by-public/${publicCode}`);
      if (!res.ok) {
        drawTitle.textContent = 'Tirage introuvable';
        drawError.classList.remove('hidden');
        return;
      }
      const data = await res.json();
      participants = Array.isArray(data.participants) ? data.participants : [];

      drawTitle.textContent = data.title || 'Tirage Père Noël Secret';
      drawBudget.textContent =
        data.budget != null ? `${data.budget} € par personne` : 'Pas de budget indiqué';

      // Si l’ID verrouillé n’existe plus (tirage réinitialisé par l’admin), on enlève le verrou
      if (lockedParticipantId && !participants.some((p) => p.id === lockedParticipantId)) {
        lockedParticipantId = null;
        selectedParticipantId = null;
        localStorage.removeItem(lockKey);
      }

      renderParticipantsGrid();
      show(drawContent);
    } catch (err) {
      console.error(err);
      drawTitle.textContent = 'Erreur lors du chargement du tirage';
      drawError.classList.remove('hidden');
    }
  }

  drawBtn.addEventListener('click', async () => {
    const participantId = selectedParticipantId;
    if (!participantId) {
      alert('Merci de choisir ta carte avant de lancer le tirage.');
      return;
    }

    resetAnimation();
    hide(resultSection);
    show(animationSection);
    hide(chooserSection);

    const spinNames = participants.map((p) => p.name);
    animationInterval = setInterval(() => {
      const r = spinNames[Math.floor(Math.random() * spinNames.length)];
      animationName.textContent = r;
    }, 80);

    try {
      const res = await fetch(`/api/draws/${publicCode}/draw`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur lors du tirage.');
      }

      const data = await res.json();

      // Verrouillage définitif de ce navigateur sur ce participant
      if (!lockedParticipantId) {
        lockedParticipantId = participantId;
        localStorage.setItem(lockKey, participantId);
      }

      // On met à jour participants.hasDrawn en local pour que les tags soient à jour
      participants = participants.map((p) =>
        p.id === participantId ? { ...p, hasDrawn: true } : p
      );

      // On re-render pour désactiver les autres cartes visuellement
      renderParticipantsGrid();

      setTimeout(() => {
        if (animationInterval) {
          clearInterval(animationInterval);
          animationInterval = null;
        }

        animationName.textContent = data.receiver.name;
        receiverName.textContent = data.receiver.name;

        // Gestion de la photo du destinataire
        if (data.receiver.photoUrl) {
          receiverPhoto.src = data.receiver.photoUrl;
          receiverPhoto.style.display = 'block';
        } else {
          receiverPhoto.removeAttribute('src');
          receiverPhoto.style.display = 'none';
        }

        if (data.alreadyDrawn) {
          resultTitle.textContent = 'Ton tirage (déjà effectué)';
          receiverMessage.textContent =
            'Tu avais déjà tiré, voici à nouveau la personne à qui tu offres un cadeau.';
        } else {
          resultTitle.textContent = 'Chut, c’est ton secret !';
          receiverMessage.textContent =
            'C’est la personne à qui tu dois faire un cadeau. Garde bien cette info pour toi.';
        }

        hide(animationSection);
        show(resultSection);
      }, 700);
    } catch (err) {
      console.error(err);
      if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
      }
      hide(animationSection);
      show(chooserSection);
      alert(err.message || 'Erreur lors du tirage.');
    }
  });

  backToChooserBtn.addEventListener('click', () => {
    hide(resultSection);
    show(chooserSection);
    // On garde la même sélection qu’avant (et le même verrou)
    renderParticipantsGrid();
  });

  loadDraw();
});
