// Notifikationer (Web Push) – klientdelen. Virker på iPhone, når appen er lagt på hjemmeskærmen (iOS 16.4 eller nyere).
const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const permission = () => (supported() ? Notification.permission : 'unsupported');
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const needsInstall = () => /iP(hone|ad|od)/.test(navigator.userAgent) && !isStandalone();

export async function current() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
// Skal kaldes direkte fra et tryk (iOS kræver det)
export async function enable(vapidPublicKey) {
  if (!supported()) throw new Error('Denne browser kan ikke vise notifikationer.');
  if (needsInstall()) throw new Error('På iPhone skal appen først lægges på hjemmeskærmen (Del → Føj til hjemmeskærm).');
  const p = await Notification.requestPermission();
  if (p !== 'granted') throw new Error('Du har ikke givet tilladelse. Du kan ændre det i iPhones Indstillinger → Notifikationer.');
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) });
}
export async function disable() {
  const sub = await current();
  if (sub) await sub.unsubscribe();
  return sub;
}
// Kort, stabilt id for en enhed (endpoint er lang)
export async function subId(sub) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
