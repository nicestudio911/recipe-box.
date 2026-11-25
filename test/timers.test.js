import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { addEventListener() {}, getElementById: () => null, documentElement: {} };
const { findDurations, fmt } = await import('../public/js/timers.js');

test('finds times in steps', () => {
  const d = s => findDurations(s).map(x => x.secs);
  assert.deepEqual(d('Bake for 25 minutes, then rest 5 min.'), [1500, 300]);
  assert.deepEqual(d('Печете 1 час и 20 минути'), [3600, 1200]);
  assert.deepEqual(d('Варете 10-15 минути'), [600]);
  assert.deepEqual(d('Simmer 1.5 hours'), [5400]);
  assert.deepEqual(d('Оставете за половин час'), [1800]);
  assert.deepEqual(d('Добавете 1 ч.л. сол и 2 ч. ч. брашно'), [], 'teaspoons are not hours');
  assert.deepEqual(d('Use 4 eggs and 200 g flour'), []);
  assert.deepEqual(d('Печете 40 мин.'), [2400]);
});

test('formats countdowns', () => {
  assert.equal(fmt(65), '1:05');
  assert.equal(fmt(3725), '1:02:05');
});
