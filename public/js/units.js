// Convert ingredient amounts between metric and US units ("2 cups" <-> "480 ml", "350°F" <-> "175°C").
const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const NUM = String.raw`(\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛]|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛])`;

export function parseNum(s) {
  s = s.trim();
  if (FRAC[s]) return FRAC[s];
  let m;
  if ((m = s.match(/^(\d+)\s*([½¼¾⅓⅔⅛])$/))) return +m[1] + FRAC[m[2]];
  if ((m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = s.match(/^(\d+)\/(\d+)$/))) return m[1] / m[2];
  return parseFloat(s.replace(',', '.'));
}

// unit -> [kind, factor to base unit (ml or g), system]
const UNITS = [
  [/^(cups?|c\.)$/i, 'vol', 240, 'us'],
  [/^(tablespoons?|tbsps?\.?|tbs\.?)$/i, 'vol', 15, 'spoon'],
  [/^T$/, 'vol', 15, 'spoon'],
  [/^(teaspoons?|tsps?\.?)$/i, 'vol', 5, 'spoon'],
  [/^t$/, 'vol', 5, 'spoon'],
  [/^(fl\.?\s?oz\.?|fluid ounces?)$/i, 'vol', 29.57, 'us'],
  [/^(pints?|pt\.?)$/i, 'vol', 473, 'us'],
  [/^(quarts?|qt\.?)$/i, 'vol', 946, 'us'],
  [/^(gallons?|gal\.?)$/i, 'vol', 3785, 'us'],
  [/^(ounces?|oz\.?)$/i, 'mass', 28.35, 'us'],
  [/^(pounds?|lbs?\.?)$/i, 'mass', 453.6, 'us'],
  [/^(ml|мл|milliliters?|millilitres?)$/i, 'vol', 1, 'metric'],
  [/^(dl|дл)$/i, 'vol', 100, 'metric'],
  [/^(l|л|liters?|litres?|литра?)$/i, 'vol', 1000, 'metric'],
  [/^(g|гр?\.?|grams?|грама?)$/i, 'mass', 1, 'metric'],
  [/^(kg|кг|kilograms?|килограма?)$/i, 'mass', 1000, 'metric'],
  // Bulgarian kitchen measures
  [/^(ч\.\s?ч\.?|чаени чаши|чаена чаша|чаша|чаши)$/i, 'vol', 200, 'cup-bg'],
  [/^(с\.\s?л\.?|супени лъжици|супена лъжица)$/i, 'vol', 15, 'spoon'],
  [/^(ч\.\s?л\.?|чаени лъжици|чаена лъжичка|чаена лъжица|кафени лъжички)$/i, 'vol', 5, 'spoon'],
];
const unitRe = String.raw`(fl\.?\s?oz\.?|fluid ounces?|ч\.\s?ч\.?|с\.\s?л\.?|ч\.\s?л\.?|чаени чаши|чаена чаша|супени лъжици|супена лъжица|чаени лъжици|чаена лъжичка|чаена лъжица|[A-Za-zА-Яа-я]+\.?)`;

const round = (v, unit) => {
  if (unit === 'g' || unit === 'ml') return v >= 100 ? Math.round(v / 5) * 5 : Math.round(v);
  if (v >= 10) return Math.round(v);
  return Math.round(v * 4) / 4; // quarters for cups, oz, lb
};
const pretty = v => {
  const whole = Math.floor(v), f = v - whole;
  const frac = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[Math.round(f * 100) / 100];
  if (!f) return String(whole);
  return frac ? `${whole || ''}${frac}` : String(Math.round(v * 10) / 10);
};

function toSystem(amount, kind, base, system, sep) {
  const v = amount * base; // in ml or g
  if (system === 'metric') {
    if (kind === 'vol') return v >= 1000 ? `${String(Math.round(v / 100) / 10).replace('.', sep)} l` : `${round(v, 'ml')} ml`;
    return v >= 1000 ? `${String(Math.round(v / 100) / 10).replace('.', sep)} kg` : `${round(v, 'g')} g`;
  }
  if (kind === 'vol') {
    if (v < 45) return null; // keep spoons as they are
    const cups = v / 240;
    return `${pretty(round(cups))} ${cups > 1.1 ? 'cups' : 'cup'}`;
  }
  const oz = v / 28.35;
  if (oz >= 16) { const lb = round(v / 453.6); return `${pretty(lb)} lb`; }
  return `${pretty(round(oz))} oz`;
}

// Convert one ingredient line. system: 'metric' | 'us'. Returns the line unchanged if nothing to convert.
export function convertLine(line, system) {
  if (!system || line.startsWith('## ')) return line;
  const sep = /\d,\d/.test(line) ? ',' : '.';
  const m = line.match(new RegExp(String.raw`^(\s*)${NUM}(?:\s*[-–]\s*${NUM})?\s*${unitRe}(?=\s|$|,|\))`));
  if (!m) return convertTemps(line, system);
  const [all, lead, a, b, unit] = m;
  const u = UNITS.find(([re]) => re.test(unit.trim()));
  if (!u) return convertTemps(line, system);
  const [, kind, base, from] = u;
  if (from === 'spoon') return line; // spoons are the same everywhere
  if (system === 'metric' && from === 'metric') return line;
  if (system === 'us' && from === 'us') return line;
  const conv = x => toSystem(parseNum(x), kind, base, system, sep);
  const ca = conv(a);
  if (!ca) return line;
  const out = b ? `${ca.split(' ')[0]}–${conv(b)}` : ca;
  return lead + out + convertTemps(line.slice(all.length), system);
}

// Oven temperatures in any text (ingredients or steps)
export function convertTemps(text, system) {
  if (system === 'metric') return text.replace(/(\d{3})\s*°?\s*F\b/g, (m, f) => `${Math.round(((f - 32) * 5) / 9 / 5) * 5}°C`);
  if (system === 'us') return text.replace(/(\d{2,3})\s*°\s*C\b|(\d{2,3})\s*градуса/g, (m, c1, c2) => `${Math.round(((c1 || c2) * 9) / 5 / 5 + 32 / 5) * 5}°F`);
  return text;
}
