// =====================================================================
//  Mes parties : historique des parties du membre connecté
//  (parties où il a joué avec son compte, et parties qu'il a créées)
//
//  Prévu pour accueillir les tournois : chaque partie a un « contexte »
//  (aujourd'hui toujours « match »), affiché sur la carte et filtrable.
// =====================================================================

import { supabase, esc, formatPartie, etatPartie, profilConnecte, etiquetteType } from './app.js?v=__VERSION__';
import { JEUX, ORDRE_PENTADARTS } from './pentadarts-regles.js?v=__VERSION__';

const JEUX_CLUB = ['pentadarts', 'capital', 'cricket'];
const NOMS_JEUX = { pentadarts: 'Pentadarts', capital: 'Le capital', cricket: 'Le cricket' };
const COURTS = { centre: 'Centre', mickey: 'Cricket', finish: 'Finish', '301a': '301', '301b': '301', capital: 'Capital' };

const PAR_PAGE = 20;
const DUREE_REPRISE_H = 24;
let COLONNES = 'match_type, tournament_match_id, id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, first_side, status, winner_side, visibility, created_by, created_at, finished_at, game_sides(side, name, is_bot), game_players(side, profile_id, display_name, throw_order)';

const zoneAcces = document.getElementById('acces');
const contenu = document.getElementById('contenu');
const liste = document.getElementById('liste');
const btnPlus = document.getElementById('plus');

let moi = null;
const filtres = { type: '', statut: '', jeu: '' };
let page = 0;
let parties = [];
let fin = false;

// Contexte d'une partie : match libre ou match de tournoi
const matchsTournoi = new Map();     // id du match de tournoi → { nom, match_no, tournament_id }
function contexte(g) {
  const mt = g.tournament_match_id && matchsTournoi.get(g.tournament_match_id);
  if (g.tournament_match_id) {
    return { type: 'tournoi', libelle: mt ? `Tournoi · ${mt.nom} · M${mt.match_no}` : 'Tournoi', lien: mt ? `tournoi.html?id=${encodeURIComponent(mt.tournament_id)}` : null };
  }
  return { type: 'match', libelle: 'Match' };
}

async function init() {
  moi = await profilConnecte();
  if (!moi) {
    zoneAcces.hidden = false;
    zoneAcces.innerHTML = '<p class="vide">Connectez-vous pour retrouver vos parties. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  if (moi.status !== 'active') {
    zoneAcces.hidden = false;
    zoneAcces.innerHTML = '<p class="vide">Votre compte doit être validé par un admin du club pour accéder à vos parties.</p>';
    return;
  }
  contenu.hidden = false;
  recharger();
}

// Applique les filtres communs aux deux requêtes
function filtrer(q) {
  // Les parties abandonnées ne sont pas conservées
  q = q.neq('status', 'abandoned');
  if (filtres.statut) q = q.eq('status', filtres.statut);
  if (filtres.jeu) q = q.eq('variant', filtres.jeu);
  return q.order('created_at', { ascending: false }).range(page * PAR_PAGE, page * PAR_PAGE + PAR_PAGE - 1);
}

// Jeux du club (Pentadarts, Capital : scripts 039-040) : seulement les parties où je joue avec mon compte
let jeuxClub = [];
async function chargerJeuxClub() {
  jeuxClub = [];
  if ((filtres.jeu && !JEUX_CLUB.includes(filtres.jeu)) || filtres.type) return;
  const lire = (colonnes) => {
    let q = supabase.from('jeux_parties').select(colonnes).contains('joueurs', JSON.stringify([{ profile_id: moi.id }]));
    if (filtres.jeu) q = q.eq('jeu', filtres.jeu);
    return q.order('created_at', { ascending: false }).limit(100);
  };
  let r = await lire('id, jeu, joueurs, resultat, statut, updated_at, created_by, created_at');
  if (r.error) r = await lire('id, jeu, joueurs, resultat, created_by, created_at');   // script 040 pas encore lancé
  if (r.error) return;                                                                  // script 039 pas encore lancé
  const limite = Date.now() - 3 * 86400000;
  jeuxClub = (r.data || [])
    .filter((g) => g.statut !== 'live' || Date.parse(g.updated_at) >= limite)
    .filter((g) => !filtres.statut || (filtres.statut === 'live' ? g.statut === 'live' : g.statut !== 'live'))
    .map((g) => ({ ...g, jeuClub: true }));
}

async function chargerPage() {
  btnPlus.disabled = true;
  if (page === 0) await chargerJeuxClub();
  // Filtre sur un jeu du club : pas de match X01 à charger
  if (JEUX_CLUB.includes(filtres.jeu)) {
    btnPlus.disabled = false;
    fin = true;
    parties = [...jeuxClub];
    afficher();
    return;
  }
  // Seulement les parties jouées avec mon compte
  const lire = () => Promise.all([
    filtrer(supabase.from('games').select(`${COLONNES}, moi:game_players!inner(profile_id)`).eq('moi.profile_id', moi.id)),
    Promise.resolve({ data: [] }),
  ]);
  let [jouees, creees] = await lire();
  // Base sans les tournois (script 016 non exécuté) : on relit sans la colonne du tournoi
  if (jouees.error && /match_type/.test(jouees.error.message || '')) {
    COLONNES = COLONNES.replace('match_type, ', '');
    [jouees, creees] = await lire();
  }
  if (jouees.error && /tournament_match_id/.test(jouees.error.message || '')) {
    COLONNES = COLONNES.replace('tournament_match_id, ', '');
    [jouees, creees] = await lire();
  }
  btnPlus.disabled = false;
  if (jouees.error && creees.error) {
    liste.innerHTML = '<p class="vide">Impossible de charger vos parties pour le moment.</p>';
    return;
  }
  // Une partie interrompue depuis plus de 24 h est considérée comme abandonnée : on ne l'affiche pas
  const limite = Date.now() - DUREE_REPRISE_H * 3600 * 1000;
  const nouvelles = [...(jouees.data || []), ...(creees.data || [])]
    .filter((g, i, t) => t.findIndex((x) => x.id === g.id) === i && !parties.some((p) => p.id === g.id))
    .filter((g) => g.status !== 'live' || Date.parse(g.created_at) >= limite);
  fin = (jouees.data || []).length < PAR_PAGE && (creees.data || []).length < PAR_PAGE;

  // Nom du tournoi des matchs de tournoi
  const aChercher = [...new Set(nouvelles.map((g) => g.tournament_match_id).filter((x) => x && !matchsTournoi.has(x)))];
  if (aChercher.length) {
    const { data: mts } = await supabase.from('tournament_matches').select('id, match_no, tournament_id, tournaments(name)').in('id', aChercher);
    (mts || []).forEach((x) => matchsTournoi.set(x.id, { nom: x.tournaments?.name || 'Tournoi', match_no: x.match_no, tournament_id: x.tournament_id }));
  }
  if (nouvelles.some((g) => g.tournament_match_id)) document.getElementById('filtre-type').hidden = false;

  // Manches gagnées : les volées de finish suffisent
  if (nouvelles.length) {
    const { data: finishs } = await supabase
      .from('visits')
      .select('id, game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_bust, is_checkout, darts_used, darts_at_double')
      .in('game_id', nouvelles.map((g) => g.id))
      .eq('is_checkout', true);
    for (const g of nouvelles) {
      const sides = [...g.game_sides].sort((a, b) => a.side - b.side);
      g.etat = etatPartie(g, sides, (finishs || []).filter((v) => v.game_id === g.id));
    }
  }
  parties = [...parties, ...nouvelles, ...(page === 0 ? jeuxClub : [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  afficher();
}

function recharger() {
  page = 0;
  parties = [];
  fin = false;
  liste.innerHTML = '<p class="vide">Chargement…</p>';
  chargerPage();
}

// ---------- Affichage ----------

function nomCamp(g, side) {
  const s = g.game_sides.find((x) => x.side === side);
  const joueurs = g.game_players.filter((p) => p.side === side).sort((a, b) => a.throw_order - b.throw_order).map((p) => p.display_name);
  if (g.mode === 'double' && s?.name) return `${s.name} (${joueurs.join(' / ')})`;
  return joueurs.join(' / ') || (s?.is_bot ? 'Dartbot' : '—');
}

const fmtJour = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtHeure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function resultat(g, monCamp) {
  if (g.status === 'live') return { cle: 'live', texte: 'En cours' };
  if (!monCamp) return { cle: 'arbitre', texte: 'Score tenu' };
  if (g.game_sides.length < 2) return { cle: 'solo', texte: 'Solo' };
  return g.winner_side === monCamp ? { cle: 'victoire', texte: 'Victoire' } : { cle: 'defaite', texte: 'Défaite' };
}

function carte(g) {
  const sides = [...g.game_sides].sort((a, b) => a.side - b.side);
  const monCamp = g.game_players.find((p) => p.profile_id === moi.id)?.side || null;
  const res = resultat(g, monCamp);
  const ctx = contexte(g);
  const etat = g.etat || { manches: {}, sets: {} };
  const score = (s) => (g.sets_n ? etat.sets[s] ?? 0 : etat.manches[s] ?? 0);
  const date = new Date(g.finished_at || g.created_at);

  // Camps : le mien d'abord
  const ordre = monCamp ? [monCamp, ...sides.map((s) => s.side).filter((s) => s !== monCamp)] : sides.map((s) => s.side);
  const lignes = ordre.map((s) => `
    <li class="${s === monCamp ? 'mp-camp--moi' : ''}${g.status === 'finished' && g.winner_side === s ? ' mp-camp--gagnant' : ''}">
      <span class="mp-camp__nom">${esc(nomCamp(g, s))}</span>
      <b class="mp-camp__score">${score(s)}</b>
    </li>`).join('');

  const actions = [];
  if (res.cle === 'live' && (g.created_by === moi.id || moi.role === 'admin')) {
    actions.push(`<a class="bouton bouton--petit bouton--plein" href="scorer.html?id=${encodeURIComponent(g.id)}">Reprendre</a>`);
  }
  actions.push(`<a class="bouton bouton--petit" href="live.html?id=${encodeURIComponent(g.id)}">${g.status === 'finished' ? 'Récapitulatif' : 'Voir le score'}</a>`);

  return `
    <article class="mp-carte mp-carte--${res.cle}">
      <header class="mp-carte__haut">
        ${ctx.lien ? `<a class="mp-carte__ctx mp-carte__ctx--tournoi" href="${ctx.lien}">${esc(ctx.libelle)}</a>` : `<span class="mp-carte__ctx">${esc(ctx.libelle)}</span>`}
        <span class="mp-carte__date">${esc(fmtJour.format(date))} · ${esc(fmtHeure.format(date))}</span>
        <span class="mp-resultat mp-resultat--${res.cle}">${esc(res.texte)}</span>
      </header>
      <ul class="mp-camps">${lignes}</ul>
      <p class="mp-carte__format">${etiquetteType(g.match_type)} ${esc(formatPartie(g))}${g.sets_n ? ' · score en sets' : ''}${g.visibility === 'private' ? ' · privée' : ''}</p>
      <div class="actions">${actions.join('')}</div>
    </article>`;
}

// Carte d'une partie de Pentadarts ou de Capital
function carteJeuClub(g) {
  const joueurs = g.joueurs || [];
  const r = g.resultat || {};
  const groupes = r.classement || [];
  const moiIdx = joueurs.findIndex((j) => j.profile_id === moi.id);
  let rang = 1; const rangs = {};
  groupes.forEach((gr) => { gr.forEach((p) => { rangs[p] = rang; }); rang += gr.length; });
  const monRang = moiIdx >= 0 ? rangs[moiIdx] : null;
  const enCours = g.statut === 'live';
  const res = enCours ? { cle: 'live', texte: 'En cours' }
    : monRang === 1 ? { cle: 'victoire', texte: 'Victoire' } : monRang ? { cle: 'defaite', texte: `${monRang}e place` } : { cle: 'arbitre', texte: 'Terminée' };
  const date = new Date(g.created_at);
  const capital = g.jeu === 'capital';
  const seul = g.jeu !== 'pentadarts';
  const lignes = enCours ? joueurs.map((j, p) => `<li class="${p === moiIdx ? 'mp-camp--moi' : ''}"><span class="mp-camp__nom">${esc(j.nom)}</span></li>`).join('') : groupes.flat().map((p) => `
    <li class="${p === moiIdx ? 'mp-camp--moi' : ''}${rangs[p] === 1 ? ' mp-camp--gagnant' : ''}">
      <span class="mp-camp__nom">${rangs[p]}. ${esc(joueurs[p]?.nom || '?')}</span>
      <b class="mp-camp__score">${r.totaux?.[p] ?? ''}${capital ? '' : g.jeu === 'cricket' ? '<small> /27</small>' : '<small> pts</small>'}</b>
    </li>`).join('');
  const feuille = !seul && r.jeux ? `
    <details class="mp-feuille"><summary>Voir la feuille</summary>
      <div class="pd-defile"><table class="pd-table pd-table--feuille">
        <thead><tr><th></th>${groupes.flat().map((p) => `<th>${esc(joueurs[p]?.nom || '?')}</th>`).join('')}</tr></thead>
        <tbody>${ORDRE_PENTADARTS.filter((c) => r.jeux[c]).map((c) => `<tr><th><span class="pd-num-mini">${JEUX[c].num}</span>${esc(COURTS[c])}</th>${groupes.flat().map((p) => `<td><b>${r.jeux[c].points?.[p] ?? 0}</b></td>`).join('')}</tr>`).join('')}
        <tr class="pd-ligne-total"><th>Total</th>${groupes.flat().map((p) => `<td>${r.totaux?.[p] ?? ''}</td>`).join('')}</tr></tbody></table></div>
    </details>` : '';
  return `
    <article class="mp-carte mp-carte--${res.cle} mp-carte--jeu">
      <header class="mp-carte__haut">
        <span class="mp-carte__ctx mp-carte__ctx--jeu">${NOMS_JEUX[g.jeu] || 'Jeu du club'}</span>
        <span class="mp-carte__date">${esc(fmtJour.format(date))} · ${esc(fmtHeure.format(date))}</span>
        <span class="mp-resultat mp-resultat--${res.cle}">${esc(res.texte)}</span>
      </header>
      <ul class="mp-camps">${lignes}</ul>
      <p class="mp-carte__format">Jeu du club · ${joueurs.length} joueur${joueurs.length > 1 ? 's' : ''} · hors statistiques</p>
      ${enCours ? `<div class="actions"><a class="bouton bouton--petit bouton--plein" href="pentadarts.html?${seul ? `jeu=${g.jeu}&` : ''}reprendre=${encodeURIComponent(g.id)}">Reprendre</a></div>` : feuille}
    </article>`;
}

function afficher() {
  const visibles = parties.filter((g) => g.jeuClub || !filtres.type || contexte(g).type === filtres.type);
  liste.innerHTML = visibles.length
    ? visibles.map((g) => (g.jeuClub ? carteJeuClub(g) : carte(g))).join('')
    : `<p class="vide">${filtres.statut || filtres.jeu ? 'Aucune partie avec ces filtres.' : 'Vous n\'avez pas encore de partie. <a href="jouer.html#match">Lancer un match</a>'}</p>`;
  btnPlus.hidden = fin;
}

// ---------- Filtres et pagination ----------

document.querySelectorAll('[data-filtre]').forEach((groupe) => {
  groupe.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    groupe.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    filtres[groupe.dataset.filtre] = b.dataset.valeur;
    if (groupe.dataset.filtre === 'type') afficher();
    else recharger();
  });
});

btnPlus.addEventListener('click', () => {
  page += 1;
  chargerPage();
});

init();
