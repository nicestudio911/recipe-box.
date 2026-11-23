import { allRecipes, getRecipe, saveRecipe, deleteRecipe, importAll } from './db.js';
import { parseRecipeText } from './parse-text.js';

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean);
let draft = null;        // recipe being created from an import, before it's saved
let listQuery = '';
let listTag = '';

// ---------- helpers ----------
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

function fmtMins(m) {
  if (!m) return '';
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? ` ${r} min` : ''}` : `${r} min`;
}

// Shrink photos before storing them, so the database stays small
function resizeImage(file, max = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = URL.createObjectURL(file);
  });
}

function pickFiles({ camera = false, multiple = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = multiple;
    if (camera) input.capture = 'environment';
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

// Scale numbers at the start of an ingredient line ("1 1/2 cups" x2 -> "3 cups")
const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
function scaleLine(line, f) {
  if (f === 1) return line;
  return line.replace(/^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛])(\s*[-–]\s*(\d+(?:[.,]\d+)?))?/, (m, a, _r, b) => {
    const val = s => {
      if (FRAC[s]) return FRAC[s];
      if (/\d+\s+\d+\/\d+/.test(s)) { const [w, fr] = s.split(/\s+/); const [n, d] = fr.split('/'); return +w + n / d; }
      if (s.includes('/')) { const [n, d] = s.split('/'); return n / d; }
      return parseFloat(s.replace(',', '.'));
    };
    const out = v => { const x = Math.round(v * f * 100) / 100; return String(x).replace('.', /[,]/.test(a) ? ',' : '.'); };
    return b ? `${out(val(a))}–${out(val(b))}` : out(val(a));
  });
}

// ---------- views ----------
async function renderList() {
  const recipes = await allRecipes();
  const tags = [...new Set(recipes.flatMap(r => r.tags || []))].sort();
  const q = listQuery.toLowerCase();
  const shown = recipes.filter(r =>
    (!listTag || (listTag === '★' ? r.favorite : (r.tags || []).includes(listTag))) &&
    (!q || [r.title, ...(r.ingredients || []), ...(r.tags || [])].join(' ').toLowerCase().includes(q)));

  view.innerHTML = `
    <div class="search"><input id="q" type="search" placeholder="Search recipes or ingredients" value="${esc(listQuery)}" aria-label="Search"></div>
    ${recipes.length ? `<div class="chips">
      <button class="chip ${!listTag ? 'on' : ''}" data-tag="">All</button>
      <button class="chip ${listTag === '★' ? 'on' : ''}" data-tag="★">★ Favourites</button>
      ${tags.map(t => `<button class="chip ${listTag === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>` : ''}
    ${!recipes.length ? `
      <div class="empty">
        <div class="empty-icon">🍲</div>
        <h2>No recipes yet</h2>
        <p>Add your first one. Write it yourself, snap a photo of a cookbook page, or paste a link.</p>
        <button class="btn primary" data-action="add">Add a recipe</button>
      </div>` :
      shown.length ? `<div class="grid">${shown.map(card).join('')}</div>` : `<p class="muted center">Nothing matches “${esc(listQuery)}”.</p>`}`;

  const qi = $('#q');
  qi.oninput = () => { listQuery = qi.value; renderList().then(() => { const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); };
  view.querySelectorAll('.chip').forEach(c => (c.onclick = () => { listTag = c.dataset.tag; renderList(); }));
}

function card(r) {
  const time = r.totalTime || ((r.prepTime || 0) + (r.cookTime || 0));
  return `<a class="card" href="#/recipe/${r.id}">
    <div class="thumb">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span>🍽️</span>'}</div>
    <div class="card-body">
      <h3>${r.favorite ? '<span class="star">★</span> ' : ''}${esc(r.title)}</h3>
      <p class="muted small">${[(r.ingredients || []).length + ' ingredients', fmtMins(time)].filter(Boolean).join(' · ')}</p>
    </div></a>`;
}

async function renderRecipe(id) {
  const r = await getRecipe(id);
  if (!r) { location.hash = '#/'; return; }
  let factor = 1;
  const baseServings = parseFloat(String(r.servings).match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.')) || null;

  const draw = () => {
    const ing = (r.ingredients || []).map(l => scaleLine(l, factor));
    view.innerHTML = `
      <article class="recipe">
        ${r.image ? `<img class="hero" src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="recipe-head">
          <h1>${esc(r.title)}</h1>
          <button class="icon-btn ${r.favorite ? 'fav' : ''}" data-action="fav" aria-label="Favourite">${r.favorite ? '★' : '☆'}</button>
        </div>
        ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ''}
        <div class="facts">
          ${r.servings ? `<span>🍽️ ${esc(r.servings)}${factor !== 1 && baseServings ? ` → ${Math.round(baseServings * factor * 10) / 10}` : ''}</span>` : ''}
          ${r.prepTime ? `<span>Prep ${fmtMins(r.prepTime)}</span>` : ''}
          ${r.cookTime ? `<span>Cook ${fmtMins(r.cookTime)}</span>` : ''}
          ${r.totalTime ? `<span>⏱ ${fmtMins(r.totalTime)}</span>` : ''}
        </div>
        ${(r.tags || []).length ? `<div class="chips static">${r.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}

        <section>
          <div class="section-head">
            <h2>Ingredients</h2>
            <div class="scaler" aria-label="Scale recipe">
              ${[0.5, 1, 2, 3].map(f => `<button class="${f === factor ? 'on' : ''}" data-scale="${f}">${f === 0.5 ? '½' : f}×</button>`).join('')}
            </div>
          </div>
          <ul class="ingredients">${ing.map((l, i) => l.startsWith('## ') ? `<li class="sub">${esc(l.slice(3))}</li>` :
            `<li><label><input type="checkbox" data-i="${i}"><span>${esc(l)}</span></label></li>`).join('')}</ul>
        </section>

        <section>
          <h2>Steps</h2>
          <ol class="steps">${(r.steps || []).map(s => s.startsWith('## ') ? `<li class="sub">${esc(s.slice(3))}</li>` : `<li>${esc(s)}</li>`).join('')}</ol>
        </section>

        ${r.notes ? `<section><h2>Notes</h2><p class="notes">${esc(r.notes)}</p></section>` : ''}
        ${r.sourceUrl ? `<p class="small muted">Source: <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(new URL(r.sourceUrl).hostname)}</a></p>` : ''}

        <div class="actions">
          <button class="btn" data-action="cook">👩‍🍳 Cooking mode</button>
          <a class="btn" href="#/edit/${r.id}">Edit</a>
          <button class="btn" data-action="share">Share</button>
          <button class="btn danger" data-action="delete">Delete</button>
        </div>
      </article>`;

    view.querySelectorAll('[data-scale]').forEach(b => (b.onclick = () => { factor = +b.dataset.scale; draw(); }));
    view.querySelectorAll('.steps li:not(.sub)').forEach(li => (li.onclick = () => li.classList.toggle('done')));
    $('[data-action=fav]').onclick = async () => { r.favorite = !r.favorite; Object.assign(r, await saveRecipe(r)); draw(); };
    $('[data-action=delete]').onclick = async () => {
      if (!confirm(`Delete “${r.title}”?`)) return;
      await deleteRecipe(r.id); toast('Recipe deleted'); location.hash = '#/';
    };
    $('[data-action=share]').onclick = () => shareRecipe(r);
    $('[data-action=cook]').onclick = e => toggleCooking(e.currentTarget);
  };
  draw();
}

let wakeLock = null;
async function toggleCooking(btn) {
  document.body.classList.toggle('cooking');
  const on = document.body.classList.contains('cooking');
  btn.textContent = on ? 'Exit cooking mode' : '👩‍🍳 Cooking mode';
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* not supported: fine */ }
  if (on) toast('Bigger text, and the screen stays on');
}

async function shareRecipe(r) {
  const text = `${r.title}\n\n${r.servings ? `Servings: ${r.servings}\n\n` : ''}Ingredients:\n${(r.ingredients || []).map(i => `• ${i}`).join('\n')}\n\nSteps:\n${(r.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}${r.sourceUrl ? `\n\n${r.sourceUrl}` : ''}`;
  if (navigator.share) { try { await navigator.share({ title: r.title, text }); } catch {} return; }
  await navigator.clipboard.writeText(text); toast('Recipe copied to clipboard');
}

async function renderEdit(id) {
  const existing = id ? await getRecipe(id) : null;
  const r = existing || draft || { title: '', ingredients: [], steps: [], tags: [] };
  const isImport = !existing && draft;
  view.innerHTML = `
    <form class="edit" autocomplete="off">
      <h1>${existing ? 'Edit recipe' : isImport ? 'Check the imported recipe' : 'New recipe'}</h1>
      ${isImport ? `<p class="hint">${draft._from === 'photo' ? 'Text recognition is not perfect. Check the lines below and fix anything it misread, then save.' : 'Here is what we found. Make any changes, then save.'}</p>` : ''}

      <div class="photo-field">
        <div class="photo-prev">${r.image ? `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">` : '<span>No photo</span>'}</div>
        <div class="photo-btns">
          <button type="button" class="btn small" data-act="cam">📷 Take photo</button>
          <button type="button" class="btn small" data-act="pick">Choose photo</button>
          ${r.image ? '<button type="button" class="btn small ghost" data-act="rm">Remove</button>' : ''}
        </div>
      </div>

      <label>Title<input name="title" required value="${esc(r.title)}" placeholder="e.g. Grandma's banitsa"></label>
      <label>Short description<input name="description" value="${esc(r.description)}"></label>
      <div class="row">
        <label>Servings<input name="servings" value="${esc(r.servings)}" placeholder="4"></label>
        <label>Prep (min)<input name="prepTime" type="number" min="0" inputmode="numeric" value="${r.prepTime ?? ''}"></label>
        <label>Cook (min)<input name="cookTime" type="number" min="0" inputmode="numeric" value="${r.cookTime ?? ''}"></label>
        <label>Total (min)<input name="totalTime" type="number" min="0" inputmode="numeric" value="${r.totalTime ?? ''}"></label>
      </div>
      <label>Ingredients <span class="muted small">one per line</span>
        <textarea name="ingredients" rows="8" placeholder="500 g flour&#10;2 eggs&#10;1 tsp salt">${esc((r.ingredients || []).join('\n'))}</textarea></label>
      <label>Steps <span class="muted small">one per line</span>
        <textarea name="steps" rows="8" placeholder="Mix the flour and salt.&#10;Add the eggs...">${esc((r.steps || []).join('\n'))}</textarea></label>
      <label>Tags <span class="muted small">comma separated</span><input name="tags" value="${esc((r.tags || []).join(', '))}" placeholder="dinner, vegetarian"></label>
      <label>Notes<textarea name="notes" rows="3">${esc(r.notes)}</textarea></label>
      <label>Source link<input name="sourceUrl" type="url" value="${esc(r.sourceUrl)}" placeholder="https://"></label>
      ${r._rawText ? `<details class="raw"><summary>Recognised text from the photo</summary><pre>${esc(r._rawText)}</pre></details>` : ''}

      <div class="actions sticky">
        <button type="button" class="btn" data-act="cancel">Cancel</button>
        <button class="btn primary" type="submit">Save recipe</button>
      </div>
    </form>`;

  const form = $('form.edit');
  let image = r.image || '';
  const setPhoto = async camera => {
    const [f] = await pickFiles({ camera });
    if (!f) return;
    image = await resizeImage(f);
    $('.photo-prev').innerHTML = `<img src="${image}" alt="">`;
  };
  form.querySelector('[data-act=cam]').onclick = () => setPhoto(true);
  form.querySelector('[data-act=pick]').onclick = () => setPhoto(false);
  const rm = form.querySelector('[data-act=rm]');
  if (rm) rm.onclick = () => { image = ''; $('.photo-prev').innerHTML = '<span>No photo</span>'; rm.remove(); };
  form.querySelector('[data-act=cancel]').onclick = () => { draft = null; history.length > 1 ? history.back() : (location.hash = '#/'); };

  form.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const num = v => (v === '' ? null : Math.max(0, parseInt(v, 10)) || null);
    const saved = await saveRecipe({
      ...(existing || {}),
      title: d.title.trim(), description: d.description.trim(), image,
      servings: d.servings.trim(), prepTime: num(d.prepTime), cookTime: num(d.cookTime), totalTime: num(d.totalTime),
      ingredients: lines(d.ingredients), steps: lines(d.steps),
      tags: d.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
      notes: d.notes.trim(), sourceUrl: d.sourceUrl.trim(),
    });
    draft = null;
    toast('Saved');
    location.replace(`#/recipe/${saved.id}`);
  };
}

function renderSettings() {
  view.innerHTML = `
    <div class="settings">
      <h1>Backup</h1>
      <p class="muted">Your recipes are saved on this device only. Download a backup file to keep them safe or to move them to another phone or computer.</p>
      <div class="actions">
        <button class="btn primary" data-act="export">Download backup</button>
        <button class="btn" data-act="import">Restore from backup</button>
      </div>
      <h2>Install on your phone</h2>
      <p class="muted">Open this page in your phone's browser. On iPhone tap Share, then “Add to Home Screen”. On Android tap the menu, then “Install app”. It then opens like a normal app and works offline.</p>
    </div>`;
  $('[data-act=export]').onclick = async () => {
    const data = JSON.stringify({ app: 'recipe-box', version: 1, exportedAt: new Date().toISOString(), recipes: await allRecipes() });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `recipes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $('[data-act=import]').onclick = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        const n = await importAll(Array.isArray(data) ? data : data.recipes);
        toast(`Restored ${n} recipes`);
      } catch { toast('That file is not a recipe backup'); }
    };
    input.click();
  };
}

// ---------- add / import ----------
function openSheet(html, onMount) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-backdrop"></div><div class="sheet-panel" role="dialog" aria-modal="true">${html}</div>`;
  sheet.hidden = false;
  const close = () => { sheet.hidden = true; sheet.innerHTML = ''; };
  sheet.querySelector('.sheet-backdrop').onclick = close;
  onMount?.(sheet.querySelector('.sheet-panel'), close);
  return close;
}

function openAddSheet() {
  openSheet(`
    <h2>Add a recipe</h2>
    <div class="add-options">
      <button data-a="cam"><span>📷</span><b>Take a photo</b><small>Of a cookbook page or a handwritten card</small></button>
      <button data-a="upload"><span>🖼️</span><b>Upload photos</b><small>One or more pictures of a recipe</small></button>
      <button data-a="url"><span>🔗</span><b>From a link</b><small>Paste the address of a recipe website</small></button>
      <button data-a="paste"><span>📋</span><b>Paste text</b><small>Copied from a message or a document</small></button>
      <button data-a="manual"><span>✍️</span><b>Write it myself</b><small>Start with an empty recipe</small></button>
    </div>`, (panel, close) => {
    panel.querySelector('[data-a=manual]').onclick = () => { close(); draft = null; location.hash = '#/new'; };
    panel.querySelector('[data-a=cam]').onclick = async () => { close(); importFromPhotos(await pickFiles({ camera: true })); };
    panel.querySelector('[data-a=upload]').onclick = async () => { close(); importFromPhotos(await pickFiles({ multiple: true })); };
    panel.querySelector('[data-a=url]').onclick = () => { close(); openUrlSheet(); };
    panel.querySelector('[data-a=paste]').onclick = () => { close(); openPasteSheet(); };
  });
}

function openUrlSheet(prefill = '') {
  openSheet(`
    <h2>Import from a link</h2>
    <form class="stack">
      <input name="url" type="url" required placeholder="https://www.example.com/recipe" value="${esc(prefill)}" autofocus>
      <p class="error" hidden></p>
      <button class="btn primary">Import</button>
    </form>`, (panel, close) => {
    const form = panel.querySelector('form');
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = form.querySelector('button'); const err = form.querySelector('.error');
      btn.disabled = true; btn.textContent = 'Reading the page…'; err.hidden = true;
      try {
        const res = await fetch(`/api/import?url=${encodeURIComponent(form.url.value.trim())}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        draft = { ...data, _from: 'url' };
        close(); location.hash = '#/new';
      } catch (ex) {
        err.textContent = navigator.onLine ? ex.message : 'You are offline. Connect to the internet to import from a link.';
        err.hidden = false; btn.disabled = false; btn.textContent = 'Import';
      }
    };
  });
}

function openPasteSheet() {
  openSheet(`
    <h2>Paste recipe text</h2>
    <form class="stack">
      <textarea name="text" rows="10" required placeholder="Paste the whole recipe here. We will find the title, ingredients and steps."></textarea>
      <button class="btn primary">Continue</button>
    </form>`, (panel, close) => {
    panel.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const text = e.target.text.value;
      if (/^https?:\/\/\S+$/.test(text.trim())) { close(); openUrlSheet(text.trim()); return; }
      draft = { ...parseRecipeText(text), _from: 'paste' };
      close(); location.hash = '#/new';
    };
  });
}

let tesseractLoading;
function loadTesseract() {
  tesseractLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/tesseract/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { tesseractLoading = null; reject(new Error('Could not load text recognition. Check your connection and try again.')); };
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

async function importFromPhotos(files) {
  if (!files?.length) return;
  let cancelled = false;
  const close = openSheet(`
    <h2>Reading your recipe</h2>
    <div class="ocr-thumbs"></div>
    <div class="progress"><div class="bar"></div></div>
    <p class="muted small status">Preparing…</p>
    <button class="btn ghost" data-a="cancel">Cancel</button>`, (panel, closeFn) => {
    panel.querySelector('[data-a=cancel]').onclick = () => { cancelled = true; closeFn(); };
  });
  const panel = $('#sheet .sheet-panel');
  const status = t => panel && (panel.querySelector('.status').textContent = t);
  const bar = p => panel && (panel.querySelector('.bar').style.width = `${Math.round(p * 100)}%`);

  try {
    const images = await Promise.all(files.map(f => resizeImage(f, 2200, 0.9)));
    panel.querySelector('.ocr-thumbs').innerHTML = images.map(src => `<img src="${src}" alt="">`).join('');
    status('Loading text recognition (first time takes a little longer)…');
    const Tesseract = await loadTesseract();
    let current = 0;
    const worker = await Tesseract.createWorker(['bul', 'eng'], 1, {
      workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/core', langPath: '/vendor/lang',
      logger: m => {
        if (m.status === 'recognizing text') { bar((current + m.progress) / images.length); status(`Reading text${images.length > 1 ? ` (photo ${current + 1} of ${images.length})` : ''}… ${Math.round(m.progress * 100)}%`); }
        else if (m.status) status(m.status.replace(/^\w/, c => c.toUpperCase()) + '…');
      },
    });
    const texts = [];
    for (current = 0; current < images.length; current++) {
      if (cancelled) break;
      const { data } = await worker.recognize(images[current]);
      texts.push(data.text);
    }
    await worker.terminate();
    if (cancelled) return;
    const raw = texts.join('\n');
    if (raw.replace(/\s/g, '').length < 15) throw new Error('No readable text found. Try a sharper, well lit photo taken straight on.');
    draft = { ...parseRecipeText(raw), image: await resizeImage(files[0]), _rawText: raw, _from: 'photo' };
    close(); location.hash = '#/new';
  } catch (e) {
    if (cancelled) return;
    status(e.message); panel.querySelector('.status').classList.add('error');
    panel.querySelector('[data-a=cancel]').textContent = 'Close';
  }
}

// ---------- router ----------
async function route() {
  const [, page, id] = location.hash.replace(/^#\/?/, '/').split('/');
  document.body.classList.remove('cooking');
  $('#fab').hidden = !!page;
  $('#back').hidden = !page;
  window.scrollTo(0, 0);
  if (!page) return renderList();
  if (page === 'recipe') return renderRecipe(id);
  if (page === 'edit') return renderEdit(id);
  if (page === 'new') return renderEdit(null);
  if (page === 'settings') return renderSettings();
  location.hash = '#/';
}

document.addEventListener('click', e => {
  if (e.target.closest('[data-action=add]') || e.target.closest('#fab')) openAddSheet();
});
$('#back').onclick = () => (history.length > 1 ? history.back() : (location.hash = '#/'));
window.addEventListener('hashchange', route);
route();

// Share target: Android "Share → Recipe Box" with a link
const shared = new URLSearchParams(location.search);
const sharedUrl = shared.get('url') || (shared.get('text') || '').match(/https?:\/\/\S+/)?.[0];
if (sharedUrl) { history.replaceState(null, '', '/#/'); openUrlSheet(sharedUrl); }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
