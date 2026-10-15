// =====================================================================
//  Page d'accueil : matchs en cours (temps réel) + actualités
// =====================================================================

import { supabase, esc, dateFr, formatPartie, etatPartie, urlImage } from './app.js?v=__VERSION__';

const CATEGORIES = {
  annonce: 'Annonce de match',
  resultat: 'Résultat',
  vie_club: 'Vie du club',
  evenement: 'Événement',
};

// ---------- Matchs en cours ----------

async function chargerMatchs() {
  const zone = document.getElementById('matchs');
  const { data: games, error } = await supabase
    .from('games')
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, first_side, status, game_sides(side, name, is_bot), game_players(side, display_name, throw_order)')
    .eq('status', 'live')
    .eq('visibility', 'public')
    .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(12);

  if (error) {
    zone.innerHTML = '<p class="vide">Impossible de charger les matchs pour le moment.</p>';
    return;
  }
  if (!games.length) {
    zone.innerHTML = '<p class="vide">Aucun match en cours. Les parties publiques apparaissent ici dès qu\'elles commencent.</p>';
    return;
  }

  const { data: visits } = await supabase
    .from('visits')
    .select('id, game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_bust, is_checkout, darts_used, darts_at_double')
    .in('game_id', games.map((g) => g.id));

  zone.innerHTML = games.map((g) => carteMatch(g, (visits || []).filter((v) => v.game_id === g.id))).join('');
}

function nomCamp(g, side) {
  const s = g.game_sides.find((x) => x.side === side);
  const joueurs = g.game_players
    .filter((p) => p.side === side)
    .sort((a, b) => a.throw_order - b.throw_order)
    .map((p) => p.display_name);
  if (g.mode === 'double' && s?.name) return `${s.name} (${joueurs.join(' / ')})`;
  return joueurs.join(' / ') || (s?.is_bot ? 'Dartbot' : '—');
}

function carteMatch(g, visits) {
  const sides = [...g.game_sides].sort((a, b) => a.side - b.side);
  const etat = etatPartie(g, sides, visits);
  const lien = `live.html?id=${encodeURIComponent(g.id)}`;

  if (sides.length === 2) {
    const [a, b] = sides.map((s) => s.side);
    const score = g.sets_n
      ? `${etat.sets[a]} – ${etat.sets[b]}`
      : `${etat.manches[a]} – ${etat.manches[b]}`;
    return `
      <a class="match" href="${lien}">
        <span class="match__format">${esc(formatPartie(g))}</span>
        <span class="match__ligne">
          <span class="match__camp">
            <span class="match__nom">${esc(nomCamp(g, a))}</span>
            <span class="match__reste">reste ${etat.reste[a]}</span>
          </span>
          <span class="match__score">${score}</span>
          <span class="match__camp match__camp--droite">
            <span class="match__nom">${esc(nomCamp(g, b))}</span>
            <span class="match__reste">reste ${etat.reste[b]}</span>
          </span>
        </span>
        <span class="match__lien">Suivre le score en direct →</span>
      </a>`;
  }

  // 3 ou 4 joueurs
  const lignes = sides.map((s) => `
    <span class="match__ligne" style="grid-template-columns: minmax(0,1fr) auto">
      <span class="match__nom">${esc(nomCamp(g, s.side))}</span>
      <span class="match__reste">${etat.manches[s.side]} manche(s) · reste ${etat.reste[s.side]}</span>
    </span>`).join('');
  return `
    <a class="match" href="${lien}">
      <span class="match__format">${esc(formatPartie(g))}</span>
      ${lignes}
      <span class="match__lien">Suivre le score en direct →</span>
    </a>`;
}

// ---------- Actualités ----------

async function chargerArticles() {
  const zone = document.getElementById('articles');
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, body, category, image_path, published_at')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(20);

  if (error) {
    zone.innerHTML = '<p class="vide">Impossible de charger les actualités pour le moment.</p>';
    return;
  }
  if (!data.length) {
    zone.innerHTML = '<p class="vide">Les premières actualités du club arrivent très bientôt.</p>';
    return;
  }

  zone.innerHTML = data.map((a) => {
    const lien = `article.html?id=${encodeURIComponent(a.id)}`;
    const image = a.image_path
      ? `<a href="${lien}" tabindex="-1" aria-hidden="true"><img class="article__image" src="${esc(urlImage(a.image_path))}" alt="" loading="lazy"></a>`
      : '';
    const extrait = a.body && a.body.length > 220 ? `${a.body.slice(0, 220).trim()}…` : a.body;
    return `
      <article class="article">
        ${image}
        <span class="etiquette etiquette--${esc(a.category)}">${esc(CATEGORIES[a.category] || a.category)}</span>
        <h3 class="article__titre"><a class="lien-titre" href="${lien}">${esc(a.title)}</a></h3>
        <span class="article__meta">${esc(dateFr(a.published_at))}</span>
        ${extrait ? `<p class="article__texte">${esc(extrait)}</p>` : ''}
        <a class="match__lien" href="${lien}">Lire et partager →</a>
      </article>`;
  }).join('');
}

// ---------- Temps réel : on recharge les matchs à chaque volée ----------

let attente = null;
function rafraichirBientot() {
  clearTimeout(attente);
  attente = setTimeout(chargerMatchs, 400);
}

supabase
  .channel('accueil-matchs')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, rafraichirBientot)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, rafraichirBientot)
  .subscribe();

chargerMatchs();
chargerArticles();
