// Visninger til egne styrkeprogrammer (Mere → Plan → Programmer). Returnerer HTML-tekst; app.js står for tilstand og hændelser.
import * as P from './plan.js';
import * as PG from './programs.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const seg = (group, options, value) => `<div class="seg" role="group">${options.map(([v, l]) => `<button data-act="seg" data-group="${group}" data-value="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join('')}</div>`;
const back = (act, label) => `<button class="link-btn back-link" data-act="${act}">${icon('left')}${label}</button>`;
const REST_OPTS = [0, 60, 90, 120, 150, 180, 240];

export function programsHTML(list, activeId, available, tabs = '') {
  let h = `${back('pgBackMore', 'Mere')}<h1 class="large-title" style="margin-top:0">Programmer</h1>${tabs}<div class="subtitle" style="margin-top:10px">Dine egne styrkeprogrammer – gælder fra en valgt dato, og dine gamle logs ændres ikke</div>`;
  if (list.length) {
    h += `<div class="group">${list.map((p) => `<div class="row"><button class="grow tappable" style="text-align:left;background:none;border:0;padding:0;color:inherit" data-act="pgOpen" data-id="${esc(p.id)}"><span class="title">${esc(p.name)}</span>
      <span class="meta" style="display:block">${p.sessions.length} pas · ${PG.sessionsPerWeek(p)} pr. uge · ben-volumen ${PG.volumeLabel(p.leg_volume)}${p.id === activeId ? ` · <b>I brug fra ${P.fmtDateShort(p.start_date)}</b>` : ''}</span></button>
      <button class="nav-btn" data-act="pgCopy" data-id="${esc(p.id)}" aria-label="Kopiér program">${icon('plus')}</button>
      <button class="nav-btn" data-act="pgDelete" data-id="${esc(p.id)}" aria-label="Slet program">${icon('trash')}</button></div>`).join('')}</div>`;
  } else h += `<div class="card empty">Ingen programmer endnu. Start med forslaget herunder eller lav et helt nyt.</div>`;
  h += `<div class="btn-row" style="margin-top:12px"><button class="btn filled flex" data-act="pgNew">${icon('plus')}Nyt program</button></div>
    ${available.length ? `<div class="section-header">Indbyggede forslag</div>${available.map((b) => `<div class="card" style="margin-bottom:10px"><div class="title">${esc(b.name)}</div>
      <div class="meta" style="margin:4px 0 10px">${b.id === 'hybrid-4-split' ? 'Lower (løberens dag), Bryst & ryg, Skulder & arm + løberstyrke og Upper – dine nuværende øvelser og startvægte. Man Bryst & ryg · Ons Lower · Tor Skulder & arm · Fre Upper.' : 'Dit gamle program: Upper A, Lower A, Upper B og Lower B, med startvægte fra dine gamle vægte.'} Du får en kopi, du kan ændre frit.</div>
      <button class="btn block" data-act="pgBuiltin" data-id="${esc(b.id)}">Tilføj forslaget</button></div>`).join('')}` : ''}
    <div class="section-footer">Et program erstatter planens styrkepas fra den dato, du vælger. Løbepassene bliver, hvor de er, og dine hybrid-regler tjekkes.</div>`;
  return h;
}

export function programHTML(pg, c) {
  const issues = PG.programIssues(pg);
  let h = `${back('pgBack', 'Programmer')}<h1 class="large-title" style="margin-top:0">${esc(pg.name || 'Program')}</h1>
    ${(() => { const b = PG.BUILTINS.find((x) => x.id === pg.builtin) || PG.BUILTINS.find((x) => x.name === pg.name); const same = b && JSON.stringify([pg.sessions, pg.pattern, pg.phases || b.phases]) === JSON.stringify([b.sessions, b.pattern, b.phases]); return b && !same ? `<div class="card" style="margin-bottom:12px"><div class="title">Der findes en nyere version af "${esc(b.name)}"</div><div class="meta" style="margin:4px 0 10px">Dit program er en ældre kopi. Opdatér for at få de nyeste øvelser, pas og faser. Egne rettelser i programmet overskrives. Dine logs ændres ikke.</div><button class="btn filled block" data-act="pgUpgrade">${icon('refresh')}Opdatér til nyeste version</button></div>` : ''; })()}
    <div class="group"><div class="field"><label for="pg-name">Navn</label><input id="pg-name" data-pg="name" value="${esc(pg.name)}"></div></div>
    <div class="section-header">Pas</div><div class="group">
    ${pg.sessions.map((s) => `<div class="row"><button class="grow tappable" style="text-align:left;background:none;border:0;padding:0;color:inherit" data-act="pgSessionOpen" data-sid="${esc(s.id)}"><span class="title">${esc(s.name)}</span>
      <span class="meta" style="display:block">${s.kind === 'lower' ? 'Ben' : 'Overkrop'} · ${s.exercises.length} øvelser</span></button>
      <button class="nav-btn" data-act="pgSessionCopy" data-sid="${esc(s.id)}" aria-label="Kopiér pas">${icon('plus')}</button>
      <button class="nav-btn" data-act="pgSessionDelete" data-sid="${esc(s.id)}" aria-label="Slet pas">${icon('trash')}</button></div>`).join('') || '<div class="row"><span class="meta">Ingen pas endnu</span></div>'}</div>
    <div class="btn-row" style="margin-top:10px"><button class="btn flex" data-act="pgSessionNew">${icon('plus')}Nyt pas</button><button class="btn flex" data-act="pgSessionFromTpl">Fra skabelon</button></div>
    <div class="section-header">Ugemønster (${PG.MIN_PER_WEEK}–${PG.MAX_PER_WEEK} pas pr. uge)</div><div class="group">
    ${PG.WEEKDAYS.map(([d, name]) => `<div class="row"><span class="grow title">${name}</span><select class="inline-select" data-pg-pat="${d}" aria-label="Pas ${name}">
      <option value="">Intet</option>${pg.sessions.map((s) => `<option value="${esc(s.id)}" ${pg.pattern && pg.pattern[d] === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`).join('')}</div>
    <div class="section-footer">${PG.sessionsPerWeek(pg)} pas pr. uge.</div>
    <div class="section-header">Ben-volumen</div>${seg('pgLeg', PG.LEG_VOLUMES, pg.leg_volume || 'normal')}
    <div class="section-footer">Lav: 1–2 sæt pr. benøvelse · Normal: som skrevet · Høj: +1 sæt. Kan sættes for hvert benpas for sig.</div>
    <div class="section-header">Tilvænning</div>${seg('pgAdapt', PG.ADAPT_OPTIONS, String(pg.adapt_weeks || 0))}
    <div class="section-footer">De første uger: lav ben-volumen og RIR 3, som stiger automatisk til dit valgte niveau. Bruges især ved nye, tunge benøvelser.</div>`;
  if (issues.length) h += `<div class="section-header">Tjek</div>${issues.map((i) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(i)}</span></div>`).join('')}`;
  if (c.violations && c.violations.length) h += `<div class="section-header">Dine hybrid-regler</div>${c.violations.slice(0, 5).map((v) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(v)}</span></div>`).join('')}`;
  h += `<div class="section-header">Gælder fra</div><div class="group"><div class="field"><label for="pg-start">Startdato</label><input id="pg-start" type="date" value="${esc(pg.start_date && pg.active ? pg.start_date : c.defaultStart)}" min="${esc(c.today)}"></div></div>
    <div class="btn-row" style="margin-top:12px"><button class="btn filled flex" data-act="pgActivate" ${issues.length ? 'disabled' : ''}>${icon('check')}${pg.active ? 'Opdatér startdato' : 'Brug fra denne dato'}</button>
    ${pg.active ? `<button class="btn flex" data-act="pgStop">Stop programmet</button>` : ''}</div>
    <div class="section-footer">${pg.active ? `I brug fra ${P.fmtDateShort(pg.start_date)} – stopper du, gælder planens egne styrkepas igen.` : 'Et andet aktivt program stoppes. Planens løbepas bliver ved med at gælde.'}</div>`;
  return h;
}

export function sessionHTML(pg, s, c) {
  const lib = c.lib;
  const exRow = (x, i) => {
    const doms = PG.givesSoreness(x.exercise, lib);
    return `<div class="card pg-ex" style="margin-bottom:10px"><div class="ex-top"><h4 style="margin:0">${esc(x.exercise)}${doms ? ' <span class="chip deload" title="Excentrisk tung øvelse">Giver meget ømhed</span>' : ''}</h4>
      <span class="we-km"><button class="btn" data-act="pgExUp" data-i="${i}" aria-label="Flyt op" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button><button class="btn" data-act="pgExDown" data-i="${i}" aria-label="Flyt ned" ${i === s.exercises.length - 1 ? 'disabled' : ''}>${icon('down')}</button><button class="btn" data-act="pgExDel" data-i="${i}" aria-label="Fjern øvelse">${icon('trash')}</button></span></div>
      <div class="group" style="margin-top:8px">
        <div class="field"><label>Sæt</label><select data-pg-ex="${i}" data-f="sets">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${Number(x.sets) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Reps</label><input data-pg-ex="${i}" data-f="reps" value="${esc(x.reps)}" placeholder="f.eks. 8-12"></div>
        <div class="field"><label>RIR</label><select data-pg-ex="${i}" data-f="rir">${['0', '1', '2', '3', '4'].map((n) => `<option ${String(x.rir) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div class="field"><label>Pause</label><select data-pg-ex="${i}" data-f="rest_sec">${REST_OPTS.map((n) => `<option value="${n}" ${Number(x.rest_sec || 0) === n ? 'selected' : ''}>${n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : 'Standard'}</option>`).join('')}</select></div>
      </div></div>`;
  };
  return `${back('pgSessionBack', esc(pg.name || 'Program'))}<h1 class="large-title" style="margin-top:0">${esc(s.name)}</h1>
    <div class="group"><div class="field"><label for="pgs-name">Navn</label><input id="pgs-name" data-pg-s="name" value="${esc(s.name)}"></div></div>
    <div class="section-header">Type</div>${seg('pgKind', [['upper', 'Overkrop'], ['lower', 'Ben']], s.kind)}
    ${s.kind === 'lower' ? `<div class="section-header">Ben-volumen for dette pas</div>${seg('pgSessLeg', [['inherit', 'Som programmet'], ...PG.LEG_VOLUMES], s.leg_volume || 'inherit')}` : ''}
    <div class="section-header">Øvelser</div>${s.exercises.map(exRow).join('') || '<div class="card empty">Ingen øvelser endnu.</div>'}
    <button class="btn block" style="margin-top:6px" data-act="pgExAdd">${icon('plus')}Tilføj øvelse</button>
    <div class="section-footer">Mærket "Giver meget ømhed" vises på excentrisk tunge øvelser som RDL, split squat og step-downs. Brug dem med Tilvænning eller lav ben-volumen de første uger.</div>`;
}
