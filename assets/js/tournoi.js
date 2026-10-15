// =====================================================================
//  Page d'un tournoi : présentation, code, participants, poules, arbre,
//  matchs, gestion par l'organisateur (lancement, inscriptions…).
//  Lecture via la fonction tournoi_detail (droits vérifiés par la base) :
//  organisateur, participant, ou spectateur (tournoi lancé à matchs publics).
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, nomAffiche, BASE_URL, dateFr, formatPartie, avatar } from './app.js?v=__VERSION__';
import { chargerMembres } from './tournoi-commun.js?v=__VERSION__';
import {
  badgeStatut, resumeFormat, estMoi, choisirMembre, STATUTS,
  classementPoule, nomTour, lettrePoule, POINTS_VICTOIRE, POINTS_DEFAITE,
} from './tournoi-commun.js?v=__VERSION__';

const id = new URLSearchParams(location.search).get('id');
const zone = document.getElementById('tournoi');
const zoneMsg = document.getElementById('message');
const fenAjout = document.getElementById('fen-ajout');
const fenLancer = document.getElementById('fen-lancer');

let moi = null;
let role = null;            // organisateur | participant | spectateur
let t = null;
let inscrits = [];
let matchs = [];
let parId = new Map();
let onglet = null;
let enCours = false;        // une action est en cours (anti double clic)

let photosMembres = new Map();

async function init() {
  moi = await profilConnecte();
  const p = new URLSearchParams(location.search);
  if (p.get('nouveau')) message(zoneMsg, 'Tournoi créé. Partagez le code ci-dessous pour que les joueurs s\'inscrivent.', 'ok');
  if (p.get('inscrit')) message(zoneMsg, 'Inscription enregistrée. Bienvenue dans le tournoi !', 'ok');
  if (p.get('modifie')) message(zoneMsg, 'Paramètres enregistrés.', 'ok');
  if (p.get('nouveau') || p.get('inscrit') || p.get('modifie')) history.replaceState(null, '', `tournoi.html?id=${encodeURIComponent(id)}`);
  // Photos des membres (visibles des membres validés uniquement)
  if (moi?.status === 'active') photosMembres = new Map((await chargerMembres()).map((m) => [m.id, m]));
  await charger();
}

async function charger() {
  if (!id) {
    zone.innerHTML = '<p class="vide">Aucun tournoi indiqué. <a href="tournois.html">Voir les tournois</a></p>';
    return;
  }
  const { data, error } = await supabase.rpc('tournoi_detail', { p_tournoi: id });
  if (error || !data) {
    const texte = error?.code === 'P0001' ? error.message : 'Ce tournoi n\'est pas disponible pour le moment.';
    zone.innerHTML = `<div class="vide">${esc(texte)}
      ${moi ? '<div class="actions" style="justify-content:center;margin-top:10px"><a class="bouton bouton--plein" href="tournois.html">Rejoindre un tournoi avec son code</a></div>'
    : '<div class="actions" style="justify-content:center;margin-top:10px"><a class="bouton bouton--plein" href="connexion.html">Se connecter</a></div>'}</div>`;
    return;
  }
  role = data.role;
  t = data.tournoi;
  inscrits = data.inscrits || [];
  matchs = data.matchs || [];
  parId = new Map(inscrits.map((e) => [e.id, e]));
  etiquettes = null;
  statsTournoi = null;
  document.title = `${t.name} – Dolina Darts Club`;
  if (!onglet) onglet = t.status === 'running' || t.status === 'finished' ? (t.format === 'pools' ? 'poules' : 'arbre') : 'participants';
  afficher();
}

const estOrganisateur = () => role === 'organisateur';
// Poules toutes jouées et phase finale pas encore créée
const poulesTerminees = () => t.format === 'pools' && t.status === 'running'
  && matchs.some((m) => m.phase === 'pool') && !matchs.some((m) => m.phase === 'final')
  && matchs.filter((m) => m.phase === 'pool').every((m) => m.status === 'done' || m.status === 'bye');
const avantLancement = () => t.status === 'draft' || t.status === 'open';
const monInscription = () => (moi ? inscrits.find((e) => estMoi(e, moi.id)) : null);
const estMonMatch = (m) => { const mi = monInscription(); return !!mi && (m.entry_a === mi.id || m.entry_b === mi.id); };

// ---------- Affichage général ----------

function afficher() {
  const orga = estOrganisateur();
  const mi = monInscription();
  const nb = inscrits.length;
  const lance = !avantLancement();
  const onglets = [
    ...(t.format === 'pools' && lance ? [['poules', 'Poules'], ['arbre', 'Phase finale']] : []),
    ...(t.format === 'knockout' && lance ? [['arbre', 'Arbre']] : []),
    ...(lance ? [['matchs', `Matchs${mesMatchsAJouer() ? ' <span class="t-compte t-compte--moi">' + mesMatchsAJouer() + '</span>' : ''}`]] : []),
    ...(lance ? [['stats', 'Stats']] : []),
    ['participants', `Participants <span class="t-compte">${nb}</span>`],
    ['infos', 'Infos'],
  ];
  if (!onglets.some(([c]) => c === onglet)) onglet = onglets[0][0];

  zone.innerHTML = `
    <section class="t-entete">
      <div class="t-entete__haut">${badgeStatut(t.status)}${orga ? '<span class="t-role">Organisateur</span>' : ''}${mi ? '<span class="t-role t-role--joueur">Inscrit</span>' : ''}${role === 'spectateur' ? '<span class="t-role">Spectateur</span>' : ''}</div>
      <h1 class="t-titre">${esc(t.name)}</h1>
      <p class="t-sous">${esc(resumeFormat(t))} · organisé par ${esc(t.organisateur || '—')}</p>
      ${t.description ? `<p class="t-description">${esc(t.description)}</p>` : ''}
      ${lance ? avancement() : `
        <div class="t-jauge" role="img" aria-label="${nb} inscrits sur ${t.max_participants}"><span style="width:${Math.min(100, Math.round((nb / t.max_participants) * 100))}%"></span></div>
        <p class="t-places">${nb} / ${t.max_participants} inscrits · ${esc(STATUTS[t.status].aide)}</p>`}
    </section>

    ${t.status === 'finished' ? podium() : ''}
    ${poulesTerminees() && !orga ? '<p class="message message--ok">Toutes les poules sont terminées : l\'organisateur va lancer la phase finale.</p>' : ''}
    ${t.code && t.status !== 'finished' ? blocCode() : ''}
    ${orga ? panneauOrganisateur() : ''}

    <nav class="t-onglets" role="tablist" aria-label="Sections du tournoi">
      ${onglets.map(([cle, lib]) => `<button type="button" role="tab" aria-selected="${cle === onglet}" data-onglet="${cle}">${lib}</button>`).join('')}
    </nav>
    <section class="t-panneau" role="tabpanel">${contenuOnglet(onglet)}</section>`;

  brancher();
}

function avancement() {
  const vrais = matchs.filter((m) => m.status !== 'bye');
  const joues = vrais.filter((m) => m.status === 'done').length;
  const live = vrais.filter((m) => m.status === 'live').length;
  const pct = vrais.length ? Math.round((joues / vrais.length) * 100) : 0;
  const format = t.format === 'pools' && !matchs.some((m) => m.phase === 'final') ? t.pool_format : (t.final_format || t.pool_format);
  return `
    <div class="t-jauge" role="img" aria-label="${joues} matchs joués sur ${vrais.length}"><span style="width:${pct}%"></span></div>
    <p class="t-places">${inscrits.length} ${t.team_mode === 'double' ? 'doublettes' : 'joueurs'} · ${joues} / ${vrais.length} matchs joués${live ? ` · ${live} en cours` : ''}${format ? ` · ${esc(formatPartie(format))}` : ''}</p>`;
}

function podium() {
  const finale = matchs.find((m) => m.phase === 'final' && !m.is_third_place && !m.next_match_id);
  const petite = matchs.find((m) => m.is_third_place);
  if (!finale?.winner_entry) return '';
  const second = finale.winner_entry === finale.entry_a ? finale.entry_b : finale.entry_a;
  const places = [
    ['1', 'Vainqueur', finale.winner_entry],
    ['2', 'Finaliste', second],
    ...(petite?.winner_entry ? [['3', '3e place', petite.winner_entry]] : []),
  ];
  const mi = monInscription();
  return `
    <section class="t-podium" aria-label="Podium">
      ${places.map(([rang, titre, idE]) => `
        <div class="t-podium__place t-podium__place--${rang}${mi && idE === mi.id ? ' t-podium__place--moi' : ''}">
          <span class="t-podium__rang">${rang}</span>
          <span class="t-podium__titre">${titre}</span>
          <strong>${esc(nomEntree(idE))}</strong>
        </div>`).join('')}
    </section>`;
}

function blocCode() {
  return `
    <section class="t-code" aria-label="Code du tournoi">
      <div>
        <span class="t-code__titre">Code du tournoi</span>
        <span class="t-code__valeur" id="valeur-code">${esc(t.code)}</span>
      </div>
      <div class="t-code__actions">
        <button type="button" class="bouton bouton--petit" id="btn-copier">Copier le code</button>
        <button type="button" class="bouton bouton--petit bouton--plein" id="btn-partager">Partager</button>
      </div>
      <p class="t-code__aide">${t.status === 'open'
        ? 'Les membres saisissent ce code dans Tournois › Rejoindre un tournoi.'
        : (avantLancement() ? 'Inscriptions fermées : ouvrez-les pour que le code fonctionne.' : 'Les inscriptions sont terminées.')}</p>
    </section>`;
}

function panneauOrganisateur() {
  const nb = inscrits.length;
  if (t.status === 'finished') return '';
  if (t.status === 'running') {
    const commence = matchs.some((m) => m.status === 'live' || m.status === 'done' || m.game_id);
    return `
      <section class="t-gestion" aria-label="Gestion du tournoi">
        <h2 class="t-gestion__titre">Gestion du tournoi</h2>
        ${poulesTerminees() ? `
        <div class="t-gestion__ligne t-gestion__ligne--alerte">
          <span><strong>Toutes les poules sont terminées</strong><small>Vérifiez les classements, puis lancez la phase finale avec les ${t.pool_qualifiers * t.pools_count} qualifiés.</small></span>
          <button type="button" class="bouton bouton--petit bouton--plein" data-action="phase-finale">Lancer la phase finale</button>
        </div>` : ''}
        <div class="t-gestion__ligne">
          <span><strong>Tournoi lancé</strong><small>${commence ? 'Des matchs ont été joués : le tirage est définitif.' : 'Aucun match joué : vous pouvez encore annuler le lancement pour corriger les inscriptions.'}</small></span>
          ${commence ? '' : '<button type="button" class="bouton bouton--petit bouton--danger" data-action="annuler-lancement">Annuler le lancement</button>'}
        </div>
      </section>`;
  }
  const ouvert = t.status === 'open';
  const min = t.format === 'pools' ? 3 : 2;
  return `
    <section class="t-gestion" aria-label="Gestion du tournoi">
      <h2 class="t-gestion__titre">Gestion du tournoi</h2>
      <div class="t-gestion__ligne">
        <span><strong>Inscriptions ${ouvert ? 'ouvertes' : 'fermées'}</strong><small>${ouvert ? 'Le code permet de rejoindre le tournoi.' : 'Le code est refusé tant que les inscriptions sont fermées.'}</small></span>
        <button type="button" class="bouton bouton--petit${ouvert ? '' : ' bouton--plein'}" data-action="basculer">${ouvert ? 'Fermer les inscriptions' : 'Ouvrir les inscriptions'}</button>
      </div>
      <div class="t-gestion__ligne">
        <span><strong>Lancer le tournoi</strong><small>${nb >= min ? 'Tirage au sort, puis création des ' + (t.format === 'pools' ? 'poules et de leurs matchs.' : 'matchs de l\'arbre.') : `Il faut au moins ${min} inscrits.`}</small></span>
        <button type="button" class="bouton bouton--petit bouton--plein" data-action="lancer"${nb < min ? ' disabled' : ''}>Lancer le tournoi</button>
      </div>
      <div class="actions">
        <button type="button" class="bouton bouton--petit" data-action="ajouter"${nb >= t.max_participants ? ' disabled title="Tournoi complet"' : ''}>+ Ajouter un participant</button>
        <a class="bouton bouton--petit" href="tournoi-creer.html?id=${encodeURIComponent(t.id)}">Modifier les paramètres</a>
        <button type="button" class="bouton bouton--petit bouton--danger" data-action="supprimer">Supprimer le tournoi</button>
      </div>
    </section>`;
}

function contenuOnglet(cle) {
  if (cle === 'participants') return vueParticipants();
  if (cle === 'poules') return vuePoules();
  if (cle === 'arbre') return vueArbre();
  if (cle === 'matchs') return vueMatchs();
  if (cle === 'stats') return vueStats();
  return vueInfos();
}

// ---------- Participants ----------

function vueParticipants() {
  const orga = estOrganisateur();
  if (!inscrits.length) {
    return `<p class="vide">Aucun inscrit pour l'instant.${orga ? ' Partagez le code ou ajoutez des participants.' : ''}</p>`;
  }
  const mi = monInscription();
  const lignes = inscrits.map((e, i) => {
    const moiIci = mi && e.id === mi.id;
    const peutRetirer = avantLancement() && (orga || (moi && e.profile_id === moi.id));
    return `
      <li class="t-inscrit${moiIci ? ' t-inscrit--moi' : ''}">
        <span class="t-inscrit__num">${i + 1}</span>
        ${photosMembres.has(e.profile_id) ? avatar(photosMembres.get(e.profile_id), 'avatar--mini') : ''}
        <span class="t-inscrit__nom"><strong>${moi && e.profile_id ? `<a href="profil.html?id=${e.profile_id}">${esc(e.nom)}</a>` : esc(e.nom)}</strong>${e.detail ? `<small>${esc(e.detail)}</small>` : ''}</span>
        ${e.pool_no && t.format === 'pools' ? `<span class="t-poule-mini">Poule ${lettrePoule(e.pool_no)}</span>` : ''}
        ${moiIci ? '<span class="t-moi">Vous</span>' : ''}
        ${peutRetirer ? `<button type="button" class="bouton bouton--icone bouton--danger" data-retirer="${e.id}" aria-label="${moi && e.profile_id === moi.id ? 'Me désinscrire' : `Retirer ${esc(e.nom)}`}" title="${moi && e.profile_id === moi.id ? 'Me désinscrire' : 'Retirer'}">✕</button>` : ''}
      </li>`;
  }).join('');
  const quitter = mi && moi && mi.profile_id === moi.id && avantLancement()
    ? `<button type="button" class="bouton bouton--petit bouton--danger" data-retirer="${mi.id}" data-moi="1">Me désinscrire</button>` : '';
  return `<ol class="t-inscrits">${lignes}</ol>${quitter ? `<div class="actions">${quitter}</div>` : ''}`;
}

// ---------- Matchs : briques communes ----------

// « A1 » = 1er de la poule A (phase finale d'un tournoi à poules)
let etiquettes = null;
function etiquettePoule(idE) {
  if (!etiquettes) {
    etiquettes = new Map();
    for (let k = 1; k <= (t.pools_count || 0); k++) {
      const membres = inscrits.filter((e) => e.pool_no === k).sort((a, b) => (a.seed || 0) - (b.seed || 0));
      classementPoule(membres.map((e) => e.id), matchs.filter((m) => m.phase === 'pool' && m.pool_no === k))
        .forEach((c) => etiquettes.set(c.id, `${lettrePoule(k)}${c.rang}`));
    }
  }
  return etiquettes.get(idE) || '';
}

function nomEntree(idInscrit) {
  return parId.get(idInscrit)?.nom || 'Ancien joueur';
}

// Libellé d'une place encore inconnue : « Vainqueur M3 », « Perdant M7 »
function placeVide(m, cote) {
  const source = matchs.find((x) => x.next_match_id === m.id && x.next_slot === cote);
  if (source) return `Vainqueur M${source.match_no}`;
  const perdant = matchs.find((x) => x.loser_match_id === m.id && x.loser_slot === cote);
  if (perdant) return `Perdant M${perdant.match_no}`;
  return 'À déterminer';
}

function libelleMatch(m) {
  if (m.phase === 'pool') return `Poule ${lettrePoule(m.pool_no)} · journée ${m.round_no}`;
  if (m.is_third_place) return 'Match pour la 3e place';
  const nb = matchs.filter((x) => x.phase === 'final' && x.round_no === m.round_no && !x.is_third_place).length;
  return nomTour(nb);
}

const STATUT_MATCH = {
  waiting: { texte: 'En attente', classe: 'attente' },
  ready: { texte: 'À jouer', classe: 'pret' },
  live: { texte: 'En cours', classe: 'live' },
  done: { texte: 'Terminé', classe: 'fini' },
  bye: { texte: 'Exemption', classe: 'bye' },
};

function ligneJoueur(m, cote) {
  const idE = cote === 'a' ? m.entry_a : m.entry_b;
  const score = cote === 'a' ? m.score_a : m.score_b;
  const gagnant = m.winner_entry && m.winner_entry === idE;
  const mi = monInscription();
  const moiIci = mi && idE === mi.id;
  if (!idE) {
    const texte = m.status === 'bye' ? 'Exempté' : placeVide(m, cote);
    return `<div class="m-joueur m-joueur--vide"><span class="m-joueur__nom">${esc(texte)}</span><span class="m-joueur__score"></span></div>`;
  }
  const seed = m.phase === 'final' && t.format === 'pools' ? etiquettePoule(idE) : parId.get(idE)?.seed;
  return `
    <div class="m-joueur${gagnant ? ' m-joueur--gagnant' : ''}${m.status === 'done' && !gagnant ? ' m-joueur--perdant' : ''}${moiIci ? ' m-joueur--moi' : ''}">
      ${m.phase === 'final' && seed ? `<span class="m-joueur__seed">${seed}</span>` : ''}
      <span class="m-joueur__nom">${esc(nomEntree(idE))}</span>
      <span class="m-joueur__score">${m.status === 'done' ? (m.forfeit ? (gagnant ? 'V' : 'F') : (score ?? '')) : (m.status === 'bye' && gagnant ? '✓' : '')}</span>
    </div>`;
}

function boutonMatch(m) {
  const orga = role === 'organisateur';
  const autorise = orga || role === 'participant';
  const jeTiensLeScore = moi && m.game_created_by === moi.id;
  const boutons = [];
  if (m.status === 'ready' && autorise) {
    boutons.push(`<button type="button" class="bouton bouton--petit${estMonMatch(m) ? ' bouton--plein' : ''}" data-lancer="${m.id}">Lancer le match</button>`);
  }
  if (m.status === 'live' && m.game_id) {
    if (m.game_status === 'finished' && (jeTiensLeScore || orga)) {
      boutons.push(`<button type="button" class="bouton bouton--petit bouton--plein" data-valider="${m.game_id}">Valider le résultat</button>`);
    }
    if (jeTiensLeScore || (moi?.role === 'admin')) {
      boutons.push(`<a class="bouton bouton--petit${m.game_status === 'finished' ? '' : ' bouton--plein'}" href="scorer.html?id=${encodeURIComponent(m.game_id)}">${m.game_status === 'finished' ? 'Ouvrir le scorer' : 'Reprendre le scorer'}</a>`);
    } else {
      boutons.push(`<a class="bouton bouton--petit" href="live.html?id=${encodeURIComponent(m.game_id)}">${m.game_status === 'finished' ? 'Voir le score' : 'Suivre en direct'}</a>`);
    }
  }
  if (m.status === 'done' && m.game_id) {
    boutons.push(`<a class="bouton bouton--petit" href="live.html?id=${encodeURIComponent(m.game_id)}">Récapitulatif</a>`);
  }
  if (orga) {
    if (m.status === 'ready' || m.status === 'live') boutons.push(`<button type="button" class="bouton bouton--petit bouton--discret" data-forfait="${m.id}">Forfait…</button>`);
    if (m.status === 'done') boutons.push(`<button type="button" class="bouton bouton--petit bouton--discret" data-corriger="${m.id}">Corriger le score</button>`);
    if (m.status === 'done' || m.status === 'live') boutons.push(`<button type="button" class="bouton bouton--petit bouton--discret" data-reinit="${m.id}">Remettre à jouer</button>`);
  }
  return boutons.join('');
}

// Format du match : le sien (fixé par tour) ou celui de la phase
function formatMatch(m) {
  return m.format || (m.phase === 'pool' ? t.pool_format : t.final_format);
}

function etatPartieMatch(m) {
  const notes = [];
  if (m.status === 'live' && m.game_status === 'finished') notes.push('<p class="m-carte__note">Partie terminée : résultat à valider.</p>');
  if (m.corrected_at) notes.push('<p class="m-carte__note m-carte__note--gris">Score corrigé par l\'organisateur</p>');
  if (m.format && m.status !== 'done' && m.status !== 'bye') notes.push(`<p class="m-carte__note m-carte__note--gris">${esc(formatPartie(m.format))}</p>`);
  return notes.join('');
}

function carteMatch(m, { avecLibelle = true, compacte = false } = {}) {
  const s = STATUT_MATCH[m.status];
  const mien = estMonMatch(m);
  return `
    <article class="m-carte m-carte--${s.classe}${mien ? ' m-carte--moi' : ''}${compacte ? ' m-carte--compacte' : ''}" id="match-${m.match_no}">
      <header class="m-carte__haut">
        <span class="m-carte__no">M${m.match_no}</span>
        ${avecLibelle ? `<span class="m-carte__libelle">${esc(libelleMatch(m))}</span>` : '<span class="m-carte__libelle"></span>'}
        ${mien ? '<span class="m-moi">Mon match</span>' : ''}
        <span class="m-statut m-statut--${s.classe}">${s.texte}</span>
      </header>
      ${ligneJoueur(m, 'a')}
      ${ligneJoueur(m, 'b')}
      ${compacte ? '' : `${etatPartieMatch(m)}<div class="m-carte__actions">${boutonMatch(m)}</div>`}
    </article>`;
}

// ---------- Poules ----------

function vuePoules() {
  const nbPoules = t.pools_count || Math.max(0, ...inscrits.map((e) => e.pool_no || 0));
  if (!nbPoules) return '<p class="vide">Les poules apparaîtront au lancement du tournoi.</p>';
  const mi = monInscription();
  const blocs = [];
  for (let k = 1; k <= nbPoules; k++) {
    const membres = inscrits.filter((e) => e.pool_no === k).sort((a, b) => (a.seed || 0) - (b.seed || 0));
    const mPoule = matchs.filter((m) => m.phase === 'pool' && m.pool_no === k);
    const classement = classementPoule(membres.map((e) => e.id), mPoule);
    const qualif = t.pool_qualifiers || 0;
    const maPoule = mi && membres.some((e) => e.id === mi.id);
    const lignes = classement.map((c) => {
      const e = parId.get(c.id);
      const moiIci = mi && c.id === mi.id;
      return `
        <tr class="${c.rang <= qualif ? 'p-qualif' : ''}${moiIci ? ' p-moi' : ''}">
          <td class="p-rang">${c.rang}</td>
          <th scope="row" class="p-nom">${esc(e?.nom || '—')}${moiIci ? ' <span class="t-moi">Vous</span>' : ''}${c.critere ? `<small>${esc(c.critere)}</small>` : ''}</th>
          <td>${c.joues}</td><td>${c.victoires}</td><td>${c.defaites}</td>
          <td>${c.pour}-${c.contre}</td>
          <td class="p-points">${c.points}</td>
        </tr>`;
    }).join('');
    const journees = [...new Set(mPoule.map((m) => m.round_no))].sort((a, b) => a - b);
    const joues = mPoule.filter((m) => m.status === 'done').length;
    blocs.push(`
      <section class="p-poule${maPoule ? ' p-poule--moi' : ''}">
        <header class="p-poule__haut">
          <h3>Poule ${lettrePoule(k)}</h3>
          ${maPoule ? '<span class="m-moi">Ma poule</span>' : ''}
          <span class="p-poule__info">${membres.length} ${t.team_mode === 'double' ? 'doublettes' : 'joueurs'} · ${joues}/${mPoule.length} matchs</span>
        </header>
        <div class="p-tableau-cadre">
          <table class="p-tableau">
            <thead><tr><th>#</th><th class="p-nom">${t.team_mode === 'double' ? 'Doublette' : 'Joueur'}</th><th title="Matchs joués">J</th><th title="Victoires">V</th><th title="Défaites">D</th><th title="Manches gagnées - perdues">Manches</th><th title="Points">Pts</th></tr></thead>
            <tbody>${lignes}</tbody>
          </table>
        </div>
        <details class="p-matchs"${maPoule ? ' open' : ''}>
          <summary>Matchs de la poule</summary>
          ${journees.map((j) => `
            <h4 class="p-journee">Journée ${j}</h4>
            <div class="m-liste">${mPoule.filter((m) => m.round_no === j).map((m) => carteMatch(m, { avecLibelle: false })).join('')}</div>`).join('')}
        </details>
      </section>`);
  }
  return `
    <p class="t-legende">Les ${t.pool_qualifiers} premier${t.pool_qualifiers > 1 ? 's' : ''} de chaque poule (surlignés) se qualifient pour la phase finale.
      Classement : ${POINTS_VICTOIRE} points par victoire, ${POINTS_DEFAITE} point par défaite ; à égalité, le plus de manches gagnées, puis le match entre les joueurs à égalité.</p>
    <div class="p-poules">${blocs.join('')}</div>`;
}

// ---------- Arbre ----------

// Sous le titre d'un tour : son format, et le bouton « Format » pour l'organisateur
function enteteTour(r, duTour, petite) {
  const tous = [...duTour, ...(petite ? [petite] : [])];
  const reels = tous.filter((m) => m.status !== 'bye');
  if (!reels.length) return '';
  const formats = [...new Set(reels.map((m) => JSON.stringify(formatMatch(m) || null)))];
  const libelle = formats.length === 1 && formatMatch(reels[0]) ? formatPartie(formatMatch(reels[0])) : 'Formats variés';
  const modifiable = role === 'organisateur' && t.status === 'running' && reels.some((m) => (m.status === 'waiting' || m.status === 'ready') && !m.game_id);
  return `<p class="a-tour__format">${esc(libelle.replace(/^\d+ · |^Score libre \d+ · /, ''))}${modifiable ? ` <button type="button" class="a-tour__modifier" data-format-tour="${r}" aria-label="Changer le format des matchs de ce tour">Modifier</button>` : ''}</p>`;
}

function vueArbre() {
  const finals = matchs.filter((m) => m.phase === 'final');
  if (!finals.length) {
    if (t.format === 'pools') {
      const q = (t.pool_qualifiers || 0) * (t.pools_count || 0);
      return `<p class="vide">La phase finale sera créée automatiquement à la fin des poules, avec les ${q || ''} qualifiés${t.final_format ? '' : ' ; l\'organisateur choisira alors le format des matchs'}.</p>`;
    }
    return '<p class="vide">L\'arbre apparaîtra au lancement du tournoi.</p>';
  }
  const tours = Math.max(...finals.map((m) => m.round_no));
  const colonnes = [];
  for (let r = 1; r <= tours; r++) {
    const duTour = finals.filter((m) => m.round_no === r && !m.is_third_place).sort((a, b) => a.position - b.position);
    const petite = finals.find((m) => m.round_no === r && m.is_third_place);
    colonnes.push(`
      <div class="a-tour">
        <h3 class="a-tour__titre">${esc(nomTour(duTour.length))}</h3>
        ${enteteTour(r, duTour, petite)}
        <div class="a-tour__matchs">
          ${duTour.map((m) => `<div class="a-case">${carteMatch(m, { avecLibelle: false, compacte: true })}</div>`).join('')}
        </div>
        ${petite ? `<div class="a-petite"><h3 class="a-tour__titre">3e place</h3>${carteMatch(petite, { avecLibelle: false, compacte: true })}</div>` : ''}
      </div>`);
  }
  const mien = finals.some(estMonMatch);
  return `
    <p class="t-legende">Faites défiler l'arbre de gauche à droite. ${mien ? 'Vos matchs sont encadrés en orange (« Mon match »).' : ''} Touchez un match pour voir ses détails dans l'onglet Matchs.</p>
    <div class="a-cadre"><div class="a-arbre" style="--tours:${tours}">${colonnes.join('')}</div></div>`;
}

// ---------- Liste des matchs ----------

function vueMatchs() {
  const vrais = matchs.filter((m) => m.status !== 'bye');
  const groupes = [
    ['live', 'En cours'],
    ['ready', 'À jouer'],
    ['waiting', 'En attente des matchs précédents'],
    ['done', 'Terminés'],
  ];
  const mien = vrais.filter(estMonMatch);
  const sections = [];
  if (mien.length) {
    const ordre = { live: 0, ready: 1, waiting: 2, done: 3 };
    sections.push(`
      <section class="m-groupe m-groupe--moi">
        <h3 class="m-groupe__titre">Mes matchs</h3>
        <div class="m-liste">${[...mien].sort((a, b) => ordre[a.status] - ordre[b.status] || a.match_no - b.match_no).map((m) => carteMatch(m)).join('')}</div>
      </section>`);
  }
  // Mes matchs sont regroupés en tête : on ne les répète pas dans les autres groupes
  for (const [st, titre] of groupes) {
    const liste = vrais.filter((m) => m.status === st && !estMonMatch(m));
    if (!liste.length) continue;
    sections.push(`
      <section class="m-groupe">
        <h3 class="m-groupe__titre">${titre} <span class="t-compte">${liste.length}</span></h3>
        <div class="m-liste">${liste.map((m) => carteMatch(m)).join('')}</div>
      </section>`);
  }
  return sections.join('') || '<p class="vide">Aucun match pour l\'instant.</p>';
}

function mesMatchsAJouer() {
  return matchs.filter((m) => (m.status === 'ready' || m.status === 'live') && estMonMatch(m)).length;
}

// ---------- Stats du tournoi : tableau par joueur ----------

let statsTournoi = null;           // résultat de stats_tournoi (rechargé avec la page)
let chargementStats = false;
let triStats = { cle: 'victoires', sens: -1 };
const virguleT = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(d).replace('.', ','));

const COLONNES_STATS = [
  ['nom', 'Joueur', (l) => l.nom],
  ['matchs', 'MJ', (l) => l.matchs, 'Matchs joués'],
  ['victoires', 'V', (l) => l.victoires, 'Victoires'],
  ['defaites', 'D', (l) => l.defaites, 'Défaites'],
  ['manches', 'Manches', (l) => l.manches_gagnees - l.manches_perdues, 'Manches gagnées – perdues'],
  ['moyenne', 'Moy.', (l) => l.moyenne ?? -1, 'Moyenne 3 fléchettes'],
  ['double', 'Double', (l) => l.double ?? -1, 'Réussite au double'],
  ['nb_180', '180', (l) => l.nb_180, 'Nombre de 180'],
  ['meilleur_finish', 'Finish', (l) => l.meilleur_finish ?? -1, 'Meilleur finish'],
];

async function chargerStats() {
  if (chargementStats) return;
  chargementStats = true;
  const { data, error } = await supabase.rpc('stats_tournoi', { p_tournoi: id });
  chargementStats = false;
  statsTournoi = error ? { erreur: error } : (data || []).map((l) => ({
    ...l,
    nom: nomEntree(l.entry_id),
    moyenne: l.flechettes ? (l.points / l.flechettes) * 3 : null,
    double: l.flechettes_double ? (l.finishs / l.flechettes_double) * 100 : null,
  }));
  if (onglet === 'stats') {
    const panneau = zone.querySelector('.t-panneau');
    if (panneau) { panneau.innerHTML = vueStats(); brancherStats(); }
  }
}

function vueStats() {
  if (!statsTournoi) {
    chargerStats();
    return '<p class="vide">Calcul des statistiques…</p>';
  }
  if (statsTournoi.erreur) {
    return `<p class="vide">${esc(statsTournoi.erreur.code === 'P0001' ? statsTournoi.erreur.message : 'Statistiques indisponibles (script SQL 020 à exécuter dans Supabase ?).')}</p>`;
  }
  const col = COLONNES_STATS.find((c) => c[0] === triStats.cle) || COLONNES_STATS[2];
  const lignes = [...statsTournoi].sort((a, b) => {
    const va = col[2](a); const vb = col[2](b);
    if (typeof va === 'string') return va.localeCompare(vb, 'fr') * -triStats.sens;
    return (va - vb) * triStats.sens || (b.manches_gagnees - b.manches_perdues) - (a.manches_gagnees - a.manches_perdues) || a.nom.localeCompare(b.nom, 'fr');
  });
  const mi = monInscription();
  const entete = COLONNES_STATS.map(([cle, lib, , titre]) => {
    const actif = cle === triStats.cle;
    return `<th scope="col"${cle === 'nom' ? ' class="ts-nom"' : ''} aria-sort="${actif ? (triStats.sens < 0 ? 'descending' : 'ascending') : 'none'}"><button type="button" data-tri="${cle}"${titre ? ` title="${titre}"` : ''}>${lib}${actif ? (triStats.sens < 0 ? ' ▾' : ' ▴') : ''}</button></th>`;
  }).join('');
  const corps = lignes.map((l) => {
    const moiIci = mi && l.entry_id === mi.id;
    return `
      <tr class="${moiIci ? 'p-moi' : ''}">
        <th scope="row" class="ts-nom">${esc(l.nom)}${moiIci ? ' <span class="t-moi">Vous</span>' : ''}${l.forfaits ? `<small>${l.forfaits} forfait${l.forfaits > 1 ? 's' : ''}</small>` : ''}</th>
        <td>${l.matchs}</td>
        <td class="s-gagne">${l.victoires}</td>
        <td class="s-perdu">${l.defaites}</td>
        <td><span class="s-gagne">${l.manches_gagnees}</span>-<span class="s-perdu">${l.manches_perdues}</span></td>
        <td class="ts-fort">${virguleT(l.moyenne)}</td>
        <td>${l.double === null ? '–' : `${virguleT(l.double)} %`}</td>
        <td>${l.nb_180}</td>
        <td>${l.meilleur_finish ?? '–'}</td>
      </tr>`;
  }).join('');
  return `
    <p class="t-legende">Touchez un titre de colonne pour trier. Matchs terminés et joués du tournoi (les forfaits ne comptent pas comme matchs joués). Moyenne et double : calculés sur les volées saisies dans le scorer.</p>
    <div class="p-tableau-cadre ts-cadre">
      <table class="p-tableau ts-tableau">
        <thead><tr>${entete}</tr></thead>
        <tbody>${corps}</tbody>
      </table>
    </div>`;
}

function brancherStats() {
  zone.querySelectorAll('[data-tri]').forEach((b) => b.addEventListener('click', () => {
    const cle = b.dataset.tri;
    triStats = triStats.cle === cle ? { cle, sens: -triStats.sens } : { cle, sens: cle === 'nom' ? 1 : -1 };
    zone.querySelector('.t-panneau').innerHTML = vueStats();
    brancherStats();
  }));
}

// ---------- Infos ----------

function vueInfos() {
  const lignes = [
    ['Participants', `${t.team_mode === 'double' ? 'Double (2v2)' : 'Individuel'} · ${t.max_participants} places maximum`],
    ['Format', t.format === 'pools' ? 'Poules puis élimination directe' : 'Élimination directe'],
  ];
  if (t.format === 'pools') {
    lignes.push(['Poules', `${t.pools_count ? `${t.pools_count} poules` : 'Nombre choisi au lancement'} · ${t.pool_qualifiers} qualifié${t.pool_qualifiers > 1 ? 's' : ''} par poule`]);
    lignes.push(['Classement des poules', `${POINTS_VICTOIRE} points par victoire, ${POINTS_DEFAITE} point par défaite. Égalité : le plus de manches gagnées, puis le vainqueur du match entre les joueurs à égalité.`]);
    if (t.pool_format) lignes.push(['Matchs de poule', esc(formatPartie(t.pool_format))]);
  }
  if (t.final_format) lignes.push([t.format === 'pools' ? 'Matchs de la phase finale' : 'Matchs', esc(formatPartie(t.final_format))]);
  if (!t.pool_format && !t.final_format) lignes.push(['Format des matchs', 'Choisi par l\'organisateur au lancement de chaque phase']);
  lignes.push(['Placement', 'Tirage au sort ; les exemptions éventuelles sont réparties dans l\'arbre']);
  lignes.push(['Match pour la 3e place', t.third_place ? 'Oui' : 'Non']);
  lignes.push(['Matchs', t.public_matches ? 'Publics (visibles dans « Matchs en cours »)' : 'Privés']);
  lignes.push(['Guide de finish', t.show_checkout === false ? 'Masqué' : 'Affiché dans le scorer']);
  lignes.push(['Créé le', esc(dateFr(t.created_at))]);
  if (t.started_at) lignes.push(['Lancé le', esc(dateFr(t.started_at))]);
  return `<dl class="t-recap">${lignes.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

// ---------- Actions ----------

function brancher() {
  zone.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => {
    onglet = b.dataset.onglet;
    afficher();
  }));
  if (onglet === 'stats') brancherStats();
  // Dans l'arbre, toucher un match ouvre sa fiche dans l'onglet Matchs
  zone.querySelectorAll('.a-case .m-carte, .a-petite .m-carte').forEach((c) => {
    c.setAttribute('role', 'button');
    c.tabIndex = 0;
    const ouvrir = () => {
      const no = c.id;
      onglet = 'matchs';
      afficher();
      const cible = document.querySelectorAll(`#${no}`);
      const el = cible[cible.length - 1];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.classList.add('m-carte--repere');
    };
    c.addEventListener('click', ouvrir);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') ouvrir(); });
  });

  document.getElementById('btn-copier')?.addEventListener('click', async (e) => {
    const ok = await copier(t.code);
    e.target.textContent = ok ? 'Code copié ✓' : 'Copie impossible';
    setTimeout(() => { e.target.textContent = 'Copier le code'; }, 2000);
  });
  document.getElementById('btn-partager')?.addEventListener('click', async (e) => {
    const lien = `${BASE_URL}tournois.html?code=${t.code}`;
    const texte = `Rejoins le tournoi « ${t.name} » du Dolina Darts Club avec le code ${t.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: t.name, text: texte, url: lien }); } catch { /* partage annulé */ }
      return;
    }
    const ok = await copier(`${texte} : ${lien}`);
    e.target.textContent = ok ? 'Lien copié ✓' : 'Copie impossible';
    setTimeout(() => { e.target.textContent = 'Partager'; }, 2000);
  });

  zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => retirer(b.dataset.retirer, !!b.dataset.moi || parId.get(b.dataset.retirer)?.profile_id === moi?.id)));
  zone.querySelector('[data-action="basculer"]')?.addEventListener('click', basculer);
  zone.querySelector('[data-action="supprimer"]')?.addEventListener('click', supprimer);
  zone.querySelector('[data-action="ajouter"]')?.addEventListener('click', ouvrirAjout);
  zone.querySelector('[data-action="lancer"]')?.addEventListener('click', ouvrirLancement);
  zone.querySelector('[data-action="annuler-lancement"]')?.addEventListener('click', annulerLancement);
  zone.querySelector('[data-action="phase-finale"]')?.addEventListener('click', () => ouvrirLancement('finale'));
  zone.querySelectorAll('[data-lancer]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ouvrirBull(b.dataset.lancer); }));
  zone.querySelectorAll('[data-valider]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); valider(b.dataset.valider, b); }));
  zone.querySelectorAll('[data-forfait]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ouvrirForfait(b.dataset.forfait); }));
  zone.querySelectorAll('[data-corriger]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ouvrirCorrection(b.dataset.corriger); }));
  zone.querySelectorAll('[data-format-tour]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); ouvrirLancement('tour', Number(b.dataset.formatTour)); }));
  zone.querySelectorAll('[data-reinit]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); reinitialiser(b.dataset.reinit); }));
}

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    const zoneTexte = document.createElement('textarea');
    zoneTexte.value = texte;
    document.body.appendChild(zoneTexte);
    zoneTexte.select();
    const ok = document.execCommand('copy');
    zoneTexte.remove();
    return ok;
  }
}

async function action(fn) {
  if (enCours) return;
  enCours = true;
  try { await fn(); } finally { enCours = false; }
}

function basculer() {
  action(async () => {
    const statut = t.status === 'open' ? 'draft' : 'open';
    const { error } = await supabase.from('tournaments').update({ status: statut }).eq('id', t.id).select('id').single();
    if (error) return message(zoneMsg, erreurFr(error));
    message(zoneMsg, statut === 'open' ? 'Inscriptions ouvertes : le code fonctionne.' : 'Inscriptions fermées.', 'ok');
    await charger();
  });
}

function supprimer() {
  if (!confirm(`Supprimer définitivement le tournoi « ${t.name} » et toutes ses inscriptions ?`)) return;
  action(async () => {
    const { error } = await supabase.rpc('supprimer_tournoi', { p_tournoi: t.id, p_avec_parties: false });
    if (error) return message(zoneMsg, erreurFr(error));
    location.href = 'tournois.html';
  });
}

function retirer(idInscrit, soiMeme) {
  const e = parId.get(idInscrit);
  if (!e) return;
  if (!confirm(soiMeme ? 'Vous désinscrire de ce tournoi ?' : `Retirer ${e.nom} du tournoi ?`)) return;
  action(async () => {
    const { data, error } = await supabase.from('tournament_entries').delete().eq('id', idInscrit).select('id');
    if (error || !data?.length) return message(zoneMsg, error ? erreurFr(error) : 'Ce participant n\'a pas pu être retiré.');
    if (soiMeme && !estOrganisateur()) {
      location.href = 'tournois.html';
      return;
    }
    message(zoneMsg, soiMeme ? 'Vous êtes désinscrit.' : 'Participant retiré.', 'ok');
    await charger();
  });
}

function annulerLancement() {
  if (!confirm('Annuler le lancement ? Le tirage et les matchs seront effacés ; les inscrits sont conservés et le tournoi repasse « en préparation ».')) return;
  action(async () => {
    const { error } = await supabase.rpc('annuler_lancement', { p_tournoi: t.id });
    if (error) return message(zoneMsg, erreurFr(error));
    message(zoneMsg, 'Lancement annulé : le tournoi est de nouveau en préparation (inscriptions fermées).', 'ok');
    onglet = 'participants';
    await charger();
  });
}

// ---------- Lancement : format des matchs et nombre de poules ----------

const choixLancement = { variant: '501' };

let modeLancement = 'tournoi';     // 'tournoi' (tirage), 'finale' (après les poules) ou 'tour' (format d'un tour)
let tourChoisi = null;

function ouvrirLancement(mode = 'tournoi', tour = null) {
  modeLancement = mode;
  tourChoisi = tour;
  const f = document.getElementById('form-lancer');
  f.reset();
  choixLancement.variant = t.pool_format?.variant && mode === 'finale' ? t.pool_format.variant : '501';
  if (mode === 'finale' && t.pool_format?.variant === 'libre') f.elements.start_score.value = t.pool_format.start_score;
  majVariant();
  const n = inscrits.length;
  const blocPoules = document.getElementById('lancer-poules');
  blocPoules.hidden = t.format !== 'pools' || mode === 'finale';
  document.getElementById('t-lancer').textContent = mode === 'finale' ? 'Lancer la phase finale' : 'Lancer le tournoi';
  f.querySelector('[type=submit]').textContent = mode === 'finale' ? 'Créer l\'arbre final' : 'Lancer et tirer au sort';
  if (mode === 'tour') {
    const duTour = matchs.filter((m) => m.phase === 'final' && m.round_no === tour);
    const nb = duTour.filter((m) => !m.is_third_place).length;
    const actuel = formatMatch(duTour.find((m) => m.status !== 'bye') || duTour[0]) || t.final_format;
    if (actuel) {
      choixLancement.variant = actuel.variant;
      majVariant();
      f.elements.start_score.value = actuel.start_score || 1001;
      f.elements.legs_kind.value = actuel.legs_kind;
      f.elements.legs_n.value = actuel.legs_n;
      f.elements.sets_kind.value = actuel.sets_kind || '';
      f.elements.sets_n.value = actuel.sets_n || 3;
    }
    document.getElementById('t-lancer').textContent = `Format : ${nomTour(nb)}`;
    f.querySelector('[type=submit]').textContent = 'Appliquer à ce tour';
    document.getElementById('erreur-lancer').textContent = '';
    document.getElementById('lancer-intro').textContent = `Nombre de manches (ou de sets) pour gagner un match de ce tour${duTour.some((m) => m.is_third_place) ? ', match pour la 3e place compris' : ''}. Seuls les matchs pas encore commencés changent.`;
    majResumeLancement();
    fenLancer.hidden = false;
    return;
  }
  if (mode === 'finale') {
    const q = t.pool_qualifiers * t.pools_count;
    document.getElementById('erreur-lancer').textContent = '';
    document.getElementById('lancer-intro').textContent = `Les ${t.pool_qualifiers} premier${t.pool_qualifiers > 1 ? 's' : ''} de chaque poule (${q} qualifiés) : les premiers de poule sont les mieux placés, et deux joueurs d'une même poule ne se rencontrent pas au premier tour quand c'est possible (1er A contre 2e B…). Choisissez le format des matchs de la phase finale.`;
    majResumeLancement();
    fenLancer.hidden = false;
    return;
  }
  if (t.format === 'pools') {
    const sel = f.elements.poules;
    const max = Math.min(16, Math.floor(n / 2));
    const defaut = Math.min(max, t.pools_count || Math.max(1, Math.ceil(n / 4)));
    sel.innerHTML = Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1} poule${i ? 's' : ''}</option>`).join('');
    sel.value = String(defaut);
  }
  majResumeLancement();
  document.getElementById('erreur-lancer').textContent = '';
  document.getElementById('lancer-intro').textContent = t.format === 'pools'
    ? `${n} ${t.team_mode === 'double' ? 'doublettes' : 'joueurs'} : tirage au sort des poules, puis création des matchs de poule (chacun contre chacun). Le format de la phase finale se choisira à la fin des poules.`
    : `${n} ${t.team_mode === 'double' ? 'doublettes' : 'joueurs'} : tirage au sort, puis création de l'arbre${(n & (n - 1)) !== 0 ? ' avec des exemptions au premier tour (nombre de joueurs qui n\'est pas une puissance de 2)' : ''}.`;
  fenLancer.hidden = false;
}

function majVariant() {
  document.querySelectorAll('#form-lancer [data-variant]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.variant === choixLancement.variant)));
  document.getElementById('lancer-libre').hidden = choixLancement.variant !== 'libre';
}

function lireFormat() {
  const f = document.getElementById('form-lancer').elements;
  return {
    variant: choixLancement.variant,
    start_score: choixLancement.variant === 'libre' ? Number(f.start_score.value) : Number(choixLancement.variant),
    legs_kind: f.legs_kind.value,
    legs_n: Number(f.legs_n.value),
    sets_kind: f.sets_kind.value || null,
    sets_n: f.sets_kind.value ? Number(f.sets_n.value) : null,
  };
}

function majResumeLancement() {
  const f = document.getElementById('form-lancer').elements;
  f.sets_n.hidden = !f.sets_kind.value;
  const format = lireFormat();
  let texte = formatPartie(format);
  if (t.format === 'pools' && modeLancement !== 'finale') {
    const n = inscrits.length;
    const p = Number(f.poules.value) || 1;
    const base = Math.floor(n / p);
    const plus = n % p;
    const morceaux = [];
    if (p - plus) morceaux.push(`${p - plus} poule${p - plus > 1 ? 's' : ''} de ${base}`);
    if (plus) morceaux.push(`${plus} poule${plus > 1 ? 's' : ''} de ${base + 1}`);
    texte += ` · ${morceaux.join(' et ')} → ${p * t.pool_qualifiers} qualifiés`;
    if (t.pool_qualifiers > base) texte += ` (impossible : ${t.pool_qualifiers} qualifiés pour des poules de ${base})`;
    else if (t.pool_qualifiers === base) texte += ` (attention : dans les poules de ${base}, tout le monde est qualifié)`;
  }
  document.getElementById('lancer-resume').textContent = texte;
}

document.getElementById('form-lancer').addEventListener('click', (e) => {
  const b = e.target.closest('[data-variant]');
  if (b) { choixLancement.variant = b.dataset.variant; majVariant(); majResumeLancement(); }
});
document.getElementById('form-lancer').addEventListener('input', majResumeLancement);
document.getElementById('form-lancer').addEventListener('change', majResumeLancement);
fenLancer.addEventListener('click', (e) => {
  if (e.target === fenLancer || e.target.closest('[data-fermer]')) fenLancer.hidden = true;
});

document.getElementById('form-lancer').addEventListener('submit', (e) => {
  e.preventDefault();
  const erreur = document.getElementById('erreur-lancer');
  const format = lireFormat();
  if (format.legs_kind === 'best_of' && format.legs_n % 2 === 0) { erreur.textContent = '« Au meilleur de » demande un nombre impair de manches.'; return; }
  if (format.sets_kind === 'best_of' && format.sets_n % 2 === 0) { erreur.textContent = '« Au meilleur de » demande un nombre impair de sets.'; return; }
  const bouton = e.target.querySelector('[type=submit]');
  action(async () => {
    bouton.disabled = true;
    let error;
    if (modeLancement === 'tour') {
      ({ error } = await supabase.rpc('definir_format_tour', { p_tournoi: t.id, p_tour: tourChoisi, p_format: format }));
    } else if (modeLancement === 'finale') {
      ({ error } = await supabase.rpc('lancer_phase_finale', { p_tournoi: t.id, p_format: format }));
    } else {
      const params = { p_tournoi: t.id, p_format: format };
      if (t.format === 'pools') params.p_poules = Number(e.target.elements.poules.value);
      ({ error } = await supabase.rpc('lancer_tournoi', params));
    }
    bouton.disabled = false;
    if (error) { erreur.textContent = erreurFr(error); return; }
    fenLancer.hidden = true;
    message(zoneMsg, modeLancement === 'tour' ? `Format appliqué : ${formatPartie(format)}.` : modeLancement === 'finale' ? 'Phase finale lancée : l\'arbre est créé avec les qualifiés.'
      : (t.format === 'pools' ? 'Tournoi lancé : les poules sont tirées au sort.' : 'Tournoi lancé : l\'arbre est tiré au sort.'), 'ok');
    onglet = modeLancement === 'finale' || modeLancement === 'tour' ? 'arbre' : (t.format === 'pools' ? 'poules' : 'arbre');
    await charger();
  });
});

// ---------- Matchs : lancer (tirage au bull), valider, forfait, correction ----------

const fenBull = document.getElementById('fen-bull');
const fenForfait = document.getElementById('fen-forfait');
let matchChoisi = null;

function ouvrirBull(idMatch) {
  matchChoisi = matchs.find((m) => m.id === idMatch);
  if (!matchChoisi) return;
  document.getElementById('bull-match').textContent = `M${matchChoisi.match_no} · ${libelleMatch(matchChoisi)}`;
  document.getElementById('bull-choix').innerHTML = [['1', matchChoisi.entry_a], ['2', matchChoisi.entry_b]]
    .map(([cote, idE]) => `<button type="button" class="bouton bouton--plein bouton--large" data-premier="${cote}">${esc(nomEntree(idE))}</button>`).join('');
  document.getElementById('erreur-bull').textContent = '';
  fenBull.hidden = false;
}

document.getElementById('bull-choix').addEventListener('click', (e) => {
  const b = e.target.closest('[data-premier]');
  if (!b || !matchChoisi) return;
  action(async () => {
    fenBull.querySelectorAll('button').forEach((x) => { x.disabled = true; });
    const { data, error } = await supabase.rpc('lancer_match_tournoi', { p_match: matchChoisi.id, p_premier: Number(b.dataset.premier) });
    fenBull.querySelectorAll('button').forEach((x) => { x.disabled = false; });
    if (error) {
      document.getElementById('erreur-bull').textContent = erreurFr(error);
      await charger();
      return;
    }
    location.href = `scorer.html?id=${encodeURIComponent(data)}`;
  });
});
fenBull.addEventListener('click', (e) => { if (e.target === fenBull || e.target.closest('[data-fermer]')) fenBull.hidden = true; });

function valider(idPartie, bouton) {
  action(async () => {
    bouton.disabled = true;
    const { error } = await supabase.rpc('valider_match_tournoi', { p_game: idPartie });
    if (error) { bouton.disabled = false; return message(zoneMsg, `Le résultat n'a pas été validé : ${erreurFr(error)}`); }
    message(zoneMsg, 'Résultat validé : le tournoi est à jour.', 'ok');
    await charger();
  });
}

function ouvrirForfait(idMatch) {
  matchChoisi = matchs.find((m) => m.id === idMatch);
  if (!matchChoisi) return;
  document.getElementById('forfait-match').textContent = `M${matchChoisi.match_no} · ${libelleMatch(matchChoisi)}${matchChoisi.status === 'live' ? ' — la partie commencée sera effacée' : ''}`;
  document.getElementById('forfait-choix').innerHTML = [matchChoisi.entry_a, matchChoisi.entry_b]
    .map((idE) => `<button type="button" class="bouton bouton--danger bouton--large" data-perdant="${idE}">${esc(nomEntree(idE))} déclare forfait</button>`).join('');
  document.getElementById('erreur-forfait').textContent = '';
  fenForfait.hidden = false;
}

document.getElementById('forfait-choix').addEventListener('click', (e) => {
  const b = e.target.closest('[data-perdant]');
  if (!b || !matchChoisi) return;
  action(async () => {
    const { error } = await supabase.rpc('forfait_match', { p_match: matchChoisi.id, p_forfait: b.dataset.perdant });
    if (error) { document.getElementById('erreur-forfait').textContent = erreurFr(error); return; }
    fenForfait.hidden = true;
    message(zoneMsg, `Forfait enregistré : ${nomEntree(b.dataset.perdant)} est éliminé de ce match.`, 'ok');
    await charger();
  });
});
fenForfait.addEventListener('click', (e) => { if (e.target === fenForfait || e.target.closest('[data-fermer]')) fenForfait.hidden = true; });

// ---------- Corriger le score (organisateur) ----------

const fenCorriger = document.getElementById('fen-corriger');

function ouvrirCorrection(idMatch) {
  matchChoisi = matchs.find((m) => m.id === idMatch);
  if (!matchChoisi) return;
  const m = matchChoisi;
  const f = formatMatch(m) || {};
  const sets = !!f.sets_n;
  const form = document.getElementById('form-corriger');
  document.getElementById('corriger-match').textContent = `M${m.match_no} · ${libelleMatch(m)}${f.variant ? ` · ${formatPartie(f)}` : ''}`;
  document.getElementById('corriger-unite').textContent = sets ? 'Sets gagnés' : 'Manches gagnées';
  form.querySelectorAll('[data-sets]').forEach((el) => { el.hidden = !sets; });
  document.getElementById('corriger-nom-a').textContent = nomEntree(m.entry_a);
  document.getElementById('corriger-nom-b').textContent = nomEntree(m.entry_b);
  form.elements.score_a.value = m.score_a ?? '';
  form.elements.score_b.value = m.score_b ?? '';
  form.elements.legs_a.value = m.legs_a ?? '';
  form.elements.legs_b.value = m.legs_b ?? '';
  document.getElementById('erreur-corriger').textContent = '';
  majVainqueurCorrection();
  fenCorriger.hidden = false;
}

function majVainqueurCorrection() {
  const f = document.getElementById('form-corriger').elements;
  const a = Number(f.score_a.value);
  const b = Number(f.score_b.value);
  const zone = document.getElementById('corriger-vainqueur');
  if (f.score_a.value === '' || f.score_b.value === '' || a === b) {
    zone.textContent = 'Saisissez deux scores différents.';
    return;
  }
  const v = a > b ? matchChoisi.entry_a : matchChoisi.entry_b;
  const change = v !== matchChoisi.winner_entry;
  zone.innerHTML = `Vainqueur : <strong>${esc(nomEntree(v))}</strong>${change ? ' — <span class="t-alerte">le vainqueur change</span> : il remplacera l\'autre joueur dans le match suivant (possible seulement si ce match n\'a pas commencé).' : ' (inchangé)'}`;
}

document.getElementById('form-corriger').addEventListener('input', majVainqueurCorrection);
fenCorriger.addEventListener('click', (e) => { if (e.target === fenCorriger || e.target.closest('[data-fermer]')) fenCorriger.hidden = true; });

document.getElementById('form-corriger').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const erreur = document.getElementById('erreur-corriger');
  const sets = !!(formatMatch(matchChoisi) || {}).sets_n;
  if (f.score_a.value === '' || f.score_b.value === '') { erreur.textContent = 'Indiquez le score de chaque joueur.'; return; }
  if (Number(f.score_a.value) === Number(f.score_b.value)) { erreur.textContent = 'Il faut un vainqueur : les deux scores ne peuvent pas être égaux.'; return; }
  const params = { p_match: matchChoisi.id, p_score_a: Number(f.score_a.value), p_score_b: Number(f.score_b.value) };
  if (sets) { params.p_legs_a = f.legs_a.value === '' ? null : Number(f.legs_a.value); params.p_legs_b = f.legs_b.value === '' ? null : Number(f.legs_b.value); }
  const bouton = e.target.querySelector('[type=submit]');
  action(async () => {
    bouton.disabled = true;
    const { error } = await supabase.rpc('corriger_score_match', params);
    bouton.disabled = false;
    if (error) { erreur.textContent = erreurFr(error); return; }
    fenCorriger.hidden = true;
    message(zoneMsg, `Score de M${matchChoisi.match_no} corrigé.`, 'ok');
    await charger();
  });
});

function reinitialiser(idMatch) {
  const m = matchs.find((x) => x.id === idMatch);
  if (!m) return;
  const texte = m.status === 'live'
    ? `Remettre M${m.match_no} « à jouer » ? La partie en cours sera effacée.`
    : `Remettre M${m.match_no} « à jouer » ? Le résultat et la partie seront effacés, et le vainqueur retiré du match suivant.`;
  if (!confirm(texte)) return;
  action(async () => {
    const { error } = await supabase.rpc('reinitialiser_match', { p_match: idMatch });
    if (error) return message(zoneMsg, erreurFr(error));
    message(zoneMsg, `M${m.match_no} est de nouveau à jouer.`, 'ok');
    await charger();
  });
}

// ---------- Ajout manuel (organisateur) ----------

const choixAjout = { 1: null, 2: null };    // membre choisi pour joueur 1 / joueur 2

// Individuel : membres cochés + invités (un par ligne), ajoutés en une fois
const cochesAjout = new Set();
let membresAjout = [];
let ajoutsFaits = 0;

function placesRestantes() {
  return t.max_participants - inscrits.length;
}

function majPlacesAjout() {
  const reste = placesRestantes();
  const nbInvites = lireInvites().length;
  const total = cochesAjout.size + nbInvites;
  document.getElementById('ajout-places').textContent = `${inscrits.length} / ${t.max_participants} inscrits · ${reste} place${reste > 1 ? 's' : ''} restante${reste > 1 ? 's' : ''}`;
  document.getElementById('aj-nb-membres').textContent = cochesAjout.size ? `(${cochesAjout.size} coché${cochesAjout.size > 1 ? 's' : ''})` : '';
  const bouton = document.getElementById('aj-valider');
  if (t.team_mode !== 'double') {
    bouton.textContent = total ? `Ajouter ${total} participant${total > 1 ? 's' : ''}` : 'Ajouter';
    bouton.disabled = !total;
    document.getElementById('erreur-ajout').textContent = total > reste ? `Il ne reste que ${reste} place${reste > 1 ? 's' : ''} : seuls les ${reste} premiers seront ajoutés.` : '';
  }
}

function lireInvites() {
  return [...new Set(document.getElementById('aj-invites').value.split('\n').map((x) => x.trim()).filter(Boolean))];
}

function afficherMembresAjout() {
  const q = document.getElementById('aj-recherche').value.trim().toLowerCase();
  const deja = dejaInscrits();
  const liste = membresAjout.filter((m) => !deja.has(m.id)
    && (!q || [m.first_name, m.last_name, m.nickname].some((v) => (v || '').toLowerCase().includes(q))));
  document.getElementById('aj-liste').innerHTML = liste.length
    ? liste.map((m) => `
      <label class="aj-membre${cochesAjout.has(m.id) ? ' aj-membre--coche' : ''}">
        <input type="checkbox" value="${m.id}"${cochesAjout.has(m.id) ? ' checked' : ''}>
        ${avatar(m, 'avatar--mini')}
        <span><strong>${esc(nomAffiche(m))}</strong>${m.use_nickname ? `<small>${esc(`${m.first_name} ${m.last_name}`)}</small>` : (m.nickname ? `<small>${esc(m.nickname)}</small>` : '')}</span>
      </label>`).join('')
    : `<p class="vide">${q ? 'Aucun membre ne correspond : ajoutez-le comme invité ci-dessous.' : 'Tous les membres sont déjà inscrits.'}</p>`;
}

async function ouvrirAjout() {
  const double = t.team_mode === 'double';
  fenAjout.querySelectorAll('[data-double]').forEach((el) => { el.hidden = !double; });
  fenAjout.querySelectorAll('[data-simple]').forEach((el) => { el.hidden = double; });
  document.getElementById('form-ajout').reset();
  document.getElementById('erreur-ajout').textContent = '';
  document.getElementById('aj-bilan').hidden = true;
  document.getElementById('t-ajout').textContent = double ? 'Ajouter des doublettes' : 'Ajouter des participants';
  document.getElementById('aj-valider').textContent = double ? 'Ajouter la doublette' : 'Ajouter';
  document.getElementById('aj-valider').disabled = false;
  ajoutsFaits = 0;
  choixAjout[1] = null;
  choixAjout[2] = null;
  cochesAjout.clear();
  if (double) {
    zoneJoueur(1);
    zoneJoueur(2);
  }
  fenAjout.hidden = false;
  majPlacesAjout();
  if (!double) {
    membresAjout = await chargerMembres();
    afficherMembresAjout();
    document.getElementById('aj-recherche').focus();
  }
}

document.getElementById('aj-recherche').addEventListener('input', afficherMembresAjout);
document.getElementById('aj-invites').addEventListener('input', majPlacesAjout);
document.getElementById('aj-liste').addEventListener('change', (e) => {
  const c = e.target.closest('input[type=checkbox]');
  if (!c) return;
  if (c.checked) cochesAjout.add(c.value); else cochesAjout.delete(c.value);
  c.closest('.aj-membre').classList.toggle('aj-membre--coche', c.checked);
  majPlacesAjout();
});

function fermerAjout() {
  fenAjout.hidden = true;
  if (ajoutsFaits) {
    const mot = t.team_mode === 'double' ? 'doublette' : 'participant';
    message(zoneMsg, `${ajoutsFaits} ${mot}${ajoutsFaits > 1 ? 's' : ''} ajouté${t.team_mode === 'double' ? 'e' : ''}${ajoutsFaits > 1 ? 's' : ''}.`, 'ok');
    onglet = 'participants';
    charger();
  }
}

function dejaInscrits() {
  return new Set(inscrits.flatMap((e) => [e.profile_id, e.partner_profile_id]).filter(Boolean));
}

function zoneJoueur(n) {
  const z = fenAjout.querySelector(`[data-zone="${n}"]`);
  const m = choixAjout[n];
  z.innerHTML = m
    ? `<span class="puce">${esc(nomAffiche(m))} <button type="button" class="puce__retirer" data-vider="${n}" aria-label="Retirer">✕</button></span>`
    : `<button type="button" class="bouton bouton--petit" data-choisir="${n}">Choisir un membre</button>
       <span class="t-ou">ou</span>
       <input type="text" data-invite="${n}" maxlength="40" placeholder="Nom d'un invité (sans compte)" aria-label="Nom de l'invité">`;
  z.querySelector('[data-choisir]')?.addEventListener('click', async () => {
    const exclure = dejaInscrits();
    const autre = choixAjout[n === 1 ? 2 : 1];
    if (autre) exclure.add(autre.id);
    const choisi = await choisirMembre({ titre: 'Ajouter un membre', exclure });
    if (choisi) { choixAjout[n] = choisi; zoneJoueur(n); }
  });
  z.querySelector('[data-vider]')?.addEventListener('click', () => { choixAjout[n] = null; zoneJoueur(n); });
}

fenAjout.addEventListener('click', (e) => {
  if (e.target === fenAjout || e.target.closest('[data-fermer]')) fermerAjout();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!fenAjout.hidden) fermerAjout(); fenLancer.hidden = true; fenBull.hidden = true; fenForfait.hidden = true; fenCorriger.hidden = true; }
});

document.getElementById('form-ajout').addEventListener('submit', (e) => {
  e.preventDefault();
  if (t.team_mode !== 'double') { ajouterPlusieurs(); return; }
  const erreur = document.getElementById('erreur-ajout');
  const double = t.team_mode === 'double';
  const invite = (n) => fenAjout.querySelector(`[data-invite="${n}"]`)?.value.trim() || null;
  const ligne = {
    tournament_id: t.id,
    profile_id: choixAjout[1]?.id || null,
    guest_name: choixAjout[1] ? null : invite(1),
  };
  if (!ligne.profile_id && !ligne.guest_name) { erreur.textContent = 'Choisissez un membre ou saisissez le nom d\'un invité.'; return; }
  if (double) {
    ligne.team_name = e.target.elements.team_name.value.trim();
    ligne.partner_profile_id = choixAjout[2]?.id || null;
    ligne.partner_guest_name = choixAjout[2] ? null : invite(2);
    if (!ligne.team_name) { erreur.textContent = 'Donnez un nom à la doublette.'; return; }
    if (!ligne.partner_profile_id && !ligne.partner_guest_name) { erreur.textContent = 'Indiquez le joueur 2 (membre ou invité).'; return; }
  }
  const bouton = e.target.querySelector('[type=submit]');
  action(async () => {
    bouton.disabled = true;
    const { error } = await supabase.from('tournament_entries').insert(ligne).select('id').single();
    bouton.disabled = false;
    if (error) { erreur.textContent = erreurFr(error); return; }
    // Doublette ajoutée : la fenêtre reste ouverte pour la suivante
    ajoutsFaits += 1;
    await rechargerInscrits();
    const bilan = document.getElementById('aj-bilan');
    bilan.hidden = false;
    bilan.innerHTML = `<p class="aj-ok">✓ « ${esc(ligne.team_name)} » ajoutée (${ajoutsFaits} doublette${ajoutsFaits > 1 ? 's' : ''} ajoutée${ajoutsFaits > 1 ? 's' : ''}). Saisissez la suivante ou fermez.</p>`;
    e.target.elements.team_name.value = '';
    choixAjout[1] = null;
    choixAjout[2] = null;
    zoneJoueur(1);
    zoneJoueur(2);
    majPlacesAjout();
    if (placesRestantes() <= 0) { erreur.textContent = 'Le tournoi est complet.'; bouton.disabled = true; }
    e.target.elements.team_name.focus();
  });
});

// Relit la liste des inscrits (sans redessiner la page) pendant l'ajout
async function rechargerInscrits() {
  const { data } = await supabase.rpc('tournoi_detail', { p_tournoi: id });
  if (data) {
    inscrits = data.inscrits || [];
    parId = new Map(inscrits.map((x) => [x.id, x]));
  }
}

// Individuel : ajoute les membres cochés puis les invités, un par un,
// pour indiquer précisément ceux qui n'ont pas pu être ajoutés
function ajouterPlusieurs() {
  const erreur = document.getElementById('erreur-ajout');
  const bouton = document.getElementById('aj-valider');
  const aAjouter = [
    ...[...cochesAjout].map((idM) => ({ ligne: { tournament_id: t.id, profile_id: idM }, nom: nomAffiche(membresAjout.find((m) => m.id === idM) || {}) })),
    ...lireInvites().map((nom) => ({ ligne: { tournament_id: t.id, guest_name: nom.slice(0, 40) }, nom })),
  ];
  if (!aAjouter.length) { erreur.textContent = 'Cochez des membres ou saisissez des noms d\'invités.'; return; }
  action(async () => {
    bouton.disabled = true;
    bouton.textContent = 'Ajout en cours…';
    const ok = [];
    const refus = [];
    for (const x of aAjouter) {
      const { error } = await supabase.from('tournament_entries').insert(x.ligne).select('id').single();
      if (error) refus.push(`${x.nom} : ${erreurFr(error)}`); else ok.push(x.nom);
    }
    ajoutsFaits += ok.length;
    await rechargerInscrits();
    cochesAjout.clear();
    // Les invités refusés restent dans la zone de saisie pour correction
    const refusesInvites = aAjouter.filter((x) => x.ligne.guest_name && !ok.includes(x.nom)).map((x) => x.nom);
    document.getElementById('aj-invites').value = refusesInvites.join('\n');
    afficherMembresAjout();
    majPlacesAjout();
    const bilan = document.getElementById('aj-bilan');
    bilan.hidden = false;
    bilan.innerHTML = `${ok.length ? `<p class="aj-ok">✓ ${ok.length} ajouté${ok.length > 1 ? 's' : ''} : ${esc(ok.join(', '))}</p>` : ''}${refus.length ? `<ul class="aj-refus">${refus.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`;
    erreur.textContent = '';
    if (!refus.length) {
      fermerAjout();
    }
  });
}

// Mise à jour automatique quand un match du tournoi change (si le temps réel est disponible)
supabase
  .channel(`tournoi-${id}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_matches', filter: `tournament_id=eq.${id}` }, () => { if (!enCours) charger(); })
  .subscribe();

init();
