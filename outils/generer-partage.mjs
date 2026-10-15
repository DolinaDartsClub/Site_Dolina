// =====================================================================
//  Préparation du site avant publication (lancé par GitHub Actions)
//
//  1. Copie les fichiers du site dans le dossier _site
//  2. Crée une page « a/<id>.html » par article publié, avec les balises
//     Open Graph (titre, texte, photo) lues par LinkedIn, WhatsApp, Facebook.
//     Cette page renvoie aussitôt vers article.html?id=<id>.
//  3. Lors des passages automatiques (toutes les 15 minutes), ne republie
//     le site que si les articles ont changé.
//
//  Aucune clé secrète : les articles publiés sont publics, la clé publique suffit.
// =====================================================================

import { readFile, writeFile, mkdir, cp, rm, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const RACINE = process.cwd();
const SORTIE = join(RACINE, '_site');
const SITE_URL = (process.env.SITE_URL || 'https://dolinadartsclub.github.io/Site_Dolina/').replace(/\/?$/, '/');
const EXCLUS = new Set(['.git', '.github', '_site', 'outils', 'supabase', 'README.md', 'node_modules']);

// Adresse et clé publique lues dans config.js (une seule source de vérité)
const config = await readFile(join(RACINE, 'assets/js/config.js'), 'utf8');
const SUPABASE_URL = config.match(/SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const CLE = config.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*'([^']+)'/)[1];

const CATEGORIES = { annonce: 'Annonce de match', resultat: 'Résultat', vie_club: 'Vie du club', evenement: 'Événement' };

const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function resume(texte, max = 200) {
  const t = String(texte || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}…` : t;
}

async function sortieGitHub(cle, valeur) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${cle}=${valeur}\n`);
  console.log(`${cle}=${valeur}`);
}

// ---------- 1. Articles publiés ----------

const reponse = await fetch(
  `${SUPABASE_URL}/rest/v1/articles?select=id,title,body,category,image_path,published_at,updated_at&published=eq.true&order=published_at.desc`,
  { headers: { apikey: CLE, Authorization: `Bearer ${CLE}` } },
);
if (!reponse.ok) {
  console.error(`Lecture des articles impossible : ${reponse.status} ${await reponse.text()}`);
  process.exit(1);
}
const articles = await reponse.json();
const signature = JSON.stringify(articles.map((a) => [a.id, a.updated_at]));
console.log(`${articles.length} article(s) publié(s).`);

// ---------- 2. Faut-il republier ? ----------

if (process.env.EVENEMENT === 'schedule') {
  try {
    const enLigne = await fetch(`${SITE_URL}a/signature.json`, { cache: 'no-store' });
    if (enLigne.ok && (await enLigne.text()) === signature) {
      console.log('Aucun changement dans les articles : pas de republication.');
      await sortieGitHub('publier', 'false');
      process.exit(0);
    }
  } catch { /* site injoignable : on republie */ }
}

// ---------- 3. Copie du site ----------

await rm(SORTIE, { recursive: true, force: true });
await mkdir(SORTIE, { recursive: true });
for (const nom of await readdir(RACINE)) {
  if (EXCLUS.has(nom)) continue;
  await cp(join(RACINE, nom), join(SORTIE, nom), { recursive: true });
}
await writeFile(join(SORTIE, '.nojekyll'), '');

// ---------- 4. Pages d'aperçu ----------

await mkdir(join(SORTIE, 'a'), { recursive: true });
const logo = `${SITE_URL}assets/img/icon-512.png`;

for (const a of articles) {
  const cible = `../article.html?id=${encodeURIComponent(a.id)}`;
  const url = `${SITE_URL}a/${a.id}.html`;
  const image = a.image_path ? `${SUPABASE_URL}/storage/v1/object/public/public-images/${a.image_path}` : logo;
  const description = resume(a.body) || `${CATEGORIES[a.category] || 'Actualité'} – Dolina Darts Club`;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(a.title)} – Dolina Darts Club</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Dolina Darts Club">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="article:published_time" content="${esc(a.published_at)}">
<meta name="twitter:card" content="${a.image_path ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(a.title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(SITE_URL)}article.html?id=${esc(a.id)}">
<meta http-equiv="refresh" content="0; url=${esc(cible)}">
<script>location.replace(${JSON.stringify(cible)});</script>
<style>body{margin:0;background:#141414;color:#f8f8f8;font-family:system-ui,sans-serif;padding:24px}a{color:#f57a00}</style>
</head>
<body>
<p>${esc(a.title)}</p>
<p><a href="${esc(cible)}">Lire l'article sur le site du Dolina Darts Club</a></p>
</body>
</html>
`;
  await writeFile(join(SORTIE, 'a', `${a.id}.html`), html);
}

await writeFile(join(SORTIE, 'a', 'signature.json'), signature);
console.log(`${articles.length} page(s) d'aperçu générée(s) dans _site/a/.`);
await sortieGitHub('publier', 'true');
