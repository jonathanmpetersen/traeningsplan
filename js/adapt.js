// Tilpasning af planen oven på plan.json (planfilen ændres aldrig):
//  - Syg/skadet: erstatter pas i en periode (fx kun roligt løb og RIR 3 efter sygdom)
//  - Rejse: hotel-pas (kropsvægt) og forslag til nye dage, når et pas ikke kan lade sig gøre
// Rene funktioner uden DOM.
import * as P from './plan.js';

export const HEALTH_KINDS = {
  fever: { label: 'Syg – feber eller symptomer under halsen', hint: 'Ingen træning, indtil du er feberfri og uden symptomer under halsen.' },
  easy: { label: 'Syg – på vej op igen', hint: 'Kun roligt løb (kortere) og RIR 3 i styrke. 1–2 uger efter sygdom.' },
  leg: { label: 'Skadet – ben', hint: 'Intet løb og intet benpas (Lower). Overkrop er okay.' },
  upper: { label: 'Skadet – overkrop', hint: 'Intet overkropspas. Løb og benpas er okay.' },
};

// Hotel-pas: kropsvægt, ca. 20–25 min (navnene findes i øvelsesbiblioteket, så de kan logges og tæller i statistikken)
export const HOTEL_EXERCISES = [
  { exercise: 'Armstrækninger', sets: 3, reps: '12-15', rir: '2-3' },
  { exercise: 'Split squat', sets: 3, reps: '10-12', rir: '2-3' },
  { exercise: 'Baglæns udfald', sets: 2, reps: '12', rir: '2-3' },
  { exercise: 'Dead bug', sets: 3, reps: '10', rir: '2-3' },
  { exercise: 'Planke', sets: 3, reps: '30-45', rir: '2' },
];

export const healthActive = (h, date) => !!(h && h.active && h.from && h.to && h.from <= date && date <= h.to);
const round1 = (v) => Math.round(v * 10) / 10;
const rest = (description, label, item) => ({ kind: 'rest', description, adapted: label, orig_kind: item.kind });

// → { item, adapted } eller null (uændret)
export function adaptHealth(item, health) {
  if (!health || item.kind === 'rest') return null;
  if (item.kind === 'run' && item.type === 'race') return null; // racet bestemmer du selv
  const lower = P.isLower(item);
  switch (health.kind) {
    case 'fever':
      return { item: rest('Hvile – feber eller symptomer under halsen: ingen træning, til du er helt rask.', 'Syg – hvile', item), adapted: 'Syg – hvile' };
    case 'easy':
      if (item.kind === 'run') {
        const hard = ['quality', 'long', 'hills'].includes(item.type);
        const km = hard ? (item.type === 'long' ? Math.min(round1(item.km * 0.6), 10) : Math.min(item.km, 6)) : Math.min(item.km, 8);
        const { elevation_m, test, ...keep } = item; // eslint-disable-line no-unused-vars
        return { item: { ...keep, type: 'easy', km, zone: 'Z2', description: `Rolig Z2 – let løb efter sygdom (planlagt: ${item.description || item.type})`, adapted: 'Tilpasset: sygdom' }, adapted: 'Tilpasset: sygdom' };
      }
      return { item: { ...item, exercises: (item.exercises || []).map((x) => ({ ...x, rir: '3' })), note: [item.note, 'Efter sygdom: hold RIR 3 – stop tidligt hellere end sent.'].filter(Boolean).join(' '), adapted: 'Tilpasset: sygdom' }, adapted: 'Tilpasset: sygdom' };
    case 'leg':
      if (item.kind === 'run' || lower) return { item: rest('Skadet ben: hvile (eller cykel/svøm, hvis det ikke gør ondt).', 'Skadet ben', item), adapted: 'Skadet ben' };
      return null;
    case 'upper':
      if (item.kind === 'strength' && !lower) return { item: rest('Skadet overkrop: hvile fra overkropspas. Løb og benpas kan fortsætte.', 'Skadet overkrop', item), adapted: 'Skadet overkrop' };
      return null;
    default:
      return null;
  }
}

export function hotelItem(item) {
  if (item.kind !== 'strength') return item;
  return { ...item, session: `${item.session} (hotel)`, exercises: HOTEL_EXERCISES.map((x) => ({ ...x })), note: 'Hotel-pas: kropsvægt, ca. 20–25 min. Planke i sekunder.', hotel: true, adapted: 'Hotel-pas' };
}

// Anvend tilpasninger på en plan: schedule = { entries, byDate } fra P.buildSchedule
export function applyAdaptations(schedule, { health, travel } = {}) {
  const hotel = (travel && travel.hotel) || {};
  const entries = schedule.entries.map((e) => {
    let item = e.item, adapted = null;
    if (healthActive(health, e.date)) {
      const r = adaptHealth(item, health);
      if (r) { item = r.item; adapted = r.adapted; }
    }
    if (item.kind === 'strength' && hotel[e.key]) { item = hotelItem(item); adapted = 'Hotel-pas'; }
    return item === e.item ? e : { ...e, item, adapted };
  });
  const byDate = new Map();
  for (const e of entries) { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); }
  return { entries, byDate };
}

// "Kan ikke i dag": de bedste nye dage inden for de næste dage – uden flyvedage og uden regelbrud
export function suggestMoves(plan, overrides, entry, today, travelDays = {}, { within = 7, max = 3, blockedWeekdays = [] } = {}) {
  const out = [];
  for (let i = 0; i <= within; i++) {
    const d = P.addDays(today, i);
    if (d === entry.date || travelDays[d] === 'fly' || travelDays[d] === 'off' || blockedWeekdays.includes(P.parseISO(d).getDay())) continue;
    const warnings = P.moveWarnings(plan, overrides, entry.key, d);
    out.push({ date: d, warnings, dist: Math.abs(P.daysBetween(entry.date, d)) + (d < entry.date ? 0.4 : 0) });
  }
  const clean = out.filter((o) => !o.warnings.length).sort((a, b) => a.dist - b.dist);
  return clean.slice(0, max);
}
