const CACHE = 'tabinet-v0.7.9-pages-friend-profile-modal';
const ASSETS = ['./', './index.html', './styles.css?v=079-friend-profile-modal', './rules.js?v=079-friend-profile-modal', './app.js?v=079-friend-profile-modal', './manifest.webmanifest', './icons/icon.svg?v=079-friend-profile-modal'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isAppAsset = /\/(index\.html|styles\.css|app\.js|rules\.js|sw\.js)$/.test(url.pathname);
  const isNavigation = event.request.mode === 'navigate';

  if (isNavigation || isAppAsset) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      }))
  );
});
