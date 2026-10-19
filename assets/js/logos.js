// =====================================================================
//  Logos des équipes adverses (script 034)
//  Le nom de l'adversaire d'une rencontre (« CAL 1 », « Patrick's 3 »)
//  est simplifié puis comparé aux alias de chaque club adverse.
// =====================================================================

import { supabase, esc, urlImage } from './app.js?v=__VERSION__';

let clubs = null;     // [{ id, nom, alias, logo }]
let chargement = null;

// « Patrick's 3 » → « patricks » ; « SMFE 91 3 » → « smfe 91 » ; « CAL 1 » → « cal »
export function cleAdversaire(nom) {
  return String(nom || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+\d+$/, '')
    .trim();
}

export async function chargerClubs(forcer = false) {
  if (clubs && !forcer) return clubs;
  if (chargement && !forcer) return chargement;
  chargement = supabase.from('clubs_adverses').select('id, nom, alias, logo').then(({ data, error }) => {
    clubs = error ? [] : data;   // script 034 pas encore lancé : pas de logo, rien ne casse
    return clubs;
  });
  return chargement;
}

export function clubDe(adversaire) {
  if (!clubs) return null;
  const cle = cleAdversaire(adversaire);
  if (!cle) return null;
  return clubs.find((c) => (c.alias || []).includes(cle) || cleAdversaire(c.nom) === cle) || null;
}

export function urlLogo(logo) {
  if (!logo) return '';
  return logo.startsWith('assets/') ? logo : urlImage(logo);
}

// Pastille du logo : l'image du club, sinon ses initiales
export function logoAdversaire(adversaire, classe = '') {
  const c = clubDe(adversaire);
  const url = urlLogo(c?.logo);
  if (url) return `<span class="logo-adv ${classe}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async"></span>`;
  const initiales = String(adversaire || '?').replace(/\s+\d+$/, '').split(/\s+/).map((m) => m[0]).join('').slice(0, 3).toUpperCase();
  return `<span class="logo-adv logo-adv--vide ${classe}" aria-hidden="true">${esc(initiales)}</span>`;
}

export const LOGO_DOLINA = 'assets/img/logo.png';
export function logoDolina(classe = '') {
  return `<span class="logo-adv logo-adv--dolina ${classe}"><img src="${LOGO_DOLINA}" alt="" decoding="async"></span>`;
}

// Image choisie dans le téléphone → carré de 320 px en WebP (léger), fond transparent conservé
export async function preparerLogo(fichier) {
  if (!/^image\/(png|jpeg|webp)$/.test(fichier.type)) throw new Error('Choisissez une image PNG, JPEG ou WebP.');
  const bitmap = await createImageBitmap(fichier);
  const T = 320;
  const toile = document.createElement('canvas');
  toile.width = T; toile.height = T;
  const ctx = toile.getContext('2d');
  const k = Math.min((T * 0.94) / bitmap.width, (T * 0.94) / bitmap.height);
  const w = bitmap.width * k; const h = bitmap.height * k;
  ctx.drawImage(bitmap, (T - w) / 2, (T - h) / 2, w, h);
  const blob = await new Promise((ok) => toile.toBlob(ok, 'image/webp', 0.9));
  if (blob && blob.type === 'image/webp') return blob;
  return new Promise((ok) => toile.toBlob(ok, 'image/png'));   // navigateur sans WebP
}

// Enregistre le logo du club de cet adversaire (créé s'il n'existe pas encore)
export async function enregistrerLogo(adversaire, fichier) {
  await chargerClubs();
  const blob = await preparerLogo(fichier);
  const ext = blob.type === 'image/webp' ? 'webp' : 'png';
  const chemin = `logos/${crypto.randomUUID()}.${ext}`;
  const { error: e1 } = await supabase.storage.from('public-images').upload(chemin, blob, { contentType: blob.type, cacheControl: '31536000' });
  if (e1) throw e1;
  const club = clubDe(adversaire);
  const req = club
    ? supabase.from('clubs_adverses').update({ logo: chemin }).eq('id', club.id).select('id, nom, alias, logo').single()
    : supabase.from('clubs_adverses').insert({ nom: adversaire.replace(/\s+\d+$/, '').trim() || adversaire, alias: [cleAdversaire(adversaire)], logo: chemin }).select('id, nom, alias, logo').single();
  const { data, error } = await req;
  if (error) {
    await supabase.storage.from('public-images').remove([chemin]);
    throw error;
  }
  // L'ancien logo envoyé (pas ceux du site) est supprimé du stockage
  if (club?.logo?.startsWith('logos/')) supabase.storage.from('public-images').remove([club.logo]).catch(() => {});
  clubs = clubs.filter((c) => c.id !== data.id).concat(data);
  return data;
}

// Ordre d'une rencontre partout sur le site : l'équipe qui reçoit à gauche,
// celle qui se déplace à droite (quel que soit le résultat)
export function affiche(nomDolina, r, sep = '–') {
  const nous = `<span class="nom-dolina">${esc(nomDolina)}</span>`;
  const eux = esc(r.adversaire);
  return r.domicile ? `${nous} ${sep} ${eux}` : `${eux} ${sep} ${nous}`;
}
// Score : Dolina en orange, l'adversaire en blanc
export function scoreOrdonne(r, sep = ' – ') {
  const nous = `<b class="score-dolina">${r.score_nous}</b>`;
  const eux = `<b class="score-adv">${r.score_eux}</b>`;
  return r.domicile ? `${nous}${sep}${eux}` : `${eux}${sep}${nous}`;
}
