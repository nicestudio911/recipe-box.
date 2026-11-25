// Recipe import from social media posts: YouTube (incl. Shorts), TikTok, Instagram, Facebook.
// These sites don't publish recipe data, so we read the post's caption / video description
// and turn that text into a recipe. What each platform lets us read without logging in:
//   YouTube   full video description (from the watch page)
//   TikTok    full caption (official oEmbed endpoint)
//   Instagram caption from the page's public preview data, when Instagram serves it (often it doesn't)
//   Facebook  same as Instagram; when the text isn't available, the app asks to paste the caption
import { parseRecipeText } from '../public/js/parse-text.js';
import { decodeEntities } from './extract.js';

// Requests identify honestly as Recipe Box (set in lib/app.js); we don't pose as a browser or another crawler.

export function socialPlatform(rawUrl) {
  let host;
  try { host = new URL(rawUrl).hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, ''); } catch { return null; }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)instagram\.com$|^instagr\.am$/.test(host)) return 'instagram';
  if (/(^|\.)facebook\.com$|^fb\.watch$|^fb\.com$/.test(host)) return 'facebook';
  return null;
}

const NAMES = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
let L = 'en'; // language of messages for the current import
const m = (en, bg) => (L === 'bg' ? bg : en);

function meta(html, name) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  const c = tag?.match(/content=["']([^"']*)["']/i)?.[1] ?? tag?.match(/content=([^\s>]+)/i)?.[1];
  return c ? decodeEntities(c).trim() : '';
}

// Pull a JSON object that starts right after `marker` out of a page (balanced braces)
function jsonAfter(html, marker) {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  const start = html.indexOf('{', i + marker.length);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length && j < start + 3_000_000; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, j + 1)); } catch { return null; } }
  }
  return null;
}

function youtubeId(u) {
  const url = new URL(u);
  if (url.hostname.endsWith('youtu.be')) return url.pathname.slice(1).split('/')[0];
  const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
  return m ? m[1] : url.searchParams.get('v');
}

async function youtube(url, fetchPage) {
  const id = youtubeId(url);
  if (!id) throw new Error(m('That does not look like a YouTube video link', 'Това не прилича на връзка към видео в YouTube'));
  const { html } = await fetchPage(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { 'Accept-Language': 'en,bg;q=0.8' } });
  const player = jsonAfter(html, 'ytInitialPlayerResponse');
  const d = player?.videoDetails;
  return {
    captionTracks: player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [],
    title: d?.title || meta(html, 'og:title'),
    text: d?.shortDescription || meta(html, 'og:description') || meta(html, 'description'),
    image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    author: d?.author || '',
    sourceUrl: url.includes('/shorts/') ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
    truncated: !d?.shortDescription,
  };
}

// Subtitles (uploaded or automatic) = what is said in the video. Best effort: YouTube sometimes refuses.
async function youtubeTranscript(tracks, fetchPage) {
  if (!tracks.length) return '';
  const rank = t => (t.kind === 'asr' ? 1 : 0) + (/^(bg|en)/.test(t.languageCode) ? 0 : 2);
  const track = [...tracks].sort((a, b) => rank(a) - rank(b))[0];
  try {
    const { html } = await fetchPage(`${track.baseUrl}&fmt=json3`, {});
    const data = JSON.parse(html);
    return (data.events || []).flatMap(e => (e.segs || []).map(x => x.utf8)).join('').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

async function tiktok(url, fetchPage) {
  // The official oEmbed endpoint returns the full caption as "title"
  try {
    const { html } = await fetchPage(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { headers: { Accept: 'application/json' } });
    const o = JSON.parse(html);
    if (o.title) return { title: '', text: o.title, image: o.thumbnail_url || '', author: o.author_name || '', sourceUrl: url, truncated: false };
  } catch { /* fall back to the page */ }
  const { html, finalUrl } = await fetchPage(url, {});
  const data = jsonAfter(html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
  const item = data?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
  return {
    title: '', text: item?.desc || meta(html, 'og:description') || meta(html, 'description'),
    image: item?.video?.cover || meta(html, 'og:image'), author: item?.author?.nickname || '', sourceUrl: finalUrl, truncated: !item?.desc,
  };
}

// Instagram and Facebook: use the public preview data on the post page, if they serve it to us
async function metaPreview(url, fetchPage, platform) {
  const { html, finalUrl } = await fetchPage(url, { headers: { 'Accept-Language': 'en,bg;q=0.8' } });
  let text = meta(html, 'og:description') || meta(html, 'description');
  let author = '';
  // Instagram: '1,234 likes, 56 comments - chef_name on May 3, 2025: "caption…"'
  const ig = text.match(/^[\d.,KkMm]+\s+likes?,\s*[\d.,KkMm]+\s+comments?\s*-\s*([^\s]+)\s+on\s+[^:]+:\s*["“]([\s\S]*)["”]\.?\s*$/);
  if (ig) { author = ig[1]; text = ig[2]; }
  // Long captions sometimes come complete in the page's embedded data
  const full = html.match(/"caption":\{[^{}]*?"text":"((?:[^"\\]|\\.)*)"/)?.[1] || html.match(/"edge_media_to_caption":\{"edges":\[\{"node":\{"text":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (full) { try { const t = JSON.parse(`"${full}"`); if (t.length > text.length) text = t; } catch {} }
  if (!text || /log in|sign up|влезте/i.test(text) && text.length < 120) {
    throw new Error(m(`${NAMES[platform]} did not share this post's text. It may be private, or ${NAMES[platform]} is blocking it. Copy the caption and use "Paste text" instead.`,
      `${NAMES[platform]} не сподели текста на тази публикация. Може да е лична или ${NAMES[platform]} да я блокира. Копирайте описанието и използвайте „Постави текст“.`));
  }
  return {
    title: '', text, image: meta(html, 'og:image'), author: author || meta(html, 'og:title').replace(/ on (Instagram|Facebook).*$/i, ''),
    sourceUrl: finalUrl, truncated: /\.\.\.$|…$/.test(text),
  };
}

export async function importSocial(url, fetchPage, { structure, lang = 'en' } = {}) {
  L = lang === 'bg' ? 'bg' : 'en';
  const platform = socialPlatform(url);
  const post = platform === 'youtube' ? await youtube(url, fetchPage)
    : platform === 'tiktok' ? await tiktok(url, fetchPage)
    : await metaPreview(url, fetchPage, platform);
  const text = (post.text || '').trim();
  const transcript = structure && post.captionTracks ? await youtubeTranscript(post.captionTracks, fetchPage) : '';
  if (!text && !transcript) throw new Error(m(`This ${NAMES[platform]} post has no caption or description to read the recipe from.`, `Тази публикация в ${NAMES[platform]} няма описание, от което да прочетем рецептата.`));

  // AI structuring when configured (handles free-form captions and spoken recipes); otherwise the rule-based parser
  let r = structure ? await structure({ text, transcript, title: post.title, platform: NAMES[platform] }).catch(e => { console.error('AI structuring failed:', e.message); return null; }) : null;
  if (!r) {
    r = parseRecipeText(post.title ? `${post.title}\n${text}` : text);
    if (post.title) r.title = post.title;
  }
  const found = (r.ingredients?.length || 0) + (r.steps?.length || 0);
  const warnings = [];
  if ((r.ingredients?.length || 0) < 2) warnings.push(r._ai
    ? m(`We couldn't find a full recipe in this ${NAMES[platform]} post's text${transcript ? ' or what is said in the video' : ''}. It may only be shown on screen.`,
        `Не открихме пълна рецепта в текста на публикацията${transcript ? ' или в казаното във видеото' : ''}. Може да е показана само на екрана.`)
    : m(`The ${NAMES[platform]} caption doesn't seem to list the ingredients. The recipe may only be shown or spoken in the video.`,
        `Описанието в ${NAMES[platform]} не изглежда да съдържа продуктите. Рецептата може да е само показана или казана във видеото.`));
  if (post.truncated) warnings.push(m(`${NAMES[platform]} only shared the start of the caption, so part of the recipe may be missing.`, `${NAMES[platform]} сподели само началото на описанието, затова част от рецептата може да липсва.`));
  delete r._ai;
  return {
    ...r,
    title: (r.title || post.title || m(`Recipe from ${post.author || NAMES[platform]}`, `Рецепта от ${post.author || NAMES[platform]}`)).slice(0, 200),
    image: post.image || '',
    sourceUrl: post.sourceUrl || url,
    notes: [r.notes, post.author ? m(`From ${post.author} on ${NAMES[platform]}`, `От ${post.author} в ${NAMES[platform]}`) : ''].filter(Boolean).join('\n'),
    tags: [...new Set([...(r.tags || []), platform])],
    _rawText: transcript ? `${text}\n\n--- Said in the video ---\n${transcript}` : text,
    _warning: warnings.join(' '),
    _found: found,
  };
}
