// Shopping list: add ingredients from recipes or the meal plan, tick them off in the shop.
import { t, tn } from './i18n.js';
import { $, $$, view, esc, toast, openSheet } from './ui.js';
import { getList, saveList } from './db.js';

const uid = () => crypto.randomUUID();
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Let the person untick what they already have, then add the rest.
// groups: [{ title, lines: [...] }]
export function offerToShopping(groups, heading = t('Add to shopping list')) {
  groups = groups.map(g => ({ ...g, lines: g.lines.filter(l => l && !l.startsWith('## ')) })).filter(g => g.lines.length);
  if (!groups.length) { toast(t('No ingredients to add')); return; }
  openSheet(`
    <h2>${esc(heading)}</h2>
    <p class="muted small">${t('Untick what you already have.')}</p>
    <form class="stack">
      <div class="pick-list">
        ${groups.map((g, gi) => `
          ${groups.length > 1 && g.title ? `<p class="pick-head">${esc(g.title)}</p>` : ''}
          ${g.lines.map((l, li) => `<label><input type="checkbox" checked data-g="${gi}" data-l="${li}"><span>${esc(l)}</span></label>`).join('')}`).join('')}
      </div>
      <button class="btn primary">${t('Add to shopping list')}</button>
    </form>`, (panel, close) => {
    panel.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      const picked = $$('input:checked', panel).map(i => ({ text: groups[i.dataset.g].lines[i.dataset.l], recipe: groups[i.dataset.g].title || '' }));
      const added = await addItems(picked);
      close();
      toast(added ? tn(added, 'item added to your shopping list', 'items added to your shopping list') : t('Already on your shopping list'));
    };
  });
}

export async function addItems(items) {
  const list = await getList('shopping');
  const have = new Set(list.items.filter(i => !i.done).map(i => norm(i.text)));
  let added = 0;
  for (const { text, recipe = '' } of items) {
    const k = norm(text);
    if (!k || have.has(k)) continue;
    have.add(k);
    list.items.push({ id: uid(), text: text.trim(), done: false, recipe });
    added++;
  }
  saveList('shopping', list);
  return added;
}

export async function renderShopping() {
  const list = await getList('shopping');
  const draw = () => {
    const open = list.items.filter(i => !i.done), done = list.items.filter(i => i.done);
    const groups = new Map();
    for (const i of open) { const g = i.recipe || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); }
    const row = i => `<li class="${i.done ? 'done' : ''}"><label><input type="checkbox" data-id="${i.id}" ${i.done ? 'checked' : ''}><span>${esc(i.text)}</span></label>
      <button class="icon-btn small" data-del="${i.id}" aria-label="${t('Remove')}">✕</button></li>`;
    view.innerHTML = `
      <div class="page-head">
        <h1>${t('Shopping list')}</h1>
        ${open.length ? `<button class="btn small" data-act="share">${t('Share')}</button>` : ''}
      </div>
      <form class="add-item"><input name="text" placeholder="${t('Add an item, e.g. 1 l milk')}" autocomplete="off" aria-label="${t('Add an item')}"><button class="btn primary small">${t('Add')}</button></form>
      ${!list.items.length ? `<div class="empty"><div class="empty-icon">🛒</div><h2>${t('Your shopping list is empty')}</h2>
        <p>${t('Open a recipe and tap “Add to shopping list”, or add the whole week from the meal plan.')}</p></div>` : ''}
      ${[...groups].map(([g, items]) => `${g ? `<h2 class="group">${esc(g)}</h2>` : groups.size > 1 ? `<h2 class="group">${t('Other')}</h2>` : ''}<ul class="ingredients shop">${items.map(row).join('')}</ul>`).join('')}
      ${done.length ? `<div class="section-head"><h2>${t('In the basket')} <span class="muted">(${done.length})</span></h2><button class="btn small ghost" data-act="clear-done">${t('Clear')}</button></div>
        <ul class="ingredients shop">${done.map(row).join('')}</ul>` : ''}
      ${list.items.length ? `<div class="actions"><button class="btn danger small" data-act="clear-all">${t('Empty the list')}</button></div>` : ''}`;

    const save = () => { saveList('shopping', list); draw(); };
    $('.add-item').onsubmit = e => {
      e.preventDefault();
      const text = e.target.text.value.trim();
      if (!text) return;
      list.items.push({ id: uid(), text, done: false, recipe: '' });
      save(); $('.add-item input').focus();
    };
    $$('input[data-id]').forEach(c => (c.onchange = () => { list.items.find(i => i.id === c.dataset.id).done = c.checked; save(); }));
    $$('[data-del]').forEach(b => (b.onclick = () => { list.items = list.items.filter(i => i.id !== b.dataset.del); save(); }));
    const cd = $('[data-act=clear-done]'); if (cd) cd.onclick = () => { list.items = list.items.filter(i => !i.done); save(); };
    const ca = $('[data-act=clear-all]'); if (ca) ca.onclick = () => { if (confirm(t('Remove everything from the shopping list?'))) { list.items = []; save(); } };
    const sh = $('[data-act=share]'); if (sh) sh.onclick = async () => {
      const text = `${t('Shopping list')}\n\n${open.map(i => `☐ ${i.text}`).join('\n')}`;
      if (navigator.share) { try { await navigator.share({ title: t('Shopping list'), text }); } catch {} return; }
      try { await navigator.clipboard.writeText(text); toast(t('Copied to clipboard')); } catch { toast(text, 8000); }
    };
  };
  draw();
}
