// Small zero-dependency server: serves the app and fetches recipe pages
// (browsers can't read other sites directly because of CORS).
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { extractRecipe } from './lib/extract.js';

const PORT = Number(process.env.PORT) || 3000;
const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(APP_DIR, 'public');
// Text recognition engine + English/Bulgarian language data, served locally (no CDN needed)
const VENDOR = {
  '/vendor/tesseract/': join(APP_DIR, 'node_modules/tesseract.js/dist/'),
  '/vendor/core/': join(APP_DIR, 'node_modules/tesseract.js-core/'),
  '/vendor/lang/eng.traineddata.gz': join(APP_DIR, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'),
  '/vendor/lang/bul.traineddata.gz': join(APP_DIR, 'node_modules/@tesseract.js-data/bul/4.0.0_best_int/bul.traineddata.gz'),
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.gz': 'application/octet-stream',
};

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:')) return isPrivate(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function fetchPage(rawUrl, depth = 0) {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https links are supported');
  const { address } = await lookup(url.hostname);
  if (isPrivate(address) && !process.env.ALLOW_LOCAL_URLS) throw new Error('That address is not allowed');
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RecipeBox/0.1; +recipe import)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'bg,en;q=0.8',
    },
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    if (depth > 5) throw new Error('Too many redirects');
    return fetchPage(new URL(res.headers.get('location'), url).href, depth + 1);
  }
  if (!res.ok) throw new Error(`The site answered with ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8_000_000) throw new Error('Page is too large');
  // Respect a non-UTF-8 charset (some Bulgarian sites still use windows-1251)
  const charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1]
    || buf.subarray(0, 4000).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] || 'utf-8';
  let html;
  try { html = new TextDecoder(charset).decode(buf); } catch { html = buf.toString('utf8'); }
  return { html, finalUrl: url.href };
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/api/import') {
      const target = u.searchParams.get('url');
      if (!target) return send(res, 400, { error: 'Missing url' });
      let page;
      try { page = await fetchPage(target); } catch (e) {
        return send(res, 502, { error: `Could not open that link: ${e.message}` });
      }
      const recipe = extractRecipe(page.html, page.finalUrl);
      if (!recipe) return send(res, 422, { error: 'No recipe found on that page. Try copying the text and using "Paste text" instead.' });
      return send(res, 200, recipe);
    }
    if (u.pathname === '/api/health') return send(res, 200, { ok: true });

    for (const [prefix, target] of Object.entries(VENDOR)) {
      if (!u.pathname.startsWith(prefix)) continue;
      const rest = normalize(u.pathname.slice(prefix.length));
      if (rest.includes('..')) return send(res, 403, 'Forbidden', 'text/plain');
      const file = target.endsWith('/') ? join(target, rest) : target;
      try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=604800' });
        return res.end(body);
      } catch { return send(res, 404, 'Not found', 'text/plain'); }
    }

    let p = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p.endsWith('/')) p += 'index.html';
    let file = join(ROOT, p);
    if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain');
    try { if (!(await stat(file)).isFile()) throw 0; } catch { file = join(ROOT, 'index.html'); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => console.log(`Recipe app running at http://localhost:${PORT}`));
