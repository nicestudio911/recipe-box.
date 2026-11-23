import test from 'node:test';
import assert from 'node:assert/strict';
import { importSocial, socialPlatform } from '../lib/social.js';

const pages = {};
const fetchPage = async (url, opts = {}) => {
  for (const [k, v] of Object.entries(pages)) if (url.startsWith(k)) return { html: typeof v === 'function' ? v(opts) : v, finalUrl: url };
  throw new Error('not found ' + url);
};

test('platform detection', () => {
  assert.equal(socialPlatform('https://youtube.com/shorts/abc123XYZ'), 'youtube');
  assert.equal(socialPlatform('https://youtu.be/abc123XYZ'), 'youtube');
  assert.equal(socialPlatform('https://vm.tiktok.com/ZMabc/'), 'tiktok');
  assert.equal(socialPlatform('https://www.instagram.com/reel/Cabc/'), 'instagram');
  assert.equal(socialPlatform('https://fb.watch/abc/'), 'facebook');
  assert.equal(socialPlatform('https://www.bbcgoodfood.com/recipes/x'), null);
});

test('YouTube Short: reads the full description', async () => {
  const player = { videoDetails: { title: 'Fluffy pancakes in 5 minutes', author: 'Chef Ana', shortDescription: 'Ingredients:\n2 eggs\n200 ml milk\n150 g flour\n\nMethod:\n1. Whisk everything.\n2. Fry on a hot pan.\n\n#shorts #pancakes' } };
  pages['https://www.youtube.com/watch?v=abc123XYZ'] = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(player)};var x=1;</script></html>`;
  const r = await importSocial('https://www.youtube.com/shorts/abc123XYZ', fetchPage);
  assert.equal(r.title, 'Fluffy pancakes in 5 minutes');
  assert.deepEqual(r.ingredients, ['2 eggs', '200 ml milk', '150 g flour']);
  assert.deepEqual(r.steps, ['Whisk everything.', 'Fry on a hot pan.']);
  assert.equal(r.image, 'https://i.ytimg.com/vi/abc123XYZ/hqdefault.jpg');
  assert.equal(r.sourceUrl, 'https://www.youtube.com/shorts/abc123XYZ');
  assert.ok(r.tags.includes('youtube'));
  assert.equal(r._warning, '');
});

test('TikTok: caption from oEmbed', async () => {
  pages['https://www.tiktok.com/oembed'] = JSON.stringify({ title: 'Баница за 10 минути 😍\n🥚 4 яйца\n🧀 400 г сирене\n🥛 1 чаша кисело мляко\n1️⃣ Разбийте яйцата.\n2️⃣ Добавете сиренето и млякото.\n#баница', author_name: 'mama_gotvi', thumbnail_url: 'https://p16.tiktokcdn.com/x.jpg' });
  const r = await importSocial('https://www.tiktok.com/@mama_gotvi/video/123', fetchPage);
  assert.equal(r.title, 'Баница за 10 минути 😍');
  assert.deepEqual(r.ingredients, ['4 яйца', '400 г сирене', '1 чаша кисело мляко']);
  assert.equal(r.steps.length, 2);
  assert.match(r.notes, /mama_gotvi on TikTok/);
});

test('Instagram: caption from link preview, AI used when available', async () => {
  pages['https://www.instagram.com/reel/Cxyz/'] = () => {
    return `<meta property="og:description" content="1,234 likes, 56 comments - chef.ivan on May 3, 2025: &quot;Best hummus ever! Blend a can of chickpeas with 2 tbsp tahini, juice of 1 lemon and a garlic clove. Drizzle with olive oil.&quot;"><meta property="og:image" content="https://cdn.ig/x.jpg">`;
  };
  let seen;
  const structure = async input => { seen = input; return { title: 'Best hummus', ingredients: ['1 can chickpeas', '2 tbsp tahini', '1 lemon', '1 garlic clove', 'olive oil'], steps: ['Blend everything.', 'Drizzle with olive oil.'], tags: ['dip'], notes: '', _ai: true }; };
  const r = await importSocial('https://www.instagram.com/reel/Cxyz/', fetchPage, { structure });
  assert.equal(seen.platform, 'Instagram');
  assert.match(seen.text, /^Best hummus ever!/);
  assert.equal(r.title, 'Best hummus');
  assert.equal(r.ingredients.length, 5);
  assert.deepEqual(r.tags, ['dip', 'instagram']);
  assert.match(r.notes, /chef\.ivan/);
  assert.equal(r._ai, undefined);
});

test('Instagram blocked: clear message', async () => {
  pages['https://www.instagram.com/p/blocked/'] = '<meta property="og:description" content="Log in to see photos and videos from friends.">';
  await assert.rejects(importSocial('https://www.instagram.com/p/blocked/', fetchPage), /did not share this post's text/);
});

test('Caption without ingredients gives a warning', async () => {
  pages['https://www.tiktok.com/oembed'] = JSON.stringify({ title: 'You have to try this pasta!! 🤤 #foodtok' });
  const r = await importSocial('https://www.tiktok.com/@x/video/9', fetchPage);
  assert.match(r._warning, /doesn't seem to list the ingredients/);
});
