// Styrke: startvægte, enheder, skive-beregner og progression pr. øvelse.
// Data: start_weights.json (Jonathans arbejdsvægte), exercises.json (bibliotek) og den loggede historik.
import * as P from './plan.js';

export const LOAD_TYPES = {
  total: 'kg i alt', per_hand: 'kg pr. hånd', machine: 'kg (maskine)', cable: 'kg (kabel)', bodyweight: 'kropsvægt + kg',
};
const BAR_KG = 20;
const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
// Almindelige håndvægte i et fitnesscenter
export const DB_WEIGHTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12.5, 15, 17.5, 20, 22.5, 25, 27.5, 30, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50];
// Basisøvelser (lang pause); resten er isolation
const COMPOUND = new Set(['Squat', 'Hip hinge', 'Horisontalt pres', 'Skrå pres', 'Lodret pres', 'Lodret træk', 'Horisontalt træk', 'Dips', 'Enkeltben']);

const num = (v) => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));
const r25 = (kg) => Math.round(kg / 2.5) * 2.5;
export const fmtKg = (kg) => (kg == null ? '–' : Number(kg).toLocaleString('da-DK', { maximumFractionDigits: 2 }));

export function repBottom(reps) { const m = String(reps).match(/\d+/); return m ? Number(m[0]) : null; }

// ---------- Opslag ----------
// ctx: { lib: Map navn→øvelse, start: start_weights.json, settings: Map navn→exercise_settings }
function libFor(ctx, name) {
  if (ctx.lib.has(name)) return ctx.lib.get(name);
  for (const e of ctx.lib.values()) if ((e.aliases || []).includes(name)) return e;
  return null;
}
// Navne, der betyder samme øvelse (biblioteksnavn + aliaser)
function namesFor(ctx, name) {
  const e = libFor(ctx, name);
  return new Set([name, ...(e ? [e.name, ...(e.aliases || [])] : [])]);
}

export function loadType(ctx, name) {
  const s = ctx.settings.get(name);
  if (s && s.load_type) return s.load_type;
  // Øvelsens egen enhed fra biblioteket vinder – også efter et skift (aldrig arvet fra den gamle øvelse)
  const e = libFor(ctx, name);
  if (e && e.load_type) return e.load_type;
  const st = startEntry(ctx, name);
  return (st && st.load_type) || 'machine';
}

function startEntry(ctx, name) {
  const start = ctx.start || {};
  const names = namesFor(ctx, name);
  return (start.plan_exercises || []).find((x) => names.has(x.exercise))
    || (start.other_known_exercises || []).find((x) => names.has(x.exercise)) || null;
}

// Startvægt første gang en øvelse logges: { kg, suggested, kg_second, assumption, source, reference }
export function startWeight(ctx, name) {
  const st = startEntry(ctx, name);
  const settings = ctx.settings.get(name);
  if (settings && settings.start_kg != null) return { kg: Number(settings.start_kg), confirmed: true };
  if (st && st.kg != null) {
    return { kg: st.kg, kg_second: st.kg_second, assumption: st.assumption, source: st.source, confirmed: !!(settings && settings.start_confirmed) };
  }
  if (st && st.suggest_kg != null) {
    return { kg: st.suggest_kg, suggested: true, assumption: st.assumption, source: st.source, confirmed: !!(settings && settings.start_confirmed) };
  }
  // Ingen data: vis en reference fra en beslægtet øvelse, hvis der er en
  const e = libFor(ctx, name);
  const altNames = new Set();
  if (e) for (const id of e.alternatives || []) for (const x of ctx.lib.values()) if (x.id === id) altNames.add(x.name);
  const ref = [...(ctx.start.plan_exercises || []), ...(ctx.start.other_known_exercises || [])]
    .find((x) => x.kg != null && (x.alt_for === name || [...altNames].some((a) => namesFor(ctx, a).has(x.exercise))));
  return { kg: null, reference: ref ? `${ref.exercise}: ${fmtKg(ref.kg)} ${LOAD_TYPES[ref.load_type] || 'kg'}` : null };
}

// ---------- Skive-beregner ----------
export function plates(totalKg, bar = BAR_KG) {
  if (totalKg == null || totalKg <= 0) return '';
  if (totalKg < bar) return `Under ${bar} kg – brug en lettere stang`;
  let side = Math.round(((totalKg - bar) / 2) * 100) / 100;
  if (side === 0) return `Kun stangen (${bar} kg)`;
  const parts = [];
  let left = side;
  for (const p of PLATES) while (left >= p - 1e-9) { parts.push(p); left = Math.round((left - p) * 100) / 100; }
  const plateTxt = parts.length > 1 ? ` (${parts.map(fmtKg).join(' + ')})` : '';
  return `${bar} kg stang + ${fmtKg(side)} kg pr. side${plateTxt}${left > 0 ? ' – tæt på' : ''}`;
}

// ---------- Historik ----------
// Alle loggede pas for en øvelse før en dato (eller samme dato, andet pas), ældste først
export function sessionsFor(rows, ctx, name, entry) {
  const names = namesFor(ctx, name);
  const byKey = new Map();
  for (const r of rows) {
    if (!names.has(r.exercise) || r.item_key === entry.key || r.date > entry.date) continue;
    if (num(r.kg) == null && num(r.reps) == null) continue;
    if (!byKey.has(r.item_key)) byKey.set(r.item_key, { key: r.item_key, date: r.date, sets: [], updated: '' });
    const s = byKey.get(r.item_key);
    s.sets.push({ set_no: r.set_no, kg: num(r.kg) || 0, reps: num(r.reps) || 0 });
    if ((r.updated_at || '') > s.updated) s.updated = r.updated_at || '';
  }
  const list = [...byKey.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  list.forEach((s) => s.sets.sort((a, b) => a.set_no - b.set_no));
  return list;
}

const topKg = (s) => Math.max(0, ...s.sets.map((x) => x.kg));
const totalReps = (s) => s.sets.reduce((t, x) => t + x.reps, 0);

// To pas i træk uden rep-fremgang på samme vægt → fremgangen er gået i stå
export function stalled(sessions) {
  let streak = 0;
  for (let i = 1; i < sessions.length; i++) {
    const a = sessions[i - 1], b = sessions[i];
    if (topKg(a) === topKg(b) && totalReps(b) <= totalReps(a)) { streak++; if (streak >= 2) return true; } else streak = 0;
  }
  return false;
}

function increase(ctx, name, kg, sessions) {
  const lt = loadType(ctx, name);
  if (lt === 'per_hand') return DB_WEIGHTS.find((w) => w > kg + 1e-9) || kg + 2.5;
  const heavyLower = /^(squat|rumænsk dødløft)/i.test(name);
  if (heavyLower) return kg + (stalled(sessions) ? 2.5 : 5);
  const s = ctx.settings.get(name);
  const step = (s && num(s.min_step)) || 2.5;
  return kg + step;
}
function roundDown(ctx, name, kg) {
  if (loadType(ctx, name) === 'per_hand') return [...DB_WEIGHTS].reverse().find((w) => w <= kg) || kg;
  return r25(kg);
}

// Næste gang for én øvelse i et pas.
// Returnerer { kind: 'up'|'same'|'down'|'manual'|'start'|'none', kg, reps, text }
export function nextTarget(ctx, ex, sessions, { deload = false, session = '' } = {}) {
  const name = ex.exercise;
  const top = P.repTop(ex.reps), bottom = repBottom(ex.reps);
  const s = ctx.settings.get(name);
  const last = sessions[sessions.length - 1];
  // Din egen vægt gælder, indtil du har logget øvelsen efter at have sat den
  if (s && num(s.next_kg) != null && (!last || (last.updated || '') <= (s.updated_at || ''))) {
    return { kind: 'manual', kg: num(s.next_kg), reps: bottom, text: `Næste gang: ${fmtKg(num(s.next_kg))} kg (din vægt)` };
  }
  if (!last) {
    const st = startWeight(ctx, name);
    if (st.kg != null) return { kind: 'start', kg: st.kg, reps: bottom, text: `Start: ${fmtKg(st.kg)} kg${st.suggested ? ' (forslag)' : ''}` };
    return { kind: 'none', kg: null, reps: bottom, text: '' };
  }
  const kg = topKg(last);
  const plannedSets = Number(ex.sets) || last.sets.length;
  const allTop = top != null && last.sets.length >= plannedSets && last.sets.every((x) => x.reps >= top);
  const below = (sess) => bottom != null && sess.sets.some((x) => x.reps < bottom);
  if (deload) return { kind: 'same', kg, reps: bottom, text: `Deload: hold ${fmtKg(kg)} kg – ingen øgning i denne uge` };
  if (allTop) {
    const next = increase(ctx, name, kg, sessions);
    return { kind: 'up', kg: next, reps: bottom, text: `↑ Næste gang: ${fmtKg(next)} kg × ${bottom}` };
  }
  const prev = sessions[sessions.length - 2];
  const friday = /fredag/i.test(session);
  const stuck = sessions.length >= 4 && sessions.slice(-4).every((x) => topKg(x) === kg) && totalReps(last) <= totalReps(sessions[sessions.length - 4]);
  const fase2 = stuck && /fredag/i.test(session) ? ' · Står stille i 3 uger – skift øvelse kun om fredagen (Fase 2)' : '';
  // Fredagens reps er ofte lavere end mandagens (træthed) – det er ikke en grund til at gå ned i vægt
  if (friday && below(last) && !allTop) return { kind: 'same', kg, reps: bottom, text: `Samme vægt: ${fmtKg(kg)} kg – lavere reps på fredag er normalt${fase2}`, fase2: !!fase2 };
  if (below(last) && prev && below(prev)) {
    const down = roundDown(ctx, name, kg * 0.9);
    return { kind: 'down', kg: down, reps: bottom, text: `↓ To gange under ${bottom} reps – prøv ${fmtKg(down)} kg (−10 %)` };
  }
  if (below(last)) return { kind: 'same', kg, reps: bottom, text: `Samme vægt: ${fmtKg(kg)} kg – et sæt var under ${bottom} reps` };
  return { kind: 'same', kg, reps: top, text: `Samme vægt: ${fmtKg(kg)} kg – gå efter ${top} reps i alle sæt${fase2}`, fase2: !!fase2 };
}

// ---------- Pause pr. øvelse ----------
// Isolationsøvelser (lægløft, mave, lateral raises, curls, triceps …) → 60–90 sek; resten (basisøvelser) → 2–3 min.
const ISOLATION_PATTERNS = new Set(['Core', 'Lægløft', 'Knæfleksion', 'Knæekstension', 'Bryst isolation', 'Lat isolation',
  'Skulder isolation', 'Bagside skulder', 'Biceps', 'Triceps', 'Arme superset']);
const ISOLATION_GROUPS = new Set(['Læg', 'Core']);
const ISOLATION_NAME = /lægløft|calf|curl|triceps|pushdown|lateral|face pull|rear delt|crunch|mave|leg raise|planke|ab wheel|fly|pullover|extension/i;
export const REST_PRESETS = [60, 90, 120, 150, 180, 240]; // "ét tryk" skifter til næste (og til sidst tilbage til standard)

export function defaultRest(ctx, name) {
  const e = libFor(ctx, name);
  const iso = (e && (ISOLATION_PATTERNS.has(e.pattern) || (ISOLATION_GROUPS.has(e.group)))) || ISOLATION_NAME.test(name);
  return iso ? 75 : 150;
}
// Din egen pause (gemt pr. øvelse) vinder over standarden
export function restSeconds(ctx, name, itemRest) {
  const own = num((ctx.settings.get(name) || {}).rest_sec);
  if (own != null && own > 0) return own;
  const prog = num(itemRest); // pause fra dit eget program
  return prog != null && prog > 0 ? prog : defaultRest(ctx, name);
}
export const hasOwnRest = (ctx, name) => num((ctx.settings.get(name) || {}).rest_sec) > 0;
export function fmtRest(sec) { const m = Math.floor(sec / 60), r = sec % 60; return `${m}:${String(r).padStart(2, '0')}`; }
// Tekst til visning: standard vises som interval, egen pause som præcis tid
export function restLabel(sec, own = false) {
  if (own) return fmtRest(sec);
  return sec >= 120 ? '2–3 min' : '60–90 sek';
}
// Næste værdi i rundturen: standard → 60 → 90 → 120 → 150 → 180 → 240 → standard (null)
export function nextRest(current) {
  if (!current) return REST_PRESETS[0];
  const i = REST_PRESETS.indexOf(current);
  return i < 0 || i === REST_PRESETS.length - 1 ? null : REST_PRESETS[i + 1];
}

// ---------- Reps ved skift mellem en- og tobens-øvelser ----------
const UNILATERAL_NAME = /enbens|enarms|single|bulgarsk|split squat|udfald|step-up|step-down|pr\. ben/i;
export function isUnilateral(info, name) {
  return !!(info && info.pattern === 'Enkeltben') || UNILATERAL_NAME.test(name || '');
}
// Standard-reps for en tobens-øvelse, når der skiftes fra en etbens-øvelse
const BILATERAL_REPS = { Squat: '8-12', 'Hip hinge': '8-10', Knæfleksion: '10-12', Knæekstension: '10-12', Lægløft: '10-15' };
// Returnerer { reps, note } – note er en kort forklaring, når reps blev ændret
export function adaptReps(origReps, origInfo, origName, newInfo, newName) {
  const perLeg = /pr\.?\s*ben/i.test(String(origReps));
  const from = perLeg || isUnilateral(origInfo, origName);
  const to = isUnilateral(newInfo, newName);
  if (from && !to) {
    const base = String(origReps).replace(/\s*pr\.?\s*ben/i, '').trim();
    const reps = (newInfo && BILATERAL_REPS[newInfo.pattern]) || base;
    return { reps, note: `${newName} trænes med begge ben, så "pr. ben" er fjernet. Foreslået: ${reps} reps.` };
  }
  if (!from && to && !/pr\.?\s*ben/i.test(String(origReps))) {
    return { reps: `${origReps} pr. ben`, note: `${newName} trænes ét ben ad gangen, så "pr. ben" er tilføjet.` };
  }
  return { reps: origReps, note: '' };
}

// ---------- Forudfyldning af et sæt ----------
// Reps: samme sæt sidste gang, ellers bunden af intervallet (aldrig toppen). Stiger vægten, startes der igen fra bunden.
export function prefillReps(target, last, setNo, ex) {
  const bottom = repBottom(ex.reps);
  if (['up', 'down', 'manual', 'start'].includes(target.kind) && target.kind !== 'start') return bottom;
  const lastSet = last && (last.sets.find((x) => x.set_no === setNo) || last.sets[last.sets.length - 1]);
  return lastSet && lastSet.reps ? lastSet.reps : bottom;
}

// ---------- Rekorder (til opsummeringen) ----------
const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + reps / 30) : 0);
// Bedste estimerede 1RM og tungeste vægt for en øvelse i en række logrækker
export function bests(rows, names) {
  let best = { e1rm: 0, kg: 0 };
  for (const r of rows) {
    if (!names.has(r.exercise)) continue;
    const kg = num(r.kg) || 0, reps = num(r.reps) || 0;
    if (!reps) continue;
    best = { e1rm: Math.max(best.e1rm, e1rm(kg, reps)), kg: Math.max(best.kg, kg) };
  }
  return best;
}
export function namesOf(ctx, name) { return namesFor(ctx, name); }
