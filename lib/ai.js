// Turns messy text (a social media caption, a video description or transcript) into a
// structured recipe with Claude. Enabled when ANTHROPIC_API_KEY is set on the server.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';

const RecipeSchema = z.object({
  is_recipe: z.boolean().describe('false if the text contains no recipe at all'),
  title: z.string(),
  description: z.string().describe('one short sentence, or empty'),
  servings: z.string().describe('e.g. "4" or "4 servings", empty if unknown'),
  prep_minutes: z.number().int().nullable(),
  cook_minutes: z.number().int().nullable(),
  total_minutes: z.number().int().nullable(),
  ingredients: z.array(z.string()).describe('one ingredient per item with its amount, e.g. "200 g spaghetti"'),
  steps: z.array(z.string()).describe('one instruction per item, in order, without numbering'),
  tags: z.array(z.string()).describe('up to 4 short lowercase tags such as "dessert" or "vegetarian"'),
  notes: z.string().describe('useful tips from the text, or empty'),
});

const SYSTEM = `You extract cooking recipes from social media posts, video transcripts and photos (cookbook pages, handwritten recipe cards, screenshots).
Return only what the source says: do not invent ingredients, amounts or steps that are not in the text or clearly spoken in the transcript. If an amount is not given, write the ingredient without one.
Write the recipe in the same language as the source (Bulgarian stays Bulgarian, English stays English).
Ignore hashtags, calls to like or follow, sponsor messages and links.
For photos, read the text exactly as written, including handwriting; if several photos are given they are pages of the same recipe, in order.
Keep each ingredient short ("2 eggs", "1 tsp salt") and each step a clear instruction. If the text has no recipe, set is_recipe to false and leave the lists empty.`;

export function createStructurer(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 });
  const model = env.ANTHROPIC_MODEL || 'claude-opus-5-5';

  return async function structure({ text = '', transcript = '', title = '', platform = '', images = [] }) {
    const source = [
      platform && `Platform: ${platform}`,
      title && `Video/post title: ${title}`,
      text && `Caption / description:\n${text.slice(0, 20000)}`,
      transcript && `Transcript of what is said in the video:\n${transcript.slice(0, 40000)}`,
      images.length && `${images.length} photo(s) of the recipe are attached above.`,
    ].filter(Boolean).join('\n\n');
    const imageBlocks = images.map(({ mediaType, data }) => ({ type: 'image', source: { type: 'base64', media_type: mediaType, data } }));

    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if the main model declines, the API retries on a fallback model
      output_config: { effort: 'low', format: betaZodOutputFormat(RecipeSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: `<source>\n${source}\n</source>\n\nExtract the recipe.` }] }],
    });
    if (response.stop_reason === 'refusal') throw new Error(images.length ? 'The AI declined to read this photo' : 'The AI declined to read this post');
    const r = response.parsed_output;
    if (!r) throw new Error(`AI returned no recipe (stop reason: ${response.stop_reason})`);
    if (!r.is_recipe) return { title: r.title || title, ingredients: [], steps: [], notes: '', tags: [], _ai: true };
    return {
      title: r.title, description: r.description, servings: r.servings,
      prepTime: r.prep_minutes || null, cookTime: r.cook_minutes || null, totalTime: r.total_minutes || null,
      ingredients: r.ingredients, steps: r.steps, tags: r.tags.slice(0, 4), notes: r.notes, _ai: true,
    };
  };
}

const NutritionSchema = z.object({
  servings_assumed: z.number().describe('number of servings the totals are divided by'),
  per_serving: z.object({
    kcal: z.number(), protein_g: z.number(), carbs_g: z.number(), sugar_g: z.number(),
    fat_g: z.number(), saturated_fat_g: z.number(), fiber_g: z.number(), salt_g: z.number(),
  }),
  confidence: z.enum(['low', 'medium', 'high']).describe('low if many amounts are missing or vague'),
  note: z.string().describe('one short sentence on the main assumptions, in the language of the recipe'),
});

// Estimates nutrition per serving from the ingredient list. Returns null without ANTHROPIC_API_KEY.
export function createNutritionEstimator(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 });
  const model = env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  return async function estimate({ title, servings, ingredients }) {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: betaZodOutputFormat(NutritionSchema) },
      system: `You are a nutritionist estimating nutrition facts for home recipes from standard food composition data (such as USDA).
Estimate the total for all ingredients as written, then divide by the number of servings. If servings are not given, assume a sensible number for the dish and say so.
For vague amounts ("salt to taste", "a pinch") use small typical amounts. Ignore water. Oil for deep frying: count only what is absorbed.`,
      messages: [{ role: 'user', content: `<recipe>\nTitle: ${title}\nServings: ${servings || 'not given'}\nIngredients:\n${ingredients.slice(0, 150).join('\n')}\n</recipe>` }],
    });
    const r = response.parsed_output;
    if (!r) throw new Error(`AI returned no estimate (stop reason: ${response.stop_reason})`);
    const round = v => Math.max(0, Math.round(v * 10) / 10);
    return {
      servings: round(r.servings_assumed) || 1,
      perServing: Object.fromEntries(Object.entries(r.per_serving).map(([k, v]) => [k, k === 'kcal' ? Math.round(Math.max(0, v)) : round(v)])),
      confidence: r.confidence, note: r.note.slice(0, 300), estimatedAt: Date.now(),
    };
  };
}
