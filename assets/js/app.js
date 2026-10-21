// =====================================================================
//  Outils communs à toutes les pages
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js?v=__VERSION__';
import { calculerEtat } from './x01.js?v=__VERSION__';

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
  const mode = g.mode === 'double' ? ' · double 2v2' : (g.mode === 'bot' ? ' · contre le dartbot' : '');
  return `${jeu}${mode} · ${sets}${legs}`;
}


// Rencontres de championnat passées sans score (pour l'admin et les capitaines) :
// date dépassée → « À scorer » ; période dépassée sans date fixée → « À mettre à jour »
export async function rencontresEnRetard(equipe = null) {
  const auj = new Date().toLocaleDateString('fr-CA');
  let q = supabase.from('rencontres').select('id, team_id, date_match, date_fin, journee, adversaire, domicile, teams(name)')
    .is('score_nous', null).lt('date_match', auj).order('date_match').limit(200);
  if (equipe) q = q.eq('team_id', equipe);
  const { data, error } = await q;
  if (error) return [];
  return (data || []).filter((r) => (r.date_fin || r.date_match) < auj).map((r) => ({
    ...r,
    etat: r.date_fin && r.date_fin !== r.date_match ? 'maj' : 'score',
  }));
}
export const ETATS_RETARD = { score: 'À scorer', maj: 'À mettre à jour' };

// Calcule l'état d'une partie X01 à partir de ses volées
// (reste de chaque camp, manches et sets gagnés, camp au lancer)
export function etatPartie(game, sides, visits) {
  const ordre = [...visits].sort((a, b) => a.id - b.id);
  const e = calculerEtat(game, sides.map((s) => s.side), ordre);
  return {
    reste: e.reste,
    manches: e.manches,
    sets: e.sets,
    setCourant: e.set,
    mancheCourante: e.manche,
    auLancer: e.auLancer,
    debutManche: e.debutManche,
    gagnant: e.gagnant,
    historique: e.historique,
    stats: e.stats,
  };
}

// Nom affiché sur le site : le surnom si le joueur l'a choisi, sinon « Prénom Nom »
export function nomAffiche(p) {
  if (!p) return '';
  return p.use_nickname && p.nickname?.trim() ? p.nickname.trim() : `${p.first_name} ${p.last_name}`;
}

// Nom complet « Prénom Surnom Nom » (ex. Tony Big Tonz Al Kassis), sur la fiche du joueur
export function nomComplet(p) {
  if (!p) return '';
  return [p.first_name, p.nickname?.trim(), p.last_name].filter(Boolean).join(' ');
}

// Même chose en HTML, avec le surnom mis en valeur
export function nomCompletHtml(p) {
  if (!p) return '';
  const surnom = p.nickname?.trim() ? ` <span class="surnom">${esc(p.nickname.trim())}</span>` : '';
  return `${esc(p.first_name)}${surnom} ${esc(p.last_name)}`;
}

// Capitaine ou vice-capitaine (script 036 : mêmes accès) de cette équipe
export const estCapitaineDe = (t, uid) => !!uid && !!t && (t.captain_id === uid || t.vice_captain_id === uid);

// ---------- Comptes sans email (script 035) ----------
// Supabase exige un email : ces comptes ont une adresse interne qui ne reçoit rien
export const DOMAINE_IDENTIFIANT = 'identifiant.dolina.invalid';
export function identifiantDe(email) {
  const m = String(email || '').toLowerCase().match(/^(.+)@identifiant\.dolina\.invalid$/);
  return m ? m[1] : null;
}
// Saisie de connexion : un email, ou un identifiant (sans @)
export function emailConnexion(saisie) {
  const s = String(saisie || '').trim().toLowerCase();
  return s.includes('@') ? s : `${s}@${DOMAINE_IDENTIFIANT}`;
}
// Email à afficher : rien pour une adresse interne
export const emailVisible = (email) => (identifiantDe(email) ? '' : (email || ''));

// Adresse publique d'une image d'actualité stockée dans Supabase
export function urlImage(chemin) {
  return chemin ? `${SUPABASE_URL}/storage/v1/object/public/public-images/${chemin}` : '';
}

// ---------- Photos de profil ----------
// Dossier privé « photos-profil » : chaque photo s'affiche grâce à un lien
// temporaire (1 heure) que la base accorde seulement aux membres validés.
export const DOSSIER_PHOTOS = 'photos-profil';
const DUREE_LIEN = 3600;
const liensPhotos = new Map(); // chemin -> { url, fin }
try {
  const garde = JSON.parse(sessionStorage.getItem('dolina-photos') || '{}');
  Object.entries(garde).forEach(([k, v]) => { if (v.fin > Date.now() + 60000) liensPhotos.set(k, v); });
} catch { /* stockage indisponible : sans importance */ }

function retenirLiens() {
  try { sessionStorage.setItem('dolina-photos', JSON.stringify(Object.fromEntries(liensPhotos))); } catch { /* idem */ }
}

// Liens temporaires pour une liste de photos (demandés en une seule fois)
export async function liensPhotosProfil(chemins) {
  const manquants = [...new Set(chemins.filter(Boolean))]
    .filter((c) => !(liensPhotos.get(c)?.fin > Date.now() + 60000));
  if (manquants.length) {
    const { data } = await supabase.storage.from(DOSSIER_PHOTOS).createSignedUrls(manquants, DUREE_LIEN);
    (data || []).forEach((d) => {
      if (d.signedUrl && !d.error) liensPhotos.set(d.path, { url: d.signedUrl, fin: Date.now() + DUREE_LIEN * 1000 });
    });
    retenirLiens();
  }
  return Object.fromEntries(chemins.filter((c) => liensPhotos.has(c)).map((c) => [c, liensPhotos.get(c).url]));
}

export function oublierLienPhoto(chemin) {
  liensPhotos.delete(chemin);
  retenirLiens();
}

// Remplit toutes les pastilles [data-photo] de la page avec leur photo
export async function chargerPhotos(racine = document) {
  const pastilles = [...racine.querySelectorAll('[data-photo]:not([data-photo-ok])')];
  if (!pastilles.length) return;
  pastilles.forEach((p) => p.setAttribute('data-photo-ok', ''));
  const liens = await liensPhotosProfil(pastilles.map((p) => p.dataset.photo));
  pastilles.forEach((p) => {
    const url = liens[p.dataset.photo];
    if (!url) return;
    const img = new Image();
    img.alt = '';
    img.onload = () => p.prepend(img);
    img.src = url;
  });
}

// Pastille de profil : les initiales, remplacées par la photo dès qu'elle est chargée
export function avatar(profil, classe = '') {
  const nom = profil ? nomAffiche(profil) : '?';
  const initiales = (profil?.first_name && profil?.last_name && !profil.use_nickname
    ? `${profil.first_name[0]}${profil.last_name[0]}`
    : nom.split(/\s+/).map((m) => m[0]).join('').slice(0, 2)).toUpperCase();
  const photo = profil?.photo_path ? ` data-photo="${esc(profil.photo_path)}"` : '';
  return `<span class="avatar ${classe}"${photo} aria-hidden="true"><span>${esc(initiales)}</span></span>`;
}

// Les pastilles ajoutées à la page reçoivent leur photo automatiquement
if (typeof MutationObserver !== 'undefined') {
  let attente = null;
  new MutationObserver(() => {
    if (attente) return;
    attente = setTimeout(() => { attente = null; chargerPhotos(); }, 30);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

// Adresse de base du site (sert aux liens envoyés par email)
export const BASE_URL = new URL('./', location.href).href;

// Traduit en français les messages d'erreur les plus courants de Supabase
export function erreurFr(error) {
  const m = (error && (error.message || error.error_description)) || '';
  // Messages rédigés en français par la base (règles du club) : affichés tels quels
  if (error?.code === 'P0001' && m) return m;
  if (error?.code === '23505') return 'Cet élément existe déjà (inscription ou nom en double).';
  if (error?.code === '23514') return 'Une valeur saisie n\'est pas valide. Vérifiez le formulaire.';
  if (error?.code === '42501' || /row-level security/i.test(m)) return `Vous n'avez pas les droits pour faire cette action.${m ? ` (Détail : ${m})` : ''}`;
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

// Supprime une partie non terminée (abandon) avec ses joueurs et ses volées.
// Si la base n'autorise pas encore la suppression (script 011 non exécuté),
// la partie est seulement marquée abandonnée.
export async function supprimerPartie(id) {
  const { data, error } = await supabase.from('games').delete().eq('id', id).select('id');
  if (!error && data && data.length) return true;
  await supabase.from('games').update({ status: 'abandoned' }).eq('id', id);
  return false;
}

// Profil de la personne connectée (null si personne n'est connecté)
export async function profilConnecte() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, nickname, use_nickname, status, role')
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

// Barre d'icônes en haut (ordinateur) sur tout le site : le texte s'affiche au survol
const ICONES_NAV = [
  ['./', 'Accueil', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
  ['jouer.html', 'Jouer', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'],
  ['tournois.html', 'Tournois', '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'],
  ['stats.html', 'Mes stats', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
  ['classement.html', 'Classement', '<path d="M8 21V11H3v10M15 21V4h-6v17M21 21v-7h-6v7M2 21h20"/>'],
  ['equipes.html', 'Équipes', '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M17 4a4 4 0 0 1 0 8M22 21c0-3-2-6-5-6.5"/>'],
  ['contact.html', 'Nous contacter', '<path d="M4 5h16v14H4z"/><path d="M4 6l8 7 8-7"/>'],
];
// Pages rattachées à une rubrique (pour la mettre en avant)
const RUBRIQUES = { 'scorer.html': 'jouer.html', 'live.html': './', 'mes-parties.html': 'jouer.html', 'tournoi.html': 'tournois.html', 'tournoi-creer.html': 'tournois.html', 'face-a-face.html': 'classement.html', 'records.html': 'classement.html', 'capitaine.html': 'equipes.html', 'compter.html': 'jouer.html', 'pentadarts.html': 'jouer.html', 'echauffement.html': 'jouer.html', 'equipes.html': 'equipes.html', 'profil.html': 'classement.html', 'article.html': './' };

function ajouterBarreIcones() {
  const entete = document.querySelector('.entete');
  if (!entete || entete.querySelector('.nav-icones') || document.body.classList.contains('sans-nav')) return;
  const page = location.pathname.split('/').pop() || './';
  const actuelle = page === 'index.html' ? './' : (RUBRIQUES[page] || page);
  const nav = document.createElement('nav');
  nav.className = 'nav-icones';
  nav.setAttribute('aria-label', 'Navigation principale');
  nav.innerHTML = ICONES_NAV.map(([href, libelle, svg]) => {
    const icone = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`;
    if (!href) return `<span class="nav-icones__item nav-icones__item--bientot" title="${libelle}">${icone}<span class="nav-icones__texte">${libelle}</span></span>`;
    return `<a class="nav-icones__item" href="${href}"${href === actuelle ? ' aria-current="page"' : ''}>${icone}<span class="nav-icones__texte">${libelle}</span></a>`;
  }).join('');
  const marque = entete.querySelector('.entete__marque');
  if (marque) marque.after(nav); else entete.prepend(nav);
}
ajouterBarreIcones();

// En-tête : « Connexion » devient « Mon compte » quand on est connecté
async function brancherEntete() {
  const lien = document.getElementById('lien-compte');
  if (!lien) return;
  const { data: { session } } = await supabase.auth.getSession();
  const libelle = session ? 'Mon compte' : (lien.textContent.trim() || 'Connexion');
  if (session) lien.href = 'compte.html';
  // Icône + texte : sur les petits téléphones, seule l'icône reste (le titre de la page garde sa place)
  lien.classList.add('lien-compte');
  // Visiteur sur l'accueil : le mot « Connexion » reste écrit (assez de place, plus clair)
  if (!session && /\/(index\.html)?$/.test(location.pathname)) lien.classList.add('lien-compte--texte');
  lien.setAttribute('aria-label', libelle);
  lien.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg><span>${libelle}</span>`;
  if (session) menuCompte(lien, session.user.id);
}
brancherEntete();

// « Mon compte » devient un petit menu pour un admin ou un capitaine :
// mon profil, espace capitaine (+ calendrier de l'équipe), espace admin, déconnexion
const ICONES_COMPTE = {
  profil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  capitaine: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  calendrier: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  admin: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  sortie: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
};
const iconeCompte = (k) => `<svg class="mc-icone" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES_COMPTE[k]}</svg>`;

async function menuCompte(lien, uid) {
  const [rp, rt] = await Promise.all([
    supabase.from('profiles').select('role, status').eq('id', uid).maybeSingle(),
    supabase.from('teams').select('*').order('sort_order'),
  ]);
  const actif = rp.data?.status === 'active';
  const admin = actif && rp.data?.role === 'admin';
  const equipe = actif ? ((rt.data || []).find((t) => estCapitaineDe(t, uid)) || null) : null;
  if (!admin && !equipe) return;   // simple membre : le lien mène directement à Mon compte

  // Admin : nombre de choses à traiter (inscriptions, demandes d'équipe, messages)
  let aTraiter = 0;
  if (admin) {
    const compte = (r) => r.count || 0;
    const [a, b, c] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('team_members').select('team_id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('contact_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    ]);
    aTraiter = compte(a) + compte(b) + compte(c) + (await rencontresEnRetard()).length;
  }
  // Capitaine : rencontres de son équipe passées sans score
  const retardCap = equipe && !admin ? (await rencontresEnRetard(equipe.id)).length : 0;
  if (retardCap) aTraiter = retardCap;
  const page = location.pathname.split('/').pop() || 'index.html';
  const item = (href, icone, texte, extra = '') => `<a class="mc-item${page === href.split('#')[0] ? ' mc-item--ici' : ''}" role="menuitem" href="${href}">${iconeCompte(icone)}<span>${texte}</span>${extra}</a>`;
  const menu = document.createElement('div');
  menu.className = 'mc';
  menu.innerHTML = `
    <div class="mc-liste" role="menu" aria-label="Mon compte">
      ${item('compte.html', 'profil', 'Mon profil')}
      ${equipe && !admin ? item('capitaine.html', 'capitaine', `Espace capitaine <small>${esc(equipe.name)}${retardCap ? ' · à mettre à jour' : ''}</small>`, retardCap ? `<span class="compteur">${retardCap}</span>` : '') : ''}
      ${admin ? item(equipe ? `capitaine.html?equipe=${encodeURIComponent(equipe.name)}` : 'capitaine.html', 'capitaine', 'Espaces capitaines <small>toutes les équipes</small>') : ''}
      ${equipe ? item(`equipes.html#${encodeURIComponent(equipe.name)}`, 'calendrier', 'Calendrier de l\'équipe') : ''}
      ${admin ? item('admin.html', 'admin', 'Espace admin', aTraiter ? `<span class="compteur">${aTraiter}</span>` : '') : ''}
      <hr>
      <button type="button" class="mc-item mc-item--sortie" role="menuitem" data-deconnexion>${iconeCompte('sortie')}<span>Déconnexion</span></button>
    </div>`;
  lien.after(menu);
  menu.prepend(lien);
  lien.setAttribute('aria-haspopup', 'menu');
  lien.setAttribute('aria-expanded', 'false');
  if (aTraiter) lien.insertAdjacentHTML('beforeend', `<span class="compteur mc-pastille" aria-label="${aTraiter} à traiter">${aTraiter}</span>`);
  const ouvrir = (oui) => { menu.classList.toggle('mc--ouvert', oui); lien.setAttribute('aria-expanded', String(oui)); };
  lien.addEventListener('click', (e) => {
    e.preventDefault();
    ouvrir(!menu.classList.contains('mc--ouvert'));
    if (menu.classList.contains('mc--ouvert')) menu.querySelector('.mc-item')?.focus({ preventScroll: true });
  });
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) ouvrir(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('mc--ouvert')) { ouvrir(false); lien.focus(); } });
  menu.querySelector('[data-deconnexion]').addEventListener('click', async () => {
    await supabase.auth.signOut().catch(() => {});
    location.href = './';
  });
  // Ancre #capitaine sur la page actuelle : on y va sans recharger
  menu.querySelectorAll('a[href^="compte.html#"]').forEach((a) => a.addEventListener('click', () => ouvrir(false)));
}

// Enregistre le service worker (installation du site comme une appli)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ---------- Lieu : au club ou à l'extérieur (redemandé environ toutes les heures) ----------
// Au club : parties normales. À l'extérieur : chaque match et tournoi est « ligue » ou « amical ».
// Le choix est gardé sur cet appareil ; un amical ne compte pas au classement.
const CLE_LIEU = 'dolina-lieu';
const DUREE_LIEU = 60 * 60 * 1000;
const PICTO_LIEU = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
let lieuMemoire = null;
let fenetreLieu = null;

function lireLieu() {
  try {
    const v = JSON.parse(localStorage.getItem(CLE_LIEU) || 'null');
    if (v) return v;
  } catch { /* stockage indisponible */ }
  return lieuMemoire;
}

// « club », « exterieur », ou null si le choix date de plus d'une heure
export function lieuActuel() {
  const v = lireLieu();
  return v?.lieu && Date.now() - v.t < DUREE_LIEU ? v.lieu : null;
}

export function definirLieu(lieu) {
  lieuMemoire = { lieu, t: Date.now() };
  try { localStorage.setItem(CLE_LIEU, JSON.stringify(lieuMemoire)); } catch { /* idem */ }
  majPuceLieu();
  document.dispatchEvent(new CustomEvent('dolina:lieu', { detail: lieu }));
}

// Fenêtre « Où jouez-vous ? » ; renvoie le lieu choisi
export function choisirLieu() {
  if (fenetreLieu) return fenetreLieu;
  fenetreLieu = new Promise((resolve) => {
    const f = document.createElement('div');
    f.className = 'fenetre';
    f.setAttribute('role', 'dialog');
    f.setAttribute('aria-modal', 'true');
    f.setAttribute('aria-labelledby', 't-lieu');
    const actuel = lireLieu()?.lieu;
    f.innerHTML = `
      <div class="fenetre__boite lieu-fenetre">
        <h2 id="t-lieu">Où jouez-vous ?</h2>
        <button type="button" class="lieu-choix${actuel === 'club' ? ' lieu-choix--actuel' : ''}" data-lieu="club">
          <strong>Au club</strong><small>Les parties fonctionnent comme d'habitude et comptent dans vos stats.</small>
        </button>
        <button type="button" class="lieu-choix${actuel === 'exterieur' ? ' lieu-choix--actuel' : ''}" data-lieu="exterieur">
          <strong>À l'extérieur</strong><small>Pour chaque match et tournoi, vous indiquerez s'il s'agit d'un match de ligue ou d'un match amical (un amical ne compte pas au classement).</small>
        </button>
        <p class="lieu-note">La question revient environ toutes les heures. Vous pouvez changer à tout moment avec le bouton ${PICTO_LIEU.replace('<svg', '<svg class="lieu-note__picto"')} en haut de l'écran.</p>
      </div>`;
    document.body.appendChild(f);
    f.querySelector('.lieu-choix--actuel, .lieu-choix')?.focus();
    f.addEventListener('click', (e) => {
      const b = e.target.closest('[data-lieu]');
      if (!b) return;
      definirLieu(b.dataset.lieu);
      f.remove();
      fenetreLieu = null;
      resolve(b.dataset.lieu);
    });
  });
  return fenetreLieu;
}

function majPuceLieu() {
  const b = document.getElementById('puce-lieu');
  if (!b) return;
  const l = lieuActuel() || lireLieu()?.lieu;
  b.dataset.lieu = l || '';
  b.querySelector('span').textContent = l === 'club' ? 'Au club' : (l === 'exterieur' ? 'Extérieur' : 'Lieu ?');
  b.setAttribute('aria-label', `Lieu : ${l === 'club' ? 'au club' : (l === 'exterieur' ? 'à l\'extérieur' : 'non indiqué')}. Changer`);
}

async function initLieu() {
  const entete = document.querySelector('.entete');
  if (!entete) return;
  const p = await profilConnecte().catch(() => null);
  if (p?.status !== 'active') return;
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'puce-lieu';
  b.className = 'bouton puce-lieu';
  b.title = 'Au club ou à l\'extérieur ? Changer';
  b.innerHTML = `${PICTO_LIEU}<span></span>`;
  b.addEventListener('click', () => choisirLieu());
  const compte = document.getElementById('lien-compte') || entete.querySelector('#deconnexion');
  if (compte) compte.before(b); else entete.appendChild(b);
  majPuceLieu();
  const spectateur = /live\.html$/.test(location.pathname);
  if (!lieuActuel() && !spectateur) choisirLieu();
  setInterval(() => {
    majPuceLieu();
    if (!document.hidden && !lieuActuel() && !spectateur) choisirLieu();
  }, 5 * 60 * 1000);
}
initLieu();

// Type de match d'une nouvelle partie ou d'un tournoi, selon le lieu :
//   au club : « Partie de club » ou « Match de ligue » ;  à l'extérieur : « Match de ligue » ou « Match amical » (choix obligatoire)
// « Match de ligue » est grisé pour l'instant (LIGUE_ACTIVE) : la ligue se joue depuis la page de la ligue interne.
const LIGUE_ACTIVE = false;
export function brancherTypeMatch(zone, valeurInitiale = null) {
  let valeur = valeurInitiale;
  const afficher = () => {
    const lieu = lieuActuel() || lireLieu()?.lieu || 'club';
    const options = lieu === 'exterieur'
      ? [['ligue', 'Match de ligue'], ['amical', 'Match amical']]
      : [['club', 'Partie de club'], ['ligue', 'Match de ligue']];
    if (!LIGUE_ACTIVE && valeur === 'ligue') valeur = null;
    if (lieu === 'exterieur' && valeur === 'club') valeur = null;
    if (lieu === 'exterieur' && !LIGUE_ACTIVE && !valeur) valeur = 'amical';
    if (lieu !== 'exterieur' && (valeur === 'amical' || !valeur)) valeur = LIGUE_ACTIVE && valeurInitiale === 'ligue' ? 'ligue' : 'club';
    zone.innerHTML = `
      <div class="pastilles pastilles--2" role="group" aria-label="Type de match">
        ${options.map(([v, l]) => (v === 'ligue' && !LIGUE_ACTIVE
    ? `<button type="button" class="pastille-choix" disabled aria-disabled="true" title="Bientôt disponible">${l}<small>bientôt</small></button>`
    : `<button type="button" class="pastille-choix" data-type-match="${v}" aria-pressed="${valeur === v}">${l}</button>`)).join('')}
      </div>
      <small class="type-match__aide">${lieu === 'exterieur'
    ? `Vous jouez à l'extérieur. ${valeur === 'amical' ? 'Un match amical compte dans vos stats, mais pas au classement.' : (valeur === 'ligue' ? 'Un match de ligue compte au classement.' : 'Choisissez le type du match.')}`
    : `Vous jouez au club. ${valeur === 'ligue' ? 'Match de ligue : compte au classement.' : 'Compte dans vos stats. Le classement ne compte que les matchs de ligue et de tournoi.'}`}
        <button type="button" class="lien-discret" data-changer-lieu>Changer de lieu</button></small>`;
  };
  zone.addEventListener('click', (e) => {
    const b = e.target.closest('[data-type-match]');
    if (b) { valeur = b.dataset.typeMatch; afficher(); return; }
    if (e.target.closest('[data-changer-lieu]')) choisirLieu();
  });
  document.addEventListener('dolina:lieu', afficher);
  afficher();
  return {
    definir: (v) => { valeur = v; valeurInitiale = v; afficher(); },
    valeur: () => valeur,
    manque: () => (!valeur ? 'Indiquez si c\'est un match de ligue ou un match amical.' : null),
  };
}

// Petite étiquette pour l'affichage (rien pour une partie de club)
export function etiquetteType(type) {
  if (type === 'ligue') return '<span class="type-match type-match--ligue">Ligue</span>';
  if (type === 'amical') return '<span class="type-match type-match--amical">Amical</span>';
  return '';
}

// ---------------------------------------------------------------------
// Listes déroulantes : un groupe de choix (filtres, onglets) de 4 options
// ou plus s'affiche en liste déroulante compacte. Les boutons d'origine
// restent dans la page (masqués) : choisir une option clique le bouton,
// donc chaque page garde son fonctionnement.
// ---------------------------------------------------------------------
const GROUPES_CHOIX = '.mp-filtre, .t-onglets, .ardoise__onglets';
const SEUIL_LISTE = 4;
const CHEVRON = '<svg class="ld-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
const COCHE = '<svg class="ld-coche" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
const estChoisi = (b) => b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true' || b.getAttribute('aria-current') === 'page';
const optionsDe = (groupe) => [...groupe.children].filter((e) => (e.tagName === 'BUTTON' || e.tagName === 'A') && !e.hidden);
let listeOuverte = null;

function fermerListe() {
  if (!listeOuverte) return;
  listeOuverte.classList.remove('ld--ouverte');
  listeOuverte.querySelector('.ld-bouton').setAttribute('aria-expanded', 'false');
  listeOuverte = null;
}

function enListe(groupe) {
  const options = optionsDe(groupe);
  let ld = groupe.previousElementSibling?.classList.contains('ld') ? groupe.previousElementSibling : null;
  // Dans une barre de filtres (plusieurs filtres distincts), chaque filtre est une liste
  const toujours = groupe.dataset.liste === 'toujours' || !!groupe.closest('.mp-filtres, .rc-filtres');
  if (!options.length || (options.length < SEUIL_LISTE && !toujours)) {
    groupe.classList.remove('ld-source');
    ld?.remove();
    return;
  }
  if (!ld) {
    ld = document.createElement('div');
    ld.className = 'ld';
    ld.innerHTML = `<button type="button" class="ld-bouton" aria-haspopup="listbox" aria-expanded="false"></button><div class="ld-options" role="listbox"></div>`;
    groupe.before(ld);
    ld._groupe = groupe;
  }
  groupe.classList.add('ld-source');
  ld.hidden = groupe.hidden;
  if (groupe.classList.contains('eq-filtre')) ld.classList.add('ld--collant');
  const libelle = groupe.getAttribute('aria-label') || '';
  const choisi = options.find(estChoisi) || options[0];
  const bouton = ld.querySelector('.ld-bouton');
  const contenu = `${libelle ? `<span class="ld-libelle">${esc(libelle)}</span>` : ''}<span class="ld-valeur">${choisi.innerHTML}</span>${CHEVRON}`;
  if (bouton.innerHTML !== contenu) bouton.innerHTML = contenu;
  bouton.setAttribute('aria-label', `${libelle} : ${choisi.textContent.trim()}`);
  const liste = options.map((o, i) => `<button type="button" class="ld-option" role="option" data-ld="${i}" aria-selected="${o === choisi}"${o.disabled || o.getAttribute('aria-disabled') === 'true' ? ' disabled' : ''}${o.title ? ` title="${esc(o.title)}"` : ''}>${COCHE}<span>${o.innerHTML}</span></button>`).join('');
  const zone = ld.querySelector('.ld-options');
  if (zone.innerHTML !== liste) zone.innerHTML = liste;
}

function rafraichirListes(racine = document) {
  racine.querySelectorAll(GROUPES_CHOIX).forEach(enListe);
  // Listes dont le groupe a disparu
  document.querySelectorAll('.ld').forEach((ld) => { if (!ld._groupe?.isConnected) ld.remove(); });
}

let listesEnAttente = false;
new MutationObserver((mutations) => {
  if (listesEnAttente) return;
  if (mutations.every((m) => m.target.closest?.('.ld') || (m.target.nodeType === 3 && m.target.parentElement?.closest('.ld')))) return;
  listesEnAttente = true;
  requestAnimationFrame(() => { listesEnAttente = false; rafraichirListes(); });
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-selected', 'hidden', 'disabled'] });
document.addEventListener('DOMContentLoaded', () => rafraichirListes());
rafraichirListes();

document.addEventListener('click', (e) => {
  const bouton = e.target.closest('.ld-bouton');
  if (bouton) {
    const ld = bouton.parentElement;
    const ouvrir = !ld.classList.contains('ld--ouverte');
    fermerListe();
    if (ouvrir) {
      ld.classList.add('ld--ouverte');
      bouton.setAttribute('aria-expanded', 'true');
      listeOuverte = ld;
      // Ouvre vers le haut s'il n'y a pas la place en dessous
      const bas = window.innerHeight - bouton.getBoundingClientRect().bottom;
      ld.classList.toggle('ld--haut', bas < 260 && bouton.getBoundingClientRect().top > bas);
      (ld.querySelector('.ld-option[aria-selected="true"]') || ld.querySelector('.ld-option:not([disabled])'))?.focus({ preventScroll: true });
    }
    return;
  }
  const option = e.target.closest('.ld-option');
  if (option) {
    const ld = option.closest('.ld');
    const source = optionsDe(ld._groupe)[Number(option.dataset.ld)];
    fermerListe();
    ld.querySelector('.ld-bouton').focus({ preventScroll: true });
    source?.click();
    return;
  }
  if (!e.target.closest('.ld')) fermerListe();
});
document.addEventListener('keydown', (e) => {
  if (!listeOuverte) return;
  if (e.key === 'Escape') { const b = listeOuverte.querySelector('.ld-bouton'); fermerListe(); b.focus(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const opts = [...listeOuverte.querySelectorAll('.ld-option:not([disabled])')];
    const i = opts.indexOf(document.activeElement);
    opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length]?.focus();
  }
});

// Hauteur de l'en-tête collant (pour les effets de défilement et les éléments collés dessous)
function majHauteurEntete() {
  const h = document.querySelector('.entete')?.offsetHeight;
  if (h) document.documentElement.style.setProperty('--entete-h', `${h}px`);
}
majHauteurEntete();
window.addEventListener('resize', majHauteurEntete);
window.addEventListener('load', majHauteurEntete);

// ---------------------------------------------------------------------
// Mise en page au défilement, sur toutes les pages (comme l'accueil) :
// - le titre de la page s'efface en douceur quand on descend ;
// - la dernière barre d'onglets ou de filtres se colle sous l'en-tête,
//   se cache quand on descend et réapparaît dès qu'on remonte.
// ---------------------------------------------------------------------
(function miseEnPageDefilement() {
  const page = location.pathname.split('/').pop() || 'index.html';
  if (['index.html', 'scorer.html', 'live.html'].includes(page)) return;
  const main = document.querySelector('main');
  if (!main) return;
  const calme = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let tete = [];
  let barre = null;
  let dernier = window.scrollY;
  let enAttente = false;

  const reperer = () => {
    // Titre de page : le premier h1 visible (avec son bloc d'en-tête et l'intro qui suit)
    const h1 = [...main.querySelectorAll('h1')].find((h) => h.offsetParent && !h.closest('.carte-info, .fenetre'));
    const conteneur = h1?.closest('.rc-tete, .cap-tete');
    const bloc = h1 ? (conteneur && !conteneur.querySelector('.ld, .mp-filtre') ? conteneur : h1) : null;
    const nouveaux = bloc ? [bloc, ...(bloc.nextElementSibling?.matches('.intro, .eq-intro, .rc-intro') ? [bloc.nextElementSibling] : [])] : [];
    if (nouveaux.join() !== tete.join()) {
      tete.forEach((el) => { el.classList.remove('tete-page'); el.style.removeProperty('--p'); });
      tete = calme ? [] : nouveaux;
      tete.forEach((el) => el.classList.add('tete-page'));
    }
    // Barre collante : la dernière barre d'onglets ou de filtres visible de la page
    const barres = [...main.querySelectorAll('.t-onglets, .eq-onglets, .mp-filtres, .rc-filtres, .eq-filtre')]
      .filter((b) => b.offsetParent && !b.closest('.fenetre, [hidden]'));
    const choisie = barres.at(-1) || null;
    if (choisie !== barre) {
      barre?.classList.remove('barre-collante', 'barre-collante--cache');
      barre = choisie;
      barre?.classList.add('barre-collante');
    }
  };

  const effets = () => {
    enAttente = false;
    const y = window.scrollY;
    const hEntete = document.querySelector('.entete')?.offsetHeight || 64;
    tete.forEach((el) => el.style.setProperty('--p', Math.min(1, Math.max(0, y / 160)).toFixed(3)));
    if (barre) {
      const collee = barre.getBoundingClientRect().top <= hEntete + 1;
      const menuOuvert = barre.querySelector('.ld--ouverte');
      if (!collee || y < dernier - 6 || menuOuvert) barre.classList.remove('barre-collante--cache');
      else if (y > dernier + 6) barre.classList.add('barre-collante--cache');
      document.body.classList.toggle('barre-visible', collee && !barre.classList.contains('barre-collante--cache'));
    }
    dernier = y;
  };

  let attente = null;
  new MutationObserver(() => { clearTimeout(attente); attente = setTimeout(reperer, 120); })
    .observe(main, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('scroll', () => { if (!enAttente) { enAttente = true; requestAnimationFrame(effets); } }, { passive: true });
  window.addEventListener('resize', () => { reperer(); effets(); });
  reperer();
  effets();
}());

// ---------------------------------------------------------------------
// Barre de navigation du bas (téléphone) sur toutes les pages, comme sur l'accueil
// ---------------------------------------------------------------------
(function barreDuBas() {
  if (document.querySelector('.nav-bas')) return;
  const page = location.pathname.split('/').pop() || 'index.html';
  if (['scorer.html', 'live.html'].includes(page) || document.body.classList.contains('sans-nav')) return;
  const RUB = {
    'classement.html': 'stats.html', 'records.html': 'stats.html', 'face-a-face.html': 'stats.html', 'profil.html': 'stats.html',
    'mes-parties.html': 'jouer.html', 'compter.html': 'jouer.html', 'pentadarts.html': 'jouer.html', 'echauffement.html': 'jouer.html', 'tournoi.html': 'tournois.html', 'tournoi-creer.html': 'tournois.html',
    'capitaine.html': 'equipes.html', 'article.html': './',
  };
  const actuelle = RUB[page] || page;
  const liens = [
    ['./', 'Accueil', '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
    ['jouer.html', 'Jouer', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'],
    ['tournois.html', 'Tournois', '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>'],
    ['stats.html', 'Mes stats', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
    ['equipes.html', 'Équipes', '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M17 4a4 4 0 0 1 0 8M22 21c0-3-2-6-5-6.5"/>'],
  ];
  const nav = document.createElement('nav');
  nav.className = 'nav-bas';
  nav.setAttribute('aria-label', 'Navigation principale');
  nav.innerHTML = liens.map(([href, nom, d]) => `<a href="${href}"${href === actuelle ? ' aria-current="page"' : ''}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>${nom}</a>`).join('');
  document.body.appendChild(nav);
}());

// ---------- Bandeau de rubriques d'une page (comme l'accueil) ----------
// Collé sous l'en-tête : caché quand on descend, revient quand on remonte ; la rubrique
// affichée est mise en avant et un clic y amène directement. rubriques : [[id, nom, icône]]
export function barreRubriques(barre, rubriques) {
  if (!barre) return;
  let actif = null;
  const observateur = new IntersectionObserver((entrees) => {
    const visibles = entrees.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
    if (!visibles.length) return;
    actif = visibles[0].target.id;
    barre.querySelectorAll('a').forEach((a) => {
      if (a.dataset.rubrique === actif) {
        a.setAttribute('aria-current', 'true');
        const piste = barre.querySelector('.rubriques-page__piste');
        piste?.scrollTo({ left: a.offsetLeft - piste.clientWidth / 2 + a.clientWidth / 2, behavior: 'smooth' });
      } else a.removeAttribute('aria-current');
    });
  }, { rootMargin: '-30% 0px -60% 0px' });
  const suivis = new Set();
  let dernierRendu = null;
  const dessiner = () => {
    const presentes = rubriques.filter(([id]) => { const el = document.getElementById(id); return el && !el.hidden && el.offsetParent && el.childElementCount; });
    const html = presentes.length > 1
      ? `<div class="rubriques-page__piste">${presentes.map(([id, nom, icone]) => `<a href="#${id}" data-rubrique="${id}"${id === actif ? ' aria-current="true"' : ''}>${icone || ''}<span>${nom}</span></a>`).join('')}</div>` : '';
    // Comparé au dernier rendu (le navigateur réécrit les SVG : comparer innerHTML bouclerait)
    if (html !== dernierRendu) { dernierRendu = html; barre.innerHTML = html; }
    if (barre.hidden !== !html) barre.hidden = !html;
    presentes.forEach(([id]) => { const el = document.getElementById(id); if (!suivis.has(el)) { suivis.add(el); observateur.observe(el); } });
  };
  dessiner();
  new MutationObserver(() => requestAnimationFrame(dessiner)).observe(document.querySelector('main'), { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });

  let dernier = window.scrollY;
  let auto = 0;
  let enAttente = false;
  const effets = () => {
    const y = window.scrollY;
    const collee = barre.getBoundingClientRect().top <= (document.querySelector('.entete')?.offsetHeight || 64) + 1;
    if (Date.now() >= auto) {
      if (!collee || y < dernier - 6) barre.classList.remove('rubriques-page--cache');
      else if (y > dernier + 6) barre.classList.add('rubriques-page--cache');
    }
    dernier = y;
    enAttente = false;
  };
  window.addEventListener('scroll', () => { if (!enAttente) { enAttente = true; requestAnimationFrame(effets); } }, { passive: true });
  barre.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-rubrique]');
    if (!a) return;
    e.preventDefault();
    const cible = document.getElementById(a.dataset.rubrique);
    const decalage = (document.querySelector('.entete')?.offsetHeight || 64) + barre.offsetHeight + 12;
    auto = Date.now() + 1200;
    barre.classList.remove('rubriques-page--cache');
    window.scrollTo({ top: cible.getBoundingClientRect().top + window.scrollY - decalage, behavior: 'smooth' });
  });
}
