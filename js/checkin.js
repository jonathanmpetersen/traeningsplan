// Daglig tjek-ind (ben 1–5, energi 1–5) og hurtighandlinger på pas. Rene funktioner uden DOM.
// Appen foreslår – brugeren vælger selv.
import * as P from './plan.js';

export const LEG_LABELS = ['Friske', 'Lidt trætte', 'Mærkbare', 'Ømme', 'Meget ømme'];
export const ENERGY_LABELS = ['Meget lav', 'Lav', 'Okay', 'God', 'Rigtig god'];
const clone = (o) => JSON.parse(JSON.stringify(o));
const round05 = (v) => Math.round(v * 2) / 2;
const HARD_RUN = new Set(['quality', 'long', 'hills']);
export const isRunnable = (it) => it.kind === 'run' && it.type !== 'race';
export const isHardRun = (it) => it.kind === 'run' && HARD_RUN.has(it.type);

// ---------- Ændringer af et pas ----------
export function easierItem(it) {
  const c = clone(it);
  if (c.kind === 'run') {
    if (c.type === 'race') return c;
    const hard = HARD_RUN.has(c.type);
    c.km = Math.max(3, round05(c.km * (hard ? 0.7 : 0.8)));
    if (hard) {
      const was = c.type === 'long' ? 'langtur' : c.type === 'hills' ? 'bakkepas' : 'kvalitetspas';
      c.type = 'easy'; c.zone = 'Z2'; c.description = `Gjort lettere: rolig tur i Z2 i stedet for ${was}`;
      delete c.test; delete c.elevation_m;
    } else if (!/Gjort lettere/.test(c.description || '')) c.description = `${c.description || 'Rolig Z2'} (gjort lettere)`;
    return c;
  }
  if (c.kind === 'strength') {
    c.exercises = c.exercises.map((x) => ({ ...x, sets: Math.max(1, (Number(x.sets) || 3) - 1), rir: String(Math.min(4, (Number(x.rir) || 2) + 1)) }));
    c.note = 'Gjort lettere: ét sæt færre og RIR +1.';
  }
  if (c.kind === 'other') {
    c.minutes = Math.max(10, Math.round((c.minutes || 45) * 0.7 / 5) * 5);
    c.rpe = Math.max(1, (c.rpe || 5) - 1);
    if (c.legs === 'hard') c.legs = 'moderate'; else if (c.legs === 'moderate') c.legs = 'light';
    c.title = c.title.replace(/\d+ min/, `${c.minutes} min`);
  }
  return c;
}
export function fewerSets(it) {
  const c = clone(it);
  if (c.kind === 'strength') { c.exercises = c.exercises.map((x) => ({ ...x, sets: Math.max(1, (Number(x.sets) || 3) - 1) })); c.note = 'Færre sæt (−1) pga. ømme ben.'; }
  return c;
}
export function rirPlus(it) {
  const c = clone(it);
  if (c.kind === 'strength') { c.exercises = c.exercises.map((x) => ({ ...x, rir: String(Math.min(4, (Number(x.rir) || 2) + 1)) })); c.note = 'RIR +1 pga. ømme ben.'; }
  return c;
}
// Kvalitet/langtur/bakke → rolig tur (ca. 70 %); en allerede rolig tur forbliver rolig
export function toEasyRun(it) {
  if (!isRunnable(it)) return it;
  return easierItem(isHardRun(it) ? it : { ...it, type: 'quality' });
}
// Benpas → overkropspas (fra en skabelon, der findes i planen/programmet)
export function toUpper(it, template) {
  if (!template) return it;
  const c = clone(template);
  delete c.leg; delete c.program_id;
  c.note = `Lavet om fra ${it.session}: overkrop i stedet for benpas.`;
  return c;
}

// ---------- Forslag ud fra tjek-ind ----------
// items: dagens pas (ikke hvile). Returnerer [{id, title, actions: [[handling, tekst]]}]
export function suggestionsFor({ legs, energy }, items) {
  const out = [];
  const runs = items.filter(isRunnable);
  const leg = items.filter(P.isLower);
  if (legs >= 4) {
    if (runs.length) out.push({ id: 'legs-run', title: 'Dine ben er ømme – løbepasset i dag', actions: [['easier', 'Kortere og roligere'], ['swap', 'Byt med en anden dag'], ['rest', 'Hvile i dag']] });
    if (leg.length) out.push({ id: 'legs-lift', title: 'Dine ben er ømme – benpasset i dag', actions: [['fewer', 'Færre sæt (−1)'], ['rir', 'RIR +1'], ['swap', 'Flyt benpasset']] });
  }
  if (legs === 3 && runs.some((r) => r.type === 'quality' || r.type === 'long'))
    out.push({ id: 'legs-hard', title: 'Hårdt løbepas med trætte ben', actions: [['swapEasy', 'Byt med en rolig dag senere i ugen']] });
  if (legs >= 4 && runs.some((r) => r.type === 'quality' || r.type === 'long'))
    out.find((s) => s.id === 'legs-run').actions.splice(1, 0, ['swapEasy', 'Byt med en rolig dag senere i ugen']);
  if (energy != null && energy <= 2 && items.length && !out.length) out.push({ id: 'energy', title: 'Lav energi i dag', actions: [['easier', 'Gør dagens pas lettere'], ['swap', 'Byt med en anden dag']] });
  return out;
}

// ---------- Bytte dage ----------
// Dage, hvor et bytte ikke skaber nye regelbrud. weeksFn: () => nyt klonet array af planens uger
export function swapOptions(weeks, date, { today, isBlocked = () => false, span = 7 } = {}) {
  const base = new Set(P.checkRules(scheduleOf(weeks)).map((v) => v.text));
  const find = (d) => { for (const w of weeks) for (const day of w.days) if (day.date === d) return day; return null; };
  const a0 = find(date);
  if (!a0) return [];
  const hasRace = (day) => day.items.some((i) => i.kind === 'run' && i.type === 'race');
  const out = [];
  for (let k = -span; k <= span; k++) {
    const d = P.addDays(date, k);
    if (k === 0 || d < today || isBlocked(d)) continue;
    const b0 = find(d);
    if (!b0 || hasRace(a0) || hasRace(b0)) continue;
    const ia = a0.items, ib = b0.items;
    a0.items = ib; b0.items = ia;
    const after = P.checkRules(scheduleOf(weeks)).map((v) => v.text).filter((t) => !base.has(t));
    a0.items = ia; b0.items = ib;
    if (!after.length) out.push({ date: d, items: ib });
  }
  return out;
}
export function scheduleOf(weeks) {
  const byDate = new Map();
  for (const w of weeks) for (const d of w.days) byDate.set(d.date, d.items.map((item) => ({ item })));
  return { byDate };
}
