// =====================================================================
//  Scorer X01 : saisie des volées, enregistrement en direct, fin de partie
//  Les règles de calcul sont dans x01.js (testées automatiquement).
//  Chaque volée est affichée tout de suite, puis enregistrée dans la base
//  dans l'ordre ; si l'enregistrement échoue, la volée est retirée et
//  un message demande de la ressaisir.
// =====================================================================

import { voleeBot, lireReglageBot } from './dartbot.js?v=__VERSION__';
import { valeurFleche, cheminConseille } from './compter-calcul.js?v=__VERSION__';
import { reglageVoix, definirVoix, voixDisponible, annoncerVolee, dire } from './voix.js?v=__VERSION__';
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
let moi = null;
let botSide = null;       // camp du dartbot (partie contre le bot)
let reglageBot = null;
let minuterieBot = null;
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
  moi = await profilConnecte();
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

  const campBot = game.game_sides.find((x) => x.is_bot);
  if (campBot) {
    botSide = campBot.side;
    reglageBot = lireReglageBot(campBot.name);
  }

  const res = await supabase.from('visits').select('*').eq('game_id', id).order('id');
  visits = res.data || [];
  prochainIdLocal = (visits.at(-1)?.id || 0) + 1;

  $('titre-format').textContent = botSide
    ? `${formatPartie(game)} · bot : moy. ${reglageBot.moyenne}, doubles ${reglageBot.doubles} %`
    : `${formatPartie(game)} · finish double`;
  // Guide de finish masqué si le créateur l'a choisi
  document.querySelector('.scorer__finish').hidden = game.show_checkout === false;
  $('fin-live').href = `live.html?id=${encodeURIComponent(id)}`;
  if (game.tournament_match_id) await chargerTournoi();
  else if (game.feuille_match_id) await chargerFeuille();
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
  // Guide de finish : de préférence sur D20, D16, D10, D8, D12, D18, D6 ou D4 (meilleure descente)
  const sugg = reste !== null ? cheminConseille(reste)?.chemin : null;
  $('finish').textContent = sugg ? sugg.join(' · ') : (reste === null ? '—' : (reste > 170 ? 'Pas encore' : 'Pas de finish en une volée'));
  $('qui').textContent = etat.auLancer ? (tourDuBot() ? 'Le dartbot lance…' : `Volée de ${nomsCamps[etat.auLancer]}`) : 'Partie terminée';
  $('saisie').textContent = saisie || '0';
  document.body.classList.toggle('scorer--tour-bot', tourDuBot());
  planifierBot();

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
        <span title="Fléchettes lancées dans cette manche"><small>Fléchettes</small><b>${etat.flechettesManche?.[s] ?? 0}</b></span>
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

// Nom prononcé : le joueur qui va lancer (en double, celui du camp dont c'est le tour)
function nomVoix(side) {
  const j = joueursCamps[side] || [];
  if (game.mode === 'double' && j.length > 1) return j[etat.voleesTotal[side] % j.length];
  return nomsCamps[side];
}

// Bouton haut-parleur : coupé → français → anglais → coupé
function majBoutonVoix() {
  const b = $('btn-voix');
  if (!b) return;
  if (!voixDisponible()) { b.hidden = true; return; }
  const r = reglageVoix();
  b.classList.toggle('bouton--plein', r.actif);
  b.querySelector('span').textContent = r.actif ? (r.langue === 'en' ? 'EN' : 'FR') : '';
  b.setAttribute('aria-label', r.actif ? `Annonce vocale en ${r.langue === 'en' ? 'anglais' : 'français'} (toucher pour changer)` : 'Annonce vocale coupée (toucher pour l\'activer)');
  b.title = b.getAttribute('aria-label');
}
$('btn-voix')?.addEventListener('click', () => {
  const r = reglageVoix();
  const suivant = !r.actif ? { actif: true, langue: 'fr' } : (r.langue === 'fr' ? { actif: true, langue: 'en' } : { actif: false, langue: 'fr' });
  definirVoix(suivant);
  majBoutonVoix();
  if (suivant.actif) dire(suivant.langue === 'en' ? 'Game on!' : 'Annonce vocale activée.', suivant.langue);
  else if (voixDisponible()) window.speechSynthesis.cancel();
});
majBoutonVoix();

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

// ---------- Match d'une feuille de match CPARD (script 056) ----------
// Même déroulé qu'un match de tournoi : validation puis retour à la feuille
async function chargerFeuille() {
  const { data } = await supabase.rpc('feuille_de_partie', { p_game: id });
  if (!data) return;
  tournoi = { feuille: true, match_no: data.numero, status: data.statut === 'termine' ? 'done' : 'live', feuille_id: data.feuille_id, nom: 'Feuille de match' };
  const lien = `feuille.html?id=${encodeURIComponent(data.feuille_id)}`;
  $('btn-quitter').href = lien;
  $('btn-quitter').setAttribute('aria-label', 'Retour à la feuille de match (le match reste en cours)');
  $('fin-tournoi').href = lien;
  $('fin-tournoi').textContent = 'Retour à la feuille de match';
  $('titre-format').textContent = `CPARD · Match #${data.numero} · 501, 3 manches`;
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
  $('fin-texte').textContent = tournoi.feuille
    ? 'Résultat reporté sur la feuille de match. En cas d\'erreur, le capitaine peut remettre le match à jouer.'
    : 'Résultat validé : le tournoi est à jour. En cas d\'erreur, contactez l\'organisateur.';
}

$('fin-valider').addEventListener('click', async () => {
  const bouton = $('fin-valider');
  if (bouton.disabled) return;
  bouton.disabled = true;                    // pas de double validation
  await file;                                // dernières volées bien enregistrées
  const { error } = await supabase.rpc(tournoi?.feuille ? 'valider_match_feuille' : 'valider_match_tournoi', { p_game: id });
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
    if (!valide) $('fin-texte').textContent = `Vérifiez le score puis validez : le résultat sera enregistré ${tournoi.feuille ? 'sur la feuille de match' : 'dans le tournoi'}.`;
  }
  // Score du gagnant en premier (« Dartbot gagne 2 – 0 »)
  const ordre = camps.length === 2 ? [etat.gagnant, ...camps.filter((c) => c !== etat.gagnant)] : camps;
  const compte = game.sets_n ? etat.sets : etat.manches;
  $('fin-gagnant').textContent = `${nomsCamps[etat.gagnant]} gagne ${ordre.map((c) => compte[c]).join(' – ')}${game.sets_n ? ' (sets)' : ''}`;

  // Victoire ou défaite, du point de vue de celui qui tient le scorer (s'il joue)
  const monCamp = game.game_players.find((p) => p.profile_id && p.profile_id === moi?.id)?.side;
  const boite = $('fen-fin').querySelector('.fenetre__boite');
  boite.classList.remove('fin--victoire', 'fin--defaite');
  $('fin-resultat').hidden = !monCamp;
  if (monCamp) {
    const gagne = monCamp === etat.gagnant;
    boite.classList.add(gagne ? 'fin--victoire' : 'fin--defaite');
    $('fin-mot').textContent = gagne ? 'Victoire !' : 'Défaite';
    $('fin-icone').innerHTML = gagne
      ? '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 7h18v10a9 9 0 0 1-18 0z"/><path d="M15 11H8v3a7 7 0 0 0 7 7M33 11h7v3a7 7 0 0 1-7 7"/><path d="M24 26v8M17 41h14M19 41l1-7h8l1 7"/></svg>'
      : '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="3"/><path d="M38 10 30 18"/><path d="M38 10l1-5M38 10l5-1"/></svg>';
  }
  $('fen-fin').hidden = false;
}

// ---------- Pavé numérique ----------

function construirePave() {
  // Raccourcis sur les côtés du pavé : scores fréquents à gauche, gros scores à droite
  const raccourci = (n) => `<button type="button" class="touche touche--raccourci" data-score="${n}">${n}</button>`;
  $('raccourcis-g').innerHTML = [26, 41, 45, 57, 60].map(raccourci).join('');
  $('raccourcis-d').innerHTML = [81, 85, 100, 140, 180].map(raccourci).join('');
  $('pave').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((c) => `<button type="button" class="touche" data-chiffre="${c}">${c}</button>`).join('')
    + '<button type="button" class="touche touche--effacer" data-effacer>Effacer</button>'
    + '<button type="button" class="touche" data-chiffre="0">0</button>'
    + '<button type="button" class="touche touche--valider" data-valider title="Appui long (3 s) : le nombre saisi est le reste après la volée">Valider</button>';
  erreurSaisie('');
}

// Message sous la saisie : une erreur, ou à défaut l'astuce de l'appui long
function erreurSaisie(texte) {
  const z = $('erreur');
  z.classList.toggle('ecran-saisie__erreur--astuce', !texte);
  z.textContent = texte || 'Sans saisie : 0 · Appui long sur Valider : saisir le reste';
}

// Valider : sans saisie, la volée vaut 0 ; si le nombre saisi est le reste (appui long), on en déduit le score
function validerSaisie(estReste = false) {
  if (!estReste) return valider(saisie === '' ? 0 : Number(saisie));
  const reste = etat.reste[etat.auLancer];
  const apres = Number(saisie);
  if (saisie === '') return erreurSaisie('Tapez le reste, puis gardez le doigt sur Valider.');
  const score = reste - apres;
  if (apres === 1 || score < 0 || score > 180) {
    saisie = ''; $('saisie').textContent = '0';
    return erreurSaisie(`Il ne peut pas rester ${apres} : il restait ${reste}.`);
  }
  saisie = '';
  $('saisie').textContent = '0';
  valider(score);
}

function saisir(c) {
  if (saisie.length >= 3) return;
  saisie = saisie === '0' ? c : saisie + c;
  erreurSaisie('');
  $('saisie').textContent = saisie;
}

document.querySelector('.scorer__saisie').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !etat || etat.gagnant || game.status === 'abandoned' || tourDuBot()) return;
  if (b.dataset.chiffre) saisir(b.dataset.chiffre);
  else if ('effacer' in b.dataset) { saisie = ''; $('saisie').textContent = '0'; erreurSaisie(''); }
  else if ('valider' in b.dataset) { if (appuiLongFait) { appuiLongFait = false; return; } validerSaisie(); }
  else if (b.dataset.score) valider(Number(b.dataset.score));
});

// Appui long (3 s) sur Valider : le nombre saisi est le reste après la volée
const DUREE_APPUI = 3000;
let minuterieAppui = null;
let appuiLongFait = false;
document.querySelector('.scorer__saisie').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-valider]');
  if (!b || !etat || etat.gagnant || tourDuBot() || saisie === '') return;
  appuiLongFait = false;
  b.classList.add('touche--appui');
  clearTimeout(minuterieAppui);
  minuterieAppui = setTimeout(() => {
    appuiLongFait = true;
    b.classList.remove('touche--appui');
    if (navigator.vibrate) navigator.vibrate(40);
    validerSaisie(true);
  }, DUREE_APPUI);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => document.querySelector('.scorer__saisie').addEventListener(t, () => {
  clearTimeout(minuterieAppui);
  document.querySelector('.touche--appui')?.classList.remove('touche--appui');
}));
document.querySelector('.scorer__saisie').addEventListener('contextmenu', (e) => { if (e.target.closest('[data-valider]')) e.preventDefault(); });

// Clavier (ordinateur) : chiffres, Entrée, Retour arrière
document.addEventListener('keydown', (e) => {
  if (!etat || etat.gagnant || tourDuBot() || e.target.closest('input, textarea')) return;
  if (!document.querySelectorAll('.fenetre:not([hidden])').length) {
    if (/^[0-9]$/.test(e.key)) saisir(e.key);
    else if (e.key === 'Enter') validerSaisie();
    else if (e.key === 'Backspace') { saisie = saisie.slice(0, -1); $('saisie').textContent = saisie || '0'; }
  }
});

// ---------- Validation d'une volée ----------

function valider(score) {
  const side = etat.auLancer;
  const reste = etat.reste[side];
  const probleme = verifierVolee(score, reste);
  if (probleme) {
    erreurSaisie(probleme);
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

  // Annonce vocale : le score, puis ce qu'il reste au joueur suivant s'il est sur un finish
  const suivant = etat.auLancer && !etat.gagnant && finissable(etat.reste[etat.auLancer])
    ? { nom: nomVoix(etat.auLancer), reste: etat.reste[etat.auLancer] } : null;
  annoncerVolee({ score, bust: nature === 'bust', finManche: nature === 'finish' && !etat.gagnant, finPartie: !!etat.gagnant, suivant });

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

// ---------- Dartbot : il joue tout seul quand c'est son tour ----------

function tourDuBot() {
  return !!(botSide && etat && !etat.gagnant && etat.auLancer === botSide);
}

function planifierBot() {
  if (!tourDuBot() || enAttente || minuterieBot || game.status !== 'live') return;
  // Petite pause (plus longue avec l'annonce vocale), puis le bot lance fléchette par fléchette
  $('erreur').textContent = '';
  minuterieBot = setTimeout(jouerBot, reglageVoix().actif ? 2200 : 1200);
}

// Le bot lance ses 3 fléchettes une par une : chaque fléchette s'affiche en direct
// (total de la volée qui monte, reste du bot qui baisse), puis la volée est enregistrée
const PAUSE_FLECHETTE = 1200;
function jouerBot() {
  minuterieBot = null;
  if (!tourDuBot() || enAttente || game.status !== 'live') return;
  const reste = etat.reste[botSide];
  const v = voleeBot(reste, reglageBot, Math.random, etat.stats[botSide]);
  const carte = document.querySelectorAll('#camps .camp')[camps.indexOf(botSide)]?.querySelector('.camp__reste');
  const nom = (l) => (l === '0' ? 'Raté' : l);
  let cumul = 0;
  let i = 0;
  const suivante = () => {
    minuterieBot = null;
    if (!tourDuBot() || game.status !== 'live') return;   // volée annulée entre-temps
    const l = v.detail[i];
    cumul += valeurFleche(l);
    i += 1;
    $('saisie').textContent = cumul;
    const z = $('erreur');
    z.classList.add('ecran-saisie__erreur--bot');
    z.innerHTML = v.detail.slice(0, i).map((x, k) => `<span class="fl-bot${k === i - 1 ? ' fl-bot--nouvelle' : ''}">${esc(nom(x))}</span>`).join('');
    if (carte) {
      const apres = reste - cumul;
      carte.textContent = apres < 0 || apres === 1 || (apres === 0 && !(l.startsWith('D') || l === 'Bull')) ? 'Bust' : apres;
      carte.classList.add('camp__reste--direct');
    }
    if (i < v.detail.length) { minuterieBot = setTimeout(suivante, PAUSE_FLECHETTE); return; }
    minuterieBot = setTimeout(() => {
      minuterieBot = null;
      if (!tourDuBot() || game.status !== 'live') return;
      z.classList.remove('ecran-saisie__erreur--bot');
      enAttente = { score: v.score, reste, nature: v.nature, detail: { flechettes: v.flechettes, auDouble: v.auDouble } };
      enregistrer();
      erreurSaisie('');
      if (v.nature === 'normale') afficherEvenement(`Dartbot : ${v.detail.map(nom).join(' · ')}`);
    }, PAUSE_FLECHETTE);
  };
  suivante();
}

// ---------- Annuler la dernière volée ----------

async function annuler() {
  clearTimeout(minuterieBot);
  minuterieBot = null;
  await file;
  // Contre le dartbot : on revient à la dernière volée du joueur (la volée du bot qui suit est annulée aussi)
  const aRetirer = [];
  for (let i = visits.length - 1; i >= 0; i--) {
    aRetirer.push(visits[i]);
    if (!botSide || visits[i].side !== botSide) break;
  }
  const v = aRetirer.at(-1);
  if (!v) return;
  const { error } = await supabase.from('visits').delete().in('id', aRetirer.map((x) => x.id));
  if (error) return message(zoneMsg, `Impossible d'annuler la volée : ${erreurFr(error)}`);
  visits.splice(visits.length - aRetirer.length, aRetirer.length);
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
    ? `Abandonner ce match ${tournoi.feuille ? 'de la feuille de match' : 'de tournoi'} ? La partie sera effacée et le match redeviendra « à jouer ».`
    : 'Abandonner la partie ? Elle sera supprimée définitivement, avec tous ses scores.';
  if (!confirm(texte)) return;
  await file;
  await supprimerPartie(id);
  location.href = tournoi?.feuille ? `feuille.html?id=${encodeURIComponent(tournoi.feuille_id)}`
    : (tournoi ? `tournoi.html?id=${encodeURIComponent(tournoi.tournament_id)}` : 'jouer.html');
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
