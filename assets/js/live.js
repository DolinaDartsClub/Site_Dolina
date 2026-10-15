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
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, first_side, status, winner_side, game_sides(side, name, is_bot), game_players(id, side, display_name, throw_order)')
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
    .select('id, set_no, leg_no, visit_no, side, player_id, score, remaining_before, is_bust, is_checkout, darts_used, darts_at_double')
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

// Manche affichée dans le tableau (null = manche en cours)
let mancheChoisie = null;

function afficher() {
  const sides = [...game.game_sides].sort((a, b) => a.side - b.side);
  const ordre = [...visits].sort((a, b) => a.id - b.id);
  const etat = etatPartie(game, sides, ordre);
  const fini = game.status !== 'live';

  format.textContent = formatPartie(game) + ' · finish double';
  badge.textContent = fini ? (game.status === 'finished' ? 'TERMINÉ' : 'INTERROMPU') : 'EN DIRECT';
  badge.className = 'live__badge' + (fini ? ' live__badge--fini' : '');

  const actif = fini ? null : etat.auLancer;

  // Liste des manches jouées (set, manche), dans l'ordre
  const manches = [];
  for (const v of ordre) {
    const cle = `${v.set_no}-${v.leg_no}`;
    if (!manches.find((m) => m.cle === cle)) manches.push({ cle, set: v.set_no, leg: v.leg_no });
  }
  const cleCourante = `${etat.setCourant}-${etat.mancheCourante}`;
  if (!fini && !manches.find((m) => m.cle === cleCourante)) manches.push({ cle: cleCourante, set: etat.setCourant, leg: etat.mancheCourante });
  const cleVue = mancheChoisie && manches.find((m) => m.cle === mancheChoisie) ? mancheChoisie : manches.at(-1)?.cle;
  const vue = manches.find((m) => m.cle === cleVue);
  const libelle = (m) => (game.sets_n ? `S${m.set} · M${m.leg}` : `Manche ${m.leg}`);

  // Volées de la manche affichée, par camp
  const parCamp = Object.fromEntries(sides.map((s) => [s.side, []]));
  for (const v of ordre) if (vue && v.set_no === vue.set && v.leg_no === vue.leg && parCamp[v.side]) parCamp[v.side].push(v);
  const nbLignes = Math.max(0, ...Object.values(parCamp).map((l) => l.length));
  const enCours = vue && vue.cle === cleCourante && !fini;

  const joueur = (v) => {
    if (game.mode !== 'double' || !v.player_id) return '';
    const p = game.game_players.find((x) => x.id === v.player_id);
    return p ? `<small class="ardoise__qui">${esc(p.display_name)}</small>` : '';
  };
  const cellule = (v) => {
    if (!v) return '<td class="ardoise__volee"></td><td class="ardoise__reste"></td>';
    const apres = v.is_bust ? v.remaining_before : v.remaining_before - v.score;
    const classe = v.is_checkout ? ' ardoise--finish' : (v.is_bust ? ' ardoise--bust' : (v.score >= 100 ? ' ardoise--ton' : ''));
    return `<td class="ardoise__volee${classe}">${v.is_bust ? 'Bust' : v.score}${joueur(v)}</td>`
      + `<td class="ardoise__reste${v.is_checkout ? ' ardoise--finish' : ''}">${v.is_checkout ? `✓ ${v.darts_used}<small>fl.</small>` : apres}</td>`;
  };

  const entetes = sides.map((s) => {
    const gagnant = fini && game.winner_side === s.side;
    const st = etat.stats[s.side];
    const moy = st && st.flechettes ? (Math.round((st.points / st.flechettes) * 30) / 10).toString().replace('.', ',') : '–';
    return `
      <th colspan="2" class="ardoise__camp${s.side === actif ? ' ardoise__camp--actif' : ''}${gagnant ? ' ardoise__camp--gagnant' : ''}">
        <span class="live__etat">${gagnant ? 'Vainqueur' : (s.side === actif ? 'Au lancer' : '&nbsp;')}</span>
        ${nomArdoise(s.side)}
        <span class="ardoise__gros">${enCours || !vue ? etat.reste[s.side] : (parCamp[s.side].some((v) => v.is_checkout) ? '✓' : (parCamp[s.side].length ? cellApres(parCamp[s.side].at(-1)) : game.start_score))}</span>
        <span class="ardoise__score">${game.sets_n ? `Sets <b>${etat.sets[s.side]}</b> · ` : ''}Manches <b>${etat.manches[s.side]}</b></span>
        <span class="ardoise__moy">Moy. ${moy}</span>
      </th>`;
  }).join('');

  const sousEntetes = sides.map(() => '<th>Volée</th><th>Reste</th>').join('');
  const depart = sides.map(() => `<td class="ardoise__volee"></td><td class="ardoise__reste ardoise__depart">${game.start_score}</td>`).join('');
  let corps = '';
  for (let i = 0; i < nbLignes; i++) {
    corps += `<tr><th class="ardoise__no">${i + 1}</th>${sides.map((s) => cellule(parCamp[s.side][i])).join('')}</tr>`;
  }

  const onglets = manches.length > 1
    ? `<div class="ardoise__onglets" role="group" aria-label="Choisir la manche">${manches.map((m) => `<button type="button" class="ardoise__onglet" aria-pressed="${m.cle === cleVue}" data-manche="${m.cle}">${libelle(m)}</button>`).join('')}</div>`
    : '';

  zone.innerHTML = `
    <p class="match__format live__format">${esc(formatPartie(game))} · finish double</p>
    ${onglets}
    <div class="ardoise-cadre">
      <table class="ardoise ardoise--${sides.length}">
        <thead>
          <tr><th class="ardoise__no"></th>${entetes}</tr>
          <tr class="ardoise__sous"><th class="ardoise__no">#</th>${sousEntetes}</tr>
        </thead>
        <tbody>
          <tr><th class="ardoise__no"></th>${depart}</tr>
          ${corps}
        </tbody>
      </table>
    </div>
    <p class="match__format">${vue ? `${libelle(vue)}${enCours ? ' en cours' : ''} · ` : ''}Le score se met à jour automatiquement à chaque volée saisie.</p>`;

  zone.querySelectorAll('[data-manche]').forEach((b) => b.addEventListener('click', () => {
    mancheChoisie = b.dataset.manche === manches.at(-1).cle ? null : b.dataset.manche;
    afficher();
  }));
}

// En double : nom de l'équipe, puis les deux joueurs en petit
function nomArdoise(side) {
  const s = game.game_sides.find((x) => x.side === side);
  const joueurs = game.game_players.filter((p) => p.side === side).sort((a, b) => a.throw_order - b.throw_order).map((p) => p.display_name);
  if (game.mode === 'double') {
    return `<span class="ardoise__nom">${esc(s?.name || joueurs.join(' / '))}</span><span class="ardoise__joueurs">${esc(joueurs.join(' · '))}</span>`;
  }
  return `<span class="ardoise__nom">${esc(nomCamp(side))}</span>`;
}

function cellApres(v) {
  return v.is_bust ? v.remaining_before : v.remaining_before - v.score;
}

// Temps réel : nouvelles volées, corrections, fin de partie
supabase
  .channel(`live-${id}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `game_id=eq.${id}` }, charger)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` }, charger)
  .subscribe();

charger();
