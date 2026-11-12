// Egne pas ("+ Tilføj pas"): løb, styrke og andet. Rene funktioner uden DOM.
// Et eget pas gemmes som en række i custom_sessions med det færdige pas (item) og lægges ind i planen på sin dato.
import * as P from './plan.js';
import { HOTEL_EXERCISES } from './adapt.js';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const round05 = (v) => Math.round(v * 2) / 2;
const clone = (o) => JSON.parse(JSON.stringify(o));
export const newId = () => `cs-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

// ---------- Løb ----------
// [id, tekst, planens type, ekstra, standardzone]
export const RUN_KINDS = [
  ['easy', 'Rolig', 'easy', {}, 'Z2'], ['quality', 'Kvalitet/interval', 'quality', {}, 'Z4'], ['tempo', 'Tempo', 'quality', { label: 'Tempo' }, 'Z4'],
  ['long', 'Langtur', 'long', {}, 'Z2'], ['hills', 'Bakke/power hike', 'hills', {}, 'Z3'], ['treadmill', 'Løbebånd', 'easy', { label: 'Løbebånd' }, 'Z2'],
  ['trail', 'Trail', 'easy', { label: 'Trail' }, 'Z2'], ['test', 'Test (5 km)', 'quality', { test: '5k' }, 'Z4'], ['race', 'Race', 'race', {}, 'Z4'],
];
export const runKind = (id) => RUN_KINDS.find((k) => k[0] === id) || RUN_KINDS[0];
export const OTHER_KINDS = [
  ['cykel', 'Cykel', '🚴'], ['svomning', 'Svømning', '🏊'], ['hyrox', 'Hyrox-træning', '🏋️'], ['mobilitet', 'Mobilitet/yoga', '🧘'],
  ['hold', 'Holdtræning', '🤝'], ['bold', 'Boldspil/sport', '⚽'], ['gaatur', 'Gåtur', '🚶'],
];
export const otherKind = (id) => OTHER_KINDS.find((k) => k[0] === id) || OTHER_KINDS[0];
export const LEG_LOAD = [['light', 'Let'], ['moderate', 'Moderat'], ['hard', 'Hård']];

export function buildRunItem({ sub = 'easy', km, minutes, zone, description, elevation_m, time }) {
  const [id, label, type, extra, z0] = runKind(sub);
  let k = num(km);
  const mins = num(minutes);
  if (k == null && mins != null) k = round05(mins / 6.5);
  k = k == null ? 5 : k;
  const name = extra.label || (type === 'race' ? 'Race' : label.split('/')[0]);
  const item = { kind: 'run', type, km: k, zone: zone || z0, description: description || label, own: true, sub: id, title: extra.test ? '5 km-test' : `${name} ${P.fmtKm(k)} km` };
  if (extra.test) item.test = extra.test;
  if (mins != null) item.minutes = mins;
  if (num(elevation_m)) item.elevation_m = num(elevation_m);
  if (time) item.time = time;
  return item;
}
export function buildOtherItem({ activity = 'cykel', minutes, rpe, hr, km, legs = 'light', description, time }) {
  const [id, label, emoji] = otherKind(activity);
  const m = Math.max(1, Math.round(num(minutes) || 45));
  const item = { kind: 'other', activity: id, emoji, title: `${label} ${m} min`, minutes: m, rpe: Math.min(10, Math.max(1, Math.round(num(rpe) || 5))), legs, description: description || '', own: true };
  if (num(hr)) item.hr = num(hr);
  if (num(km)) item.km_other = num(km);
  if (time) item.time = time;
  return item;
}
// Belastning i "km-ækvivalenter" (varighed i timer × RPE)
export const otherLoad = (item) => ((num(item.minutes) || 0) / 60) * (num(item.rpe) || 5);

// ---------- Styrke ----------
export const LEG_MUSCLES = ['quads', 'hamstrings', 'glutes', 'calves'];
export function musclesOfExercises(names, lib) {
  const primary = new Set(), secondary = new Set();
  for (const n of names) {
    const e = lib && lib.get ? lib.get(n) : null;
    if (!e) continue;
    (e.primary_muscles || []).forEach((m) => primary.add(m));
    (e.secondary_muscles || []).forEach((m) => secondary.add(m));
  }
  for (const m of primary) secondary.delete(m);
  return { primary: [...primary], secondary: [...secondary] };
}
// Er det et benpas? Benøvelser (body = lower) eller primære benmuskler
export function isLegWork(exerciseNames, muscles, lib) {
  const names = exerciseNames || [];
  if (names.length) {
    const lower = names.filter((n) => { const e = lib && lib.get ? lib.get(n) : null; return e && (e.body === 'lower' || (e.primary_muscles || []).some((m) => LEG_MUSCLES.includes(m))); }).length;
    return lower / names.length >= 0.4;
  }
  return (muscles || []).some((m) => LEG_MUSCLES.includes(m));
}
export function buildStrengthItem({ name, mode = 'free', muscles = [], exercises = [], lib, note = '', time }) {
  const item = { kind: 'strength', session: name || 'Eget pas', exercises: exercises.map((x) => ({ exercise: x.exercise, sets: x.sets ?? 3, reps: String(x.reps ?? '8-12'), rir: String(x.rir ?? '2'), ...(x.rest_sec ? { rest_sec: x.rest_sec } : {}) })), note, own: true, mode, muscles: [...muscles], title: name || 'Eget pas' };
  if (isLegWork(item.exercises.map((x) => x.exercise), muscles, lib)) item.leg = true;
  if (mode === 'hotel') { item.exercises = HOTEL_EXERCISES.map((x) => ({ ...x })); item.hotel = true; item.note = note || 'Hotel-pas: kropsvægt, ca. 20–25 min. Planke i sekunder.'; delete item.leg; }
  if (time) item.time = time;
  return item;
}

const ISO_NAME = /curl|lateral|extension|fly|raise|pushdown|crunch|lægløft|face pull|butterfly|pullover|planke|dead bug|ab wheel|leg raise/i;
export const isCompound = (e) => !ISO_NAME.test(e.name) && !['Core', 'Læg'].includes(e.group) && !/isolation|biceps|triceps/i.test(e.pattern || '');
// Forslag på 4–6 øvelser, der dækker de valgte muskelgrupper. Sammensatte øvelser først.
export function suggestExercises(muscles, lib, { max = 6, min = 4 } = {}) {
  const targets = new Set(muscles);
  if (!targets.size) return [];
  const all = [...lib.values()].filter((e) => !/superset/i.test(e.name) && !e.custom);
  const hit = (e) => { let s = 0; for (const m of e.primary_muscles || []) if (targets.has(m)) s += 1; for (const m of e.secondary_muscles || []) if (targets.has(m)) s += 0.3; return s; };
  const picks = [], uncovered = new Set(targets), patterns = new Set();
  while (picks.length < max) {
    let best = null, bestScore = 0;
    for (const e of all) {
      if (picks.includes(e)) continue;
      const h = hit(e);
      if (h <= 0) continue;
      let gain = 0;
      for (const m of e.primary_muscles || []) if (uncovered.has(m)) gain += 1.2;
      for (const m of e.secondary_muscles || []) if (uncovered.has(m)) gain += 0.3;
      const compound = isCompound(e);
      const score = gain + h * 0.3 + (compound && picks.length < 3 ? 0.9 : 0) - (patterns.has(e.pattern) ? 0.8 : 0) - (!compound && picks.length < 2 ? 0.6 : 0);
      if (score > bestScore) { best = e; bestScore = score; }
    }
    if (!best) break;
    if (!uncovered.size && picks.length >= min) break;
    picks.push(best); patterns.add(best.pattern);
    (best.primary_muscles || []).forEach((m) => uncovered.delete(m));
  }
  picks.sort((a, b) => Number(isCompound(b)) - Number(isCompound(a)));
  return picks.map((e) => ({ exercise: e.name, sets: 3, reps: isCompound(e) ? '6-10' : '10-15', rir: '2' }));
}
// Øvelser til de valgte muskelgrupper først (til "+ Tilføj øvelse")
export function exercisesForMuscles(muscles, lib) {
  const targets = new Set(muscles || []);
  return [...lib.values()].filter((e) => (e.primary_muscles || []).some((m) => targets.has(m)));
}

// ---------- Ind i planen ----------
// rows: custom_sessions { id, date, item, deleted }. Pas lægges til sidst på dagen (stabil rækkefølge efter id); en hviledag erstattes.
export function applyCustom(weeks, rows) {
  const live = (rows || []).filter((r) => r && !r.deleted && r.item && r.date);
  if (!live.length) return weeks;
  const by = new Map();
  for (const r of [...live].sort((a, b) => (a.id < b.id ? -1 : 1))) { if (!by.has(r.date)) by.set(r.date, []); by.get(r.date).push(r); }
  return weeks.map((w) => {
    if (!w.days.some((d) => by.has(d.date))) return w;
    const days = w.days.map((d) => {
      const rs = by.get(d.date);
      if (!rs) return d;
      const base = d.items.filter((i) => i.kind !== 'rest' || false);
      return { ...d, items: [...(base.length ? base : []), ...rs.map((r) => ({ ...clone(r.item), custom_id: r.id, own: true }))] };
    });
    return { ...w, days };
  });
}
