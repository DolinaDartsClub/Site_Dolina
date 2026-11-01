# Documentation du site du Dolina Darts Club

> **Version du 31/10/2026** — état vérifié du dépôt (30 pages, 55 modules JavaScript, scripts SQL 001 à 067).
> Ce document sert au **suivi** du site : ce qu'il fait, comment il est construit, comment le faire évoluer
> sans rien casser. Le **pourquoi** (besoins, règles validées, feuille de route) est dans
> [`CAHIER_DES_CHARGES.md`](CAHIER_DES_CHARGES.md).

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Architecture technique](#2-architecture-technique)
3. [Rôles et droits](#3-rôles-et-droits)
4. [Pages du site](#4-pages-du-site)
5. [Modules JavaScript](#5-modules-javascript)
6. [Fonctionnement détaillé par rubrique](#6-fonctionnement-détaillé-par-rubrique)
7. [Base de données](#7-base-de-données)
8. [Publication et mises à jour](#8-publication-et-mises-à-jour)
9. [Tests automatiques](#9-tests-automatiques)
10. [Procédures courantes (pas à pas)](#10-procédures-courantes-pas-à-pas)
11. [Sécurité](#11-sécurité)
12. [Dépannage et pièges connus](#12-dépannage-et-pièges-connus)
13. [Migration vers dolina.mydarts.org](#13-migration-vers-dolinamydartsorg)
14. [Suivi : à faire et en attente](#14-suivi--à-faire-et-en-attente)
15. [Historique des versions](#15-historique-des-versions)

---

## 1. Vue d'ensemble

| | |
|---|---|
| **Adresse actuelle** | https://dolinadartsclub.github.io/Site_Dolina/ |
| **Adresse prévue** | dolina.mydarts.org (migration en attente, voir § 13) — domaine envisagé à l'origine : dolinadartsclub.fr |
| **Dépôt** | GitHub `DolinaDartsClub/Site_Dolina`, branche `main` |
| **Hébergement des pages** | GitHub Pages (gratuit), publié par GitHub Actions |
| **Données, comptes, droits** | Supabase, offre gratuite, région Europe — projet `zygebzwobnxutowiqgxk` |
| **Coût** | 0 € (hors nom de domaine éventuel) |
| **Contact du club** | dolinadartsclub@gmail.com |
| **Langue / public** | Français, usage surtout sur téléphone ; installable comme une appli (PWA) |

Le site couvre : accueil et actualités, comptes membres, scorer X01 avec matchs en direct, statistiques,
classement et records, équipes et calendrier CPARD, feuille de match officielle CPARD, tournois (poules,
élimination directe, tableaux B), ligue interne et Masters, jeux du club et entraînements, prise de contact,
espace capitaine et espace d'administration.

## 2. Architecture technique

```
 Téléphone / ordinateur (navigateur)
   │  pages HTML + CSS + modules JavaScript (aucune compilation)
   │  servis par GitHub Pages
   ▼
 assets/js/app.js ── client Supabase (clé PUBLIQUE uniquement)
   │
   ▼
 Supabase
   ├─ Auth (comptes, mots de passe)
   ├─ Postgres : tables + règles d'accès RLS + fonctions « RPC » (SECURITY DEFINER)
   ├─ Realtime : matchs en direct, scores live des tournois
   └─ Storage : public-images (actus, logos), photos-profil (privé)
```

**Principes à respecter**

- **Pas d'outil de compilation.** Chaque fichier est lisible et modifiable directement. Modules ES
  (`<script type="module">`), une page = un fichier HTML + un fichier JS.
- **Cache des navigateurs** : tout appel de fichier se fait avec `?v=__VERSION__` (remplacé à chaque
  publication). Tout nouveau fichier doit garder ce suffixe **et** être ajouté à la liste `FICHIERS` de `sw.js`.
- **La sécurité est dans la base**, jamais dans la page : chaque table a la RLS activée ; les opérations
  sensibles passent par des fonctions SQL qui vérifient elles-mêmes les droits (`is_admin()`,
  `is_captain_of()`, `tournoi_organisateur()`, `feuille_peut_gerer()`…).
- **Indicateurs internes** dans les fonctions SQL : `set_config('dolina.interne','oui',true)` permet à une
  fonction autorisée de contourner les verrous des tournois/feuilles ; `dolina.ajout_en_cours` autorise une
  inscription dans un tournoi déjà lancé. Ne jamais les utiliser hors d'une fonction qui a vérifié les droits.
- **Compatibilité** : iOS 14 et plus (fichier `compat.js` chargé avant les modules sur chaque page, qui
  ajoute `Array.at`, `findLast`, `Object.hasOwn`, `replaceAll`, `crypto.randomUUID`, `structuredClone`).
- **Scripts SQL numérotés** (`supabase/NNN_nom.sql`) : chaque évolution de la base est un nouveau script, à
  exécuter **une fois, dans l'ordre**, dans Supabase › SQL Editor. Un script redéfinit les fonctions qu'il
  modifie (la dernière version fait foi).
- **Repli si un script manque** : beaucoup de pages détectent une colonne/fonction absente et fonctionnent
  sans la nouveauté (message de diagnostic pour les admins). Ce n'est pas une raison pour ne pas lancer les scripts.

### Charte graphique

Fond noir mat (`--noir #141414`, cartes `#1e1e1e`), orange (`--orange #f57a00`), gris ; polices Barlow et
Barlow Condensed (titres en majuscules) ; effet « verre » sur cartes et barres. Score Dolina en orange,
adversaire en blanc ; équipe qui reçoit à gauche. Tout est dans `assets/css/style.css` (variables en tête).

## 3. Rôles et droits

| Rôle | Comment on l'obtient | Ce qu'il peut faire |
|---|---|---|
| **Visiteur** | sans compte (choix « Continuer en tant que visiteur », mémorisé 7 jours) | accueil, actus, matchs publics en direct, calendrier des équipes, tournois publics, contact |
| **Inscrit en attente** | crée son compte | se connecter, voir l'état de son compte ; rien de réservé aux membres |
| **Membre** | validé par un admin (`profiles.status = 'active'`) | jouer, stats, classement, records, profils, fil du club, tournois, demander à rejoindre une équipe, sa ligue |
| **Capitaine / vice-capitaine** | désigné par l'admin (le capitaine peut choisir son vice) | gérer son équipe (demandes, retrait d'un joueur), saisir le calendrier et les scores, **feuilles de match**, espace capitaine |
| **Organisateur de tournoi** | crée le tournoi (tout membre) | inscriptions, lancement, formats, corrections, clôture, tableau B |
| **Admin** | `profiles.role = 'admin'` (script 002 pour le premier) | tout : membres, rôles, équipes, actus, demandes, matchs, tournois, sauvegarde, exports, **ligue interne**, **niveaux des joueurs** |

Règles particulières : le dernier admin ne peut pas être retiré ; un capitaine ne gère qu'une équipe ;
les **niveaux** ne sont visibles et modifiables que par les admins ; la **ligue interne** est invisible
pour les non-admins tant que l'admin ne l'a pas ouverte.

## 4. Pages du site

| Page | Rôle | Accès |
|---|---|---|
| `index.html` | Accueil : entraînements, actus (carrousel), prochaines rencontres, résultats, matchs en cours, derniers matchs, tournois, rappels de ligue, « Rejoindre le club » | tous |
| `live.html` | Score en direct d'une partie publique (ardoise, onglets par manche, récap) | tous (lien partageable) |
| `article.html` | Article + partage (WhatsApp, LinkedIn, Facebook, copie) | tous |
| `inscription.html`, `connexion.html` | Création de compte, connexion (email **ou** identifiant) | tous |
| `mot-de-passe-oublie.html`, `mot-de-passe.html` | Mot de passe oublié (demande à l'admin tant que les emails sont inactifs) ; nouveau mot de passe | tous |
| `compte.html` | Mon compte : profil, équipes, saison, rappels de ligue, mot de passe, bandeaux capitaine/admin | connecté |
| `profil.html` | Profil d'un membre (sans `id` : le mien) | membres |
| `mes-donnees.html` | Mes données (RGPD) : consultation, impression/PDF, export | connecté |
| `jouer.html` | Choix des jeux : Match X01, tournois, feuille CPARD, jeux du club, entraînements | membres |
| `scorer.html` | Scorer X01 (saisie des volées, dartbot, voix, guide de finish) | créateur de la partie / organisateur |
| `mes-parties.html` | Historique des parties (X01 et jeux du club) | membres |
| `compter.html` | Entraînement « Compter une manche » (dont match dartbot contre dartbot) | membres |
| `pentadarts.html` | Pentadarts, Capital, Cricket | membres |
| `echauffement.html` | Échauffement du club | membres |
| `stats.html` | Mes stats (ou celles d'un membre : `?id=`) | membres |
| `classement.html` | Classement : onglets Joueurs, Doublettes, Records du club | membres |
| `records.html` | Records du club (onglet du classement) | membres |
| `face-a-face.html` | Face-à-face entre deux membres ou deux doublettes | membres |
| `equipes.html` | Équipes : calendrier, résultats, effectif, salles ; onglet **Fil du club** | tous (effectif et fil : membres) |
| `capitaine.html` | Espace capitaine | capitaines, vice, admin |
| `feuille.html` | **Feuille de match CPARD** (liste, création, feuille, lien adverse `?code=`) | membres d'équipe ; capitaine adverse par le lien |
| `tournois.html` | Mes tournois, rejoindre avec un code, derniers tournois du club | membres |
| `tournoi-creer.html` | Créer / modifier un tournoi | membres |
| `tournoi.html` | Page d'un tournoi ou de la ligue : participants, poules, arbre(s), matchs, stats, gestion | participants, organisateur, spectateurs si public |
| `contact.html` | Nous contacter (adhésion, renseignement…) | tous |
| `admin.html` | Espace d'administration (menu des rubriques en haut à droite) | admins |
| `mentions-legales.html` | Mentions légales et confidentialité | tous |
| `bientot.html` | Page d'attente des rubriques pas encore ouvertes | tous |

**Fenêtre de bienvenue** : un visiteur non connecté voit d'abord « Se connecter / Créer mon compte joueur /
Continuer en tant que visiteur » (pas sur connexion, inscription, live, article, contact, lien adverse de feuille…).

## 5. Modules JavaScript

| Module | Rôle |
|---|---|
| `app.js` | Outils communs : client Supabase, `esc`, `message` (bandeau flottant dans l'admin), `surPlace`, `profilConnecte`, `lienJoueur`, `formatPartie`, `etatPartie`, photos, navigation, fenêtre de bienvenue, listes déroulantes |
| `config.js` | URL et clé **publique** Supabase, `EMAILS_ACTIFS`, `EMAIL_CLUB` |
| `compat.js` | Fonctions manquantes des anciens iPad/iPhone (script classique, avant les modules) |
| `x01.js` | **Moteur X01** pur et testé : volées, bust, finish double, manches/sets, prolongation, stats, suggestions de finish |
| `scorer.js` | Écran de saisie, enregistrement en direct, validation des matchs de tournoi et de feuille |
| `dartbot.js` | Adversaire simulé fléchette par fléchette (moyenne et réussite au double réglables) |
| `voix.js` | Annonces vocales (synthèse vocale du navigateur, français / anglais) |
| `cible.js` | Cible SVG aux dimensions réelles (tirage au bull, dartbot) |
| `live.js` | Direct : ardoise, onglets de manches, stats par manche |
| `accueil.js` | Accueil (temps réel) |
| `jouer.js`, `mes-parties.js` | Création de partie et reprise ; historique |
| `compter.js`, `compter-calcul.js` | Entraînement compter |
| `pentadarts.js`, `pentadarts-regles.js` | Jeux du club (règles pures testées) |
| `echauffement.js`, `echauffement-regles.js` | Échauffement (règles pures testées) |
| `stats.js`, `classement.js`, `records.js`, `face-a-face.js`, `profil.js`, `profil-commun.js` | Statistiques et profils |
| `equipes.js`, `logos.js`, `ics.js`, `retard.js`, `fil.js` | Équipes, logos (adverses et propres), export agenda, rencontres à scorer, fil du club |
| `capitaine.js`, `cap-stats.js` | Espace capitaine |
| `feuille.js` | Feuille de match CPARD (ordre officiel des 20 matchs, compositions, signatures, PDF) |
| `tournois.js`, `tournoi-creer.js`, `tournoi.js`, `tournoi-commun.js` | Tournois et ligue |
| `rappels-ligue.js` | Rappels de ligue (accueil, Mon compte) |
| `compte.js`, `connexion.js`, `inscription.js`, `mot-de-passe*.js`, `mes-donnees.js`, `recadrage.js` | Comptes |
| `contact.js`, `article.js` | Contact, article |
| `admin.js` + `admin-*.js` | Admin : membres/équipes, actus, demandes, matchs, tournois, sauvegarde, exports, comptes sans email, invités |

## 6. Fonctionnement détaillé par rubrique

### 6.1 Comptes

- Inscription libre → compte **en attente** → validation par un admin (Admin › Inscriptions).
- **Emails inactifs** (`EMAILS_ACTIFS = false`) : pas de confirmation par email ; « Mot de passe oublié »
  crée une demande traitée par l'admin, qui génère un **mot de passe provisoire** à envoyer (WhatsApp/SMS/email) ;
  le membre est invité à le changer.
- **Comptes sans email** (créés par l'admin) : identifiant + code, ou « profil géré » sans connexion.
  Un admin peut ensuite leur **donner un email et un téléphone** (script 061) : ils se connectent alors avec
  l'email, l'identifiant ne sert plus, rien n'est perdu.
- **Rattacher un invité** : les parties/tournois joués comme invité peuvent être rattachés au compte d'un
  membre (Admin › Membres › fiche), avec annulation.
- Photo de profil : recadrée 400×400, stockage privé, visible des membres connectés.
- RGPD : « Mes données » et suppression de son compte (les matchs de tournoi restent en « Ancien joueur »).

### 6.2 Scorer X01 et parties

- Jeux : 301, 501, score libre ; seul, 1 contre 1, jusqu'à 4 joueurs, double 2 contre 2, contre le dartbot.
- Format : « premier à » (par défaut) ou « au meilleur de » N manches, sets optionnels.
- **Prolongation** (script 067, option des tournois/ligue) : en « premier à N », à **(N-1)-(N-1)** il faut
  **N+1** manches (ligue : premier à 4, 5 si 3-3). Le moteur `x01.js` l'applique ; le format s'affiche
  « premier à 4 manches (5 si 3-3) ».
- Saisie : pavé, raccourcis de scores, fléchettes au double demandées à 50 ou moins, appui long = saisie du reste,
  guide de finish (masqué par défaut en tournoi), annonce vocale.
- Parties publiques visibles en direct ; parties contre le dartbot **toujours privées** ; une partie abandonnée
  est supprimée ; toutes les parties lancées depuis Jouer sont des **parties de club** (le choix ligue/amical a été retiré).

### 6.3 Statistiques, classement, records, fil

- **Stats** : seules les parties terminées en 301/501 ; moyenne 3 fléchettes = points ÷ fléchettes × 3
  (bust = 3 fléchettes, 0 point) ; 9 premières = 3 premières volées de chaque manche ; réussite au double =
  finishs ÷ fléchettes au double ; parties seul exclues du bilan.
- **Classement** (Joueurs, Doublettes) : **uniquement les matchs de ligue et de tournoi** (feuilles CPARD
  comprises, comptées « ligue ») ; ordre : matchs gagnés, manches gagnées, réussite au double, moyenne ;
  minimum de manches réglable (5 par défaut).
- **Records du club** : meilleure moyenne sur une partie (≥ 9 fléchettes) et plus haut finish, par trimestre
  de saison ou depuis toujours ; membres seulement.
- **Fil du club** (membres) : annonces calculées automatiquement — finish ≥ 100, 180, volée ≥ 120,
  moyenne ≥ 60, records perso/club ; doubles compris (lanceur déduit de l'ordre de jeu) ; exclus : dartbot,
  amicaux, parties seul.

### 6.4 Équipes, calendrier, logos

- Calendrier par équipe (saison CPARD 2026-2027 chargée par le script 031), filtres À venir / Résultats / Tout,
  export agenda, carnet de salles, rencontres à scorer signalées (« À scorer », « À mettre à jour »).
- **Logos adverses** partagés par club (CAL 1, CAL 3…) ; **logo propre** à une équipe du site (ex. ARMY 78),
  sinon logo Dolina.
- **Équipe de test** (case dans Admin › Équipes, script 058) : absente de l'accueil, garde sa page.
- Admin › Équipes : créer, renommer, ordonner, supprimer, capitaine, vice-capitaine, logo, équipe de test.

### 6.5 Feuille de match CPARD (`feuille.html`, scripts 056, 057, 064)

1. **Liste** par équipe (onglets), séparée Domicile / Extérieur ; bouton « + Nouvelle rencontre » (crée la
   rencontre au calendrier et ouvre sa feuille) ; « Feuille de match » aussi sur chaque rencontre de la page Équipes, même déjà jouée.
2. **Camp** : l'équipe qui **reçoit est toujours l'équipe A (à gauche)**, les visiteurs l'équipe E — automatique.
3. **Compositions** : A, B, C, D (ou E, F, G, H), doubles A1/A2 (E1/E2), remplaçant Y (Z). Notre équipe se
   choisit dans l'effectif (ou nom libre) ; le **capitaine adverse** saisit la sienne par un **lien sans compte**
   (`feuille.html?code=…`). **Compositions masquées l'une de l'autre** jusqu'au lancement (garanti par la base).
4. **Lancer la rencontre** (capitaine qui gère) quand les deux équipes sont complètes ; annulable tant
   qu'aucun match n'a commencé.
5. **20 matchs dans l'ordre officiel FFD**, avec ⊙ (qui commence), répartis sur les cibles choisies :

   | # | A | E | ⊙ | | # | A | E | ⊙ |
   |---|---|---|---|---|---|---|---|---|
   | 1 | A | F | A | | 11 | A | G | A |
   | 2 | B | E | E | | 12 | C | E | A |
   | 3 | C | H | A | | 13 | B | H | E |
   | 4 | D | G | E | | 14 | D | F | E |
   | 5 | A | E | E | | 15 | A | H | E |
   | 6 | B | F | A | | 16 | D | E | A |
   | 7 | C | G | E | | 17 | B | G | A |
   | 8 | D | H | A | | 18 | C | F | E |
   | 9 | A1 | E1 | A | | 19 | A1 | E2 | E |
   | 10 | A2 | E2 | A | | 20 | A2 | E1 | E |

6. Chaque match : **au scorer** (501, meilleur des 3 manches, stats dans le compte des joueurs, type « ligue »)
   ou **score saisi** (2-0, 2-1, 1-2, 0-2, sans stats). « Corriger » remet un match à jouer. La page reste en place après une saisie.
7. **Remplacement** : un par équipe, « Y remplace D après le match 10 » → les matchs suivants (doubles compris) passent au remplaçant.
8. **Validation** : 20 matchs terminés + **signatures des deux capitaines au doigt** → score reporté au
   calendrier, article publié (option), **PDF au format FFD** (logos FFD et CPARD, une page A4) et mail
   préparé pour dscpard@gmail.com (le PDF est à joindre). « Rouvrir » efface les signatures.

### 6.6 Tournois

- Formats : **poules + phase finale** ou **élimination directe** ; individuel ou doublettes ; code d'accès + QR code.
- Inscriptions par code, ajout par l'organisateur (membres cochés, invités un par ligne).
- Lancement : format des matchs (jeu, manches, sets, **prolongation**), nombre de poules, cibles par poule et
  de phase finale. Poules : 3 pts victoire / 1 pt défaite, départage manches puis confrontation directe ;
  qualifiés croisés en phase finale (1er A contre 2e B…).
- En cours : lancer un match (tirage au bull), score en direct, validation, corriger le score, forfait,
  **clôturer un match** (nul / sans suite, pour les matchs sans suite d'arbre), format par tour, **ajouter un
  joueur** dans une poule, annuler le lancement tant que rien n'est joué.
- **Tableau B (poules)** : créé à la fin des poules avec les non-qualifiés (poule unique ou élimination directe), script 052 (+ correctif 066).
- **Tableau B en double élimination** (élimination directe, script 065) : option à la création ; chaque
  éliminé du A rejoint le B au tour qui lui correspond (ordre inversé), exemptions gérées, format du B choisi à
  part au lancement, **le B a son propre vainqueur** (pas de grande finale), pas de match pour la 3e place ;
  le finaliste du A ne descend pas dans le B (règle confirmée par le club le 31/10/2026).
- Admin › Tournois : liste et suppression (parties gardées ou supprimées).

### 6.7 Ligue interne et Masters

- Créée par l'admin (Admin › Tournois), **masquée** tant que l'admin ne l'ouvre pas.
- Au lancement : nombre de **poules**, **qualifiés par poule** pour le Master, format proposé **premier à 4
  avec prolongation (5 si 3-3)** ; poules **équilibrées selon le niveau** (serpentin), invités répartis en dernier.
- **Niveaux** (1 très fort → 5 débutant) : donnés par l'admin dans Admin › Membres ou sur la page de la ligue
  avant lancement ; jamais visibles des joueurs ; utilisés **uniquement** pour la ligue.
- Points : **victoire 3, défaite jouée 1, forfait 0, nul 1 chacun** ; forfait ou nul proposé par un joueur et
  confirmé par l'autre ; l'admin tranche si besoin.
- **Fin de saison** (date réglée par l'admin) ; rappels dans Mon compte et sur l'accueil (urgent : ≤ 30 jours ou réponse attendue).
- Vue joueur « Mes matchs » (une ligne par adversaire, Jouer, menu ⋯) ; grille complète repliée.
- **Contacter l'adversaire sur WhatsApp** (script 068) : icône à côté de « Jouer », message pré-rempli. Le
  téléphone reste privé tant que le joueur n'a pas accepté de le partager (bandeau « Partager » dans Mes matchs,
  ou case dans Mon compte) ; seuls ses adversaires de ligue le reçoivent.
- **Ajouter un membre** après le lancement, même ligue complète (une place est créée) ; ses matchs contre sa poule sont créés.
- Puis **Master** (phase finale) avec les qualifiés.

### 6.8 Jeux du club et entraînement

Pentadarts (5 jeux, 3 à 5 joueurs), Capital, Cricket (1 à 8 joueurs, en manches) avec reprise sur un autre
appareil ; Échauffement (20, 19, 18, 16, bulle puis doubles 20→1, normal/expert) ; Compter une manche
(dont match dartbot contre dartbot). « À venir » : exercices par niveau, défi du mois, tour de l'horloge.

### 6.9 Actualités, contact, administration

- **Actus** (admin) : rédaction, photo, brouillon/publication, article pré-rempli depuis une rencontre ;
  aperçus de partage `a/<id>.html` générés automatiquement.
- **Nous contacter** : demande enregistrée (anti-abus), moyen de recontact choisi ; traitée dans Admin › Demandes.
- **Admin** (menu en haut à droite) : Inscriptions (valider ou refuser les nouveaux comptes), Membres
  (rôles, statut, niveau, email, mot de passe provisoire, invités, parties, création d'un membre sans email), Équipes, Demandes (contact, équipe, mot de passe), Actus, Matchs, Tournois,
  Exports CSV, Sauvegarde. Après une modification la page **reste en place** (message en bandeau flottant en bas).

## 7. Base de données

### 7.1 Tables

| Table | Contenu |
|---|---|
| `profiles`, `profile_private` | Profil public, coordonnées privées (email, téléphone, accord de partage du téléphone en ligue) |
| `teams`, `team_members` | Équipes (capitaine, vice, ordre, logo, accueil) et rattachements |
| `articles` | Actualités (liées à une équipe possible) |
| `settings` | Réglages (seuil du classement…) |
| `games`, `game_sides`, `game_players`, `visits` | Parties X01, camps, joueurs, volées |
| `jeux_parties` | Pentadarts, Capital, Cricket |
| `tournaments`, `tournament_entries`, `tournament_matches` | Tournois / ligue, inscrits, matchs (arbres A et B, poules) |
| `propositions_ligue` | Forfaits / nuls proposés entre joueurs |
| `niveaux_joueurs` | Niveau des membres (admin seulement) |
| `rencontres`, `salles`, `clubs_adverses` | Calendrier CPARD, salles, logos adverses |
| `feuilles_match`, `feuille_matchs` | Feuilles CPARD et leurs 20 matchs |
| `contact_requests` | Demandes « Nous contacter » et mot de passe oublié |
| `rattachements_invites` | Historique des rattachements d'invités |

### 7.2 Scripts SQL (à exécuter dans l'ordre)

> État au 01/11/2026 : scripts **001 à 067 exécutés** en production ; **068 à exécuter**.
> Pour chaque nouveau script : l'exécuter une fois, dans l'ordre, puis cocher sa ligne ici.

| N° | Objet | Exécuté |
|---|---|---|
| 001 | Base de données v1 (profils, équipes, actus, parties, RLS) | ✅ |
| 002 | Premier administrateur (une seule fois) | ✅ |
| 003 | Correctif lien parties/joueurs | ✅ |
| 004 | Réinitialiser un mot de passe (outil admin, à la demande) | — |
| 005 | Administration (suppression de compte, toujours un admin) | ✅ |
| 006 | Stockage des images d'actualités | ✅ |
| 007 | Profil : marque des fléchettes | ✅ |
| 008 | Surnom affiché | ✅ |
| 009 | Jouer (création de partie) | ✅ |
| 011 | Suppression des parties abandonnées | ✅ |
| 012–017 | Tournois : création, tirage, accueil, guide de finish, matchs, corrections | ✅ |
| 018 | Nous contacter | ✅ |
| 019–023 | Stats, stats de tournoi, classement, sans parties seul, face-à-face | ✅ |
| 024 | Sauvegarde | ✅ |
| 025–026 | Photo de profil, RGPD | ✅ |
| 027–029 | Suppression de tournoi, une cible par poule, type club/ligue/amical | ✅ |
| 030–031 | Calendrier des équipes, saison 2026-2027 | ✅ |
| 032–034 | Records, préférence de contact, logos adverses | ✅ |
| 035–038 | Comptes sans email, vice-capitaine, espace capitaine, mot de passe provisoire | ✅ |
| 039–041 | Jeux du club, reprise, cricket | ✅ |
| 042 | Plusieurs cibles par poule | ✅ |
| 043 | Cibles de la phase finale | ✅ |
| 044 | Ligue interne (masquée) | ✅ |
| 045 | Classement : seulement ligue et tournois | ✅ |
| 046 | Dartbot toujours privé | ✅ |
| 047 | Fil du club | ✅ |
| 048 | Derniers tournois du club | ✅ |
| 049 | Fil du club : doubles | ✅ |
| 050 | Ligue : fin de saison, nuls, forfaits | ✅ |
| 051 | Ajouter un joueur pendant un tournoi | ✅ |
| 052 | Tableau B des non-qualifiés | ✅ |
| 053 | Clôturer un match (nul / sans suite) | ✅ |
| 054 | Rattacher un invité à un compte | ✅ |
| 055 | Logo propre à chaque équipe | ✅ |
| 056 | Feuille de match CPARD | ✅ |
| 057 | Feuille : compositions masquées jusqu'au lancement | ✅ |
| 058 | Équipe de test masquée de l'accueil | ✅ |
| 059 | Ligue : ajouter un membre après le lancement | ✅ |
| 060 | Niveaux des joueurs (têtes de série) | ✅ |
| 061 | Donner un email à un compte sans email | ✅ |
| 062 | Niveaux jamais montrés aux joueurs | ✅ |
| 063 | Niveaux : admin seulement, ligue seulement | ✅ |
| 064 | Feuille : l'équipe qui reçoit est toujours A | ✅ |
| 065 | Tableau B en double élimination | ✅ |
| 066 | Correctif tableau B (DELETE sans WHERE) | ✅ |
| 067 | Prolongation des matchs « premier à N » | ✅ |
| 068 | Ligue : contacter son adversaire sur WhatsApp (numéro partagé avec accord) | ⏳ |

Le dossier `supabase/emails/` contient les modèles d'emails (confirmation, nouveau mot de passe) à coller dans
Supabase › Authentication › Email Templates le jour où les emails seront activés.

### 7.3 Principales fonctions (RPC appelées par le site)

| Domaine | Fonctions (script de la dernière version) |
|---|---|
| Comptes / admin | `admin_creer_membre` (035), `admin_changer_code` (035), `admin_mot_de_passe_provisoire` (038), `admin_ajouter_email` (061), `admin_delete_account` (026), `delete_my_account` (026), `mes_donnees` (026), `mot_de_passe_change` (038), `invites_correspondants` / `rattacher_invite` / `annuler_rattachements` (054), `definir_niveau_joueur` (060) |
| Stats | `stats_joueur` (022), `stats_tournoi` (020), `classement_membres` / `classement_doublettes` (045), `records_club` (032), `face_a_face*` / `liste_doublettes` (023), `fil_du_club` (049) |
| Tournois | `rejoindre_tournoi` / `apercu_tournoi` (044), `lancer_tournoi` (065), `annuler_lancement` (013), `tournoi_detail` (065), `tournois_en_cours` (044), `lancer_match_tournoi` (067), `valider_match_tournoi` / `forfait_match` / `reinitialiser_match` / `lancer_phase_finale` (016), `corriger_score_match` (017), `definir_format_tour` (065), `definir_cibles_poule` (042), `definir_cibles_finale` (043), `cloturer_match` (053), `ajouter_joueur_en_cours` (059), `creer_tableau_b` (066), `derniers_tournois` (065), `supprimer_tournoi` (027) |
| Ligue | `definir_visibilite_ligue` / `definir_qualifies` (044), `definir_fin_saison` / `proposer_resultat_ligue` / `repondre_proposition_ligue` / `match_nul_ligue` / `propositions_ligue_en_cours` / `mes_rappels_ligue` (050), `niveaux_tournoi` (063), `contacts_ligue` (068) |
| Feuille CPARD | `creer_feuille` (064), `feuille_detail` (057), `feuilles_rencontres`, `enregistrer_compo` (057), `lancer_rencontre` / `annuler_lancement_feuille` (057), `definir_cibles_feuille`, `definir_remplacement` (057), `lancer_match_feuille`, `valider_match_feuille`, `saisir_resultat_feuille`, `remettre_match_feuille`, `valider_feuille`, `rouvrir_feuille`, `supprimer_feuille`, `feuille_de_partie` (056) |
| Divers | `envoyer_demande_contact_v2` (038), `sauvegarde_club` / `espace_utilise` (024), `definir_vice_capitaine` (036), `forme_equipe` (037) |

Les fonctions internes (non appelables depuis le site) gèrent les arbres (`creer_arbre`, `faire_avancer`,
`creer_tableau_b_double`, `b_resoudre`), les poules (`creer_poules`, `classement_poule`), les verrous
(`verrou_partie_tournoi`, `verrou_partie_feuille`…) et les droits (`is_admin`, `is_captain_of`,
`tournoi_organisateur`, `tournoi_participant`, `feuille_peut_gerer`, `feuille_peut_jouer`).

## 8. Publication et mises à jour

Fichier `.github/workflows/publier-site.yml` (« Publier le site ») :

1. Déclenché à chaque `push` sur `main`, toutes les 15 minutes (aperçus de partage des nouveaux articles), ou à la main (Actions › Run workflow).
2. Lance les tests du scorer (`node outils/test-x01.mjs`) : **un échec bloque la publication**.
3. `outils/generer-partage.mjs` remplace `__VERSION__`, crée `a/<id>.html` pour chaque article publié et ne republie que si quelque chose a changé.
4. Envoi sur GitHub Pages (réglage unique : Settings › Pages › Source : « GitHub Actions »).

**Modifier le site** : modifier/ajouter les fichiers → commit sur `main` → la publication part toute seule
(1 à 2 minutes). Vérifier dans l'onglet Actions qu'elle est verte. Un nouveau fichier : suffixe `?v=__VERSION__`
+ ajout dans `sw.js`. Une évolution de base : **nouveau script numéroté** (ne jamais modifier un script déjà
exécuté en production, sauf correctif identique repris dans un nouveau script).

## 9. Tests automatiques

| Commande | Ce qu'elle vérifie | État au 31/10/2026 |
|---|---|---|
| `node outils/test-x01.mjs` | Règles du scorer (dont prolongation) | 18 réussis |
| `node outils/test-dartbot.mjs` | Dartbot | 45 réussis |
| `node outils/test-compter.mjs` | Compter une manche | 25 réussis |
| `node outils/test-pentadarts.mjs` | Pentadarts, Capital, Cricket | 64 réussis |
| `node outils/test-echauffement.mjs` | Échauffement | 20 réussis |
| `bash outils/test-base/tout-tester.sh` | **Toute la base** : droits, tournois, ligue, feuille, niveaux… (31 groupes, base neuve à chaque groupe) | **649 réussis, 0 échec** |

La base de test est un Postgres 16 local qui imite Supabase (`stub.sql`) : voir `outils/test-base/LISEZMOI.md`.
Utilisateurs de test : Tony (admin), Will, Franck, Gérald (membres), Paul (en attente).
**Règle** : toute nouvelle fonction SQL arrive avec son fichier `test-xxx.sql` ; lancer `tout-tester.sh` avant chaque publication d'un script.

## 10. Procédures courantes (pas à pas)

**Exécuter un script SQL** — Supabase › SQL Editor › New query → coller **tout** le fichier → Run → vérifier
« Success ». Un message d'erreur = ne pas passer au suivant, noter l'erreur.

**Valider un nouveau membre** — Admin › Inscriptions → Valider (puis l'équipe dans Admin › Membres si besoin).

**Mot de passe oublié** — Admin › Demandes (ou fiche du membre) → « Mot de passe provisoire » → envoyer par WhatsApp/SMS.

**Membre sans email** — Admin › Membres › bouton « + Créer un membre sans email » (en haut de la liste) (identifiant + code, ou profil géré).
Plus tard : fiche → « Passer à un compte avec email ».

**Rattacher des matchs joués comme invité** — Admin › Membres › fiche → « Matchs joués comme invité ».

**Équipe** — Admin › Équipes : créer, capitaine, vice, logo, « Équipe de test ».

**Préparer et lancer la ligue** — Admin › Tournois › créer la ligue → inscrire les membres → vérifier les
niveaux (page de la ligue ou Admin › Membres) → Lancer : 2 poules, qualifiés par poule, premier à 4 +
prolongation → régler la fin de saison → **ouvrir la ligue** (visibilité) quand tout est prêt. En cours de
saison : « + Ajouter un membre ». Fin : vérifier les résultats manquants (trancher), puis lancer le Master.

**Rencontre CPARD** — Jouer › Match officiel CPARD (ou Équipes › Feuille de match) → ouvrir/créer la
rencontre → saisir notre compo → envoyer le lien au capitaine adverse → Lancer la rencontre → matchs →
remplacement si besoin → signatures → Valider → Télécharger le PDF (« Enregistrer au format PDF ») → Envoyer au CPARD (joindre le PDF).

**Sauvegarde** — Admin › Sauvegarde → télécharger le fichier (au moins une fois par mois : l'offre gratuite
de Supabase ne sauvegarde pas). Les images ne sont pas dans le fichier (seulement leurs noms).

## 11. Sécurité

- `config.js` ne contient que la clé **publique** (`sb_publishable_…`), faite pour être visible.
- **Jamais** dans le dépôt ni dans une conversation : clé secrète Supabase (`sb_secret_…`, `service_role`),
  mot de passe de la base, mots de passe SMTP, mots de passe FTP / hébergement.
- Pour un déploiement FTP (§ 13) : uniquement par les **secrets GitHub** `FTP_SERVEUR`, `FTP_UTILISATEUR`,
  `FTP_MOT_DE_PASSE`, `FTP_DOSSIER`.
- Les droits sont garantis par la base (RLS + fonctions qui vérifient le rôle) : la page n'est qu'un affichage.
- Données sensibles masquées par la base : niveaux, code du lien adverse (feuille), compositions avant
  lancement, coordonnées privées, ligue masquée.

## 12. Dépannage et pièges connus

| Symptôme | Cause probable | Solution |
|---|---|---|
| Une nouveauté ne marche pas en ligne mais marche en test | Script SQL pas encore exécuté | Exécuter les scripts manquants (§ 7.2) |
| « Could not find the function … » / « column … not found » | Script manquant, ou cache de schéma Supabase | Exécuter le script ; sinon `notify pgrst, 'reload schema';` |
| « DELETE requires a WHERE clause » | Supabase refuse un DELETE/UPDATE sans condition | Toujours écrire `where …` (même `where true` sur une table temporaire) |
| Ancienne version affichée après publication | Cache du navigateur / appli installée | Recharger ; fermer et rouvrir l'onglet ; vérifier que le fichier a bien `?v=__VERSION__` |
| Le bouton « Se connecter » ne fait rien (vieux iPad) | Fonction JS trop récente | `compat.js` couvre iOS 14+ ; le message de la page de connexion indique la fonction en cause |
| Connexion perdue à chaque page sur iPhone/iPad | Safari « Bloquer tous les cookies » | Le désactiver ; pas de navigation privée (la page le signale) |
| « Mot de passe oublié » n'envoie rien | Emails inactifs | Mot de passe provisoire par l'admin ; activer les emails plus tard (§ 14) |
| Clic sur un bouton qui ouvre un profil | Attribut `data-profil` hors d'un `.lien-joueur` | Seuls les éléments `.lien-joueur[data-profil]` ouvrent un profil |
| Publication rouge dans Actions | Test du scorer en échec | Corriger le moteur ou le test avant de republier |

## 13. Migration vers dolina.mydarts.org

État : **en attente** du bon mot de passe FTP (Vince ; FileZilla renvoie « 530 Login authentication failed »).

- **Option A (recommandée)** : enregistrement DNS CNAME `dolina` → `dolinadartsclub.github.io`, domaine
  personnalisé dans Settings › Pages, HTTPS forcé. Rien ne change dans la publication.
- **Option B** : envoi FTPS par GitHub Actions avec les secrets `FTP_SERVEUR`, `FTP_UTILISATEUR`,
  `FTP_MOT_DE_PASSE`, `FTP_DOSSIER` (dossier web à confirmer avec l'hébergeur).
- Dans les deux cas : Supabase › Authentication › URL Configuration (Site URL + Redirect URLs), puis remplacer
  l'adresse codée en dur dans : `index.html` (balises og), `article.html` (og:image),
  `outils/generer-partage.mjs` (`SITE_URL`), `assets/js/admin-sans-email.js` (message du code).

## 14. Suivi : à faire et en attente

**À faire par le club**
- Noter le niveau des membres de la ligue ; créer et lancer la ligue (2 poules, Master à 8 conseillé).
- Obtenir les accès FTP / DNS pour la migration (§ 13).
- Fournir les informations de l'association pour les mentions légales (RGPD).

**En attente d'un élément**
- Voix du commentateur : prompt et 345 annonces prêts ; brancher les fichiers MP3 quand ils sont générés.
- Emails automatiques : configurer un SMTP (domaine du club + Brevo, ou Gmail), puis `EMAILS_ACTIFS = true`
  et « Confirm email » dans Supabase.

**Idées notées, pas commencées** : exercices par niveau, défi du mois et classement mensuel Compter, tour de
l'horloge, mode hors ligne du scorer, notifications push, expiration des mots de passe provisoires, option
aller-retour pour la ligue.

## 15. Historique des versions

| Date | Principales évolutions |
|---|---|
| 15/10/2026 | Première version : accueil, direct, comptes, admin, actus, scorer X01, mes parties, tournois (T1-T3), contact, stats, classement, face-à-face, profils, sauvegarde, photos, RGPD |
| 16/10/2026 | Une cible par poule, QR code, voix, dartbot, calendrier des équipes (saison 2026-2027), records, exports CSV |
| 17-18/10/2026 | Espace capitaine, prochaines rencontres, refonte visuelle (verre, barres), Compter une manche, raccourcis du scorer |
| 19-20/10/2026 | Logos adverses, comptes sans email, vice-capitaine, mot de passe provisoire, jeux du club (Pentadarts, Capital, Cricket), échauffement, cibles multiples |
| 21-23/10/2026 | Ligue interne, fil du club, derniers tournois, fin de saison, tableau B, clôture de match, score live, liens profils, invités, gestion des équipes, logo d'équipe, **feuille de match CPARD** |
| 24-25/10/2026 | Retrait du choix ligue/amical, compatibilité iOS 14+, ajout en cours de ligue, niveaux, onglet Records, email pour les comptes sans email |
| 27/10/2026 | Niveaux réservés à l'admin et à la ligue, PDF CPARD (totaux, logos, une page), équipe qui reçoit = A, fenêtre de bienvenue, **tableau B en double élimination**, correctif tableau B |
| 30/10/2026 | Bouton « Accepter » corrigé, feuille sur rencontres jouées, admin sans remontée de page, niveaux sur la page de la ligue, **prolongation** |
| 31/10/2026 | Relecture complète, tests remis à jour (`tout-tester.sh`), documentation et cahier des charges v2 |

Le détail de chaque changement est dans l'historique Git (`git log`).
