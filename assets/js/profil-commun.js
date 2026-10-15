// =====================================================================
//  Briques communes à « Mon compte » et à la page profil d'un membre :
//  saison en cours et résumé des statistiques de la saison.
// =====================================================================

const virgule = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(d).replace('.', ','));

// La saison commence le 1er septembre
export function debutSaison(d = new Date()) {
  const annee = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(annee, 8, 1);
}

export function nomSaison(d = debutSaison()) {
  return `Saison ${d.getFullYear()}-${d.getFullYear() + 1}`;
}

// Tuiles du résumé (s = résultat de stats_joueur)
export function resumeSaison(s) {
  if (!s) return '<p class="vide">Statistiques indisponibles pour le moment.</p>';
  if (!s.parties) return '<p class="vide">Aucune partie comptée cette saison.</p>';
  const moy = s.flechettes ? (s.points / s.flechettes) * 3 : null;
  const dbl = s.flechettes_double ? (s.finishs / s.flechettes_double) * 100 : null;
  const tuile = (t, v, d = '', principale = false) => `<div class="s-tuile${principale ? ' s-tuile--principale' : ''}"><span class="s-tuile__titre">${t}</span><span class="s-tuile__valeur">${v}</span>${d ? `<span class="s-tuile__detail">${d}</span>` : ''}</div>`;
  return `<div class="s-grille pr-grille">
      ${tuile('Moyenne', virgule(moy), `${s.parties} partie${s.parties > 1 ? 's' : ''}`, true)}
      ${tuile('Victoires – défaites', `<span class="s-gagne">${s.victoires}</span> – <span class="s-perdu">${s.defaites}</span>`)}
      ${tuile('Réussite au double', dbl === null ? '–' : `${virgule(dbl)} %`)}
      ${tuile('180', s.nb_180)}
      ${tuile('Meilleur finish', s.meilleur_finish ?? '–')}
    </div>`;
}
