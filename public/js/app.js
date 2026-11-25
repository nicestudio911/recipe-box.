import { allRecipes, getRecipe, saveRecipe, deleteRecipe, importAll, api, currentUser, signUp, logIn, logOut, deleteAccount, legacyRecipes, moveLegacyRecipes } from './db.js';
import { parseRecipeText } from './parse-text.js';
import { t, tn, lang, setLang } from './i18n.js';
import { $, $$, view, esc, lines, toast, fmtMins, resizeImage, pickFiles, openSheet, download } from './ui.js';

let draft = null;        // recipe being created from an import, before it's saved
let listQuery = '';
let listTag = '';
let user = null;         // logged-in account
let pendingSharedUrl = null;
let emailEnabled = false; // server has an email service for verification / reset
let aiEnabled = false;    // server has AI for imports
let verifyBannerClosed = false;

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
    ${emailEnabled && !user.emailVerified && !verifyBannerClosed ? `<div class="banner">
      <span>${t('📧 Please confirm your email. We sent a link to <b>{email}</b>.', { email: esc(user.email) })}</span>
      <span class="banner-actions"><button class="link" data-act="resend">${t('Send again')}</button><button class="link" data-act="close-banner" aria-label="${t('Hide')}">✕</button></span>
    </div>` : ''}
    <div class="search"><input id="q" type="search" placeholder="${t('Search recipes or ingredients')}" value="${esc(listQuery)}" aria-label="${t('Search')}"></div>
    ${recipes.length ? `<div class="chips">
      <button class="chip ${!listTag ? 'on' : ''}" data-tag="">${t('All')}</button>
      <button class="chip ${listTag === '★' ? 'on' : ''}" data-tag="★">${t('★ Favourites')}</button>
      ${tags.map(t => `<button class="chip ${listTag === t ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>` : ''}
    ${!recipes.length ? `
      <div class="empty">
        <div class="empty-icon">🍲</div>
        <h2>${t('No recipes yet')}</h2>
        <p>${t('Add your first one. Write it yourself, snap a photo of a cookbook page, or paste a link.')}</p>
        <button class="btn primary" data-action="add">${t('Add a recipe')}</button>
      </div>` :
      shown.length ? `<div class="grid">${shown.map(card).join('')}</div>` : `<p class="muted center">${t('Nothing matches “{q}”.', { q: esc(listQuery) })}</p>`}`;

  const resend = $('[data-act=resend]');
  if (resend) {
    resend.onclick = () => resendVerification(resend);
    $('[data-act=close-banner]').onclick = () => { verifyBannerClosed = true; $('.banner').remove(); };
  }
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
      <p class="muted small">${[tn((r.ingredients || []).length, 'ingredient', 'ingredients'), fmtMins(time)].filter(Boolean).join(' · ')}</p>
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
          <button class="icon-btn ${r.favorite ? 'fav' : ''}" data-action="fav" aria-label="${t('Favourite')}">${r.favorite ? '★' : '☆'}</button>
        </div>
        ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ''}
        <div class="facts">
          ${r.servings ? `<span>🍽️ ${esc(r.servings)}${factor !== 1 && baseServings ? ` → ${Math.round(baseServings * factor * 10) / 10}` : ''}</span>` : ''}
          ${r.prepTime ? `<span>${t('Prep {t}', { t: fmtMins(r.prepTime) })}</span>` : ''}
          ${r.cookTime ? `<span>${t('Cook {t}', { t: fmtMins(r.cookTime) })}</span>` : ''}
          ${r.totalTime ? `<span>⏱ ${fmtMins(r.totalTime)}</span>` : ''}
        </div>
        ${(r.tags || []).length ? `<div class="chips static">${r.tags.map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}

        <section>
          <div class="section-head">
            <h2>${t('Ingredients')}</h2>
            <div class="scaler" aria-label="${t('Scale recipe')}">
              ${[0.5, 1, 2, 3].map(f => `<button class="${f === factor ? 'on' : ''}" data-scale="${f}">${f === 0.5 ? '½' : f}×</button>`).join('')}
            </div>
          </div>
          <ul class="ingredients">${ing.map((l, i) => l.startsWith('## ') ? `<li class="sub">${esc(l.slice(3))}</li>` :
            `<li><label><input type="checkbox" data-i="${i}"><span>${esc(l)}</span></label></li>`).join('')}</ul>
        </section>

        ${(r.steps || []).length ? `<section>
          <h2>${t('Steps')}</h2>
          <ol class="steps">${r.steps.map(s => s.startsWith('## ') ? `<li class="sub">${esc(s.slice(3))}</li>` : `<li>${esc(s)}</li>`).join('')}</ol>
        </section>` : ''}

        ${r.notes ? `<section><h2>${t('Notes')}</h2><p class="notes">${esc(r.notes)}</p></section>` : ''}
        ${r.sourceUrl ? `<p class="small muted">${t('Source:')} <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">${esc(new URL(r.sourceUrl).hostname)}</a></p>` : ''}

        <div class="actions">
          <button class="btn" data-action="cook">${t('👩‍🍳 Cooking mode')}</button>
          <a class="btn" href="#/edit/${r.id}">${t('Edit')}</a>
          <button class="btn" data-action="share">${t('Share')}</button>
          <button class="btn danger" data-action="delete">${t('Delete')}</button>
        </div>
      </article>`;

    view.querySelectorAll('[data-scale]').forEach(b => (b.onclick = () => { factor = +b.dataset.scale; draw(); }));
    view.querySelectorAll('.steps li:not(.sub)').forEach(li => (li.onclick = () => li.classList.toggle('done')));
    $('[data-action=fav]').onclick = async () => {
      try { Object.assign(r, await saveRecipe({ ...r, favorite: !r.favorite })); draw(); } catch (e) { toast(e.message); }
    };
    $('[data-action=delete]').onclick = async () => {
      if (!confirm(t('Delete “{title}”?', { title: r.title }))) return;
      try { await deleteRecipe(r.id); toast(t('Recipe deleted')); location.hash = '#/'; } catch (e) { toast(e.message); }
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
  btn.textContent = on ? t('Exit cooking mode') : t('👩‍🍳 Cooking mode');
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else { await wakeLock?.release(); wakeLock = null; }
  } catch { /* not supported: fine */ }
  if (on) toast(t('Bigger text, and the screen stays on'));
}

async function shareRecipe(r) {
  const text = `${r.title}\n\n${r.servings ? `${t('Servings: {s}', { s: r.servings })}\n\n` : ''}${t('Ingredients:')}\n${(r.ingredients || []).map(i => `• ${i}`).join('\n')}\n\n${t('Steps:')}\n${(r.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}${r.sourceUrl ? `\n\n${r.sourceUrl}` : ''}`;
  if (navigator.share) { try { await navigator.share({ title: r.title, text }); } catch {} return; }
  await navigator.clipboard.writeText(text); toast(t('Recipe copied to clipboard'));
}

async function renderEdit(id) {
  const existing = id ? await getRecipe(id) : null;
  const r = existing || draft || { title: '', ingredients: [], steps: [], tags: [] };
  const isImport = !existing && draft;
  view.innerHTML = `
    <form class="edit" autocomplete="off">
      <h1>${existing ? t('Edit recipe') : isImport ? t('Check the imported recipe') : t('New recipe')}</h1>
      ${isImport ? `<p class="hint">${draft._from === 'photo' && !draft._ai ? t('Text recognition is not perfect. Check the lines below and fix anything it misread, then save.') : t('Here is what we found. Make any changes, then save.')}</p>` : ''}
      ${isImport && draft._warning ? `<p class="hint warn">⚠️ ${esc(draft._warning)}</p>` : ''}

      <div class="photo-field">
        <div class="photo-prev">${r.image ? `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">` : `<span>${t('No photo')}</span>`}</div>
        <div class="photo-btns">
          <button type="button" class="btn small" data-act="cam">${t('📷 Take photo')}</button>
          <button type="button" class="btn small" data-act="pick">${t('Choose photo')}</button>
          ${r.image ? `<button type="button" class="btn small ghost" data-act="rm">${t('Remove')}</button>` : ''}
        </div>
      </div>

      <label>${t('Title')}<input name="title" required value="${esc(r.title)}" placeholder="${esc(t("e.g. Grandma's banitsa"))}"></label>
      <label>${t('Short description')}<input name="description" value="${esc(r.description)}"></label>
      <div class="row">
        <label>${t('Servings')}<input name="servings" value="${esc(r.servings)}" placeholder="4"></label>
        <label>${t('Prep (min)')}<input name="prepTime" type="number" min="0" inputmode="numeric" value="${r.prepTime ?? ''}"></label>
        <label>${t('Cook (min)')}<input name="cookTime" type="number" min="0" inputmode="numeric" value="${r.cookTime ?? ''}"></label>
        <label>${t('Total (min)')}<input name="totalTime" type="number" min="0" inputmode="numeric" value="${r.totalTime ?? ''}"></label>
      </div>
      <label>${t('Ingredients')} <span class="muted small">${t('one per line')}</span>
        <textarea name="ingredients" rows="8" placeholder="${esc(t('500 g flour\n2 eggs\n1 tsp salt')).replace(/\n/g, '&#10;')}">${esc((r.ingredients || []).join('\n'))}</textarea></label>
      <label>${t('Steps')} <span class="muted small">${t('one per line')}</span>
        <textarea name="steps" rows="8" placeholder="${esc(t('Mix the flour and salt.\nAdd the eggs...')).replace(/\n/g, '&#10;')}">${esc((r.steps || []).join('\n'))}</textarea></label>
      <label>${t('Tags')} <span class="muted small">${t('comma separated')}</span><input name="tags" value="${esc((r.tags || []).join(', '))}" placeholder="${t('dinner, vegetarian')}"></label>
      <label>${t('Notes')}<textarea name="notes" rows="3">${esc(r.notes)}</textarea></label>
      <label>${t('Source link')}<input name="sourceUrl" type="url" value="${esc(r.sourceUrl)}" placeholder="https://"></label>
      ${r._rawText ? `<details class="raw"><summary>${draft?._from === 'photo' ? t('Recognised text from the photo') : t('Original text from the post')}</summary><pre>${esc(r._rawText)}</pre></details>` : ''}

      <div class="actions sticky">
        <button type="button" class="btn" data-act="cancel">${t('Cancel')}</button>
        <button class="btn primary" type="submit">${t('Save recipe')}</button>
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
  if (rm) rm.onclick = () => { image = ''; $('.photo-prev').innerHTML = `<span>${t('No photo')}</span>`; rm.remove(); };
  form.querySelector('[data-act=cancel]').onclick = () => { draft = null; history.length > 1 ? history.back() : (location.hash = '#/'); };

  form.onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const num = v => (v === '' ? null : Math.max(0, parseInt(v, 10)) || null);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = t('Saving…');
    let saved;
    try {
      saved = await saveRecipe({
      ...(existing || {}),
      title: d.title.trim(), description: d.description.trim(), image,
      servings: d.servings.trim(), prepTime: num(d.prepTime), cookTime: num(d.cookTime), totalTime: num(d.totalTime),
      ingredients: lines(d.ingredients), steps: lines(d.steps),
      tags: d.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
      notes: d.notes.trim(), sourceUrl: d.sourceUrl.trim(),
      });
    } catch (ex) {
      btn.disabled = false; btn.textContent = t('Save recipe');
      toast(ex.message, 4000);
      return;
    }
    draft = null;
    toast(t('Saved'));
    location.replace(`#/recipe/${saved.id}`);
  };
}

function renderSettings() {
  view.innerHTML = `
    <div class="settings">
      <h1>${t('Account')}</h1>
      <p class="muted">${t('Logged in as <b>{email}</b>. Your recipes are saved to your account, so they appear on every phone and computer where you log in.', { email: esc(user.email) })}</p>
      ${emailEnabled ? `<p class="small">${user.emailVerified ? t('✅ Email confirmed') : `${t('⚠️ Email not confirmed yet.')} <button class="link" data-act="resend">${t('Send the link again')}</button>`}</p>` : ''}
      <div class="actions"><button class="btn" data-act="logout">${t('Log out')}</button></div>

      <h2>${t('Language')}</h2>
      <div class="scaler lang-pick">
        <button class="${lang === 'bg' ? 'on' : ''}" data-lang="bg">Български</button>
        <button class="${lang === 'en' ? 'on' : ''}" data-lang="en">English</button>
      </div>

      <h2>${t('Change password')}</h2>
      <form class="stack pw-form" autocomplete="on">
        <input type="email" name="username" value="${esc(user.email)}" autocomplete="username" hidden>
        <label>${t('Current password')}<input name="current" type="password" required autocomplete="current-password"></label>
        <label>${t('New password')}<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="${t('At least 8 characters')}"></label>
        <p class="error" hidden></p>
        <button class="btn">${t('Change password')}</button>
      </form>

      <h2>${t('Backup')}</h2>
      <p class="muted">${t('Download all your recipes as a file, or add recipes from a backup file.')}</p>
      <div class="actions">
        <button class="btn" data-act="export">${t('Download backup')}</button>
        <button class="btn" data-act="import">${t('Restore from backup')}</button>
      </div>

      <h2>${t('Install on your phone')}</h2>
      <p class="muted">${t("Open this page in your phone's browser. On iPhone tap Share, then “Add to Home Screen”. On Android tap the menu, then “Install app”. It then opens like a normal app.")}</p>

      <h2>${t('Your data and privacy')}</h2>
      <p class="muted">${t('Download everything we store about you: your account details and all your recipes.')}</p>
      <div class="actions"><a class="btn" href="/api/account/export" download>${t('Download all my data')}</a></div>
      <p class="small legal-links"><a href="/privacy.html">${t('Privacy policy')}</a> · <a href="/terms.html">${t('Terms of use')}</a></p>

      <h2>${t('Delete account')}</h2>
      <p class="muted">${t('Permanently deletes your account and all your recipes. Download a backup first if you want to keep them.')}</p>
      <div class="actions"><button class="btn danger" data-act="delete">${t('Delete my account')}</button></div>
    </div>`;
  const resendBtn = $('[data-act=resend]');
  if (resendBtn) resendBtn.onclick = () => resendVerification(resendBtn);
  $$('[data-lang]').forEach(b => (b.onclick = () => { setLang(b.dataset.lang); renderChrome(); renderSettings(); }));
  const pw = $('.pw-form');
  pw.onsubmit = async e => {
    e.preventDefault();
    const btn = pw.querySelector('button'); const err = pw.querySelector('.error');
    btn.disabled = true; err.hidden = true;
    try {
      await api('/api/password', { method: 'POST', body: { current: pw.current.value, password: pw.password.value } });
      pw.reset(); toast(t('Password changed. Other devices were logged out.'), 4000);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false;
  };
  $('[data-act=logout]').onclick = async () => {
    try { await logOut(); user = null; location.hash = '#/'; route(); } catch (e) { toast(e.message); }
  };
  $('[data-act=delete]').onclick = async () => {
    if (prompt(t('This deletes your account and all your recipes forever. Type DELETE to confirm.')) !== 'DELETE') return;
    try { await deleteAccount(); user = null; toast(t('Your account was deleted')); location.hash = '#/'; route(); } catch (e) { toast(e.message); }
  };
  $('[data-act=export]').onclick = async () => {
    const data = JSON.stringify({ app: 'recipe-box', version: 2, exportedAt: new Date().toISOString(), recipes: await allRecipes() });
    download(`recipes-${new Date().toISOString().slice(0, 10)}.json`, data);
  };
  $('[data-act=import]').onclick = async () => {
    const [file] = await pickFiles({ accept: 'application/json,.json' });
    if (!file) return;
    let list;
    try { const data = JSON.parse(await file.text()); list = Array.isArray(data) ? data : data.recipes; if (!Array.isArray(list)) throw 0; }
    catch { toast(t('That file is not a recipe backup')); return; }
    try { const n = await importAll(list, k => toast(t('Restoring… {k} of {n}', { k, n: list.length }))); toast(t('Restored {n} recipes', { n })); }
    catch (e) { toast(e.message, 4000); }
  };
}

function renderAuth(mode = 'login') {
  const signup = mode === 'signup';
  $('#fab').hidden = true; $('#back').hidden = true; $('#settings-link').hidden = true;
  view.innerHTML = `
    <div class="auth">
      <div class="auth-hero">
        <div class="empty-icon">🍲</div>
        <h1>${signup ? t('Create your recipe box') : t('Welcome back')}</h1>
        <p class="muted">${t('Save your recipes, snap them from a cookbook with your camera, or import them from any recipe website. They follow you to every device.')}</p>
      </div>
      <form class="stack" autocomplete="on">
        ${signup ? `<label>${t('Your name')}<input name="name" autocomplete="name" placeholder="${t('Optional')}"></label>` : ''}
        <label>${t('Email')}<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
        <label>${t('Password')}<input name="password" type="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? t('At least 8 characters') : ''}"></label>
        <p class="error" hidden></p>
        <button class="btn primary">${signup ? t('Create account') : t('Log in')}</button>
        ${!signup && emailEnabled ? `<a href="#" class="center small" data-forgot>${t('Forgot your password?')}</a>` : ''}
      </form>
      <p class="center muted">${signup ? t('Already have an account?') : t('New here?')}
        <a href="#" data-switch>${signup ? t('Log in') : t('Create an account')}</a></p>
      <p class="center small muted legal-links"><a href="/privacy.html">${t('Privacy policy')}</a> · <a href="/terms.html">${t('Terms of use')}</a></p>
    </div>`;
  $('[data-switch]').onclick = e => { e.preventDefault(); renderAuth(signup ? 'login' : 'signup'); };
  const forgot = $('[data-forgot]');
  if (forgot) forgot.onclick = e => { e.preventDefault(); renderForgot($('.auth [name=email]').value); };
  const form = $('.auth form');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button'); const err = form.querySelector('.error');
    btn.disabled = true; err.hidden = true;
    const body = Object.fromEntries(new FormData(form));
    try {
      user = await (signup ? signUp(body) : logIn(body));
      renderChrome();
      await offerLegacyMove();
      route();
      if (pendingSharedUrl) { openUrlSheet(pendingSharedUrl); pendingSharedUrl = null; }
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

async function resendVerification(btn) {
  btn.disabled = true;
  try { await api('/api/verify/send', { method: 'POST', body: {} }); toast(t('Sent. Check your inbox at {email}', { email: user.email }), 4000); }
  catch (e) { toast(e.message, 4000); btn.disabled = false; }
}

function authShell(title, text, inner) {
  $('#fab').hidden = true; $('#back').hidden = true;
  view.innerHTML = `<div class="auth"><div class="auth-hero"><div class="empty-icon">🍲</div><h1>${title}</h1>${text ? `<p class="muted">${text}</p>` : ''}</div>${inner}</div>`;
}

function renderForgot(email = '') {
  authShell(t('Forgot your password?'), t('Enter your email and we will send you a link to choose a new password.'), `
    <form class="stack">
      <label>${t('Email')}<input name="email" type="email" required autocomplete="email" inputmode="email" value="${esc(email)}"></label>
      <p class="error" hidden></p>
      <button class="btn primary">${t('Send reset link')}</button>
    </form>
    <p class="center muted"><a href="#" data-back>${t('Back to log in')}</a></p>`);
  $('[data-back]').onclick = e => { e.preventDefault(); renderAuth(); };
  const form = $('.auth form');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button'); const err = form.querySelector('.error');
    btn.disabled = true; err.hidden = true;
    try {
      await api('/api/forgot', { method: 'POST', body: { email: form.email.value } });
      authShell(t('Check your email'), t('If there is an account for <b>{email}</b>, we just sent it a link to choose a new password. The link works for 1 hour. Check your spam folder too.', { email: esc(form.email.value) }),
        `<p class="center"><a href="#" data-back>${t('Back to log in')}</a></p>`);
      $('[data-back]').onclick = ev => { ev.preventDefault(); renderAuth(); };
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

function renderReset(token) {
  authShell(t('Choose a new password'), '', `
    <form class="stack">
      <label>${t('New password')}<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="${t('At least 8 characters')}"></label>
      <p class="error" hidden></p>
      <button class="btn primary">${t('Save new password')}</button>
    </form>`);
  const form = $('.auth form');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button'); const err = form.querySelector('.error');
    btn.disabled = true; err.hidden = true;
    try {
      ({ user } = await api('/api/reset', { method: 'POST', body: { token, password: form.password.value } }));
      renderChrome();
      toast(t('Password changed. You are logged in.'), 4000);
      location.replace('#/');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; }
  };
}

async function renderVerify(token) {
  authShell(t('Confirming your email…'), '', '');
  try {
    const res = await api('/api/verify', { method: 'POST', body: { token } });
    if (user && user.id === res.user.id) user = res.user;
    authShell(t('Email confirmed ✅'), t('Thanks! Your email address is confirmed.'), `<p class="center"><a class="btn primary" href="#/">${user ? t('Go to my recipes') : t('Log in')}</a></p>`);
  } catch (e) {
    authShell(t('Link not valid'), esc(e.message), `<p class="center"><a class="btn" href="#/">${t('Open Recipe Box')}</a></p>`);
  }
}

// Recipes saved on this device before accounts existed: move them into the account
async function offerLegacyMove() {
  let list = [];
  try { list = await legacyRecipes(); } catch { return; }
  if (!list.length) return;
  if (!confirm(t('This device has {n} recipes saved from before you had an account. Add them to your account?', { n: list.length }))) return;
  try { toast(t('Added {n} recipes to your account', { n: await moveLegacyRecipes() })); } catch (e) { toast(e.message, 4000); }
}

// ---------- add / import ----------
function openAddSheet() {
  openSheet(`
    <h2>${t('Add a recipe')}</h2>
    <div class="add-options">
      <button data-a="cam"><span>📷</span><b>${t('Take a photo')}</b><small>${t('Of a cookbook page or a handwritten card')}</small></button>
      <button data-a="upload"><span>🖼️</span><b>${t('Upload photos')}</b><small>${t('One or more pictures of a recipe')}</small></button>
      <button data-a="url"><span>🔗</span><b>${t('From a link')}</b><small>${t('Recipe website, YouTube, TikTok, Instagram or Facebook')}</small></button>
      <button data-a="paste"><span>📋</span><b>${t('Paste text')}</b><small>${t('Copied from a message or a document')}</small></button>
      <button data-a="manual"><span>✍️</span><b>${t('Write it myself')}</b><small>${t('Start with an empty recipe')}</small></button>
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
    <h2>${t('Import from a link')}</h2>
    <p class="muted small">${aiEnabled ? t('Recipe websites, YouTube videos and Shorts, TikTok, Instagram and Facebook posts. From a post, we read the recipe from its caption and, for YouTube, from what is said in the video.') : t('Recipe websites, YouTube videos and Shorts, TikTok, Instagram and Facebook posts. From a post, we read the recipe from its caption.')}</p>
    <form class="stack">
      <input name="url" type="url" required placeholder="https://www.example.com/recipe" value="${esc(prefill)}" autofocus>
      <p class="error" hidden></p>
      <button class="btn primary">${t('Import')}</button>
    </form>`, (panel, close) => {
    const form = panel.querySelector('form');
    form.onsubmit = async e => {
      e.preventDefault();
      const btn = form.querySelector('button'); const err = form.querySelector('.error');
      btn.disabled = true; btn.textContent = /youtu|tiktok|instagram|facebook|fb\.watch/i.test(form.url.value) ? t('Reading the post… (can take up to 30 seconds)') : t('Reading the page…'); err.hidden = true;
      try {
        const data = await api(`/api/import?url=${encodeURIComponent(form.url.value.trim())}&lang=${lang}`);
        draft = { ...data, _from: 'url' };
        close(); location.hash = '#/new';
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false; btn.disabled = false; btn.textContent = t('Import');
      }
    };
  });
}

function openPasteSheet() {
  openSheet(`
    <h2>${t('Paste recipe text')}</h2>
    <form class="stack">
      <textarea name="text" rows="10" required placeholder="${t('Paste the whole recipe here. We will find the title, ingredients and steps.')}"></textarea>
      <button class="btn primary">${t('Continue')}</button>
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
    s.onerror = () => { tesseractLoading = null; reject(new Error(t('Could not load text recognition. Check your connection and try again.'))); };
    document.head.appendChild(s);
  });
  return tesseractLoading;
}

async function importFromPhotos(files) {
  if (!files?.length) return;
  let cancelled = false;
  const close = openSheet(`
    <h2>${t('Reading your recipe')}</h2>
    <div class="ocr-thumbs"></div>
    <div class="progress"><div class="bar"></div></div>
    <p class="muted small status">${t('Preparing…')}</p>
    <button class="btn ghost" data-a="cancel">${t('Cancel')}</button>`, (panel, closeFn) => {
    panel.querySelector('[data-a=cancel]').onclick = () => { cancelled = true; closeFn(); };
  });
  const panel = $('#sheet .sheet-panel');
  const status = text => panel && (panel.querySelector('.status').textContent = text);
  const bar = p => panel && (panel.querySelector('.bar').style.width = `${Math.round(p * 100)}%`);

  try {
    const images = await Promise.all(files.map(f => resizeImage(f, 2200, 0.9)));
    panel.querySelector('.ocr-thumbs').innerHTML = images.map(src => `<img src="${src}" alt="">`).join('');
    status(t('Loading text recognition (first time takes a little longer)…'));
    const Tesseract = await loadTesseract();
    let current = 0;
    const worker = await Tesseract.createWorker(['bul', 'eng'], 1, {
      workerPath: '/vendor/tesseract/worker.min.js', corePath: '/vendor/core', langPath: '/vendor/lang',
      logger: m => {
        if (m.status !== 'recognizing text') return;
        const p = Math.round(m.progress * 100);
        bar((current + m.progress) / images.length);
        status(images.length > 1 ? t('Reading text (photo {i} of {n})… {p}%', { i: current + 1, n: images.length, p }) : t('Reading text… {p}%', { p }));
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
    if (raw.replace(/\s/g, '').length < 15) throw new Error(t('No readable text found. Try a sharper, well lit photo taken straight on.'));
    draft = { ...parseRecipeText(raw), image: await resizeImage(files[0]), _rawText: raw, _from: 'photo' };
    close(); location.hash = '#/new';
  } catch (e) {
    if (cancelled) return;
    status(e.message); panel.querySelector('.status').classList.add('error');
    panel.querySelector('[data-a=cancel]').textContent = t('Close');
  }
}

// Top bar: language switch and labels that depend on the language
function renderChrome() {
  $('#settings-link').hidden = !user;
  $('#back').setAttribute('aria-label', t('Back'));
  const lb = $('#lang-btn');
  lb.textContent = lang === 'bg' ? 'EN' : 'БГ';
  lb.setAttribute('aria-label', lang === 'bg' ? 'Switch to English' : 'Превключи на български');
}

// ---------- router ----------
async function route() {
  const [, page, id] = location.hash.replace(/^#\/?/, '/').split('/');
  document.body.classList.remove('cooking');
  $('#fab').hidden = !!page;
  $('#back').hidden = !page;
  window.scrollTo(0, 0);
  if (page === 'verify') return renderVerify(id);
  if (page === 'reset') return renderReset(id);
  if (!user) return renderAuth();
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
$('#lang-btn').onclick = () => { setLang(lang === 'bg' ? 'en' : 'bg'); renderChrome(); route(); };
window.addEventListener('hashchange', route);

// Share target: Android "Share → Recipe Box" with a link
const shared = new URLSearchParams(location.search);
const sharedUrl = shared.get('url') || (shared.get('text') || '').match(/https?:\/\/\S+/)?.[0];
if (sharedUrl) history.replaceState(null, '', '/#/');

(async () => {
  try { user = await currentUser(); } catch { user = null; }
  try { ({ emailEnabled, aiEnabled } = await api('/api/config')); } catch { /* offline */ }
  renderChrome();
  await route();
  if (sharedUrl) { if (user) openUrlSheet(sharedUrl); else pendingSharedUrl = sharedUrl; }
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
