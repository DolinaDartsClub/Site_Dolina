// Tests automatiques du moteur X01 : node outils/test-x01.mjs
import assert from 'node:assert/strict';
import {
  verifierVolee, natureVolee, finissable, aGagner, calculerEtat, nouvelleVolee, moyenne, suggestionFinish,
} from '../assets/js/x01.js';

let ok = 0;
const test = (nom, fn) => { fn(); ok += 1; console.log(`✓ ${nom}`); };

// Joue une liste de volées [score, detail?] et renvoie l'état
function jouer(game, sides, saisies) {
  const visits = [];
  let etat = calculerEtat(game, sides, visits);
  for (const [score, detail] of saisies) {
    const v = nouvelleVolee(etat, score, detail);
    visits.push({ id: visits.length + 1, ...v });
    etat = calculerEtat(game, sides, visits);
  }
  return { etat, visits };
}
const g501 = (extra = {}) => ({ start_score: 501, legs_kind: 'best_of', legs_n: 3, sets_kind: null, sets_n: null, first_side: 1, ...extra });

test('scores impossibles refusés', () => {
  for (const s of [179, 178, 176, 175, 173, 172, 169, 166, 163, 181, -1]) assert.ok(verifierVolee(s, 501));
  for (const s of [0, 26, 60, 100, 140, 171, 174, 177, 180]) assert.equal(verifierVolee(s, 501), null);
});

test('restes sans finish', () => {
  for (const r of [171, 169, 168, 166, 165, 163, 162, 159, 1, 0]) assert.equal(finissable(r), false);
  for (const r of [170, 167, 164, 161, 160, 2, 40, 50]) assert.equal(finissable(r), true);
  assert.ok(verifierVolee(169, 169));
});

test('bust : sous 0, reste 1', () => {
  assert.equal(natureVolee(60, 40), 'bust');
  assert.equal(natureVolee(39, 40), 'bust');
  assert.equal(natureVolee(40, 40), 'finish');
  assert.equal(natureVolee(20, 40), 'normale');
});

test('au meilleur de / premier à', () => {
  assert.equal(aGagner('best_of', 3), 2);
  assert.equal(aGagner('best_of', 5), 3);
  assert.equal(aGagner('first_to', 3), 3);
});

test('une manche en 501, bust compris, et alternance des manches', () => {
  const { etat } = jouer(g501(), [1, 2], [
    [180], [100], [180], [100], [100], [60],          // J1 reste 41, J2 reste 241
    [60], [0],                                         // J1 bust (41-60<0) : reste 41
    [41, { flechettes: 2, auDouble: 1 }],             // J1 finit
  ]);
  assert.equal(etat.manches[1], 1);
  assert.equal(etat.reste[1], 501);
  assert.equal(etat.manche, 2);
  assert.equal(etat.debutManche, 2, 'le joueur 2 commence la manche 2');
  assert.equal(etat.auLancer, 2);
  // fléchettes J1 : 4 volées × 3 + 2 = 14 ; points : 180+180+100+0+41 = 501
  assert.equal(etat.stats[1].flechettes, 14);
  assert.equal(etat.stats[1].points, 501);
  assert.equal(moyenne(etat.stats[1]), Math.round((501 / 14) * 3 * 10) / 10);
});

test('fin de match au meilleur de 3 manches', () => {
  const finir = (s) => [[180], [0], [180], [0], [141, { flechettes: 3, auDouble: 1 }]];
  // J1 gagne la manche 1 (il commence), J2 commence la manche 2 : on fait finir J1 aussi
  const m1 = [[180], [0], [180], [0], [141, { flechettes: 3, auDouble: 1 }]];
  const m2 = [[0], [180], [0], [180], [0], [141, { flechettes: 3, auDouble: 1 }]];
  const { etat } = jouer(g501(), [1, 2], [...m1, ...m2]);
  assert.equal(etat.gagnant, 1);
  assert.equal(etat.auLancer, null);
  void finir;
});

test('sets : alternance entre sets', () => {
  // 1 set = premier à 1 manche, au meilleur de 3 sets
  const game = g501({ legs_kind: 'first_to', legs_n: 1, sets_kind: 'best_of', sets_n: 3 });
  const { etat } = jouer(game, [1, 2], [[180], [0], [180], [0], [141, { flechettes: 3 }]]);
  assert.equal(etat.sets[1], 1);
  assert.equal(etat.set, 2);
  assert.equal(etat.debutManche, 2, 'celui qui a commencé le set 1 commence en second le set 2');
});

test('sets : au set 3, le joueur du set 1 recommence', () => {
  const game = g501({ legs_kind: 'first_to', legs_n: 1, sets_kind: 'best_of', sets_n: 3 });
  const s1 = [[180], [0], [180], [0], [141, { flechettes: 3 }]];          // J1 gagne
  const s2 = [[180], [0], [180], [0], [141, { flechettes: 3 }]];          // J2 commence et gagne
  const { etat } = jouer(game, [1, 2], [...s1, ...s2]);
  assert.equal(etat.set, 3);
  assert.equal(etat.sets[1], 1);
  assert.equal(etat.sets[2], 1);
  assert.equal(etat.debutManche, 1);
});

test('dans un set, les manches alternent à partir du joueur qui a commencé le set', () => {
  const game = g501({ legs_kind: 'best_of', legs_n: 3, sets_kind: 'best_of', sets_n: 3, first_side: 2 });
  const { etat } = jouer(game, [1, 2], [[180], [0], [180], [0], [141, { flechettes: 3 }]]);
  assert.equal(etat.debutManche, 1, 'manche 2 du set 1 : l\'autre joueur commence');
});

test('3 joueurs : rotation de l\'ordre et du départ', () => {
  const game = g501({ legs_kind: 'first_to', legs_n: 2 });
  let { etat } = jouer(game, [1, 2, 3], [[60]]);
  assert.equal(etat.auLancer, 2);
  ({ etat } = jouer(game, [1, 2, 3], [[60], [60], [60]]));
  assert.equal(etat.auLancer, 1);
});

test('numérotation des volées', () => {
  const { visits } = jouer(g501(), [1, 2], [[60], [45], [100]]);
  assert.deepEqual(visits.map((v) => [v.side, v.visit_no, v.remaining_before]), [[1, 1, 501], [2, 1, 501], [1, 2, 441]]);
});

test('score libre', () => {
  const { etat } = jouer(g501({ start_score: 1001 }), [1, 2], [[180]]);
  assert.equal(etat.reste[1], 821);
});

test('suggestions de finish (simples privilégiés)', () => {
  assert.deepEqual(suggestionFinish(170), ['T20', 'T20', 'Bull']);
  assert.deepEqual(suggestionFinish(49), ['9', 'D20']);
  assert.deepEqual(suggestionFinish(40), ['D20']);
  assert.deepEqual(suggestionFinish(100), ['T20', 'D20']);
  assert.equal(suggestionFinish(169), null);
  assert.equal(suggestionFinish(1), null);
});

console.log(`\n${ok} tests réussis.`);
