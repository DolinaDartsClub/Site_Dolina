// =====================================================================
//  Espace d'administration (réservé aux admins)
//  - Inscriptions : valider ou refuser les nouveaux comptes
//  - Membres : statut, rôle, équipes, suppression
//  - Équipes : désigner les capitaines
//  Les droits sont vérifiés par la base : un non-admin ne peut rien modifier.
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, dateFr, nomComplet as nomCompletJoueur, avatar, DOSSIER_PHOTOS, formatPartie, identifiantDe, surPlace } from './app.js?v=__VERSION__';
import { initSansEmail } from './admin-sans-email.js?v=__VERSION__';
import { initRattachementInvites } from './admin-invites.js?v=__VERSION__';
import { initActus } from './admin-actus.js?v=__VERSION__';
import { initDemandes } from './admin-demandes.js?v=__VERSION__';
import { initMatchs } from './admin-matchs.js?v=__VERSION__';
import { blocRencontresRetard } from './retard.js?v=__VERSION__';
import { initExports } from './admin-exports.js?v=__VERSION__';
import { initSauvegarde } from './admin-sauvegarde.js?v=__VERSION__';
import { initTournois } from './admin-tournois.js?v=__VERSION__';
import { logoEquipe, enregistrerLogoEquipe } from './logos.js?v=__VERSION__';

const zoneMessage = document.getElementById('message');
const vues = {
  inscriptions: document.getElementById('vue-inscriptions'),
  membres: document.getElementById('vue-membres'),
  equipes: document.getElementById('vue-equipes'),
  matchs: document.getElementById('vue-matchs'),
  actus: document.getElementById('vue-actus'),
  demandes: document.getElementById('vue-demandes'),
  tournois: document.getElementById('vue-tournois'),
  exports: document.getElementById('vue-exports'),
  sauvegarde: document.getElementById('vue-sauvegarde'),
};
const listeMembres = document.getElementById('liste-membres');
const listeEquipes = document.getElementById('liste-equipes');
const recherche = document.getElementById('recherche');

let moi = null;
let profils = [];
let equipes = [];
let niveaux = null;   // profile_id -> niveau (1 à 5), null si script 060 absent
const ouverts = new Set(); // fiches membres dépliées (gardées ouvertes après une action)

const STATUT = { pending: 'En attente', active: 'Validé', refused: 'Refusé' };
const STATUT_CLASSE = { pending: 'statut--attente', active: 'statut--ok', refused: 'statut--refus' };
const EQUIPE = { pending: 'En attente', accepted: 'Membre', refused: 'Refusé' };
const EQUIPE_CLASSE = { pending: 'statut--attente', accepted: 'statut--ok', refused: 'statut--refus' };

const nomComplet = (p) => nomCompletJoueur(p);
const prive = (p) => (Array.isArray(p.profile_private) ? p.profile_private[0] : p.profile_private) || {};
const nomEquipe = (id) => equipes.find((t) => t.id === id)?.name || '?';

// ---------- Chargement ----------

async function charger() {
  const [rp, rt] = await Promise.all([
    supabase
      .from('profiles')
      .select('*, profile_private(email, phone), team_members!team_members_profile_id_fkey(team_id, status)')
      .order('last_name'),
    supabase.from('teams').select('*').order('sort_order'),
  ]);
  // Niveaux des joueurs (script 060) : privés, pour équilibrer les poules
  const rn = await supabase.from('niveaux_joueurs').select('profile_id, niveau');
  niveaux = rn.error ? null : new Map((rn.data || []).map((x) => [x.profile_id, x.niveau]));
  if (rp.error || rt.error) {
    message(zoneMessage, erreurFr(rp.error || rt.error));
    return;
  }
  profils = rp.data;
  equipes = rt.data;
  afficherInscriptions();
  afficherRecap();
  afficherMembres();
  afficherEquipes();
}

// ---------- Inscriptions en attente ----------

function afficherInscriptions() {
  const attente = profils.filter((p) => p.status === 'pending')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  document.getElementById('nb-attente').textContent = attente.length;

  if (!attente.length) {
    vues.inscriptions.innerHTML = '<p class="vide">Aucune inscription en attente.</p>';
    return;
  }
  vues.inscriptions.innerHTML = `
    <p class="intro">${attente.length} inscription${attente.length > 1 ? 's' : ''} à traiter. Après votre validation, le capitaine de chaque équipe demandée accepte ou refuse le joueur.</p>
    <div class="liste-cartes">
      ${attente.map((p) => {
        const c = prive(p);
        const demandes = (p.team_members || []).map((m) => esc(nomEquipe(m.team_id))).join(', ') || 'Aucune équipe';
        return `
          <article class="carte-info">
            <h2>${esc(nomComplet(p))}</h2>
            <span class="match__format">Inscrit le ${esc(dateFr(p.created_at))}</span>
            <dl class="infos">
              <dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd>
              <dt>Téléphone</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '—'}</dd>
              <dt>Équipe(s)</dt><dd>${demandes}</dd>
            </dl>
            <div class="actions">
              <button type="button" class="bouton bouton--plein" data-action="valider" data-id="${p.id}">Valider</button>
              <button type="button" class="bouton bouton--danger" data-action="refuser" data-id="${p.id}">Refuser</button>
            </div>
          </article>`;
      }).join('')}
    </div>`;
}

// ---------- Membres ----------

// ---------- Récap des membres (haut de la rubrique Membres) ----------
function afficherRecap() {
  let zone = document.getElementById('recap-membres');
  if (!zone) {
    zone = document.createElement('section');
    zone.id = 'recap-membres';
    zone.className = 'recap-membres';
    const vue = document.getElementById('vue-membres');
    vue.insertBefore(zone, vue.firstChild);
  }
  const actifs = profils.filter((p) => p.status === 'active');
  const nb = (f) => profils.filter(f).length;
  const dansEquipe = (p, id) => (p.team_members || []).some((m) => m.status === 'accepted' && (!id || m.team_id === id));
  const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
  const tuile = (valeur, libelle, classe = '') => `<div class="recap-tuile ${classe}"><b>${valeur}</b><span>${libelle}</span></div>`;
  zone.innerHTML = `
    <div class="recap-tuiles">
      ${tuile(actifs.length, `Membre${actifs.length > 1 ? 's' : ''} validé${actifs.length > 1 ? 's' : ''}`, 'recap-tuile--fort')}
      ${tuile(nb((p) => p.status === 'pending'), 'En attente', nb((p) => p.status === 'pending') ? 'recap-tuile--alerte' : '')}
      ${tuile(nb((p) => new Date(p.created_at) >= debutMois), 'Nouveaux ce mois')}
      ${tuile(actifs.filter((p) => !dansEquipe(p)).length, 'Sans équipe')}
      ${tuile(actifs.filter((p) => p.role === 'admin').length, 'Admins')}
      ${tuile(actifs.filter((p) => p.compte === 'identifiant' || p.compte === 'gere').length, 'Sans email')}
    </div>
    <div class="recap-equipes">
      ${equipes.map((t) => {
        const n = actifs.filter((p) => dansEquipe(p, t.id)).length;
        const cap = profils.find((p) => p.id === t.captain_id);
        const vice = profils.find((p) => p.id === t.vice_captain_id);
        return `<div class="recap-equipe"><strong>${esc(t.name)}</strong><span><b>${n}</b> joueur${n > 1 ? 's' : ''}</span>
          <small>${cap ? `Cap. ${esc(nomComplet(cap))}` : 'Pas de capitaine'}${vice ? ` · Vice ${esc(nomComplet(vice))}` : ''}</small></div>`;
      }).join('')}
    </div>
    ${nb((p) => p.status === 'refused') ? `<p class="match__format recap-note">${nb((p) => p.status === 'refused')} inscription(s) refusée(s) dans la liste.</p>` : ''}`;
}

function afficherMembres() {
  const q = recherche.value.trim().toLowerCase();
  const liste = profils.filter((p) => {
    if (!q) return true;
    const c = prive(p);
    return [p.first_name, p.last_name, p.nickname, c.email].some((v) => (v || '').toLowerCase().includes(q));
  });

  if (!liste.length) {
    listeMembres.innerHTML = '<p class="vide">Aucun membre ne correspond à la recherche.</p>';
    return;
  }

  listeMembres.innerHTML = liste.map((p) => {
    const c = prive(p);
    const estMoi = p.id === moi.id;
    const rattachements = p.team_members || [];
    const resumeEquipes = rattachements.filter((m) => m.status === 'accepted').map((m) => nomEquipe(m.team_id)).join(', ');

    const lignesEquipes = equipes.map((t) => {
      const m = rattachements.find((x) => x.team_id === t.id);
      const capitaine = t.captain_id === p.id;
      const vice = t.vice_captain_id === p.id;
      let actions = '';
      if (!m) {
        actions = `<button type="button" class="bouton bouton--petit" data-action="ajouter-equipe" data-id="${p.id}" data-team="${t.id}">Ajouter</button>`;
      } else if (m.status === 'pending') {
        actions = `<button type="button" class="bouton bouton--petit bouton--plein" data-action="accepter-equipe" data-id="${p.id}" data-team="${t.id}">Accepter</button>
                   <button type="button" class="bouton bouton--petit bouton--danger" data-action="refuser-equipe" data-id="${p.id}" data-team="${t.id}">Refuser</button>`;
      } else if (!capitaine) {
        actions = `<button type="button" class="bouton bouton--petit bouton--danger" data-action="retirer-equipe" data-id="${p.id}" data-team="${t.id}">Retirer</button>`;
      }
      return `
        <div class="ligne-equipe">
          <span class="ligne-equipe__nom">${esc(t.name)}${capitaine ? ' <span class="statut statut--ok">Capitaine</span>' : (vice ? ' <span class="statut statut--ok">Vice-capitaine</span>' : '')}</span>
          ${m ? `<span class="statut ${EQUIPE_CLASSE[m.status]}">${EQUIPE[m.status]}</span>` : '<span class="match__format">—</span>'}
          <span class="ligne-equipe__actions">${actions}</span>
        </div>`;
    }).join('');

    return `
      <details class="carte-info fiche" data-fiche="${p.id}" ${ouverts.has(p.id) ? 'open' : ''}>
        <summary class="fiche__resume">
          ${avatar(p, 'avatar--liste fiche__avatar')}
          <span class="fiche__nom">${esc(nomComplet(p))}${estMoi ? ' (vous)' : ''}</span>
          <span class="fiche__badges">
            ${p.status === 'active'
    ? '<span class="valide-ok" role="img" aria-label="Compte validé" title="Compte validé"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/></svg></span>'
    : `<span class="statut ${STATUT_CLASSE[p.status]}">${STATUT[p.status]}</span>`}
            ${p.role === 'admin' ? '<span class="statut statut--ok">Admin</span>' : ''}
            ${p.compte === 'gere' ? '<span class="statut statut--sans-email">Profil géré</span>' : (identifiantDe(c.email) ? '<span class="statut statut--sans-email">Sans email</span>' : '')}
          </span>
          <span class="match__format">${esc(resumeEquipes || 'Sans équipe')}</span>
        </summary>
        <div class="fiche__contenu">
          <dl class="infos">
            ${identifiantDe(c.email)
    ? `<dt>${p.compte === 'gere' ? 'Accès' : 'Identifiant'}</dt><dd>${p.compte === 'gere' ? 'Profil géré, sans connexion' : `<strong>${esc(identifiantDe(c.email))}</strong> · sans email`}</dd>`
    : `<dt>Email</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : '—'}</dd>`}
            <dt>Téléphone</dt><dd>${c.phone ? `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` : '—'}</dd>
            <dt>Inscrit le</dt><dd>${esc(dateFr(p.created_at))}</dd>
          </dl>
          <div class="deux-colonnes">
            <label class="champ">Prénom<input type="text" maxlength="60" value="${esc(p.first_name)}" data-champ="first_name" data-id="${p.id}"></label>
            <label class="champ">Nom<input type="text" maxlength="60" value="${esc(p.last_name)}" data-champ="last_name" data-id="${p.id}"></label>
          </div>
          <button type="button" class="bouton bouton--petit" data-action="renommer" data-id="${p.id}" style="align-self:flex-start">Enregistrer le nom</button>
          ${identifiantDe(c.email) ? `<div class="se-email">
            <strong>Passer à un compte avec email</strong>
            <span class="match__format">Le membre se connectera ensuite avec son email (son identifiant « ${esc(identifiantDe(c.email))} » ne servira plus). Profil, parties, équipes et stats sont gardés.</span>
            <div class="deux-colonnes">
              <label class="champ">Email<input type="email" maxlength="120" autocomplete="off" data-email-nouveau="${p.id}" placeholder="prenom.nom@exemple.fr"></label>
              <label class="champ">Téléphone<input type="tel" maxlength="30" autocomplete="off" data-tel-nouveau="${p.id}" value="${esc(c.phone || '')}"></label>
            </div>
            <button type="button" class="bouton bouton--petit bouton--plein" data-action="ajouter-email" data-id="${p.id}" style="align-self:flex-start">Enregistrer l'email</button>
          </div>` : ''}
          ${niveaux && p.status === 'active' ? `<label class="champ">Niveau <small>(privé · sert à équilibrer les poules des ligues et tournois)</small>
            <select data-action="niveau" data-id="${p.id}">
              <option value="">— Non noté —</option>
              ${[[1, '1 · Très fort'], [2, '2 · Fort'], [3, '3 · Moyen'], [4, '4 · Débutant confirmé'], [5, '5 · Débutant']].map(([v, l]) => `<option value="${v}"${niveaux.get(p.id) === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select></label>` : ''}
          ${p.role !== 'admin' || estMoi ? `<div class="se-fiche">
            <button type="button" class="bouton bouton--petit" data-nouveau-code="${p.id}" data-prenom="${esc(p.first_name)}" data-tel="${esc(c.phone || '')}" data-email="${esc(c.email || '')}">${p.compte === 'gere' ? 'Donner un accès (identifiant + mot de passe)' : 'Mot de passe provisoire'}</button>
            <span class="match__format">${p.compte === 'gere' ? `Identifiant prévu : ${esc(identifiantDe(c.email))}` : 'Mot de passe oublié ? Le site en tire un provisoire, à envoyer au membre.'}${p.mdp_provisoire ? ' · <strong>Provisoire pas encore changé</strong>' : ''}</span>
            <div data-codes></div>
          </div>` : ''}
          ${p.photo_path ? `<div class="photo-profil__ligne">${avatar(p, 'avatar--grand')}
            <button type="button" class="bouton bouton--petit bouton--danger" data-action="retirer-photo" data-id="${p.id}">Retirer la photo</button></div>` : ''}
          <div class="deux-colonnes">
            <label class="champ">Statut du compte
              <select data-action="statut" data-id="${p.id}" ${estMoi ? 'disabled' : ''}>
                ${Object.entries(STATUT).map(([v, l]) => `<option value="${v}" ${p.status === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </label>
            <label class="champ">Rôle
              <select data-action="role" data-id="${p.id}" ${estMoi ? 'disabled' : ''}>
                <option value="member" ${p.role === 'member' ? 'selected' : ''}>Membre</option>
                <option value="admin" ${p.role === 'admin' ? 'selected' : ''}>Administrateur</option>
              </select>
            </label>
          </div>
          ${estMoi ? '<p class="match__format">Vous ne pouvez pas modifier votre propre statut ni votre rôle : demandez à un autre admin.</p>' : ''}
          <div class="fiche__equipes">
            <h3>Équipes</h3>
            ${lignesEquipes}
          </div>
          <div class="fiche__parties">
            <h3>Parties</h3>
            <div class="fiche__liste-parties" data-liste-parties="${p.id}">
              <button type="button" class="bouton bouton--petit" data-partie-action="voir" data-id="${p.id}" style="align-self:flex-start">Voir ses parties</button>
            </div>
          </div>
          <div class="fiche__parties" data-ri-bloc>
            <h3>Matchs joués comme invité</h3>
            <div data-ri-zone>
              <p class="match__format" style="margin:0">Avant de créer son compte, ce membre a peut-être joué comme invité (tournois, parties). Rattachez ces matchs à son compte.</p>
              <button type="button" class="bouton bouton--petit" data-ri-ouvrir="${p.id}" style="align-self:flex-start">Chercher ses matchs d'invité</button>
            </div>
          </div>
          ${estMoi || p.role === 'admin' ? '' : `
          <button type="button" class="lien-discret lien-danger" data-action="supprimer" data-id="${p.id}">Supprimer définitivement ce compte</button>`}
        </div>
      </details>`;
  }).join('');
}

// ---------- Équipes et capitaines ----------

// Rencontres passées sans score : notification « À scorer » / « À mettre à jour »
async function afficherRetards() {
  const n = await blocRencontresRetard(document.getElementById('rencontres-retard'));
  const c = document.getElementById('nb-rencontres');
  c.textContent = n;
  c.hidden = !n;
}

function afficherEquipes() {
  const actifs = profils.filter((p) => p.status === 'active');
  const creer = `
      <article class="carte-info eq-creer">
        <h2>Nouvelle équipe</h2>
        <div class="eq-creer__ligne">
          <input type="text" id="nouvelle-equipe" maxlength="40" placeholder="Nom de l'équipe (ex. Dolina 3)" aria-label="Nom de la nouvelle équipe">
          <button type="button" class="bouton bouton--plein" data-action="creer-equipe">Créer l'équipe</button>
        </div>
        <small class="match__format">Elle apparaît tout de suite dans Équipes, l'inscription des membres, le classement et le calendrier. Choisissez ensuite son capitaine ci-dessous.</small>
      </article>`;
  listeEquipes.innerHTML = creer + equipes.map((t, i) => {
    const membres = profils.filter((p) => (p.team_members || []).some((m) => m.team_id === t.id && m.status === 'accepted'));
    const attente = profils.filter((p) => (p.team_members || []).some((m) => m.team_id === t.id && m.status === 'pending'));
    const autresCapitaines = new Set(equipes.filter((x) => x.id !== t.id && x.captain_id).map((x) => x.captain_id));
    return `
      <article class="carte-info">
        <div class="cap-bloc-tete"><h2 class="eq-tete__nom">${logoEquipe(t, 'logo-adv--m')}${esc(t.name)}</h2><a class="lien-equipe" href="capitaine.html?equipe=${encodeURIComponent(t.name)}">Espace capitaine →</a></div>
        ${'accueil' in t ? `<label class="fm-case"><input type="checkbox" data-action="accueil-equipe" data-team="${t.id}"${t.accueil === false ? ' checked' : ''}> Équipe de test : ne pas l'afficher sur la page d'accueil</label>` : ''}
        ${'logo' in t ? `<div class="adm-logo-equipe">
          <label class="bouton bouton--petit">${t.logo ? 'Changer le logo' : 'Ajouter un logo'}<input type="file" accept="image/png,image/jpeg,image/webp" data-logo-equipe="${t.id}" hidden></label>
          ${t.logo ? `<button type="button" class="bouton bouton--petit" data-action="retirer-logo-equipe" data-team="${t.id}">Reprendre le logo Dolina</button>` : ''}
          <small class="match__format">Affiché sur sa page Équipes, ses rencontres et ses annonces. Sans logo : celui du Dolina.</small>
        </div>` : ''}
        <label class="champ">Capitaine
          <select data-action="capitaine" data-team="${t.id}">
            <option value="">— Aucun capitaine —</option>
            ${actifs.map((p) => `<option value="${p.id}" ${t.captain_id === p.id ? 'selected' : ''} ${autresCapitaines.has(p.id) ? 'disabled' : ''}>${esc(nomComplet(p))}${autresCapitaines.has(p.id) ? ' (déjà capitaine)' : ''}</option>`).join('')}
          </select>
          <small>Un capitaine ne gère qu'une seule équipe. Il en devient automatiquement membre.</small>
        </label>
        ${'vice_captain_id' in t ? `<label class="champ">Vice-capitaine
          <select data-action="vice" data-team="${t.id}">
            <option value="">— Aucun vice-capitaine —</option>
            ${actifs.filter((p) => p.id !== t.captain_id).map((p) => `<option value="${p.id}" ${t.vice_captain_id === p.id ? 'selected' : ''}>${esc(nomComplet(p))}</option>`).join('')}
          </select>
          <small>Mêmes accès que le capitaine. Le capitaine peut aussi le choisir dans son espace.</small>
        </label>` : ''}
        <div>
          <strong>${membres.length} membre${membres.length > 1 ? 's' : ''}</strong>
          ${membres.length ? `<p class="intro" style="margin:4px 0 0">${membres.map((p) => esc(nomComplet(p))).join(', ')}</p>` : ''}
        </div>
        ${attente.length ? `<p class="statut statut--attente">${attente.length} demande${attente.length > 1 ? 's' : ''} en attente</p>` : ''}
        <details class="eq-gerer">
          <summary>Renommer, ordre, suppression</summary>
          <div class="eq-creer__ligne">
            <input type="text" maxlength="40" value="${esc(t.name)}" data-nom-equipe="${t.id}" aria-label="Nouveau nom de l'équipe">
            <button type="button" class="bouton bouton--petit" data-action="renommer-equipe" data-team="${t.id}">Renommer</button>
          </div>
          <div class="actions">
            <button type="button" class="bouton bouton--petit" data-action="monter-equipe" data-team="${t.id}"${i === 0 ? ' disabled' : ''}>↑ Monter</button>
            <button type="button" class="bouton bouton--petit" data-action="descendre-equipe" data-team="${t.id}"${i === equipes.length - 1 ? ' disabled' : ''}>↓ Descendre</button>
            <button type="button" class="bouton bouton--petit bouton--danger" data-action="supprimer-equipe" data-team="${t.id}">Supprimer l'équipe</button>
          </div>
          <small class="match__format">L'ordre est celui des onglets de la page Équipes et des listes du site.</small>
        </details>
      </article>`;
  }).join('');
}

// ---------- Actions ----------

async function executer(action, el) {
  const id = el.dataset.id;
  const team = el.dataset.team;
  const p = profils.find((x) => x.id === id);
  let res = { error: null };

  switch (action) {
    case 'renommer': {
      const prenom = document.querySelector(`[data-champ="first_name"][data-id="${id}"]`).value.trim();
      const nom = document.querySelector(`[data-champ="last_name"][data-id="${id}"]`).value.trim();
      if (!prenom || !nom) { message(zoneMessage, 'Le prénom et le nom sont obligatoires.'); return; }
      res = await supabase.from('profiles').update({ first_name: prenom, last_name: nom }).eq('id', id);
      break;
    }
    case 'retirer-photo':
      if (!confirm(`Retirer la photo de profil de ${nomComplet(p)} ?`)) return;
      res = await supabase.from('profiles').update({ photo_path: null }).eq('id', id);
      if (!res.error && p.photo_path) await supabase.storage.from(DOSSIER_PHOTOS).remove([p.photo_path]);
      break;
    case 'valider':
      res = await supabase.from('profiles').update({ status: 'active' }).eq('id', id);
      break;
    case 'refuser':
      if (!confirm(`Refuser l'inscription de ${nomComplet(p)} ?`)) return;
      res = await supabase.from('profiles').update({ status: 'refused' }).eq('id', id);
      break;
    case 'statut':
      res = await supabase.from('profiles').update({ status: el.value }).eq('id', id);
      break;
    case 'role':
      if (el.value === 'admin' && !confirm(`Donner les droits d'administrateur à ${nomComplet(p)} ? Il pourra gérer tous les comptes et le contenu du site.`)) {
        el.value = 'member';
        return;
      }
      res = await supabase.from('profiles').update({ role: el.value }).eq('id', id);
      break;
    case 'ajouter-equipe':
      res = await supabase.from('team_members').insert({ team_id: team, profile_id: id, status: 'accepted' });
      break;
    case 'accepter-equipe':
      res = await supabase.from('team_members').update({ status: 'accepted' }).eq('team_id', team).eq('profile_id', id);
      break;
    case 'refuser-equipe':
      res = await supabase.from('team_members').update({ status: 'refused' }).eq('team_id', team).eq('profile_id', id);
      break;
    case 'retirer-equipe':
      if (!confirm(`Retirer ${nomComplet(p)} de l'équipe ${nomEquipe(team)} ?`)) return;
      res = await supabase.from('team_members').delete().eq('team_id', team).eq('profile_id', id);
      break;
    case 'capitaine':
      res = await supabase.from('teams').update({ captain_id: el.value || null }).eq('id', team);
      break;
    case 'creer-equipe': {
      const nom = document.getElementById('nouvelle-equipe').value.trim();
      if (nom.length < 2) { message(zoneMessage, 'Donnez un nom à l\'équipe (2 caractères minimum).'); return; }
      const ordre = Math.max(0, ...equipes.map((x) => x.sort_order || 0)) + 1;
      res = await supabase.from('teams').insert({ name: nom, sort_order: ordre });
      if (!res.error) message(zoneMessage, `Équipe « ${nom} » créée.`, 'ok');
      break;
    }
    case 'renommer-equipe': {
      const nom = document.querySelector(`[data-nom-equipe="${team}"]`).value.trim();
      if (nom.length < 2) { message(zoneMessage, 'Le nom doit compter au moins 2 caractères.'); return; }
      res = await supabase.from('teams').update({ name: nom }).eq('id', team);
      break;
    }
    case 'monter-equipe':
    case 'descendre-equipe': {
      const i = equipes.findIndex((x) => x.id === team);
      const j = action === 'monter-equipe' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= equipes.length) return;
      // Réécrit l'ordre de toutes les équipes (1, 2, 3…) avec les deux échangées
      const liste = [...equipes];
      [liste[i], liste[j]] = [liste[j], liste[i]];
      for (const [k, x] of liste.entries()) {
        res = await supabase.from('teams').update({ sort_order: k + 1 }).eq('id', x.id);
        if (res.error) break;
      }
      break;
    }
    case 'supprimer-equipe': {
      const t = equipes.find((x) => x.id === team);
      const { count } = await supabase.from('rencontres').select('id', { count: 'exact', head: true }).eq('team_id', team);
      const nbMembres = profils.filter((x) => (x.team_members || []).some((m) => m.team_id === team)).length;
      if (!confirm(`Supprimer l'équipe « ${t?.name} » ?\n\n${nbMembres} membre${nbMembres > 1 ? 's' : ''} seront retirés de l'équipe (leurs comptes et leurs parties restent).${count ? `\nSes ${count} rencontre${count > 1 ? 's' : ''} du calendrier seront effacées.` : ''}\n\nCette action est définitive.`)) return;
      if (count && !confirm(`Dernière vérification : effacer aussi les ${count} rencontre${count > 1 ? 's' : ''} et leurs scores ?`)) return;
      res = await supabase.from('teams').delete().eq('id', team);
      if (!res.error) message(zoneMessage, `Équipe « ${t?.name} » supprimée.`, 'ok');
      break;
    }
    case 'ajouter-email': {
      const mail = document.querySelector(`[data-email-nouveau="${id}"]`).value.trim();
      const tel = document.querySelector(`[data-tel-nouveau="${id}"]`).value.trim();
      if (!mail) { message(zoneMessage, 'Indiquez l\'email du membre.'); return; }
      if (!confirm(`Donner l'email ${mail} à ${nomComplet(p)} ?\n\nIl se connectera désormais avec cet email et son mot de passe actuel (ou un mot de passe provisoire). Son identifiant ne servira plus.`)) return;
      res = await supabase.rpc('admin_ajouter_email', { p_user: id, p_email: mail, p_phone: tel || null });
      if (!res.error) message(zoneMessage, `${nomComplet(p)} se connecte maintenant avec ${mail}.${p.compte === 'gere' ? ' Donnez-lui un mot de passe provisoire pour sa première connexion.' : ''}`, 'ok');
      break;
    }
    case 'niveau':
      res = await supabase.rpc('definir_niveau_joueur', { p_profile: id, p_niveau: el.value ? Number(el.value) : null });
      if (!res.error) message(zoneMessage, `Niveau de ${nomComplet(p)} enregistré.`, 'ok');
      break;
    case 'accueil-equipe':
      res = await supabase.from('teams').update({ accueil: !el.checked }).eq('id', team);
      if (!res.error) message(zoneMessage, el.checked ? 'Équipe masquée de la page d\'accueil.' : 'Équipe de nouveau affichée sur la page d\'accueil.', 'ok');
      break;
    case 'retirer-logo-equipe': {
      const t = equipes.find((x) => x.id === team);
      if (!confirm(`Retirer le logo de « ${t?.name} » ? L'équipe reprendra celui du Dolina.`)) return;
      try { await enregistrerLogoEquipe(t, null); res = {}; } catch (err) { res = { error: err }; }
      break;
    }
    case 'vice':
      res = await supabase.rpc('definir_vice_capitaine', { p_team: team, p_profile: el.value || null });
      break;
    case 'supprimer':
      if (!confirm(`Supprimer définitivement le compte de ${nomComplet(p)} ?\n\nSon profil, sa photo et ses parties jouées seul ou contre des invités seront effacés. Dans les parties contre d'autres membres et dans les tournois, il apparaîtra comme « Ancien joueur ». Cette action est irréversible.`)) return;
      res = await supabase.rpc('admin_delete_account', { p_user: id });
      if (!res.error && p.photo_path) await supabase.storage.from(DOSSIER_PHOTOS).remove([p.photo_path]);
      break;
    default:
      return;
  }

  if (res.error) {
    // Code P0001 = message écrit en français dans la base (ex. « garder au moins un administrateur »)
    const doublon = res.error.code === '23505' && /team/.test(res.error.message || '');
    message(zoneMessage, doublon ? 'Une équipe porte déjà ce nom.' : (res.error.code === 'P0001' ? res.error.message : erreurFr(res.error)));
  } else if (!['creer-equipe', 'supprimer-equipe', 'accueil-equipe', 'niveau', 'ajouter-email'].includes(action)) {
    message(zoneMessage, '');
    if (/equipe/.test(action)) document.dispatchEvent(new CustomEvent('dolina:equipes-maj', { detail: { source: 'admin' } }));
  }
  await surPlace(charger);
}

// ---------- Parties d'un membre (suppression par l'admin) ----------

const STATUT_PARTIE = { live: 'En cours', finished: 'Terminée', abandoned: 'Abandonnée' };
const fmtPartie = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

async function afficherPartiesMembre(id) {
  const zone = document.querySelector(`[data-liste-parties="${id}"]`);
  if (!zone) return;
  zone.innerHTML = '<p class="vide">Chargement…</p>';
  const { data, error } = await supabase.from('games')
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, status, winner_side, created_at, finished_at, tournament_match_id, game_players(side, profile_id, display_name, throw_order), moi:game_players!inner(profile_id, side)')
    .eq('moi.profile_id', id).order('created_at', { ascending: false }).limit(100);
  if (error) { zone.innerHTML = `<p class="vide">${esc(erreurFr(error))}</p>`; return; }
  const quand = (g) => new Date(g.finished_at || g.created_at).getTime();
  const parties = (data || []).sort((a, b) => quand(b) - quand(a));
  if (!parties.length) { zone.innerHTML = '<p class="vide">Aucune partie enregistrée.</p>'; return; }
  const { data: fins } = await supabase.from('visits').select('game_id, side').in('game_id', parties.map((g) => g.id)).eq('is_checkout', true);
  const manches = (g, side) => (fins || []).filter((f) => f.game_id === g.id && f.side === side).length;
  const supprimables = parties.filter((g) => !g.tournament_match_id).length;
  zone.innerHTML = `<p class="match__format" style="margin:0">${parties.length} partie${parties.length > 1 ? 's' : ''}${parties.length === 100 ? ' (les 100 plus récentes)' : ''}. Les matchs de tournoi se corrigent depuis la page du tournoi.</p>
    ${supprimables ? `<div class="adm-selection">
      <label class="adm-selection__tout"><input type="checkbox" data-tout-parties="${id}"> Tout sélectionner</label>
      <button type="button" class="bouton bouton--petit bouton--danger" data-partie-action="supprimer-selection" data-id="${id}" disabled>Supprimer la sélection</button>
    </div>` : ''}
    <ul class="adm-parties">${parties.map((g) => {
    const monCamp = g.moi?.[0]?.side;
    const camps = [...new Set(g.game_players.map((x) => x.side))].sort((a, b) => a - b);
    const nomCamp = (c) => g.game_players.filter((x) => x.side === c).sort((a, b) => a.throw_order - b.throw_order).map((x) => x.display_name).join(' / ');
    const adversaires = camps.filter((c) => c !== monCamp).map(nomCamp).join(', ');
    let resultat = STATUT_PARTIE[g.status] || g.status;
    if (g.status === 'finished' && camps.length > 1) resultat = g.winner_side === monCamp ? 'Victoire' : 'Défaite';
    const score = [monCamp, ...camps.filter((c) => c !== monCamp)].map((c) => manches(g, c)).join(' – ');
    return `
      <li class="adm-partie">
        ${g.tournament_match_id ? '<span class="adm-partie__case"></span>' : `<input type="checkbox" class="adm-partie__case" data-choix-partie="${g.id}" aria-label="Sélectionner la partie du ${esc(fmtPartie.format(new Date(g.finished_at || g.created_at)))}">`}
        <div class="adm-partie__texte">
          <strong>${esc(fmtPartie.format(new Date(g.finished_at || g.created_at)))} · ${esc(resultat)}${camps.length > 1 ? ` · ${esc(score)}` : ''}</strong>
          <small>${adversaires ? `contre ${esc(adversaires)}` : 'Seul'} · ${esc(formatPartie(g))}</small>
        </div>
        <span class="adm-partie__actions">
          <a class="bouton bouton--petit" href="live.html?id=${encodeURIComponent(g.id)}">Voir</a>
          ${g.tournament_match_id ? '<span class="t-role">Tournoi</span>'
    : `<button type="button" class="bouton bouton--petit bouton--danger" data-partie-action="supprimer" data-id="${id}" data-partie="${g.id}" data-resume="${esc(`${fmtPartie.format(new Date(g.finished_at || g.created_at))}, ${adversaires ? `contre ${adversaires}` : 'seul'}`)}">Supprimer</button>`}
        </span>
      </li>`;
  }).join('')}</ul>`;
}

// Sélection multiple : cases à cocher + « Tout sélectionner »
function majSelection(zone) {
  const cases = [...zone.querySelectorAll('[data-choix-partie]')];
  const n = cases.filter((c) => c.checked).length;
  const bouton = zone.querySelector('[data-partie-action="supprimer-selection"]');
  if (bouton) {
    bouton.disabled = !n;
    bouton.textContent = n ? `Supprimer la sélection (${n})` : 'Supprimer la sélection';
  }
  const tout = zone.querySelector('[data-tout-parties]');
  if (tout) {
    tout.checked = n > 0 && n === cases.length;
    tout.indeterminate = n > 0 && n < cases.length;
  }
  cases.forEach((c) => c.closest('.adm-partie').classList.toggle('adm-partie--choisie', c.checked));
}
document.addEventListener('change', (e) => {
  const zone = e.target.closest('[data-liste-parties]');
  if (!zone) return;
  if (e.target.matches('[data-tout-parties]')) zone.querySelectorAll('[data-choix-partie]').forEach((c) => { c.checked = e.target.checked; });
  if (e.target.matches('[data-tout-parties], [data-choix-partie]')) majSelection(zone);
});

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-partie-action]');
  if (!b) return;
  if (b.dataset.partieAction === 'voir') return afficherPartiesMembre(b.dataset.id);
  if (b.dataset.partieAction === 'supprimer-selection') {
    const zone = b.closest('[data-liste-parties]');
    const ids = [...zone.querySelectorAll('[data-choix-partie]:checked')].map((c) => c.dataset.choixPartie);
    if (!ids.length) return;
    if (!confirm(`Supprimer définitivement ${ids.length > 1 ? `ces ${ids.length} parties` : 'cette partie'} ?\n\nElles disparaîtront pour tous les joueurs, avec leurs volées : les statistiques et le classement seront recalculés sans elles.`)) return;
    b.disabled = true;
    const { data, error } = await supabase.from('games').delete().in('id', ids).select('id');
    if (error) {
      b.disabled = false;
      return message(zoneMessage, error.code === 'P0001' ? error.message : erreurFr(error));
    }
    const n = data?.length || 0;
    message(zoneMessage, n === ids.length
      ? `${n} partie${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''}.`
      : `${n} partie${n > 1 ? 's' : ''} supprimée${n > 1 ? 's' : ''} sur ${ids.length} : les autres n'ont pas pu l'être.`, n === ids.length ? 'ok' : undefined);
    document.dispatchEvent(new Event('dolina:parties-maj'));
    return afficherPartiesMembre(b.dataset.id);
  }
  if (b.dataset.partieAction === 'supprimer') {
    if (!confirm(`Supprimer définitivement cette partie (${b.dataset.resume}) ?\n\nElle disparaîtra pour tous les joueurs, avec ses volées : leurs statistiques et le classement seront recalculés sans elle.`)) return;
    b.disabled = true;
    const { data, error } = await supabase.from('games').delete().eq('id', b.dataset.partie).select('id');
    if (error || !data?.length) {
      b.disabled = false;
      return message(zoneMessage, error ? (error.code === 'P0001' ? error.message : erreurFr(error)) : 'La partie n\'a pas pu être supprimée.');
    }
    message(zoneMessage, 'Partie supprimée.', 'ok');
    document.dispatchEvent(new Event('dolina:parties-maj'));
    afficherPartiesMembre(b.dataset.id);
  }
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('button[data-action]');
  if (el) executer(el.dataset.action, el);
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('select[data-action], input[type="checkbox"][data-action]');
  if (el) executer(el.dataset.action, el);
});
// Logo d'une équipe (script 055)
document.addEventListener('change', async (e) => {
  const champ = e.target.closest('input[data-logo-equipe]');
  if (!champ?.files?.[0]) return;
  const t = equipes.find((x) => x.id === champ.dataset.logoEquipe);
  message(zoneMessage, 'Envoi du logo…', 'ok');
  try {
    await enregistrerLogoEquipe(t, champ.files[0]);
    message(zoneMessage, `Logo de « ${t.name} » enregistré.`, 'ok');
    charger();
  } catch (err) {
    message(zoneMessage, err.message && !err.code ? err.message : erreurFr(err));
  }
});
document.addEventListener('toggle', (e) => {
  const id = e.target.dataset?.fiche;
  if (!id) return;
  if (e.target.open) ouverts.add(id); else ouverts.delete(id);
}, true);
recherche.addEventListener('input', afficherMembres);
// Une demande d'équipe traitée dans l'onglet Demandes : on met à jour Membres et Équipes
document.addEventListener('dolina:equipes-maj', (e) => { if (e.detail?.source === 'demandes') charger(); });

// ---------- Onglets ----------

// Menu des rubriques : bouton en haut à droite, liste verticale déroulante
const menu = document.getElementById('adm-menu');
const boutonMenu = document.getElementById('adm-menu-bouton');
function ouvrirMenu(ouvert) {
  menu.classList.toggle('adm-menu--ouvert', ouvert);
  boutonMenu.setAttribute('aria-expanded', String(ouvert));
  if (ouvert) menu.querySelector('[aria-selected="true"]')?.focus();
}
boutonMenu.addEventListener('click', () => ouvrirMenu(!menu.classList.contains('adm-menu--ouvert')));
document.addEventListener('click', (e) => { if (!menu.contains(e.target)) ouvrirMenu(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.classList.contains('adm-menu--ouvert')) { ouvrirMenu(false); boutonMenu.focus(); }
});
// Pastille du bouton : total des choses à traiter (inscriptions, demandes, sauvegarde)
function majAlerte() {
  const n = ['nb-attente', 'nb-demandes', 'nb-sauvegarde', 'nb-rencontres'].reduce((t, id) => {
    const c = document.getElementById(id);
    if (!c || c.hidden) return t;
    return t + (Number(c.textContent) || (c.textContent.trim() === '!' ? 1 : 0));
  }, 0);
  const a = document.getElementById('adm-menu-alerte');
  a.textContent = n;
  a.hidden = !n;
  document.querySelectorAll('.adm-menu__item .compteur').forEach((c) => {
    c.closest('.adm-menu__item').classList.toggle('adm-menu__item--alerte', !c.hidden && c.textContent.trim() !== '0');
  });
}
new MutationObserver(majAlerte).observe(document.getElementById('onglets'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });

document.getElementById('onglets').addEventListener('click', (e) => {
  const b = e.target.closest('[data-onglet]');
  if (!b) return;
  document.querySelectorAll('[data-onglet]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  Object.entries(vues).forEach(([nom, v]) => { v.hidden = nom !== b.dataset.onglet; });
  history.replaceState(null, '', `#${b.dataset.onglet}`);
  // Titre de la rubrique affichée, avec son icône
  document.getElementById('adm-titre').innerHTML = `${b.querySelector('svg').outerHTML}<span>${b.querySelector('.adm-menu__texte').textContent}</span>`;
  ouvrirMenu(false);
});

// ---------- Démarrage ----------

async function init() {
  moi = await profilConnecte();
  if (!moi) {
    location.replace('connexion.html');
    return;
  }
  if (moi.role !== 'admin' || moi.status !== 'active') {
    vues.inscriptions.innerHTML = '<p class="vide">Cet espace est réservé aux administrateurs du club.</p>';
    return;
  }
  document.getElementById('adm-barre').hidden = false;
  majAlerte();
  afficherRetards();
  const depart = location.hash.slice(1);
  if (vues[depart]) document.querySelector(`[data-onglet="${depart}"]`).click();
  await Promise.all([charger(), initActus(moi), initDemandes(document.getElementById('message')), initSauvegarde(document.getElementById('message')), initTournois(document.getElementById('message')), initMatchs(document.getElementById('message'))]);
  initExports(document.getElementById('message'));
  initSansEmail({ zoneMessage: document.getElementById('message'), equipes, recharger: charger });
  initRattachementInvites(document.getElementById('message'));
}

init();
