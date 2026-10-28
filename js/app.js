// Træningsplan – hovedprogram. Alt træningsindhold kommer fra data/plan.json.
import * as S from './store.js';
import * as P from './plan.js';
import * as Sync from './sync.js';
import { CHECKLISTS } from './checklists.js';
import * as Q from './quotes.js';
import * as R from './recovery.js';
import * as T from './strength.js';
import { icon } from './icons.js';
import * as X from './stats.js';
import * as SU from './statsui.js';
import * as SH from './share.js';
import * as Diag from './diag.js';
import * as A from './adapt.js';
import * as RS from './runstats.js';
import * as Rep from './report.js';
import * as RC from './race.js';
import * as Push from './push.js';
import * as PL from './planner.js';
import * as PU from './planui.js';
import * as PG from './programs.js';
import * as CI from './checkin.js';
import * as TU from './tune.js';
import * as AC from './actual.js';
import * as PGU from './programui.js';
import * as O from './own.js';
import * as OU from './ownui.js';
import * as RP from './runprog.js';
import * as RPU from './runprogui.js';
import { bodySVG } from './musclemap.js';
import * as ICS from './ics.js';
import * as Audio from './audio.js';
import * as Wake from './wake.js';
const { unlockAudio, playCue, soundMode, updateSoundButton } = Audio;
import { MUSCLES, MUSCLE_LABEL } from './musclemap.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const fmtNum = (n, d = 1) => (n == null ? '–' : Number(n).toLocaleString('da-DK', { maximumFractionDigits: d }));
const desktop = matchMedia('(min-width: 900px)');
const finePointer = matchMedia('(pointer: fine)');

let plan, basePlan, config, baseConfig, startWeights, startWeightsFile, goalsFile, quotesFile, exercisesFile, runTypes, sched, baseDates;
const ui = { pgTab: 'strength', rp: { id: null }, pg: { id: null, sid: null }, tab: 'today', sub: null, weekStart: null, pasSeg: 'week', recRange: 7, progSeg: 'run', planView: 'main', rs: null, pauseWeeks: '1', statSeg: 'strength', statRunSec: 'overview', reportWeek: null, statSec: 'overview', statRange: '3M', statMetric: 'volume', statMuscle: null, statMonth: null, statEx: null, statExTab: 'about', statQ: '', statBar: null, goalSort: 'own', goalEdit: false, quoteSeg: 'all' };

// Filtre i "Alle pas" huskes pr. enhed
const PAS_KEY = 'tp.pasFilter';
const pasFilter = (() => {
  const d = { main: 'all', sub: null, q: '', past: false };
  try { return { ...d, ...JSON.parse(localStorage.getItem(PAS_KEY) || '{}') }; } catch { return d; }
})();
function savePasFilter() { try { localStorage.setItem(PAS_KEY, JSON.stringify(pasFilter)); } catch { /* privat tilstand */ } }

// ---------- Øvelsesbibliotek (exercises.json + egne øvelser) ----------
function allExercises() {
  const lib = (exercisesFile && exercisesFile.exercises) || [];
  const custom = S.all('custom_exercises').map((c) => ({ ...c, custom: true, alternatives: [] }));
  return [...lib, ...custom];
}
function exerciseIndex() { return new Map(allExercises().map((e) => [e.name, e])); }
function exList(entry) { return P.effectiveExercises(entry, S.all('exercise_overrides')); }

// ======================= Data-hjælpere =======================
function overridesMap() { return Object.fromEntries(S.all('overrides').map((o) => [o.id, o])); }
function recompute() {
  P.setRules(settingVal('hybrid_rules'));
  plan = effectivePlan();
  if (baseDatesFor !== plan) { baseDates = new Map(P.buildSchedule(plan, {}).entries.map((e) => [e.key, e.date])); baseDatesFor = plan; }
  applySettings();
  // Syg/skadet og hotel-pas lægges oven på planen (plan.json ændres aldrig)
  sched = A.applyAdaptations(P.buildSchedule(plan, overridesMap()), { health: settingVal('health'), travel: settingVal('travel') });
}
// Marathonmål og tempoer, du har godkendt i appen (efter 5 km-testen), lægges oven på config.json
function applySettings() {
  // Personlige tal (puls, zoner) og startvægte ligger i Supabase (settings: profile / start_weights) – ikke i den offentlige side
  const prof = S.get('settings', 'profile');
  const pace = S.get('settings', 'pace');
  config = { ...baseConfig };
  if (prof && prof.value) for (const [k, v] of Object.entries(prof.value)) if (v != null) config[k] = v;
  if (pace && pace.value && pace.value.marathon_goal_time) config = { ...config, marathon_goal_time: pace.value.marathon_goal_time, paces: pace.value.paces || null };
  const sw = S.get('settings', 'start_weights');
  startWeights = (sw && sw.value) || startWeightsFile;
}
const entryByKey = (key) => sched.entries.find((e) => e.key === key);
const entriesOn = (date) => sched.byDate.get(date) || [];
const statusOf = (key) => (S.get('session_status', key) || {}).status || null;

function setStatus(entry, status, { toggle = true } = {}) {
  const cur = statusOf(entry.key);
  if (toggle && cur === status) { S.remove('session_status', entry.key); return; }
  S.put('session_status', { id: entry.key, item_key: entry.key, date: entry.date, item_index: entry.idx, status });
}

function garminFor(entry) {
  const acts = S.all('garmin_activities').filter((a) => a.type === 'running');
  return acts.find((a) => a.planned_key === entry.key) || acts.find((a) => !a.planned_key && a.date === entry.date) || null;
}
// Faktisk løb for et pas: manuel log vinder altid over Garmin
function runActual(entry) {
  const manual = S.get('run_logs', entry.key);
  if (manual) return { ...manual, from: 'manual' };
  const g = garminFor(entry);
  if (g) return { km: g.km, time_sec: g.duration_sec, hr: g.avg_hr, max_hr: g.max_hr, elev: g.elev_gain, from: 'garmin' };
  return null;
}
// Højdemeter: manuel log vinder, ellers Garmin (samme regel som km)
function loggedElevOn(date) {
  const manual = S.all('run_logs').filter((r) => r.date === date);
  const garmin = S.all('garmin_activities').filter((a) => a.type === 'running' && a.date === date);
  if (manual.length) {
    const m = manual.reduce((s, r) => s + (num(r.elev) || 0), 0);
    return m || garmin.reduce((s, a) => s + (num(a.elev_gain) || 0), 0);
  }
  return garmin.reduce((s, a) => s + (num(a.elev_gain) || 0), 0);
}
function plannedElevOn(date) { return entriesOn(date).filter((e) => e.item.kind === 'run').reduce((s, e) => s + (e.item.elevation_m || 0), 0); }
const fmtElev = (m) => `↑${fmtNum(m, 0)} hm`;
function loggedKmOn(date) {
  const manual = S.all('run_logs').filter((r) => r.date === date);
  if (manual.length) return manual.reduce((s, r) => s + (num(r.km) || 0), 0);
  return S.all('garmin_activities').filter((a) => a.type === 'running' && a.date === date).reduce((s, a) => s + (num(a.km) || 0), 0);
}
function plannedKmOn(date) { return entriesOn(date).filter((e) => e.item.kind === 'run' && !e.item.optional).reduce((s, e) => s + (e.item.km || 0), 0); }

function weekStats(start) {
  const dates = P.weekDates(start);
  let planned = 0, logged = 0, sessions = 0, done = 0, elevPlanned = 0, elevLogged = 0;
  for (const d of dates) {
    planned += plannedKmOn(d);
    logged += loggedKmOn(d);
    elevPlanned += plannedElevOn(d);
    elevLogged += loggedElevOn(d);
    for (const e of entriesOn(d)) {
      if (e.item.kind === 'rest') continue;
      sessions++;
      if (statusOf(e.key) === 'done') done++;
    }
  }
  const w = P.weekFor(plan, start);
  if (w && w.elevation_m) elevPlanned = w.elevation_m; // ugens samlede mål fra plan.json
  return { planned, logged, sessions, done, elevPlanned, elevLogged };
}

function setsFor(key) { return S.all('strength_logs').filter((r) => r.item_key === key); }
function currentWeekStart() {
  const t = P.todayISO();
  const w = P.weekFor(plan, t);
  if (w) return w.start;
  return t < plan.start ? plan.weeks[0].start : plan.weeks[plan.weeks.length - 1].start;
}

const HRV_DA = { BALANCED: 'Balanceret', UNBALANCED: 'Ubalanceret', LOW: 'Lav', POOR: 'Lav', NONE: '–' };
const recoveryDays = () => R.indexDays(S.all('garmin_daily'));
// Hårdt pas i dag + næste rolige tur inden for 3 dage (til "Byt"-knappen)
function swapCandidates(date) {
  const hard = entriesOn(date).find((e) => e.item.kind === 'run' && ['quality', 'long', 'hills'].includes(e.item.type));
  let easy = null;
  for (let i = 1; i <= 3 && hard && !easy; i++) easy = entriesOn(P.addDays(date, i)).find((e) => e.item.kind === 'run' && e.item.type === 'easy');
  return hard && easy ? { hard, easy } : null;
}

// ======================= Små UI-byggesten =======================
function kindIcon(item) {
  const c = P.itemColor(item);
  const ic = item.type === 'hills' ? 'mountain' : c === 'other' ? 'flame' : c;
  return `<span class="badge-ic k-${c}">${icon(ic)}</span>`;
}
function statusDot(key) {
  const s = statusOf(key);
  if (s === 'done') return `<span class="status-dot done" title="Gennemført">${icon('check')}</span>`;
  if (s === 'skipped') return `<span class="status-dot skipped" title="Sprunget over">${icon('skip')}</span>`;
  return '';
}
function entryMeta(e) {
  const it = e.item;
  const parts = [];
  if (it.kind === 'run') parts.push(P.zoneText(it.zone, config));
  if (it.kind === 'run' && it.elevation_m) parts.push(fmtElev(it.elevation_m));
  if (e.adapted) parts.push(e.adapted);
  if (it.kind === 'strength') {
    const exs = exList(e);
    const changed = exs.filter((x) => x.swapped_from || x.added).length;
    parts.push(`${exs.length} øvelser${changed ? ` (${changed} ændret)` : ''}`);
    if (e.date >= P.todayISO() && !statusOf(e.key)) { const up = nextSummary(e).up; if (up) parts.push(`↑ ${up} klar til mere vægt`); }
  }
  if (it.kind === 'other') parts.push(`${it.minutes} min · RPE ${it.rpe}`, ({ light: 'let benbelastning', moderate: 'moderat benbelastning', hard: 'hård benbelastning' })[it.legs]);
  if (it.own) parts.push('Eget pas');
  if (it.kind === 'rest') parts.push(it.description);
  if (e.moved) parts.push(`flyttet fra ${P.fmtDateShort(e.origDate)}`);
  if (it.kind === 'run') { const a = runActual(e); if (a && a.km) parts.push(`løbet ${fmtNum(a.km)} km${a.elev ? ` ${fmtElev(a.elev)}` : ''}`); }
  return parts.filter(Boolean).join(' · ');
}
function rings(a, b, size = 92) {
  const ring = (r, frac, color) => {
    const c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac || 0));
    return `<circle r="${r}" cx="50" cy="50" stroke="${color}" stroke-opacity=".22" stroke-width="12"/>
      <circle r="${r}" cx="50" cy="50" stroke="${color}" stroke-width="12" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - f)}" transform="rotate(-90 50 50)"/>`;
  };
  return `<svg class="rings" width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="Fremskridt">${ring(42, a, 'var(--run)')}${b == null ? '' : ring(27, b, 'var(--strength)')}</svg>`;
}
function weekRingsCard(start) {
  const st = weekStats(start);
  return `<div class="card rings-card">${rings(st.planned ? st.logged / st.planned : 0, st.sessions ? st.done / st.sessions : 0)}
    <div class="ring-legend">
      <div><div class="big c-run">${fmtNum(st.logged)} / ${fmtNum(st.planned)} km</div><div class="lbl">Løbet i ugen</div></div>
      <div><div class="big c-strength">${st.done} / ${st.sessions}</div><div class="lbl">Pas gennemført</div></div>
      ${st.elevPlanned ? `<div><div class="big c-accent">↑${fmtNum(st.elevLogged, 0)} / ${fmtNum(st.elevPlanned, 0)} hm</div><div class="lbl">Højdemeter</div></div>` : ''}
    </div></div>`;
}
function syncPill() {
  const s = Sync.status();
  return `<button class="sync-pill" data-act="sub" data-sub="account" title="${esc(s.detail || 'Konto og synkronisering')}">${icon(s.icon)}${esc(s.text)}</button>`;
}
function seg(group, options, value) {
  return `<div class="seg" role="group">${options.map(([v, l]) => `<button data-act="seg" data-group="${group}" data-value="${v}" aria-pressed="${v === value}">${l}</button>`).join('')}</div>`;
}

// ======================= Visninger =======================
function sessionCard(e) {
  const it = e.item, st = statusOf(e.key);
  if (it.kind === 'rest') {
    return `<div class="card session-card"><div class="session-head">${kindIcon(it)}<div><h3>Hvile</h3><div class="meta">${esc(it.description)}</div></div></div></div>`;
  }
  let body = '';
  if (it.kind === 'run') {
    body = `<div class="session-desc">${esc(it.description)}</div><div class="meta">${esc(P.zoneText(it.zone, config))}${it.elevation_m ? ` · ${fmtElev(it.elevation_m)}` : ''}</div>${runTypeChips(it)}`;
    const a = runActual(e);
    if (e.date <= P.todayISO()) body += runDataButton();
    if (a) body += `<div class="note">${a.from === 'garmin' ? 'Fra Garmin: ' : 'Logget: '}${fmtNum(a.km)} km · ${P.fmtDuration(a.time_sec)}${a.km && a.time_sec ? ` · ${P.fmtPace(a.time_sec / a.km)}/km` : ''}${a.hr ? ` · puls ${a.hr}` : ''}${a.elev ? ` · ${fmtElev(a.elev)}` : ''}</div>`;
  } else if (it.kind === 'other') {
    body = `${it.description ? `<div class="session-desc">${esc(it.description)}</div>` : ''}<div class="meta">${it.minutes} min · RPE ${it.rpe}${it.hr ? ` · puls ${it.hr}` : ''}${it.km_other ? ` · ${fmtNum(it.km_other)} km` : ''} · ${({ light: 'let', moderate: 'moderat', hard: 'hård' })[it.legs]} benbelastning</div>`;
  } else {
    const ctx = strengthCtx();
    body = `<ul class="ex-list">${exList(e).map((x) => {
      const tg = targetFor(e, x, ctx).target;
      return `<li><b>${esc(x.exercise)}</b> · ${x.sets} × ${esc(x.reps)}${x.swapped_from ? ` <span class="chip accent">skiftet</span>` : x.added ? ` <span class="chip accent">ekstra</span>` : ''}${tg.kg != null ? ` <span class="chip next-${tg.kind}">${tg.kind === 'up' ? '↑ ' : tg.kind === 'down' ? '↓ ' : ''}${T.fmtKg(tg.kg)} kg</span>` : ''}</li>`;
    }).join('')}</ul>`;
    if (it.note) body += `<div class="note">${esc(it.note)}</div>`;
    const n = setsFor(e.key).length;
    if (n) body += `<div class="meta">${n} sæt logget</div>`;
  }
  const chips = [it.own ? `<span class="chip accent">Eget pas</span>` : '', e.adapted ? `<span class="chip accent">${esc(e.adapted)}</span>` : '', e.moved ? `<span class="chip moved">Flyttet</span>` : '', st === 'done' ? `<span class="chip run">Gennemført${actualState().changed.has(e.key) ? ' (ændret)' : ''}</span>` : '', st === 'skipped' ? `<span class="chip">Sprunget over</span>` : ''].join('');
  const metaLine = it.kind === 'run' ? `${fmtNum(it.km)} km` : it.kind === 'other' ? `${it.minutes} min` : `${exList(e).length} øvelser`;
  return `<div class="card session-card">
    <div class="session-head">${kindIcon(it)}<div class="grow"><h3>${esc(P.itemTitle(plan, e))}${e.item.strides_day ? ' <span class="chip" style="vertical-align:middle">kvalitetsdag</span>' : ''}</h3><div class="meta">${metaLine} ${chips}</div></div></div>
    ${body}
    ${travelNote(e)}
    ${qaRow(e)}
    <div class="btn-row">
      ${it.kind === 'other' ? '' : `<button class="btn filled flex" data-act="open" data-key="${e.key}">${icon(it.kind === 'run' ? (it.type === 'hills' ? 'mountain' : 'run') : 'strength')}${it.kind === 'run' ? 'Log løb' : 'Log sæt'}</button>`}
      <button class="btn ${st === 'done' ? 'on' : ''}" data-act="status" data-key="${e.key}" data-status="done" aria-pressed="${st === 'done'}">${icon('check')}${st === 'done' ? 'Gennemført' : 'Færdig'}</button>
    </div>
    <div class="btn-row">
      <button class="btn flex" data-act="status" data-key="${e.key}" data-status="skipped" aria-pressed="${st === 'skipped'}">${icon('skip')}${st === 'skipped' ? 'Sprunget over' : 'Spring over'}</button>
      ${it.custom_id ? `<button class="btn flex" data-act="ownEdit" data-id="${esc(it.custom_id)}">${icon('edit')}Rediger / flyt</button>` : `<button class="btn flex" data-act="move" data-key="${e.key}">${icon('move')}Flyt</button>`}
    </div>
    ${it.custom_id ? `<div class="btn-row">${it.kind === 'strength' ? `<button class="btn flex" data-act="saveTpl" data-key="${e.key}">Gem som skabelon</button>` : ''}<button class="btn flex danger" data-act="ownDelete" data-id="${esc(it.custom_id)}">${icon('trash')}Slet</button></div>` : ''}
  </div>`;
}

function entryRow(e, { showDate = false } = {}) {
  const it = e.item;
  const title = esc(P.itemTitle(plan, e));
  const meta = esc((showDate ? `${P.fmtWeekday(e.date)} ${P.fmtDateShort(e.date)} · ` : '') + entryMeta(e));
  const done = statusOf(e.key) === 'done';
  const row = `<button class="row tappable has-icon ${done ? 'done' : ''}" data-act="open" data-key="${e.key}" ${finePointer.matches && it.kind !== 'rest' ? `draggable="true" data-drag="${e.key}"` : ''}>
      ${kindIcon(it)}<span class="grow"><span class="title">${title}</span><span class="meta" style="display:block">${meta}</span></span>${statusDot(e.key)}${icon('right', 'chev')}</button>`;
  if (it.kind === 'rest') return row;
  return `<div class="swipe has-icon"><div class="actions">
      <button class="a-done" data-act="status" data-key="${e.key}" data-status="done">${icon('check')}${done ? 'Fortryd' : 'Gennemført'}</button>
      <button class="a-move" data-act="move" data-key="${e.key}">${icon('move')}Flyt</button>
    </div>${row}</div>`;
}

function countdownCards() {
  const t = P.todayISO();
  const goals = (plan.goals || []).filter((g) => g.date && g.date >= t).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!goals.length) return '';
  return `<div class="countdown" style="margin-top:12px">${goals.map((g, i) => {
    const d = P.daysBetween(t, g.date);
    return `<div class="card"><span class="chip race" style="justify-self:start">${i === 0 ? 'Næste løb' : 'Derefter'}</span>
      <div class="num c-race">${d === 0 ? 'I dag!' : d}</div><div class="meta">${d === 0 ? '' : d === 1 ? 'dag' : 'dage'}</div>
      <div class="name">${esc(P.raceShortName(g.name))}</div><div class="meta">${P.fmtDateLong(g.date)}</div></div>`;
  }).join('')}</div>`;
}

const STATUS_TEXT = {
  green: ['Grøn', 'Klar til træning'], yellow: ['Gul', 'Tag det lidt roligere'],
  red: ['Rød', 'Prioritér restitution'], unknown: ['–', 'Ingen data fra i nat endnu'],
};
// Dagens status-kort. På "I dag" vises det kun ved gul/rød; på Restitution altid.
function recoveryCard(date, { full = false } = {}) {
  if (!S.all('garmin_daily').length) return '';
  const st = R.dayStatus(recoveryDays(), date);
  if (!full && (st.level === 'green' || st.level === 'unknown')) return '';
  const sug = R.suggestion(st.level, entriesOn(date), (e) => P.itemTitle(plan, e));
  const swap = sug.canSwap ? swapCandidates(date) : null;
  const reasons = [...st.reasons].sort((x, y) => ({ red: 0, yellow: 1, green: 2 }[x.level] - { red: 0, yellow: 1, green: 2 }[y.level]));
  const [label, title] = STATUS_TEXT[st.level];
  return `<div class="card status-card s-${st.level}" style="margin-top:12px">
    <div class="status-top"><span class="status-light" aria-hidden="true"></span><div><div class="status-label">${label} · ${esc(title)}</div>
      <div class="meta">${P.fmtDateLong(date)}</div></div></div>
    <div class="status-sug">${esc(sug.text)}</div>
    ${swap ? `<button class="btn" data-act="swap" data-a="${swap.hard.key}" data-b="${swap.easy.key}">${icon('swap')}Byt med ${esc(P.itemTitle(plan, swap.easy))} (${P.fmtWeekday(swap.easy.date)})</button>` : ''}
    ${reasons.length ? `<ul class="status-reasons">${reasons.map((r) => `<li class="r-${r.level}">${esc(r.text)}</li>`).join('')}</ul>` : ''}
    ${!full ? `<button class="link-btn" data-act="sub" data-sub="recovery">Se restitution ›</button>` : ''}
  </div>`;
}

// ---------- Dagens citat ----------
function allQuotes() {
  const builtin = (quotesFile && quotesFile.quotes) || [];
  const custom = S.all('custom_quotes').map((q) => ({ id: q.id, text: q.text, tags: q.tags || ['general'], custom: true }));
  return [...builtin.map((q) => ({ ...q, id: Q.quoteId(q) })), ...custom];
}
const favoriteIds = () => new Set(S.all('favorite_quotes').map((f) => f.id));
function completedWeeksBefore(start) {
  let n = 0;
  for (const w of plan.weeks) {
    if (w.start >= start) break;
    const st = weekStats(w.start);
    if (st.sessions > 0 && st.done === st.sessions) n++;
  }
  return n;
}
function goalLine(t) {
  const goals = S.all('goals').filter((g) => g.status !== DONE()).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const dated = goals.filter((g) => g.date && g.date >= t).sort((a, b) => (a.date < b.date ? -1 : 1));
  const dream = goals.find((g) => !g.date && !g.linked_to_plan);
  const useCountdown = dated.length && (!dream || Q.hash(t) % 2 === 0);
  if (useCountdown) {
    const g = dated[0], d = P.daysBetween(t, g.date);
    const name = g.event ? P.raceShortName(g.event) : g.name;
    return d === 0 ? `I dag: ${name}!` : `${d} ${d === 1 ? 'dag' : 'dage'} til ${name}`;
  }
  return dream ? `Næste på bucketlisten: ${dream.name}` : null;
}
function quoteLine(t) {
  const quotes = allQuotes();
  if (!quotes.length) return '';
  const races = sched.entries.filter((e) => e.item.type === 'race').map((e) => {
    const g = P.raceGoal(plan, e.date);
    return { date: e.date, name: g ? g.name : e.item.description };
  });
  const yesterday = P.addDays(t, -1);
  const w = P.weekFor(plan, t);
  // Milepæl: mandag efter hver 5. gennemførte uge
  let milestone = false;
  if (w && w.start === t) {
    const prev = P.weekFor(plan, yesterday);
    const st = prev && weekStats(prev.start);
    const n = completedWeeksBefore(t);
    milestone = !!(st && st.sessions && st.done === st.sessions && n > 0 && n % 5 === 0);
  }
  const ctx = {
    date: t, entries: entriesOn(t), week: w, races, milestone,
    missedYesterday: entriesOn(yesterday).some((e) => statusOf(e.key) === 'skipped'), hour: new Date().getHours(),
  };
  const favs = favoriteIds();
  const q = Q.pickQuote(quotes, ctx, favs);
  if (!q) return '';
  const ordinary = !['race_day', 'race_week_half', 'race_week_marathon', 'missed', 'milestone'].includes(q.reason);
  if (ordinary && Q.isGoalDay(t)) {
    const line = goalLine(t);
    if (line) return `<button class="quote-line goal press" data-act="tab" data-tab="goals">${icon('flag')}<span>${esc(line)}</span></button>`;
  }
  const fav = favs.has(q.id);
  return `<div class="quote-line"><p>“${esc(q.text)}”</p>
    <button class="heart ${fav ? 'on' : ''}" data-act="favQuote" data-id="${esc(q.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Fjern fra favoritter' : 'Gem som favorit'}">${icon('heart')}</button></div>`;
}

function todayHTML({ compact = false } = {}) {
  const t = P.todayISO();
  const w = P.weekFor(plan, t);
  let h = compact ? `<h2 class="col-title">I dag</h2>` : `<h1 class="large-title">I dag</h1>`;
  h += `<div class="subtitle">${P.fmtDateLong(t)}${w ? ` · <span class="chip accent">Uge ${w.week}</span><span class="chip">${esc(w.phase)}</span>${w.deload ? '<span class="chip deload">Deload</span>' : ''}` : ''} ${compact ? '' : syncPill()}</div>`;
  if (t < plan.start) {
    const d = P.daysBetween(t, plan.start);
    const z2 = P.hrZones(config) && P.hrZones(config).Z2;
    const tip = z2 ? `Indtil da: hold dig til rolige ture i Z2 (${z2[0]}–${z2[1]} bpm).` : 'Indtil da: hold dig til rolige ture, hvor du kan tale i hele sætninger.';
    h += `<div class="card"><h3>Planen starter om ${d} dag${d === 1 ? '' : 'e'}</h3><div class="meta">${P.fmtDateLong(plan.start)}. ${tip}</div></div>`;
    h += quoteLine(t);
  }
  h += countdownCards();
  h += healthBanner();
  if (t >= plan.start) h += checkinHTML(t) + reactionsHTML(t);
  { const pz = pauseInfo(); if (pz) h += PU.pauseCardHTML(pz); }
  if (planChanged()) h += `<button class="card adapt-banner press" style="display:block;width:100%;text-align:left;margin-top:12px" data-act="planSync"><div class="title">Planen er ændret</div><div class="meta">Opdatér ur og kalender →</div></button>`;
  h += recoveryCard(t);
  const today = entriesOn(t);
  if (t >= plan.start) {
    h += `<div class="section-header"><span>Dagens pas</span><button class="nav-btn add-day" data-act="ownAdd" aria-label="Tilføj pas">${icon('plus')}</button></div>`;
    h += today.length ? today.map(sessionCard).join('') : `<div class="card"><div class="session-head"><span class="badge-ic k-rest">${icon('rest')}</span><div><h3>Ingen pas i dag</h3><div class="meta">Hvile og restitution.</div></div></div></div>`;
    if (!today.some((e) => e.item.kind === 'run')) h += `<div class="section-header">Løbedata</div>${runDataButton()}`;
    h += quoteLine(t) + reviewToday(t);
  }
  // Kommende pas
  const upcoming = [];
  for (let i = 1; i <= 14 && upcoming.length < 5; i++) {
    const d = P.addDays(t, i);
    for (const e of entriesOn(d)) if (e.item.kind !== 'rest' && upcoming.length < 5) upcoming.push(e);
  }
  h += `<div class="group" style="margin-top:14px"><button class="row tappable has-icon" data-act="sub" data-sub="daily"><span class="badge-ic k-gray">${icon('log')}</span><span class="grow title">Dagbog <span class="meta">vægt · protein · søvn</span></span>${icon('right', 'chev')}</button></div>`;
  if (upcoming.length) h += `<div class="section-header">Kommende pas</div><div class="group">${upcoming.map((e) => entryRow(e, { showDate: true })).join('')}</div>`;
  h += `<div class="section-header">Denne uge</div>${weekRingsCard(currentWeekStart())}`;
  return h;
}

function weekHTML({ compact = false } = {}) {
  const start = ui.weekStart || currentWeekStart();
  const w = P.weekFor(plan, start);
  const idx = plan.weeks.indexOf(w);
  const dates = P.weekDates(start);
  const t = P.todayISO();
  let h = compact ? `<h2 class="col-title">Uge</h2>` : '';
  h += `<div class="week-nav">
    <button class="btn" data-act="week" data-dir="-1" aria-label="Forrige uge" ${idx <= 0 ? 'disabled' : ''}>${icon('left')}</button>
    <button class="lbl press" data-act="week" data-dir="0">Uge ${w.week} · ${P.fmtDateShort(dates[0])} – ${P.fmtDateShort(dates[6])}</button>
    <button class="btn" data-act="week" data-dir="1" aria-label="Næste uge" ${idx >= plan.weeks.length - 1 ? 'disabled' : ''}>${icon('right')}</button></div>`;
  h += `<div class="subtitle"><span class="chip">${esc(w.phase)}</span>${w.deload ? '<span class="chip deload">Deload</span>' : ''}<span class="chip run">Plan ${fmtNum(w.run_km)} km</span>${w.elevation_m ? `<span class="chip accent">${fmtElev(w.elevation_m)}</span>` : ''}</div>`;
  const clash = PL.conflictsOnBlocked([w], isBlockedDay, t);
  h += `<div class="btn-row" style="margin:0 0 12px"><button class="btn flex" data-act="weekEdit" data-start="${start}" ${P.addDays(start, 6) < t ? 'disabled' : ''}>${icon('edit')}Tilpas ugen${w.edit_type ? ' · ændret' : ''}</button></div>`;
  if (clash.length) h += `<div class="warn" style="margin-bottom:12px">${icon('warn')}<span>${clash.length} pas falder på utilgængelige dage (${clash.map((d) => `${P.fmtWeekday(d)} ${P.fmtDateShort(d)}`).join(', ')}). <button type="button" class="link-btn inline" data-act="weekEdit" data-start="${start}">Foreslå flytning</button> Er ugen presset, fjernes det laveste prioriterede først: ${esc(P.PRIORITY_TEXT)}.</span></div>`;
  h += warningsCard(start);
  h += weekRingsCard(start);
  for (const d of dates) {
    const es = entriesOn(d);
    const lk = loggedKmOn(d), pk = plannedKmOn(d), pe = plannedElevOn(d), le = loggedElevOn(d);
    const right = [pk || lk ? `${fmtNum(lk)}/${fmtNum(pk)} km` : '', pe || le ? `↑${fmtNum(le, 0)}/${fmtNum(pe, 0)} hm` : ''].filter(Boolean).join(' · ');
    h += `<div class="section-header" data-drop-date="${d}"><span>${P.fmtWeekday(d)} ${P.fmtDateShort(d)} ${d === t ? '<span class="today-mark">· I dag</span>' : ''}</span><span>${right} <button class="nav-btn add-day" data-act="ownAdd" data-date="${d}" aria-label="Tilføj pas ${P.fmtWeekday(d)} ${P.fmtDateShort(d)}">${icon('plus')}</button></span></div>`;
    h += `<div class="group" data-drop-date="${d}">${es.length ? es.map((e) => entryRow(e)).join('') : `<div class="row has-icon"><span class="badge-ic k-rest">${icon('rest')}</span><span class="grow meta">Hvile</span></div>`}</div>`;
  }
  if (finePointer.matches) h += `<div class="section-footer">Tip: træk et pas over på en anden dag for at flytte det.</div>`;
  else h += `<div class="section-footer">Tip: swipe et pas til venstre for at markere det eller flytte det.</div>`;
  return h;
}

// ---------- Pas-fanen: Uge | Alle pas ----------
function pasHTML() {
  return `<h1 class="large-title">Pas</h1><button class="btn filled block" style="margin-bottom:12px" data-act="ownAdd">${icon('plus')}Tilføj pas</button>${seg('pasSeg', [['week', 'Uge'], ['all', 'Alle pas']], ui.pasSeg)}${ui.pasSeg === 'all' ? allPassesHTML() : weekHTML()}`;
}

const RUN_SUBS = [['easy', 'Rolig'], ['quality', 'Kvalitet'], ['long', 'Langtur'], ['hills', 'Bakke/højdemeter'], ['race', 'Race']];
function strengthSessions() {
  return [...new Set(plan.weeks.flatMap((w) => w.days.flatMap((d) => d.items.filter((i) => i.kind === 'strength').map((i) => i.session))))];
}
function chipBtn(act, value, label, on, extra = '') {
  return `<button type="button" class="chip-btn" data-act="${act}" data-value="${esc(value)}" aria-pressed="${on}" ${extra}>${esc(label)}</button>`;
}
function passFilterMatch(e) {
  const it = e.item;
  if (it.kind === 'rest') return false;
  if (pasFilter.main === 'strength' && it.kind !== 'strength') return false;
  if (pasFilter.main === 'run' && it.kind !== 'run') return false;
  if (pasFilter.sub) {
    if (pasFilter.main === 'run') {
      if (pasFilter.sub === 'hills' ? !(it.type === 'hills' || it.elevation_m) : it.type !== pasFilter.sub) return false;
    } else if (pasFilter.main === 'strength' && it.session !== pasFilter.sub) return false;
  }
  const q = (pasFilter.q || '').trim().toLowerCase();
  if (!q) return true;
  const title = `${P.itemTitle(plan, e)} ${it.kind === 'run' ? `${it.km} km` : ''} ${P.fmtDateShort(e.date)}`.toLowerCase();
  const hay = [title, it.description, it.session, it.zone, `${P.fmtWeekday(e.date)} ${P.fmtDateLong(e.date)}`,
    it.kind === 'run' ? RUN_LABELS_DA(it.type) : '', ...(it.kind === 'strength' ? exList(e).map((x) => x.exercise) : [])]
    .join(' ').toLowerCase();
  // Tal (f.eks. "langtur 30") matcher kun titel/km, så "30-60 g kulhydrat" i beskrivelsen ikke tæller med
  return q.split(/\s+/).every((tok) => (/^\d+([.,]\d+)?$/.test(tok) ? new RegExp(`(^|\\D)${tok.replace(',', '[.,]')}(\\D|$)`).test(title) : hay.includes(tok)));
}
function RUN_LABELS_DA(type) { return (RUN_SUBS.find(([v]) => v === type) || [, ''])[1]; }

function passRow(e, t, ctx) {
  const it = e.item, st = statusOf(e.key);
  const up = it.kind === 'strength' && e.date >= t && !statusOf(e.key) ? nextSummary(e, ctx).up : 0;
  const meta = [`${P.fmtWeekday(e.date)} ${P.fmtDateShort(e.date)}`, it.kind === 'run' ? `${fmtNum(it.km)} km` : `${exList(e).length} øvelser`,
    it.elevation_m ? fmtElev(it.elevation_m) : '', up ? `↑ ${up} klar til mere vægt` : ''].filter(Boolean).join(' · ');
  const badges = [st === 'done' ? '<span class="chip run">✓ Gennemført</span>' : '', st === 'skipped' ? '<span class="chip">✕ Sprunget over</span>' : '',
    e.moved ? '<span class="chip moved">Flyttet</span>' : ''].join('');
  return `<button class="row tappable has-icon ${st ? 'done' : ''}" data-act="open" data-key="${e.key}" ${e.date === t ? 'data-today="1"' : ''}>
    ${kindIcon(it)}<span class="grow"><span class="title">${esc(P.itemTitle(plan, e))}${e.item.strides_day ? ' <span class="chip">kvalitetsdag</span>' : ''}${e.date === t ? ' <span class="chip accent">I dag</span>' : ''}</span>
    <span class="meta" style="display:block">${esc(meta)}</span>${badges ? `<span class="pass-badges">${badges}</span>` : ''}</span>${icon('right', 'chev')}</button>`;
}

function allPassesHTML() {
  const f = pasFilter;
  let h = `<div class="search"><span class="search-ic">${icon('search')}</span><input type="search" id="pasSearch" placeholder="Søg, f.eks. bænkpres, tærskel, langtur 30" value="${esc(f.q)}" aria-label="Søg i pas" autocomplete="off"></div>`;
  h += `<div class="tag-picks filter-row">${chipBtn('pasMain', 'all', 'Alle', f.main === 'all')}${chipBtn('pasMain', 'strength', 'Styrke', f.main === 'strength')}${chipBtn('pasMain', 'run', 'Løb', f.main === 'run')}</div>`;
  if (f.main === 'run') h += `<div class="tag-picks filter-row sub">${RUN_SUBS.map(([v, l]) => chipBtn('pasSub', v, l, f.sub === v)).join('')}</div>`;
  if (f.main === 'strength') h += `<div class="tag-picks filter-row sub">${strengthSessions().map((s) => chipBtn('pasSub', s, s, f.sub === s)).join('')}</div>`;
  h += `<div class="btn-row" style="margin:10px 0 4px"><button class="btn flex" data-act="pasToday">${icon('today')}Gå til i dag</button>
    <button class="btn flex" data-act="pasPast">${f.past ? 'Skjul tidligere pas' : 'Vis tidligere pas'}</button></div>`;
  return h + `<div id="pasList">${allPassesList()}</div>`;
}

function allPassesList() {
  const t = P.todayISO();
  const fromWeek = pasFilter.past ? plan.weeks[0].start : currentWeekStart();
  const ctx = strengthCtx();
  let h = '', count = 0;
  for (const w of plan.weeks) {
    if (w.start < fromWeek) continue;
    const rows = P.weekDates(w.start).flatMap((d) => entriesOn(d)).filter(passFilterMatch);
    if (!rows.length) continue;
    count += rows.length;
    h += `<div class="week-sticky"><span>Uge ${w.week} · ${esc(w.phase)}${w.deload ? ' · Deload' : ''}</span><span>${fmtNum(w.run_km)} km${w.elevation_m ? ` · ${fmtElev(w.elevation_m)}` : ''}</span></div>
      <div class="group">${rows.map((e) => passRow(e, t, ctx)).join('')}</div>`;
  }
  return count ? h + `<div class="section-footer">${count} pas</div>` : `<div class="card empty" style="margin-top:14px">Ingen pas passer til filteret.</div>`;
}

// ======================= Ugerapport =======================
let reportState = { key: null, data: null, blob: null };
function reportData(start) {
  const rows = S.all('strength_logs'), lib = exerciseIndex();
  const weekDates = P.weekDates(start);
  const sessions = X.sessionsFrom(rows, lib);
  const prs = X.prSets(rows, lib).bySession;
  const prCount = sessions.filter((x) => weekDates.includes(x.date)).reduce((n, x) => n + ((prs[x.key] || []).length), 0);
  const prevDates = P.weekDates(P.addDays(start, -7));
  const daily = S.all('garmin_daily');
  return Rep.weekReport({
    start, entries: sched.entries, statusOf, runs: RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running')),
    sessions, prCount, daily, prevDaily: daily.filter((r) => prevDates.includes(r.date)), weekInfo: P.weekFor(plan, start), today: P.todayISO(),
  });
}
function reportHTML() {
  const start = ui.reportWeek || X.mondayOf(P.todayISO());
  const r = reportData(start);
  reportState = { key: start, data: r, blob: null };
  setTimeout(() => { if (reportState.key === start && !reportState.blob) reportState.blob = SH.reportPNG(r).catch(() => null); }, 0);
  const isNow = start === X.mondayOf(P.todayISO());
  const tile = (l, v, sub) => `<div class="stat-tile"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="d" style="color:var(--label-2)"><small>${sub}</small></div>` : ''}</div>`;
  return `<div class="cal-head" style="margin-top:6px"><button class="nav-btn" data-act="reportNav" data-d="-1" aria-label="Forrige uge">${icon('left')}</button>
      <b>${r.week ? `Uge ${r.week} · ` : ''}${P.fmtDateShort(r.start)} – ${P.fmtDateShort(r.end)}${isNow ? ' (nu)' : ''}</b>
      <button class="nav-btn" data-act="reportNav" data-d="1" aria-label="Næste uge" ${isNow ? 'disabled' : ''}>${icon('right')}</button></div>
    ${r.phase ? `<div class="subtitle" style="margin:0 0 10px">${esc(r.phase)}${r.deload ? ' · Deload' : ''}</div>` : ''}
    <div class="stat-tiles">${tile('Løb', `${fmtNum(r.km)} km`, r.plannedKm ? `af ${fmtNum(r.plannedKm)} planlagt · ${r.runsDone}/${r.runsPlanned} pas` : '')}
      ${tile('Højdemeter', `${fmtNum(r.elev, 0)} m`, r.plannedElev ? `af ${fmtNum(r.plannedElev, 0)} planlagt` : '')}
      ${tile('Styrke', `${r.strengthDone} pas`, `${r.sets} sæt · ${fmtNum(r.volume, 0)} kg`)}
      ${tile('Rekorder', r.prs ? `🏅 ${r.prs}` : '–', '')}
      ${tile('HRV', r.hrv != null ? `${fmtNum(r.hrv, 0)} ms` : '–', r.hrvPrev != null ? `sidste uge ${fmtNum(r.hrvPrev, 0)}` : '')}
      ${tile('Søvn', r.sleepH != null ? `${fmtNum(r.sleepH)} t` : '–', r.rhr != null ? `hvilepuls ${fmtNum(r.rhr, 0)}` : '')}</div>
    <div class="section-header">Vurdering</div><div class="card">${r.lines.map((l) => `<p class="report-line">${esc(l)}</p>`).join('')}</div>
    ${reviewHTML(start)}
    <button class="btn filled block" style="margin-top:14px" data-act="reportShare">${icon('external')}Del som billede</button>`;
}
async function shareReport() {
  const r = reportState.data;
  if (!r) return;
  if (!reportState.blob) reportState.blob = SH.reportPNG(r).catch(() => null);
  const blob = await reportState.blob;
  if (!blob) { toast('Kunne ikke lave billedet.'); return; }
  const file = new File([blob], `ugerapport-${r.start}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `Ugerapport ${r.start}` }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Billedet er gemt');
}

// ======================= Statistik =======================
function statsCtx() {
  const rows = S.all('strength_logs');
  const lib = exerciseIndex();
  const runDates = new Set([...S.all('run_logs').map((r) => r.date), ...S.all('garmin_activities').filter((a) => a.type === 'running').map((a) => a.date)]);
  const sessions = X.sessionsFrom(rows, lib);
  const soreness = AC.legSoreness({ legSessions: sessions.filter((s) => AC.isLegSession(s, lib)), logs: S.all('daily_log') });
  const otherDates = new Set(sched.entries.filter((e) => e.item.kind === 'other' && statusOf(e.key) === 'done').map((e) => e.date));
  return { rows, lib, today: P.todayISO(), runDates, sessions, soreness, otherDates };
}
// Pas der mangler at blive logget (seneste 14 dage)
function missingList(kind) {
  const t = P.todayISO(), missing = [];
  for (let i = 0; i <= 14; i++) {
    const d = P.addDays(t, -i);
    for (const e of entriesOn(d)) {
      if (e.item.kind !== kind) continue;
      if (statusOf(e.key)) continue;
      if (kind === 'run' && runActual(e)) continue;
      if (kind === 'strength' && setsFor(e.key).length) continue;
      missing.push(e);
    }
  }
  return missing.length ? `<div class="section-header">Mangler at blive logget</div><div class="group">${missing.slice(0, 8).map((e) => entryRow(e, { showDate: true })).join('')}</div>` : '';
}
function statsHTML() {
  let h = `<h1 class="large-title">Statistik</h1><div class="subtitle">${syncPill()}</div>`;
  h += seg('statSeg', [['strength', 'Styrke'], ['run', 'Løb'], ['report', 'Rapport']], ui.statSeg);
  if (ui.statSeg === 'report') return h + reportHTML();
  if (ui.statSeg === 'strength') {
    if (ui.statSec === 'history') h += missingList('strength');
    return h + SU.strengthStatsHTML(statsCtx(), ui);
  }
  h += `<div class="tag-picks filter-row">${RS.RUN_SECTIONS.map(([v, l]) => SU.chip('statRunSec', v, l, ui.statRunSec === v)).join('')}</div>`;
  if (ui.statRunSec !== 'overview') {
    const rc = { runs: RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running')), zones: P.hrZones(config), today: P.todayISO(), shoes: (settingVal('shoes') || {}).shoes || [] };
    if (ui.statRunSec === 'zones') return h + RS.zonesHTML(rc, ui, SU.periodBar(ui));
    if (ui.statRunSec === 'pace') return h + RS.paceHTML(rc, ui, SU.periodBar(ui), SU.lineChart);
    return h + RS.shoesHTML(rc);
  }
  h += missingList('run');
  h += progressRunHTML();
  h += `<button class="btn filled block" style="margin-top:18px" data-act="extraRun">${icon('plus')}Tilføj ekstra løbetur</button>`;
  const manual = S.all('run_logs').map((r) => ({ ...r, from: 'manual' }));
  const manualDates = new Set(manual.map((r) => r.date));
  const garmin = S.all('garmin_activities').filter((a) => a.type === 'running' && !manualDates.has(a.date))
    .map((a) => ({ id: a.id, item_key: a.planned_key, date: a.date, km: a.km, time_sec: a.duration_sec, hr: a.avg_hr, elev: a.elev_gain, from: 'garmin' }));
  const runs = [...manual, ...garmin].sort((a, b) => (a.date < b.date ? 1 : -1));
  h += `<div class="section-header">Loggede løbeture</div>`;
  h += runs.length ? `<div class="group">${runs.map((r) => {
    const e = r.item_key && entryByKey(r.item_key);
    const title = e ? P.itemTitle(plan, e) : 'Ekstra løbetur';
    const act = r.from === 'manual' ? (e ? `data-act="open" data-key="${r.item_key}"` : `data-act="extraRun" data-id="${r.id}"`) : (e ? `data-act="open" data-key="${e.key}"` : '');
    return `<button class="row tappable has-icon" ${act}><span class="badge-ic k-run">${icon('run')}</span>
      <span class="grow"><span class="title">${esc(title)}</span><span class="meta" style="display:block">${P.fmtWeekday(r.date)} ${P.fmtDateShort(r.date)} · ${fmtNum(r.km)} km · ${P.fmtDuration(r.time_sec)}${r.km && r.time_sec ? ` · ${P.fmtPace(r.time_sec / r.km)}/km` : ''}${r.hr ? ` · ${r.hr} bpm` : ''}${num(r.elev) ? ` · ${fmtElev(num(r.elev))}` : ''}${r.from === 'garmin' ? ' · Garmin' : ''}</span></span>${icon('right', 'chev')}</button>`;
  }).join('')}</div>` : `<div class="card empty">Ingen løbeture logget endnu.</div>`;
  return h;
}

// ---------- Fremskridt ----------
function weeklyChart(metric = 'km') {
  const W = 340, H = 170, pl = 26, pb = 18, pt = 8;
  const data = plan.weeks.map((w) => {
    const ds = P.weekDates(w.start);
    if (metric === 'elev') {
      return { w, planned: w.elevation_m || ds.reduce((s, d) => s + plannedElevOn(d), 0), actual: ds.reduce((s, d) => s + loggedElevOn(d), 0) };
    }
    return { w, planned: ds.reduce((s, d) => s + plannedKmOn(d), 0), actual: ds.reduce((s, d) => s + loggedKmOn(d), 0) };
  });
  const unit = metric === 'elev' ? 'hm' : 'km';
  const step = metric === 'elev' ? 500 : 10;
  const max = Math.max(step, ...data.map((d) => Math.max(d.planned, d.actual)));
  const top = Math.ceil(max / step) * step;
  const slot = (W - pl) / data.length;
  const y = (v) => pt + (H - pt - pb) * (1 - v / top);
  const cur = currentWeekStart();
  let svg = '';
  for (const v of [0, top / 2, top]) svg += `<line class="grid" x1="${pl}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
  data.forEach((d, i) => {
    const x = pl + i * slot;
    const bw = slot * 0.72, aw = slot * 0.42;
    svg += `<g><title>Uge ${d.w.week}: ${fmtNum(d.planned, 0)} ${unit} planlagt, ${fmtNum(d.actual, 0)} ${unit} ${metric === 'elev' ? 'op' : 'løbet'}</title>
      <rect class="planned" x="${x + (slot - bw) / 2}" y="${y(d.planned)}" width="${bw}" height="${Math.max(0, H - pb - y(d.planned))}" rx="1.5"/>
      ${d.actual ? `<rect class="${metric === 'elev' ? 'actual-elev' : 'actual'}" x="${x + (slot - aw) / 2}" y="${y(d.actual)}" width="${aw}" height="${Math.max(0, H - pb - y(d.actual))}" rx="1.5"/>` : ''}</g>`;
    if (d.w.start === cur) svg += `<line class="now" x1="${x + slot / 2}" x2="${x + slot / 2}" y1="${pt}" y2="${H - pb}"/>`;
    if (i % 4 === 0) svg += `<text x="${x + slot / 2}" y="${H - 4}" text-anchor="middle">U${d.w.week}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ugentlige ${metric === 'elev' ? 'højdemeter' : 'km'}, planlagt og faktisk">${svg}</svg>
    <div class="legend"><span><i style="background:var(--fill-2)"></i>Planlagt</span><span><i style="background:${metric === 'elev' ? 'var(--accent)' : 'var(--run)'}"></i>${metric === 'elev' ? 'Højdemeter op' : 'Løbet'}</span><span><i style="background:none;border:1px dashed var(--accent)"></i>Denne uge</span></div>`;
}

function ormChart(points) {
  const W = 320, H = 120, pl = 34, pb = 18, pt = 10, pr = 10;
  const ys = points.map((p) => p.v);
  let lo = Math.min(...ys) * 0.95, hi = Math.max(...ys) * 1.05;
  if (hi - lo < 5) { lo -= 2.5; hi += 2.5; }
  const t0 = P.parseISO(points[0].date).getTime(), t1 = P.parseISO(points[points.length - 1].date).getTime();
  const x = (d) => (t1 === t0 ? (pl + W - pr) / 2 : pl + (W - pl - pr) * ((P.parseISO(d).getTime() - t0) / (t1 - t0)));
  const y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let svg = '';
  for (const v of [lo, hi]) svg += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
  svg += `<polyline class="line" points="${points.map((p) => `${x(p.date)},${y(p.v)}`).join(' ')}"/>`;
  svg += points.map((p) => `<circle class="dot" cx="${x(p.date)}" cy="${y(p.v)}" r="3.5"><title>${P.fmtDateShort(p.date)}: ${fmtNum(p.v)} kg</title></circle>`).join('');
  svg += `<text x="${pl}" y="${H - 3}">${P.fmtDateShort(points[0].date)}</text><text x="${W - pr}" y="${H - 3}" text-anchor="end">${P.fmtDateShort(points[points.length - 1].date)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimeret 1RM over tid">${svg}</svg>`;
}

function progressRunHTML() {
  const t = P.todayISO();
  const all = [...S.all('run_logs')];
  const total = plan.weeks.reduce((s, w) => s + P.weekDates(w.start).reduce((a, d) => a + loggedKmOn(d), 0), 0);
  const longest = Math.max(0, ...all.map((r) => num(r.km) || 0), ...S.all('garmin_activities').filter((a) => a.type === 'running').map((a) => num(a.km) || 0));
  const wk = weekStats(currentWeekStart());
  return `<div class="stat-row">
      <div class="stat"><div class="v c-run">${fmtNum(total)}</div><div class="l">km i alt</div></div>
      <div class="stat"><div class="v">${fmtNum(wk.logged)}</div><div class="l">km denne uge</div></div>
      <div class="stat"><div class="v">${fmtNum(longest)}</div><div class="l">længste tur (km)</div></div>
    </div><div class="card"><h3 style="margin-bottom:8px">Km pr. uge</h3>${weeklyChart('km')}</div>
    ${plan.weeks.some((w) => w.elevation_m) ? `<div class="card"><h3 style="margin-bottom:8px">Højdemeter pr. uge</h3>${weeklyChart('elev')}
      <div class="meta" style="margin-top:6px">Transgrancanaria Half har ca. 1.800 højdemeter op. Logget i alt: ${fmtElev(plan.weeks.reduce((s, w) => s + P.weekDates(w.start).reduce((a, d) => a + loggedElevOn(d), 0), 0))}</div></div>` : ''}
    ${t < plan.start ? '<div class="section-footer">Graferne fyldes ud, når du logger løbeture.</div>' : ''}`;
}

function ormCard(label, test, rows) {
  const byKey = {};
  for (const r of rows) {
    if (!test(r.exercise)) continue;
    const v = P.epley(num(r.kg), num(r.reps));
    if (!v) continue;
    if (!byKey[r.item_key] || byKey[r.item_key].v < v) byKey[r.item_key] = { date: r.date, v };
  }
  const pts = Object.values(byKey).sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = pts[pts.length - 1], first = pts[0];
  const diff = pts.length > 1 ? last.v - first.v : 0;
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><h3>${esc(label)}</h3>
    ${last ? `<span class="c-strength" style="font-weight:700;font-size:1.15rem">${fmtNum(last.v)} kg</span>` : ''}</div>
    <div class="meta">Estimeret 1RM (Epley)${pts.length > 1 ? ` · ${diff >= 0 ? '+' : ''}${fmtNum(diff)} kg siden start` : ''}</div>
    ${pts.length ? ormChart(pts) : '<div class="empty">Ingen data endnu – log et sæt med kg og reps.</div>'}</div>`;
}

function progressStrengthHTML() {
  const rows = S.all('strength_logs');
  let h = P.ORM_LIFTS.map((lift) => ormCard(lift.label, (n) => lift.match.test(n), rows)).join('');
  // Hver anden øvelse med data får sin egen graf – også øvelser, du har skiftet til
  const others = [...new Set(rows.filter((r) => P.epley(num(r.kg), num(r.reps))).map((r) => r.exercise))]
    .filter((n) => !P.ORM_LIFTS.some((l) => l.match.test(n))).sort((a, b) => a.localeCompare(b, 'da'));
  if (others.length) h += `<div class="section-header">Andre øvelser</div>` + others.map((n) => ormCard(n, (x) => x === n, rows)).join('');
  return h;
}

function progressHTML({ compact = false } = {}) {
  if (compact) {
    return `<h2 class="col-title">Fremskridt</h2>${progressRunHTML()}<div class="section-header">Styrke</div>${progressStrengthHTML()}`;
  }
  return `<h1 class="large-title">Fremskridt</h1>${seg('progSeg', [['run', 'Løb'], ['strength', 'Styrke']], ui.progSeg)}${ui.progSeg === 'run' ? progressRunHTML() : progressStrengthHTML()}`;
}

// ---------- Mål ----------
const goalStatuses = () => (goalsFile && goalsFile.statuses) || ['Drøm', 'Planlagt', 'Tilmeldt', 'Gennemført'];
const DONE = () => goalStatuses()[goalStatuses().length - 1];
function sortedGoals() {
  const goals = S.all('goals');
  const st = goalStatuses();
  const by = {
    own: (a, b) => (a.sort ?? 0) - (b.sort ?? 0),
    date: (a, b) => (a.date || '9999') < (b.date || '9999') ? -1 : (a.date || '9999') > (b.date || '9999') ? 1 : (a.sort ?? 0) - (b.sort ?? 0),
    status: (a, b) => st.indexOf(b.status) - st.indexOf(a.status) || (a.sort ?? 0) - (b.sort ?? 0),
  }[ui.goalSort];
  return goals.sort(by);
}
function goalPlanStats(g) {
  const t = P.todayISO();
  const end = g.date || plan.weeks[plan.weeks.length - 1].start;
  const weeksLeft = Math.max(0, Math.ceil(P.daysBetween(t, end) / 7));
  let planned = 0, logged = 0, longest = 0, elevPlanned = 0, elevLogged = 0;
  for (const e of sched.entries) {
    if (e.item.kind !== 'run' || e.date > end || e.item.type === 'race') continue;
    planned += e.item.km || 0;
    elevPlanned += e.item.elevation_m || 0;
  }
  for (let d = plan.start; d <= end && d <= t; d = P.addDays(d, 1)) {
    const k = loggedKmOn(d);
    logged += k;
    longest = Math.max(longest, k);
    elevLogged += loggedElevOn(d);
  }
  return { weeksLeft, planned, logged, longest, elevPlanned, elevLogged };
}
function goalCard(g) {
  const st = goalStatuses();
  const si = Math.max(0, st.indexOf(g.status));
  const t = P.todayISO();
  const days = g.date ? P.daysBetween(t, g.date) : null;
  let h = `<div class="card goal-card">
    <div class="goal-top"><div class="grow"><h3>${esc(g.name)}</h3>
      <div class="meta">${g.category ? `<span class="chip accent">${esc(g.category)}</span> ` : ''}<span class="chip">${esc(g.status)}</span></div>
      ${g.event ? `<div class="meta" style="margin-top:4px">${esc(g.event)}</div>` : ''}
      ${g.date ? `<div class="meta">${P.fmtDateLong(g.date)}</div>` : ''}</div>
      ${days != null && days >= 0 ? `<div class="goal-days"><div class="num">${days}</div><div class="lbl">${days === 1 ? 'dag' : 'dage'}</div></div>` : ''}</div>
    <div class="status-steps" aria-label="Status: ${esc(g.status)}">${st.map((_, i) => `<span class="${i <= si ? 'on' : ''}"></span>`).join('')}</div>`;
  if (g.linked_to_plan) {
    const s = goalPlanStats(g);
    h += `<div class="goal-stats"><div><b>${s.weeksLeft}</b><small>uger tilbage</small></div><div><b>${fmtNum(s.logged, 0)}<span class="meta">/${fmtNum(s.planned, 0)}</span></b><small>km løbet i planen</small></div><div><b>${fmtNum(s.longest)}</b><small>længste tur (km)</small></div></div>`;
    if (s.elevPlanned) h += `<div class="goal-stats goal-elev"><div><b>↑${fmtNum(s.elevLogged, 0)}<span class="meta">/${fmtNum(s.elevPlanned, 0)}</span></b><small>højdemeter i planen (gennemført / planlagt)</small></div></div>`;
  }
  if (g.note) h += `<div class="note">${esc(g.note)}</div>`;
  if (ui.goalEdit && ui.goalSort === 'own') {
    h += `<div class="sort-btns"><button class="btn" data-act="goalMove" data-id="${esc(g.id)}" data-dir="-1" aria-label="Flyt op">${icon('up')}</button><button class="btn" data-act="goalMove" data-id="${esc(g.id)}" data-dir="1" aria-label="Flyt ned">${icon('down')}</button></div>`;
  }
  return h + `</div>`;
}
function goalsHTML() {
  const all = sortedGoals();
  const done = all.filter((g) => g.status === DONE());
  const active = all.filter((g) => g.status !== DONE());
  let h = `<h1 class="large-title">Mål</h1>`;
  h += `<div class="card rings-card" style="margin-top:8px">${rings(all.length ? done.length / all.length : 0, null)}
    <div class="ring-legend"><div><div class="big c-run">${done.length} af ${all.length}</div><div class="lbl">mål opnået</div></div>
    <button class="btn filled" data-act="goalNew">${icon('plus')}Nyt mål</button></div></div>`;
  h += `<div style="margin-top:16px">${seg('goalSort', [['own', 'Egen'], ['date', 'Dato'], ['status', 'Status']], ui.goalSort)}</div>`;
  h += `<div class="section-header"><span>Bucketlist</span>${ui.goalSort === 'own' ? `<button class="link-btn" data-act="goalEditToggle">${ui.goalEdit ? 'Færdig' : 'Sortér'}</button>` : ''}</div>`;
  h += active.length ? active.map((g) => `<div class="goal-wrap swipe"><div class="actions">
      <button class="a-done" data-act="goalDone" data-id="${esc(g.id)}">${icon('check')}Gennemført</button>
      <button class="a-del" data-act="goalDel" data-id="${esc(g.id)}">${icon('trash')}Slet</button></div>
      <div class="row tappable" data-act="goal" data-id="${esc(g.id)}" role="button" tabindex="0">${goalCard(g)}</div></div>`).join('')
    : `<div class="card empty">Ingen aktive mål. Tryk "Nyt mål" for at tilføje et.</div>`;
  h += `<div class="section-footer">Swipe et mål til venstre for at markere det gennemført eller slette det.</div>`;
  if (done.length) {
    h += `<div class="section-header">Opnået</div><div class="group">${done.map((g) => `<button class="row tappable" data-act="goal" data-id="${esc(g.id)}">
      <span class="check-badge">${icon('check')}</span><span class="grow"><span class="title">${esc(g.name)}</span>
      <span class="meta" style="display:block">${[g.event, g.result ? `Tid: ${g.result}` : '', g.completed_date ? P.fmtDateShort(g.completed_date) : ''].filter(Boolean).map(esc).join(' · ')}</span></span>${icon('right', 'chev')}</button>`).join('')}</div>`;
  }
  return h;
}

// ---------- Mere ----------
// ======================= Tilpasning: syg/skadet og vagter/rejser =======================
function settingVal(id) { const r = S.get('settings', id); return r && r.value ? r.value : null; }
function saveSetting(id, value) { S.put('settings', { id, value }); }
const travelDays = () => (settingVal('travel') || {}).days || {};

function healthBanner() {
  const h = settingVal('health');
  if (!A.healthActive(h, P.todayISO())) return '';
  const k = A.HEALTH_KINDS[h.kind];
  return `<div class="card adapt-banner"><div class="session-head"><span class="badge-ic k-race">${icon('cross')}</span><div class="grow"><h3>Tilpasset plan</h3>
    <div class="meta">${esc(k.label)} · til og med ${P.fmtDateShort(h.to)}</div></div></div><div class="meta" style="margin:6px 0 10px">${esc(k.hint)}</div>
    <div class="btn-row"><button class="btn flex" data-act="healthEnd">Afslut tilpasning</button><button class="btn flex" data-act="healthExtend">+ 7 dage</button></div></div>`;
}
function healthHTML() {
  const h = settingVal('health'), t = P.todayISO();
  let out = `<h1 class="large-title">Syg eller skadet</h1><div class="subtitle">Tilpas planen i et par dage eller uger</div>`;
  if (A.healthActive(h, t)) {
    return out + healthBanner() + `<div class="section-footer">Pas i perioden vises tilpasset i appen. Kalenderfilen og Garmin-træningerne følger stadig den oprindelige plan. Dine loggede sæt og løb ændres ikke.</div>`;
  }
  const kind = ui.healthKind || 'easy', days = Number(ui.healthDays || 7);
  out += `<div class="section-header">Hvad er der sket?</div><div class="group">${Object.entries(A.HEALTH_KINDS).map(([k, v]) => `<button class="row tappable" data-act="healthKind" data-value="${k}" aria-pressed="${k === kind}">
      <span class="grow"><span class="title">${esc(v.label)}</span><span class="meta" style="display:block">${esc(v.hint)}</span></span>${k === kind ? icon('check') : ''}</button>`).join('')}</div>
    <div class="section-header">Hvor længe?</div>${seg('healthDays', [['3', '3 dage'], ['7', '7 dage'], ['10', '10 dage'], ['14', '14 dage']], String(days))}
    <button class="btn filled block" style="margin-top:14px" data-act="healthStart">${icon('check')}Tilpas planen fra i dag</button>
    <div class="section-footer">Efter sygdom: 1–2 uger kun roligt løb og RIR 3 i styrke. Ingen træning ved feber eller symptomer under halsen. Planfilen ændres ikke – du kan altid afslutte tilpasningen igen.</div>`;
  return out;
}
function travelHTML() {
  const t = P.todayISO(), days = travelDays(), pr = planPrefs();
  const start = X.mondayOf(t);
  let h = `<h1 class="large-title">Utilgængelige dage</h1><div class="subtitle">Vagter og rejser – tryk på en dag: ✈ → ⛔ → 🛏 → ingen</div><div class="card">
    <div class="trv-w">${['M', 'T', 'O', 'T', 'F', 'L', 'S'].map((d) => `<span>${d}</span>`).join('')}</div>`;
  for (let w = 0; w < 8; w++) {
    const ws = P.addDays(start, w * 7);
    h += `<div class="trv-row">${P.weekDates(ws).map((d) => {
      const k = days[d], past = d < t, fixed = pr.blocked_weekdays.includes(P.parseISO(d).getDay());
      return `<button class="trv-d ${k || ''} ${fixed && !k ? 'fixed' : ''} ${d === t ? 'today' : ''}" data-act="travelCycle" data-date="${d}" ${past ? 'disabled' : ''} aria-label="${P.fmtDateLong(d)}${k === 'fly' ? ', flyvedag' : k === 'off' ? ', optaget' : k === 'hotel' ? ', hotel' : fixed ? ', fast fridag' : ''}"><b>${Number(d.slice(8))}</b><span>${k === 'fly' ? '✈' : k === 'off' ? '⛔' : k === 'hotel' ? '🛏' : fixed ? '·' : ''}</span></button>`;
    }).join('')}</div>`;
  }
  h += `</div><div class="section-header">Faste dage, jeg ikke kan træne</div><div class="tag-picks">${[[1, 'Man'], [2, 'Tir'], [3, 'Ons'], [4, 'Tor'], [5, 'Fre'], [6, 'Lør'], [0, 'Søn']].map(([v, l]) => `<button type="button" class="chip-btn" data-act="prefWd" data-value="${v}" aria-pressed="${pr.blocked_weekdays.includes(v)}">${l}</button>`).join('')}</div>
    <div class="section-footer"><b>✈ Flyvedag</b> og <b>⛔ Optaget</b> (fx vagt): ingen pas. "Genstart planen" og "Tilpas ugen" undgår dagene, og pas på dem foreslås flyttet.<br><b>🛏 Hotel:</b> du kan træne, og styrkepas kan skiftes til et kort hotel-pas.<br><b>Faste dage:</b> gælder hver uge og bruges, når planen laves eller tilpasses.</div>`;
  return h;
}
// Note på et pas, når du er ude at rejse den dag
function travelNote(e) {
  const kind = travelDays()[e.date];
  if (!kind || e.item.kind === 'rest' || statusOf(e.key)) return '';
  if (kind === 'fly' || kind === 'off') return `<div class="note travel">${kind === 'off' ? '⛔ Du er optaget' : '✈ Du flyver'} ${e.date === P.todayISO() ? 'i dag' : 'denne dag'}. <button type="button" class="link-btn inline" data-act="cannot" data-key="${e.key}">Kan ikke i dag – find ny dag</button></div>`;
  if (e.item.kind === 'strength' && setsFor(e.key).length) return '';
  if (e.item.kind === 'strength') return `<div class="note travel">🛏 Hotel. ${e.item.hotel ? `Hotel-pas er valgt. <button type="button" class="link-btn inline" data-act="hotelOff" data-key="${e.key}">Tilbage til planlagt pas</button>` : `<button type="button" class="link-btn inline" data-act="hotelOn" data-key="${e.key}">Skift til hotel-pas (ca. 20 min)</button>`}</div>`;
  return `<div class="note travel">🛏 Hotel. Tip: et kort roligt løb ude eller på løbebånd.</div>`;
}
function openCannot(key) {
  const e = entryByKey(key);
  if (!e) return;
  const sg = A.suggestMoves(plan, overridesMap(), e, P.todayISO(), travelDays(), { blockedWeekdays: planPrefs().blocked_weekdays });
  const body = `<div class="card" style="margin:4px 0 14px"><div class="session-head">${kindIcon(e.item)}<div><h3>${esc(P.itemTitle(plan, e))}</h3><div class="meta">Planlagt ${P.fmtDateLong(e.date)}${P.priorityLabel(e.item) ? ` · ${P.priorityLabel(e.item)}` : ''}</div></div></div></div>
    <div class="section-header">Bedste nye dage</div>
    ${sg.length ? `<div class="group">${sg.map((x) => `<button class="row tappable" data-act="moveTo" data-key="${key}" data-date="${x.date}"><span class="grow"><span class="title">${P.fmtWeekday(x.date)} ${P.fmtDateShort(x.date)}</span><span class="meta" style="display:block">Ingen regelbrud${travelDays()[x.date] === 'hotel' ? ' · hotel' : ''}</span></span>${icon('right', 'chev')}</button>`).join('')}</div>`
      : `<div class="card empty">Ingen dag de næste 7 dage uden regelbrud. Vælg selv en dag, eller spring passet over. Er ugen presset, fjernes det laveste prioriterede først: ${esc(P.PRIORITY_TEXT)}.</div>`}
    <button class="btn block" style="margin-top:12px" data-act="move" data-key="${key}">${icon('move')}Vælg selv en dag</button>
    <button class="btn block" style="margin-top:8px" data-act="status" data-key="${key}" data-status="skipped" data-insheet="1">${icon('skip')}Spring over</button>`;
  openSheet({ title: 'Kan ikke i dag', body });
}

// ======================= Plan: genstart, versioner, tilpas ugen og pause =======================
const clone = (o) => JSON.parse(JSON.stringify(o));
const planPrefs = () => ({ blocked_weekdays: [], strength_per_week: 4, ...(settingVal('plan_prefs') || {}) });
function isBlockedDay(d) { const k = travelDays()[d]; return k === 'fly' || k === 'off' || planPrefs().blocked_weekdays.includes(P.parseISO(d).getDay()); }
const nBlockedDates = () => Object.entries(travelDays()).filter(([d, k]) => d >= P.todayISO() && (k === 'fly' || k === 'off')).length;
const planChanged = () => { const s = settingVal('plan_sync'); return !!(s && s.changed_at && (!s.done_at || s.changed_at > s.done_at)); };
function markPlanChanged(from) {
  const cur = settingVal('plan_sync') || {};
  const open = cur.changed_at && (!cur.done_at || cur.changed_at > cur.done_at);
  saveSetting('plan_sync', { ...cur, changed_at: new Date().toISOString(), from: open && cur.from && cur.from < from ? cur.from : from, queued: false });
}

// Den effektive plan = skabelonen (plan.json) + aktiv planversion + ugeændringer. plan.json ændres aldrig.
let effKey = null, effPlan = null, baseDatesFor = null;
const activeRunProgram = () => S.all('run_programs').filter((p) => p.active && !p.deleted).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] || null;
const activeProgram = () => S.all('programs').filter((p) => p.active && !p.deleted).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] || null;
function activeVersion() { return S.all('plan_versions').filter((v) => v.active).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0] || null; }
function effectivePlan() {
  const ver = activeVersion(), edits = S.all('week_edits'), prog = activeProgram(), own = customRows(), rpr = activeRunProgram();
  const key = `${ver ? ver.id + ver.updated_at : ''}|${prog ? prog.id + prog.updated_at : ''}|${edits.map((e) => e.id + e.updated_at).join(',')}|${own.map((r) => r.id + r.updated_at).join(',')}|${rpr ? rpr.id + rpr.updated_at : ''}`;
  if (key !== effKey || !effPlan) { effKey = key; effPlan = PL.mergePlan(basePlan, ver, edits, prog, own, rpr); }
  return effPlan;
}

function planHTML() {
  if (ui.planView === 'wizard' && ui.rs) return PU.wizardHTML(ui.rs, { today: P.todayISO(), nBlocked: nBlockedDates() });
  if (ui.planView === 'programs') return programsView();
  if (ui.planView === 'hybrid') return PU.hybridHTML(P.getRules(), upcomingViolations());
  if (ui.planView === 'versions') return PU.versionsHTML(S.all('plan_versions').sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)), (activeVersion() || {}).id);
  const t = P.todayISO(), goals = plan.goals || [];
  const wk = (re) => { const g = goals.find((x) => re.test(x.name)); return g && g.date >= t ? Math.ceil(P.daysBetween(t, g.date) / 7) : null; };
  // Uge X af Y tælles i den aktive planversion (ikke i den oprindelige plan)
  const ver = activeVersion(), vw = ver && ver.weeks && ver.weeks.length ? ver.weeks : plan.weeks;
  const cur = P.weekFor(plan, t), idx = cur ? vw.findIndex((w) => w.start === cur.start) : -1;
  const runs = RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running'));
  const nextLong = sched.entries.filter((e) => e.item.kind === 'run' && e.item.type === 'long' && e.date >= t).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  const ws = cur ? weekStats(cur.start) : null;
  const st = {
    weekNo: idx >= 0 ? idx + 1 : null, weekTotal: vw.length, before: !!vw.length && t < vw[0].start, startsOn: vw.length ? vw[0].start : null, phase: cur ? `${cur.phase}${cur.deload ? ' · Deload' : ''}` : '',
    tgcWeeks: wk(/Transgrancanaria/i), marWeeks: wk(/marathon/i), week: ws, nextLong: nextLong ? { km: nextLong.item.km, date: nextLong.date } : null,
    longest: Math.max(0, ...runs.filter((r) => r.date >= (vw[0] ? vw[0].start : '0')).map((r) => r.km || 0)), target: PL.MAR_LONG.final,
  };
  return PU.planMainHTML({ version: ver, st, nVersions: S.all('plan_versions').length, nBlocked: nBlockedDates(), pause: pauseInfo(), changed: planChanged(), levelHTML: levelHTML() });
}

// ---------- Tjek-ind og hurtighandlinger ----------
function checkinHTML(t) {
  const row = S.get('daily_log', t) || {};
  const legs = num(row.legs), energy = num(row.energy);
  const scale = (k, val, labels) => `<div class="ci-scale" role="group" aria-label="${k === 'legs' ? 'Ben' : 'Energi'}">${[1, 2, 3, 4, 5].map((v) => `<button type="button" data-act="ci" data-k="${k}" data-v="${v}" aria-pressed="${val === v}" aria-label="${v} – ${labels[v - 1]}">${v}</button>`).join('')}</div>`;
  const items = entriesOn(t).map((e) => e.item).filter((i) => i.kind !== 'rest');
  const sugg = legs != null || energy != null ? CI.suggestionsFor({ legs: legs ?? 0, energy }, items) : [];
  let h = `<div class="section-header">Tjek ind</div><div class="card ci-card">
    <div class="ci-line"><span class="title">Ben</span>${scale('legs', legs, CI.LEG_LABELS)}</div>
    <div class="meta ci-hint">${legs != null ? `${legs} – ${CI.LEG_LABELS[legs - 1]}` : '1 = friske · 5 = meget ømme'}</div>
    <div class="ci-line"><span class="title">Energi</span>${scale('energy', energy, CI.ENERGY_LABELS)}</div>
    <div class="meta ci-hint">${energy != null ? `${energy} – ${CI.ENERGY_LABELS[energy - 1]}` : '1 = meget lav · 5 = rigtig god'}</div></div>`;
  for (const s of sugg) {
    h += `<div class="card adapt-banner" style="margin-top:10px"><div class="title">${esc(s.title)}</div><div class="meta" style="margin:4px 0 10px">Et forslag – du bestemmer selv.</div>
      <div class="qa-row">${s.actions.map(([a, l]) => `<button class="btn" data-act="qa" data-qa="${a}" data-date="${t}">${esc(l)}</button>`).join('')}</div></div>`;
  }
  return h;
}
function qaRow(e) {
  const it = e.item, t = P.todayISO();
  if (it.kind === 'rest' || (it.kind === 'run' && it.type === 'race') || e.date < t || statusOf(e.key) === 'done') return '';
  const b = (a, l) => `<button class="btn" data-act="qa" data-qa="${a}" data-key="${e.key}" data-date="${e.date}">${l}</button>`;
  return `<div class="qa-row" aria-label="Hurtige handlinger">${b('easier', 'Gør lettere')}${b('swap', 'Byt dag med …')}${it.kind === 'run' && CI.isHardRun(it) ? b('toEasy', 'Lav om til rolig tur') : ''}${P.isLower(it) ? b('toUpper', 'Lav om til overkrop') : ''}</div>`;
}
// Dagens pas fra planen (før flytninger), så ændringer skrives på den oprindelige dag
function planDay(date) { for (const w of plan.weeks) for (const d of w.days) if (d.date === date) return d; return null; }
function replaceAt(e, newItem) {
  if (e.item.custom_id) { // egne pas ændres i deres egen række
    const row = S.get('custom_sessions', e.item.custom_id); if (!row) return false;
    const { custom_id: _c, ...clean } = newItem;
    S.put('custom_sessions', { ...row, item: clean }); markPlanChanged(e.date); recompute(); return true;
  }
  const d = planDay(e.origDate); if (!d) return false;
  const items = d.items.map((x, i) => (i === e.idx ? newItem : x));
  editDays({ [e.origDate]: items }, e.date); recompute(); return true;
}
function upperTemplate() {
  const t = P.todayISO();
  for (const w of plan.weeks) if (w.days[6].date >= t) for (const d of w.days) for (const i of d.items) if (i.kind === 'strength' && !P.isLower(i)) return i;
  const prog = activeProgram();
  const s = prog && prog.sessions.find((x) => x.kind !== 'lower');
  return s ? PG.buildItem(prog, s, t) : null; // kan være null i løbsuger
}
function qaApply(qa, key, date) {
  const t = P.todayISO();
  const entries = key ? [entryByKey(key)].filter(Boolean) : entriesOn(date);
  const pick = (f) => entries.filter((e) => e.item.kind !== 'rest' && f(e.item));
  let n = 0;
  const each = (list, fn) => { for (const e of list) if (replaceAt(e, fn(e.item))) n++; };
  if (qa === 'easier') each(pick((i) => !(i.kind === 'run' && i.type === 'race')), CI.easierItem);
  else if (qa === 'toEasy') each(pick(CI.isRunnable), CI.toEasyRun);
  else if (qa === 'toUpper') { const tpl = upperTemplate(); if (!tpl) { toast('Der findes intet overkropspas at bruge.'); return; } each(pick(P.isLower), (i) => CI.toUpper(i, tpl)); }
  else if (qa === 'fewer') each(pick(P.isLower), CI.fewerSets);
  else if (qa === 'rir') each(pick(P.isLower), CI.rirPlus);
  else if (qa === 'rest') each(pick(CI.isRunnable), () => ({ kind: 'rest', description: 'Hvile i dag (valgt efter tjek-ind).' }));
  else if (qa === 'easierRuns') each(pick(CI.isRunnable), CI.easierItem);
  if (n) { toast('Passet er ændret ✓'); render(); }
  void t;
}
function openSwap(date, { easyOnly = false } = {}) {
  const t = P.todayISO();
  let opts = CI.swapOptions(JSON.parse(JSON.stringify(plan.weeks)), date, { today: t, isBlocked: isBlockedDay });
  if (easyOnly) opts = opts.filter((o) => o.date > date && P.daysBetween(date, o.date) <= 6 && o.items.some((i) => i.kind === 'run' && i.type === 'easy') && !o.items.some((i) => (i.kind === 'run' && CI.isHardRun(i)) || P.isLower(i)));
  const label = (items) => items.filter((i) => i.kind !== 'rest').map((i) => (i.kind === 'run' ? `${runWord(i)} ${fmtNum(i.km)} km` : i.session)).join(' + ') || 'Hvile';
  const body = opts.length ? `<div class="subtitle" style="margin:4px 0 10px">Kun dage, hvor et bytte ikke bryder dine hybrid-regler.</div><div class="group">${opts.map((o) => `<button class="row tappable" data-act="swapDo" data-a="${date}" data-b="${o.date}"><span class="grow"><span class="title">${P.fmtWeekday(o.date)} ${P.fmtDateShort(o.date)}</span><span class="meta" style="display:block">${esc(label(o.items))}</span></span>${icon('swap')}</button>`).join('')}</div>`
    : `<div class="card empty">Ingen dage de næste 7 dage kan byttes uden at bryde dine hybrid-regler. Du kan ændre reglerne under Plan → Hybrid-regler.</div>`;
  openSheet({ title: easyOnly ? 'Byt med en rolig dag' : 'Byt dag med …', body });
}
const runWord = (i) => (i.strides_day ? 'Rolig + strides' : i.type === 'long' ? 'Langtur' : i.type === 'quality' ? 'Kvalitet' : i.type === 'hills' ? 'Bakke' : 'Rolig');
function swapDo(a, b) {
  const da = planDay(a), db = planDay(b); if (!da || !db) return;
  editDays({ [a]: db.items, [b]: da.items }, a < b ? a : b);
  recompute(); closeSheet(); toast('Dagene er byttet ✓'); render();
}

// ---------- Tilpas passet under træningen ----------
function saveTune(e, ex, fields) {
  const scope = wo.scope === 'future' ? 'future' : 'date';
  const id = scope === 'future' ? `tn-f-${e.item.session}-${ex.slot}` : `tn-d-${e.key}-${ex.slot}`;
  const cur = S.get('exercise_overrides', id) || {};
  S.put('exercise_overrides', { ...cur, id, action: 'tune', scope, date: scope === 'future' ? e.date : e.date, item_key: e.key, session: e.item.session, original: String(ex.slot), ...fields, deleted: false });
  if (scope === 'future' && e.item.program_id) { // gem også i programmet
    const pg = S.get('programs', e.item.program_id);
    if (pg) {
      const next = PG.clone(pg), s = next.sessions.find((x) => x.name === e.item.session), x = s && s.exercises.find((y) => y.exercise === ex.original);
      if (x) { Object.assign(x, fields); S.put('programs', next); }
    }
  }
  recompute(); renderWorkoutBody();
}
function setCount(slot, d) {
  const e = entryByKey(wo.key); if (!e) return;
  const ex = exList(e).find((x) => x.slot === slot); if (!ex) return;
  const total = Math.max(1, Number(ex.sets) || 3);
  if (d > 0) { saveTune(e, ex, { sets: total + 1 }); return; }
  if (total <= 1) { toast('Øvelsen skal have mindst ét sæt.'); return; }
  const row = S.get('strength_logs', `${e.key}|${slot}|${total}`);
  if (row && num(row.reps) != null) { if (!window.confirm(`Sæt ${total} er allerede logget. Fjern det?`)) return; S.remove('strength_logs', row.id); refreshMiniMap(); }
  saveTune(e, ex, { sets: total - 1 });
}
function deleteSet(slot, n) {
  const e = entryByKey(wo.key); if (!e) return;
  const ex = exList(e).find((x) => x.slot === slot); if (!ex) return;
  const total = Math.max(1, Number(ex.sets) || 3);
  if (total <= 1) { toast('Øvelsen skal have mindst ét sæt.'); return; }
  const rows = setsFor(e.key).filter((r) => String(r.ex_index) === String(slot));
  const hit = rows.find((r) => Number(r.set_no) === n);
  if (hit && num(hit.reps) != null && !window.confirm(`Sæt ${n} er logget. Slet det?`)) return;
  const snap = rows.map((r) => ({ ...r }));
  for (const r of rows) S.remove('strength_logs', r.id);
  for (const r of snap) {
    const m = Number(r.set_no);
    if (m === n || m < 1) continue;
    const nn = m > n ? m - 1 : m;
    S.put('strength_logs', { ...r, id: `${e.key}|${slot}|${nn}`, set_no: nn, deleted: false });
  }
  for (const k of Object.keys(wo.vals)) if (k.startsWith(`${slot}|`)) delete wo.vals[k];
  for (const k of [...wo.edited]) if (k.split('|')[1] === String(slot)) wo.edited.delete(k);
  saveTune(e, ex, { sets: total - 1 });
  refreshMiniMap();
  toast(`Sæt ${n} slettet`, () => {
    for (const r of setsFor(e.key).filter((x) => String(x.ex_index) === String(slot))) S.remove('strength_logs', r.id);
    for (const r of snap) S.put('strength_logs', { ...r, deleted: false });
    saveTune(e, ex, { sets: total });
  });
}
function moveEx(slot, to) {
  const e = entryByKey(wo.key); if (!e) return;
  const order = exList(e).map((x) => x.slot), i = order.indexOf(slot);
  if (i < 0) return;
  to = Math.max(0, Math.min(order.length - 1, to));
  if (to === i) return;
  order.splice(i, 1); order.splice(to, 0, slot);
  S.put('exercise_overrides', { id: `od-${e.key}`, action: 'order', scope: 'date', date: e.date, item_key: e.key, session: e.item.session, exercise: JSON.stringify(order), deleted: false });
  recompute(); renderWorkoutBody();
}
// Ændring af rep-mål og RIR direkte på øvelsen
document.addEventListener('change', (ev) => {
  const el = ev.target, t = el.dataset && el.dataset.tune;
  if (!t || !woOpen()) return;
  const e = entryByKey(wo.key), ex = e && exList(e).find((x) => x.slot === el.dataset.slot);
  if (!ex) return;
  const v = el.value.trim();
  if (t === 'reps' && !/^\d+(\s*[-–]\s*\d+)?$/.test(v)) { toast('Skriv reps som 8 eller 8-12.'); el.value = ex.reps; return; }
  saveTune(e, ex, { [t]: v.replace('–', '-').replace(/\s/g, '') });
});
// Swipe til venstre på et sæt sletter det; træk i ≡ flytter øvelsen
(() => {
  let sw = null;
  const body = () => $('#woBody');
  document.addEventListener('touchstart', (ev) => {
    const row = ev.target.closest && ev.target.closest('#woBody .set-row');
    if (!row || ev.target.closest('input, button') || ev.touches.length !== 1) { sw = null; return; }
    sw = { row, x: ev.touches[0].clientX, y: ev.touches[0].clientY, dx: 0, on: false };
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (!sw) return;
    const dx = ev.touches[0].clientX - sw.x, dy = ev.touches[0].clientY - sw.y;
    if (!sw.on && (Math.abs(dy) > 14 || dx > 0)) { if (Math.abs(dy) > 14) sw = null; return; }
    if (dx < -10) { sw.on = true; sw.dx = dx; sw.row.style.transform = `translateX(${Math.max(dx, -110)}px)`; sw.row.classList.add('swiping'); }
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (!sw) return;
    const { row, dx, on } = sw; sw = null;
    row.style.transform = ''; row.classList.remove('swiping');
    if (on && dx < -80) { const [slot, n] = row.dataset.set.split('|'); deleteSet(slot, Number(n)); }
  }, { passive: true });
  document.addEventListener('touchcancel', () => { if (sw) { sw.row.style.transform = ''; sw.row.classList.remove('swiping'); sw = null; } }, { passive: true });
  // træk i ≡
  let dg = null;
  document.addEventListener('pointerdown', (ev) => {
    const h = ev.target.closest && ev.target.closest('.ex-handle');
    if (!h || !woOpen()) return;
    ev.preventDefault();
    dg = { slot: h.dataset.slot, card: h.closest('.ex-card'), pid: ev.pointerId, y0: ev.clientY };
    dg.card.classList.add('dragging');
    try { h.setPointerCapture(ev.pointerId); } catch { /* ældre browsere */ }
  });
  document.addEventListener('pointermove', (ev) => {
    if (!dg || ev.pointerId !== dg.pid) return;
    dg.card.style.transform = `translateY(${ev.clientY - dg.y0}px)`;
    const b = body(); if (b) { const r = b.getBoundingClientRect(); if (ev.clientY < r.top + 50) b.scrollTop -= 8; else if (ev.clientY > r.bottom - 150) b.scrollTop += 8; }
  });
  const endDrag = (ev) => {
    if (!dg || ev.pointerId !== dg.pid) return;
    const { slot, card } = dg; dg = null;
    const mid = card.getBoundingClientRect(); const y = mid.top + mid.height / 2;
    card.style.transform = ''; card.classList.remove('dragging');
    const cards = $$('#woBody .ex-card');
    const to = cards.filter((c) => c !== card && (() => { const r = c.getBoundingClientRect(); return r.top + r.height / 2 < y; })()).length;
    moveEx(slot, to);
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
})();

// ---------- Egne pas ("+ Tilføj pas") ----------
const customRows = () => S.all('custom_sessions').filter((r) => !r.deleted && r.item);
const nowHHMM = () => new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');
// Egne pas ligger i custom_sessions, ikke i ugeændringer: tag dem ud af dagene, og flyt rækkens dato, hvis passet er byttet til en anden dag
function splitCustom(dayMap) {
  const out = {};
  for (const [d, items] of Object.entries(dayMap)) {
    const own = items.filter((i) => i.custom_id), rest = items.filter((i) => !i.custom_id);
    for (const it of own) { const row = S.get('custom_sessions', it.custom_id); if (row && row.date !== d) S.put('custom_sessions', { ...row, date: d }); }
    out[d] = rest.length ? rest : (own.length ? [{ kind: 'rest', description: 'Hviledag (gåtur/mobilitet er fint)' }] : items);
  }
  return out;
}
function ownDefaults(date) {
  const t = P.todayISO(), d = date || t;
  return { date: d, when: d === t ? 'now' : 'plan', time: '', kind: 'strength', mode: 'muscles', sub: 'easy', activity: 'cykel', legs: 'light', rpe: 5, muscles: [], sug: [], pick: null, name: '', editId: null };
}
function ownCtx() {
  const o = ui.own, lib = exerciseIndex();
  const prog = activeProgram();
  const history = [];
  const seen = new Set();
  for (const s of X.sessionsFrom(S.all('strength_logs'), lib).reverse()) {
    if (seen.has(s.key) || history.length >= 12) continue;
    seen.add(s.key);
    history.push({ key: s.key, date: s.date, name: s.session, n: new Set(s.rows.map((r) => r.exercise)).size });
  }
  const tpls = (settingVal('session_templates') || {}).list || [];
  return {
    today: P.todayISO(), editing: !!o.editId,
    program: prog ? prog.sessions.map((s) => ({ id: s.id, name: s.name, kind: s.kind, n: s.exercises.length })) : [],
    history, templates: tpls.map((t) => ({ id: t.id, name: t.name, n: t.exercises.length })),
    suggestion: (o.sug || []).map((x) => ({ ...x, soreness: PG.givesSoreness(x.exercise, lib) })),
  };
}
function ownRender() {
  const body = $('#sheetBody'); if (!body || !ui.own) return;
  const top = body.scrollTop;
  body.innerHTML = OU.addHTML(ui.own, ownCtx());
  body.scrollTop = top;
}
function openOwnAdd(date) {
  ui.own = ownDefaults(date);
  openSheet({ title: 'Tilføj pas', body: OU.addHTML(ui.own, ownCtx()), footer: `<button class="btn filled block" data-act="ownSave">${icon('plus')}Tilføj pas</button>` });
}
function openOwnEdit(id) {
  const r = S.get('custom_sessions', id); if (!r || r.deleted) return;
  const it = r.item, t = P.todayISO();
  ui.own = { ...ownDefaults(r.date), date: r.date, when: 'plan', time: r.time || it.time || '', kind: it.kind, editId: id, name: it.session || '', sub: it.sub || 'easy', km: it.kind === 'other' ? it.km_other : it.km, minutes: it.minutes, zone: it.zone, description: it.description || '', elevation_m: it.elevation_m, activity: it.activity || 'cykel', rpe: it.rpe || 5, hr: it.hr, legs: it.legs || 'light' };
  void t;
  openSheet({ title: 'Rediger eget pas', body: OU.addHTML(ui.own, ownCtx()), footer: `<button class="btn filled block" data-act="ownSave">${icon('check')}Gem ændringer</button><button class="btn block danger" style="margin-top:8px" data-act="ownDelete" data-id="${esc(id)}">${icon('trash')}Slet pas</button>` });
}
function ownItemFromState() {
  const o = ui.own, lib = exerciseIndex();
  const time = o.when === 'now' ? nowHHMM() : (o.time || null);
  if (o.kind === 'run') {
    if (num(o.km) == null && num(o.minutes) == null) { toast('Skriv km eller tid.'); return null; }
    return O.buildRunItem({ sub: o.sub, km: o.km, minutes: o.minutes, zone: o.zone, description: o.description, elevation_m: o.elevation_m, time });
  }
  if (o.kind === 'other') {
    if (num(o.minutes) == null) { toast('Skriv varighed i minutter.'); return null; }
    return O.buildOtherItem({ activity: o.activity, minutes: o.minutes, rpe: o.rpe, hr: o.hr, km: o.km, legs: o.legs, description: o.description, time });
  }
  // styrke
  let exercises = [], muscles = [...(o.muscles || [])], name = (o.name || '').trim(), mode = o.mode;
  if (mode === 'program') {
    const prog = activeProgram(), s = prog && prog.sessions.find((x) => `p:${x.id}` === o.pick);
    if (!s) { toast('Vælg et pas fra programmet.'); return null; }
    const built = PG.buildItem(prog, s, o.date);
    if (!built) { toast('Det pas er ikke planlagt den dag (løbsuge).'); return null; }
    exercises = built.exercises; name = name || s.name;
  } else if (mode === 'copy') {
    if (!o.pick) { toast('Vælg et pas at kopiere.'); return null; }
    if (o.pick.startsWith('t:')) { const t = ((settingVal('session_templates') || {}).list || []).find((x) => `t:${x.id}` === o.pick); if (!t) return null; exercises = PG.clone(t.exercises); muscles = [...(t.muscles || [])]; name = name || t.name; }
    else {
      const key = o.pick.slice(2), rows = S.all('strength_logs').filter((r) => r.item_key === key && num(r.reps) != null);
      const by = new Map();
      for (const r of rows) { if (!by.has(r.exercise)) by.set(r.exercise, []); by.get(r.exercise).push(r); }
      exercises = [...by].map(([exercise, rs]) => ({ exercise, sets: rs.length, reps: String(Math.max(...rs.map((r) => num(r.reps)))), rir: '2' }));
      name = name || (rows[0] && rows[0].session) || 'Kopi';
    }
  } else if (mode === 'muscles') {
    if (!muscles.length && !o.empty) { toast('Vælg mindst én muskelgruppe, eller vælg Fri træning.'); return null; }
    exercises = o.empty ? [] : (o.sug || []);
    name = name || (muscles.slice(0, 2).map((m) => MUSCLE_LABEL[m]).join(' + ') || 'Eget pas');
  } else if (mode === 'hotel') name = name || 'Hotel-pas';
  else name = name || 'Eget pas';
  if (!muscles.length && exercises.length) { const m = O.musclesOfExercises(exercises.map((x) => x.exercise), lib); muscles = m.primary; }
  return O.buildStrengthItem({ name, mode, muscles, exercises, lib, time });
}
function ownSave() {
  const o = ui.own; if (!o) return;
  if (o.editId) {
    const r = S.get('custom_sessions', o.editId); if (!r) return;
    let item;
    if (o.kind === 'strength') item = { ...r.item, session: (o.name || '').trim() || r.item.session, title: (o.name || '').trim() || r.item.title, time: o.time || undefined };
    else item = { ...ownItemFromState() };
    if (!item || item.kind == null) return;
    S.put('custom_sessions', { ...r, date: o.date, time: o.time || null, item });
    markPlanChanged(o.date); recompute(); closeSheet(); toast('Passet er rettet ✓'); render();
    ownCheck(o.editId, o.date);
    return;
  }
  const date = o.when === 'now' ? P.todayISO() : o.date;
  if (!date) { toast('Vælg en dato.'); return; }
  o.date = date;
  const item = ownItemFromState(); if (!item) return;
  const id = O.newId();
  S.put('custom_sessions', { id, date, time: item.time || null, kind: item.kind, item });
  markPlanChanged(date); recompute();
  const key = `c:${id}`, now = o.when === 'now';
  closeSheet();
  if (now && item.kind === 'strength') { render(); openWorkout(key); return; }
  if (now && item.kind === 'other') { const e = entryByKey(key); if (e) setStatus(e, 'done', { toggle: false }); toast('Passet er tilføjet og markeret som gennemført ✓'); render(); ownCheck(id, date); return; }
  toast(now ? 'Passet er tilføjet' : `Passet er planlagt ${P.fmtWeekday(date)} ${P.fmtDateShort(date)} ✓`); render();
  if (now && item.kind === 'run') { openSession(key); return; }
  ownCheck(id, date);
}
function ownDelete(id) {
  const r = S.get('custom_sessions', id); if (!r) return;
  S.remove('custom_sessions', id); markPlanChanged(r.date); recompute(); closeSheet();
  toast('Passet er slettet', () => { S.put('custom_sessions', { ...r, deleted: false }); markPlanChanged(r.date); recompute(); render(); });
  render();
}
// Regelbrud (hybrid-regler) og for høj belastning, som det nye pas giver
function ownCheck(id, date) {
  const near = JSON.parse(JSON.stringify(plan.weeks.filter((w) => w.days[6].date >= P.addDays(date, -8) && w.days[0].date <= P.addDays(date, 8))));
  const after = PL.violationsOf(near);
  const without = JSON.parse(JSON.stringify(near));
  for (const w of without) for (const d of w.days) d.items = d.items.filter((i) => i.custom_id !== id);
  const before = new Set(PL.violationsOf(without));
  const violations = after.filter((v) => !before.has(v));
  // belastning: ugens samlede planlagte belastning mod de seneste 4 uger
  const t = P.todayISO(), mon = X.mondayOf(date);
  const runs = RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running'));
  const sessions = X.sessionsFrom(S.all('strength_logs'), exerciseIndex());
  const chronic = AC.loadRatio({ runs, sessions, end: t, others: othersList() }).chronic;
  const wEntries = sched.entries.filter((e) => e.date >= mon && e.date <= P.addDays(mon, 6));
  const load = wEntries.reduce((s, e) => s + (e.item.kind === 'run' ? (e.item.km || 0) : e.item.kind === 'other' ? O.otherLoad(e.item) : e.item.kind === 'strength' ? 0.15 * (e.item.exercises || []).reduce((a, x) => a + (Number(x.sets) || 0), 0) : 0), 0);
  let shorten = null;
  if (chronic > 0 && load > chronic * AC.LOAD_RANGE[1]) {
    const excess = load - chronic * AC.LOAD_RANGE[1];
    const next = wEntries.filter((e) => e.date >= date && e.item.kind === 'run' && e.item.type === 'easy' && !e.item.own).sort((a, b) => (a.date < b.date ? -1 : 1))[0]
      || wEntries.filter((e) => e.item.kind === 'run' && e.item.type === 'easy' && e.date >= t).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    if (next) { const to = Math.max(3, Math.round((next.item.km - Math.min(excess, next.item.km * 0.3)) * 2) / 2); if (to < next.item.km) shorten = { key: next.key, date: next.date, from: next.item.km, to }; }
  }
  if (!violations.length && !shorten) return;
  const entry = entryByKey(`c:${id}`);
  setTimeout(() => openSheet({ title: 'Tjek af dit pas', body: `<div class="subtitle" style="margin:4px 0 8px">Passet er lagt ind ${P.fmtWeekday(date)} ${P.fmtDateShort(date)} – du bestemmer selv, om du vil ændre noget.</div>${OU.warnHTML({ violations, shorten })}`,
    footer: violations.length ? `<div class="qa-row"><button class="btn" data-act="qa" data-qa="swap" data-date="${date}">${icon('swap')}Byt dag</button>${entry ? `<button class="btn" data-act="qa" data-qa="easier" data-key="c:${esc(id)}" data-date="${date}">Gør lettere</button>` : ''}<button class="btn" data-act="closeSheet">Behold</button></div>` : '' }), 350);
}
const othersList = () => sched.entries.filter((e) => e.item.kind === 'other' && statusOf(e.key) === 'done').map((e) => ({ date: e.date, load: O.otherLoad(e.item) }));
function ownSetValue(k, v) {
  const o = ui.own; if (!o) return;
  if (k === 'when') { o.when = v; if (v === 'now') o.date = P.todayISO(); }
  else if (k === 'kind') { o.kind = v; o.pick = null; }
  else if (k === 'muscle') { o.muscles = o.muscles.includes(v) ? o.muscles.filter((m) => m !== v) : [...o.muscles, v]; o.sug = O.suggestExercises(o.muscles, exerciseIndex()); o.empty = false; }
  else if (k === 'mode') { o.mode = v; o.pick = null; o.empty = false; if (v === 'hotel' && !o.name) o.name = 'Hotel-pas'; }
  else if (k === 'empty') { o.empty = true; ownSave(); return; }
  else o[k] = v;
  ownRender();
}
// Mini-muskelkort i toppen af et eget styrkepas: farves efterhånden som sæt logges
function miniMapHTML(e) {
  const lib = exerciseIndex(), rows = setsFor(e.key).filter((r) => num(r.reps) != null);
  const prim = {}, sec = {};
  for (const r of rows) { const info = lib.get(r.exercise); if (!info) continue; for (const m of info.primary_muscles || []) prim[m] = (prim[m] || 0) + 1; for (const m of info.secondary_muscles || []) sec[m] = (sec[m] || 0) + 0.5; }
  const inten = Object.fromEntries(Object.entries(prim).map(([m, n]) => [m, Math.min(1, n / 5)]));
  const target = Object.fromEntries((e.item.muscles || []).filter((m) => !inten[m]).map((m) => [m, 0.35]));
  const secondary = { ...Object.fromEntries(Object.entries(sec).filter(([m]) => !inten[m]).map(([m, n]) => [m, Math.min(1, n / 3)])), ...target };
  return `<div class="card mini-map" aria-label="Muskler i dette pas">${bodySVG(inten, { interactive: false, secondary })}<div class="meta" style="text-align:center">Orange: trænet nu · blå: valgt eller ramt sekundært</div></div>`;
}
function refreshMiniMap() {
  const el = $('.mini-map'), e = wo && wo.key && entryByKey(wo.key);
  if (el && e) el.outerHTML = miniMapHTML(e);
}
function saveTemplate(e) {
  const cur = settingVal('session_templates') || { list: [] };
  const exs = exList(e).map((x) => ({ exercise: x.exercise, sets: x.sets, reps: x.reps, rir: x.rir, ...(x.rest_sec ? { rest_sec: x.rest_sec } : {}) }));
  const list = [...(cur.list || []).filter((t) => t.name !== e.item.session), { id: O.newId().replace('cs-', 'tp-'), name: e.item.session, muscles: e.item.muscles || [], exercises: exs }];
  saveSetting('session_templates', { list });
  toast('Gemt som skabelon ✓');
}
// Når et eget styrkepas afsluttes: muskler og benpas beregnes ud fra de øvelser, der faktisk blev lavet
function ownFinish(e) {
  const id = e.item.custom_id; if (!id || e.item.kind !== 'strength') return;
  const row = S.get('custom_sessions', id); if (!row) return;
  const names = [...new Set(setsFor(e.key).filter((r) => num(r.reps) != null).map((r) => r.exercise))];
  if (!names.length) return;
  const lib = exerciseIndex(), m = O.musclesOfExercises(names, lib);
  const item = { ...row.item, muscles: m.primary };
  if (O.isLegWork(names, m.primary, lib)) item.leg = true; else delete item.leg;
  S.put('custom_sessions', { ...row, item, muscles_done: m }); recompute();
}

// ---------- Planen reagerer på det, du faktisk laver ----------
let actualMemo = { key: null, val: null };
function actualState() {
  const t = P.todayISO();
  const key = [t, effKey, sched.entries.length, S.all('run_logs').length, S.all('garmin_activities').length, S.all('strength_logs').length].join('|');
  if (actualMemo.key === key) return actualMemo.val;
  const from = P.addDays(t, -7), lib = exerciseIndex();
  const runs = RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running'));
  const rm = AC.matchRuns({ entries: sched.entries, runs, from, to: t, zones: P.hrZones(config) });
  const sessions = X.sessionsFrom(S.all('strength_logs'), lib);
  const sm = AC.matchStrength({ entries: sched.entries, sessions, from, to: t, lib });
  const recent = (x) => x.date >= P.addDays(t, -3);
  const impacts = AC.ruleImpacts({ weeks: plan.weeks.filter((w) => w.days[6].date >= from).slice(0, 3), today: t, extraRuns: rm.extra.filter(recent), extraStrength: sm.extra.filter(recent), changedRuns: rm.changed.filter(recent) });
  const shorten = AC.shortenSuggestion({ entries: sched.entries, runs, today: t, hasExtra: rm.extra.length > 0 });
  const val = { rm, sm, impacts, shorten, changed: new Set([...rm.changed, ...sm.changed].map((c) => c.key)), why: new Map([...rm.changed, ...sm.changed].map((c) => [c.key, c.why])) };
  actualMemo = { key, val };
  return val;
}
function reactionsHTML(t) {
  const a = actualState(), seen = (settingVal('actual_seen') || {}).ids || {};
  const cards = [];
  const add = (id, text, actions = '') => { if (!seen[id]) cards.push(`<div class="card adapt-banner" style="margin-top:10px"><div class="meta" style="color:var(--label)">${esc(text)}</div><div class="qa-row">${actions}<button class="btn" data-act="actualSeen" data-id="${esc(id)}">Skjul</button></div></div>`); };
  const swapBtn = (date) => `<button class="btn filled" data-act="qa" data-qa="swapEasy" data-date="${date}">Byt med en rolig dag</button>`;
  for (const x of a.rm.extra.filter((y) => y.date >= P.addDays(t, -3))) add(`xr-${x.date}-${x.km}`, `Ekstra løbetur ${P.fmtWeekday(x.date)} ${P.fmtDateShort(x.date)}: ${fmtNum(x.km)} km${x.hard ? ' (hård)' : x.long ? ' (lang)' : ''}. Den tæller med i ugens km.`);
  for (const x of a.sm.extra.filter((y) => y.date >= P.addDays(t, -3))) add(`xs-${x.key}`, `Ekstra ${x.leg ? 'benpas' : 'styrkepas'} ${P.fmtWeekday(x.date)} ${P.fmtDateShort(x.date)} tæller med i statistik og muskelfordeling${x.leg ? ' – og dine hybrid-regler gælder for det' : ''}.`);
  for (const c of [...a.rm.changed, ...a.sm.changed].filter((y) => y.date >= P.addDays(t, -3))) add(`ch-${c.key}`, `Passet ${P.fmtWeekday(c.date)} ${P.fmtDateShort(c.date)} blev løbet/lavet anderledes (${c.why}) og er markeret "gennemført (ændret)".`);
  const done = new Set();
  for (const im of a.impacts) {
    if (done.has(im.text)) continue; done.add(im.text);
    const hard = entriesOn(im.date).some((e) => e.item.kind === 'run' && (e.item.type === 'quality' || e.item.type === 'long'));
    add(`im-${im.date}-${im.text.slice(0, 20)}`, `${im.text} – på grund af det, du har lavet ekstra.`, hard ? swapBtn(im.date) : '');
  }
  if (a.shorten) add(`sh-${a.shorten.key}-${a.shorten.to}`, `Du har løbet ${fmtNum(a.shorten.excess)} km mere end planlagt hidtil i ugen. Forkort ${P.fmtWeekday(a.shorten.date)}s rolige tur fra ${fmtNum(a.shorten.from)} til ${fmtNum(a.shorten.to)} km?`, `<button class="btn filled" data-act="shorten" data-key="${a.shorten.key}" data-to="${a.shorten.to}">Forkort</button>`);
  return cards.length ? `<div class="section-header">Planen har bemærket</div>${cards.join('')}` : '';
}
function shortenDo(key, to) {
  const e = entryByKey(key); if (!e) return;
  if (replaceAt(e, { ...e.item, km: Number(to), description: `${(e.item.description || 'Rolig Z2').replace(/ \(forkortet\)$/, '')} (forkortet)` })) { toast('Den rolige tur er forkortet ✓'); render(); }
}

// ---------- Ugeopgørelse og forslag til næste uge ----------
function reviewData(start) {
  const runs = RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running'));
  const sessions = X.sessionsFrom(S.all('strength_logs'), exerciseIndex());
  const ns = P.addDays(start, 7), nw = P.weekFor(plan, ns);
  const nEntries = sched.entries.filter((e) => e.date >= ns && e.date <= P.addDays(ns, 6));
  const nextWeek = nw ? { deload: !!nw.deload, plannedKm: nEntries.filter((e) => e.item.kind === 'run' && e.item.type !== 'race').reduce((s, e) => s + (e.item.km || 0), 0), plannedSets: nEntries.filter((e) => e.item.kind === 'strength').reduce((s, e) => s + (e.item.exercises || []).reduce((a, x) => a + (Number(x.sets) || 0), 0), 0) } : null;
  const isDone = (e) => statusOf(e.key) === 'done' || !!runActual(e) || setsFor(e.key).length > 0;
  return AC.weeklyReview({ start, entries: sched.entries, isDone, runs, sessions, daily: S.all('garmin_daily'), logs: S.all('daily_log'), nextWeek, others: othersList() });
}
function reviewHTML(start) {
  const t = P.todayISO();
  if (start > t) return '';
  const r = reviewData(start);
  const rec = (settingVal('week_review') || {})[start];
  const sug = r.suggestion, canAct = P.addDays(start, 7) > t && P.weekFor(plan, P.addDays(start, 7));
  const tile = (l, v, sub) => `<div class="stat-tile"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="d" style="color:var(--label-2)"><small>${sub}</small></div>` : ''}</div>`;
  const ratio = r.load.ratio;
  return `<div class="section-header">Ugeopgørelse: planlagt mod faktisk</div>
    <div class="stat-tiles">${tile('Km', `${fmtNum(r.actual.km)}`, `planlagt ${fmtNum(r.planned.km)}`)}
      ${tile('Langtur', `${fmtNum(r.actual.longest)} km`, `planlagt ${fmtNum(r.planned.longest)}`)}
      ${tile('Højdemeter', `${fmtNum(r.actual.elev, 0)} m`, `planlagt ${fmtNum(r.planned.elev, 0)}`)}
      ${tile('Styrkepas', `${r.actual.strength}`, `planlagt ${r.planned.strength}`)}
      ${tile('Benømhed', r.legsAvg != null ? fmtNum(r.legsAvg) : '–', '1 = friske · 5 = ømme')}
      ${tile('Belastning', ratio != null ? fmtNum(ratio, 2) : '–', `7 dage mod 28 dage · mål ${AC.LOAD_RANGE[0]}–${AC.LOAD_RANGE[1]}`)}</div>
    <div class="card" style="margin-top:12px"><div class="title">Næste uge: ${AC.SUGGESTION_LABEL[sug.id]}${sug.factor !== 1 ? ` (${sug.factor > 1 ? '+' : '−'}${Math.round(Math.abs(sug.factor - 1) * 100)} % km)` : ''}</div>
      <ul class="status-reasons" style="margin-top:6px">${sug.reasons.map((x) => `<li>${esc(x[0].toUpperCase() + x.slice(1))}</li>`).join('')}</ul>
      ${r.projected != null ? `<div class="meta">Forventet belastning næste uge: ${fmtNum(r.projected, 2)}</div>` : ''}
      ${rec ? `<div class="meta" style="margin-top:8px">${rec.status === 'accepted' ? '✓ Du accepterede forslaget.' : 'Du beholdt planen.'}</div>`
        : canAct ? `<div class="qa-row"><button class="btn filled" data-act="reviewChoose" data-start="${start}" data-accept="1">${sug.id === 'hold' ? 'Hold planen' : `Brug forslaget: ${AC.SUGGESTION_LABEL[sug.id]}`}</button>${sug.id !== 'hold' ? `<button class="btn" data-act="reviewChoose" data-start="${start}" data-accept="0">Behold planen</button>` : ''}</div>` : ''}</div>`;
}
function reviewChoose(start, accept) {
  const t = P.todayISO(), r = reviewData(start), sug = r.suggestion;
  const all = { ...(settingVal('week_review') || {}) };
  if (accept && sug.factor !== 1) {
    const ns = P.addDays(start, 7), w = plan.weeks.find((x) => x.start === ns);
    if (w) { const { mods } = TU.scaleWeeks([w], sug.pct, t > ns ? t : ns); if (Object.keys(mods).length) { editDays(mods, ns); recompute(); } }
  }
  all[start] = { id: sug.id, status: accept ? 'accepted' : 'declined', at: new Date().toISOString() };
  saveSetting('week_review', all);
  toast(accept && sug.factor !== 1 ? 'Næste uge er justeret ✓' : 'Gemt'); render();
}
// Søndag aften (og mandag): ugeopgørelsen på I dag
function reviewToday(t) {
  const wd = P.parseISO(t).getDay(), hour = new Date().getHours();
  let start = null;
  if (wd === 0 && hour >= 17) start = X.mondayOf(t);
  else if (wd === 1) start = P.addDays(X.mondayOf(t), -7);
  if (!start || !P.weekFor(plan, start)) return '';
  if ((settingVal('week_review') || {})[start]) return '';
  return reviewHTML(start);
}

// Felter i "Tilføj pas" gemmes i tilstanden uden at tegne sheetet igen
document.addEventListener('input', (ev) => { const k = ev.target.dataset && ev.target.dataset.own; if (k && ui.own) ui.own[k] = ev.target.value; });
document.addEventListener('change', (ev) => { const k = ev.target.dataset && ev.target.dataset.own; if (k && ui.own) { ui.own[k] = ev.target.value; if (k === 'date' && ui.own.when === 'now' && ev.target.value !== P.todayISO()) { ui.own.when = 'plan'; ownRender(); } } });
function openTplPicker() {
  const list = (settingVal('session_templates') || {}).list || [];
  openSheet({ title: 'Nyt pas fra skabelon', body: list.length ? `<div class="group">${list.map((t) => `<button class="row tappable" data-act="pgTplPick" data-id="${esc(t.id)}"><span class="grow"><span class="title">${esc(t.name)}</span><span class="meta" style="display:block">${t.exercises.length} øvelser</span></span>${icon('plus')}</button>`).join('')}</div>` : '<div class="card empty">Ingen skabeloner endnu. Gem et eget pas som skabelon under Pas.</div>' });
}
function pgFromTemplate(id) {
  const t = ((settingVal('session_templates') || {}).list || []).find((x) => x.id === id); if (!t) return;
  const lib = exerciseIndex(), leg = O.isLegWork(t.exercises.map((x) => x.exercise), t.muscles, lib);
  pgMut((p) => { p.sessions.push({ id: PG.newId('s'), name: t.name, kind: leg ? 'lower' : 'upper', exercises: PG.clone(t.exercises) }); });
  closeSheet(); toast('Pas tilføjet fra skabelon ✓');
}

// ---- Egne løbeplaner ----
const pgTabs = () => `<div style="margin-top:6px">${seg('pgTab', [['strength', 'Styrke'], ['run', 'Løb']], ui.pgTab)}</div>`;
function runProgramsView() {
  const row = ui.rp && ui.rp.id ? S.get('run_programs', ui.rp.id) : null;
  if (!row || row.deleted) {
    const list = S.all('run_programs').sort((a, b) => (a.name || '').localeCompare(b.name || '', 'da'));
    return `<button class="link-btn back-link" data-act="pgBackMore">${icon('left')}Mere</button><h1 class="large-title" style="margin-top:0">Programmer</h1>${pgTabs()}<div style="height:10px"></div>${RPU.runListHTML(list, (activeRunProgram() || {}).id, {})}`;
  }
  const t = P.todayISO();
  // forslag fra "Løs alle automatisk" vises som forhåndsvisning, før det gemmes
  const draft = ui.rpDraft && ui.rpDraft.id === row.id ? ui.rpDraft : null;
  const viewRow = draft ? { ...row, config: { ...row.config, fixes: { ...(row.config.fixes || {}), ...draft.fixes } } } : row;
  const gen = RP.generate(viewRow);
  let violations = [];
  try {
    const edits = S.all('week_edits'), ver = activeVersion(), prog = activeProgram(), own = customRows();
    const withRp = PL.mergePlan(basePlan, ver, edits, prog, own, { ...viewRow, active: true, generated: gen.days, end_date: gen.end || row.end_date }).weeks;
    const without = PL.mergePlan(basePlan, ver, edits, prog, own, null).weeks;
    const before = new Set(PL.violationsOf(without));
    violations = PL.violationsOf(withRp).filter((v) => !before.has(v));
    const clash = PL.conflictsOnBlocked(withRp.filter((w) => w.days[6].date >= row.start_date), isBlockedDay, row.start_date);
    if (clash.length) violations.push(`${clash.length} pas falder på utilgængelige dage (${clash.slice(0, 3).map((d) => `${P.fmtWeekday(d)} ${P.fmtDateShort(d)}`).join(', ')})`);
  } catch { /* ingen visning */ }
  const rep = row.replaces ? S.get('run_programs', row.replaces) : null;
  // forebyg: hvis km er for lave til antallet af løbedage i de første uger, foreslå en gradvis stigning
  let rampHint = null;
  const early = (gen.issues || []).filter((x) => x.start < P.addDays(row.start_date, 63));
  if (early.length && !(row.config.ramp || []).length) {
    const st = RP.suggestRamp(viewRow);
    if (st.length) rampHint = { text: `Km er for lave til ${row.config.weekdays.length} løbedage i de første uger (fx uge ${P.fmtDateShort(early[0].start)}: ${P.fmtKm(early[0].planned)} km, men ${early[0].days} dage kræver mindst ${P.fmtKm(early[0].actual)} km). Forslag: ${st.map((x) => `${x.days} dage fra uge ${x.week}`).join(', ')}.`, button: 'Brug forslaget' };
  }
  return RPU.runEditHTML(viewRow, { today: t, gen, violations, rampHint, draft: draft ? { count: Object.keys(draft.fixes).length } : null, goals: (plan.goals || []).filter((g) => g.date), replacesName: rep && !rep.deleted ? rep.name : null });
}
function rpFinalize(r) {
  r.config.avoid = (plan.goals || []).filter((x) => x.date && x.date !== r.config.goal_date).map((x) => x.date); // ingen løb lige før/efter andre løb
  const g = RP.generate(r);
  r.generated = g.days;
  r.end_date = r.config.goal_date ? r.config.goal_date : (r.end_date || null);
  return r;
}
function rpMut(fn) {
  const cur = ui.rp && ui.rp.id && S.get('run_programs', ui.rp.id);
  if (!cur) return;
  const next = PG.clone(cur);
  fn(next); rpFinalize(next);
  S.put('run_programs', next);
  if (next.active) { markPlanChanged(next.start_date > P.todayISO() ? next.start_date : P.todayISO()); recompute(); }
  render();
}
function rpNew(base) {
  const id = PG.newId('rp'), goals = (plan.goals || []).filter((g) => g.date && g.date > P.todayISO()).sort((a, b) => (a.date < b.date ? 1 : -1));
  const cfg = base ? base.config : RP.DEFAULTS();
  if (!base && goals[0]) { cfg.goal_date = goals[0].date; cfg.goal_km = /marathon/i.test(goals[0].name) ? 42.2 : 23; }
  const row = rpFinalize({ id, name: base ? 'Min plan (ud fra den nuværende)' : 'Min løbeplan', start_date: (base && base.start_date) || P.addDays(P.todayISO(), 1), end_date: null, active: false, config: cfg, generated: {}, replaces: undefined });
  S.put('run_programs', row);
  ui.rp = { id }; render(); window.scrollTo(0, 0);
}
function rpSetPath(obj, path, raw) {
  const keys = path.split('.'), last = keys.pop();
  let o = obj; for (const k of keys) o = o[k];
  const isNum = /^-?\d+([.,]\d+)?$/.test(String(raw).trim());
  o[last] = raw === '' ? '' : isNum ? Number(String(raw).replace(',', '.')) : raw;
}
// Tidligere ugeændringer med løb i perioden ville skjule løbeplanen: fjern dem (kan fortrydes)
function stripRunEdits(from, to, gen = {}) {
  const snap = [];
  for (const e of S.all('week_edits')) {
    if (!e.days) continue;
    const days = { ...e.days };
    let changed = false;
    for (const [d, items] of Object.entries(days)) {
      if (d < from || d > (to || '9999-12-31')) continue;
      // dage med løb – eller dage, hvor løbeplanen har et løb, som ugeændringen ville skjule
      if (items.some((i) => i.kind === 'run' && i.type !== 'race') || (gen[d] && gen[d].length)) { delete days[d]; changed = true; }
    }
    if (changed) { snap.push(e); S.put('week_edits', { ...e, days }); }
  }
  return snap;
}
function rpActivate(fix) {
  const cur = S.get('run_programs', ui.rp.id); if (!cur) return;
  if (!cur.active && cur.start_date < P.todayISO()) { toast('Startdatoen kan ikke ligge før i dag.'); return; }
  const prev = S.all('run_programs').filter((x) => x.active && x.id !== cur.id);
  for (const p of prev) S.put('run_programs', { ...p, active: false });
  const snap = stripRunEdits(cur.start_date > P.todayISO() ? cur.start_date : P.todayISO(), cur.end_date, cur.generated || {});
  S.put('run_programs', { ...cur, active: true, replaces: cur.active ? cur.replaces : ((prev[0] || {}).id || null) });
  markPlanChanged(cur.start_date); recompute();
  toast(`Løbeplanen gælder fra ${P.fmtDateShort(cur.start_date)} ✓${snap.length ? ' – tidligere ugeændringer af løb er fjernet' : ''}`, snap.length || prev.length ? () => {
    for (const e of snap) S.put('week_edits', e);
    S.put('run_programs', { ...cur, active: !!cur.active });
    for (const p of prev) S.put('run_programs', { ...p, active: true });
    markPlanChanged(cur.start_date); recompute(); render();
  } : null, 8000);
  if (fix) hybridRepair(); else render();
}
function rpStop() {
  const cur = S.get('run_programs', ui.rp.id); if (!cur) return;
  S.put('run_programs', { ...cur, active: false }); markPlanChanged(cur.start_date); recompute(); toast('Løbeplanen er stoppet – planens egne løbepas gælder igen'); render();
}
function rpRestore(id) {
  const cur = S.get('run_programs', id); if (!cur) return;
  S.put('run_programs', { ...cur, active: false });
  const prev = cur.replaces && S.get('run_programs', cur.replaces);
  if (prev && !prev.deleted) S.put('run_programs', { ...prev, active: true });
  markPlanChanged(cur.start_date); recompute();
  toast(prev && !prev.deleted ? `"${prev.name}" er gendannet` : 'Den indbyggede plan er gendannet'); render();
}
document.addEventListener('change', (ev) => {
  const el = ev.target, ds = el.dataset || {};
  if (ds.rp !== undefined) {
    rpMut((r) => {
      if (ds.rp === 'config.goal_date') {
        const g = (plan.goals || []).find((x) => x.date === el.value);
        if (g) { r.config.goal_date = g.date; r.config.goal_km = /marathon/i.test(g.name) ? 42.2 : 23; } else { delete r.config.goal_date; delete r.config.goal_km; }
      } else if (['name', 'start_date', 'end_date'].includes(ds.rp)) r[ds.rp] = el.value;
      else rpSetPath(r, ds.rp, el.value);
    });
    return;
  }
  if (ds.rpRow !== undefined) {
    rpMut((r) => { const row = r.config.rows[Number(ds.rpRow)]; if (!row) return; rpSetPath(row, ds.f, el.value); if (ds.f === 'sub') row.zone = ''; });
    return;
  }
  if (ds.rpRamp !== undefined) { rpMut((r) => { const x = (r.config.ramp || [])[Number(ds.rpRamp)]; if (x) rpSetPath(x, ds.f, el.value); }); return; }
  if (ds.rpRot !== undefined) { rpMut((r) => { const it = r.config.rotation[Number(ds.rpRot)]; if (it) rpSetPath(it, ds.f, el.value); }); return; }
  if (ds.rpAddrot !== undefined && el.value) { const ps = RP.preset(el.value); rpMut((r) => { r.config.rotation.push({ id: ps.id, reps: ps.reps, min: ps.min }); }); }
});

// ---- Programmer ----
function programsView() {
  if (ui.pgTab === 'run') return runProgramsView();
  const pg = ui.pg && ui.pg.id ? S.get('programs', ui.pg.id) : null;
  const t = P.todayISO();
  if (!pg || pg.deleted) {
    const list = S.all('programs').sort((a, b) => (a.name || '').localeCompare(b.name || '', 'da'));
    return PGU.programsHTML(list, (activeProgram() || {}).id, PG.BUILTINS.filter((b) => !list.some((p) => p.builtin === b.id)), pgTabs());
  }
  if (ui.pg.sid) {
    const s = pg.sessions.find((x) => x.id === ui.pg.sid);
    if (s) return PGU.sessionHTML(pg, s, { lib: exerciseIndex() });
  }
  // regeltjek af programmet, som det ville ligge i planen fra den valgte dato
  let violations = [];
  try {
    const start = pg.start_date && pg.active ? pg.start_date : P.addDays(t, 1);
    const weeks = PG.applyProgram(basePlanWeeksFrom(start), { ...pg, active: true, start_date: start });
    violations = PL.violationsOf(weeks);
  } catch { /* ingen visning */ }
  return PGU.programHTML(pg, { today: t, defaultStart: P.addDays(t, 1), violations });
}
function basePlanWeeksFrom(start) { return JSON.parse(JSON.stringify(plan.weeks.filter((w) => w.days[6].date >= start).slice(0, 8))); }
function pgMut(fn) {
  const cur = ui.pg && ui.pg.id && S.get('programs', ui.pg.id);
  if (!cur) return;
  const next = PG.clone({ ...cur });
  fn(next);
  S.put('programs', next);
  if (next.active) { markPlanChanged(next.start_date > P.todayISO() ? next.start_date : P.todayISO()); recompute(); }
  render();
}
function pgSession() { const cur = ui.pg && ui.pg.id && S.get('programs', ui.pg.id); return cur ? cur.sessions.find((s) => s.id === ui.pg.sid) : null; }
function pgNew(builtin) {
  const base = builtin ? PG.clone(builtin) : { name: 'Nyt program', sessions: [], pattern: {}, leg_volume: 'normal', adapt_weeks: 0 };
  const id = PG.newId();
  S.put('programs', { ...base, id, builtin: builtin ? builtin.id : null, active: false, start_date: null });
  ui.pg = { id, sid: null }; render(); window.scrollTo(0, 0);
}
function pgCopy(id) {
  const cur = S.get('programs', id); if (!cur) return;
  const next = PG.clone(cur); next.id = PG.newId(); next.name = `${cur.name} (kopi)`; next.active = false; next.start_date = null; next.builtin = null;
  S.put('programs', next); toast('Kopi lavet'); render();
}
function pgDelete(id) {
  const cur = S.get('programs', id); if (!cur) return;
  if (!window.confirm(`Slet "${cur.name}"?${cur.active ? ' Planens egne styrkepas gælder igen.' : ''} Dine logs ændres ikke.`)) return;
  const wasActive = cur.active;
  S.remove('programs', id);
  if (wasActive) { markPlanChanged(P.todayISO()); recompute(); }
  render();
}
function pgActivate() {
  const v = ($('#pg-start') || {}).value;
  if (!v) { toast('Vælg en startdato.'); return; }
  if (v < P.todayISO()) { toast('Startdatoen kan ikke ligge før i dag.'); return; }
  const cur = S.get('programs', ui.pg.id); if (!cur) return;
  for (const p of S.all('programs').filter((x) => x.active && x.id !== cur.id)) S.put('programs', { ...p, active: false });
  S.put('programs', { ...cur, active: true, start_date: v });
  markPlanChanged(v); recompute();
  toast(`Programmet gælder fra ${P.fmtDateShort(v)} ✓`); render();
}
function pgStop() {
  const cur = S.get('programs', ui.pg.id); if (!cur) return;
  S.put('programs', { ...cur, active: false });
  markPlanChanged(cur.start_date || P.todayISO()); recompute();
  toast('Programmet er stoppet'); render();
}
function openProgramExPicker() {
  const body = `<div class="search"><span class="search-ic">${icon('search')}</span><input type="search" id="pgExSearch" placeholder="Søg i øvelsesbiblioteket" autocomplete="off" aria-label="Søg øvelse"></div><div id="pgExResults">${pgPickerResults('')}</div>`;
  openSheet({ title: 'Tilføj øvelse', body, onMount: (root) => { $('#pgExSearch', root).addEventListener('input', (ev) => { $('#pgExResults', root).innerHTML = pgPickerResults(ev.target.value); }); } });
}
function pgPickerResults(q) {
  const all = allExercises(), query = q.trim().toLowerCase();
  const row = (x) => `<button class="row tappable" data-act="pgExPick" data-name="${esc(x.name)}"><span class="grow"><span class="title">${esc(x.name)}</span><span class="meta" style="display:block">${esc([x.group, x.equipment].filter(Boolean).join(' · '))}${PG.givesSoreness(x.name, exerciseIndex()) ? ' · Giver meget ømhed' : ''}</span></span>${icon('plus')}</button>`;
  if (query) { const hits = all.filter((x) => [x.name, x.group, x.pattern, x.equipment].join(' ').toLowerCase().includes(query)); return hits.length ? `<div class="group">${hits.slice(0, 40).map(row).join('')}</div>` : '<div class="card empty">Ingen øvelser fundet.</div>'; }
  const groups = (exercisesFile && exercisesFile.groups) || [...new Set(all.map((x) => x.group))];
  return groups.map((g) => { const xs = all.filter((x) => x.group === g); return xs.length ? `<div class="section-header">${esc(g)}</div><div class="group">${xs.map(row).join('')}</div>` : ''; }).join('');
}
// Felter i programeditoren gemmes med det samme
document.addEventListener('change', (ev) => {
  const el = ev.target, ds = el.dataset || {};
  if (ds.pg === 'name') { pgMut((p) => { p.name = el.value.trim() || 'Program'; }); return; }
  if (ds.pgPat !== undefined) { pgMut((p) => { p.pattern = { ...(p.pattern || {}) }; if (el.value) p.pattern[ds.pgPat] = el.value; else delete p.pattern[ds.pgPat]; }); return; }
  if (ds.pgS === 'name') { pgMut((p) => { const s = p.sessions.find((x) => x.id === ui.pg.sid); if (s) s.name = el.value.trim() || 'Pas'; }); return; }
  if (ds.pgEx !== undefined) {
    pgMut((p) => {
      const x = (p.sessions.find((s) => s.id === ui.pg.sid) || { exercises: [] }).exercises[Number(ds.pgEx)]; if (!x) return;
      const f = ds.f;
      if (f === 'sets' || f === 'rest_sec') { const n = Number(el.value); if (f === 'rest_sec' && !n) delete x.rest_sec; else x[f] = n; }
      else x[f] = el.value.trim();
    });
  }
});

// ---- Hybrid-regler ----
function upcomingViolations() {
  const t = P.todayISO();
  return PL.violationsOf(plan.weeks.filter((w) => w.days[6].date >= t));
}
// Skriv ændrede dage som ugeændringer (kun de dage, der er givet). mods: { dato: [pas] }
function editDays(mods, floor) {
  mods = splitCustom(mods);
  const byWeek = {};
  for (const [d, items] of Object.entries(mods)) { const m = PL.mondayOf(d); if (!byWeek[m]) byWeek[m] = {}; byWeek[m][d] = items; }
  for (const [m, days] of Object.entries(byWeek)) {
    const ex = S.get('week_edits', m);
    S.put('week_edits', { id: m, week_type: (ex && !ex.deleted && ex.week_type) || 'normal', days: { ...((ex && !ex.deleted && ex.days) || {}), ...days }, note: (ex && ex.note) || '' });
  }
  markPlanChanged(floor || P.todayISO());
}
function saveRules(patch) { saveSetting('hybrid_rules', { ...P.getRules(), ...patch }); recompute(); render(); }
function hybridRepair() {
  const t = P.todayISO();
  const weeks = JSON.parse(JSON.stringify(plan.weeks.filter((w) => w.days[6].date >= t)));
  const before = PL.violationsOf(weeks).length;
  const changed = PL.repairWeeks(weeks, t, isBlockedDay);
  const after = PL.violationsOf(weeks).length;
  if (!changed.length) { toast(before ? 'Kunne ikke finde en bedre placering inden for ugerne.' : 'Ingen regelbrud.'); return; }
  const mods = {};
  for (const w of weeks.filter((x) => changed.includes(x.start))) for (const d of w.days) if (d.date >= t) mods[d.date] = d.items;
  editDays(mods, t);
  recompute();
  toast(after ? `Rettet delvist: ${before} → ${after} regelbrud` : 'Alle regelbrud er rettet ✓'); render();
}

// ---- Genstart ----
function wizardDefaults() {
  const t = P.todayISO(), from = P.addDays(t, -14);
  const runs = RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running')).filter((r) => r.date > from && r.date <= t);
  const km = Math.round((runs.reduce((s, r) => s + r.km, 0) / 2) * 10) / 10;
  const str = new Set(S.all('strength_logs').filter((r) => r.date > from && r.date <= t && num(r.reps) != null).map((r) => r.item_key)).size;
  const pr = planPrefs();
  return { step: 1, start: P.addDays(t, 1), km, long: Math.max(0, ...runs.map((r) => r.km)), str, perWeek: '3', wd: [...pr.blocked_weekdays], result: null };
}
function runGenerate(rs) {
  const blockedDates = {};
  for (const [d, k] of Object.entries(travelDays())) if (k === 'fly' || k === 'off') blockedDates[d] = k;
  return PL.generatePlan({ template: basePlan, current: plan, start: rs.start, recentKm: num(rs.km) || 0, recentLong: num(rs.long) || 0,
    recentStrength: num(rs.str) || 0, strengthPerWeek: Number(rs.perWeek), blockedWeekdays: rs.wd, blockedDates,
    strict: rs.mode === 'strict', cautious: rs.mode === 'cautious' });
}
function rsNext() {
  const rs = ui.rs;
  if (!rs) return;
  if (rs.step === 1) {
    const v = $('#rs-start').value;
    if (!v) { toast('Vælg en startdato.'); return; }
    if (v < P.todayISO()) { toast('Startdatoen kan ikke ligge før i dag.'); return; }
    rs.start = v; rs.step = 2;
  } else if (rs.step === 2) {
    rs.km = num($('#rs-km').value) ?? 0; rs.long = num($('#rs-long').value) ?? 0; rs.str = Math.max(0, Math.round(num($('#rs-str').value) ?? 0)); rs.step = 3;
  } else if (rs.step === 3) {
    rs.replacing = (activeVersion() || {}).label || 'Oprindelig plan';
    rs.result = runGenerate(rs);
    if (rs.result.error) { toast(rs.result.error); return; }
    rs.step = 4;
  }
  render(); window.scrollTo(0, 0);
}
function rsSave() {
  const rs = ui.rs, r = rs && rs.result;
  if (!r || r.error) return;
  const id = `pv-${Date.now().toString(36)}`, prevId = (activeVersion() || {}).id || null;
  for (const v of S.all('plan_versions').filter((x) => x.active)) S.put('plan_versions', { ...v, active: false });
  S.put('plan_versions', {
    id, label: `Genstart ${P.fmtDateShort(rs.start)}`, start_date: rs.start, active: true,
    inputs: { start: rs.start, km: rs.km, long: rs.long, str: rs.str, perWeek: rs.perWeek, wd: rs.wd, mode: rs.mode || 'goals' },
    weeks: r.weeks.filter((w) => w.start >= r.startMonday), summary: r.summary,
  });
  for (const e of S.all('week_edits').filter((x) => x.id >= r.startMonday)) S.remove('week_edits', e.id); // erstattet af den nye plan
  saveSetting('plan_prefs', { ...planPrefs(), blocked_weekdays: rs.wd, strength_per_week: Number(rs.perWeek) });
  { const pz = pauseInfo(); if (pz) saveSetting('pause_dismissed', { key: pz.key, at: new Date().toISOString() }); } // genstarten afløser pause-forslaget
  markPlanChanged(rs.start);
  ui.planView = 'main'; ui.rs = null;
  toast('Planen er genstartet ✓', () => { useVersion(prevId); }, 9000); render(); window.scrollTo(0, 0);
}

// ---- Versioner ----
function useVersion(id) {
  for (const v of S.all('plan_versions')) if (!!v.active !== (v.id === id)) S.put('plan_versions', { ...v, active: v.id === id });
  const v = id && S.get('plan_versions', id);
  markPlanChanged(v ? v.start_date : P.todayISO());
  toast(id ? 'Planversionen er i brug' : 'Den oprindelige plan er i brug'); render();
}

// ---- Tilbage efter pause ----
function lastActivityDate() {
  const t = P.todayISO(); let last = null;
  const take = (d) => { if (d && d <= t && (!last || d > last)) last = d; };
  for (const r of S.all('strength_logs')) if (num(r.reps) != null) take(r.date);
  for (const r of S.all('run_logs')) take(r.date);
  for (const a of S.all('garmin_activities')) if (a.type === 'running') take(a.date);
  for (const r of S.all('session_status')) if (r.status === 'done') take(r.date);
  return last;
}
function lastNormalKm(before) { // km i den seneste uge med mindst 2 løb før pausen
  const wk = {};
  for (const r of RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running'))) {
    const m = X.mondayOf(r.date); (wk[m] ||= { km: 0, n: 0 }); wk[m].km += r.km; wk[m].n++;
  }
  const cand = Object.entries(wk).filter(([m, v]) => v.n >= 2 && m <= X.mondayOf(before || P.todayISO())).sort((a, b) => (a[0] < b[0] ? 1 : -1))[0];
  return cand ? Math.round(cand[1].km * 10) / 10 : null;
}
function pauseInfo() {
  const t = P.todayISO();
  if (t < plan.start || A.healthActive(settingVal('health'), t)) return null;
  const thisWeek = S.get('week_edits', X.mondayOf(t));
  if (thisWeek && thisWeek.week_type === 'sick') return null; // du er syg lige nu
  const last = lastActivityDate();
  const sick = S.all('week_edits').find((e) => e.week_type === 'sick' && P.addDays(e.id, 6) < t && P.addDays(e.id, 6) >= P.addDays(t, -7));
  const days = P.daysBetween(last || plan.start, t);
  if (days < 7 && !sick) return null;
  const key = sick && days < 7 ? `sick-${sick.id}` : last || 'start';
  const dis = settingVal('pause_dismissed');
  if (dis && dis.key === key) return null;
  return { days: Math.max(days, 7), reason: sick && days < 7 ? 'sick' : 'pause', key, last, refKm: lastNormalKm(last), weights: 0 };
}
function lowerWeights(weeks) {
  const ctx = strengthCtx(), t = P.todayISO();
  let n = 0;
  const names = new Set(weeks.flatMap((w) => w.days.filter((d) => d.date >= t).flatMap((d) => d.items.filter((i) => i.kind === 'strength').flatMap((i) => i.exercises.map((x) => x.exercise)))));
  for (const name of names) {
    const last = T.sessionsFor(S.all('strength_logs'), ctx, name, { key: '__after__', date: '9999-12-31' }).pop();
    if (!last) continue;
    const top = Math.max(0, ...last.sets.map((x) => x.kg)), lt = T.loadType(ctx, name);
    if (!top || lt === 'bodyweight') continue;
    const target = top * 0.9;
    const kg = lt === 'per_hand' ? ([...T.DB_WEIGHTS].reverse().find((w) => w <= target) || target) : Math.floor(target / 2.5) * 2.5;
    S.put('exercise_settings', { ...(S.get('exercise_settings', name) || { id: name }), next_kg: kg, next_set_on: t, start_confirmed: true });
    n++;
  }
  return n;
}
function pauseOpen() {
  const info = pauseInfo();
  if (!info) return;
  ui.pauseWeeks = ui.pauseWeeks || '1';
  const weeks = [0, 1].map((k) => plan.weeks.find((w) => w.start === X.mondayOf(P.addDays(P.todayISO(), 7 * k)))).filter(Boolean);
  const ctx = strengthCtx();
  info.weights = info.days > 14 ? new Set(weeks.flatMap((w) => w.days.flatMap((d) => d.items.filter((i) => i.kind === 'strength').flatMap((i) => i.exercises.map((x) => x.exercise))))).size : 0;
  openSheet({ title: 'Tilbage efter pause', body: PU.pauseSheetHTML(info, ui.pauseWeeks),
    footer: `<button class="btn filled block" data-act="pauseApply">${icon('check')}Tilpas de næste uger</button>` });
  void ctx;
}
function pauseApply() {
  const info = pauseInfo();
  if (!info) return;
  const n = Number(ui.pauseWeeks || 1), t = P.todayISO(), done = [];
  for (let k = 0; k < n; k++) {
    const ws = X.mondayOf(P.addDays(t, 7 * k)), w = plan.weeks.find((x) => x.start === ws);
    if (!w) continue;
    const floor = ws > t ? ws : t, frac = (7 - P.daysBetween(ws, floor)) / 7;
    const days = PL.tidyDays(PL.reshapeWeek(w.days, 'back', { floor, volume: 0.7, refKm: info.refKm != null ? info.refKm * frac : null }));
    S.put('week_edits', { id: ws, week_type: 'back', days: splitCustom(Object.fromEntries(days.map((d) => [d.date, d.items]))), note: 'Tilbage efter pause' });
    done.push({ days });
  }
  const lowered = info.days > 14 ? lowerWeights(done) : 0;
  saveSetting('pause_dismissed', { key: info.key, at: new Date().toISOString() });
  markPlanChanged(t);
  closeSheet();
  toast(`Tilpasset de næste ${n === 1 ? 'uge' : 'uger'}${lowered ? ` · ${lowered} startvægte sænket ca. 10 %` : ''}`);
  render();
}

// ---- Tilpas ugen ----
let we = null;
const WE_ADD = [['run:easy', 'Rolig tur'], ['run:long', 'Langtur'], ['str:Lower', 'Lower'], ['str:Upper (mandag)', 'Upper (man)'], ['str:Upper (fredag)', 'Upper (fre)']];
function weekEditOpen(start) {
  const w = P.weekFor(plan, start);
  const t = P.todayISO();
  if (!w) return;
  if (P.addDays(start, 6) < t) { toast('Ugen er allerede slut.'); return; }
  const baseWeek = PL.mergePlan(basePlan, activeVersion(), []).weeks.find((x) => x.start === start) || w;
  const ex = S.get('week_edits', start);
  const strengthN = w.days.flatMap((d) => d.items.filter((i) => i.kind === 'strength')).length;
  we = { start, floor: t > start ? t : start, orig: clone(baseWeek.days), days: clone(w.days), weekNo: w.week,
    type: ex && ['busy', 'exam', 'trip', 'sick'].includes(ex.week_type) ? ex.week_type : 'normal', perWeek: '3', baseViol: new Set(PL.violationsOf(plan.weeks)) };
  openSheet({ title: 'Tilpas ugen', body: weRender(),
    footer: `<div class="btn-row"><button class="btn flex" data-act="weReset">Nulstil</button><button class="btn filled flex" data-act="weSave">${icon('check')}Gem</button></div>` });
}
function weCtx() {
  const weeks = plan.weeks.map((w) => (w.start === we.start ? { ...w, days: we.days } : w));
  return { weekNo: we.weekNo, violations: PL.violationsOf(weeks).filter((v) => !we.baseViol.has(v)), blocked: PL.conflictsOnBlocked([{ days: we.days }], isBlockedDay, we.floor),
    travel: travelDays(), today: P.todayISO(), config, blockedWd: planPrefs().blocked_weekdays, addOptions: WE_ADD };
}
const weRender = () => PU.weekEditorHTML(we, weCtx());
function weRefresh() { const sb = $('#sheetBody'), top = sb.scrollTop; sb.innerHTML = weRender(); sb.scrollTop = top; }
const weDay = (date) => we.days.find((d) => d.date === date);
const weClean = () => { we.days = PL.tidyDays(we.days); };
function weSetType(type) {
  we.type = type;
  we.days = PL.tidyDays(PL.reshapeWeek(we.orig, type, { floor: we.floor }));
  if (type === 'normal') weSetPer(we.perWeek, true);
  weRefresh();
}
function weSetPer(v, silent) {
  we.perWeek = v;
  if (we.type !== 'normal') return;
  const strength = we.days.flatMap((d) => d.items.filter((i) => i.kind === 'strength').map((i) => ({ d, i })));
  if (v === '3') {
    for (const { d, i } of strength) if (i.session === 'Skulder & arm' && d.date >= we.floor) d.items = d.items.filter((x) => x !== i);
  } else if (!strength.some((x) => x.i.session === 'Skulder & arm')) {
    const day = we.days.find((d) => d.date >= we.floor && !d.items.some((i) => i.kind === 'strength') && !isBlockedDay(d.date)) || null;
    const item = makeWeItem('str:Skulder & arm');
    if (day && item) day.items = [...day.items.filter((i) => i.kind !== 'rest'), item];
  }
  weClean();
  if (!silent) weRefresh();
}
function makeWeItem(spec) {
  const [kind, name] = spec.split(':');
  if (kind === 'run') {
    const kms = we.days.flatMap((d) => d.items.filter((i) => i.kind === 'run' && i.type === 'easy').map((i) => i.km)).sort((a, b) => a - b);
    const base = kms.length ? kms[Math.floor(kms.length / 2)] : 5;
    return name === 'long' ? { kind: 'run', type: 'long', km: Math.max(8, Math.round(base * 1.8)), description: 'Rolig Z2', zone: 'Z2' } : { kind: 'run', type: 'easy', km: base, description: 'Rolig Z2', zone: 'Z2' };
  }
  const tpl = plan.weeks.flatMap((w) => w.days.flatMap((d) => d.items)).find((i) => i.kind === 'strength' && i.session === name && !/Deload/.test(i.note || ''));
  return tpl ? clone(tpl) : null;
}
function weSave() {
  const days = splitCustom(Object.fromEntries(PL.tidyDays(we.days).map((d) => [d.date, d.items])));
  const same = we.type === 'normal' && JSON.stringify(days) === JSON.stringify(Object.fromEntries(we.orig.map((d) => [d.date, d.items])));
  if (same) S.remove('week_edits', we.start); else S.put('week_edits', { id: we.start, week_type: we.type, days, note: '' });
  markPlanChanged(we.floor);
  closeSheet(); we = null;
  toast('Ugen er tilpasset ✓'); render();
}

// ---- Opdatér ur og kalender ----
function openPlanSync() {
  const s = settingVal('plan_sync') || {};
  openSheet({ title: 'Opdatér ur og kalender', body: PU.planSyncHTML({ from: s.from || P.todayISO(), queued: !!s.queued }),
    footer: `<button class="btn block" data-act="planSyncDone">Jeg har opdateret</button>` });
}
function downloadICS() {
  const { text, count } = ICS.buildICS({ plan, entries: sched.entries, config, exercisesOf: (e) => exList(e) });
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a'); a.href = url; a.download = 'traeningsplan.ics'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Kalenderfil med ${count} begivenheder hentet`);
}

// ---------- Sko ----------
function updateShoes(fn) {
  const cur = settingVal('shoes') || {};
  saveSetting('shoes', { ...cur, shoes: fn(cur.shoes || []) });
  render();
}
function openShoeNew() {
  openSheet({ title: 'Ny sko', body: `<div class="group" style="margin-top:6px">
      <div class="field"><label for="sh-name">Navn</label><input id="sh-name" placeholder="f.eks. Nike Pegasus 41"></div>
      <div class="field"><label for="sh-km0">Startkm</label><input id="sh-km0" inputmode="decimal" placeholder="0" value="0"><span class="suffix">km</span></div>
      <div class="field"><label for="sh-from">I brug fra</label><input id="sh-from" type="date" value="${P.todayISO()}"></div></div>
    <div class="section-footer">Er skoene allerede brugt, så skriv de kilometer, de har. De nuværende sko i brug pensioneres automatisk fra dagen før.</div>`,
    footer: `<button class="btn filled block" data-act="shoeSave">${icon('check')}Tilføj sko</button>`, onMount: () => setTimeout(() => $('#sh-name').focus(), 350) });
}
function saveShoe() {
  const name = $('#sh-name').value.trim();
  if (!name) { toast('Giv skoene et navn.'); return; }
  const from = $('#sh-from').value || P.todayISO(), km0 = num($('#sh-km0').value) || 0;
  closeSheet();
  updateShoes((l) => [...l.map((x) => (!x.to && !x.retired ? { ...x, to: P.addDays(from, -1) } : x)), { id: `sh-${Date.now().toString(36)}`, name, km0, from }]);
  toast('Sko tilføjet');
}

// ---------- Dagbog (vægt, protein, søvn) ----------
function dailyHTML() {
  const t = P.todayISO(), date = ui.dailyDate || t;
  const cur = S.get('daily_log', date) || {};
  const rows = S.all('daily_log').filter((r) => r.date).sort((a, b) => (a.date < b.date ? -1 : 1));
  const wts = rows.filter((r) => num(r.weight_kg) != null && r.date >= P.addDays(t, -90)).map((r) => ({ date: r.date, v: num(r.weight_kg) }));
  const last7 = rows.filter((r) => r.date > P.addDays(t, -7) && num(r.protein_g) != null);
  const kg = wts.length ? wts[wts.length - 1].v : null;
  const protAvg = last7.length ? last7.reduce((s, r) => s + num(r.protein_g), 0) / last7.length : null;
  let h = `<h1 class="large-title">Dagbog</h1><div class="subtitle">Valgfrit: vægt, protein og søvn</div>
    <div class="group"><div class="field"><label for="dl-date">Dato</label><input id="dl-date" type="date" value="${date}" max="${t}" data-act-change="dailyDate"></div>
      <div class="field"><label for="dl-w">Kropsvægt</label><input id="dl-w" inputmode="decimal" placeholder="kg" value="${cur.weight_kg != null ? String(cur.weight_kg).replace('.', ',') : ''}"><span class="suffix">kg</span></div>
      <div class="field"><label for="dl-p">Protein</label><input id="dl-p" inputmode="numeric" placeholder="gram" value="${cur.protein_g ?? ''}"><span class="suffix">g</span></div>
      <div class="field"><label for="dl-s">Søvn</label><input id="dl-s" inputmode="decimal" placeholder="timer" value="${cur.sleep_h != null ? String(cur.sleep_h).replace('.', ',') : ''}"><span class="suffix">t</span></div>
      <div class="field stack"><label for="dl-n">Note</label><textarea id="dl-n" placeholder="Hvordan har du det?">${esc(cur.note || '')}</textarea></div></div>
    <button class="btn filled block" style="margin-top:14px" data-act="dailySave">${icon('check')}Gem</button>`;
  if (kg != null) {
    h += `<div class="section-header">Kropsvægt (90 dage)</div><div class="card">${SU.lineChart(wts, { unit: 'kg', decimals: 1 })}</div>`;
  }
  if (protAvg != null) {
    const target = kg ? `Mål 1,6–2 g/kg: ${fmtNum(kg * 1.6, 0)}–${fmtNum(kg * 2, 0)} g/dag.` : 'Skriv din vægt for at se dit mål (1,6–2 g/kg).';
    h += `<div class="section-header">Protein</div><div class="card"><b>${fmtNum(protAvg, 0)} g/dag</b> i snit de seneste ${last7.length} dage med log.<div class="meta">${target}</div></div>`;
  }
  const hist = rows.slice(-10).reverse();
  if (hist.length) h += `<div class="section-header">Seneste</div><div class="group">${hist.map((r) => `<button class="row tappable" data-act="dailyOpen" data-date="${r.date}"><span class="grow"><span class="title">${P.fmtWeekday(r.date)} ${P.fmtDateShort(r.date)}</span><span class="meta" style="display:block">${[r.weight_kg != null ? `${fmtNum(r.weight_kg)} kg` : '', r.protein_g != null ? `${fmtNum(r.protein_g, 0)} g protein` : '', r.sleep_h != null ? `${fmtNum(r.sleep_h)} t søvn` : ''].filter(Boolean).join(' · ') || 'Kun note'}</span></span>${icon('right', 'chev')}</button>`).join('')}</div>`;
  return h;
}
function raceHTML() {
  const rs = RS.runsList(S.all('run_logs'), S.all('garmin_activities').filter((a) => a.type === 'running')).filter((r) => r.km >= 5 && r.sec).slice(-8).map((r) => r.sec / r.km).sort((a, b) => a - b);
  const easyPace = rs.length >= 3 ? rs[Math.floor(rs.length / 2)] : null;
  return RC.raceHTML({ plan, config, today: P.todayISO(), entries: sched.entries, easyPace });
}

const MORE = [
  { id: 'account', label: 'Konto og synkronisering', icon: 'cloud', color: 'k-accent' },
  { id: 'plan', label: 'Plan', icon: 'list', color: 'k-accent' },
  { id: 'programs', label: 'Programmer', icon: 'strength', color: 'k-strength' },
  { id: 'hybrid', label: 'Hybrid-regler', icon: 'edit', color: 'k-strength' },
  { id: 'versions', label: 'Planversioner', icon: 'backup', color: 'k-gray' },
  { id: 'recovery', label: 'Restitution', icon: 'heart', color: 'k-race' },
  { id: 'race', label: 'Racedag', icon: 'flag', color: 'k-race' },
  { id: 'daily', label: 'Dagbog', icon: 'log', color: 'k-gray' },
  { id: 'health', label: 'Syg eller skadet', icon: 'cross', color: 'k-race' },
  { id: 'travel', label: 'Utilgængelige dage', icon: 'plane', color: 'k-accent' },
  { id: 'checklists', label: 'Tjeklister', icon: 'list', color: 'k-strength' },
  { id: 'zones', label: 'Zoner og tempo', icon: 'gauge', color: 'k-accent' },
  { id: 'quotes', label: 'Citater', icon: 'quote', color: 'k-accent' },
  { id: 'swaps', label: 'Mine øvelsesskift', icon: 'swap', color: 'k-strength' },
  { id: 'rules', label: 'Regler', icon: 'book', color: 'k-gray' },
  { id: 'backup', label: 'Backup og kalender', icon: 'backup', color: 'k-gray' },
];
function moreHTML() {
  return `<h1 class="large-title">Mere</h1><div class="subtitle">${syncPill()}</div>
    <div class="group">${MORE.map((m) => `<button class="row tappable has-icon" data-act="sub" data-sub="${m.id}"><span class="badge-ic ${m.color}">${icon(m.icon)}</span><span class="grow title">${m.label}</span>${icon('right', 'chev')}</button>`).join('')}</div>`;
}

// ---------- "Hent løbedata" ----------
// Mac'en henter løbeturene fra Garmin (flere gange om dagen) og lægger dem i Supabase. Knappen henter det nyeste ned i appen.
const hhmm = (iso) => new Date(iso).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
const runUi = { busy: false, kind: '', html: '' };
const dayWord = (d) => { const n = P.daysBetween(d.toLocaleDateString('sv-SE'), P.todayISO()); return n === 0 ? 'i dag' : n === 1 ? 'i går' : `${n} dage siden`; };
function lastGarminPull() {
  const t = [...S.all('garmin_activities'), ...S.all('garmin_daily')].map((r) => Date.parse(r.updated_at)).filter((x) => x > 0);
  return t.length ? new Date(Math.max(...t)) : null;
}
function setRunUi(patch) { Object.assign(runUi, patch); updateRunDom(); }
const runStatusHTML = () => (runUi.busy ? 'Henter …' : runUi.html);
function updateRunDom() {
  $$('.run-status').forEach((el) => { el.className = `run-status ${runUi.busy ? '' : runUi.kind}`; el.innerHTML = runStatusHTML(); });
  $$('.run-btn').forEach((b) => { b.disabled = runUi.busy; b.classList.toggle('busy', runUi.busy); });
}
function runDataButton() {
  return `<div class="run-box"><button class="btn filled block run-btn ${runUi.busy ? 'busy' : ''}" data-act="fetchRuns" ${runUi.busy ? 'disabled' : ''}>${icon('refresh')}Hent løbedata</button>
    <div class="run-status ${runUi.busy ? '' : runUi.kind}" role="status">${runStatusHTML()}</div></div>`;
}
async function fetchRuns() {
  if (runUi.busy) return;
  if (!Sync.configured || !Sync.currentUser()) { setRunUi({ kind: 'err', html: 'Log ind først (Mere → Konto og synkronisering).' }); return; }
  if (!navigator.onLine) { setRunUi({ kind: 'err', html: 'Du er offline – prøv igen, når du har net.' }); return; }
  setRunUi({ busy: true });
  const before = new Set(S.all('garmin_activities').filter((a) => a.type === 'running').map((a) => a.id));
  try {
    await Sync.syncNow();
    const n = S.all('garmin_activities').filter((a) => a.type === 'running' && !before.has(a.id)).length;
    const last = lastGarminPull();
    const hours = last ? (Date.now() - last.getTime()) / 36e5 : null;
    const parts = [`Hentet kl. ${hhmm(new Date().toISOString())}`, n ? `${n} ny${n === 1 ? ' tur' : 'e ture'}` : 'Ingen nye ture'];
    let kind = 'ok', extra = '';
    if (last) {
      extra = `Garmin hentet af Mac'en ${dayWord(last)} kl. ${hhmm(last)}`;
      if (hours > 10 && !n) { kind = ''; extra += ' – nye ture kommer med, næste gang Mac\'en henter fra Garmin.'; }
    } else { kind = ''; extra = 'Der er endnu ikke hentet noget fra Garmin.'; }
    setRunUi({ busy: false, kind, html: `${parts.join(' · ')}<br><span class="sub">${esc(extra)}</span>` });
    render();
  } catch (e) {
    setRunUi({ busy: false, kind: 'err', html: esc(e.message || 'Hentningen fejlede.') });
  }
}

// Planlagt vs. faktisk, tid i pulszoner og splits for en tur fra Garmin
function garminDetailHTML(a, e, manual) {
  const it = e && e.item;
  const cell = (v) => (v == null || v === '' ? '–' : v);
  const zp = it ? esc(P.zoneText(it.zone, config)).split(' · ') : [];
  const elevTarget = it && it.elevation_m ? `mål ${fmtNum(it.elevation_m, 0)} hm` : '–';
  const rows = [
    ['Distance', it && it.km ? `${fmtNum(it.km)} km` : '–', `${fmtNum(a.km)} km`],
    ['Tid', '–', P.fmtDuration(a.duration_sec)],
    ['Tempo', zp.find((x) => /\/km/.test(x)) || '–', a.km && a.duration_sec ? `${P.fmtPace(a.duration_sec / a.km)} /km` : '–'],
    ['Puls', zp.filter((x) => !/\/km/.test(x)).slice(0, 2).join(' · ') || '–', a.avg_hr ? `${a.avg_hr}${a.max_hr ? ` (max ${a.max_hr})` : ''} bpm` : '–'],
    ['Højdemeter', elevTarget, a.elev_gain != null ? `${fmtNum(a.elev_gain, 0)} hm` : '–'],
  ];
  let h = `<div class="card run-card" style="margin-bottom:14px"><div class="sc-head"><b>Fra Garmin</b>${a.name ? `<span class="meta"> · ${esc(a.name)}</span>` : ''}</div>
    <table class="pvs"><thead><tr><th></th><th>Planlagt</th><th>Faktisk</th></tr></thead><tbody>${rows.map(([l, p, f]) => `<tr><th scope="row">${l}</th><td>${cell(p)}</td><td><b>${cell(f)}</b></td></tr>`).join('')}</tbody></table>`;
  const zs = a.hr_zone_secs && Object.keys(a.hr_zone_secs).length ? a.hr_zone_secs : null;
  if (zs) {
    const names = Object.keys(zs).sort(), tot = names.reduce((x, n) => x + (Number(zs[n]) || 0), 0) || 1;
    h += `<div class="sc-h">Tid i dine pulszoner</div><div class="zbars">${names.map((n) => `<div class="zb"><span class="zn">${n}</span><span class="zbar"><i style="width:${Math.round((Number(zs[n]) || 0) / tot * 100)}%"></i></span><span class="zt">${P.fmtDuration(Number(zs[n]) || 0)}</span></div>`).join('')}</div>`;
  }
  const sp = Array.isArray(a.splits) ? a.splits : [];
  if (sp.length) {
    const fastest = Math.min(...sp.filter((x) => x.pace_sec_km && x.km >= 0.5).map((x) => x.pace_sec_km), Infinity);
    h += `<div class="sc-h">Splits pr. km</div><table class="splits"><thead><tr><th>km</th><th>Tempo</th><th></th><th>Puls</th><th>hm</th></tr></thead><tbody>${sp.map((x, i) => {
      const w = x.pace_sec_km && isFinite(fastest) ? Math.max(8, Math.round(fastest / x.pace_sec_km * 100)) : 0;
      return `<tr><td>${x.km >= 0.95 ? i + 1 : fmtNum(x.km)}</td><td>${x.pace_sec_km ? P.fmtPace(x.pace_sec_km) : '–'}</td><td class="sbar"><i style="width:${w}%"></i></td><td>${x.hr ?? '–'}</td><td>${x.elev == null ? '–' : (x.elev > 0 ? '+' : '') + x.elev}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  const when = a.fetched_at || a.updated_at;
  h += `<div class="sc-foot">Hentet fra Garmin kl. ${when ? hhmm(when) : '–'}${a.activity_id ? ` · <a href="https://connect.garmin.com/modern/activity/${esc(String(a.activity_id))}" target="_blank" rel="noopener">Åbn i Garmin Connect</a>` : ''}${manual ? '<br>Dine egne tal herunder bruges i stedet.' : ''}</div></div>`;
  return h;
}

// ---------- Restitution ----------
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function garminButton() {
  return `<button class="btn filled block" data-act="openGarmin">${icon('external')}Åbn Garmin Connect</button>`;
}
// Seneste dag (i dag eller før) med data i et felt
function latest(byDate, field, maxAge = 7) {
  const t = P.todayISO();
  for (let i = 0; i <= maxAge; i++) {
    const d = P.addDays(t, -i), row = byDate.get(d);
    if (row && row[field] != null && row[field] !== '') return { date: d, v: Number(row[field]), row };
  }
  return null;
}
const ago = (d) => { const n = P.daysBetween(d, P.todayISO()); return n === 0 ? 'i nat/i dag' : n === 1 ? 'i går' : `${n} dage siden`; };
function metricCard(label, value, sub, cls = '') {
  return `<div class="metric ${cls}"><div class="m-label">${label}</div><div class="m-value">${value}</div><div class="m-sub">${sub}</div></div>`;
}
function recoveryMetrics(byDate) {
  const t = P.todayISO(), cards = [];
  const hrv = latest(byDate, 'hrv_avg');
  if (hrv) {
    const b = R.baseline(byDate, 'hrv_avg', hrv.date);
    const st = HRV_DA[String(hrv.row.hrv_status || '').toUpperCase()];
    cards.push(metricCard('HRV', `${Math.round(hrv.v)}<small> ms</small>`,
      [st && st !== '–' ? st : '', hrv.row.hrv_weekly_avg ? `7-dages snit ${Math.round(hrv.row.hrv_weekly_avg)}` : '', b ? `din normal ${Math.round(b.mean)}` : '', ago(hrv.date)].filter(Boolean).join(' · ')));
  }
  const sl = latest(byDate, 'sleep_score') || latest(byDate, 'sleep_seconds');
  if (sl) {
    const r = sl.row, hrs = r.sleep_seconds ? `${Math.floor(r.sleep_seconds / 3600)} t ${Math.round((r.sleep_seconds % 3600) / 60)} min` : '';
    cards.push(metricCard('Søvn', r.sleep_score != null ? `${Math.round(r.sleep_score)}<small> /100</small>` : hrs, [r.sleep_score != null ? hrs : '', ago(sl.date)].filter(Boolean).join(' · ')));
  }
  const rhr = latest(byDate, 'resting_hr');
  if (rhr) {
    const b = R.baseline(byDate, 'resting_hr', rhr.date);
    const diff = b ? Math.round(rhr.v - b.mean) : null;
    cards.push(metricCard('Hvilepuls', `${Math.round(rhr.v)}<small> bpm</small>`, [b ? `normal ${Math.round(b.mean)} (${diff > 0 ? '+' : ''}${diff})` : '', ago(rhr.date)].filter(Boolean).join(' · ')));
  }
  const bb = latest(byDate, 'body_battery_wake') || latest(byDate, 'body_battery_high');
  if (bb) {
    const r = bb.row;
    cards.push(metricCard('Body Battery', `${Math.round(bb.v)}`, [r.body_battery_wake != null ? 'ved opvågning' : 'dagens højeste', r.body_battery_low != null ? `laveste ${r.body_battery_low}` : '', ago(bb.date)].filter(Boolean).join(' · ')));
  }
  const stress = latest(byDate, 'stress_avg');
  if (stress) cards.push(metricCard('Stress', `${Math.round(stress.v)}<small> /100</small>`, [`gennemsnit`, stress.row.stress_max ? `maks ${stress.row.stress_max}` : '', ago(stress.date)].filter(Boolean).join(' · ')));
  const vo2 = latest(byDate, 'vo2max', 120);
  if (vo2) cards.push(metricCard('VO2max', `${fmtNum(vo2.v)}`, `seneste måling ${P.fmtDateShort(vo2.date)}`));
  const rec = latest(byDate, 'recovery_hours', 2);
  if (rec) cards.push(metricCard('Restitutionstid', `${Math.round(rec.v)}<small> t</small>`, ago(rec.date)));
  return cards.length ? `<div class="metric-grid">${cards.join('')}</div>` : '';
}

// Lille dagsgraf: linje eller søjler, evt. med bånd (baseline) og stiplet normal-linje
function dayChart(dates, vals, { type = 'line', band = null, ref = null, cls = 'c-hrv', unit = '', colorFor = null } = {}) {
  const W = 330, H = 120, pl = 30, pr = 8, pt = 8, pb = 18;
  const nums = vals.filter((v) => v != null);
  if (!nums.length) return '';
  let lo = Math.min(...nums, ...(band || []), ref ?? Infinity), hi = Math.max(...nums, ...(band || []), ref ?? -Infinity);
  if (type === 'bar') lo = 0;
  const pad = (hi - lo) * 0.1 || 5; if (type !== 'bar') lo -= pad; hi += pad;
  const n = dates.length, slot = (W - pl - pr) / n;
  const x = (i) => pl + slot * (i + 0.5), y = (v) => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let svg = '';
  for (const v of [lo, (lo + hi) / 2, hi]) svg += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
  if (band) svg += `<rect class="band" x="${pl}" y="${y(band[1])}" width="${W - pl - pr}" height="${Math.max(0, y(band[0]) - y(band[1]))}"><title>Normalt område ${Math.round(band[0])}–${Math.round(band[1])}${unit}</title></rect>`;
  if (ref != null) svg += `<line class="ref" x1="${pl}" x2="${W - pr}" y1="${y(ref)}" y2="${y(ref)}"><title>Din normal ${Math.round(ref)}${unit}</title></line>`;
  if (type === 'bar') {
    vals.forEach((v, i) => { if (v != null) svg += `<rect class="${colorFor ? colorFor(v, i) : cls}" x="${x(i) - slot * 0.32}" y="${y(v)}" width="${slot * 0.64}" height="${H - pb - y(v)}" rx="1.5"><title>${P.fmtDateShort(dates[i])}: ${fmtNum(v)}${unit}</title></rect>`; });
  } else {
    let path = '', open = false;
    vals.forEach((v, i) => { if (v == null) { open = false; return; } path += `${open ? 'L' : 'M'}${x(i)},${y(v)} `; open = true; });
    svg += `<path class="dline ${cls}" d="${path}"/>`;
    vals.forEach((v, i) => { if (v != null) svg += `<circle class="ddot ${cls}" cx="${x(i)}" cy="${y(v)}" r="${n > 10 ? 2 : 3}"><title>${P.fmtDateShort(dates[i])}: ${fmtNum(v)}${unit}</title></circle>`; });
  }
  const step = n > 10 ? 7 : 1;
  dates.forEach((d, i) => { if ((n - 1 - i) % step === 0) svg += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${n > 10 ? P.fmtDateShort(d).replace('.', '') : P.fmtWeekday(d)}</text>`; });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${svg}</svg>`;
}

function recoveryCharts(byDate) {
  const days = Number(ui.recRange) === 28 ? 28 : 7;
  const t = P.todayISO();
  const dates = Array.from({ length: days }, (_, i) => P.addDays(t, i - days + 1));
  const col = (f) => dates.map((d) => { const v = (byDate.get(d) || {})[f]; return v == null || v === '' ? null : Number(v); });
  const out = [];
  const hrv = col('hrv_avg');
  if (hrv.some((v) => v != null)) {
    const g = latest(byDate, 'hrv_baseline_low', days);
    const gb = g && g.row.hrv_baseline_high ? [g.v, Number(g.row.hrv_baseline_high)] : null;
    const own = R.baseline(byDate, 'hrv_avg', t);
    const band = gb || (own ? [own.mean - own.sd, own.mean + own.sd] : null);
    out.push(`<div class="card"><h3>HRV</h3><div class="meta">${gb ? 'Grønt bånd = Garmins balancerede område' : own ? 'Bånd = din normal ± 1 standardafvigelse' : 'Baseline kommer efter 7 dage med data'}${own ? ` · stiplet = din 28-dages normal (${Math.round(own.mean)} ms)` : ''}</div>
      ${dayChart(dates, hrv, { band, ref: own ? own.mean : null, cls: 'c-hrv', unit: ' ms' })}</div>`);
  }
  const sleepH = col('sleep_seconds').map((v) => (v == null ? null : v / 3600)), score = col('sleep_score');
  if (sleepH.some((v) => v != null) || score.some((v) => v != null)) {
    const has = sleepH.some((v) => v != null);
    out.push(`<div class="card"><h3>Søvn</h3><div class="meta">${has ? 'Timer pr. nat · farve efter søvnscore (grøn ≥ 80, gul 50–79, rød < 50)' : 'Søvnscore'}</div>
      ${has ? dayChart(dates, sleepH, { type: 'bar', ref: 8, unit: ' t', colorFor: (v, i) => { const sc = score[i]; return sc == null ? 'b-gray' : sc >= 80 ? 'b-green' : sc >= 50 ? 'b-yellow' : 'b-red'; } }) : dayChart(dates, score, { type: 'bar', cls: 'b-green' })}</div>`);
  }
  const rhr = col('resting_hr');
  if (rhr.some((v) => v != null)) {
    const own = R.baseline(byDate, 'resting_hr', t);
    out.push(`<div class="card"><h3>Hvilepuls</h3><div class="meta">${own ? `Stiplet = din normal (${Math.round(own.mean)} bpm)` : 'bpm'}</div>${dayChart(dates, rhr, { ref: own ? own.mean : null, cls: 'c-rhr', unit: ' bpm' })}</div>`);
  }
  const bb = col('body_battery_wake').map((v, i) => v ?? col('body_battery_high')[i]);
  if (bb.some((v) => v != null)) out.push(`<div class="card"><h3>Body Battery</h3><div class="meta">Ved opvågning (ellers dagens højeste)</div>${dayChart(dates, bb, { type: 'bar', cls: 'b-accent' })}</div>`);
  if (!out.length) return '';
  return `<div class="section-header">Udvikling</div>${seg('recRange', [['7', '7 dage'], ['28', '28 dage']], String(days))}${out.join('')}`;
}

// Ugentlige km og højdemeter sammen med HRV-trenden (seneste 8 uger)
function trainingVsHrv(byDate) {
  const t = P.todayISO(), thisWeek = R.weekStart(t);
  const weeks = Array.from({ length: 8 }, (_, i) => P.addDays(thisWeek, (i - 7) * 7));
  const data = weeks.map((ws) => {
    const ds = P.weekDates(ws).filter((d) => d <= t);
    const hrvs = ds.map((d) => (byDate.get(d) || {}).hrv_avg).filter((v) => v != null).map(Number);
    return { ws, km: ds.reduce((s, d) => s + loggedKmOn(d), 0), hm: ds.reduce((s, d) => s + loggedElevOn(d), 0), hrv: hrvs.length ? R.mean(hrvs) : null };
  });
  if (!data.some((d) => d.km || d.hrv)) return '';
  const W = 330, H = 150, pl = 28, pr = 30, pt = 14, pb = 18, slot = (W - pl - pr) / data.length;
  const kmTop = Math.max(10, Math.ceil(Math.max(...data.map((d) => d.km)) / 10) * 10);
  const hv = data.map((d) => d.hrv).filter((v) => v != null);
  const hLo = hv.length ? Math.min(...hv) - 5 : 0, hHi = hv.length ? Math.max(...hv) + 5 : 1;
  const x = (i) => pl + slot * (i + 0.5), yk = (v) => pt + (H - pt - pb) * (1 - v / kmTop), yh = (v) => pt + (H - pt - pb) * (1 - (v - hLo) / (hHi - hLo));
  let svg = `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yk(0)}" y2="${yk(0)}"/><text x="${pl - 4}" y="${yk(kmTop) + 3}" text-anchor="end">${kmTop}</text><text x="${pl - 4}" y="${yk(0) + 3}" text-anchor="end">0</text>`;
  if (hv.length) svg += `<text x="${W - pr + 4}" y="${yh(hHi) + 3}">${Math.round(hHi)}</text><text x="${W - pr + 4}" y="${yh(hLo) + 3}">${Math.round(hLo)}</text>`;
  data.forEach((d, i) => {
    if (d.km) svg += `<rect class="actual" x="${x(i) - slot * 0.3}" y="${yk(d.km)}" width="${slot * 0.6}" height="${yk(0) - yk(d.km)}" rx="1.5"><title>Uge fra ${P.fmtDateShort(d.ws)}: ${fmtNum(d.km)} km${d.hm ? `, ↑${Math.round(d.hm)} hm` : ''}</title></rect>`;
    if (d.hm) svg += `<text class="hm-label" x="${x(i)}" y="${yk(d.km) - 3}" text-anchor="middle">↑${Math.round(d.hm)}</text>`;
    const wd = P.parseISO(d.ws);
    svg += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${wd.getDate()}/${wd.getMonth() + 1}</text>`;
  });
  let path = '', open = false;
  data.forEach((d, i) => { if (d.hrv == null) { open = false; return; } path += `${open ? 'L' : 'M'}${x(i)},${yh(d.hrv)} `; open = true; });
  if (path) svg += `<path class="dline c-hrv" d="${path}"/>` + data.map((d, i) => (d.hrv == null ? '' : `<circle class="ddot c-hrv" cx="${x(i)}" cy="${yh(d.hrv)}" r="3"><title>HRV-snit ${Math.round(d.hrv)} ms</title></circle>`)).join('');
  return `<div class="section-header">Træning og HRV</div><div class="card"><div class="meta">Løbet km pr. uge (søjler, ↑ = højdemeter) og ugens HRV-snit (linje, højre akse). Faldende HRV i takt med stigende km kan være et tegn på, at du skal tage det roligere.</div>
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Km pr. uge og HRV">${svg}</svg>
    <div class="legend"><span><i style="background:var(--run)"></i>km</span><span><i style="background:var(--hrv)"></i>HRV (ms)</span></div></div>`;
}

function weekSummary(byDate) {
  const t = P.todayISO(), ws = R.weekStart(t), prev = P.addDays(ws, -7);
  const range = (from, to) => { const out = []; for (let d = from; d <= to; d = P.addDays(d, 1)) out.push(d); return out; };
  const cur = range(ws, t), last = range(prev, P.addDays(ws, -1));
  const avg = (ds, f) => { const v = ds.map((d) => (byDate.get(d) || {})[f]).filter((x) => x != null).map(Number); return v.length ? R.mean(v) : null; };
  let sessions = 0, done = 0;
  for (const d of cur) for (const e of entriesOn(d)) { if (e.item.kind === 'rest') continue; sessions++; if (statusOf(e.key) === 'done') done++; }
  const km = cur.reduce((s, d) => s + loggedKmOn(d), 0), kmPlan = P.weekDates(ws).reduce((s, d) => s + plannedKmOn(d), 0);
  const hm = cur.reduce((s, d) => s + loggedElevOn(d), 0);
  const hrv = avg(cur, 'hrv_avg'), hrvPrev = avg(last, 'hrv_avg'), sleep = avg(cur, 'sleep_seconds'), score = avg(cur, 'sleep_score'), rhr = avg(cur, 'resting_hr'), stress = avg(cur, 'stress_avg');
  const trend = hrv != null && hrvPrev != null ? hrv - hrvPrev : null;
  let verdict = 'Ugen er i gang.';
  if (trend != null && trend <= -5) verdict = 'HRV er faldet i forhold til sidste uge – prioritér søvn og hold de rolige ture rolige.';
  else if (score != null && score < 60) verdict = 'Søvnen halter i denne uge – gå tidligere i seng, især før de hårde pas.';
  else if (trend != null && trend >= 3) verdict = 'HRV er steget – kroppen håndterer træningen godt.';
  else if (hrv != null) verdict = 'Stabil uge – fortsæt efter planen.';
  const row = (l, v) => (v ? `<div class="row"><span class="grow">${l}</span><span class="value">${v}</span></div>` : '');
  return `<div class="section-header">Ugen indtil nu (${P.fmtDateShort(ws)} – ${P.fmtDateShort(t)})</div><div class="group">
    ${row('Pas gennemført', sessions ? `${done} af ${sessions}` : '')}
    ${row('Løbet', kmPlan || km ? `${fmtNum(km)}${kmPlan ? ` / ${fmtNum(kmPlan)}` : ''} km${hm ? ` · ↑${Math.round(hm)} hm` : ''}` : '')}
    ${row('HRV-snit', hrv != null ? `${Math.round(hrv)} ms${trend != null ? ` (${trend >= 0 ? '+' : ''}${Math.round(trend)} fra sidste uge)` : ''}` : '')}
    ${row('Søvn', sleep != null || score != null ? `${sleep != null ? `${fmtNum(sleep / 3600)} t/nat` : ''}${score != null ? ` · score ${Math.round(score)}` : ''}` : '')}
    ${row('Hvilepuls', rhr != null ? `${Math.round(rhr)} bpm` : '')}
    ${row('Stress', stress != null ? `${Math.round(stress)} i snit` : '')}
  </div><div class="section-footer">${esc(verdict)}</div>`;
}

function recoveryHTML() {
  const rows = S.all('garmin_daily');
  let h = `<h1 class="large-title">Restitution</h1>${garminButton()}<div style="margin-top:10px">${runDataButton()}</div>`;
  if (!rows.length) {
    return h + `<div class="card empty" style="margin-top:14px">${icon('heart')}<br>Ingen data fra Garmin endnu.<br><br>Når dit ur har synkroniseret med appen, vises HRV, søvn, hvilepuls og Body Battery her – med dagens status og et forslag til dagens pas.</div>`;
  }
  const byDate = R.indexDays(rows);
  h += recoveryCard(P.todayISO(), { full: true });
  h += recoveryMetrics(byDate);
  h += recoveryCharts(byDate);
  h += trainingVsHrv(byDate);
  h += weekSummary(byDate);
  const newest = [...rows].map((r) => r.date).filter((d) => d <= P.todayISO()).sort().pop();
  const age = newest ? P.daysBetween(newest, P.todayISO()) : null;
  const synced = Sync.lastSyncText();
  h += `<div class="section-footer">Seneste data fra uret: ${newest ? (age === 0 ? 'i dag' : age === 1 ? 'i går' : `${age} dage siden (${P.fmtDateShort(newest)})`) : '–'}.${synced ? ` Appen synkroniserede ${synced}.` : ''}
    ${age > 0 ? 'Mangler dagens nat? Åbn Garmin Connect-appen, så uret synkroniserer – de nye data kommer med ved Mac\'ens næste hentning.' : ''}<br>Din normal = gennemsnittet af de seneste 28 dage (kræver mindst 7 dage med data). Data kommer fra dit Garmin-ur.</div>`;
  return h;
}

function checklistsHTML() {
  let h = `<h1 class="large-title">Tjeklister</h1>`;
  for (const list of CHECKLISTS) {
    const done = list.items.filter((i) => (S.get('checklists', i.id) || {}).done).length;
    h += `<div class="section-header"><span>${esc(list.title)}</span><span>${done}/${list.items.length}</span></div><div class="group">`;
    h += list.items.map((i) => {
      const on = !!(S.get('checklists', i.id) || {}).done;
      return `<label class="row"><span class="grow">${esc(i.text)}</span><span class="switch"><input type="checkbox" data-check="${i.id}" data-list="${list.id}" ${on ? 'checked' : ''} aria-label="${esc(i.text)}"><span></span></span></label>`;
    }).join('');
    h += `</div>`;
  }
  return h;
}

function zonesHTML() {
  const zones = P.hrZones(config), pc = P.paces(config);
  let h = `<h1 class="large-title">Zoner og tempo</h1>`;
  h += `<div class="section-header">Pulszoner</div>`;
  if (zones) {
    h += `<div class="group">${Object.entries(zones).map(([z, [lo, hi]]) => `<div class="row"><span class="grow title">${z}</span><span class="value">${lo}–${hi} bpm</span></div>`).join('')}</div>`;
    if (!config.hr_zones) h += `<div class="section-footer">Udregnet ud fra maxpuls ${config.max_hr}.</div>`;
  } else {
    h += `<div class="card"><div class="meta">Pulszonerne er ikke sat endnu. Indtil da styres løb efter RPE (oplevet anstrengelse 1–10).</div></div>`;
  }
  h += `<div class="section-header">Tempo</div>`;
  if (pc) {
    h += `<div class="group">
      ${pc.mp ? `<div class="row"><span class="grow title">Marathonfart (MP)</span><span class="value">${P.fmtPace(pc.mp)}/km</span></div>` : ''}
      ${pc.threshold ? `<div class="row"><span class="grow title">Tærskel</span><span class="value">${P.fmtPace(pc.threshold)}/km</span></div>` : ''}
      ${pc.easy ? `<div class="row"><span class="grow title">Rolig</span><span class="value">${P.fmtPace(pc.easy[0])}–${P.fmtPace(pc.easy[1])}/km</span></div>` : ''}</div>`;
    if (config.marathon_goal_time) h += `<div class="section-footer">Ud fra måltid ${esc(config.marathon_goal_time)} på marathon.</div>`;
  } else {
    const test = sched.entries.find((e) => e.item.test === '5k');
    h += `<div class="card"><div class="meta">${test ? `Dine tempoer udregnes efter 5 km-testen ${P.fmtWeekday(test.date).toLowerCase()} ${P.fmtDateShort(test.date)}. Indtil da styres løb efter puls og RPE.` : 'Dine tempoer udregnes, når du har et marathonmål. Indtil da styres løb efter puls og RPE.'}</div></div>`;
  }
  if (!runTypes) h += `<div class="section-header">RPE-guide</div><div class="group">
    ${[['Z1 · RPE 2', 'Meget let, gå/jog'], ['Z2 · RPE 3–4', 'Kan tale i hele sætninger'], ['Z3 · RPE 5–6', 'Kan tale i korte sætninger'], ['MP · RPE 6', 'Marathonfart'], ['Z4 · RPE 7', 'Tærskel – komfortabelt hårdt'], ['Z5 · RPE 8–9', 'Hårdt, kun få ord']]
      .map(([a, b]) => `<div class="row"><span class="grow title">${a}</span><span class="value">${b}</span></div>`).join('')}</div>`;
  h += `<div class="section-header">Tid og sted</div><div class="group">
    ${(config.timezone_from && config.timezone_from.length ? config.timezone_from : [{ from: plan.start, timezone: config.timezone }]).map((z, i, arr) => {
      const city = { 'Europe/Helsinki': 'Helsinki', 'Europe/Copenhagen': 'København' }[z.timezone] || z.timezone;
      const until = arr[i + 1] ? ` til ${P.fmtDateShort(P.addDays(arr[i + 1].from, -1))}` : '';
      return `<div class="row"><span class="grow title">Tidszone${i ? '' : ''}</span><span class="value">${esc(city)} ${i ? `fra ${P.fmtDateShort(z.from)}` : until.trim() ? `(${until.trim()})` : ''}</span></div>`;
    }).join('')}
    ${Object.entries(config.default_times || {}).map(([k, v]) => `<div class="row"><span class="grow title">${esc({ run_weekday: 'Løb (hverdag)', long_run: 'Langtur', strength: 'Styrke', transgrancanaria: 'Transgrancanaria', cph_marathon: 'CPH Marathon' }[k] || k)}</span><span class="value">${esc(v)}</span></div>`).join('')}</div>`;

  return h + runTypesHTML();
}

// ---------- Løbetyper forklaret (run_types.json) ----------
const rtById = (id) => (runTypes && runTypes.types.find((t) => t.id === id)) || null;
function runTypeChips(item) {
  if (!runTypes) return '';
  const ids = P.runTypeIds(item).filter(rtById);
  return ids.length ? `<div class="rt-chips">${ids.map((id) => `<button type="button" class="chip-btn rt-chip" data-act="runType" data-id="${id}" aria-label="Forklaring: ${esc(rtById(id).name)}">${esc(rtById(id).name)} <span aria-hidden="true">ⓘ</span></button>`).join('')}</div>` : '';
}
function runTypesHTML() {
  if (!runTypes) return '';
  const zones = P.hrZones(config);
  let h = `<h2 class="col-title" id="run-types" style="margin-top:28px">Løbetyper forklaret</h2>
    <div class="card"><div class="session-desc">${esc(runTypes.intro)}</div></div>
    <div class="section-header">Zoner</div>
    <div class="group">${runTypes.zones.map((z) => {
      const hr = zones && zones[z.zone] ? `${zones[z.zone][0]}–${zones[z.zone][1]} bpm` : '';
      return `<div class="row"><span class="zone-badge">${esc(z.zone)}</span><span class="grow"><span class="title">${esc(z.text)}</span><span class="meta" style="display:block">RPE ${esc(z.rpe)}</span></span><span class="value">${hr || '–'}</span></div>`;
    }).join('')}</div>
    <div class="section-footer">${esc(runTypes.zones_note)}${zones ? ' Pulsen til højre er dine egne zoner.' : ''}</div>
    <div class="section-header">Kategorier</div>`;
  h += runTypes.categories.map((c) => `<div class="card rt-cat" id="rt-cat-${esc(c.id)}"><h3>${esc(c.name)}</h3>
      <dl class="rt-dl"><dt>Hvornår</dt><dd>${esc(c.when)}</dd><dt>Omfang</dt><dd>${esc(c.volume)}</dd><dt>Indhold</dt><dd>${esc(c.content)}</dd><dt>Formål</dt><dd>${esc(c.purpose)}</dd></dl>
      <div class="rt-chips">${c.types.filter(rtById).map((id) => `<button type="button" class="chip-btn" data-act="runType" data-id="${id}">${esc(rtById(id).name)}</button>`).join('')}</div></div>`).join('');
  h += `<div class="section-header">En typisk uge</div><div class="group">${runTypes.week_example.map((d) => `<div class="row"><span class="zone-badge">${esc(d.day)}</span><span class="grow"><span class="title">${esc(d.run)}</span><span class="meta" style="display:block">Styrke: ${esc(d.strength || '–')}</span></span></div>`).join('')}</div>
    <div class="section-footer">${esc(runTypes.week_exceptions)}</div>
    <div class="section-header">Løbetyper</div>`;
  h += runTypes.types.map((t) => {
    const x = P.runTypeTargets(t, config);
    const target = [x.hr, x.pace].filter(Boolean).join(' · ');
    return `<details class="card rt-type" id="rt-${esc(t.id)}" ${ui.openRunType === t.id ? 'open' : ''}>
      <summary><span class="grow"><span class="title">${esc(t.name)}</span><span class="meta" style="display:block">${esc([t.zone !== '–' ? t.zone : '', t.rpe !== '–' ? `RPE ${t.rpe}` : '', target].filter(Boolean).join(' · '))}</span></span>${icon('down', 'chev')}</summary>
      <dl class="rt-dl"><dt>Hvad</dt><dd>${esc(t.what)}</dd><dt>Hvorfor</dt><dd>${esc(t.why)}</dd><dt>Sådan føles det</dt><dd>${esc(t.feel)}</dd><dt>Typisk fejl</dt><dd>${esc(t.mistake)}</dd>
      ${target ? `<dt>Din puls/tempo</dt><dd>${esc(target)}</dd>` : ''}</dl></details>`;
  }).join('');
  return h;
}

function quotesHTML() {
  const favs = favoriteIds();
  let list = allQuotes();
  if (ui.quoteSeg === 'fav') list = list.filter((q) => favs.has(q.id));
  if (ui.quoteSeg === 'own') list = list.filter((q) => q.custom);
  let h = `<h1 class="large-title">Citater</h1>
    <div class="subtitle">Ét citat pr. dag på "I dag". Favoritter vises oftere.</div>
    <button class="btn filled block" data-act="quoteNew" style="margin-bottom:14px">${icon('plus')}Tilføj eget citat</button>
    ${seg('quoteSeg', [['all', 'Alle'], ['fav', `Favoritter (${favs.size})`], ['own', 'Egne']], ui.quoteSeg)}`;
  if (!list.length) {
    return h + `<div class="card empty">${ui.quoteSeg === 'fav' ? 'Ingen favoritter endnu. Tryk på hjertet ved et citat.' : 'Ingen egne citater endnu.'}</div>`;
  }
  h += `<div class="group">${list.map((q) => {
    const fav = favs.has(q.id);
    return `<div class="row quote-row"><span class="grow"><span class="title">${esc(q.text)}</span>
      <span class="meta" style="display:block">${(q.tags || []).map((t) => esc(Q.TAG_LABEL[t] || t)).join(' · ')}${q.custom ? ' · Eget' : ''}</span></span>
      ${q.custom ? `<button class="heart" data-act="quoteDel" data-id="${esc(q.id)}" aria-label="Slet citat">${icon('trash')}</button>` : ''}
      <button class="heart ${fav ? 'on' : ''}" data-act="favQuote" data-id="${esc(q.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Fjern fra favoritter' : 'Gem som favorit'}">${icon('heart')}</button></div>`;
  }).join('')}</div>`;
  return h;
}

function openQuoteNew() {
  const body = `<div class="group" style="margin-top:6px"><div class="field stack"><label for="cq-text">Citat</label>
      <textarea id="cq-text" placeholder="Skriv dit citat …"></textarea></div></div>
    <div class="section-header">Hvornår må det vises?</div>
    <div class="tag-picks" id="cq-tags">${Q.TAGS.map(([t, l]) => `<button type="button" class="chip-btn" data-tag="${t}" aria-pressed="${t === 'general'}">${l}</button>`).join('')}</div>
    <div class="section-footer">"Generelt" kan vises alle dage. De andre bruges på dage, der passer.</div>
    <button class="btn filled block" style="margin-top:14px" data-act="quoteSave">${icon('check')}Gem citat</button>`;
  openSheet({
    title: 'Nyt citat', body,
    onMount: (root) => {
      $('#cq-tags', root).addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
      });
      setTimeout(() => $('#cq-text', root).focus(), 350);
    },
  });
}

function swapsHTML() {
  const t = P.todayISO();
  const rows = S.all('exercise_overrides').sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1));
  const future = rows.filter((r) => r.scope === 'future');
  const single = rows.filter((r) => r.scope === 'date' && (r.date || '') >= P.addDays(t, -14));
  const line = (r) => r.action === 'add' ? `+ ${r.exercise}` : r.action === 'tune' ? `Ændret sæt/reps/RIR (plads ${Number(r.original) + 1})` : r.action === 'order' ? 'Ny rækkefølge af øvelser' : `${r.original} → ${r.exercise}`;
  const row = (r) => `<div class="row"><span class="grow"><span class="title">${esc(line(r))}</span>
    <span class="meta" style="display:block">${esc(r.session || '')} · ${r.scope === 'future' ? `fra ${P.fmtDateShort(r.date)}` : P.fmtDateShort(r.date)}${r.sets ? ` · ${r.sets} × ${esc(r.reps || '')}` : ''}</span></span>
    <button class="btn danger" data-act="undoSwap" data-id="${esc(r.id)}">Fortryd</button></div>`;
  let h = `<h1 class="large-title">Mine øvelsesskift</h1>
    <div class="subtitle">Skift laver du i et styrkepas med "Skift øvelse" eller "+ Tilføj øvelse". Selve planen ændres ikke.</div>`;
  h += `<div class="section-header">Fremover i passene</div>`;
  h += future.length ? `<div class="group">${future.map(row).join('')}</div>` : `<div class="card empty">Ingen faste skift.</div>`;
  if (single.length) h += `<div class="section-header">Kun ét pas (seneste 14 dage og frem)</div><div class="group">${single.map(row).join('')}</div>`;
  return h;
}

function rulesHTML() {
  return `<h1 class="large-title">Regler</h1><div class="group">${(plan.rules || []).map((r) => `<div class="row"><span class="grow">${esc(r)}</span></div>`).join('')}</div>
    <div class="section-header">Appen advarer, når du flytter et pas, hvis</div>
    <div class="group">${['kvalitet eller langtur ligger under 48 timer efter Lower', 'Lower ligger 1–2 dage før kvalitet eller langtur'].map((r) => `<div class="row"><span class="grow">${r}</span></div>`).join('')}</div>`;
}

// ---------- Konto og synkronisering ----------
async function doLogin(mode) {
  const email = ($('#lg-email') || {}).value?.trim() || '';
  const pass = ($('#lg-pass') || {}).value || '';
  login.email = email;
  if (!email.includes('@')) { login.error = 'Skriv din e-mail.'; render(); return; }
  if (!pass) { login.error = 'Skriv din adgangskode.'; render(); return; }
  if (mode === 'signup') {
    if (pass.length < 8) { login.error = 'Brug mindst 8 tegn i adgangskoden.'; render(); return; }
    if (pass !== (($('#lg-pass2') || {}).value || '')) { login.error = 'De to adgangskoder er ikke ens.'; render(); return; }
  }
  login.busy = true; login.error = ''; render();
  try {
    if (mode === 'signup') await Sync.signUp(email, pass); else await Sync.signIn(email, pass);
    toast(mode === 'signup' ? 'Konto oprettet – du er logget ind ✓' : 'Logget ind ✓');
  } catch (e) { login.error = e.message; }
  login.busy = false; render();
}
const login = { email: '', busy: false, error: '', mode: 'signin' };
// ---------- Om appen: version og fejllog ----------
const about = { running: null, latest: null, loaded: false };
async function loadAbout() {
  const v = await Diag.versions();
  about.running = v.running; about.latest = v.latest; about.loaded = true;
  const el = $('#aboutVersion'); if (el) el.innerHTML = aboutVersionHTML();
}
function aboutVersionHTML() {
  if (!about.loaded) return '<span class="meta">Tjekker …</span>';
  const same = about.running && about.latest && about.running === about.latest;
  return `<span class="title">Version ${esc(Diag.versionLabel(about.running))}</span><span class="meta" style="display:block">${
    !about.latest ? 'Kunne ikke tjekke for opdateringer (offline?).' : same ? 'Du har den nyeste version ✓' : `Nyeste version er fra ${esc(Diag.versionLabel(about.latest))} – tryk "Opdater" eller træk ned på forsiden.`}</span>`;
}
function aboutHTML() {
  if (!about.loaded) setTimeout(loadAbout, 0);
  const errs = Diag.list().slice(0, 8);
  return `<div class="section-header">Om appen</div><div class="group"><div class="row"><span class="grow" id="aboutVersion">${aboutVersionHTML()}</span></div>
    <button class="row tappable" data-act="refresh"><span class="grow title">Opdater nu</span>${icon('refresh')}</button></div>
    <div class="section-header">Fejllog</div>${errs.length ? `<div class="group">${errs.map((e) => `<div class="row"><span class="grow"><span class="title">${esc(e.msg)}</span><span class="meta" style="display:block">${new Date(e.t).toLocaleString('da-DK', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${esc(e.kind)}${e.n > 1 ? ` ×${e.n}` : ''}</span></span></div>`).join('')}</div>
      <div class="btn-row" style="margin-top:10px"><button class="btn flex" data-act="errCopy">Kopiér log</button><button class="btn flex" data-act="errClear">Ryd log</button></div>`
      : `<div class="card empty">Ingen fejl noteret. Hvis noget går galt, dukker det op her.</div>`}`;
}
// ---------- Notifikationer (Web Push) ----------
const PUSH_KEY = 'tp.push';
const pushOn = () => { try { return localStorage.getItem(PUSH_KEY) === '1' && Push.permission() === 'granted'; } catch { return false; } };
const deviceName = () => (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Enhed');
const PUSH_DEFAULTS = { rest: true, remind: true, remind_hour: 20, today: false, today_hour: 7, report: false, report_hour: 19, morning: false, morning_only_sessions: false, morning_times: {}, morning_off: {} };
const pushPrefs = () => ({ ...PUSH_DEFAULTS, ...(settingVal('push_prefs') || {}) });
function prefRow(key, label, hint, hourKey, hours) {
  const p = pushPrefs();
  return `<label class="row"><span class="grow"><span class="title">${label}</span><span class="meta" style="display:block">${hint}${hourKey ? ` Klokken <select data-pref="${hourKey}" class="inline-select" aria-label="Tidspunkt">${hours.map((h) => `<option value="${h}" ${Number(p[hourKey]) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>` : ''}</span></span>
    <span class="switch"><input type="checkbox" data-pref="${key}" ${p[key] ? 'checked' : ''}><span></span></span></label>`;
}

// Morgenbesked: tid pr. ugedag (0 = søndag), standard 04:30
const MORNING_TIMES = ['03:00', '03:30', '04:00', '04:30', '05:00', '05:30', '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00'];
const WD_ORDER = [[1, 'Mandag'], [2, 'Tirsdag'], [3, 'Onsdag'], [4, 'Torsdag'], [5, 'Fredag'], [6, 'Lørdag'], [0, 'Søndag']];
function morningHTML() {
  const p = pushPrefs();
  const status = settingVal('push_status') || {};
  const when = status.at ? new Date(status.at).toLocaleString('da-DK', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const stat = status.at
    ? (status.ok === false ? `<div class="row"><span class="grow"><span class="title" style="color:var(--red,#FF453A)">Sidste forsøg fejlede</span><span class="meta" style="display:block">${esc(status.error || 'Beskeden blev ikke sendt.')} (${when})</span></span></div>`
      : `<div class="row"><span class="grow"><span class="title">Sidst sendt ✓</span><span class="meta" style="display:block">${when}</span></span></div>`)
    : `<div class="row"><span class="grow"><span class="meta">Ingen morgenbesked er sendt endnu.</span></span></div>`;
  return `<div class="section-header">Morgenbesked</div>
    <div class="group">
      <label class="row"><span class="grow"><span class="title">Send mig en besked hver morgen</span><span class="meta" style="display:block">Dagens pas, dagens citat og din restitution – så du kan se dagen, før du står op.</span></span><span class="switch"><input type="checkbox" data-pref="morning" ${p.morning ? 'checked' : ''}><span></span></span></label>
      ${p.morning ? `<label class="row"><span class="grow"><span class="title">Kun dage med pas</span><span class="meta" style="display:block">Spring hviledage over.</span></span><span class="switch"><input type="checkbox" data-pref="morning_only_sessions" ${p.morning_only_sessions ? 'checked' : ''}><span></span></span></label>
      ${WD_ORDER.map(([d, name]) => {
        const off = !!(p.morning_off || {})[d];
        const t = (p.morning_times || {})[d] || '04:30';
        return `<div class="row"><span class="grow"><span class="title">${name}</span></span>
          <select data-mwd="${d}" data-mk="time" class="inline-select" aria-label="Tidspunkt ${name}" ${off ? 'disabled' : ''}>${MORNING_TIMES.map((x) => `<option value="${x}" ${x === t ? 'selected' : ''}>${x}</option>`).join('')}</select>
          <span class="switch" style="margin-left:10px"><input type="checkbox" data-mwd="${d}" data-mk="on" aria-label="${name} til/fra" ${off ? '' : 'checked'}><span></span></span></div>`;
      }).join('')}` : ''}
      ${stat}
    </div>
    <div class="section-footer">Tiderne følger din tidszone. Beskeden sendes én gang pr. dag, og et tryk åbner appen på I dag. Appens restitutionsvurdering og tilpasninger for sygdom/hotel indgår ikke i beskeden – kun planen, flytninger og ugeændringer.</div>
    ${p.morning ? `<div class="btn-row" style="margin-top:10px"><button class="btn flex" data-act="morningTest">Send testbesked nu</button></div>` : ''}`;
}
function pushHTML() {
  if (!Sync.currentUser()) return '';
  let body;
  if (!Push.supported()) body = `<div class="card empty">Denne browser kan ikke vise notifikationer.</div>`;
  else if (Push.needsInstall()) body = `<div class="card"><div class="meta">På iPhone virker notifikationer først, når appen er lagt på hjemmeskærmen (Del → Føj til hjemmeskærm). Åbn den derfra, og kom tilbage hertil.</div></div>`;
  else if (pushOn()) body = `<div class="group"><div class="row"><span class="grow"><span class="title">Slået til på denne enhed ✓</span><span class="meta" style="display:block">Du får besked, når pausen er slut, og en påmindelse om at logge løb.</span></span></div></div>
    <div class="section-header">Hvad vil du have besked om?</div>
    <div class="group">${prefRow('rest', 'Pause slut', 'Når pausen mellem sæt er ovre (kun når appen ikke er åben).')}
      ${prefRow('remind', 'Husk at logge løb', 'Hvis du har et løbepas i dag uden data.', 'remind_hour', [17, 18, 19, 20, 21, 22])}
      ${prefRow('report', 'Ugerapport om søndagen', 'Når ugen er slut.', 'report_hour', [17, 18, 19, 20, 21])}</div>
    ${morningHTML()}
    <div class="section-footer">Påmindelser, morgenbesked og ugerapport sendes af et tjek hver halve time, efter din tidszone.</div>
    <div class="btn-row" style="margin-top:10px"><button class="btn flex" data-act="pushTest">Send prøve</button><button class="btn flex" data-act="pushOff">Slå fra</button></div>`;
  else body = `<div class="group"><div class="row"><span class="grow"><span class="title">Ikke slået til</span><span class="meta" style="display:block">Få en notifikation, når pausen er slut – også med skærmen låst – og en påmindelse om at logge løb.</span></span></div></div>
    <button class="btn filled block" style="margin-top:10px" data-act="pushOn">${icon('bell')}Slå notifikationer til</button>`;
  return `<div class="section-header">Notifikationer</div>${body}`;
}
async function pushEnable() {
  try {
    const key = (window.TP_CONFIG || {}).vapidPublicKey;
    if (!key) throw new Error('Notifikationer er ikke sat op endnu.');
    const sub = await Push.enable(key);
    S.put('push_subscriptions', { id: await Push.subId(sub), subscription: sub.toJSON(), device: deviceName() });
    try { localStorage.setItem(PUSH_KEY, '1'); } catch { /* privat tilstand */ }
    toast('Notifikationer er slået til ✓'); render();
  } catch (e) { toast(e.message || 'Kunne ikke slå notifikationer til.'); Diag.log('push', e.message); }
}
async function pushDisable() {
  try {
    const sub = await Push.disable();
    if (sub) S.remove('push_subscriptions', await Push.subId(sub));
  } catch (e) { Diag.log('push', e.message); }
  try { localStorage.removeItem(PUSH_KEY); } catch { /* ingen */ }
  toast('Notifikationer er slået fra'); render();
}
async function morningTest() {
  try {
    await Sync.syncNow();
    const r = await Sync.callFunction('push', { action: 'morning_test' });
    toast(r && r.ok ? 'Testbesked sendt – den kommer om et øjeblik' : (r && r.message) || 'Testbeskeden kunne ikke sendes.');
    await Sync.syncNow().catch(() => {});
    render();
  } catch (e) { toast(e.code === 'not_deployed' ? 'Notifikations-funktionen er ikke opdateret i Supabase endnu.' : e.message); }
}
async function pushTest() {
  try {
    await Sync.syncNow();
    const r = await Sync.callFunction('push', { action: 'test' });
    toast(r && r.ok ? 'Prøve sendt – den kommer om et øjeblik' : (r && r.message) || 'Prøven kunne ikke sendes.');
  } catch (e) { toast(e.code === 'not_deployed' ? 'Notifikations-funktionen er ikke oprettet i Supabase endnu (se README).' : e.message); }
}
// Pausen slutter: send besked, også når appen er lukket (funktionen tjekker, at pausen stadig gælder)
function pushRest() {
  if (!rest || rest.total < 30 || !pushPrefs().rest || !pushOn() || !Sync.currentUser() || !navigator.onLine) return;
  rest.pid = String(Date.now());
  saveSetting('rest_push', { id: rest.pid, end_at: rest.end });
  Sync.callFunction('push', { action: 'rest', rest_id: rest.pid, end_at: rest.end }).catch((e) => Diag.log('push', e.message));
}
function pushRestCancel() { if (pushOn()) saveSetting('rest_push', { id: null, end_at: 0 }); }

function soundPrefHTML() {
  const m = Audio.restMix();
  return `<div class="section-header">Lyd ved pause</div><div class="group"><label class="row"><span class="grow"><span class="title">Lyd ved pause</span><span class="meta" style="display:block">Mix med musik lader din musik spille videre. Fra giver kun blink og notifikation.</span></span>
    <select class="inline-select" data-restmix aria-label="Lyd ved pause"><option value="mix" ${m === 'mix' ? 'selected' : ''}>Mix med musik</option><option value="off" ${m === 'off' ? 'selected' : ''}>Fra</option></select></label></div>`;
}
document.addEventListener('change', (ev) => { if (ev.target.dataset && ev.target.dataset.restmix !== undefined) { Audio.setRestMix(ev.target.value); toast('Gemt'); } });
const TABLE_NAMES = { exercise_overrides: 'Øvelsesændring', strength_logs: 'Styrkelog', run_logs: 'Løbelog', session_status: 'Passtatus', overrides: 'Flyttet pas', week_edits: 'Ugeændring', programs: 'Program', plan_versions: 'Planversion', custom_sessions: 'Eget pas', run_programs: 'Løbeplan' };
function failedHTML() {
  const list = Sync.failedRows();
  if (!list.length) return '';
  return `<div class="section-header">Kunne ikke gemmes i databasen</div><div class="group">${list.map((f) => `<div class="row"><span class="grow"><span class="title">${esc(TABLE_NAMES[f.table] || f.table)}</span><span class="meta" style="display:block">${esc(Sync.failedText(f.message))}</span></span><button class="btn" data-act="retryFailed" data-key="${esc(f.key)}">Prøv igen</button></div>`).join('')}</div>
    <div class="section-footer">Rækkerne er ikke slettet – de ligger på denne enhed, indtil de er gemt i databasen.</div>
    <button class="btn block" style="margin-top:8px" data-act="retryFailed">Prøv alle igen</button>`;
}
function accountHTML() { return accountMainHTML() + pushHTML() + soundPrefHTML() + aboutHTML(); }
function accountMainHTML() {
  const s = Sync.status();
  let h = `<h1 class="large-title">Konto og synkronisering</h1>
    <div class="group"><div class="row has-icon"><span class="badge-ic k-accent">${icon(s.icon)}</span><span class="grow"><span class="title">${esc(s.text)}</span>${s.detail ? `<span class="meta" style="display:block">${esc(s.detail)}</span>` : ''}</span></div></div>`;
  if (!Sync.configured) {
    return h + `<div class="card" style="margin-top:14px"><div class="meta">Synkronisering mellem iPhone og Mac er ikke sat op endnu. Når den er klar, kan du logge ind her. Indtil da gemmes alt kun på denne enhed – tag backup under Backup og kalender.</div></div>`;
  }
  const u = Sync.currentUser();
  if (u) {
    return h + `<div class="section-header">Logget ind</div><div class="group">
        <div class="row"><span class="grow title">${esc(u.email || '')}</span></div></div>
      <div class="section-footer">Log ind med samme e-mail på iPhone og Mac, så deler de log, flytninger, øvelsesskift, mål, citater og Garmin-data.</div>
      ${failedHTML()}
      <button class="btn filled block" style="margin-top:14px" data-act="syncNow">${icon('cloud')}Synkronisér nu</button>
      <button class="btn danger block" style="margin-top:8px" data-act="signOut">Log ud på denne enhed</button>`;
  }
  const signup = login.mode === 'signup';
  h += `<div class="section-header">${signup ? 'Opret konto (kun første gang)' : 'Log ind'}</div>
    <div class="group">
      <div class="field"><label for="lg-email">E-mail</label><input id="lg-email" type="email" autocomplete="username" inputmode="email" placeholder="din@email.dk" value="${esc(login.email)}"></div>
      <div class="field"><label for="lg-pass">Adgangskode</label><input id="lg-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="${signup ? 'mindst 8 tegn' : ''}"></div>
      ${signup ? `<div class="field"><label for="lg-pass2">Gentag</label><input id="lg-pass2" type="password" autocomplete="new-password"></div>` : ''}
    </div>
    <div class="section-footer">${signup ? 'Brug samme e-mail og adgangskode på iPhone og Mac. Lad gerne din adgangskodemanager (iCloud-nøgleringen) foreslå en stærk adgangskode og gemme den.' : 'Du logger ind én gang på hver enhed. Appen husker login-tokenet, ikke adgangskoden.'}</div>
    <button class="btn filled block" style="margin-top:14px" data-act="${signup ? 'signUp' : 'signIn'}" ${login.busy ? 'disabled' : ''}>${login.busy ? 'Vent …' : signup ? 'Opret konto' : 'Log ind'}</button>
    <button class="btn block" style="margin-top:8px" data-act="loginMode">${signup ? 'Jeg har allerede en konto – log ind' : 'Første gang? Opret konto'}</button>`;
  if (login.error) h += `<div class="warn" style="margin-top:12px">${icon('warn')}<span>${esc(login.error)}</span></div>`;
  return h;
}

const webcalUrl = () => location.href.replace(/^https?:/, 'webcal:').replace(/[?#].*$/, '').replace(/[^/]*$/, '') + 'traeningsplan.ics';
function backupHTML() {
  return `<h1 class="large-title">Backup og kalender</h1>
    <div class="section-header">Synkronisering</div><div class="group"><button class="row tappable has-icon" data-act="sub" data-sub="account"><span class="badge-ic k-accent">${icon('cloud')}</span><span class="grow title">Konto og synkronisering</span>${icon('right', 'chev')}</button></div>
    <div class="section-header">Backup af din log</div>
    <div class="group">
      <button class="row tappable has-icon" data-act="export"><span class="badge-ic k-accent">${icon('backup')}</span><span class="grow title">Gem backup (JSON-fil)</span>${icon('right', 'chev')}</button>
      <label class="row tappable has-icon"><span class="badge-ic k-gray">${icon('up')}</span><span class="grow title">Indlæs backup</span><input type="file" accept="application/json,.json" data-import class="visually-hidden">${icon('right', 'chev')}</label>
    </div>
    <div class="section-footer">Backuppen indeholder alt, du har logget, flyttet og krydset af. Indlæsning fletter med det, der allerede er her – det nyeste vinder.</div>
    <div class="section-header">Kalender</div>
    <div class="group"><a class="row tappable has-icon" href="traeningsplan.ics" download style="text-decoration:none"><span class="badge-ic k-race">${icon('calendar')}</span><span class="grow title" style="color:var(--label)">Hent kalenderfil (.ics)</span>${icon('right', 'chev')}</a></div>
    <div class="group" style="margin-top:10px"><a class="row tappable has-icon" href="${webcalUrl()}" style="text-decoration:none"><span class="badge-ic k-accent">${icon('calendar')}</span><span class="grow title">Abonnér på kalenderen</span>${icon('right', 'chev')}</a></div>
    <div class="section-footer">Åbn filen på iPhone, og vælg "Tilføj alle" for at lægge planen i Kalender. Med "Abonnér" opdaterer din kalender sig selv, når planen ændres (Apple Kalender henter nyt cirka hver time til hver dag). Flytninger i appen kommer ikke med i filen.</div>`;
}

// ======================= Rammen (navigation) =======================
const TABS = [
  { id: 'today', label: 'I dag', icon: 'today' },
  { id: 'pas', label: 'Pas', icon: 'list' },
  { id: 'stats', label: 'Statistik', icon: 'chart' },
  { id: 'goals', label: 'Mål', icon: 'flag' },
  { id: 'more', label: 'Mere', icon: 'more' },
];
const SIDEBAR = [
  { tab: 'today', label: 'Oversigt', icon: 'today' },
  { tab: 'pas', label: 'Pas', icon: 'list' },
  { tab: 'stats', label: 'Statistik', icon: 'chart' },
  { tab: 'goals', label: 'Mål', icon: 'flag' },
  { head: 'Mere' },
  ...MORE.map((m) => ({ tab: 'more', sub: m.id, label: m.label, icon: m.icon })),
];

function renderChrome() {
  const isDesk = desktop.matches;
  $('#tabbar').innerHTML = TABS.map((t) => `<button class="tab" data-act="tab" data-tab="${t.id}" ${ui.tab === t.id ? 'aria-current="page"' : ''}>${icon(t.icon)}<span>${t.label}</span></button>`).join('');
  const activeSide = (s) => (s.sub ? ui.tab === 'more' && ui.sub === s.sub
    : ui.tab === s.tab);
  $('#sidebar').innerHTML = `<div class="app-name"><img src="icons/icon-192.png" alt="">Træningsplan</div>` +
    SIDEBAR.map((s) => s.head ? `<div class="side-h">${s.head}</div>` :
      `<button class="side-link" data-act="${s.sub ? 'sub' : 'tab'}" data-tab="${s.tab}" ${s.sub ? `data-sub="${s.sub}"` : ''} ${activeSide(s) ? 'aria-current="page"' : ''}>${icon(s.icon)}${s.label}</button>`).join('') +
    `<button class="side-link" data-act="refresh">${icon('refresh')}Opdater</button>` + syncPill();
  return isDesk;
}

function render() {
  if (!plan) return;
  recompute();
  const isDesk = renderChrome();
  let html, title, back = false;
  const view = $('#view');
  view.classList.toggle('narrow', isDesk && ui.tab !== 'today');
  if (isDesk && ui.tab === 'today') {
    title = 'Oversigt';
    html = `<h1 class="large-title">Oversigt</h1><div class="subtitle">${P.fmtDateLong(P.todayISO())}</div>
      <div class="dashboard"><section>${weekHTML({ compact: true })}</section><section>${todayHTML({ compact: true })}</section><section>${progressHTML({ compact: true })}</section></div>`;
  } else if (ui.tab === 'today') { title = 'I dag'; html = todayHTML(); }
  else if (ui.tab === 'pas') { title = 'Pas'; html = pasHTML(); }
  else if (ui.tab === 'stats') { title = 'Statistik'; html = statsHTML(); }
  else if (ui.tab === 'goals') { title = 'Mål'; html = goalsHTML(); }
  else if (ui.tab === 'more' && ui.sub) {
    const m = MORE.find((x) => x.id === ui.sub);
    title = m.label; back = !isDesk;
    html = { account: accountHTML, recovery: recoveryHTML, plan: planHTML, programs: () => { ui.planView = 'programs'; return planHTML(); }, hybrid: () => { ui.planView = 'hybrid'; return planHTML(); }, versions: () => { ui.planView = 'versions'; return planHTML(); }, health: healthHTML, travel: travelHTML, race: raceHTML, daily: dailyHTML, checklists: checklistsHTML, quotes: quotesHTML, swaps: swapsHTML, zones: zonesHTML, rules: rulesHTML, backup: backupHTML }[ui.sub]();
  } else { title = 'Mere'; html = moreHTML(); }
  // Chip-rækker (filtre) skal blive, hvor de er, når siden tegnes igen – ellers springer de tilbage til start
  const rowPos = $$('.filter-row', view).map((r) => r.scrollLeft);
  view.innerHTML = html;
  $$('.filter-row', view).forEach((r, i) => {
    r.scrollLeft = rowPos[i] || 0;
    const on = r.querySelector('[aria-pressed="true"]');
    if (on) { // sørg for, at det valgte filter er helt synligt
      const rb = r.getBoundingClientRect(), ob = on.getBoundingClientRect();
      const a = ob.left - rb.left + r.scrollLeft, b = a + ob.width;
      if (a < r.scrollLeft) r.scrollLeft = a - 8; else if (b > r.scrollLeft + r.clientWidth) r.scrollLeft = b - r.clientWidth + 8;
    }
  });
  $('#navTitle').textContent = title;
  $('#navLeft').innerHTML = back ? `<button class="nav-btn" data-act="back">${icon('left')}Mere</button>` : '';
  $('#navRight').innerHTML = (ui.tab === 'goals' ? `<button class="nav-btn" data-act="goalNew" aria-label="Nyt mål">${icon('plus')}</button>` : '')
    + (isDesk ? `<button class="nav-btn" data-act="refresh" aria-label="Opdater" title="Opdater (henter nyeste data og app-version)">${icon('refresh')}</button>` : '');
  document.title = `${title} · Træningsplan`;
  onScroll();
}

function go(tab, sub = null) {
  const same = ui.tab === tab && ui.sub === sub;
  if (sub === 'recovery' || tab === 'today') Sync.syncNow(); // frisk Garmin-data, hver gang siden åbnes
  ui.tab = tab; ui.sub = sub;
  if (tab === 'pas' && !same) ui.weekStart = ui.weekStart || currentWeekStart();
  render();
  if (!same) window.scrollTo({ top: 0 });
}

function onScroll() { $('#navbar').classList.toggle('scrolled', window.scrollY > 36); }

// ======================= Bottom sheet =======================
let sheetCleanup = null, sheetClosing = null, drag = null;
const sheetIsOpen = () => { const sh = $('#sheet'); return !sh.hidden && sh.classList.contains('open'); };
function resetSheetDrag() { drag = null; const sh = $('#sheet'); sh.classList.remove('dragging'); sh.style.transform = ''; }
function openSheet({ title, body, right = '', footer = '', onMount }) {
  const sheet = $('#sheet'), bd = $('#backdrop'), foot = $('#sheetFoot');
  clearTimeout(sheetClosing);
  resetSheetDrag(); // et ark må aldrig starte halvt nede efter et tidligere træk
  if (typeof sheetCleanup === 'function') sheetCleanup();
  $('#sheetTitle').textContent = title;
  $('#sheetRight').innerHTML = right;
  $('#sheetBody').innerHTML = body;
  foot.innerHTML = footer; foot.hidden = !footer;
  sheet.classList.toggle('has-foot', !!footer);
  sheet.hidden = false; bd.hidden = false;
  document.body.classList.add('sheet-open'); // skjuler pause-uret, mens et ark er åbent
  requestAnimationFrame(() => { sheet.classList.add('open'); bd.classList.add('open'); });
  $('#sheetBody').scrollTop = 0;
  sheetCleanup = onMount ? onMount($('#sheetBody')) : null;
}
function closeSheet() {
  const sheet = $('#sheet'), bd = $('#backdrop');
  if (sheet.hidden) return;
  if (document.activeElement && sheet.contains(document.activeElement)) document.activeElement.blur();
  drag = null; sheet.classList.remove('dragging');
  sheet.classList.remove('open'); bd.classList.remove('open');
  sheet.style.transform = '';
  document.body.classList.remove('sheet-open');
  if (typeof sheetCleanup === 'function') sheetCleanup();
  sheetCleanup = null;
  clearTimeout(sheetClosing);
  sheetClosing = setTimeout(() => { if (!sheet.classList.contains('open')) { sheet.hidden = true; bd.hidden = true; } }, 320);
  if (woOpen()) renderWorkoutBody(); else render();
}
// Træk arket ned for at lukke. Robust: pointer capture, flere afslutnings-hændelser og et sikkerhedsnet,
// så arket aldrig kan blive hængende halvt nede.
(function sheetDrag() {
  const sheet = () => $('#sheet');
  function end(cancel) {
    if (!drag) return;
    const { dy, t0 } = drag, speed = dy / Math.max(1, performance.now() - t0);
    drag = null;
    sheet().classList.remove('dragging');
    if (!cancel && (dy > 110 || (dy > 40 && speed > 0.6))) closeSheet(); else sheet().style.transform = '';
    setTimeout(() => {
      const sh = sheet();
      if (!drag && !sh.hidden && sh.classList.contains('open') && (sh.style.transform || sh.classList.contains('dragging'))) {
        sh.style.transform = ''; sh.classList.remove('dragging');
      }
    }, 450);
  }
  document.addEventListener('pointerdown', (ev) => {
    if (desktop.matches || drag || !sheetIsOpen()) return;
    const grip = ev.target.closest('.sheet-grab, .sheet-head');
    if (!grip || ev.target.closest('button')) return;
    drag = { id: ev.pointerId, y0: ev.clientY, dy: 0, t0: performance.now() };
    try { grip.setPointerCapture(ev.pointerId); } catch { /* ældre browsere */ }
    sheet().classList.add('dragging');
  });
  document.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (ev.pointerType === 'mouse' && ev.buttons === 0) { end(true); return; }
    drag.dy = Math.max(0, ev.clientY - drag.y0);
    sheet().style.transform = `translateY(${drag.dy}px)`;
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((type) => {
    document.addEventListener(type, (ev) => { if (drag && ev.pointerId === drag.id) end(type !== 'pointerup'); }, true);
  });
  window.addEventListener('blur', () => end(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) end(true); });
})();

function stepper(id, value, placeholder, delta, label, attrs = '', cls = '') {
  const mode = /inputmode=/.test(attrs) ? '' : 'inputmode="decimal"';
  // Forslag (forudfyldt) vises som grå placeholder, så det man skriver erstatter tallet
  const pre = cls.includes('prefilled');
  return `<div class="stepper"><button type="button" data-act="step" data-target="${id}" data-delta="${-delta}" aria-label="Mindre ${label}">${icon('minus')}</button>
    <input id="${id}" ${mode} class="${cls}" value="${pre ? '' : (value ?? '')}" placeholder="${pre ? (value ?? '') : (placeholder ?? '')}" aria-label="${label}" ${attrs}>
    <button type="button" data-act="step" data-target="${id}" data-delta="${delta}" aria-label="Mere ${label}">${icon('plus')}</button></div>`;
}

function statusButtons(e) {
  const st = statusOf(e.key);
  return `<div class="btn-row" style="margin-top:16px">
    <button class="btn flex ${st === 'done' ? 'on' : ''}" data-act="status" data-key="${e.key}" data-status="done" data-insheet="1">${icon('check')}${st === 'done' ? 'Gennemført' : 'Markér gennemført'}</button>
    <button class="btn flex" data-act="status" data-key="${e.key}" data-status="skipped" data-insheet="1">${icon('skip')}${st === 'skipped' ? 'Sprunget over' : 'Spring over'}</button></div>
    <button class="btn block" style="margin-top:8px" data-act="move" data-key="${e.key}">${icon('move')}Flyt pas${e.moved ? ` (flyttet fra ${P.fmtDateShort(e.origDate)})` : ''}</button>
    ${st === 'done' ? '' : `<button class="btn block" style="margin-top:8px" data-act="cannot" data-key="${e.key}">Kan ikke i dag</button>`}`;
}

function openSession(key) {
  const e = entryByKey(key);
  if (!e) return;
  const it = e.item;
  const head = `<div class="subtitle" style="margin:4px 0 12px">${P.fmtDateLong(e.date)}${e.moved ? ' · <span class="chip moved">Flyttet</span>' : ''}${e.adapted ? ` · <span class="chip accent">${esc(e.adapted)}</span>` : ''}</div>${travelNote(e)}`;
  if (it.kind === 'rest') return openSheet({ title: 'Hvile', body: `${head}<div class="card">${esc(it.description)}</div>` });
  if (it.kind === 'run') return openRunSheet(e, head);
  if (it.kind === 'other') return openSheet({ title: it.title, body: `${head}${sessionCard(e)}` });
  if (woOpen() && wo.key === key) return renderWorkoutBody(); // allerede åbent: opfrisk
  openWorkout(key);
}
const slotId = (slot) => String(slot).replace(/[^a-zA-Z0-9]/g, '_');

// ---- Styrke: startvægte, enhed, næste gang og skive-beregner ----
function strengthCtx() {
  return {
    lib: exerciseIndex(), start: startWeights || {},
    settings: new Map(S.all('exercise_settings').map((r) => [r.id, r])),
  };
}
function targetFor(e, ex, ctx = strengthCtx()) {
  const sessions = T.sessionsFor(S.all('strength_logs'), ctx, ex.exercise, e);
  return { sessions, target: T.nextTarget(ctx, ex, sessions, { deload: !!(P.weekFor(plan, e.date) || {}).deload, session: e.item.session }) };
}
// Kort status til oversigter: hvor mange øvelser er klar til mere vægt
function nextSummary(e, ctx = strengthCtx()) {
  const items = exList(e).map((ex) => ({ name: ex.exercise, ...targetFor(e, ex, ctx).target }));
  return { up: items.filter((x) => x.kind === 'up' || x.kind === 'manual').length, items };
}

// ======================= Styrkepas i fuldskærm =======================
// wo = tilstand for det åbne pas. vals/edited husker det, der er skrevet i felterne, men endnu ikke er markeret ✓,
// så en opfriskning (fx efter "Skift øvelse") aldrig sletter noget.
const wo = { key: null, vals: {}, edited: new Set(), start: null, end: null, tick: null };
const woOpen = () => !$('#workout').hidden;
Wake.init(woOpen);
const curKey = () => (woOpen() ? wo.key : $('#sheetBody').dataset.key);
const WO_STORE = (k) => `tp.wo.${k}`;
function loadWo(key) { try { return JSON.parse(localStorage.getItem(WO_STORE(key)) || '{}'); } catch { return {}; } }
function saveWo() { try { localStorage.setItem(WO_STORE(wo.key), JSON.stringify({ start: wo.start, end: wo.end })); } catch { /* privat tilstand */ } }
const fmtClock = (sec) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), r = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

function openWorkout(key) {
  const e = entryByKey(key);
  if (!e) return;
  const saved = loadWo(key);
  const stale = saved.start && !saved.end && Date.now() - saved.start > 6 * 3600 * 1000; // glemt pas fra tidligere
  Object.assign(wo, { key, scope: 'date', vals: {}, edited: new Set(), start: stale ? null : saved.start || null, end: stale ? null : saved.end || null });
  syncWoStart();
  $('#woTitle').textContent = e.item.session;
  $('#workout').hidden = false;
  document.body.classList.add('in-workout');
  renderWorkoutBody();
  $('#woBody').scrollTop = 0;
  updateElapsed();
  clearInterval(wo.tick); wo.tick = setInterval(updateElapsed, 1000);
  Wake.acquire();
}
function closeWorkout() {
  stopRest();
  Wake.release();
  clearInterval(wo.tick);
  $('#workout').hidden = true;
  document.body.classList.remove('in-workout');
  wo.key = null; wo.vals = {}; wo.edited = new Set();
  render();
}
// Findes der allerede ✓-sæt (fx efter genindlæsning), men ingen starttid, bruges det første sæts tidspunkt
function syncWoStart() {
  if (wo.start || !wo.key) return;
  const times = setsFor(wo.key).filter((r) => num(r.reps) != null).map((r) => Date.parse(r.updated_at)).filter((t) => t > 0);
  if (times.length) { wo.start = Math.min(...times); saveWo(); }
}
function updateElapsed() {
  const el = $('#woElapsed');
  if (!el) return;
  syncWoStart();
  el.textContent = wo.start ? fmtClock(Math.max(0, ((wo.end || Date.now()) - wo.start) / 1000)) : '–';
}

function renderWorkoutBody() {
  const key = wo.key;
  recompute();
  const e = key && entryByKey(key);
  if (!e) { closeWorkout(); return; }
  const body = $('#woBody'), top = body.scrollTop;
  const logged = Object.fromEntries(setsFor(key).map((r) => [`${r.ex_index}-${r.set_no}`, r]));
  const ctx = strengthCtx();
  $('#woTitle').textContent = e.item.session;
  let h = `<div class="subtitle" style="margin:2px 4px 10px">${P.fmtDateLong(e.date)}${e.moved ? ' · <span class="chip moved">Flyttet</span>' : ''}${e.adapted ? ` · <span class="chip accent">${esc(e.adapted)}</span>` : ''}</div>${travelNote(e)}`;
  if (e.item.note) h += `<div class="note" style="margin-bottom:12px">${esc(e.item.note)}</div>`;
  if (e.item.own && e.item.kind === 'strength') h += miniMapHTML(e);
  h += `<div class="wo-scope"><span class="meta">Ændringer af sæt, reps, RIR og rækkefølge gælder:</span><div class="seg" role="group"><button type="button" data-act="seg" data-group="woScope" data-value="date" aria-pressed="${(wo.scope || 'date') === 'date'}">Kun i dag</button><button type="button" data-act="seg" data-group="woScope" data-value="future" aria-pressed="${wo.scope === 'future'}">${e.item.program_id ? 'Fremover og programmet' : 'Fremover i dette pas'}</button></div></div>`;
  for (const ex of exList(e)) h += exerciseCard(e, ex, logged, ctx);
  h += `<button class="btn block" style="margin-top:12px" data-act="exAdd">${icon('plus')}Tilføj øvelse</button>
    <div class="wo-actions">${e.item.own ? `<button class="btn block" data-act="saveTpl" data-key="${e.key}">Gem som skabelon</button>` : ''}<button class="btn block" data-act="move" data-key="${e.key}">${icon('move')}Flyt pas${e.moved ? ` (flyttet fra ${P.fmtDateShort(e.origDate)})` : ''}</button>
    <button class="btn block danger" data-act="woSkip">${icon('skip')}Spring pas over</button></div>`;
  body.innerHTML = h;
  body.scrollTop = top;
  updateFinishHint();
}

function exerciseCard(e, ex, logged, ctx) {
  const sid = slotId(ex.slot), name = ex.exercise;
  const { sessions, target } = targetFor(e, ex, ctx);
  const last = sessions[sessions.length - 1];
  const lt = T.loadType(ctx, name);
  const sets = Math.max(1, Number(ex.sets) || 3);
  const step = lt === 'per_hand' ? 1 : P.weightStep(name, ctx.lib);
  const restSec = T.restSeconds(ctx, name, ex.rest_sec), ownRest = T.hasOwnRest(ctx, name) || num(ex.rest_sec) > 0;
  let h = `<div class="ex-card" data-ex="${esc(name)}" data-slot="${esc(ex.slot)}"><div class="ex-top"><button type="button" class="ex-handle" data-act="exHandle" data-slot="${esc(ex.slot)}" aria-label="Træk for at flytte øvelsen">≡</button><h4>${esc(name)}</h4>
    ${ex.added ? `<button class="link-btn" data-act="exUndo" data-id="${esc(ex.override_id)}">Fjern</button>`
      : `<button class="link-btn" data-act="exSwap" data-slot="${esc(ex.slot)}">${icon('swap')}Skift øvelse</button>`}</div>
    <div class="ex-tune"><span class="grp"><button type="button" class="btn" data-act="setCount" data-slot="${esc(ex.slot)}" data-d="-1" aria-label="Fjern et sæt">− Sæt</button><b>${sets}</b><button type="button" class="btn" data-act="setCount" data-slot="${esc(ex.slot)}" data-d="1" aria-label="Tilføj et sæt">+ Sæt</button></span>
      <label>Reps <input data-tune="reps" data-slot="${esc(ex.slot)}" value="${esc(ex.reps)}" aria-label="Rep-mål"></label>
      <label>RIR <select data-tune="rir" data-slot="${esc(ex.slot)}" aria-label="RIR">${['0', '1', '2', '3', '4'].map((r) => `<option ${String(ex.rir) === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <span class="grp"><button type="button" class="btn" data-act="exMove" data-slot="${esc(ex.slot)}" data-dir="-1" aria-label="Flyt op">${icon('up')}</button><button type="button" class="btn" data-act="exMove" data-slot="${esc(ex.slot)}" data-dir="1" aria-label="Flyt ned">${icon('down')}</button></span></div>
    <div class="meta ex-meta">
      <label class="unit"><span class="visually-hidden">Enhed</span><select data-unit="${esc(name)}">${Object.entries(T.LOAD_TYPES).map(([k, l]) => `<option value="${k}" ${k === lt ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button type="button" class="rest-chip ${ownRest ? 'own' : ''}" data-act="restCycle" data-name="${esc(name)}" aria-label="Pause efter hvert sæt: ${T.restLabel(restSec, ownRest)}. Tryk for at ændre">${icon('timer')}${T.restLabel(restSec, ownRest)}</button></div>`;
  if (ex.swapped_from) h += `<div class="last">Skiftet fra ${esc(ex.swapped_from)} · <button class="link-btn inline" data-act="exUndo" data-id="${esc(ex.override_id)}">Fortryd skift</button></div>`;
  if (ex.added) h += `<div class="last">Ekstra øvelse</div>`;
  if (ex.rep_note) h += `<div class="note rep-note">${esc(ex.rep_note)}</div>`;
  if (last) h += `<div class="last">Sidste gang (${P.fmtDateShort(last.date)}): ${last.sets.map((x) => `${T.fmtKg(x.kg)} kg × ${x.reps}`).join(', ')}</div>`;
  // Første gang: startvægt (bekræft antagelser) eller tip
  if (!last && target.kind !== 'manual') {
    const st = T.startWeight(ctx, name);
    if (st.kg != null && st.assumption && !st.confirmed) {
      h += `<div class="warn confirm-box">${icon('warn')}<div><b>Bekræft startvægt: ${T.fmtKg(st.kg)} ${T.LOAD_TYPES[lt]}</b><br>${esc(st.assumption)}
        <div class="btn-row" style="margin-top:8px"><button class="btn" data-act="startOk" data-name="${esc(name)}">${icon('check')}Passer</button>
        <button class="btn" data-act="nextEdit" data-name="${esc(name)}" data-kg="${st.kg}">Ret vægt</button></div></div></div>`;
    } else if (st.kg == null) {
      h += `<div class="note">Ingen tidligere vægt. Vælg en vægt, du kunne løfte 2–3 gange mere end rep-målet.${st.reference ? `<br>Til sammenligning: ${esc(st.reference)}.` : ''}</div>`;
    }
    if (st.kg_second) h += `<div class="last">Anden øvelse i supersættet: ${T.fmtKg(st.kg_second)} kg</div>`;
  }
  // Næste gang-mærke + manuel vægt
  if (ui.editNext === name) {
    const v = target.kg != null ? String(target.kg).replace('.', ',') : '';
    h += `<div class="next-edit">${stepper('next-kg', v, '', step, 'kg næste gang')}
      <button class="btn filled" data-act="nextSave" data-name="${esc(name)}">Gem</button>
      ${(ctx.settings.get(name) || {}).next_kg != null ? `<button class="btn" data-act="nextReset" data-name="${esc(name)}">Nulstil</button>` : ''}</div>`;
  } else if (target.text) {
    h += `<div class="next-row"><span class="chip next-${target.kind}">${esc(target.text)}</span><button class="link-btn inline" data-act="nextEdit" data-name="${esc(name)}">Ret</button></div>`;
  }
  h += `<div class="set-head"><span>#</span><span>${esc(lt === 'bodyweight' ? '+ kg' : T.LOAD_TYPES[lt])}</span><span>reps</span><span class="visually-hidden">Færdig</span></div>`;
  // Forudfyldning: vægten fra "næste gang" (arves til senere sæt), reps fra sidste gang eller bunden af intervallet
  let carryKg = target.kg != null ? String(target.kg).replace('.', ',') : '';
  let firstKg = null;
  for (let n = 1; n <= sets; n++) {
    const r = logged[`${ex.slot}-${n}`];
    const done = !!r && num(r.reps) != null;
    const v = wo.vals[`${ex.slot}|${n}`] || {};
    const kgEdited = wo.edited.has(`kg|${ex.slot}|${n}`), repsEdited = wo.edited.has(`reps|${ex.slot}|${n}`);
    let kgVal, repsVal, kgPre = false, repsPre = false;
    if (done) { kgVal = r.kg; repsVal = r.reps; }
    else {
      if (kgEdited && v.kg !== undefined) kgVal = v.kg; else { kgVal = carryKg; kgPre = kgVal !== ''; }
      if (repsEdited && v.reps !== undefined) repsVal = v.reps; else { const pr = T.prefillReps(target, last, n, ex); repsVal = pr != null ? pr : ''; repsPre = repsVal !== ''; }
    }
    if (kgVal !== '' && kgVal != null) carryKg = String(kgVal).replace('.', ',');
    if (firstKg == null && kgVal !== '' && kgVal != null) firstKg = num(kgVal);
    h += `<div class="set-row ${done ? 'done' : ''}" data-set="${esc(ex.slot)}|${n}">
      <span class="n">${n}</span>
      ${stepper(`kg-${sid}-${n}`, kgVal != null ? String(kgVal).replace('.', ',') : '', 'kg', step, `kg, sæt ${n}`, `data-set="${esc(ex.slot)}|${n}"`, kgPre ? 'prefilled' : '')}
      ${stepper(`reps-${sid}-${n}`, repsVal ?? '', 'reps', 1, `reps, sæt ${n}`, `data-set="${esc(ex.slot)}|${n}" inputmode="numeric"`, repsPre ? 'prefilled' : '')}
      <button type="button" class="set-ok" data-act="setDone" data-slot="${esc(ex.slot)}" data-n="${n}" aria-pressed="${done}"
        aria-label="${done ? `Sæt ${n} er færdigt – tryk for at fortryde` : `Sæt ${n} færdigt`}">${icon('check')}</button></div>`;
  }
  if (lt === 'total') h += `<div class="plates" id="plates-${sid}">${esc(T.plates(firstKg))}</div>`;
  return h + `</div>`;
}

const setRowEl = (slot, n) => $$('#woBody .set-row').find((el) => el.dataset.set === `${slot}|${n}`);
function markRow(rowEl, done) {
  if (!rowEl) return;
  rowEl.classList.toggle('done', done);
  const [slot, n] = rowEl.dataset.set.split('|');
  const btn = $('.set-ok', rowEl);
  btn.setAttribute('aria-pressed', String(done));
  btn.setAttribute('aria-label', done ? `Sæt ${n} er færdigt – tryk for at fortryde` : `Sæt ${n} færdigt`);
  if (done) $$('input', rowEl).forEach((i) => i.classList.remove('prefilled'));
}

// ✓ på et sæt: gem sættet, marker rækken som gennemført og start pausen. Tryk igen for at fortryde.
function toggleSet(slot, n) {
  const key = wo.key, e = entryByKey(key);
  if (!e) return;
  const ex = exList(e).find((x) => x.slot === slot);
  if (!ex) return;
  const sid = slotId(slot), id = `${key}|${slot}|${n}`, rowEl = setRowEl(slot, n);
  const existing = S.get('strength_logs', id);
  if (existing && num(existing.reps) != null) { S.remove('strength_logs', id); markRow(rowEl, false); updateFinishHint(); refreshMiniMap(); return; }
  const kgEl = $(`#kg-${sid}-${n}`), repsEl = $(`#reps-${sid}-${n}`);
  const ctx = strengthCtx(), lt = T.loadType(ctx, ex.exercise);
  let kg = num(kgEl.value) ?? num(kgEl.placeholder); // uden eget tal bruges forslaget
  const reps = num(repsEl.value) ?? num(repsEl.placeholder);
  if (reps == null) { toast('Skriv, hvor mange reps du tog.'); repsEl.focus(); return; }
  if (kg == null && lt !== 'bodyweight') { toast('Skriv vægten først.'); kgEl.focus(); return; }
  if (kg == null) kg = 0;
  S.put('strength_logs', { id, item_key: key, date: e.date, session: e.item.session, ex_index: slot, exercise: ex.exercise, set_no: n, kg, reps, load_type: lt });
  markRow(rowEl, true);
  refreshMiniMap();
  announceRecords(S.get('strength_logs', id));
  if (!wo.start) wo.start = Date.now(); // tiden starter ved første ✓
  if (wo.end) wo.end = null;            // fortsætter man efter "Afslut", løber tiden videre
  saveWo(); updateElapsed();
  unlockAudio();
  if (allSetsDone(e)) { stopRest(); toast('Alle sæt er klaret – tryk Afslut pas.'); } else startRest(T.restSeconds(ctx, ex.exercise, ex.rest_sec), ex.exercise);
  updateFinishHint();
}
// 🏅 Besked, når et ✓-sæt slår en rekord for øvelsen
function announceRecords(row) {
  if (!row) return;
  const lib = exerciseIndex();
  const hits = X.prCheck(S.all('strength_logs'), lib, row);
  if (!hits.length) return;
  const text = { e1rm: (v) => `est. 1RM ${fmtNum(Math.round(v * 10) / 10)} kg`, maxKg: (v) => `maks vægt ${fmtNum(v)} kg`, setVol: (v) => `sæt-volumen ${fmtNum(v, 0)} kg`, maxReps: (v) => `maks reps ${fmtNum(v, 0)}` };
  toast(`🏅 Ny rekord: ${X.canonicalName(lib, row.exercise)} – ${hits.slice(0, 2).map((h) => text[h.type](h.value)).join(', ')}`, null, 4500);
}
function allSetsDone(e) {
  const done = new Set(setsFor(e.key).filter((r) => num(r.reps) != null).map((r) => `${r.ex_index}|${r.set_no}`));
  return exList(e).every((ex) => { for (let n = 1; n <= (Number(ex.sets) || 3); n++) if (!done.has(`${ex.slot}|${n}`)) return false; return true; });
}
function updateFinishHint() {
  const btn = $('.wo-finish'), e = wo.key && entryByKey(wo.key);
  if (btn && e) btn.classList.toggle('ready', allSetsDone(e));
}

// Ændring i et kg- eller reps-felt: husk det, vis det som "rettet" (sort), og giv senere sæt den nye vægt
function onSetEdit(t, type) {
  const [slot, nStr] = t.dataset.set.split('|');
  const n = Number(nStr), sid = slotId(slot), isKg = t.id.startsWith('kg-');
  t.classList.remove('prefilled');
  wo.edited.add(`${isKg ? 'kg' : 'reps'}|${slot}|${n}`);
  wo.vals[`${slot}|${n}`] = { ...(wo.vals[`${slot}|${n}`] || {}), [isKg ? 'kg' : 'reps']: t.value };
  if (isKg) {
    for (let m = n + 1; ; m++) {
      const nx = $(`#kg-${sid}-${m}`);
      if (!nx) break;
      if (nx.classList.contains('prefilled')) { nx.value = ''; nx.placeholder = t.value; }
    }
    const pl = $(`#plates-${sid}`);
    if (pl) pl.textContent = T.plates(num(t.value));
  }
  // Et sæt, der allerede er ✓, opdateres stille (ingen ny pause)
  if (type === 'change') {
    const e = entryByKey(wo.key);
    const row = e && S.get('strength_logs', `${wo.key}|${slot}|${n}`);
    if (row && num(row.reps) != null) {
      const kg = num($(`#kg-${sid}-${n}`).value), reps = num($(`#reps-${sid}-${n}`).value);
      if (reps == null) { S.put('strength_logs', { ...row, kg: kg ?? 0 }); return; }
      S.put('strength_logs', { ...row, kg: kg ?? row.kg, reps });
    }
  }
}

// ---- Pause-ur: DOM'en bygges én gang (i index.html); kun tekst og bredde opdateres ----
let rest = null; // { end, total, name, done, warned, timer }
(window.__tp ||= { cues: [] }).getRest = () => rest; // bruges kun til test
function startRest(sec, name) {
  stopRest();
  rest = { end: Date.now() + sec * 1000, total: sec, name, done: false, warned: false, timer: null, pid: null };
  rest.timer = setInterval(tickRest, 250);
  pushRest();
  $('#restDock').classList.add('show');
  tickRest();
}
function stopRest() {
  if (rest) { clearInterval(rest.timer); if (rest.pid) pushRestCancel(); }
  rest = null;
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch { /* ingen tale */ }
  $('#restDock').classList.remove('show', 'over');
}
// Pausen er slut: tydelig blink (virker også uden lyd)
function flashRest() {
  document.body.classList.add('rest-flash');
  setTimeout(() => document.body.classList.remove('rest-flash'), 2600);
}
function tickRest() {
  if (!rest) return;
  const left = Math.ceil((rest.end - Date.now()) / 1000); // sekunder tilbage; negativ = over tiden
  if (left <= 0 && !rest.done) { rest.done = true; rest.warned = true; playCue('end'); flashRest(); }
  else if (left > 0 && left <= 10 && !rest.warned && rest.total > 20) { rest.warned = true; playCue('warn'); }
  const over = left <= 0, t = Math.abs(left);
  $('#rdLabel').textContent = over ? 'Klar til næste sæt!' : `Pause · ${rest.name}`;
  $('#rdTime').textContent = `${over && left < 0 ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  $('#rdBar').style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - left / rest.total))})`;
  $('#restDock').classList.toggle('over', over);
  if (left < -300) stopRest(); // skjul igen 5 min efter
}
// Tilbage fra baggrunden: vis straks den rigtige tid (ud fra rest.end), og bip hvis pausen er slut
['visibilitychange', 'pageshow', 'focus'].forEach((type) => (type === 'visibilitychange' ? document : window).addEventListener(type, () => {
  if (type === 'visibilitychange' && document.hidden) return;
  tickRest(); updateElapsed();
  if (woOpen()) Wake.acquire();
}));

// ---- Afslut pas: opsummering ----
function openSummary() {
  const e = entryByKey(wo.key);
  if (!e) return;
  const ctx = strengthCtx();
  const rows = setsFor(wo.key).filter((r) => num(r.reps) != null);
  if (!rows.length && !confirm('Ingen sæt er markeret færdige. Afslut alligevel?')) return;
  const secs = wo.start ? Math.max(0, ((wo.end || Date.now()) - wo.start) / 1000) : null;
  const nextOcc = sched.entries.find((x) => x.item.kind === 'strength' && x.item.session === e.item.session && x.date > e.date);
  const nextDeload = !!(nextOcc && (P.weekFor(plan, nextOcc.date) || {}).deload);
  const nexts = [];
  for (const ex of exList(e)) {
    const sessions = T.sessionsFor(S.all('strength_logs'), ctx, ex.exercise, { key: '__after__', date: '9999-12-31' });
    const tg = T.nextTarget(ctx, ex, sessions, { deload: nextDeload, session: e.item.session });
    if (tg.text) nexts.push({ name: ex.exercise, tg });
  }
  const detail = X.sessionDetail(S.all('strength_logs'), exerciseIndex(), wo.key);
  const opts = { minutes: secs != null ? Math.max(1, Math.round(secs / 60)) : undefined, start: wo.start || undefined };
  pd = { key: wo.key, opts, blob: null };
  const body = (detail ? SU.passDetailHTML(detail, opts) : '') + `
    <div class="section-header">Næste gang</div>
    <div class="group">${nexts.map((x) => `<div class="row"><span class="grow"><span class="title">${esc(x.name)}</span></span><span class="chip next-${x.tg.kind}">${esc(x.tg.text.replace(/^Næste gang:\s*/, ''))}</span></div>`).join('') || '<div class="row"><span class="grow meta">Ingen forslag endnu.</span></div>'}</div>
    ${nextDeload ? '<div class="section-footer">Næste pas ligger i en deload-uge: hold vægten, og øg ikke.</div>' : ''}`;
  openSheet({
    title: 'Opsummering', body, onMount: () => prepareShare(),
    footer: `<div class="btn-row"><button class="btn" data-act="closeSheet">Tilbage til passet</button><button class="btn filled" data-act="woDone">${icon('check')}Færdig</button></div>`,
  });
}
// ---- Pas-detalje (fra Statistik → Historik og efter "Afslut pas") og Del som billede ----
let pd = null; // { key, opts, blob }
function openPassDetail(key) {
  const d = X.sessionDetail(S.all('strength_logs'), exerciseIndex(), key);
  if (!d) { toast('Ingen loggede sæt i dette pas.'); return; }
  pd = { key, opts: {}, blob: null };
  openSheet({ title: d.session || 'Styrkepas', body: SU.passDetailHTML(d, {}), onMount: () => prepareShare() });
  $('#sheetBody').dataset.key = key;
}
// Billedet laves på forhånd, så "Del" kan svare med det samme (iPhone kræver, at deling sker lige efter trykket)
function prepareShare() {
  if (!pd) return;
  const cur = pd, d = X.sessionDetail(S.all('strength_logs'), exerciseIndex(), cur.key);
  if (!d) return;
  cur.blob = SH.summaryPNG(d, cur.opts).catch(() => null);
}
async function shareSummary() {
  if (!pd) return;
  const d = X.sessionDetail(S.all('strength_logs'), exerciseIndex(), pd.key);
  if (!pd.blob) prepareShare();
  const blob = await pd.blob;
  if (!blob) { toast('Kunne ikke lave billedet.'); return; }
  const file = new File([blob], `${(d.session || 'pas').replace(/\W+/g, '-')}-${d.date}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `${d.session || 'Styrkepas'} ${d.date}` }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Billedet er gemt');
}
function finishWorkout() {
  const e = entryByKey(wo.key);
  if (!e) return;
  setStatus(e, 'done', { toggle: false });
  ownFinish(e);
  wo.end = Date.now(); saveWo();
  closeSheet();
  closeWorkout();
  toast('Pas gemt ✓');
}

// ---- Skift og tilføj øvelser ----
const libInfo = (n) => allExercises().find((x) => x.name === n || (x.aliases || []).includes(n)) || null;
let picker = null; // { key, slot, mode: 'swap'|'add', chosen }
function exerciseRow(x, current) {
  return `<button class="row tappable" data-act="exPick" data-name="${esc(x.name)}" ${x.name === current ? 'disabled' : ''}>
    <span class="grow"><span class="title">${esc(x.name)}</span><span class="meta" style="display:block">${esc([x.group, x.pattern, x.equipment].filter(Boolean).join(' · '))}${x.custom ? ' · Egen' : ''}</span></span>${icon('right', 'chev')}</button>`;
}
// Filtre i øvelsessøgningen (husker sidste valg)
const PICK_KEY = 'tp.pickFilter';
const MUSCLE_FILTERS = [
  ['chest', 'Bryst', (x) => (x.primary_muscles || []).includes('chest')],
  ['back', 'Ryg', (x) => (x.primary_muscles || []).some((m) => ['lats', 'lower_back'].includes(m)) || x.group === 'Ryg'],
  ['shoulders', 'Skuldre', (x) => (x.primary_muscles || []).some((m) => /^delt_/.test(m))],
  ['biceps', 'Biceps', (x) => (x.primary_muscles || []).includes('biceps')],
  ['triceps', 'Triceps', (x) => (x.primary_muscles || []).includes('triceps')],
  ['quads', 'Ben – forlår', (x) => (x.primary_muscles || []).includes('quads')],
  ['hamstrings', 'Baglår', (x) => (x.primary_muscles || []).includes('hamstrings')],
  ['glutes', 'Baller', (x) => (x.primary_muscles || []).includes('glutes')],
  ['calves', 'Lægge', (x) => (x.primary_muscles || []).includes('calves')],
  ['abs', 'Mave', (x) => (x.primary_muscles || []).includes('abs')],
  ['full', 'Hele kroppen', (x) => (x.primary_muscles || []).length >= 3 || /dødløft/i.test(x.name || '')],
];
const EQUIP_FILTERS = [
  ['bar', 'Stang', (x) => x.load_type === 'total' || /stang|barbell/i.test(x.equipment || '')],
  ['db', 'Håndvægt', (x) => x.load_type === 'per_hand' || /håndvægt|dumbbell/i.test(x.equipment || '')],
  ['machine', 'Maskine', (x) => x.load_type === 'machine' || /maskine/i.test(x.equipment || '')],
  ['cable', 'Kabel', (x) => x.load_type === 'cable' || /kabel/i.test(x.equipment || '')],
  ['bw', 'Kropsvægt', (x) => x.load_type === 'bodyweight' || /kropsvægt/i.test(x.equipment || '')],
];
let pickFilter = (() => { try { return { m: null, eq: null, ...(JSON.parse(localStorage.getItem(PICK_KEY)) || {}) }; } catch { return { m: null, eq: null }; } })();
const savePickFilter = () => { try { localStorage.setItem(PICK_KEY, JSON.stringify(pickFilter)); } catch { /* privat tilstand */ } };
function pickChipsHTML() {
  const c = (k, id, label, on) => `<button type="button" class="chip-btn" data-act="pickF" data-k="${k}" data-v="${id}" aria-pressed="${on}">${label}</button>`;
  return `<div class="tag-picks filter-row">${MUSCLE_FILTERS.map(([id, l]) => c('m', id, l, pickFilter.m === id)).join('')}</div>
    <div class="tag-picks filter-row">${EQUIP_FILTERS.map(([id, l]) => c('eq', id, l, pickFilter.eq === id)).join('')}</div>`;
}
function pickFilterToggle(k, v) {
  pickFilter[k] = pickFilter[k] === v ? null : v;
  savePickFilter();
  const box = $('#exFilters'); if (box) box.innerHTML = pickChipsHTML(); // kun chips og liste tegnes igen – aldrig hele arket
  const res = $('#exResults'); if (res) res.innerHTML = pickerResults(($('#exSearch') || {}).value || '', picker && picker.current);
}
function recentExercises(n = 8) {
  const seen = new Set(), out = [], by = new Map(allExercises().map((x) => [x.name, x]));
  for (const r of [...S.all('strength_logs')].sort((a, b) => ((a.updated_at || '') < (b.updated_at || '') ? 1 : -1))) {
    const x = by.get(r.exercise);
    if (x && !seen.has(x.name)) { seen.add(x.name); out.push(x); if (out.length >= n) break; }
  }
  return out;
}
function pickerResults(q, current) {
  const all = allExercises();
  const query = q.trim().toLowerCase();
  let list = all;
  const mf = MUSCLE_FILTERS.find((x) => x[0] === pickFilter.m), ef = EQUIP_FILTERS.find((x) => x[0] === pickFilter.eq);
  if (mf) list = list.filter(mf[2]);
  if (ef) list = list.filter(ef[2]);
  if (query) list = list.filter((x) => [x.name, x.group, x.pattern, x.equipment, ...(x.aliases || [])].join(' ').toLowerCase().includes(query));
  if (query || mf || ef) return list.length ? `<div class="group">${list.slice(0, 60).map((x) => exerciseRow(x, current)).join('')}</div>` : `<div class="card empty">Ingen øvelser fundet. Prøv et andet filter, eller opret den som ny øvelse herunder.</div>`;
  const recent = recentExercises();
  const groups = (exercisesFile && exercisesFile.groups) || [...new Set(all.map((x) => x.group))];
  return (recent.length ? `<div class="section-header">Senest brugt</div><div class="group">${recent.map((x) => exerciseRow(x, current)).join('')}</div>` : '') + groups.map((g) => {
    const xs = all.filter((x) => x.group === g);
    return xs.length ? `<div class="section-header">${esc(g)}</div><div class="group">${xs.map((x) => exerciseRow(x, current)).join('')}</div>` : '';
  }).join('');
}
function openExercisePicker(key, slot) {
  const e = entryByKey(key);
  if (!e) return;
  const ex = slot != null ? exList(e).find((x) => x.slot === slot) : null;
  picker = { key, slot, mode: ex ? 'swap' : 'add', chosen: null, current: ex && ex.exercise };
  const all = allExercises();
  let suggest = [];
  const forMuscles = !ex && e.item.own && (e.item.muscles || []).length;
  if (forMuscles) suggest = O.exercisesForMuscles(e.item.muscles, new Map(all.map((x) => [x.name, x]))).sort((a, b) => Number(O.isCompound(b)) - Number(O.isCompound(a))).slice(0, 14);
  if (ex) {
    const info = all.find((x) => x.name === ex.exercise);
    const byId = new Map(all.map((x) => [x.id, x]));
    suggest = info && info.alternatives && info.alternatives.length ? info.alternatives.map((id) => byId.get(id)).filter(Boolean)
      : all.filter((x) => info && x.pattern === info.pattern && x.name !== ex.exercise);
  }
  const top = `<div class="pick-top"><div class="search"><span class="search-ic">${icon('search')}</span><input type="search" id="exSearch" placeholder="Søg i øvelsesbiblioteket" autocomplete="off" autocapitalize="off" enterkeyhint="search" aria-label="Søg øvelse"></div>
    <div id="exFilters">${pickChipsHTML()}</div></div>`;
  // Søgefeltet ligger fast øverst; forslag og resultater scroller under det
  const body = `${top}${ex ? `<div class="subtitle" style="margin:4px 0 10px">Nu: <b>${esc(ex.exercise)}</b></div>` : ''}
    ${suggest.length ? `<div class="section-header">${forMuscles ? 'Til dine muskelgrupper' : 'Forslag til samme bevægelse'}</div><div class="group">${suggest.map((x) => exerciseRow(x, ex && ex.exercise)).join('')}</div>` : ''}
    <div id="exResults">${pickerResults('', ex && ex.exercise)}</div>`;
  openSheet({
    title: ex ? 'Skift øvelse' : 'Tilføj øvelse', body,
    footer: `<button class="btn block" data-act="exNew">${icon('plus')}Opret ny øvelse</button>`,
    right: `<button class="nav-btn" data-act="exBack">Tilbage</button>`,
    onMount: (root) => {
      $('#exSearch', root).addEventListener('input', (ev) => { $('#exResults', root).innerHTML = pickerResults(ev.target.value, ex && ex.exercise); });
    },
  });
}
function openExerciseConfirm(name) {
  const e = entryByKey(picker.key);
  const ex = picker.slot != null ? exList(e).find((x) => x.slot === picker.slot) : null;
  picker.chosen = name;
  const v = ex ? { sets: ex.sets, reps: ex.reps, rir: ex.rir } : { sets: 3, reps: '8-12', rir: '2' };
  // Skift mellem etbens- og tobens-øvelse: fjern/tilføj "pr. ben" og foreslå passende reps
  let repNote = '';
  if (ex) { const a = T.adaptReps(ex.reps, libInfo(ex.exercise), ex.exercise, libInfo(name), name); v.reps = a.reps; repNote = a.note; }
  const body = `<div class="card" style="margin:4px 0 14px"><h3>${esc(name)}</h3>${ex ? `<div class="meta">I stedet for ${esc(ex.exercise)}</div>` : `<div class="meta">Ekstra øvelse i ${esc(e.item.session)}</div>`}</div>
    <div class="section-header">Gælder</div>
    <div class="seg" id="exScope" role="group"><button type="button" data-scope="date" aria-pressed="true">Kun i dag</button><button type="button" data-scope="future" aria-pressed="false">Fremover i dette pas</button></div>
    <div class="section-footer" id="exScopeHelp">Kun dette pas (${P.fmtDateShort(e.date)}).</div>
    <div class="section-header">Sæt, reps og RIR${ex ? ' (arvet – kan ændres)' : ''}</div>
    <div class="group">
      <div class="field"><label for="ex-sets">Sæt</label><input id="ex-sets" inputmode="numeric" value="${esc(v.sets)}"></div>
      <div class="field"><label for="ex-reps">Reps</label><input id="ex-reps" value="${esc(v.reps)}" placeholder="f.eks. 8-12"></div>
      <div class="field"><label for="ex-rir">RIR</label><input id="ex-rir" value="${esc(v.rir ?? '')}" placeholder="f.eks. 2"></div>
    </div>
    ${repNote ? `<div class="note rep-note">${esc(repNote)}</div>` : ''}`;
  openSheet({
    title: ex ? 'Skift øvelse' : 'Tilføj øvelse', body,
    footer: `<button class="btn filled block" data-act="exSave">${icon('check')}${ex ? 'Skift øvelse' : 'Tilføj øvelse'}</button>`,
    right: `<button class="nav-btn" data-act="exPickerBack">Tilbage</button>`,
    onMount: (root) => {
      $('#exScope', root).addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        $$('#exScope button', root).forEach((x) => x.setAttribute('aria-pressed', x === b));
        $('#exScopeHelp', root).textContent = b.dataset.scope === 'future'
          ? `Alle ${e.item.session}-pas fra ${P.fmtDateShort(e.date)} og frem. Kan fortrydes under Mere → Mine øvelsesskift.`
          : `Kun dette pas (${P.fmtDateShort(e.date)}).`;
      });
    },
  });
}
function saveExerciseChange() {
  const e = entryByKey(picker.key);
  if (!e || !picker.chosen) return;
  const scope = ($('#exScope button[aria-pressed="true"]') || {}).dataset?.scope || 'date';
  let original = null;
  if (picker.slot != null) {
    // "Fremover"-skift skal pege på navnet fra de faste skift (uden "kun i dag"-skift)
    const base = scope === 'future'
      ? P.effectiveExercises(e, S.all('exercise_overrides').filter((r) => r.scope === 'future'))
      : exList(e);
    original = (base.find((x) => x.slot === picker.slot) || {}).exercise;
  }
  S.put('exercise_overrides', {
    id: `xo-${Date.now().toString(36)}`, action: picker.slot != null ? 'swap' : 'add', scope,
    date: e.date, item_key: scope === 'date' ? e.key : null, session: e.item.session,
    original, exercise: picker.chosen,
    sets: num($('#ex-sets').value) || 3, reps: $('#ex-reps').value.trim() || '8-12', rir: $('#ex-rir').value.trim() || null,
  });
  toast(picker.slot != null ? `Skiftet til ${picker.chosen}` : `${picker.chosen} tilføjet`);
  picker = null;
  closeSheet(); // passet opfriskes af closeSheet – uden at miste det, du har skrevet
}
function openExerciseNew() {
  const groups = (exercisesFile && exercisesFile.groups) || ['Ben', 'Bryst', 'Ryg', 'Skuldre', 'Arme', 'Core'];
  const patterns = (exercisesFile && exercisesFile.patterns) || [];
  const body = `<div class="group" style="margin-top:6px">
      <div class="field"><label for="nx-name">Navn</label><input id="nx-name" placeholder="f.eks. Landmine press"></div>
      <div class="field"><label for="nx-group">Muskelgruppe</label><select id="nx-group">${groups.map((g) => `<option>${esc(g)}</option>`).join('')}</select></div>
      <div class="field"><label for="nx-pattern">Bevægelse</label><select id="nx-pattern">${patterns.map((p) => `<option>${esc(p)}</option>`).join('')}<option>Andet</option></select></div>
      <div class="field"><label for="nx-body">Progression</label><select id="nx-body"><option value="upper">Overkrop (+2,5 kg)</option><option value="lower">Ben (+5 kg)</option></select></div>
      <div class="field"><label for="nx-eq">Udstyr</label><input id="nx-eq" placeholder="f.eks. Kabel"></div>
    </div>
    <div class="section-header">Primære muskler</div><div class="tag-picks" id="nx-prim">${MUSCLES.map((m) => chipBtn('nxMuscle', m.id, m.label, false, 'data-kind="p"')).join('')}</div>
    <div class="section-header">Sekundære muskler</div><div class="tag-picks" id="nx-sec">${MUSCLES.map((m) => chipBtn('nxMuscle', m.id, m.label, false, 'data-kind="s"')).join('')}</div>
    <div class="section-footer">Bruges til muskelkort og fordeling i Statistik. Primære tæller 1 sæt, sekundære 0,5.</div>`;
  openSheet({ title: 'Ny øvelse', body, footer: `<button class="btn filled block" data-act="exNewSave">${icon('check')}Opret og vælg</button>`, right: `<button class="nav-btn" data-act="exPickerBack">Tilbage</button>`, onMount: () => setTimeout(() => $('#nx-name').focus(), 350) });
}
function saveExerciseNew() {
  const name = $('#nx-name').value.trim();
  if (!name) { toast('Giv øvelsen et navn.'); return; }
  if (allExercises().some((x) => x.name.toLowerCase() === name.toLowerCase())) { openExerciseConfirm(allExercises().find((x) => x.name.toLowerCase() === name.toLowerCase()).name); return; }
  const body = $('#nx-body').value;
  S.put('custom_exercises', {
    id: `cx-${Date.now().toString(36)}`, name, group: $('#nx-group').value, pattern: $('#nx-pattern').value,
    body, step_kg: body === 'lower' ? 5 : 2.5, equipment: $('#nx-eq').value.trim(),
    primary_muscles: $$('#nx-prim [aria-pressed="true"]').map((b) => b.dataset.value),
    secondary_muscles: $$('#nx-sec [aria-pressed="true"]').map((b) => b.dataset.value),
  });
  openExerciseConfirm(name);
}

// ---- Løb ----
function parseTime(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  if (s.includes(':')) return P.parseDuration(s);
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  // "4530" → 45:30, "13005" → 1:30:05
  const sec = Number(digits.slice(-2)), min = Number(digits.slice(-4, -2) || 0), h = Number(digits.slice(0, -4) || 0);
  return h * 3600 + min * 60 + sec;
}
// ---- Justér løbepas, niveau og advarsler ----
function tuneHTML(e) {
  const it = e.item;
  if (!TU || it.kind !== 'run' || it.type === 'race' || it.test || e.date < P.todayISO() || statusOf(e.key) === 'done') return '';
  const o = TU.intensityOptions(it);
  const b = (op, label, off) => `<button class="btn" data-act="tune" data-op="${op}" data-key="${esc(e.key)}" ${off ? 'disabled' : ''}>${label}</button>`;
  const hardLabel = it.type === 'easy' && TU.levelOf(it) == null ? 'Tilføj strides' : o.harder ? `Hårdere: ${o.harder}` : 'Hårdere';
  const easyLabel = it.type === 'easy' && TU.levelOf(it) == null ? 'Fjern strides' : o.easier ? `Lettere: ${o.easier}` : 'Lettere';
  return `<div class="card" style="margin-bottom:14px"><div class="title">Justér passet${it.tuned ? ' <span class="chip">justeret</span>' : ''}</div>
    <div class="meta" style="margin:2px 0 8px">Gælder kun dette pas. Du kan fortryde bagefter.</div>
    <div class="qa-row">${b('km-', '− 1 km', (it.km || 0) - 1 < 3)}${b('km+', '+ 1 km')}</div>
    <div class="qa-row">${b('easier', easyLabel, !o.easier)}${b('harder', hardLabel, !o.harder)}</div>
    ${it.tuned && it.tune_orig ? `<div class="qa-row">${b('reset', 'Tilbage til planen')}</div>` : ''}</div>`;
}
function tuneDo(key, op) {
  const e = entryByKey(key); if (!e) return;
  const before = e.item;
  const next = op === 'km+' ? TU.tweakKm(before, 1) : op === 'km-' ? TU.tweakKm(before, -1) : op === 'harder' ? TU.stepIntensity(before, 1)
    : op === 'easier' ? TU.stepIntensity(before, -1) : TU.resetTune(before);
  if (!next) { toast('Passet kan ikke justeres mere i den retning.'); return; }
  if (!replaceAt(e, next)) return;
  toast(op === 'reset' ? 'Tilbage til planen' : 'Passet er justeret', () => { const e2 = entryByKey(key); if (e2) replaceAt(e2, before); closeSheet(); const e3 = entryByKey(key); if (e3) openSession(key); });
  closeSheet(); const e4 = entryByKey(key); if (e4) openSession(key);
}
function levelState() { if (!ui.lv) ui.lv = { pct: 0, from: P.todayISO() }; return ui.lv; }
function levelPreview() {
  const lv = levelState();
  const { rows } = TU.scaleWeeks(plan.weeks, lv.pct, lv.from);
  const six = rows.slice(0, 6);
  return `<table class="perf"><thead><tr><th>Uge fra</th><th>Nu</th><th>Efter</th><th></th></tr></thead><tbody>${six.map((r) => `<tr><td>${P.fmtDateShort(r.start)}${r.deload ? ' · deload' : ''}</td><td>${fmtNum(r.before)} km</td><td><b>${fmtNum(r.after)} km</b></td><td>${r.held ? '<small>milepæl holdes</small>' : ''}</td></tr>`).join('')}</tbody></table>`;
}
function levelHTML() {
  const lv = levelState();
  const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
  return `<div class="section-header">Niveau for løbeplanen</div><div class="card">
    <div class="meta" style="margin-bottom:8px">Skalerer rolige ture og kvalitetspas fra en valgt dato. Langturen følger med samme procent, men milepælene (20–22 km med 900 hm før 25/2 og 32 km ca. 17/4) holdes.</div>
    <div class="field"><label for="lv-pct">Niveau</label><span class="grow" style="flex:1;text-align:right;font-weight:600" id="lv-val">${sign(lv.pct)} %</span></div>
    <input id="lv-pct" data-lv="pct" type="range" min="-20" max="30" step="5" value="${lv.pct}" style="width:100%" aria-label="Niveau i procent">
    <div class="field"><label for="lv-from">Fra</label><input id="lv-from" data-lv="from" type="date" value="${esc(lv.from)}" min="${esc(P.todayISO())}"></div>
    <div id="lv-prev" style="overflow-x:auto;margin-top:8px">${levelPreview()}</div>
    <div class="btn-row" style="margin-top:12px"><button class="btn filled flex" data-act="lvSave">${icon('check')}Gem niveau</button></div></div>`;
}
function lvSave() {
  const lv = levelState();
  if (!lv.from || lv.from < P.todayISO()) { toast('Vælg en dato fra i dag.'); return; }
  const { mods } = TU.scaleWeeks(plan.weeks, lv.pct, lv.from);
  const ids = [...new Set(Object.keys(mods).map((d) => PL.mondayOf(d)))];
  if (!ids.length) { toast('Ingen pas ændres med det niveau.'); return; }
  const snap = ids.map((id) => [id, S.get('week_edits', id)]);
  editDays(mods, lv.from); recompute();
  toast(`Niveau ${lv.pct > 0 ? '+' : lv.pct < 0 ? '−' : ''}${Math.abs(lv.pct)} % fra ${P.fmtDateShort(lv.from)} er gemt ✓`, () => {
    for (const [id, row] of snap) { if (row && !row.deleted) S.put('week_edits', row); else S.remove('week_edits', id); }
    markPlanChanged(lv.from); recompute(); render();
  }, 9000);
  render();
}
function warningsCard(start) {
  const t = P.todayISO();
  const actualKm = {};
  for (const w of plan.weeks) if (w.days[6].date < t) actualKm[w.start] = w.days.reduce((s, d) => s + loggedKmOn(d.date), 0);
  const list = TU.loadWarnings({ weeks: plan.weeks, today: t, actualKm, span: 6 }).filter((x) => x.start === start);
  return list.length ? `<div class="card adapt-banner" style="margin-bottom:12px"><div class="title">Advarsler</div><ul class="status-reasons" style="margin-top:6px">${list.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul><div class="meta">Det er kun advarsler – du bestemmer selv.</div></div>` : '';
}
document.addEventListener('input', (ev) => {
  const k = ev.target.dataset && ev.target.dataset.lv; if (!k) return;
  const lv = levelState(); lv[k] = k === 'pct' ? Number(ev.target.value) : ev.target.value;
  const v = $('#lv-val'); if (v) v.textContent = `${lv.pct > 0 ? '+' : lv.pct < 0 ? '−' : ''}${Math.abs(lv.pct)} %`;
  const p = $('#lv-prev'); if (p) p.innerHTML = levelPreview();
});
function openRunSheet(e, head, extraId = null) {
  const it = e.item;
  const id = extraId || e.key;
  const manual = S.get('run_logs', id);
  const g = e.extra ? null : garminFor(e);
  let body = head || '';
  if (!e.extra) body += `<div class="card" style="margin-bottom:14px"><div class="session-desc">${esc(it.description)}</div><div class="meta">${fmtNum(it.km)} km · ${esc(P.zoneText(it.zone, config))}${it.elevation_m ? ` · mål ${fmtElev(it.elevation_m)}` : ''}</div>${runTypeChips(it)}</div>`;
  if (!e.extra) body += tuneHTML(e);
  if (g) body += garminDetailHTML(g, e, manual);
  if (!e.extra && e.date <= P.todayISO()) body += runDataButton();
  const v = manual || {};
  body += `<div class="group">
    ${e.extra ? `<div class="field"><label for="r-date">Dato</label><input id="r-date" type="date" value="${v.date || e.date}"></div>` : ''}
    <div class="field"><label for="r-km">Distance</label><input id="r-km" inputmode="decimal" placeholder="${g ? fmtNum(g.km) : fmtNum(it.km)}" value="${v.km != null ? String(v.km).replace('.', ',') : ''}"><span class="suffix">km</span></div>
    <div class="field"><label for="r-time">Tid</label><input id="r-time" inputmode="numeric" placeholder="${g ? P.fmtDuration(g.duration_sec) : 'f.eks. 3200 = 32:00'}" value="${v.time_sec ? P.fmtDuration(v.time_sec) : ''}"></div>
    <div class="field"><label>Tempo</label><span class="grow" style="flex:1;text-align:right;font-weight:600" id="r-pace">–</span></div>
    <div class="field"><label for="r-hr">Gns. puls</label><input id="r-hr" inputmode="numeric" placeholder="${g && g.avg_hr ? g.avg_hr : 'bpm'}" value="${v.hr ?? ''}"><span class="suffix">bpm</span></div>
    ${it.test === '5k' ? `<div class="field test-field"><label for="r-test">Tid for de 5 km</label><input id="r-test" inputmode="numeric" placeholder="f.eks. 2230 = 22:30" value="${v.test_time_sec ? P.fmtDuration(v.test_time_sec) : ''}"></div>` : ''}
    <div class="field"><label for="r-elev">Højdemeter</label><input id="r-elev" inputmode="numeric" placeholder="${g && g.elev_gain ? Math.round(g.elev_gain) : it.elevation_m ? `mål ${it.elevation_m}` : 'm op'}" value="${v.elev ?? ''}"><span class="suffix">m op</span></div>
    <div class="field"><label for="r-rpe">RPE</label><span style="flex:1;display:flex;justify-content:flex-end">${stepper('r-rpe', v.rpe ?? '', '1–10', 1, 'RPE', 'inputmode="numeric"')}</span></div>
    <div class="field stack"><label for="r-note">Note</label><textarea id="r-note" placeholder="Hvordan føltes det?">${esc(v.note || '')}</textarea></div>
  </div>
  <button class="btn filled block" style="margin-top:14px" data-act="saveRun" data-id="${esc(id)}">${icon('check')}Gem løb</button>
  ${manual ? `<button class="btn danger block" style="margin-top:8px" data-act="deleteRun" data-id="${esc(id)}">${icon('trash')}Slet min log</button>` : ''}`;
  if (!e.extra) body += statusButtons(e);
  openSheet({
    title: e.extra ? 'Ekstra løbetur' : P.itemTitle(plan, e), body,
    onMount: (root) => {
      const upd = () => {
        const km = num($('#r-km').value) ?? (g ? g.km : null), t = parseTime($('#r-time').value) ?? (g ? g.duration_sec : null);
        $('#r-pace').textContent = km && t ? `${P.fmtPace(t / km)} /km` : '–';
      };
      root.addEventListener('input', upd);
      $('#r-time').addEventListener('blur', () => { const t = parseTime($('#r-time').value); if (t) $('#r-time').value = P.fmtDuration(t); upd(); });
      upd();
    },
  });
  $('#sheetBody').dataset.key = e.key;
  $('#sheetBody').dataset.extra = e.extra ? '1' : '';
}
function saveRun(id) {
  const key = $('#sheetBody').dataset.key;
  const extra = $('#sheetBody').dataset.extra === '1';
  const e = extra ? null : entryByKey(key);
  const km = num($('#r-km').value), t = parseTime($('#r-time').value);
  if (km == null && t == null && !$('#r-note').value.trim()) { toast('Skriv mindst distance eller tid.'); return; }
  const rpe = num($('#r-rpe').value);
  S.put('run_logs', {
    id, item_key: extra ? null : key, date: extra ? ($('#r-date').value || P.todayISO()) : e.date,
    km, time_sec: t, hr: num($('#r-hr').value), elev: num($('#r-elev').value),
    rpe: rpe == null ? null : Math.max(1, Math.min(10, rpe)),
    note: $('#r-note').value.trim(), source: 'manual',
  });
  if (e && !statusOf(e.key)) setStatus(e, 'done', { toggle: false });
  // 5 km-test: foreslå marathonmål og tempoer
  const testSec = $('#r-test') ? parseTime($('#r-test').value) : null;
  if (e && e.item.test === '5k' && testSec) {
    const row = S.get('run_logs', id);
    S.put('run_logs', { ...row, note: [row.note, `5 km-test: ${P.fmtDuration(testSec)}`].filter(Boolean).join(' · ') });
    openPaceProposal(testSec, e.date);
    return;
  }
  toast('Løb gemt ✓');
  closeSheet();
}

// ---------- Marathonmål efter 5 km-testen ----------
// Riegels formel: T2 = T1 × (D2/D1)^1,06. Første marathon: +4 % som sikkert forslag.
function paceFromMarathon(sec) {
  const mp = sec / 42.195;
  const r = (x) => P.fmtPace(Math.round(x / 5) * 5);
  return { mp: r(mp), threshold: r(mp - 20), easy: `${r(mp + 60)}-${r(mp + 75)}` };
}
function openPaceProposal(testSec, date) {
  const riegel = testSec * Math.pow(42.195 / 5, 1.06);
  const options = [
    { id: 'safe', label: 'Sikkert (anbefalet til første marathon)', sec: Math.round((riegel * 1.04) / 60) * 60 },
    { id: 'ambitious', label: 'Ambitiøst (ren beregning)', sec: Math.round(riegel / 60) * 60 },
  ];
  const card = (o, i) => {
    const pc = paceFromMarathon(o.sec);
    return `<label class="row pace-option"><input type="radio" name="pace-opt" value="${i}" ${i === 0 ? 'checked' : ''}>
      <span class="grow"><span class="title">${esc(o.label)}</span><span class="pace-goal">${P.fmtDuration(o.sec)}</span>
      <span class="meta" style="display:block">MP ${pc.mp}/km · tærskel ${pc.threshold}/km · rolig ${pc.easy.replace('-', '–')}/km</span></span></label>`;
  };
  openSheet({
    title: 'Dit marathonmål',
    body: `<div class="card" style="margin:4px 0 14px"><h3>5 km på ${P.fmtDuration(testSec)} 🎉</h3><div class="meta">${P.fmtPace(testSec / 5)}/km. Ud fra testen foreslår appen et marathonmål og dine tempoer til resten af planen.</div></div>
      <div class="group" id="pace-opts">${options.map(card).join('')}</div>
      <div class="section-footer">Tempoerne bruges på dine pas, i kalenderen og på uret. Pulszonerne gælder stadig – især på varme dage og i bakker.</div>
      <button class="btn filled block" style="margin-top:14px" data-act="paceSave">${icon('check')}Brug disse tal</button>
      <button class="btn block" style="margin-top:8px" data-act="closeSheet">Ikke nu</button>`,
  });
  $('#sheetBody').dataset.pace = JSON.stringify({ options, testSec, date });
}
function openExtraRun(id) {
  const existing = id ? S.get('run_logs', id) : null;
  const newId = id || `extra-${Date.now().toString(36)}`;
  const e = { key: newId, date: existing ? existing.date : P.todayISO(), item: { kind: 'run', type: 'easy', km: null, description: 'Ekstra løbetur' }, extra: true };
  openRunSheet(e, '', newId);
}

// ---- Flyt pas ----
function defaultDate(e) { return baseDates.get(e.key); }
function doMove(e, to) {
  const prevOv = S.get('overrides', e.key);
  if (to === defaultDate(e)) S.remove('overrides', e.key);
  else S.put('overrides', { id: e.key, item_key: e.key, from_date: e.origDate, item_index: e.idx, to_date: to });
  const st = S.get('session_status', e.key);
  if (st) S.put('session_status', { ...st, date: to });
  toast(`Flyttet til ${P.fmtWeekday(to)} ${P.fmtDateShort(to)}`, () => {
    if (prevOv) S.put('overrides', { ...prevOv, deleted: false }); else S.remove('overrides', e.key);
  });
}
function openMove(key, presetDate) {
  const e = entryByKey(key);
  if (!e) return;
  const chips = [-2, -1, 1, 2, 3].map((n) => {
    const d = P.addDays(e.date, n);
    return `<button class="btn" data-act="pickDate" data-date="${d}">${n > 0 ? '+' : ''}${n} · ${P.fmtWeekday(d)}</button>`;
  }).join('');
  const body = `<div class="card" style="margin:4px 0 14px"><div class="session-head">${kindIcon(e.item)}<div><h3>${esc(P.itemTitle(plan, e))}</h3><div class="meta">Nu: ${P.fmtDateLong(e.date)}${e.moved ? ` · planlagt ${P.fmtDateShort(defaultDate(e))}` : ''}</div></div></div></div>
    <div class="group"><div class="field"><label for="mv-date">Ny dato</label><input id="mv-date" type="date" value="${presetDate || e.date}"></div></div>
    <div class="btn-row" style="margin-top:10px">${chips}</div>
    <div id="mv-warn" style="margin-top:14px"></div>
    <button class="btn filled block" style="margin-top:14px" id="mv-go" data-act="doMove" data-key="${key}">Flyt</button>
    ${e.moved ? `<button class="btn block" style="margin-top:8px" data-act="resetMove" data-key="${key}">Tilbage til planens dato (${P.fmtDateShort(defaultDate(e))})</button>` : ''}`;
  openSheet({
    title: 'Flyt pas', body,
    onMount: () => {
      const upd = () => {
        const to = $('#mv-date').value;
        const warns = to && to !== e.date ? P.moveWarnings(plan, overridesMap(), key, to) : [];
        $('#mv-warn').innerHTML = warns.map((w) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(w)}</span></div>`).join('');
        const btn = $('#mv-go');
        btn.disabled = !to || to === e.date;
        btn.textContent = warns.length ? 'Flyt alligevel' : to && to !== e.date ? `Flyt til ${P.fmtWeekday(to)} ${P.fmtDateShort(to)}` : 'Vælg en ny dato';
      };
      $('#mv-date').addEventListener('input', upd);
      $('#mv-date').addEventListener('change', upd);
      upd();
    },
  });
}

// ---- Mål ----
function openGoal(id, { preset } = {}) {
  const g = id ? S.get('goals', id) : null;
  const st = goalStatuses();
  const v = { name: '', category: '', status: st[0], event: '', date: '', note: '', result: '', completed_date: '', linked_to_plan: false, ...(g || {}), ...(preset || {}) };
  const body = `<div class="group" style="margin-top:6px">
      <div class="field"><label for="g-name">Navn</label><input id="g-name" value="${esc(v.name)}" placeholder="f.eks. Hyrox"></div>
      <div class="field"><label for="g-cat">Kategori</label><input id="g-cat" value="${esc(v.category)}" placeholder="Løb, Hybrid …"></div>
      <div class="field"><label for="g-event">Event</label><input id="g-event" value="${esc(v.event || '')}" placeholder="Navn på løb/event"></div>
      <div class="field"><label for="g-date">Dato</label><input id="g-date" type="date" value="${esc(v.date || '')}"></div>
    </div>
    <div class="section-header">Status</div>
    <div class="seg" id="g-status" role="group">${st.map((s) => `<button type="button" data-status="${esc(s)}" aria-pressed="${s === v.status}">${esc(s)}</button>`).join('')}</div>
    <div class="group" id="g-done" ${v.status === st[st.length - 1] ? '' : 'hidden'}>
      <div class="field"><label for="g-result">Resultat</label><input id="g-result" value="${esc(v.result || '')}" placeholder="Tid, f.eks. 3:42:10"></div>
      <div class="field"><label for="g-cdate">Gennemført</label><input id="g-cdate" type="date" value="${esc(v.completed_date || (v.status === st[st.length - 1] ? P.todayISO() : ''))}"></div>
    </div>
    <div class="group" style="margin-top:14px">
      <label class="row"><span class="grow">Vis fremskridt fra træningsplanen</span><span class="switch"><input type="checkbox" id="g-linked" ${v.linked_to_plan ? 'checked' : ''}><span></span></span></label>
      <div class="field stack"><label for="g-note">Note</label><textarea id="g-note" placeholder="Noter, link, krav …">${esc(v.note || '')}</textarea></div>
    </div>
    <button class="btn filled block" style="margin-top:14px" data-act="saveGoal" data-id="${esc(id || '')}">${icon('check')}Gem</button>
    ${g ? `<button class="btn danger block" style="margin-top:8px" data-act="goalDel" data-id="${esc(id)}">${icon('trash')}Slet mål</button>` : ''}`;
  openSheet({
    title: g ? g.name : 'Nyt mål', body,
    onMount: (root) => {
      $('#g-status', root).addEventListener('click', (ev) => {
        const b = ev.target.closest('button'); if (!b) return;
        $$('#g-status button', root).forEach((x) => x.setAttribute('aria-pressed', x === b));
        const isDone = b.dataset.status === st[st.length - 1];
        $('#g-done', root).hidden = !isDone;
        if (isDone && !$('#g-cdate', root).value) $('#g-cdate', root).value = P.todayISO();
      });
      if (preset && preset.status === st[st.length - 1]) setTimeout(() => $('#g-result', root).focus(), 350);
    },
  });
}
function saveGoal(id) {
  const name = $('#g-name').value.trim();
  if (!name) { toast('Giv målet et navn.'); return; }
  const status = ($('#g-status button[aria-pressed="true"]') || {}).dataset?.status || goalStatuses()[0];
  const existing = id ? S.get('goals', id) : null;
  const all = S.all('goals');
  const isDone = status === DONE();
  S.put('goals', {
    ...(existing || {}),
    id: id || `g-${Date.now().toString(36)}`, name, category: $('#g-cat').value.trim(), status,
    event: $('#g-event').value.trim() || null, date: $('#g-date').value || null, note: $('#g-note').value.trim(),
    linked_to_plan: $('#g-linked').checked,
    result: isDone ? $('#g-result').value.trim() || null : existing?.result ?? null,
    completed_date: isDone ? $('#g-cdate').value || P.todayISO() : null,
    sort: existing ? existing.sort : Math.max(-1, ...all.map((g) => g.sort ?? 0)) + 1,
  });
  toast(isDone ? 'Tillykke – mål opnået! 🎉' : 'Mål gemt');
  closeSheet();
}
function moveGoal(id, dir) {
  const active = sortedGoals().filter((g) => g.status !== DONE());
  const i = active.findIndex((g) => g.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= active.length) return;
  [active[i], active[j]] = [active[j], active[i]];
  active.forEach((g, k) => { if (g.sort !== k) S.put('goals', { ...g, sort: k }); });
}

// ======================= Toast =======================
let toastTimer;
function toast(text, undo, ms) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button class="btn" id="toastUndo">Fortryd</button>' : ''}`;
  t.classList.add('show');
  if (undo) $('#toastUndo').onclick = () => { undo(); t.classList.remove('show'); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms || (undo ? 5000 : 2200));
}

// ======================= Opdater (knap på Mac, træk ned på iPhone) =======================
let refreshing = false, reloadingForUpdate = false;
async function refreshApp() {
  if (refreshing) return;
  refreshing = true;
  document.body.classList.add('is-refreshing');
  try {
    // 1) Er der en ny version af appen? (service workeren overtager selv; så genindlæses siden)
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && navigator.onLine) {
      await Promise.race([reg.update(), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});
      // Er en ny version ved at blive installeret, så vent på den (op til 10 sek.); siden genindlæses, når den tager over
      const w = reg.installing || reg.waiting;
      if (w && w.state !== 'activated') {
        await new Promise((res) => { const t = setTimeout(res, 10000); w.addEventListener('statechange', () => { if (w.state === 'activated') { clearTimeout(t); res(); } }); });
      }
      await new Promise((r) => setTimeout(r, 400));
      if (reloadingForUpdate) return;
    }
    // 2) Hent nyeste data fra Supabase og planen
    await Sync.syncNow();
    try {
      const [p2, c2] = await Promise.all([loadJSON('data/plan.json'), loadJSON('data/config.json')]);
      basePlan = p2; effKey = null; baseConfig = c2;
      baseDates = new Map(P.buildSchedule(plan, {}).entries.map((e) => [e.key, e.date]));
    } catch { /* offline: behold den gemte plan */ }
    render();
    toast(navigator.onLine ? 'Opdateret ✓' : 'Offline – viser gemte data');
  } finally {
    refreshing = false;
    document.body.classList.remove('is-refreshing');
  }
}
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || reloadingForUpdate) return;
    if (woOpen()) { toast('Ny version klar – åbn appen igen efter passet'); return; }
    reloadingForUpdate = true; location.reload();
  });
}

// Arket følger det synlige område, når tastaturet åbner/lukker, og siden bliver ikke hængende forskudt
(() => {
  const vv = window.visualViewport;
  // Tastaturet regnes som åbent, når det synlige område er mærkbart lavere end vinduet
  const kbOpen = () => vv && window.innerHeight - vv.height > 80;
  const fit = () => {
    const sh = $('#sheet'), w = $('#workout');
    if (!vv || !sh) return;
    const kb = kbOpen();
    if (sheetIsOpen() && !desktop.matches && kb) {
      sh.style.bottom = `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px`;
      sh.style.maxHeight = `${Math.max(260, Math.round(vv.height - 16))}px`;
    } else { sh.style.bottom = ''; sh.style.maxHeight = ''; }
    // Pas i fuld skærm: kun mens tastaturet er åbent følger det det synlige område; ellers fylder det hele skærmen
    if (w) {
      if (!w.hidden && !desktop.matches && kb) { w.style.top = `${Math.round(vv.offsetTop)}px`; w.style.bottom = 'auto'; w.style.height = `${Math.round(vv.height)}px`; }
      else { w.style.top = ''; w.style.bottom = ''; w.style.height = ''; }
    }
  };
  const settle = () => {
    // tastaturet er lukket: nulstil forskydning, så siden ikke hænger løftet
    if (!kbOpen() && (window.scrollY !== 0 || (vv && vv.offsetTop !== 0)) && (woOpen() || sheetIsOpen() || document.body.classList.contains('in-workout'))) window.scrollTo(0, 0);
    else if (vv && !kbOpen() && vv.offsetTop > 0) window.scrollTo(0, Math.max(0, window.scrollY));
    fit();
  };
  if (vv) { vv.addEventListener('resize', settle); vv.addEventListener('scroll', fit); }
  document.addEventListener('focusout', () => [120, 350, 700].forEach((ms) => setTimeout(() => { if (!document.activeElement || !document.activeElement.matches('input, textarea, select')) { settle(); if (ms === 120) flushPending(); } }, ms)));
  ['pageshow', 'orientationchange', 'visibilitychange'].forEach((t) => (t === 'visibilitychange' ? document : window).addEventListener(t, () => setTimeout(settle, 150)));
  new MutationObserver(fit).observe($('#sheet'), { attributes: true, attributeFilter: ['class', 'hidden'] });
  new MutationObserver(fit).observe($('#workout'), { attributes: true, attributeFilter: ['hidden'] });
  // et felt i passet skal altid kunne ses over tastaturet
  document.addEventListener('focusin', (ev) => {
    const el = ev.target;
    if (!woOpen() || !el.closest || !el.closest('#woBody') || !el.matches('input, select, textarea')) return;
    setTimeout(() => { fit(); try { el.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch { /* ældre browsere */ } }, 300);
  });
})();

// Tryk i et talfelt markerer hele tallet, så det man skriver erstatter det (iOS kræver et lille delay)
document.addEventListener('focusin', (ev) => {
  const el = ev.target;
  if (el.matches && el.matches('.stepper input, .field input[inputmode], [data-tune="reps"]')) setTimeout(() => { try { el.select(); el.setSelectionRange(0, 99); } catch { /* ikke understøttet */ } }, 30);
});

// Et åbent ark (eller pas i fuld skærm) må aldrig trække siden bagved med: stop træk, som ikke kan rulle arkets eget indhold
(() => {
  let y = 0;
  document.addEventListener('touchstart', (ev) => { y = ev.touches[0].clientY; }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (ev.touches.length !== 1) return;
    const sheetOpen = $('#sheet') && $('#sheet').classList.contains('open');
    if (!sheetOpen && !woOpen()) return;
    if (ev.target.closest('input[type="range"], .rest-dock')) return;
    const box = ev.target.closest(sheetOpen ? '#sheetBody' : '#woBody');
    const dy = ev.touches[0].clientY - y;
    if (!box) { if (ev.cancelable) ev.preventDefault(); return; } // udenfor indholdet: baggrunden, fodlinjen osv.
    const canScroll = box.scrollHeight > box.clientHeight + 1;
    const atTop = box.scrollTop <= 0, atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    if (!canScroll || (atTop && dy > 0) || (atBottom && dy < 0)) { if (ev.cancelable) ev.preventDefault(); }
  }, { passive: false });
})();

// Træk ned i toppen af siden (kun på touch), som i andre apps
(() => {
  const THRESH = 70;
  let y0 = null, pull = 0;
  const ind = () => $('#ptr');
  const blocked = () => window.scrollY > 0 || woOpen() || $('#sheet').classList.contains('open');
  document.addEventListener('touchstart', (ev) => {
    if (ev.touches.length !== 1 || blocked() || ev.target.closest('input, textarea, select, .sheet, .swipe')) { y0 = null; return; }
    y0 = ev.touches[0].clientY; pull = 0;
  }, { passive: true });
  document.addEventListener('touchmove', (ev) => {
    if (y0 == null) return;
    pull = Math.max(0, ev.touches[0].clientY - y0);
    if (window.scrollY > 0) { y0 = null; setPtr(0); return; }
    setPtr(pull);
  }, { passive: true });
  const end = () => {
    if (y0 == null) return;
    const go = pull >= THRESH; y0 = null; pull = 0; setPtr(0, go);
    if (go) refreshApp();
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', () => { y0 = null; setPtr(0); }, { passive: true });
  function setPtr(d, spin) {
    const el = ind(); if (!el) return;
    const h = Math.min(d, 110) * 0.6;
    el.style.setProperty('--pull', h + 'px');
    el.classList.toggle('ready', d >= THRESH);
    el.classList.toggle('show', d > 8 || !!spin);
    el.style.transform = `translate(-50%, ${spin ? 56 : Math.max(0, h) - 20}px) rotate(${Math.min(d, 110) * 3}deg)`;
  }
})();

// ======================= Swipe på rækker =======================
let swipeMoved = false;
(function swipeRows() {
  let cur = null;
  const closeAll = (except) => $$('.swipe.open').forEach((s) => { if (s !== except) { s.classList.remove('open'); s.querySelector(':scope > .row').style.transform = ''; } });
  document.addEventListener('pointerdown', (ev) => {
    const row = ev.target.closest('.swipe > .row');
    if (!row || ev.pointerType === 'mouse' && finePointer.matches && row.draggable) { if (!ev.target.closest('.swipe .actions')) closeAll(); return; }
    const wrap = row.parentElement;
    closeAll(wrap);
    const w = wrap.querySelector('.actions').offsetWidth;
    cur = { row, wrap, x0: ev.clientX, y0: ev.clientY, base: wrap.classList.contains('open') ? -w : 0, w, dx: 0, active: false };
    swipeMoved = false;
  });
  document.addEventListener('pointermove', (ev) => {
    if (!cur) return;
    const dx = ev.clientX - cur.x0, dy = ev.clientY - cur.y0;
    if (!cur.active) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { cur = null; return; }
      if (Math.abs(dx) < 10) return;
      cur.active = true; swipeMoved = true; cur.wrap.classList.add('dragging');
    }
    cur.dx = dx;
    const x = Math.min(0, Math.max(-cur.w - 30, cur.base + dx));
    cur.row.style.transform = `translateX(${x}px)`;
  });
  const end = () => {
    if (!cur) return;
    const { wrap, row, base, dx, w, active } = cur;
    wrap.classList.remove('dragging');
    if (active) {
      const open = base + dx < -w / 2;
      wrap.classList.toggle('open', open);
      row.style.transform = open ? `translateX(${-w}px)` : '';
    }
    cur = null;
    setTimeout(() => { swipeMoved = false; }, 0);
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
})();

// ======================= Træk og slip (Mac) =======================
document.addEventListener('dragstart', (ev) => {
  const el = ev.target.closest('[data-drag]');
  if (!el) return;
  ev.dataTransfer.setData('text/plain', el.dataset.drag);
  ev.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (ev) => {
  const t = ev.target.closest('[data-drop-date]');
  if (!t) return;
  ev.preventDefault();
  $$('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  const group = t.classList.contains('group') ? t : t.nextElementSibling;
  if (group) group.classList.add('drop-target');
});
document.addEventListener('dragleave', (ev) => { if (!ev.relatedTarget || !ev.relatedTarget.closest?.('[data-drop-date]')) $$('.drop-target').forEach((x) => x.classList.remove('drop-target')); });
document.addEventListener('drop', (ev) => {
  const t = ev.target.closest('[data-drop-date]');
  $$('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  if (!t) return;
  ev.preventDefault();
  const key = ev.dataTransfer.getData('text/plain');
  const e = entryByKey(key);
  const to = t.dataset.dropDate;
  if (!e || to === e.date) return;
  const warns = P.moveWarnings(plan, overridesMap(), key, to);
  if (warns.length) openMove(key, to);
  else doMove(e, to);
});

// ======================= Klik og input =======================
const actions = {
  tab: (d) => go(d.tab),
  sub: (d) => {
    if (d.sub === 'programs') { ui.planView = 'programs'; ui.pg = { id: null, sid: null }; ui.rp = { id: null }; ui.rs = null; }
    else if (d.sub === 'hybrid') { ui.planView = 'hybrid'; ui.rs = null; }
    else if (d.sub === 'versions') { ui.planView = 'versions'; ui.rs = null; }
    else if (d.sub === 'plan' && ui.sub !== 'plan') { ui.planView = 'main'; ui.rs = null; }
    go('more', d.sub);
  },
  back: () => go('more'),
  open: (d) => openSession(d.key),
  move: (d) => openMove(d.key),
  status: (d) => {
    const e = entryByKey(d.key);
    if (!e) return;
    setStatus(e, d.status);
    if (d.insheet) closeSheet();
  },
  week: (d) => {
    const dir = Number(d.dir);
    if (dir === 0) ui.weekStart = currentWeekStart();
    else {
      const i = plan.weeks.findIndex((w) => w.start === (ui.weekStart || currentWeekStart()));
      const n = plan.weeks[Math.max(0, Math.min(plan.weeks.length - 1, i + dir))];
      ui.weekStart = n.start;
    }
    render();
  },
  seg: (d) => {
    if (d.group === 'weType') { weSetType(d.value); return; }
    if (d.group === 'wePer') { weSetPer(d.value); return; }
    if (d.group === 'rsPer') { ui.rs.perWeek = d.value; render(); return; }
    if (d.group === 'woScope') { wo.scope = d.value; $$('.wo-scope [data-group="woScope"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === d.value))); return; }
    if (d.group === 'pgTab') { ui.pgTab = d.value; ui.rp = { id: null }; ui.pg = { id: null, sid: null }; render(); return; }
    if (d.group === 'pgLeg') { pgMut((p) => { p.leg_volume = d.value; }); return; }
    if (d.group === 'pgAdapt') { pgMut((p) => { p.adapt_weeks = Number(d.value); }); return; }
    if (d.group === 'pgKind') { pgMut((p) => { const s = p.sessions.find((x) => x.id === ui.pg.sid); if (s) s.kind = d.value; }); return; }
    if (d.group === 'pgSessLeg') { pgMut((p) => { const s = p.sessions.find((x) => x.id === ui.pg.sid); if (s) s.leg_volume = d.value; }); return; }
    if (d.group === 'rsMode') { ui.rs.mode = d.value; ui.rs.result = runGenerate(ui.rs); render(); return; }
    if (d.group === 'pauseWeeks') { ui.pauseWeeks = d.value; const info = pauseInfo(); if (info) $('#sheetBody').innerHTML = PU.pauseSheetHTML({ ...info, weights: 0 }, d.value); return; }
    ui[d.group] = d.value;
    if (d.group === 'statRange') ui.statBar = null;
    if (d.group === 'statSec' && d.value !== 'exercises') ui.statEx = null;
    render();
  },
  statSession: (d) => openPassDetail(d.key),
  pdShare: () => shareSummary(),
  muscle: (d) => { ui.statMuscle = ui.statMuscle === d.m ? null : d.m; render(); },
  statEx: (d) => { ui.statEx = d.name; ui.statExTab = 'about'; render(); window.scrollTo(0, 0); },
  statExBack: () => { ui.statEx = null; render(); },
  statMonth: (d) => {
    const [y, m] = (ui.statMonth || P.todayISO().slice(0, 7)).split('-').map(Number);
    const dt = new Date(y, m - 1 + Number(d.d), 1);
    ui.statMonth = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; render();
  },
  statBar: (d) => { ui.statBar = Number(d.i); render(); },
  extraRun: (d) => openExtraRun(d.id),
  saveRun: (d) => saveRun(d.id),
  deleteRun: (d) => { S.remove('run_logs', d.id); toast('Log slettet'); closeSheet(); },
  closeSheet: () => closeSheet(),
  setCount: (d) => setCount(d.slot, Number(d.d)),
  exMove: (d) => { const e = entryByKey(wo.key); if (!e) return; const i = exList(e).findIndex((x) => x.slot === d.slot); moveEx(d.slot, i + Number(d.dir)); },
  exHandle: () => {},
  pickF: (d) => pickFilterToggle(d.k, d.v),
  ownAdd: (d) => openOwnAdd(d.date || null),
  ownSet: (d) => ownSetValue(d.k, d.v),
  ownSugDel: (d) => { ui.own.sug.splice(Number(d.i), 1); ownRender(); },
  ownSave: () => ownSave(),
  ownEdit: (d) => { closeSheet(); setTimeout(() => openOwnEdit(d.id), 50); },
  ownDelete: (d) => ownDelete(d.id),
  saveTpl: (d) => { const e = entryByKey(d.key); if (e) saveTemplate(e); },
  pgSessionFromTpl: () => openTplPicker(),
  pgTplPick: (d) => pgFromTemplate(d.id),
  step: (d) => {
    const inp = document.getElementById(d.target);
    const delta = Number(d.delta);
    let v = num(inp.value);
    // Første tryk på et tomt felt bruger forslaget (sidste gang / forrige sæt / planen)
    if (v == null) {
      const base = num(inp.placeholder);
      v = base != null ? base : delta > 0 ? delta : 0;
    } else v += delta;
    v = Math.max(0, Math.round(v * 100) / 100);
    if (d.target === 'r-rpe') v = Math.max(1, Math.min(10, v || 1));
    inp.value = String(v).replace('.', ',');
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  },
  pickDate: (d) => { const i = $('#mv-date'); i.value = d.date; i.dispatchEvent(new Event('input')); },
  doMove: (d) => { const e = entryByKey(d.key); const to = $('#mv-date').value; if (e && to) { closeSheet(); doMove(e, to); } },
  resetMove: (d) => { const e = entryByKey(d.key); if (e) { closeSheet(); doMove(e, defaultDate(e)); } },
  swap: (d) => {
    const a = entryByKey(d.a), b = entryByKey(d.b);
    if (!a || !b) return;
    const da = a.date, db = b.date;
    S.put('overrides', { id: a.key, item_key: a.key, from_date: a.origDate, item_index: a.idx, to_date: db });
    S.put('overrides', { id: b.key, item_key: b.key, from_date: b.origDate, item_index: b.idx, to_date: da });
    toast('Pas byttet', () => { [a, b].forEach((x) => (x.moved ? S.put('overrides', { id: x.key, item_key: x.key, from_date: x.origDate, item_index: x.idx, to_date: x.date }) : S.remove('overrides', x.key))); });
  },
  export: () => {
    const blob = new Blob([S.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `traeningsplan-backup-${P.todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup gemt');
  },
  goal: (d) => openGoal(d.id),
  goalNew: () => openGoal(null),
  goalDone: (d) => openGoal(d.id, { preset: { status: DONE() } }),
  goalDel: (d) => {
    const g = S.get('goals', d.id);
    if (!g || !confirm(`Slet målet "${g.name}"?`)) return;
    S.remove('goals', d.id);
    closeSheet();
    toast('Mål slettet', () => S.put('goals', { ...g, deleted: false }));
  },
  goalMove: (d) => moveGoal(d.id, Number(d.dir)),
  goalEditToggle: () => { ui.goalEdit = !ui.goalEdit; render(); },
  paceSave: () => {
    const { options, testSec, date } = JSON.parse($('#sheetBody').dataset.pace || '{}');
    const i = Number((document.querySelector('#pace-opts input:checked') || {}).value || 0);
    const o = options[i];
    S.put('settings', { id: 'pace', value: {
      marathon_goal_time: P.fmtDuration(o.sec), paces: paceFromMarathon(o.sec),
      from_test: { date, time_5k_sec: testSec, choice: o.id }, confirmed_at: new Date().toISOString(),
    } });
    toast(`Marathonmål ${P.fmtDuration(o.sec)} gemt ✓`);
    closeSheet();
  },
  // Styrke: bekræft startvægt, din egen næste-gang-vægt, pause-ur
  startOk: (d) => {
    const cur = S.get('exercise_settings', d.name) || { id: d.name };
    S.put('exercise_settings', { ...cur, start_confirmed: true });
    toast('Startvægt bekræftet ✓'); renderWorkoutBody();
  },
  nextEdit: (d) => { ui.editNext = ui.editNext === d.name ? null : d.name; renderWorkoutBody(); },
  nextSave: (d) => {
    const kg = num(($('#next-kg') || {}).value);
    if (kg == null) { toast('Skriv en vægt.'); return; }
    const cur = S.get('exercise_settings', d.name) || { id: d.name };
    S.put('exercise_settings', { ...cur, next_kg: kg, next_set_on: P.todayISO(), start_confirmed: true });
    ui.editNext = null; toast(`Næste gang: ${T.fmtKg(kg)} kg`); renderWorkoutBody();
  },
  nextReset: (d) => {
    const cur = S.get('exercise_settings', d.name);
    if (cur) S.put('exercise_settings', { ...cur, next_kg: null, next_set_on: null });
    ui.editNext = null; renderWorkoutBody();
  },
  // Pas-visning: ✓ pr. sæt, afslut, luk, spring over
  setDone: (d) => toggleSet(d.slot, Number(d.n)),
  woClose: () => closeWorkout(),
  woFinish: () => openSummary(),
  woDone: () => finishWorkout(),
  woSkip: () => {
    const e = entryByKey(wo.key);
    if (!e || !confirm('Spring passet over?')) return;
    setStatus(e, 'skipped', { toggle: false }); closeWorkout(); toast('Pas sprunget over');
  },
  // Pause-ur
  restAdd: (d) => {
    if (!rest) return;
    const sec = Number(d.sec);
    rest.end += sec * 1000; rest.total = Math.max(5, rest.total + sec);
    if (rest.end > Date.now()) { rest.done = false; rest.warned = rest.end - Date.now() <= 10000; }
    pushRest();
    tickRest();
  },
  restStop: () => stopRest(),
  restSound: () => {
    const next = Audio.cycleSound();
    toast({ beep: 'Lyd: bip', speech: 'Lyd: bip og stemme ("Næste sæt")', off: 'Lyd: slukket' }[next]);
  },
  // Pause pr. øvelse: ét tryk skifter til næste pause (60 s → 90 s → 2:00 → 2:30 → 3:00 → 4:00 → standard) og husker den
  restCycle: (d) => {
    const ctx = strengthCtx();
    const nxt = T.nextRest(T.hasOwnRest(ctx, d.name) ? T.restSeconds(ctx, d.name) : null);
    const row = S.get('exercise_settings', d.name) || { id: d.name };
    S.put('exercise_settings', { ...row, rest_sec: nxt });
    renderWorkoutBody();
    toast(nxt ? `Pause for ${d.name}: ${T.fmtRest(nxt)}` : `Pause for ${d.name}: standard`);
  },
  // Løbetype → åbn forklaringen under Zoner og tempo
  runType: (d) => {
    ui.openRunType = d.id;
    const fromSheet = !$('#sheet').hidden;
    if (fromSheet) closeSheet();
    go('more', 'zones');
    // Vent til arket er lukket (animation), så scrollet ikke bliver nulstillet
    setTimeout(() => {
      const el = document.getElementById(`rt-${d.id}`);
      if (el) { el.open = true; el.scrollIntoView({ block: 'start' }); }
    }, fromSheet ? 380 : 30);
  },
  // Garmin Connect: Mac → hjemmesiden i ny fane. iPhone → prøv appen (gcm-ciq://), ellers Garmins
  // universelle link, der åbner appen hvis den er installeret – og ellers hjemmesiden.
  // (Restitution henter selv frisk data, når siden åbnes – se go())
  openGarmin: () => {
    if (!isIOS) { window.open('https://connect.garmin.com/modern/', '_blank', 'noopener'); return; }
    let left = false;
    const onHide = () => { if (document.hidden) left = true; };
    document.addEventListener('visibilitychange', onHide);
    window.location.href = 'gcm-ciq://';
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (!left && !document.hidden) window.location.href = 'https://connect.garmin.com/modern/home';
    }, 1500);
  },
  // Konto og synkronisering
  signIn: () => doLogin('signin'),
  signUp: () => doLogin('signup'),
  loginMode: () => { login.mode = login.mode === 'signup' ? 'signin' : 'signup'; login.error = ''; render(); },
  signOut: async () => {
    if (!confirm('Log ud på denne enhed? Dine data bliver liggende i Supabase.')) return;
    await Sync.signOut(); render();
  },
  syncNow: () => Sync.syncNow(),
  errCopy: async () => { try { await navigator.clipboard.writeText(Diag.asText()); toast('Log kopieret'); } catch { toast('Kunne ikke kopiere – markér teksten manuelt.'); } },
  errClear: () => { Diag.clear(); toast('Log ryddet'); render(); },
  fetchRuns: () => fetchRuns(),
  shoeNew: () => openShoeNew(),
  shoeSave: () => saveShoe(),
  shoeRetire: (d) => updateShoes((l) => l.map((x) => (x.id === d.id ? { ...x, retired: true, to: x.to || P.todayISO() } : x))),
  shoeUse: (d) => updateShoes((l) => l.map((x) => (x.id === d.id ? { ...x, retired: false, to: null } : (!x.to && !x.retired ? { ...x, to: P.addDays(P.todayISO(), -1) } : x)))),
  reportNav: (d) => { const cur = ui.reportWeek || X.mondayOf(P.todayISO()); const n = P.addDays(cur, 7 * Number(d.d)); ui.reportWeek = n >= X.mondayOf(P.todayISO()) ? null : n; render(); },
  reportShare: () => shareReport(),
  dailySave: () => {
    const date = $('#dl-date').value || P.todayISO();
    const row = { ...(S.get('daily_log', date) || {}), id: date, date, weight_kg: num($('#dl-w').value), protein_g: num($('#dl-p').value), sleep_h: num($('#dl-s').value), note: $('#dl-n').value.trim() };
    if (row.weight_kg == null && row.protein_g == null && row.sleep_h == null && !row.note) { toast('Skriv mindst ét felt.'); return; }
    S.put('daily_log', row); ui.dailyDate = null; toast('Gemt i dagbogen'); render();
  },
  dailyOpen: (d) => { ui.dailyDate = d.date; render(); window.scrollTo(0, 0); },
  pushOn: () => pushEnable(),
  pushOff: () => pushDisable(),
  pushTest: () => pushTest(),
  morningTest: () => morningTest(),
  planRestart: () => { ui.planView = 'wizard'; ui.rs = wizardDefaults(); render(); window.scrollTo(0, 0); },
  planBack: () => {
    if (ui.planView === 'wizard' && ui.rs && ui.rs.step > 1) ui.rs.step -= 1;
    else { ui.planView = 'main'; ui.rs = null; if (['programs', 'hybrid', 'versions'].includes(ui.sub)) { go('more', 'plan'); window.scrollTo(0, 0); return; } }
    render(); window.scrollTo(0, 0);
  },
  rsNext: () => rsNext(),
  rsSave: () => rsSave(),
  rsWd: (d, el) => { const v = Number(d.value), a = ui.rs.wd; ui.rs.wd = a.includes(v) ? a.filter((x) => x !== v) : [...a, v]; el.setAttribute('aria-pressed', ui.rs.wd.includes(v)); },
  planVersions: () => { ui.planView = 'versions'; go('more', 'versions'); window.scrollTo(0, 0); },
  ci: (d) => { const t = P.todayISO(); const cur = S.get('daily_log', t) || {}; const v = Number(d.v); S.put('daily_log', { ...cur, id: t, date: t, [d.k]: cur[d.k] === v ? null : v }); render(); },
  qa: (d) => {
    if (d.qa === 'swap') return openSwap(d.date);
    if (d.qa === 'swapEasy') return openSwap(d.date, { easyOnly: true });
    qaApply(d.qa, d.key || null, d.date);
  },
  swapDo: (d) => swapDo(d.a, d.b),
  shorten: (d) => shortenDo(d.key, d.to),
  actualSeen: (d) => { const cur = settingVal('actual_seen') || { ids: {} }; saveSetting('actual_seen', { ids: { ...cur.ids, [d.id]: true } }); render(); },
  reviewChoose: (d) => reviewChoose(d.start, d.accept === '1'),
  tune: (d) => tuneDo(d.key, d.op),
  retryFailed: async (d) => { await Sync.retryFailed(d.key || null); render(); toast(Sync.failedRows().length ? 'Nogle rækker kunne stadig ikke gemmes' : 'Gemt ✓'); },
  lvSave: () => lvSave(),
  planHybrid: () => { ui.planView = 'hybrid'; go('more', 'hybrid'); window.scrollTo(0, 0); },
  planPrograms: () => { ui.planView = 'programs'; ui.pg = { id: null, sid: null }; ui.rp = { id: null }; go('more', 'programs'); window.scrollTo(0, 0); },
  rpNew: () => rpNew(null),
  rpFromPlan: () => { const b = RP.fromPlan(plan.weeks, plan.goals, P.todayISO()); b.start_date = P.addDays(P.todayISO(), 1); rpNew(b); },
  rpOpen: (d) => { ui.rpDraft = null; ui.rp = { id: d.id }; render(); window.scrollTo(0, 0); },
  rpBack: () => { ui.rp = { id: null }; render(); },
  rpCopy: (d) => { const r = S.get('run_programs', d.id); if (!r) return; const n = PG.clone(r); n.id = PG.newId('rp'); n.name = `${r.name} (kopi)`; n.active = false; n.replaces = undefined; S.put('run_programs', n); toast('Kopi lavet'); render(); },
  rpDelete: (d) => { const r = S.get('run_programs', d.id); if (!r || !window.confirm(`Slet "${r.name}"?${r.active ? ' Planens egne løbepas gælder igen.' : ''}`)) return; S.remove('run_programs', d.id); if (r.active) { markPlanChanged(r.start_date); recompute(); } render(); },
  rpFix: (d) => rpMut((r) => { r.config.fixes = { ...(r.config.fixes || {}) }; if (d.mode) r.config.fixes[d.week] = d.mode; else delete r.config.fixes[d.week]; }),
  rpFixAll: () => { const row = S.get('run_programs', ui.rp.id); if (!row) return; ui.rpDraft = { id: row.id, fixes: RP.recommendAll(row) }; render(); },
  rpFixAllApply: () => { const dr = ui.rpDraft; ui.rpDraft = null; if (dr) rpMut((r) => { r.config.fixes = { ...(r.config.fixes || {}), ...dr.fixes }; }); },
  rpFixAllCancel: () => { ui.rpDraft = null; render(); },
  rpRampAdd: () => rpMut((r) => { const ramp = r.config.ramp || []; const last = ramp[ramp.length - 1]; r.config.ramp = [...ramp, { week: last ? Number(last.week) + 4 : 1, days: Math.min(r.config.weekdays.length, last ? Number(last.days) + 1 : 3) }]; }),
  rpRampDel: (d) => rpMut((r) => { r.config.ramp = (r.config.ramp || []).filter((_, i) => i !== Number(d.i)); }),
  rpRampSuggest: () => rpMut((r) => { const st = RP.suggestRamp(r); r.config.ramp = st; if (!st.length) toast('Km rækker til alle dine løbedage fra første uge.'); }),
  rpWd: (d) => rpMut((r) => { const wd = Number(d.wd), on = r.config.weekdays.includes(wd); if (on && r.config.weekdays.length <= 2) { toast('Mindst 2 løbedage.'); return; } if (!on && r.config.weekdays.length >= 6) { toast('Højst 6 løbedage.'); return; } r.config.weekdays = on ? r.config.weekdays.filter((x) => x !== wd) : [...r.config.weekdays, wd]; if (!on && !r.config.rows.some((x) => x.wd === wd)) r.config.rows.push({ wd, sub: 'easy', km: 6, zone: '', description: '', elevation_m: '' }); }),
  rpRotDel: (d) => rpMut((r) => { if (r.config.rotation.length > 1) r.config.rotation.splice(Number(d.i), 1); else toast('Mindst ét kvalitetspas.'); }),
  rpActivate: (d) => rpActivate(d.fix === '1'),
  rpStop: () => rpStop(),
  rpRestore: (d) => rpRestore(d.id),
  pgBackMore: () => { go('more'); },
  pgNew: () => pgNew(false), pgBuiltin: (d) => pgNew(PG.BUILTINS.find((b) => b.id === d.id) || PG.BUILTIN),
  pgOpen: (d) => { ui.pg = { id: d.id, sid: null }; render(); window.scrollTo(0, 0); },
  pgBack: () => { ui.pg = { id: null, sid: null }; render(); },
  pgCopy: (d) => pgCopy(d.id), pgDelete: (d) => pgDelete(d.id),
  pgActivate: () => pgActivate(), pgStop: () => pgStop(),
  pgUpgrade: () => {
    const cur = S.get('programs', ui.pg.id); const b = cur && (PG.BUILTINS.find((x) => x.id === cur.builtin) || PG.BUILTINS.find((x) => x.name === cur.name)); if (!b) return;
    if (!window.confirm('Opdatér programmet til den nyeste version? Egne rettelser i programmet overskrives. Dine logs ændres ikke.')) return;
    const n = PG.clone(b);
    S.put('programs', { ...cur, builtin: b.id, sessions: n.sessions, pattern: n.pattern, phases: n.phases, leg_volume: n.leg_volume, adapt_weeks: n.adapt_weeks });
    if (cur.active) { markPlanChanged(P.todayISO()); recompute(); }
    toast('Programmet er opdateret ✓'); render();
  },
  pgSessionNew: () => { const id = PG.newId('s'); pgMut((p) => { p.sessions.push({ id, name: `Pas ${p.sessions.length + 1}`, kind: 'upper', exercises: [] }); }); ui.pg.sid = id; render(); window.scrollTo(0, 0); },
  pgSessionOpen: (d) => { ui.pg.sid = d.sid; render(); window.scrollTo(0, 0); },
  pgSessionBack: () => { ui.pg.sid = null; render(); },
  pgSessionCopy: (d) => pgMut((p) => { const s = p.sessions.find((x) => x.id === d.sid); if (s) { const c = PG.clone(s); c.id = PG.newId('s'); c.name = `${s.name} (kopi)`; p.sessions.push(c); } }),
  pgSessionDelete: (d) => { if (!window.confirm('Slet passet fra programmet?')) return; pgMut((p) => { p.sessions = p.sessions.filter((x) => x.id !== d.sid); for (const k of Object.keys(p.pattern || {})) if (p.pattern[k] === d.sid) delete p.pattern[k]; }); },
  pgExAdd: () => openProgramExPicker(),
  pgExPick: (d) => { pgMut((p) => { const s = p.sessions.find((x) => x.id === ui.pg.sid); if (s) s.exercises.push({ exercise: d.name, sets: 3, reps: '8-12', rir: '2' }); }); closeSheet(); },
  pgExDel: (d) => pgMut((p) => { const s = p.sessions.find((x) => x.id === ui.pg.sid); if (s) s.exercises.splice(Number(d.i), 1); }),
  pgExUp: (d) => pgMut((p) => { const s = p.sessions.find((x) => x.id === ui.pg.sid), i = Number(d.i); if (s && i > 0) [s.exercises[i - 1], s.exercises[i]] = [s.exercises[i], s.exercises[i - 1]]; }),
  pgExDown: (d) => pgMut((p) => { const s = p.sessions.find((x) => x.id === ui.pg.sid), i = Number(d.i); if (s && i < s.exercises.length - 1) [s.exercises[i + 1], s.exercises[i]] = [s.exercises[i], s.exercises[i + 1]]; }),
  hyRepair: () => hybridRepair(),
  verUse: (d) => useVersion(d.id),
  verOriginal: () => useVersion(null),
  verDelete: (d) => { if (!confirm('Slet denne planversion? Din log påvirkes ikke.')) return; S.remove('plan_versions', d.id); markPlanChanged(P.todayISO()); toast('Version slettet'); render(); },
  weekEdit: (d) => weekEditOpen(d.start),
  weekEditFromPlan: () => weekEditOpen(X.mondayOf(P.todayISO())),
  weDel: (d) => { const day = weDay(d.day); day.items.splice(Number(d.idx), 1); weClean(); weRefresh(); },
  weKm: (d) => { const it = weDay(d.day).items[Number(d.idx)]; it.km = Math.max(1, Math.round((it.km + Number(d.d)) * 2) / 2); weRefresh(); },
  weSave: () => weSave(),
  weReset: () => { S.remove('week_edits', we.start); markPlanChanged(we.floor); closeSheet(); we = null; toast('Ugen er nulstillet til planen'); render(); },
  weTidy: () => {
    const weeks = plan.weeks.map((w) => (w.start === we.start ? { ...w, days: we.days } : w));
    const warnings = [];
    PL.relocate(weeks, weeks.findIndex((w) => w.start === we.start), isBlockedDay, we.floor, warnings);
    weClean(); weRefresh();
    toast(warnings.length ? `${warnings.length} pas kunne ikke flyttes uden regelbrud` : 'Pas flyttet væk fra utilgængelige dage');
  },
  pauseOpen: () => pauseOpen(),
  pauseApply: () => pauseApply(),
  pauseDismiss: () => { const info = pauseInfo(); if (info) saveSetting('pause_dismissed', { key: info.key, at: new Date().toISOString() }); toast('Okay – vi spørger ikke igen for denne pause'); render(); },
  planSync: () => openPlanSync(),
  planSyncMac: () => { const s = settingVal('plan_sync') || {}; saveSetting('plan_sync', { ...s, queued: true, queued_at: new Date().toISOString() }); $('#sheetBody').innerHTML = PU.planSyncHTML({ from: s.from || P.todayISO(), queued: true }); toast('Mac\'en opdaterer ved næste hentning'); },
  planSyncDone: () => { const s = settingVal('plan_sync') || {}; saveSetting('plan_sync', { ...s, done_at: new Date().toISOString(), queued: false }); closeSheet(); render(); },
  icsDownload: () => downloadICS(),
  prefWd: (d) => { const pr = planPrefs(), v = Number(d.value); saveSetting('plan_prefs', { ...pr, blocked_weekdays: pr.blocked_weekdays.includes(v) ? pr.blocked_weekdays.filter((x) => x !== v) : [...pr.blocked_weekdays, v] }); render(); },
  healthKind: (d) => { ui.healthKind = d.value; render(); },
  healthStart: () => {
    const kind = ui.healthKind || 'easy', n = Number(ui.healthDays || 7), t = P.todayISO();
    saveSetting('health', { active: true, kind, from: t, to: P.addDays(t, n - 1) });
    toast('Planen er tilpasset'); render();
  },
  healthEnd: () => { const h = settingVal('health'); if (h) saveSetting('health', { ...h, active: false }); toast('Tilpasningen er afsluttet'); render(); },
  healthExtend: () => { const h = settingVal('health'); if (h) saveSetting('health', { ...h, to: P.addDays(h.to, 7) }); toast('Forlænget med 7 dage'); render(); },
  travelCycle: (d) => {
    const cur = settingVal('travel') || {}, days = { ...(cur.days || {}) };
    const next = { undefined: 'fly', fly: 'off', off: 'hotel', hotel: undefined }[days[d.date]];
    if (next) days[d.date] = next; else delete days[d.date];
    for (const k of Object.keys(days)) if (k < P.addDays(P.todayISO(), -60)) delete days[k];
    saveSetting('travel', { ...cur, days }); render();
  },
  hotelOn: (d) => { const cur = settingVal('travel') || {}; saveSetting('travel', { ...cur, hotel: { ...(cur.hotel || {}), [d.key]: true } }); toast('Hotel-pas valgt'); closeSheet(); if (woOpen()) { recompute(); renderWorkoutBody(); } else render(); },
  hotelOff: (d) => { const cur = settingVal('travel') || {}, hotel = { ...(cur.hotel || {}) }; delete hotel[d.key]; saveSetting('travel', { ...cur, hotel }); closeSheet(); if (woOpen()) { recompute(); renderWorkoutBody(); } else render(); },
  cannot: (d) => { closeSheet(); setTimeout(() => openCannot(d.key), 50); },
  moveTo: (d) => { const e = entryByKey(d.key); if (e) { closeSheet(); doMove(e, d.date); } },
  refresh: () => refreshApp(),
  // Pas-fanen
  pasMain: (d) => { pasFilter.main = d.value; pasFilter.sub = null; savePasFilter(); render(); },
  pasSub: (d) => { pasFilter.sub = pasFilter.sub === d.value ? null : d.value; savePasFilter(); render(); },
  pasPast: () => { pasFilter.past = !pasFilter.past; savePasFilter(); render(); },
  pasToday: () => {
    const el = $('#pasList [data-today]') || $('#pasList .week-sticky');
    if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    else toast('Intet pas i dag med det valgte filter.');
  },
  // Øvelsesskift
  exSwap: (d) => openExercisePicker(curKey(), d.slot),
  exAdd: () => openExercisePicker(curKey(), null),
  exPick: (d) => openExerciseConfirm(d.name),
  exNew: () => openExerciseNew(),
  exNewSave: () => saveExerciseNew(),
  nxMuscle: (d, el) => { el.setAttribute('aria-pressed', el.getAttribute('aria-pressed') !== 'true'); },
  exSave: () => saveExerciseChange(),
  exBack: () => { picker = null; closeSheet(); },
  exPickerBack: () => { if (picker) openExercisePicker(picker.key, picker.slot); },
  exUndo: (d) => {
    const r = S.get('exercise_overrides', d.id);
    if (!r) return;
    if (r.scope === 'future' && !confirm(`Fortryd skiftet for alle ${r.session}-pas fra ${P.fmtDateShort(r.date)}?`)) return;
    S.remove('exercise_overrides', d.id);
    toast('Skift fortrudt', () => S.put('exercise_overrides', { ...r, deleted: false }));
    if (woOpen()) renderWorkoutBody();
  },
  undoSwap: (d) => {
    const r = S.get('exercise_overrides', d.id);
    if (!r) return;
    S.remove('exercise_overrides', d.id);
    toast('Skift fortrudt', () => S.put('exercise_overrides', { ...r, deleted: false }));
  },
  favQuote: (d) => {
    if (S.get('favorite_quotes', d.id)) S.remove('favorite_quotes', d.id);
    else { S.put('favorite_quotes', { id: d.id, quote_id: d.id }); toast('Gemt som favorit ♥'); }
  },
  quoteNew: () => openQuoteNew(),
  quoteSave: () => {
    const text = $('#cq-text').value.trim();
    if (!text) { toast('Skriv citatet først.'); return; }
    const tags = $$('#cq-tags button[aria-pressed="true"]').map((b) => b.dataset.tag);
    S.put('custom_quotes', { id: `c-${Date.now().toString(36)}`, text, tags: tags.length ? tags : ['general'] });
    toast('Citat gemt');
    closeSheet();
  },
  quoteDel: (d) => {
    const q = S.get('custom_quotes', d.id);
    if (!q || !confirm('Slet dit citat?')) return;
    S.remove('custom_quotes', d.id);
    toast('Citat slettet', () => S.put('custom_quotes', { ...q, deleted: false }));
  },
  saveGoal: (d) => saveGoal(d.id),
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  // Et swipe må ikke også tælle som et tryk
  if (swipeMoved && el.closest('.swipe > .row')) { ev.preventDefault(); return; }
  const wrap = el.closest('.swipe');
  if (wrap && wrap.classList.contains('open') && !el.closest('.actions')) {
    wrap.classList.remove('open'); wrap.querySelector(':scope > .row').style.transform = ''; ev.preventDefault(); return;
  }
  const fn = actions[el.dataset.act];
  if (!fn) return;
  ev.preventDefault();
  fn(el.dataset, el);
});
document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('g[data-act]')) { ev.preventDefault(); ev.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  if (ev.key === 'Escape') { if (sheetIsOpen()) closeSheet(); else if (woOpen()) closeWorkout(); }
  if (ev.key === 'Enter' && /^lg-(email|pass|pass2)$/.test(ev.target.id)) { ev.preventDefault(); doLogin(login.mode); }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role="button"][data-act]')) { ev.preventDefault(); ev.target.click(); }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.set) onSetEdit(t, 'change');
  if (t.dataset.unit) {
    const cur = S.get('exercise_settings', t.dataset.unit) || { id: t.dataset.unit };
    S.put('exercise_settings', { ...cur, load_type: t.value });
    renderWorkoutBody();
  }
  if (t.dataset.check) {
    if (t.checked) S.put('checklists', { id: t.dataset.check, list_id: t.dataset.list, done: true });
    else S.remove('checklists', t.dataset.check);
  }
  if (t.matches('[data-import]') && t.files[0]) {
    t.files[0].text().then((txt) => {
      try { const n = S.importJSON(txt); toast(`Backup indlæst – ${n} ændringer`); } catch (err) { toast(err.message || 'Kunne ikke læse filen'); }
    });
    t.value = '';
  }
});
// Skriver du i et kg-/reps-felt, bliver tallet sort (rettet) med det samme
document.addEventListener('input', (ev) => { if (ev.target.dataset && ev.target.dataset.set) onSetEdit(ev.target, 'input'); });
// Søgning i "Alle pas": opdatér kun listen, så feltet beholder fokus
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'pasSearch') return;
  pasFilter.q = ev.target.value;
  savePasFilter();
  recompute();
  $('#pasList').innerHTML = allPassesList();
});
// Valg for notifikationer gemmes med det samme
document.addEventListener('change', (ev) => {
  const k = ev.target.dataset && ev.target.dataset.pref;
  if (!k) return;
  const v = ev.target.type === 'checkbox' ? ev.target.checked : Number(ev.target.value);
  saveSetting('push_prefs', { ...pushPrefs(), [k]: v });
  toast('Gemt');
  if (k === 'morning') render();
});
// Morgenbesked: tid og til/fra pr. ugedag
document.addEventListener('change', (ev) => {
  const el = ev.target, d = el.dataset && el.dataset.mwd;
  if (d === undefined) return;
  const p = pushPrefs();
  if (el.dataset.mk === 'time') saveSetting('push_prefs', { ...p, morning_times: { ...(p.morning_times || {}), [d]: el.value } });
  else saveSetting('push_prefs', { ...p, morning_off: { ...(p.morning_off || {}), [d]: !el.checked } });
  toast('Gemt');
  render();
});
// Hybrid-regler: Lower samme dag som kvalitetspasset (indstilling til regel 2)
document.addEventListener('change', (ev) => { if (ev.target.dataset && ev.target.dataset.hySame !== undefined) saveRules({ lowerSameDay: ev.target.checked }); });
// Tilpas ugen: flyt eller tilføj pas via valgmenuerne
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!we || !t.dataset) return;
  if ('weMove' in t.dataset && t.value) {
    const from = weDay(t.dataset.day), to = weDay(t.value), it = from.items.splice(Number(t.dataset.idx), 1)[0];
    to.items = [...to.items.filter((i) => i.kind !== 'rest'), it]; weClean(); weRefresh();
  } else if ('weAdd' in t.dataset && t.value) {
    const item = makeWeItem(t.value), day = weDay(t.dataset.day);
    if (!item) { toast('Kunne ikke finde passet.'); weRefresh(); return; }
    day.items = [...day.items.filter((i) => i.kind !== 'rest'), item]; weClean(); weRefresh();
  }
});
// Dagbog: skift dato, og vis den dags tal
document.addEventListener('change', (ev) => { if (ev.target.id === 'dl-date' && ev.target.value) { ui.dailyDate = ev.target.value; render(); } });
// Søgning i Statistik → Øvelser: opdatér kun listen, så feltet beholder fokus
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'statSearch') return;
  ui.statQ = ev.target.value;
  $('#statExList').innerHTML = SU.exerciseList(statsCtx(), ui);
});
// Sidebaren på Mac: rul kun i selve sidebaren – aldrig siden bagved
$('#sidebar').addEventListener('wheel', (ev) => { ev.preventDefault(); ev.currentTarget.scrollTop += ev.deltaY; }, { passive: false });
$('#backdrop').addEventListener('click', closeSheet);
window.addEventListener('scroll', onScroll, { passive: true });
desktop.addEventListener('change', render);

// Opdatér visningen når data ændres (men ikke mens man skriver i et ark – det opdateres ved lukning)
// (Mens et pas er åbent, opfriskes det kun ved flytning af passet – ellers ville felterne blive bygget om under dine fingre)
// Stangøvelser (bænkpres, squat, RDL, barbell row …) er "kg i alt" – ret forkert enhed (maskine) i indstillinger og logs
function fixLoadTypes() {
  const lib = exerciseIndex();
  let n = 0;
  for (const r of S.all('exercise_settings')) {
    const e = lib.get(r.id);
    if (e && e.load_type === 'total' && r.load_type && r.load_type !== 'total') { S.put('exercise_settings', { ...r, load_type: null }); n++; }
  }
  for (const r of S.all('strength_logs')) {
    const e = lib.get(r.exercise);
    if (e && e.load_type === 'total' && r.load_type && r.load_type !== 'total') { S.put('strength_logs', { ...r, load_type: 'total' }); n++; }
  }
  return n;
}

// Mens et felt eller en rullemenu har fokus, tegnes siden ikke igen i baggrunden (så menuen ikke lukker af sig selv)
let pendingRender = false;
const typing = () => { const a = document.activeElement; return !!(a && a.matches && a.matches('input, textarea, select')); };
function flushPending() {
  if (!pendingRender || typing()) return;
  pendingRender = false;
  if (sheetIsOpen()) return;
  if (woOpen()) renderWorkoutBody(); else render();
}
function softRender() { if (typing()) { pendingRender = true; return; } if (woOpen()) return; render(); }
S.onChange((table) => {
  if (sheetIsOpen()) return;
  if (typing()) { pendingRender = true; return; }
  if (woOpen()) { if (table === 'overrides' || table === 'exercise_overrides') renderWorkoutBody(); return; }
  render();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { Sync.syncNow(); softRender(); } });
window.addEventListener('online', () => { Sync.syncNow(); softRender(); });
window.addEventListener('offline', softRender);

// ======================= Start =======================
async function loadJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}
async function start() {
  try {
    [basePlan, baseConfig] = await Promise.all([loadJSON('data/plan.json'), loadJSON('data/config.json')]);
    plan = basePlan;
    config = baseConfig;
    P.setTimezones(config.timezone_from, config.timezone);
    [goalsFile, quotesFile, exercisesFile, runTypes] = await Promise.all([
      loadJSON('data/goals.json').catch(() => null),
      loadJSON('data/quotes.json').catch(() => null),
      loadJSON('data/exercises.json').catch(() => null),
      loadJSON('data/run_types.json').catch(() => null),
    ]);
    startWeightsFile = await loadJSON('data/start_weights.json').catch(() => null);
    startWeights = startWeightsFile;
  } catch (err) {
    $('#view').innerHTML = `<div class="loading"><div class="card empty">Kunne ikke hente planen.<br>Tjek din internetforbindelse og prøv igen.<br><small>${esc(err.message)}</small></div></div>`;
    return;
  }
  S.seedGoals(goalsFile);
  baseDates = new Map(P.buildSchedule(plan, {}).entries.map((e) => [e.key, e.date]));
  const hash = location.hash.replace('#', '');
  if (TABS.some((t) => t.id === hash)) ui.tab = hash;
  if (hash === 'week') ui.tab = 'pas'; // gamle genveje
  if (hash === 'log') ui.tab = 'stats';
  render();
  // Statusfeltet opdateres løbende; hele visningen kun hvis man står på kontosiden og ikke skriver
  let fixedAt = 0;
  fixLoadTypes();
  Sync.onStatus(() => {
    if (Sync.currentUser() && Date.now() - fixedAt > 8000) { fixedAt = Date.now(); if (fixLoadTypes() && !typing() && !woOpen()) render(); }
    $$('.sync-pill').forEach((el) => { el.outerHTML = syncPill(); });
    if (ui.sub === 'account' && $('#sheet').hidden && !typing() && !woOpen()) render();
  });
  // Pause-urets knapper bygges én gang (resten af uret opdateres kun med tekst og bredde)
  $('#rdStop').innerHTML = icon('skip');
  $('#ptr').innerHTML = icon('refresh');
  updateSoundButton();
  Sync.init();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('service-worker.js').catch((e) => console.warn('Service worker fejlede', e));
}
start();
