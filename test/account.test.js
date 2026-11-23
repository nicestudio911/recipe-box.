import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../lib/app.js';

const sent = [];
const mailer = { enabled: true, async send(m) { sent.push(m); } };
const server = createApp({ dataDir: ':memory:', mailer, appUrl: 'https://recipes.test' });
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
test.after(() => server.close());

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body && JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const lastLink = kind => sent.filter(m => m.text.includes(`/#/${kind}/`)).at(-1).text.match(new RegExp(`https://recipes\\.test/#/${kind}/([\\w-]+)`))[1];

test('sign-up sends a verification email and the link verifies', async () => {
  const a = client();
  assert.equal((await a('/api/config')).data.emailEnabled, true);
  const s = await a('/api/signup', { method: 'POST', body: { email: 'v@example.com', password: 'password1' } });
  assert.equal(s.data.user.emailVerified, false);
  assert.equal(sent.at(-1).to, 'v@example.com');
  const token = lastLink('verify');
  const v = await client()('/api/verify', { method: 'POST', body: { token } });
  assert.equal(v.data.user.emailVerified, true);
  assert.equal((await a('/api/me')).data.user.emailVerified, true);
  assert.equal((await a('/api/verify', { method: 'POST', body: { token } })).status, 400, 'link works once');
});

test('change password logs out other devices', async () => {
  const a = client(), b = client();
  await a('/api/signup', { method: 'POST', body: { email: 'p@example.com', password: 'password1' } });
  await b('/api/login', { method: 'POST', body: { email: 'p@example.com', password: 'password1' } });
  assert.equal((await a('/api/password', { method: 'POST', body: { current: 'nope', password: 'password2' } })).status, 401);
  assert.equal((await a('/api/password', { method: 'POST', body: { current: 'password1', password: 'short' } })).status, 400);
  assert.equal((await a('/api/password', { method: 'POST', body: { current: 'password1', password: 'password2' } })).status, 200);
  assert.ok((await a('/api/me')).data.user, 'this device stays logged in');
  assert.equal((await b('/api/me')).data.user, null, 'other device logged out');
  assert.equal((await client()('/api/login', { method: 'POST', body: { email: 'p@example.com', password: 'password2' } })).status, 200);
});

test('forgot password: same answer for unknown emails, reset link works once', async () => {
  const a = client();
  await a('/api/signup', { method: 'POST', body: { email: 'r@example.com', password: 'password1' } });
  const before = sent.length;
  assert.equal((await client()('/api/forgot', { method: 'POST', body: { email: 'nobody@example.com' } })).status, 200);
  assert.equal(sent.length, before, 'no email for unknown address');
  assert.equal((await client()('/api/forgot', { method: 'POST', body: { email: 'R@example.com' } })).status, 200);
  const token = lastLink('reset');
  const c = client();
  assert.equal((await c('/api/reset', { method: 'POST', body: { token, password: 'x' } })).status, 400);
  const r = await c('/api/reset', { method: 'POST', body: { token, password: 'brandnew1' } });
  assert.equal(r.status, 200); assert.equal(r.data.user.emailVerified, true);
  assert.ok((await c('/api/me')).data.user, 'logged in after reset');
  assert.equal((await a('/api/me')).data.user, null, 'old sessions ended');
  assert.equal((await client()('/api/reset', { method: 'POST', body: { token, password: 'another12' } })).status, 400);
  assert.equal((await client()('/api/login', { method: 'POST', body: { email: 'r@example.com', password: 'brandnew1' } })).status, 200);
});

test('without an email service the features report off', async () => {
  const s2 = createApp({ dataDir: ':memory:', mailer: { enabled: false, send() {} } });
  await new Promise(r => s2.listen(0, r));
  const b2 = `http://localhost:${s2.address().port}`;
  assert.equal((await (await fetch(b2 + '/api/config')).json()).emailEnabled, false);
  assert.equal((await fetch(b2 + '/api/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":"a@b.co"}' })).status, 503);
  s2.close();
});
