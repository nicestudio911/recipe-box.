// Step-by-step cooking: one big step at a time, the screen stays on, timers one tap away.
import { t } from './i18n.js';
import { $, $$, view, esc, openSheet } from './ui.js';
import { getRecipe } from './db.js';
import { stepHtml } from './timers.js';

let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* not supported: fine */ }
}
// The lock is dropped when the tab is hidden; take it again when cooking continues
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.body.classList.contains('cooking')) keepAwake(true); });
window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/cook/')) keepAwake(false); });

export async function renderCook(id, { transform = l => l, stepTransform = s => s } = {}) {
  const r = await getRecipe(id);
  if (!r) { location.hash = '#/'; return; }
  const steps = (r.steps || []).filter(s => !s.startsWith('## ')).map(stepTransform);
  const ingredients = (r.ingredients || []).map(transform);
  const checked = new Set();
  let i = 0;
  document.body.classList.add('cooking');
  keepAwake(true);

  const draw = () => {
    const last = i >= steps.length;
    view.innerHTML = `
      <div class="cook">
        <div class="cook-top">
          <p class="muted small">${esc(r.title)}</p>
          <button class="btn small" data-act="ing">🥕 ${t('Ingredients')}</button>
        </div>
        <div class="cook-progress"><div style="width:${steps.length ? Math.round((Math.min(i + 1, steps.length) / steps.length) * 100) : 100}%"></div></div>
        ${!steps.length ? `<p class="cook-step">${t('This recipe has no steps. Open the ingredients to tick them off.')}</p>` :
          last ? `<div class="cook-done"><div class="empty-icon">🎉</div><p class="cook-step">${t('Enjoy your meal!')}</p></div>` :
          `<p class="cook-count">${t('Step {i} of {n}', { i: i + 1, n: steps.length })}</p>
           <p class="cook-step">${stepHtml(steps[i], r.title)}</p>`}
        <div class="cook-nav">
          <button class="btn" data-act="prev" ${i === 0 ? 'disabled' : ''}>‹ ${t('Back')}</button>
          ${last || !steps.length ? `<a class="btn primary" href="#/recipe/${r.id}">${t('Finish')}</a>` :
            `<button class="btn primary" data-act="next">${i === steps.length - 1 ? t('Done') : t('Next')} ›</button>`}
        </div>
      </div>`;
    const prev = $('[data-act=prev]'); prev.onclick = () => { if (i > 0) { i--; draw(); } };
    const next = $('[data-act=next]'); if (next) next.onclick = () => { i++; draw(); };
    $('[data-act=ing]').onclick = showIngredients;
  };

  const showIngredients = () => openSheet(`
    <h2>${t('Ingredients')}</h2>
    <div class="pick-list">${ingredients.map((l, n) => l.startsWith('## ') ? `<p class="pick-head">${esc(l.slice(3))}</p>` :
      `<label><input type="checkbox" data-n="${n}" ${checked.has(n) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>`,
  panel => $$('input', panel).forEach(c => (c.onchange = () => (c.checked ? checked.add(+c.dataset.n) : checked.delete(+c.dataset.n)))));

  // Swipe left / right to change step
  let x0 = null;
  view.ontouchstart = e => (x0 = e.touches[0].clientX);
  view.ontouchend = e => {
    if (x0 === null || !location.hash.startsWith('#/cook/')) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) < 60) return;
    if (dx < 0 && i < steps.length) i++; else if (dx > 0 && i > 0) i--; else return;
    draw();
  };
  draw();
}
