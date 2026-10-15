// =====================================================================
//  Administration : liste de tous les tournois, avec suppression
//  (à tout moment ; les parties jouées sont supprimées ou gardées
//  comme parties libres, au choix)
// =====================================================================

import { supabase, esc, message, erreurFr, nomAffiche } from './app.js?v=__VERSION__';
import { badgeStatut, resumeFormat } from './tournoi-commun.js?v=__VERSION__';

const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
let zone;
let zoneMsg;
let tournois = [];

export async function initTournois(zoneMessage) {
  zone = document.getElementById('vue-tournois');
  zoneMsg = zoneMessage;
  zone.addEventListener('click', clic);
  await charger();
}

async function charger() {
  const { data, error } = await supabase.from('tournaments')
    .select('id, name, status, format, team_mode, max_participants, pools_count, pool_qualifiers, third_place, created_at, created_by, organisateur:profiles!tournaments_created_by_fkey(first_name, last_name, nickname, use_nickname), tournament_entries(count), tournament_matches(status, game_id)')
    .order('created_at', { ascending: false });
  if (error) {
    zone.innerHTML = `<p class="vide">Tournois indisponibles. (${esc(erreurFr(error))})</p>`;
    return;
  }
  tournois = data || [];
  afficher();
}

function afficher() {
  if (!tournois.length) {
    zone.innerHTML = '<p class="vide">Aucun tournoi pour l\'instant.</p>';
    return;
  }
  zone.innerHTML = `
    <p class="sv-aide">Tous les tournois du club, du plus récent au plus ancien. Un admin peut supprimer un tournoi à tout moment, même lancé ou terminé.</p>
    <ul class="adm-tournois">${tournois.map((t) => {
    const inscrits = t.tournament_entries?.[0]?.count ?? 0;
    const joues = (t.tournament_matches || []).filter((m) => m.game_id).length;
    let format = '';
    try { format = resumeFormat(t); } catch { format = t.format === 'pools' ? 'Poules' : 'Élimination directe'; }
    return `
      <li class="adm-tournoi" data-tournoi="${t.id}">
        <div class="adm-tournoi__haut">
          <a class="adm-tournoi__nom" href="tournoi.html?id=${encodeURIComponent(t.id)}">${esc(t.name)}</a>
          ${badgeStatut(t.status)}
        </div>
        <small>${esc(format)} · ${inscrits} inscrit${inscrits > 1 ? 's' : ''} · ${joues} match${joues > 1 ? 's' : ''} joué${joues > 1 ? 's' : ''}</small>
        <small>Organisé par ${esc(t.organisateur ? nomAffiche(t.organisateur) : 'Ancien joueur')} · créé le ${esc(fmt.format(new Date(t.created_at)))}</small>
        <div class="adm-tournoi__actions">
          <button type="button" class="bouton bouton--petit bouton--danger" data-supprimer="${t.id}">Supprimer</button>
        </div>
        <div class="adm-tournoi__confirmer" hidden>
          <p><strong>Supprimer « ${esc(t.name)} » ?</strong> Inscriptions, poules, arbre et résultats seront effacés. Cette action est définitive.</p>
          ${joues ? `<label class="case case--simple"><input type="checkbox" data-avec-parties>Supprimer aussi les ${joues} partie${joues > 1 ? 's' : ''} jouée${joues > 1 ? 's' : ''} (sinon elles restent dans les stats des joueurs, comme parties libres)</label>` : ''}
          <div class="actions">
            <button type="button" class="bouton bouton--petit bouton--danger" data-confirmer="${t.id}">Confirmer la suppression</button>
            <button type="button" class="bouton bouton--petit" data-annuler>Annuler</button>
          </div>
        </div>
      </li>`;
  }).join('')}</ul>`;
}

async function clic(e) {
  const ligne = e.target.closest('[data-tournoi]');
  if (!ligne) return;
  const panneau = ligne.querySelector('.adm-tournoi__confirmer');
  if (e.target.closest('[data-supprimer]')) {
    panneau.hidden = false;
    e.target.closest('[data-supprimer]').hidden = true;
    return;
  }
  if (e.target.closest('[data-annuler]')) {
    panneau.hidden = true;
    ligne.querySelector('[data-supprimer]').hidden = false;
    return;
  }
  const b = e.target.closest('[data-confirmer]');
  if (!b) return;
  const avecParties = !!ligne.querySelector('[data-avec-parties]')?.checked;
  b.disabled = true;
  const { data, error } = await supabase.rpc('supprimer_tournoi', { p_tournoi: b.dataset.confirmer, p_avec_parties: avecParties });
  if (error) {
    b.disabled = false;
    const absente = /function|schema cache/i.test(error.message || '');
    return message(zoneMsg, absente ? 'Exécutez d\'abord le script SQL 027 dans Supabase.' : erreurFr(error));
  }
  const nb = data?.parties || 0;
  message(zoneMsg, `Tournoi supprimé.${nb ? (avecParties ? ` ${nb} partie${nb > 1 ? 's' : ''} supprimée${nb > 1 ? 's' : ''}.` : ` ${nb} partie${nb > 1 ? 's' : ''} gardée${nb > 1 ? 's' : ''} comme partie${nb > 1 ? 's' : ''} libre${nb > 1 ? 's' : ''}.`) : ''}`, 'ok');
  await charger();
}
