document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const adminCode = params.get('code');

  const adminSubtitle = document.getElementById('adminSubtitle');
  const adminError = document.getElementById('adminError');
  const adminContent = document.getElementById('adminContent');
  const drawTitle = document.getElementById('drawTitle');
  const drawBudget = document.getElementById('drawBudget');
  const participantsBody = document.getElementById('participantsBody');
  const addParticipantBtn = document.getElementById('addParticipantBtn');
  const saveParticipantsBtn = document.getElementById('saveParticipantsBtn');
  const startDrawBtn = document.getElementById('startDrawBtn');
  const publicLinkSection = document.getElementById('publicLinkSection');
  const publicUrlInputAdmin = document.getElementById('publicUrlInputAdmin');

  // Modal de recadrage
  const photoCropModal = document.getElementById('photoCropModal');
  const cropCanvas = document.getElementById('cropCanvas');
  const zoomRange = document.getElementById('zoomRange');
  const cancelCropBtn = document.getElementById('cancelCropBtn');
  const confirmCropBtn = document.getElementById('confirmCropBtn');

  const cropCtx = cropCanvas.getContext('2d');

  let resetDrawBtn = null;
  let cropImage = null;            // Image en cours de recadrage
  let cropZoom = parseFloat(zoomRange.value) || 1.3;
  let currentPhotoInput = null;    // Champ de texte à mettre à jour après upload

  if (!adminCode) {
    adminSubtitle.textContent = 'Code administrateur manquant dans l’URL.';
    adminError.classList.remove('hidden');
    return;
  }

  function openModal() {
    photoCropModal.classList.remove('hidden');
  }

  function closeModal() {
    photoCropModal.classList.add('hidden');
    cropImage = null;
    currentPhotoInput = null;
  }

  function drawCroppedImage() {
    if (!cropImage) return;

    const canvas = cropCanvas;
    const ctx = cropCtx;
    const img = cropImage;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // On calcule une échelle de base pour remplir le canvas
    const baseScale = Math.max(w / img.width, h / img.height);
    const scale = baseScale * cropZoom;

    const drawW = img.width * scale;
    const drawH = img.height * scale;

    const dx = (w - drawW) / 2;
    const dy = (h - drawH) / 2;

    // On dessine dans un masque circulaire pour avoir un aperçu rond
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(img, dx, dy, drawW, drawH);

    ctx.restore();
  }

  function openCropper(file, targetInput) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        cropImage = img;
        currentPhotoInput = targetInput;
        cropZoom = parseFloat(zoomRange.value) || 1.3;
        drawCroppedImage();
        openModal();
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  zoomRange.addEventListener('input', () => {
    cropZoom = parseFloat(zoomRange.value) || 1.3;
    drawCroppedImage();
  });

  cancelCropBtn.addEventListener('click', () => {
    closeModal();
  });

  confirmCropBtn.addEventListener('click', async () => {
    if (!cropImage || !currentPhotoInput) {
      closeModal();
      return;
    }

    // On transforme le canvas (cercle) en image à uploader
    cropCanvas.toBlob(async (blob) => {
      if (!blob) {
        alert("Impossible de générer l'image recadrée.");
        return;
      }

      const formData = new FormData();
      formData.append('photo', blob, 'avatar.png');

      try {
        const res = await fetch('/api/upload-photo', {
          method: 'POST',
          body: formData
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Erreur lors de l’envoi de la photo.');
        }

        const data = await res.json();
        currentPhotoInput.value = data.url || '';
      } catch (err) {
        console.error(err);
        alert(err.message || 'Erreur lors de l’envoi de la photo.');
      } finally {
        closeModal();
      }
    }, 'image/png');
  });

  function createRow(participant) {
    const tr = document.createElement('tr');
    tr.classList.add('participant-row');

    // Nom
    const tdName = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Nom';
    nameInput.value = participant?.name || '';
    tdName.appendChild(nameInput);

    // Photo (URL + fichier + mini-preview)
    const tdPhoto = document.createElement('td');

    const photoInput = document.createElement('input');
    photoInput.type = 'text';
    photoInput.placeholder = 'URL photo (rempli automatiquement)';
    photoInput.value = participant?.photoUrl || '';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.marginTop = '4px';

    const preview = document.createElement('div');
    preview.style.marginTop = '4px';

    const previewImg = document.createElement('img');
    previewImg.className = 'participant-photo-preview';
    previewImg.alt = 'Aperçu';
    if (participant?.photoUrl) {
      previewImg.src = participant.photoUrl;
    }
    preview.appendChild(previewImg);

    // Quand l’URL change, on met à jour la preview
    photoInput.addEventListener('input', () => {
      const url = photoInput.value.trim();
      if (url) {
        previewImg.src = url;
      } else {
        previewImg.removeAttribute('src');
      }
    });

    // Quand on choisit un fichier, on ouvre le recadrage
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      openCropper(file, photoInput);
    });

    tdPhoto.appendChild(photoInput);
    tdPhoto.appendChild(fileInput);
    tdPhoto.appendChild(preview);

    tr.appendChild(tdName);
    tr.appendChild(tdPhoto);
    return tr;
  }

  async function loadDraw() {
    try {
      const res = await fetch(`/api/draws/by-admin/${adminCode}`);
      if (!res.ok) {
        adminSubtitle.textContent = 'Tirage introuvable.';
        adminError.classList.remove('hidden');
        return;
      }
      const data = await res.json();

      drawTitle.textContent = data.title;
      drawBudget.textContent =
        data.budget != null ? `${data.budget} € par personne` : 'Pas de budget indiqué';

      participantsBody.innerHTML = '';
      if (Array.isArray(data.participants) && data.participants.length > 0) {
        data.participants.forEach((p) => {
          participantsBody.appendChild(
            createRow({ name: p.name, photoUrl: p.photoUrl || '' })
          );
        });
      } else {
        for (let i = 0; i < 3; i++) {
          participantsBody.appendChild(createRow({ name: '', photoUrl: '' }));
        }
      }

      // Lien public si tirage prêt
      if (data.publicCode && data.status === 'ready') {
        const origin = window.location.origin;
        const publicUrl = `${origin}/draw.html?code=${data.publicCode}`;
        publicUrlInputAdmin.value = publicUrl;
        publicLinkSection.classList.remove('hidden');
      } else {
        publicLinkSection.classList.add('hidden');
      }

      // Bouton de réinitialisation (une seule fois)
      if (!resetDrawBtn) {
        resetDrawBtn = document.createElement('button');
        resetDrawBtn.type = 'button';
        resetDrawBtn.className = 'btn-secondary btn-inline';
        resetDrawBtn.textContent = 'Réinitialiser le tirage';
        startDrawBtn.parentElement.appendChild(resetDrawBtn);

        resetDrawBtn.addEventListener('click', async () => {
          if (
            !confirm(
              'Réinitialiser le tirage ? Les attributions seront effacées mais les participants conservés.'
            )
          ) {
            return;
          }
          try {
            const resReset = await fetch(`/api/draws/${adminCode}/reset`, {
              method: 'POST'
            });
            if (!resReset.ok) {
              const err = await resReset.json().catch(() => ({}));
              throw new Error(err.error || 'Erreur lors de la réinitialisation.');
            }
            alert(
              'Tirage réinitialisé. Tu peux à nouveau modifier les participants et relancer.'
            );
            await loadDraw();
          } catch (err) {
            console.error(err);
            alert(err.message || 'Erreur lors de la réinitialisation.');
          }
        });
      }

      adminSubtitle.textContent =
        'Configure les participants, lance ou réinitialise le tirage.';
      adminContent.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      adminSubtitle.textContent = 'Erreur lors du chargement du tirage.';
      adminError.classList.remove('hidden');
    }
  }

  addParticipantBtn.addEventListener('click', () => {
    participantsBody.appendChild(createRow({ name: '', photoUrl: '' }));
  });

  saveParticipantsBtn.addEventListener('click', async () => {
    const rows = participantsBody.querySelectorAll('.participant-row');
    const participants = [];

    rows.forEach((row) => {
      const inputs = row.querySelectorAll('input[type="text"]');
      const name = inputs[0].value.trim();
      const photoUrl = inputs[1].value.trim();
      if (name) {
        participants.push({ name, photoUrl });
      }
    });

    if (participants.length < 2) {
      alert('Merci de renseigner au moins 2 participants.');
      return;
    }

    try {
      const res = await fetch(`/api/draws/${adminCode}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participants })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Erreur lors de l'enregistrement des participants.");
      }

      alert('Participants enregistrés.');
      await loadDraw();
    } catch (err) {
      console.error(err);
      alert(err.message || "Erreur lors de l'enregistrement des participants.");
    }
  });

  startDrawBtn.addEventListener('click', async () => {
    if (
      !confirm(
        'Lancer le tirage ? Tu ne pourras plus modifier les participants sans réinitialiser.'
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/draws/${adminCode}/start`, {
        method: 'POST'
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur lors du tirage.');
      }

      const data = await res.json();
      const origin = window.location.origin;
      const publicUrl = `${origin}/draw.html?code=${data.publicCode}`;
      publicUrlInputAdmin.value = publicUrl;
      publicLinkSection.classList.remove('hidden');
      alert('Tirage lancé ! Tu peux maintenant partager le lien aux participants.');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Erreur lors du tirage.');
    }
  });

  loadDraw();
});
