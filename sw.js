const CACHE = 'tabinet-v0.7.6-online2';
const ASSETS = ['./', './index.html', './rules.js', './loader.js', './manifest.webmanifest', './icons/icon.svg', './app-01.js','./app-02.js','./app-03.js','./app-04.js','./app-05.js','./style-01.css','./style-02.css','./style-03.css','./style-04.css'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {}); return response;
  }).catch(() => caches.match('./index.html'))));
});