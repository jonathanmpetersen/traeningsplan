// Visninger til egne løbeplaner (Mere → Programmer → Løb). Returnerer HTML-tekst; app.js står for tilstand og hændelser.
import * as P from './plan.js';
import * as RP from './runprog.js';
import { icon } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('da-DK', { maximumFractionDigits: d }));
const seg = (group, options, value) => `<div class="seg" role="group">${options.map(([v, l]) => `<button type="button" data-act="seg" data-group="${group}" data-value="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join('')}</div>`;
const WD = [[1, 'Man'], [2, 'Tir'], [3, 'Ons'], [4, 'Tor'], [5, 'Fre'], [6, 'Lør'], [0, 'Søn']];
const WD_LONG = { 1: 'Mandag', 2: 'Tirsdag', 3: 'Onsdag', 4: 'Torsdag', 5: 'Fredag', 6: 'Lørdag', 0: 'Søndag' };
const f = (label, input) => `<div class="field"><label>${label}</label>${input}</div>`;
const inp = (path, v, attrs = '') => `<input data-rp="${path}" value="${esc(v ?? '')}" ${attrs}>`;
const sel = (path, opts, v) => `<select data-rp="${path}">${opts.map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

export function runListHTML(list, activeId, c) {
  let h = '';
  if (!activeId) h += `<div class="card" style="margin-bottom:10px"><div class="title">Indbygget plan er i brug</div><div class="meta">Planens egne løbepas gælder. En aktiv løbeplan erstatter dem fra en dato.</div></div>`;
  if (list.length) {
    h += `<div class="group">${list.map((r) => `<div class="row"><button class="grow tappable" style="text-align:left;background:none;border:0;padding:0;color:inherit" data-act="rpOpen" data-id="${esc(r.id)}"><span class="title">${esc(r.name)}</span>
      <span class="meta" style="display:block">${r.start_date ? `${P.fmtDateShort(r.start_date)} → ${r.end_date ? P.fmtDateShort(r.end_date) : '–'}` : 'Ingen datoer endnu'}${r.id === activeId ? ' · <b>I brug</b>' : ''}</span></button>
      <button class="nav-btn" data-act="rpCopy" data-id="${esc(r.id)}" aria-label="Kopiér løbeplan">${icon('plus')}</button>
      <button class="nav-btn" data-act="rpDelete" data-id="${esc(r.id)}" aria-label="Slet løbeplan">${icon('trash')}</button></div>`).join('')}</div>`;
  } else h += `<div class="card empty">Ingen egne løbeplaner endnu.</div>`;
  h += `<div class="btn-row" style="margin-top:12px"><button class="btn filled flex" data-act="rpNew">${icon('plus')}Ny løbeplan</button></div>
    <button class="btn block" style="margin-top:8px" data-act="rpFromPlan">${icon('refresh')}Lav min egen ud fra den nuværende plan</button>
    <div class="section-footer">Den aktive løbeplan og det aktive styrkeprogram flettes sammen i Pas-fanen, og dine hybrid-regler gælder. Den tidligere løbeplan gemmes og kan gendannes.</div>`;
  return h;
}

export function runEditHTML(row, c) {
  const cfg = row.config, pr = cfg.prog, g = c.gen;
  const back = `<button class="link-btn back-link" data-act="rpBack">${icon('left')}Løbeplaner</button>`;
  const goalOpts = [['', 'Ingen – jeg sætter selv en slutdato'], ...c.goals.map((x) => [x.date, `${x.name} (${P.fmtDateShort(x.date)})`])];
  let h = `${back}<h1 class="large-title" style="margin-top:0">${esc(row.name || 'Løbeplan')}</h1>
    <div class="group">${f('Navn', inp('name', row.name))}${f('Startdato', `<input type="date" data-rp="start_date" value="${esc(row.start_date || '')}" min="${esc(c.today)}">`)}
      ${f('Mål-løb', sel('config.goal_date', goalOpts, cfg.goal_date))}
      ${cfg.goal_date ? '' : f('Slutdato', `<input type="date" data-rp="end_date" value="${esc(row.end_date || '')}">`)}</div>
    <div class="section-header">Løbedage (${cfg.weekdays.length} pr. uge)</div><div class="tag-picks filter-row" style="flex-wrap:wrap">${WD.map(([d, l]) => `<button type="button" class="chip-btn" data-act="rpWd" data-wd="${d}" aria-pressed="${cfg.weekdays.includes(d)}">${l}</button>`).join('')}</div>
    <div class="section-footer">Vælg 2–6 dage.</div>
    <div class="section-header">Løbedage pr. uge over tid</div>
    ${(cfg.ramp || []).length ? `<div class="group">${cfg.ramp.map((x, i) => `<div class="row"><span class="grow title">Fra uge</span><input class="rp-mini" data-rp-ramp="${i}" data-f="week" inputmode="numeric" value="${esc(x.week)}" aria-label="Fra uge"><span class="meta">→</span><select class="inline-select" data-rp-ramp="${i}" data-f="days" aria-label="Dage">${[2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${Number(x.days) === n ? 'selected' : ''}>${n} dage</option>`).join('')}</select><button class="nav-btn" data-act="rpRampDel" data-i="${i}" aria-label="Fjern trin">${icon('trash')}</button></div>`).join('')}</div>` : '<div class="card empty">Alle valgte dage bruges fra første uge.</div>'}
    <div class="btn-row" style="margin-top:8px"><button class="btn flex" data-act="rpRampAdd">${icon('plus')}Tilføj trin</button><button class="btn flex" data-act="rpRampSuggest">Foreslå ud fra km</button></div>
    ${c.rampHint ? `<div class="warn" style="margin-top:10px">${icon('warn')}<span>${esc(c.rampHint.text)}</span></div><button class="btn filled block" style="margin-top:8px" data-act="rpRampSuggest">${esc(c.rampHint.button)}</button>` : ''}
    <div class="section-footer">Fx 3 dage de første 4 uger, derefter 4 og så 5. Så passer km til antallet af dage fra starten.</div>
    <div class="section-header">Ugeskabelon</div>`;
  cfg.rows.filter((r) => cfg.weekdays.includes(r.wd)).sort((a, b) => ((a.wd + 6) % 7) - ((b.wd + 6) % 7)).forEach((r) => {
    const i = cfg.rows.indexOf(r);
    h += `<div class="card" style="margin-bottom:10px"><div class="title">${WD_LONG[r.wd]}</div><div class="group" style="margin-top:6px">
      ${f('Type', `<select data-rp-row="${i}" data-f="sub">${RP.DAY_TYPES.map(([id, l]) => `<option value="${id}" ${r.sub === id ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${f('Km (vægt)', `<input data-rp-row="${i}" data-f="km" inputmode="decimal" value="${esc(r.km)}">`)}
      ${f('Zone', `<select data-rp-row="${i}" data-f="zone">${RP.ZONES.map((z) => `<option ${((r.zone || RP.dayType(r.sub)[3]) === z) ? 'selected' : ''}>${z}</option>`).join('')}</select>`)}
      ${f('Højdemeter', `<input data-rp-row="${i}" data-f="elevation_m" inputmode="numeric" value="${esc(r.elevation_m)}" placeholder="valgfrit">`)}
      ${f('Beskrivelse', `<input data-rp-row="${i}" data-f="description" value="${esc(r.description)}" placeholder="valgfrit">`)}</div></div>`;
  });
  h += `<div class="section-footer">Km på hver dag er forholdet mellem dagene. Ugens samlede km og langturen styres af progressionen herunder.</div>
    <div class="section-header">Kvalitetspas-rotation</div><div class="group">${cfg.rotation.map((it, i) => `<div class="row"><span class="grow"><span class="title">${esc(RP.preset(it.id).name)}</span>
      <span class="meta" style="display:block">${esc(RP.preset(it.id).fmt(it.reps, it.min))}</span></span>
      <input class="rp-mini" data-rp-rot="${i}" data-f="reps" inputmode="numeric" value="${esc(it.reps)}" aria-label="Gentagelser"><span class="meta">×</span><input class="rp-mini" data-rp-rot="${i}" data-f="min" inputmode="numeric" value="${esc(it.min)}" aria-label="Minutter">
      <button class="nav-btn" data-act="rpRotDel" data-i="${i}" aria-label="Fjern">${icon('trash')}</button></div>`).join('')}</div>
    <div class="row-add"><select data-rp-addrot aria-label="Tilføj kvalitetspas">${[['', 'Tilføj kvalitetspas …'], ...RP.QUALITY_PRESETS.map((p) => [p.id, p.name])].map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></div>
    <div class="section-footer">Pas skiftes mellem uge for uge. Forklaringerne findes under Mere → Zoner og tempo → Løbetyper forklaret.</div>
    <div class="section-header">Progression</div><div class="group">
      ${f('Start-km pr. uge', inp('config.prog.start_km', pr.start_km, 'inputmode="decimal"'))}
      ${f('Stigning pr. uge', `<span class="inline">${inp('config.prog.step', pr.step, 'inputmode="decimal" style="width:5em"')}${sel('config.prog.step_mode', [['km', 'km'], ['pct', '%']], pr.step_mode)}</span>`)}
      ${f('Loft (maks km/uge)', inp('config.prog.cap_km', pr.cap_km, 'inputmode="decimal"'))}
      ${f('Langtur: start (km)', inp('config.prog.long_start', pr.long_start, 'inputmode="decimal"'))}
      ${f('Langtur: + km pr. uge', inp('config.prog.long_step', pr.long_step, 'inputmode="decimal"'))}
      ${f('Langtur: maks (km)', inp('config.prog.long_max', pr.long_max, 'inputmode="decimal"'))}
      ${f('Sidste km i MP fra uge', inp('config.prog.mp_from', pr.mp_from, 'inputmode="numeric" placeholder="valgfrit"'))}
      ${f('…antal km i MP', inp('config.prog.mp_km', pr.mp_km, 'inputmode="decimal"'))}</div>
    <div class="section-header">Intervaller</div><div class="group">
      ${f('Flere gentagelser hver', inp('config.prog.every', pr.every, 'inputmode="numeric"'))}
      ${f('+ gentagelser', inp('config.prog.reps_step', pr.reps_step, 'inputmode="numeric"'))}
      ${f('Maks gentagelser', inp('config.prog.reps_max', pr.reps_max, 'inputmode="numeric"'))}
      ${f('+ minutter pr. gentagelse', inp('config.prog.dur_step', pr.dur_step, 'inputmode="numeric"'))}
      ${f('Maks minutter', inp('config.prog.dur_max', pr.dur_max, 'inputmode="numeric"'))}</div>
    <div class="section-footer">Eksempel: 3×8 → 4×8 → 3×10 min.</div>
    <div class="section-header">Cutback og nedtrapning</div><div class="group">
      ${f('Cutback-uge', sel('config.prog.cutback_every', [[0, 'Ingen'], [3, 'Hver 3. uge'], [4, 'Hver 4. uge'], [5, 'Hver 5. uge']], pr.cutback_every))}
      ${f('Cutback (−%)', sel('config.prog.cutback_pct', [[20, '−20 %'], [25, '−25 %'], [30, '−30 %']], pr.cutback_pct))}
      ${cfg.goal_date ? f('Nedtrapning', sel('config.prog.taper', [['auto', 'Automatisk ud fra distance'], [1, '1 uge'], [2, '2 uger'], [3, '3 uger']], pr.taper)) : ''}</div>
    <div class="section-header">Højdemeter (valgfrit, til trail)</div><div class="group">
      ${f('Start (m pr. uge)', inp('config.prog.elev_start', pr.elev_start, 'inputmode="numeric" placeholder="tom = fra"'))}
      ${f('+ m pr. uge', inp('config.prog.elev_step', pr.elev_step, 'inputmode="numeric"'))}
      ${f('Loft (m)', inp('config.prog.elev_cap', pr.elev_cap, 'inputmode="numeric"'))}</div>
    <div class="section-header">Forhåndsvisning uge for uge</div>`;
  if (!g.weeks.length) h += `<div class="card empty">${esc(g.warnings[0] || 'Vælg datoer og løbedage.')}</div>`;
  else {
    h += `<div class="card" style="overflow-x:auto"><table class="perf"><thead><tr><th>Uge fra</th><th>Km</th><th>Langtur</th><th>Kvalitet</th><th>Hm</th></tr></thead><tbody>
      ${g.weeks.map((w) => `<tr><td>${P.fmtDateShort(w.start)}${w.kind === 'cut' ? ' · C' : w.kind === 'taper' ? ' · N' : w.kind === 'race' ? ' 🏁' : ''}${w.flags.length || (w.issues || []).length ? ' ⚠' : ''}</td><td><b>${fmt(w.km)}</b></td><td>${w.long ? fmt(w.long) : ''}</td><td>${esc(w.quality.join(', '))}</td><td>${w.elev ? fmt(w.elev, 0) : ''}</td></tr>`).join('')}</tbody></table></div>
      <div class="section-footer">C = cutback-uge, N = nedtrapning, 🏁 = løbsuge, ⚠ = se advarsler.</div>`;
    const other = g.warnings.filter((w) => !(g.issues || []).some((x) => x.text === w));
    const issues = g.issues || [];
    if (c.draft) h += `<div class="card adapt-banner" style="margin-top:12px"><div class="title">Forslag: løs alle automatisk</div><div class="meta" style="margin:4px 0 10px">Forhåndsvisningen viser ugerne med det anbefalede forslag (${c.draft.count} uger rettes). Der er ikke gemt noget endnu.</div><div class="qa-row"><button class="btn filled" data-act="rpFixAllApply">Anvend</button><button class="btn" data-act="rpFixAllCancel">Fortryd</button></div></div>`;
    const applied = g.weeks.filter((w) => w.applied);
    if (issues.length) {
      h += `<div class="section-header">Advarsler (${issues.length})</div>`;
      if (issues.length > 1 && !c.draft) h += `<button class="btn filled block" style="margin-bottom:10px" data-act="rpFixAll">Løs alle automatisk (anbefalede forslag)</button>`;
      for (const x of issues) {
        h += `<div class="card" style="margin-bottom:10px"><div class="warn" style="background:none;padding:0">${icon('warn')}<span>${esc(x.text)}</span></div><div class="meta" style="margin:6px 0">Vælg en løsning:</div>
          <div class="fix-col">${x.options.map((m) => `<button class="btn ${m === x.recommended ? 'filled' : ''} block" data-act="rpFix" data-week="${esc(x.start)}" data-mode="${m}"><span>${esc(RP.fixLabel(m))}${m === x.recommended ? ' (anbefalet)' : ''}</span><small>${esc(x.detail[m] || '')}</small></button>`).join('')}</div></div>`;
      }
    }
    if (applied.length) h += `<div class="section-header">Løst</div><div class="group">${applied.map((w) => `<div class="row"><span class="grow"><span class="title">Uge ${P.fmtDateShort(w.start)}</span><span class="meta" style="display:block">${esc(w.applied.text)}</span></span><button class="btn" data-act="rpFix" data-week="${esc(w.start)}" data-mode="">Fortryd</button></div>`).join('')}</div>`;
    if (other.length) h += `<div class="section-header">Andre advarsler</div>${other.slice(0, 8).map((w) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(w)}</span></div>`).join('')}`;
    if (c.violations.length) h += `<div class="section-header">Dine hybrid-regler</div>${c.violations.slice(0, 6).map((v) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(v)}</span></div>`).join('')}${c.violations.length > 6 ? `<div class="meta">… og ${c.violations.length - 6} flere</div>` : ''}`;
  }
  h += `<div class="btn-row" style="margin-top:14px"><button class="btn filled flex" data-act="rpActivate" ${g.weeks.length ? '' : 'disabled'}>${icon('check')}${row.active ? 'Opdatér' : 'Brug fra startdatoen'}</button>${row.active ? `<button class="btn flex" data-act="rpStop">Stop planen</button>` : ''}</div>
    ${!row.active && c.violations.length ? `<button class="btn block" style="margin-top:8px" data-act="rpActivate" data-fix="1">Brug den, og ret regelbrud ved at bytte dage</button>` : ''}
    ${row.active && row.replaces !== undefined ? `<button class="btn block" style="margin-top:8px" data-act="rpRestore" data-id="${esc(row.id)}">Gendan ${c.replacesName ? `"${esc(c.replacesName)}"` : 'den indbyggede plan'}</button>` : ''}
    <div class="section-footer">${row.active ? 'Planen er i brug. Ændringer her opdaterer Pas-fanen med det samme.' : 'Der ændres ikke noget, før du trykker. Den løbeplan, der er i brug nu, gemmes og kan gendannes.'}</div>`;
  return h;
}
