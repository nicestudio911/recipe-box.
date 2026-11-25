// Offline support: keep the app shell cached; recipes live in IndexedDB.
const CACHE = 'recipe-box-v7';
const SHELL = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/js/db.js', '/js/parse-text.js', '/js/i18n.js', '/js/ui.js', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/privacy.html', '/terms.html', '/css/legal.css', '/js/legal.js'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

const put = (req, res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/vendor/')) {
    // Text recognition engine and language files are big and never change: cache first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => put(e.request, res))));
    return;
  }
  // App files: network first so updates show up, cache as fallback when offline
  e.respondWith(fetch(e.request).then(res => put(e.request, res))
    .catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
});
