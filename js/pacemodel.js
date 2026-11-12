// Tempo-model: foreløbige tempoer (min/km-intervaller) ud fra dine seneste løb – indtil 5 km-testen giver rigtige tal.
// Rene funktioner uden DOM (testes i test_logic.mjs). Alle tempoer er sek/km som [hurtigste, langsomste].
// 5 km-form 27:30 er udgangspunktet. Alle tempoer er forhold til 5 km-tempoet (T5 ÷ 5), så de skalerer med formen.
export const DEFAULT_T5 = 27 * 60 + 30;
const RATIOS = {
  easy: [1.18, 1.32],      // 27:30 → 6:30–7:15
  mp: [1.06, 1.12],        // 5:50–6:10
  tempo: [0.985, 1.045],   // 5:25–5:45
  intervals: [0.924, 0.985], // 5:05–5:25
  short: [0.879, 0.939],   // 4:50–5:10 (korte intervaller)
  jog: [1.364, 1.455],     // 7:30–8:00 (pause mellem intervaller)
};
export const KEYS = Object.keys(RATIOS);
const r5 = (x) => Math.round(x / 5) * 5;

export function rangesFromT5(t5) {
  const p5 = t5 / 5;
  return Object.fromEntries(KEYS.map((k) => [k, [r5(p5 * RATIOS[k][0]), r5(p5 * RATIOS[k][1])]]));
}

export const fmtP = (sec) => { const s = Math.round(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const fmtRange = (r) => (!r ? '' : `${fmtP(r[0])}–${fmtP(r[1])}`);
export const parseP = (s) => { const p = String(s).trim().split(':').map(Number); return p.some(isNaN) ? null : p.reduce((a, x) => a * 60 + x, 0); };
export function parseRange(s) {
  if (s == null || s === '') return null;
  const parts = String(s).split(/[-–]/).map(parseP).filter((x) => x != null);
  if (!parts.length) return null;
  return parts.length === 1 ? [parts[0] - 5, parts[0] + 5] : [Math.min(...parts), Math.max(...parts)];
}

// config.paces (strenge, enkeltværdi eller "5:25-5:45") → intervaller. Mangler noget, udledes det af tærskel/rolig.
export function rangesFromConfigPaces(p) {
  if (!p) return null;
  const out = {};
  for (const [k, key] of [['easy', 'easy'], ['mp', 'mp'], ['threshold', 'tempo'], ['interval', 'intervals'], ['short', 'short'], ['jog', 'jog']]) {
    const r = parseRange(p[k]);
    if (r) out[key] = k === 'threshold' || k === 'mp' ? (String(p[k]).match(/[-–]/) ? r : [r[0] - 5, r[0] + 15]) : r;
  }
  if (!out.easy && !out.mp && !out.tempo) return null;
  const thr = out.tempo ? (out.tempo[0] + out.tempo[1]) / 2 : null;
  if (thr) {
    if (!out.intervals) out.intervals = [r5(thr - 30), r5(thr - 10)];
    if (!out.short) out.short = [r5(thr - 45), r5(thr - 25)];
  }
  if (!out.jog && out.easy) out.jog = [r5(out.easy[1] + 15), r5(out.easy[1] + 45)];
  return out;
}
// …og omvendt (til lagring i indstillingerne og config)
export function toPacesConfig(r) {
  const range = (x) => `${fmtP(x[0])}-${fmtP(x[1])}`;
  return { easy: range(r.easy), mp: range(r.mp), threshold: range(r.tempo), interval: range(r.intervals), short: range(r.short), jog: range(r.jog) };
}

// Bedste indsats (sekunder) på en distance i km – glidende vindue over omgangene, ellers turens gennemsnit
function bestAt(runs, d) {
  let best = null;
  for (const r of runs) {
    if (!r.km || !r.sec) continue;
    const sp = (Array.isArray(r.splits) ? r.splits : []).filter((x) => x && x.km > 0 && x.time_sec > 0);
    const put = (sec) => { if (sec > 0 && isFinite(sec) && (!best || sec < best.sec)) best = { sec: Math.round(sec), date: r.date }; };
    if (sp.length) {
      for (let i = 0; i < sp.length; i++) {
        let km = 0, sec = 0;
        for (let j = i; j < sp.length; j++) { km += sp[j].km; sec += sp[j].time_sec; if (km >= d * 0.99) { if (km <= d * 1.04) put((sec * d) / km); break; } }
      }
    } else if (r.km >= d * 0.99 && r.km <= d * 1.12) put((r.sec * d) / r.km);
  }
  return best;
}
const MILE2 = 3.21869;
const riegel = (t, d1, d2) => t * Math.pow(d2 / d1, 1.06);

// runs: [{ date, sec, km, splits?, type?, hr? }] (de seneste 4–6 uger). zones: pulszoner (til at genkende rolige ture i Z2).
// Returnerer { t5, basis:{ kind:'5k'|'2mile'|'easy'|'default', ... }, ranges } – det hurtigste (bedste) estimat vinder.
export function computeModel(runs, zones = null) {
  const ok = (runs || []).filter((r) => r.km >= 1.5 && r.sec > 0);
  const cands = [];
  const b5 = bestAt(ok, 5);
  if (b5) cands.push({ kind: '5k', t5: b5.sec, date: b5.date, detail: `bedste 5 km: ${fmtP(b5.sec)}` });
  const b2 = bestAt(ok, MILE2);
  if (b2) cands.push({ kind: '2mile', t5: riegel(b2.sec, MILE2, 5), date: b2.date, detail: `bedste 2 mile: ${fmtP(b2.sec)}` });
  // rolige ture i Z2: 5 km-tempo ≈ rolig ÷ 1,25 (rolig midte er ca. 25 % langsommere end 5 km-tempo)
  const inZ2 = (r) => !zones || !zones.Z2 || !r.hr || (r.hr >= zones.Z1[0] && r.hr <= zones.Z2[1]);
  const easyRuns = ok.filter((r) => r.type === 'easy' && r.km >= 3 && inZ2(r));
  if (easyRuns.length >= 2) {
    const paces = easyRuns.map((r) => r.sec / r.km).sort((a, b) => a - b), mid = paces[Math.floor(paces.length / 2)];
    cands.push({ kind: 'easy', t5: (mid / 1.25) * 5, detail: `rolige ture i Z2 (gns. ${fmtP(mid)}/km)` });
  }
  if (!cands.length) return { t5: DEFAULT_T5, basis: { kind: 'default', detail: '5 km-form ca. 27:30' }, ranges: rangesFromT5(DEFAULT_T5) };
  cands.sort((a, b) => a.t5 - b.t5);
  const best = cands[0], t5 = Math.round(best.t5);
  return { t5, basis: { kind: best.kind, date: best.date || null, detail: best.detail }, ranges: rangesFromT5(t5) };
}

// Vis et forslag, når den nye beregning er markant hurtigere end det, der bruges (≥ 2 %) – og du ikke allerede har afvist netop det
export function shouldSuggest(saved, computed) {
  if (!saved || !computed || saved.basis?.kind === 'default' || computed.basis.kind === 'default') return false;
  if (computed.t5 > saved.t5 * 0.98) return false;
  if (saved.dismissed_t5 && computed.t5 >= saved.dismissed_t5 * 0.99) return false;
  return true;
}

// ---------- Adaptiv form-model: kvalitetsblokke → tempo ved tærskelpuls, med bremser ----------
const TEMPO_MID = (RATIOS.tempo[0] + RATIOS.tempo[1]) / 2; // tempo-midten ≈ 1,015 × 5 km-tempoet
const BLOCK_MIN_SEC = 240;     // blokke under 4 min tæller ikke
const SEC_PER_BPM = 3;         // grov tommelfinger: 1 slag højere puls ≈ 3 sek/km hurtigere ved samme anstrengelse
export const MAX_STEP_SEC = 10; // højst 10 sek/km (på 5 km-tempoet) pr. ændring
export const MIN_DAYS_BETWEEN = 7;

// Er turen egnet? Ikke rolige ture/langture, ikke løbebånd/kraftig stigning, ikke dårlig GPS.
export function blocksOf(run, lthr) {
  const type = run.type;
  if (type === 'easy' || type === 'long' || type === 'race') return [];
  if (run.name && /løbebånd|treadmill|indendørs|indoor/i.test(run.name)) return [];
  const sp = (Array.isArray(run.splits) ? run.splits : []).filter((x) => x && x.km > 0 && x.time_sec > 0 && x.pace_sec_km > 0);
  if (!sp.length) return [];
  // GPS: urealistiske tempoer ⇒ ingen blokke fra turen
  if (sp.some((x) => x.pace_sec_km < 150 || x.pace_sec_km > 900)) return [];
  const sorted = sp.map((x) => x.pace_sec_km).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
  const out = [];
  for (const x of sp) {
    if (x.time_sec < BLOCK_MIN_SEC || !x.hr) continue;
    if (x.pace_sec_km > med * 0.95) continue;                        // kun de hurtige omgange (ikke opvarmning/pauser)
    if (x.elev != null && Math.abs(x.elev) / x.km > 25) continue;     // meget stigning/nedløb
    const adj = x.pace_sec_km + (x.hr - lthr) * SEC_PER_BPM;          // tempo ved tærskelpuls
    out.push({ date: run.date, pace: x.pace_sec_km, hr: x.hr, sec: x.time_sec, atLthr: adj });
  }
  return out;
}
// Én værdi pr. pas: varighedsvægtet tempo ved tærskelpuls → 5 km-tempo (sek/km)
export function passEstimates(runs, lthr) {
  const res = [];
  for (const r of runs || []) {
    const b = blocksOf(r, lthr); if (!b.length) continue;
    const w = b.reduce((s, x) => s + x.sec, 0), thr = b.reduce((s, x) => s + x.atLthr * x.sec, 0) / w;
    res.push({ date: r.date, id: r.id, thr: Math.round(thr), t5: Math.round((thr / TEMPO_MID) * 5), blocks: b.length, hrMax: Math.max(...b.map((x) => x.hr)), pace: Math.round(b.reduce((s, x) => s + x.pace * x.sec, 0) / w) });
  }
  return res.sort((a, b) => (a.date < b.date ? -1 : 1));
}
// Forslag: kræver 2–3 pas i træk i samme retning (≥ 1,5 %), nyere vægtes højere, højst MAX_STEP_SEC pr. ændring og ≥ 7 dage siden sidst.
// cur = { t5, changed_at }. Returnerer null eller { t5, from, direction, passes, capped, text }
export function adaptiveProposal(passes, cur, today) {
  if (!cur || !passes || passes.length < 2) return null;
  if (cur.changed_at) { const days = (new Date(today) - new Date(String(cur.changed_at).slice(0, 10))) / 864e5; if (days < MIN_DAYS_BETWEEN) return null; }
  const last = passes.slice(-3), thr = cur.t5 * 0.015;
  const dir = last.every((p) => p.t5 < cur.t5 - thr) ? -1 : last.every((p) => p.t5 > cur.t5 + thr) ? 1 : 0;
  if (!dir) return null;
  const w = (p) => Math.pow(0.5, (new Date(today) - new Date(p.date)) / 864e5 / 14);
  const avg = last.reduce((s, p) => s + p.t5 * w(p), 0) / last.reduce((s, p) => s + w(p), 0);
  let step = avg - cur.t5; const cap = MAX_STEP_SEC * 5; // sek på 5 km-tiden
  const capped = Math.abs(step) > cap; if (capped) step = Math.sign(step) * cap;
  const t5 = Math.round(cur.t5 + step);
  if (Math.abs(t5 - cur.t5) < 5) return null;
  return { t5, from: cur.t5, direction: dir, passes: last, capped };
}
// Fortæl hvad forslaget bygger på – på dansk
export function proposalText(p) {
  const n = p.passes.length, faster = p.direction < 0;
  return `Dine sidste ${n} tempopas tyder på, at du er ${faster ? 'hurtigere' : 'langsommere'} end tempoerne nu (${faster ? 'lavere puls eller hurtigere tempo' : 'højere puls ved samme tempo'}). 5 km-form: ${fmtP(p.from)} → ${fmtP(p.t5)}${p.capped ? ' (højst ca. 10 sek/km ad gangen)' : ''}.`;
}

// Feedback efter et kvalitetspas. target = [hurtigste, langsomste] sek/km, zones = pulszoner. Returnerer tekst eller null.
export function passFeedback(run, target, zones) {
  if (!target || !run) return null;
  const sp = (Array.isArray(run.splits) ? run.splits : []).filter((x) => x && x.time_sec > 0 && x.pace_sec_km > 0);
  const work = sp.filter((x) => x.time_sec >= 45 && x.pace_sec_km <= target[1] + 40);
  if (!work.length) return null;
  const w = work.reduce((s, x) => s + x.time_sec, 0), pace = work.reduce((s, x) => s + x.pace_sec_km * x.time_sec, 0) / w;
  const mid = (target[0] + target[1]) / 2, diff = Math.round(pace - mid);
  const hrs = work.map((x) => x.hr).filter(Boolean), hrMax = hrs.length ? Math.max(...hrs) : null;
  const z4 = zones && zones.Z4;
  if (diff <= -10) {
    const cap = hrMax ? Math.max(hrMax - 4, z4 ? z4[0] : 0) : null;
    return { kind: 'fast', diff, hrMax, text: `Du løb ${-diff} sek/km hurtigere end planlagt${hrMax ? ` med puls op til ${hrMax}` : ''} – tempo skal være komfortabelt hårdt.${cap ? ` Næste gang: hold pulsen under ca. ${cap}.` : ''}` };
  }
  if (diff >= 10) {
    const high = hrMax && z4 && hrMax >= z4[1];
    return { kind: 'slow', diff, hrMax, text: `Du løb ${diff} sek/km langsommere end planlagt${hrMax ? ` (puls op til ${hrMax})` : ''}.${high ? ' Pulsen var høj ved det tempo – det kan være træthed, så tempoerne bliver ikke sat op.' : ' Pulsen var ikke høj – du havde sandsynligvis luft til at holde tempoet.'}` };
  }
  return { kind: 'ok', diff, hrMax, text: `Tempoet lå tæt på planen (${diff === 0 ? '±0' : (diff > 0 ? '+' : '−') + Math.abs(diff)} sek/km)${hrMax ? `, puls op til ${hrMax}` : ''} ✓` };
}

// Omgange → rigtige km-splits (interpoleret ligeligt inden for hver omgang)
export function kmSplits(laps) {
  const L = (laps || []).filter((x) => x && x.km > 0 && x.time_sec > 0);
  const out = []; let cumKm = 0, cumT = 0, nextKm = 1, accT = 0, accKm = 0, hrW = 0, hrT = 0, elev = 0, hasElev = false;
  for (const l of L) {
    let remKm = l.km, remT = l.time_sec; const spd = l.time_sec / l.km;
    while (remKm > 1e-6) {
      const need = 1 - accKm, take = Math.min(need, remKm), t = take * spd;
      accKm += take; accT += t; remKm -= take; remT -= t;
      if (l.hr) { hrW += l.hr * t; hrT += t; }
      if (l.elev != null) { elev += l.elev * (take / l.km); hasElev = true; }
      if (accKm >= 0.999) { out.push({ km: out.length + 1, pace_sec_km: Math.round(accT), hr: hrT ? Math.round(hrW / hrT) : null, elev: hasElev ? Math.round(elev) : null }); accKm = 0; accT = 0; hrW = 0; hrT = 0; elev = 0; hasElev = false; }
    }
  }
  if (accKm >= 0.1) out.push({ km: out.length + 1, part: Math.round(accKm * 100) / 100, pace_sec_km: Math.round(accT / accKm), hr: hrT ? Math.round(hrW / hrT) : null, elev: hasElev ? Math.round(elev) : null });
  return out;
}
