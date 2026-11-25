import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../lib/app.js';
import { createGoogleAuth } from '../lib/google.js';

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
let claims;
const fetchFn = async (url, opts) => {
  assert.equal(url, 'https://oauth2.googleapis.com/token');
  assert.equal(new URLSearchParams(opts.body.toString()).get('code'), 'good-code');
  return new Response(JSON.stringify({ id_token: `x.${b64(claims)}.sig` }), { status: 200 });
};
const google = createGoogleAuth({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' }, { fetchFn });
const srv = createApp({ dataDir: ':memory:', google, mailer: { enabled: false }, alerts: { report: async () => {} } });
await new Promise(r => srv.listen(0, r));
const base = `http://localhost:${srv.address().port}`;
test.after(() => srv.close());

async function googleLogin(c) {
  const start = await fetch(base + '/api/auth/google', { redirect: 'manual' });
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  assert.equal(to.host, 'accounts.google.com');
  assert.equal(to.searchParams.get('client_id'), 'cid');
  const state = to.searchParams.get('state');
  const gcookie = start.headers.get('set-cookie').split(';')[0];
  claims = { iss: 'https://accounts.google.com', aud: 'cid', exp: Date.now() / 1000 + 600, ...c };
  const cb = await fetch(`${base}/api/auth/google/callback?code=good-code&state=${state}`, { redirect: 'manual', headers: { cookie: gcookie } });
  const cookies = cb.headers.getSetCookie();
  return { location: cb.headers.get('location'), sid: cookies.find(x => x.startsWith('sid='))?.split(';')[0] };
}

test('off without keys', () => {
  assert.equal(createGoogleAuth({}), null);
});

test('new user signs in with Google and can set a first password', async () => {
  assert.equal((await (await fetch(base + '/api/config')).json()).googleEnabled, true);
  const r = await googleLogin({ sub: 'g1', email: 'Ana@Gmail.com', email_verified: true, name: 'Ana' });
  assert.equal(r.location, '/#/');
  const me = await (await fetch(base + '/api/me', { headers: { cookie: r.sid } })).json();
  assert.equal(me.user.email, 'ana@gmail.com'); assert.equal(me.user.emailVerified, true); assert.equal(me.user.hasPassword, false);
  // no password login possible yet
  assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ana@gmail.com', password: '!google' }) })).status, 401);
  const set = await fetch(base + '/api/password', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: r.sid }, body: JSON.stringify({ password: 'newpassword1' }) });
  assert.equal(set.status, 200);
  // same Google account again -> same user
  const again = await googleLogin({ sub: 'g1', email: 'ana@gmail.com', email_verified: true });
  const me2 = await (await fetch(base + '/api/me', { headers: { cookie: again.sid } })).json();
  assert.equal(me2.user.id, me.user.id); assert.equal(me2.user.hasPassword, true);
});

test('unconfirmed account with the same email is taken over safely', async () => {
  const su = await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'victim@gmail.com', password: 'attacker123' }) });
  const attacker = su.headers.get('set-cookie').split(';')[0];
  await googleLogin({ sub: 'g2', email: 'victim@gmail.com', email_verified: true });
  assert.equal((await (await fetch(base + '/api/me', { headers: { cookie: attacker } })).json()).user, null, 'old sessions ended');
  assert.equal((await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'victim@gmail.com', password: 'attacker123' }) })).status, 401);
});

test('bad state, wrong audience and unverified email are refused', async () => {
  const bad = await fetch(`${base}/api/auth/google/callback?code=good-code&state=nope`, { redirect: 'manual' });
  assert.equal(bad.headers.get('location'), '/#/login-error/state');
  assert.equal((await googleLogin({ sub: 'g3', email: 'x@gmail.com', email_verified: true, aud: 'other' })).location, '/#/login-error/google');
  assert.equal((await googleLogin({ sub: 'g4', email: 'y@gmail.com', email_verified: false })).location, '/#/login-error/google');
});
