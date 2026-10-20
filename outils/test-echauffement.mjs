// Vérifie l'échauffement (scoring + doubles). Lancer : node outils/test-echauffement.mjs
import { calculer, cibleActuelle, DOUBLES } from '../assets/js/echauffement-regles.js';

let ok = 0; let ko = 0;
const egal = (o, a, t) => { const x = JSON.stringify(o); const y = JSON.stringify(a); if (x === y) ok++; else { ko++; console.log('ÉCHEC', t, '→', x, 'attendu', y); } };
const F = (f) => ({ f });

// ---------- Scoring ----------
let A = [F('T'), F('T'), F('T')];                     // 9 points sur le 20
let e = calculer({ mode: 'normal' }, A);
egal([e.phase, e.etape, e.points], ['scoring', 0, 9], '9 points sur le 20');
A.push(F('S'));                                       // 10 → le 19
e = calculer({ mode: 'normal' }, A);
egal([e.etape, e.points], [1, 0], '20 validé à 10 points');
A.push(F('T'), F('T'), F('T'), F('D'));               // 11 sur le 19 → étape 18/16
e = calculer({ mode: 'normal' }, A);
egal(cibleActuelle(e).aChoisir, true, 'il faut choisir 18 ou 16');
A.push(F('T'));                                       // ignoré tant que pas choisi
egal(calculer({ mode: 'normal' }, A).points, 0, 'fléchette ignorée avant le choix');
A.push({ choix: 16 }, F('T'), F('T'), F('T'), F('T'));
e = calculer({ mode: 'normal' }, A);
egal([e.etape, cibleActuelle(e).cible], [3, 'B'], '16 choisi et validé, place à la bulle');
A.push(F('50'), F('25'), F('0'), F('50'));           // 2 + 1 + 0 + 2 = 5
e = calculer({ mode: 'normal' }, A);
egal([e.phase, cibleActuelle(e).double, cibleActuelle(e).vise], ['doubles', 20, 20], 'bulle à 5 points : place aux doubles (D20)');
egal(e.flechettesScoring, 16, 'fléchettes de scoring comptées (la fléchette avant le choix ne compte pas)');

// ---------- Doubles : exemple de la règle (D18 : simple 18, D9, D18 = 2 finishs) ----------
const D = (...f) => f.map(F);
let B = [...D('D', '0', '0')];                        // D20 réussi
e = calculer({ mode: 'normal', sansScoring: true }, B);
egal([e.i, DOUBLES[e.i]], [1, 18], 'D20 réussi : on passe au D18');
B.push(...D('S'));
e = calculer({ mode: 'normal', sansScoring: true }, B);
egal(cibleActuelle(e).vise, 9, 'simple 18 : on vise D9');
B.push(...D('D'));
e = calculer({ mode: 'normal', sansScoring: true }, B);
egal(cibleActuelle(e).vise, 18, 'D9 touché : on revise D18');
B.push(...D('D'));
e = calculer({ mode: 'normal', sansScoring: true }, B);
egal([e.finishs[18], DOUBLES[e.i]], [2, 16], '2 finishs sur le D18, puis D16');
// D20 visé, simple 20 → D10
const C = [...D('S')];
egal(cibleActuelle(calculer({ mode: 'normal', sansScoring: true }, C)).vise, 10, 'simple 20 : on vise D10');
// D9 visé : un simple 9 ne laisse pas de double (compte comme raté)
const O = [...D('D', '0', '0', 'S', 'S')];
egal(cibleActuelle(calculer({ mode: 'normal', sansScoring: true }, O)).vise, 9, 'D18 → S18 → D9 ; S9 ignoré');

// ---------- Normal : volée ratée, on recommence le même double ----------
let N = [...D('D', '0', '0', 'D', '0', '0', '0', '0', '0')];
e = calculer({ mode: 'normal', sansScoring: true }, N);
egal([DOUBLES[e.i], e.voleesRatees], [16, 1], 'normal : D16 raté → on reste sur D16');

// ---------- Expert : verrouillage et retour ----------
let X = [...D('D', 'D', 'D')];                        // D20 réussi 3 fois → verrouillé
e = calculer({ mode: 'expert', sansScoring: true }, X);
egal([e.verrouilles.has(20), DOUBLES[e.i]], [true, 18], 'expert : D20 verrouillé (3 finishs)');
X.push(...D('D', '0', '0'));                          // D18 réussi une fois (pas verrouillé)
X.push(...D('0', '0', '0'));                          // D16 raté → retour après D20 = D18
e = calculer({ mode: 'expert', sansScoring: true }, X);
egal([DOUBLES[e.i], e.retours], [18, 1], 'expert : D16 raté → retour au D18 (après le dernier verrouillé)');
X.push(...D('D', 'D', '0'));                          // D18 : 1 + 2 = 3 finishs → verrouillé
e = calculer({ mode: 'expert', sansScoring: true }, X);
egal([e.verrouilles.has(18), DOUBLES[e.i]], [true, 16], 'expert : D18 verrouillé au cumul de 3');
X.push(...D('0', '0', '0'));
e = calculer({ mode: 'expert', sansScoring: true }, X);
egal(DOUBLES[e.i], 16, 'expert : D16 raté → on reste au D16 (D18 verrouillé)');
// Sans aucun verrou : retour au D20
const Y = [...D('D', '0', '0', '0', '0', '0')];
egal(DOUBLES[calculer({ mode: 'expert', sansScoring: true }, Y).i], 20, 'expert : sans verrou, retour au D20');

// ---------- Partie complète en normal ----------
const Z = [];
DOUBLES.forEach(() => Z.push(...D('D', '0', '0')));
e = calculer({ mode: 'normal', sansScoring: true }, Z);
egal([e.phase, e.volees, e.flechettes], ['fini', 11, 33], 'normal : 11 doubles en 11 volées');

console.log(`${ok} PASS, ${ko} FAIL`);
process.exit(ko ? 1 : 0);
