// Kitchen timers: times in steps ("bake for 25 minutes") become buttons that start a countdown.
// Running timers float at the bottom of the screen and ring when done, even if you go to another recipe.
import { t } from './i18n.js';
import { esc } from './ui.js';

const UNIT = String.raw`(hours?|hrs?|h|часа|час|ч(?!\.\s?[лч])\.?|minutes?|mins?|min\.?|минути|минута|мин\.?|seconds?|secs?|sec\.?|секунди|секунда|сек\.?)`;
const RE = new RegExp(String.raw`(\d+(?:[.,]\d+)?|½|половин)(?:\s*(?:[-–]|до|to)\s*(\d+(?:[.,]\d+)?))?\s*${UNIT}(?![\p{L}])`, 'giu');
const factor = u => (/^(h|ч|час)/i.test(u) ? 3600 : /^(s|сек)/i.test(u) ? 1 : 60);
const num = s => (s === '½' || s === 'половин' ? 0.5 : parseFloat(s.replace(',', '.')));

export function findDurations(text) {
  const out = [];
  for (const m of text.matchAll(RE)) {
    const secs = Math.round(num(m[1]) * factor(m[3]));
    if (secs >= 5 && secs <= 48 * 3600) out.push({ index: m.index, length: m[0].length, secs, text: m[0] });
  }
  return out;
}

// Escaped step text with the durations turned into timer buttons
export function stepHtml(text, label = '') {
  let html = '', last = 0;
  for (const d of findDurations(text)) {
    html += esc(text.slice(last, d.index));
    html += `<button type="button" class="timer-chip" data-secs="${d.secs}" data-label="${esc(label)}">⏱ ${esc(d.text)}</button>`;
    last = d.index + d.length;
  }
  return html + esc(text.slice(last));
}

export const fmt = s => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
};

// ---------- running timers ----------
const KEY = 'rb-timers';
let timers = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } })();
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(timers)); } catch {} };
let tick, audio;

export function startTimer(secs, label) {
  try { audio ||= new AudioContext(); audio.resume(); } catch {}
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  timers.push({ id: crypto.randomUUID(), label, secs, end: Date.now() + secs * 1000, rang: false });
  persist(); draw();
}

function ring(timer) {
  timer.rang = true; persist();
  navigator.vibrate?.([400, 200, 400, 200, 400]);
  try {
    audio ||= new AudioContext();
    for (let i = 0; i < 6; i++) {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = i % 2 ? 660 : 880; o.connect(g); g.connect(audio.destination);
      const at = audio.currentTime + i * 0.35;
      g.gain.setValueAtTime(0.25, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      o.start(at); o.stop(at + 0.32);
    }
  } catch {}
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { new Notification(t('⏰ Time is up'), { body: timer.label || fmt(timer.secs), tag: timer.id }); } catch {}
  }
}

function draw() {
  let bar = document.getElementById('timers');
  if (!timers.length) { bar?.remove(); clearInterval(tick); tick = null; return; }
  if (!bar) { bar = document.createElement('div'); bar.id = 'timers'; document.body.append(bar); }
  const now = Date.now();
  for (const tm of timers) if (!tm.rang && tm.end <= now) ring(tm);
  bar.innerHTML = timers.map(tm => {
    const left = (tm.end - now) / 1000, done = left <= 0;
    return `<div class="timer ${done ? 'done' : ''}">
      <span class="timer-time">${done ? t('⏰ Done!') : fmt(left)}</span>
      <span class="timer-label">${esc(tm.label || fmt(tm.secs))}</span>
      ${done ? '' : `<button data-plus="${tm.id}" aria-label="${t('Add a minute')}">+1</button>`}
      <button data-stop="${tm.id}" aria-label="${t('Stop timer')}">✕</button></div>`;
  }).join('');
  tick ||= setInterval(draw, 1000);
}

document.addEventListener('click', e => {
  const chip = e.target.closest('.timer-chip');
  if (chip) { e.stopPropagation(); startTimer(+chip.dataset.secs, chip.dataset.label); return; }
  const stop = e.target.closest('#timers [data-stop]');
  if (stop) { timers = timers.filter(x => x.id !== stop.dataset.stop); persist(); draw(); return; }
  const plus = e.target.closest('#timers [data-plus]');
  if (plus) { const tm = timers.find(x => x.id === plus.dataset.plus); if (tm) { tm.end += 60000; persist(); draw(); } }
}, true);

draw();
