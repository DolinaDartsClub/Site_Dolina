// =====================================================================
//  Échauffement du club — règles (module pur, testé par outils/test-echauffement.mjs)
//
//  1. Scoring : 10 points sur le 20 (simple = 1, double = 2, triple = 3),
//     puis 10 points sur le 19, puis sur le 18, puis sur le 16,
//     puis 5 points à la bulle (25 = 1, 50 = 2). Il faut tout compléter.
//  2. Doubles (entraînement de Danny Noppert) : doubles pairs de 20 à 2,
//     puis le double 1, avec 3 fléchettes par volée. On finit « comme au
//     501 » : en visant D20, un simple 20 laisse 20, on vise alors D10.
//     Après un finish, la fléchette suivante revise le double en cours.
//     - Normal : un double réussi (au moins un finish dans la volée) est
//       fermé, on n'y revient plus ; une volée ratée : on recommence ce double.
//     - Expert : un double réussi 3 fois (en tout) est verrouillé. Une volée
//       sans finish renvoie au D20, ou au double qui suit le dernier verrouillé.
//  La partie est rejouée à partir de la liste des fléchettes (annuler = retirer la dernière).
// =====================================================================

export const ETAPES_SCORING = [
  { cible: '20', but: 10 },
  { cible: '19', but: 10 },
  { cible: '18', but: 10 },
  { cible: '16', but: 10 },
  { cible: 'B', but: 5 },
];
export const DOUBLES = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 1];
export const FINISHS_VERROU = 3;

const VALEUR = { S: 1, D: 2, T: 3, 25: 1, 50: 2, 0: 0 };

export function calculer(config, actions) {
  const expert = config.mode === 'expert';
  const e = {
    phase: config.sansScoring ? 'doubles' : 'scoring',
    etape: 0, points: 0, choix: null,
    flechettesScoring: 0,
    // Doubles
    i: 0, reste: 2 * DOUBLES[0], volee: [], finishsVolee: 0,
    finishs: Object.fromEntries(DOUBLES.map((d) => [d, 0])),
    fermes: new Set(), verrouilles: new Set(),
    flechettesDoubles: 0, volees: 0, voleesRatees: 0, retours: 0,
    journal: [],
  };

  const doubleCourant = () => DOUBLES[e.i];
  const prochainLibre = (depuis) => {
    let k = depuis;
    while (k < DOUBLES.length && (expert ? e.verrouilles.has(DOUBLES[k]) : e.fermes.has(DOUBLES[k]))) k += 1;
    return k;
  };
  const allerA = (k) => {
    e.i = prochainLibre(k);
    if (e.i >= DOUBLES.length) { e.phase = 'fini'; return; }
    e.reste = 2 * doubleCourant();
  };

  for (const a of actions) {
    if (e.phase === 'fini') break;

    if (e.phase === 'scoring') {
      const et = ETAPES_SCORING[e.etape];
      if (a.choix) { if (et.choix?.includes(String(a.choix))) e.choix = String(a.choix); continue; }
      if (et.choix && !e.choix) continue;   // il faut d'abord choisir 18 ou 16
      const v = VALEUR[a.f] ?? 0;
      e.flechettesScoring += 1;
      e.points += v;
      e.journal.push({ phase: 'scoring', etape: e.etape, f: a.f, v });
      if (e.points >= et.but) {
        e.etape += 1;
        e.points = 0;
        if (e.etape >= ETAPES_SCORING.length) { e.phase = 'doubles'; allerA(0); }
      }
      continue;
    }

    // ---------- Doubles ----------
    const d = doubleCourant();
    const vise = e.reste / 2;
    if (a.f === 'D') {
      e.finishsVolee += 1;
      e.finishs[d] += 1;
      e.reste = 2 * d;                       // la fléchette suivante revise le double en cours
    } else if (a.f === 'S' && vise % 2 === 0) {
      e.reste -= vise;                       // ex. D20 visé, simple 20 → reste 20 → D10
    }
    e.volee.push({ f: a.f, vise });
    e.flechettesDoubles += 1;
    if (e.volee.length < 3) continue;

    // Fin de la volée
    e.volees += 1;
    const reussi = e.finishsVolee > 0;
    e.journal.push({ phase: 'doubles', double: d, finishs: e.finishsVolee, volee: e.volee });
    e.volee = [];
    e.finishsVolee = 0;
    if (reussi) {
      if (expert) { if (e.finishs[d] >= FINISHS_VERROU) e.verrouilles.add(d); }
      else e.fermes.add(d);
      allerA(e.i + 1);
    } else {
      e.voleesRatees += 1;
      if (expert) {
        // Retour au D20, ou au double qui suit le dernier double verrouillé
        let dernier = -1;
        DOUBLES.forEach((x, k) => { if (e.verrouilles.has(x) && k < e.i) dernier = k; });
        if (dernier + 1 < e.i) e.retours += 1;
        allerA(dernier + 1);
      } else {
        e.reste = 2 * d;                     // normal : on recommence ce double
      }
    }
  }

  e.flechettes = e.flechettesScoring + e.flechettesDoubles;
  e.totalFinishs = Object.values(e.finishs).reduce((x, y) => x + y, 0);
  return e;
}

// Ce que vise le joueur maintenant (pour l'affichage)
export function cibleActuelle(e) {
  if (e.phase === 'scoring') {
    const et = ETAPES_SCORING[e.etape];
    return { type: 'scoring', cible: et.cible === '18/16' ? e.choix : et.cible, but: et.but, points: e.points, aChoisir: !!et.choix && !e.choix, choix: et.choix };
  }
  if (e.phase === 'doubles') return { type: 'double', double: DOUBLES[e.i], vise: e.reste / 2, flechette: e.volee.length + 1 };
  return { type: 'fini' };
}
