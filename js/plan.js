// Planlogik: læser plan.json/config.json og lægger brugerens flytninger ovenpå.
// Samme regler som scripts/plan_common.py – ret begge steder, hvis noget ændres.

export const RUN_LABELS = { easy: 'Rolig', quality: 'Kvalitet', long: 'Langtur', hills: 'Bakke', race: 'Race' };
// Kun rigtige intervalpas hedder "Kvalitet"; en rolig tur med strides på kvalitetsdagen (deload) hedder "Rolig + strides"
export const runName = (it) => (it.strides_day ? 'Rolig + strides' : RUN_LABELS[it.type] || 'Løb');
const HARD = new Set(['quality', 'long', 'race']); // hills (power hike i Z2) tæller ikke som hårdt
const ZONE_RPE = {
  Z1: 'RPE 2', 'Z1-2': 'RPE 2-3', Z2: 'RPE 3-4', Z3: 'RPE 5-6',
  Z4: 'RPE 7', Z5: 'RPE 8-9', MP: 'RPE 6', Race: 'Race-indsats',
};

// ---------- Datoer (alt som 'YYYY-MM-DD' i lokal tid) ----------
export function iso(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
export function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
export function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 864e5); }
// "I dag" følger tidszonen i config.json (timezone_from), ikke enhedens – så et pas ikke skifter dag midt på natten, når du rejser.
let TZ = { list: [], fallback: null };
export function setTimezones(list, fallback) { TZ = { list: Array.isArray(list) ? [...list].sort((a, b) => (a.from < b.from ? -1 : 1)) : [], fallback: fallback || null }; }
const dateIn = (tz, now) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); } catch { return null; }
};
export function todayISO(now = new Date()) {
  let best = null;
  for (const e of TZ.list) { const d = dateIn(e.timezone, now); if (d && e.from <= d) best = d; }
  return best || (TZ.fallback && dateIn(TZ.fallback, now)) || iso(now);
}

const fmtLong = new Intl.DateTimeFormat('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('da-DK', { day: 'numeric', month: 'short' });
const fmtWd = new Intl.DateTimeFormat('da-DK', { weekday: 'short' });
export const fmtDateLong = (s) => cap(fmtLong.format(parseISO(s)));
export const fmtDateShort = (s) => fmtShort.format(parseISO(s));
export const fmtWeekday = (s) => cap(fmtWd.format(parseISO(s)).replace('.', ''));
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ---------- Racedatoer styres af goals[].date ----------
function nearestGoal(plan, date) {
  const goals = (plan.goals || []).filter((g) => g.date);
  if (!goals.length) return null;
  return goals.reduce((best, g) =>
    Math.abs(daysBetween(g.date, date)) < Math.abs(daysBetween(best.date, date)) ? g : best);
}
export function raceGoal(plan, date) { return nearestGoal(plan, date); }
export function raceShortName(name) {
  return name.split('(')[0].replace('The North Face', '').replace('–', ' ').replace('RACE:', '')
    .replace('Copenhagen', 'CPH').replace(/\s+/g, ' ').trim();
}

// ---------- Skema ----------
// Hvert pas får en stabil nøgle ud fra den oprindelige dato og plads i plan.json.
// overrides: { [key]: { to_date } }
export function buildSchedule(plan, overrides = {}) {
  const entries = [];
  for (const week of plan.weeks) {
    for (const day of week.days) {
      day.items.forEach((item, idx) => {
        const key = item.custom_id ? `c:${item.custom_id}` : `${day.date}-${idx}`; // egne pas har en fast nøgle
        let date = day.date;
        if (item.kind === 'run' && item.type === 'race' && !item.custom_id) {
          const g = nearestGoal(plan, day.date);
          if (g) date = g.date;
        }
        const ov = overrides[key];
        const moved = !!(ov && !ov.deleted && ov.to_date && ov.to_date !== date);
        if (moved) date = ov.to_date;
        entries.push({ key, origDate: day.date, idx, date, item, moved });
      });
    }
  }
  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.origDate < b.origDate ? -1 : a.idx - b.idx));
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  return { entries, byDate };
}

export function weekFor(plan, date) {
  for (const w of plan.weeks) {
    const d = daysBetween(w.start, date);
    if (d >= 0 && d < 7) return w;
  }
  return null;
}

export function weekDates(start) { return Array.from({ length: 7 }, (_, i) => addDays(start, i)); }

// Benpas: styrkepas med benmuskler, eller et "andet" pas med hård benbelastning
export function isLower(item) { return (item.kind === 'strength' && (item.leg === true || /lower/i.test(item.session || ''))) || (item.kind === 'other' && item.legs === 'hard'); }

// ---------- Prioritet, når ugen bliver presset ----------
// 1. langtur · 2. kvalitet · 3. Lower · 4. Upper (man) · 5. rolige ture · 6. Upper (fre). Det laveste fjernes først.
export const PRIORITY_NAMES = ['langtur', 'kvalitetspas', 'Lower', 'Upper (man)', 'rolige ture', 'Upper (fre)'];
export const PRIORITY_TEXT = 'langtur → kvalitet → Lower → Upper (man) → rolige ture → Upper (fre)';
export function priorityOf(it) {
  if (it.kind === 'run') return it.type === 'long' || it.type === 'race' ? 1 : it.type === 'quality' ? 2 : 5;
  if (it.kind === 'strength') return isLower(it) ? 3 : it.light ? 7 : /fredag|\(fre\)/i.test(it.session || '') ? 6 : 4;
  if (it.kind === 'other') return it.legs === 'hard' ? 3 : 5;
  return 7;
}
export const priorityLabel = (it) => { const n = priorityOf(it); return n <= 6 ? `prioritet ${n} af 6 (${PRIORITY_NAMES[n - 1]})` : ''; };

// ---------- Regeltjek ----------
// De seks hybrid-regler (Mere → Hybrid-regler). Kun regel 2 har en indstilling: må Lower ligge samme dag som kvalitetspasset (om eftermiddagen, mindst 6 timer efter løbet)?
//  1. Intet kvalitetspas eller langtur inden for 48 timer efter Lower (72 timer før langtur foretrækkes).
//  2. Lower ligger dagen efter kvalitetspasset (eller samme dag om eftermiddagen) – aldrig 1–2 dage før kvalitet eller langtur.
//  3. En kort rolig tur på Lower-dagen er valgfri.
//  4. Ca. 80 % af løbet i Z1–Z2 (vises i Statistik).
//  5. Kvalitetspas og langtur fjernes eller nedgraderes aldrig for at få km til at passe – rolige ture justeres først.
//  6. Prioritet i pressede uger: langtur → kvalitet → Lower → Upper (man) → rolige ture → Upper (fre).
export const DEFAULT_RULES = { lowerSameDay: false };
export function normalizeRules(v) {
  return { ...DEFAULT_RULES, lowerSameDay: !!(v && v.lowerSameDay) };
}
let RULES = normalizeRules(null);
export function setRules(v) { RULES = normalizeRules(v); }
export const getRules = () => RULES;
const mondayIso = (d) => addDays(d, -((parseISO(d).getDay() + 6) % 7));

export function checkRules(schedule, rules = RULES) {
  const out = [];
  const items = (d) => (schedule.byDate.get(d) || []).map((e) => e.item);
  const runs = (d) => items(d).filter((i) => i.kind === 'run' && !i.optional);
  const hardRun = (d) => runs(d).some((r) => r.type === 'quality' || r.type === 'long');
  const dates = [...schedule.byDate.keys()].sort();
  const weekHasQuality = (d) => { const m = mondayIso(d); for (let i = 0; i < 7; i++) if (runs(addDays(m, i)).some((r) => r.type === 'quality')) return true; return false; };
  for (const d of dates) {
    if (!items(d).some(isLower)) continue;
    // 1 + 2: aldrig kvalitet eller langtur 1–2 dage efter Lower (under 48 timer)
    const d1 = addDays(d, 1);
    if (hardRun(d1)) out.push({ date: d1, text: `Kvalitetspas eller langtur under 48 timer efter Lower (${fmtDateShort(d1)})` });
    const d2 = addDays(d, 2);
    if (hardRun(d2)) out.push({ date: d2, text: `Lower ligger kun to dage før kvalitetspas eller langtur (${fmtDateShort(d)} → ${fmtDateShort(d2)}) – Lower hører til dagen efter kvalitetspasset` });
    // 2: Lower dagen efter kvalitetspasset (eller samme dag om eftermiddagen, hvis det er slået til)
    if (hardRun(d) && !rules.lowerSameDay) out.push({ date: d, text: `Lower og kvalitetspas/langtur samme dag (${fmtDateShort(d)}) – slå "samme dag om eftermiddagen" til, eller flyt Lower til dagen efter` });
    if (weekHasQuality(d) && !runs(addDays(d, -1)).some((r) => r.type === 'quality') && !(rules.lowerSameDay && runs(d).some((r) => r.type === 'quality')) && !runs(d).some((r) => r.type === 'long'))
      out.push({ date: d, text: `Lower bør ligge dagen efter kvalitetspasset (${fmtDateShort(d)})` });
  }
  return out;
}

// Regelbrud, som en flytning ville skabe (dem der ikke allerede findes)
export function moveWarnings(plan, overrides, key, toDate) {
  const before = new Set(checkRules(buildSchedule(plan, overrides)).map((v) => v.text));
  const after = checkRules(buildSchedule(plan, { ...overrides, [key]: { to_date: toDate } }));
  return after.filter((v) => !before.has(v.text)).map((v) => v.text);
}

// ---------- Puls og tempo ----------
export function parseDuration(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return s;
  const parts = String(s).trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
export function fmtPace(sec) {
  if (!sec || !isFinite(sec)) return '–';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtDuration(sec) {
  if (!sec) return '–';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function hrZones(config) {
  const z = config.hr_zones;
  if (z) {
    if (Array.isArray(z)) return Object.fromEntries(z.map((v, i) => [`Z${i + 1}`, v]));
    return z;
  }
  if (config.max_hr) {
    const bands = [[50, 60], [60, 70], [70, 80], [80, 90], [90, 100]];
    return Object.fromEntries(bands.map(([lo, hi], i) =>
      [`Z${i + 1}`, [Math.round(config.max_hr * lo / 100), Math.round(config.max_hr * hi / 100)]]));
  }
  return null;
}

export function paces(config) {
  const p = config.paces;
  if (p) {
    const out = {};
    if (p.mp) out.mp = parseDuration(p.mp);
    if (p.threshold) out.threshold = parseDuration(p.threshold);
    if (p.easy) { const e = String(p.easy).split('-'); out.easy = [parseDuration(e[0]), parseDuration(e[e.length - 1])]; }
    return Object.keys(out).length ? out : null;
  }
  const goal = parseDuration(config.marathon_goal_time);
  if (goal) { const mp = goal / 42.195; return { mp, threshold: mp - 20, easy: [mp + 60, mp + 75] }; }
  return null;
}

// Kort tekst til en zone: puls/tempo hvis config har tal, ellers RPE
export function zoneText(zone, config) {
  if (!zone) return '';
  const parts = [zone];
  const zones = hrZones(config), pc = paces(config);
  if (zones) {
    if (zone === 'Z1-2' && zones.Z1 && zones.Z2) parts.push(`${zones.Z1[0]}–${zones.Z2[1]} bpm`);
    else if (zones[zone]) parts.push(`${zones[zone][0]}–${zones[zone][1]} bpm`);
  }
  if (pc) {
    if (zone === 'MP' && pc.mp) parts.push(`MP ${fmtPace(pc.mp)}/km`);
    else if (zone === 'Z4' && pc.threshold) parts.push(`tærskel ~${fmtPace(pc.threshold)}/km`);
    else if (['Z1', 'Z1-2', 'Z2'].includes(zone) && pc.easy) parts.push(`rolig ${fmtPace(pc.easy[0])}–${fmtPace(pc.easy[1])}/km`);
  }
  if (parts.length === 1 && ZONE_RPE[zone]) parts.push(ZONE_RPE[zone]);
  return parts.join(' · ');
}

// ---------- Visningstekster ----------
export function itemTitle(plan, entry) {
  const it = entry.item;
  if (it.kind === 'strength') return it.session;
  if (it.kind === 'rest') return 'Hvile';
  if (it.kind === 'other' || ((it.own || it.rp) && it.title)) return it.title;
  if (it.type === 'race') {
    const g = raceGoal(plan, entry.date);
    return raceShortName(g ? g.name : it.description);
  }
  if (it.test === '5k') return '5 km-test';
  return `${runName(it)} ${fmtKm(it.km)} km${it.optional ? ' (valgfri)' : ''}`;
}
export function itemColor(item) {
  if (item.kind === 'strength') return 'strength';
  if (item.kind === 'rest') return 'rest';
  if (item.kind === 'other') return 'other';
  return item.type === 'race' ? 'race' : 'run';
}
export function fmtKm(km) {
  if (km == null || km === '') return '–';
  return Number(km).toLocaleString('da-DK', { maximumFractionDigits: 1 });
}

// ---------- Løbetyper (forklaringer i run_types.json) ----------
// Hvilke løbetyper et pas består af – vigtigste først. Bruges til at linke pas til forklaringen.
export function runTypeIds(item) {
  if (!item || item.kind !== 'run') return [];
  const d = (item.description || '').toLowerCase();
  const ids = [];
  const add = (id) => { if (!ids.includes(id)) ids.push(id); };
  if (item.test) return ids; // test (fx 5 km-test) har sin egen forklaring i beskrivelsen
  if (item.type === 'race') add('race');
  else if (item.type === 'hills' || d.includes('power hike')) add('power_hike');
  else if (d.includes('shakeout')) add('shakeout');
  else if (item.type === 'long') add('langtur');
  else if (item.type === 'quality') {
    if (d.includes('fartlek')) add('fartlek');
    if (/tærskel|tempo/.test(d)) add('taerskel');
    if (/\bmp\b|marathonfart/.test(d)) add('marathonfart');
    if (/10k-fart|race-indsats/.test(d)) add('korte_intervaller');
    if (/bakke/.test(d)) add('bakkeintervaller');
    if (!ids.length) add('rolig'); // deload: "Rolig + strides"
  } else add('rolig');
  if (item.type === 'long' && /\bmp\b|marathonfart/.test(d)) add('marathonfart');
  if (d.includes('strides')) add('strides');
  return ids;
}

// Puls og tempo for en løbetype ud fra config.json (zone kan være "Z2", "Z3–Z4", "–", "Race")
export function runTypeTargets(type, config) {
  const zones = hrZones(config), pc = paces(config);
  const nums = (String(type.zone).match(/Z(\d)/g) || []).map((z) => Number(z.slice(1)));
  let hr = '';
  if (zones && nums.length) {
    const lo = zones[`Z${Math.min(...nums)}`], hi = zones[`Z${Math.max(...nums)}`];
    if (lo && hi) hr = `${lo[0]}–${hi[1]} bpm`;
  }
  let pace = '';
  if (pc) {
    if (['rolig', 'langtur', 'shakeout'].includes(type.id) && pc.easy) pace = `${fmtPace(pc.easy[0])}–${fmtPace(pc.easy[1])}/km`;
    if (type.id === 'taerskel' && pc.threshold) pace = `~${fmtPace(pc.threshold)}/km`;
    if (type.id === 'marathonfart' && pc.mp) pace = `${fmtPace(pc.mp)}/km`;
  }
  return { hr, pace };
}

// ---------- Styrke ----------
export function repTop(reps) {
  const nums = String(reps).match(/\d+/g);
  return nums ? Number(nums[nums.length - 1]) : null;
}
// +5 kg på squat og rumænsk dødløft, ellers +2,5 kg
// Progressionstrin fra øvelsesbiblioteket (exercises.json); ellers +5 kg på squat/RDL og +2,5 kg på resten
export function weightStep(exercise, library) {
  const info = library && library.get(exercise);
  if (info && info.step_kg) return info.step_kg;
  if (info && info.body === 'lower' && /squat|dødløft|benpres|hip thrust/i.test(exercise)) return 5;
  return /^(squat|rumænsk dødløft)/i.test(exercise) ? 5 : 2.5;
}

// Øvelserne i et styrkepas efter brugerens skift. Samme regler som effective_exercises() i plan_common.py:
// - 'future'-rækker gælder for samme session fra deres dato og frem (ældste først)
// - 'date'-rækker gælder kun det ene pas (item_key)
// - action 'swap' erstatter øvelsen med navnet 'original'; 'add' tilføjer en ny øvelse
export function effectiveExercises(entry, overrides) {
  const item = entry.item;
  const list = (item.exercises || []).map((e, i) => ({ ...e, slot: String(i), original: e.exercise }));
  const rows = (overrides || []).filter((r) => !r.deleted);
  const byTime = (a, b) => ((a.date || '') + (a.updated_at || '') < (b.date || '') + (b.updated_at || '') ? -1 : 1);
  const future = rows.filter((r) => r.scope === 'future' && r.session === item.session && (r.date || '') <= entry.date).sort(byTime);
  const today = rows.filter((r) => r.scope === 'date' && r.item_key === entry.key).sort(byTime);
  let order = null;
  for (const r of [...future, ...today]) {
    if (r.action === 'tune') { // sæt/reps/RIR ændret på en øvelse (original = pladsen i passet)
      const t = list.find((e) => e.slot === r.original);
      if (t) for (const k of ['sets', 'reps', 'rir']) if (r[k] != null && r[k] !== '') t[k] = r[k];
      continue;
    }
    if (r.action === 'order') { try { order = JSON.parse(r.exercise); } catch { /* ingen rækkefølge */ } continue; }
    const fresh = { exercise: r.exercise, sets: r.sets, reps: r.reps, rir: r.rir };
    if (r.action === 'add') {
      list.push({ ...fresh, sets: r.sets || 3, reps: r.reps || '8-12', rir: r.rir || '2', slot: `a-${r.id}`, original: null, added: true, override_id: r.id });
      continue;
    }
    const target = list.find((e) => e.exercise === r.original);
    if (!target) continue;
    target.swapped_from = target.swapped_from || target.exercise;
    target.exercise = r.exercise;
    for (const k of ['sets', 'reps', 'rir']) if (r[k] != null && r[k] !== '') target[k] = r[k];
    target.override_id = r.id;
  }
  if (Array.isArray(order)) { // rækkefølgen for dette pas (ukendte pladser lægges sidst)
    const pos = new Map(order.map((s, i) => [s, i]));
    const base = new Map(list.map((e, i) => [e.slot, i]));
    list.sort((a, b) => ((pos.has(a.slot) ? pos.get(a.slot) : 1000 + base.get(a.slot)) - (pos.has(b.slot) ? pos.get(b.slot) : 1000 + base.get(b.slot))));
  }
  return list;
}
export function epley(kg, reps) { return kg && reps ? kg * (1 + reps / 30) : 0; }

// Øvelserne der vises som 1RM-grafer (matcher starten af øvelsesnavnet i plan.json)
export const ORM_LIFTS = [
  // Præcise navne fra plan.json – skiftede øvelser (f.eks. "Bænkpres med håndvægte") får deres egen graf
  { label: 'Bænkpres', match: /^bænkpres$/i },
  { label: 'Squat', match: /^squat( \(eller hack squat\))?$/i },
  { label: 'Rumænsk dødløft', match: /^rumænsk dødløft$/i },
  { label: 'Skulderpres', match: /^stående skulderpres$/i },
];
