// =====================================================================
//  Jouer → « Compter une manche » : le dartbot lance, le joueur compte
//  la volée et le reste. Correction immédiate, avec le calcul le plus
//  simple et le chemin de finish quand il est possible.
//  Deux modes : une manche (un dartbot) ou un match entre deux dartbots,
//  que le joueur score volée par volée comme un marqueur au club.
//  Ne compte ni dans les stats ni dans le classement. Records gardés
//  sur l'appareil.
// =====================================================================

import { esc } from './app.js?v=__VERSION__';
import { voleeBot } from './dartbot.js?v=__VERSION__';
import { cibleSvg, marque, positionFleche } from './cible.js?v=__VERSION__';
import { corriger } from './compter-calcul.js?v=__VERSION__';
import { reglageVoix, annoncerVolee } from './voix.js?v=__VERSION__';

const NIVEAUX = {
  // variete : le bot vise aussi T19, T18, T17 et tombe dans les numéros voisins → des totaux moins évidents
  debutant: { nom: 'Débutant', moyenne: 45, doubles: 30, variete: 0.7, afficher: true, chrono: 0 },
  confirme: { nom: 'Confirmé', moyenne: 62, doubles: 35, variete: 0.9, afficher: false, chrono: 0 },
  expert: { nom: 'Expert', moyenne: 78, doubles: 45, variete: 1, afficher: false, chrono: 15 },
};
const CLE = 'dolina-compter';
const $ = (id) => document.getElementById(id);
const formReponse = $('form-reponse');

let niveau = 'debutant';
let depart = 501;
let mode = 'manche';     // 'manche' (un dartbot) ou 'match' (dartbot contre dartbot)
let manchesMatch = 2;    // match : premier à N manches
const NOMS_BOTS = ['Bot Rouge', 'Bot Bleu'];
let jeu = null;          // état de la manche
let minuteur = null;

// ---------- Records (sur l'appareil) ----------
function records() { try { return JSON.parse(localStorage.getItem(CLE) || '{}'); } catch { return {}; } }
function enregistrerRecord(cle, valeur) { try { const r = records(); r[cle] = valeur; localStorage.setItem(CLE, JSON.stringify(r)); } catch { /* stockage indisponible */ } }
const cleRecord = (k) => (mode === 'match' ? `match-${k}-${depart}-${manchesMatch}` : `${k}-${depart}`);
function afficherRecords() {
  const r = records();
  const lignes = Object.entries(NIVEAUX).map(([k, n]) => {
    const x = r[cleRecord(k)];
    return `<li><span>${n.nom}</span>${x ? `<b>${x.points} pts</b><small>${x.precision} % juste</small>` : '<small>pas encore joué</small>'}</li>`;
  }).join('');
  $('cp-records').innerHTML = `<h3>Mes records en ${depart}${mode === 'match' ? ` · match premier à ${manchesMatch}` : ''}</h3><ul>${lignes}</ul>`;
}

// ---------- Réglages ----------
document.querySelectorAll('#form-compter .pastilles').forEach((g) => g.addEventListener('click', (e) => {
  const b = e.target.closest('[data-valeur]');
  if (!b) return;
  g.querySelectorAll('[data-valeur]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (g.dataset.groupe === 'niveau') niveau = b.dataset.valeur;
  else if (g.dataset.groupe === 'mode') { mode = b.dataset.valeur; $('cp-bloc-manches').hidden = mode !== 'match'; majBoutonDepart(); afficherRecords(); }
  else if (g.dataset.groupe === 'manches') { manchesMatch = Number(b.dataset.valeur); afficherRecords(); }
  else { depart = Number(b.dataset.valeur); afficherRecords(); }
}));
$('form-compter').addEventListener('submit', (e) => { e.preventDefault(); demarrer(); });
function majBoutonDepart() { $('form-compter').querySelector('[type=submit]').textContent = mode === 'match' ? 'Commencer le match' : 'Commencer la manche'; }
afficherRecords();

// ---------- Manche ----------
function demarrer() {
  const n = mode === 'match' ? 2 : 1;
  jeu = {
    mode, objectif: mode === 'match' ? manchesMatch : 1,
    joueurs: Array.from({ length: n }, (_, i) => ({ nom: n > 1 ? NOMS_BOTS[i] : 'Dartbot', reste: depart, manches: 0, hist: { finishs: 0, auDouble: 0 } })),
    tour: 0, premier: 0, mancheNo: 1, voleeManche: 0,
    volee: 0, points: 0, serie: 0, meilleure: 0, justes: 0, debut: Date.now(),
  };
  $('cp-tableau').hidden = n === 1;
  $('cp-reste-avant').hidden = n > 1;
  majTableau();
  $('cp-reglages').hidden = true;
  $('cp-fin').hidden = true;
  $('cp-jeu').hidden = false;
  $('cp-chrono-bloc').hidden = !NIVEAUX[niveau].chrono;
  voleeSuivante();
}

// Match : tableau des deux dartbots (reste, manches, qui lance)
function majTableau() {
  if (jeu.joueurs.length < 2) return;
  $('cp-tableau').innerHTML = `
    <p class="cp-tableau__manche">Manche ${jeu.mancheNo} · premier à ${jeu.objectif} manche${jeu.objectif > 1 ? 's' : ''}</p>
    <div class="cp-tableau__joueurs">${jeu.joueurs.map((j, i) => `
      <div class="cp-joueur${i === jeu.tour ? ' cp-joueur--actif' : ''}">
        <span class="cp-joueur__nom">${i === jeu.tour ? '<span class="cp-joueur__lance" aria-label="lance"></span>' : ''}${esc(j.nom)}</span>
        <b class="cp-joueur__reste">${j.reste}</b>
        <small>${j.manches} manche${j.manches > 1 ? 's' : ''}</small>
      </div>`).join('')}</div>`;
}

function voleeSuivante() {
  const n = NIVEAUX[niveau];
  const j = jeu.joueurs[jeu.tour];
  jeu.volee += 1;
  jeu.voleeManche += 1;
  const v = voleeBot(j.reste, n, Math.random, j.hist);
  j.hist.auDouble += v.auDouble;
  if (v.nature === 'finish') j.hist.finishs += 1;
  jeu.labels = v.detail;
  jeu.corr = corriger(v.detail, j.reste);
  jeu.repondu = false;
  $('cp-volee').textContent = jeu.volee;
  $('cp-avant').textContent = j.reste;
  majTableau();
  $('cp-correction').hidden = true;
  formReponse.hidden = false;
  formReponse.reset();
  majBust(false);
  // Cible : les fléchettes arrivent l'une après l'autre
  $('cp-cible').innerHTML = cibleSvg({ id: 'cp-svg', etiquette: `Volée ${jeu.volee}${jeu.joueurs.length > 1 ? ` de ${j.nom}` : ''} : trois fléchettes sur la cible` });
  const zone = document.querySelector('#cp-svg .cible-marques');
  jeu.labels.forEach((l, i) => setTimeout(() => {
    zone.insertAdjacentHTML('beforeend', marque(positionFleche(l), String(i + 1), 'cible-fleche--bot cp-fleche'));
  }, 250 + i * 380));
  const fl = $('cp-fleches');
  fl.hidden = !n.afficher;
  fl.innerHTML = n.afficher ? jeu.labels.map((l) => `<span class="cp-puce">${esc(l === '0' ? 'Raté' : l)}</span>`).join('') : '';
  setTimeout(() => formReponse.elements.score.focus({ preventScroll: true }), 250 + jeu.labels.length * 380);
  lancerChrono();
}

function lancerChrono() {
  clearInterval(minuteur);
  const duree = NIVEAUX[niveau].chrono;
  if (!duree) return;
  let t = duree;
  $('cp-chrono').textContent = t;
  $('cp-chrono-bloc').classList.remove('cp-info--urgent');
  minuteur = setInterval(() => {
    t -= 1;
    $('cp-chrono').textContent = Math.max(0, t);
    $('cp-chrono-bloc').classList.toggle('cp-info--urgent', t <= 5);
    if (t <= 0) { clearInterval(minuteur); verifier(true); }
  }, 1000);
}

let bust = false;
function majBust(oui) {
  bust = oui;
  $('cp-bust').setAttribute('aria-pressed', String(oui));
  $('cp-bust').classList.toggle('bouton--plein', oui);
  formReponse.elements.score.disabled = oui;
  formReponse.elements.reste.disabled = oui;
}
$('cp-bust').addEventListener('click', () => majBust(!bust));
formReponse.addEventListener('submit', (e) => { e.preventDefault(); verifier(false); });

function verifier(tempsEcoule) {
  if (!jeu || jeu.repondu) return;
  const f = formReponse.elements;
  const score = f.score.value === '' ? null : Number(f.score.value);
  const reste = f.reste.value === '' ? null : Number(f.reste.value);
  if (!tempsEcoule && !bust && (score === null || reste === null)) {
    (score === null ? f.score : f.reste).focus();
    return;
  }
  clearInterval(minuteur);
  jeu.repondu = true;
  const c = jeu.corr;
  let okScore; let okReste;
  if (tempsEcoule) { okScore = false; okReste = false; }
  else if (c.bust) { okScore = bust; okReste = bust; }
  else { okScore = !bust && score === c.total; okReste = !bust && reste === c.reste; }
  const parfait = okScore && okReste;
  jeu.serie = parfait ? jeu.serie + 1 : 0;
  jeu.meilleure = Math.max(jeu.meilleure, jeu.serie);
  const bonus = 1 + Math.floor(jeu.serie / 3);           // ×2 à partir de 3 volées justes d'affilée, ×3 à partir de 6…
  const gagnes = ((okScore ? 1 : 0) + (okReste ? 1 : 0)) * (parfait ? bonus : 1);
  jeu.points += gagnes;
  if (parfait) jeu.justes += 1;
  $('cp-points').textContent = jeu.points;
  $('cp-serie').textContent = jeu.serie;
  // Fin de volée : reste du lanceur, manche gagnée, match fini ?
  const lanceur = jeu.joueurs[jeu.tour];
  lanceur.reste = c.reste;
  let finManche = false; let finMatch = false;
  if (c.finish) {
    lanceur.manches += 1;
    finManche = true;
    finMatch = lanceur.manches >= jeu.objectif;
  }
  const autre = jeu.joueurs.length > 1 ? jeu.joueurs[1 - jeu.tour] : null;
  if (reglageVoix().actif) {
    annoncerVolee({ score: c.total, bust: c.bust, finManche: finManche && !finMatch && jeu.joueurs.length > 1, finPartie: finMatch, suivant: autre && !finManche ? { nom: autre.nom, reste: autre.reste } : null });
  }

  const ligne = (ok, titre, attendu, donne) => `<li class="${ok ? 'cp-ok' : 'cp-ko'}"><span class="cp-pastille">${ok ? '✓' : '✗'}</span><span><b>${titre}</b> ${ok ? attendu : `${donne !== null && donne !== undefined ? `vous avez dit ${esc(String(donne))}, ` : ''}c'était <b>${attendu}</b>`}</span></li>`;
  const resultats = c.bust
    ? ligne(okScore, 'Bust', 'la volée compte 0', tempsEcoule ? 'rien' : (bust ? 'bust' : `${score ?? '—'} / ${reste ?? '—'}`))
    : ligne(okScore, 'Score :', c.total, tempsEcoule ? null : (bust ? 'bust' : score)) + ligne(okReste, 'Reste :', c.reste, tempsEcoule ? null : (bust ? 'bust' : reste));
  $('cp-fleches').hidden = false;
  $('cp-fleches').innerHTML = jeu.labels.map((l) => `<span class="cp-puce">${esc(l === '0' ? 'Raté' : l)}</span>`).join('');
  formReponse.hidden = true;
  const z = $('cp-correction');
  z.hidden = false;
  z.className = `cp-correction ${parfait ? 'cp-correction--juste' : 'cp-correction--faux'}`;
  z.innerHTML = `
    <div class="cp-verdict">${tempsEcoule ? 'Temps écoulé !' : parfait ? (jeu.serie >= 3 ? `Parfait ! Série de ${jeu.serie} 🔥` : 'Parfait !') : 'Pas tout à fait…'}${gagnes ? ` <span>+${gagnes} pt${gagnes > 1 ? 's' : ''}${parfait && bonus > 1 ? ` (×${bonus})` : ''}</span>` : ''}</div>
    <ul class="cp-resultats">${resultats}</ul>
    <div class="cp-calcul">
      <h3>${parfait ? 'Le calcul' : 'Le calcul le plus simple'}</h3>
      ${c.lignes.map((l) => `<p>${esc(l)}</p>`).join('')}
      ${c.conseil ? `<p class="cp-conseil">${esc(c.conseil)}</p>` : ''}
      ${c.pourquoi ? `<p class="cp-pourquoi">${esc(c.pourquoi)}</p>` : ''}
    </div>
    ${finManche && jeu.joueurs.length > 1 ? `<p class="cp-manche-gagnee">${esc(lanceur.nom)} gagne la manche ${jeu.mancheNo} · ${jeu.joueurs.map((x) => `${esc(x.nom)} ${x.manches}`).join(' – ')}</p>` : ''}
    <button type="button" class="bouton bouton--plein bouton--large" id="cp-suivant">${finMatch || (finManche && jeu.joueurs.length === 1) ? 'Voir mon bilan' : finManche ? 'Manche suivante' : 'Volée suivante'}</button>`;
  $('cp-suivant').focus({ preventScroll: true });
  z.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  majTableau();
  jeu.fini = finMatch || (jeu.joueurs.length === 1 && c.finish) || jeu.volee >= 400 || (jeu.joueurs.length === 1 && jeu.volee >= 60);
  jeu.nouvelleManche = finManche && !jeu.fini;
  if (!finManche && autre) jeu.tour = 1 - jeu.tour;
}

// Match : nouvelle manche, le premier lanceur change
function mancheSuivante() {
  jeu.mancheNo += 1;
  jeu.premier = 1 - jeu.premier;
  jeu.tour = jeu.premier;
  jeu.voleeManche = 0;
  jeu.joueurs.forEach((j) => { j.reste = depart; });
  jeu.nouvelleManche = false;
  voleeSuivante();
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'cp-suivant') { if (jeu.fini) bilan(); else if (jeu.nouvelleManche) mancheSuivante(); else voleeSuivante(); }
  if (e.target.id === 'cp-rejouer') demarrer();
  if (e.target.id === 'cp-reglages-btn') { $('cp-fin').hidden = true; $('cp-reglages').hidden = false; afficherRecords(); window.scrollTo({ top: 0 }); }
});

function bilan() {
  const duree = Math.round((Date.now() - jeu.debut) / 1000);
  const precision = Math.round((jeu.justes / jeu.volee) * 100);
  const cle = cleRecord(niveau);
  const ancien = records()[cle];
  const record = !ancien || jeu.points > ancien.points;
  if (record) enregistrerRecord(cle, { points: jeu.points, precision, date: new Date().toISOString() });
  $('cp-jeu').hidden = true;
  const z = $('cp-fin');
  z.hidden = false;
  z.innerHTML = `
    <h2>${record ? 'Nouveau record ! 🎯' : (jeu.mode === 'match' ? 'Match terminé' : 'Manche terminée')}</h2>
    ${jeu.mode === 'match' ? `<p class="cp-score-final">${jeu.joueurs.map((x) => `<span>${esc(x.nom)} <b>${x.manches}</b></span>`).join('<i>–</i>')}</p>` : ''}
    <p class="match__format" style="margin:0">${NIVEAUX[niveau].nom} · ${depart}${jeu.mode === 'match' ? ` · premier à ${jeu.objectif}` : ''} · ${jeu.volee} volées comptées en ${Math.floor(duree / 60)} min ${String(duree % 60).padStart(2, '0')} s</p>
    <div class="cp-stats">
      <span><b>${jeu.points}</b>points</span>
      <span><b>${precision} %</b>volées justes</span>
      <span><b>${jeu.meilleure}</b>meilleure série</span>
    </div>
    ${ancien && !record ? `<p class="match__format" style="margin:0">Votre record à battre : ${ancien.points} points.</p>` : ''}
    <div class="actions">
      <button type="button" class="bouton bouton--plein" id="cp-rejouer">Rejouer</button>
      <button type="button" class="bouton" id="cp-reglages-btn">Changer les réglages</button>
      <a class="bouton" href="jouer.html">Retour à Jouer</a>
    </div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
