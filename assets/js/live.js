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

// Manche affichée (null = la plus récente)
let mancheChoisie = null;

// Présentation inspirée des tablettes de score de compétition :
// plaques des joueurs en haut (reste en gros), puis une colonne de volées par joueur
function afficher() {
  const sides = [...game.game_sides].sort((a, b) => a.side - b.side);
  const ordre = [...visits].sort((a, b) => a.id - b.id);
  const etat = etatPartie(game, sides, ordre);
  const fini = game.status !== 'live';
  const duel = sides.length === 2;

  format.textContent = formatPartie(game) + ' · finish double';
  badge.textContent = fini ? (game.status === 'finished' ? 'TERMINÉ' : 'INTERROMPU') : 'EN DIRECT';
  badge.className = 'live__badge' + (fini ? ' live__badge--fini' : '');

  // Manches jouées, dans l'ordre
  const manches = [];
  for (const v of ordre) {
    const cle = `${v.set_no}-${v.leg_no}`;
    if (!manches.find((m) => m.cle === cle)) manches.push({ cle, set: v.set_no, leg: v.leg_no });
  }
  const cleCourante = `${etat.setCourant}-${etat.mancheCourante}`;
  if (!fini && !manches.find((m) => m.cle === cleCourante)) manches.push({ cle: cleCourante, set: etat.setCourant, leg: etat.mancheCourante });
  const cleVue = mancheChoisie && manches.find((m) => m.cle === mancheChoisie) ? mancheChoisie : manches.at(-1)?.cle;
  const vue = manches.find((m) => m.cle === cleVue);
  const enCours = !!vue && vue.cle === cleCourante && !fini;
  const libelle = (m) => (game.sets_n ? `Set ${m.set} · Manche ${m.leg}` : `Manche ${m.leg}`);

  // Volées de la manche affichée, par camp
  const parCamp = Object.fromEntries(sides.map((s) => [s.side, []]));
  const voleesVue = ordre.filter((v) => vue && v.set_no === vue.set && v.leg_no === vue.leg);
  voleesVue.forEach((v) => parCamp[v.side]?.push(v));
  const debutant = enCours ? etat.debutManche : voleesVue[0]?.side;
  const actif = enCours ? etat.auLancer : null;
  const ligneActive = actif ? parCamp[actif].length : -1;
  const nbLignes = Math.max(ligneActive + 1, ...Object.values(parCamp).map((l) => l.length), 1);

  // Reste affiché sur la plaque : en direct, ou à la fin de la manche consultée
  const resteVue = (side) => {
    if (enCours) return etat.reste[side];
    const l = parCamp[side];
    if (!l.length) return game.start_score;
    const d = l.at(-1);
    return d.is_checkout ? 0 : (d.is_bust ? d.remaining_before : d.remaining_before - d.score);
  };
  const moy = (side) => {
    const st = etat.stats[side];
    return st && st.flechettes ? String(Math.round((st.points / st.flechettes) * 30) / 10).replace('.', ',') : '–';
  };

  const plaque = (s) => {
    const gagnantPartie = fini && game.winner_side === s.side;
    const gagnantManche = parCamp[s.side].some((v) => v.is_checkout);
    const classes = ['plaque', s.side === actif ? 'plaque--actif' : '', gagnantPartie ? 'plaque--gagnant' : ''].join(' ');
    return `
      <div class="${classes}">
        <div class="plaque__nom">${nomPlaque(s.side)}</div>
        <div class="plaque__reste">${gagnantManche && !enCours ? '✓' : resteVue(s.side)}</div>
        <div class="plaque__infos">
          ${duel ? '' : `<span>${game.sets_n ? `S <b>${etat.sets[s.side]}</b> · ` : ''}M <b>${etat.manches[s.side]}</b></span>`}
          <span>Moy. ${moy(s.side)}</span>
          ${gagnantPartie ? '<span class="plaque__vainqueur">Vainqueur</span>' : ''}
        </div>
      </div>`;
  };

  const marque = (side, i) => {
    let m = '';
    if (i === 0 && side === debutant) m += '<i class="tableau-score__debut" title="A commencé la manche">●</i>';
    if (side === actif && i === ligneActive) m += '<i class="tableau-score__fleche" title="Au lancer">▸</i>';
    return m;
  };
  const qui = (v) => {
    if (game.mode !== 'double' || !v?.player_id) return '';
    const p = game.game_players.find((x) => x.id === v.player_id);
    return p ? `<small>${esc(p.display_name)}</small>` : '';
  };
  const volee = (side, i) => {
    const v = parCamp[side][i];
    if (!v) return `<td class="ts__volee">${marque(side, i)}</td>`;
    const cl = v.is_checkout ? ' ts--finish' : v.is_bust ? ' ts--bust' : v.score === 180 ? ' ts--180' : v.score >= 100 ? ' ts--ton' : '';
    return `<td class="ts__volee${cl}">${marque(side, i)}<span>${v.is_bust ? 'Bust' : v.score}</span>${qui(v)}</td>`;
  };
  const reste = (side, i) => {
    const v = parCamp[side][i];
    if (!v) return '<td class="ts__reste"></td>';
    if (v.is_checkout) return `<td class="ts__reste ts--finish-reste">✓ ${v.darts_used} fl.</td>`;
    return `<td class="ts__reste">${v.is_bust ? v.remaining_before : v.remaining_before - v.score}</td>`;
  };

  let lignes = '';
  for (let i = 0; i < nbLignes; i++) {
    const no = `<th class="ts__no">${(i + 1) * 3}</th>`;
    if (duel) {
      const [a, b] = sides.map((s) => s.side);
      lignes += `<tr>${reste(a, i)}${volee(a, i)}${no}${volee(b, i)}${reste(b, i)}</tr>`;
    } else {
      lignes += `<tr>${no}${sides.map((s) => volee(s.side, i) + reste(s.side, i)).join('')}</tr>`;
    }
  }
  const tete = duel
    ? '<tr><th>Reste</th><th>Volée</th><th class="ts__no">Fl.</th><th>Volée</th><th>Reste</th></tr>'
    : `<tr><th class="ts__no">Fl.</th>${sides.map(() => '<th>Volée</th><th>Reste</th>').join('')}</tr>`;

  const centre = duel ? `
      <div class="plaques__centre">
        <span class="plaques__titre">${game.sets_n ? 'Sets' : 'Manches'}</span>
        <span class="plaques__score">${game.sets_n ? `${etat.sets[sides[0].side]}<i>–</i>${etat.sets[sides[1].side]}` : `${etat.manches[sides[0].side]}<i>–</i>${etat.manches[sides[1].side]}`}</span>
        ${game.sets_n ? `<span class="plaques__titre">Manches ${etat.manches[sides[0].side]}–${etat.manches[sides[1].side]}</span>` : ''}
      </div>` : '';

  const onglets = manches.length > 1
    ? `<div class="ardoise__onglets" role="group" aria-label="Choisir la manche">${manches.map((m) => `<button type="button" class="ardoise__onglet" aria-pressed="${m.cle === cleVue}" data-manche="${m.cle}">${game.sets_n ? `S${m.set} · M${m.leg}` : `Manche ${m.leg}`}</button>`).join('')}</div>`
    : '';

  zone.innerHTML = `
    <p class="match__format live__format">${esc(formatPartie(game))} · finish double</p>
    <div class="tablette">
      <div class="plaques plaques--${sides.length}">
        ${duel ? plaque(sides[0]) + centre + plaque(sides[1]) : sides.map(plaque).join('')}
      </div>
      <div class="tableau-score-cadre">
        <table class="tableau-score${duel ? ' tableau-score--duel' : ` tableau-score--${sides.length}`}">
          <thead>${tete}</thead>
          <tbody>${lignes}</tbody>
        </table>
      </div>
      <div class="tablette__barre">
        <span>${vue ? libelle(vue) : ''}</span>
        <span>${enCours ? 'En cours' : (fini && vue === manches.at(-1) ? 'Partie terminée' : 'Manche terminée')}</span>
      </div>
    </div>
    ${onglets}
    <p class="match__format">● a commencé la manche · ▸ au lancer · Le score se met à jour automatiquement.</p>`;

  zone.querySelectorAll('[data-manche]').forEach((b) => b.addEventListener('click', () => {
    mancheChoisie = b.dataset.manche === manches.at(-1).cle ? null : b.dataset.manche;
    afficher();
  }));
}

// Nom sur la plaque ; en double : équipe puis joueurs en petit
function nomPlaque(side) {
  const s = game.game_sides.find((x) => x.side === side);
  const joueurs = game.game_players.filter((p) => p.side === side).sort((a, b) => a.throw_order - b.throw_order).map((p) => p.display_name);
  if (game.mode === 'double') {
    return `<span>${esc(s?.name || joueurs.join(' / '))}</span><small>${esc(joueurs.join(' · '))}</small>`;
  }
  return `<span>${esc(nomCamp(side))}</span>`;
}

// Temps réel : nouvelles volées, corrections, fin de partie
supabase
  .channel(`live-${id}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `game_id=eq.${id}` }, charger)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` }, charger)
  .subscribe();

charger();
