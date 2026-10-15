# Site du Dolina Darts Club

Site web du Dolina Darts Club : actualités, matchs en direct, scorer X01, statistiques et classement.

- **Site** : hébergé gratuitement par GitHub Pages (dossier racine de la branche `main`).
- **Données, comptes, droits** : Supabase (offre gratuite, région européenne).
- **Code** : HTML, CSS et JavaScript simples, sans outil de compilation. Chaque fichier peut être lu et modifié directement sur GitHub.

## Organisation des fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Page d'accueil : matchs en cours et actualités |
| `live.html` | Score en direct d'une partie publique |
| `mentions-legales.html` | Mentions légales et politique de confidentialité |
| `inscription.html`, `connexion.html` | Création de compte et connexion |
| `mot-de-passe-oublie.html` | Mot de passe oublié : demande du lien (ou contact du club tant que les emails sont inactifs) |
| `mot-de-passe.html` | Choix d'un nouveau mot de passe (lien reçu par email) |
| `compte.html` | Mon compte : état de validation, équipes, espace capitaine, mot de passe |
| `admin.html` | Administration : inscriptions, membres, rôles, équipes, capitaines et actualités |
| `article.html` | Page d'un article, avec les boutons de partage |
| `bientot.html` | Page d'attente pour les rubriques pas encore ouvertes |
| `assets/css/style.css` | Charte graphique (noir mat, orange, gris) |
| `assets/js/config.js` | Adresse et clé **publique** de Supabase |
| `assets/js/app.js` | Outils communs (connexion à Supabase, calcul du score) |
| `assets/js/accueil.js`, `assets/js/live.js` | Logique de chaque page |
| `manifest.webmanifest`, `sw.js` | Installation du site comme une appli (PWA) |
| `supabase/001_schema.sql` | Création de la base de données et des règles d'accès |
| `supabase/002_premier_admin.sql` | Désignation du premier administrateur |
| `supabase/003_correctif_parties.sql` | Correctif : lien entre parties et joueurs |
| `supabase/004_reinitialiser_mot_de_passe.sql` | Réinitialiser le mot de passe d'un joueur (provisoire, par un admin) |
| `supabase/005_admin.sql` | Administration : suppression de compte, toujours un admin, capitaine membre de son équipe |
| `supabase/006_actualites.sql` | Stockage des images d'actualités (envoi réservé aux admins) |
| `outils/generer-partage.mjs` | Prépare le site et crée une page d'aperçu de partage par article |
| `.github/workflows/publier-site.yml` | Publication automatique du site sur GitHub Pages |
| `supabase/007_profil.sql` | Profil : marque des fléchettes |
| `supabase/emails/` | Modèles d'emails en français à coller dans Supabase |

## Sécurité

- `config.js` ne contient que la clé **publique** (`sb_publishable_…`), faite pour être visible.
- La clé **secrète** (`sb_secret_…` ou `service_role`) ne doit **jamais** apparaître dans ce dépôt.
- Les droits (qui lit, qui écrit) sont contrôlés par la base elle-même (Row Level Security), pas par le site.

## Activer les emails plus tard

Quand l'envoi d'emails fonctionne, passer `EMAILS_ACTIFS` à `true` dans `assets/js/config.js`, puis réactiver « Confirm email » dans Supabase.

## Publication

Le site est publié par GitHub Actions (Settings › Pages › Source : « GitHub Actions ») :
à chaque modification, et toutes les 15 minutes pour créer les aperçus de partage des nouveaux articles
(`a/<id>.html` : titre, texte et photo affichés par LinkedIn, WhatsApp et Facebook).

## Mettre à jour le site

Les fichiers JS et CSS sont appelés avec `?v=__VERSION__` : à chaque publication, GitHub Actions remplace ce mot par un numéro unique, ce qui oblige les navigateurs à recharger les fichiers modifiés. Garder ce suffixe sur tout nouveau fichier.
