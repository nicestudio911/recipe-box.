import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipeText } from '../public/js/parse-text.js';
import { extractRecipe, durationToMinutes } from '../lib/extract.js';

test('English recipe with headers', () => {
  const r = parseRecipeText(`Classic Pancakes
Serves 4
Ingredients
2 cups flour
1 tbsp sugar
2 eggs
1 1/2 cups milk
Instructions
1. Whisk the flour and sugar
together in a large bowl.
2. Add eggs and milk and stir until smooth.
3. Cook on a hot pan until golden.`);
  assert.equal(r.title, 'Classic Pancakes');
  assert.equal(r.servings, '4');
  assert.deepEqual(r.ingredients, ['2 cups flour', '1 tbsp sugar', '2 eggs', '1 1/2 cups milk']);
  assert.equal(r.steps.length, 3);
  assert.equal(r.steps[0], 'Whisk the flour and sugar together in a large bowl.');
});

test('Bulgarian recipe with headers', () => {
  const r = parseRecipeText(`Таратор
Продукти:
1 краставица
500 г кисело мляко
2 скилидки чесън
1 с.л. олио
Начин на приготвяне:
Краставицата се нарязва на ситно.
Млякото се разбива с вода, добавя се чесънът.`);
  assert.equal(r.title, 'Таратор');
  assert.equal(r.ingredients.length, 4);
  assert.equal(r.steps.length, 2);
});

test('No headers: classify by shape', () => {
  const r = parseRecipeText(`Simple Salad
- 2 tomatoes
- 1 cucumber
- salt
Chop everything and mix it in a bowl with olive oil.`);
  assert.equal(r.title, 'Simple Salad');
  assert.deepEqual(r.ingredients, ['2 tomatoes', '1 cucumber', 'salt']);
  assert.equal(r.steps.length, 1);
});

test('JSON-LD extraction with @graph and sections', () => {
  const html = `<html><head><title>x</title><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, {
      '@type': ['Recipe'], name: 'Banitsa &amp; More', recipeYield: ['8', '8 pieces'], totalTime: 'PT1H15M',
      image: [{ url: '/img.jpg' }], recipeIngredient: ['4 eggs', '400 g sirene'],
      recipeInstructions: [{ '@type': 'HowToSection', name: 'Filling', itemListElement: [{ '@type': 'HowToStep', text: 'Mix eggs and cheese.' }] }, { '@type': 'HowToStep', text: 'Bake.' }],
    }] })}</script></head><body></body></html>`;
  const r = extractRecipe(html, 'https://example.com/r/1');
  assert.equal(r.title, 'Banitsa & More');
  assert.equal(r.servings, '8 pieces');
  assert.equal(r.totalTime, 75);
  assert.equal(r.image, 'https://example.com/img.jpg');
  assert.deepEqual(r.steps, ['## Filling', 'Mix eggs and cheese.', 'Bake.']);
});

test('Heuristic extraction without schema', () => {
  const html = `<h1>Soup</h1><h2>Ingredients</h2><ul><li>1 onion</li><li>2 carrots</li></ul><h2>Directions</h2><ol><li>Chop.</li><li>Boil for 20 min.</li></ol><h2>Comments</h2><p>Nice!</p>`;
  const r = extractRecipe(html, 'https://e.com');
  assert.deepEqual(r.ingredients, ['1 onion', '2 carrots']);
  assert.deepEqual(r.steps, ['Chop.', 'Boil for 20 min.']);
});

test('durations', () => { assert.equal(durationToMinutes('PT45M'), 45); assert.equal(durationToMinutes('P0DT2H'), 120); });
