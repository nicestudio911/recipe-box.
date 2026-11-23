// Tries link imports against the real sites and prints what came out.
// Used by .github/workflows/try-imports.yml (GitHub's servers can reach the sites).
// Usage: node scripts/try-import.mjs <url> [<url> ...]
import { socialPlatform, importSocial } from '../lib/social.js';
import { extractRecipe } from '../lib/extract.js';
import { createStructurer } from '../lib/ai.js';

const structure = createStructurer();
const fetchPage = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RecipeBox/0.3)', 'Accept-Language': 'bg,en;q=0.8', ...(opts.headers || {}) }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { html: await res.text(), finalUrl: res.url };
};

let failed = 0;
for (const url of process.argv.slice(2)) {
  console.log(`\n=== ${url}  (AI: ${structure ? 'on' : 'off'})`);
  try {
    const r = socialPlatform(url) ? await importSocial(url, fetchPage, { structure }) : extractRecipe((await fetchPage(url)).html, url);
    if (!r) throw new Error('no recipe found');
    console.log(JSON.stringify({ title: r.title, servings: r.servings, ingredients: r.ingredients, steps: r.steps, warning: r._warning, image: r.image ? 'yes' : 'no', captionChars: r._rawText?.length }, null, 2));
  } catch (e) { failed++; console.log('FAILED:', e.message); }
}
process.exitCode = failed ? 1 : 0;
