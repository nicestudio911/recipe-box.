// HTML for /s/<token>: a shared recipe that anyone can read, with link previews for chat apps.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const L = {
  en: { ingredients: 'Ingredients', steps: 'Steps', notes: 'Notes', servings: 'Servings', min: 'min', source: 'Source', save: 'Save to my Recipe Box',
    made: 'Shared from Recipe Box, a free app for your recipes on phone and web.', open: 'Try Recipe Box', gone: 'This share link no longer works',
    goneText: 'The owner may have stopped sharing this recipe or deleted it.', saved: 'Saved to your recipes ✓' },
  bg: { ingredients: 'Продукти', steps: 'Начин на приготвяне', notes: 'Бележки', servings: 'Порции', min: 'мин', source: 'Източник', save: 'Запази в моя Recipe Box',
    made: 'Споделено от Recipe Box, безплатно приложение за рецептите ви на телефон и компютър.', open: 'Опитайте Recipe Box', gone: 'Тази връзка вече не работи',
    goneText: 'Собственикът може да е спрял споделянето или да е изтрил рецептата.', saved: 'Запазено в рецептите ви ✓' },
};

export function renderSharePage(r, { bg = false, url = '' } = {}) {
  const l = bg ? L.bg : L.en;
  const lang = bg ? 'bg' : 'en';
  const head = (title, extra = '') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<link rel="stylesheet" href="/css/styles.css"><link rel="icon" href="/icons/icon.svg" type="image/svg+xml"><meta name="theme-color" content="#c2532d">${extra}</head>`;
  const top = `<header class="topbar"><a href="/" class="brand"><span>🍲</span> Recipe Box</a></header>`;
  if (!r) return `${head(l.gone, '<meta name="robots" content="noindex">')}<body>${top}<main><div class="empty"><div class="empty-icon">🔗</div><h2>${l.gone}</h2><p>${l.goneText}</p><a class="btn primary" href="/">${l.open}</a></div></main></body></html>`;

  const desc = r.description || (r.ingredients || []).filter(i => !i.startsWith('## ')).slice(0, 6).join(', ');
  const image = r.image ? `${url}/image` : '';
  const og = `<meta name="robots" content="noindex">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(r.title)}"><meta property="og:description" content="${esc(desc.slice(0, 200))}">
<meta property="og:url" content="${esc(url)}">${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : ''}`;
  const mins = m => (m ? (m >= 60 ? `${Math.floor(m / 60)} ${bg ? 'ч' : 'h'}${m % 60 ? ` ${m % 60} ${l.min}` : ''}` : `${m} ${l.min}`) : '');
  const list = (items, tag) => items.map(x => (x.startsWith('## ') ? `<li class="sub">${esc(x.slice(3))}</li>` : tag(x))).join('');
  let host = ''; try { host = r.sourceUrl ? new URL(r.sourceUrl).hostname : ''; } catch {}

  return `${head(`${r.title} · Recipe Box`, og)}<body>${top}<main>
<article class="recipe shared-recipe">
  ${r.image ? `<img class="hero" src="${esc(image)}" alt="">` : ''}
  <h1>${esc(r.title)}</h1>
  ${r.description ? `<p class="muted">${esc(r.description)}</p>` : ''}
  <div class="facts">
    ${r.servings ? `<span>🍽️ ${esc(r.servings)}</span>` : ''}
    ${r.totalTime || r.prepTime || r.cookTime ? `<span>⏱ ${mins(r.totalTime || (r.prepTime || 0) + (r.cookTime || 0))}</span>` : ''}
  </div>
  <div class="actions share-cta"><button class="btn primary" id="save" data-saved="${esc(l.saved)}">＋ ${l.save}</button></div>
  ${(r.ingredients || []).length ? `<section><h2>${l.ingredients}</h2><ul class="ingredients">${list(r.ingredients, x => `<li><label><input type="checkbox"><span>${esc(x)}</span></label></li>`)}</ul></section>` : ''}
  ${(r.steps || []).length ? `<section><h2>${l.steps}</h2><ol class="steps">${list(r.steps, x => `<li>${esc(x)}</li>`)}</ol></section>` : ''}
  ${r.notes ? `<section><h2>${l.notes}</h2><p class="notes">${esc(r.notes)}</p></section>` : ''}
  ${host ? `<p class="small muted">${l.source}: <a href="${esc(r.sourceUrl)}" rel="noopener nofollow" target="_blank">${esc(host)}</a></p>` : ''}
  <p class="small muted share-foot">${l.made} <a href="/">${l.open}</a></p>
</article></main>
<script src="/js/shared.js"></script></body></html>`;
}
