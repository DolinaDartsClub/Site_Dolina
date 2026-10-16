// =====================================================================
//  Administration : derniers matchs enregistrés (toutes les parties du
//  club, du plus récent au plus ancien), avec filtres, lien vers le
//  score et suppression (une ou plusieurs ; jamais un match de tournoi,
//  qui se corrige depuis la page du tournoi).
// =====================================================================

import { supabase, esc, message, erreurFr, formatPartie, nomAffiche } from './app.js?v=__VERSION__';

const PAR_PAGE = 50;
const STATUTS = { live: 'En cours', finished: 'Terminé', abandoned: 'Abandonné' };
const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let zone;
let zoneMsg;
let parties = [];
let manches = [];   // finishs : { game_id, side }
let filtre = 'tout';
let complet = false;
let recherche = '';

export async function initMatchs(zoneMessage) {
  zone = document.getElementById('vue-matchs');
  zoneMsg = zoneMessage;
  zone.addEventListener('click', clic);
  zone.addEventListener('change', changement);
  zone.addEventListener('input', (e) => {
    if (e.target.id === 'mt-recherche') { recherche = e.target.value.trim().toLowerCase(); afficherListe(); }
  });
  await charger();
}

async function charger(plus = false) {
  const depuis = plus ? parties.length : 0;
  const { data, error } = await supabase.from('games')
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, status, winner_side, visibility, match_type, created_at, finished_at, tournament_match_id, createur:profiles!games_created_by_fkey(first_name, last_name, nickname, use_nickname), game_players(side, display_name, throw_order, profile_id)')
    .order('created_at', { ascending: false })
    .range(depuis, depuis + PAR_PAGE - 1);
  if (error) {
    zone.innerHTML = `<p class="vide">Matchs indisponibles. (${esc(erreurFr(error))})</p>`;
    return;
  }
  const nouvelles = data || [];
  complet = nouvelles.length < PAR_PAGE;
  parties = plus ? parties.concat(nouvelles) : nouvelles;
  if (nouvelles.length) {
    const { data: fins } = await supabase.from('visits').select('game_id, side').in('game_id', nouvelles.map((g) => g.id)).eq('is_checkout', true);
    manches = (plus ? manches : []).concat(fins || []);
  }
  afficher();
}

function nomsCamps(g) {
  const camps = [...new Set(g.game_players.map((p) => p.side))].sort((a, b) => a - b);
  return camps.map((c) => ({
    side: c,
    nom: g.game_players.filter((p) => p.side === c).sort((a, b) => a.throw_order - b.throw_order).map((p) => p.display_name).join(' / '),
    manches: manches.filter((m) => m.game_id === g.id && m.side === c).length,
  }));
}

function visibles() {
  return parties.filter((g) => {
    if (filtre === 'live' && g.status !== 'live') return false;
    if (filtre === 'finished' && g.status !== 'finished') return false;
    if (filtre === 'tournoi' && !g.tournament_match_id) return false;
    if (filtre === 'bot' && g.mode !== 'bot') return false;
    if (recherche && !g.game_players.some((p) => (p.display_name || '').toLowerCase().includes(recherche))) return false;
    return true;
  });
}

function ligne(g) {
  const camps = nomsCamps(g);
  const quand = new Date(g.finished_at || g.created_at);
  const tags = [
    g.tournament_match_id ? 'Tournoi' : null,
    g.mode === 'bot' ? 'Dartbot' : null,
    g.match_type === 'ligue' ? 'Ligue' : (g.match_type === 'amical' ? 'Amical' : null),
    g.visibility === 'private' ? 'Privé' : null,
  ].filter(Boolean);
  return `
    <li class="adm-partie mt-ligne mt-ligne--${g.status}">
      ${g.tournament_match_id ? '<span class="adm-partie__case"></span>' : `<input type="checkbox" class="adm-partie__case" data-choix-match="${g.id}" aria-label="Sélectionner le match du ${esc(fmt.format(quand))}">`}
      <div class="adm-partie__texte">
        <div class="mt-score">${camps.map((c) => `<span class="mt-camp${g.status === 'finished' && g.winner_side === c.side ? ' mt-camp--gagnant' : ''}"><span class="mt-camp__nom">${esc(c.nom)}</span><b>${c.manches}</b></span>`).join('<i>–</i>')}</div>
        <small>${esc(fmt.format(quand))} · ${esc(formatPartie(g))}${g.createur ? ` · saisi par ${esc(nomAffiche(g.createur))}` : ''}</small>
        <span class="mt-tags"><span class="mt-statut mt-statut--${g.status}">${esc(STATUTS[g.status] || g.status)}</span>${tags.map((t) => `<span class="mt-tag">${esc(t)}</span>`).join('')}</span>
      </div>
      <span class="adm-partie__actions">
        <a class="bouton bouton--petit" href="live.html?id=${encodeURIComponent(g.id)}">Voir</a>
        ${g.tournament_match_id ? '' : `<button type="button" class="bouton bouton--petit bouton--danger" data-supprimer-match="${g.id}">Supprimer</button>`}
      </span>
    </li>`;
}

function afficher() {
  const nb = (f) => parties.filter((g) => (f === 'live' ? g.status === 'live' : f === 'finished' ? g.status === 'finished' : f === 'tournoi' ? !!g.tournament_match_id : f === 'bot' ? g.mode === 'bot' : true)).length;
  zone.innerHTML = `
    <p class="sv-aide">Toutes les parties enregistrées sur le site, de la plus récente à la plus ancienne. Les matchs de tournoi se corrigent depuis la page du tournoi.</p>
    <div class="mt-outils">
      <div class="mp-filtre" role="group" aria-label="Filtrer les matchs">
        ${[['tout', 'Tous'], ['live', 'En cours'], ['finished', 'Terminés'], ['tournoi', 'Tournois'], ['bot', 'Dartbot']].map(([v, l]) => `<button type="button" data-filtre-match="${v}" aria-pressed="${filtre === v}">${l} <b>${nb(v)}</b></button>`).join('')}
      </div>
      <label class="champ mt-recherche"><span class="visuellement-cache">Rechercher un joueur</span>
        <input type="search" id="mt-recherche" placeholder="Rechercher un joueur" value="${esc(recherche)}" autocomplete="off">
      </label>
    </div>
    <div class="adm-selection" id="mt-selection">
      <label class="adm-selection__tout"><input type="checkbox" id="mt-tout"> Tout sélectionner</label>
      <button type="button" class="bouton bouton--petit bouton--danger" id="mt-supprimer-selection" disabled>Supprimer la sélection</button>
    </div>
    <ul class="adm-parties" id="mt-liste"></ul>
    <div class="actions" id="mt-plus"></div>`;
  afficherListe();
}

function afficherListe() {
  const liste = visibles();
  const ul = zone.querySelector('#mt-liste');
  if (!ul) return;
  ul.innerHTML = liste.length ? liste.map(ligne).join('') : '<li class="vide">Aucun match pour ce filtre.</li>';
  zone.querySelector('#mt-selection').hidden = !liste.some((g) => !g.tournament_match_id);
  zone.querySelector('#mt-plus').innerHTML = complet
    ? `<p class="match__format" style="margin:0">${parties.length} match${parties.length > 1 ? 's' : ''} au total.</p>`
    : `<button type="button" class="bouton bouton--petit" id="mt-charger-plus">Afficher ${PAR_PAGE} matchs de plus</button>`;
  majSelection();
}

function majSelection() {
  const cases = [...zone.querySelectorAll('[data-choix-match]')];
  const n = cases.filter((c) => c.checked).length;
  const bouton = zone.querySelector('#mt-supprimer-selection');
  if (bouton) {
    bouton.disabled = !n;
    bouton.textContent = n ? `Supprimer la sélection (${n})` : 'Supprimer la sélection';
  }
  const tout = zone.querySelector('#mt-tout');
  if (tout) { tout.checked = n > 0 && n === cases.length; tout.indeterminate = n > 0 && n < cases.length; }
  cases.forEach((c) => c.closest('.adm-partie').classList.toggle('adm-partie--choisie', c.checked));
}

function changement(e) {
  if (e.target.id === 'mt-tout') zone.querySelectorAll('[data-choix-match]').forEach((c) => { c.checked = e.target.checked; });
  if (e.target.id === 'mt-tout' || e.target.matches('[data-choix-match]')) majSelection();
}

async function supprimer(ids) {
  const { data, error } = await supabase.from('games').delete().in('id', ids).select('id');
  if (error) return message(zoneMsg, error.code === 'P0001' ? error.message : erreurFr(error));
  const n = data?.length || 0;
  const retirees = new Set((data || []).map((x) => x.id));
  parties = parties.filter((g) => !retirees.has(g.id));
  message(zoneMsg, n === ids.length
    ? `${n} match${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''}.`
    : `${n} match${n > 1 ? 's' : ''} supprimé${n > 1 ? 's' : ''} sur ${ids.length} : les autres n'ont pas pu l'être.`, n === ids.length ? 'ok' : undefined);
  afficher();
}

async function clic(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.filtreMatch) { filtre = b.dataset.filtreMatch; afficher(); return; }
  if (b.id === 'mt-charger-plus') { b.disabled = true; await charger(true); return; }
  if (b.dataset.supprimerMatch) {
    if (!confirm('Supprimer définitivement ce match ?\n\nIl disparaîtra pour tous les joueurs, avec ses volées : les statistiques et le classement seront recalculés sans lui.')) return;
    b.disabled = true;
    await supprimer([b.dataset.supprimerMatch]);
    return;
  }
  if (b.id === 'mt-supprimer-selection') {
    const ids = [...zone.querySelectorAll('[data-choix-match]:checked')].map((c) => c.dataset.choixMatch);
    if (!ids.length || !confirm(`Supprimer définitivement ${ids.length > 1 ? `ces ${ids.length} matchs` : 'ce match'} ?\n\nIls disparaîtront pour tous les joueurs, avec leurs volées : les statistiques et le classement seront recalculés.`)) return;
    b.disabled = true;
    await supprimer(ids);
  }
}

// Une partie supprimée depuis la fiche d'un membre : on recharge la liste
document.addEventListener('dolina:parties-maj', () => { if (zone) charger(); });
