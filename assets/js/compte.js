// =====================================================================
//  Mon compte : état du compte, équipes, espace capitaine, accès admin,
//  changement de mot de passe, déconnexion
//  (profil modifiable, photo et suppression du compte : étape 7)
// =====================================================================

import { supabase, esc, profilConnecte, message, erreurFr } from './app.js';

const zone = document.getElementById('contenu');
const boutonDeco = document.getElementById('deconnexion');

const STATUTS = {
  pending: ['statut--attente', 'En attente de validation par un admin'],
  active: ['statut--ok', 'Compte validé'],
  refused: ['statut--refus', 'Inscription refusée'],
};
const STATUTS_EQUIPE = {
  pending: ['statut--attente', 'En attente du capitaine'],
  accepted: ['statut--ok', 'Membre de l\'équipe'],
  refused: ['statut--refus', 'Demande refusée'],
};

let profil = null;
let messageGeneral = null;

async function afficher() {
  profil = await profilConnecte();
  if (!profil) {
    location.replace('connexion.html');
    return;
  }
  boutonDeco.hidden = false;
  const estActif = profil.status === 'active';
  const estAdmin = estActif && profil.role === 'admin';

  // Équipes du club et mes rattachements
  const [{ data: equipes }, { data: mesRattachements }] = await Promise.all([
    supabase.from('teams').select('id, name, captain_id').order('sort_order'),
    supabase.from('team_members').select('team_id, status').eq('profile_id', profil.id),
  ]);

  // Espace capitaine : demandes en attente pour mon équipe
  const monEquipe = (equipes || []).find((t) => t.captain_id === profil.id && estActif);
  let demandes = [];
  if (monEquipe) {
    const { data } = await supabase
      .from('team_members')
      .select('profile_id, status, requested_at, profiles!team_members_profile_id_fkey(first_name, last_name, nickname, status)')
      .eq('team_id', monEquipe.id)
      .eq('status', 'pending')
      .order('requested_at');
    demandes = data || [];
  }

  // Admin : nombre d'inscriptions à valider
  let nbAttente = 0;
  if (estAdmin) {
    const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    nbAttente = count || 0;
  }

  const [classe, libelle] = STATUTS[profil.status] || STATUTS.pending;
  const nom = profil.first_name ? `${profil.first_name} ${profil.last_name}` : profil.email;

  let explication = '';
  if (profil.status === 'pending') {
    explication = '<p class="intro">Votre demande est enregistrée. Un admin du club doit maintenant valider votre compte. Revenez sur cette page pour suivre son avancement.</p>';
  } else if (profil.status === 'refused') {
    explication = '<p class="intro">Votre inscription n\'a pas été acceptée. Pour toute question, écrivez à <a href="mailto:dolinadartsclub@gmail.com">dolinadartsclub@gmail.com</a>.</p>';
  }

  // ----- Bloc admin -----
  const blocAdmin = estAdmin ? `
    <div class="alerte">
      <span>${nbAttente
        ? `<strong>${nbAttente} inscription${nbAttente > 1 ? 's' : ''}</strong> en attente de validation`
        : 'Aucune inscription en attente'}</span>
      <a class="bouton bouton--plein" href="admin.html">Espace admin</a>
    </div>` : '';

  // ----- Bloc capitaine -----
  const blocCapitaine = monEquipe ? `
    <div class="carte-info">
      <h2>Capitaine · ${esc(monEquipe.name)}</h2>
      ${demandes.length ? demandes.map((d) => {
        const p = d.profiles || {};
        const valide = p.status === 'active';
        return `
          <div class="ligne-equipe">
            <span class="ligne-equipe__nom">${esc(p.first_name)} ${esc(p.last_name)}${p.nickname ? ` « ${esc(p.nickname)} »` : ''}</span>
            ${valide ? '<span class="statut statut--attente">Veut intégrer l\'équipe</span>' : '<span class="statut statut--attente">Compte pas encore validé</span>'}
            <span class="ligne-equipe__actions">
              <button type="button" class="bouton bouton--petit bouton--plein" data-action="cap-accepter" data-id="${d.profile_id}" ${valide ? '' : 'disabled title="Un admin doit d\'abord valider ce compte"'}>Accepter</button>
              <button type="button" class="bouton bouton--petit bouton--danger" data-action="cap-refuser" data-id="${d.profile_id}">Refuser</button>
            </span>
          </div>`;
      }).join('') : '<p class="intro">Aucune demande en attente pour votre équipe.</p>'}
    </div>` : '';

  // ----- Mes équipes -----
  const lignesEquipes = (equipes || []).map((t) => {
    const m = (mesRattachements || []).find((x) => x.team_id === t.id);
    const capitaine = t.captain_id === profil.id;
    let action = '';
    if (!m) action = `<button type="button" class="bouton bouton--petit" data-action="rejoindre" data-team="${t.id}">Demander à rejoindre</button>`;
    else if (m.status === 'pending') action = `<button type="button" class="bouton bouton--petit bouton--danger" data-action="annuler" data-team="${t.id}">Annuler la demande</button>`;
    else if (m.status === 'refused') action = `<button type="button" class="bouton bouton--petit" data-action="redemander" data-team="${t.id}">Refaire une demande</button>`;
    else if (!capitaine) action = `<button type="button" class="bouton bouton--petit bouton--danger" data-action="quitter" data-team="${t.id}" data-nom="${esc(t.name)}">Quitter l'équipe</button>`;
    const [c, l] = m ? STATUTS_EQUIPE[m.status] : [null, null];
    return `
      <div class="ligne-equipe">
        <span class="ligne-equipe__nom">${esc(t.name)}${capitaine ? ' <span class="statut statut--ok">Capitaine</span>' : ''}</span>
        ${m ? `<span class="statut ${c}">${l}</span>` : '<span class="match__format">—</span>'}
        <span class="ligne-equipe__actions">${action}</span>
      </div>`;
  }).join('');
  const aucuneEquipe = !(mesRattachements || []).some((m) => m.status === 'accepted');

  zone.innerHTML = `
    <h1>Mon compte</h1>
    <div class="message" id="message-general" role="alert" hidden></div>
    ${blocAdmin}
    <div class="carte-info">
      <h2>${esc(nom)}${profil.nickname ? ` « ${esc(profil.nickname)} »` : ''}</h2>
      <span class="match__format">${esc(profil.email)}</span>
      <span class="statut ${classe}">${libelle}</span>
      ${estAdmin ? '<span class="statut statut--ok">Administrateur</span>' : ''}
      ${explication}
    </div>
    ${blocCapitaine}
    <div class="carte-info">
      <h2>Mes équipes</h2>
      ${aucuneEquipe ? '<p class="intro" style="margin:0">Sans équipe, vous avez accès à tout le site sauf aux espaces équipe. Vous pouvez demander à rejoindre une équipe : son capitaine validera.</p>' : ''}
      ${lignesEquipes}
    </div>
    <details class="carte-info repli" id="bloc-mdp">
      <summary>Changer mon mot de passe</summary>
      <form class="repli__contenu" id="form-mdp" novalidate>
        <div class="message" id="message-mdp" role="alert" hidden></div>
        <label class="champ">Mot de passe actuel<input name="actuel" type="password" autocomplete="current-password" required></label>
        <label class="champ">Nouveau mot de passe<input name="nouveau" type="password" autocomplete="new-password" minlength="8" required>
          <small>8 caractères minimum.</small></label>
        <label class="champ">Confirmer le nouveau mot de passe<input name="nouveau2" type="password" autocomplete="new-password" required></label>
        <button class="bouton bouton--plein" type="submit">Enregistrer le nouveau mot de passe</button>
      </form>
    </details>
    <p><a href="./">← Retour à l'accueil</a></p>`;

  messageGeneral = document.getElementById('message-general');
  brancherChangementMotDePasse(profil.email);
}

// ---------- Actions : équipes et capitaine ----------

zone.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b) return;
  const team = b.dataset.team;
  const id = b.dataset.id;
  let res = { error: null };
  b.disabled = true;

  switch (b.dataset.action) {
    case 'rejoindre':
      res = await supabase.from('team_members').insert({ team_id: team, profile_id: profil.id });
      break;
    case 'annuler':
      res = await supabase.from('team_members').delete().eq('team_id', team).eq('profile_id', profil.id);
      break;
    case 'redemander':
      // Une demande refusée est supprimée, puis refaite
      res = await supabase.from('team_members').delete().eq('team_id', team).eq('profile_id', profil.id);
      if (!res.error) res = await supabase.from('team_members').insert({ team_id: team, profile_id: profil.id });
      break;
    case 'quitter':
      if (!confirm(`Quitter l'équipe ${b.dataset.nom} ?`)) { b.disabled = false; return; }
      res = await supabase.from('team_members').delete().eq('team_id', team).eq('profile_id', profil.id);
      break;
    case 'cap-accepter':
    case 'cap-refuser': {
      const equipe = (await supabase.from('teams').select('id').eq('captain_id', profil.id).maybeSingle()).data;
      res = await supabase.from('team_members')
        .update({ status: b.dataset.action === 'cap-accepter' ? 'accepted' : 'refused' })
        .eq('team_id', equipe?.id).eq('profile_id', id);
      break;
    }
    default:
      return;
  }

  if (res.error) {
    b.disabled = false;
    message(messageGeneral, res.error.code === 'P0001' ? res.error.message : erreurFr(res.error));
    return;
  }
  await afficher();
});

// ---------- Changement du mot de passe (connecté) ----------

function brancherChangementMotDePasse(email) {
  const form = document.getElementById('form-mdp');
  const zoneMsg = document.getElementById('message-mdp');
  const bouton = form.querySelector('button');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { actuel, nouveau, nouveau2 } = form.elements;
    if (!actuel.value) return message(zoneMsg, 'Indiquez votre mot de passe actuel.');
    if (nouveau.value.length < 8) return message(zoneMsg, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
    if (nouveau.value !== nouveau2.value) return message(zoneMsg, 'Les deux nouveaux mots de passe ne sont pas identiques.');

    bouton.disabled = true;
    // On vérifie d'abord le mot de passe actuel (sécurité si le téléphone est resté ouvert)
    const verif = await supabase.auth.signInWithPassword({ email, password: actuel.value });
    if (verif.error) {
      bouton.disabled = false;
      return message(zoneMsg, 'Mot de passe actuel incorrect.');
    }
    const { error } = await supabase.auth.updateUser({ password: nouveau.value });
    bouton.disabled = false;
    if (error) return message(zoneMsg, erreurFr(error));

    form.reset();
    message(zoneMsg, 'Mot de passe modifié. Utilisez-le dès votre prochaine connexion.', 'ok');
  });
}

boutonDeco.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('./');
});

// Laisse le temps à une session venue d'un lien email d'être enregistrée
setTimeout(afficher, 300);
