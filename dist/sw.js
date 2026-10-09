const CACHE = 'miaou-v1';
const NAV_TIMEOUT_MS = 4000;
const CDN_IMMUTABLE = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.gstatic\.com)\//;
const FONTS_CSS = /^https:\/\/fonts\.googleapis\.com\//;

const RETRY_PARAM = 'miaou-retry';

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate' && req.url.indexOf(self.registration.scope) === 0) {
    e.respondWith(networkFirst(e, req));
    return;
  }
  if (CDN_IMMUTABLE.test(req.url)) { e.respondWith(cacheFirst(req.url)); return; }
  if (FONTS_CSS.test(req.url)) { e.respondWith(staleWhileRevalidate(e, req.url)); return; }
});

function cacheKey(url) {
  const u = new URL(url);
  u.searchParams.delete(RETRY_PARAM);
  return u.href;
}

function fetchCors(url) {
  return fetch(url, { mode: 'cors', credentials: 'omit' });
}

async function networkFirst(e, req) {
  const cache = await caches.open(CACHE);
  const key = self.registration.scope;
  const network = fetch(req);

  e.waitUntil(network.then(function (r) {
    if (r.ok) return cache.put(key, r.clone());
  }).catch(function () {}));
  const timeout = new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, NAV_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;

    const cached = await cache.match(key);
    if (cached) return cached;
    return await network;
  } catch (err) {
    const cached = await cache.match(key);
    return cached || Response.error();
  }
}

async function cacheFirst(url) {
  const cache = await caches.open(CACHE);
  const key = cacheKey(url);
  const cached = await cache.match(key);
  if (cached) return cached;
  try {
    const r = await fetchCors(url);
    if (r.ok) await cache.put(key, r.clone());
    return r;
  } catch (err) {
    return Response.error();
  }
}

async function staleWhileRevalidate(e, url) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(url);
  const refresh = fetchCors(url).then(function (r) {
    if (r.ok) return cache.put(url, r.clone()).then(function () { return r; });
    return r;
  });
  if (cached) { e.waitUntil(refresh.catch(function () {})); return cached; }
  try { return await refresh; } catch (err) { return Response.error(); }
}
