// =====================================================================
//  Rappels de la ligue interne (script 050) pour le joueur connecté :
//  matchs restants avant la fin de saison, forfaits / nuls à confirmer.
//  Affichés dans Mon compte (toujours) et sur l'accueil (si urgent).
// =====================================================================

import { supabase, esc } from './app.js?v=__VERSION__';

const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const joursAvant = (d) => { const auj = new Date(); auj.setHours(12, 0, 0, 0); return Math.round((new Date(`${d}T12:00:00`) - auj) / 86400000); };

// urgentSeulement : seulement les propositions à confirmer et les fins de saison à moins de 30 jours
export async function blocRappelsLigue({ urgentSeulement = false } = {}) {
  const { data, error } = await supabase.rpc('mes_rappels_ligue');
  if (error || !data?.length) return '';
  return data.map((l) => {
    const j = l.fin_saison ? joursAvant(l.fin_saison) : null;
    const urgent = l.a_repondre > 0 || (j !== null && j <= 30);
    if (urgentSeulement && !urgent) return '';
    const morceaux = [
      l.a_repondre ? `<strong>${l.a_repondre} proposition${l.a_repondre > 1 ? 's' : ''}</strong> à confirmer (forfait ou nul)` : '',
      l.restants ? `<strong>${l.restants} match${l.restants > 1 ? 's' : ''}</strong> à jouer${l.fin_saison ? (j >= 0 ? ` avant le ${esc(fmt.format(new Date(`${l.fin_saison}T12:00:00`)))} (${j === 0 ? 'aujourd\'hui' : `${j} jour${j > 1 ? 's' : ''}`})` : ' : la saison est terminée, l\'admin tranche') : ''}` : '',
    ].filter(Boolean).join(' · ');
    return `
      <div class="alerte${urgent ? ' alerte--ligue-urgent' : ''}">
        <span>${esc(l.name)}<br><small>${morceaux}</small></span>
        <a class="bouton bouton--plein" href="tournoi.html?id=${encodeURIComponent(l.id)}">Voir la ligue</a>
      </div>`;
  }).join('');
}
