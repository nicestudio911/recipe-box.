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

const SYSTEM = `You extract cooking recipes from social media posts and video transcripts.
Return only what the source says: do not invent ingredients, amounts or steps that are not in the text or clearly spoken in the transcript. If an amount is not given, write the ingredient without one.
Write the recipe in the same language as the source (Bulgarian stays Bulgarian, English stays English).
Ignore hashtags, calls to like or follow, sponsor messages and links.
Keep each ingredient short ("2 eggs", "1 tsp salt") and each step a clear instruction. If the text has no recipe, set is_recipe to false and leave the lists empty.`;

export function createStructurer(env = process.env) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 2 });
  const model = env.ANTHROPIC_MODEL || 'claude-opus-5-5';

  return async function structure({ text, transcript = '', title = '', platform = '' }) {
    const source = [
      platform && `Platform: ${platform}`,
      title && `Video/post title: ${title}`,
      `Caption / description:\n${text.slice(0, 20000)}`,
      transcript && `Transcript of what is said in the video:\n${transcript.slice(0, 40000)}`,
    ].filter(Boolean).join('\n\n');

    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // if the main model declines, the API retries on a fallback model
      output_config: { effort: 'low', format: betaZodOutputFormat(RecipeSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `<source>\n${source}\n</source>\n\nExtract the recipe.` }],
    });
    if (response.stop_reason === 'refusal') throw new Error('The AI declined to read this post');
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
