import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../lib/app.js';

const server = createApp({ dataDir: ':memory:' });
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body && JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

test('sign up, save, list, and isolation between users', async () => {
  const a = client(), b = client();
  assert.equal((await a('/api/recipes')).status, 401);
  assert.equal((await a('/api/signup', { method: 'POST', body: { email: 'ana@example.com', password: 'short' } })).status, 400);
  const s = await a('/api/signup', { method: 'POST', body: { email: 'Ana@Example.com', password: 'longenough1', name: 'Ana' } });
  assert.equal(s.status, 200); assert.equal(s.data.user.email, 'ana@example.com');
  assert.equal((await b('/api/signup', { method: 'POST', body: { email: 'ana@example.com', password: 'whatever12' } })).status, 409);

  const saved = await a('/api/recipes', { method: 'POST', body: { title: 'Баница', ingredients: ['4 яйца', 7], image: 'javascript:alert(1)', extra: 'x' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.ingredients, ['4 яйца']);
  assert.equal(saved.data.image, ''); assert.equal(saved.data.extra, undefined);

  const put = await a(`/api/recipes/${saved.data.id}`, { method: 'PUT', body: { ...saved.data, favorite: true } });
  assert.equal(put.data.favorite, true); assert.equal(put.data.createdAt, saved.data.createdAt);
  assert.equal((await a('/api/recipes')).data.recipes.length, 1);

  await b('/api/signup', { method: 'POST', body: { email: 'bob@example.com', password: 'longenough2' } });
  assert.equal((await b('/api/recipes')).data.recipes.length, 0);
  assert.equal((await b(`/api/recipes/${saved.data.id}`)).status, 404);
  await b(`/api/recipes/${saved.data.id}`, { method: 'DELETE' });
  assert.equal((await a('/api/recipes')).data.recipes.length, 1, "b can't delete a's recipe");

  // log out, log in again
  await a('/api/logout', { method: 'POST', body: {} });
  assert.equal((await a('/api/me')).data.user, null);
  assert.equal((await a('/api/login', { method: 'POST', body: { email: 'ana@example.com', password: 'wrongpass' } })).status, 401);
  assert.equal((await a('/api/login', { method: 'POST', body: { email: 'ana@example.com', password: 'longenough1' } })).status, 200);
  assert.equal((await a('/api/recipes')).data.recipes[0].title, 'Баница');
});

test('cross-site and non-JSON writes are refused', async () => {
  const c = client();
  await c('/api/signup', { method: 'POST', body: { email: 'c@example.com', password: 'longenough3' } });
  assert.equal((await c('/api/recipes', { method: 'POST', body: { title: 'x' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  const res = await c('/api/recipes', { method: 'POST', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(res.status, 415);
});

test('link import needs login', async () => {
  assert.equal((await client()('/api/import?url=https://example.com')).status, 401);
});

test('shopping list and meal plan are saved per user and cleaned', async () => {
  const a = client(), b = client();
  await a('/api/signup', { method: 'POST', body: { email: 'lists@example.com', password: 'longenough1' } });
  await b('/api/signup', { method: 'POST', body: { email: 'lists2@example.com', password: 'longenough1' } });
  assert.deepEqual((await a('/api/lists/shopping')).data.items, []);
  const s = await a('/api/lists/shopping', { method: 'PUT', body: { items: [{ id: 'x1', text: ' 2 яйца ', done: true, recipe: 'Баница' }, { text: '' }, { text: 5 }, { text: 'мляко' }] } });
  assert.equal(s.status, 200);
  assert.equal(s.data.items.length, 2);
  assert.deepEqual(s.data.items[0], { id: 'x1', text: '2 яйца', done: true, recipe: 'Баница' });
  assert.ok(s.data.updatedAt > 0);
  assert.equal((await a('/api/lists/shopping')).data.items[1].text, 'мляко');
  assert.deepEqual((await b('/api/lists/shopping')).data.items, [], 'other users see their own list');

  const p = await a('/api/lists/plan', { method: 'PUT', body: { days: { '2026-11-25': [{ recipeId: 'r1' }, { text: 'Leftovers' }, {}], 'bad': [{ text: 'x' }], '2026-11-26': [] } } });
  assert.deepEqual(Object.keys(p.data.days), ['2026-11-25']);
  assert.equal(p.data.days['2026-11-25'].length, 2);
  assert.equal((await a('/api/lists/other')).status, 404);
});

test('recipes keep their collections', async () => {
  const a = client();
  await a('/api/signup', { method: 'POST', body: { email: 'coll@example.com', password: 'longenough1' } });
  const r = await a('/api/recipes', { method: 'POST', body: { title: 'Таратор', collections: ['Summer', ' Summer ', 'Quick', 7, ''] } });
  assert.deepEqual(r.data.collections, ['Summer', 'Quick']);
});
