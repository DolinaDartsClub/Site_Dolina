// =====================================================================
//  Administration : exports CSV (à ouvrir avec Excel, Numbers ou Google
//  Sheets). Séparateur « ; » et nombres à virgule, pour Excel en français.
//  Membres, classement et stats, toutes les parties, calendrier des équipes.
// =====================================================================

import { supabase, esc, message, erreurFr, formatPartie, nomAffiche } from './app.js?v=__VERSION__';
import { debutSaison, nomSaison } from './profil-commun.js?v=__VERSION__';

let zone;
let zoneMsg;

const jour = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '');
const jourHeure = (d) => (d ? new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const dateSql = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR') : '');
const nombre = (n, dec = 1) => (n === null || n === undefined || Number.isNaN(n) ? '' : Number(n).toFixed(dec).replace('.', ','));
const STATUTS = { pending: 'En attente', active: 'Validé', refused: 'Refusé' };
const STATUTS_PARTIE = { live: 'En cours', finished: 'Terminée', abandoned: 'Abandonnée' };

function cellule(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function telecharger(nom, entetes, lignes) {
  const texte = '﻿' + [entetes, ...lignes].map((l) => l.map(cellule).join(';')).join('\r\n') + '\r\n';
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([texte], { type: 'text/csv;charset=utf-8' }));
  lien.download = `${nom}-${new Date().toLocaleDateString('fr-CA')}.csv`;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
  return lignes.length;
}

// Lecture de toute une table par paquets de 1000 lignes
async function tout(requete) {
  const lignes = [];
  for (let depuis = 0; ; depuis += 1000) {
    const { data, error } = await requete().range(depuis, depuis + 999);
    if (error) throw error;
    lignes.push(...(data || []));
    if (!data || data.length < 1000) return lignes;
  }
}

// ---------- Les quatre exports ----------

async function exporterMembres() {
  const [profils, equipes] = await Promise.all([
    tout(() => supabase.from('profiles').select('id, first_name, last_name, nickname, use_nickname, status, role, hand, dart_brand, dart_weight, created_at, profile_private(email, phone), team_members!team_members_profile_id_fkey(status, teams(name))').order('last_name')),
    supabase.from('teams').select('id, name, captain_id'),
  ]);
  const capitaines = new Map((equipes.data || []).map((t) => [t.captain_id, t.name]));
  return telecharger('membres', ['Prénom', 'Nom', 'Surnom', 'Email', 'Téléphone', 'Équipes', 'Capitaine de', 'Statut', 'Rôle', 'Main', 'Fléchettes', 'Poids (g)', 'Inscrit le'],
    profils.map((p) => {
      const prive = (Array.isArray(p.profile_private) ? p.profile_private[0] : p.profile_private) || {};
      return [p.first_name, p.last_name, p.nickname || '', prive.email || '', prive.phone || '',
        (p.team_members || []).filter((m) => m.status === 'accepted').map((m) => m.teams?.name).filter(Boolean).join(', '),
        capitaines.get(p.id) || '', STATUTS[p.status] || p.status, p.role === 'admin' ? 'Admin' : 'Membre',
        p.hand || '', p.dart_brand || '', p.dart_weight ? nombre(p.dart_weight, 1) : '', jour(p.created_at)];
    }));
}

async function exporterClassement(periode) {
  const debut = periode === 'tout' ? null : new Date(Number(periode), 8, 1);
  const fin = debut ? new Date(debut.getFullYear() + 1, 8, 1) : null;
  const { data, error } = await supabase.rpc('classement_membres', { p_debut: debut ? debut.toISOString() : null, p_fin: fin ? fin.toISOString() : null });
  if (error) throw error;
  const joueurs = data?.joueurs || [];
  let rang = 0;
  return telecharger(`classement-${periode === 'tout' ? 'depuis-toujours' : `${periode}-${Number(periode) + 1}`}`,
    ['Rang', 'Joueur', 'Équipes', 'Matchs', 'Victoires', 'Défaites', '% victoires', 'Manches gagnées', 'Manches perdues', 'Manches jouées', 'Moyenne', 'Moyenne 9 premières', 'Réussite au double (%)', 'Finishs', 'Meilleur finish', '180', `Classé (${data?.seuil ?? 5} manches mini)`],
    joueurs.map((j) => {
      if (j.classe) rang += 1;
      return [j.classe ? rang : '', j.nom, j.equipes || '', j.matchs, j.victoires, j.matchs - j.victoires,
        j.matchs ? nombre((j.victoires / j.matchs) * 100, 0) : '', j.manches_gagnees, j.manches_perdues, j.manches_jouees,
        j.flechettes ? nombre((j.points / j.flechettes) * 3, 2) : '', j.flechettes_9 ? nombre((j.points_9 / j.flechettes_9) * 3, 2) : '',
        j.flechettes_double ? nombre((j.finishs / j.flechettes_double) * 100, 1) : '', j.finishs, j.meilleur_finish ?? '', j.nb_180, j.classe ? 'Oui' : 'Non'];
    }));
}

async function exporterParties() {
  const parties = await tout(() => supabase.from('games')
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, status, winner_side, visibility, match_type, created_at, finished_at, tournament_match_id, createur:profiles!games_created_by_fkey(first_name, last_name, nickname, use_nickname), game_sides(side, name), game_players(side, display_name, throw_order)')
    .order('created_at', { ascending: false }));
  const fins = await tout(() => supabase.from('visits').select('game_id, side').eq('is_checkout', true).order('id'));
  const manches = new Map();
  fins.forEach((f) => { const k = `${f.game_id}:${f.side}`; manches.set(k, (manches.get(k) || 0) + 1); });
  const TYPES = { club: 'Club', ligue: 'Ligue', amical: 'Amical' };
  const MODES = { single: 'Individuel', double: 'Double 2v2', bot: 'Contre le dartbot' };
  return telecharger('parties', ['Date', 'Statut', 'Jeu', 'Format', 'Mode', 'Type', 'Tournoi', 'Joueurs', 'Score (manches)', 'Gagnant', 'Saisie par', 'Visibilité'],
    parties.map((g) => {
      const camps = [...new Set(g.game_players.map((p) => p.side))].sort((a, b) => a - b);
      const nom = (c) => (g.mode === 'double' && g.game_sides?.find((s) => s.side === c)?.name)
        || g.game_players.filter((p) => p.side === c).sort((a, b) => a.throw_order - b.throw_order).map((p) => p.display_name).join(' / ');
      return [jourHeure(g.finished_at || g.created_at), STATUTS_PARTIE[g.status] || g.status, g.variant === 'libre' ? `Libre ${g.start_score}` : g.variant,
        formatPartie({ ...g, mode: 'single' }).replace(/^[^·]*·\s*/, ''), MODES[g.mode] || g.mode, TYPES[g.match_type] || 'Club', g.tournament_match_id ? 'Oui' : '',
        camps.map(nom).join(' vs '), camps.map((c) => manches.get(`${g.id}:${c}`) || 0).join('-'),
        g.status === 'finished' && g.winner_side ? nom(g.winner_side) : '', g.createur ? nomAffiche(g.createur) : '', g.visibility === 'private' ? 'Privée' : 'Publique'];
    }));
}

async function exporterCalendrier() {
  const [rencontres, equipes, salles] = await Promise.all([
    tout(() => supabase.from('rencontres').select('*').order('date_match')),
    supabase.from('teams').select('id, name, sort_order'),
    supabase.from('salles').select('id, nom, adresse'),
  ]);
  const eq = new Map((equipes.data || []).map((t) => [t.id, t]));
  const sa = new Map((salles.data || []).map((s) => [s.id, s]));
  rencontres.sort((a, b) => (eq.get(a.team_id)?.sort_order ?? 0) - (eq.get(b.team_id)?.sort_order ?? 0) || a.date_match.localeCompare(b.date_match));
  return telecharger('calendrier-equipes', ['Équipe', 'Saison', 'Journée', 'Division', 'Poule', 'Date', 'Date limite', 'Heure du match', 'Rendez-vous', 'Lieu', 'Adversaire', 'Salle', 'Adresse', 'Score Dolina', 'Score adversaire', 'Résultat', 'Note'],
    rencontres.map((r) => {
      const s = sa.get(r.salle_id);
      const joue = r.score_nous !== null && r.score_nous !== undefined;
      return [eq.get(r.team_id)?.name || '', nomSaison(debutSaison(new Date(`${r.date_match}T12:00:00`))).replace('Saison ', ''), r.journee || '', r.division || '', r.poule || '',
        dateSql(r.date_match), dateSql(r.date_fin), r.heure_match ? r.heure_match.slice(0, 5) : '', r.heure_rdv ? r.heure_rdv.slice(0, 5) : '',
        r.domicile ? 'Domicile' : 'Extérieur', r.adversaire, s?.nom || '', s?.adresse || '',
        joue ? r.score_nous : '', joue ? r.score_eux : '',
        joue ? (r.score_nous > r.score_eux ? 'Victoire' : r.score_nous < r.score_eux ? 'Défaite' : 'Nul') : '', r.note || ''];
    }));
}

// ---------- Affichage ----------

const EXPORTS = [
  { id: 'membres', titre: 'Liste des membres', texte: 'Nom, surnom, email, téléphone, équipes, statut, rôle, matériel, date d\'inscription.', icone: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M17 4a4 4 0 0 1 0 8M22 21c0-3-2-6-5-6.5"/>', fn: exporterMembres, sensible: true },
  { id: 'classement', titre: 'Classement et stats des joueurs', texte: 'Victoires, manches, moyenne, réussite au double, meilleur finish, 180… (mêmes règles que la page Classement).', icone: '<path d="M8 21V11H3v10M15 21V4h-6v17M21 21v-7h-6v7M2 21h20"/>', fn: () => exporterClassement(zone.querySelector('#ex-periode').value), periode: true },
  { id: 'parties', titre: 'Toutes les parties', texte: 'Une ligne par partie : date, joueurs, score en manches, gagnant, format, type, tournoi.', icone: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>', fn: exporterParties },
  { id: 'calendrier', titre: 'Calendrier et résultats des équipes', texte: 'Toutes les rencontres de championnat : date, lieu, adversaire, salle, score et résultat.', icone: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', fn: exporterCalendrier },
];

function afficher() {
  const actuelle = debutSaison().getFullYear();
  const saisons = [];
  for (let a = actuelle; a >= 2026; a--) saisons.push(a);
  zone.innerHTML = `
    <p class="sv-aide">Fichiers CSV à ouvrir avec Excel, Numbers ou Google Sheets (séparateur point-virgule, accents et nombres à virgule compris).</p>
    <div class="ex-grille">${EXPORTS.map((x) => `
      <article class="carte-info ex-carte">
        <svg class="ex-carte__icone" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${x.icone}</svg>
        <div class="ex-carte__texte">
          <h3>${esc(x.titre)}</h3>
          <p>${esc(x.texte)}</p>
          ${x.sensible ? '<p class="ex-alerte">Contient des coordonnées personnelles : ne le partagez pas en dehors du bureau du club et supprimez-le après usage.</p>' : ''}
          ${x.periode ? `<label class="ex-periode"><span>Période</span><select id="ex-periode">${saisons.map((a) => `<option value="${a}">${esc(nomSaison(new Date(a, 8, 1)))}</option>`).join('')}<option value="tout">Depuis toujours</option></select></label>` : ''}
        </div>
        <button type="button" class="bouton bouton--plein bouton--petit ex-bouton" data-export="${x.id}">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>
          Télécharger
        </button>
      </article>`).join('')}
    </div>`;
}

async function clic(e) {
  const b = e.target.closest('[data-export]');
  if (!b) return;
  const x = EXPORTS.find((y) => y.id === b.dataset.export);
  const texte = b.innerHTML;
  b.disabled = true;
  b.textContent = 'Préparation…';
  try {
    const n = await x.fn();
    message(zoneMsg, `${x.titre} : fichier téléchargé (${n} ligne${n > 1 ? 's' : ''}).`, 'ok');
  } catch (err) {
    message(zoneMsg, `Export impossible : ${err.code === 'P0001' ? err.message : erreurFr(err)}`);
  } finally {
    b.disabled = false;
    b.innerHTML = texte;
  }
}

export function initExports(zoneMessage) {
  zone = document.getElementById('vue-exports');
  zoneMsg = zoneMessage;
  zone.addEventListener('click', clic);
  afficher();
}
