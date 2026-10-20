// =====================================================================
//  Pentadarts (5 jeux du club) et Capital (jeu seul) — page de jeu
//  Catégorie à part : rien n'est compté dans les moyennes ni le classement X01.
//  La partie est gardée sur le téléphone (reprise possible) ; à la fin,
//  le résultat est enregistré dans l'historique (script 039).
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, nomAffiche } from './app.js?v=__VERSION__';
import {
  calculer, JEUX, CIBLES_MICKEY, LIBELLES_MICKEY, FINISHS, MANCHES_CAPITAL, LIBELLES_CAPITAL,
  CENTRE_BUT, IMPOSSIBLES_301, pointsCentre, totalMickey, mancheCapital, mickeyFerme, libelleCricket, touchesFleche,
} from './pentadarts-regles.js?v=__VERSION__';

const MODE = ['capital', 'cricket'].includes(new URLSearchParams(location.search).get('jeu')) ? new URLSearchParams(location.search).get('jeu') : 'pentadarts';
const SEUL = MODE !== 'pentadarts';   // un jeu seul (capital ou cricket), sans points ni feuille de 5 jeux
const MIN = SEUL ? 1 : 3;
const MAX = SEUL ? 8 : 5;
const NOMS_MODE = { pentadarts: 'Pentadarts', capital: 'Le capital', cricket: 'Le cricket' };
const PARAM = MODE === 'pentadarts' ? '' : `?jeu=${MODE}`;
const CLE = `dolina-${MODE}`;
const $ = (id) => document.getElementById(id);
const zoneMsg = $('message');

let moi = null;
let membres = [];
let config = { mode: MODE, joueurs: [], ordre: [] };
let actions = [];
let volee = [];          // fléchettes de la volée en cours (pas encore validée)
let saisie = '';         // 301 / 501 : score tapé
let finEnAttente = null; // 301 : score égal au reste, en attente de « fini sur un double ? »
let multi = 1;           // capital : simple / double / triple
let tirage = [];         // ordre du tirage à la bulle
let enregistre = false;
let partieId = null;     // partie enregistrée en ligne (script 040) : reprenable sur un autre appareil
let attenteSync = null;

// ---------- Textes ----------
const REGLES = {
  centre: `Le premier à ${CENTRE_BUT} centres (25 = 1, bulle 50 = 2). Le tour se termine pour tous.`,
  mickey: 'Fermer chaque case (3 touches), dans l\'ordre de votre choix. Un triple 20 ferme le 20 d\'un coup, ou coche une fois la case Triple : à vous de choisir.',
  finish: 'Réussir 50, 40, 36, 32, 24 puis 7, en finissant sur un double.',
  '301a': 'Le premier qui finit sur un double gagne. Les autres : classés selon leur reste.',
  '301b': 'Le premier qui finit sur un double gagne. Les autres : classés selon leur reste.',
  capital: '1re volée : votre capital. Ensuite, seuls les points sur la case comptent ; 0 point = capital divisé par 2.',
};
if (MODE === 'cricket') {
  document.title = 'Cricket – Dolina Darts Club';
  $('pd-nom-jeu').textContent = 'Cricket';
  $('pd-titre').textContent = 'Le cricket';
  $('pd-intro').textContent = 'Fermez le 20, 19, 18, 17, 16, 15, le centre, le triple et le double (3 touches chacun), dans l\'ordre de votre choix. Un triple 20 ferme le 20 d\'un coup, ou coche une fois la case Triple. Le premier qui ferme tout gagne, à la fin du tour ; les autres sont classés selon leurs touches. Mêmes règles que dans le Pentadarts.';
  $('pd-legende-joueurs').textContent = 'Joueurs (1 à 8)';
} else if (MODE === 'capital') {
  document.title = 'Capital – Dolina Darts Club';
  $('pd-nom-jeu').textContent = 'Capital';
  $('pd-titre').textContent = 'Le capital';
  $('pd-intro').textContent = 'Marquez le plus de points possible avec votre première volée : c\'est votre capital. Ensuite, seuls les points sur la case affichée (20, double, 19, triple, 18, 57, centre) comptent. Une volée à 0 point divise votre capital par 2. Le plus gros capital gagne.';
  $('pd-legende-joueurs').textContent = 'Joueurs (1 à 8)';
} else {
  $('pd-intro').textContent = 'Les 5 jeux de la feuille du club : le centre, le cricket, le finish, deux manches de 301 et le capital. Les 3 premiers de chaque jeu marquent des points ; le total désigne le vainqueur. De 3 à 5 joueurs.';
  $('pd-legende-joueurs').textContent = 'Joueurs (3 à 5)';
}

// ---------- Sauvegarde sur le téléphone ----------
function garder() {
  try { localStorage.setItem(CLE, JSON.stringify({ config, actions, enregistre, partieId, quand: Date.now() })); } catch { /* sans importance */ }
  // En ligne : la partie suit le joueur d'un appareil à l'autre
  clearTimeout(attenteSync);
  attenteSync = setTimeout(synchroniser, 500);
}

const joueursEnLigne = () => config.joueurs.map((j) => ({ nom: j.nom, profile_id: j.id || null }));
let enLigneIndispo = false;
async function synchroniser() {
  if (!moi || moi.status !== 'active' || enregistre || enLigneIndispo || !config.joueurs.length) return;
  if (!partieId) {
    const { data, error } = await supabase.from('jeux_parties')
      .insert({ jeu: MODE, joueurs: joueursEnLigne(), ordre: config.ordre, actions, statut: 'live', resultat: config.format ? { format: config.format } : {} }).select('id').single();
    if (error) { enLigneIndispo = true; return; }   // script 040 pas encore lancé : sur cet appareil seulement
    partieId = data.id;
    try { localStorage.setItem(CLE, JSON.stringify({ config, actions, enregistre, partieId, quand: Date.now() })); } catch { /* idem */ }
  } else {
    await supabase.from('jeux_parties').update({ actions, ordre: config.ordre }).eq('id', partieId);
  }
}
function oublier() { try { localStorage.removeItem(CLE); } catch { /* idem */ } }
function lireSauvegarde() {
  try { const s = JSON.parse(localStorage.getItem(CLE) || 'null'); return s && Date.now() - s.quand < 3 * 86400000 ? s : null; } catch { return null; }
}

// ---------- Format en manches (cricket seul) ----------
function lireFormat() {
  const type = $('pd-format-type').value; let n = Number($('pd-format-n').value) || 1;
  if (type === 'meilleur' && n % 2 === 0) n += 1;   // au meilleur de : un nombre impair
  return { type, n };
}
const objectifDe = (f) => (f?.type === 'meilleur' ? Math.floor(f.n / 2) + 1 : (f?.n || 1));
const texteFormat = (f) => (!f || (f.type === 'premier' && f.n === 1) ? 'En une manche'
  : `${f.type === 'meilleur' ? `Au meilleur de ${f.n} manches` : `Premier à ${f.n} manches`} · ${objectifDe(f)} manche${objectifDe(f) > 1 ? 's' : ''} gagnante${objectifDe(f) > 1 ? 's' : ''}`);
if (MODE === 'cricket') {
  $('pd-bloc-format').hidden = false;
  const maj = () => { const f = lireFormat(); $('pd-format-n').value = String(f.n); $('pd-format-resume').textContent = texteFormat(f); };
  $('pd-format-type').addEventListener('change', maj);
  $('pd-format-n').addEventListener('change', maj);
  maj();
}

// ---------- Réglages ----------
function afficherJoueurs() {
  $('pd-joueurs').innerHTML = config.joueurs.map((j, i) => `
    <span class="pd-joueur"><b>${i + 1}</b>${esc(j.nom)}<button type="button" data-retirer="${i}" aria-label="Retirer ${esc(j.nom)}">×</button></span>`).join('')
    || '<p class="match__format" style="margin:0">Ajoutez les joueurs de la partie.</p>';
  const pris = new Set(config.joueurs.map((j) => j.id).filter(Boolean));
  $('pd-membre').innerHTML = '<option value="">— Choisir un membre —</option>'
    + membres.filter((m) => !pris.has(m.id)).map((m) => `<option value="${m.id}">${esc(nomAffiche(m))}</option>`).join('');
  const n = config.joueurs.length;
  $('pd-bloc-bulle').hidden = n < 2;
  tirage = tirage.filter((i) => i < n);
  afficherTirage();
}
function afficherTirage() {
  const n = config.joueurs.length;
  $('pd-bulle').innerHTML = config.joueurs.map((j, i) => {
    const rang = tirage.indexOf(i);
    return `<button type="button" class="pd-bulle__joueur${rang >= 0 ? ' pd-bulle__joueur--place' : ''}" data-tirage="${i}" ${rang >= 0 ? 'disabled' : ''}>
      ${rang >= 0 ? `<b>${rang + 1}</b>` : ''}${esc(j.nom)}</button>`;
  }).join('');
  const pret = n >= MIN && n <= MAX && (n === 1 || tirage.length >= n - 1);
  const rangs = ['Qui est le plus près de la bulle ?', 'Qui est 2e ?', 'Qui est 3e ?', 'Qui est 4e ?'];
  $('pd-bulle-question').textContent = n > 1 && tirage.length < n ? `👉 ${rangs[tirage.length] || ''}` : (n > 1 ? `✓ ${config.joueurs[tirage[0]]?.nom || ''} commence` : '');
  $('pd-commencer').disabled = !pret;
  $('pd-commencer').textContent = n < MIN ? `Ajoutez au moins ${MIN} joueur${MIN > 1 ? 's' : ''}` : (pret ? 'Commencer la partie' : 'Touchez les noms ci-dessus pour le tirage');
}

$('pd-membre').addEventListener('change', (e) => {
  const m = membres.find((x) => x.id === e.target.value);
  if (m && config.joueurs.length < MAX) { config.joueurs.push({ nom: nomAffiche(m), id: m.id }); afficherJoueurs(); }
  e.target.value = '';
});
$('pd-ajouter-invite').addEventListener('click', () => {
  const nom = $('pd-invite').value.trim();
  if (!nom) return;
  if (config.joueurs.length >= MAX) return message(zoneMsg, `${MAX} joueurs au maximum.`);
  config.joueurs.push({ nom });
  $('pd-invite').value = '';
  afficherJoueurs();
});
$('pd-invite').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('pd-ajouter-invite').click(); } });
$('pd-joueurs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-retirer]');
  if (!b) return;
  config.joueurs.splice(Number(b.dataset.retirer), 1);
  tirage = [];
  afficherJoueurs();
});
$('pd-bulle').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tirage]');
  if (!b) return;
  tirage.push(Number(b.dataset.tirage));
  // Le dernier n'a pas besoin d'être touché
  if (tirage.length === config.joueurs.length - 1) tirage.push(config.joueurs.findIndex((_, i) => !tirage.includes(i)));
  afficherTirage();
});
$('pd-bulle-effacer').addEventListener('click', () => { tirage = []; afficherTirage(); });
// Pas de tirage à la bulle possible : ordre tiré au sort
$('pd-bulle-hasard').addEventListener('click', () => {
  const idx = config.joueurs.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  tirage = idx;
  afficherTirage();
});

$('pd-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const n = config.joueurs.length;
  if (n < MIN || n > MAX) return;
  config.ordre = n === 1 ? [0] : (tirage.length === n ? [...tirage] : config.joueurs.map((_, i) => i));
  if (MODE === 'cricket') config.format = lireFormat();
  actions = [];
  volee = [];
  enregistre = false;
  partieId = null;
  garder();
  demarrer();
});

// ---------- Partie ----------
const nom = (p) => config.joueurs[p]?.nom || '?';

function demarrer() {
  $('pd-reglages').hidden = true;
  $('pd-fin').hidden = true;
  $('pd-jeu').hidden = false;
  rendre();
}

function jouer(action) {
  actions.push(action);
  volee = [];
  saisie = '';
  finEnAttente = null;
  garder();
  rendre();
}

function rendre() {
  const etat = calculer(config, actions);
  if (etat.termine) return finPartie(etat);
  const cle = etat.jeu;
  const d = etat.departage;
  $('pd-num').textContent = cle === 'final' ? '=' : (MODE === 'capital' ? '$' : MODE === 'cricket' ? 'C' : JEUX[cle].num);
  $('pd-jeu-titre').textContent = d ? (d.type === '501' ? 'Départage : manche de 501' : `${JEUX[cle].titre} · départage`) : JEUX[cle].titre;
  $('pd-jeu-regle').textContent = d ? texteDepartage(d) : REGLES[cle];
  // Cricket en manches : manche en cours et score du match
  if (MODE === 'cricket' && etat.objectif > 1) {
    $('pd-jeu-titre').textContent = `${d ? 'Départage · ' : ''}Manche ${etat.manches.length + 1}`;
    $('pd-jeu-regle').innerHTML = `${esc(texteFormat(config.format))}<span class="pd-score-match">${config.ordre.map((p) => `${esc(nom(p))} <b>${etat.gagnees[p]}</b>`).join(' · ')}</span>`;
  }
  $('pd-voir-feuille').hidden = SEUL;
  $('pd-tableau').innerHTML = d ? tableauDepartage(etat, d) : TABLEAUX[cle](etat, etat.jeux[cle]);
  $('pd-saisie').innerHTML = `<p class="pd-tour">À <strong>${esc(nom(etat.joueur))}</strong> de lancer${infoTour(etat)}</p>` + saisieHtml(etat);
  $('pd-annuler').disabled = !actions.length && !volee.length && !saisie;
}

function infoTour(etat) {
  if (etat.departage) return '';
  const cle = etat.jeu;
  const st = etat.jeux[cle];
  if (cle === 'capital') return ` · manche <b>${esc(LIBELLES_CAPITAL[MANCHES_CAPITAL[mancheCapital(st)]] || MANCHES_CAPITAL[mancheCapital(st)])}</b>`;
  if (cle === 'finish') return ` · finish <b>${FINISHS[st.etape[etat.joueur]]}</b>`;
  if (cle === '301a' || cle === '301b') return ` · reste <b>${st.reste[etat.joueur]}</b>`;
  return ` · volée ${Math.floor(st.t / st.ordre.length) + 1}`;
}

function texteDepartage(d) {
  const place = d.position + d.places.length + 1;
  if (d.type === 'bulle') return `Égalité pour la ${place === 1 ? '1re' : `${place}e`} place : chacun lance une fléchette sur la bulle. 50 bat 25, qui bat raté. Encore à égalité (25 et 25, ou tous ratés) : on recommence.`;
  if (d.type === 'finish') return `Égalité pour la ${place === 1 ? '1re' : `${place}e`} place : les joueurs rejouent le ${d.cible}. Le premier qui le réussit passe devant.`;
  return `Égalité au total pour la ${place === 1 ? '1re' : `${place}e`} place : une manche de 501, le premier qui finit gagne.`;
}

// ---------- Tableaux de chaque jeu ----------
const enTete = (st, etat) => st.ordre.map((p) => `<th class="${p === etat.joueur ? 'pd-actif' : ''}">${esc(nom(p))}</th>`).join('');

const TABLEAUX = {
  centre(etat, st) {
    const nbCol = Math.max(10, ...st.volees.map((v) => v.length));
    const tete = Array.from({ length: nbCol }, (_, i) => `<th>${i + 1}</th>`).join('');
    return `<div class="pd-defile"><table class="pd-table pd-table--centre">
      <thead><tr><th></th>${tete}<th class="pd-total">Total</th></tr></thead>
      <tbody>${st.ordre.map((p) => `<tr class="${p === etat.joueur ? 'pd-actif' : ''}"><th>${esc(nom(p))}</th>
        ${Array.from({ length: nbCol }, (_, i) => { const v = st.volees[p][i]; return `<td>${v ? v.reduce((a, d) => a + pointsCentre(d), 0) : ''}</td>`; }).join('')}
        <td class="pd-total">${st.total[p]}</td></tr>`).join('')}</tbody></table></div>`;
  },
  mickey(etat, st) {
    const marque = (n) => ['', '/', 'X', '⊗'][n];
    return `<div class="pd-defile"><table class="pd-table pd-table--mickey">
      <thead><tr><th></th>${enTete(st, etat)}</tr></thead>
      <tbody>${CIBLES_MICKEY.map((c) => `<tr><th>${esc(LIBELLES_MICKEY[c] || c)}</th>${st.ordre.map((p) => `<td class="${st.touches[p][c] >= 3 ? 'pd-ferme' : ''} ${p === etat.joueur ? 'pd-actif' : ''}">${marque(st.touches[p][c])}</td>`).join('')}</tr>`).join('')}
      <tr class="pd-ligne-total"><th>Touches</th>${st.ordre.map((p) => `<td class="${p === etat.joueur ? 'pd-actif' : ''}">${totalMickey(st, p)}<small>/27</small></td>`).join('')}</tr></tbody></table></div>`;
  },
  finish(etat, st) {
    return `<div class="pd-defile"><table class="pd-table pd-table--finish">
      <thead><tr><th></th>${enTete(st, etat)}</tr></thead>
      <tbody>${FINISHS.map((f, i) => `<tr><th>${f}</th>${st.ordre.map((p) => `<td class="${st.etape[p] > i ? 'pd-ferme' : ''} ${p === etat.joueur ? 'pd-actif' : ''}">${st.etape[p] > i ? '✓' : (st.etape[p] === i ? '•' : '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  },
  '301a': (etat, st) => tableauX01(etat, st),
  '301b': (etat, st) => tableauX01(etat, st),
  capital(etat, st) {
    const m = mancheCapital(st);
    return `<div class="pd-defile"><table class="pd-table pd-table--capital">
      <thead><tr><th></th>${enTete(st, etat)}</tr></thead>
      <tbody>${MANCHES_CAPITAL.map((c, i) => `<tr class="${i === m ? 'pd-manche' : ''}"><th>${esc(LIBELLES_CAPITAL[c] || c)}</th>${st.ordre.map((p) => {
        const v = st.volees[p][i];
        return `<td class="${p === etat.joueur ? 'pd-actif' : ''}">${v ? `<span class="${v.points ? '' : 'pd-moitie'}">${v.points ? `+${v.points}` : '÷2'}</span><small>${v.capital}</small>` : ''}</td>`;
      }).join('')}</tr>`).join('')}
      <tr class="pd-ligne-total"><th>Capital</th>${st.ordre.map((p) => `<td class="${p === etat.joueur ? 'pd-actif' : ''}">${st.capital[p]}</td>`).join('')}</tr></tbody></table></div>`;
  },
};

function tableauX01(etat, st) {
  return `<div class="pd-x01">${st.ordre.map((p) => `
    <div class="pd-x01__joueur${p === etat.joueur ? ' pd-actif' : ''}">
      <span class="pd-x01__nom">${esc(nom(p))}</span>
      <b class="pd-x01__reste">${st.reste[p]}</b>
      <small>${st.volees[p].slice(-3).map((v) => (v.nature === 'bust' ? 'bust' : v.score)).join(' · ') || '&nbsp;'}</small>
    </div>`).join('')}</div>`;
}

function tableauDepartage(etat, d) {
  if (d.type === '501') return tableauX01({ joueur: etat.joueur }, d.x01);
  const groupe = d.type === 'bulle' ? d.groupes[0] : d.restants;
  const lance = (p) => { if (d.type !== 'bulle') return ''; const i = groupe.indexOf(p); return i >= 0 && i < d.tour.length ? `<b>${d.tour[i] || 'raté'}</b>` : ''; };
  return `<div class="pd-departage">${groupe.map((p) => `<span class="pd-departage__joueur${p === etat.joueur ? ' pd-actif' : ''}">${esc(nom(p))}${lance(p)}</span>`).join('<i>=</i>')}
    ${d.places.length ? `<p class="match__format">Déjà départagés : ${d.places.map((p) => esc(nom(p))).join(', ')}</p>` : ''}</div>`;
}

// ---------- Saisie ----------
// Fléchettes de la volée : touchez-en une pour l'effacer ; « Tout effacer » vide la volée
const emplacements = (labels) => `<div class="pd-fleches">${[0, 1, 2].map((i) => (labels[i] !== undefined
  ? `<button type="button" class="pd-fleche pd-fleche--pleine" data-retirer-fleche="${i}" aria-label="Effacer la fléchette ${i + 1} (${esc(labels[i])})">${esc(labels[i])}<span class="pd-fleche__x" aria-hidden="true">×</span></button>`
  : `<span class="pd-fleche">${i + 1}</span>`)).join('')}</div>
  ${labels.length ? '<button type="button" class="lien-discret pd-tout-effacer" data-vider-volee>Tout effacer</button>' : '<p class="pd-astuce">Touchez une fléchette pour l\'effacer.</p>'}`;
const boutonValider = (pret, texte = 'Valider la volée') => `<button type="button" class="bouton bouton--plein bouton--large" data-valider ${pret ? '' : 'disabled'}>${texte}</button>`;

function saisieHtml(etat) {
  const d = etat.departage;
  if (d?.type === 'bulle') {
    return `<div class="pd-trois"><button type="button" class="bouton bouton--plein pd-gros" data-action='{"bulle":50}'>50<small>bulle</small></button>
      <button type="button" class="bouton pd-gros pd-gros--25" data-action='{"bulle":25}'>25<small>demi-bulle</small></button>
      <button type="button" class="bouton pd-gros" data-action='{"bulle":0}'>Raté</button></div>`;
  }
  if (d?.type === 'finish') return saisieReussite(d.cible);
  if (d?.type === '501') return saisieX01(d.x01, etat.joueur);
  const cle = etat.jeu;
  const st = etat.jeux[cle];
  if (cle === 'centre') {
    return `${emplacements(volee.map((v) => (v ? String(v) : '0')))}
      <div class="pd-touches pd-touches--3">${[[0, 'Raté'], [25, '25'], [50, '50']].map(([v, l]) => `<button type="button" class="touche" data-fleche="${v}" ${volee.length >= 3 ? 'disabled' : ''}>${l}</button>`).join('')}</div>
      ${boutonValider(volee.length === 3)}`;
  }
  if (cle === 'mickey') {
    // Cricket : simple / double / triple, puis la case. Un double ou un triple sur 15-20 se pose
    // soit sur son numéro (2 ou 3 touches), soit une fois sur la case Double / Triple.
    const p = etat.joueur;
    const compte = (c) => st.touches[p][c] + volee.filter((f) => String(f || '').split('*')[0] === c).reduce((n, f) => n + touchesFleche(f), 0);
    const plein = volee.length >= 3;
    const NUM = ['20', '19', '18', '17', '16', '15'];
    const bouton = (val, texte, cible) => `<button type="button" class="touche" data-fleche="${val}" ${plein || compte(cible) >= 3 ? 'disabled' : ''}>${texte}</button>`;
    let touches;
    if (multi === 1) touches = NUM.map((c) => bouton(c, c, c)).join('') + bouton('C', '25', 'C');
    else {
      const L = multi === 3 ? 'T' : 'D';
      touches = NUM.map((c) => bouton(`${c}*${multi}`, `${L}${c}<small>${multi} touches</small>`, c)).join('')
        + (multi === 2 ? bouton('C*2', '50<small>2 touches</small>', 'C') : '')
        + bouton(L, `Case ${multi === 3 ? 'Triple' : 'Double'}<small>1 touche</small>`, L);
    }
    return `${emplacements(volee.map(libelleCricket))}
      <div class="pd-multi" role="group" aria-label="Multiplicateur">${[[1, 'Simple'], [2, 'Double'], [3, 'Triple']].map(([v, l]) => `<button type="button" class="pastille-choix" data-multi="${v}" aria-pressed="${multi === v}">${l}</button>`).join('')}</div>
      <div class="pd-touches pd-touches--cricket">${touches}
        <button type="button" class="touche touche--effacer" data-fleche="" ${plein ? 'disabled' : ''}>Raté</button></div>
      ${boutonValider(volee.length === 3 || (mickeyFermeAvec(st, p) && volee.length))}`;
  }
  if (cle === 'finish') return saisieReussite(FINISHS[st.etape[etat.joueur]]);
  if (cle === '301a' || cle === '301b') return saisieX01(st, etat.joueur);
  if (cle === 'capital') return saisieCapital(st);
  return '';
}
function mickeyFermeAvec(st, p) {
  return CIBLES_MICKEY.every((c) => st.touches[p][c] + volee.filter((f) => String(f || '').split('*')[0] === c).reduce((n, f) => n + touchesFleche(f), 0) >= 3);
}

function saisieReussite(cible) {
  return `<p class="pd-cible">Finish <b>${cible}</b></p>
    <div class="pd-deux"><button type="button" class="bouton bouton--plein pd-gros" data-action='{"reussi":true}'>Réussi<small>fini sur un double</small></button>
    <button type="button" class="bouton pd-gros" data-action='{"reussi":false}'>Raté</button></div>`;
}

function saisieX01(st, p) {
  if (finEnAttente !== null) {
    return `<p class="pd-cible">${finEnAttente} : fini sur un double ?</p>
      <div class="pd-deux"><button type="button" class="bouton bouton--plein pd-gros" data-fin="1">Oui, fini !</button>
      <button type="button" class="bouton pd-gros" data-fin="0">Non (bust)</button></div>`;
  }
  return `<div class="ecran-saisie pd-ecran"><span class="ecran-saisie__qui">Score de la volée · reste ${st.reste[p]}</span><span class="ecran-saisie__valeur">${saisie || '0'}</span></div>
    <div class="pave pd-pave">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => `<button type="button" class="touche" data-chiffre="${c}">${c}</button>`).join('')}
      <button type="button" class="touche touche--effacer" data-effacer>Effacer</button>
      <button type="button" class="touche" data-chiffre="0">0</button>
      <button type="button" class="touche touche--valider" data-valider-x01>Valider</button></div>`;
}

function saisieCapital(st) {
  const m = MANCHES_CAPITAL[mancheCapital(st)];
  return `<p class="pd-cible">Manche <b>${esc(LIBELLES_CAPITAL[m] || m)}</b>${m === '57' ? ' <small>(exactement 57 avec la volée)</small>' : ''}</p>
    ${emplacements(volee)}
    <div class="pd-multi" role="group" aria-label="Multiplicateur">${[[1, 'Simple'], [2, 'Double'], [3, 'Triple']].map(([v, l]) => `<button type="button" class="pastille-choix" data-multi="${v}" aria-pressed="${multi === v}">${l}</button>`).join('')}</div>
    <div class="pd-touches pd-touches--numeros">${Array.from({ length: 20 }, (_, i) => `<button type="button" class="touche" data-num="${i + 1}" ${volee.length >= 3 ? 'disabled' : ''}>${i + 1}</button>`).join('')}
      <button type="button" class="touche" data-fleche-cap="25" ${volee.length >= 3 ? 'disabled' : ''}>25</button>
      <button type="button" class="touche" data-fleche-cap="Bull" ${volee.length >= 3 ? 'disabled' : ''}>50</button>
      <button type="button" class="touche touche--effacer" data-fleche-cap="0" ${volee.length >= 3 ? 'disabled' : ''}>Raté</button></div>
    ${boutonValider(volee.length === 3)}`;
}

// ---------- Clics ----------
$('pd-saisie').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const etat = calculer(config, actions);
  if (b.dataset.action) return jouer(JSON.parse(b.dataset.action));
  if (b.dataset.fleche !== undefined) {
    const v = b.dataset.fleche;
    volee.push(etat.jeu === 'centre' ? Number(v) : (v || null));
    multi = 1;
    return rendre();
  }
  if (b.dataset.retirerFleche !== undefined) { volee.splice(Number(b.dataset.retirerFleche), 1); return rendre(); }
  if (b.hasAttribute('data-vider-volee')) { volee = []; multi = 1; return rendre(); }
  if (b.dataset.multi) { multi = Number(b.dataset.multi); return rendre(); }
  if (b.dataset.num) {
    const n = b.dataset.num;
    volee.push(multi === 3 ? `T${n}` : multi === 2 ? `D${n}` : n);
    multi = 1;
    return rendre();
  }
  if (b.dataset.flecheCap) { volee.push(b.dataset.flecheCap); multi = 1; return rendre(); }
  if (b.hasAttribute('data-valider')) {
    const f = [...volee];
    while (f.length < 3) f.push(etat.jeu === 'centre' ? 0 : (etat.jeu === 'capital' ? '0' : null));
    return jouer({ fleches: f });
  }
  if (b.dataset.chiffre !== undefined) { if ((saisie + b.dataset.chiffre).length <= 3) saisie = String(Number(saisie + b.dataset.chiffre)); return rendre(); }
  if (b.hasAttribute('data-effacer')) { saisie = saisie.slice(0, -1); return rendre(); }
  if (b.hasAttribute('data-valider-x01')) {
    const s = Number(saisie || 0);
    if (s > 180 || IMPOSSIBLES_301.includes(s)) { message(zoneMsg, `${s} est impossible en 3 fléchettes.`); saisie = ''; return rendre(); }
    const st = etat.departage ? etat.departage.x01 : etat.jeux[etat.jeu];
    if (s === st.reste[etat.joueur]) { finEnAttente = s; return rendre(); }
    return jouer({ score: s });
  }
  if (b.dataset.fin !== undefined) {
    const s = finEnAttente;
    return jouer(b.dataset.fin === '1' ? { score: s, fin: true } : { score: s });
  }
});

$('pd-annuler').addEventListener('click', () => {
  if (finEnAttente !== null) finEnAttente = null;
  else if (saisie) saisie = '';
  else if (volee.length) volee.pop();
  else if (actions.length) actions.pop();
  garder();
  rendre();
});
$('pd-abandonner').addEventListener('click', () => {
  if (!confirm('Abandonner la partie ? Elle ne sera pas enregistrée.')) return;
  oublier();
  clearTimeout(attenteSync);
  const fin = () => { location.href = location.pathname + PARAM; };
  if (partieId) supabase.from('jeux_parties').delete().eq('id', partieId).then(fin, fin); else fin();
});

// ---------- Feuille de score (comme la feuille papier) ----------
const COURTS = { centre: 'Centre', mickey: 'Cricket', finish: 'Finish', '301a': '301', '301b': '301', capital: 'Capital' };
function feuilleHtml(etat) {
  const ordre = config.ordre;
  if (MODE === 'capital') return TABLEAUX.capital({ joueur: -1 }, etat.jeux.capital);
  if (MODE === 'cricket') {
    const m = etat.final?.manches || etat.manches || [];
    const liste = m.length > 1 || etat.objectif > 1
      ? `<ol class="pd-manches">${m.map((x, i) => `<li>Manche ${i + 1} : <strong>${x.gagnant !== null ? esc(nom(x.gagnant)) : '—'}</strong></li>`).join('')}</ol>` : '';
    return liste + (m.length <= 1 ? TABLEAUX.mickey({ joueur: -1 }, etat.jeux.mickey) : '');
  }
  const lignes = etat.phases.map((c) => {
    const r = etat.resultats[c];
    return `<tr><th><span class="pd-num-mini">${JEUX[c].num}</span>${esc(COURTS[c])}</th>${ordre.map((p) => `<td>${r?.points ? `<b>${r.points[p]}</b><small>${r.rangs[p]}${r.rangs[p] === 1 ? 'er' : 'e'}</small>` : ''}</td>`).join('')}</tr>`;
  }).join('');
  const totaux = Object.fromEntries(ordre.map((p) => [p, etat.phases.reduce((s, c) => s + (etat.resultats[c]?.points?.[p] || 0), 0)]));
  return `<div class="pd-defile"><table class="pd-table pd-table--feuille">
    <thead><tr><th>Score final</th>${ordre.map((p) => `<th>${esc(nom(p))}</th>`).join('')}</tr></thead>
    <tbody>${lignes}<tr class="pd-ligne-total"><th>Total</th>${ordre.map((p) => `<td>${totaux[p]}</td>`).join('')}</tr></tbody></table></div>`;
}
$('pd-voir-feuille').addEventListener('click', () => {
  $('pd-feuille').innerHTML = feuilleHtml(calculer(config, actions));
  $('pd-fen-feuille').hidden = false;
});
$('pd-fen-feuille').addEventListener('click', (e) => {
  if (e.target.id === 'pd-fen-feuille' || e.target.closest('[data-fermer]')) $('pd-fen-feuille').hidden = true;
});

// ---------- Fin de partie ----------
function finPartie(etat) {
  $('pd-jeu').hidden = true;
  const zone = $('pd-fin');
  zone.hidden = false;
  const groupes = etat.final.groupes;
  const totaux = etat.final.totaux;
  let rang = 1;
  const podium = groupes.map((g) => { const r = rang; rang += g.length; return g.map((p) => ({ p, r })); }).flat();
  zone.innerHTML = `
    <div class="carte-info pd-fin">
      <p class="pd-fin__sur">${NOMS_MODE[MODE]} terminé</p>
      <h1 class="pd-fin__gagnant">${groupes[0].map((p) => esc(nom(p))).join(' et ')} ${groupes[0].length > 1 ? 'gagnent' : 'gagne'} !</h1>
      <ol class="pd-podium">${podium.map(({ p, r }) => `<li class="pd-podium__ligne${r === 1 ? ' pd-podium__ligne--1' : ''}"><span class="pd-podium__rang">${r}</span><span class="pd-podium__nom">${esc(nom(p))}</span><b>${totaux[p]}<small>${MODE === 'capital' ? '' : MODE === 'cricket' ? (etat.final.unite === 'manches' ? ` manche${totaux[p] > 1 ? 's' : ''}` : ' /27') : ' pts'}</small></b></li>`).join('')}</ol>
      ${(etat.final.departages || []).length ? '<p class="match__format">Égalité au total départagée par une manche de 501.</p>' : ''}
      ${feuilleHtml(etat)}
      <p class="match__format" id="pd-etat-enregistrement"></p>
      <div class="actions">
        <button type="button" class="bouton bouton--plein" id="pd-rejouer">Rejouer avec les mêmes joueurs</button>
        <a class="bouton" href="jouer.html">Retour aux jeux</a>
      </div>
    </div>`;
  $('pd-rejouer').addEventListener('click', () => {
    oublier();
    actions = []; volee = []; tirage = []; enregistre = false; partieId = null;
    $('pd-fin').hidden = true;
    $('pd-reglages').hidden = false;
    afficherJoueurs();
    window.scrollTo({ top: 0 });
  });
  enregistrer(etat);
}

async function enregistrer(etat) {
  const zone = $('pd-etat-enregistrement');
  if (enregistre) { zone.textContent = 'Partie enregistrée dans l\'historique.'; return; }
  if (!moi || moi.status !== 'active') { zone.textContent = 'Connectez-vous pour garder un historique de vos parties.'; return; }
  const resultat = {
    classement: etat.final.groupes,
    totaux: etat.final.totaux,
    jeux: Object.fromEntries(Object.entries(etat.resultats).map(([c, r]) => [c, { points: r.points, rangs: r.rangs }])),
    ...(config.format ? { format: config.format, unite: etat.final.unite, manches: (etat.final.manches || []).map((m) => m.gagnant) } : {}),
  };
  clearTimeout(attenteSync);
  let { error } = partieId
    ? await supabase.from('jeux_parties').update({ statut: 'finished', resultat, actions, ordre: config.ordre }).eq('id', partieId)
    : await supabase.from('jeux_parties').insert({ jeu: MODE, joueurs: joueursEnLigne(), ordre: config.ordre, resultat, actions, statut: 'finished' });
  // Script 040 pas encore lancé : enregistrement à l'ancienne (sans statut)
  if (error && /statut/.test(error.message || '')) {
    ({ error } = await supabase.from('jeux_parties').insert({ jeu: MODE, joueurs: joueursEnLigne(), ordre: config.ordre, resultat, actions }));
  }
  if (error) {
    zone.textContent = /jeux_parties/.test(error.message || '') ? 'Historique pas encore disponible (script SQL 039 à lancer).' : `Partie non enregistrée : ${erreurFr(error)}`;
    return;
  }
  enregistre = true;
  garder();
  zone.textContent = 'Partie enregistrée dans l\'historique.';
}

// ---------- Historique ----------
async function chargerHistorique() {
  if (!moi || moi.status !== 'active') return;
  let { data, error } = await supabase.from('jeux_parties').select('id, created_at, joueurs, resultat').eq('jeu', MODE).eq('statut', 'finished').order('created_at', { ascending: false }).limit(10);
  if (error) ({ data, error } = await supabase.from('jeux_parties').select('id, created_at, joueurs, resultat').eq('jeu', MODE).order('created_at', { ascending: false }).limit(10));
  if (error || !data?.length) return;
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  $('pd-historique').hidden = false;
  $('pd-liste-historique').innerHTML = data.map((g) => {
    const noms = (g.joueurs || []).map((j) => j.nom);
    const premier = (g.resultat?.classement?.[0] || []).map((p) => noms[p]).join(' et ');
    const t = g.resultat?.totaux || {};
    return `<article class="carte-info pd-histo">
      <span class="match__format">${esc(fmt.format(new Date(g.created_at)))}</span>
      <strong>${esc(premier || '?')} ${premier.includes(' et ') ? 'gagnent' : 'gagne'}</strong>
      <span class="pd-histo__scores">${(g.resultat?.classement || []).flat().map((p) => `${esc(noms[p])} <b>${t[p] ?? ''}</b>`).join(' · ')}</span>
    </article>`;
  }).join('');
}

// ---------- Parties en cours (en ligne et sur cet appareil) ----------
function reprendre(cfg, acts, id, dejaEnregistre = false) {
  config = cfg; actions = acts || []; partieId = id || null; enregistre = dejaEnregistre;
  volee = []; saisie = ''; finEnAttente = null;
  garder();
  demarrer();
}
const versConfig = (g) => ({ mode: MODE, joueurs: (g.joueurs || []).map((j) => ({ nom: j.nom, id: j.profile_id || undefined })), ordre: g.ordre || [], ...(g.resultat?.format ? { format: g.resultat.format } : {}) });

async function afficherReprises() {
  const local = lireSauvegarde();
  let enLigne = [];
  if (moi?.status === 'active') {
    const depuis = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data } = await supabase.from('jeux_parties').select('id, joueurs, ordre, actions, created_by, updated_at')
      .eq('jeu', MODE).eq('statut', 'live').gte('updated_at', depuis).order('updated_at', { ascending: false });
    // Seulement les parties où je joue avec mon compte, ou que j'ai lancées
    enLigne = (data || []).filter((g) => g.created_by === moi.id || (g.joueurs || []).some((j) => j.profile_id === moi.id));
  }
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const cartes = enLigne.map((g) => {
    const etat = calculer(versConfig(g), g.actions || []);
    return `<div class="carte-info pd-reprise">
      <strong>Partie en cours</strong>
      <span class="match__format">${(g.joueurs || []).map((j) => esc(j.nom)).join(' – ')} · ${esc(JEUX[etat.jeu]?.titre || 'départage')} · ${esc(fmt.format(new Date(g.updated_at)))}</span>
      <div class="actions"><button type="button" class="bouton bouton--plein" data-reprendre-en-ligne="${g.id}">Reprendre la partie</button>
      <button type="button" class="bouton bouton--danger" data-abandon-en-ligne="${g.id}">Abandonner</button></div></div>`;
  });
  // Partie gardée seulement sur cet appareil (pas encore en ligne)
  const localSeul = local?.config?.joueurs?.length && local.actions && !local.enregistre && !enLigne.some((g) => g.id === local.partieId);
  if (localSeul) {
    const etat = calculer(local.config, local.actions);
    if (!etat.termine) {
      cartes.push(`<div class="carte-info pd-reprise">
        <strong>Partie en cours sur cet appareil</strong>
        <span class="match__format">${local.config.joueurs.map((j) => esc(j.nom)).join(' – ')} · ${esc(JEUX[etat.jeu]?.titre || 'départage')}</span>
        <div class="actions"><button type="button" class="bouton bouton--plein" data-reprendre-local>Reprendre la partie</button>
        <button type="button" class="bouton bouton--danger" data-abandon-local>Abandonner</button></div></div>`);
    }
  }
  $('pd-reprise').innerHTML = cartes.join('');
  $('pd-reprise').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.reprendreEnLigne) {
      const g = enLigne.find((x) => x.id === b.dataset.reprendreEnLigne);
      return reprendre(versConfig(g), g.actions, g.id);
    }
    if (b.hasAttribute('data-reprendre-local')) return reprendre(local.config, local.actions, local.partieId || null);
    if (!confirm('Abandonner cette partie ? Elle sera supprimée.')) return;
    if (b.dataset.abandonEnLigne) await supabase.from('jeux_parties').delete().eq('id', b.dataset.abandonEnLigne);
    if (b.hasAttribute('data-abandon-local') || local?.partieId === b.dataset.abandonEnLigne) oublier();
    afficherReprises();
  };
  // Lien « Reprendre » depuis Mes parties
  const demande = new URLSearchParams(location.search).get('reprendre');
  const g = demande && enLigne.find((x) => x.id === demande);
  if (g) reprendre(versConfig(g), g.actions, g.id);
}

// ---------- Démarrage ----------
async function init() {
  moi = await profilConnecte().catch(() => null);
  if (moi?.status === 'active') {
    const { data } = await supabase.from('profiles').select('id, first_name, last_name, nickname, use_nickname').eq('status', 'active').order('last_name');
    membres = data || [];
    $('pd-champ-membre').hidden = false;
    if (!config.joueurs.length) config.joueurs.push({ nom: nomAffiche(moi), id: moi.id });
  }
  await afficherReprises();
  afficherJoueurs();
  chargerHistorique();
}
init();
