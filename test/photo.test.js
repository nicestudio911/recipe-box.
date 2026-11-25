import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../lib/app.js';

const calls = [];
const structure = async ({ images }) => {
  calls.push(images);
  if (images[0].data === 'bm9uZQ==') return { title: '', ingredients: [], steps: [] };
  return { title: 'Мусака', ingredients: ['500 г кайма'], steps: ['Печете 40 минути.'], tags: [], _ai: true };
};
const server = createApp({ dataDir: ':memory:', structure, mailer: { enabled: false } });
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

let cookie = '';
const call = async (path, body) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: res.status, data: await res.json() };
};

test('photo import sends the photos to the AI and returns a recipe', async () => {
  assert.equal((await call('/api/import/photo', { images: ['data:image/jpeg;base64,AAAA'] })).status, 401);
  await call('/api/signup', { email: 'ph@example.com', password: 'password1' });
  const r = await call('/api/import/photo', { images: ['data:image/jpeg;base64,AAAA', 'data:image/png;base64,BBBB', 'x', 'y', 'z', 'w'] });
  assert.equal(r.status, 200);
  assert.equal(r.data.title, 'Мусака');
  assert.deepEqual(calls.at(-1), [{ mediaType: 'image/jpeg', data: 'AAAA' }, { mediaType: 'image/png', data: 'BBBB' }], 'only valid images, max 4 considered');
});

test('photo import: bad input and no recipe', async () => {
  assert.equal((await call('/api/import/photo', { images: ['javascript:alert(1)'] })).status, 400);
  assert.equal((await call('/api/import/photo', { images: ['data:image/jpeg;base64,bm9uZQ=='] })).status, 422);
});

test('photo import is off without an AI key', async () => {
  const s2 = createApp({ dataDir: ':memory:', structure: null, mailer: { enabled: false } });
  await new Promise(r => s2.listen(0, r));
  const b2 = `http://localhost:${s2.address().port}`;
  const su = await fetch(b2 + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'n@example.com', password: 'password1' }) });
  const c = su.headers.get('set-cookie').split(';')[0];
  const r = await fetch(b2 + '/api/import/photo', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify({ images: ['data:image/jpeg;base64,AAAA'] }) });
  assert.equal(r.status, 503);
  s2.close();
});

test('nutrition estimate is saved on the recipe', async () => {
  const est = { servings: 4, perServing: { kcal: 420, protein_g: 21, carbs_g: 30, sugar_g: 4, fat_g: 22, saturated_fat_g: 8, fiber_g: 3, salt_g: 1.2 }, confidence: 'medium', note: 'Assumes lean mince.', estimatedAt: 1 };
  const s3 = createApp({ dataDir: ':memory:', structure: null, nutrition: async () => est, mailer: { enabled: false } });
  await new Promise(r => s3.listen(0, r));
  const b3 = `http://localhost:${s3.address().port}`;
  const su = await fetch(b3 + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nu@example.com', password: 'password1' }) });
  const c = su.headers.get('set-cookie').split(';')[0];
  const post = (path, body) => fetch(b3 + path, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: c }, body: JSON.stringify(body) });
  const empty = await (await post('/api/recipes', { title: 'Empty' })).json();
  assert.equal((await post(`/api/recipes/${empty.id}/nutrition`, {})).status, 400);
  const rec = await (await post('/api/recipes', { title: 'Мусака', servings: '4', ingredients: ['500 г кайма'] })).json();
  const r = await post(`/api/recipes/${rec.id}/nutrition`, {});
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.equal(saved.nutrition.perServing.kcal, 420);
  assert.equal(saved.nutrition.confidence, 'medium');
  assert.equal((await post('/api/recipes/nope/nutrition', {})).status, 404);
  s3.close();
});
