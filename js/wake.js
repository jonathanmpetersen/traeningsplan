// Wake Lock: skærmen holdes tændt, mens et pas er åbent (med lille indikator i pas-visningen)
import { icon } from './icons.js';
const $ = (sel) => document.querySelector(sel);
let wakeLock = null, isOpen = () => false;
export function init(openFn) { isOpen = openFn; }
export async function acquire() {
  if (!isOpen()) return;
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; updateAwake(); });
    }
  } catch { wakeLock = null; }
  updateAwake();
}
export function release() { try { if (wakeLock) wakeLock.release(); } catch { /* allerede sluppet */ } wakeLock = null; updateAwake(); }
function updateAwake() {
  const el = $('#woAwake');
  if (!el) return;
  el.hidden = !isOpen();
  el.classList.toggle('off', !wakeLock);
  el.innerHTML = wakeLock ? `${icon('today')}Skærm tændt` : `${icon('rest')}Skærm kan slukke`;
}

