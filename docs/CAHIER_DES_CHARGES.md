# Cahier des charges — Site du Dolina Darts Club

> **Version 2 — 31/10/2026.** Remise à jour à partir du site réellement livré, des règles validées par le club
> pendant le développement (octobre 2026) et des demandes en attente. La numérotation des sections reprend
> celle citée dans le code (§ 6.5 équipes, § 6.7 scorer, § 7 statistiques).
> Statuts : ✅ livré · 🟡 livré, à activer ou à compléter · ⏳ à faire · ✖ abandonné.
> Le fonctionnement technique est décrit dans [`DOCUMENTATION.md`](DOCUMENTATION.md).

## 1. Contexte

Le Dolina Darts Club (fléchettes traditionnelles, steel tip, depuis 1984) s'entraîne le mardi et le jeudi de
19 h à 22 h 30 au Gymnase Paul Souriau (30 rue de Seine, Boulogne-Billancourt), parfois au Club House du
complexe Marcel Bec (Meudon). Il engage trois équipes dans le championnat par équipes du CPARD : **Dolina 1**,
**Dolina 2** et **Dolinos**. Le site remplace des outils dispersés (papier, messageries, tableurs).

## 2. Objectifs

1. Présenter le club et attirer de nouveaux joueurs (visiteurs).
2. Donner aux membres un outil de jeu et de suivi : scorer, statistiques, classement, records.
3. Gérer la vie sportive : calendrier et feuilles de match CPARD, tournois internes, ligue interne et Masters.
4. Simplifier l'administration : membres, équipes, actualités, demandes, sauvegardes.

## 3. Contraintes

| Contrainte | Réponse retenue |
|---|---|
| Budget 0 € (hors nom de domaine) | GitHub Pages + Supabase offre gratuite |
| Développeur bénévole débutant, sans logiciel à installer | HTML/CSS/JS sans compilation, modifiable sur GitHub ; développement avec Claude |
| Simple à maintenir | Un fichier par page, scripts SQL numérotés, tests automatiques, documentation |
| Usage surtout sur téléphone, parfois tablette ancienne | Mobile d'abord, appli installable (PWA), compatibilité iOS 14+ |
| Données personnelles | RGPD : consentement photo, export et suppression de compte, coordonnées privées |
| Langue | Tout en français |

## 4. Utilisateurs et rôles

Visiteur · inscrit en attente · membre validé · capitaine et vice-capitaine · organisateur de tournoi ·
administrateur. Détail des droits : `DOCUMENTATION.md` § 3. Principe : **les droits sont garantis par la base
de données**, pas par l'affichage.

## 5. Identité visuelle

Noir mat, orange (#f57a00), gris ; polices Barlow / Barlow Condensed ; logo du club ; score Dolina en orange ;
l'équipe qui reçoit toujours à gauche. ✅

## 6. Fonctionnalités

### 6.1 Accueil et visiteurs ✅
- Horaires et lieux d'entraînement, itinéraire, bouton « Rejoindre le club ».
- Actualités en carrousel ; prochaines rencontres (Dolina 1, Dolina 2, Dolinos) avec logos ; derniers résultats ;
  matchs en cours en direct ; 3 derniers matchs publics (jusqu'à 6) ; tournois en cours ; rappels de ligue.
- Fenêtre de bienvenue pour un visiteur non connecté : se connecter / créer mon compte joueur / continuer en
  visiteur (7 jours) — évite la confusion avec « Rejoindre le club ».
- Une équipe marquée « de test » n'apparaît pas sur l'accueil.

### 6.2 Comptes et profils ✅ (emails 🟡)
- Inscription, validation par un admin, connexion par email ou identifiant.
- Profil : surnom (affichable partout), main, poids et marque des fléchettes, téléphone, photo recadrée.
- Comptes sans email créés par l'admin ; ajout d'un email plus tard sans perte de données.
- Mot de passe oublié : **mot de passe provisoire donné par l'admin** tant que les emails ne sont pas actifs 🟡.
- Page profil de chaque membre ; noms cliquables partout.
- Rattacher à un compte les matchs joués comme invité.
- RGPD : « Mes données » (consultation, PDF, export) et suppression de son compte.

### 6.3 Administration ✅
Inscriptions (validation des comptes), membres (rôles, statut, niveau, email, mot de passe provisoire, parties), équipes (création,
ordre, capitaine, vice, logo, équipe de test), demandes (contact, équipes, mot de passe), actualités, matchs,
tournois, exports CSV, sauvegarde mensuelle. La page ne remonte pas après une modification.

### 6.4 Actualités ✅
Articles avec photo, brouillon/publication, article pré-rempli depuis une rencontre ou généré à la validation
d'une feuille de match, aperçus de partage (WhatsApp, LinkedIn, Facebook).

### 6.5 Équipes et calendrier ✅
- Calendrier et résultats par équipe et par saison (2026-2027 chargée), filtres, export agenda, salles.
- Logos des clubs adverses ; logo propre à une équipe du site.
- Effectif visible des membres ; espace capitaine (demandes, effectif, forme, rencontres à scorer).
- Rencontres passées sans score signalées « À scorer » / « À mettre à jour ».
- Onglet **Fil du club** (membres) : exploits annoncés automatiquement.

### 6.6 Feuille de match CPARD ✅
Règles validées :
- **L'équipe qui reçoit est toujours l'équipe A (à gauche)**, les visiteurs l'équipe E.
- Composition : 4 simples, 2 doubles, 1 remplaçant par équipe ; le capitaine adverse saisit la sienne par un
  lien, **sans compte** ; **les compositions restent masquées l'une de l'autre jusqu'au lancement** de la rencontre.
- **20 matchs dans l'ordre officiel FFD** avec le joueur qui commence ; répartition sur le nombre de cibles disponibles.
- Chaque match : 501, meilleur des 3 manches, finish double ; joué au scorer (stats dans le compte des joueurs)
  ou saisi en manches seulement (sans stats).
- Un remplacement par équipe : les matchs suivants basculent sur le remplaçant.
- 1 point par match gagné ; totaux points et manches automatiques.
- Signature au doigt en plein écran ; chaque capitaine peut signer sur son propre téléphone (l'adverse par son lien).
- Validation par le capitaine qui gère, une fois les deux signatures faites ; score reporté au calendrier ;
  **vrai fichier PDF au format FFD, toujours sur une seule page A4** (logos FFD et CPARD) à envoyer à
  dscpard@gmail.com (partage direct par Mail sur téléphone) ; article automatique (option).
- **Lien spectateurs** : tout le monde, même sans compte, suit le score en direct (rien de modifiable ;
  compositions visibles après le lancement).
- Création d'une rencontre directement depuis la feuille ; feuille possible aussi sur une rencontre déjà jouée.

### 6.7 Scorer X01 ✅
- 301, 501, score libre ; seul, 1 contre 1, jusqu'à 4 joueurs, 2 contre 2, contre le dartbot (niveau réglable).
- Formats « premier à » (par défaut) et « au meilleur de », sets ; **prolongation** optionnelle : à (N-1)-(N-1),
  il faut N+1 manches.
- Saisie rapide (raccourcis, double demandé à 50 ou moins, reste par appui long), guide de finish (masqué en
  tournoi), annonce vocale du navigateur (français/anglais), direct public, récapitulatif par manche.
- Toutes les parties lancées depuis « Jouer » sont des **parties de club** ; les matchs de ligue se jouent
  uniquement depuis la rubrique Ligue (et la feuille CPARD). Parties contre le dartbot toujours privées.
- Voix de commentateur enregistrée 🟡 (annonces et prompt prêts, fichiers audio à produire).

### 6.8 Entraînement et jeux du club
- ✅ Pentadarts, Capital, Cricket (reprise sur un autre appareil) ; Échauffement ; Compter une manche (dont dartbot contre dartbot).
- ⏳ Exercices par niveau avec carnet d'entraînement ; défi du mois avec classement ; tour de l'horloge.

### 6.9 Tournois ✅
- Poules + phase finale, ou élimination directe ; individuel ou doublettes ; code et QR code.
- Cibles par poule et pour la phase finale ; score en direct ; corrections, forfaits, clôture nul / sans suite ;
  ajout d'un joueur en cours (poules).
- Poules : 3 points par victoire, 1 par défaite ; départage manches puis confrontation directe.
- **Tableau B** pour les non-qualifiés des poules (poule unique ou élimination directe).
- **Tableau B en double élimination** pour l'élimination directe : chaque éliminé du A rejoint le B au tour
  correspondant ; le B a son propre vainqueur (pas de grande finale), format à part ; pas de match pour la
  3e place ; le finaliste du A ne descend pas dans le B (il est 2e du tournoi).
- Tournois de l'année listés dans « Derniers tournois du club ».

### 6.10 Ligue interne et Masters ✅ (prête à lancer)
Règles validées :
- Ligue créée et gérée par l'admin uniquement ; masquée tant qu'elle n'est pas ouverte.
- Chacun contre chacun dans sa poule ; **2 poules** prévues au départ ; qualifiés par poule pour le **Master**.
- Matchs en **premier à 4 manches, 5 si 3-3** (prolongation automatique).
- Points : **victoire 3, défaite jouée 1, forfait 0, nul 1 chacun** ; forfait/nul proposé par un joueur,
  confirmé par l'adversaire ; l'admin tranche.
- **Niveaux 1 à 5** donnés par l'admin seul (Admin › Membres ou page de la ligue), jamais montrés aux joueurs,
  utilisés **uniquement** pour équilibrer les poules de la ligue (serpentin).
- Fin de saison fixée par l'admin (mi-juin), rappels aux joueurs ; Master en fin de saison (ex. jeudi 24 juin 2027).
- Ajout d'un membre en cours de saison, même ligue complète (il a moins de temps pour jouer).
- Bouton WhatsApp pour contacter son adversaire ; numéro partagé seulement avec l'accord du joueur, et seulement à ses adversaires de ligue.
- ⏸ **Match à distance avec caméra** (prêt, en pause, pas en ligne) : chacun chez soi, son téléphone filme sa cible ; chacun saisit ses propres
  volées, l'adversaire les voit en direct ; validation par l'un des deux, mêmes règles de points (litige : l'admin).
- ⏳ Option aller-retour (proposée, non décidée).

### 6.11 Nous contacter ✅
Formulaire public (adhésion, renseignements…), choix du moyen de recontact, protection anti-abus, traitement
dans l'admin.

## 7. Statistiques, classement et records ✅

- Seules les parties terminées en 301/501 comptent ; moyenne 3 fléchettes, 9 premières, réussite au double,
  180, finishs ; parties seul hors bilan.
- **Classement** : uniquement les matchs de **ligue et de tournoi** (feuilles CPARD comprises) ; ordre : matchs
  gagnés, manches gagnées, réussite au double, moyenne ; minimum de manches réglable par l'admin ; onglets
  Joueurs, Doublettes, **Records du club**.
- **Records** : meilleure moyenne sur une partie et plus haut finish, par trimestre ou depuis toujours.
- Face-à-face entre deux membres ou deux doublettes ; stats de tournoi ; statistiques d'équipe pour le capitaine.

## 8. Exigences non fonctionnelles

| Exigence | Statut |
|---|---|
| Sécurité par la base (RLS, fonctions vérifiant les droits), aucune clé secrète dans le code | ✅ |
| Compatibilité iPhone/iPad iOS 14+, Android, ordinateur | ✅ |
| Appli installable (PWA), chargement rapide (cache) | ✅ |
| Tests automatiques avant publication (scorer) et batterie complète de la base | ✅ |
| Sauvegarde des données (manuelle, mensuelle, par l'admin) | ✅ |
| Mode hors ligne du scorer | ⏳ |
| Notifications (rappels, matchs) | ⏳ |

## 9. RGPD et mentions légales

✅ consentement photo, coordonnées privées, export et suppression de compte, page de confidentialité.
⏳ compléter les mentions légales avec les informations de l'association (responsable de publication, adresse du siège).

## 10. Hébergement et coûts

GitHub Pages + Supabase gratuits ✅. ⏳ Passage sur **dolina.mydarts.org** (CNAME conseillé ; accès en attente).
🟡 Emails : SMTP gratuit à configurer (domaine du club + Brevo, ou Gmail).

## 11. Journal des décisions validées

| Date | Décision |
|---|---|
| 15/10/2026 | Stats : parties terminées 301/501 seulement ; parties contre invités comptées ; règles de moyenne |
| 16/10/2026 | Un tournoi compte comme partie de club (pas de choix ligue/amical) |
| 21/10/2026 | Classement : uniquement ligue + tournois ; Mes stats gardent tout |
| 21/10/2026 | Parties contre le dartbot toujours privées |
| 22/10/2026 | Ligue : victoire 3, défaite 1, forfait 0, nul 1 chacun ; propositions entre joueurs ; fin de saison |
| 22/10/2026 | Guide de finish masqué par défaut en tournoi (interdit en tournoi officiel) |
| 23/10/2026 | Feuille CPARD : compositions masquées jusqu'au lancement ; un remplacement par équipe |
| 23/10/2026 | ARMY 78 = équipe de test, absente de l'accueil |
| 24/10/2026 | Choix « Match de ligue / amical » retiré de Jouer ; la ligue se joue dans sa rubrique |
| 27/10/2026 | Niveaux : réglés par l'admin, utilisés seulement pour la ligue |
| 27/10/2026 | Feuille CPARD : l'équipe qui reçoit est toujours A, à gauche |
| 27/10/2026 | Tableau B double élimination : le B a son propre vainqueur, format choisi à part |
| 30/10/2026 | Ligue : 2 poules, premier à 4 manches, 5 si 3-3, puis Masters |
| 31/10/2026 | Tableau B double élimination : le finaliste du A ne descend pas dans le B |
| 31/10/2026 | Scripts SQL 001 à 067 exécutés en production |
| 01/11/2026 | Ligue : contact WhatsApp entre adversaires, numéro partagé avec accord |
| 04/11/2026 | Feuille CPARD : PDF d'une page en vrai fichier, signature à distance, lien spectateurs public |
| 08/11/2026 | Ligue : match à distance avec caméra ; chacun saisit ses volées ; mêmes règles de validation |

## 12. Feuille de route

| Priorité | Sujet | Dépend de |
|---|---|---|
| 1 | Lancer la ligue interne (niveaux, 2 poules, fin de saison) | — |
| 2 | Migration vers dolina.mydarts.org | Accès DNS/FTP (Vince) |
| 2 | Mentions légales complètes | Infos de l'association |
| 2 | Emails automatiques (SMTP) | Choix du fournisseur |
| 3 | Voix de commentateur enregistrée | Fichiers MP3 |
| 3 | Exercices par niveau, défi du mois, tour de l'horloge | — |
| 3 | Option aller-retour pour la ligue | Décision du club |
| 4 | Mode hors ligne du scorer, notifications, expiration des mots de passe provisoires | — |

## 13. Hors périmètre

Paiement en ligne des cotisations, boutique, application native (le site s'installe déjà comme une appli),
cibles électroniques connectées.
