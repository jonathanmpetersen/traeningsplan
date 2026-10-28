// Visninger til Plan: genstart, forhåndsvisning, versioner, tilpas ugen, pause og ur/kalender. Returnerer HTML-tekst.
// app.js står for tilstand og hændelser.
import * as P from './plan.js';
import * as PL from './planner.js';
import { icon } from './icons.js';
import { barChart } from './statsui.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('da-DK', { maximumFractionDigits: d }));
const seg = (group, options, value) => `<div class="seg" role="group">${options.map(([v, l]) => `<button data-act="seg" data-group="${group}" data-value="${v}" aria-pressed="${String(v) === String(value)}">${l}</button>`).join('')}</div>`;
const WD = [['1', 'Man'], ['2', 'Tir'], ['3', 'Ons'], ['4', 'Tor'], ['5', 'Fre'], ['6', 'Lør'], ['0', 'Søn']];

// ---------- Plan-siden ----------
export function planMainHTML(c) {
  const { version, st, nVersions, nBlocked, pause, changed } = c;
  const bar = (v, max) => `<div class="pbar" role="img" aria-label="${fmt(v, 0)} af ${fmt(max, 0)}"><i style="width:${max > 0 ? Math.min(100, Math.round((v / max) * 100)) : 0}%"></i></div>`;
  const wk = (n) => (n == null ? '–' : n);
  let h = `<h1 class="large-title">Plan</h1><div class="subtitle">${version ? esc(version.label) : 'Oprindelig plan'}</div>
    <div class="card plan-status"><div class="session-head"><span class="badge-ic k-accent">${icon('list')}</span><div class="grow"><h3>${st.weekNo != null ? `Uge ${st.weekNo} af ${st.weekTotal}` : st.before ? `Starter ${P.fmtDateShort(st.startsOn)}` : 'Planen er slut'}</h3>
      <div class="meta">${st.phase ? esc(st.phase) : ''}</div></div></div>
      <div class="stat-tiles" style="margin-top:12px"><div class="stat-tile"><div class="l">Transgrancanaria</div><div class="v">${wk(st.tgcWeeks)}</div><div class="d" style="color:var(--label-2)"><small>uger</small></div></div>
        <div class="stat-tile"><div class="l">CPH Marathon</div><div class="v">${wk(st.marWeeks)}</div><div class="d" style="color:var(--label-2)"><small>uger</small></div></div></div>
      ${st.week ? `<div class="section-header" style="margin:14px 0 6px">Ugens fremskridt</div>
        <div class="meta">Pas: ${st.week.done} af ${st.week.sessions}</div>${bar(st.week.done, st.week.sessions)}
        <div class="meta" style="margin-top:8px">Km: ${fmt(st.week.logged)} af ${fmt(st.week.planned)}</div>${bar(st.week.logged, st.week.planned)}` : ''}
      <div class="section-header" style="margin:14px 0 6px">Næste milepæl</div>
      ${st.nextLong ? `<div class="meta">Næste langtur: <b>${fmt(st.nextLong.km)} km</b> · ${P.fmtWeekday(st.nextLong.date)} ${P.fmtDateShort(st.nextLong.date)}</div>` : '<div class="meta">Ingen flere langture i planen.</div>'}
      <div class="meta" style="margin-top:8px">Længste tur indtil nu: <b>${fmt(st.longest)} km</b> af målet på ${st.target} km</div>${bar(st.longest, st.target)}</div>`;
  if (changed) h += `<div class="card adapt-banner" style="margin-top:12px"><div class="title">Planen er ændret</div><div class="meta" style="margin:4px 0 10px">Ur og kalender følger først med, når du opdaterer dem.</div><button class="btn filled block" data-act="planSync">${icon('external')}Opdatér ur og kalender</button></div>`;
  if (pause) h += pauseCardHTML(pause, { compact: true });
  h += c.levelHTML || '';
  h += `<div class="section-header">Plan</div><div class="group">
      <button class="row tappable has-icon" data-act="weekEditFromPlan"><span class="badge-ic k-strength">${icon('edit')}</span><span class="grow"><span class="title">Tilpas denne uge</span><span class="meta" style="display:block">Travl, eksamen, rejse eller syg – eller flyt og ret pas</span></span>${icon('right', 'chev')}</button>
      <button class="row tappable has-icon" data-act="planHybrid"><span class="badge-ic k-strength">${icon('edit')}</span><span class="grow"><span class="title">Hybrid-regler</span><span class="meta" style="display:block">Dine regler for ben, løb og hårde dage</span></span>${icon('right', 'chev')}</button>
      <button class="row tappable has-icon" data-act="planPrograms"><span class="badge-ic k-strength">${icon('strength')}</span><span class="grow"><span class="title">Programmer</span><span class="meta" style="display:block">Egne styrkeprogrammer og ugemønster</span></span>${icon('right', 'chev')}</button>
      <button class="row tappable has-icon" data-act="planVersions"><span class="badge-ic k-gray">${icon('backup')}</span><span class="grow"><span class="title">Planversioner</span><span class="meta" style="display:block">${nVersions ? `${nVersions} gemt${nVersions === 1 ? '' : 'e'} · gå tilbage til en tidligere` : 'Ingen endnu – du kan altid gå tilbage til den oprindelige plan'}</span></span>${icon('right', 'chev')}</button>
      <button class="row tappable has-icon" data-act="planRestart"><span class="badge-ic k-gray">${icon('refresh')}</span><span class="grow"><span class="title">Genstart planen</span><span class="meta" style="display:block">Lav planen om fra en ny dato – bruges efter længere pause</span></span>${icon('right', 'chev')}</button>
      <button class="row tappable has-icon" data-act="sub" data-sub="travel"><span class="badge-ic k-accent">${icon('plane')}</span><span class="grow"><span class="title">Utilgængelige dage</span><span class="meta" style="display:block">${nBlocked ? `${nBlocked} dage markeret` : 'Markér vagter og rejser'} · planen undgår dem</span></span>${icon('right', 'chev')}</button>
</div>
    <div class="section-footer">Din log og dine rekorder ændres aldrig, når planen genstartes. Løbsdatoerne (Transgrancanaria og CPH Marathon) ligger fast.</div>`;
  return h;
}

// ---------- Genstart-guide ----------
const stepHead = (n, t) => `<div class="section-header" style="margin-top:6px">Trin ${n} af 3 · ${t}</div>`;
export function wizardHTML(rs, c) {
  const back = `<button class="link-btn back-link" data-act="planBack">${icon('left')}${rs.step === 1 ? 'Plan' : 'Tilbage'}</button>`;
  let h = `${back}<h1 class="large-title" style="margin-top:0">Genstart planen</h1>`;
  if (rs.step === 1) {
    h += stepHead(1, 'Startdato') + `<div class="group"><div class="field"><label for="rs-start">Startdato</label><input id="rs-start" type="date" value="${esc(rs.start)}" min="${esc(c.today)}"></div></div>
      <div class="section-footer">Starter du midt i en uge, laves en kort startuge fra startdatoen til søndag med lette pas (rolige ture og ét let styrkepas). Fulde uger starter derefter mandag.</div>
      <button class="btn filled block" style="margin-top:16px" data-act="rsNext">Næste</button>`;
  } else if (rs.step === 2) {
    h += stepHead(2, 'Dit niveau lige nu') + `<div class="group">
      <div class="field"><label for="rs-km">Løb pr. uge (sidste 2 uger)</label><input id="rs-km" inputmode="decimal" value="${esc(String(rs.km).replace('.', ','))}"><span class="suffix">km</span></div>
      <div class="field"><label for="rs-long">Længste tur (sidste 2 uger)</label><input id="rs-long" inputmode="decimal" value="${esc(String(rs.long).replace('.', ','))}"><span class="suffix">km</span></div>
      <div class="field"><label for="rs-str">Styrkepas (sidste 2 uger)</label><input id="rs-str" inputmode="numeric" value="${esc(rs.str)}"><span class="suffix">pas</span></div></div>
    <div class="section-footer">Tallene er foreslået ud fra din log. Ret dem, så de passer. Planen bygger op fra dit niveau med højst ca. 10 % mere pr. uge.</div>
    <button class="btn filled block" style="margin-top:16px" data-act="rsNext">Næste</button>`;
  } else if (rs.step === 3) {
    h += stepHead(3, 'Træning fremover') + `<div class="section-header">Styrkepas pr. uge</div>${seg('rsPer', [['3', '3 pas: Upper (man), Lower (ons), Upper (fre)']], '3')}
      <div class="section-header">Faste dage, hvor jeg ikke kan træne</div>
      <div class="tag-picks">${WD.map(([v, l]) => `<button type="button" class="chip-btn" data-act="rsWd" data-value="${v}" aria-pressed="${rs.wd.includes(Number(v))}">${l}</button>`).join('')}</div>
      <div class="group" style="margin-top:14px"><button class="row tappable has-icon" data-act="sub" data-sub="travel"><span class="badge-ic k-accent">${icon('plane')}</span><span class="grow"><span class="title">Vagter og rejser</span><span class="meta" style="display:block">${c.nBlocked ? `${c.nBlocked} dage markeret – planen undgår dem` : 'Ingen markeret – tryk for at markere dage'}</span></span>${icon('right', 'chev')}</button></div>
      <button class="btn filled block" style="margin-top:16px" data-act="rsNext">Se forhåndsvisning</button>`;
  } else {
    h += previewHTML(rs.result, rs);
  }
  return h;
}

export function previewHTML(r, rs) {
  if (!r || r.error) return `<div class="card empty">${esc((r && r.error) || 'Planen kunne ikke laves.')}</div>`;
  const s = r.summary;
  const tile = (l, v, sub) => `<div class="stat-tile"><div class="l">${l}</div><div class="v">${v}</div>${sub ? `<div class="d" style="color:var(--label-2)"><small>${sub}</small></div>` : ''}</div>`;
  const series = s.weekly.map((w) => ({ start: w.start, km: w.km }));
  let h = `<div class="section-header" style="margin-top:6px">Forhåndsvisning</div>
    <div class="stat-tiles">${tile('Uger til Transgrancanaria', s.weeksToTransgrancanaria ?? '–', s.tgcDate ? P.fmtDateShort(s.tgcDate) : '')}
      ${tile('Uger til CPH Marathon', s.weeksToMarathon ?? '–', s.marDate ? P.fmtDateShort(s.marDate) : '')}
      ${tile('Topuge', s.peak ? `${fmt(s.peak.km, 0)} km` : '–', s.peak ? `uge ${s.peak.week} · ${P.fmtDateShort(s.peak.start)}` : '')}
      ${tile('Længste tur før marathon', s.longBeforeMarathon != null ? `${fmt(s.longBeforeMarathon, 1)} km` : '–', s.longBeforeTransgrancanaria != null ? `før Transgrancanaria: ${fmt(s.longBeforeTransgrancanaria, 1)} km` : '')}
      ${tile('Højdemeter-top', s.elevPeak ? `${fmt(s.elevPeak.m, 0)} m` : '–', s.elevPeak ? `uge ${s.elevPeak.week}` : '')}
      ${tile('Deloads', s.deloads, 'cutback ca. hver 4. uge')}</div>`;
  const g = r.goals;
  if (g) {
    h += `<div class="section-header">Mål-tjek</div><div class="group">${g.milestones.map((m) => `<div class="row"><span class="grow"><span class="title">${m.ok ? '✓' : '✗'} ${esc(m.text)}</span></span></div>`).join('')}</div>`;
    if (g.blockers.length || (r.relaxations && r.relaxations.length)) {
      h += `<div class="section-header">${g.ok ? 'Hvad der bremsede – og løsningen' : 'Hvad der bremser'}</div>
        ${g.blockers.map((b) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(b.text)}</span></div>`).join('')}
        ${r.relaxations && r.relaxations.length ? `<div class="card"><div class="title">${rs && rs.mode === 'cautious' ? 'Mere forsigtig løsning' : 'Foreslået løsning (mindst mulig lempelse)'}</div><ul class="status-reasons" style="margin-top:6px">${r.relaxations.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul></div>` : ''}`;
    }
    h += `<div class="section-header">Vælg tilgang</div>${seg('rsMode', [['goals', 'Hold målene'], ['cautious', 'Forsigtig'], ['strict', 'Strenge regler']], (rs && rs.mode) || 'goals')}
      <div class="section-footer">${rs && rs.mode === 'strict' ? 'Kun reglerne – målene nås ikke, hvis de ikke kan.' : rs && rs.mode === 'cautious' ? 'Marathon-toppen på langtur sænkes hellere end at stige 3 km om ugen.' : 'Målene holdes; den mindst risikable regel lempes først.'}</div>`;
  }
  const lseries = s.weekly.filter((w) => w.long != null).map((w) => ({ start: w.start, km: w.long }));
  if (lseries.length) h += `<div class="section-header">Langtur uge for uge</div><div class="card">${barChart(lseries, 'km', null, false)}</div>`;
  if (r.warnings && r.warnings.length) h += `<div class="section-header">Vær opmærksom</div>${r.warnings.map((w) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(w)}</span></div>`).join('')}`;
  h += `<div class="section-header">Km pr. uge</div><div class="card">${barChart(series, 'km', null, false)}</div>
    <details class="card" style="margin-top:12px" open><summary class="title" style="cursor:pointer;min-height:32px">Alle uger</summary><table class="perf" style="margin-top:8px"><thead><tr><th>Uge</th><th>Fra</th><th>Km</th><th>Langtur</th><th>Hm</th></tr></thead><tbody>
      ${s.weekly.map((w) => `<tr><td>${w.week}${w.deload ? ' ·&nbsp;D' : ''}${w.race ? ' 🏁' : ''}</td><td>${P.fmtDateShort(w.start)}</td><td><b>${fmt(w.km, 1)}</b></td><td>${w.long != null ? fmt(w.long, 1) : ''}${w.longElev ? ` <small>(${fmt(w.longElev, 0)} hm)</small>` : ''}</td><td>${w.elev ? fmt(w.elev, 0) : ''}</td></tr>`).join('')}</tbody></table></details>`;
  const sw = r.weeks.find((w) => w.start === r.startMonday);
  if (sw) h += `<div class="section-header">${rs && rs.start > r.startMonday ? 'Startugen' : 'Første uge'}</div><div class="group">${sw.days.filter((d) => d.date >= (rs ? rs.start : r.startMonday)).map((d) => `<div class="row"><span class="grow"><span class="title">${P.fmtWeekday(d.date)} ${P.fmtDateShort(d.date)}</span><span class="meta" style="display:block">${d.items.map((i) => (i.kind === 'run' ? `${i.type === 'long' ? 'Langtur' : i.type === 'quality' ? 'Kvalitet' : 'Rolig'} ${fmt(i.km, 1)} km` : i.kind === 'strength' ? `${i.session} · ${i.exercises.length} øvelser` : 'Hvile')).join(' + ')}</span></span></div>`).join('')}</div>`;
  h += `<div class="card" style="margin-top:16px"><div class="title">Erstatter: ${esc((rs && rs.replacing) || 'Oprindelig plan')}</div><div class="meta" style="margin-top:4px">Den bliver gemt under Planversioner, så du kan gå tilbage til den (eller fortryde lige efter).</div></div>
    <button class="btn filled block" style="margin-top:12px" data-act="rsSave">${icon('check')}Gem som ny planversion</button>
    <div class="section-footer">Der gemmes ikke noget, før du trykker. Din log og alle rekorder bevares.</div>`;
  return h;
}

// ---------- Versioner ----------
export function versionsHTML(versions, activeId) {
  const back = `<button class="link-btn back-link" data-act="planBack">${icon('left')}Plan</button>`;
  let h = `${back}<h1 class="large-title" style="margin-top:0">Planversioner</h1>`;
  h += `<div class="group"><button class="row tappable" data-act="verOriginal"><span class="grow"><span class="title">Oprindelig plan</span><span class="meta" style="display:block">Skabelonen fra start</span></span>${!activeId ? icon('check') : ''}</button>
    ${versions.map((v) => `<div class="row"><span class="grow"><span class="title">${esc(v.label)}</span><span class="meta" style="display:block">Gemt ${new Date(v.updated_at).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })} · start ${P.fmtDateShort(v.start_date)}${v.summary && v.summary.peak ? ` · topuge ${fmt(v.summary.peak.km, 0)} km` : ''}</span></span>
      ${v.id === activeId ? '<span class="chip run">I brug</span>' : `<button class="btn" data-act="verUse" data-id="${esc(v.id)}">Brug</button>`}
      <button class="nav-btn" data-act="verDelete" data-id="${esc(v.id)}" aria-label="Slet version">${icon('trash')}</button></div>`).join('')}</div>
    <div class="section-footer">Vælger du en anden version, ændres kun planen fremover. Din log og dine rekorder ligger uændret.</div>`;
  return h;
}

// ---------- Tilpas ugen ----------
const runLabel = (i) => (i.strides_day ? 'Rolig + strides' : i.type === 'long' ? 'Langtur' : i.type === 'quality' ? (i.test ? '5 km-test' : 'Kvalitet') : i.type === 'hills' ? 'Bakke' : i.type === 'race' ? 'Race' : 'Rolig');
export function weekEditorHTML(st, c) {
  const { days, type, floor, perWeek } = st;
  const wd = (d) => P.fmtWeekday(d.date);
  const busy = ['busy', 'exam', 'trip', 'sick'].includes(type);
  let h = `<div class="subtitle" style="margin:2px 0 10px">Uge ${c.weekNo} · ${P.fmtDateShort(days[0].date)} – ${P.fmtDateShort(days[6].date)}</div>
    <div class="section-header" style="margin-top:6px">Ugetype</div>${seg('weType', PL.WEEK_TYPES.filter(([v]) => v !== 'back'), type)}
    
    <div class="section-footer">${type === 'sick' ? 'Syg: alt fjernes. Når ugen er slut, foreslår appen "Tilbage efter pause".' : busy ? 'Travl/eksamen/rejse: ca. 60 % løbevolumen, ingen intervaller og 2 styrkepas (Upper + Lower). Prioritet: ' + P.PRIORITY_TEXT + ' – det laveste fjernes først.' : 'Flyt, slet, ret km eller tilføj pas herunder.'}</div>`;
  const warns = [...c.violations.map((v) => `Regelbrud: ${v}`), ...c.blocked.map((d) => { const its = (days.find((x) => x.date === d) || { items: [] }).items.filter((i) => i.kind !== 'rest'); return `${P.fmtWeekday(d)} ${P.fmtDateShort(d)} er markeret som utilgængelig, men har pas (${its.map((i) => `${i.kind === 'run' ? runLabel(i) : i.session}: ${P.priorityLabel(i)}`).join(', ')})`; })];
  if (warns.length) h += `<div class="section-header">Advarsler</div>${warns.map((w) => `<div class="warn" style="margin-bottom:8px">${icon('warn')}<span>${esc(w)}</span></div>`).join('')}${c.blocked.length ? `<button class="btn block" style="margin-top:6px" data-act="weTidy">${icon('move')}Flyt pas væk fra utilgængelige dage</button><div class="section-footer">Pas med højest prioritet flyttes først, og det laveste prioriterede udgår først: ${esc(P.PRIORITY_TEXT)}.</div>` : ''}`;
  for (const d of days) {
    const past = d.date < floor, kind = c.travel[d.date];
    h += `<div class="section-header"><span>${wd(d)} ${P.fmtDateShort(d.date)}${d.date === c.today ? ' · I dag' : ''}</span><span>${kind === 'fly' ? '✈ flyvedag' : kind === 'off' ? '⛔ optaget' : kind === 'hotel' ? '🛏 hotel' : c.blockedWd.includes(Number(P.parseISO(d.date).getDay())) ? '⛔ fast fridag' : ''}</span></div>`;
    h += `<div class="group">`;
    const real = d.items.filter((i) => i.kind !== 'rest');
    if (!real.length) h += `<div class="row"><span class="grow meta">${esc((d.items[0] && d.items[0].description) || 'Hvile')}</span></div>`;
    real.forEach((it) => {
      const idx = d.items.indexOf(it);
      const title = it.kind === 'run' ? `${runLabel(it)} ${fmt(it.km, 1)} km` : it.session;
      h += `<div class="row we-item${past ? ' past' : ''}"><span class="grow"><span class="title">${esc(title)}</span><span class="meta" style="display:block">${it.kind === 'run' ? esc(P.zoneText(it.zone, c.config) || it.zone || '') : `${it.exercises.length} øvelser`}</span></span>`;
      if (!past) {
        if (it.kind === 'run' && it.type !== 'race') h += `<span class="we-km"><button class="btn" data-act="weKm" data-day="${d.date}" data-idx="${idx}" data-d="-1" aria-label="1 km mindre">−</button><button class="btn" data-act="weKm" data-day="${d.date}" data-idx="${idx}" data-d="1" aria-label="1 km mere">+</button></span>`;
        if (!(it.kind === 'run' && it.type === 'race')) {
          h += `<select class="inline-select" data-we-move data-day="${d.date}" data-idx="${idx}" aria-label="Flyt til"><option value="">Flyt …</option>${days.filter((x) => x.date !== d.date && x.date >= floor).map((x) => `<option value="${x.date}">${P.fmtWeekday(x.date)}</option>`).join('')}</select>`;
          h += `<button class="nav-btn" data-act="weDel" data-day="${d.date}" data-idx="${idx}" aria-label="Slet pas">${icon('trash')}</button>`;
        }
      }
      h += `</div>`;
    });
    if (!past) h += `<div class="row"><select class="inline-select" data-we-add data-day="${d.date}" aria-label="Tilføj pas"><option value="">+ Tilføj pas …</option>${c.addOptions.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></div>`;
    h += `</div>`;
  }
  return h;
}

// ---------- Tilbage efter pause ----------
export function pauseCardHTML(p, { compact = false } = {}) {
  const why = p.reason === 'sick' ? 'Ugen med sygdom er slut' : `Du har holdt pause i ${p.days} dage`;
  return `<div class="card adapt-banner" ${compact ? 'style="margin-top:12px"' : ''}><div class="session-head"><span class="badge-ic k-strength">${icon('refresh')}</span><div class="grow"><h3>Tilbage efter pause</h3>
    <div class="meta">${why} – vil du tilpasse?</div></div></div>
    <div class="meta" style="margin:8px 0 10px">Forslag: 1–2 uger kun rolige løb (ca. 70 % af din sidste normale uge), og styrke med RIR 3${p.days > 14 ? '. Efter mere end 14 dages pause sænkes startvægtene med ca. 10 %' : ''}.</div>
    <div class="btn-row"><button class="btn filled flex" data-act="pauseOpen">Tilpas</button><button class="btn flex" data-act="pauseDismiss">Ikke nu</button></div></div>`;
}
export function pauseSheetHTML(p, weeks) {
  return `<div class="card" style="margin:4px 0 14px"><div class="title">${p.reason === 'sick' ? 'Efter sygdom' : `${p.days} dages pause`}</div>
      <div class="meta">Tilpasningen gælder fra i dag og lægges som ændring af ugerne. Din plan ellers er uændret.</div></div>
    <div class="section-header">Hvor længe?</div>${seg('pauseWeeks', [['1', '1 uge'], ['2', '2 uger']], String(weeks))}
    <div class="group" style="margin-top:14px">
      <div class="row"><span class="grow"><span class="title">Rolige løb</span><span class="meta" style="display:block">Ca. 70 % af din sidste normale uge (${p.refKm ? `${fmt(p.refKm, 0)} km → ${fmt(p.refKm * 0.7, 0)} km` : 'efter planen'}), ingen intervaller</span></span></div>
      <div class="row"><span class="grow"><span class="title">Styrke</span><span class="meta" style="display:block">Samme pas, RIR 3 (hold igen)</span></span></div>
      ${p.days > 14 ? `<div class="row"><span class="grow"><span class="title">Startvægte</span><span class="meta" style="display:block">Ca. 10 % lavere end sidst på ${p.weights} øvelser</span></span></div>` : ''}</div>`;
}

// ---------- Opdatér ur og kalender ----------
export function planSyncHTML(c) {
  return `<div class="section-header" style="margin-top:6px">Det nemme</div>
    <div class="card"><div class="title">Lad Mac'en gøre det</div><div class="meta" style="margin:4px 0 10px">Næste gang Mac'en henter fra Garmin (kl. 07:30 og derefter hver 2. time), opdaterer den uret og kalenderfilen med den nye plan fra ${esc(P.fmtDateShort(c.from))}.</div>
      <button class="btn filled block" data-act="planSyncMac" ${c.queued ? 'disabled' : ''}>${icon('check')}${c.queued ? 'Står i kø – Mac\'en opdaterer næste gang' : 'Opdatér ved næste hentning'}</button></div>
    <div class="section-header">Selv i Kalender</div>
    <div class="card"><div class="meta" style="margin-bottom:10px">Hent en ny kalenderfil med den nuværende plan. Åbn den, og vælg "Tilføj alle" – pas, du har fra før, opdateres i stedet for at blive til dubletter.</div>
      <button class="btn block" data-act="icsDownload">${icon('calendar')}Hent kalenderfil (.ics)</button></div>
    <div class="section-header">Garmin-uret manuelt</div>
    <div class="card"><div class="meta" style="margin-bottom:8px">Kør på Mac'en, hvis du vil have det med det samme:</div>
      <pre class="cmd">bash scripts/garmin.sh clear --fra ${esc(c.from)}\nbash scripts/garmin.sh push --uger 2</pre></div>`;
}

// ---------- Hybrid-regler ----------
const RULE_TEXT = [
  ['Intet kvalitetspas eller langtur inden for 48 timer efter Lower', 'Benene skal være friske til de hårde løbepas. 72 timer før langturen foretrækkes (Lower onsdag, langtur lørdag).'],
  ['Lower ligger dagen efter kvalitetspasset', 'Så ligger de hårde dage samlet. Aldrig 1–2 dage før kvalitet eller langtur. Samme dag om eftermiddagen er en indstilling (se herunder).'],
  ['Kort rolig tur på Lower-dagen er valgfri', 'Markeret "valgfri" i planen: 3–5 km, kun hvis du er frisk.'],
  ['Ca. 80 % af løbet i Z1–Z2', 'Statistik → Løb viser fordelingen pr. uge og advarer, hvis under 70 % er roligt.'],
  ['Kvalitet og langtur fjernes aldrig for at få km til at passe', 'Er der for lidt tid eller for få km, justeres de rolige ture først.'],
  ['Prioritet i pressede uger', 'Langtur → kvalitet → Lower → Upper (man) → rolige ture → Upper (fre). Det laveste fjernes først (Tilpas ugen, Utilgængelige dage, sygdom).'],
];
export function hybridHTML(r, viol) {
  const back = `<button class="link-btn back-link" data-act="planBack">${icon('left')}Plan</button>`;
  let h = `${back}<h1 class="large-title" style="margin-top:0">Hybrid-regler</h1><div class="subtitle">De seks regler bruges af "Flyt pas", "Tilpas ugen", genstart, programmer og advarsler</div>
    <div class="group">${RULE_TEXT.map(([t, d], i) => `<div class="row"><span class="grow"><span class="title">${i + 1}. ${esc(t)}</span><span class="meta" style="display:block">${esc(d)}</span></span></div>`).join('')}</div>
    <div class="section-header">Indstilling til regel 2</div><div class="group"><label class="row"><span class="grow"><span class="title">Lower må ligge samme dag som kvalitetspasset</span><span class="meta" style="display:block">Om eftermiddagen, mindst 6 timer efter løbet.</span></span><span class="switch"><input type="checkbox" data-hy-same ${r.lowerSameDay ? 'checked' : ''}><span></span></span></label></div>
    <div class="section-header">Din plan fremover</div>`;
  h += viol.length ? `<div class="card"><div class="title">${viol.length} regelbrud i de kommende uger</div><ul class="status-reasons" style="margin-top:6px">${viol.slice(0, 6).map((v) => `<li>${esc(v)}</li>`).join('')}${viol.length > 6 ? `<li>… og ${viol.length - 6} flere</li>` : ''}</ul>
    <button class="btn filled block" style="margin-top:12px" data-act="hyRepair">${icon('move')}Ret dem ved at bytte dage</button></div>`
    : `<div class="card"><div class="title">✓ Ingen regelbrud i de kommende uger</div></div>`;
  return h;
}
