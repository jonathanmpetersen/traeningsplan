// Planen reagerer på det, du faktisk laver: ekstra løb/styrke, ændret type, ugens opgørelse og ømhed efter benpas.
// Rene funktioner uden DOM (testes af scripts/test_logic.mjs).
import * as P from './plan.js';
import * as RS from './runstats.js';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const round05 = (v) => Math.round(v * 2) / 2;
const sum = (a) => a.reduce((s, x) => s + x, 0);
const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? sum(v) / v.length : null; };
const mondayOf = (iso) => P.addDays(iso, -((P.parseISO(iso).getDay() + 6) % 7));

// ---------- Løbeture ----------
// Andel af tiden i Z4–Z5 (Garmins zonetid, ellers gennemsnitspulsen)
export function hardShare(run, zones) {
  if (run.zoneSecs) {
    const tot = sum(Object.values(run.zoneSecs).map((v) => num(v) || 0));
    if (tot > 0) return ((num(run.zoneSecs.Z4) || 0) + (num(run.zoneSecs.Z5) || 0)) / tot;
  }
  if (run.hr && zones) { const z = RS.zoneOf(run.hr, zones); return z === 'Z4' || z === 'Z5' ? 1 : 0; }
  return null;
}
export const isHardRun = (run, zones) => (hardShare(run, zones) ?? 0) >= 0.4;
export const isLongRun = (run) => (run.km || 0) >= 14 || (run.sec || 0) >= 90 * 60;

// Match turene med planlagte løbepas pr. dag. Returnerer ekstra ture, matchede par og ændrede pas.
export function matchRuns({ entries, runs, from, to, zones }) {
  const planned = new Map();
  for (const e of entries) if (e.item.kind === 'run' && e.item.type !== 'race' && e.date >= from && e.date <= to) { if (!planned.has(e.date)) planned.set(e.date, []); planned.get(e.date).push(e); }
  const byDate = new Map();
  for (const r of runs) if (r.date >= from && r.date <= to) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
  const out = { extra: [], matched: [], changed: [] };
  for (const [date, rs] of byDate) {
    const pl = [...(planned.get(date) || [])];
    const left = [];
    for (const r of rs) {
      const i = r.key ? pl.findIndex((e) => e.key === r.key) : -1;
      if (i >= 0) out.matched.push({ run: r, entry: pl.splice(i, 1)[0] }); else left.push(r);
    }
    for (const r of left) {
      if (!pl.length) { out.extra.push({ date, run: r, km: r.km, hard: isHardRun(r, zones), long: isLongRun(r) }); continue; }
      let bi = 0;
      pl.forEach((e, k) => { if (Math.abs((e.item.km || 0) - r.km) < Math.abs((pl[bi].item.km || 0) - r.km)) bi = k; });
      out.matched.push({ run: r, entry: pl.splice(bi, 1)[0] });
    }
  }
  for (const { run, entry } of out.matched) {
    const t = entry.item.type, share = hardShare(run, zones);
    if (share == null) continue;
    if ((t === 'easy' || t === 'long') && share >= 0.4) out.changed.push({ key: entry.key, date: entry.date, why: 'hårdere end planlagt', run });
    else if ((t === 'quality' || t === 'hills') && share < 0.1 && (run.hr || run.zoneSecs)) out.changed.push({ key: entry.key, date: entry.date, why: 'roligere end planlagt', run });
  }
  return out;
}

// ---------- Styrkepas ----------
// Er det et benpas? Navnet (Lower) eller mindst halvdelen af øvelserne er benøvelser
export function isLegSession(s, lib) {
  if (P.isLower({ kind: 'strength', session: s.session })) return true;
  const names = [...new Set((s.rows || []).map((r) => r.exercise))];
  const lower = names.filter((n) => { const e = lib && lib.get && lib.get(n); return e && e.body === 'lower'; }).length;
  return names.length > 0 && lower / names.length >= 0.5;
}
// sessions: fra X.sessionsFrom; lib: Map(navn → info med body). Ekstra = pas uden planlagt pas med samme nøgle.
export function matchStrength({ entries, sessions, from, to, lib }) {
  const plannedKeys = new Set(entries.filter((e) => e.item.kind === 'strength').map((e) => e.key));
  const out = { extra: [], changed: [] };
  const isLeg = (s) => isLegSession(s, lib);
  for (const s of sessions) {
    if (s.date < from || s.date > to || plannedKeys.has(s.key)) continue;
    out.extra.push({ date: s.date, session: s.session, leg: isLeg(s), key: s.key });
  }
  const doneKeys = new Set(sessions.map((s) => s.key));
  for (const x of out.extra) {
    for (const e of entries) if (e.date === x.date && e.item.kind === 'strength' && !doneKeys.has(e.key)) out.changed.push({ key: e.key, date: e.date, why: `${x.session || 'et andet pas'} i stedet` });
  }
  return out;
}

// ---------- Hybrid-regler ved ændringer ----------
const scheduleOf = (weeks) => {
  const byDate = new Map();
  for (const w of weeks) for (const d of w.days) byDate.set(d.date, d.items.map((item) => ({ item })));
  return { byDate };
};
// Nye regelbrud i dagene fra i dag og frem, hvis de faktiske pas lægges oven på planen
export function ruleImpacts({ weeks, today, extraRuns, extraStrength, changedRuns, rules }) {
  const clone = JSON.parse(JSON.stringify(weeks));
  const base = new Set(P.checkRules(scheduleOf(weeks), rules).map((v) => v.text));
  const day = (d) => { for (const w of clone) for (const x of w.days) if (x.date === d) return x; return null; };
  let touched = false;
  for (const x of extraRuns || []) {
    if (!x.hard && !x.long) continue;
    const d = day(x.date); if (!d) continue;
    d.items.push({ kind: 'run', type: x.long && !x.hard ? 'long' : 'quality', km: x.km }); touched = true;
  }
  for (const x of extraStrength || []) {
    if (!x.leg) continue;
    const d = day(x.date); if (!d) continue;
    d.items.push({ kind: 'strength', session: 'Lower', leg: true, exercises: [] }); touched = true;
  }
  for (const c of changedRuns || []) {
    if (c.why !== 'hårdere end planlagt') continue;
    const d = day(c.date); if (!d) continue;
    const it = d.items.find((i) => i.kind === 'run' && i.type !== 'race'); if (it) { it.type = 'quality'; touched = true; }
  }
  if (!touched) return [];
  return P.checkRules(scheduleOf(clone), rules).filter((v) => !base.has(v.text) && v.date >= today).map((v) => ({ date: v.date, text: v.text }));
}

// ---------- For mange km: forkort en kommende rolig tur ----------
export function shortenSuggestion({ entries, runs, today, hasExtra }) {
  if (!hasExtra) return null;
  const mon = mondayOf(today), end = P.addDays(mon, 6);
  const wEntries = entries.filter((e) => e.item.kind === 'run' && e.item.type !== 'race' && e.date >= mon && e.date <= end);
  const plannedToDate = sum(wEntries.filter((e) => e.date <= today).map((e) => e.item.km || 0));
  const actualToDate = sum(runs.filter((r) => r.date >= mon && r.date <= today).map((r) => r.km || 0));
  const excess = actualToDate - plannedToDate;
  if (excess < 2) return null;
  const next = wEntries.filter((e) => e.date > today && e.item.type === 'easy').sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (!next) return null;
  const to = Math.max(3, round05(next.item.km - excess));
  return to < next.item.km ? { key: next.key, date: next.date, from: next.item.km, to, excess: Math.round(excess * 10) / 10 } : null;
}

// ---------- Belastning ----------
// others: [{date, load}] – egne "andet"-pas (varighed × RPE)
export const dayLoad = (runs, sessions, date, others = []) => sum(runs.filter((r) => r.date === date).map((r) => r.km || 0)) + 0.15 * sum(sessions.filter((s) => s.date === date).map((s) => s.sets || 0)) + sum(others.filter((o) => o.date === date).map((o) => o.load || 0));
export function loadRatio({ runs, sessions, end, others = [] }) {
  let acute = 0, total = 0;
  for (let i = 0; i < 28; i++) { const l = dayLoad(runs, sessions, P.addDays(end, -i), others); total += l; if (i < 7) acute += l; }
  const chronic = total / 4;
  return { acute: Math.round(acute * 10) / 10, chronic: Math.round(chronic * 10) / 10, ratio: chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null };
}
export const LOAD_RANGE = [0.8, 1.3];

// ---------- Ugeopgørelse og forslag til næste uge ----------
const BAD_HRV = new Set(['LOW', 'POOR', 'UNBALANCED']);
export function weeklyReview({ start, entries, isDone, runs, sessions, daily, logs, nextWeek, others = [] }) {
  const dates = P.weekDates(start), end = dates[6];
  const wEntries = entries.filter((e) => dates.includes(e.date) && e.item.kind !== 'rest' && !(e.item.kind === 'run' && e.item.type === 'race'));
  const pRuns = wEntries.filter((e) => e.item.kind === 'run');
  const wRuns = runs.filter((r) => dates.includes(r.date));
  const wSess = sessions.filter((s) => dates.includes(s.date));
  const planned = {
    km: sum(pRuns.map((e) => e.item.km || 0)), longest: Math.max(0, ...pRuns.filter((e) => e.item.type === 'long').map((e) => e.item.km || 0)),
    elev: sum(pRuns.map((e) => e.item.elevation_m || 0)), strength: wEntries.filter((e) => e.item.kind === 'strength').length,
  };
  const actual = { km: sum(wRuns.map((r) => r.km || 0)), longest: Math.max(0, ...wRuns.map((r) => r.km || 0)), elev: sum(wRuns.map((r) => r.elev || 0)), strength: wSess.length };
  const rpeAvg = avg(wRuns.map((r) => num(r.rpe)));
  const runsSkipped = pRuns.filter((e) => !isDone(e)).length;
  const done = wEntries.filter(isDone).length;
  const doneFrac = wEntries.length ? done / wEntries.length : null;
  const skipped = wEntries.length - done;
  const legsAvg = avg(logs.filter((l) => dates.includes(l.date)).map((l) => num(l.legs)));
  const dRows = daily.filter((r) => dates.includes(r.date));
  const badHrv = dRows.filter((r) => BAD_HRV.has(String(r.hrv_status || '').toUpperCase())).length;
  const sleep = avg(dRows.map((r) => (num(r.sleep_seconds) ? num(r.sleep_seconds) / 3600 : null)));
  const load = loadRatio({ runs, sessions, end, others });
  const reasons = [];
  const down = [];
  if (runsSkipped >= 2) down.push(`${runsSkipped} løbepas blev sprunget over`);
  if (rpeAvg != null && rpeAvg >= 8) down.push(`løbene føltes hårde (RPE ${Math.round(rpeAvg * 10) / 10} i snit)`);
  if (doneFrac != null && doneFrac < 0.6) down.push(`kun ${done} af ${wEntries.length} pas blev gennemført`);
  if (badHrv >= 3) down.push('HRV har været lav/ubalanceret flere dage');
  if (sleep != null && sleep < 6.5) down.push(`søvnen var kun ${Math.round(sleep * 10) / 10} timer i snit`);
  if (legsAvg != null && legsAvg >= 3.5) down.push(`benene har været ømme (${Math.round(legsAvg * 10) / 10} i snit)`);
  if (load.ratio != null && load.ratio > LOAD_RANGE[1]) down.push(`belastningen er høj (${load.ratio} mod 28 dage – målet er ${LOAD_RANGE[0]}–${LOAD_RANGE[1]})`);
  const calm = badHrv < 2 && (sleep == null || sleep >= 7) && (legsAvg == null || legsAvg <= 2.5);
  let id = 'hold';
  if (down.length) { id = 'down'; reasons.push(...down); }
  else if (nextWeek && nextWeek.deload) reasons.push('næste uge er en deload');
  else if (runsSkipped === 0 && pRuns.length && (rpeAvg == null || rpeAvg <= 5) && doneFrac != null && doneFrac >= 0.95 && calm && (load.ratio == null || load.ratio <= 1.15)) { id = 'up'; reasons.push(`alle løbepas blev gennemført${rpeAvg != null ? `, RPE ${Math.round(rpeAvg * 10) / 10} i snit` : ''}, restitutionen ser god ud og ømheden er lav`); }
  else if (runsSkipped === 0 && load.ratio != null && load.ratio < LOAD_RANGE[0] && calm && doneFrac != null && doneFrac >= 0.8 && (rpeAvg == null || rpeAvg <= 5)) { id = 'up'; reasons.push(`belastningen er lav (${load.ratio} mod 28 dage)`); }
  else if (runsSkipped === 1) reasons.push('ét løbepas blev sprunget over – hold niveauet')
  else if (rpeAvg != null && rpeAvg > 5) reasons.push(`løbene føltes ret hårde (RPE ${Math.round(rpeAvg * 10) / 10} i snit) – hold niveauet`);
  else reasons.push('hold niveauet, indtil alt er gennemført og restitutionen er god');
  const upFactor = rpeAvg != null && rpeAvg <= 4 && (load.ratio == null || load.ratio <= 1.15) ? 1.1 : 1.05; // +5–10 %
  const factor = id === 'up' ? upFactor : id === 'down' ? 0.9 : 1;
  // belastningen i næste uge skal holdes inden for 0,8–1,3 af de seneste 4 uger
  let projected = null;
  if (nextWeek && load.chronic > 0) {
    projected = Math.round(((nextWeek.plannedKm * factor + 0.15 * (nextWeek.plannedSets || 0)) / load.chronic) * 100) / 100;
    if (id === 'up' && projected > LOAD_RANGE[1]) { id = 'hold'; reasons.length = 0; reasons.push(`en stigning ville give en belastning på ${projected} (over ${LOAD_RANGE[1]})`); }
  }
  return { start, planned, actual, doneFrac, done, skipped, total: wEntries.length, legsAvg, load, projected, rpeAvg, runsSkipped, suggestion: { id, factor: id === 'up' ? upFactor : id === 'down' ? 0.9 : 1, pct: id === 'up' ? Math.round((upFactor - 1) * 100) : id === 'down' ? -10 : 0, reasons } };
}
export const SUGGESTION_LABEL = { hold: 'Hold', up: 'Lidt op', down: 'Lidt ned' };

// ---------- Ømhed efter benpas ----------
// legSessions: [{date}] benpas; logs: daily_log-rækker med legs. Dag 1–3 efter hvert benpas.
export function legSoreness({ legSessions, logs }) {
  const by = new Map(logs.filter((l) => num(l.legs) != null).map((l) => [l.date, num(l.legs)]));
  const rows = legSessions.map((s) => {
    const d = [1, 2, 3].map((k) => by.get(P.addDays(s.date, k)) ?? null);
    return { date: s.date, d1: d[0], d2: d[1], d3: d[2], avg: avg(d) };
  }).filter((r) => r.avg != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  const mean = (k) => avg(rows.map((r) => r[k]));
  let verdict = null;
  if (rows.length >= 4) {
    const half = Math.floor(rows.length / 2);
    const a = avg(rows.slice(0, half).map((r) => r.avg)), b = avg(rows.slice(-half).map((r) => r.avg));
    if (b <= a - 0.5) verdict = 'Ømheden er faldet – tilvænningen virker.';
    else if (b >= a + 0.5) verdict = 'Ømheden er steget – hold volumen, eller gå et skridt tilbage.';
    else verdict = 'Ømheden er stabil.';
    if (b <= 2) verdict += ' Den er lav nu, så du kan øge ben-volumen et trin.';
  }
  return { rows, means: { d1: mean('d1'), d2: mean('d2'), d3: mean('d3') }, verdict };
}
