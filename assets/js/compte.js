// =====================================================================
//  Mon compte : état du compte, équipes, déconnexion
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
  refused: ['statut--refus', 'Refusé'],
};

async function afficher() {
  // Laisse le temps à la session venue d'un lien email d'être enregistrée
  await new Promise((r) => setTimeout(r, 300));
  const profil = await profilConnecte();
  if (!profil) {
    location.replace('connexion.html');
    return;
  }
  boutonDeco.hidden = false;

  const { data: equipes } = await supabase
    .from('team_members')
    .select('status, teams(name)')
    .eq('profile_id', profil.id);

  const [classe, libelle] = STATUTS[profil.status] || STATUTS.pending;
  const nom = profil.first_name ? `${profil.first_name} ${profil.last_name}` : profil.email;

  let explication = '';
  if (profil.status === 'pending') {
    explication = '<p class="intro">Votre email est confirmé. Un admin du club doit maintenant valider votre compte ; vous recevrez un email dès que c\'est fait.</p>';
  } else if (profil.status === 'refused') {
    explication = '<p class="intro">Votre inscription n\'a pas été acceptée. Pour toute question, écrivez à <a href="mailto:dolinadartsclub@gmail.com">dolinadartsclub@gmail.com</a>.</p>';
  }

  const listeEquipes = (equipes || []).length
    ? equipes.map((e) => {
        const [c, l] = STATUTS_EQUIPE[e.status] || STATUTS_EQUIPE.pending;
        return `<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap">
                  <strong>${esc(e.teams?.name)}</strong><span class="statut ${c}">${l}</span></div>`;
      }).join('')
    : '<p class="intro">Aucune équipe : vous avez accès à tout le site, sauf aux espaces équipe.</p>';

  zone.innerHTML = `
    <h1>Mon compte</h1>
    <div class="carte-info">
      <h2>${esc(nom)}${profil.nickname ? ` « ${esc(profil.nickname)} »` : ''}</h2>
      <span class="match__format">${esc(profil.email)}</span>
      <span class="statut ${classe}">${libelle}</span>
      ${profil.role === 'admin' && profil.status === 'active' ? '<span class="statut statut--ok">Administrateur</span>' : ''}
      ${explication}
    </div>
    <div class="carte-info">
      <h2>Mes équipes</h2>
      ${listeEquipes}
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

  brancherChangementMotDePasse(profil.email);
}

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

afficher();
