// Planlægger: genererer en ny plan frem til begge løb ("Genstart planen") og tilpasser enkelte uger.
// Rene funktioner uden DOM. plan.json er skabelonen: den nye plan følger skabelonens uger (samme datoer, samme løb,
// samme faser, deloads og nedtrapning), men kilometerne begrænses, så de stiger højst ca. 10 % pr. uge fra dit niveau.
import * as P from './plan.js';
import { applyProgram } from './programs.js';
import { applyCustom } from './own.js';
import { applyRunProgram } from './runprog.js';

const DAY_NAMES = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
export const MIN_LONG_BEFORE_MARATHON = 28;
const round05 = (v) => Math.round(v * 2) / 2;
const clone = (o) => JSON.parse(JSON.stringify(o));
export const mondayOf = (iso) => P.addDays(iso, -((P.parseISO(iso).getDay() + 6) % 7));
const dow = (iso) => P.parseISO(iso).getDay(); // 0 = søndag

const kindOf = (w) => (/Løbsuge/i.test(w.phase) ? 'race' : /Nedtrapning/i.test(w.phase) ? 'taper' : /Restitution/i.test(w.phase) ? 'recovery' : 'build');
const runsOf = (w) => w.days.flatMap((d) => d.items.filter((i) => i.kind === 'run' && !i.optional)); // valgfrie ture tæller ikke i ugens km
const raceKmOf = (w) => runsOf(w).filter((r) => r.type === 'race').reduce((s, r) => s + (r.km || 0), 0);
const nonRaceKm = (w) => runsOf(w).filter((r) => r.type !== 'race').reduce((s, r) => s + (r.km || 0), 0);
export const weekKm = (w) => Math.round(runsOf(w).reduce((s, r) => s + (r.km || 0), 0) * 10) / 10;

// ---------- Regler (samme som "Flyt pas") på en liste af uger ----------
function scheduleOf(weeks) {
  const byDate = new Map();
  for (const w of weeks) for (const d of w.days) byDate.set(d.date, d.items.map((item) => ({ item })));
  return { byDate };
}
export const violationsOf = (weeks) => P.checkRules(scheduleOf(weeks)).map((v) => v.text);

// ---------- Målstyret kilometer- og langtursplan ----------
// Planen lægges baglæns fra målene: først faste milepæle for langturen (Transgrancanaria og marathon), så den bedst
// mulige progression derhen inden for reglerne. Kan milepælene ikke nås, lempes den mindst risikable regel først, og
// planen fortæller hvilken regel der bremsede.
export const PEAK_WEEK_KM = 55;               // mål for topugen (4 løbeture): ca. 52–55 km
export const WEEK_PER_LONG = 1.75;            // ugens km ≈ 1,75 × langturen (langturen ca. 55 % af ugen i starten, ca. 45–50 % senere)
const CUT = 0.75;                             // cutback-uge: −25 %
const AFTER_MILESTONE = 0.78;                 // ugen efter milepælen, før nedtrapning: langtur ≈ 78 %
export const TGC_LONG = { min: 21, max: 21, hm: 900, daysBefore: 20 };
export const MAR_LONG = { early: 28, earlyMax: 30, final: 32, daysBefore: 21 };
// Højeste ugentlige km næste uge: under 30 km/uge op til +4 km, derover højst ca. 10 %
export const ramp = (x) => (x < 30 ? Math.floor(x + 4) : Math.floor(x * 1.1));

function pickSource(tplWeeks, i, deload) {
  const w = tplWeeks[i];
  if (w.deload === deload) return w;
  const k = kindOf(w);
  for (const samePhase of [true, false]) {
    for (let d = 1; d < tplWeeks.length; d++) {
      for (const j of [i + d, i - d]) { const x = tplWeeks[j]; if (x && x.deload === deload && kindOf(x) === k && !raceKmOf(x) && (!samePhase || x.phase === w.phase)) return x; }
    }
  }
  return w;
}

// Opdel skabelonens uger i blokke, der slutter med en raceuge
function blocksOf(template, tplWeeks, fromIdx) {
  const rows = [];
  for (let i = fromIdx; i < tplWeeks.length; i++) rows.push({ i, w: tplWeeks[i], start: tplWeeks[i].start, kind: kindOf(tplWeeks[i]), cut: false });
  const blocks = [];
  let cur = { rows: [], type: 'other', raceDate: null };
  for (const r of rows) {
    cur.rows.push(r);
    if (r.kind === 'race') {
      const hit = r.w.days.flatMap((d) => d.items.map((it) => ({ d, it }))).find((x) => x.it.kind === 'run' && x.it.type === 'race');
      cur.raceDate = hit ? hit.d.date : null;
      const g = (template.goals || []).find((x) => x.date === cur.raceDate);
      cur.type = g && /transgrancanaria|half/i.test(g.name) ? 'tgc' : g && /marathon/i.test(g.name) ? 'mar' : 'other';
      blocks.push(cur); cur = { rows: [], type: 'other', raceDate: null };
    }
  }
  if (cur.rows.length) blocks.push(cur);
  return blocks;
}
// Milepælsugen (mandag) i en blok, og cutback-uger (hver 4. opbygningsuge; aldrig milepælsugen)
function markBlock(block, { noCut }) {
  const rows = block.rows;
  let ms = null;
  if (block.type !== 'other' && block.raceDate) {
    const days = block.type === 'tgc' ? TGC_LONG.daysBefore : MAR_LONG.daysBefore;
    const mon = mondayOf(P.addDays(block.raceDate, -days));
    let idx = rows.findIndex((r) => r.start === mon && r.kind === 'build');
    if (idx < 0) for (let k = rows.length - 1; k >= 0; k--) if (rows[k].kind === 'build' && rows[k].start <= mon) { idx = k; break; }
    ms = idx >= 0 ? idx : null;
  }
  block.msIdx = ms;
  let c = 0;
  rows.forEach((r, k) => {
    r.cut = false;
    if (r.kind !== 'build') { c = 0; return; }
    const next = rows[k + 1];
    const isMs = k === ms;
    if (!noCut && !isMs && c >= 3 && next && next.kind === 'build' && (ms == null || k < ms)) { r.cut = true; c = 0; } else c++;
  });
}

// Simulér én blok med fast ugentlig stigning s (km) på langturen. Returnerer rækker med K (ugens km) og L (langtur)
function simulate(block, s, o) {
  const rows = block.rows, ms = block.msIdx;
  const tplPeak = Math.max(1, ...rows.filter((r) => r.kind === 'build' && !r.w.deload).map((r) => nonRaceKm(r.w)));
  let lastW = o.startW, lastL = null, msL = null, peakW = 0, first = true;
  const out = [], limited = [];
  rows.forEach((r, k) => {
    const o2 = { start: r.start, kind: r.kind, cut: r.cut, T: nonRaceKm(r.w) };
    if (r.kind === 'build') {
      if (r.cut) { o2.K = Math.round(CUT * lastW); o2.L = round05(CUT * lastL); }
      else if (ms != null && k > ms) { o2.K = Math.round(0.9 * lastW); o2.L = round05(AFTER_MILESTONE * msL); }
      else {
        const isFirst = first;
        let wantL = isFirst ? o.firstL : lastL + s;
        const cap = o.capL(k, ms);
        if (wantL > cap) wantL = cap;
        const growth = isFirst && o.restartW ? o.restartW : ramp(lastW);
        const target = Math.min(PEAK_WEEK_KM, Math.round(WEEK_PER_LONG * wantL));
        let W = isFirst && o.restartW ? o.restartW : Math.min(growth, target);
        if (wantL > W - 3) { limited.push({ start: r.start, wantL, W }); wantL = Math.max(3, W - 3); }
        o2.K = W; o2.L = round05(wantL);
        lastW = W; lastL = o2.L; peakW = Math.max(peakW, W); first = false;
        if (k === ms) msL = o2.L;
      }
    } else {
      const f = nonRaceKm(r.w) / tplPeak;
      o2.K = Math.max(8, Math.round((peakW || lastW) * f));
      if (r.kind === 'recovery') o2.deload = true;
    }
    out.push(o2);
  });
  return { rows: out, peakW, msL, limited };
}

// Er milepælene nået?
function okBlock(block, sim, o) {
  const ms = block.msIdx;
  if (ms == null || block.type === 'other') return true;
  const L = sim.rows[ms].L;
  if (block.type === 'tgc') return L >= o.msMin;
  const early = sim.rows.filter((r, k) => k < ms && r.kind === 'build' && !r.cut && r.L >= MAR_LONG.early).length;
  return L >= o.msMin && early >= o.needEarly;
}

function solveBlock(block, o) {
  let last = null;
  for (let s = 1; s <= o.sMax + 1e-9; s += 0.25) {
    const sim = simulate(block, s, o);
    last = { sim, s };
    if (okBlock(block, sim, o)) return { ...last, ok: true };
  }
  return { ...last, ok: false };
}

// Relaksationer i rækkefølge efter stigende risiko
export const RELAXATIONS = [
  ['tgc22', 'Langturen før Transgrancanaria sættes til 22 km (øverst i 20–22 km), så genstarten efter løbet bliver højere'],
  ['noCutMar', 'Ingen cutback-uge i marathon-opbygningen (restitutionsugen efter Transgrancanaria tæller som cutback)'],
  ['step3Mar', 'Langturen må stige op til 3 km pr. uge (i stedet for 2) i marathon-opbygningen'],
  ['restart95', 'Efter Transgrancanaria genoptages på ca. 95 % af niveauet i stedet for 90 %'],
  ['mar30', 'Marathon-toppen på langtur sættes til 30 km (i stedet for 32): ét pas på 28 og ét på 30'],
  ['step3Tgc', 'Langturen må stige op til 3 km pr. uge (i stedet for 2) frem mod Transgrancanaria'],
];

function attempt(template, tplWeeks, fromIdx, o, relaxIds) {
  const has = (id) => relaxIds.includes(id);
  const blocks = blocksOf(template, tplWeeks, fromIdx);
  const res = [];
  let prev = null; // forrige bloks resultat (peak, msL)
  let allOk = true;
  for (const block of blocks) {
    markBlock(block, { noCut: block.type === 'mar' && has('noCutMar') });
    let bo;
    if (block.type === 'mar' || (prev && block.type === 'other')) {
      const ratio = has('restart95') ? 0.95 : 0.9;
      const final = has('mar30') ? 30 : MAR_LONG.final;
      bo = {
        startW: prev ? prev.peakW : o.startW, firstL: round05(ratio * (prev && prev.msL ? prev.msL : o.firstL)), restartW: prev ? Math.round(ratio * prev.peakW) : null,
        sMax: has('step3Mar') ? 3 : 2, msMin: final, needEarly: has('mar30') ? 1 : 2,
        capL: (k, ms) => (ms != null && k >= ms ? final : MAR_LONG.earlyMax),
      };
    } else {
      const tmax = has('tgc22') ? 22 : TGC_LONG.max;
      bo = { startW: o.startW, firstL: o.firstL, restartW: null, sMax: has('step3Tgc') ? 3 : 2, msMin: has('tgc22') ? 22 : TGC_LONG.min, needEarly: 0, capL: () => tmax };
    }
    const r = solveBlock(block, bo);
    allOk = allOk && r.ok;
    res.push({ block, r, bo });
    prev = { peakW: r.sim.peakW, msL: r.sim.msL };
  }
  return { res, allOk, relaxIds };
}

// Hovedfunktion: returnerer rækker for de nye uger + målkontrol
export function goalCurve(template, tplWeeks, fromIdx, { base, startWeekKm, recentLong, strict, cautious }) {
  const startW = Math.max(base, startWeekKm || 0);
  const firstCap = ramp(startW) - 3;
  const wanted = Math.min(8, Math.max(7, round05((recentLong || 6) + 1))); // langturen starter på 7–8 km
  const firstL = Math.max(3, Math.min(wanted, firstCap));
  const o = { startW, firstL };
  // standard: hold milepælene (32 km) og lempe skridtet; forsigtig: sænk hellere marathon-toppen til 30 km end at stige 3 km/uge
  const order = cautious ? ['tgc22', 'noCutMar', 'restart95', 'mar30', 'step3Mar', 'step3Tgc'] : ['tgc22', 'noCutMar', 'step3Mar', 'restart95', 'mar30', 'step3Tgc'];
  const tries = strict ? [[]] : [[], ...order.map((_, i) => order.slice(0, i + 1))];
  const strictRun = attempt(template, tplWeeks, fromIdx, o, []);
  let chosen = null;
  for (const t of tries) { const a = attempt(template, tplWeeks, fromIdx, o, t); chosen = a; if (a.allOk) break; }
  // rækker
  const rows = [];
  for (const { block, r } of chosen.res) {
    r.sim.rows.forEach((x, k) => {
      const br = block.rows[k];
      const deload = x.cut || !!x.deload;
      const src = x.kind === 'build' ? pickSource(tplWeeks, br.i, x.cut) : br.w;
      rows.push({ start: x.start, kind: x.kind, deload, K: x.K, L: x.kind === 'build' ? x.L : null, T: nonRaceKm(src), src, block: block.type, ms: block.msIdx === k });
    });
  }
  addElevation(chosen.res, rows);
  const check = checkGoals(chosen, strictRun, { firstL, wanted, startW });
  return { rows, check, relaxations: chosen.relaxIds.map((id) => ({ id, text: RELAXATIONS.find((x) => x[0] === id)[1] })) };
}

// Højdemeter på langturen i trailblokken: stiger fra ca. 8 til 43 hm pr. km frem til milepælsugen (min. 900 hm)
function addElevation(res, rows) {
  const byStart = new Map(rows.map((r) => [r.start, r]));
  for (const { block, r } of res) {
    if (block.type !== 'tgc' || block.msIdx == null) continue;
    const trail = block.rows.map((br, k) => ({ br, k })).filter(({ br, k }) => br.kind === 'build' && /Trail/i.test(br.w.phase) && k <= block.msIdx);
    const normal = trail.filter(({ k }) => !r.sim.rows[k].cut);
    const nMs = Math.max(1, normal.length - 1);
    let lastH = 8, msElev = 0;
    block.rows.forEach((br, k) => {
      const x = r.sim.rows[k], row = byStart.get(br.start);
      if (br.kind !== 'build' || !row) return;
      const ni = normal.findIndex((n) => n.k === k);
      let e = 0;
      if (k === block.msIdx) { e = Math.max(TGC_LONG.hm, Math.round((x.L * 43) / 10) * 10); msElev = e; }
      else if (k > block.msIdx) e = Math.round((0.75 * msElev) / 10) * 10;
      else if (ni >= 0) { lastH = 8 + (43 - 8) * (ni / nMs); e = Math.round((x.L * lastH) / 10) * 10; }
      else if (trail.some((t) => t.k === k)) e = Math.round((x.L * lastH * 0.8) / 10) * 10;
      if (e >= 100) row.longElev = e;
    });
  }
}

// Målkontrol til forhåndsvisningen: hvad nåes, hvad bremser, og hvilke lempelser blev brugt
function checkGoals(chosen, strictRun, { firstL, wanted, startW }) {
  const out = { milestones: [], blockers: [], ok: chosen.allOk, usedRelaxations: chosen.relaxIds, firstL, wantedFirstL: wanted };
  const fmtKm = (v) => String(v).replace('.', ',');
  for (const { block, r, bo } of chosen.res) {
    const ms = block.msIdx;
    if (block.type === 'other') continue;
    if (ms == null) { out.milestones.push({ key: block.type, ok: false, text: 'Milepælen ligger før startdatoen og kan ikke nås.' }); continue; }
    const rows = r.sim.rows, L = rows[ms].L, wk = rows[ms].start;
    if (block.type === 'tgc') {
      out.milestones.push({ key: 'tgc', ok: L >= bo.msMin, date: wk, text: `Transgrancanaria: langtur ${fmtKm(L)} km med ${TGC_LONG.hm}+ højdemeter (uge fra ${P.fmtDateShort(wk)}, ca. 3 uger før løbet)`, long: L });
    } else {
      const early = rows.map((x, k) => ({ x, k })).filter(({ x, k }) => k < ms && x.kind === 'build' && !x.cut && x.L >= MAR_LONG.early);
      out.milestones.push({ key: 'mar28', ok: early.length >= bo.needEarly, text: `Marathon: ${bo.needEarly === 1 ? 'mindst én langtur' : 'mindst to langture'} på 28–30 km (${early.map(({ x }) => `${fmtKm(x.L)} km`).join(' og ') || 'ingen'})`, count: early.length });
      out.milestones.push({ key: 'mar32', ok: L >= bo.msMin, date: wk, text: `Marathon: langtur på ${fmtKm(bo.msMin)} km ca. 3 uger før (uge fra ${P.fmtDateShort(wk)}: ${fmtKm(L)} km)`, long: L });
    }
    if (r.sim.limited.length) out.blockers.push({ rule: 'weekly', text: `Reglen om ugentlige km (højst +4 km/uge under 30 km, ellers ca. 10 %) holder langturen tilbage i ${r.sim.limited.length === 1 ? 'en uge' : r.sim.limited.length + ' uger'}.` });
  }
  // hvad bremsede, hvis de strenge regler ikke er nok?
  if (!strictRun.allOk) {
    for (const { block, r, bo } of strictRun.res) {
      if (block.type === 'other' || block.msIdx == null || okBlock(block, r.sim, bo)) continue;
      const ms = block.msIdx, L = r.sim.rows[ms].L;
      if (block.type === 'tgc') out.blockers.push({ rule: 'step', text: `Med højst +2 km pr. uge på langturen når du kun ${fmtKm(L)} km før Transgrancanaria (mål ${TGC_LONG.min} km).` });
      else {
        const start = r.sim.rows.find((x) => x.kind === 'build');
        out.blockers.push({ rule: 'marathon', text: `Efter Transgrancanaria starter langturen på 90 % (${fmtKm(start ? start.L : 0)} km). Med højst +2 km pr. uge og en cutback-uge når du kun ${fmtKm(L)} km ca. 3 uger før marathon (mål ${MAR_LONG.final} km).` });
      }
    }
  }
  return out;
}

// ---------- En uge ud fra skabelonen ----------
const EASY_DESC = 'Rolig Z2';
const restDay = () => ({ kind: 'rest', description: 'Hviledag (gåtur/mobilitet er fint)' });
function easyItem(km, desc = EASY_DESC) { return { kind: 'run', type: 'easy', km, description: desc, zone: 'Z2' }; }
const scaleElevText = (d, e) => (d || '').replace(/≈\s*[\d.]+\s*højdemeter/g, `≈${e} højdemeter`);

function shapeRuns(src, curveK, T, warnings, opt = {}) {
  // Returnerer en kopi af ugens dage, hvor løbene er tilpasset ugens km (K); styrke røres ikke her
  const days = clone(src.days);
  const f = T > 0 ? curveK / T : 1;
  let runs = [];
  days.forEach((d) => d.items.forEach((it) => { if (it.kind === 'run' && it.type !== 'race' && !it.optional) runs.push({ d, it }); }));
  for (const { it } of runs) delete it.test; // 5 km-testen placeres bagefter
  // 1) kvalitetspas og langtur fjernes eller nedgraderes aldrig for at få km til at passe – de rolige ture justeres først
  if (!opt.longKm && Math.abs(f - 1) < 0.03) return days; // skabelonens uge, uændret
  // 2) antal løb: ved få km færre og længere ture (langturen bevares)
  const maxRuns = curveK < 11 ? 2 : curveK < 15 ? 3 : runs.length;
  if (runs.length > maxRuns) {
    const prio = (r) => (r.it.type === 'long' ? 100 : r.it.type === 'quality' ? 50 : r.it.type === 'hills' ? 40 : 10) + (r.it.km || 0) / 100;
    const keep = [...runs].sort((a, b) => prio(b) - prio(a)).slice(0, maxRuns);
    for (const r of runs) if (!keep.includes(r)) { r.d.items = r.d.items.filter((x) => x !== r.it); }
    runs = runs.filter((r) => keep.includes(r));
  }
  // 3) km: langturen følger sin egen progression (opt.longKm); resten fordeles efter skabelonens andele
  const minOf = (it) => (it.type === 'long' ? 5 : it.type === 'quality' ? (/strides/i.test(it.description || '') && !/min|×\d* ?km|bakke/i.test((it.description || '').replace(/6×20 sek strides/g, '')) ? 3 : 5) : 3);
  const longRun = opt.longKm ? runs.find((r) => r.it.type === 'long') : null;
  if (longRun) {
    longRun.it.km = Math.min(round05(opt.longKm), Math.max(3, curveK));
    let others = runs.filter((r) => r !== longRun);
    const rest = () => Math.max(0, curveK - longRun.it.km);
    // for få km til de øvrige løb: drop det mindst vigtige (kvalitet bevares helst)
    while (others.length && rest() < others.reduce((a, r) => a + minOf(r.it), 0)) {
      const drop = [...others].sort((a, b) => (a.it.type === 'quality' ? 1 : 0) - (b.it.type === 'quality' ? 1 : 0) || (a.it.km || 0) - (b.it.km || 0))[0];
      drop.d.items = drop.d.items.filter((x) => x !== drop.it);
      others = others.filter((r) => r !== drop);
    }
    if (others.length) {
      const tpl2 = others.map((r) => r.it.km || 0), t2 = tpl2.reduce((a, b) => a + b, 0) || 1;
      others.forEach((r, i) => { r.it.km = Math.max(minOf(r.it), round05(rest() * (tpl2[i] / t2))); });
      const big = others.reduce((b, r) => (!b || r.it.km > b.it.km ? r : b), null);
      const diff = rest() - others.reduce((a, r) => a + r.it.km, 0);
      if (Math.abs(diff) >= 0.5) big.it.km = Math.max(minOf(big.it), round05(big.it.km + diff));
    } else if (curveK - longRun.it.km >= 1) longRun.it.km = round05(curveK);
    runs = runs.filter((r) => r === longRun || others.includes(r));
  } else {
    const tpl = runs.map((r) => r.it.km || 0), tsum = tpl.reduce((a, b) => a + b, 0) || 1;
    runs.forEach((r, i) => { r.it.km = Math.max(minOf(r.it), round05(curveK * (tpl[i] / tsum))); });
    const sum = () => runs.reduce((s2, r) => s2 + r.it.km, 0);
    const longest = runs.reduce((b, r) => (!b || r.it.km > b.it.km ? r : b), null);
    if (longest) longest.it.km = Math.max(minOf(longest.it), round05(longest.it.km + (curveK - sum())));
  }
  // 4) højdemeter skaleres (langturen i trailblokken får sit eget mål)
  const ef = Math.min(1, f);
  for (const { it } of runs) {
    if (opt.longElev && it.type === 'long') {
      it.elevation_m = opt.longElev;
      it.description = /≈\s*[\d.]+\s*højdemeter/.test(it.description || '') ? scaleElevText(it.description, opt.longElev) : `${it.description || 'Trail'} · Mål: ≈${opt.longElev} højdemeter – find kuperet terræn, eller løb blokke på løbebånd med 8–10 % stigning.`;
    } else if (it.elevation_m) {
      const e = Math.round((it.elevation_m * ef) / 10) * 10;
      if (e < 50) delete it.elevation_m; else { it.elevation_m = e; it.description = scaleElevText(it.description, e); }
    }
  }
  return days;
}

function lighten(items, mode) {
  // Styrkepas lettes: færre sæt, RIR 3
  return items.map((it) => {
    if (it.kind !== 'strength') return it;
    const c = clone(it);
    c.exercises = c.exercises.map((x) => ({ ...x, sets: mode === 'deload' ? Math.max(1, Math.ceil(x.sets / 2)) : Math.max(1, x.sets - 1), rir: '3' }));
    c.note = mode === 'deload' ? 'Deload: lettere vægt, ingen sæt tæt på failure.' : 'Genstart: let pas, hold RIR 3.';
    return c;
  });
}

// Styrkepas for en uge: vælg 3 eller 4 pas ud fra skabelonens
function shapeStrength(days, perWeek, { eased, deload, srcDeload }) {
  const names = ['Upper (mandag)', 'Lower', 'Upper (fredag)'];
  const present = days.flatMap((d) => d.items.filter((i) => i.kind === 'strength' && !i.light).map((i) => i.session));
  let keep = names.filter((n) => present.includes(n));
  const max = eased ? Math.min(3, perWeek) : perWeek;
  while (keep.length > max) keep = keep.slice(0, -1);
  for (const d of days) {
    d.items = d.items.filter((i) => i.kind !== 'strength' || i.light || keep.includes(i.session));
    if (eased) d.items = d.items.map((i) => (i.kind === 'strength' && !i.light ? { ...i, exercises: i.exercises.map((x) => ({ ...x, rir: '3' })) } : i));
    if (deload && !srcDeload) d.items = lighten(d.items, 'deload');
  }
  return days;
}

// ---------- Startuge (fra startdatoen til søndag) ----------
function startWeekDays(curDays, tplSrc, start, isBlocked, startKm) {
  const days = clone(curDays);
  for (const d of days) if (d.date >= start) d.items = [];
  const avail = days.filter((d) => d.date >= start && !isBlocked(d.date));
  const nRuns = Math.min(startKm >= 9 ? 3 : 2, avail.length >= 5 ? 3 : avail.length >= 3 ? 2 : avail.length >= 1 ? 1 : 0);
  const pos = nRuns === 3 ? [0, Math.floor((avail.length - 1) / 2), avail.length - 1] : nRuns === 2 ? [0, avail.length - 1] : [0];
  const shares = nRuns === 3 ? [0.3, 0.3, 0.4] : nRuns === 2 ? [0.45, 0.55] : [1];
  const runDays = [...new Set(pos)].map((p) => avail[p]);
  const km = shares.map((s) => Math.max(3, round05(startKm * s)));
  runDays.forEach((d, i) => d.items.push(easyItem(km[i], i === runDays.length - 1 && nRuns > 1 ? `${EASY_DESC} – lidt længere, hold det helt roligt` : EASY_DESC)));
  // ét let styrkepas (Upper) på en dag mellem løbene
  const upper = tplSrc.days.flatMap((d) => d.items).find((i) => i.kind === 'strength' && /upper/i.test(i.session));
  if (upper && avail.length) {
    const sd = avail[Math.min(1, avail.length - 1)];
    const item = lighten([clone(upper)], 'start')[0];
    sd.items.unshift(item);
  }
  // hviledage
  for (const d of days) if (d.date >= start && !d.items.length) d.items.push({ kind: 'rest', description: 'Hviledag (gåtur/mobilitet er fint)' });
  return { days, runKm: runDays.reduce((s, _, i) => s + km[i], 0) };
}

// ---------- Flyt pas væk fra utilgængelige dage uden regelbrud ----------
export function relocate(weeks, wi, isBlocked, floorDate, warnings) {
  const w = weeks[wi];
  // pas med højest prioritet placeres først, så det laveste prioriterede er det, der udelades (langtur → kvalitet → Lower → Upper → rolige ture → Skulder & arm)
  const todo = [];
  for (const d of w.days) if (d.date >= floorDate && isBlocked(d.date)) for (const it of d.items) if (it.kind !== 'rest' && !(it.kind === 'run' && it.type === 'race')) todo.push({ d, it });
  todo.sort((a, b) => P.priorityOf(a.it) - P.priorityOf(b.it));
  for (const { d, it } of todo) {
    {
      const before = new Set(violationsOf(weeks));
      const cand = w.days.filter((x) => x.date >= floorDate && x.date !== d.date && !isBlocked(x.date)
        && !(it.kind === 'run' && x.items.some((i) => i.kind === 'run')) && !(it.kind === 'strength' && x.items.some((i) => i.kind === 'strength')))
        .sort((a, b) => Math.abs(P.daysBetween(d.date, a.date)) - Math.abs(P.daysBetween(d.date, b.date)));
      let placed = false;
      d.items = d.items.filter((i) => i !== it);
      for (const c of cand) {
        c.items.push(it);
        const after = violationsOf(weeks);
        if (after.every((v) => before.has(v))) { placed = true; break; }
        c.items.pop();
      }
      if (!placed) {
        warnings.push(`${it.kind === 'run' ? `${it.km} km ${it.type === 'long' ? 'langtur' : it.type === 'quality' ? 'kvalitet' : 'rolig tur'}` : it.session} ${P.fmtDateShort(d.date)} kunne ikke flyttes (utilgængelig dag) og er udeladt – ${P.priorityLabel(it)}, så det laveste prioriterede fjernes først`);
      }
    }
    if (!d.items.length) d.items.push({ kind: 'rest', description: 'Hviledag (gåtur/mobilitet er fint)' });
  }
  // hviledage skal ikke stå ved siden af pas
  for (const d of w.days) if (d.items.length > 1) d.items = d.items.filter((i) => i.kind !== 'rest');
}

// ---------- Ret regelbrud ved at bytte dage inden for ugen ----------
// Prøver at bytte indholdet af to dage (eller flytte ét pas til en hviledag), så færre regler brydes. Returnerer mondage for ændrede uger.
export function repairWeeks(weeks, floor, isBlocked = () => false) {
  const changed = new Set();
  const count = () => violationsOf(weeks).length;
  const movable = (d) => d.date >= floor && !isBlocked(d.date) && !d.items.some((i) => i.kind === 'run' && i.type === 'race' || i.test);
  for (const w of weeks) {
    if (w.days[6].date < floor) continue;
    for (let iter = 0; iter < 8; iter++) {
      const base = count();
      if (!base) break;
      let best = null;
      for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
        const da = w.days[a], db = w.days[b];
        if (!movable(da) || !movable(db)) continue;
        const ia = da.items, ib = db.items;
        da.items = ib; db.items = ia;
        const c = count();
        da.items = ia; db.items = ib;
        if (c < base && (!best || c < best.c)) best = { a, b, c };
      }
      if (!best) break;
      const da = w.days[best.a], db = w.days[best.b];
      [da.items, db.items] = [db.items, da.items];
      changed.add(w.start);
    }
  }
  for (const w of weeks) w.run_km = weekKm(w);
  return [...changed];
}

// ---------- Hele planen ----------
// inputs: { template, current, start, recentKm, recentLong, recentStrength, strengthPerWeek, blockedWeekdays, blockedDates }
export function generatePlan(inputs) {
  const { template, current, start } = inputs;
  const perWeek = 3; // 3 styrkepas: Upper (man), Lower (ons), Upper (fre)
  const warnings = [];
  const raceDates = new Set((template.goals || []).map((g) => g.date));
  const blockedWd = new Set(inputs.blockedWeekdays || []);
  const blockedDates = inputs.blockedDates || {};
  const isBlocked = (date) => !raceDates.has(date) && (blockedWd.has(dow(date)) || ['fly', 'off'].includes(blockedDates[date]));

  const tplWeeks = template.weeks;
  const startMonday = mondayOf(start);
  const fromIdx = tplWeeks.findIndex((w) => w.start >= startMonday);
  if (fromIdx < 0) return { error: 'Startdatoen ligger efter det sidste løb.' };
  const curByStart = new Map(current.weeks.map((w) => [w.start, w]));
  const kept = current.weeks.filter((w) => w.start < startMonday).map(clone);

  const base = Math.max(Number(inputs.recentKm) || 0, 6);
  // startuge: de første uger tilpasses, hvis startdatoen ligger i en uge, der allerede er i gang
  const partial = start > startMonday;
  const firstTpl = tplWeeks[fromIdx];
  const startWeekKm = Math.min(12, Math.max(10, Math.round(base * 0.8))); // startugen: ca. 10–12 km
  const curve = goalCurve(template, tplWeeks, partial ? fromIdx + 1 : fromIdx, { base, startWeekKm: partial ? startWeekKm : 0, recentLong: Number(inputs.recentLong) || 0, strict: !!inputs.strict, cautious: !!inputs.cautious });

  const out = [...kept];
  let relIdx = 0;
  // 1) startuge (delvis uge)
  if (partial) {
    const cur = curByStart.get(startMonday) || clone(firstTpl);
    const upperSrc = tplWeeks.find((x) => x.days.some((d) => d.items.some((i) => i.session === 'Upper (mandag)'))) || firstTpl;
    const s = startWeekDays(cur.days, upperSrc, start, isBlocked, startWeekKm);
    const w = { week: firstTpl.week, start: startMonday, phase: firstTpl.phase, deload: false, run_km: 0, days: s.days };
    w.run_km = weekKm(w);
    out.push(w);
    relIdx = 1;
  }
  // 2) fulde uger
  curve.rows.forEach((cv, ci) => {
    const tw = tplWeeks.find((x) => x.start === cv.start);
    const eased = (partial ? ci === 0 : ci === 0);
    let days = shapeRuns(cv.src, cv.K, cv.T || 1, warnings, { longKm: cv.L, longElev: cv.longElev });
    // dato for dagene = den uges egne datoer (src kan være en anden uge, når deload-mønsteret afviger)
    days = days.map((d, i) => ({ ...d, date: tw.days[i].date, weekday: tw.days[i].weekday }));
    // styrke fra skabelonens uge (samme dato), men ikke deload-versionen, hvis vi ikke har deload
    const strengthSrc = tw.deload === cv.deload ? tw : cv.src;
    const sDays = clone(strengthSrc.days);
    const restOf = (i) => tw.days[i].items.filter((x) => x.kind === 'rest').slice(0, 1);
    days = days.map((d, i) => {
      const st = sDays[i].items.filter((x) => x.kind === 'strength');
      const runs = d.items.filter((x) => x.kind === 'run' && x.type !== 'race');
      const race = tw.days[i].items.filter((x) => x.kind === 'run' && x.type === 'race').map(clone);
      const items = [...st, ...runs, ...race];
      return { ...d, items: items.length ? items : (restOf(i).length ? clone(restOf(i)) : [restDay()]) };
    });
    days = shapeStrength(days, perWeek, { eased, deload: cv.deload, srcDeload: strengthSrc.deload });
    days.forEach((d) => { if (!d.items.length) d.items = [restDay()]; });
    const w = { week: tw.week, start: tw.start, phase: tw.phase, deload: cv.deload, run_km: 0, days };
    const elevSum = runsOf(w).reduce((a, r) => a + (r.elevation_m || 0), 0);
    if (elevSum) w.elevation_m = Math.round(elevSum / 10) * 10;
    w.run_km = weekKm(w);
    out.push(w);
  });

  // 3) 5 km-testen: relativ uge 6–8 fra startugen
  placeTest(out, template, startMonday, relIdx, partial);

  // 4) utilgængelige dage
  const floor = start;
  out.forEach((w, wi) => { if (w.start >= startMonday) relocate(out, wi, isBlocked, floor, warnings); });
  for (const w of out) w.run_km = weekKm(w);

  // 4b) ret regelbrud (dine hybrid-regler) ved at bytte dage i ugen
  repairWeeks(out.filter((w) => w.start >= startMonday), start, isBlocked);

  // 5) kontrol
  const viol = violationsOf(out.filter((w) => w.start >= startMonday));
  for (const v of viol) warnings.push(`Regelbrud: ${v}`);
  const summary = summarize(out, template, start);
  if (summary.longBeforeMarathon != null && summary.longBeforeMarathon < MIN_LONG_BEFORE_MARATHON) {
    warnings.unshift(`Den længste tur før marathon bliver kun ${String(summary.longBeforeMarathon).replace('.', ',')} km (anbefalet mindst ${MIN_LONG_BEFORE_MARATHON} km). Start tidligere, eller accepter en mere forsigtig marathon.`);
  }
  return { weeks: out, summary, warnings, startMonday, goals: curve.check, relaxations: curve.relaxations };
}

function placeTest(weeks, template, startMonday, relIdx, partial) {
  const tplTest = template.weeks.flatMap((w) => w.days.flatMap((d) => d.items.map((i) => ({ w, d, i })))).find((x) => x.i.test === '5k');
  if (!tplTest) return;
  const gen = weeks.filter((w) => w.start >= startMonday);
  const rel = (w) => gen.indexOf(w) + 1; // relativ uge 1 = startugen
  const okWeek = (w) => rel(w) >= 6 && rel(w) <= 8 && !/Løbsuge|Nedtrapning|Restitution/.test(w.phase);
  // en frisk uge (ikke deload) i relativ uge 6–8; ellers den uge, skabelonen har; ellers uge 7
  const target = gen.find((w) => okWeek(w) && !w.deload) || gen.find(okWeek) || gen[Math.min(gen.length - 1, 6)];
  if (!target) return;
  const runs = target.days.flatMap((d) => d.items.filter((i) => i.kind === 'run' && i.type !== 'race').map((i) => ({ d, i })));
  // testen lægges på kvalitetsdagen (tirsdag i den nye struktur), ellers tirsdag/onsdag, ellers midt på ugen
  const pick = runs.find((x) => x.i.type === 'quality') || runs.find((x) => dow(x.d.date) === 2) || runs.find((x) => dow(x.d.date) === 3) || runs[Math.floor(runs.length / 2)];
  if (!pick) return;
  const weekTarget = weekKm(target);
  const small = weekTarget < 16;
  const desc = small ? tplTest.i.description.replace(/2 km rolig opvarmning/g, '1 km rolig opvarmning').replace(/2 km rolig nedvarmning/g, '1 km rolig nedvarmning') : tplTest.i.description;
  const testKm = small ? 7 : 9;
  Object.assign(pick.i, { type: 'quality', zone: 'Z4', km: testKm, description: desc, test: '5k' });
  delete pick.i.elevation_m;
  // resten af ugen lettes, så ugens km ikke vokser pga. testen: fjern/forkort de øvrige løb
  let others = runs.filter((x) => x !== pick);
  const ordered = () => others.sort((a, b) => (a.i.type === 'long' ? 1 : 0) - (b.i.type === 'long' ? 1 : 0) || a.i.km - b.i.km);
  while (weekKm(target) > weekTarget + 1 && others.length > 1) {
    const r = ordered()[0];
    const room = r.i.km - 3;
    if (room >= 1) r.i.km = Math.max(3, round05(r.i.km - Math.min(room, weekKm(target) - weekTarget))); else { r.d.items = r.d.items.filter((x) => x !== r.i); others = others.filter((x) => x !== r); }
    if (others.every((o) => o.i.km <= 3)) break;
  }
  for (const d of target.days) if (!d.items.length) d.items = [restDay()];
}

// ---------- Opsummering til forhåndsvisning ----------
export function summarize(weeks, template, start) {
  const goals = (template.goals || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const mar = goals.find((g) => /marathon/i.test(g.name)), tgc = goals.find((g) => /Transgrancanaria/i.test(g.name));
  const wks = (d) => Math.max(0, Math.ceil(P.daysBetween(start, d) / 7));
  const startMonday = mondayOf(start);
  const gen = weeks.filter((w) => w.start >= startMonday);
  const normal = gen.filter((w) => !runsOf(w).some((r) => r.type === 'race'));
  let peak = null;
  for (const w of normal) { const k = weekKm(w); if (!peak || k > peak.km) peak = { km: k, week: w.week, start: w.start }; }
  const longs = (until) => gen.filter((w) => !until || w.start < until).flatMap((w) => w.days.flatMap((d) => d.items.filter((i) => i.kind === 'run' && i.type === 'long').map((i) => ({ km: i.km, date: d.date }))));
  const marMonday = mar ? mondayOf(mar.date) : null;
  const lm = longs(marMonday).sort((a, b) => b.km - a.km)[0] || null;
  const lt = tgc ? longs(mondayOf(tgc.date)).sort((a, b) => b.km - a.km)[0] || null : null;
  const elevOf = (w) => w.elevation_m || w.days.reduce((s, d) => s + d.items.reduce((a, i) => a + (i.kind === 'run' && i.type !== 'race' ? i.elevation_m || 0 : 0), 0), 0);
  let elevPeak = null;
  for (const w of normal) { const e = elevOf(w); if (e && (!elevPeak || e > elevPeak.m)) elevPeak = { m: e, week: w.week, start: w.start }; }
  return {
    weeksToTransgrancanaria: tgc ? wks(tgc.date) : null, weeksToMarathon: mar ? wks(mar.date) : null, tgcDate: tgc ? tgc.date : null, marDate: mar ? mar.date : null,
    weekly: gen.map((w) => { const lg = runsOf(w).filter((r) => r.type === 'long').sort((a, b) => b.km - a.km)[0]; return { week: w.week, start: w.start, phase: w.phase, deload: w.deload, km: weekKm(w), elev: elevOf(w) || null, race: runsOf(w).some((r) => r.type === 'race'), long: lg ? lg.km : null, longElev: lg && lg.elevation_m ? lg.elevation_m : null }; }),
    peak, longBeforeMarathon: lm ? lm.km : null, longBeforeMarathonDate: lm ? lm.date : null, longBeforeTransgrancanaria: lt ? lt.km : null,
    elevPeak, deloads: gen.filter((w) => w.deload).length,
  };
}

// ---------- Tilpas ugen ----------
export const WEEK_TYPES = [['normal', 'Normal'], ['busy', 'Travl'], ['exam', 'Eksamen'], ['trip', 'Rejse'], ['sick', 'Syg']];
// Ugens dage omformes efter ugetype. days: [{date, weekday, items}] (kun dage fra og med floor ændres)
export function reshapeWeek(days, type, { floor, volume = 0.6, refKm = null } = {}) {
  const out = clone(days);
  const editable = (d) => d.date >= floor;
  if (type === 'sick') {
    for (const d of out) if (editable(d)) d.items = [{ kind: 'rest', description: 'Syg – hvile. Ingen træning ved feber eller symptomer under halsen.' }];
    return out;
  }
  if (type === 'normal') return out;
  const mode = type === 'back' ? 'back' : 'busy';
  const runs = [];
  out.forEach((d) => d.items.forEach((it) => { if (it.kind === 'run' && it.type !== 'race' && editable(d) && !it.optional) runs.push({ d, it }); }));
  const tplKm = runs.reduce((s2, r) => s2 + (r.it.km || 0), 0);
  const target = (refKm != null ? refKm : tplKm) * volume;
  if (mode === 'busy') {
    // travl uge: de rolige ture kortes først – langtur og kvalitetspas bevares (kvalitet og langtur nedgraderes aldrig for at få km til at passe)
    const keepKm = runs.filter((r) => r.it.type === 'long' || r.it.type === 'quality').reduce((s2, r) => s2 + r.it.km, 0);
    const easy = runs.filter((r) => r.it.type !== 'long' && r.it.type !== 'quality');
    const easyKm = easy.reduce((s2, r) => s2 + r.it.km, 0);
    const g = easyKm ? Math.max(0.4, Math.min(1, (target - keepKm) / easyKm)) : 1;
    for (const { it } of easy) { it.km = Math.max(3, round05(it.km * g)); if (it.type === 'hills') { it.type = 'easy'; it.zone = 'Z2'; it.description = `${EASY_DESC} (tilpasset)`; delete it.elevation_m; } }
    for (const d of out) if (editable(d)) d.items = d.items.filter((it) => !(it.kind === 'run' && it.optional)); // valgfrie ture udgår
  } else {
    // alle løbene bliver rolige; ugens km = volume × (referenceuge eller planen)
    const f = tplKm ? target / tplKm : 1;
    for (const { it } of runs) {
      if (it.type !== 'easy' && it.type !== 'long') { it.type = 'easy'; it.zone = 'Z2'; it.description = `${EASY_DESC} (tilpasset: ingen intervaller)`; delete it.elevation_m; }
      else if (it.type === 'long') it.description = `${EASY_DESC}`.trim();
      delete it.test;
      it.km = Math.max(3, round05((it.km || 0) * f));
      if (it.elevation_m) { it.elevation_m = Math.round((it.elevation_m * Math.min(1, f)) / 10) * 10; if (it.elevation_m < 50) delete it.elevation_m; else it.description = scaleElevText(it.description, it.elevation_m); }
    }
    // lange ture må ikke fylde mere end ca. 45 % af ugen
    const total = runs.reduce((s2, r) => s2 + r.it.km, 0);
    for (const { it } of runs) if (total && it.km / total > 0.45 && runs.length > 1) it.km = Math.max(3, round05(total * 0.45));
  }
  // styrke
  const keepNames = mode === 'busy' ? ['Upper (mandag)', 'Lower'] : null; // efter prioritet: Lower, så Upper (man); Upper (fre) udgår først
  for (const d of out) {
    if (!editable(d)) continue;
    d.items = d.items.filter((it) => {
      if (it.kind !== 'strength') return true;
      return !keepNames || keepNames.includes(it.session);
    }).map((it) => (it.kind === 'strength' && mode === 'back'
      ? { ...it, exercises: it.exercises.map((x) => ({ ...x, rir: '3' })), note: 'Tilbage efter pause: hold RIR 3.' } : it));
    if (!d.items.length) d.items = [restDay()];
  }
  // sørg for to styrkepas i travle uger (Upper + Lower), hvis skabelonen mangler et af dem
  return out;
}

// Dage uden pas får en hvile; dage med både pas og hvile får kun pas
export function tidyDays(days) {
  return days.map((d) => {
    const real = d.items.filter((i) => i.kind !== 'rest');
    return { ...d, items: real.length ? real : [restDay()] };
  });
}

// Pas på utilgængelige dage (til advarsler i ugevisningen)
export function conflictsOnBlocked(weeks, isBlocked, from) {
  const out = [];
  for (const w of weeks) for (const d of w.days) {
    if (d.date < from || !isBlocked(d.date)) continue;
    if (d.items.some((i) => i.kind !== 'rest' && !(i.kind === 'run' && i.type === 'race'))) out.push(d.date);
  }
  return out;
}

// ---------- Den effektive plan: skabelon + aktiv version + ugeændringer ----------
export function mergePlan(base, version, edits, program, custom, runProg) {
  let weeks = base.weeks;
  if (version && Array.isArray(version.weeks)) {
    const m = new Map(version.weeks.map((w) => [w.start, w]));
    weeks = weeks.map((w) => m.get(w.start) || w);
  }
  if (program) weeks = applyProgram(weeks, program);
  if (runProg) weeks = applyRunProgram(weeks, runProg);
  if (edits && edits.length) {
    const em = new Map(edits.map((e) => [e.id, e]));
    weeks = weeks.map((w) => {
      const e = em.get(w.start);
      if (!e || !e.days) return w;
      const nw = { ...w, days: w.days.map((d) => (e.days[d.date] ? { ...d, items: e.days[d.date] } : d)), edit_type: e.week_type };
      nw.run_km = weekKm(nw);
      return nw;
    });
  }
  if (custom && custom.length) weeks = applyCustom(weeks, custom);
  return { ...base, weeks };
}
