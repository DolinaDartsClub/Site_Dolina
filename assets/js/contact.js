// =====================================================================
//  Nous contacter : demande enregistrée sur le site (onglet « Demandes »
//  de l'administration). Accessible sans compte.
// =====================================================================

import { supabase, message, erreurFr } from './app.js?v=__VERSION__';

const form = document.getElementById('form-contact');
const zoneMsg = document.getElementById('message');
let motif = new URLSearchParams(location.search).get('motif') || 'adhesion';
let envoi = false;

// Moyen de contact préféré : seule la coordonnée utile devient obligatoire
const MOYENS = {
  appel: { tel: true, texte: 'Un membre du bureau vous appelle très vite.' },
  sms: { tel: true, texte: 'Vous recevrez très vite un SMS du club.' },
  whatsapp: { tel: true, texte: 'Vous recevrez très vite un message WhatsApp du club.' },
  email: { tel: false, texte: 'Le club vous répond très vite par email.' },
};
let pref = null;
let moment = '';
function majPref() {
  form.querySelectorAll('[data-groupe="pref"] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valeur === pref)));
  const tel = pref ? MOYENS[pref].tel : false;
  document.getElementById('ct-moment').hidden = !pref || !tel;
  document.querySelector('#champ-tel .ct-facultatif').hidden = tel;
  document.querySelector('#champ-email .ct-facultatif').hidden = pref === 'email';
  form.elements.telephone.required = tel;
  form.elements.email.required = pref === 'email';
  // Le champ utile passe en premier
  const t = document.getElementById('champ-tel');
  const m = document.getElementById('champ-email');
  if (pref === 'email') t.before(m); else m.before(t);
}
form.querySelector('[data-groupe="pref"]').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  pref = b.dataset.valeur;
  majPref();
});
form.querySelector('[data-groupe="moment"]').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  moment = b.dataset.valeur;
  form.querySelectorAll('[data-groupe="moment"] button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});
majPref();

function majMotif() {
  form.querySelectorAll('[data-groupe="motif"] button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valeur === motif)));
}
form.querySelector('[data-groupe="motif"]').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  motif = b.dataset.valeur;
  majMotif();
});
majMotif();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (envoi) return;
  const f = form.elements;
  if (f.site.value) return;                       // robot
  const champs = { prenom: f.prenom.value.trim(), nom: f.nom.value.trim(), telephone: f.telephone.value.trim(), email: f.email.value.trim(), message: f.message.value.trim() };
  if (!pref) return message(zoneMsg, 'Choisissez comment vous préférez être recontacté.');
  if (!champs.prenom || !champs.nom) return message(zoneMsg, 'Indiquez votre prénom et votre nom.');
  if ((MOYENS[pref].tel || champs.telephone) && champs.telephone.replace(/\D/g, '').length < 6) return message(zoneMsg, MOYENS[pref].tel ? 'Indiquez votre numéro de téléphone pour être recontacté.' : 'Indiquez un numéro de téléphone valide.');
  if ((pref === 'email' || champs.email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(champs.email)) return message(zoneMsg, pref === 'email' ? 'Indiquez votre adresse email pour recevoir notre réponse.' : 'Indiquez une adresse email valide.');
  if (!f.accord.checked) return message(zoneMsg, 'Cochez la case d\'accord pour que le club puisse vous répondre.');
  envoi = true;
  const bouton = form.querySelector('[type=submit]');
  bouton.disabled = true;
  bouton.textContent = 'Envoi…';
  let { error } = await supabase.rpc('envoyer_demande_contact_v2', {
    p_motif: motif, p_prenom: champs.prenom, p_nom: champs.nom, p_telephone: champs.telephone, p_email: champs.email, p_message: champs.message, p_pref: pref, p_moment: moment,
  });
  // Base pas encore à jour (script 033 non exécuté) : ancienne fonction, préférence notée dans le message
  if (error && (error.code === 'PGRST202' || /envoyer_demande_contact_v2/.test(error.message || ''))) {
    const NOMS = { appel: 'un appel', sms: 'un SMS', whatsapp: 'WhatsApp', email: 'un email' };
    ({ error } = await supabase.rpc('envoyer_demande_contact', {
      p_motif: motif, p_prenom: champs.prenom, p_nom: champs.nom, p_telephone: champs.telephone, p_email: champs.email,
      p_message: `[Préfère être contacté par ${NOMS[pref]}${moment ? `, ${moment}` : ''}]\n${champs.message}`.trim(),
    }));
  }
  envoi = false;
  bouton.disabled = false;
  bouton.textContent = 'Envoyer ma demande';
  if (error) return message(zoneMsg, erreurFr(error));
  form.hidden = true;
  document.getElementById('merci-texte').textContent = MOYENS[pref].texte;
  document.getElementById('merci').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
