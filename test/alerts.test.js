import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlerts } from '../lib/alerts.js';
import { createApp } from '../lib/app.js';

test('alerts: off without email, throttled when on', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    assert.equal(createAlerts({ mailer: { enabled: false }, to: 'a@b.c' }).enabled, false);
    assert.equal(createAlerts({ mailer: { enabled: true }, to: '' }).enabled, false);
    const sent = []; let clock = Date.parse('2026-11-25T10:00:00Z');
    const a = createAlerts({ mailer: { enabled: true, send: async m => sent.push(m) }, to: 'owner@example.com', now: () => clock });
    assert.equal(await a.report('Server', new Error('db locked 123')), true);
    assert.equal(await a.report('Server', new Error('db locked 456')), false, 'same error within an hour');
    assert.equal(await a.report('Server', new Error('other')), true);
    clock += 3601_000;
    assert.equal(await a.report('Server', new Error('db locked 789')), true);
    assert.match(sent.at(-1).text, /1 similar alerts were skipped/);
    assert.equal(sent[0].to, 'owner@example.com');
    assert.match(sent[0].subject, /Server error: db locked 123/);
  } finally { console.error = quiet; }
});

test('browser errors and AI failures reach the alerts', async () => {
  const reports = [];
  const alerts = { enabled: true, report: async (kind, e, ctx) => reports.push({ kind, message: e.message, ctx }) };
  const srv = createApp({ dataDir: ':memory:', alerts, mailer: { enabled: false }, structure: async () => { throw new Error('overloaded'); } });
  await new Promise(r => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  const r = await fetch(base + '/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x is undefined', page: '#/recipe' }) });
  assert.equal(r.status, 200);
  assert.deepEqual(reports[0].kind, 'Browser'); assert.equal(reports[0].message, 'x is undefined');
  const su = await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'al@example.com', password: 'password1' }) });
  const cookie = su.headers.get('set-cookie').split(';')[0];
  const p = await fetch(base + '/api/import/photo', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ images: ['data:image/jpeg;base64,AAAA'] }) });
  assert.equal(p.status, 502);
  assert.equal(reports[1].kind, 'AI photo'); assert.equal(reports[1].message, 'overloaded');
  srv.close();
});
