// Fremskridt: personlige rekorder, estimeret sluttid, milepæle og alle tiders tal. Rene funktioner uden DOM (testes i test_logic.mjs).
import * as P from './plan.js';

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const PR_DISTANCES = [[1, '1 km'], [5, '5 km'], [10, '10 km'], [21.0975, 'Halvmaraton'], [42.195, 'Marathon']];
export const PR_SHORT = { 1: '1K', 5: '5K', 10: '10K', 21.0975: '21K', 42.195: '42K' };

// Bedste indsats på en distance ud fra omgangene (km-splits); uden omgange bruges turens gennemsnit, hvis turen er næsten præcis distancen
export function bestEfforts(runs) {
  const best = {};
  const put = (d, sec, run) => { if (!sec || !isFinite(sec)) return; if (!best[d] || sec < best[d].sec) best[d] = { sec: Math.round(sec), date: run.date, id: run.id, distance: d }; };
  for (const r of runs) {
    if (!r.km || !r.sec) continue;
    const sp = (Array.isArray(r.splits) ? r.splits : []).filter((x) => x && x.km > 0 && x.time_sec > 0);
    for (const [d] of PR_DISTANCES) {
      if (r.test && d === 5 && r.test > 0) { put(5, r.test, r); continue; }
      if (sp.length) {
        // glidende vindue over sammenhængende omgange, der tilsammen dækker distancen (±3 %)
        for (let i = 0; i < sp.length; i++) {
          let km = 0, sec = 0;
          for (let j = i; j < sp.length; j++) {
            km += sp[j].km; sec += sp[j].time_sec;
            if (km >= d * 0.99) { if (km <= d * 1.04) put(d, (sec * d) / km, r); break; }
          }
        }
      } else if (r.km >= d * 0.99 && r.km <= d * (d >= 21 ? 1.06 : 1.12)) put(d, (r.sec * d) / r.km, r);
    }
  }
  return best;
}

// Estimeret sluttid for halvmaraton og marathon (interval) ud fra bedste præstationer (Riegel). null, hvis der ingen data er.
export function estimateFinish(prs) {
  const src = [5, 10].map((d) => prs[d]).filter(Boolean);
  if (!src.length) return null;
  const pred = (d) => src.map((s) => s.sec * (d / s.distance) ** 1.06);
  const half = Math.min(...pred(21.0975)), mar = Math.min(...pred(42.195));
  return { half: [Math.round(half), Math.round(half * 1.04)], marathon: [Math.round(mar), Math.round(mar * 1.08)], basis: src.map((s) => s.distance) };
}

// Milepæle: { id, label, done, date, detail }
export function milestones({ runs, strengthSessions, strengthPRs = 0 }) {
  const rs = [...runs].filter((r) => r.km > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const out = [];
  out.push({ id: 'first', label: 'Første løbetur', done: !!rs.length, date: rs[0] && rs[0].date, detail: rs[0] ? `${fmt(rs[0].km)} km` : '' });
  let cum = 0, hundred = null;
  for (const r of rs) { cum += r.km; if (cum >= 100 && !hundred) hundred = r.date; }
  out.push({ id: '100km', label: '100 km i alt', done: !!hundred, date: hundred, detail: `${fmt(cum)} / 100 km` });
  const longRun = rs.find((r) => r.km >= 20);
  out.push({ id: 'long20', label: 'Første langtur over 20 km', done: !!longRun, date: longRun && longRun.date, detail: longRun ? `${fmt(longRun.km)} km` : 'længste: ' + fmt(Math.max(0, ...rs.map((r) => r.km))) + ' km' });
  const wk = new Map();
  for (const r of rs) { const m = mondayOf(r.date); wk.set(m, (wk.get(m) || 0) + (r.elev || 0)); }
  const hmWeek = [...wk.entries()].sort().find(([, v]) => v >= 1000);
  out.push({ id: 'hm1000', label: 'Første uge med 1.000 højdemeter', done: !!hmWeek, date: hmWeek && hmWeek[0], detail: `bedste uge: ${fmt(Math.max(0, ...wk.values()), 0)} hm` });
  const ss = [...strengthSessions].sort((a, b) => (a.date < b.date ? -1 : 1));
  out.push({ id: 's50', label: '50 styrkepas', done: ss.length >= 50, date: ss[49] && ss[49].date, detail: `${ss.length} / 50` });
  out.push({ id: 's100', label: '100 styrkepas', done: ss.length >= 100, date: ss[99] && ss[99].date, detail: `${ss.length} / 100` });
  out.push({ id: 'spr', label: 'Styrke-rekorder', done: strengthPRs > 0, date: null, detail: `${strengthPRs} rekord${strengthPRs === 1 ? '' : 'er'}` });
  return out;
}

export function allTime({ runs, strengthSessions, coreCount = 0 }) {
  const rs = runs.filter((r) => r.km > 0);
  return {
    km: rs.reduce((s, r) => s + r.km, 0), activities: rs.length + strengthSessions.length, seconds: rs.reduce((s, r) => s + (r.sec || 0), 0),
    longest: rs.reduce((m, r) => (r.km > m.km ? { km: r.km, date: r.date } : m), { km: 0, date: null }),
    runs: rs.length, strength: strengthSessions.length - coreCount, core: coreCount,
  };
}

// Aktiviteter grupperet pr. måned: [{ month:'2026-11', km, count, seconds, items:[...] }] (nyeste først)
export function groupByMonth(items) {
  const m = new Map();
  for (const it of items) {
    const k = it.date.slice(0, 7);
    if (!m.has(k)) m.set(k, { month: k, km: 0, count: 0, seconds: 0, items: [] });
    const g = m.get(k);
    g.count++; g.km += it.kind === 'run' ? it.km || 0 : 0; g.seconds += it.seconds || 0; g.items.push(it);
  }
  const out = [...m.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
  for (const g of out) g.items.sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}

const mondayOf = (iso) => P.addDays(iso, -((P.parseISO(iso).getDay() + 6) % 7));
const fmt = (n, d = 1) => Number(n).toLocaleString('da-DK', { maximumFractionDigits: d });
export const fmtHMS = (sec) => { const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`; };

// ---------- Pulszoner ud fra tærskelpuls (efter 5 km-testen) ----------
// Tærskelpuls ≈ gennemsnitspuls på en hård 5 km-test. Zoner i procent af tærskelpulsen (løb).
export function lthrFromTest(runs) {
  const t = [...runs].filter((r) => r.test && r.hr).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  return t ? { lthr: Math.round(t.hr), date: t.date } : null;
}
export function zonesFromLthr(lthr) {
  const bands = [[0.7, 0.84], [0.85, 0.89], [0.9, 0.94], [0.95, 0.99], [1.0, 1.06]];
  return Object.fromEntries(bands.map(([lo, hi], i) => [`Z${i + 1}`, [Math.round(lthr * lo), Math.round(lthr * hi)]]));
}
