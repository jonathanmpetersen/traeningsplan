// Løbetype på loggede ture: planlagt type (fra det matchede pas) og faktisk type (foreslået ud fra navn, Strava-type,
// omgange/intervaller, pulszoner, længde og stigning – eller rettet af dig). Rene funktioner uden DOM (testes i test_logic.mjs).
import * as RS from './runstats.js';
import * as P from './plan.js';

export const TYPES = [['easy', 'Rolig'], ['tempo', 'Tempo'], ['intervals', 'Intervaller'], ['hills', 'Bakker'], ['long', 'Langtur'], ['mp', 'Maratontempo'], ['powerhike', 'Power hike'], ['race', 'Test/Race']];
// Gamle gemte typer (før de 8 løbetyper): kvalitet → intervaller
export const normType = (t) => (t === 'quality' ? 'intervals' : t);
export const typeLabel = (t) => (TYPES.find((x) => x[0] === t) || [t, t || '–'])[1];
const HARD = new Set(['intervals', 'tempo', 'hills', 'mp']);
export const isHardType = (t) => HARD.has(t);

// Planlagt type ud fra et pas i planen (tærskel/MP-pas er "tempo", resten af kvalitetspas "kvalitet")
export function plannedTypeOf(item) {
  if (!item || item.kind !== 'run') return null;
  return item.strides_day ? 'easy' : P.typeKey(item);
}

// Navnet på aktiviteten ("Helsinki - TP Kvalitet 6 km", "Langtur", "Fartlek" …)
const NAME_RULES = [
  [/rolig\s*\+\s*strides|\brolig\b|\beasy\b|recovery|restitution|shakeout/i, 'easy'],
  [/\brace\b|stævne|marathon\b|halvmarathon|\bhalf\b/i, 'race'],
  [/maratontempo/i, 'mp'],
  [/power hike/i, 'powerhike'],
  [/langtur|long run|\blong\b/i, 'long'],
  [/bakke|hill|power hike|stigning/i, 'hills'],
  [/tærskel|tempo|threshold/i, 'tempo'],
  [/\bMP\b|marathonfart/i, 'mp'],
  [/kvalitet|interval|fartlek|\d+\s*[×x]\s*\d/i, 'intervals'],
];
export function typeFromName(name) {
  const n = String(name || '');
  if (!n.trim()) return null;
  // "Rolig + strides" er en rolig tur, selvom der står strides
  for (const [re, t] of NAME_RULES) if (re.test(n)) return { type: t, hit: (n.match(re) || [''])[0] };
  return null;
}

// Stravas workout_type for løb: 1 = race, 2 = langtur, 3 = træning (kvalitet)
export const STRAVA_TYPE = { 1: 'race', 2: 'long', 3: 'intervals' };

// Antal skift mellem hurtigt og langsomt i omgangene (fartlek/intervaller giver mange skift)
export function intervalSwitches(splits) {
  const sp = (Array.isArray(splits) ? splits : []).filter((x) => x && x.pace_sec_km && x.time_sec >= 20);
  if (sp.length < 6) return 0;
  const paces = sp.map((x) => x.pace_sec_km).sort((a, b) => a - b);
  const med = paces.reduce((a, b) => a + b, 0) / paces.length; // gennemsnit: deler hurtige og rolige omgange pænt
  let last = 0, n = 0;
  for (const x of sp) {
    const d = (x.pace_sec_km - med) / med;
    const s = d < -0.1 ? -1 : d > 0.1 ? 1 : 0;
    if (s !== 0) { if (last !== 0 && s !== last) n++; last = s; }
  }
  return n;
}
function paceSpread(splits) {
  const p = (Array.isArray(splits) ? splits : []).filter((x) => x && x.pace_sec_km && x.km >= 0.8).map((x) => x.pace_sec_km);
  if (p.length < 3) return null;
  const m = p.reduce((a, b) => a + b, 0) / p.length;
  return Math.sqrt(p.reduce((a, b) => a + (b - m) ** 2, 0) / p.length) / m;
}
function zoneShares(run, zones) {
  if (run.zoneSecs) {
    const tot = Object.values(run.zoneSecs).reduce((s, v) => s + (Number(v) || 0), 0);
    if (tot > 0) { const f = (z) => (Number(run.zoneSecs[z]) || 0) / tot; return { hard: f('Z4') + f('Z5'), mid: f('Z3') + f('Z4'), known: true }; }
  }
  if (run.hr && zones) { const z = RS.zoneOf(run.hr, zones); return { hard: z === 'Z4' || z === 'Z5' ? 1 : 0, mid: z === 'Z3' || z === 'Z4' ? 1 : 0, known: false }; }
  return null;
}

// Foreslå faktisk type. run: { name, workoutType, km, sec, hr, elev, zoneSecs, splits }. ctx: { zones, weekKm }
// Returnerer { type, source, reason } – source: navn | strava | omgange | pulszoner | længde | stigning | standard
export function suggestType(run, ctx = {}) {
  const { zones = null, weekKm = 0, weekRuns = 3 } = ctx;
  const nm = typeFromName(run.name);
  if (nm) return { type: nm.type, source: 'navn', reason: `Navnet siger "${nm.hit}"` };
  if (run.workoutType && STRAVA_TYPE[run.workoutType]) return { type: STRAVA_TYPE[run.workoutType], source: 'strava', reason: `Strava markerer den som ${typeLabel(STRAVA_TYPE[run.workoutType]).toLowerCase()}` };
  const km = run.km || 0, sec = run.sec || 0;
  if (sec >= 90 * 60) return { type: 'long', source: 'længde', reason: `Over 90 minutter (${Math.round(sec / 60)} min)` };
  const sh0 = zoneShares(run, zones);
  // Over 40 % af ugens km (mindst tre ture i ugen, og ikke en hård tur) → langtur
  if (weekRuns >= 3 && weekKm > 0 && km >= 8 && km / weekKm > 0.4 && !(sh0 && sh0.hard >= 0.15)) return { type: 'long', source: 'længde', reason: `${Math.round((km / weekKm) * 100)} % af ugens km` };
  const sh = zoneShares(run, zones);
  const sw = intervalSwitches(run.splits);
  if (sw >= 4) return { type: 'intervals', source: 'omgange', reason: `${sw} skift mellem hurtigt og roligt i omgangene` };
  if (km > 0 && run.elev && run.elev / km >= 25 && km <= 14) return { type: 'hills', source: 'stigning', reason: `${Math.round(run.elev / km)} højdemeter pr. km` };
  if (sh && sh.hard >= 0.15) {
    const spread = paceSpread(run.splits);
    if (sh.mid >= 0.6 && spread != null && spread < 0.07) return { type: 'tempo', source: 'pulszoner', reason: `${Math.round(sh.mid * 100)} % af tiden i Z3–Z4 med jævnt tempo` };
    return { type: 'intervals', source: 'pulszoner', reason: `${Math.round(sh.hard * 100)} % af tiden i Z4–Z5` };
  }
  return { type: 'easy', source: 'standard', reason: sh ? 'Mest i de rolige zoner' : 'Ingen tegn på kvalitet' };
}

// Planlagt mod faktisk: { planned, actual, deviates, text } – afvigelse = hård ↔ rolig, eller langtur ↔ rolig
export function compareTypes(planned, actual) {
  if (!planned || !actual || planned === actual || planned === 'race' || actual === 'race') return { planned, actual, deviates: false, text: '' };
  const deviates = (isHardType(planned) && actual === 'easy') || ((planned === 'easy' || planned === 'long') && isHardType(actual))
    || (planned === 'long' && actual === 'easy') || (planned === 'easy' && actual === 'long');
  return { planned, actual, deviates, text: deviates ? `planlagt ${typeLabel(planned).toLowerCase()}, løbet som ${typeLabel(actual).toLowerCase()}` : '' };
}
