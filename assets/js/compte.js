// =====================================================================
//  Mon compte : état du compte, équipes, déconnexion
//  (profil modifiable, photo et suppression du compte : étape 7)
// =====================================================================

import { supabase, esc, profilConnecte } from './app.js';

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
    <p><a href="./">← Retour à l'accueil</a></p>`;
}

boutonDeco.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('./');
});

afficher();
