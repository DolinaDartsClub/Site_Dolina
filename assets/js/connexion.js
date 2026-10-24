// =====================================================================
//  Connexion
//  (« Mot de passe oublié ? » ouvre la page mot-de-passe-oublie.html)
// =====================================================================

import { supabase, erreurFr, message, emailConnexion } from './app.js?v=__VERSION__';

const form = document.getElementById('formulaire');
const zoneMessage = document.getElementById('message');
const bouton = document.getElementById('envoyer');
const lienOubli = document.getElementById('oubli');

// Navigateur qui bloque le stockage (Safari « Bloquer tous les cookies ») : la session
// ne peut pas être gardée d'une page à l'autre, on prévient tout de suite
function stockageOk() {
  try { localStorage.setItem('dolina-test', '1'); localStorage.removeItem('dolina-test'); return true; } catch { return false; }
}
if (!stockageOk()) {
  message(zoneMessage, 'Votre navigateur bloque le stockage du site : la connexion ne peut pas être gardée. Sur iPhone ou iPad : Réglages › Safari › désactivez « Bloquer tous les cookies », puis rechargez la page (pas en navigation privée).');
}

// Déjà connecté ? On va directement à « Mon compte »
supabase.auth.getSession().then(({ data: { session } }) => {
  if (session) location.replace('compte.html');
});

// Si un email est déjà saisi, on le transmet à la page « Mot de passe oublié »
lienOubli.addEventListener('click', () => {
  const email = form.email.value.trim();
  if (email && email.includes('@')) lienOubli.href = `mot-de-passe-oublie.html?email=${encodeURIComponent(email)}`;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saisie = form.email.value.trim();
  const email = emailConnexion(saisie);   // « jean.dupont » → compte sans email
  const password = form.password.value;
  if (!saisie || !password) {
    message(zoneMessage, 'Indiquez votre email (ou votre identifiant) et votre mot de passe.');
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Connexion…';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  bouton.disabled = false;
  bouton.textContent = 'Se connecter';

  if (error) {
    message(zoneMessage, !saisie.includes('@') && /invalid login|credentials/i.test(error.message || '')
      ? 'Identifiant ou code incorrect. Code oublié : demandez-en un nouveau à un admin du club.'
      : erreurFr(error));
    return;
  }
  location.replace('compte.html');
});
