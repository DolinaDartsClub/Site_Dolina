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

// Demande à un admin (script 038) : arrive dans Espace admin › Demandes
function afficherDemande(compte, identifiant) {
  form.hidden = true;
  const zone = document.getElementById('resultat');
  document.getElementById('resultat-texte').hidden = true;
  document.getElementById('resultat-contact').innerHTML = `
    <form class="mdp-demande" id="form-demande" novalidate>
      <p class="intro">Un admin du club vous envoie un <strong>mot de passe provisoire</strong>, que vous changerez ensuite dans « Mon compte ». Comment préférez-vous le recevoir ?</p>
      <div class="message" id="message-demande" role="alert" hidden></div>
      <div class="deux-colonnes">
        <label class="champ">Prénom<input name="prenom" maxlength="60" autocomplete="given-name" required></label>
        <label class="champ">Nom<input name="nom" maxlength="60" autocomplete="family-name" required></label>
      </div>
      <fieldset class="bloc-choix"><legend>Recevoir le mot de passe par</legend>
        <div class="pastilles" id="mdp-pref">
          ${[['whatsapp', 'WhatsApp'], ['sms', 'SMS'], ['appel', 'Appel'], ...(identifiant ? [] : [['email', 'Email']])].map(([v, l], i) => `<button type="button" class="pastille-choix" data-pref="${v}" aria-pressed="${i === 0}">${l}</button>`).join('')}
        </div>
      </fieldset>
      <label class="champ" id="mdp-champ-tel">Téléphone<input name="telephone" type="tel" inputmode="tel" autocomplete="tel" maxlength="30"></label>
      <button class="bouton bouton--plein bouton--large" type="submit">Prévenir un admin</button>
    </form>`;
  zone.hidden = false;
  const f = document.getElementById('form-demande');
  let pref = 'whatsapp';
  f.querySelector('#mdp-pref').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pref]');
    if (!b) return;
    pref = b.dataset.pref;
    f.querySelectorAll('[data-pref]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    f.querySelector('#mdp-champ-tel').hidden = pref === 'email';
  });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const zm = document.getElementById('message-demande');
    const bt = f.querySelector('[type=submit]');
    bt.disabled = true;
    const { error } = await supabase.rpc('envoyer_demande_contact_v2', {
      p_motif: 'mot_de_passe', p_prenom: f.prenom.value, p_nom: f.nom.value,
      p_telephone: pref === 'email' ? '' : f.telephone.value, p_email: identifiant ? '' : compte,
      p_message: `Compte : ${compte}`, p_pref: pref, p_moment: '',
    });
    bt.disabled = false;
    if (error) {
      // Script 038 pas encore lancé : on garde l'ancien moyen (écrire au club)
      if (/objet de votre demande|contact_requests_motif/i.test(error.message || '')) {
        document.getElementById('resultat-contact').innerHTML = blocContact(compte);
        return;
      }
      message(zm, error.code === 'P0001' ? error.message : erreurFr(error));
      return;
    }
    const t = document.getElementById('resultat-texte');
    t.hidden = false;
    t.textContent = `C'est envoyé. Un admin du club vous recontacte ${{ whatsapp: 'sur WhatsApp', sms: 'par SMS', appel: 'par téléphone', email: 'par email' }[pref]} avec un mot de passe provisoire.`;
    document.getElementById('resultat-contact').innerHTML = '';
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = form.email.value.trim().toLowerCase();
  if (!email) { message(zoneMessage, 'Indiquez l\'email ou l\'identifiant de votre compte.'); return; }
  const identifiant = !email.includes('@');
  if (!identifiant && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    message(zoneMessage, 'Indiquez une adresse email valide.');
    return;
  }

  // Pas d'envoi d'email (ou compte avec identifiant) : on prévient un admin, qui donne un mot de passe provisoire
  if (!EMAILS_ACTIFS || identifiant) {
    afficherDemande(email, identifiant);
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
