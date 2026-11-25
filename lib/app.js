// HTTP app: static files, accounts, recipes API and recipe link import.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { extractRecipe } from './extract.js';
import { openStore, cleanRecipe, cleanList, LIST_KEYS } from './store.js';
import { createMailer, verificationEmail, resetEmail } from './mail.js';
import { socialPlatform, importSocial } from './social.js';
import { createStructurer, createNutritionEstimator } from './ai.js';
import { renderSharePage } from './share-page.js';
import { createAlerts } from './alerts.js';
import { createGoogleAuth } from './google.js';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
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
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob: https:; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' data: blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
const MAX_BODY = 4_500_000; // a recipe with one resized photo fits easily
const MAX_PHOTOS = 4;
// "data:image/jpeg;base64,..." -> { mediaType, data } for the AI
function parseDataUrl(s) {
  const m = typeof s === 'string' && s.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  return m ? { mediaType: m[1], data: m[2] } : null;
}
const MAX_RECIPES_PER_USER = 2000;

function isPrivate(ip) {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:')) return isPrivate(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function fetchPage(rawUrl, allowLocal, extraHeaders = {}, depth = 0) {
  const url = new URL(rawUrl);
  if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https links are supported');
  const { address } = await lookup(url.hostname);
  if (isPrivate(address) && !allowLocal) throw new Error('That address is not allowed');
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RecipeBox/0.2; +recipe import)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'bg,en;q=0.8',
      ...extraHeaders,
    },
  });
  if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
    if (depth > 5) throw new Error('Too many redirects');
    return fetchPage(new URL(res.headers.get('location'), url).href, allowLocal, extraHeaders, depth + 1);
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

// Simple in-memory limiter: at most `max` hits per key per window
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return key => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    return ++h.n <= max;
  };
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(c => c.trim().split('=')).filter(([k]) => k).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('That is too large. Try a smaller photo.'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('Invalid request'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function createApp({
  dataDir = process.env.DATA_DIR || join(APP_DIR, 'data'),
  allowLocalUrls = !!process.env.ALLOW_LOCAL_URLS,
  trustProxy = !!process.env.TRUST_PROXY,
  appUrl = process.env.APP_URL,   // public address used in email links, e.g. https://recipe-box-ivan.fly.dev
  mailer = createMailer(),
  structure = createStructurer(),  // AI recipe extraction (null when ANTHROPIC_API_KEY is not set)
  nutrition = createNutritionEstimator(), // AI nutrition estimate (null without the key)
  fetcher = fetchPage,             // replaceable in tests
  alerts = null,                   // error emails (see alerts.js)
  google = createGoogleAuth(),     // Sign in with Google (null when not set up)
} = {}) {
  alerts ||= createAlerts({ mailer, appUrl });
  if (mailer.enabled && !appUrl) console.warn('APP_URL is not set: email links will use the request host');
  const store = openStore(dataDir);
  setInterval(() => store.purge(), 3600_000).unref();
  const authLimit = limiter(10, 15 * 60_000);    // log in / sign up attempts per IP
  const importLimit = limiter(30, 60 * 60_000);  // link imports per user per hour
  const aiLimit = limiter(40, 24 * 3600_000);     // social and photo imports per user per day (these use paid AI)
  const writeLimit = limiter(300, 60 * 60_000);  // recipe saves per user per hour
  const clientErrorLimit = limiter(10, 60 * 60_000); // browser error reports per IP per hour
  const shareViewLimit = limiter(600, 60 * 60_000); // shared recipe views per IP per hour
  const listLimit = limiter(1000, 60 * 60_000);  // shopping list / meal plan saves per user per hour
  const mailIpLimit = limiter(5, 15 * 60_000);   // reset emails per IP
  const mailToLimit = limiter(3, 60 * 60_000);   // emails per address per hour

  const baseUrl = req => (appUrl || `${isHttpsReq(req) ? 'https' : 'http'}://${req.headers.host}`).replace(/\/$/, '');
  function isHttpsReq(req) { return req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https'); }
  async function sendMail(to, message) {
    if (!mailToLimit(to.toLowerCase())) return false;
    try { await mailer.send({ to, ...message }); return true; }
    catch (e) { console.error('Email failed:', e.message); return false; }
  }
  const sendVerification = (req, user) =>
    sendMail(user.email, verificationEmail(`${baseUrl(req)}/#/verify/${store.createEmailToken(user.id, 'verify')}`));

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...headers });
    res.end(JSON.stringify(body));
  };
  const redirect = (res, location, headers = {}) => { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers }); res.end(); };
  const clientIp = req => (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
  const isHttps = req => req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
  const sessionCookie = (req, token, maxAge) =>
    `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;

  async function api(req, res, u) {
    const method = req.method;
    // CSRF protection: state changes must be JSON from our own origin
    if (method !== 'GET') {
      const origin = req.headers.origin;
      if (origin) {
        let host = null; try { host = new URL(origin).host; } catch {}
        if (host !== req.headers.host) return send(res, 403, { error: 'Forbidden' });
      }
      if (!/^application\/json/.test(req.headers['content-type'] || '') && method !== 'DELETE') return send(res, 415, { error: 'Expected JSON' });
    }
    const token = parseCookies(req.headers.cookie).sid;
    const user = store.userForToken(token);
    const path = u.pathname;

    if (path === '/api/health') return send(res, 200, { ok: true });
    if (path === '/api/config') return send(res, 200, { emailEnabled: mailer.enabled, aiEnabled: !!structure, googleEnabled: !!google });

    // Sign in with Google: /api/auth/google sends the browser to Google, which comes back to .../callback
    if (path === '/api/auth/google' && method === 'GET' && google) {
      if (!authLimit(clientIp(req))) return redirect(res, '/#/login-error/limit');
      const { url, state } = google.start(`${baseUrl(req)}/api/auth/google/callback`);
      return redirect(res, url, { 'Set-Cookie': `gstate=${state}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=600${isHttps(req) ? '; Secure' : ''}` });
    }
    if (path === '/api/auth/google/callback' && method === 'GET' && google) {
      const clear = `gstate=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
      const state = parseCookies(req.headers.cookie).gstate;
      const code = u.searchParams.get('code');
      if (u.searchParams.get('error')) return redirect(res, '/#/', { 'Set-Cookie': clear }); // they pressed Cancel
      if (!code || !state || state !== u.searchParams.get('state')) return redirect(res, '/#/login-error/state', { 'Set-Cookie': clear });
      try {
        const profile = await google.finish(code, `${baseUrl(req)}/api/auth/google/callback`);
        const { token: t } = store.googleLogin(profile);
        return redirect(res, '/#/', { 'Set-Cookie': [clear, sessionCookie(req, t, store.sessionMaxAge)] });
      } catch (e) {
        if (e.status === 409) return redirect(res, '/#/login-error/linked', { 'Set-Cookie': clear });
        alerts.report('Google sign-in', e);
        return redirect(res, '/#/login-error/google', { 'Set-Cookie': clear });
      }
    }

    if (path === '/api/signup' || path === '/api/login') {
      if (method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!authLimit(clientIp(req))) return send(res, 429, { error: 'Too many attempts. Please wait 15 minutes and try again.' });
      const body = await readJson(req);
      const { user: u2, token: t } = path === '/api/signup' ? await store.signUp(body) : await store.logIn(body);
      if (path === '/api/signup' && mailer.enabled) await sendVerification(req, u2);
      return send(res, 200, { user: u2 }, { 'Set-Cookie': sessionCookie(req, t, store.sessionMaxAge) });
    }
    if (path === '/api/logout' && method === 'POST') {
      store.logOut(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }
    if (path === '/api/me' && method === 'GET') return send(res, 200, { user });

    if (path === '/api/client-error' && method === 'POST') {
      if (!clientErrorLimit(clientIp(req))) return send(res, 204, {});
      const b = await readJson(req);
      alerts.report('Browser', { message: String(b.message || '').slice(0, 300), stack: String(b.stack || '').slice(0, 2000) },
        { page: String(b.page || '').slice(0, 200), browser: String(req.headers['user-agent'] || '').slice(0, 200) });
      return send(res, 200, { ok: true });
    }

    // Shared recipes can be viewed without an account
    const sh = path.match(/^\/api\/shared\/([\w-]{16})$/);
    if (sh && method === 'GET') {
      if (!shareViewLimit(clientIp(req))) return send(res, 429, { error: 'Too many requests. Please wait a little.' });
      const r = store.sharedRecipe(sh[1]);
      return r ? send(res, 200, r) : send(res, 404, { error: 'This share link no longer works.' });
    }

    // Links from emails work without being logged in
    if (path === '/api/verify' && method === 'POST') {
      const { token: vt } = await readJson(req);
      return send(res, 200, { user: store.verifyEmail(vt) });
    }
    if (path === '/api/forgot' && method === 'POST') {
      if (!mailer.enabled) return send(res, 503, { error: 'Password reset by email is not available yet.' });
      if (!mailIpLimit(clientIp(req))) return send(res, 429, { error: 'Too many requests. Please wait 15 minutes and try again.' });
      const { email } = await readJson(req);
      const u2 = store.userByEmail(email);
      if (u2) await sendMail(u2.email, resetEmail(`${baseUrl(req)}/#/reset/${store.createEmailToken(u2.id, 'reset')}`));
      // Same answer either way, so nobody can find out who has an account
      return send(res, 200, { ok: true });
    }
    if (path === '/api/reset' && method === 'POST') {
      if (!authLimit(clientIp(req))) return send(res, 429, { error: 'Too many attempts. Please wait 15 minutes and try again.' });
      const { token: rt, password } = await readJson(req);
      const { user: u2, token: t } = await store.resetPassword(rt, password);
      return send(res, 200, { user: u2 }, { 'Set-Cookie': sessionCookie(req, t, store.sessionMaxAge) });
    }

    if (!user) return send(res, 401, { error: 'Please log in' });

    if (path === '/api/password' && method === 'POST') {
      if (!authLimit(`pw:${user.id}`)) return send(res, 429, { error: 'Too many attempts. Please wait 15 minutes and try again.' });
      await store.changePassword(user.id, token, await readJson(req));
      return send(res, 200, { ok: true });
    }
    if (path === '/api/verify/send' && method === 'POST') {
      if (!mailer.enabled) return send(res, 503, { error: 'Email is not available yet.' });
      if (user.emailVerified) return send(res, 200, { ok: true, already: true });
      if (!(await sendVerification(req, user))) return send(res, 429, { error: 'Could not send the email right now. Please try again in an hour.' });
      return send(res, 200, { ok: true });
    }

    if (path === '/api/account/export' && method === 'GET') {
      const data = { exportedAt: new Date().toISOString(), app: 'Recipe Box', account: store.accountInfo(user.id), recipes: store.listRecipes(user.id), lists: store.allLists(user.id) };
      const day = new Date().toISOString().slice(0, 10);
      return send(res, 200, data, { 'Content-Disposition': `attachment; filename="recipe-box-my-data-${day}.json"` });
    }
    if (path === '/api/account' && method === 'DELETE') {
      store.deleteAccount(user.id);
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }

    if (path === '/api/recipes' && method === 'GET') return send(res, 200, { recipes: store.listRecipes(user.id) });

    const shm = path.match(/^\/api\/recipes\/([\w-]{1,64})\/share$/);
    if (shm) {
      if (!store.getRecipe(user.id, shm[1])) return send(res, 404, { error: 'Not found' });
      const link = tok => (tok ? `${baseUrl(req)}/s/${tok}` : null);
      if (method === 'GET') return send(res, 200, { url: link(store.shareToken(user.id, shm[1])) });
      if (method === 'POST') return send(res, 200, { url: link(store.createShare(user.id, shm[1])) });
      if (method === 'DELETE') { store.deleteShare(user.id, shm[1]); return send(res, 200, { url: null }); }
    }
    const svm = path.match(/^\/api\/shared\/([\w-]{16})\/save$/);
    if (svm && method === 'POST') {
      const r = store.sharedRecipe(svm[1]);
      if (!r) return send(res, 404, { error: 'This share link no longer works.' });
      if (store.countRecipes(user.id) >= MAX_RECIPES_PER_USER) return send(res, 403, { error: 'Recipe limit reached' });
      const { nutrition, createdAt, updatedAt, ...copy } = r;
      return send(res, 200, store.saveRecipe(user.id, cleanRecipe({ ...copy, nutrition }, randomUUID())));
    }

    const nm = path.match(/^\/api\/recipes\/([\w-]{1,64})\/nutrition$/);
    if (nm && method === 'POST') {
      if (!nutrition) return send(res, 503, { error: 'AI reading is not available.' });
      const r = store.getRecipe(user.id, nm[1]);
      if (!r) return send(res, 404, { error: 'Not found' });
      const ingredients = (r.ingredients || []).filter(l => !l.startsWith('## '));
      if (!ingredients.length) return send(res, 400, { error: 'Add ingredients first.' });
      if (!aiLimit(user.id)) return send(res, 429, { error: 'You have reached today\'s limit for AI imports. Please try again tomorrow.' });
      try {
        const est = await nutrition({ title: r.title, servings: r.servings, ingredients });
        return send(res, 200, store.saveRecipe(user.id, cleanRecipe({ ...r, nutrition: est }, r.id)));
      } catch (e) {
        alerts.report('AI nutrition', e, { recipe: r.title });
        return send(res, 502, { error: 'AI reading failed' });
      }
    }

    const m = path.match(/^\/api\/recipes\/([\w-]{1,64})$/);
    if (m) {
      const id = m[1];
      if (method === 'GET') { const r = store.getRecipe(user.id, id); return r ? send(res, 200, r) : send(res, 404, { error: 'Not found' }); }
      if (method === 'PUT') {
        if (!writeLimit(user.id)) return send(res, 429, { error: 'Too many changes. Please try again later.' });
        if (!store.getRecipe(user.id, id) && store.countRecipes(user.id) >= MAX_RECIPES_PER_USER) return send(res, 403, { error: 'Recipe limit reached' });
        return send(res, 200, store.saveRecipe(user.id, cleanRecipe(await readJson(req), id)));
      }
      if (method === 'DELETE') { store.deleteRecipe(user.id, id); return send(res, 200, { ok: true }); }
    }
    if (path === '/api/recipes' && method === 'POST') {
      if (!writeLimit(user.id)) return send(res, 429, { error: 'Too many changes. Please try again later.' });
      if (store.countRecipes(user.id) >= MAX_RECIPES_PER_USER) return send(res, 403, { error: 'Recipe limit reached' });
      return send(res, 200, store.saveRecipe(user.id, cleanRecipe(await readJson(req), randomUUID())));
    }

    const lm = path.match(/^\/api\/lists\/(\w+)$/);
    if (lm && LIST_KEYS.includes(lm[1])) {
      if (method === 'GET') return send(res, 200, store.getList(user.id, lm[1]));
      if (method === 'PUT') {
        if (!listLimit(user.id)) return send(res, 429, { error: 'Too many changes. Please wait a little.' });
        return send(res, 200, store.saveList(user.id, lm[1], cleanList(lm[1], await readJson(req))));
      }
    }

    if (path === '/api/import/photo' && method === 'POST') {
      if (!structure) return send(res, 503, { error: 'AI reading is not available.' });
      const { images } = await readJson(req);
      const list = (Array.isArray(images) ? images : []).slice(0, MAX_PHOTOS).map(parseDataUrl).filter(Boolean);
      if (!list.length) return send(res, 400, { error: 'No photo received' });
      if (!aiLimit(user.id)) return send(res, 429, { error: 'You have reached today\'s limit for AI imports. Please try again tomorrow.' });
      try {
        const recipe = await structure({ images: list });
        if (!recipe.ingredients.length && !recipe.steps.length) return send(res, 422, { error: 'No recipe found in that photo.' });
        return send(res, 200, recipe);
      } catch (e) {
        alerts.report('AI photo', e, { photos: list.length });
        return send(res, 502, { error: 'AI reading failed' });
      }
    }

    if (path === '/api/import' && method === 'GET') {
      if (!importLimit(user.id)) return send(res, 429, { error: 'You have imported a lot of links this hour. Please try again later.' });
      const target = u.searchParams.get('url');
      if (!target) return send(res, 400, { error: 'Missing url' });
      if (socialPlatform(target)) {
        if (!aiLimit(user.id)) return send(res, 429, { error: 'You have reached today\'s limit for social media imports. Please try again tomorrow.' });
        try {
          const recipe = await importSocial(target, (u, o = {}) => fetcher(u, allowLocalUrls, o.headers), { structure, lang: u.searchParams.get('lang') });
          return send(res, 200, recipe);
        } catch (e) { return send(res, 422, { error: e.message }); }
      }
      let page;
      try { page = await fetcher(target, allowLocalUrls); } catch (e) {
        return send(res, 502, { error: `Could not open that link: ${e.message}` });
      }
      const recipe = extractRecipe(page.html, page.finalUrl);
      if (!recipe) return send(res, 422, { error: 'No recipe found on that page. Try copying the text and using "Paste text" instead.' });
      return send(res, 200, recipe);
    }
    return send(res, 404, { error: 'Not found' });
  }

  // Public page for a shared recipe: readable without the app, with a preview for chat apps
  function sharePage(req, res, token, image) {
    if (!shareViewLimit(clientIp(req))) return send(res, 429, { error: 'Too many requests. Please wait a little.' });
    const r = store.sharedRecipe(token);
    if (image) {
      const m = r?.image?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (m) { res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=3600', ...SECURITY_HEADERS }); return res.end(Buffer.from(m[2], 'base64')); }
      if (r?.image) { res.writeHead(302, { Location: r.image }); return res.end(); }
      return send(res, 404, { error: 'Not found' });
    }
    const html = renderSharePage(r, { bg: /^bg\b/i.test(req.headers['accept-language'] || ''), url: `${baseUrl(req)}/s/${token}` });
    res.writeHead(r ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(html);
  }

  async function staticFile(req, res, u) {
    const serve = async (file, cache) => {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': cache, ...SECURITY_HEADERS });
      res.end(body);
    };
    for (const [prefix, target] of Object.entries(VENDOR)) {
      if (!u.pathname.startsWith(prefix)) continue;
      const rest = normalize(u.pathname.slice(prefix.length));
      if (rest.includes('..')) return send(res, 403, { error: 'Forbidden' });
      try { return await serve(target.endsWith('/') ? join(target, rest) : target, 'public, max-age=604800'); }
      catch { return send(res, 404, { error: 'Not found' }); }
    }
    let p = normalize(decodeURIComponent(u.pathname));
    if (p.endsWith('/')) p += 'index.html';
    let file = join(ROOT, p);
    if (!file.startsWith(ROOT)) return send(res, 403, { error: 'Forbidden' });
    try { if (!(await stat(file)).isFile()) throw 0; } catch { file = join(ROOT, 'index.html'); }
    return serve(file, 'no-cache');
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname.startsWith('/api/')) return await api(req, res, u);
      const sp = u.pathname.match(/^\/s\/([\w-]{16})(\/image)?$/);
      if (sp) return sharePage(req, res, sp[1], !!sp[2]);
      return await staticFile(req, res, u);
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message });
      alerts.report('Server', e, { request: `${req.method} ${u.pathname}` });
      if (!res.headersSent) send(res, 500, { error: 'Server error' });
    }
  });
  server.on('close', () => store.close());
  server.alerts = alerts;
  return server;
}
