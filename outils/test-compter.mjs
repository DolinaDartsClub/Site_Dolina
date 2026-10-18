// Vérifie les calculs et explications du jeu « Compter une manche »
import { corriger, expliquerReste, valeurFleche, cheminConseille } from '../assets/js/compter-calcul.js';
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
c = corriger(['T20', 'T20', '1'], 242); egal(c.reste, 121, 'reste 121'); console.log(c.conseil, '|', c.pourquoi);
const ch = (r) => cheminConseille(r)?.chemin.join(' ');
egal(ch(40), 'D20', '40 → D20'); egal(ch(32), 'D16', '32 → D16'); egal(ch(36), 'D18', '36 → D18'); egal(ch(24), 'D12', '24 → D12');
egal(ch(38), '6 D16', '38 → 6 puis D16 (pas D19)'); egal(ch(50), '10 D20', '50 → 10 D20 plutôt que Bull'); egal(ch(170), 'T20 T20 Bull', '170');
egal(ch(81), 'T19 D12', '81 en deux fléchettes'); egal(ch(110), 'T20 10 D20', '110 sur D20 plutôt que bull'); egal(ch(7), '1 D3', '7'); egal(ch(100), 'T20 D20', '100'); egal(cheminConseille(169), null, '169 impossible');
// Le double final est toujours conseillé quand c'est possible
const bons = new Set(['D20', 'D16', 'D10', 'D8', 'D12', 'D18', 'D6', 'D4']);
let hors = []; for (let r = 2; r <= 170; r++) { const x = cheminConseille(r); if (x && !bons.has(x.chemin.at(-1))) hors.push(`${r}:${x.chemin.join(' ')}`); }
console.log('restes finis hors doubles conseillés :', hors.join(', '));
console.log(`${ok} PASS, ${ko} FAIL`);
process.exit(ko ? 1 : 0);
