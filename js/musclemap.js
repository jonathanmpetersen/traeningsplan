// Egen, enkel muskelfigur (stiliseret – forfra og bagfra) tegnet som inline SVG.
// Hvert muskelområde er en gruppe med data-m="<id>", så et tryk kan åbne detaljer.
// intensity: { muskel-id: 0..1 } styrer farvestyrken (orange, som styrke i resten af appen).

export const MUSCLES = [
  { id: 'chest', label: 'Bryst' },
  { id: 'delt_front', label: 'Forreste skulder' },
  { id: 'delt_side', label: 'Side-skulder' },
  { id: 'delt_rear', label: 'Bageste skulder' },
  { id: 'biceps', label: 'Biceps' },
  { id: 'triceps', label: 'Triceps' },
  { id: 'forearms', label: 'Underarme' },
  { id: 'abs', label: 'Mave' },
  { id: 'lats', label: 'Lats / øvre ryg' },
  { id: 'lower_back', label: 'Lænd' },
  { id: 'glutes', label: 'Baller' },
  { id: 'quads', label: 'Forlår' },
  { id: 'hamstrings', label: 'Baglår' },
  { id: 'calves', label: 'Lægge' },
];
export const MUSCLE_LABEL = Object.fromEntries(MUSCLES.map((m) => [m.id, m.label]));

// Form: e = ellipse [cx, cy, rx, ry, rotation], p = sti, r = afrundet rektangel [x, y, w, h, radius].
// mirror: true tegner også en spejlvendt udgave (højre side).
const FRONT = {
  chest: { mirror: true, shapes: [{ p: 'M99 70 C88 67 76 69 68 79 C63 91 69 105 84 110 C92 112 98 110 99 107 Z' }] },
  delt_front: { mirror: true, shapes: [{ e: [62, 77, 10, 13, 0] }] },
  delt_side: { mirror: true, shapes: [{ e: [51, 83, 6.5, 12, -8] }] },
  biceps: { mirror: true, shapes: [{ e: [53, 118, 8, 20, -4] }] },
  forearms: { mirror: true, shapes: [{ e: [47, 170, 7, 28, -3] }] },
  abs: { mirror: false, shapes: [{ r: [88, 114, 24, 74, 9] }] },
  quads: { mirror: true, shapes: [{ e: [84, 264, 15, 48, 2] }] },
  calves: { mirror: true, shapes: [{ e: [83, 362, 9, 32, 0] }] },
};
const BACK = {
  delt_rear: { mirror: true, shapes: [{ e: [62, 77, 10, 12, 0] }] },
  delt_side: { mirror: true, shapes: [{ e: [51, 83, 6.5, 12, -8] }] },
  triceps: { mirror: true, shapes: [{ e: [53, 118, 8, 20, -4] }] },
  forearms: { mirror: true, shapes: [{ e: [47, 170, 7, 28, -3] }] },
  lats: { mirror: true, shapes: [{ p: 'M99 60 L80 69 L99 94 Z' }, { p: 'M97 92 L74 88 C69 110 77 138 92 160 L97 156 Z' }] },
  lower_back: { mirror: false, shapes: [{ r: [89, 160, 22, 34, 8] }] },
  glutes: { mirror: true, shapes: [{ e: [86, 215, 15, 17, 0] }] },
  hamstrings: { mirror: true, shapes: [{ e: [84, 272, 14, 44, 1] }] },
  calves: { mirror: true, shapes: [{ e: [83, 362, 10, 32, 0] }] },
};

// Kropssilhuet (venstre halvdel spejles til højre)
const HALF = [
  'M62 62 Q99 55 99 55 L99 226 L70 226 Q74 212 76 198 Q75 160 68 122 Z', // torso
  'M60 64 Q46 68 44 92 L40 142 L37 206 Q39 216 48 215 L55 212 L59 152 L65 102 Z', // arm
  'M70 226 L99 226 L97 300 L94 332 L92 410 L86 426 L73 426 L74 410 L75 332 L72 300 Z', // ben
];

const shapeEl = (s, extra = '') => {
  if (s.e) { const [cx, cy, rx, ry, rot] = s.e; return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''}${extra}/>`; }
  if (s.r) { const [x, y, w, h, r] = s.r; return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"${extra}/>`; }
  return `<path d="${s.p}"${extra}/>`;
};
const mirrored = (inner) => `<g transform="translate(200 0) scale(-1 1)">${inner}</g>`;

function figure(defs, o, ox, label) {
  const { intensity, secondary, selected, interactive, inline } = o;
  const bodyAttr = inline ? ` fill="${inline.bodyFill}" stroke="${inline.stroke}" stroke-width="1"` : '';
  const silhouette = `<g class="mm-body"${bodyAttr}>${HALF.map((d) => `<path d="${d}"/>`).join('')}${mirrored(HALF.map((d) => `<path d="${d}"/>`).join(''))}
    <circle cx="100" cy="27" r="17"/><rect x="92" y="42" width="16" height="14" rx="5"/></g>`;
  let muscles = '';
  for (const [id, def] of Object.entries(defs)) {
    const v = Math.max(0, Math.min(1, intensity[id] || 0));
    const v2 = v > 0 ? 0 : Math.max(0, Math.min(1, secondary[id] || 0));
    const draw = () => def.shapes.map((sh) => shapeEl(sh)).join('');
    const body = def.mirror ? draw() + mirrored(draw()) : draw();
    const attrs = interactive ? ` data-act="muscle" data-m="${id}" role="button" tabindex="0" aria-label="${MUSCLE_LABEL[id]}"` : ` aria-label="${MUSCLE_LABEL[id]}"`;
    const cls = `mm-m${selected === id ? ' sel' : ''}${v > 0 ? ' hot' : v2 > 0 ? ' hot2' : ''}`;
    const vv = v > 0 ? 0.22 + 0.78 * v : v2 > 0 ? 0.35 + 0.65 * v2 : 0;
    let paint = '';
    if (inline) {
      const col = v > 0 ? inline.p : v2 > 0 ? inline.s : inline.base;
      paint = ` fill="${col}" fill-opacity="${v > 0 || v2 > 0 ? vv.toFixed(2) : 1}" stroke="${v > 0 ? inline.p : v2 > 0 ? inline.s : inline.stroke}" stroke-width=".8"`;
    }
    muscles += `<g class="${cls}"${attrs}${paint} style="--v:${vv.toFixed(2)}">${body}</g>`;
  }
  const textAttr = inline ? ` fill="${inline.text}" font-size="12" font-family="-apple-system, system-ui, sans-serif"` : '';
  return `<g transform="translate(${ox} 0)">${silhouette}${muscles}<text class="mm-label" x="100" y="446" text-anchor="middle"${textAttr}>${label}</text></g>`;
}

// intensity: { id: 0..1 } (orange). secondary: { id: 0..1 } (blå, bruges til muskler uden primær intensitet).
export function bodySVG(intensity = {}, { selected = null, interactive = true, secondary = {} } = {}) {
  const o = { intensity, secondary, selected, interactive };
  return `<svg class="musclemap" viewBox="0 0 420 454" role="group" aria-label="Muskelkort forfra og bagfra">${figure(FRONT, o, 0, 'Forfra')}${figure(BACK, o, 220, 'Bagfra')}</svg>`;
}
// Selvstændig udgave med faste farver (til billede/PNG, hvor CSS-variabler ikke findes)
export function bodySVGInline(primary, secondary, theme) {
  const inten = Object.fromEntries([...primary].map((id) => [id, 1]));
  const sec = Object.fromEntries([...secondary].map((id) => [id, 1]));
  const o = { intensity: inten, secondary: sec, selected: null, interactive: false, inline: theme };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 454" width="840" height="908">${figure(FRONT, o, 0, 'Forfra')}${figure(BACK, o, 220, 'Bagfra')}</svg>`;
}
