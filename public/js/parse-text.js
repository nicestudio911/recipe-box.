// Turns free text (from a photo via OCR, or pasted) into a structured recipe.
// Works for English and Bulgarian recipes.

const ING_HEAD = /^\s*(ingredients?|you(?:'|’)?ll need|съставки|продукти|необходими продукти|необходими съставки)\s*[:.\-]?\s*$/i;
const STEP_HEAD = /^\s*(instructions?|directions?|method|preparation|steps|how to make(?: it)?|начин на приготвяне|приготвяне|приготвяне на|начин)\s*[:.\-]?\s*$/i;
const SERV = /(?:serves|servings|yield|makes|порции|порция|за)\s*[:\-]?\s*(\d+(?:\s*[-–]\s*\d+)?)/i;
const TIME = /(\d+)\s*(min|minutes|мин|минути|h|hr|hours|час|часа)/i;

const UNIT = '(?:g|gr|kg|ml|l|dl|tsp|tbsp|tbs|cup|cups|oz|lb|lbs|pinch|clove|cloves|can|pcs?|pieces?|г|гр|кг|мл|л|дл|ч\\.?\\s?л\\.?|с\\.?\\s?л\\.?|к\\.?\\s?л\\.?|ч\\.?\\s?ч\\.?|чаша|чаши|бр\\.?|щипка|скилидка|скилидки|глава|връзка|пакет|пакетче|кутия|супена|чаена)';
const QTY_START = new RegExp(`^\\s*([•\\-–*·o]\\s*)?(\\d+([.,/]\\d+)?|[½¼¾⅓⅔⅛]|one|two|three|a few|една|един|две|два|три|няколко)\\s*(${UNIT}\\b)?`, 'i');
const BULLET = /^\s*[•\-–*·]\s+/;
const STEP_NUM = /^\s*(?:step\s*)?(\d{1,2})\s*[.)]\s+|^\s*(?:стъпка\s*)(\d{1,2})[.:]?\s*/i;

const KEYCAP = /^\s*(\d)\uFE0F?\u20E3\s*/u;                      // 1️⃣ 2️⃣ ...
const LEAD_EMOJI = /^\s*(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}\uFE0F\u200D])+\s*/u;

// Social media captions: emoji bullets, keycap numbers, hashtags
function socialTidy(line) {
  if (/^(\s*#[\p{L}\p{N}_]+)+\s*$/u.test(line)) return '';            // hashtag-only line
  line = line.replace(KEYCAP, '$1. ');
  if (LEAD_EMOJI.test(line)) {
    const rest = line.replace(LEAD_EMOJI, '');
    line = ING_HEAD.test(rest) || STEP_HEAD.test(rest) || !rest ? rest : `• ${rest}`;
  }
  return line.replace(/(\s#[\p{L}\p{N}_]+)+\s*$/u, '');                  // trailing hashtags
}

function tidy(line) {
  return socialTidy(line).replace(/\s+/g, ' ').replace(/^[|_~]+|[|_~]+$/g, '').trim();
}

export function looksLikeIngredient(line) {
  if (line.length > 90) return false;
  if (BULLET.test(line)) return true;
  if (QTY_START.test(line) && !STEP_NUM.test(line)) return true;
  return new RegExp(`\\b\\d+([.,]\\d+)?\\s*${UNIT}\\b`, 'i').test(line) && line.split(' ').length <= 8;
}

function joinWrapped(lines) {
  // OCR breaks sentences across lines; glue a line onto the previous one
  // when the previous didn't end a sentence and this one doesn't start a new step.
  const out = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (prev && !/[.!?:;]$/.test(prev) && !STEP_NUM.test(l) && !BULLET.test(l) && /^[a-zа-я(,]/.test(l)) {
      out[out.length - 1] = `${prev} ${l}`;
    } else out.push(l);
  }
  return out;
}

const stripNum = s => s.replace(STEP_NUM, '').replace(BULLET, '').trim();

export function parseRecipeText(text) {
  const lines = String(text || '').split(/\r?\n/).map(tidy).filter(l => l && !/^[\W\d_]{1,3}$/.test(l));
  const result = { title: '', servings: '', totalTime: null, ingredients: [], steps: [], notes: '' };
  if (!lines.length) return result;

  let ingStart = lines.findIndex(l => ING_HEAD.test(l));
  let stepStart = lines.findIndex(l => STEP_HEAD.test(l));

  // Title: first reasonable line that isn't a section header
  const titleIdx = lines.findIndex(l => !ING_HEAD.test(l) && !STEP_HEAD.test(l) && !looksLikeIngredient(l) && l.length <= 80);
  if (titleIdx !== -1 && (ingStart === -1 || titleIdx < ingStart) && titleIdx < 4) result.title = lines[titleIdx].replace(/[:.]$/, '');

  for (const l of lines.slice(0, 12)) {
    if (!result.servings) { const m = l.match(SERV); if (m && /serv|yield|make|порци/i.test(l)) result.servings = m[1]; }
    if (!result.totalTime) {
      const m = l.match(TIME);
      if (m && /time|време|min|мин|час|hour/i.test(l) && l.length < 60) result.totalTime = /h|hr|hour|час/i.test(m[2]) ? +m[1] * 60 : +m[1];
    }
  }

  const before = [];
  if (ingStart !== -1 || stepStart !== -1) {
    const sections = [];
    if (ingStart !== -1) sections.push(['ing', ingStart]);
    if (stepStart !== -1) sections.push(['step', stepStart]);
    sections.sort((a, b) => a[1] - b[1]);
    sections.forEach(([kind, start], i) => {
      const end = sections[i + 1]?.[1] ?? lines.length;
      const chunk = lines.slice(start + 1, end);
      if (kind === 'ing') result.ingredients.push(...chunk.map(stripNum).filter(Boolean));
      else result.steps.push(...joinWrapped(chunk).map(stripNum).filter(Boolean));
    });
    before.push(...lines.slice(titleIdx + 1, sections[0][1]));
    // Recipe with only an instructions header: ingredient-like lines before it are ingredients
    if (ingStart === -1) {
      const ing = before.filter(looksLikeIngredient);
      result.ingredients.push(...ing.map(stripNum));
      before.splice(0, before.length, ...before.filter(l => !looksLikeIngredient(l)));
    }
  } else {
    // No headers: classify line by line
    const rest = lines.filter((_, i) => i !== titleIdx);
    for (const l of joinWrapped(rest)) {
      if (looksLikeIngredient(l) && !result.steps.length) result.ingredients.push(stripNum(l));
      else if (l.length > 25 || STEP_NUM.test(l)) result.steps.push(stripNum(l));
      else before.push(l);
    }
  }
  result.notes = before.filter(l => !SERV.test(l) && !TIME.test(l)).join('\n');
  return result;
}
