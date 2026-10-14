// Dagens citat: vælger ét citat pr. dag fra data/quotes.json + egne citater.
// Tags i citaterne styrer, hvilke dage et citat kan vises.
import * as P from './plan.js';

export const TAGS = [
  ['general', 'Generelt'], ['morning', 'Morgen'], ['easy', 'Rolig tur'], ['quality', 'Kvalitet'], ['long', 'Langtur'],
  ['lower', 'Bendag'], ['upper', 'Overkrop'], ['rest', 'Hviledag'], ['deload', 'Deload'], ['missed', 'Sprunget over'],
  ['milestone', 'Milepæl'], ['race_week_half', 'Løbsuge (Half)'], ['race_week_marathon', 'Løbsuge (Marathon)'], ['race_day', 'Løbsdag'],
];
export const TAG_LABEL = Object.fromEntries(TAGS);

// Stabilt id til indbyggede citater (de har intet id i quotes.json)
export function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const quoteId = (q) => q.id || `q-${hash(q.text).toString(36)}`;

// Dagens tags i prioriteret rækkefølge (vigtigst først).
// ctx: { date, entries, week, races, missedYesterday, milestone, hour }
export function dayTags(ctx) {
  const { date, entries, week, races, hour } = ctx;
  const groups = [];
  const items = entries.map((e) => e.item);

  if (races.some((r) => r.date === date)) groups.push(['race_day']);
  const upcoming = races.find((r) => { const d = P.daysBetween(date, r.date); return d > 0 && d <= 7; });
  if (upcoming) groups.push([/transgrancanaria|half/i.test(upcoming.name) ? 'race_week_half' : 'race_week_marathon']);
  if (ctx.missedYesterday) groups.push(['missed']);
  if (ctx.milestone) groups.push(['milestone']);
  if (week && week.deload) groups.push(['deload']);

  // Dagens pas (Upper, Bryst & ryg og Skulder & arm tæller som upper)
  const session = new Set();
  for (const it of items) {
    if (it.kind === 'strength') session.add(P.isLower(it) ? 'lower' : 'upper');
    if (it.kind === 'run' && ['long', 'quality', 'easy'].includes(it.type)) session.add(it.type);
    if (it.kind === 'rest') session.add('rest');
  }
  if (!items.length) session.add('rest');
  if (hour < 10 && items.some((it) => it.kind !== 'rest')) session.add('morning');
  groups.push([...session]);
  groups.push(['general']);
  return groups;
}

// Vælg dagens citat deterministisk ud fra datoen. Favoritter vægtes 3× (vises oftere).
export function pickQuote(quotes, ctx, favorites = new Set()) {
  if (!quotes || !quotes.length) return null;
  for (const tags of dayTags(ctx)) {
    const pool = quotes.filter((q) => (q.tags || []).some((t) => tags.includes(t)));
    if (!pool.length) continue;
    const weighted = pool.flatMap((q) => (favorites.has(quoteId(q)) ? [q, q, q] : [q]));
    const q = weighted[hash(ctx.date + tags.join()) % weighted.length];
    return { ...q, id: quoteId(q), reason: q.tags.find((t) => tags.includes(t)) };
  }
  const q = quotes[hash(ctx.date) % quotes.length];
  return { ...q, id: quoteId(q), reason: 'general' };
}

// Cirka hver 4. dag vises en linje fra Mål-fanen i stedet (kun på "almindelige" dage)
export function isGoalDay(date) { return hash(`goal-${date}`) % 4 === 0; }
