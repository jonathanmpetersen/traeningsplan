// Fejllog og versionsinfo (vises under Mere → Konto og synkronisering → Om appen).
// Gemmer de seneste fejl lokalt på enheden, så de kan kopieres og sendes, hvis noget går galt.
const KEY = 'tp.errors';
const MAX = 40;
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a.slice(-MAX))); } catch { /* fuld lagring / privat tilstand */ } };

export function log(kind, message, extra) {
  const a = read();
  const msg = String(message || '').slice(0, 300);
  const last = a[a.length - 1];
  if (last && last.kind === kind && last.msg === msg) { last.n = (last.n || 1) + 1; last.t = new Date().toISOString(); write(a); return; }
  a.push({ t: new Date().toISOString(), kind, msg, extra: extra ? String(extra).slice(0, 300) : undefined });
  write(a);
}
export const list = () => read().reverse();
export const clear = () => write([]);
export function asText() {
  return list().map((e) => `${e.t} [${e.kind}]${e.n > 1 ? ` ×${e.n}` : ''} ${e.msg}${e.extra ? ` – ${e.extra}` : ''}`).join('\n') || 'Ingen fejl.';
}

window.addEventListener('error', (ev) => log('fejl', ev.message || 'Ukendt fejl', ev.filename ? `${ev.filename.split('/').pop()}:${ev.lineno}` : ''));
window.addEventListener('unhandledrejection', (ev) => log('løfte', (ev.reason && ev.reason.message) || String(ev.reason)));

// Hvilken version kører, og hvilken er den nyeste udgivne?
export async function versions() {
  const out = { running: null, latest: null };
  try { out.running = (await caches.keys()).filter((k) => k.startsWith('tp-')).sort().pop() || null; } catch { /* ingen cache */ }
  try {
    const t = await (await fetch('service-worker.js', { cache: 'no-store' })).text();
    out.latest = (/CACHE_VERSION = '([^']+)'/.exec(t) || [])[1] || null;
  } catch { /* offline */ }
  return out;
}
// 'tp-20261012202352' → '12/10 kl. 20.23'
export function versionLabel(v) {
  const m = /tp-(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)/.exec(v || '');
  return m ? `${Number(m[3])}/${Number(m[2])} kl. ${m[4]}.${m[5]}` : (v || 'ukendt');
}
