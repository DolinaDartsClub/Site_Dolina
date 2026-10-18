// =====================================================================
//  Entraînement « Compter une manche » : valeurs des fléchettes et
//  explications de calcul mental (le chemin le plus simple).
//  Aucune dépendance au navigateur : testé par outils/test-compter.mjs.
// =====================================================================

import { finissable } from './x01.js?v=__VERSION__';

export function valeurFleche(label) {
  if (label === 'Bull') return 50;
  if (label === '25') return 25;
  if (label === '0') return 0;
  const n = Number(label.replace(/^[TD]/, ''));
  if (label.startsWith('T')) return 3 * n;
  if (label.startsWith('D')) return 2 * n;
  return n;
}

export function nomFleche(label) {
  if (label === 'Bull') return 'Bull (50)';
  if (label === '25') return '25 (demi-bull)';
  if (label === '0') return 'hors cible (0)';
  if (label.startsWith('T')) return `triple ${label.slice(1)} = ${valeurFleche(label)}`;
  if (label.startsWith('D')) return `double ${label.slice(1)} = ${valeurFleche(label)}`;
  return `simple ${label}`;
}

// a + b, présenté le plus simplement : « 79 + 19 = 79 + 20 − 1 = 98 »
function addition(a, b) {
  const u = b % 10;
  if (b >= 10 && u >= 7) {
    const rond = b + (10 - u);
    return `${a} + ${b} = ${a} + ${rond} − ${10 - u} = ${a + b}`;
  }
  return `${a} + ${b} = ${a + b}`;
}

// Explication du total d'une volée : on commence par la plus grosse fléchette
export function expliquerVolee(labels) {
  const valeurs = labels.map(valeurFleche);
  const lignes = [labels.map((l) => nomFleche(l)).join(' · ')];
  const tri = [...valeurs].sort((x, y) => y - x).filter((v) => v > 0);
  if (tri.length > 1) {
    let total = tri[0];
    const etapes = [];
    for (const v of tri.slice(1)) { etapes.push(addition(total, v)); total += v; }
    lignes.push(`On part de la plus grosse : ${etapes.join(', puis ')}`);
  }
  return { total: valeurs.reduce((s, v) => s + v, 0), lignes };
}

// Explication du reste : on arrondit le score à la dizaine la plus proche
export function expliquerReste(reste, score) {
  const r = reste - score;
  if (score === 0) return `${reste} − 0 = ${reste}`;
  const u = score % 10;
  if (score < 10) return `${reste} − ${score} = ${r}`;
  if (u === 0) {
    const c = Math.floor(score / 100) * 100;
    return c && c !== score ? `${reste} − ${score} : ${reste} − ${c} = ${reste - c}, puis − ${score - c} = ${r}` : `${reste} − ${score} = ${r}`;
  }
  if (u >= 5) {
    const rond = score + (10 - u);
    return `${reste} − ${score} : ${reste} − ${rond} = ${reste - rond}, puis on rajoute ${10 - u} → ${r}`;
  }
  const dizaines = score - u;
  return `${reste} − ${score} : ${reste} − ${dizaines} = ${reste - dizaines}, puis − ${u} → ${r}`;
}

// ---------- Chemin de finish conseillé ----------
// On vise d'abord les doubles qui « se coupent » bien en deux quand on touche le simple :
// D20 → D10, D16 → D8 → D4, D12 → D6, D18 (→ D9)
export const DOUBLES_CONSEILLES = [20, 16, 10, 8, 12, 18, 6, 4];
const SUITE_DOUBLE = {
  20: 'si la fléchette tombe dans le simple 20, il reste 20 : on enchaîne sur D10',
  16: 'si elle tombe dans le simple 16, il reste D8, puis D4 : le double qui se coupe le mieux',
  10: 'si elle tombe dans le simple 10, il reste D5',
  8: 'si elle tombe dans le simple 8, il reste D4, puis D2',
  12: 'si elle tombe dans le simple 12, il reste D6, puis D3',
  18: 'si elle tombe dans le simple 18, il reste D9',
  6: 'si elle tombe dans le simple 6, il reste D3',
  4: 'si elle tombe dans le simple 4, il reste D2, puis D1',
};
const FLECHES = (() => {
  const l = [];
  for (let n = 1; n <= 20; n++) l.push({ l: String(n), v: n, cout: 0 });
  l.push({ l: '25', v: 25, cout: 1 });
  for (let n = 1; n <= 20; n++) l.push({ l: `T${n}`, v: 3 * n, cout: 1 });
  for (let n = 1; n <= 20; n++) l.push({ l: `D${n}`, v: 2 * n, cout: 2 });
  l.push({ l: 'Bull', v: 50, cout: 2 });
  return l;
})();
const FINALES = [...Array.from({ length: 20 }, (_, i) => ({ l: `D${i + 1}`, v: 2 * (i + 1), n: i + 1 })), { l: 'Bull', v: 50, n: 25 }];
const rangDouble = (f) => { const i = DOUBLES_CONSEILLES.indexOf(f.n); return i >= 0 ? i : (f.n === 25 ? 30 : 10 + (20 - f.n)); };

// Le chemin le plus court qui finit, de préférence, sur un double conseillé
export function cheminConseille(reste) {
  if (!finissable(reste)) return null;
  let meilleur = null;
  const garder = (chemin, finale) => {
    const setup = chemin.slice(0, -1);
    // D'abord finir sur un double conseillé (quitte à prendre une fléchette de plus), puis le moins de fléchettes
    const cle = [DOUBLES_CONSEILLES.includes(finale.n) ? 0 : 1, chemin.length, rangDouble(finale), setup.reduce((s, x) => s + x.cout, 0), -(setup[0]?.v || 0)];
    if (!meilleur || cle.some((v, i) => v !== meilleur.cle[i] && cle.slice(0, i).every((w, j) => w === meilleur.cle[j]) && v < meilleur.cle[i])) meilleur = { cle, chemin, finale };
  };
  for (const f of FINALES) {
    if (f.v === reste) garder([f], f);
    for (const a of FLECHES) {
      if (a.v + f.v === reste) garder([a, f], f);
      for (const b of FLECHES) if (a.v + b.v + f.v === reste) garder([a, b, f], f);
    }
  }
  if (!meilleur) return null;
  return { chemin: meilleur.chemin.map((x) => x.l), double: meilleur.finale.n, explication: SUITE_DOUBLE[meilleur.finale.n] || null };
}

// Correction complète d'une volée. labels : fléchettes ; reste : avant la volée
export function corriger(labels, reste) {
  const { total, lignes } = expliquerVolee(labels);
  const apres = reste - total;
  const dernier = labels[labels.length - 1];
  const finish = apres === 0 && (dernier.startsWith('D') || dernier === 'Bull');
  const bust = !finish && (apres < 0 || apres === 1 || apres === 0);
  const res = { total, bust, finish, reste: bust ? reste : apres, lignes: [...lignes] };
  if (bust) {
    res.lignes.push(apres === 0
      ? `${reste} − ${total} = 0, mais la dernière fléchette n'est pas un double : bust, la volée compte 0 et le reste reste à ${reste}.`
      : `${reste} − ${total} = ${apres} : ${apres < 0 ? 'on dépasse' : 'il resterait 1, impossible à finir'} → bust, la volée compte 0 et le reste reste à ${reste}.`);
  } else if (finish) {
    res.lignes.push(`${reste} − ${total} = 0, terminé sur ${dernier === 'Bull' ? 'le bull' : `le ${nomFleche(dernier).split(' =')[0]}`} : game shot !`);
  } else {
    res.lignes.push(`Reste : ${expliquerReste(reste, total)}`);
    const c = cheminConseille(apres);
    if (c) {
      res.conseil = `Il reste ${apres} : finish conseillé en ${c.chemin.length} fléchette${c.chemin.length > 1 ? 's' : ''} — ${c.chemin.join(' · ')}`;
      if (c.explication) res.pourquoi = `Pourquoi finir sur ${c.double === 25 ? 'le bull' : `D${c.double}`} ? ${c.explication.charAt(0).toUpperCase()}${c.explication.slice(1)}.`;
    }
  }
  return res;
}
