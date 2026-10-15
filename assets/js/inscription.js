// =====================================================================
//  Inscription d'un joueur
//  Le compte est créé « en attente » ; un admin le valide ensuite,
//  puis le capitaine de chaque équipe choisie valide l'intégration.
// =====================================================================

import { supabase, esc, erreurFr, message, BASE_URL } from './app.js?v=__VERSION__';

const form = document.getElementById('formulaire');
const zoneMessage = document.getElementById('message');
const zoneEquipes = document.getElementById('equipes');
const bouton = document.getElementById('envoyer');

// ---------- Liste des équipes ----------

async function chargerEquipes() {
  const { data, error } = await supabase.from('teams').select('id, name').order('sort_order');
  if (error) {
    zoneEquipes.innerHTML = '<span class="champ"><small>Impossible de charger les équipes. Rechargez la page.</small></span>';
    return;
  }
  zoneEquipes.innerHTML =
    data.map((t) => `<label class="case"><input type="checkbox" name="team" value="${esc(t.id)}">${esc(t.name)}</label>`).join('') +
    '<label class="case"><input type="checkbox" name="no_team" value="1">Aucune équipe</label>';

  // « Aucune équipe » et une équipe ne peuvent pas être cochées ensemble
  zoneEquipes.addEventListener('change', (e) => {
    if (e.target.name === 'no_team' && e.target.checked) {
      zoneEquipes.querySelectorAll('input[name="team"]').forEach((c) => { c.checked = false; });
    } else if (e.target.name === 'team' && e.target.checked) {
      zoneEquipes.querySelector('input[name="no_team"]').checked = false;
    }
  });
}

// ---------- Envoi ----------

function verifier(f) {
  if (!f.last_name.value.trim() || !f.first_name.value.trim()) return 'Indiquez votre nom et votre prénom.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) return 'Indiquez une adresse email valide.';
  if (f.phone.value.replace(/[^0-9]/g, '').length < 9) return 'Indiquez un numéro de téléphone valide.';
  if (f.password.value.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
  const equipes = f.querySelectorAll('input[name="team"]:checked').length;
  const aucune = f.querySelector('input[name="no_team"]')?.checked;
  if (!equipes && !aucune) return 'Choisissez votre ou vos équipes, ou « Aucune équipe ».';
  if (!f.privacy.checked) return 'Vous devez accepter la politique de confidentialité.';
  return null;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const probleme = verifier(form);
  if (probleme) {
    message(zoneMessage, probleme);
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Envoi en cours…';
  message(zoneMessage, '');

  const email = f.email.value.trim().toLowerCase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: f.password.value,
    options: {
      emailRedirectTo: BASE_URL + 'compte.html',
      // Ces informations servent à créer le profil (voir la base de données)
      data: {
        first_name: f.first_name.value.trim(),
        last_name: f.last_name.value.trim(),
        phone: f.phone.value.trim(),
        nickname: f.nickname.value.trim(),
        hand: f.hand.value,
        dart_weight: f.dart_weight.value.replace(',', '.'),
        dart_brand: f.dart_brand.value.trim(),
        photo_consent: f.photo_consent.checked,
        teams: [...form.querySelectorAll('input[name="team"]:checked')].map((c) => c.value),
      },
    },
  });

  bouton.disabled = false;
  bouton.textContent = 'Envoyer ma demande';

  if (error) {
    message(zoneMessage, erreurFr(error));
    return;
  }

  // Si la confirmation par email est désactivée dans Supabase,
  // le compte est connecté tout de suite : on va directement à « Mon compte »
  if (data?.session) {
    location.replace('compte.html');
    return;
  }

  document.getElementById('merci-email').textContent = email;
  form.hidden = true;
  document.getElementById('merci').hidden = false;
  window.scrollTo({ top: 0 });
});

chargerEquipes();
