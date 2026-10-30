/* ============================================================
   Pharmacie Simple — Service Worker
   Stratégie (reprise de labo) : RÉSEAU D'ABORD, repli sur le cache.
   En ligne, on a toujours la dernière version ; hors ligne, le
   comptoir s'ouvre quand même avec la dernière version connue.

   À CHAQUE MISE EN LIGNE : changer APP_VERSION et CACHE ici, dans
   js/version.js et dans les « ?v= » de index.html
   (tests/deploiement.test.js vérifie que les trois concordent).
   ============================================================ */

const APP_VERSION = '1.9.1';
const CACHE = 'pharmacie-simple-v11';
const v = (url) => url + '?v=' + APP_VERSION;
const famille = (nom) => nom.replace(/[\d.]+$/, '');

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  v('./css/app.css'),
  v('./vendor/supabase-2.39.7.umd.js'),
  './vendor/fonts/plus-jakarta-sans-latin-var.woff2',
  v('./js/app.js'),
  './js/config.js',
  './js/util.js',
  './js/version.js',
  './js/hors-ligne.js',
  './js/pages/comptoir.js',
  './js/pages/entree.js',
  './js/pages/stock.js',
  './js/pages/inventaire.js',
  './js/pages/journee.js',
  './js/pages/credits.js',
  './js/pages/programmes.js',
  './js/pages/point.js',
  './js/pages/rapport.js',
  './js/pages/base.js',
  './js/pages/reglages.js',
  './js/pages/erreurs.js'
];

self.addEventListener('install', (e) => {
  // Fichier par fichier : un seul échec ne doit pas priver l'application de tout le pré-cache
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  // On ne supprime que les anciens caches de CE site (d'autres sites partagent le domaine github.io)
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== CACHE && famille(k) === famille(CACHE)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // écritures : jamais interceptées
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // base Supabase : toujours le réseau

  const versionne = url.searchParams.has('v');
  // Sans ?v= : requête conditionnelle (ETag → 304) pour ne jamais servir une page périmée
  const reseau = versionne ? fetch(req) : fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });

  e.respondWith(
    reseau
      .then((res) => {
        if (res.ok) {
          const copie = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copie)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const exact = await caches.match(req);
        if (exact) return exact;
        // Un fichier versionné doit correspondre EXACTEMENT : jamais un module d'une autre version
        if (versionne) return Response.error();
        if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
        return (await caches.match(req, { ignoreSearch: true })) || Response.error();
      })
  );
});
