// Løbebånd: anbefalet hastighed (km/t) pr. trin ud fra tempointervaller (sek/km, se pacemodel.js). Rene funktioner uden DOM (testes i test_logic.mjs).

const r1 = (v) => Math.round(v * 10) / 10;
export const kmh = (secPerKm) => 3600 / secPerKm; // 6:30/km = 390 s → 9,2 km/t

// Hastighedsinterval { lo, hi } i km/t ud fra et tempointerval [hurtigste, langsomste] i sek/km (afrundet til 0,1)
export const rangeFromPaces = (fastSec, slowSec) => ({ lo: r1(kmh(Math.max(fastSec, slowSec))), hi: r1(kmh(Math.min(fastSec, slowSec))) });
export const fmtKmh1 = (v) => r1(v).toLocaleString('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtRange = (r) => (!r ? '' : r.lo === r.hi ? `${fmtKmh1(r.lo)} km/t` : `${fmtKmh1(r.lo)}–${fmtKmh1(r.hi)} km/t`);

// Jog (pause mellem intervaller) uden eget tempo: rolig hastighed − 1,0 til 1,5 km/t (afrundet til 0,1), aldrig under gangfart
export function jogRange(easy) {
  if (!easy) return null;
  const mid = (easy.lo + easy.hi) / 2;
  return { lo: Math.max(5, r1(mid - 1.5)), hi: Math.max(5.5, r1(mid - 1.0)) };
}
export const WALK = { lo: 5, hi: 6 };         // gå mellem gentagelser
export const POWER_HIKE = { lo: 5, hi: 6.5 }; // power hike ved 12–15 %

// Over 4 % stigning sænkes hastigheden ca. 0,5 km/t pr. 2 % (så indsatsen svarer til zonen). incl = [lo, hi] i %
export function slopeAdjust(range, incl) {
  if (!range || !incl) return range;
  const cut = (p) => (Math.max(0, p - 4) / 2) * 0.5;
  return { lo: r1(Math.max(4, range.lo - cut(incl[1]))), hi: r1(Math.max(4.5, range.hi - cut(incl[0]))) };
}

// Tempointervaller { easy, mp, tempo, intervals, short, jog } (sek/km) → hastigheder. source: 'test' | 'estimate' | 'default'
export function speedSet(ranges, source = 'estimate') {
  if (!ranges) return null;
  const out = { source, estimated: source !== 'test' };
  for (const k of ['easy', 'mp', 'tempo', 'intervals', 'short', 'jog']) out[k] = ranges[k] ? rangeFromPaces(ranges[k][0], ranges[k][1]) : null;
  if (!out.easy && !out.tempo && !out.mp) return null;
  return out;
}

// Hastighed for ét trin. role: warm | cool | run | mp | fast | rest. key: typeKey. incl: [lo, hi] stigning i %. restText: teksten på pausen.
// opts.short: korte intervaller (≤ 2 min eller < 1 km) bruger det hurtigere tempo.
// Returnerer { range, text, estimated, kind } – kind: 'walk' | 'jog' | 'easy' | 'run' | 'hike'
export function stepSpeed(set, key, role, incl, restText = '', opts = {}) {
  const est = !!set && set.estimated;
  const wrap = (range, kind) => (range ? { range, text: fmtRange(range), estimated: est, kind } : null);
  if (key === 'powerhike') return role === 'warm' || role === 'cool' ? (set && set.easy ? wrap(set.easy, 'easy') : null) : { range: POWER_HIKE, text: 'gå ca. 5–6,5 km/t', estimated: false, kind: 'hike' };
  if (role === 'rest') {
    const t = String(restText).toLowerCase(), jog = /jog/.test(t), walk = /gang|gå/.test(t);
    const jr = set ? set.jog || (set.easy ? jogRange(set.easy) : null) : null;
    const walkTxt = `${fmtKmh1(WALK.lo)}–${fmtKmh1(WALK.hi)} km/t`;
    if (jog && walk) return { range: WALK, text: `gå ${walkTxt}${jr ? ` eller jog ${fmtRange(jr)}` : ''}`, estimated: est && !!jr, kind: 'walk' };
    if (jog) return wrap(jr, 'jog');
    if (walk) return { range: WALK, text: `gå ${walkTxt}`, estimated: false, kind: 'walk' };
    return set && set.easy ? wrap(set.easy, 'easy') : null; // "1 min roligt" = rolig fart
  }
  if (!set) return null;
  if (role === 'fast' && (key === 'easy' || key === 'long')) return null; // strides: hurtigt men afslappet – ingen fast fart
  if (role === 'warm' || role === 'cool' || key === 'easy' || key === 'long') return wrap(set.easy, 'easy');
  if (role === 'mp') return wrap(set.mp, 'run');
  let base = null;
  if (key === 'tempo') base = set.tempo;
  else if (key === 'intervals' || key === 'race') base = opts.short && set.short ? set.short : set.intervals;
  else if (key === 'hills') base = set.intervals;
  else if (key === 'mp') base = set.mp;
  return wrap(slopeAdjust(base, incl), 'run');
}
