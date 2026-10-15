// =====================================================================
//  Choix d'un nouveau mot de passe (après le lien reçu par email)
// =====================================================================

import { supabase, erreurFr, message } from './app.js?v=__VERSION__';

const form = document.getElementById('formulaire');
const zoneMessage = document.getElementById('message');
const bouton = document.getElementById('envoyer');

// Le lien de l'email ouvre une session temporaire ; sans elle, rien à faire ici
setTimeout(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    message(zoneMessage, 'Ce lien n\'est plus valide ou a déjà servi. Refaites une demande depuis la page de connexion, avec « Mot de passe oublié ? ».');
    bouton.disabled = true;
  }
}, 600);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (form.password.value.length < 8) {
    message(zoneMessage, 'Le mot de passe doit contenir au moins 8 caractères.');
    return;
  }
  if (form.password.value !== form.password2.value) {
    message(zoneMessage, 'Les deux mots de passe ne sont pas identiques.');
    return;
  }
  bouton.disabled = true;
  const { error } = await supabase.auth.updateUser({ password: form.password.value });
  bouton.disabled = false;
  if (error) {
    message(zoneMessage, erreurFr(error));
    return;
  }
  message(zoneMessage, 'Mot de passe enregistré. Redirection vers votre compte…', 'ok');
  setTimeout(() => location.replace('compte.html'), 1500);
});
