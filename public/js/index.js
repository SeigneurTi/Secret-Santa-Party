document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('createForm');
  const createResult = document.getElementById('createResult');
  const createdTitle = document.getElementById('createdTitle');
  const adminUrlInput = document.getElementById('adminUrlInput');
  const publicUrlInput = document.getElementById('publicUrlInput');
  const goAdminBtn = document.getElementById('goAdminBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('titleInput').value.trim();
    const budgetRaw = document.getElementById('budgetInput').value;

    if (!title) {
      alert("Merci d'indiquer un nom de tirage.");
      return;
    }

    try {
      const res = await fetch('/api/draws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          budget: budgetRaw !== '' ? Number(budgetRaw) : null
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur lors de la création du tirage.');
      }

      const data = await res.json();
      const origin = window.location.origin;
      const adminUrl = `${origin}/admin.html?code=${data.adminCode}`;
      const publicUrl = `${origin}/draw.html?code=${data.publicCode}`;

      createdTitle.textContent = data.title;
      adminUrlInput.value = adminUrl;
      publicUrlInput.value = publicUrl;

      createResult.classList.remove('hidden');

      goAdminBtn.onclick = () => {
        window.location.href = adminUrl;
      };
    } catch (err) {
      console.error(err);
      alert(err.message || 'Erreur lors de la création du tirage.');
    }
  });
});
