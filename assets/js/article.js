// =====================================================================
//  Page d'un article + boutons de partage
//  Le lien partagé pointe vers la page « a/<id>.html » générée par GitHub
//  (titre, texte et photo dans l'aperçu LinkedIn, WhatsApp, Facebook) ;
//  tant qu'elle n'existe pas encore, on partage le lien de cette page.
// =====================================================================

import { supabase, esc, dateFr, urlImage, BASE_URL } from './app.js?v=__VERSION__';

const CATEGORIES = { annonce: 'Annonce de match', resultat: 'Résultat', vie_club: 'Vie du club', evenement: 'Événement' };
const zone = document.getElementById('article');
const id = new URLSearchParams(location.search).get('id');

const ICONES = {
  partager: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
  whatsapp: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.6-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>',
  facebook: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.2-1.3 1.4-1.3H17V2.6A21 21 0 0 0 14.6 2.5C12.2 2.5 10.6 4 10.6 6.6v1.9H8v3.2h2.6V21.5H14v-9.8h2.6l.4-3.2z"/></svg>',
  linkedin: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9.75h4v11.75H3zM9.5 9.75h3.8v1.6h.06c.53-1 1.83-2.06 3.77-2.06 4.03 0 4.77 2.65 4.77 6.1v6.11h-4v-5.42c0-1.3-.02-2.96-1.8-2.96-1.8 0-2.08 1.4-2.08 2.86v5.52h-4z"/></svg>',
  lien: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.1 0l3-3a5 5 0 0 0-7.1-7.1l-1.2 1.2"/><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.2-1.2"/></svg>',
};

// Lien à partager : page d'aperçu si elle existe déjà, sinon cette page
async function lienDePartage(articleId) {
  const apercu = `${BASE_URL}a/${articleId}.html`;
  try {
    const r = await fetch(apercu, { method: 'HEAD', cache: 'no-store' });
    if (r.ok) return apercu;
  } catch { /* hors ligne : on garde le lien direct */ }
  return `${BASE_URL}article.html?id=${encodeURIComponent(articleId)}`;
}

async function charger() {
  if (!id) {
    zone.innerHTML = '<p class="vide">Aucun article indiqué.</p>';
    return;
  }
  const { data: a, error } = await supabase
    .from('articles')
    .select('id, title, body, category, image_path, published, published_at')
    .eq('id', id)
    .maybeSingle();

  if (error || !a) {
    zone.innerHTML = '<p class="vide">Cet article n\'existe pas ou n\'est plus publié.</p>';
    return;
  }

  document.title = `${a.title} – Dolina Darts Club`;
  const image = a.image_path ? urlImage(a.image_path) : '';

  zone.innerHTML = `
    ${a.published ? '' : '<p class="message message--ok">Brouillon : cet article n\'est visible que des admins.</p>'}
    ${image ? `<img class="article__image article-complet__image" src="${esc(image)}" alt="">` : ''}
    <span class="etiquette etiquette--${esc(a.category)}">${esc(CATEGORIES[a.category] || a.category)}</span>
    <h1 class="article-complet__titre">${esc(a.title)}</h1>
    <span class="article__meta">${esc(dateFr(a.published_at))}</span>
    ${a.body ? `<p class="article__texte article-complet__texte">${esc(a.body)}</p>` : ''}
    ${a.published ? `
    <section class="partage" aria-labelledby="titre-partage">
      <h2 class="section__titre" id="titre-partage">Partager</h2>
      <div class="partage__boutons" id="partage">
        <span class="match__format">Préparation des liens…</span>
      </div>
      <p class="match__format" id="partage-info"></p>
    </section>` : ''}`;

  if (a.published) brancherPartage(a, image);
}

async function brancherPartage(a, image) {
  const url = await lienDePartage(a.id);
  const texte = `${a.title} – Dolina Darts Club`;
  const enc = encodeURIComponent;
  const zoneBoutons = document.getElementById('partage');
  const info = document.getElementById('partage-info');

  zoneBoutons.innerHTML = `
    ${navigator.share ? `<button type="button" class="bouton bouton--plein partage__btn" id="partage-natif">${ICONES.partager}Partager…</button>` : ''}
    <a class="bouton partage__btn" href="https://wa.me/?text=${enc(`${texte} ${url}`)}" target="_blank" rel="noopener">${ICONES.whatsapp}WhatsApp</a>
    <a class="bouton partage__btn" href="https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}" target="_blank" rel="noopener">${ICONES.linkedin}LinkedIn</a>
    <a class="bouton partage__btn" href="https://www.facebook.com/sharer/sharer.php?u=${enc(url)}" target="_blank" rel="noopener">${ICONES.facebook}Facebook</a>
    <button type="button" class="bouton partage__btn" id="partage-copier">${ICONES.lien}Copier le lien</button>
    ${image ? `<a class="bouton partage__btn" href="${esc(image)}" target="_blank" rel="noopener">Ouvrir le visuel</a>` : ''}`;

  info.textContent = navigator.share
    ? 'Instagram : utilisez « Partager… » puis choisissez Instagram, ou ouvrez le visuel pour l\'enregistrer et le publier.'
    : 'Instagram n\'accepte pas les liens depuis un site : ouvrez le visuel pour l\'enregistrer, puis publiez-le depuis l\'appli Instagram.';

  document.getElementById('partage-natif')?.addEventListener('click', async () => {
    try { await navigator.share({ title: texte, text: texte, url }); } catch { /* partage annulé */ }
  });
  document.getElementById('partage-copier').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(url);
      e.currentTarget.lastChild.textContent = 'Lien copié ✓';
    } catch {
      prompt('Copiez ce lien :', url);
    }
  });
}

charger();
