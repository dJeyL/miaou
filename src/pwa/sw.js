// sw.js — service worker de MIAOU servi en http(s) (portée : son dossier, /app/
// derrière le proxy MCP). Copié dans dist/ par build.py, commentaires retirés.
// Stratégie et motifs : docs/pwa.md.
//
// Rôle unique : lancer MIAOU proxy coupé. Il ne sert donc QUE trois familles
// de requêtes, et laisse passer tout le reste sans y toucher — appels au
// backend LLM (SSE), POST /mcp, version.json, manifeste, icônes. Ne pas
// appeler respondWith hors de ces familles : un flux SSE relayé par le worker
// peut se bloquer, et une requête non GET n'a rien à faire dans un cache.
//
//   1. Navigation dans la portée : réseau d'abord, cache en repli. Le délai
//      NAV_TIMEOUT_MS borne l'attente d'un proxy qui pend (LAN) ; une
//      connexion refusée échoue tout de suite de toute façon.
//   2. Bibliothèques des CDN : URL versionnées, donc immuables. Cache d'abord,
//      mises en cache au premier usage, aucun préchargement.
//   3. Feuille Google Fonts : URL non versionnée, contenu qui dépend du
//      navigateur. Servie du cache, rafraîchie en arrière-plan.
//
// Les requêtes CDN sont refaites en mode 'cors' : une réponse opaque (no-cors)
// est comptée très au-delà de sa taille dans le quota, partagé avec IndexedDB
// et la détection de stockage plein. Les CDN servis répondent tous
// Access-Control-Allow-Origin: *, et une réponse cors satisfait les <script>
// et <link> no-cors de la page (mesuré).
//
// Aucun nettoyage de cache : les montées de version des tiers sont rares, et
// une ancienne URL versionnée ne coûte que sa place.

const CACHE = 'miaou-v1';
const NAV_TIMEOUT_MS = 4000;
const CDN_IMMUTABLE = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.gstatic\.com)\//;
const FONTS_CSS = /^https:\/\/fonts\.googleapis\.com\//;
// Paramètre que loadCdnScript (ui.js) ajoute pour contourner une requête
// pendue : le réseau voit l'URL réelle, le cache la clé sans lui — sinon chaque
// nouvelle tentative laisserait une entrée de plus, jamais nettoyée.
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

// Une seule entrée pour le HTML, sous la racine de la portée : /app/ et
// /app/miaou.html, ou une URL à paramètres, servent le même document.
async function networkFirst(e, req) {
  const cache = await caches.open(CACHE);
  const key = self.registration.scope;
  const network = fetch(req);
  // Le clone est pris dans un .then enregistré AVANT celui qui rendra la
  // réponse à la page, donc avant toute lecture du corps. waitUntil est appelé
  // tant que respondWith est en attente (seule fenêtre où il est permis hors du
  // gestionnaire) : la mise en cache aboutit même quand c'est le cache qui a
  // répondu après le délai.
  e.waitUntil(network.then(function (r) {
    if (r.ok) return cache.put(key, r.clone());
  }).catch(function () {}));
  const timeout = new Promise(function (resolve) {
    setTimeout(function () { resolve(null); }, NAV_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    // Délai dépassé : le cache s'il existe, sinon on continue d'attendre.
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
