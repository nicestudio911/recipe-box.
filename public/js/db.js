// Recipes are stored on the device in IndexedDB (room for photos, works offline).
const DB_NAME = 'recipe-box';
const STORE = 'recipes';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('updatedAt', 'updatedAt');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const allRecipes = async () => (await tx('readonly', s => s.getAll())).sort((a, b) => b.updatedAt - a.updatedAt);
export const getRecipe = id => tx('readonly', s => s.get(id));
export const deleteRecipe = id => tx('readwrite', s => s.delete(id));

export async function saveRecipe(r) {
  const now = Date.now();
  const rec = { ...r, id: r.id || crypto.randomUUID(), createdAt: r.createdAt || now, updatedAt: now };
  await tx('readwrite', s => s.put(rec));
  return rec;
}

export async function importAll(list) {
  let n = 0;
  await tx('readwrite', s => { for (const r of list) if (r && r.title) { s.put({ ...r, id: r.id || crypto.randomUUID(), updatedAt: r.updatedAt || Date.now() }); n++; } });
  return n;
}
