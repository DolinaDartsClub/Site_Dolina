// =====================================================================
//  Moteur X01 : toutes les règles du scorer (cahier des charges § 6.7)
//  Aucune dépendance : ce fichier est testé automatiquement (outils/test-x01.mjs).
//
//  Règles appliquées :
//  - volée de 0 à 180 ; refus de 179, 178, 176, 175, 173, 172, 169, 166, 163
//  - bust si le reste passe sous 0 ou tombe à 1 : la volée vaut 0, le reste ne bouge pas
//  - finish : reste exactement 0 (sur un double) ; impossible au-dessus de 170
//    et sur 169, 168, 166, 165, 163, 162, 159
//  - « au meilleur de N » ou « premier à N », pour les manches comme pour les sets
//  - alternance : dans un set, les manches alternent à partir de celui qui a
//    commencé le set ; celui qui a commencé le set 1 commence en second le set 2…
//  - moyenne : points ÷ fléchettes × 3 ; une volée en bust compte 3 fléchettes à 0
// =====================================================================

export const IMPOSSIBLES = [179, 178, 176, 175, 173, 172, 169, 166, 163];
export const SANS_FINISH = [169, 168, 166, 165, 163, 162, 159];

// Nombre de manches (ou de sets) à gagner
export function aGagner(kind, n) {
  return kind === 'first_to' ? n : Math.floor(n / 2) + 1;
}

// Un reste peut-il se finir en une volée ?
export function finissable(reste) {
  return reste >= 2 && reste <= 170 && !SANS_FINISH.includes(reste);
}

// Vérifie une volée saisie ; renvoie un message d'erreur ou null
export function verifierVolee(score, reste) {
  if (!Number.isInteger(score) || score < 0 || score > 180) return 'Une volée vaut entre 0 et 180.';
  if (IMPOSSIBLES.includes(score)) return `${score} est impossible avec 3 fléchettes.`;
  if (score === reste && !finissable(reste)) return `${reste} ne se finit pas en une volée.`;
  return null;
}

// Nature d'une volée : 'bust', 'finish' ou 'normale'
export function natureVolee(score, reste) {
  const apres = reste - score;
  if (apres === 0 && finissable(reste)) return 'finish';
  if (apres < 0 || apres === 1 || apres === 0) return 'bust';
  return 'normale';
}

// ---------------------------------------------------------------------
// État complet d'une partie à partir de ses volées
//   game  : { start_score, legs_kind, legs_n, sets_kind, sets_n, first_side, status, winner_side }
//   sides : numéros des camps dans l'ordre de jeu, ex. [1, 2]
//   visits: volées enregistrées, dans l'ordre de saisie (trier par id avant l'appel)
// ---------------------------------------------------------------------
export function calculerEtat(game, sides, visits) {
  const camps = [...sides].sort((a, b) => a - b);
  const n = camps.length;
  const mancheAGagner = aGagner(game.legs_kind, game.legs_n);
  const setAGagner = game.sets_n ? aGagner(game.sets_kind, game.sets_n) : 1;
  const premier = camps.includes(game.first_side) ? game.first_side : camps[0];
  const idxPremier = camps.indexOf(premier);

  const zero = () => Object.fromEntries(camps.map((c) => [c, 0]));
  const etat = {
    camps,
    set: 1,
    manche: 1,                 // numéro de manche dans le set
    reste: Object.fromEntries(camps.map((c) => [c, game.start_score])),
    manches: zero(),           // manches gagnées dans le set en cours
    sets: zero(),              // sets gagnés
    voleesManche: zero(),      // volées de chaque camp dans la manche en cours
    voleesTotal: zero(),       // volées de chaque camp depuis le début (alternance en double)
    stats: Object.fromEntries(camps.map((c) => [c, { points: 0, flechettes: 0, auDouble: 0, finishs: 0, derniere: null, meilleurFinish: 0, cent: 0, cent40: 0, cent80: 0 }])),
    gagnant: null,
    debutManche: premier,
    auLancer: premier,
    historique: [],            // volées de la manche en cours
    totalManche: 0,
  };

  // Camp qui commence le set s, manche m (1, 2, 3…) : rotation
  const debut = (s, m) => camps[(idxPremier + (s - 1) + (m - 1)) % n];

  // Les volées sont fournies dans l'ordre de saisie
  for (const v of visits) {
    if (etat.gagnant) break;
    const st = etat.stats[v.side];
    if (!st) continue;
    st.flechettes += v.is_checkout ? v.darts_used : 3;
    st.points += v.is_bust ? 0 : v.score;
    st.auDouble += v.darts_at_double || 0;
    st.derniere = v.is_bust ? 'Bust' : v.score;
    if (!v.is_bust) {
      if (v.score === 180) st.cent80 += 1;
      else if (v.score >= 140) st.cent40 += 1;
      else if (v.score >= 100) st.cent += 1;
    }
    etat.voleesManche[v.side] += 1;
    etat.voleesTotal[v.side] += 1;
    etat.historique.push(v);
    etat.totalManche += 1;
    if (!v.is_bust) etat.reste[v.side] = v.remaining_before - v.score;

    if (v.is_checkout) {
      st.finishs += 1;
      st.meilleurFinish = Math.max(st.meilleurFinish, v.remaining_before);
      etat.manches[v.side] += 1;
      if (etat.manches[v.side] >= mancheAGagner) {
        etat.sets[v.side] += 1;
        if (etat.sets[v.side] >= setAGagner) {
          etat.gagnant = v.side;
        } else {
          etat.set += 1;
          etat.manche = 1;
          etat.manches = zero();
        }
      } else {
        etat.manche += 1;
      }
      // Nouvelle manche
      etat.reste = Object.fromEntries(camps.map((c) => [c, game.start_score]));
      etat.voleesManche = zero();
      etat.historique = [];
      etat.totalManche = 0;
    }
  }

  etat.debutManche = debut(etat.set, etat.manche);
  etat.auLancer = etat.gagnant ? null : camps[(camps.indexOf(etat.debutManche) + etat.totalManche) % n];
  if (game.status === 'finished' && game.winner_side) etat.gagnant = game.winner_side;
  return etat;
}

// Données à enregistrer pour une nouvelle volée du camp au lancer
//   detail : { flechettes: 1|2|3 (finish), auDouble: 0..3 }
export function nouvelleVolee(etat, score, detail = {}) {
  const side = etat.auLancer;
  const reste = etat.reste[side];
  const nature = natureVolee(score, reste);
  return {
    set_no: etat.set,
    leg_no: etat.manche,
    visit_no: etat.voleesManche[side] + 1,
    side,
    score,                       // score saisi (compte 0 point si bust)
    remaining_before: reste,
    is_bust: nature === 'bust',
    is_checkout: nature === 'finish',
    darts_used: nature === 'finish' ? (detail.flechettes || 3) : 3,
    darts_at_double: detail.auDouble || 0,
  };
}

// Moyenne sur 3 fléchettes, arrondie à 0,1
export function moyenne(st) {
  return st.flechettes ? Math.round((st.points / st.flechettes) * 3 * 10) / 10 : null;
}

// ---------------------------------------------------------------------
// Suggestion de finish : chemin le plus court, puis fin sur D20, D16 ou D8 ;
// un simple est toujours préféré à un triple de même valeur (49 : 9 · D20)
// ---------------------------------------------------------------------
const FLECHES = (() => {
  const liste = [];
  for (let v = 60; v >= 1; v--) {
    let l = null;
    if (v <= 20) l = String(v);
    else if (v === 25) l = '25';
    else if (v === 50) l = 'Bull';
    else if (v % 3 === 0 && v / 3 <= 20) l = `T${v / 3}`;
    else if (v % 2 === 0 && v / 2 <= 20) l = `D${v / 2}`;
    if (l) liste.push({ l, v });
  }
  return liste;
})();
const DOUBLES = (() => {
  const pref = [20, 16, 8, 18, 12, 10, 4, 2, 14, 6];
  const liste = pref.map((d) => ({ l: `D${d}`, v: d * 2 }));
  for (let d = 20; d >= 1; d--) if (!pref.includes(d)) liste.push({ l: `D${d}`, v: d * 2 });
  liste.push({ l: 'Bull', v: 50 });
  return liste;
})();

export function suggestionFinish(reste) {
  if (!finissable(reste)) return null;
  for (const d of DOUBLES) if (d.v === reste) return [d.l];
  for (const d of DOUBLES) for (const a of FLECHES) if (a.v + d.v === reste) return [a.l, d.l];
  for (const a of FLECHES) for (const d of DOUBLES) for (const b of FLECHES) if (a.v + b.v + d.v === reste) return [a.l, b.l, d.l];
  return null;
}
