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
  'mes-parties.html',
  'tournois.html',
  'equipes.html',
  'records.html',
  'capitaine.html',
  'compter.html',
  'pentadarts.html',
  'echauffement.html',
  'contact.html',
  'stats.html',
  'classement.html',
  'face-a-face.html',
  'profil.html',
  'mes-donnees.html',
  'tournoi.html',
  'feuille.html',
  'tournoi-creer.html',
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
  'assets/js/voix.js',
  'assets/js/dartbot.js',
  'assets/js/cible.js',
  'assets/js/mes-parties.js',
  'assets/js/tournoi-commun.js',
  'assets/js/vendor/qrcode.js',
  'assets/js/tournois.js',
  'assets/js/equipes.js',
  'assets/js/fil.js',
  'assets/js/feuille.js',
  'assets/js/compat.js',
  'assets/js/rappels-ligue.js',
  'assets/js/records.js',
  'assets/js/capitaine.js',
  'assets/js/retard.js',
  'assets/js/logos.js',
  'assets/js/admin-sans-email.js',
  'assets/js/admin-invites.js',
  'assets/js/cap-stats.js',
  'assets/js/recadrage.js',
  'assets/js/pentadarts.js',
  'assets/js/pentadarts-regles.js',
  'assets/js/echauffement.js',
  'assets/js/echauffement-regles.js',
  'assets/js/compter.js',
  'assets/js/compter-calcul.js',
  'assets/js/cible.js',
  'assets/js/ics.js',
  'assets/js/contact.js',
  'assets/js/stats.js',
  'assets/js/classement.js',
  'assets/js/face-a-face.js',
  'assets/js/profil.js',
  'assets/js/profil-commun.js',
  'assets/js/mes-donnees.js',
  'assets/js/admin-demandes.js',
  'assets/js/admin-sauvegarde.js',
  'assets/js/admin-tournois.js',
  'assets/js/admin-matchs.js',
  'assets/js/admin-exports.js',
  'assets/js/tournoi.js',
  'assets/js/tournoi-creer.js',
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
