// Shows the Bulgarian or English half of a legal page.
const saved = (() => { try { return localStorage.getItem('rb-lang'); } catch { return null; } })();
const initial = saved || ((navigator.languages || [navigator.language]).some(l => /^bg\b/i.test(l)) ? 'bg' : 'en');
function show(l) {
  document.querySelectorAll('section[lang]').forEach(s => s.classList.toggle('active', s.lang === l));
  document.querySelectorAll('.lang button').forEach(b => b.classList.toggle('on', b.dataset.l === l));
  document.documentElement.lang = l;
}
document.querySelectorAll('.lang button').forEach(b => (b.onclick = () => { show(b.dataset.l); try { localStorage.setItem('rb-lang', b.dataset.l); } catch {} }));
show(initial);
