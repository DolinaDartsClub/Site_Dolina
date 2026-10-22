// =====================================================================
//  Score en direct d'une partie publique (accessible sans compte)
// =====================================================================

import { supabase, esc, formatPartie, etatPartie, lienJoueur } from './app.js?v=__VERSION__';

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
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, first_side, status, winner_side, game_sides(side, name, is_bot), game_players(id, side, profile_id, display_name, throw_order)')
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

// Même chose, avec chaque nom de membre cliquable vers son profil
function nomCampHtml(side) {
  const s = game.game_sides.find((x) => x.side === side);
  const joueurs = game.game_players
    .filter((p) => p.side === side)
    .sort((a, b) => a.throw_order - b.throw_order)
    .map((p) => lienJoueur(p.profile_id, esc(p.display_name)));
  if (game.mode === 'double' && s?.name) return `${esc(s.name)} (${joueurs.join(' / ')})`;
  return joueurs.join(' / ') || (s?.is_bot ? 'Dartbot' : '—');
}

// Manche affichée (null = la plus récente)
let mancheChoisie = null;
// À 3 ou 4 joueurs : joueur dont on affiche les volées (null = celui au lancer)
let campChoisi = null;

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
  const gagnantVue = voleesVue.find((v) => v.is_checkout)?.side;
  const vu = duel ? null : (sides.some((x) => x.side === campChoisi) ? campChoisi : (actif ?? gagnantVue ?? sides[0].side));
  const nbLignes = duel
    ? Math.max(ligneActive + 1, ...Object.values(parCamp).map((l) => l.length), 1)
    : Math.max(vu === actif ? ligneActive + 1 : 0, parCamp[vu].length, 1);

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
    const classes = ['plaque', s.side === actif ? 'plaque--actif' : '', gagnantPartie ? 'plaque--gagnant' : '', s.side === vu ? 'plaque--vu' : ''].join(' ');
    const choix = duel ? '' : ` role="button" tabindex="0" data-camp="${s.side}" aria-pressed="${s.side === vu}" title="Voir les volées"`;
    return `
      <div class="${classes}"${choix}>
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
      lignes += `<tr>${no}${volee(vu, i)}${reste(vu, i)}</tr>`;
    }
  }
  const tete = duel
    ? '<tr><th>Reste</th><th>Volée</th><th class="ts__no">Fl.</th><th>Volée</th><th>Reste</th></tr>'
    : '<tr><th class="ts__no">Fl.</th><th>Volée</th><th>Reste</th></tr>';

  const centre = duel ? `
      <div class="plaques__centre">
        <span class="plaques__titre">${game.sets_n ? 'Sets' : 'Manches'}</span>
        <span class="plaques__score">${game.sets_n ? `${etat.sets[sides[0].side]}<i>–</i>${etat.sets[sides[1].side]}` : `${etat.manches[sides[0].side]}<i>–</i>${etat.manches[sides[1].side]}`}</span>
        ${game.sets_n ? `<span class="plaques__titre">Manches ${etat.manches[sides[0].side]}–${etat.manches[sides[1].side]}</span>` : ''}
      </div>` : '';

  const onglets = manches.length > 1
    ? `<div class="ardoise__onglets" role="group" aria-label="Choisir la manche">${manches.map((m) => `<button type="button" class="ardoise__onglet" aria-pressed="${m.cle === cleVue}" data-manche="${m.cle}">${game.sets_n ? `S${m.set} · M${m.leg}` : `Manche ${m.leg}`}</button>`).join('')}</div>`
    : '';

  // Récapitulatif : stats de la manche affichée, en haut
  const statsManche = fini && vue ? (() => {
    const cols = sides.map((s) => s.side);
    const st = Object.fromEntries(cols.map((c) => [c, statsVolees(voleesVue, c)]));
    const l = (titre, f) => `<tr><th>${titre}</th>${cols.map((c) => `<td>${f(st[c])}</td>`).join('')}</tr>`;
    return `
    <div class="recap-cadre stats-manche">
      <table class="recap recap--${cols.length}">
        <thead><tr><th>${esc(libelle(vue))}</th>${cols.map((c) => `<th class="${gagnantVue === c ? 'recap--vainqueur' : ''}">${nomCampHtml(c)}${gagnantVue === c ? '<small>Gagne la manche</small>' : ''}</th>`).join('')}</tr></thead>
        <tbody>
          ${l('Moy. 9 premières', moy9)}
          ${l('Moyenne (3 fl.)', moy3)}
          ${l('Réussite au double', (x) => `${pctDouble(x)}<small>${x.finishs}/${x.auDouble}</small>`)}
        </tbody>
      </table>
    </div>`;
  })() : '';

  zone.innerHTML = `
    <p class="match__format live__format">${esc(formatPartie(game))} · finish double</p>
    ${onglets}
    ${statsManche}
    <div class="tablette">
      <div class="plaques plaques--${sides.length}">
        ${duel ? plaque(sides[0]) + centre + plaque(sides[1]) : sides.map(plaque).join('')}
      </div>
      <div class="tableau-score-cadre">
        ${duel ? '' : `<div class="tablette__detail"><span>Volées de <b>${nomCampHtml(vu)}</b></span><small>Touchez un joueur pour voir ses volées</small></div>`}
        <table class="tableau-score${duel ? ' tableau-score--duel' : ' tableau-score--solo'}">
          <thead>${tete}</thead>
          <tbody>${lignes}</tbody>
        </table>
      </div>
      <div class="tablette__barre">
        <span>${vue ? libelle(vue) : ''}</span>
        <span>${enCours ? 'En cours' : (fini && vue === manches.at(-1) ? 'Partie terminée' : 'Manche terminée')}</span>
      </div>
    </div>
    <p class="match__format">● a commencé la manche · ▸ au lancer · Le score se met à jour automatiquement.</p>
    ${fini ? recapitulatif(sides, ordre, manches, etat, libelle) : ''}`;

  zone.querySelectorAll('[data-camp]').forEach((p) => {
    const choisir = () => { campChoisi = Number(p.dataset.camp); afficher(); };
    p.addEventListener('click', choisir);
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choisir(); } });
  });
  zone.querySelectorAll('[data-voir-manche]').forEach((b) => b.addEventListener('click', () => {
    mancheChoisie = b.dataset.voirManche;
    campChoisi = null;
    afficher();
    document.querySelector('.tablette')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));

  zone.querySelectorAll('[data-manche]').forEach((b) => b.addEventListener('click', () => {
    mancheChoisie = b.dataset.manche === manches.at(-1).cle ? null : b.dataset.manche;
    campChoisi = null;
    afficher();
  }));
}

// ---------- Récapitulatif de fin de partie ----------

// Statistiques d'un camp sur une liste de volées
function statsVolees(liste, side) {
  const st = { points: 0, flechettes: 0, auDouble: 0, finishs: 0, cent: 0, cent40: 0, cent80: 0, meilleur: 0, meilleurFinish: 0, volees: 0, points9: 0, flechettes9: 0 };
  const parManche = {};
  for (const v of liste) {
    if (v.side !== side) continue;
    st.volees += 1;
    st.flechettes += v.is_checkout ? v.darts_used : 3;
    // 9 premières fléchettes : les 3 premières volées de chaque manche
    const cle = `${v.set_no}-${v.leg_no}`;
    parManche[cle] = (parManche[cle] || 0) + 1;
    if (parManche[cle] <= 3) {
      st.flechettes9 += v.is_checkout ? v.darts_used : 3;
      if (!v.is_bust) st.points9 += v.score;
    }
    st.auDouble += v.darts_at_double || 0;
    if (v.is_bust) continue;
    st.points += v.score;
    st.meilleur = Math.max(st.meilleur, v.score);
    if (v.score === 180) st.cent80 += 1;
    else if (v.score >= 140) st.cent40 += 1;
    else if (v.score >= 100) st.cent += 1;
    if (v.is_checkout) { st.finishs += 1; st.meilleurFinish = Math.max(st.meilleurFinish, v.remaining_before); }
  }
  return st;
}
const virgule = (n) => String(n).replace('.', ',');
const moy3 = (st) => (st.flechettes ? virgule(((st.points / st.flechettes) * 3).toFixed(1)) : '–');
const moy9 = (st) => (st.flechettes9 ? virgule(((st.points9 / st.flechettes9) * 3).toFixed(1)) : '–');
const pctDouble = (st) => (st.auDouble ? `${virgule(Math.round((st.finishs / st.auDouble) * 1000) / 10)} %` : '–');

function recapitulatif(sides, ordre, manches, etat, libelle) {
  const cols = sides.map((s) => s.side);
  const global = Object.fromEntries(cols.map((c) => [c, statsVolees(ordre, c)]));
  const ligne = (titre, f, meilleur = null) => {
    const vals = cols.map((c) => f(global[c], c));
    const max = meilleur ? Math.max(...cols.map((c) => meilleur(global[c]))) : null;
    return `<tr><th>${titre}</th>${cols.map((c, i) => `<td${meilleur && max > 0 && meilleur(global[c]) === max ? ' class="recap--top"' : ''}>${vals[i]}</td>`).join('')}</tr>`;
  };
  const entete = `<tr><th></th>${cols.map((c) => `<th class="${game.winner_side === c ? 'recap--vainqueur' : ''}">${nomCampHtml(c)}${game.winner_side === c ? '<small>Vainqueur</small>' : ''}</th>`).join('')}</tr>`;

  const tableGlobal = `
    <div class="recap-cadre"><table class="recap recap--${cols.length}">
      <thead>${entete}</thead>
      <tbody>
        ${game.sets_n ? ligne('Sets', (st, c) => etat.sets[c], (st) => 0) : ''}
        ${ligne('Manches gagnées', (st) => st.finishs, (st) => st.finishs)}
        ${ligne('Moyenne (3 fl.)', (st) => moy3(st), (st) => (st.flechettes ? st.points / st.flechettes : 0))}
        ${ligne('Moy. 9 premières', (st) => moy9(st), (st) => (st.flechettes9 ? st.points9 / st.flechettes9 : 0))}
        ${ligne('Fléchettes', (st) => st.flechettes)}
        ${ligne('100+', (st) => st.cent, (st) => st.cent)}
        ${ligne('140+', (st) => st.cent40, (st) => st.cent40)}
        ${ligne('180', (st) => st.cent80, (st) => st.cent80)}
        ${ligne('Meilleure volée', (st) => st.meilleur || '–', (st) => st.meilleur)}
        ${ligne('Meilleur finish', (st) => st.meilleurFinish || '–', (st) => st.meilleurFinish)}
        ${ligne('Réussite au double', (st) => `${pctDouble(st)}<small>${st.finishs}/${st.auDouble}</small>`, (st) => (st.auDouble ? st.finishs / st.auDouble : 0))}
      </tbody>
    </table></div>`;

  const cartesManches = manches.map((m) => {
    const liste = ordre.filter((v) => v.set_no === m.set && v.leg_no === m.leg);
    const fin = liste.find((v) => v.is_checkout);
    const lignes = cols.map((c) => {
      const st = statsVolees(liste, c);
      const der = [...liste].reverse().find((v) => v.side === c);
      const reste = !der ? game.start_score : der.is_checkout ? 0 : (der.is_bust ? der.remaining_before : der.remaining_before - der.score);
      return `<tr class="${fin?.side === c ? 'recap--vainqueur' : ''}"><th>${nomCampHtml(c)}</th><td>${moy9(st)}</td><td>${moy3(st)}</td><td>${pctDouble(st)}</td><td>${fin?.side === c ? `✓ ${fin.remaining_before}` : reste}</td></tr>`;
    }).join('');
    return `
      <article class="recap-manche">
        <header>
          <strong>${libelle(m)}</strong>
          <span>${fin ? `${nomCampHtml(fin.side)} · ${statsVolees(liste, fin.side).flechettes} fléchettes · finish ${fin.remaining_before}` : 'Non terminée'}</span>
        </header>
        <table class="recap recap--manche">
          <thead><tr><th></th><th title="Moyenne des 9 premières fléchettes">9 prem.</th><th title="Moyenne 3 fléchettes">Moy.</th><th title="Réussite au double">Double</th><th>Reste</th></tr></thead>
          <tbody>${lignes}</tbody>
        </table>
        <button type="button" class="bouton bouton--petit" data-voir-manche="${m.cle}">Voir les volées</button>
      </article>`;
  }).join('');

  return `
    <section class="section recap-section">
      <h2 class="section__titre">Récapitulatif de la partie</h2>
      ${tableGlobal}
      <p class="match__format">En orange : le meilleur de la partie. Réussite au double = finishs ÷ fléchettes lancées au double.</p>
    </section>
    <section class="section recap-section">
      <h2 class="section__titre">Récapitulatif par manche</h2>
      <div class="recap-manches">${cartesManches}</div>
    </section>`;
}

// Nom sur la plaque ; en double : équipe puis joueurs en petit
function nomPlaque(side) {
  const s = game.game_sides.find((x) => x.side === side);
  const joueurs = game.game_players.filter((p) => p.side === side).sort((a, b) => a.throw_order - b.throw_order).map((p) => p.display_name);
  if (game.mode === 'double') {
    const liens = game.game_players.filter((p) => p.side === side).sort((a, b) => a.throw_order - b.throw_order).map((p) => lienJoueur(p.profile_id, esc(p.display_name)));
    return `<span>${esc(s?.name || joueurs.join(' / '))}</span><small>${liens.join(' · ')}</small>`;
  }
  return `<span>${nomCampHtml(side)}</span>`;
}

// Temps réel : nouvelles volées, corrections, fin de partie
supabase
  .channel(`live-${id}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'visits', filter: `game_id=eq.${id}` }, charger)
  .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` }, charger)
  .subscribe();

charger();
