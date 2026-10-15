// =====================================================================
//  Connexion et demande de nouveau mot de passe
// =====================================================================

import { supabase, erreurFr, message, BASE_URL } from './app.js';

const form = document.getElementById('formulaire');
const zoneMessage = document.getElementById('message');
const bouton = document.getElementById('envoyer');

// Déjà connecté ? On va directement à « Mon compte »
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) location.replace('compte.html');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = form.email.value.trim().toLowerCase();
  const password = form.password.value;
  if (!email || !password) {
    message(zoneMessage, 'Indiquez votre email et votre mot de passe.');
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Connexion…';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  bouton.disabled = false;
  bouton.textContent = 'Se connecter';

  if (error) {
    message(zoneMessage, erreurFr(error));
    return;
  }
  location.replace('compte.html');
});

document.getElementById('oubli').addEventListener('click', async () => {
  const email = form.email.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    message(zoneMessage, 'Indiquez d\'abord votre email dans le champ ci-dessus, puis cliquez à nouveau sur « Mot de passe oublié ? ».');
    form.email.focus();
    return;
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: BASE_URL + 'mot-de-passe.html',
  });
  if (error) {
    // L'envoi d'emails n'est pas encore en place : on oriente vers un admin
    if (/sending|smtp|email/i.test(error.message || '')) {
      message(zoneMessage, 'L\'envoi d\'emails n\'est pas encore disponible sur le site. Demandez à un admin du club de réinitialiser votre mot de passe, ou écrivez à dolinadartsclub@gmail.com.');
    } else {
      message(zoneMessage, erreurFr(error));
    }
    return;
  }
  // Même message qu'il existe un compte ou non (on ne dévoile pas qui est inscrit)
  message(zoneMessage, `Si un compte existe pour ${email}, un email avec un lien pour choisir un nouveau mot de passe vient d'être envoyé. Pensez à regarder dans les spams.`, 'ok');
});
