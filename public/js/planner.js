// Weekly meal planner: put recipes (or free text like "Leftovers") on days, then shop for the week.
import { t, lang } from './i18n.js';
import { $, $$, view, esc, toast, openSheet } from './ui.js';
import { getList, saveList, allRecipes } from './db.js';
import { offerToShopping } from './shopping.js';

const uid = () => crypto.randomUUID();
export const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return addDays(x, -((x.getDay() + 6) % 7)); };
const locale = () => (lang === 'bg' ? 'bg-BG' : 'en-GB');
const dayLabel = d => new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'short' }).format(d);
const shortLabel = d => new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(d);

let weekOffset = 0;

export async function renderPlan() {
  const [plan, recipes] = await Promise.all([getList('plan'), allRecipes()]);
  const byId = new Map(recipes.map(r => [r.id, r]));
  const draw = () => {
    const start = addDays(monday(new Date()), weekOffset * 7);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const today = dayKey(new Date());
    const fmt = new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' });
    const weekRecipes = days.flatMap(d => (plan.days[dayKey(d)] || []).map(m => byId.get(m.recipeId)).filter(Boolean));
    view.innerHTML = `
      <div class="page-head"><h1>${t('Meal plan')}</h1></div>
      <div class="week-nav">
        <button class="icon-btn" data-week="-1" aria-label="${t('Previous week')}">‹</button>
        <div class="center"><b>${fmt.format(days[0])} – ${fmt.format(days[6])}</b>${weekOffset ? ` <button class="link" data-week="0">${t('This week')}</button>` : ''}</div>
        <button class="icon-btn" data-week="1" aria-label="${t('Next week')}">›</button>
      </div>
      <div class="days">
        ${days.map(d => {
          const k = dayKey(d);
          const meals = plan.days[k] || [];
          return `<section class="day ${k === today ? 'today' : ''}">
            <div class="day-head"><h3>${esc(dayLabel(d))}</h3><button class="btn small ghost" data-add="${k}">+ ${t('Add')}</button></div>
            ${meals.length ? `<ul class="meals">${meals.map(m => {
              const r = byId.get(m.recipeId);
              const label = r ? `<a href="#/recipe/${r.id}">${esc(r.title)}</a>` : m.recipeId ? `<span class="muted">${t('(deleted recipe)')}</span>` : esc(m.text);
              return `<li>${r?.image ? `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">` : '<span class="meal-dot">🍽️</span>'}<span class="meal-name">${label}</span>
                <button class="icon-btn small" data-del="${k}|${m.id}" aria-label="${t('Remove')}">✕</button></li>`;
            }).join('')}</ul>` : ''}
          </section>`;
        }).join('')}
      </div>
      ${weekRecipes.length ? `<div class="actions"><button class="btn primary" data-act="shop">🛒 ${t("Add this week's ingredients to the shopping list")}</button></div>` : ''}`;

    const save = () => { saveList('plan', plan); draw(); };
    $$('[data-week]').forEach(b => (b.onclick = () => { weekOffset = b.dataset.week === '0' ? 0 : weekOffset + +b.dataset.week; draw(); }));
    $$('[data-del]').forEach(b => (b.onclick = () => {
      const [k, id] = b.dataset.del.split('|');
      plan.days[k] = (plan.days[k] || []).filter(m => m.id !== id);
      if (!plan.days[k].length) delete plan.days[k];
      save();
    }));
    $$('[data-add]').forEach(b => (b.onclick = () => pickMeal(b.dataset.add, recipes, meal => {
      (plan.days[b.dataset.add] ||= []).push(meal);
      save();
    })));
    const shop = $('[data-act=shop]');
    if (shop) shop.onclick = () => {
      const seen = new Set();
      offerToShopping(weekRecipes.filter(r => !seen.has(r.id) && seen.add(r.id)).map(r => ({ title: r.title, lines: r.ingredients || [] })));
    };
  };
  draw();
}

// Sheet: choose one of your recipes, or type something else
function pickMeal(day, recipes, onPick) {
  const d = new Date(`${day}T12:00`);
  openSheet(`
    <h2>${esc(dayLabel(d))}</h2>
    <form class="add-item free"><input name="text" placeholder="${t('Or type something, e.g. Leftovers')}" autocomplete="off"><button class="btn small">${t('Add')}</button></form>
    ${recipes.length ? `<div class="search"><input type="search" placeholder="${t('Search recipes or ingredients')}" aria-label="${t('Search')}"></div>
    <div class="pick-recipes">${recipes.map(r => `<button data-id="${r.id}" data-s="${esc([r.title, ...(r.tags || [])].join(' ').toLowerCase())}">
      ${r.image ? `<img src="${esc(r.image)}" alt="" referrerpolicy="no-referrer">` : '<span class="meal-dot">🍽️</span>'}<span>${esc(r.title)}</span></button>`).join('')}</div>` : `<p class="muted">${t('No recipes yet')}</p>`}`,
  (panel, close) => {
    panel.querySelector('form.free').onsubmit = e => {
      e.preventDefault();
      const text = e.target.text.value.trim();
      if (text) { close(); onPick({ id: uid(), recipeId: '', text }); }
    };
    const q = panel.querySelector('input[type=search]');
    if (q) q.oninput = () => $$('.pick-recipes button', panel).forEach(b => (b.hidden = !b.dataset.s.includes(q.value.toLowerCase().trim())));
    $$('.pick-recipes button', panel).forEach(b => (b.onclick = () => { close(); onPick({ id: uid(), recipeId: b.dataset.id, text: '' }); }));
  });
}

// From a recipe page: choose a day in the next two weeks
export function addToPlan(recipe) {
  const today = new Date();
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  openSheet(`
    <h2>${t('Add to meal plan')}</h2>
    <p class="muted small">${esc(recipe.title)}</p>
    <div class="day-pick">${days.map((d, i) => `<button class="chip" data-day="${dayKey(d)}">${i === 0 ? t('Today') : i === 1 ? t('Tomorrow') : esc(shortLabel(d))}</button>`).join('')}</div>`,
  (panel, close) => {
    $$('[data-day]', panel).forEach(b => (b.onclick = async () => {
      const plan = await getList('plan');
      (plan.days[b.dataset.day] ||= []).push({ id: uid(), recipeId: recipe.id, text: '' });
      saveList('plan', plan);
      close();
      const label = b.textContent.trim();
      toast(t('Added to the meal plan for {day}', { day: b.dataset.day === dayKey(today) || b === panel.querySelectorAll('[data-day]')[1] ? label.toLowerCase() : label }));
    }));
  });
}
