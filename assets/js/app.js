// =====================================================================
//  Outils communs à toutes les pages
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js?v=__VERSION__';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Échappe un texte avant de l'insérer dans la page (évite toute injection HTML)
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
export function dateFr(iso) {
  return iso ? fmtDate.format(new Date(iso)) : '';
}

// Libellé du format d'une partie, ex. « 501 · au meilleur de 3 manches »
export function formatPartie(g) {
  const jeu = g.variant === 'libre' ? `Score libre ${g.start_score}` : g.variant;
  const kind = (k) => (k === 'first_to' ? 'premier à' : 'au meilleur de');
  const legs = `${kind(g.legs_kind)} ${g.legs_n} manche${g.legs_n > 1 ? 's' : ''}`;
  const sets = g.sets_n ? `${kind(g.sets_kind)} ${g.sets_n} sets, ` : '';
  const mode = g.mode === 'double' ? ' · double 2v2' : '';
  return `${jeu}${mode} · ${sets}${legs}`;
}

// Calcule l'état d'une partie X01 à partir de ses volées
// (reste de chaque camp, manches et sets gagnés, camp au lancer)
export function etatPartie(game, sides, visits) {
  const ordre = [...visits].sort((a, b) =>
    a.set_no - b.set_no || a.leg_no - b.leg_no || a.visit_no - b.visit_no || a.id - b.id);
  const camps = sides.map((s) => s.side);
  const etat = {
    reste: Object.fromEntries(camps.map((c) => [c, game.start_score])),
    manches: Object.fromEntries(camps.map((c) => [c, 0])),
    sets: Object.fromEntries(camps.map((c) => [c, 0])),
    setCourant: 1,
    mancheCourante: 1,
    dernier: null,
  };
  let set = 1;
  let leg = 1;
  for (const v of ordre) {
    if (v.set_no !== set) {
      // Nouveau set : le camp qui a le plus de manches remporte le set précédent
      const gagnant = camps.reduce((a, b) => (etat.manches[b] > etat.manches[a] ? b : a), camps[0]);
      etat.sets[gagnant] += 1;
      for (const c of camps) etat.manches[c] = 0;
    }
    if (v.set_no !== set || v.leg_no !== leg) {
      set = v.set_no;
      leg = v.leg_no;
      for (const c of camps) etat.reste[c] = game.start_score;
    }
    if (!v.is_bust) etat.reste[v.side] = v.remaining_before - v.score;
    if (v.is_checkout) {
      etat.manches[v.side] += 1;
      for (const c of camps) etat.reste[c] = game.start_score;
    }
    etat.dernier = v;
  }
  etat.setCourant = set;
  etat.mancheCourante = leg;
  return etat;
}

// Adresse publique d'une image d'actualité stockée dans Supabase
export function urlImage(chemin) {
  return chemin ? `${SUPABASE_URL}/storage/v1/object/public/public-images/${chemin}` : '';
}

// Adresse de base du site (sert aux liens envoyés par email)
export const BASE_URL = new URL('./', location.href).href;

// Traduit en français les messages d'erreur les plus courants de Supabase
export function erreurFr(error) {
  const m = (error && (error.message || error.error_description)) || '';
  if (/already registered|already been registered|already exists/i.test(m)) return 'Un compte existe déjà avec cet email. Utilisez « Se connecter » ou « Mot de passe oublié ».';
  if (/invalid login credentials/i.test(m)) return 'Email ou mot de passe incorrect.';
  if (/email not confirmed/i.test(m)) return 'Votre email n\'est pas encore confirmé. Cliquez sur le lien reçu par email (pensez à regarder dans les spams).';
  if (/password should be at least|weak password/i.test(m)) return 'Mot de passe trop court ou trop simple : 8 caractères minimum.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Trop de tentatives en peu de temps. Réessayez dans quelques minutes.';
  if (/invalid email|unable to validate email/i.test(m)) return 'Adresse email invalide.';
  if (/same password|different from the old/i.test(m)) return 'Le nouveau mot de passe doit être différent de l\'ancien.';
  if (/sending|smtp|email/i.test(m) && /error|fail/i.test(m)) return `L'email n'a pas pu être envoyé. Réessayez plus tard ou prévenez le club. (Détail : ${m})`;
  if (/database error/i.test(m)) return `Le compte n'a pas pu être enregistré. Prévenez le club. (Détail : ${m})`;
  if (/fetch|network/i.test(m)) return 'Connexion internet indisponible. Réessayez.';
  return `Une erreur est survenue. Réessayez dans un instant.${m ? ` (Détail : ${m})` : ''}`;
}

// Affiche un message dans une zone (classe message--erreur ou message--ok)
export function message(zone, texte, type = 'erreur') {
  zone.hidden = !texte;
  zone.className = `message message--${type}`;
  zone.textContent = texte || '';
  if (texte) zone.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// Profil de la personne connectée (null si personne n'est connecté)
export async function profilConnecte() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, nickname, status, role')
    .eq('id', session.user.id)
    .maybeSingle();
  return data ? { ...data, email: session.user.email } : { id: session.user.id, email: session.user.email, status: 'pending' };
}

// Bouton « œil » sur chaque champ de mot de passe, pour afficher ou masquer la saisie
const OEIL_OUVERT = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const OEIL_BARRE = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';

function ajouterOeils(racine) {
  racine.querySelectorAll('input[type="password"]:not([data-oeil])').forEach((champ) => {
    champ.dataset.oeil = '1';
    const enveloppe = document.createElement('span');
    enveloppe.className = 'mdp';
    champ.parentNode.insertBefore(enveloppe, champ);
    enveloppe.appendChild(champ);

    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.className = 'mdp__oeil';
    bouton.setAttribute('aria-label', 'Afficher le mot de passe');
    bouton.innerHTML = OEIL_OUVERT;
    bouton.addEventListener('click', () => {
      const visible = champ.type === 'text';
      champ.type = visible ? 'password' : 'text';
      bouton.innerHTML = visible ? OEIL_OUVERT : OEIL_BARRE;
      bouton.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
    });
    enveloppe.appendChild(bouton);
  });
}
ajouterOeils(document);
// Les formulaires ajoutés plus tard (ex. « Mon compte ») reçoivent aussi l'œil
new MutationObserver(() => ajouterOeils(document)).observe(document.body, { childList: true, subtree: true });

// Bouton « Accueil » bien visible dans l'en-tête de toutes les pages, sauf l'accueil
function ajouterBoutonAccueil() {
  const entete = document.querySelector('.entete');
  const surAccueil = /\/(index\.html)?$/.test(location.pathname);
  if (!entete || surAccueil || entete.querySelector('.bouton--accueil')) return;
  const lien = document.createElement('a');
  lien.href = './';
  lien.className = 'bouton bouton--plein bouton--accueil';
  lien.setAttribute('aria-label', 'Retour à l\'accueil du site');
  lien.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/></svg><span>Accueil</span>';
  // Bouton « page précédente » (flèche seule), juste avant le bouton Accueil
  const retour = document.createElement('button');
  retour.type = 'button';
  retour.className = 'bouton bouton--icone bouton--retour';
  retour.setAttribute('aria-label', 'Revenir à la page précédente');
  retour.title = 'Page précédente';
  retour.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>';
  retour.addEventListener('click', () => {
    // Page précédente du site si elle existe, sinon l'accueil
    const vientDuSite = document.referrer && new URL(document.referrer).origin === location.origin;
    if (vientDuSite && history.length > 1) history.back();
    else location.href = './';
  });

  const marque = entete.querySelector('.entete__marque');
  if (marque) marque.after(retour, lien); else entete.prepend(retour, lien);
}
ajouterBoutonAccueil();

// En-tête : « Connexion » devient « Mon compte » quand on est connecté
async function brancherEntete() {
  const lien = document.getElementById('lien-compte');
  if (!lien) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    lien.textContent = 'Mon compte';
    lien.href = 'compte.html';
  }
}
brancherEntete();

// Enregistre le service worker (installation du site comme une appli)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
