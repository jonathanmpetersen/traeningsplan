// Restitution: baseline, dagens status (grøn/gul/rød) og forslag til dagens pas.
// Data kommer fra garmin_daily (Garmin pull). Ingen træningsindhold her – kun vurdering.
import * as P from './plan.js';

export const BASELINE_DAYS = 28;  // din egen normal = de seneste 28 dage før i dag
export const MIN_BASELINE = 7;    // mindst 7 dage med data, før vi sammenligner med din normal

const num = (v) => (typeof v === 'number' && isFinite(v) ? v : v != null && v !== '' && isFinite(Number(v)) ? Number(v) : null);
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export function sd(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

// byDate: Map 'YYYY-MM-DD' → garmin_daily-række
export function indexDays(rows) { return new Map(rows.map((r) => [r.date, r])); }

export function values(byDate, field, from, to) {
  const out = [];
  for (let d = from; d <= to; d = P.addDays(d, 1)) {
    const v = num((byDate.get(d) || {})[field]);
    if (v != null) out.push({ date: d, v });
  }
  return out;
}

// Din normal for et felt: snit og spredning over de 28 dage før `date`
export function baseline(byDate, field, date) {
  const vals = values(byDate, field, P.addDays(date, -BASELINE_DAYS), P.addDays(date, -1)).map((x) => x.v);
  if (vals.length < MIN_BASELINE) return null;
  return { mean: mean(vals), sd: sd(vals), n: vals.length };
}

const LEVEL = { green: 0, yellow: 1, red: 2 };
const worst = (a, b) => (LEVEL[a] >= LEVEL[b] ? a : b);
const r0 = (v) => Math.round(v);

// Dagens status ud fra HRV, søvn, hvilepuls og Body Battery
export function dayStatus(byDate, date) {
  const day = byDate.get(date);
  if (!day) return { level: 'unknown', reasons: [], day: null };
  const reasons = [];
  const add = (level, metric, text) => reasons.push({ level, metric, text });

  // Er nattens data kommet? Før uret har synkroniseret, er dagens række kun halv (fx et gammelt lavpunkt i Body Battery) – så vurderes intet
  const nightIn = num(day.sleep_score) != null || num(day.hrv_avg) != null || num(day.body_battery_wake) != null;
  if (!nightIn) return { level: 'unknown', reasons, day, pending: true };

  // HRV i nat mod din normal (og Garmins egen vurdering)
  const hrv = num(day.hrv_avg);
  const hb = baseline(byDate, 'hrv_avg', date);
  const gStatus = String(day.hrv_status || '').toUpperCase();
  if (hrv != null && hb) {
    const low1 = hb.mean - Math.max(hb.sd, 3), low2 = hb.mean - Math.max(2 * hb.sd, 6);
    if (hrv < low2) add('red', 'hrv', `HRV ${r0(hrv)} ms – markant under din normal (${r0(hb.mean)} ms)`);
    else if (hrv < low1) add('yellow', 'hrv', `HRV ${r0(hrv)} ms – under din normal (${r0(hb.mean)} ms)`);
    else add('green', 'hrv', `HRV ${r0(hrv)} ms – på din normal (${r0(hb.mean)} ms)`);
  } else if (hrv != null) {
    add('green', 'hrv', `HRV ${r0(hrv)} ms (din normal beregnes efter ${MIN_BASELINE} dage med data)`);
  }
  if (gStatus === 'LOW' || gStatus === 'POOR') add('red', 'hrv', 'Garmin: HRV-status lav');
  else if (gStatus === 'UNBALANCED') add('yellow', 'hrv', 'Garmin: HRV-status ubalanceret');

  // Søvn
  const score = num(day.sleep_score), hours = num(day.sleep_seconds) != null ? num(day.sleep_seconds) / 3600 : null;
  if (score != null) {
    if (score < 50) add('red', 'sleep', `Søvnscore ${r0(score)} – dårlig nat`);
    else if (score < 65) add('yellow', 'sleep', `Søvnscore ${r0(score)} – under middel`);
    else add('green', 'sleep', `Søvnscore ${r0(score)}`);
  }
  if (hours != null) {
    if (hours < 5) add('red', 'sleep', `Kun ${hours.toFixed(1).replace('.', ',')} timers søvn`);
    else if (hours < 6) add('yellow', 'sleep', `${hours.toFixed(1).replace('.', ',')} timers søvn – lidt kort`);
  }

  // Hvilepuls mod din normal
  const rhr = num(day.resting_hr);
  const rb = baseline(byDate, 'resting_hr', date);
  if (rhr != null && rb) {
    const diff = rhr - rb.mean;
    if (diff >= 7) add('red', 'rhr', `Hvilepuls ${r0(rhr)} – ${r0(diff)} slag over din normal`);
    else if (diff >= 4) add('yellow', 'rhr', `Hvilepuls ${r0(rhr)} – ${r0(diff)} slag over din normal`);
    else add('green', 'rhr', `Hvilepuls ${r0(rhr)} – normal (${r0(rb.mean)})`);
  }

  // Body Battery ved opvågning
  const bb = num(day.body_battery_wake); // kun værdien ved opvågning (dagens højeste/laveste siger intet om, hvordan du starter dagen)
  if (bb != null) {
    if (bb < 25) add('red', 'bb', `Body Battery ${r0(bb)} – lavt`);
    else if (bb < 50) add('yellow', 'bb', `Body Battery ${r0(bb)} – halvt opladet`);
    else add('green', 'bb', `Body Battery ${r0(bb)}`);
  }

  if (!reasons.length) return { level: 'unknown', reasons, day };
  let level = reasons.reduce((l, r) => worst(l, r.level), 'green');
  if (level === 'yellow' && reasons.filter((r) => r.level === 'yellow').length >= 3) level = 'red';
  return { level, reasons, day };
}

// Konkret forslag til dagens pas ud fra status
export function suggestion(level, entries, title) {
  const items = entries.map((e) => e.item).filter((i) => i.kind !== 'rest');
  const run = items.find((i) => i.kind === 'run');
  const strength = items.find((i) => i.kind === 'strength');
  const t = run ? run.type : strength ? 'strength' : 'rest';
  const name = run ? title(entries.find((e) => e.item === run)) : strength ? strength.session : '';
  const hard = ['quality', 'long', 'hills'].includes(t);
  const lines = {
    green: {
      quality: `Grønt lys: gennemfør ${name} som planlagt.`,
      long: `Grønt lys til langturen (${name}). Husk energi undervejs.`,
      hills: `Grønt lys til power hike (${name}).`,
      easy: `Rolig tur som planlagt (${name}).`,
      race: 'Kroppen er klar – god løbsdag!',
      strength: `Fuld styrke i ${name} – gå efter progression.`,
      rest: 'Hviledag – godt timet. Gå gerne en tur.',
    },
    yellow: {
      quality: `Gennemfør ${name}, men hold dig i bunden af zonen og drop evt. sidste interval.`,
      long: `Kør ${name} i Z2 hele vejen, og kort den gerne 10–20 %.`,
      hills: `Kortere power hike i roligt tempo – stop hvis pulsen løber løbsk.`,
      easy: `Rolig tur, gerne lidt kortere end planlagt.`,
      race: 'Start roligt og løb efter følelsen.',
      strength: `Træn ${name}, men hold 1 rep ekstra i reserve og skip ikke-vigtige øvelser.`,
      rest: 'Hviledag – perfekt timing. Prioritér søvn i nat.',
    },
    red: {
      quality: `Byt ${name} til et roligt pas eller hvile i dag.`,
      long: `Udskyd ${name}, eller løb kort og meget roligt i dag.`,
      hills: `Spring power hike over i dag – gå en rolig tur i stedet.`,
      easy: 'Hvil eller gå en tur i stedet for at løbe.',
      race: 'Løbsdag: start meget roligt, og drik og spis tidligt.',
      strength: `Let teknikpas eller hvil i stedet for ${name}.`,
      rest: 'Hviledag – godt. Ekstra søvn og mad i dag.',
    },
  };
  if (level === 'unknown') return { text: 'Ingen data fra uret fra i nat endnu – vurder efter følelsen.', canSwap: false };
  const text = (lines[level] || lines.green)[t] || lines[level].easy;
  return { text, canSwap: level === 'red' && hard };
}

// Mandag i ugen for en dato
export function weekStart(date) {
  const d = P.parseISO(date);
  const wd = (d.getDay() + 6) % 7;
  return P.addDays(date, -wd);
}
