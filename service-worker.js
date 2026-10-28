// Gør appen brugbar offline (f.eks. i fitnesscentret).
// data/*.json: network-first (nyeste plan når der er net, ellers den gemte).
// Alt andet: cache-first.
// CACHE_VERSION bumpes automatisk af scripts/deploy.sh ved hvert deploy.
const CACHE_VERSION = 'tp-20261028081328';
// Filer, der gerne må mangle (appen virker uden dem)
const OPTIONAL = ['traeningsplan.ics'];
const SHELL = [
  './',
  'index.html',
  'config.js',
  'manifest.json',
  'css/app.css',
  'css/premium.css',
  'js/app.js',
  'js/plan.js',
  'js/tune.js',
  'js/store.js',
  'js/sync.js',
  'js/icons.js',
  'js/checklists.js',
  'js/quotes.js',
  'js/recovery.js',
  'js/strength.js',
  'js/stats.js',
  'js/statsui.js',
  'js/musclemap.js',
  'js/share.js',
  'js/diag.js',
  'js/adapt.js',
  'js/runstats.js',
  'js/report.js',
  'js/race.js',
  'js/planner.js',
  'js/planui.js',
  'js/ics.js',
  'js/programs.js',
  'js/own.js',
  'js/runprog.js',
  'js/runprogui.js',
  'js/ownui.js',
  'js/programui.js',
  'js/checkin.js',
  'js/actual.js',
  'js/push.js',
  'js/audio.js',
  'js/wake.js',
  'vendor/supabase.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'data/plan.json',
  'data/config.json',
  'data/goals.json',
  'data/quotes.json',
  'data/exercises.json',
  'data/run_types.json',
  'traeningsplan.ics',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION)
      // cache: 'reload' springer browserens HTTP-cache over, så en ny version aldrig får gamle filer med
      .then((c) => Promise.all(SHELL.map((u) => fetch(new Request(u, { cache: 'reload' })).then((r) => { if (!r.ok) throw new Error(u); return c.put(u, r); }).catch((e) => { if (!OPTIONAL.includes(u)) throw e; }))))
      .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase-databasen – altid direkte

  if (/\/data\/[^/]+\.json$/.test(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true })),
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE_VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => (req.mode === 'navigate' ? caches.match('index.html') : undefined))),
  );
});

// ---------- Notifikationer (Web Push) ----------
// iOS kræver, at hver push vises. Er appen åben, vises og lukkes den med det samme (appen bipper selv).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Træningsplan', body: event.data ? event.data.text() : '' }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.some((c) => c.visibilityState === 'visible');
    const tag = data.tag || 'tp';
    await self.registration.showNotification(data.title || 'Træningsplan', {
      body: data.body || '', tag, renotify: true, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: data.url || './' },
    });
    if (open && tag === 'rest') (await self.registration.getNotifications({ tag })).forEach((n) => n.close());
  })());
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) { await wins[0].focus(); return; }
    await self.clients.openWindow((event.notification.data && event.notification.data.url) || './');
  })());
});
