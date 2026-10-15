// =====================================================================
//  Administration : onglet « Actualités »
//  Rédiger, illustrer, publier, dépublier et supprimer les articles.
// =====================================================================

import { supabase, esc, message, erreurFr, dateFr, urlImage } from './app.js';

const CATEGORIES = { annonce: 'Annonce de match', resultat: 'Résultat', vie_club: 'Vie du club', evenement: 'Événement' };
const BUCKET = 'public-images';
const LARGEUR_MAX = 1600;

let moi = null;
let articles = [];
let enCours = null;      // article en cours de modification (null = nouveau)
let nouvellePhoto = null; // Blob prêt à envoyer
let retirerPhoto = false;

const liste = document.getElementById('actus-liste');
const zoneArticles = document.getElementById('actus-articles');
const form = document.getElementById('actu-form');
const zoneMsg = document.getElementById('actu-message');
const apercu = document.getElementById('actu-apercu');
const apercuImg = document.getElementById('actu-apercu-img');
const champPhoto = document.getElementById('actu-photo');

// ---------- Liste ----------

async function charger() {
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, body, category, image_path, published, published_at, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) {
    zoneArticles.innerHTML = `<p class="vide">${esc(erreurFr(error))}</p>`;
    return;
  }
  articles = data;
  afficherListe();
}

function afficherListe() {
  if (!articles.length) {
    zoneArticles.innerHTML = '<p class="vide">Aucun article pour l\'instant. Cliquez sur « Nouvel article » pour publier la première actualité du club.</p>';
    return;
  }
  zoneArticles.innerHTML = articles.map((a) => `
    <article class="carte-info carte-actu">
      ${a.image_path ? `<img class="carte-actu__image" src="${esc(urlImage(a.image_path))}" alt="" loading="lazy">` : ''}
      <div class="carte-actu__texte">
        <span class="etiquette etiquette--${esc(a.category)}">${esc(CATEGORIES[a.category])}</span>
        <h3 class="article__titre">${esc(a.title)}</h3>
        <span class="statut ${a.published ? 'statut--ok' : 'statut--attente'}">${a.published ? `Publié le ${esc(dateFr(a.published_at))}` : 'Brouillon'}</span>
        <div class="actions">
          <button type="button" class="bouton bouton--petit" data-modifier="${a.id}">Modifier</button>
          ${a.published ? `<a class="bouton bouton--petit" href="article.html?id=${a.id}" target="_blank" rel="noopener">Voir</a>` : ''}
        </div>
      </div>
    </article>`).join('');
}

// ---------- Formulaire ----------

function ouvrir(article) {
  enCours = article || null;
  nouvellePhoto = null;
  retirerPhoto = false;
  form.reset();
  message(zoneMsg, '');
  document.getElementById('actu-titre-form').textContent = article ? 'Modifier l\'article' : 'Nouvel article';
  form.title.value = article?.title || '';
  form.category.value = article?.category || 'annonce';
  form.body.value = article?.body || '';
  montrerApercu(article?.image_path ? urlImage(article.image_path) : null);

  document.getElementById('actu-publier').textContent = article?.published ? 'Enregistrer (reste publié)' : 'Publier';
  document.getElementById('actu-brouillon').textContent = article?.published ? 'Dépublier (repasser en brouillon)' : 'Enregistrer en brouillon';
  document.getElementById('actu-supprimer').hidden = !article;
  document.getElementById('actu-statut').textContent = article
    ? (article.published ? `Publié le ${dateFr(article.published_at)}.` : 'Brouillon : visible uniquement des admins.')
    : '';

  liste.hidden = true;
  form.hidden = false;
  form.title.focus();
  window.scrollTo({ top: 0 });
}

function fermer() {
  form.hidden = true;
  liste.hidden = false;
  enCours = null;
}

function montrerApercu(src) {
  apercu.hidden = !src;
  if (src) apercuImg.src = src;
}

// Réduit la photo (1600 px de large au plus) et la convertit en JPEG
function reduire(fichier) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(fichier);
    img.onload = () => {
      const echelle = Math.min(1, LARGEUR_MAX / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * echelle);
      canvas.height = Math.round(img.height * echelle);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#141414'; // fond noir mat pour les visuels transparents
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('conversion'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('lecture')); };
    img.src = url;
  });
}

champPhoto.addEventListener('change', async () => {
  const f = champPhoto.files[0];
  if (!f) return;
  if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
    message(zoneMsg, 'Format non accepté : choisissez une image JPEG, PNG ou WebP.');
    champPhoto.value = '';
    return;
  }
  try {
    nouvellePhoto = await reduire(f);
    retirerPhoto = false;
    montrerApercu(URL.createObjectURL(nouvellePhoto));
    message(zoneMsg, '');
  } catch {
    message(zoneMsg, 'Impossible de lire cette image. Essayez avec une autre photo.');
  }
});

document.getElementById('actu-retirer-photo').addEventListener('click', () => {
  nouvellePhoto = null;
  retirerPhoto = true;
  champPhoto.value = '';
  montrerApercu(null);
});

// ---------- Enregistrement ----------

async function enregistrer(publier) {
  const titre = form.title.value.trim();
  if (!titre) {
    message(zoneMsg, 'Le titre est obligatoire.');
    return;
  }
  const boutons = form.querySelectorAll('button');
  boutons.forEach((b) => { b.disabled = true; });
  message(zoneMsg, publier ? 'Publication en cours…' : 'Enregistrement…', 'ok');

  const ancienneImage = enCours?.image_path || null;
  let image = ancienneImage;

  // 1. Envoi de la nouvelle photo
  if (nouvellePhoto) {
    const chemin = `actus/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(chemin, nouvellePhoto, { contentType: 'image/jpeg', cacheControl: '31536000' });
    if (error) {
      boutons.forEach((b) => { b.disabled = false; });
      message(zoneMsg, `La photo n'a pas pu être envoyée. ${erreurFr(error)}`);
      return;
    }
    image = chemin;
  } else if (retirerPhoto) {
    image = null;
  }

  // 2. Enregistrement de l'article
  const donnees = {
    title: titre,
    category: form.category.value,
    body: form.body.value.trim(),
    image_path: image,
    published: publier,
  };
  let res;
  if (enCours) {
    res = await supabase.from('articles').update(donnees).eq('id', enCours.id);
  } else {
    res = await supabase.from('articles').insert({ ...donnees, author_id: moi.id });
  }
  boutons.forEach((b) => { b.disabled = false; });
  if (res.error) {
    message(zoneMsg, erreurFr(res.error));
    return;
  }

  // 3. Ménage : l'ancienne photo remplacée ou retirée est supprimée
  if (ancienneImage && ancienneImage !== image) {
    await supabase.storage.from(BUCKET).remove([ancienneImage]);
  }

  fermer();
  await charger();
}

async function supprimer() {
  if (!enCours) return;
  if (!confirm(`Supprimer définitivement l'article « ${enCours.title} » ?`)) return;
  const { error } = await supabase.from('articles').delete().eq('id', enCours.id);
  if (error) {
    message(zoneMsg, erreurFr(error));
    return;
  }
  if (enCours.image_path) await supabase.storage.from(BUCKET).remove([enCours.image_path]);
  fermer();
  await charger();
}

form.addEventListener('click', (e) => {
  const b = e.target.closest('[data-actu]');
  if (!b) return;
  const action = b.dataset.actu;
  if (action === 'publier') enregistrer(true);
  if (action === 'brouillon') enregistrer(false);
  if (action === 'annuler') fermer();
  if (action === 'supprimer') supprimer();
});

zoneArticles.addEventListener('click', (e) => {
  const b = e.target.closest('[data-modifier]');
  if (b) ouvrir(articles.find((a) => a.id === b.dataset.modifier));
});

document.getElementById('actu-nouvelle').addEventListener('click', () => ouvrir(null));

export async function initActus(profil) {
  moi = profil;
  await charger();
}
