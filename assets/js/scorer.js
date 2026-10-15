// =====================================================================
//  Scorer X01 : saisie des volées, enregistrement en direct, fin de partie
//  Les règles de calcul sont dans x01.js (testées automatiquement).
//  Chaque volée est affichée tout de suite, puis enregistrée dans la base
//  dans l'ordre ; si l'enregistrement échoue, la volée est retirée et
//  un message demande de la ressaisir.
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, formatPartie, supprimerPartie } from './app.js?v=__VERSION__';
import {
  calculerEtat, nouvelleVolee, verifierVolee, natureVolee, finissable, suggestionFinish, moyenne,
} from './x01.js?v=__VERSION__';

const id = new URLSearchParams(location.search).get('id');
const $ = (s) => document.getElementById(s);
const zoneMsg = $('message');

let game = null;
let camps = [];           // numéros des camps
let nomsCamps = {};       // side -> nom affiché
let joueursCamps = {};    // side -> [noms des joueurs dans l'ordre de lancer]
let visits = [];
let etat = null;
let saisie = '';
let enAttente = null;     // volée en cours de confirmation (questions finish / double)
let file = Promise.resolve();
let prochainIdLocal = 1;
let tournoi = null;        // match de tournoi : { match_no, status, tournament_id, nom }

// ---------- Chargement ----------

async function init() {
  const moi = await profilConnecte();
  if (!moi) return location.replace('connexion.html');
  const { data, error } = await supabase
    .from('games')
    .select('*, game_sides(side, name, is_bot), game_players(id, side, display_name, throw_order, profile_id)')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    $('titre-format').textContent = 'Partie introuvable';
    return message(zoneMsg, 'Cette partie n\'existe pas ou vous n\'y avez pas accès.');
  }
  if (data.created_by !== moi.id && moi.role !== 'admin') {
    // Seul le créateur de la partie saisit les scores : les autres la suivent en direct
    return location.replace(`live.html?id=${encodeURIComponent(id)}`);
  }
  game = data;
  camps = game.game_sides.map((s) => s.side).sort((a, b) => a - b);
  for (const s of camps) {
    const joueurs = game.game_players.filter((p) => p.side === s).sort((a, b) => a.throw_order - b.throw_order);
    joueursCamps[s] = joueurs.map((p) => p.display_name);
    const camp = game.game_sides.find((x) => x.side === s);
    nomsCamps[s] = game.mode === 'double' && camp?.name ? camp.name : joueursCamps[s].join(' / ');
  }

  const res = await supabase.from('visits').select('*').eq('game_id', id).order('id');
  visits = res.data || [];
  prochainIdLocal = (visits.at(-1)?.id || 0) + 1;

  $('titre-format').textContent = `${formatPartie(game)} · finish double`;
  // Guide de finish masqué si le créateur l'a choisi
  document.querySelector('.scorer__finish').hidden = game.show_checkout === false;
  $('fin-live').href = `live.html?id=${encodeURIComponent(id)}`;
  if (game.tournament_match_id) await chargerTournoi();
  document.body.classList.toggle('scorer--nombreux', camps.length > 2);
  construirePave();
  rafraichir();

  if (game.status === 'abandoned') {
    message(zoneMsg, 'Cette partie a été abandonnée : elle ne peut plus être reprise.');
    $('scorer').classList.add('scorer--fige');
  }
  garderEcranAllume();
}

// ---------- Affichage ----------

function rafraichir() {
  etat = calculerEtat(game, camps, visits);
  const titreManche = `${game.sets_n ? `Set ${etat.set} · ` : ''}Manche ${etat.manche}`;
  $('titre-manche').textContent = etat.gagnant ? 'Partie terminée' : titreManche;

  $('camps').innerHTML = camps.length > 2 ? campsNombreux() : camps.map((s) => carteCamp(s)).join('');

  const reste = etat.auLancer ? etat.reste[etat.auLancer] : null;
  const sugg = reste !== null ? suggestionFinish(reste) : null;
  $('finish').textContent = sugg ? sugg.join(' · ') : (reste === null ? '—' : (reste > 170 ? 'Pas encore' : 'Pas de finish en une volée'));
  $('qui').textContent = etat.auLancer ? `Volée de ${nomsCamps[etat.auLancer]}` : 'Partie terminée';
  $('saisie').textContent = saisie || '0';

  if (etat.gagnant && game.status !== 'abandoned') afficherFin();
}

// Carte complète d'un camp
function carteCamp(s, volees = false) {
  const st = etat.stats[s];
  const actif = etat.auLancer === s;
  const moy = moyenne(st);
  const lanceur = game.mode === 'double' && joueursCamps[s].length > 1
    ? joueursCamps[s][etat.voleesTotal[s] % joueursCamps[s].length] : null;
  const detail = volees ? etat.historique.filter((v) => v.side === s) : [];
  return `
    <article class="camp${actif ? ' camp--actif' : ''}${etat.gagnant === s ? ' camp--gagnant' : ''}">
      <div class="camp__entete">
        <span class="camp__nom">${esc(nomsCamps[s])}</span>
        ${actif ? '<span class="camp__badge">Au lancer</span>' : (etat.debutManche === s && !etat.gagnant ? '<span class="camp__debut" title="A commencé la manche">●</span>' : '')}
      </div>
      ${lanceur ? `<span class="camp__lanceur">${actif ? 'Lance : ' : 'Prochain : '}${esc(lanceur)}</span>` : ''}
      <span class="camp__reste">${etat.reste[s]}</span>
      <div class="camp__stats">
        <span><small>Manches</small><b class="orange">${etat.manches[s]}</b></span>
        ${game.sets_n ? `<span><small>Sets</small><b class="orange">${etat.sets[s]}</b></span>` : ''}
        <span><small>Moyenne</small><b>${moy === null ? '–' : moy.toLocaleString('fr-FR')}</b></span>
        <span><small>Dernière</small><b>${st.derniere ?? '–'}</b></span>
      </div>
      ${volees ? `<div class="camp__volees">${detail.length
        ? detail.map((v) => `<span class="${v.is_bust ? 'bust' : (v.score >= 100 ? 'ton' : '')}">${v.is_bust ? 'Bust' : v.score}</span>`).join('')
        : '<em>Première volée de la manche</em>'}</div>` : ''}
    </article>`;
}

// 3 ou 4 joueurs : le détail du joueur au lancer, les autres en résumé
function campsNombreux() {
  const focus = etat.auLancer || etat.gagnant || camps[0];
  const i = camps.indexOf(focus);
  const autres = [...camps.slice(i + 1), ...camps.slice(0, i)];
  const lignes = autres.map((s, k) => `
    <div class="mini-camp${etat.gagnant === s ? ' mini-camp--gagnant' : ''}">
      <span class="mini-camp__nom">${etat.debutManche === s && !etat.gagnant ? '<i title="A commencé la manche">●</i> ' : ''}${esc(nomsCamps[s])}${k === 0 && etat.auLancer ? ' <span class="mini-camp__suivant">Suivant</span>' : ''}</span>
      <span class="mini-camp__manches">M <b>${etat.manches[s]}</b>${game.sets_n ? ` · S <b>${etat.sets[s]}</b>` : ''}</span>
      <b class="mini-camp__reste">${etat.reste[s]}</b>
    </div>`).join('');
  return `${carteCamp(focus, true)}<div class="mini-camps">${lignes}</div>`;
}

function afficherEvenement(texte) {
  const ev = $('evenement');
  ev.textContent = texte;
  ev.classList.remove('flash');
  void ev.offsetWidth;
  ev.classList.add('flash');
}

// ---------- Match de tournoi ----------

async function chargerTournoi() {
  const { data } = await supabase.from('tournament_matches')
    .select('id, match_no, status, tournament_id, tournaments(name)')
    .eq('id', game.tournament_match_id).maybeSingle();
  if (!data) return;
  tournoi = { match_no: data.match_no, status: data.status, tournament_id: data.tournament_id, nom: data.tournaments?.name || 'Tournoi' };
  const lien = `tournoi.html?id=${encodeURIComponent(tournoi.tournament_id)}`;
  $('btn-quitter').href = lien;
  $('btn-quitter').setAttribute('aria-label', 'Retour au tournoi (le match reste en cours)');
  $('fin-tournoi').href = lien;
  $('titre-format').textContent = `${tournoi.nom} · M${tournoi.match_no} · ${formatPartie(game)}`;
  if (tournoi.status === 'done') resultatValide();
}

function resultatValide() {
  tournoi.status = 'done';
  $('scorer').classList.add('scorer--fige');
  $('btn-annuler').hidden = true;
  $('btn-abandon').hidden = true;
  $('fin-valider').hidden = true;
  $('fin-annuler').hidden = true;
  $('fin-tournoi').hidden = false;
  $('fin-texte').textContent = 'Résultat validé : le tournoi est à jour. En cas d\'erreur, contactez l\'organisateur.';
}

$('fin-valider').addEventListener('click', async () => {
  const bouton = $('fin-valider');
  if (bouton.disabled) return;
  bouton.disabled = true;                    // pas de double validation
  await file;                                // dernières volées bien enregistrées
  const { error } = await supabase.rpc('valider_match_tournoi', { p_game: id });
  bouton.disabled = false;
  if (error) return message(zoneMsg, `Le résultat n'a pas été validé : ${erreurFr(error)}`);
  resultatValide();
});

function afficherFin() {
  if (tournoi) {
    $('fin-nouvelle').hidden = true;
    const valide = tournoi.status === 'done';
    $('fin-valider').hidden = valide;
    $('fin-tournoi').hidden = !valide;
    $('fin-annuler').hidden = valide;
    if (!valide) $('fin-texte').textContent = 'Vérifiez le score puis validez : le résultat sera enregistré dans le tournoi.';
  }
  $('fin-gagnant').textContent = `${nomsCamps[etat.gagnant]} gagne ${game.sets_n
    ? camps.map((s) => etat.sets[s]).join(' – ') + ' (sets)'
    : camps.map((s) => etat.manches[s]).join(' – ')}`;
  $('fen-fin').hidden = false;
}

// ---------- Pavé numérique ----------

function construirePave() {
  $('raccourcis').innerHTML = [0, 26, 41, 45, 60, 81, 85, 100, 140, 180]
    .map((n) => `<button type="button" class="touche touche--raccourci" data-score="${n}">${n}</button>`).join('');
  $('pave').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((c) => `<button type="button" class="touche" data-chiffre="${c}">${c}</button>`).join('')
    + '<button type="button" class="touche touche--effacer" data-effacer>Effacer</button>'
    + '<button type="button" class="touche" data-chiffre="0">0</button>'
    + '<button type="button" class="touche touche--valider" data-valider>Valider</button>';
}

function saisir(c) {
  if (saisie.length >= 3) return;
  saisie = saisie === '0' ? c : saisie + c;
  $('erreur').textContent = '';
  $('saisie').textContent = saisie;
}

document.querySelector('.scorer__saisie').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !etat || etat.gagnant || game.status === 'abandoned') return;
  if (b.dataset.chiffre) saisir(b.dataset.chiffre);
  else if ('effacer' in b.dataset) { saisie = ''; $('saisie').textContent = '0'; $('erreur').textContent = ''; }
  else if ('valider' in b.dataset) { if (saisie !== '') valider(Number(saisie)); }
  else if (b.dataset.score) valider(Number(b.dataset.score));
});

// Clavier (ordinateur) : chiffres, Entrée, Retour arrière
document.addEventListener('keydown', (e) => {
  if (!etat || etat.gagnant || e.target.closest('input, textarea')) return;
  if (!document.querySelectorAll('.fenetre:not([hidden])').length) {
    if (/^[0-9]$/.test(e.key)) saisir(e.key);
    else if (e.key === 'Enter' && saisie !== '') valider(Number(saisie));
    else if (e.key === 'Backspace') { saisie = saisie.slice(0, -1); $('saisie').textContent = saisie || '0'; }
  }
});

// ---------- Validation d'une volée ----------

function valider(score) {
  const side = etat.auLancer;
  const reste = etat.reste[side];
  const probleme = verifierVolee(score, reste);
  if (probleme) {
    $('erreur').textContent = probleme;
    saisie = '';
    $('saisie').textContent = '0';
    return;
  }
  const nature = natureVolee(score, reste);
  enAttente = { score, reste, nature, detail: {} };

  if (nature === 'finish') {
    // Nombre minimum de fléchettes possible pour finir ce reste
    const mini = suggestionFinish(reste)?.length || 1;
    $('choix-finish').innerHTML = [1, 2, 3].filter((n) => n >= mini)
      .map((n) => `<button type="button" class="bouton bouton--plein touche-choix" data-flechettes="${n}">${n}</button>`).join('');
    $('fen-finish').hidden = false;
  } else if (reste <= 50 || reste - score <= 50) {
    // Le reste est passé à 50 ou moins pendant la volée (avant ou après) :
    // des fléchettes ont pu être lancées sur un double
    demanderDouble(0, 3);
  } else {
    enregistrer();
  }
}

function demanderDouble(min, max) {
  $('aide-double').textContent = enAttente.nature === 'finish'
    ? 'Y compris la fléchette du finish.'
    : `${enAttente.nature === 'bust' || enAttente.reste <= 50 ? `Reste ${enAttente.reste}` : `De ${enAttente.reste} à ${enAttente.reste - enAttente.score}`} : fléchettes lancées sur un double pendant cette volée.`;
  const options = [];
  for (let n = min; n <= max; n++) options.push(n);
  $('choix-double').innerHTML = options
    .map((n) => `<button type="button" class="bouton bouton--plein touche-choix" data-double="${n}">${n}</button>`).join('');
  $('fen-double').hidden = false;
}

$('choix-finish').addEventListener('click', (e) => {
  const b = e.target.closest('[data-flechettes]');
  if (!b) return;
  enAttente.detail.flechettes = Number(b.dataset.flechettes);
  $('fen-finish').hidden = true;
  // Fléchettes au double : au moins 1 (celle du finish)
  demanderDouble(1, enAttente.detail.flechettes);
});

$('choix-double').addEventListener('click', (e) => {
  const b = e.target.closest('[data-double]');
  if (!b) return;
  enAttente.detail.auDouble = Number(b.dataset.double);
  $('fen-double').hidden = true;
  enregistrer();
});

document.querySelectorAll('[data-annuler-saisie]').forEach((b) => b.addEventListener('click', () => {
  enAttente = null;
  saisie = '';
  document.querySelectorAll('#fen-finish, #fen-double').forEach((f) => { f.hidden = true; });
  rafraichir();
}));

// ---------- Enregistrement (dans l'ordre, sans bloquer la saisie) ----------

function enregistrer() {
  const { score, nature, detail } = enAttente;
  enAttente = null;
  saisie = '';
  const v = { id: prochainIdLocal++, ...nouvelleVolee(etat, score, detail), local: true };
  visits.push(v);
  const avant = etat;
  rafraichir();

  if (nature === 'bust') afficherEvenement('Bust : la volée vaut 0');
  else if (etat.gagnant) afficherEvenement('Game shot and the match');
  else if (nature === 'finish') afficherEvenement(`Game shot ! ${nomsCamps[v.side]} remporte la manche`);
  else afficherEvenement('');

  const finDePartie = !!etat.gagnant;
  const gagnant = etat.gagnant;
  file = file.then(async () => {
    const { local, id: idLocal, ...donnees } = v;
    const { data, error } = await supabase.from('visits').insert({ game_id: id, ...donnees }).select('id').single();
    if (error) {
      visits = visits.filter((x) => x !== v);
      rafraichir();
      message(zoneMsg, `La volée de ${score} n'a pas été enregistrée (${erreurFr(error)}). Ressaisissez-la.`);
      return;
    }
    v.id = data.id;
    delete v.local;
    if (finDePartie) {
      const r = await supabase.from('games').update({ status: 'finished', winner_side: gagnant, finished_at: new Date().toISOString() }).eq('id', id);
      if (!r.error) game.status = 'finished';
    }
  });
  void avant;
}

// ---------- Annuler la dernière volée ----------

async function annuler() {
  await file;
  const v = visits.at(-1);
  if (!v) return;
  const { error } = await supabase.from('visits').delete().eq('id', v.id);
  if (error) return message(zoneMsg, `Impossible d'annuler la volée : ${erreurFr(error)}`);
  visits.pop();
  if (game.status === 'finished') {
    await supabase.from('games').update({ status: 'live', winner_side: null, finished_at: null }).eq('id', id);
    game.status = 'live';
    game.winner_side = null;
  }
  $('fen-fin').hidden = true;
  saisie = '';
  afficherEvenement(`Volée annulée : ${v.is_bust ? 'bust' : v.score}`);
  rafraichir();
}

$('btn-annuler').addEventListener('click', annuler);
$('fin-annuler').addEventListener('click', annuler);

// ---------- Abandon ----------

$('btn-abandon').addEventListener('click', async () => {
  const texte = tournoi
    ? 'Abandonner ce match de tournoi ? La partie sera effacée et le match redeviendra « à jouer ».'
    : 'Abandonner la partie ? Elle sera supprimée définitivement, avec tous ses scores.';
  if (!confirm(texte)) return;
  await file;
  await supprimerPartie(id);
  location.href = tournoi ? `tournoi.html?id=${encodeURIComponent(tournoi.tournament_id)}` : 'jouer.html';
});

// ---------- Écran toujours allumé (tablette posée près de la cible) ----------

async function garderEcranAllume() {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => {});
      });
    }
  } catch { /* non disponible : sans importance */ }
}

init();
