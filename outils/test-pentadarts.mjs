// Vérifie les règles du Pentadarts et du Capital. Lancer : node outils/test-pentadarts.mjs
import { calculer, pointsCapital, FINISHS } from '../assets/js/pentadarts-regles.js';

let ok = 0; let ko = 0;
const egal = (obtenu, attendu, txt) => {
  const a = JSON.stringify(obtenu); const b = JSON.stringify(attendu);
  if (a === b) ok++; else { ko++; console.log('ÉCHEC', txt, '→', a, 'attendu', b); }
};
const cfg = (n, mode = 'pentadarts') => ({ mode, joueurs: Array.from({ length: n }, (_, i) => ({ nom: `J${i + 1}` })), ordre: Array.from({ length: n }, (_, i) => i) });

// ---------- Capital : calcul des manches ----------
egal(pointsCapital('$', ['T20', 'T20', '20']), 140, 'capital $');
egal(pointsCapital('20', ['T20', '5', 'D20']), 100, 'manche 20 : seuls les 20 comptent');
egal(pointsCapital('D', ['D16', 'Bull', '20']), 82, 'manche double : doubles et bull');
egal(pointsCapital('T', ['T19', '19', 'T5']), 72, 'manche triple');
egal(pointsCapital('57', ['T19', '0', '0']), 57, '57 : T19 et deux ratés');
egal(pointsCapital('57', ['T19', '1', '0']), 0, '57 raté');
egal(pointsCapital('C', ['25', 'Bull', '0']), 75, 'centre : 25 et 50');
// Capital seul (2 joueurs) : un 0 divise par 2, arrondi au-dessus
{
  const c = cfg(2, 'capital');
  const a = [
    { fleches: ['T20', 'T20', '20'] }, { fleches: ['1', '1', '1'] },   // $ : 140 / 3
    { fleches: ['0', '0', '0'] }, { fleches: ['20', '0', '0'] },        // 20 : 70 / 23
  ];
  const e = calculer(c, a);
  egal(e.jeux.capital.capital, [70, 23], 'capital : 140 → 70 ; 3 + 20 = 23');
  const e2 = calculer(c, [{ fleches: ['T20', 'T20', '1'] }, { fleches: ['0', '0', '0'] }, { fleches: ['0'] }]);
  egal(e2.jeux.capital.capital[0], 61, 'capital impair : 121 → 61 (arrondi au-dessus)');
}

// ---------- Pentadarts à 4 joueurs : partie complète ----------
const c4 = cfg(4);
const A = [];
const tour = (...volees) => volees.forEach((v) => A.push(v));
// 1. Centre : ordre J1 J2 J3 J4. J1 marque 4 points par tour (50+50+0) → 12 au 3e tour
const V = (...f) => ({ fleches: f });
tour(V(50, 50, 0), V(25, 0, 0), V(25, 25, 0), V(0, 0, 0));
tour(V(50, 50, 0), V(25, 0, 0), V(25, 25, 0), V(0, 0, 0));
let e = calculer(c4, A);
egal(e.jeu, 'centre', 'centre pas fini avant 11');
tour(V(50, 50, 0), V(50, 0, 0), V(25, 25, 0), V(0, 0, 25));   // J1 12, J2 4, J3 6, J4 1
e = calculer(c4, A);
egal(e.jeu, 'mickey', 'centre fini à la fin du tour où J1 atteint 11');
egal(e.resultats.centre.classement, [0, 2, 1, 3], 'classement du centre');
egal(e.resultats.centre.points, { 0: 3, 1: 0, 2: 1, 3: 0 }, 'points du centre (3/1/0, 4e à 0)');
egal(e.joueur, 1, 'mickey : J2 commence (rotation)');
// 2. Mickey : J2 ferme tout en 9 volées (3 cibles par volée) ; les autres 1 touche par volée
const C = ['20', '19', '18', '17', '16', '15', 'C', 'T', 'D'];
for (let v = 0; v < 9; v++) {
  const cible = C[Math.floor(v / 3) * 3];
  tour(V(...C.slice(Math.floor(v / 3) * 3, Math.floor(v / 3) * 3 + 3)), V(C[v % 9]), V(v < 5 ? '20' : null), V(C[v % 9], C[(v + 1) % 9]));
  void cible;
}
e = calculer(c4, A);
egal(e.jeu, 'finish', 'mickey fini quand J2 a tout fermé (fin du tour)');
egal(e.resultats.mickey.classement[0], 1, 'J2 gagne le mickey');
egal(e.resultats.mickey.points[1], 3, 'J2 : 3 points');
egal(e.joueur, 2, 'finish : J3 commence');
// 3. Finish (ordre J3 J4 J1 J2) : J3 réussit tout ; J4 et J2 bloqués ensemble sur 24 (4 réussites), J1 sur 40
for (let v = 0; v < 6; v++) tour({ reussi: true }, { reussi: v < 4 }, { reussi: v < 1 }, { reussi: v < 4 });
e = calculer(c4, A);
egal(e.departage?.type, 'finish', 'égalité pour la 2e place au finish : départage sur le finish restant');
egal(e.departage?.cible, 24, 'ils rejouent le 24');
egal(e.joueur, 3, 'J4 lance en premier (ordre du jeu J3 J4 J1 J2)');
tour({ reussi: false }, { reussi: true });   // J4 rate, J2 réussit → J2 2e
e = calculer(c4, A);
egal(e.resultats.finish.classement, [2, 1, 3, 0], 'classement du finish après départage');
egal(e.resultats.finish.points, { 0: 0, 1: 2, 2: 6, 3: 0 }, 'points du finish 6/2/0');
egal(e.jeu, '301a', 'on passe au 301');
egal(e.joueur, 3, '301 1re manche : J4 commence');
// 4. 301 : J4 finit au 3e passage ; restes : J1 101, J2 201, J3 101 → égalité 2e : bulle
tour({ score: 100 }, { score: 100 }, { score: 50 }, { score: 100 });
tour({ score: 100 }, { score: 100 }, { score: 50 }, { score: 100 });
tour({ score: 101, fin: true });
e = calculer(c4, A);
egal(e.departage?.type, 'bulle', 'égalité au 301 : départage à la bulle');
egal(e.departage?.restants, [0, 2], 'J1 et J3 à la bulle');
tour({ touche: false }, { touche: true });   // J1 rate, J3 touche → J3 2e
e = calculer(c4, A);
egal(e.resultats['301a'].classement, [3, 2, 0, 1], 'classement du 301');
egal(e.jeu, '301b', '2e manche de 301');
egal(e.joueur, 0, "301 2e manche : J1 commence (4' = 5e jeu)");
tour({ score: 180 }, { score: 0 }, { score: 0 }, { score: 0 }, { score: 121, fin: true });
e = calculer(c4, A);
egal(e.departage?.restants, [1, 2, 3], '301 2e manche : J2 J3 J4 à égalité pour la 2e place → bulle');
tour({ touche: true });   // J2 touche : 2e ; J3 et J4 restent à égalité (0 point chacun)
e = calculer(c4, A);
egal(e.resultats['301b'].classement[0], 0, 'J1 gagne la 2e manche');
egal(e.jeu, 'capital', 'capital');
egal(e.joueur, 1, 'capital : J2 commence');
// Bust : 2 restant, score 2 sans « fini » = bust
// 5. Capital : 8 manches × 4 joueurs ; J2 marque le plus
for (let m = 0; m < 8; m++) tour(V('T20', 'T20', 'T20'), V('0'), V('1'), V('2'));
e = calculer(c4, A);
// J4 et J1 finissent à 1 (1 ou 2, puis divisés par 2) : égalité pour la 2e place → bulle
egal(e.departage?.restants, [3, 0], 'capital : J4 et J1 à la bulle');
tour({ touche: true });
e = calculer(c4, A);
egal(e.resultats.capital.classement[0], 1, 'J2 gagne le capital');
egal(e.termine || !!e.departage, true, 'partie finie (ou départage final)');
const tot = e.final.totaux;
egal(Object.values(tot).reduce((a, b) => a + b, 0), (3 + 1) * 4 + (6 + 2) + (7 + 3), 'somme des points distribués');
console.log('Totaux :', JSON.stringify(tot), e.final.groupes.map((g) => g.map((p) => `J${p + 1}`).join('=')).join(' > '), e.departage ? `départage ${e.departage.type}` : '');

// ---------- Égalité au total pour la 1re place : manche de 501 ----------
{
  const c3 = cfg(3);
  const B = [];
  const t3 = (...v) => v.forEach((x) => B.push(x));
  t3(V(50, 50, 50), V(50, 50, 0), V(0)); t3(V(50, 50, 50), V(50, 50, 0), V(0));           // centre : J1 3, J2 1
  for (let v = 0; v < 9; v++) t3(V(...C.slice((v % 3) * 3, (v % 3) * 3 + 3)), V(C[v]), V()); // mickey : J2 3, J3 1
  for (let v = 0; v < 6; v++) t3({ reussi: v < 2 }, { reussi: true }, { reussi: false });    // finish : J1 6, J3 2
  t3({ score: 0 }, { score: 0 }, { score: 0 }, { score: 0 }, { score: 301, fin: true });   // 301a : J2 gagne
  t3({ touche: false }, { touche: true });                                                  // bulle : J3 2e
  t3({ score: 0 }, { score: 0 }, { score: 301, fin: true });                                // 301b : J1 gagne
  t3({ touche: true });                                                                     // bulle : J2 2e
  for (let m = 0; m < 8; m++) t3(V('0'), V('T20'), V('T19'));                              // capital : J2 7, J1 3
  const s = calculer(c3, B);
  egal(s.final?.totaux, { 0: 15, 1: 15, 2: 4 }, 'totaux 15 / 15 / 4');
  egal(s.departage?.type, '501', 'égalité pour la 1re place : manche de 501');
  egal(s.joueur, 0, 'le 501 commence par J1 (ordre de départ)');
  B.push({ score: 140 }, { score: 501, fin: true });
  const f = calculer(c3, B);
  egal(f.termine, true, 'partie terminée après la manche de 501');
  egal(f.final.groupes.map((g) => g.join('=')), ['1', '0', '2'], 'J2 gagne le 501 et le Pentadarts');
}

console.log(`${ok} PASS, ${ko} FAIL`);
process.exit(ko ? 1 : 0);
