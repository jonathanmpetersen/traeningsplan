// Visninger til Statistik → Styrke. Returnerer HTML-tekst; app.js står for hændelser og tilstand.
// c = kontekst fra app.js: { rows, lib, today, runDates:Set, sessions }, st = valg i visningen (ui).
import * as P from './plan.js';
import { icon } from './icons.js';
import * as X from './stats.js';
import { bodySVG, MUSCLES, MUSCLE_LABEL } from './musclemap.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('da-DK', { maximumFractionDigits: d }));
const fmtKg = (n) => fmt(Math.round(n * 10) / 10, 1);
const seg = (group, options, value) => `<div class="seg" role="group">${options.map(([v, l]) => `<button data-act="seg" data-group="${group}" data-value="${v}" aria-pressed="${v === value}">${l}</button>`).join('')}</div>`;
export const chip = (group, v, l, on) => `<button type="button" class="chip-btn" data-act="seg" data-group="${group}" data-value="${v}" aria-pressed="${on}">${l}</button>`;
const hhmm = (min) => (min == null ? '–' : min >= 60 ? `${Math.floor(min / 60)} t ${String(min % 60).padStart(2, '0')} min` : `${min} min`);
const pctText = (a, b) => (b > 0 ? `${a >= b ? '▲' : '▼'} ${fmt(Math.abs((a - b) / b * 100), 0)} %` : a > 0 ? '▲ ny' : '–');

export const SECTIONS = [['overview', 'Oversigt'], ['muscles', 'Muskelkort'], ['balance', 'Fordeling'], ['log', 'Træningslog'], ['exercises', 'Øvelser'], ['history', 'Historik']];

// ---------- Grafer (inline SVG) ----------
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

export function barChart(series, metric, selected) {
  const W = 340, H = 170, pl = 34, pb = 20, pt = 8;
  const val = (w) => w[metric] || 0;
  const top = niceMax(Math.max(...series.map(val), 1));
  const slot = (W - pl) / series.length, y = (v) => pt + (H - pt - pb) * (1 - v / top);
  const labelEvery = series.length > 40 ? 8 : series.length > 20 ? 4 : series.length > 8 ? 2 : 1;
  let svg = '';
  for (const v of [0, top / 2, top]) svg += `<line class="grid" x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v, 0)}</text>`;
  series.forEach((w, i) => {
    const bw = Math.max(2, slot * 0.7), x = pl + i * slot + (slot - bw) / 2;
    const cur = i === series.length - 1;
    svg += `<g data-act="statBar" data-i="${i}" role="button" aria-label="Uge fra ${P.fmtDateShort(w.start)}: ${fmt(val(w), 0)}"><rect class="bar-hit" x="${pl + i * slot}" y="${pt}" width="${slot}" height="${H - pt - pb}"/>
      <rect class="bar${cur ? ' now' : ''}${selected === i ? ' sel' : ''}" x="${x}" y="${val(w) ? y(val(w)) : H - pb - 1}" width="${bw}" height="${val(w) ? H - pb - y(val(w)) : 1}" rx="${Math.min(3, bw / 2)}"/></g>`;
    if (i % labelEvery === 0 || cur) svg += `<text x="${pl + i * slot + slot / 2}" y="${H - 5}" text-anchor="middle">${P.fmtDateShort(w.start).replace('. ', '.').replace(/\.$/, '')}</text>`;
  });
  const label = `Søjlediagram pr. uge, ${series.length} uger. Seneste uge: ${fmt(val(series[series.length - 1]), 0)}. Højeste: ${fmt(Math.max(...series.map(val)), 0)}.`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">${svg}</svg>`;
}

// Linjegraf med punkter; points: [{date, v}]
export function lineChart(points, { unit = '', decimals = 0 } = {}) {
  if (!points.length) return `<div class="meta" style="padding:10px 0">Ingen data endnu.</div>`;
  const W = 320, H = 130, pl = 36, pb = 20, pt = 10, pr = 10;
  const ys = points.map((p) => p.v);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const padv = (hi - lo) * 0.15 || Math.max(1, hi * 0.1);
  lo = Math.max(0, lo - padv); hi += padv;
  const t0 = P.parseISO(points[0].date).getTime(), t1 = P.parseISO(points[points.length - 1].date).getTime();
  const x = (d) => (t1 === t0 ? (pl + W - pr) / 2 : pl + (W - pl - pr) * ((P.parseISO(d).getTime() - t0) / (t1 - t0)));
  const y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let svg = '';
  for (const v of [lo, (lo + hi) / 2, hi]) svg += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 4}" y="${y(v) + 3}" text-anchor="end">${fmt(v, decimals)}</text>`;
  if (points.length > 1) svg += `<polyline class="line st" points="${points.map((p) => `${x(p.date)},${y(p.v)}`).join(' ')}"/>`;
  svg += points.map((p) => `<circle class="dot st" cx="${x(p.date)}" cy="${y(p.v)}" r="3.5"><title>${P.fmtDateShort(p.date)}: ${fmt(p.v, decimals)} ${unit}</title></circle>`).join('');
  svg += `<text x="${pl}" y="${H - 4}">${P.fmtDateShort(points[0].date)}</text>${points.length > 1 ? `<text x="${W - pr}" y="${H - 4}" text-anchor="end">${P.fmtDateShort(points[points.length - 1].date)}</text>` : ''}`;
  const lbl = `Graf med ${points.length} punkter. Første ${fmt(points[0].v, decimals)} ${unit}, seneste ${fmt(points[points.length - 1].v, decimals)} ${unit}, højeste ${fmt(Math.max(...ys), decimals)} ${unit}.`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${lbl}">${svg}</svg>`;
}

export function sparkline(values) {
  const v = values.slice(-10);
  if (v.length < 2) return '';
  const W = 64, H = 22, lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const pts = v.map((a, i) => `${(i / (v.length - 1)) * (W - 4) + 2},${H - 3 - ((a - lo) / r) * (H - 6)}`).join(' ');
  const up = v[v.length - 1] >= v[0];
  return `<svg class="spark ${up ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

export function radarChart(groups, values, max) {
  const S = 300, cx = 150, cy = 150, R = 100, n = groups.length;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, r) => `${(cx + Math.cos(ang(i)) * r).toFixed(1)},${(cy + Math.sin(ang(i)) * r).toFixed(1)}`;
  const ring = (v) => groups.map((_, i) => pt(i, (v / max) * R)).join(' ');
  let svg = '';
  svg += `<polygon class="rd-band" points="${ring(X.TARGET[1])}"/><polygon class="rd-hole" points="${ring(X.TARGET[0])}"/>`;
  for (const v of [X.TARGET[0], X.TARGET[1]]) svg += `<polygon class="rd-ring" points="${ring(v)}"/>`;
  groups.forEach((g, i) => { svg += `<line class="rd-axis" x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(ang(i)) * R).toFixed(1)}" y2="${(cy + Math.sin(ang(i)) * R).toFixed(1)}"/>`; });
  svg += `<polygon class="rd-area" points="${groups.map((g, i) => pt(i, Math.min(values[g.id], max) / max * R)).join(' ')}"/>`;
  groups.forEach((g, i) => {
    const lx = cx + Math.cos(ang(i)) * (R + 16), ly = cy + Math.sin(ang(i)) * (R + 14);
    const a = Math.cos(ang(i));
    svg += `<text class="rd-label" x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}" text-anchor="${a > 0.3 ? 'start' : a < -0.3 ? 'end' : 'middle'}">${g.label}</text>`;
  });
  return `<svg class="chart radar" viewBox="-20 0 340 ${S}" role="img" aria-label="Radar over sæt pr. muskelgruppe pr. uge: ${groups.map((g) => `${g.label} ${fmt(values[g.id], 1)}`).join(', ')}">${svg}</svg>`;
}

// ---------- 1. Oversigt ----------
const METRICS = [['volume', 'Volumen'], ['minutes', 'Varighed'], ['sessions', 'Pas'], ['sets', 'Sæt']];
const metricText = (m, v) => (m === 'volume' ? `${fmt(v, 0)} kg` : m === 'minutes' ? hhmm(Math.round(v)) : m === 'sessions' ? `${fmt(v, 0)} pas` : `${fmt(v, 0)} sæt`);

export function periodBar(st) { return `<div class="seg period">${X.RANGES.map(([v, l]) => `<button data-act="seg" data-group="statRange" data-value="${v}" aria-pressed="${st.statRange === v}">${l}</button>`).join('')}</div>`; }

export function overviewHTML(c, st) {
  const first = c.sessions.length ? c.sessions[0].date : null;
  const from = X.rangeFrom(st.statRange, c.today, first);
  const series = X.weeklySeries(c.sessions, from, c.today);
  const cur = series[series.length - 1];
  const prevW = X.weeklySeries(c.sessions, P.addDays(X.mondayOf(c.today), -7), P.addDays(X.mondayOf(c.today), -1))[0] || { volume: 0, minutes: 0, sessions: 0, sets: 0 };
  const sel = st.statBar != null && series[st.statBar] ? st.statBar : series.length - 1;
  const w = series[sel];
  let h = periodBar(st);
  h += `<div class="section-header" style="margin-top:6px">Denne uge</div><div class="stat-tiles">${METRICS.map(([m, l]) => `<div class="stat-tile"><div class="l">${l}</div><div class="v">${m === 'volume' ? fmt(cur[m], 0) : m === 'minutes' ? hhmm(Math.round(cur[m])) : fmt(cur[m], 0)}${m === 'volume' ? '<small> kg</small>' : ''}</div><div class="d ${cur[m] >= prevW[m] ? 'up' : 'down'}">${pctText(cur[m], prevW[m])}<small> mod sidste uge</small></div></div>`).join('')}</div>`;
  h += `<div class="card" style="margin-top:14px">${seg('statMetric', METRICS, st.statMetric)}
    <div class="chart-caption"><b>${metricText(st.statMetric, w[st.statMetric])}</b><span> · uge fra ${P.fmtDateShort(w.start)}${sel === series.length - 1 ? ' (nu)' : ''}</span></div>
    ${barChart(series, st.statMetric, sel)}</div>`;
  if (!c.sessions.length) h += `<div class="section-footer">Ingen loggede styrkepas endnu. Når du markerer sæt med ✓ i et pas, vises tallene her.</div>`;
  return h;
}

// ---------- 2. Muskelkort ----------
export function musclesHTML(c, st) {
  const first = c.sessions.length ? c.sessions[0].date : null;
  const from = X.rangeFrom(st.statRange, c.today, first);
  const sets = X.muscleSets(c.rows, c.lib, from, c.today);
  const max = Math.max(1, ...Object.values(sets).map((a) => a.sets));
  const inten = Object.fromEntries(Object.entries(sets).map(([id, a]) => [id, a.sets / max]));
  let h = periodBar(st);
  h += `<div class="card mm-card">${bodySVG(inten, { selected: st.statMuscle })}
    <div class="mm-legend"><span>Få sæt</span><i></i><span>Mange sæt</span></div></div>`;
  if (st.statMuscle && MUSCLE_LABEL[st.statMuscle]) {
    const a = sets[st.statMuscle];
    h += `<div class="section-header">${MUSCLE_LABEL[st.statMuscle]}</div>`;
    if (!a) h += `<div class="card empty">Ingen sæt for ${MUSCLE_LABEL[st.statMuscle].toLowerCase()} i perioden.</div>`;
    else h += `<div class="group">${Object.entries(a.by).sort((x, y) => y[1] - x[1]).map(([n, v]) => `<div class="row"><span class="grow title">${esc(n)}</span><span class="meta">${fmt(v, 1)} sæt</span></div>`).join('')}</div>
      <div class="section-footer">I alt ${fmt(a.sets, 1)} sæt i perioden. Primære muskler tæller 1 sæt, sekundære 0,5.</div>`;
  } else h += `<div class="section-footer">Tryk på en muskel for at se, hvilke øvelser og hvor mange sæt der er lavet.</div>`;
  return h;
}

// ---------- 3. Muskelfordeling ----------
export function balanceHTML(c, st) {
  const first = c.sessions.length ? c.sessions[0].date : null;
  let from = X.rangeFrom(st.statRange, c.today, first);
  if (first && X.mondayOf(first) > from) from = X.mondayOf(first); // gennemsnittet starter ved første loggede uge
  const weeks = X.weeksInRange(from, c.today);
  const total = X.groupSets(c.rows, c.lib, from, c.today);
  const per = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, v / weeks]));
  const max = Math.max(25, ...Object.values(per).map((v) => v * 1.05));
  let h = periodBar(st);
  h += `<div class="card"><div class="chart-caption"><b>Sæt pr. uge</b><span> · gennemsnit over ${weeks} uge${weeks === 1 ? '' : 'r'}</span></div>${radarChart(X.GROUPS, per, Math.max(25, Math.max(...Object.values(per))))}
    <div class="legend"><span><i style="background:var(--strength);opacity:.35"></i>Målområde ${X.TARGET[0]}–${X.TARGET[1]} sæt</span></div></div>`;
  h += `<div class="section-header">Pr. muskelgruppe</div><div class="group">${X.GROUPS.map((g) => {
    const v = per[g.id], vd = X.verdict(v), left = X.TARGET[0] / max * 100, wid = (X.TARGET[1] - X.TARGET[0]) / max * 100;
    const label = vd === 'low' ? 'for lidt' : vd === 'high' ? 'for meget' : 'i målet';
    return `<div class="row bal"><span class="bal-top"><span class="title">${g.label}</span><span class="meta"><b class="bal-${vd}">${label}</b> · ${fmt(v, 1)} sæt/uge</span></span>
      <span class="bal-track"><i class="band" style="left:${left}%;width:${wid}%"></i><i class="fill bal-${vd}" style="width:${Math.min(100, v / max * 100)}%"></i></span></div>`;
  }).join('')}</div>
  <div class="section-footer">Målområde: ${X.TARGET[0]}–${X.TARGET[1]} sæt pr. muskelgruppe pr. uge. Primære muskler tæller 1 sæt, sekundære 0,5. Den nuværende uge er med, så tallene kan se lave ud midt i en uge.</div>`;
  return h;
}

// ---------- 4. Træningslog (kalender + serie) ----------
export function calendarHTML(c, st) {
  const month = st.statMonth || c.today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const firstDay = `${month}-01`, lead = (P.parseISO(firstDay).getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const sDays = new Set(c.sessions.map((s) => s.date));
  const name = P.parseISO(firstDay).toLocaleDateString('da-DK', { month: 'long', year: 'numeric' });
  const sk = X.streak(c.sessions, c.today);
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-d empty"></span>';
  for (let d = 1; d <= days; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    cells += `<span class="cal-d${iso === c.today ? ' today' : ''}"><b>${d}</b><span class="dots">${sDays.has(iso) ? '<i class="s"></i>' : ''}${c.runDates.has(iso) ? '<i class="r"></i>' : ''}</span></span>`;
  }
  return `<div class="card streak"><div class="streak-n">${sk.weeks}</div><div><div class="title">${sk.weeks === 1 ? 'uge' : 'uger'} i træk</div>
      <div class="meta">med mindst ${sk.need} styrkepas · denne uge: ${sk.thisWeek} af ${sk.need}</div></div></div>
    <div class="card" style="margin-top:14px"><div class="cal-head"><button class="nav-btn" data-act="statMonth" data-d="-1" aria-label="Forrige måned">${icon('left')}</button><b>${name.charAt(0).toUpperCase() + name.slice(1)}</b>
      <button class="nav-btn" data-act="statMonth" data-d="1" aria-label="Næste måned">${icon('right')}</button></div>
      <div class="cal-grid">${['M', 'T', 'O', 'T', 'F', 'L', 'S'].map((d) => `<span class="cal-w">${d}</span>`).join('')}${cells}</div>
      <div class="legend"><span><i class="ds"></i>Styrke</span><span><i class="dr"></i>Løb</span></div></div>`;
}

// ---------- 5. Øvelser ----------
export function exerciseList(c, st) {
  const names = new Map();
  for (const r of c.rows) if (X.validSet(r)) names.set(X.canonicalName(c.lib, r.exercise), r.exercise);
  const q = (st.statQ || '').trim().toLowerCase();
  const list = [...names.keys()].filter((n) => !q || n.toLowerCase().includes(q)).map((n) => {
    const ss = X.exerciseSessions(c.rows, c.lib, n);
    const last = ss[ss.length - 1];
    return { n, last, e1: last.e1rm, trend: ss.map((s) => (s.e1rm || s.bestReps)) };
  }).sort((a, b) => (a.last.date < b.last.date ? 1 : -1));
  if (!list.length) return `<div class="card empty">${q ? 'Ingen øvelser matcher søgningen.' : 'Ingen øvelser logget endnu.'}</div>`;
  return `<div class="group">${list.map((x) => `<button class="row tappable" data-act="statEx" data-name="${esc(x.n)}"><span class="grow"><span class="title">${esc(x.n)}</span>
    <span class="meta" style="display:block">Sidst ${P.fmtWeekday(x.last.date)} ${P.fmtDateShort(x.last.date)} · ${x.e1 ? `est. 1RM ${fmtKg(x.e1)} kg` : `bedste ${x.last.bestReps} reps`}</span></span>${sparkline(x.trend)}${icon('right', 'chev')}</button>`).join('')}</div>`;
}
export function exercisesHTML(c, st) {
  return `<div class="search"><span class="search-ic">${icon('search')}</span><input type="search" id="statSearch" placeholder="Søg i dine øvelser" value="${esc(st.statQ || '')}" aria-label="Søg i øvelser" autocomplete="off"></div>
    <div id="statExList">${exerciseList(c, st)}</div>`;
}

const kgLabel = (c, name) => { const e = X.libEntry(c.lib, name); return e && e.load_type === 'per_hand' ? 'kg pr. hånd' : 'kg'; };

export function exerciseDetailHTML(c, st) {
  const name = st.statEx;
  const ss = X.exerciseSessions(c.rows, c.lib, name);
  const e = X.libEntry(c.lib, name);
  let h = `<button class="link-btn back-link" data-act="statExBack">${icon('left')}Alle øvelser</button><h2 class="ex-title">${esc(name)}</h2>`;
  h += seg('statExTab', [['about', 'Om'], ['history', 'Historik'], ['progress', 'Fremgang'], ['records', 'Rekorder'], ['perf', 'Præstation']], st.statExTab);
  const unit = kgLabel(c, name);
  const rec = X.records(c.rows, c.lib, name);
  if (st.statExTab === 'about') {
    const m = X.musclesOf(c.lib, name);
    const inten = {}; for (const id of m.secondary) inten[id] = 0.4; for (const id of m.primary) inten[id] = 1;
    h += `<div class="card mm-card">${bodySVG(inten, { interactive: false })}<div class="mm-legend two"><span><i class="p"></i>Primær</span><span><i class="s"></i>Sekundær</span></div></div>`;
    h += `<div class="group" style="margin-top:14px"><div class="row"><span class="grow title">Primære muskler</span><span class="meta right-text">${m.primary.map((id) => MUSCLE_LABEL[id]).join(', ') || '–'}</span></div>
      <div class="row"><span class="grow title">Sekundære muskler</span><span class="meta right-text">${m.secondary.map((id) => MUSCLE_LABEL[id]).join(', ') || '–'}</span></div>
      ${e && e.equipment ? `<div class="row"><span class="grow title">Udstyr</span><span class="meta right-text">${esc(e.equipment)}</span></div>` : ''}</div>`;
    h += `<div class="section-header">Teknik</div><div class="card"><div class="session-desc">${esc((e && e.technique) || 'Hold en kontrolleret bevægelse i hele udførelsen, og brug et fuldt bevægelsesudslag, du kan holde igennem alle sæt.')}</div></div>
      <a class="btn filled block" style="margin-top:14px" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' teknik')}">${icon('external')}Se på YouTube</a>`;
  } else if (st.statExTab === 'history') {
    h += `<div class="group" style="margin-top:6px">${[...ss].reverse().map((s) => `<button class="row tappable" data-act="open" data-key="${esc(s.key)}"><span class="grow"><span class="title">${P.fmtWeekday(s.date)} ${P.fmtDateShort(s.date)}</span>
      <span class="meta" style="display:block">${s.sets.map((r) => `${r.kg != null && Number(r.kg) !== 0 ? fmtKg(Number(r.kg)) : 'kropsv.'} × ${fmt(Number(r.reps), 0)}`).join(' · ')}</span></span>${icon('right', 'chev')}</button>`).join('') || '<div class="card empty">Ingen pas endnu.</div>'}</div>
      <div class="section-footer">Vægt i ${unit}${unit.includes('hånd') ? ' (volumen tælles dobbelt)' : ''}.</div>`;
  } else if (st.statExTab === 'progress') {
    const pts = (f) => ss.map((s) => ({ date: s.date, v: f(s) })).filter((p) => p.v > 0);
    const best = (arr) => (arr.length ? Math.max(...arr.map((p) => p.v)) : null);
    const blocks = [['Estimeret 1RM', 'kg', pts((s) => s.e1rm), 1], ['Maks vægt', unit, pts((s) => s.maxKg), 1], ['Volumen pr. pas', 'kg', pts((s) => s.volume), 0], ['Bedste reps', 'reps', pts((s) => s.bestReps), 0]];
    h += blocks.map(([t, u, p, d]) => `<div class="card" style="margin-top:12px"><div class="chart-caption"><b>${t}</b><span> · ${p.length ? `bedst ${fmt(best(p), d)} ${u}` : 'ingen data'}</span></div>${lineChart(p, { unit: u, decimals: d })}</div>`).join('');
  } else if (st.statExTab === 'records') {
    const b = rec.best;
    const rows = [
      ['e1rm', 'Estimeret 1RM', (r) => `${fmtKg(r.value)} kg`, (r) => `${fmtKg(r.kg)} × ${r.reps}`],
      ['maxKg', 'Maks vægt', (r) => `${fmtKg(r.value)} ${unit}`, (r) => `× ${r.reps} reps`],
      ['maxReps', 'Maks reps', (r) => `${fmt(r.value, 0)} reps`, (r) => (r.kg ? `med ${fmtKg(r.kg)} kg` : '')],
      ['sessionVol', 'Maks volumen pr. pas', (r) => `${fmt(r.value, 0)} kg`, () => ''],
      ['setVol', 'Maks volumen pr. sæt', (r) => `${fmt(r.value, 0)} kg`, (r) => `${fmtKg(r.kg)} × ${r.reps}`],
    ];
    h += rows.map(([k, t, val, sub]) => {
      const r = b[k];
      if (!r) return `<div class="card rec" style="margin-top:12px"><div class="title">${t}</div><div class="meta">Ingen rekord endnu</div></div>`;
      const hist = rec.hist[k];
      return `<div class="card rec" style="margin-top:12px"><div class="rec-top"><span class="title">🏅 ${t}</span><b>${val(r)}</b></div>
        <div class="meta">${P.fmtWeekday(r.date)} ${P.fmtDateShort(r.date)}${sub(r) ? ` · ${sub(r)}` : ''}</div>
        <details class="rec-hist"><summary>Vis rekordhistorik</summary><div class="group">${[...hist].reverse().map((x) => `<div class="row"><span class="grow title">${val(x)}</span><span class="meta">${P.fmtDateShort(x.date)}</span></div>`).join('')}</div></details></div>`;
    }).join('');
  } else {
    const e1 = rec.best.e1rm ? rec.best.e1rm.value : 0;
    if (!e1) h += `<div class="card empty" style="margin-top:12px">Estimeret præstation kræver mindst ét sæt med vægt. Log et sæt, så udregnes tabellen.</div>`;
    else h += `<div class="card" style="margin-top:12px"><div class="chart-caption"><b>Ud fra est. 1RM ${fmtKg(e1)} kg</b></div><table class="perf"><thead><tr><th>Reps</th><th>% af 1RM</th><th>Vægt (${unit})</th></tr></thead><tbody>${X.performanceTable(e1).map((r) => `<tr><td>${r.reps}</td><td>${fmt(r.pct * 100, 0)} %</td><td><b>${fmtKg(r.kg)}</b></td></tr>`).join('')}</tbody></table></div>
      <div class="section-footer">Beregnet med Epleys formel. Brug den som pejlemærke – ikke som facit.</div>`;
  }
  return h;
}

// ---------- 6. Historik ----------
export function historyHTML(c) {
  const prs = X.prCountsBySession(c.rows, c.lib);
  const list = [...c.sessions].reverse();
  if (!list.length) return `<div class="card empty">Ingen styrkepas logget endnu.<br>Åbn et pas, og skriv kg og reps ind pr. sæt.</div>`;
  return `<div class="group">${list.map((s) => `<button class="row tappable has-icon" data-act="statSession" data-key="${esc(s.key)}"><span class="badge-ic k-strength">${icon('strength')}</span>
    <span class="grow"><span class="title">${esc(s.session || 'Styrkepas')}${prs[s.key] ? ` <span class="pr-badge">🏅 ${prs[s.key]}</span>` : ''}</span>
    <span class="meta" style="display:block">${P.fmtWeekday(s.date)} ${P.fmtDateShort(s.date)} · ${s.minutes ? `${hhmm(s.minutes)} · ` : ''}${s.sets} sæt · ${fmt(s.volume, 0)} kg</span></span>${icon('right', 'chev')}</button>`).join('')}</div>`;
}


// ---------- 8. Pas-detalje ----------
// d fra X.sessionDetail. opts: { minutes, start } overstyrer varighed/starttid (bruges lige efter "Afslut pas").
export function passDetailHTML(d, opts = {}) {
  const minutes = opts.minutes ?? d.minutes, start = opts.start ?? d.start;
  const clock = start ? new Date(start).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) : null;
  const inten = Object.fromEntries([...d.primary].map((id) => [id, 1]));
  const sec = Object.fromEntries([...d.secondary].map((id) => [id, 1]));
  const prList = d.prs.length ? `<ul class="pd-prlist">${d.prs.map((r) => `<li>🏅 <b>${esc(r.name)}</b> · ${X.PR_LABEL[r.type]} ${r.type === 'maxReps' ? `${fmt(r.value, 0)} reps` : `${fmtKg(r.value)} kg`}</li>`).join('')}</ul>` : '';
  let h = `<div class="pd-head"><h2>${esc(d.session || 'Styrkepas')}</h2><div class="meta">${P.fmtDateLong(d.date)}${clock ? ` · kl. ${clock}` : ''}</div></div>
    <div class="pd-top"><div class="card mm-card">${bodySVG(inten, { interactive: false, secondary: sec })}
      <div class="mm-legend two"><span><i class="p"></i>Primære</span><span><i class="s2"></i>Sekundære</span></div></div>
      <div class="pd-tiles">
        <div class="pd-tile"><div class="l">Varighed</div><div class="v">${hhmm(minutes)}</div></div>
        <div class="pd-tile"><div class="l">Volumen</div><div class="v">${fmt(d.volume, 0)}<small> kg</small></div></div>
        ${d.prs.length ? `<details class="pd-tile pd-prs"><summary><span class="l">Rekorder</span><span class="v">🏅 ${d.prs.length}</span><span class="hint">Tryk for at se hvilke</span></summary>${prList}</details>`
          : `<div class="pd-tile"><div class="l">Rekorder</div><div class="v">–</div></div>`}
      </div></div>
    <div class="section-header">Øvelser</div>`;
  h += d.exercises.map((e) => `<div class="card pd-ex"><div class="pd-ex-top"><b>${esc(e.name)}</b>${e.change ? `<span class="chg ${e.change.kind}">${esc(e.change.text)}</span>` : ''}</div>
    ${e.sets.map((s, i) => `<div class="pd-set"><span class="n">${i + 1}</span><span class="w">${s.kg ? `${fmtKg(s.kg)} kg${s.perHand ? ' pr. hånd' : ''}` : 'kropsvægt'} × ${fmt(s.reps, 0)}</span>${s.pr.length ? `<span class="pr-badge" title="${s.pr.map((t) => X.PR_LABEL[t]).join(', ')}">🏅 ${s.pr.map((t) => X.PR_LABEL[t]).slice(0, 2).join(' · ')}</span>` : ''}</div>`).join('')}</div>`).join('');
  if (d.prevDate) h += `<div class="section-footer">Ændring i forhold til sidste ${esc(d.session || 'pas')} (${P.fmtDateShort(d.prevDate)}): tungeste sæt, eller reps ved samme vægt.</div>`;
  else h += `<div class="section-footer">Første gang dette pas er logget – næste gang vises ændringen.</div>`;
  h += `<button class="btn filled block" style="margin-top:14px" data-act="pdShare" data-key="${esc(d.key)}">${icon('external')}Del</button>`;
  return h;
}

export function strengthStatsHTML(c, st) {
  const nav = `<div class="tag-picks filter-row">${SECTIONS.map(([v, l]) => chip('statSec', v, l, st.statSec === v)).join('')}</div>`;
  if (st.statSec === 'exercises' && st.statEx) return nav + exerciseDetailHTML(c, st);
  const body = { overview: overviewHTML, muscles: musclesHTML, balance: balanceHTML, log: calendarHTML, exercises: exercisesHTML, history: historyHTML }[st.statSec] || overviewHTML;
  return nav + body(c, st);
}
export { MUSCLES };
