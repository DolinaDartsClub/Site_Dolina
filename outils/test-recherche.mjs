// Tests de recherche : aucun appel réseau, aucune modification des données.
import assert from 'node:assert/strict';
import { normaliserRecherche, correspondRecherche } from '../assets/js/recherche.js';

const exemples = [
  ['Accent français', 'helene', ['Hélène'], true],
  ['Majuscules', 'DOLINA', ['Dolina Darts Club'], true],
  ['Prénom et nom inversés', 'dupont jean', ['Jean', 'Dupont'], true],
  ['Recherche répartie entre colonnes', 'marie dolina', ['Marie', 'Leroy', 'Dolina 1'], true],
  ['Tiret du prénom', 'jean paul', ['Jean-Paul'], true],
  ['Apostrophe typographique', 'd angelo', ['D’Angelo'], true],
  ['Apostrophe droite', "d'angelo", ['D’Angelo'], true],
  ['Doublette', 'lea lucas', ['Léa & Lucas'], true],
  ['Email admin', 'alice@example.com', ['Alice', 'alice@example.com'], true],
  ['Absence de correspondance', 'marie', ['Manon', 'Dolina'], false],
  ['Tous les mots requis', 'jean paris', ['Jean', 'Dolina'], false],
  ['Recherche vide', '', [null], true],
  ['Recherche espaces', '   ', ['N’importe quoi'], true],
  ['Champ manquant', 'dupont', [undefined, 'Dupont'], true],
  ['Recherche non trouvée', 'dupont', [undefined, null], false],
];

let pass = 0;
for (const [nom, recherche, champs, attendu] of exemples) {
  assert.equal(correspondRecherche(recherche, ...champs), attendu, nom);
  pass++;
}
assert.equal(normaliserRecherche('  ÉLoDiE  '), 'elodie');
assert.equal(normaliserRecherche(null), '');
pass += 2;

const liste = [{ nom: 'Élodie', rang: 3 }, { nom: 'Jean-Paul', rang: 1 }];
const originaux = liste.map((x) => ({ ...x }));
const resultat = liste.filter((x) => correspondRecherche('elodie', x.nom));
assert.equal(resultat.length, 1);
assert.equal(resultat[0].rang, 3);
assert.deepEqual(liste, originaux, 'Le filtre ne modifie pas les rangs ou données source');
pass += 3;

console.log(`${pass} tests de recherche réussis.`);
