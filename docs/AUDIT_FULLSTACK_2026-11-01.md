# Audit technique et UX — Dolina Darts Club
**Date :** 1er novembre 2026  
**Base auditée :** `main`, commit `c705550f26197f061864ec82b0c65ef49f0caed6`  
**Branche dédiée :** `chore/fullstack-audit-optimization`  
**Règle de travail :** pas de changement des règles sportives, scoring, droits, états métiers ou données sans accord explicite.

## 1. Périmètre et limites

Analyse statique de tous les fichiers du dépôt, lecture ciblée des modules JS/SQL et de la documentation, contrôle des fichiers HTML, examen visuel des pages publiques sur Edge headless en vues mobile 390 px et desktop 1440 px, contrôle des processus GitHub Actions et exécution des tests JS présents.

**Non audité sur la base réelle :** les schémas et policies réellement déployés, les index et logs PostgreSQL, les extensions, les rôles/permissions Supabase, les flux connectés (membre, capitaine, administrateur), les données sportives persistées et l'exécution des 34 tests de base. Le connecteur Supabase courant ne liste pas le projet décrit dans `assets/js/config.js` (référence `zygebzwobnxutowiqgxk`).

Les constats issus de SQL du dépôt ne prouvent pas que la production exécute exactement la même définition. Les risques indiqués ci-dessous ne sont pas des preuves d'exploitation.

## 2. État actuel confirmé

- Site : https://dolinadartsclub.github.io/Site_Dolina/ ; hébergement statique GitHub Pages ; données, sessions et RPC Supabase.
- 30 pages HTML ; 56 fichiers JavaScript dans `assets/js` (environ 897 Ko source, dont bibliothèque QR), 1 CSS d'environ 215 Ko (2 737 lignes), 67 scripts SQL numérotés de 001 à 068 avec absence de 010.
- Module le plus volumineux : `assets/js/tournoi.js` ~144 Ko ; `feuille.js` ~52 Ko ; `app.js` ~46 Ko ; `admin.js` ~43 Ko. Ce sont les tailles des fichiers source, **pas** une mesure de charge réseau par page.
- Audit HTML : 26/30 pages sans métadescription, 30/30 sans lien canonical ; 9 fichiers sans H1 statique (plusieurs H1 sont probablement injectés dynamiquement), 5 fichiers avec plusieurs H1. Aucun ID HTML dupliqué, aucun chemin local inexistant dans les références simples analysées, aucun `img` sans attribut `alt` et aucun lien `target=_blank` sans `noopener` détecté.
- `sw.js` : 93 entrées précachées, une entrée dupliquée (`assets/js/cible.js`), couverture de tous les JS et HTML scannés.
- Validation JS : les 56 fichiers passent `node --check`.
- Tests locaux : `test-x01` 18/18, `test-dartbot` 45/45, `test-compter` 25/25, `test-echauffement` 20/20, `test-pentadarts` 64/64. **172/172 PASS**.
- Les workflows GitHub Actions récents réussissent ; toutefois la CI ne lance que `test-x01.mjs` avant la publication.
- Les principaux écrans publics observés sur 390 et 1440 px restent lisibles ; aucun débordement de largeur globale reproduit dans les trois pages vérifiées. Le carrousel des actualités peut déborder localement son viewport, intentionnellement, sans élargir le document.

## 3. Constats prioritaires

### A — Contrôle automatisé de publication insuffisant (confirmé, priorité élevée)
**Source :** `.github/workflows/publier-site.yml`. Le pipeline exécute uniquement `node outils/test-x01.mjs`. Les 154 autres cas couverts par les suites existantes ne sont pas un garde-fou CI. La syntaxe des fichiers JS n'est pas validée avant déploiement.
**Action sans changement métier :** exécuter les cinq suites, `node --check`, puis ajouter un contrôle statique des références HTML/PWA et une étape de smoke test. Une erreur bloque la publication.

### B — Pages Tournois invisibles pour les visiteurs (constat fonctionnel, décision métier requise)
**Source :** `assets/js/tournois.js` `init()`. Quand `profilConnecte()` est nul, la fonction retourne immédiatement avant `chargerDerniers()`. La rubrique publique « Derniers tournois du club » n'est donc jamais chargée depuis cette page pour un visiteur, contrairement au texte de cette page et à l'objectif de visibilité publique. Reproduit en navigation visiteur.
**Action :** soumettre cet écart au responsable du club ; correction isolée seulement après validation, car elle touche la visibilité voulue.

### C — Sécurité : accès réel à Supabase non vérifiable (bloquant pour certification backend)
**Source :** scripts SQL et connecteur Supabase. Les migrations contiennent de nombreuses fonctions `SECURITY DEFINER` et politiques RLS ; un audit fiable doit interroger les **définitions actives**. Le client n'expose qu'une clé publiable attendue, et les fonctions SQL inspectées ont plusieurs gardes explicites, notamment `is_admin()`, `auth.uid()` et un trigger `protect_profile_fields` protégeant les rôles.
**Action :** obtenir accès de lecture au projet Supabase du club ; comparer schéma, RLS, ACL `EXECUTE`, fonctions exposées, diagnostics de sécurité/performance et scénarios de chaque rôle. Aucun changement en production avant ces contrôles.

### D — Visibilité des parties privées à clarifier (risque de confidentialité au niveau SQL source)
**Source :** `supabase/001_schema.sql`, policy `games_select`. Elle autorise la lecture des parties marquées `private` à **tout membre actif**, via `visibility = 'public' OR is_active_member()`. Les policies des joueurs/volées dépendent de la visibilité de la partie. La fonctionnalité « privée » peut ne signifier que « cachée au public », mais si la confidentialité devait être « visible aux participants uniquement », la policy ne correspond pas.
**Action :** confirmer la sémantique avec le club, vérifier les règles actives et effectuer des tests inter-comptes. Ne pas modifier les politiques sans validation, sous peine d'affecter scores/statistiques.

### E — Authentification : mots de passe provisoires faibles et dépendance aux tables internes (risque confirmé dans le code)
**Sources :** `supabase/035_comptes_sans_email.sql` et `038_mot_de_passe_provisoire.sql`. Des codes de seulement six caractères sont acceptés ; certaines fonctions privilégiées modifient directement `auth.users`/`auth.identities`. Les fonctions inspectées vérifient `is_admin()`, mais la robustesse et la compatibilité future méritent un traitement prioritaire.
**Action :** augmenter les exigences de génération et de rotation des codes ; étudier un flux serveur utilisant l'API d'administration officielle plutôt qu'une écriture SQL directe, avec tests de non-régression. Aucun changement automatique.

### F — PWA : nettoyage des caches trop large (confirmé)
**Source :** `sw.js`. L'activation supprime toutes les clés CacheStorage autres que la version Dolina, même si elles n'appartiennent pas au service worker du club. `cache.addAll(FICHIERS)` rend aussi l'installation sensible au moindre fichier indisponible ; la liste est maintenue manuellement et contient un doublon.
**Action sans changement métier :** ne purger que les caches préfixés Dolina, supprimer le doublon, valider l'intégrité des fichiers précachés et tester install/update/offline sur navigateur.

### G — Structure JS/CSS difficile à maintenir (dette confirmée)
**Sources :** `assets/css/style.css`, `assets/js/tournoi.js`, `assets/js/app.js`. Une seule CSS de 2 737 lignes ; le module tournoi rassemble plus de 2 300 lignes ; nombreux templates `innerHTML` nécessitant une discipline d'échappement. Plusieurs fonctions utilisent bien `esc()`, mais 240 affectations `innerHTML =` demandent une revue ciblée des provenances de données.
**Action :** découper les modules par responsabilité et les feuilles CSS par composant/écran ; consolider les helpers de rendu, limiter les requêtes redondantes et ajouter des tests comparatifs avant/après. Conserver HTML/ES modules/GitHub Pages sans imposer un framework.

### H — Accessibilité de la fenêtre d'accueil à revoir (confirmé par le code)
**Source :** `assets/js/app.js`, fonction `accueilVisiteur`. La modale indique `role=dialog` et `aria-modal=true`, mais le code d'ouverture ne donne pas le focus initial et ne gère pas explicitement l'enfermement du focus, la fermeture clavier ni la restitution du focus. Le premier affichage masque tout le site public.
**Action :** corriger gestion du focus, du clavier et de l'arrière-plan ; évaluer séparément avec le club le coût UX d'une fenêtre imposée, qui relève d'un choix produit.

### I — SEO et robustesse de publication (confirmé)
**Sources :** audit HTML, `outils/generer-partage.mjs`. Absence quasi générale de métadescriptions et de canoniques. Les actualités/tournois affichés par JS se découvrent mal sans rendu client. La préparation du déploiement dépend d'une lecture REST des articles Supabase : une panne de cette API peut faire échouer une publication du site entier. Exécution planifiée toutes les 15 minutes pour les aperçus de partage.
**Action :** ajouter les métadonnées publiques correctes et `noindex` pour pages privées ; gérer gracieusement l'indisponibilité du générateur d'aperçus sans déployer des informations obsolètes ; garder les OG spécifiques aux articles.

## 4. Points positifs à conserver

- Stack gratuite et simple répondant à la contrainte de maintenance du club ; ne pas migrer vers Next.js ou React par réflexe.
- Documentation fonctionnelle détaillée et historique SQL déjà largement structurés.
- Calcul X01, dartbot, jeux d'entraînement testés localement.
- Une couche RLS et des vérifications SQL de rôles existent ; la clé exposée dans le navigateur est une clé publiable, pas une clé de service.
- Bonne cohérence graphique noir/orange, boutons tactiles et navigation basse sur mobile ; points de focus visibles en CSS.
- Échappement HTML `esc()` utilisé régulièrement ; chemins statiques et principaux attributs `alt` contrôlés.

## 5. Plan d'exécution sans changer la logique

| Phase | Travail | Conditions de validation |
|---|---|---|
| P0 — Sécurité et non-régression | Vérifier l'accès Supabase prod et la sémantique des données privées, figer les cas critiques | Matrice de droits approuvée, aucun SQL de production lancé |
| P1 — CI | Exécuter tous les tests JS, contrôle syntaxique, analyse statique et smoke test | Workflow de branche puis PR passe entièrement |
| P1 — Qualité visible | Focus modales, états vides, correctifs CSS régressifs, accessibilité et métadonnées | Desktop + mobile + navigation clavier vérifiés |
| P1 — Architecture légère | Extraire les responsabilités de `tournoi.js`, `app.js`, CSS ; optimiser requêtes | Comparaison fonctionnelle avant/après, scores identiques |
| P2 — PWA et publication | Pré-cache cohérent, scope de suppression de cache, isolation des aperçus sociaux | Installation/mise à jour et déploiement de test vérifiés |
| P2 — Backend évolutif | ACL fonctions, policies, index, performance et auth admin | Tests en environnement isolé, revue avant toute migration |

**Règle de merge :** modifications dans `chore/fullstack-audit-optimization`, revue du diff, tests complets, validation fonctionnelle ; ne jamais fusionner automatiquement dans `main`. 

**État à la rédaction :** audit documentaire uniquement ; aucune logique applicative ou migration SQL modifiée, aucune donnée client manipulée.
