// =====================================================================
//  Jouer → « Compter une manche » : le dartbot lance, le joueur compte
//  la volée et le reste. Correction immédiate, avec le calcul le plus
//  simple et le chemin de finish quand il est possible.
//  Ne compte ni dans les stats ni dans le classement. Records gardés
//  sur l'appareil.
// =====================================================================

import { esc } from './app.js?v=__VERSION__';
import { voleeBot } from './dartbot.js?v=__VERSION__';
import { cibleSvg, marque, positionFleche } from './cible.js?v=__VERSION__';
import { corriger } from './compter-calcul.js?v=__VERSION__';
import { reglageVoix, annoncerVolee } from './voix.js?v=__VERSION__';

const NIVEAUX = {
  debutant: { nom: 'Débutant', moyenne: 42, doubles: 30, afficher: true, chrono: 0 },
  confirme: { nom: 'Confirmé', moyenne: 62, doubles: 35, afficher: false, chrono: 0 },
  expert: { nom: 'Expert', moyenne: 82, doubles: 45, afficher: false, chrono: 15 },
};
const CLE = 'dolina-compter';
const $ = (id) => document.getElementById(id);
const formReponse = $('form-reponse');

let niveau = 'debutant';
let depart = 501;
let jeu = null;          // état de la manche
let minuteur = null;

// ---------- Records (sur l'appareil) ----------
function records() { try { return JSON.parse(localStorage.getItem(CLE) || '{}'); } catch { return {}; } }
function enregistrerRecord(cle, valeur) { try { const r = records(); r[cle] = valeur; localStorage.setItem(CLE, JSON.stringify(r)); } catch { /* stockage indisponible */ } }
function afficherRecords() {
  const r = records();
  const lignes = Object.entries(NIVEAUX).map(([k, n]) => {
    const x = r[`${k}-${depart}`];
    return `<li><span>${n.nom}</span>${x ? `<b>${x.points} pts</b><small>${x.precision} % juste</small>` : '<small>pas encore joué</small>'}</li>`;
  }).join('');
  $('cp-records').innerHTML = `<h3>Mes records en ${depart}</h3><ul>${lignes}</ul>`;
}

// ---------- Réglages ----------
document.querySelectorAll('#form-compter .pastilles').forEach((g) => g.addEventListener('click', (e) => {
  const b = e.target.closest('[data-valeur]');
  if (!b) return;
  g.querySelectorAll('[data-valeur]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  if (g.dataset.groupe === 'niveau') niveau = b.dataset.valeur;
  else { depart = Number(b.dataset.valeur); afficherRecords(); }
}));
$('form-compter').addEventListener('submit', (e) => { e.preventDefault(); demarrer(); });
afficherRecords();

// ---------- Manche ----------
function demarrer() {
  jeu = { reste: depart, volee: 0, points: 0, serie: 0, meilleure: 0, justes: 0, debut: Date.now(), hist: { finishs: 0, auDouble: 0 } };
  $('cp-reglages').hidden = true;
  $('cp-fin').hidden = true;
  $('cp-jeu').hidden = false;
  $('cp-chrono-bloc').hidden = !NIVEAUX[niveau].chrono;
  voleeSuivante();
}

function voleeSuivante() {
  const n = NIVEAUX[niveau];
  jeu.volee += 1;
  const v = voleeBot(jeu.reste, n, Math.random, jeu.hist);
  jeu.hist.auDouble += v.auDouble;
  if (v.nature === 'finish') jeu.hist.finishs += 1;
  jeu.labels = v.detail;
  jeu.corr = corriger(v.detail, jeu.reste);
  jeu.repondu = false;
  $('cp-volee').textContent = jeu.volee;
  $('cp-avant').textContent = jeu.reste;
  $('cp-correction').hidden = true;
  formReponse.hidden = false;
  formReponse.reset();
  majBust(false);
  // Cible : les fléchettes arrivent l'une après l'autre
  $('cp-cible').innerHTML = cibleSvg({ id: 'cp-svg', etiquette: `Volée ${jeu.volee} : trois fléchettes sur la cible` });
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
  if (reglageVoix().actif) annoncerVolee({ score: c.total, bust: c.bust, finManche: false, finPartie: c.finish, suivant: null });

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
    </div>
    <button type="button" class="bouton bouton--plein bouton--large" id="cp-suivant">${c.finish ? 'Voir mon bilan' : 'Volée suivante'}</button>`;
  $('cp-suivant').focus({ preventScroll: true });
  z.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  jeu.reste = c.reste;
  jeu.fini = c.finish || jeu.volee >= 60;
}

document.addEventListener('click', (e) => {
  if (e.target.id === 'cp-suivant') { if (jeu.fini) bilan(); else voleeSuivante(); }
  if (e.target.id === 'cp-rejouer') demarrer();
  if (e.target.id === 'cp-reglages-btn') { $('cp-fin').hidden = true; $('cp-reglages').hidden = false; afficherRecords(); window.scrollTo({ top: 0 }); }
});

function bilan() {
  const duree = Math.round((Date.now() - jeu.debut) / 1000);
  const precision = Math.round((jeu.justes / jeu.volee) * 100);
  const cle = `${niveau}-${depart}`;
  const ancien = records()[cle];
  const record = !ancien || jeu.points > ancien.points;
  if (record) enregistrerRecord(cle, { points: jeu.points, precision, date: new Date().toISOString() });
  $('cp-jeu').hidden = true;
  const z = $('cp-fin');
  z.hidden = false;
  z.innerHTML = `
    <h2>${record ? 'Nouveau record ! 🎯' : 'Manche terminée'}</h2>
    <p class="match__format" style="margin:0">${NIVEAUX[niveau].nom} · ${depart} · ${jeu.volee} volées comptées en ${Math.floor(duree / 60)} min ${String(duree % 60).padStart(2, '0')} s</p>
    <div class="cp-stats">
      <span><b>${jeu.points}</b>points</span>
      <span><b>${precision} %</b>volées justes</span>
      <span><b>${jeu.meilleure}</b>meilleure série</span>
    </div>
    ${ancien && !record ? `<p class="match__format" style="margin:0">Votre record à battre : ${ancien.points} points.</p>` : ''}
    <div class="actions">
      <button type="button" class="bouton bouton--plein" id="cp-rejouer">Rejouer</button>
      <button type="button" class="bouton" id="cp-reglages-btn">Changer de niveau</button>
      <a class="bouton" href="jouer.html">Retour à Jouer</a>
    </div>`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
