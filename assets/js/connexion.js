// =====================================================================
//  Connexion
//  (« Mot de passe oublié ? » ouvre la page mot-de-passe-oublie.html)
// =====================================================================

import { supabase, erreurFr, message } from './app.js?v=__VERSION__';

const form = document.getElementById('formulaire');
const zoneMessage = document.getElementById('message');
const bouton = document.getElementById('envoyer');
const lienOubli = document.getElementById('oubli');

// Déjà connecté ? On va directement à « Mon compte »
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) location.replace('compte.html');
});

// Si un email est déjà saisi, on le transmet à la page « Mot de passe oublié »
lienOubli.addEventListener('click', () => {
  const email = form.email.value.trim();
  if (email) lienOubli.href = `mot-de-passe-oublie.html?email=${encodeURIComponent(email)}`;
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
