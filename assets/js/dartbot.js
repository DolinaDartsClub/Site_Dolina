// =====================================================================
//  Dartbot : un adversaire simulé fléchette par fléchette.
//  Réglages : moyenne visée (sur 3 fléchettes) et réussite aux doubles (%).
//  Le bot vise T20 pour marquer, suit le chemin de finish quand il peut
//  finir, et peut rater (simple, voisin, hors double, bust) : ses volées
//  varient autour de la moyenne visée (cahier des charges § 6.7).
//  Aucune dépendance : testé par outils/test-dartbot.mjs.
// =====================================================================

import { suggestionFinish, IMPOSSIBLES } from './x01.js?v=__VERSION__';

// Ordre des numéros sur la cible (pour les voisins)
const CIBLE = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const voisin = (n, rng) => {
  const i = CIBLE.indexOf(n);
  return CIBLE[(i + (rng() < 0.5 ? 1 : CIBLE.length - 1)) % CIBLE.length];
};
const borne = (x, a, b) => Math.min(b, Math.max(a, x));

export const BOT_DEFAUT = { moyenne: 50, doubles: 30 };
export const BOT_LIMITES = { moyenne: [20, 110], doubles: [5, 80] };

// Le réglage est écrit dans le nom du camp : « Dartbot · moy. 50 · D 30 % »
export const nomCampBot = ({ moyenne, doubles }) => `Dartbot · moy. ${moyenne} · D ${doubles} %`;
export function lireReglageBot(nom) {
  const m = /moy\.\s*(\d+).*D\s*(\d+)/.exec(nom || '');
  if (!m) return { ...BOT_DEFAUT };
  return {
    moyenne: borne(Number(m[1]), ...BOT_LIMITES.moyenne),
    doubles: borne(Number(m[2]), ...BOT_LIMITES.doubles),
  };
}

// Probabilités d'un lancer vers un triple, calées sur la moyenne visée.
// Le facteur compense les fléchettes « perdues » en fin de manche (placement, doubles).
function profil({ moyenne, doubles }) {
  const m = (moyenne * 1.09) / 3;            // points visés par fléchette
  const S = 15.75;                            // simple moyen quand on rate le triple (20, ou 1 / 5)
  let pT; let pS; let p0;
  if (m >= S * 0.97) { p0 = 0.03; pT = borne((m - S * (1 - p0)) / (60 - S), 0, 0.95); pS = 1 - p0 - pT; }
  else { pT = 0; pS = borne(m / S, 0.05, 1); p0 = 1 - pS; }
  return { pT, pS, pSimple: borne(0.55 + m / 60, 0.55, 0.97), pD: doubles / 100 };
}

// Un lancer : renvoie { v, double, label } ; label : « T20 », « 20 », « D16 », « 25 », « Bull » ou « 0 » (hors cible)
const S = (n) => ({ v: n, double: false, label: String(n) });
const T = (n) => ({ v: 3 * n, double: false, label: `T${n}` });
const D = (n) => ({ v: 2 * n, double: true, label: `D${n}` });
const BULL = { v: 50, double: true, label: 'Bull' };
const VINGT_CINQ = { v: 25, double: false, label: '25' };
const RATE = { v: 0, double: false, label: '0' };
function lancer(cible, p, rng) {
  const r = rng();
  if (cible === 'Bull') {
    if (r < p.pD * 0.7) return BULL;
    return rng() < 0.45 ? VINGT_CINQ : S(CIBLE[Math.floor(rng() * 20)]);
  }
  if (cible === '25') {
    if (r < 0.35 + p.pSimple / 3) return VINGT_CINQ;
    return rng() < 0.12 ? BULL : S(CIBLE[Math.floor(rng() * 20)]);
  }
  const n = Number(cible.replace(/^[TD]/, ''));
  if (cible.startsWith('T')) {
    if (r < p.pT) return T(n);
    if (r < p.pT + p.pS) return S(rng() < 0.75 ? n : voisin(n, rng));
    return RATE;
  }
  if (cible.startsWith('D')) {
    if (r < p.pD) return D(n);
    const r2 = rng();
    if (r2 < 0.45) return S(n);
    if (r2 < 0.55) return S(voisin(n, rng));
    return RATE;                                    // hors de la cible
  }
  // Simple
  if (r < p.pSimple) return S(n);
  const r2 = rng();
  if (r2 < 0.7) return S(voisin(n, rng));
  if (r2 < 0.85) return T(n);
  return RATE;
}

// Où viser avec `d` fléchettes en main ?
const LAISSES = [40, 32, 36, 24, 20, 16, 8, 12, 4, 28, 38, 34, 30, 26, 22, 18, 14, 10, 6, 2];
function viser(reste, d) {
  const chemin = suggestionFinish(reste);
  if (chemin && chemin.length <= d) return chemin[0];
  if (reste >= 62) return 'T20';
  // Placement : laisser un double (de préférence D20, D16…)
  for (const l of LAISSES) {
    const s = reste - l;
    if (s >= 1 && s <= 20) return String(s);
    if (s === 25) return '25';
  }
  return reste > 21 ? '20' : String(Math.max(1, reste - 2));
}

// Réussite au double « corrigée » : le hasard pur donne parfois 60 % sur un match court
// pour un bot réglé à 18 %. On rapproche donc la chance de chaque fléchette de l'écart
// entre la réussite visée et la réussite déjà obtenue dans la partie.
function chanceDouble(cible, finishs, flechettes) {
  const deficit = cible * flechettes - finishs;   // > 0 : le bot est en dessous de son réglage
  return borne(cible + 0.6 * deficit, 0.02, 0.92);
}

// Une volée du bot. Renvoie { score, nature, flechettes, auDouble, detail: ['T20', '19', …] }
// historique : { finishs, auDouble } du bot depuis le début de la partie (pour la réussite au double)
export function voleeBot(reste, reglage, rng = Math.random, historique = { finishs: 0, auDouble: 0 }) {
  const p = profil(reglage);
  let r = reste;
  let auDouble = 0;
  const detail = [];
  for (let d = 3; d >= 1; d--) {
    const cible = viser(r, d);
    const surFinish = (cible.startsWith('D') || cible === 'Bull') && suggestionFinish(r)?.length === 1;
    if (surFinish) {
      p.pD = chanceDouble(reglage.doubles / 100, historique.finishs || 0, (historique.auDouble || 0) + auDouble);
      auDouble += 1;
    }
    const l = lancer(cible, p, rng);
    detail.push(l.label);
    const apres = r - l.v;
    if (apres === 0 && l.double) {
      return { score: reste, nature: 'finish', flechettes: 4 - d, auDouble: Math.max(1, auDouble), detail };
    }
    if (apres < 0 || apres === 1 || apres === 0) {
      // Bust : la volée vaut 0. Score noté : un total qui « passe » le reste (jamais le reste exact)
      const score = [reste - r + l.v, reste + 1, reste + 2, reste - 1]
        .find((s) => s !== reste && s >= 0 && s <= 180 && !IMPOSSIBLES.includes(s) && (reste - s < 2));
      if (score !== undefined) return { score, nature: 'bust', flechettes: 3, auDouble, detail };
      // Très rare (ex. 180 pile sur un reste de 180) : impossible à noter en bust, la fléchette compte 0
      detail[detail.length - 1] = '0';
      continue;
    }
    r = apres;
  }
  return { score: reste - r, nature: 'normale', flechettes: 3, auDouble, detail };
}

// Tirage au bull : distance au centre (mm) d'une fléchette du bot, selon son niveau.
// Dispersion autour du centre (loi de Rayleigh) : ~12 mm pour un pro, ~70 mm pour un débutant.
export function bullBot({ moyenne }, rng = Math.random) {
  const sigma = borne(95 - 0.75 * moyenne, 12, 80);
  const d = sigma * Math.sqrt(-2 * Math.log(1 - rng()));
  const angle = rng() * 2 * Math.PI;
  return { x: d * Math.cos(angle), y: d * Math.sin(angle), distance: d };
}
