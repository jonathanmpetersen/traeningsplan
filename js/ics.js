// Kalenderfil (.ics) lavet i appen ud fra den nuværende plan – samme titler, tider og id'er som scripts/make_ics.py.
// Tider skrives i UTC (konverteret fra din tidszone), så filen virker uden en tidszone-definition.
import * as P from './plan.js';

const esc = (t) => String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export const utf8len = (ch) => { const c = ch.codePointAt(0); return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; };
// Fold ved 75 oktetter (UTF-8) uden at klippe et tegn over
function fold(line) {
  const out = []; let cur = '', size = 0;
  for (const ch of line) {
    const n = utf8len(ch), limit = out.length ? 74 : 75;
    if (size + n > limit) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
export function tzForDate(config, date) {
  let tz = config.timezone || 'Europe/Copenhagen';
  for (const e of [...(config.timezone_from || [])].sort((a, b) => (a.from < b.from ? -1 : 1))) if (e.from <= date) tz = e.timezone;
  return tz;
}
function offsetMin(utcMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs) / 60000;
}
export function localToUtc(date, hhmm, tz) {
  const [y, m, d] = date.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let off = offsetMin(guess, tz);
  off = offsetMin(guess - off * 60000, tz);
  return guess - off * 60000;
}
const stamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const hillsMinutes = (d) => { const m = [...(d || '').matchAll(/(\d+)\s*min/g)].map((x) => Number(x[1])); return m.length ? m.reduce((a, b) => a + b, 0) : 60; };
const raceKey = (name) => { const n = name.toLowerCase(); return n.includes('transgrancanaria') ? 'transgrancanaria' : n.includes('copenhagen') || n.includes('cph') ? 'cph_marathon' : 'long_run'; };
const g = (n) => String(Number(n.toFixed(1)));

// → { title, start:'HH:MM', minutes, desc } eller null for hvile
export function eventInfo(e, { plan, config, exercisesOf }) {
  const it = e.item, times = config.default_times || {};
  if (it.kind === 'other') {
    const d = [it.description || '', `RPE ${it.rpe}`, it.hr ? `Puls ${it.hr}` : '', it.legs ? `Benbelastning: ${({ light: 'let', moderate: 'moderat', hard: 'hård' })[it.legs]}` : ''].filter(Boolean);
    return { title: `${it.emoji || '🏃'} ${it.title}`, start: it.time || times.strength || '17:00', minutes: it.minutes || 45, desc: d.join('\n') };
  }
  if (it.kind === 'strength') {
    const lines = exercisesOf(e).map((x) => `${x.exercise}: ${x.sets} × ${x.reps} (RIR ${x.rir || '–'})${x.swapped_from ? `  (i stedet for ${x.swapped_from})` : x.added ? '  (ekstra)' : ''}`);
    if (it.note) lines.push('', it.note);
    return { title: `🏋️ ${it.session}`, start: it.time || times.strength || '17:00', minutes: 75, desc: lines.join('\n') };
  }
  if (it.kind !== 'run') return null;
  const km = it.km || 0, elev = it.elevation_m, hm = elev ? ` · ↑${elev} hm` : '';
  const desc = [it.description || ''];
  const zt = P.zoneText(it.zone, config);
  if (zt) desc.push(`Zone: ${zt}`);
  if (elev) desc.push(`Højdemeter: ≈${elev} m op`);
  const d = desc.join('\n');
  if ((it.own || it.rp) && it.type !== 'race') return { title: `🏃 ${it.title}${hm}`, start: it.time || times.run_weekday || '07:00', minutes: it.minutes || (it.type === 'long' ? Math.round(km * 6.5) : it.type === 'quality' ? 60 : 45), desc: d };
  if (it.type === 'race') {
    const goal = P.raceGoal(plan, e.date), name = goal ? goal.name : it.description || 'Race';
    return { title: `🏁 ${P.raceShortName(name)}${hm}`, start: times[raceKey(name)] || times.long_run || '09:00', minutes: Math.round(km * 6.5), desc: d };
  }
  if (it.type === 'long') return { title: `🏃 Langtur ${g(km)} km${hm}`, start: times.long_run || '09:00', minutes: Math.round(km * 6.5), desc: d };
  if (it.type === 'hills') return { title: `⛰️ Bakke ${g(km)} km${hm}`, start: times.run_weekday || '07:00', minutes: hillsMinutes(it.description), desc: d };
  if (it.test === '5k') return { title: `⏱️ 5 km-test (${g(km)} km)`, start: times.run_weekday || '07:00', minutes: 60, desc: d };
  return { title: `🏃 ${P.runName(it)} ${g(km)} km${it.optional ? ' (valgfri)' : ''}${hm}`, start: times.run_weekday || '07:00', minutes: it.type === 'quality' ? 60 : 45, desc: d };
}

// opts: { plan, entries, config, exercisesOf(entry), from?, now? }
export function buildICS(opts) {
  const { plan, entries, config, from } = opts;
  const now = opts.now || Date.now();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Traeningsplan//DA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Træningsplan'];
  let n = 0;
  for (const e of entries) {
    if (from && e.date < from) continue;
    const info = eventInfo(e, opts);
    if (!info) continue;
    const tz = tzForDate(config, e.date);
    const start = localToUtc(e.date, info.start, tz), end = start + info.minutes * 60000;
    const w = P.weekFor(plan, e.date);
    const desc = `${info.desc}\n\nUge ${w ? w.week : ''} · ${w ? w.phase : ''}${w && w.deload ? ' · Deload' : ''}`;
    lines.push('BEGIN:VEVENT', `UID:${e.item.custom_id ? `c-${e.item.custom_id}` : `${e.origDate}-${e.idx}`}@traeningsplan`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(info.title)}`, `DESCRIPTION:${esc(desc)}`, 'END:VEVENT');
    n++;
  }
  lines.push('END:VCALENDAR');
  return { text: lines.map((l) => `${fold(l)}\r\n`).join(''), count: n };
}
