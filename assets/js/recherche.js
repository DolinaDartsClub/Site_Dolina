// Recherche côté navigateur uniquement : ne modifie ni les données ni leur ordre.
// Les accents, apostrophes et tirets ne doivent pas empêcher de retrouver un nom.
export function normaliserRecherche(valeur) {
  return String(valeur ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr-FR')
    .replace(/['’\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tous les mots saisis doivent être présents, même dans des champs différents.
// Ex. « marie dolina » retrouve une joueuse Marie appartenant à l'équipe Dolina.
export function correspondRecherche(recherche, ...champs) {
  const termes = normaliserRecherche(recherche).split(' ').filter(Boolean);
  if (!termes.length) return true;
  const texte = normaliserRecherche(champs.filter((v) => v != null).join(' '));
  return termes.every((mot) => texte.includes(mot));
}
