// On a shared recipe page (/s/<token>): copy the recipe into your own account.
// If you're not logged in, we remember the link, and the app saves it right after you log in or sign up.
const token = location.pathname.split('/')[2];
const btn = document.getElementById('save');
document.querySelectorAll('.steps li').forEach(li => (li.onclick = () => li.classList.toggle('done')));
if (btn) btn.onclick = async () => {
  btn.disabled = true;
  try {
    const res = await fetch(`/api/shared/${token}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' });
    if (res.status === 401) {
      try { localStorage.setItem('rb-pending-share', token); } catch {}
      location.href = '/';
      return;
    }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.status);
    const saved = await res.json();
    btn.textContent = btn.dataset.saved;
    setTimeout(() => (location.href = `/#/recipe/${saved.id}`), 900);
  } catch (e) {
    btn.disabled = false;
    alert(e.message);
  }
};
