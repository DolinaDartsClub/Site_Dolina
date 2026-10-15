// =====================================================================
//  Administration : demandes reçues par « Nous contacter »
//  (répertoire unique des demandes ; les emails viendront s'y ajouter)
// =====================================================================

import { supabase, esc, message, erreurFr } from './app.js?v=__VERSION__';

const MOTIFS = { adhesion: 'Rejoindre le club', question: 'Question', autre: 'Autre' };
const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let zone;
let zoneMsg;
let filtre = 'new';
let demandes = [];

export async function initDemandes(zoneMessage) {
  zone = document.getElementById('vue-demandes');
  zoneMsg = zoneMessage;
  zone.addEventListener('click', clic);
  await charger();
}

async function charger() {
  const { data, error } = await supabase.from('contact_requests').select('*').order('created_at', { ascending: false }).limit(200);
  if (error) {
    zone.innerHTML = `<p class="vide">Demandes indisponibles : exécutez le script SQL 018 dans Supabase. (${esc(error.message || '')})</p>`;
    return;
  }
  demandes = data || [];
  const nb = demandes.filter((d) => d.status === 'new').length;
  const compteur = document.getElementById('nb-demandes');
  compteur.textContent = nb;
  compteur.hidden = !nb;
  afficher();
}

function afficher() {
  const liste = demandes.filter((d) => filtre === 'tout' || d.status === filtre);
  zone.innerHTML = `
    <div class="mp-filtre" role="group" aria-label="Filtrer les demandes">
      ${[['new', 'À traiter'], ['done', 'Traitées'], ['tout', 'Toutes']].map(([v, l]) => `<button type="button" data-filtre="${v}" aria-pressed="${filtre === v}">${l}</button>`).join('')}
    </div>
    <div class="liste-cartes" style="margin-top:12px">
      ${liste.length ? liste.map(carte).join('') : `<p class="vide">${filtre === 'new' ? 'Aucune demande à traiter.' : 'Aucune demande.'}</p>`}
    </div>`;
}

function carte(d) {
  const tel = d.phone.replace(/[^\d+]/g, '');
  return `
    <article class="carte-info demande${d.status === 'new' ? ' demande--nouvelle' : ''}">
      <div class="demande__haut">
        <span class="etiquette${d.motif === 'adhesion' ? ' etiquette--resultat' : ''}">${esc(MOTIFS[d.motif] || d.motif)}</span>
        <span class="match__format">${esc(fmt.format(new Date(d.created_at)))}</span>
        ${d.status === 'done' ? '<span class="statut statut--ok">Traitée</span>' : ''}
      </div>
      <h2>${esc(d.first_name)} ${esc(d.last_name)}</h2>
      <div class="demande__coord">
        <a href="tel:${esc(tel)}">${esc(d.phone)}</a>
        <a href="mailto:${esc(d.email)}?subject=${encodeURIComponent('Dolina Darts Club – votre demande')}">${esc(d.email)}</a>
      </div>
      ${d.message ? `<p class="demande__message">${esc(d.message)}</p>` : '<p class="match__format" style="margin:0">Pas de message.</p>'}
      <label class="champ">Note interne <small>(visible des admins)</small>
        <textarea data-note="${d.id}" rows="2" maxlength="1000" placeholder="Ex. rappelé le 16/10, vient jeudi">${esc(d.note || '')}</textarea>
      </label>
      <div class="actions">
        ${d.status === 'new'
    ? `<button type="button" class="bouton bouton--petit bouton--plein" data-traiter="${d.id}">Marquer comme traitée</button>`
    : `<button type="button" class="bouton bouton--petit" data-rouvrir="${d.id}">Remettre à traiter</button>`}
        <button type="button" class="bouton bouton--petit" data-enregistrer-note="${d.id}">Enregistrer la note</button>
        <button type="button" class="bouton bouton--petit bouton--danger" data-supprimer="${d.id}">Supprimer</button>
      </div>
    </article>`;
}

async function clic(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.filtre) { filtre = b.dataset.filtre; afficher(); return; }
  const id = b.dataset.traiter || b.dataset.rouvrir || b.dataset.enregistrerNote || b.dataset.supprimer;
  if (!id) return;
  b.disabled = true;
  let res;
  if (b.dataset.traiter) {
    const { data: { session } } = await supabase.auth.getSession();
    res = await supabase.from('contact_requests').update({ status: 'done', treated_at: new Date().toISOString(), treated_by: session?.user?.id || null }).eq('id', id);
  } else if (b.dataset.rouvrir) {
    res = await supabase.from('contact_requests').update({ status: 'new', treated_at: null, treated_by: null }).eq('id', id);
  } else if (b.dataset.enregistrerNote) {
    res = await supabase.from('contact_requests').update({ note: zone.querySelector(`[data-note="${id}"]`).value.trim() }).eq('id', id);
  } else {
    if (!confirm('Supprimer définitivement cette demande ?')) { b.disabled = false; return; }
    res = await supabase.from('contact_requests').delete().eq('id', id);
  }
  b.disabled = false;
  if (res.error) return message(zoneMsg, erreurFr(res.error));
  message(zoneMsg, b.dataset.enregistrerNote ? 'Note enregistrée.' : (b.dataset.supprimer ? 'Demande supprimée.' : 'Demande mise à jour.'), 'ok');
  await charger();
}
