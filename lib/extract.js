// Turns a recipe web page (HTML) into a structured recipe.
// 1) schema.org Recipe in JSON-LD (used by most recipe sites)
// 2) schema.org microdata (itemprop="recipeIngredient" ...)
// 3) Heuristic: find "Ingredients" / "Instructions" sections in the page text

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s = '') {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function cleanText(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// ISO 8601 duration (PT1H30M) -> minutes
export function durationToMinutes(d) {
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!m) return null;
  const mins = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0) + Math.round((+m[4] || 0) / 60);
  return mins || null;
}

function asArray(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }

function hasType(node, type) {
  return asArray(node?.['@type']).some(t => String(t).toLowerCase() === type.toLowerCase());
}

function findRecipeNode(data) {
  const stack = [data];
  while (stack.length) {
    const n = stack.shift();
    if (!n || typeof n !== 'object') continue;
    if (Array.isArray(n)) { stack.push(...n); continue; }
    if (hasType(n, 'Recipe')) return n;
    if (n['@graph']) stack.push(n['@graph']);
    if (n.mainEntity) stack.push(n.mainEntity);
    if (n.itemListElement) stack.push(n.itemListElement);
    if (n.item) stack.push(n.item);
  }
  return null;
}

function imageUrl(img) {
  const first = asArray(img)[0];
  if (!first) return '';
  if (typeof first === 'string') return first;
  return first.url || first.contentUrl || first['@id'] || '';
}

function flattenInstructions(ins) {
  const out = [];
  for (const step of asArray(ins)) {
    if (!step) continue;
    if (typeof step === 'string') {
      // Some sites put all steps in one string separated by newlines
      step.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li)>/gi, '\n').split(/\n+/)
        .map(cleanText).filter(Boolean).forEach(s => out.push(s));
    } else if (hasType(step, 'HowToSection')) {
      if (step.name) out.push(`## ${cleanText(step.name)}`);
      out.push(...flattenInstructions(step.itemListElement));
    } else if (step.itemListElement) {
      out.push(...flattenInstructions(step.itemListElement));
    } else {
      const t = cleanText(step.text || step.name || step.description || '');
      if (t) out.push(t);
    }
  }
  return out;
}

function yieldToString(y) {
  const arr = asArray(y).map(v => cleanText(String(v))).filter(Boolean);
  // Prefer the more descriptive value ("4 servings" over "4")
  return arr.sort((a, b) => b.length - a.length)[0] || '';
}

function keywords(r) {
  const out = new Set();
  const add = v => asArray(v).forEach(x => String(x).split(',').map(s => cleanText(s)).filter(Boolean).forEach(s => out.add(s.toLowerCase())));
  add(r.recipeCategory); add(r.recipeCuisine);
  return [...out].slice(0, 6);
}

export function fromJsonLd(html) {
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch {
      try { data = JSON.parse(m[1].trim().replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; }
    }
    const r = findRecipeNode(data);
    if (!r) continue;
    const ingredients = asArray(r.recipeIngredient || r.ingredients).map(i => cleanText(String(i))).filter(Boolean);
    const steps = flattenInstructions(r.recipeInstructions);
    if (!ingredients.length && !steps.length) continue;
    return {
      title: cleanText(r.name || r.headline || ''),
      description: cleanText(r.description || ''),
      image: imageUrl(r.image),
      servings: yieldToString(r.recipeYield),
      prepTime: durationToMinutes(r.prepTime),
      cookTime: durationToMinutes(r.cookTime),
      totalTime: durationToMinutes(r.totalTime),
      ingredients,
      steps,
      tags: keywords(r),
    };
  }
  return null;
}

export function fromMicrodata(html) {
  const grab = prop => {
    const re = new RegExp(`<([a-z0-9]+)[^>]*itemprop=["'][^"']*\\b${prop}\\b[^"']*["'][^>]*>([\\s\\S]*?)</\\1>`, 'gi');
    const out = []; let m;
    while ((m = re.exec(html))) { const t = cleanText(m[2]); if (t) out.push(t); }
    return out;
  };
  const ingredients = [...grab('recipeIngredient'), ...grab('ingredients')];
  if (!ingredients.length) return null;
  const steps = grab('recipeInstructions').flatMap(s => s.split(/(?<=\.)\s+(?=[A-ZА-Я])/)).filter(Boolean);
  return { title: grab('name')[0] || '', ingredients, steps };
}

const ING_HEAD = /^(ingredients?|съставки|продукти|необходими продукти)\b/i;
const STEP_HEAD = /^(instructions?|directions?|method|preparation|steps|how to make( it)?|начин на приготвяне|приготвяне|начин на приготвяне:)\b/i;

// Generic page fallback: walk headings + list items in document order
export function fromHeuristics(html) {
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ');
  const tokens = [];
  const re = /<(h[1-6]|li|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body))) tokens.push({ tag: m[1].toLowerCase(), text: cleanText(m[2]) });
  let mode = null; const ingredients = []; const steps = [];
  for (const t of tokens) {
    if (!t.text) continue;
    const isHead = t.tag.startsWith('h') || (t.text.length < 40 && /:$/.test(t.text));
    if (isHead) {
      const h = t.text.replace(/:$/, '');
      if (ING_HEAD.test(h)) { mode = 'ing'; continue; }
      if (STEP_HEAD.test(h)) { mode = 'step'; continue; }
      // Any other heading after the steps ends the recipe (comments, related posts...)
      if (t.tag.startsWith('h') && mode === 'step' && steps.length) mode = null;
      continue;
    }
    if (mode === 'ing' && t.tag === 'li' && t.text.length < 200) ingredients.push(t.text);
    else if (mode === 'step' && t.text.length > 3) steps.push(t.text);
  }
  if (!ingredients.length && !steps.length) return null;
  return { ingredients, steps };
}

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return c ? cleanText(c) : '';
}

export function extractRecipe(html, url = '') {
  const base = {
    title: meta(html, 'og:title') || cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    description: meta(html, 'og:description') || meta(html, 'description'),
    image: meta(html, 'og:image'),
  };
  const found = fromJsonLd(html) || fromMicrodata(html) || fromHeuristics(html);
  if (!found) return null;
  const r = { ...base, ...Object.fromEntries(Object.entries(found).filter(([, v]) => v !== '' && v != null)) };
  if (r.image && url) { try { r.image = new URL(r.image, url).href; } catch {} }
  r.sourceUrl = url;
  return r;
}
