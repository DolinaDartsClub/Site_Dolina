// =====================================================================
//  Administration : demandes reçues par « Nous contacter » et demandes
//  pour rejoindre une équipe (répertoire unique des demandes ; les emails
//  viendront s'y ajouter)
// =====================================================================

import { motDePasseProvisoire } from './admin-sans-email.js?v=__VERSION__';
import { supabase, esc, message, erreurFr, avatar, nomAffiche, DOMAINE_IDENTIFIANT, surPlace } from './app.js?v=__VERSION__';

const MOTIFS = { adhesion: 'Rejoindre le club', question: 'Question', autre: 'Autre', mot_de_passe: 'Mot de passe oublié' };
const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

let zone;
let zoneMsg;
let filtre = 'new';
let demandes = [];
let equipesAttente = [];

export async function initDemandes(zoneMessage) {
  zone = document.getElementById('vue-demandes');
  zoneMsg = zoneMessage;
  zone.addEventListener('click', clic);
  // Les autres onglets (Membres, Équipes) préviennent quand une équipe change
  document.addEventListener('dolina:equipes-maj', () => charger());
  await surPlace(charger);
}

async function charger() {
  const [rc, re] = await Promise.all([
    supabase.from('contact_requests').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('team_members')
      .select('team_id, profile_id, requested_at, teams(name, captain_id), profiles!team_members_profile_id_fkey(id, first_name, last_name, nickname, use_nickname, photo_path, status)')
      .eq('status', 'pending').order('requested_at'),
  ]);
  if (rc.error) {
    zone.innerHTML = `<p class="vide">Demandes indisponibles : exécutez le script SQL 018 dans Supabase. (${esc(rc.error.message || '')})</p>`;
    return;
  }
  demandes = rc.data || [];
  equipesAttente = (re.data || []).filter((d) => d.profiles && d.profiles.status !== 'refused');
  const nb = demandes.filter((d) => d.status === 'new').length + equipesAttente.length;
  const compteur = document.getElementById('nb-demandes');
  compteur.textContent = nb;
  compteur.hidden = !nb;
  afficher();
}

function blocEquipes() {
  if (!equipesAttente.length) return '';
  return `
    <section class="carte-info dem-equipes">
      <h2>Demandes pour rejoindre une équipe <span class="compteur">${equipesAttente.length}</span></h2>
      <p class="match__format" style="margin:0">Le capitaine de l'équipe peut aussi les accepter depuis son compte.</p>
      <ul class="dem-equipes__liste">
        ${equipesAttente.map((d) => `
          <li class="dem-equipe">
            ${avatar(d.profiles, 'avatar--liste')}
            <div class="dem-equipe__texte">
              <strong>${esc(nomAffiche(d.profiles))}</strong>
              <small>veut rejoindre <b>${esc(d.teams?.name || '?')}</b>${d.requested_at ? ` · ${esc(fmt.format(new Date(d.requested_at)))}` : ''}${d.profiles.status === 'pending' ? ' · <span class="statut">compte en attente de validation</span>' : ''}</small>
            </div>
            <span class="dem-equipe__actions">
              <button type="button" class="bouton bouton--petit bouton--plein" data-equipe-ok="${d.team_id}" data-profil="${d.profile_id}">Accepter</button>
              <button type="button" class="bouton bouton--petit bouton--danger" data-equipe-non="${d.team_id}" data-profil="${d.profile_id}">Refuser</button>
            </span>
          </li>`).join('')}
      </ul>
    </section>`;
}

function afficher() {
  const liste = demandes.filter((d) => filtre === 'tout' || d.status === filtre);
  zone.innerHTML = `${blocEquipes()}
    <h2 class="section__titre dem-titre">Messages « Nous contacter »</h2>
    <div class="mp-filtre" role="group" aria-label="Filtrer les demandes">
      ${[['new', 'À traiter'], ['done', 'Traitées'], ['tout', 'Toutes']].map(([v, l]) => `<button type="button" data-filtre="${v}" aria-pressed="${filtre === v}">${l}</button>`).join('')}
    </div>
    <div class="liste-cartes" style="margin-top:12px">
      ${liste.length ? liste.map(carte).join('') : `<p class="vide">${filtre === 'new' ? 'Aucune demande à traiter.' : 'Aucune demande.'}</p>`}
    </div>`;
}

const PREFS = { appel: 'Appel', sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };
const MOMENTS = { matin: 'le matin', midi: 'le midi', 'apres-midi': 'l\'après-midi', soir: 'le soir', 'week-end': 'le week-end' };

function carte(d) {
  const tel = (d.phone || '').replace(/[^\d+]/g, '');
  const telInter = tel.startsWith('0') ? `33${tel.slice(1)}` : tel.replace(/^\+/, '');
  const pref = d.contact_pref;
  const actionPref = !pref ? '' : pref === 'appel' ? `<a class="bouton bouton--petit bouton--plein" href="tel:${esc(tel)}">Appeler</a>`
    : pref === 'sms' ? `<a class="bouton bouton--petit bouton--plein" href="sms:${esc(tel)}">Envoyer un SMS</a>`
      : pref === 'whatsapp' ? `<a class="bouton bouton--petit bouton--plein" href="https://wa.me/${esc(telInter)}" target="_blank" rel="noopener">Ouvrir WhatsApp</a>`
        : `<a class="bouton bouton--petit bouton--plein" href="mailto:${esc(d.email || '')}?subject=${encodeURIComponent('Dolina Darts Club – votre demande')}">Répondre par email</a>`;
  return `
    <article class="carte-info demande${d.status === 'new' ? ' demande--nouvelle' : ''}">
      <div class="demande__haut">
        <span class="etiquette${d.motif === 'adhesion' ? ' etiquette--resultat' : ''}">${esc(MOTIFS[d.motif] || d.motif)}</span>
        <span class="match__format">${esc(fmt.format(new Date(d.created_at)))}</span>
        ${d.status === 'done' ? '<span class="statut statut--ok">Traitée</span>' : ''}
      </div>
      <h2>${esc(d.first_name)} ${esc(d.last_name)}</h2>
      ${pref ? `<p class="demande__pref"><span class="dem-pref">Préfère : ${esc(PREFS[pref] || pref)}</span>${d.moment ? ` <span class="match__format">${esc(MOMENTS[d.moment] || d.moment)}</span>` : ''}</p>` : ''}
      <div class="demande__coord">
        ${d.phone ? `<a href="tel:${esc(tel)}">${esc(d.phone)}</a>` : ''}
        ${d.email ? `<a href="mailto:${esc(d.email)}?subject=${encodeURIComponent('Dolina Darts Club – votre demande')}">${esc(d.email)}</a>` : ''}
      </div>
      ${actionPref ? `<div class="actions">${actionPref}</div>` : ''}
      ${d.message ? `<p class="demande__message">${esc(d.message)}</p>` : '<p class="match__format" style="margin:0">Pas de message.</p>'}
      ${d.motif === 'mot_de_passe' ? `<div class="actions"><button type="button" class="bouton bouton--petit bouton--plein" data-mdp-demande="${d.id}">Donner un mot de passe provisoire</button></div><div data-mdp-resultat="${d.id}"></div>` : ''}
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
  if (b.dataset.mdpDemande) return motDePasseDemande(b);
  if (b.dataset.filtre) { filtre = b.dataset.filtre; afficher(); return; }
  if (b.dataset.equipeOk || b.dataset.equipeNon) {
    const team = b.dataset.equipeOk || b.dataset.equipeNon;
    b.disabled = true;
    const r = await supabase.from('team_members').update({ status: b.dataset.equipeOk ? 'accepted' : 'refused' })
      .eq('team_id', team).eq('profile_id', b.dataset.profil).select('team_id');
    b.disabled = false;
    if (r.error || !r.data?.length) return message(zoneMsg, r.error ? erreurFr(r.error) : 'La demande n\'a pas pu être mise à jour.');
    message(zoneMsg, b.dataset.equipeOk ? 'Demande acceptée : le joueur fait partie de l\'équipe.' : 'Demande refusée.', 'ok');
    document.dispatchEvent(new CustomEvent('dolina:equipes-maj', { detail: { source: 'demandes' } }));
    return;
  }
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
  await surPlace(charger);
}

// Demande « Mot de passe oublié » : retrouver le compte, lui donner un mot de passe provisoire
async function motDePasseDemande(b) {
  const d = (demandes || []).find((x) => x.id === b.dataset.mdpDemande);
  if (!d) return;
  const compte = (d.message.match(/Compte\s*:\s*(\S+)/i)?.[1] || d.email || '').toLowerCase();
  const mail = compte.includes('@') ? compte : `${compte}@${DOMAINE_IDENTIFIANT}`;
  const { data: p } = await supabase.from('profile_private').select('id').ilike('email', mail).maybeSingle();
  const zone = document.querySelector(`[data-mdp-resultat="${d.id}"]`);
  if (!p) {
    zone.innerHTML = `<p class="message">Aucun compte trouvé pour « ${esc(compte)} ». Cherchez le membre dans Membres et utilisez « Mot de passe provisoire » sur sa fiche.</p>`;
    return;
  }
  b.disabled = true;
  await motDePasseProvisoire({ id: p.id, prenom: d.first_name, telephone: d.phone, email: d.email, zone, zoneMessage: zoneMsg });
  b.disabled = false;
}
