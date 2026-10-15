// =====================================================================
//  Mot de passe oublié
//  - Emails actifs : envoi d'un lien de réinitialisation.
//  - Emails pas encore actifs : on explique comment contacter le club.
// =====================================================================

import { supabase, esc, erreurFr, message, BASE_URL } from './app.js?v=__VERSION__';
import { EMAILS_ACTIFS, EMAIL_CLUB } from './config.js?v=__VERSION__';

const form = document.getElementById('formulaire');
const zoneMessage = document.getElementById('message');
const bouton = document.getElementById('envoyer');

// Pré-remplit l'email s'il a été saisi sur la page de connexion
const emailUrl = new URLSearchParams(location.search).get('email');
if (emailUrl) form.email.value = emailUrl;

function afficherResultat(texte, contact) {
  form.hidden = true;
  document.getElementById('resultat-texte').textContent = texte;
  document.getElementById('resultat-contact').innerHTML = contact || '';
  document.getElementById('resultat').hidden = false;
}

function blocContact(email) {
  const sujet = encodeURIComponent('Mot de passe oublié – site du club');
  const corps = encodeURIComponent(
    `Bonjour,\n\nJ'ai oublié le mot de passe de mon compte sur le site du club.\nEmail du compte : ${email}\n\nMerci !`
  );
  return `
    <div class="carte-info">
      <h2>Contacter le club</h2>
      <p class="intro">Un admin du club vous donnera un mot de passe provisoire, à changer ensuite dans « Mon compte ».</p>
      <a class="bouton bouton--plein" href="mailto:${EMAIL_CLUB}?subject=${sujet}&body=${corps}">Écrire au club</a>
      <span class="match__format">ou directement à ${esc(EMAIL_CLUB)}, ou auprès d'un membre du bureau à l'entraînement.</span>
    </div>`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = form.email.value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    message(zoneMessage, 'Indiquez une adresse email valide.');
    return;
  }

  // L'envoi d'emails n'est pas encore en place : on oriente vers le club
  if (!EMAILS_ACTIFS) {
    afficherResultat(
      'La réinitialisation par email n\'est pas encore disponible sur le site.',
      blocContact(email)
    );
    return;
  }

  bouton.disabled = true;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: BASE_URL + 'mot-de-passe.html',
  });
  bouton.disabled = false;

  if (error) {
    if (/sending|smtp|email/i.test(error.message || '')) {
      afficherResultat('L\'email n\'a pas pu être envoyé pour le moment.', blocContact(email));
    } else {
      message(zoneMessage, erreurFr(error));
    }
    return;
  }

  // Même message qu'il existe un compte ou non (on ne dévoile pas qui est inscrit)
  afficherResultat(
    `Si un compte existe pour ${email}, un email avec un lien pour choisir un nouveau mot de passe vient d'être envoyé. Pensez à regarder dans les spams.`
  );
});
