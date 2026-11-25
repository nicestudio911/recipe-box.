import test from 'node:test';
import assert from 'node:assert/strict';
import { convertLine, convertTemps } from '../public/js/units.js';

test('US to metric', () => {
  assert.equal(convertLine('2 cups flour', 'metric'), '480 ml flour');
  assert.equal(convertLine('1 1/2 cups milk', 'metric'), '360 ml milk');
  assert.equal(convertLine('½ cup sugar', 'metric'), '120 ml sugar');
  assert.equal(convertLine('8 oz cream cheese', 'metric'), '225 g cream cheese');
  assert.equal(convertLine('2 lb chicken thighs', 'metric'), '905 g chicken thighs');
  assert.equal(convertLine('3 lbs potatoes', 'metric'), '1.4 kg potatoes');
  assert.equal(convertLine('1 tbsp olive oil', 'metric'), '1 tbsp olive oil', 'spoons stay');
  assert.equal(convertLine('2 eggs', 'metric'), '2 eggs');
  assert.equal(convertLine('Bake at 350°F for 20 minutes', 'metric'), 'Bake at 175°C for 20 minutes');
});

test('metric to US', () => {
  assert.equal(convertLine('500 g кайма', 'us'), '1 lb кайма');
  assert.equal(convertLine('200 g flour', 'us'), '7 oz flour');
  assert.equal(convertLine('1 кг картофи', 'us'), '2¼ lb картофи');
  assert.equal(convertLine('250 ml milk', 'us'), '1 cup milk');
  assert.equal(convertLine('1 л мляко', 'us'), '4¼ cups мляко');
  assert.equal(convertLine('2 ч.ч. брашно', 'us'), '1¾ cups брашно');
  assert.equal(convertLine('1 с.л. захар', 'us'), '1 с.л. захар');
  assert.equal(convertTemps('Печете на 180 градуса', 'us'), 'Печете на 355°F');
  assert.equal(convertTemps('Bake at 200°C', 'us'), 'Bake at 390°F');
});

test('no system means no change', () => {
  assert.equal(convertLine('2 cups flour', ''), '2 cups flour');
  assert.equal(convertLine('## Тесто', 'metric'), '## Тесто');
});
