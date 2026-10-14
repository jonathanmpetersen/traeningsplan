// Racedagsplan: pacing, ernæring og tidsestimat (rene funktioner + visning).
import * as P from './plan.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('da-DK', { maximumFractionDigits: d }));
const hms = (sec) => P.fmtDuration(Math.round(sec));

// Marathon: tider pr. 5 km ved jævnt tempo (eller let negativ split: første halvdel +3 s/km, anden −3 s/km)
export function marathonSplits(goalSec, negative = false) {
  const mp = goalSec / 42.195, out = [];
  const pace = (km) => (negative ? (km <= 21.0975 ? mp + 3 : mp - 3) : mp);
  let t = 0, prev = 0;
  const marks = [5, 10, 15, 20, 21.0975, 25, 30, 35, 40, 42.195];
  for (const km of marks) {
    // integrér tempoet over strækningen (tempoet skifter ved halvmarathon)
    let seg = 0, a = prev;
    while (a < km - 1e-9) {
      const b = Math.min(km, a < 21.0975 && km > 21.0975 ? 21.0975 : km);
      seg += (b - a) * pace(a + (b - a) / 2); a = b;
    }
    t += seg; prev = km;
    out.push({ km, label: km === 21.0975 ? 'Halvvejs' : km === 42.195 ? 'Mål' : `${km} km`, sec: t });
  }
  return out;
}

// Ernæring: kulhydrat pr. time, gel hver X. minut fra min. 30, drikke pr. 20 min
export function fuelPlan(totalSec, { carbPerHour = 60, gelCarb = 25, firstMin = 30 } = {}) {
  const everyMin = Math.round((gelCarb / carbPerHour) * 60);
  const gels = [];
  for (let m = firstMin; m < totalSec / 60 - 10; m += everyMin) gels.push(m);
  return { everyMin, gels, totalCarbs: Math.round(((gels.length * gelCarb))), drinkEveryMin: 20 };
}

// Trail: "anstrengelses-km" = distance + højdemeter/100 (hver 100 m op ≈ 1 km ekstra)
export function trailEstimate(km, elevM, easySecPerKm) {
  const effort = km + (elevM || 0) / 100;
  return { effort, low: effort * easySecPerKm, high: effort * (easySecPerKm + 30) };
}

export function raceHTML(c) {
  const t = c.today;
  const goals = (c.plan.goals || []).filter((g) => g.date >= t).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!goals.length) return `<h1 class="large-title">Racedag</h1><div class="card empty">Ingen kommende løb i planen.</div>`;
  const pc = P.paces(c.config);
  let h = `<h1 class="large-title">Racedag</h1><div class="subtitle">Pacing, ernæring og tidsestimat</div>`;
  for (const g of goals) {
    const days = P.daysBetween(t, g.date), isMar = /marathon/i.test(g.name) && !/half/i.test(g.name);
    h += `<div class="section-header">${esc(P.raceShortName ? P.raceShortName(g.name) : g.name)} · ${P.fmtDateLong(g.date)} · om ${days} dage</div>`;
    if (isMar) {
      const goal = P.parseDuration(c.config.marathon_goal_time);
      if (!goal) { h += `<div class="card empty">Sæt et marathonmål først: tag 5 km-testen (uge 8) og godkend forslaget, så laver appen pacing og ernæring ud fra det.</div>`; continue; }
      const sp = marathonSplits(goal), ng = marathonSplits(goal, true), fuel = fuelPlan(goal);
      h += `<div class="card"><div class="chart-caption"><b>Mål ${hms(goal)}</b><span> · ${P.fmtPace(goal / 42.195)}/km</span></div>
        <table class="perf"><thead><tr><th>Punkt</th><th>Jævnt</th><th>Let negativ</th></tr></thead><tbody>${sp.map((s, i) => `<tr><td>${s.label}</td><td><b>${hms(s.sec)}</b></td><td>${hms(ng[i].sec)}</td></tr>`).join('')}</tbody></table>
        <div class="meta" style="margin-top:8px">Start roligt: de første 3–5 km 5–10 sek/km langsommere end måltempoet. Let negativ split = første halvdel 3 sek/km over, anden halvdel 3 under.</div></div>
        <div class="card" style="margin-top:12px"><div class="chart-caption"><b>Ernæring</b><span> · ca. 60 g kulhydrat i timen</span></div>
        <ul class="race-list"><li>Gel (25 g) hver ${fuel.everyMin}. minut, første efter 30 min: <b>${fuel.gels.map((m) => `${m}`).join(', ')}</b> min</li>
        <li>I alt ca. ${fuel.totalCarbs} g kulhydrat fra gels. Drik et par slurke hver ${fuel.drinkEveryMin}. minut.</li>
        <li>Prøv præcis denne plan på dine lange ture – intet nyt på løbsdagen.</li></ul></div>
        <div class="card" style="margin-top:12px"><div class="chart-caption"><b>Dagene før</b></div><ul class="race-list"><li>2 dage før: carb-loading (cirka 8–10 g kulhydrat/kg/dag)</li><li>Dagen før: hent startnummer, læg tøj og gels frem, tidlig seng</li><li>Morgenen: let morgenmad 2–3 timer før, intet nyt</li></ul></div>`;
    } else {
      const raceItem = c.entries.map((e) => e.item).find((it) => it.type === 'race' && /Transgrancanaria/i.test(it.description || ''));
      const km = (raceItem && raceItem.km) || 23, elev = (raceItem && raceItem.elevation_m) || 1800;
      const easy = pc && pc.easy ? pc.easy[1] : c.easyPace;
      h += `<div class="card"><div class="chart-caption"><b>${fmt(km, 0)} km · ca. ${fmt(elev, 0)} højdemeter op</b></div>`;
      if (!easy) h += `<div class="meta">Tidsestimatet kræver dit rolige tempo. Det kommer, når du har fået et marathonmål (5 km-testen) eller har et par rolige ture logget.</div>`;
      else {
        const est = trailEstimate(km, elev, easy);
        h += `<div class="stat-tiles"><div class="stat-tile"><div class="l">Estimat</div><div class="v" style="font-size:1.2rem">${hms(est.low)} – ${hms(est.high)}</div></div><div class="stat-tile"><div class="l">Anstrengelses-km</div><div class="v">${fmt(est.effort, 0)}</div></div></div>
          <div class="meta" style="margin-top:8px">Regnet som ${fmt(km, 0)} km + ${fmt(elev / 100, 0)} km for højdemeterne i dit rolige tempo (${P.fmtPace(easy)}/km). Et groft estimat – terræn, varme og nedløb kan flytte det meget.</div>`;
      }
      h += `</div><div class="card" style="margin-top:12px"><div class="chart-caption"><b>Strategi</b></div><ul class="race-list"><li>Gå (power hike) i stigninger over ca. 12 %. Det er hurtigere og sparer ben til nedløbene.</li><li>Spar på quadriceps i de første nedløb – kort skridt, kontrolleret.</li><li>Gel hver 40.–45. minut og drik jævnt; planlæg efter depoterne.</li><li>Tjek racens reglement for obligatorisk udstyr og stave (Tjeklister).</li></ul></div>`;
    }
  }
  return h + `<div class="section-footer">Planerne regnes ud fra dit marathonmål og dine tempoer. De er et udgangspunkt – tilpas dem til, hvad du har afprøvet på dine ture.</div>`;
}
