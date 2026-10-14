// "Del": tegner opsummeringen af et pas som et billede (canvas → PNG), som kan gemmes eller deles.
import * as P from './plan.js';
import { bodySVGInline } from './musclemap.js';
import { PR_LABEL } from './stats.js';

const T = { bg: '#1C1C1E', card: '#2C2C2E', text: '#FFFFFF', sub: '#98989D', p: '#FF9F0A', s: '#0A84FF', up: '#30D158', down: '#FF453A', line: '#3A3A3C' };
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const nf = (n, d = 1) => Number(n).toLocaleString('da-DK', { maximumFractionDigits: d });
const hhmm = (min) => (min == null ? '–' : min >= 60 ? `${Math.floor(min / 60)} t ${String(min % 60).padStart(2, '0')} min` : `${min} min`);

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
const setLine = (s) => `${s.kg ? `${nf(s.kg)}${s.perHand ? ' pr. hånd' : ''}` : 'kropsv.'} × ${s.reps}${s.pr.length ? ' 🏅' : ''}`;

// Tegner (eller måler kun, hvis dry) og returnerer den samlede højde
function draw(ctx, d, o, img, dry) {
  const W = 1080, M = 48;
  const minutes = o.minutes ?? d.minutes, start = o.start ?? d.start;
  if (!dry) { ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, ctx.canvas.height); }
  const text = (t, x, y, size, color = T.text, weight = 400, align = 'left') => {
    if (dry) return;
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, x, y);
  };
  text('Træningsplan', W - M, 78, 30, T.sub, 500, 'right');
  text(d.session || 'Styrkepas', M, 92, 68, T.text, 700);
  const clock = start ? new Date(start).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' }) : null;
  text(`${P.fmtDateLong(d.date)}${clock ? ` · kl. ${clock}` : ''}`, M, 142, 34, T.sub);

  // Muskelkort + tal
  const mapW = 520, mapH = Math.round(mapW * 454 / 420), top = 180;
  if (!dry && img) ctx.drawImage(img, M, top, mapW, mapH);
  const tx = 600, tw = W - M - tx;
  const tiles = [['Varighed', hhmm(minutes)], ['Volumen', `${nf(d.volume, 0)} kg`], ['Rekorder', d.prs.length ? `🏅 ${d.prs.length}` : '–']];
  tiles.forEach(([l, v], i) => {
    const y = top + i * 184;
    if (!dry) { ctx.fillStyle = T.card; rrect(ctx, tx, y, tw, 164, 28); ctx.fill(); }
    text(l.toUpperCase(), tx + 28, y + 52, 26, T.sub, 600);
    text(v, tx + 28, y + 122, 60, T.text, 700);
  });
  // Forklaring
  const ly = top + mapH + 14;
  if (!dry) {
    ctx.fillStyle = T.p; ctx.beginPath(); ctx.arc(M + 14, ly + 12, 12, 0, 7); ctx.fill();
    ctx.fillStyle = T.s; ctx.beginPath(); ctx.arc(M + 330, ly + 12, 12, 0, 7); ctx.fill();
  }
  text('Primære muskler', M + 36, ly + 22, 26, T.sub); text('Sekundære muskler', M + 352, ly + 22, 26, T.sub);

  // Rekorder
  let y = ly + 78;
  if (d.prs.length) {
    text('Rekorder', M, y, 34, T.text, 700); y += 20;
    for (const r of d.prs.slice(0, 8)) { y += 42; text(`🏅 ${r.name} · ${PR_LABEL[r.type] || r.type} ${nf(r.type === 'maxReps' ? r.value : Math.round(r.value * 10) / 10, 1)}${r.type === 'maxReps' ? ' reps' : ' kg'}`, M, y, 28, T.sub); }
    y += 52;
  }
  // Øvelser
  text('Øvelser', M, y, 34, T.text, 700); y += 20;
  for (const e of d.exercises) {
    y += 56;
    text(e.name, M, y, 32, T.text, 600);
    if (e.change) text(e.change.text, W - M, y, 30, e.change.kind === 'up' ? T.up : e.change.kind === 'down' ? T.down : T.sub, 700, 'right');
    // sæt, med ombrydning
    ctx.font = `400 28px ${FONT}`;
    let line = '';
    const lines = [];
    for (const s of e.sets) {
      const part = setLine(s);
      const test = line ? `${line}   ${part}` : part;
      if (ctx.measureText(test).width > W - 2 * M && line) { lines.push(line); line = part; } else line = test;
    }
    if (line) lines.push(line);
    for (const l of lines) { y += 40; text(l, M, y, 28, T.sub); }
    y += 14;
    if (!dry) { ctx.fillStyle = T.line; ctx.fillRect(M, y, W - 2 * M, 1); }
  }
  return y + 70;
}

export async function summaryPNG(d, o = {}) {
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    bodySVGInline(d.primary, d.secondary, { bodyFill: '#3A3A3C', stroke: '#636366', base: '#48484A', p: T.p, s: T.s, text: '#98989D' }))).catch(() => null);
  const probe = document.createElement('canvas').getContext('2d');
  probe.canvas.width = 1080; probe.canvas.height = 10;
  const H = draw(probe, d, o, img, true);
  const c = document.createElement('canvas'); c.width = 1080; c.height = H;
  const ctx = c.getContext('2d');
  draw(ctx, d, o, img, false);
  ctx.font = `500 24px ${FONT}`; ctx.fillStyle = T.sub; ctx.textAlign = 'right'; ctx.fillText('Lavet i Træningsplan', 1080 - 48, H - 26);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Kunne ikke lave billedet'))), 'image/png'));
}

// ---------- Ugerapport som billede ----------
export async function reportPNG(r) {
  const W = 1080, M = 48;
  const tiles = [
    ['Løb', `${nf(r.km, 1)} km`, r.plannedKm ? `af ${nf(r.plannedKm, 1)} planlagt` : ''],
    ['Højdemeter', `${nf(r.elev, 0)} m`, r.plannedElev ? `af ${nf(r.plannedElev, 0)} planlagt` : ''],
    ['Styrke', `${r.strengthDone} pas`, `${r.sets} sæt · ${nf(r.volume, 0)} kg`],
    ['Rekorder', r.prs ? `🏅 ${r.prs}` : '–', ''],
    ['HRV', r.hrv != null ? `${nf(r.hrv, 0)} ms` : '–', r.hrvPrev != null ? `sidste uge ${nf(r.hrvPrev, 0)}` : ''],
    ['Søvn', r.sleepH != null ? `${nf(r.sleepH, 1)} t` : '–', r.rhr != null ? `hvilepuls ${nf(r.rhr, 0)}` : ''],
  ];
  const probe = document.createElement('canvas').getContext('2d');
  const wrap = (ctx, text, maxW) => { const out = []; let line = ''; for (const w of text.split(' ')) { const t = line ? `${line} ${w}` : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; };
  const draw = (ctx, dry) => {
    const text = (t, x, y, size, color = T.text, weight = 400, align = 'left') => { if (dry) return; ctx.font = `${weight} ${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, x, y); };
    if (!dry) { ctx.fillStyle = T.bg; ctx.fillRect(0, 0, W, ctx.canvas.height); }
    text('Træningsplan', W - M, 78, 30, T.sub, 500, 'right');
    text(r.week ? `Uge ${r.week}` : 'Ugerapport', M, 92, 68, T.text, 700);
    text(`${P.fmtDateShort(r.start)} – ${P.fmtDateShort(r.end)}${r.phase ? ` · ${r.phase}` : ''}${r.deload ? ' · deload' : ''}`, M, 142, 34, T.sub);
    const tw = (W - 2 * M - 24) / 2;
    tiles.forEach(([l, v, sub], i) => {
      const x = M + (i % 2) * (tw + 24), y = 190 + Math.floor(i / 2) * 200;
      if (!dry) { ctx.fillStyle = T.card; rrect(ctx, x, y, tw, 176, 28); ctx.fill(); }
      text(l.toUpperCase(), x + 28, y + 52, 26, T.sub, 600); text(v, x + 28, y + 118, 58, T.text, 700); text(sub, x + 28, y + 158, 26, T.sub);
    });
    let y = 190 + 3 * 200 + 40;
    ctx.font = `400 30px ${FONT}`;
    for (const ln of r.lines) for (const l of wrap(ctx, ln, W - 2 * M)) { y += 44; text(l, M, y, 30, T.text); }
    y += 40;
    return y + 60;
  };
  probe.canvas.width = W; probe.canvas.height = 10;
  const H = draw(probe, true);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); draw(ctx, false);
  ctx.font = `500 24px ${FONT}`; ctx.fillStyle = T.sub; ctx.textAlign = 'right'; ctx.fillText('Lavet i Træningsplan', W - M, H - 26);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Kunne ikke lave billedet'))), 'image/png'));
}
