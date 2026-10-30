// Service worker: caches the app shell so it works offline. Stale-while-revalidate: pages load
// from cache instantly and refresh the cache in the background. Fetches skip the browser's HTTP
// cache (GitHub Pages sends max-age=600), otherwise a "refresh" could re-store the old file for
// ten minutes. Bump CACHE whenever files change so a new worker installs and the app reloads.

const CACHE = 'combo-caller-v5';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'src/app.js',
  'src/audio.js',
  'src/combos.js',
  'src/personalities.js',
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
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
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
    fetch(req, { cache: 'no-cache' }).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }),
  );
  event.waitUntil(network.catch(() => {}));
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || network),
  );
});
