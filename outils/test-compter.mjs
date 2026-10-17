// Vérifie les calculs et explications du jeu « Compter une manche »
import { corriger, expliquerReste, valeurFleche } from '../assets/js/compter-calcul.js';
let ok = 0; let ko = 0;
const egal = (a, b, t) => { if (JSON.stringify(a) === JSON.stringify(b)) ok++; else { ko++; console.log('ÉCHEC', t, '→', a, 'attendu', b); } };
egal(['T20', '19', 'D5', 'Bull', '25', '0'].map(valeurFleche), [60, 19, 10, 50, 25, 0], 'valeurs');
let c = corriger(['T20', '19', 'D5'], 301);
egal([c.total, c.reste, c.bust], [89, 212, false], 'volée simple');
console.log(c.lignes.join('\n'));
egal(expliquerReste(301, 89), '301 − 89 : 301 − 90 = 211, puis on rajoute 1 → 212', 'reste arrondi');
egal(expliquerReste(501, 140), '501 − 140 : 501 − 100 = 401, puis − 40 = 361', 'reste centaine');
egal(expliquerReste(261, 43), '261 − 43 : 261 − 40 = 221, puis − 3 → 218', 'reste unités');
c = corriger(['T20', 'T20', '20'], 121); egal([c.total, c.reste, c.bust], [140, 121, true], 'bust dépassement');
c = corriger(['20', 'D10'], 40); egal([c.finish, c.reste], [true, 0], 'finish D10');
c = corriger(['20', '20'], 40); egal([c.bust, c.reste], [true, 40], 'zéro sans double = bust');
c = corriger(['T20', 'T20', '1'], 242); egal([c.reste, c.conseil], [121, 'Il reste 121 : finish possible en 3 fléchettes — T20 · T7 · D20'], 'conseil finish');
console.log(`${ok} PASS, ${ko} FAIL`);
process.exit(ko ? 1 : 0);
