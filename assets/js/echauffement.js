// =====================================================================
//  Échauffement : scoring (20, 19, 18 ou 16, bulle) puis doubles
//  (normal ou expert). Entraînement personnel : rien n'est enregistré
//  en ligne ; la partie et les records restent sur l'appareil.
// =====================================================================

import { esc } from './app.js?v=__VERSION__';
import { calculer, cibleActuelle, ETAPES_SCORING, DOUBLES, FINISHS_VERROU } from './echauffement-regles.js?v=__VERSION__';

const $ = (id) => document.getElementById(id);
const CLE = 'dolina-echauffement';
const CLE_RECORDS = 'dolina-echauffement-records';
let config = { mode: 'normal', sansScoring: false };
let actions = [];

const AIDES = {
  normal: 'Normal : dès qu\'un double est réussi (au moins un finish dans la volée), il est fermé et on n\'y revient plus. Volée ratée : on recommence ce double.',
  expert: `Expert : un double réussi ${FINISHS_VERROU} fois (en tout) est verrouillé. Une volée sans finish renvoie au D20, ou au double qui suit le dernier double verrouillé.`,
};

// ---------- Sauvegarde sur l'appareil ----------
const lire = (cle) => { try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch { return null; } };
const ecrire = (cle, v) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* sans importance */ } };
const garder = () => ecrire(CLE, { config, actions, quand: Date.now() });
const oublier = () => { try { localStorage.removeItem(CLE); } catch { /* idem */ } };

// ---------- Réglages ----------
document.querySelector('[data-groupe="mode"]').addEventListener('click', (e) => {
  const b = e.target.closest('[data-valeur]');
  if (!b) return;
  document.querySelectorAll('[data-groupe="mode"] .pastille-choix').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  config.mode = b.dataset.valeur;
  $('ec-mode-aide').textContent = AIDES[config.mode];
  afficherRecords();
});
$('ec-mode-aide').textContent = AIDES.normal;

function afficherRecords() {
  const r = lire(CLE_RECORDS) || {};
  const l = (m) => r[m] ? `<span><b>${r[m].flechettes}</b> fléchettes<small>meilleur ${m === 'expert' ? 'expert' : 'normal'}${r[m].complet ? '' : ' (doubles seuls)'}</small></span>` : '';
  const html = [l('normal'), l('expert')].filter(Boolean).join('');
  $('ec-records').innerHTML = html ? `<p class="match__format" style="margin:0">Vos records sur cet appareil</p><div class="ec-records__liste">${html}</div>` : '';
}

$('ec-form').addEventListener('submit', (e) => {
  e.preventDefault();
  config = { mode: config.mode, sansScoring: !$('ec-scoring').checked };
  actions = [];
  garder();
  demarrer();
});

function demarrer() {
  $('ec-reglages').hidden = true;
  $('ec-fin').hidden = true;
  $('ec-jeu').hidden = false;
  rendre();
}

// ---------- Jeu ----------
function jouer(a) { actions.push(a); garder(); rendre(); }

function progres(e) {
  const scoring = config.sansScoring ? '' : `<div class="ec-etapes">${ETAPES_SCORING.map((et, k) => {
    const etat = e.phase !== 'scoring' || k < e.etape ? 'fait' : (k === e.etape ? 'encours' : '');
    const nom = et.cible === 'B' ? 'Bulle' : (et.cible === '18/16' ? (e.choix || '18/16') : et.cible);
    return `<span class="ec-etape ec-etape--${etat}">${esc(nom)}<small>${et.but} pts</small></span>`;
  }).join('')}</div>`;
  const doubles = `<div class="ec-etapes ec-etapes--doubles">${DOUBLES.map((d, k) => {
    const fait = config.mode === 'expert' ? e.verrouilles.has(d) : e.fermes.has(d);
    const enCours = e.phase === 'doubles' && k === e.i;
    const points = config.mode === 'expert' ? `<i class="ec-pts">${'●'.repeat(Math.min(FINISHS_VERROU, e.finishs[d]))}${'○'.repeat(Math.max(0, FINISHS_VERROU - e.finishs[d]))}</i>` : '';
    return `<span class="ec-double${fait ? ' ec-double--fait' : ''}${enCours ? ' ec-double--encours' : ''}">D${d}${points}</span>`;
  }).join('')}</div>`;
  return scoring + doubles;
}

function rendre() {
  const e = calculer(config, actions);
  if (e.phase === 'fini') return fin(e);
  const c = cibleActuelle(e);
  $('ec-progres').innerHTML = progres(e);
  $('ec-annuler').disabled = !actions.length;
  if (c.type === 'scoring') {
    const nom = c.cible === 'B' ? 'la bulle' : `le ${c.cible}`;
    $('ec-cible').innerHTML = c.aChoisir
      ? '<p class="ec-cible__titre">Choisissez votre cible</p><p class="match__format" style="margin:0">10 points sur le 18 ou sur le 16</p>'
      : `<p class="ec-cible__sur">Scoring · ${e.flechettesScoring} fléchette${e.flechettesScoring > 1 ? 's' : ''}</p>
        <p class="ec-cible__titre">Visez ${esc(nom)}</p>
        <div class="ec-jauge"><span style="width:${Math.min(100, (c.points / c.but) * 100)}%"></span></div>
        <p class="ec-cible__pts"><b>${c.points}</b> / ${c.but} points</p>`;
    $('ec-saisie').innerHTML = c.aChoisir
      ? `<div class="pd-deux">${c.choix.map((x) => `<button type="button" class="bouton bouton--plein pd-gros" data-choix="${x}">${x}</button>`).join('')}</div>`
      : c.cible === 'B'
        ? `<div class="pd-trois"><button type="button" class="bouton bouton--plein pd-gros" data-f="50">50<small>2 points</small></button>
            <button type="button" class="bouton pd-gros pd-gros--25" data-f="25">25<small>1 point</small></button>
            <button type="button" class="bouton pd-gros" data-f="0">Raté</button></div>`
        : `<div class="ec-touches">
            <button type="button" class="bouton bouton--plein pd-gros" data-f="T">Triple ${esc(c.cible)}<small>3 points</small></button>
            <button type="button" class="bouton pd-gros pd-gros--25" data-f="D">Double ${esc(c.cible)}<small>2 points</small></button>
            <button type="button" class="bouton pd-gros" data-f="S">Simple ${esc(c.cible)}<small>1 point</small></button>
            <button type="button" class="bouton pd-gros" data-f="0">Raté</button></div>`;
    return;
  }
  // Doubles
  const simplePossible = c.vise % 2 === 0;
  const volee = e.volee.map((x) => (x.f === 'D' ? `D${x.vise} ✓` : x.f === 'S' ? `S${x.vise}` : 'Raté'));
  $('ec-cible').innerHTML = `
    <p class="ec-cible__sur">Doubles · ${config.mode === 'expert' ? 'expert' : 'normal'} · volée ${e.volees + 1}</p>
    <p class="ec-cible__titre">Double ${c.double}${c.vise !== c.double ? ` <span class="ec-vise">→ visez D${c.vise}</span>` : ''}</p>
    <div class="pd-fleches">${[0, 1, 2].map((i) => `<span class="pd-fleche${volee[i] ? ' pd-fleche--pleine' : ''}">${volee[i] ? esc(volee[i]) : i + 1}</span>`).join('')}</div>
    ${config.mode === 'expert' ? `<p class="match__format" style="margin:0">Finishs sur le D${c.double} : ${e.finishs[c.double]} / ${FINISHS_VERROU}</p>` : ''}`;
  $('ec-saisie').innerHTML = `<div class="pd-trois">
    <button type="button" class="bouton bouton--plein pd-gros" data-f="D">D${c.vise} touché<small>finish</small></button>
    <button type="button" class="bouton pd-gros pd-gros--25" data-f="S" ${simplePossible ? '' : 'disabled'}>Simple ${c.vise}<small>${simplePossible ? `puis D${c.vise / 2}` : 'pas de double après'}</small></button>
    <button type="button" class="bouton pd-gros" data-f="0">Raté</button></div>`;
}

$('ec-saisie').addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.choix) return jouer({ choix: Number(b.dataset.choix) });
  if (b.dataset.f !== undefined) return jouer({ f: b.dataset.f });
});
$('ec-annuler').addEventListener('click', () => {
  // On retire aussi un choix 18/16 resté seul
  actions.pop();
  garder();
  rendre();
});
$('ec-abandonner').addEventListener('click', () => {
  if (!confirm('Arrêter l\'échauffement ?')) return;
  oublier();
  location.reload();
});

// ---------- Fin ----------
function fin(e) {
  $('ec-jeu').hidden = true;
  const zone = $('ec-fin');
  zone.hidden = false;
  const pct = e.flechettesDoubles ? Math.round((e.totalFinishs / e.flechettesDoubles) * 1000) / 10 : 0;
  const records = lire(CLE_RECORDS) || {};
  const complet = !config.sansScoring;
  const avant = records[config.mode];
  const nouveau = !avant || (complet === !!avant.complet ? e.flechettes < avant.flechettes : complet);
  if (nouveau) { records[config.mode] = { flechettes: e.flechettes, complet, quand: Date.now() }; ecrire(CLE_RECORDS, records); }
  oublier();
  zone.innerHTML = `
    <div class="carte-info pd-fin">
      <p class="pd-fin__sur">Échauffement ${config.mode === 'expert' ? 'expert' : 'normal'} terminé</p>
      <h1 class="pd-fin__gagnant">Bravo !</h1>
      ${nouveau ? '<p class="ec-record">🏆 Nouveau record sur cet appareil</p>' : ''}
      <div class="ec-stats">
        <span><b>${e.flechettes}</b><small>fléchettes en tout</small></span>
        ${complet ? `<span><b>${e.flechettesScoring}</b><small>scoring</small></span>` : ''}
        <span><b>${e.volees}</b><small>volées de doubles</small></span>
        <span><b>${e.totalFinishs}</b><small>finishs</small></span>
        <span><b>${String(pct).replace('.', ',')} %</b><small>réussite aux doubles</small></span>
        ${config.mode === 'expert' ? `<span><b>${e.retours}</b><small>retours en arrière</small></span>` : `<span><b>${e.voleesRatees}</b><small>volées ratées</small></span>`}
      </div>
      <div class="actions">
        <button type="button" class="bouton bouton--plein" id="ec-recommencer">Recommencer</button>
        <a class="bouton" href="jouer.html">Retour aux jeux</a>
      </div>
    </div>`;
  $('ec-recommencer').addEventListener('click', () => { actions = []; garder(); demarrer(); });
}

// ---------- Démarrage : reprise d'un échauffement en cours ----------
(function init() {
  afficherRecords();
  const s = lire(CLE);
  if (s?.actions?.length && Date.now() - s.quand < 2 * 86400000) {
    const e = calculer(s.config, s.actions);
    if (e.phase !== 'fini') {
      const ou = e.phase === 'scoring' ? 'scoring' : `double ${DOUBLES[e.i]}`;
      $('ec-reprise').innerHTML = `<div class="carte-info pd-reprise"><strong>Échauffement en cours</strong>
        <span class="match__format">${s.config.mode === 'expert' ? 'Expert' : 'Normal'} · ${esc(ou)} · ${e.flechettes} fléchettes</span>
        <div class="actions"><button type="button" class="bouton bouton--plein" id="ec-reprendre">Reprendre</button>
        <button type="button" class="bouton bouton--danger" id="ec-oublier">Abandonner</button></div></div>`;
      $('ec-reprendre').addEventListener('click', () => { config = s.config; actions = s.actions; demarrer(); });
      $('ec-oublier').addEventListener('click', () => { oublier(); $('ec-reprise').innerHTML = ''; });
    }
  }
}());
