// Service worker: caches the app shell so it works offline. Stale-while-revalidate: pages load
// from cache instantly and refresh the cache in the background, so a deploy shows up on the next
// launch. Bump CACHE when the asset list changes.

const CACHE = 'combo-caller-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'src/app.js',
  'src/audio.js',
  'src/combos.js',
  'src/session.js',
  'src/speech.js',
  'src/storage.js',
  'src/timer.js',
  'src/wakelock.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const network = caches.open(CACHE).then((cache) =>
    fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }),
  );
  event.waitUntil(network.catch(() => {}));
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || network),
  );
});
