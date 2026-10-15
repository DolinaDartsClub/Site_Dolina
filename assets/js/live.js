// =====================================================================
//  Score en direct d'une partie publique (accessible sans compte)
// =====================================================================

import { supabase, esc, formatPartie, etatPartie } from './app.js?v=__VERSION__';

const id = new URLSearchParams(location.search).get('id');
const zone = document.getElementById('live');
const badge = document.getElementById('badge');
const format = document.getElementById('format');

let game = null;
let visits = [];

async function charger() {
  if (!id) {
    zone.innerHTML = '<p class="vide">Aucun match indiqué.</p>';
    return;
  }
  const { data, error } = await supabase
    .from('games')
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, status, winner_side, game_sides(side, name, is_bot), game_players(id, side, display_name, throw_order)')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    zone.innerHTML = '<p class="vide">Ce match n\'existe pas ou n\'est pas public.</p>';
    format.textContent = '';
    badge.hidden = true;
    return;
  }
  game = data;
  const res = await supabase
    .from('visits')
    .select('id, set_no, leg_no, visit_no, side, player_id, score, remaining_before, is_bust, is_checkout')
    .eq('game_id', id);
  visits = res.data || [];
  afficher();
}

function nomCamp(side) {
  const s = game.game_sides.find((x) => x.side === side);
  const joueurs = game.game_players
    .filter((p) => p.side === side)
    .sort((a, b) => a.throw_order - b.throw_order)
    .map((p) => p.display_name);
  if (game.mode === 'double' && s?.name) return `${s.name} (${joueurs.join(' / ')})`;
  return joueurs.join(' / ') || (s?.is_bot ? 'Dartbot' : '—');
}

function afficher() {
  const sides = [...game.game_sides].sort((a, b) => a.side - b.side);
  const etat = etatPartie(game, sides, visits);
  const fini = game.status !== 'live';

  format.textContent = formatPartie(game) + ' · finish double';
  badge.textContent = fini ? (game.status === 'finished' ? 'TERMINÉ' : 'INTERROMPU') : 'EN DIRECT';
  badge.className = 'live__badge' + (fini ? ' live__badge--fini' : '');

  // Camp au lancer : celui qui suit le dernier lanceur dans la manche en cours
  const ordreCamps = sides.map((s) => s.side);
  let actif = null;
  if (!fini && etat.dernier && !etat.dernier.is_checkout) {
    const i = ordreCamps.indexOf(etat.dernier.side);
    actif = ordreCamps[(i + 1) % ordreCamps.length];
  }

  const camps = sides.map((s) => {
    const gagnant = fini && game.winner_side === s.side;
    return `
      <div class="live__camp${s.side === actif ? ' live__camp--actif' : ''}">
        <span class="live__etat">${gagnant ? 'Vainqueur' : (s.side === actif ? 'Au lancer' : '&nbsp;')}</span>
        <span class="live__nom">${esc(nomCamp(s.side))}</span>
        <span class="live__reste">${etat.reste[s.side]}</span>
        <span class="live__manches">Manches : ${etat.manches[s.side]}${game.sets_n ? ` · Sets : ${etat.sets[s.side]}` : ''}</span>
      </div>`;
  }).join('');

  // Volées de la manche en cours
  const enCours = visits
    .filter((v) => v.set_no === etat.setCourant && v.leg_no === etat.mancheCourante)
    .sort((a, b) => a.visit_no - b.visit_no || a.id - b.id);
  const lignes = enCours.slice(-12).reverse().map((v) => `
    <tr>
      <td>${esc(nomCamp(v.side))}</td>
      <td>${v.is_bust ? 'Bust' : v.score}${v.is_checkout ? ' · Game shot' : ''}</td>
      <td>${v.is_bust ? v.remaining_before : v.remaining_before - v.score}</td>
    </tr>`).join('');

  zone.innerHTML = `
    <div class="live__camps">${camps}</div>
    <section class="section">
      <h2 class="section__titre">${game.sets_n ? `Set ${etat.setCourant} · ` : ''}Manche ${etat.mancheCourante}</h2>
      ${lignes
        ? `<table class="tableau"><thead><tr><th>Joueur</th><th>Volée</th><th>Reste</th></tr></thead><tbody>${lignes}</tbody></table>`
        : '<p class="vide">La manche commence.</p>'}
    </section>
    <p class="match__format">Le score se met à jour automatiquement à chaque volée saisie.</p>`;
}

// Temps réel : nouvelles volées, corrections, fin de partie
supabase
  .channel(`live-${id}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `game_id=eq.${id}` }, charger)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` }, charger)
  .subscribe();

charger();
