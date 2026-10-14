// Statistik → Løb: zonefordeling, tempo ved samme puls, langtur-progression, prognose og sko-kilometer.
// Logik (rene funktioner) øverst, visninger nederst.
import * as P from './plan.js';
import { icon } from './icons.js';
import * as X from './stats.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('da-DK', { maximumFractionDigits: d }));
export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

// ---------- Logik ----------
// Alle løbeture som én liste: din egen log vinder over Garmin for samme dato
export function runsList(manual, garmin) {
  const manualDates = new Set(manual.map((r) => r.date));
  // 5 km-testens tid står i noten ("5 km-test: 22:30")
  const testOf = (r) => { const m = /5 km-test:\s*([\d:]+)/.exec(r.note || ''); return num(r.test_time_sec) || (m ? P.parseDuration(m[1]) : null); };
  const out = manual.map((r) => ({ id: r.id, date: r.date, km: num(r.km), sec: num(r.time_sec), hr: num(r.hr), elev: num(r.elev), key: r.item_key || null, test: testOf(r), zoneSecs: null, src: 'manual' }));
  for (const a of garmin) {
    if (manualDates.has(a.date)) continue;
    out.push({ id: a.id, date: a.date, km: num(a.km), sec: num(a.duration_sec), hr: num(a.avg_hr), elev: num(a.elev_gain), key: a.planned_key || null, test: null, zoneSecs: a.hr_zone_secs || null, src: 'garmin' });
  }
  return out.filter((r) => r.km > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
}
export function zoneOf(hr, zones) {
  if (hr == null || !zones) return null;
  const names = Object.keys(zones).sort();
  return names.find((n) => hr <= zones[n][1]) || names[names.length - 1];
}
// Sekunder i hver zone for en tur: Garmins tal, ellers et estimat ud fra gennemsnitspulsen
export function zoneSecsFor(run, zones) {
  if (run.zoneSecs && Object.values(run.zoneSecs).some((v) => v > 0)) return { secs: run.zoneSecs, estimated: false };
  const z = zoneOf(run.hr, zones);
  return z && run.sec ? { secs: { [z]: run.sec }, estimated: true } : null;
}
export function zoneWeeks(runs, zones, from, today) {
  const weeks = X.weekStarts(from, today).map((start) => ({ start, secs: { Z1: 0, Z2: 0, Z3: 0, Z4: 0, Z5: 0 }, total: 0, est: 0 }));
  const idx = new Map(weeks.map((w, i) => [w.start, i]));
  for (const r of runs) {
    const i = idx.get(X.mondayOf(r.date));
    const zs = i != null && zoneSecsFor(r, zones);
    if (!zs) continue;
    for (const [z, v] of Object.entries(zs.secs)) { weeks[i].secs[z] = (weeks[i].secs[z] || 0) + v; weeks[i].total += v; if (zs.estimated) weeks[i].est += v; }
  }
  return weeks;
}
// Andel af tiden i Z1–Z2 (polariseret træning: omkring 80 %)
export function easyShare(weeks) {
  let easy = 0, total = 0;
  for (const w of weeks) { easy += (w.secs.Z1 || 0) + (w.secs.Z2 || 0); total += w.total; }
  return total ? easy / total : null;
}
// Tempo ved rolige pulsture (Z1–Z2): lavere tempo-tal ved samme puls = bedre form
export function easyPaceSeries(runs, zones) {
  if (!zones || !zones.Z1 || !zones.Z2) return [];
  const lo = zones.Z1[0], hi = zones.Z2[1];
  return runs.filter((r) => r.hr >= lo && r.hr <= hi && r.km >= 3 && r.sec > 0).map((r) => ({ date: r.date, v: r.sec / r.km, hr: r.hr, km: r.km }));
}
export function longRunSeries(runs, from, today) {
  const weeks = X.weekStarts(from, today).map((start) => ({ start, km: 0 }));
  const idx = new Map(weeks.map((w, i) => [w.start, i]));
  for (const r of runs) { const i = idx.get(X.mondayOf(r.date)); if (i != null) weeks[i].km = Math.max(weeks[i].km, r.km); }
  return weeks;
}
// Riegel: T2 = T1 × (D2/D1)^1,06
export function riegel(sec, km, toKm) { return sec * (toKm / km) ** 1.06; }
export function predictions(runs) {
  const t = [...runs].filter((r) => r.test > 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!t) return null;
  return { date: t.date, from: t.test, items: [['10 km', 10], ['Halvmarathon', 21.0975], ['Marathon', 42.195]].map(([n, d]) => ({ name: n, sec: riegel(t.test, 5, d), safe: n === 'Marathon' ? riegel(t.test, 5, d) * 1.04 : null })) };
}

// ---------- Sko ----------
export const SHOE_MARATHON = [50, 150]; // km på skoene før et marathon
export function shoeKm(shoe, runs) {
  let km = Number(shoe.km0) || 0;
  for (const r of runs) if (r.date >= shoe.from && (!shoe.to || r.date <= shoe.to)) km += r.km;
  return km;
}
export function shoeStatus(km) {
  if (km < SHOE_MARATHON[0]) return { kind: 'new', text: `Indløb: ${fmt(SHOE_MARATHON[0] - km, 0)} km til de er klar til løbsdag` };
  if (km <= SHOE_MARATHON[1]) return { kind: 'ok', text: 'Klar til løbsdag (50–150 km)' };
  if (km <= 700) return { kind: 'used', text: 'Indløbet – godt til almindelige ture' };
  return { kind: 'worn', text: 'Tæt på udtjent – overvej nye' };
}

// ---------- Visninger ----------
const hhmmss = (sec) => P.fmtDuration(Math.round(sec));
export const RUN_SECTIONS = [['overview', 'Oversigt'], ['zones', 'Zoner'], ['pace', 'Tempo'], ['shoes', 'Sko']];
const Z_COL = { Z1: '#8E8E93', Z2: '#30D158', Z3: '#FFD60A', Z4: '#FF9F0A', Z5: '#FF453A' };

function stackedChart(weeks) {
  const W = 340, H = 170, pl = 34, pb = 20, pt = 8;
  const maxMin = Math.max(30, ...weeks.map((w) => w.total / 60));
  const top = Math.ceil(maxMin / 60) * 60;
  const slot = (W - pl) / weeks.length, y = (m) => pt + (H - pt - pb) * (1 - m / top);
  const every = weeks.length > 40 ? 8 : weeks.length > 20 ? 4 : weeks.length > 8 ? 2 : 1;
  let svg = '';
  for (const v of [0, top / 2, top]) svg += `<line class="grid" x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v / 60, 1)} t</text>`;
  weeks.forEach((w, i) => {
    const bw = Math.max(2, slot * 0.7), x = pl + i * slot + (slot - bw) / 2;
    let acc = 0;
    for (const z of ['Z1', 'Z2', 'Z3', 'Z4', 'Z5']) {
      const m = (w.secs[z] || 0) / 60; if (!m) continue;
      svg += `<rect x="${x}" y="${y(acc + m)}" width="${bw}" height="${y(acc) - y(acc + m)}" fill="${Z_COL[z]}"><title>${z}: ${fmt(m, 0)} min</title></rect>`; acc += m;
    }
    if (i % every === 0 || i === weeks.length - 1) svg += `<text x="${pl + i * slot + slot / 2}" y="${H - 5}" text-anchor="middle">${P.fmtDateShort(w.start).replace('. ', '.').replace(/\.$/, '')}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tid i pulszoner pr. uge">${svg}</svg>
    <div class="legend">${Object.entries(Z_COL).map(([z, c]) => `<span><i style="background:${c}"></i>${z}</span>`).join('')}</div>`;
}

export function zonesHTML(c, st, periodBar) {
  const from = X.rangeFrom(st.statRange, c.today, c.runs[0] && c.runs[0].date);
  const wk = zoneWeeks(c.runs, c.zones, from, c.today);
  const share = easyShare(wk), est = wk.reduce((s, w) => s + w.est, 0), tot = wk.reduce((s, w) => s + w.total, 0);
  let h = periodBar;
  if (!c.zones) return h + `<div class="card empty">Zonerne mangler. Log ind, så hentes dine pulszoner fra din konto.</div>`;
  h += `<div class="card"><div class="chart-caption"><b>Tid i pulszoner pr. uge</b></div>${tot ? stackedChart(wk) : '<div class="meta">Ingen løb med pulsdata i perioden endnu.</div>'}</div>`;
  if (share != null) {
    h += `<div class="card" style="margin-top:12px"><div class="streak"><div class="streak-n" style="font-size:1.8rem">${fmt(share * 100, 0)} %</div><div><div class="title">af tiden i Z1–Z2</div>
      <div class="meta">${share >= 0.75 ? 'Flot fordeling – cirka 80 % roligt er målet.' : share >= 0.6 ? 'Lidt for meget fart – de fleste ture bør være rolige (mål ca. 80 %).' : 'Meget moderat/hårdt – hold de rolige ture rigtigt rolige (mål ca. 80 %).'}</div></div></div></div>`;
  }
  if (tot && est / tot > 0.5) h += `<div class="section-footer">Det meste er et estimat ud fra gennemsnitspulsen. Når Garmin leverer tid i zoner for turene, bliver fordelingen præcis.</div>`;
  return h;
}

export function paceHTML(c, st, periodBar, lineChart) {
  const from = X.rangeFrom(st.statRange, c.today, c.runs[0] && c.runs[0].date);
  const pts = easyPaceSeries(c.runs.filter((r) => r.date >= from), c.zones);
  const long = longRunSeries(c.runs, from, c.today);
  let h = periodBar;
  h += `<div class="card"><div class="chart-caption"><b>Tempo på rolige ture (Z1–Z2)</b><span> · lavere er hurtigere</span></div>${pts.length ? lineChart(pts.map((p) => ({ date: p.date, v: p.v / 60 })), { unit: 'min/km', decimals: 2 }) : '<div class="meta">Der skal være mindst én rolig tur (3 km+ med puls i Z1–Z2).</div>'}</div>`;
  if (pts.length >= 2) {
    const a = pts[0], b = pts[pts.length - 1], d = b.v - a.v;
    h += `<div class="section-footer">Ved rolig puls løber du nu ${P.fmtPace(b.v)}/km mod ${P.fmtPace(a.v)}/km i starten – ${Math.abs(d) < 3 ? 'stort set uændret' : d < 0 ? `${Math.round(-d)} sek/km hurtigere` : `${Math.round(d)} sek/km langsommere`}. Det er et groft mål: varme, søvn og terræn påvirker det.</div>`;
  }
  const maxLong = Math.max(0, ...long.map((w) => w.km));
  h += `<div class="card" style="margin-top:14px"><div class="chart-caption"><b>Længste tur pr. uge</b><span> · ${fmt(maxLong, 1)} km længste</span></div>${lineChart(long.filter((w) => w.km > 0).map((w) => ({ date: w.start, v: w.km })), { unit: 'km', decimals: 1 })}</div>`;
  const pr = predictions(c.runs);
  if (pr) {
    h += `<div class="section-header">Prognose fra din 5 km-test (${P.fmtDateShort(pr.date)}: ${hhmmss(pr.from)})</div><div class="group">${pr.items.map((x) => `<div class="row"><span class="grow title">${x.name}</span><span class="meta"><b>${hhmmss(x.sec)}</b>${x.safe ? ` · sikkert ${hhmmss(x.safe)}` : ''}</span></div>`).join('')}</div>
      <div class="section-footer">Riegels formel (T × (afstand/5)^1,06) – en pejling, ikke en garanti. Marathon-tiden er mest usikker.</div>`;
  }
  return h;
}

export function shoesHTML(c) {
  const shoes = c.shoes || [];
  let h = `<div class="section-header">Dine sko</div>`;
  if (!shoes.length) h += `<div class="card empty">Ingen sko endnu. Tilføj de sko, du løber i, så tæller appen kilometer.<br><small>Din tjekliste anbefaler 50–150 km på skoene før et marathon.</small></div>`;
  else h += `<div class="group">${shoes.map((s) => {
    const km = shoeKm(s, c.runs), stt = shoeStatus(km), active = !s.to && !s.retired;
    return `<div class="row shoe"><span class="grow"><span class="title">${esc(s.name)}${active ? ' <span class="chip run">I brug</span>' : s.retired ? ' <span class="chip">Pensioneret</span>' : ''}</span>
      <span class="meta" style="display:block">${fmt(km, 0)} km · <span class="shoe-${stt.kind}">${esc(stt.text)}</span></span></span>
      ${active ? `<button class="btn" data-act="shoeRetire" data-id="${esc(s.id)}">Pensionér</button>` : s.retired ? '' : `<button class="btn" data-act="shoeUse" data-id="${esc(s.id)}">Brug igen</button>`}</div>`;
  }).join('')}</div>`;
  h += `<button class="btn filled block" style="margin-top:14px" data-act="shoeNew">${icon('plus')}Tilføj sko</button>
    <div class="section-footer">Kilometerne er dine løb fra den dag, skoene kom i brug (plus evt. startkilometer). Tryk "Pensionér", når et par er færdige – så tæller de ikke længere.</div>`;
  return h;
}
