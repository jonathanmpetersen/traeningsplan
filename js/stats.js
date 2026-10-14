// Beregninger til Statistik → Styrke. Kun data fra strength_logs (+ øvelsesbiblioteket til muskler).
// Rene funktioner uden DOM, så de kan testes.
import * as P from './plan.js';

export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const epley = (kg, reps) => (kg > 0 && reps > 0 ? kg * (1 + reps / 30) : 0);

// ---------- Muskler ----------
// Radar og fordeling bruger disse grupper (områder fra muskelkortet samles)
export const GROUPS = [
  { id: 'chest', label: 'Bryst', areas: ['chest'] },
  { id: 'shoulders', label: 'Skuldre', areas: ['delt_front', 'delt_side', 'delt_rear'] },
  { id: 'biceps', label: 'Biceps', areas: ['biceps'] },
  { id: 'triceps', label: 'Triceps', areas: ['triceps'] },
  { id: 'back', label: 'Ryg', areas: ['lats', 'lower_back'] },
  { id: 'abs', label: 'Mave', areas: ['abs'] },
  { id: 'glutes', label: 'Baller', areas: ['glutes'] },
  { id: 'quads', label: 'Forlår', areas: ['quads'] },
  { id: 'hamstrings', label: 'Baglår', areas: ['hamstrings'] },
  { id: 'calves', label: 'Lægge', areas: ['calves'] },
];
export const TARGET = [10, 20]; // sæt pr. uge pr. muskelgruppe

export function libEntry(lib, name) {
  if (lib.has(name)) return lib.get(name);
  for (const e of lib.values()) if ((e.aliases || []).includes(name)) return e;
  return null;
}
export const canonicalName = (lib, name) => { const e = libEntry(lib, name); return e ? e.name : name; };
export function musclesOf(lib, name) {
  const e = libEntry(lib, name);
  const arr = (v) => (Array.isArray(v) ? v : []);
  return { primary: arr(e && e.primary_muscles), secondary: arr(e && e.secondary_muscles) };
}
// Vægten i et sæt for en muskel: primær 1 sæt, sekundær 0,5
export function setWeightFor(lib, name, areaIds) {
  const m = musclesOf(lib, name);
  if (m.primary.some((a) => areaIds.includes(a))) return 1;
  if (m.secondary.some((a) => areaIds.includes(a))) return 0.5;
  return 0;
}

// ---------- Rækker og pas ----------
export const validSet = (r) => num(r.reps) != null && num(r.reps) > 0;
export function loadTypeOf(lib, row) {
  const e = libEntry(lib, row.exercise);
  return row.load_type || (e && e.load_type) || 'machine';
}
// Volumen = kg × reps som indtastet. Håndvægt pr. hånd ×2. Kropsvægt uden ekstra vægt giver 0 kg (tælles som reps/sæt).
export function setVolume(lib, row) {
  const kg = num(row.kg) || 0, reps = num(row.reps) || 0;
  return kg * reps * (loadTypeOf(lib, row) === 'per_hand' ? 2 : 1);
}
const order = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.item_key).localeCompare(String(b.item_key)) || (num(a.set_no) || 0) - (num(b.set_no) || 0));

export function sessionsFrom(rows, lib) {
  const by = new Map();
  for (const r of rows.filter(validSet).sort(order)) {
    const k = r.item_key || `${r.date}-${r.session}`;
    if (!by.has(k)) by.set(k, { key: k, date: r.date, session: r.session, rows: [], sets: 0, volume: 0, ts: [] });
    const s = by.get(k);
    s.rows.push(r); s.sets++; s.volume += setVolume(lib, r);
    const t = Date.parse(r.updated_at); if (t > 0) s.ts.push(t);
  }
  const out = [...by.values()];
  for (const s of out) {
    // Varigheden udledes af tidspunkterne for sættene (første til sidste ✓). Over 4 timer er det sandsynligvis en senere rettelse.
    const span = s.ts.length > 1 ? (Math.max(...s.ts) - Math.min(...s.ts)) / 60000 : 0;
    s.minutes = span >= 1 && span <= 240 ? Math.round(span) : null;
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
}

// ---------- Perioder og uger ----------
export const mondayOf = (iso) => { const d = P.parseISO(iso); return P.addDays(iso, -((d.getDay() + 6) % 7)); };
export const RANGES = [['4U', '4U'], ['3M', '3M'], ['6M', '6M'], ['year', 'År'], ['all', 'Alle']];
export function rangeFrom(range, today, firstDate) {
  const cur = mondayOf(today);
  const weeks = { '4U': 4, '3M': 13, '6M': 26, year: 52 }[range];
  if (weeks) return P.addDays(cur, -7 * (weeks - 1));
  return firstDate ? mondayOf(firstDate) : cur;
}
export function weekStarts(from, today) {
  const out = [];
  for (let w = mondayOf(from); w <= today; w = P.addDays(w, 7)) out.push(w);
  return out.length ? out : [mondayOf(today)];
}
export function weeklySeries(sessions, from, today) {
  const weeks = weekStarts(from, today).map((start) => ({ start, volume: 0, minutes: 0, sessions: 0, sets: 0 }));
  const idx = new Map(weeks.map((w, i) => [w.start, i]));
  for (const s of sessions) {
    const i = idx.get(mondayOf(s.date));
    if (i == null) continue;
    const w = weeks[i];
    w.volume += s.volume; w.sets += s.sets; w.sessions += 1; w.minutes += s.minutes || 0;
  }
  return weeks;
}

// ---------- Muskler pr. periode ----------
export function muscleSets(rows, lib, fromDate, toDate) {
  const areas = {};
  const bump = (id, name, w) => {
    const a = (areas[id] ||= { sets: 0, by: {} });
    a.sets += w; a.by[name] = (a.by[name] || 0) + w;
  };
  for (const r of rows) {
    if (!validSet(r) || r.date < fromDate || r.date > toDate) continue;
    const name = canonicalName(lib, r.exercise), m = musclesOf(lib, r.exercise);
    for (const id of m.primary) bump(id, name, 1);
    for (const id of m.secondary) bump(id, name, 0.5);
  }
  return areas;
}
export function groupSets(rows, lib, fromDate, toDate) {
  const out = Object.fromEntries(GROUPS.map((g) => [g.id, 0]));
  for (const r of rows) {
    if (!validSet(r) || r.date < fromDate || r.date > toDate) continue;
    for (const g of GROUPS) out[g.id] += setWeightFor(lib, r.exercise, g.areas);
  }
  return out;
}
export function weeksInRange(from, today) { return weekStarts(from, today).length; }
export function verdict(perWeek) { return perWeek < TARGET[0] ? 'low' : perWeek > TARGET[1] ? 'high' : 'ok'; }

// ---------- Øvelser ----------
export function exerciseSessions(rows, lib, name) {
  const cn = canonicalName(lib, name);
  const mine = rows.filter((r) => validSet(r) && canonicalName(lib, r.exercise) === cn).sort(order);
  const by = new Map();
  for (const r of mine) {
    const k = r.item_key || r.date;
    if (!by.has(k)) by.set(k, { key: k, date: r.date, session: r.session, sets: [] });
    by.get(k).sets.push(r);
  }
  const out = [...by.values()];
  for (const s of out) {
    let e1 = 0, maxKg = 0, vol = 0, bestReps = 0;
    for (const r of s.sets) {
      const kg = num(r.kg) || 0, reps = num(r.reps) || 0;
      e1 = Math.max(e1, epley(kg, reps)); maxKg = Math.max(maxKg, kg); vol += setVolume(lib, r); bestReps = Math.max(bestReps, reps);
    }
    Object.assign(s, { e1rm: e1, maxKg, volume: vol, bestReps });
  }
  return out;
}
const dateOf = (r) => r.date;
// Rekorder og deres historik (hver gang en rekord blev slået)
export function records(rows, lib, name) {
  const cn = canonicalName(lib, name);
  const mine = rows.filter((r) => validSet(r) && canonicalName(lib, r.exercise) === cn).sort(order);
  const best = { e1rm: null, maxKg: null, maxReps: null, setVol: null, sessionVol: null };
  const hist = { e1rm: [], maxKg: [], maxReps: [], setVol: [], sessionVol: [] };
  const bump = (type, value, r, extra) => {
    if (!(value > 0)) return false;
    if (!best[type] || value > best[type].value + 1e-9) {
      best[type] = { value, date: dateOf(r), kg: num(r.kg) || 0, reps: num(r.reps) || 0, ...extra };
      hist[type].push(best[type]);
      return true;
    }
    return false;
  };
  for (const r of mine) {
    const kg = num(r.kg) || 0, reps = num(r.reps) || 0;
    bump('e1rm', epley(kg, reps), r);
    bump('maxKg', kg, r);
    bump('maxReps', reps, r);
    bump('setVol', setVolume(lib, r), r);
  }
  for (const s of exerciseSessions(rows, lib, name)) bump('sessionVol', s.volume, { date: s.date, kg: 0, reps: 0 });
  return { best, hist };
}

// Rekorder pr. sæt og pas (første gang en øvelse logges tæller ikke – der er intet at slå).
// Returnerer { byId: {sætId: [typer]}, bySession: {pasNøgle: [{name, type, value, kg, reps}]} } – hver (øvelse, type) tæller én gang pr. pas.
export function prSets(rows, lib) {
  const sorted = rows.filter(validSet).sort(order);
  const seen = new Map();
  const byId = {}, bySession = {}, counted = {};
  for (const r of sorted) {
    const cn = canonicalName(lib, r.exercise);
    const kg = num(r.kg) || 0, reps = num(r.reps) || 0;
    const cur = { e1: epley(kg, reps), kg, reps, vol: setVolume(lib, r) };
    const b = seen.get(cn);
    if (b) {
      const types = [];
      if (cur.e1 > b.e1 + 1e-9 && b.e1 > 0) types.push(['e1rm', cur.e1]);
      if (cur.kg > b.kg + 1e-9 && b.kg > 0) types.push(['maxKg', cur.kg]);
      if (cur.vol > b.vol + 1e-9 && b.vol > 0) types.push(['setVol', cur.vol]);
      if (!b.kg && !cur.kg && cur.reps > b.reps) types.push(['maxReps', cur.reps]);
      if (types.length) {
        byId[r.id] = types.map((t) => t[0]);
        const list = (bySession[r.item_key] ||= []);
        for (const [type, value] of types) {
          const k = `${r.item_key}|${cn}|${type}`;
          if (counted[k]) { Object.assign(counted[k], { value, kg, reps }); continue; }
          counted[k] = { name: cn, type, value, kg, reps };
          list.push(counted[k]);
        }
      }
    }
    seen.set(cn, b ? { e1: Math.max(b.e1, cur.e1), kg: Math.max(b.kg, cur.kg), reps: Math.max(b.reps, cur.reps), vol: Math.max(b.vol, cur.vol) } : cur);
  }
  return { byId, bySession };
}
export function prCountsBySession(rows, lib) {
  return Object.fromEntries(Object.entries(prSets(rows, lib).bySession).map(([k, v]) => [k, v.length]));
}
export const PR_LABEL = { e1rm: 'Est. 1RM', maxKg: 'Maks vægt', setVol: 'Sæt-volumen', maxReps: 'Maks reps' };

// ---------- Pas-detalje ----------
// Sammenligner med sidste gang samme pas (samme navn, f.eks. "Lower") blev lavet
function topOf(sets) {
  let kg = 0, reps = 0;
  for (const r of sets) {
    const k = num(r.kg) || 0, n = num(r.reps) || 0;
    if (k > kg + 1e-9 || (Math.abs(k - kg) < 1e-9 && n > reps)) { kg = k; reps = n; }
  }
  return { kg, reps };
}
export function changeText(now, prev) {
  const dk = Math.round((now.kg - prev.kg) * 100) / 100;
  const f = (v) => String(Math.abs(v)).replace('.', ',');
  if (Math.abs(dk) > 0.001) return { kind: dk > 0 ? 'up' : 'down', text: `${dk > 0 ? '+' : '−'}${f(dk)} kg` };
  const dr = now.reps - prev.reps;
  if (dr !== 0) return { kind: dr > 0 ? 'up' : 'down', text: `${dr > 0 ? '+' : '−'}${Math.abs(dr)} reps` };
  return { kind: 'same', text: 'uændret' };
}
export function sessionDetail(rows, lib, key) {
  const mine = rows.filter((r) => validSet(r) && r.item_key === key).sort(order);
  if (!mine.length) return null;
  const all = sessionsFrom(rows, lib);
  const s = all.find((x) => x.key === key);
  const date = mine[0].date, session = mine[0].session;
  const prev = all.filter((x) => x.session === session && x.key !== key && x.date <= date).sort((a, b) => (a.date < b.date ? -1 : 1)).pop() || null;
  const pr = prSets(rows, lib);
  const byEx = new Map();
  for (const r of [...mine].sort((a, b) => (num(a.ex_index) ?? 99) - (num(b.ex_index) ?? 99) || (num(a.set_no) || 0) - (num(b.set_no) || 0))) {
    const cn = canonicalName(lib, r.exercise);
    if (!byEx.has(cn)) byEx.set(cn, { name: cn, sets: [], volume: 0 });
    const e = byEx.get(cn);
    e.sets.push({ id: r.id, kg: num(r.kg) || 0, reps: num(r.reps) || 0, pr: pr.byId[r.id] || [], perHand: loadTypeOf(lib, r) === 'per_hand' });
    e.volume += setVolume(lib, r);
  }
  const exercises = [...byEx.values()];
  for (const e of exercises) {
    if (!prev) { e.change = null; continue; }
    const before = prev.rows.filter((r) => canonicalName(lib, r.exercise) === e.name);
    e.change = before.length ? changeText(topOf(e.sets.map((x) => ({ kg: x.kg, reps: x.reps }))), topOf(before)) : { kind: 'new', text: 'ny' };
  }
  const primary = new Set(), secondary = new Set();
  for (const e of exercises) { const m = musclesOf(lib, e.name); m.primary.forEach((a) => primary.add(a)); m.secondary.forEach((a) => secondary.add(a)); }
  for (const a of primary) secondary.delete(a);
  const first = s && s.ts.length ? Math.min(...s.ts) : null;
  return { key, date, session, start: first, minutes: s ? s.minutes : null, sets: s ? s.sets : mine.length, volume: s ? s.volume : 0,
    exercises, prs: pr.bySession[key] || [], primary, secondary, prevDate: prev ? prev.date : null };
}

// Slår dette ✓-sæt en rekord? Returnerer en liste med tekster (tom hvis ingen eller første gang)
export function prCheck(rows, lib, row) {
  const cn = canonicalName(lib, row.exercise);
  const prior = rows.filter((r) => validSet(r) && r.id !== row.id && canonicalName(lib, r.exercise) === cn);
  if (!prior.length) return [];
  const kg = num(row.kg) || 0, reps = num(row.reps) || 0;
  let e1 = 0, mk = 0, mr = 0, sv = 0;
  for (const r of prior) {
    const k = num(r.kg) || 0, n = num(r.reps) || 0;
    e1 = Math.max(e1, epley(k, n)); mk = Math.max(mk, k); mr = Math.max(mr, n); sv = Math.max(sv, setVolume(lib, r));
  }
  const hits = [];
  if (epley(kg, reps) > e1 + 1e-9 && e1 > 0) hits.push({ type: 'e1rm', value: epley(kg, reps) });
  if (kg > mk + 1e-9 && mk > 0) hits.push({ type: 'maxKg', value: kg });
  if (setVolume(lib, row) > sv + 1e-9 && sv > 0) hits.push({ type: 'setVol', value: setVolume(lib, row) });
  if (!mk && reps > mr) hits.push({ type: 'maxReps', value: reps });
  return hits;
}

// ---------- Serie: uger i træk med mindst 3 styrkepas ----------
export function streak(sessions, today, need = 3) {
  const per = new Map();
  for (const s of sessions) per.set(mondayOf(s.date), (per.get(mondayOf(s.date)) || 0) + 1);
  const cur = mondayOf(today), thisWeek = per.get(cur) || 0;
  let n = 0, w = thisWeek >= need ? cur : P.addDays(cur, -7);
  while ((per.get(w) || 0) >= need) { n++; w = P.addDays(w, -7); }
  return { weeks: n, thisWeek, need };
}

// ---------- Estimeret præstation ----------
export function performanceTable(e1rm) {
  return Array.from({ length: 12 }, (_, i) => {
    const reps = i + 1, pct = reps === 1 ? 1 : 1 / (1 + reps / 30);
    return { reps, pct, kg: e1rm * pct };
  });
}
