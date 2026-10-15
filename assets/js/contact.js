// =====================================================================
//  Nous contacter : demande enregistrée sur le site (onglet « Demandes »
//  de l'administration). Accessible sans compte.
// =====================================================================

import { supabase, message, erreurFr } from './app.js?v=__VERSION__';

const form = document.getElementById('form-contact');
const zoneMsg = document.getElementById('message');
let motif = new URLSearchParams(location.search).get('motif') || 'adhesion';
let envoi = false;

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
  if (!champs.prenom || !champs.nom) return message(zoneMsg, 'Indiquez votre prénom et votre nom.');
  if (champs.telephone.replace(/\D/g, '').length < 6) return message(zoneMsg, 'Indiquez un numéro de téléphone valide.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(champs.email)) return message(zoneMsg, 'Indiquez une adresse email valide.');
  if (!f.accord.checked) return message(zoneMsg, 'Cochez la case d\'accord pour que le club puisse vous répondre.');
  envoi = true;
  const bouton = form.querySelector('[type=submit]');
  bouton.disabled = true;
  bouton.textContent = 'Envoi…';
  const { error } = await supabase.rpc('envoyer_demande_contact', {
    p_motif: motif, p_prenom: champs.prenom, p_nom: champs.nom, p_telephone: champs.telephone, p_email: champs.email, p_message: champs.message,
  });
  envoi = false;
  bouton.disabled = false;
  bouton.textContent = 'Envoyer ma demande';
  if (error) return message(zoneMsg, erreurFr(error));
  form.hidden = true;
  document.getElementById('merci').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
