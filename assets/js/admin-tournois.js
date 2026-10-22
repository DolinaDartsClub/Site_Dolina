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
    .select('id, name, status, est_ligue, ligue_visible, format, team_mode, max_participants, pools_count, pool_qualifiers, third_place, created_at, created_by, organisateur:profiles!tournaments_created_by_fkey(first_name, last_name, nickname, use_nickname), tournament_entries(count), tournament_matches(status, game_id)')
    .order('created_at', { ascending: false });
  if (error) {
    zone.innerHTML = `<p class="vide">Tournois indisponibles. (${esc(erreurFr(error))})</p>`;
    return;
  }
  tournois = data || [];
  afficher();
}

// Ligue interne (script 044) : créée par un admin, masquée tant qu'elle n'est pas rendue visible
function blocLigue() {
  const ligues = tournois.filter((t) => t.est_ligue);
  const saison = (() => { const d = new Date(); const a = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return `${a}-${a + 1}`; })();
  return `
    <section class="adm-ligue">
      <h3 class="cs-sous-titre" style="margin-top:0">Ligue interne <span class="t-role">En préparation</span></h3>
      <p class="sv-aide">Un seul tableau : chaque inscrit joue une fois contre chacun des autres pendant la saison (3 points la victoire, 1 la défaite). Les premiers jouent ensuite le tournoi Master. Tant que vous ne la rendez pas visible, seuls les admins la voient.</p>
      ${ligues.length ? `<ul class="adm-tournois">${ligues.map((t) => `
        <li class="adm-tournoi"><div class="adm-tournoi__haut"><a class="adm-tournoi__nom" href="tournoi.html?id=${encodeURIComponent(t.id)}">${esc(t.name)}</a>${badgeStatut(t.status)}</div>
          <small>${t.ligue_visible ? 'Visible par les membres' : 'Masquée : visible des admins seulement'} · ${t.tournament_entries?.[0]?.count ?? 0} inscrits</small></li>`).join('')}</ul>` : ''}
      <details class="adm-ligue__creer"${ligues.length ? '' : ' open'}>
        <summary>Créer une ligue</summary>
        <form id="form-ligue" class="adm-ligue__form">
          <label class="champ">Nom<input name="nom" required maxlength="80" value="Ligue interne ${saison}"></label>
          <div class="deux-colonnes">
            <label class="champ">Places maximum<input type="number" name="places" min="3" max="64" value="40" inputmode="numeric"></label>
            <label class="champ">Qualifiés pour le Master (par poule)<select name="qualifies">${[4, 8, 12, 16].map((v) => `<option value="${v}" ${v === 8 ? 'selected' : ''}>${v}</option>`).join('')}</select><small>Le nombre de poules se choisit au lancement ; modifiable jusqu'au Master.</small></label>
          </div>
          <label class="champ">Description (facultatif)<textarea name="description" rows="2" maxlength="1000"></textarea></label>
          <button type="submit" class="bouton bouton--plein">Créer la ligue (masquée)</button>
        </form>
      </details>
    </section>`;
}

function afficher() {
  if (!tournois.length) {
    zone.innerHTML = `${blocLigue()}<p class="vide">Aucun tournoi pour l'instant.</p>`;
    brancherLigue();
    return;
  }
  zone.innerHTML = `
    ${blocLigue()}
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
  brancherLigue();
}

function brancherLigue() {
  zone.querySelector('#form-ligue')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const bouton = e.target.querySelector('[type=submit]');
    bouton.disabled = true;
    const { data, error } = await supabase.from('tournaments').insert({
      name: f.nom.value.trim(),
      description: f.description.value.trim(),
      format: 'pools', team_mode: 'single', est_ligue: true,
      max_participants: Number(f.places.value) || 40,
      pool_qualifiers: Number(f.qualifies.value) || 8,
      pools_count: 1, cibles_par_poule: 8, status: 'open',
      public_matches: false, third_place: false, show_checkout: false,
    }).select('id').single();
    bouton.disabled = false;
    if (error) {
      const absente = /schema cache/i.test(error.message || '');
      return message(zoneMsg, absente ? 'Exécutez d\'abord le script SQL 044 dans Supabase.' : erreurFr(error));
    }
    location.href = `tournoi.html?id=${encodeURIComponent(data.id)}`;
  });
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
