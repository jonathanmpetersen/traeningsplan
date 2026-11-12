// Visninger til "+ Tilføj pas" (egne pas). Returnerer HTML-tekst; app.js står for tilstand og hændelser.
import * as P from './plan.js';
import * as O from './own.js';
import { icon } from './icons.js';
import { MUSCLES } from './musclemap.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const seg = (k, options, value) => `<div class="seg" role="group">${options.map(([v, l]) => `<button type="button" data-act="ownSet" data-k="${k}" data-v="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join('')}</div>`;
const chip = (k, v, label, on) => `<button type="button" class="chip-btn" data-act="ownSet" data-k="${k}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)}</button>`;
const field = (label, input) => `<div class="field"><label>${label}</label>${input}</div>`;
const inp = (k, v, attrs = '') => `<input data-own="${k}" value="${esc(v ?? '')}" ${attrs}>`;
const ZONES = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];

// o = tilstand; c = { today, program: [{id,name,kind,n}], history: [{key,date,name,n}], templates: [{id,name,n}], suggestion: [], editing: bool }
export function addHTML(o, c) {
  const e = c.editing;
  let h = '';
  h += `<div class="group">${field('Dato', `<input type="date" data-own="date" value="${esc(o.date)}">`)}</div>`;
  h += `<div class="section-header">Tidspunkt</div>${seg('when', [['now', 'Nu'], ['plan', 'Planlagt']], o.when)}`;
  if (o.when === 'plan') h += `<div class="group" style="margin-top:8px">${field('Klokken', `<input type="time" data-own="time" value="${esc(o.time || '')}">`)}</div>`;
  if (!e) h += `<div class="section-header">Type</div>${seg('kind', [['run', 'Løb'], ['strength', 'Styrke'], ['other', 'Andet']], o.kind)}`;
  if (o.kind === 'run') h += runHTML(o);
  else if (o.kind === 'other') h += otherHTML(o);
  else h += strengthHTML(o, c);
  return h;
}

function runHTML(o) {
  const kind = O.runKind(o.sub);
  return `<div class="section-header">Løbetype</div><div class="tag-picks filter-row">${O.RUN_KINDS.map(([id, l]) => chip('sub', id, l, o.sub === id)).join('')}</div>
    <div class="group" style="margin-top:8px">
      ${field('Planlagt km', inp('km', o.km, 'inputmode="decimal" placeholder="f.eks. 8"'))}
      ${field('eller tid (min)', inp('minutes', o.minutes, 'inputmode="numeric" placeholder="f.eks. 50"'))}
      ${field('Zone', `<select data-own="zone">${ZONES.map((z) => `<option ${((o.zone || kind[4]) === z) ? 'selected' : ''}>${z}</option>`).join('')}</select>`)}
      ${field('Højdemeter', inp('elevation_m', o.elevation_m, 'inputmode="numeric" placeholder="valgfrit"'))}
      ${field('Beskrivelse', inp('description', o.description, 'placeholder="f.eks. 5×1 km i Z4"'))}
    </div><div class="section-footer">Passet kan matches med Garmin og Strava som de andre løbepas.</div>`;
}
function otherHTML(o) {
  return `<div class="section-header">Aktivitet</div><div class="tag-picks filter-row">${O.OTHER_KINDS.map(([id, l]) => chip('activity', id, l, o.activity === id)).join('')}</div>
    <div class="group" style="margin-top:8px">
      ${field('Varighed (min)', inp('minutes', o.minutes, 'inputmode="numeric" placeholder="f.eks. 60"'))}
      ${field('RPE (1–10)', `<select data-own="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option ${Number(o.rpe || 5) === n ? 'selected' : ''}>${n}</option>`).join('')}</select>`)}
      ${field('Puls (valgfri)', inp('hr', o.hr, 'inputmode="numeric"'))}
      ${field('Distance, km (valgfri)', inp('km', o.km, 'inputmode="decimal"'))}
      ${field('Beskrivelse', inp('description', o.description, 'placeholder="valgfrit"'))}
    </div>
    <div class="section-header">Blev benene belastet?</div>${seg('legs', O.LEG_LOAD, o.legs || 'light')}
    <div class="section-footer">Hård benbelastning behandles som et benpas i dine hybrid-regler. Passet tæller med i ugens belastning.</div>`;
}
const MODES = [['program', 'Fra mit program'], ['copy', 'Kopi af tidligere pas'], ['muscles', 'Vælg muskelgrupper'], ['free', 'Fri træning (tomt pas)'], ['hotel', 'Hotel/kropsvægt']];
function strengthHTML(o, c) {
  let h = '';
  if (!c.editing) h += `<div class="section-header">Styrke</div><div class="group">${MODES.map(([id, l]) => `<button type="button" class="row tappable" data-act="ownSet" data-k="mode" data-v="${id}" aria-pressed="${o.mode === id}"><span class="grow title">${l}</span>${o.mode === id ? icon('check') : icon('right', 'chev')}</button>`).join('')}</div>`;
  h += `<div class="group" style="margin-top:10px">${field('Navn', inp('name', o.name, 'placeholder="f.eks. Skulder og arme"'))}</div>`;
  if (c.editing) return h;
  if (o.mode === 'program') {
    h += `<div class="section-header">Pas fra dit program</div>`;
    h += c.program.length ? `<div class="group">${c.program.map((s) => `<button type="button" class="row tappable" data-act="ownSet" data-k="pick" data-v="p:${esc(s.id)}"><span class="grow"><span class="title">${esc(s.name)}</span><span class="meta" style="display:block">${s.kind === 'lower' ? 'Ben' : 'Overkrop'} · ${s.n} øvelser</span></span>${o.pick === `p:${s.id}` ? icon('check') : ''}</button>`).join('')}</div>` : `<div class="card empty">Du har ikke noget aktivt program. Lav ét under Mere → Programmer.</div>`;
  } else if (o.mode === 'copy') {
    h += c.templates.length ? `<div class="section-header">Mine skabeloner</div><div class="group">${c.templates.map((s) => `<button type="button" class="row tappable" data-act="ownSet" data-k="pick" data-v="t:${esc(s.id)}"><span class="grow"><span class="title">${esc(s.name)}</span><span class="meta" style="display:block">${s.n} øvelser</span></span>${o.pick === `t:${s.id}` ? icon('check') : ''}</button>`).join('')}</div>` : '';
    h += `<div class="section-header">Tidligere pas</div>`;
    h += c.history.length ? `<div class="group">${c.history.map((s) => `<button type="button" class="row tappable" data-act="ownSet" data-k="pick" data-v="h:${esc(s.key)}"><span class="grow"><span class="title">${esc(s.name)}</span><span class="meta" style="display:block">${P.fmtWeekday(s.date)} ${P.fmtDateShort(s.date)} · ${s.n} øvelser</span></span>${o.pick === `h:${s.key}` ? icon('check') : ''}</button>`).join('')}</div>` : `<div class="card empty">Ingen tidligere pas endnu.</div>`;
  } else if (o.mode === 'muscles') {
    h += `<div class="section-header">Muskelgrupper</div><div class="tag-picks filter-row" style="flex-wrap:wrap">${MUSCLES.map((m) => chip('muscle', m.id, m.label, (o.muscles || []).includes(m.id))).join('')}</div>`;
    if ((o.muscles || []).length) {
      h += `<div class="section-header">Forslag (${c.suggestion.length} øvelser)</div>`;
      h += c.suggestion.length ? `<div class="group">${c.suggestion.map((x, i) => `<div class="row"><span class="grow"><span class="title">${esc(x.exercise)}</span><span class="meta" style="display:block">${x.sets} × ${esc(x.reps)} · RIR ${esc(x.rir)}${x.soreness ? ' · Giver meget ømhed' : ''}</span></span><button type="button" class="nav-btn" data-act="ownSugDel" data-i="${i}" aria-label="Fjern øvelse">${icon('trash')}</button></div>`).join('')}</div>
        <div class="section-footer">Sammensatte øvelser først. Startvægte og "Næste gang" vises i passet som i de andre pas. Flere øvelser kan tilføjes undervejs.</div>` : `<div class="card empty">Ingen forslag til de grupper.</div>`;
      h += `<button type="button" class="btn block" style="margin-top:8px" data-act="ownSet" data-k="empty" data-v="1">Start tomt i stedet</button>`;
    }
  } else if (o.mode === 'hotel') h += `<div class="section-footer">Kort pas med kropsvægt, ca. 20–25 min.</div>`;
  else h += `<div class="section-footer">Et tomt pas. Tilføj øvelser undervejs.</div>`;
  return h;
}

// Advarsel efter oprettelse: regelbrud og for høj belastning
export function warnHTML(c) {
  let h = '';
  if (c.violations.length) h += `<div class="section-header">Dine hybrid-regler</div>${c.violations.map((v) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(v)}</span></div>`).join('')}`;
  if (c.shorten) h += `<div class="card" style="margin-top:10px"><div class="title">Ugens belastning bliver høj</div><div class="meta" style="margin:4px 0 10px">Planens km er uændrede, men du kan forkorte ${P.fmtWeekday(c.shorten.date)}s rolige tur fra ${c.shorten.from} til ${c.shorten.to} km.</div><button class="btn filled block" data-act="shorten" data-key="${esc(c.shorten.key)}" data-to="${c.shorten.to}">Forkort</button></div>`;
  return h;
}
