// Egne løbeplaner: ugeskabelon + progression → uge-for-uge løbepas. Rene funktioner uden DOM.
// Planen genereres ved gem og lægges i rækken (generated: { dato: [pas] }), så kalender, Garmin og morgenbesked bruger de færdige pas.
import * as P from './plan.js';

const round05 = (v) => Math.round(v * 2) / 2;
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const mondayOf = (iso) => P.addDays(iso, -((P.parseISO(iso).getDay() + 6) % 7));
const clone = (o) => JSON.parse(JSON.stringify(o));

// type: planens type; label: visningsnavn; zone: standardzone
export const DAY_TYPES = [
  ['easy', 'Rolig', 'easy', 'Z2'], ['quality', 'Kvalitet/interval', 'quality', 'Z4'], ['tempo', 'Tempo', 'quality', 'Z4'], ['long', 'Langtur', 'long', 'Z2'],
  ['hills', 'Bakke/power hike', 'hills', 'Z3'], ['treadmill', 'Løbebånd', 'easy', 'Z2'], ['trail', 'Trail', 'easy', 'Z2'], ['test', 'Test (5 km)', 'quality', 'Z4'],
];
export const dayType = (id) => DAY_TYPES.find((t) => t[0] === id) || DAY_TYPES[0];
export const ZONES = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

// Kvalitetspas, der kan skiftes mellem (forklaringer: se "Løbetyper forklaret")
export const QUALITY_PRESETS = [
  { id: 'fartlek', name: 'Fartlek', reps: 6, min: 1, fmt: (r) => `Fartlek: ${r}×(1 min hurtigt / 1 min roligt)` },
  { id: 'threshold', name: 'Tærskel', reps: 3, min: 8, fmt: (r, m) => `${r}×${m} min tærskel (RPE 7), 2 min jog pause` },
  { id: 'hills', name: 'Bakkesprint', reps: 8, min: 1, fmt: (r) => `${r}×45 sek bakkesprint, jog ned som pause` },
  { id: 'tempo', name: 'Tempo', reps: 2, min: 15, fmt: (r, m) => `${r}×${m} min i tempo (RPE 7), 3 min jog pause` },
  { id: 'vo2', name: '1000 m-intervaller', reps: 5, min: 1, fmt: (r) => `${r}×1000 m i 5 km-tempo, 2 min jog pause` },
  { id: 'mp', name: 'Marathontempo (MP)', reps: 2, min: 15, fmt: (r, m) => `${r}×${m} min i MP, 3 min jog pause` },
];
export const preset = (id) => QUALITY_PRESETS.find((p) => p.id === id) || QUALITY_PRESETS[0];

export const DEFAULTS = () => ({
  weekdays: [2, 3, 5, 0],
  rows: [
    { wd: 2, sub: 'easy', km: 6, zone: 'Z2', description: '', elevation_m: '' },
    { wd: 3, sub: 'quality', km: 8, zone: 'Z4', description: '', elevation_m: '' },
    { wd: 5, sub: 'easy', km: 6, zone: 'Z2', description: '', elevation_m: '' },
    { wd: 0, sub: 'long', km: 12, zone: 'Z2', description: '', elevation_m: '' },
  ],
  rotation: [{ id: 'fartlek', reps: 6, min: 1 }, { id: 'threshold', reps: 3, min: 8 }, { id: 'hills', reps: 8, min: 1 }],
  prog: {
    start_km: 24, step_mode: 'km', step: 2, cap_km: 55,
    long_start: 12, long_step: 1, long_max: 32, mp_from: '', mp_km: 8,
    reps_step: 1, reps_max: 6, dur_step: 0, dur_max: 12, every: 2,
    cutback_every: 4, cutback_pct: 25, taper: 'auto',
    elev_start: '', elev_step: 100, elev_cap: 1500,
  },
});

// Antal nedtrapningsuger ud fra distancen på mål-løbet
export function taperWeeks(setting, raceKm) {
  if (setting === 1 || setting === 2 || setting === 3 || ['1', '2', '3'].includes(String(setting))) return Number(setting);
  return raceKm >= 30 ? 3 : raceKm >= 15 ? 2 : 1;
}
const TAPER = { 1: [0.6], 2: [0.75, 0.5], 3: [0.8, 0.65, 0.5] };


// Hvilke løbedage bruges, når der kun er plads til k: langtur og kvalitet først, så de længste rolige ture
export function pickRows(rows, k) {
  if (!k || k >= rows.length) return rows;
  const rank = (r) => { const t = dayType(r.sub)[2]; return t === 'long' ? 1000 : t === 'quality' ? 500 : 0; };
  const keep = [...rows].sort((a, b) => (rank(b) + (num(b.km) || 5)) - (rank(a) + (num(a.km) || 5))).slice(0, k);
  return rows.filter((r) => keep.includes(r));
}
const isEasyRow = (r) => dayType(r.sub)[2] === 'easy';
// Mindste turlængde: kvalitet 5 km, rolig 3 km (2 km shakeout i nedtrapning), bakke 3 km
function minOfRow(r, kind, minEasy) { const t = dayType(r.sub)[2]; return t === 'quality' && kind === 'build' ? 5 : t === 'quality' ? minEasy : t === 'hills' ? 3 : minEasy; }
// Ét løsningsforslag på en uge, hvor mindstekravene overstiger planlagte km. Returnerer de tilbageværende ture og hvad der ændres.
export function fitFix(mode, others, longKm, weekKm, kind) {
  let list = others.map((r) => ({ ...r }));
  const minEasy = mode === 'shakeout' || kind === 'taper' || kind === 'race' ? 2 : 3;
  const dropped = [], crossed = [];
  let merged = null;
  const need = () => longKm + list.reduce((a, r) => a + minOfRow(r, kind, minEasy), 0);
  const easies = () => list.filter(isEasyRow).sort((a, b) => (num(a.km) || 5) - (num(b.km) || 5));
  if (mode === 'drop') {
    const keepRuns = others.length + (longKm ? 1 : 0) >= 4 ? 3 : 2; // ugen skal beholde mindst 3 ture, når det er muligt
    while (need() > weekKm + 0.5 && easies().length && list.length + (longKm ? 1 : 0) > keepRuns) { const r = easies()[0]; list = list.filter((x) => x !== r); dropped.push(r); }
  } else if (mode === 'merge') {
    const e = easies();
    if (e.length >= 2) { const [a, b] = e; list = list.filter((x) => x !== a); b.km = (num(b.km) || 5) + (num(a.km) || 5); merged = { a, b }; }
  } else if (mode === 'cross') {
    const e = easies();
    if (e.length) { const r = e[0]; list = list.filter((x) => x !== r); crossed.push(r); }
  }
  return { list, dropped, crossed, merged, minEasy, need: need() };
}
const andList = (a) => (a.length > 1 ? `${a.slice(0, -1).join(', ')} og ${a[a.length - 1]}` : a[0] || '');
const wdName = (wd) => P.fmtWeekday(P.addDays('2026-11-02', (wd + 6) % 7)); // 2026-11-02 er en mandag
export function fixLabel(mode) { return { drop: 'Færre løbedage denne uge', merge: 'Slå to ture sammen', keep: 'Behold ugen', cross: 'Lav om til gang/cross-training', shakeout: 'Kortere rolige ture (2–3 km shakeout)' }[mode]; }
const crossItem = () => ({ kind: 'other', activity: 'gaatur', emoji: '🚶', title: 'Gåtur eller cykel 25 min', minutes: 25, rpe: 2, legs: 'light', description: 'I stedet for en kort rolig tur – 20–30 min gåtur eller cykel (tæller ikke i løbe-km).', own: false, rp: true });

// Genererer alle uger. row: { start_date, end_date?, config:{goal_date?, goal_km?, weekdays, rows, rotation, prog} }
export function generate(row) {
  const c = row.config || DEFAULTS(), pr = { ...DEFAULTS().prog, ...(c.prog || {}) };
  const S = row.start_date, goal = c.goal_date || null;
  const E = goal ? goal : (row.end_date || null);
  const warnings = [];
  if (!S || !E || E < S) return { weeks: [], days: {}, warnings: ['Vælg start og slut (eller et mål-løb).'], issues: [], end: E };
  const avoid = new Set((c.avoid || []).flatMap((d) => [-1, 0, 1].map((k) => P.addDays(d, k)))); // dagene lige før og efter andre løb
  const rows = (c.rows || []).filter((r) => (c.weekdays || []).includes(r.wd)).map((r) => ({ ...r }));
  if (!rows.length) return { weeks: [], days: {}, warnings: ['Vælg mindst én løbedag.'], issues: [], end: E };
  const ramp = [...(c.ramp || [])].filter((x) => num(x.week) && num(x.days)).sort((a, b) => a.week - b.week);
  const daysFor = (w) => { let d = rows.length; for (const x of ramp) if (w + 1 >= x.week) d = Math.min(rows.length, Math.max(1, Number(x.days))); return d; };
  const hasLong = rows.some((r) => dayType(r.sub)[2] === 'long');
  const T = goal ? taperWeeks(pr.taper, c.goal_km || 42.2) : 0;
  const mon0 = mondayOf(S), monE = mondayOf(E);
  const nWeeks = Math.round(P.daysBetween(mon0, monE) / 7) + 1;
  const goalWeek = goal ? nWeeks - 1 : -1;
  const weeks = [], days = {};
  let p = 0, sinceCut = 0, lastBuildKm = null, peak = 0, qCount = 0, prevKm = null;
  const baseKm = (i) => Math.min(num(pr.cap_km) || 999, pr.step_mode === 'pct' ? (num(pr.start_km) || 20) * (1 + (num(pr.step) || 0) / 100) ** i : (num(pr.start_km) || 20) + (num(pr.step) || 0) * i);
  const baseLong = (i) => Math.min(num(pr.long_max) || 99, (num(pr.long_start) || 10) + (num(pr.long_step) || 0) * i);
  const cutEvery = Number(pr.cutback_every) || 0, cutF = 1 - (num(pr.cutback_pct) || 25) / 100;
  for (let w = 0; w < nWeeks; w++) {
    const mon = P.addDays(mon0, 7 * w);
    const taperIdx = goal && w >= goalWeek - T ? w - (goalWeek - T) : -1; // 0 .. T (T = løbsugen)
    let kind = 'build', f = 1;
    if (taperIdx >= 0) { kind = taperIdx >= T ? 'race' : 'taper'; f = (TAPER[T] || TAPER[3])[Math.min(taperIdx, T - 1)] * (kind === 'race' ? 0.7 : 1); }
    else if (cutEvery && sinceCut + 1 >= cutEvery) { kind = 'cut'; f = cutF; }
    let km, L;
    if (kind === 'build') { km = baseKm(p); L = baseLong(p); }
    else if (kind === 'cut') { km = (lastBuildKm || baseKm(p)) * f; L = baseLong(Math.max(0, p - 1)) * f; }
    else { km = (peak || baseKm(p)) * f; L = baseLong(Math.max(0, p - 1)) * f; }
    if (kind === 'build') { lastBuildKm = km; peak = Math.max(peak, km); }
    // ugens dage i perioden
    const rowsW = pickRows(rows, daysFor(w));
    const inRange = rowsW.filter((r) => { const d = P.addDays(mon, (r.wd + 6) % 7); return d >= S && d <= E && !avoid.has(d) && !(kind === 'race' && (d >= P.addDays(E, -1) || dayType(r.sub)[2] === 'long')); });
    if (!inRange.length) { weeks.push({ start: mon, kind, km: 0, long: 0, quality: [], elev: 0, flags: [], issues: [], applied: null }); if (kind === 'build') p++; sinceCut = kind === 'cut' ? 0 : sinceCut + 1; continue; }
    const frac = inRange.length / rowsW.length;
    let weekKm = round05(km * (kind === 'race' ? 1 : frac < 1 ? Math.max(frac, 0.5) : 1));
    const flags = [], issues = [];
    let applied = null;
    const longRow = hasLong ? inRange.find((r) => dayType(r.sub)[2] === 'long') : null;
    let longKm = 0;
    if (longRow) {
      longKm = round05(Math.min(L, weekKm * 0.55));
      if (L > weekKm * 0.55 + 1 && kind === 'build') flags.push(`Langturen er sat til ${P.fmtKm(round05(L))} km, men begrænses til ${P.fmtKm(longKm)} km (højst ca. 55 % af ugens ${P.fmtKm(weekKm)} km)`);
    }
    let others = inRange.filter((r) => r !== longRow);
    const wkMode = (c.fixes || {})[mon] || null;
    let crossRows = [];
    const needAt = (list, mode) => longKm + list.reduce((a, r) => a + minOfRow(r, kind, mode === 'shakeout' || kind === 'taper' || kind === 'race' ? 2 : 3), 0);
    if (wkMode && wkMode !== 'keep') {
      const fx = fitFix(wkMode, others, longKm, weekKm, kind);
      if (wkMode === 'shakeout' || fx.dropped.length || fx.crossed.length || fx.merged) {
        others = fx.list; crossRows = fx.crossed;
        const detail = wkMode === 'drop' ? `fjernede ${andList(fx.dropped.map((r) => wdName(r.wd)))}` : wkMode === 'merge' && fx.merged ? `${wdName(fx.merged.a.wd)} lagt sammen med ${wdName(fx.merged.b.wd)}` : wkMode === 'cross' ? `${andList(fx.crossed.map((r) => wdName(r.wd)))} er gang/cykel` : 'rolige ture er 2–3 km';
        applied = { mode: wkMode, text: `${fixLabel(wkMode)}: ${detail}` };
      }
    }
    const minEasyNow = wkMode === 'shakeout' || kind === 'taper' || kind === 'race' ? 2 : 3;
    const min = (r) => minOfRow(r, kind, minEasyNow);
    let rest = Math.max(0, weekKm - longKm);
    const wts = others.map((r) => num(r.km) || 5), wsum = wts.reduce((a, b) => a + b, 0) || 1;
    const alloc = others.map((r, i) => Math.max(min(r), round05((rest * wts[i]) / wsum)));
    const total = longKm + alloc.reduce((a, b) => a + b, 0);
    if (total > weekKm + 0.5) {
      if (wkMode !== 'keep' && total > weekKm + 1) {
        const nRuns = others.length + (longRow ? 1 : 0);
        const options = [], detail = {};
        const trial = (m) => fitFix(m, others, longKm, weekKm, kind);
        if (kind === 'taper' || kind === 'race') { options.push('shakeout'); detail.shakeout = 'rolige ture bliver 2–3 km, så du beholder frekvensen'; }
        else {
          const d = trial('drop'); if (d.dropped.length) { options.push('drop'); detail.drop = `fjerner ${andList(d.dropped.map((r) => `${wdName(r.wd)} (${P.fmtKm(num(r.km) || 5)} km)`))} → ${P.fmtKm(round05(d.need))} km`; }
          const m = trial('merge'); if (m.merged) { options.push('merge'); detail.merge = `${wdName(m.merged.a.wd)} lægges sammen med ${wdName(m.merged.b.wd)} til én tur`; }
        }
        const cr = trial('cross'); if (cr.crossed.length) { options.push('cross'); detail.cross = `${wdName(cr.crossed[0].wd)} bliver en gåtur eller cykeltur på 25 min`; }
        options.push('keep'); detail.keep = `accepter ${P.fmtKm(round05(total))} km`;
        const recommended = kind === 'taper' || kind === 'race' ? 'shakeout' : options.includes('drop') && trial('drop').need <= weekKm + 1.5 ? 'drop' : options.includes('merge') ? 'merge' : 'keep';
        issues.push({ code: 'min', start: mon, planned: weekKm, actual: round05(total), diff: round05(total - weekKm), days: nRuns, options, detail, recommended,
          text: `Uge ${P.fmtDateShort(mon)}: Planen er ${P.fmtKm(weekKm)} km, men ${nRuns} løbedage × mindste turlængde giver ${P.fmtKm(round05(total))} km (${P.fmtKm(round05(total - weekKm))} km mere end planlagt).` });
      }
      weekKm = round05(total);
    }
    // højdemeter (valgfrit)
    let elevWeek = 0;
    const elevOn = num(pr.elev_start) != null;
    if (elevOn) elevWeek = Math.round(Math.min(num(pr.elev_cap) || 99999, num(pr.elev_start) + (num(pr.elev_step) || 0) * p) * (kind === 'build' ? 1 : f) / 10) * 10;
    const elevRows = inRange.filter((r) => ['hills', 'trail', 'long'].includes(dayType(r.sub)[0]) || (num(r.elevation_m) && !elevOn));
    const ew = (r) => (dayType(r.sub)[0] === 'long' ? 1.5 : 2);
    const eSum = elevRows.reduce((a, r) => a + ew(r), 0) || 1;
    const items = [];
    const q = [];
    [...(longRow ? [longRow] : []), ...others].forEach((r) => {
      const [id, label, type, zone0] = dayType(r.sub), date = P.addDays(mon, (r.wd + 6) % 7);
      let km2 = r === longRow ? longKm : alloc[others.indexOf(r)];
      let desc = (r.description || '').trim(), zone = r.zone || zone0, sub = id, tType = type;
      if (type === 'quality' && id !== 'test') {
        if (kind === 'cut' || kind === 'taper' || kind === 'race') { sub = 'easy'; tType = 'easy'; zone = 'Z2'; desc = desc || 'Rolig Z2 + 4–6×20 sek strides'; }
        else {
          const rot = c.rotation && c.rotation.length ? c.rotation : DEFAULTS().rotation;
          const it = rot[qCount % rot.length], ps = preset(it.id), s = Math.floor(qCount / Math.max(1, Number(pr.every) || 2));
          const reps = Math.min(num(pr.reps_max) || 99, (num(it.reps) || ps.reps) + s * (num(pr.reps_step) || 0));
          const mins = Math.min(num(pr.dur_max) || 99, (num(it.min) || ps.min) + s * (num(pr.dur_step) || 0));
          desc = `Inkl. 2 km op- og nedvarmning. ${ps.fmt(reps, mins)}${desc ? ` · ${desc}` : ''}`;
          q.push(ps.name); qCount++;
        }
      } else if (id === 'test') desc = desc || '2 km opvarmning, 5 km hårdt og jævnt, 2 km nedvarmning';
      else if (!desc) desc = id === 'long' ? 'Rolig Z2' : id === 'easy' ? 'Rolig Z2' : label;
      if (id === 'long' && num(pr.mp_from) && w + 1 >= Number(pr.mp_from) && kind === 'build' && num(pr.mp_km)) desc = `${desc} · sidste ${num(pr.mp_km)} km i MP`;
      const item = { kind: 'run', type: tType, km: km2, zone, description: desc, title: id === 'test' ? '5 km-test' : `${tType === 'quality' ? 'Kvalitet' : label} ${P.fmtKm(km2)} km`, rp: true, sub };
      if (id === 'test') item.test = '5k';
      let e = null;
      if (elevOn && elevRows.includes(r)) e = Math.round((elevWeek * ew(r)) / eSum / 10) * 10;
      else if (!elevOn && num(r.elevation_m)) e = Math.round(num(r.elevation_m) * (kind === 'build' ? 1 : f) / 10) * 10;
      if (e && e >= 50) { item.elevation_m = e; item.description += ` · Mål: ≈${e} højdemeter`; }
      items.push({ date, item });
    });
    for (const r of crossRows) items.push({ date: P.addDays(mon, (r.wd + 6) % 7), item: crossItem() });
    const wkKm = round05(items.reduce((a, x) => a + (x.item.km || 0), 0));
    for (const { date, item } of items) { (days[date] ||= []).push(item); }
    // advarsler: mere end ca. 10 % op fra forrige ugentlige km
    if (prevKm != null && kind === 'build' && wkKm > prevKm * 1.1 + 0.5 && prevKm >= 10) flags.push(`Stigning på ${Math.round((wkKm / prevKm - 1) * 100)} % mod ugen før (${P.fmtKm(prevKm)} → ${P.fmtKm(wkKm)} km) – over ca. 10 %`);
    weeks.push({ start: mon, kind, km: wkKm, long: longKm, quality: q, elev: items.reduce((a, x) => a + (x.item.elevation_m || 0), 0), flags, issues, applied, planned: weekKm });
    if (kind === 'build' && frac === 1) prevKm = wkKm; // sammenlignes kun med forrige opbygningsuge (ikke en cutback-uge)
    if (kind === 'build') p++;
    sinceCut = kind === 'cut' ? 0 : sinceCut + 1;
  }
  const issues = weeks.flatMap((w) => w.issues || []);
  for (const w of weeks) for (const f of w.flags) warnings.push(`Uge ${P.fmtDateShort(w.start)}: ${f}`);
  for (const i of issues) warnings.push(i.text);
  return { weeks, days, warnings, issues, end: E };
}

// Læg den aktive løbeplan oven på planens uger: planens løb (undtagen race) erstattes i perioden
export function applyRunProgram(weeks, rp) {
  if (!rp || !rp.active || !rp.generated || !rp.start_date) return weeks;
  const S = rp.start_date, E = rp.end_eff || rp.end_date || '9999-12-31', gen = rp.generated;
  return weeks.map((w) => {
    if (w.days[6].date < S || w.days[0].date > E) return w;
    const days = w.days.map((d) => {
      if (d.date < S || d.date > E) return d;
      const keep = d.items.filter((i) => !(i.kind === 'run' && i.type !== 'race'));
      const add = (gen[d.date] || []).map((i) => clone(i));
      const items = [...keep.filter((i) => i.kind !== 'rest' || !add.length), ...add];
      return { ...d, items: items.length ? items : [{ kind: 'rest', description: 'Hviledag (gåtur/mobilitet er fint)' }] };
    });
    return { ...w, days };
  });
}

// "Lav min egen ud fra den nuværende plan": skabelon og progression ud fra planens kommende uger
export function fromPlan(planWeeks, goals, today) {
  const weeks = planWeeks.filter((w) => w.days[6].date >= today);
  const runsOf = (w) => w.days.flatMap((d) => d.items.filter((i) => i.kind === 'run' && i.type !== 'race').map((i) => ({ d, i })));
  const km = (w) => runsOf(w).reduce((a, x) => a + (x.i.km || 0), 0);
  const typical = weeks.find((w) => !w.deload && runsOf(w).length >= 3 && !/Løbsuge|Nedtrapning|Restitution/.test(w.phase)) || weeks[0];
  const out = DEFAULTS();
  if (!typical) return { start_date: today, config: out };
  const subOf = (i) => (i.test ? 'test' : i.type === 'hills' ? 'hills' : i.type === 'long' ? 'long' : i.type === 'quality' ? 'quality' : /trail/i.test(i.description || '') && i.elevation_m ? 'trail' : 'easy');
  const rows = runsOf(typical).map(({ d, i }) => ({ wd: P.parseISO(d.date).getDay(), sub: subOf(i), km: i.km, zone: i.zone || '', description: '', elevation_m: i.elevation_m || '' }));
  out.rows = rows; out.weekdays = rows.map((r) => r.wd);
  const builds = weeks.filter((w) => !w.deload && !/Løbsuge|Nedtrapning|Restitution/.test(w.phase));
  const kms = builds.map(km), longs = builds.map((w) => Math.max(0, ...runsOf(w).filter((x) => x.i.type === 'long').map((x) => x.i.km)));
  out.prog.start_km = Math.round(km(typical));
  out.prog.cap_km = Math.round(Math.max(...kms, km(typical)));
  out.prog.long_start = Math.round(Math.max(0, ...runsOf(typical).filter((x) => x.i.type === 'long').map((x) => x.i.km)) || 10);
  out.prog.long_max = Math.round(Math.max(...longs, out.prog.long_start));
  out.prog.step = Math.max(1, Math.round((out.prog.cap_km - out.prog.start_km) / Math.max(1, builds.length - 1)));
  out.prog.long_step = Math.max(1, Math.round((out.prog.long_max - out.prog.long_start) / Math.max(1, builds.length - 1)));
  const elevs = weeks.map((w) => w.elevation_m || 0).filter(Boolean);
  if (elevs.length) { out.prog.elev_start = Math.min(...elevs); out.prog.elev_cap = Math.max(...elevs); out.prog.elev_step = Math.max(50, Math.round((out.prog.elev_cap - out.prog.elev_start) / Math.max(1, builds.length) / 10) * 10); }
  const g = (goals || []).filter((x) => x.date && x.date >= today).sort((a, b) => (a.date < b.date ? 1 : -1))[0]; // det sidste mål
  if (g) { out.goal_date = g.date; out.goal_km = /marathon/i.test(g.name) ? 42.2 : /half|transgrancanaria/i.test(g.name) ? 23 : 21.1; }
  return { start_date: today, config: out };
}

// Forslag til løbedage pr. uge, så km altid rækker til antallet af dage: støt stigende (3 dage først, så 4 …)
export function suggestRamp(row) {
  const cfg = JSON.parse(JSON.stringify(row.config || DEFAULTS()));
  const n = (cfg.weekdays || []).length;
  const fit = new Map(); // uge-indeks → største antal dage uden km-advarsel
  const base = generate({ ...row, config: { ...cfg, ramp: [], fixes: {} } });
  base.weeks.forEach((w, i) => { if (w.kind === 'build') fit.set(i, 2); });
  for (let k = n; k >= 2; k--) {
    const g = generate({ ...row, config: { ...cfg, ramp: [{ week: 1, days: k }], fixes: {} } });
    g.weeks.forEach((w, i) => { if (fit.has(i) && fit.get(i) < k && !(w.issues || []).some((x) => x.code === 'min')) fit.set(i, k); });
  }
  const idx = [...fit.keys()].sort((a, b) => a - b);
  let suffix = n;
  const days = new Map();
  for (let j = idx.length - 1; j >= 0; j--) { suffix = Math.min(suffix, fit.get(idx[j])); days.set(idx[j], suffix); }
  const stages = [];
  let last = null;
  for (const i of idx) { const d = days.get(i); if (d !== last) { stages.push({ week: i + 1, days: d }); last = d; } }
  if (stages.length) stages[0].week = 1;
  return stages.length === 1 && stages[0].days >= n ? [] : stages;
}
// Anbefalet løsning for alle uger med advarsel
export function recommendAll(row) {
  const g = generate(row);
  const out = {};
  for (const i of g.issues || []) out[i.start] = i.recommended;
  return out;
}
