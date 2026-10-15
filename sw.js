// =====================================================================
//  Service worker : rend le site installable et garde une copie des
//  fichiers du site pour un chargement rapide.
//  Les données (scores, actualités) viennent toujours du réseau.
//  __VERSION__ est remplacé automatiquement à chaque publication (GitHub Actions).
// =====================================================================

const VERSION = 'dolina-__VERSION__';
const FICHIERS = [
  './',
  'index.html',
  'live.html',
  'bientot.html',
  'mentions-legales.html',
  'inscription.html',
  'connexion.html',
  'mot-de-passe.html',
  'mot-de-passe-oublie.html',
  'compte.html',
  'admin.html',
  'article.html',
  'jouer.html',
  'scorer.html',
  'corriger.html',
  'assets/css/style.css',
  'assets/js/app.js',
  'assets/js/config.js',
  'assets/js/accueil.js',
  'assets/js/live.js',
  'assets/js/inscription.js',
  'assets/js/connexion.js',
  'assets/js/mot-de-passe.js',
  'assets/js/mot-de-passe-oublie.js',
  'assets/js/compte.js',
  'assets/js/admin.js',
  'assets/js/admin-actus.js',
  'assets/js/article.js',
  'assets/js/x01.js',
  'assets/js/jouer.js',
  'assets/js/scorer.js',
  'assets/js/corriger.js',
  'assets/img/logo.png',
  'assets/img/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Seuls les fichiers du site lui-même passent par le cache
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Réseau d'abord (toujours la dernière version), copie locale si hors ligne
  event.respondWith(
    fetch(event.request)
      .then((reponse) => {
        if (reponse.ok) {
          const copie = reponse.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copie));
        }
        return reponse;
      })
      .catch(() => caches.match(event.request))
  );
});
