// Vérifie le dartbot : volées valides, moyenne proche du réglage, doubles respectés.
// Lancer : node outils/test-dartbot.mjs
import { voleeBot, lireReglageBot, nomCampBot } from '../assets/js/dartbot.js';
import { verifierVolee, natureVolee } from '../assets/js/x01.js';

let ok = 0; let ko = 0;
const verifier = (cond, txt) => { if (cond) ok++; else { ko++; console.log('ÉCHEC', txt); } };

// Générateur pseudo-aléatoire reproductible
function graine(s) { return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

function manches(reglage, n, rng) {
  let points = 0; let flech = 0; let auD = 0; let fin = 0; let invalides = 0; let manchesFinies = 0;
  const scores = new Set();
  for (let k = 0; k < n; k++) {
    let reste = 501;
    for (let t = 0; t < 200 && reste > 0; t++) {
      const v = voleeBot(reste, reglage, rng, { finishs: fin, auDouble: auD });
      if (verifierVolee(v.score, reste) || natureVolee(v.score, reste) !== v.nature) invalides++;
      if (v.nature !== 'bust') points += v.score;
      flech += v.nature === 'finish' ? v.flechettes : 3;
      auD += v.auDouble;
      scores.add(v.score);
      if (v.nature === 'finish') { fin++; reste = 0; manchesFinies++; } else if (v.nature === 'normale') reste -= v.score;
    }
  }
  return { moy: (points / flech) * 3, pctD: (fin / auD) * 100, invalides, manchesFinies, varies: scores.size };
}

const rng = graine(42);
for (const [moyenne, doubles] of [[30, 15], [40, 25], [50, 30], [60, 35], [75, 40], [90, 50], [105, 60]]) {
  const r = manches({ moyenne, doubles }, 1500, rng);
  console.log(`réglage ${moyenne} / ${doubles} % → moyenne ${r.moy.toFixed(1)}, doubles ${r.pctD.toFixed(1)} %, ${r.varies} scores différents`);
  verifier(r.invalides === 0, `${moyenne} : ${r.invalides} volées invalides`);
  verifier(r.manchesFinies === 1500, `${moyenne} : manches non finies`);
  verifier(Math.abs(r.moy - moyenne) <= Math.max(3, moyenne * 0.08), `${moyenne} : moyenne ${r.moy.toFixed(1)} trop loin`);
  verifier(Math.abs(r.pctD - doubles) <= 8, `${moyenne} : doubles ${r.pctD.toFixed(1)} % trop loin de ${doubles}`);
  verifier(r.varies > 15, `${moyenne} : scores pas assez variés`);
}
// Match court (3 manches) : la réussite au double reste proche du réglage
for (const doubles of [18, 40]) {
  let loin = 0;
  for (let m = 0; m < 3000; m++) { const r = manches({ moyenne: 55, doubles }, 3, rng); if (Math.abs(r.pctD - doubles) > 20) loin++; }
  console.log(`match en 3 manches, doubles ${doubles} % : ${(loin / 30).toFixed(1)} % des matchs à plus de 20 points du réglage`);
  verifier(loin / 3000 < 0.01, `doubles ${doubles} % : trop de matchs loin du réglage`);
}
verifier(JSON.stringify(lireReglageBot(nomCampBot({ moyenne: 62, doubles: 33 }))) === '{"moyenne":62,"doubles":33}', 'relecture du réglage');
verifier(nomCampBot({ moyenne: 110, doubles: 80 }).length <= 40, 'nom du camp ≤ 40 caractères');
console.log(`${ok} PASS, ${ko} FAIL`);
process.exit(ko ? 1 : 0);
