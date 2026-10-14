// Ugerapport: tal for en uge samlet ét sted (løb, styrke, restitution) + en kort vurdering.
import * as P from './plan.js';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const inWeek = (dates, d) => dates.includes(d);

// entries: planens pas (med date, key, item); statusOf(key) → 'done' | 'skipped' | null
// runs: fra RS.runsList; sessions: fra X.sessionsFrom; prCount: antal rekorder i ugen; daily: garmin_daily-rækker
export function weekReport({ start, entries, statusOf, runs, sessions, prCount, daily, prevDaily, weekInfo, today }) {
  const dates = P.weekDates(start);
  const wEntries = entries.filter((e) => inWeek(dates, e.date));
  const plannedRuns = wEntries.filter((e) => e.item.kind === 'run');
  const plannedStrength = wEntries.filter((e) => e.item.kind === 'strength');
  const wRuns = runs.filter((r) => inWeek(dates, r.date));
  const wSess = sessions.filter((s) => inWeek(dates, s.date));
  const dayRows = daily.filter((r) => inWeek(dates, r.date));
  const prevRows = prevDaily;
  const r = {
    start, end: dates[6], inProgress: !!today && today < dates[6], week: weekInfo ? weekInfo.week : null, phase: weekInfo ? weekInfo.phase : '', deload: !!(weekInfo && weekInfo.deload),
    plannedKm: plannedRuns.reduce((s, e) => s + (num(e.item.km) || 0), 0),
    km: wRuns.reduce((s, x) => s + (x.km || 0), 0),
    elev: wRuns.reduce((s, x) => s + (x.elev || 0), 0),
    plannedElev: (weekInfo && weekInfo.elevation_m) || plannedRuns.reduce((s, e) => s + (num(e.item.elevation_m) || 0), 0),
    longest: Math.max(0, ...wRuns.map((x) => x.km || 0)),
    runsDone: plannedRuns.filter((e) => statusOf(e.key) === 'done').length, runsPlanned: plannedRuns.length,
    strengthDone: wSess.length, strengthPlanned: plannedStrength.length,
    sets: wSess.reduce((s, x) => s + x.sets, 0), volume: wSess.reduce((s, x) => s + x.volume, 0), prs: prCount || 0,
    skipped: wEntries.filter((e) => statusOf(e.key) === 'skipped').length,
    hrv: avg(dayRows.map((x) => num(x.hrv_avg))), hrvPrev: avg(prevRows.map((x) => num(x.hrv_avg))),
    sleepH: avg(dayRows.map((x) => (num(x.sleep_seconds) ? num(x.sleep_seconds) / 3600 : null))),
    rhr: avg(dayRows.map((x) => num(x.resting_hr))), stress: avg(dayRows.map((x) => num(x.stress_avg))),
  };
  r.lines = assess(r);
  return r;
}

const r1 = (v) => Math.round(v * 10) / 10;
export function assess(r) {
  const lines = [];
  if (r.inProgress) {
    // Ugen er ikke slut: ingen dom, kun status
    if (r.plannedKm > 0) lines.push(`Ugen er i gang: ${r1(r.km)} af ${r1(r.plannedKm)} km løbet hidtil.`);
    if (r.strengthPlanned > 0) lines.push(`Styrke: ${r.strengthDone} af ${r.strengthPlanned} pas logget hidtil${r.prs ? `, og ${r.prs} rekord${r.prs === 1 ? '' : 'er'} 🏅` : ''}.`);
  } else {
    if (r.plannedKm > 0) {
      const p = r.km / r.plannedKm;
      lines.push(p >= 0.9 ? `Løb: ${r1(r.km)} km af ${r1(r.plannedKm)} planlagte – planen holdt.`
        : p >= 0.6 ? `Løb: ${r1(r.km)} af ${r1(r.plannedKm)} km. Et par ture manglede – tag dem ikke igen i næste uge, bare fortsæt planen.`
        : `Løb: kun ${r1(r.km)} af ${r1(r.plannedKm)} km. Det sker – se om næste uge kan flyttes lidt, og hold dig til rolige ture.`);
    } else if (r.km > 0) lines.push(`Løb: ${r1(r.km)} km.`);
    if (r.strengthPlanned > 0) lines.push(r.strengthDone >= r.strengthPlanned ? `Styrke: alle ${r.strengthPlanned} pas er logget${r.prs ? `, og du slog ${r.prs} rekord${r.prs === 1 ? '' : 'er'} 🏅` : ''}.` : `Styrke: ${r.strengthDone} af ${r.strengthPlanned} pas er logget.`);
    else if (r.strengthDone > 0) lines.push(`Styrke: ${r.strengthDone} pas logget${r.prs ? `, og ${r.prs} rekord${r.prs === 1 ? '' : 'er'} 🏅` : ''}.`);
  }
  if (r.hrv != null && r.hrvPrev != null) {
    const d = r.hrv - r.hrvPrev;
    lines.push(Math.abs(d) < 2 ? 'HRV er stabil mod sidste uge.' : d > 0 ? `HRV steg ${Math.round(d)} ms mod sidste uge – du har restitueret godt.` : `HRV faldt ${Math.round(-d)} ms mod sidste uge – giv dig selv ekstra søvn og rolige dage.`);
  }
  if (r.sleepH != null && r.sleepH < 7) lines.push(`Søvn: i snit ${r1(r.sleepH)} timer – under de 7–9 timer, der er målet.`);
  if (r.deload) lines.push('Det var en deload-uge – lavere belastning er meningen.');
  if (!lines.length) lines.push('Ingen data for ugen endnu.');
  return lines;
}
