// Recipes live on the server, per account. A copy is kept on the device (IndexedDB)
// so your recipes still open when you're offline.
import { t } from './i18n.js';

const DB_NAME = 'recipe-box';
const LEGACY = 'recipes'; // version 1 kept recipes only on the device
const CACHE = 'cache';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEGACY)) db.createObjectStore(LEGACY, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
    t.onerror = () => reject(t.error);
  });
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(t('You are offline. Connect to the internet and try again.'), 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(t(data.error || 'Something went wrong'), res.status);
  return data;
}

// ---------- account ----------
export async function currentUser() {
  try {
    const { user } = await api('/api/me');
    try { localStorage.setItem('rb-user', JSON.stringify(user)); } catch {}
    return user;
  } catch (e) {
    if (e.status !== 0) throw e;
    // Offline: remember who was logged in, so cached recipes still open
    try { return JSON.parse(localStorage.getItem('rb-user')); } catch { return null; }
  }
}
export const signUp = body => api('/api/signup', { method: 'POST', body }).then(r => r.user);
export const logIn = body => api('/api/login', { method: 'POST', body }).then(r => r.user);
export async function logOut() {
  await api('/api/logout', { method: 'POST', body: {} });
  await clearCache();
}
export async function deleteAccount() {
  await api('/api/account', { method: 'DELETE' });
  await clearCache();
}
async function clearCache() {
  try { localStorage.removeItem('rb-user'); LIST_KEYS.forEach(k => localStorage.removeItem(LIST_PREFIX + k)); } catch {}
  await tx(CACHE, 'readwrite', s => s.clear());
}

// ---------- recipes ----------
const byUpdated = list => list.sort((a, b) => b.updatedAt - a.updatedAt);

export async function allRecipes() {
  try {
    const { recipes } = await api('/api/recipes');
    await tx(CACHE, 'readwrite', s => { s.clear(); recipes.forEach(r => s.put(r)); });
    return byUpdated(recipes);
  } catch (e) {
    if (e.status !== 0) throw e;
    return byUpdated(await tx(CACHE, 'readonly', s => s.getAll()));
  }
}

export async function getRecipe(id) {
  const cached = await tx(CACHE, 'readonly', s => s.get(id));
  if (cached) return cached;
  try { return await api(`/api/recipes/${encodeURIComponent(id)}`); } catch { return null; }
}

export async function saveRecipe(r) {
  const saved = r.id
    ? await api(`/api/recipes/${encodeURIComponent(r.id)}`, { method: 'PUT', body: r })
    : await api('/api/recipes', { method: 'POST', body: r });
  await tx(CACHE, 'readwrite', s => s.put(saved));
  return saved;
}

export const saveCached = r => tx(CACHE, 'readwrite', s => s.put(r));

export async function deleteRecipe(id) {
  await api(`/api/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await tx(CACHE, 'readwrite', s => s.delete(id));
}

// Upload a list of recipes (restore from backup). Keeps their ids, so restoring twice doesn't duplicate.
export async function importAll(list, onProgress) {
  let n = 0;
  for (const r of list) {
    if (!r || !r.title) continue;
    const id = /^[\w-]{1,64}$/.test(r.id || '') ? r.id : crypto.randomUUID();
    await saveRecipe({ ...r, id });
    onProgress?.(++n);
  }
  return n;
}

// Recipes saved on this device by the first version (before accounts)
export const legacyRecipes = () => tx(LEGACY, 'readonly', s => s.getAll());
export async function moveLegacyRecipes() {
  const list = await legacyRecipes();
  const n = await importAll(list);
  await tx(LEGACY, 'readwrite', s => s.clear());
  return n;
}

// ---------- shopping list and meal plan ----------
// Saved on the device first, then sent to the server, so they work offline and sync later.
const LIST_KEYS = ['shopping', 'plan'];
const LIST_PREFIX = 'rb-list-';
const EMPTY = { shopping: () => ({ items: [] }), plan: () => ({ days: {} }) };
const readLocal = key => { try { return JSON.parse(localStorage.getItem(LIST_PREFIX + key)); } catch { return null; } };
const writeLocal = (key, v) => { try { localStorage.setItem(LIST_PREFIX + key, JSON.stringify(v)); } catch {} };
const pushTimers = {};

async function pushList(key) {
  const local = readLocal(key);
  if (!local?.dirty) return local?.data;
  const sent = JSON.stringify(local.data);
  const saved = await api(`/api/lists/${key}`, { method: 'PUT', body: local.data });
  // Only mark as synced if nothing changed on the device while we were sending
  if (JSON.stringify(readLocal(key)?.data) === sent) writeLocal(key, { data: saved });
  return saved;
}

export async function getList(key) {
  const local = readLocal(key);
  if (local?.dirty) { try { return await pushList(key); } catch { return local.data; } }
  try {
    const data = await api(`/api/lists/${key}`);
    writeLocal(key, { data });
    return data;
  } catch (e) {
    if (e.status !== 0 && e.status !== 401) throw e;
    return local?.data || EMPTY[key]();
  }
}

export function saveList(key, data) {
  writeLocal(key, { data, dirty: true });
  clearTimeout(pushTimers[key]);
  pushTimers[key] = setTimeout(() => pushList(key).catch(() => {}), 600);
  return data;
}

export const syncLists = () => Promise.all(LIST_KEYS.map(k => pushList(k).catch(() => {})));
window.addEventListener('online', syncLists);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') syncLists(); });
