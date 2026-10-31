# Site du Dolina Darts Club

Site web du Dolina Darts Club (fléchettes traditionnelles depuis 1984) : actualités, matchs en direct,
scorer X01, statistiques et classement, équipes et feuilles de match CPARD, tournois, ligue interne,
jeux du club et espace d'administration.

- **En ligne** : https://dolinadartsclub.github.io/Site_Dolina/ (GitHub Pages, publié par GitHub Actions)
- **Données, comptes, droits** : Supabase (offre gratuite, région européenne)
- **Code** : HTML, CSS et JavaScript simples, sans outil de compilation

## Documentation

| Document | Contenu |
|---|---|
| [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) | **Documentation de suivi** : architecture, rôles, pages, modules, règles de chaque rubrique, base de données et scripts SQL (avec état d'exécution), publication, tests, procédures pas à pas, sécurité, dépannage, migration, historique |
| [`docs/CAHIER_DES_CHARGES.md`](docs/CAHIER_DES_CHARGES.md) | **Cahier des charges v2** : objectifs, contraintes, fonctionnalités avec statut, règles validées, journal des décisions, feuille de route |
| [`outils/test-base/LISEZMOI.md`](outils/test-base/LISEZMOI.md) | Tests de la base de données en local |

## L'essentiel

- **Organisation** : une page = un fichier `*.html` + son module `assets/js/*.js` ; styles dans
  `assets/css/style.css` ; évolutions de la base dans `supabase/NNN_*.sql` (à exécuter une fois, dans l'ordre,
  dans Supabase › SQL Editor).
- **Publier** : un commit sur `main` suffit ; GitHub Actions teste le scorer puis publie (onglet Actions).
- **Nouveau fichier** : l'appeler avec `?v=__VERSION__` et l'ajouter à la liste de `sw.js`.
- **Tester** : `node outils/test-x01.mjs` (et les autres `outils/test-*.mjs`) ; base complète :
  `bash outils/test-base/tout-tester.sh`.

## Sécurité

- `assets/js/config.js` ne contient que la clé **publique** (`sb_publishable_…`), faite pour être visible.
- La clé **secrète** (`sb_secret_…` ou `service_role`), les mots de passe de la base, SMTP ou FTP ne doivent
  **jamais** apparaître dans ce dépôt (déploiement FTP éventuel : secrets GitHub uniquement).
- Les droits (qui lit, qui écrit) sont contrôlés par la base elle-même (Row Level Security et fonctions SQL).
