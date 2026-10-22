// =====================================================================
//  Admin › Membres : rattacher à un compte les matchs joués comme invité
//  (script 054). L'admin coche les inscriptions de tournoi et les parties
//  qui concernent vraiment le membre ; elles passent sur son compte.
// =====================================================================

import { supabase, esc, message, erreurFr } from './app.js?v=__VERSION__';

const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const date = (d) => (d ? fmt.format(new Date(d)) : '');

async function charger(zone, idMembre, recherche = '') {
  zone.innerHTML = '<p class="vide">Recherche des invités…</p>';
  const { data, error } = await supabase.rpc('invites_correspondants', { p_profile: idMembre, p_recherche: recherche || null });
  if (error) {
    zone.innerHTML = `<p class="vide">${error.code === 'PGRST202' ? 'Exécutez d\'abord le script SQL 054 dans Supabase.' : esc(erreurFr(error))}</p>`;
    return;
  }
  const insc = data.inscriptions || [];
  const parties = data.parties || [];
  const faits = data.rattaches || [];
  zone.innerHTML = `
    <p class="match__format" style="margin:0">Invités dont le nom ressemble à ce membre${recherche ? ` (recherche « ${esc(recherche)} »)` : ''}. Cochez seulement ce qui le concerne vraiment.</p>
    <div class="ri-recherche">
      <input type="search" data-ri-recherche placeholder="Autre nom d'invité (ex. Jean D.)" value="${esc(recherche)}" aria-label="Chercher un autre nom d'invité">
      <button type="button" class="bouton bouton--petit" data-ri-chercher="${idMembre}">Chercher</button>
    </div>
    ${insc.length ? `<h4 class="ri-titre">Tournois</h4><ul class="ri-liste">${insc.map((x) => `
      <li><label class="ri-ligne${x.deja_inscrit ? ' ri-ligne--impossible' : ''}">
        <input type="checkbox" data-ri-insc="${x.id}"${x.deja_inscrit ? ' disabled' : ''}>
        <span><span><strong>${esc(x.tournoi)}</strong> · ${esc(date(x.quand))}</span><small>Inscrit comme « ${esc(x.nom)} »${x.partenaire ? ' (joueur 2 d\'une doublette)' : ''} · ${x.parties} partie${x.parties > 1 ? 's' : ''}${x.deja_inscrit ? ' · <b>déjà inscrit sous son compte : impossible</b>' : ''}</small></span>
      </label></li>`).join('')}</ul>` : ''}
    ${parties.length ? `<h4 class="ri-titre">Parties hors tournoi</h4><ul class="ri-liste">${parties.map((x) => `
      <li><label class="ri-ligne${x.deja_dans_partie ? ' ri-ligne--impossible' : ''}">
        <input type="checkbox" data-ri-partie="${x.id}"${x.deja_dans_partie ? ' disabled' : ''}>
        <span><strong>${esc(x.variant)} · ${esc(date(x.quand))}</strong><small>« ${esc(x.nom)} »${x.adversaires ? ` contre ${esc(x.adversaires)}` : ''}</small></span>
      </label></li>`).join('')}</ul>` : ''}
    ${!insc.length && !parties.length ? '<p class="vide">Aucun invité ne correspond. Essayez un autre nom ci-dessus.</p>' : `
    <button type="button" class="bouton bouton--petit bouton--plein" data-ri-rattacher="${idMembre}">Rattacher la sélection à ce membre</button>`}
    ${faits.length ? `<h4 class="ri-titre">Déjà rattachés</h4><ul class="ri-liste">${faits.map((r) => `
      <li class="ri-fait"><span>${esc(r.quoi)}<small>ancien nom « ${esc(r.ancien_nom)} » · le ${esc(date(r.fait_le))}</small></span>
        <button type="button" class="bouton bouton--petit bouton--discret" data-ri-annuler="${r.id}" data-membre="${idMembre}">Annuler</button></li>`).join('')}</ul>` : ''}`;
}

export function initRattachementInvites(zoneMsg) {
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ri-ouvrir], [data-ri-chercher], [data-ri-rattacher], [data-ri-annuler]');
    if (!b) return;
    const bloc = b.closest('[data-ri-bloc]');
    const zone = bloc?.querySelector('[data-ri-zone]');
    if (!zone) return;
    if (b.dataset.riOuvrir) return charger(zone, b.dataset.riOuvrir);
    if (b.dataset.riChercher) return charger(zone, b.dataset.riChercher, zone.querySelector('[data-ri-recherche]').value.trim());
    if (b.dataset.riRattacher) {
      const insc = [...zone.querySelectorAll('[data-ri-insc]:checked')].map((c) => c.dataset.riInsc);
      const parties = [...zone.querySelectorAll('[data-ri-partie]:checked')].map((c) => c.dataset.riPartie);
      if (!insc.length && !parties.length) return message(zoneMsg, 'Cochez au moins un tournoi ou une partie.');
      if (!confirm(`Rattacher ${insc.length + parties.length} élément${insc.length + parties.length > 1 ? 's' : ''} à ce membre ? Ses stats et son classement en tiendront compte.`)) return;
      b.disabled = true;
      const { data, error } = await supabase.rpc('rattacher_invite', { p_profile: b.dataset.riRattacher, p_inscriptions: insc, p_parties: parties });
      b.disabled = false;
      if (error) return message(zoneMsg, erreurFr(error));
      message(zoneMsg, `Rattaché : ${data.inscriptions} tournoi${data.inscriptions > 1 ? 's' : ''} et ${data.parties} partie${data.parties > 1 ? 's' : ''}.`, 'ok');
      return charger(zone, b.dataset.riRattacher);
    }
    if (b.dataset.riAnnuler) {
      if (!confirm('Annuler ce rattachement ? L\'invité retrouve son ancien nom.')) return;
      const { error } = await supabase.rpc('annuler_rattachements', { p_ids: [b.dataset.riAnnuler] });
      if (error) return message(zoneMsg, erreurFr(error));
      message(zoneMsg, 'Rattachement annulé.', 'ok');
      return charger(zone, b.dataset.membre);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('[data-ri-recherche]')) {
      e.preventDefault();
      e.target.closest('[data-ri-zone]').querySelector('[data-ri-chercher]').click();
    }
  });
}
