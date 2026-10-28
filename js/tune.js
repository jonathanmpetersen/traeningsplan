// Justér løbeplanen selv: km og intensitet pr. pas, niveau for hele planen og advarsler. Rene funktioner uden DOM.
import * as P from './plan.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const round05 = (v) => Math.round(v * 2) / 2;
const MIN_KM = 3;
export const STRIDES = '6×20 sek strides';
const UP = 'Inkl. 2 km op- og nedvarmning. ';

// Intensitetstrin for kvalitetsdagen: strides → fartlek → tærskel → bakker/1 km
export const LADDER = [
  { id: 'strides', label: 'Strides', type: 'easy', zone: 'Z2', desc: `Rolig Z2 + ${STRIDES} (let kvalitetsdag)` },
  { id: 'fartlek', label: 'Fartlek', type: 'quality', zone: 'Z4', desc: UP + 'Fartlek: 6×(1 min hurtigt / 1 min roligt), RPE 7 – kontrolleret, komfortabelt hårdt.' },
  { id: 'tempo', label: 'Tærskel', type: 'quality', zone: 'Z4', desc: UP + 'Tærskel: 3×8 min (RPE 7), 2 min jog pause.' },
  { id: 'bakker', label: 'Bakker', type: 'quality', zone: 'Z4', desc: 'Opvarmning 10 min på 1 % (løbebånd). Korte bakker på løbebånd: 8×45 sek på 6–8 % stigning, RPE 8; pause 75–90 sek gang/let jog på 1 %. Alternativ: trapper – gå op, løb kontrolleret ned. Nedvarmning 10 min på 1 %.' },
];

const isRun = (it) => it && it.kind === 'run' && it.type !== 'race' && !it.test;
const hasStrides = (it) => /strides/i.test(it.description || '');

// Hvilket trin på stigen er passet (null = kan ikke justeres i intensitet)
export function levelOf(it) {
  if (!isRun(it)) return null;
  const d = it.description || '';
  if (it.type === 'easy') return it.strides_day || /strides \(let kvalitetsdag|deload/i.test(d) ? 0 : null;
  if (it.type !== 'quality') return null;
  if (/fartlek/i.test(d)) return 1;
  if (/tærskel/i.test(d)) return 2;
  if (/bakker|1 km|MP/i.test(d)) return 3;
  return /strides/i.test(d) ? 0 : null;
}

// Hvad "Lettere" / "Hårdere" vil gøre ved passet (tekst til knapperne), eller null hvis det ikke kan
export function intensityOptions(it) {
  if (!isRun(it) || it.type === 'long' || it.type === 'hills') return { easier: null, harder: null };
  if (it.type === 'easy' && levelOf(it) == null) {
    return { easier: hasStrides(it) ? 'Fjern strides' : null, harder: hasStrides(it) ? null : 'Tilføj strides' };
  }
  const l = levelOf(it);
  if (l == null) return { easier: null, harder: null };
  return { easier: l > 0 ? LADDER[l - 1].label : null, harder: l < LADDER.length - 1 ? LADDER[l + 1].label : null };
}

function tuned(it, orig) {
  const c = clone(it);
  c.tuned = true;
  c.tune_orig = it.tune_orig || (() => { const o = clone(orig); delete o.tune_orig; return o; })();
  return c;
}

export function tweakKm(it, d) {
  if (!isRun(it)) return null;
  const km = Math.max(MIN_KM, round05((Number(it.km) || 0) + d));
  if (km === it.km) return null;
  const c = tuned(it, it);
  c.km = km;
  if (c.base_km != null) c.base_km = Math.max(MIN_KM, round05(c.base_km + d));
  return c;
}

export function stepIntensity(it, dir) {
  const o = intensityOptions(it);
  if ((dir > 0 && !o.harder) || (dir < 0 && !o.easier)) return null;
  const c = tuned(it, it);
  if (it.type === 'easy' && levelOf(it) == null) {
    if (dir > 0) c.description = `${(it.description || 'Rolig Z2').replace(/\.$/, '')} + ${STRIDES} efter turen`;
    else c.description = (it.description || '').replace(/\s*\+\s*\d+×\d+ sek strides[^.]*/i, '').replace(/\s*\(?strides\)?/i, '').trim() || 'Rolig Z2';
    return c;
  }
  const t = LADDER[levelOf(it) + dir];
  c.type = t.type; c.zone = t.zone; c.description = t.desc;
  if (t.id === 'strides') c.strides_day = true; else delete c.strides_day;
  delete c.elevation_m;
  return c;
}

export function resetTune(it) {
  if (!it || !it.tune_orig) return null;
  return clone(it.tune_orig);
}

// ---------- Niveau for hele planen ----------
export const LEVELS = Array.from({ length: 11 }, (_, i) => -20 + i * 5); // −20 % … +30 %
// Milepælene holdes: langture på mindst 20 km med mindst 800 hm (Transgrancanaria) og langture på 28 km eller mere (marathon)
export const isMilestoneLong = (it) => it.kind === 'run' && it.type === 'long' && ((it.km >= 20 && (it.elevation_m || 0) >= 800) || it.km >= 28);
const kmOf = (w, opts = {}) => w.days.reduce((s, d) => s + d.items.reduce((t, i) => t + (i.kind === 'run' && !i.optional && (opts.race || i.type !== 'race') ? (i.km || 0) : 0), 0), 0);

// Skalerer rolige ture og kvalitetspas med pct, og langturen med samme procent (milepæle holdes).
// Gentagne skaleringer regnes altid ud fra grundkm (base_km), så niveauet kan ændres frit og 0 % giver planen tilbage.
export function scaleWeeks(weeks, pct, from) {
  const f = 1 + pct / 100;
  const mods = {};
  const rows = [];
  for (const w of weeks) {
    if (w.days[6].date < from) continue;
    let before = 0, after = 0, held = false;
    for (const d of w.days) {
      if (d.date < from) continue;
      let changed = false;
      const items = d.items.map((it) => {
        if (!isRun(it)) return it;
        const base = it.base_km != null ? it.base_km : it.km;
        before += it.optional ? 0 : it.km;
        let km = round05(base * f);
        if (isMilestoneLong({ ...it, km: base })) { km = base; held = true; }
        km = Math.max(MIN_KM, km);
        after += it.optional ? 0 : km;
        if (km === it.km && (pct === 0 ? it.base_km == null : it.base_km === base)) return it;
        changed = true;
        const c = clone(it);
        c.km = km;
        if (pct === 0) delete c.base_km; else c.base_km = base;
        return c;
      });
      if (changed) mods[d.date] = items;
    }
    rows.push({ start: w.start, phase: w.phase, deload: !!w.deload, before: Math.round(before * 10) / 10, after: Math.round(after * 10) / 10, held });
  }
  return { mods, rows };
}

// ---------- Advarsler (blokerer aldrig) ----------
const fmt = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
// actualKm: { 'YYYY-MM-DD'(mandag): løbet km } for afsluttede uger (valgfri; ellers bruges planen)
export function loadWarnings({ weeks, today, actualKm = {}, span = 4 }) {
  const out = [];
  const idx = weeks.findIndex((w) => w.days[6].date >= today);
  if (idx < 0) return out;
  const km = (w) => (actualKm[w.start] > 0 && w.days[6].date < today ? actualKm[w.start] : kmOf(w));
  for (let i = idx; i < Math.min(weeks.length, idx + span); i++) {
    const w = weeks[i];
    const total = kmOf(w);
    const label = `Uge fra ${P.fmtDateShort(w.start)}`;
    // 1) stigning i forhold til sidste uge (ved deload sammenlignes med den seneste uge uden deload)
    let prev = null;
    for (let j = i - 1; j >= 0; j--) { if (!weeks[j].deload && kmOf(weeks[j]) > 0) { prev = weeks[j]; break; } }
    if (prev && !w.deload) {
      const base = km(prev);
      if (base > 0 && total > base * 1.15) {
        out.push({ start: w.start, kind: 'rise', text: `${label}: ${fmt(total)} km er ${Math.round((total / base - 1) * 100)} % mere end ${prev.days[6].date < today ? 'sidste gennemførte uge' : 'ugen før'} (${fmt(base)} km). Over ca. 15 % øger risikoen for skader.` });
      }
    }
    // 2) langtur over 50 % af ugens km
    const longest = Math.max(0, ...w.days.flatMap((d) => d.items.filter((x) => x.kind === 'run' && x.type === 'long').map((x) => x.km || 0)));
    if (longest && total > 0 && longest / total > 0.5 && w.days.flatMap((d) => d.items).filter((x) => x.kind === 'run' && !x.optional).length >= 3) {
      out.push({ start: w.start, kind: 'long', text: `${label}: langturen på ${fmt(longest)} km er ${Math.round((longest / total) * 100)} % af ugens ${fmt(total)} km (over 50 %).` });
    }
    // 3) to kvalitetspas på dage i træk (også over ugegrænsen)
    const days = weeks.slice(Math.max(0, i - 1), i + 1).flatMap((x) => x.days);
    const hasQ = (d) => d.items.some((x) => x.kind === 'run' && x.type === 'quality');
    for (let k = 0; k < days.length - 1; k++) {
      if (days[k + 1].date >= w.start && days[k + 1].date <= w.days[6].date && hasQ(days[k]) && hasQ(days[k + 1])) {
        out.push({ start: w.start, kind: 'quality', text: `${label}: to kvalitetspas i træk (${P.fmtWeekday(days[k].date)} og ${P.fmtWeekday(days[k + 1].date)}).` });
      }
    }
  }
  return out;
}
