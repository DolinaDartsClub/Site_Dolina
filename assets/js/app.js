// =====================================================================
//  Outils communs à toutes les pages
// =====================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Échappe un texte avant de l'insérer dans la page (évite toute injection HTML)
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
export function dateFr(iso) {
  return iso ? fmtDate.format(new Date(iso)) : '';
}

// Libellé du format d'une partie, ex. « 501 · au meilleur de 3 manches »
export function formatPartie(g) {
  const jeu = g.variant === 'libre' ? `Score libre ${g.start_score}` : g.variant;
  const kind = (k) => (k === 'first_to' ? 'premier à' : 'au meilleur de');
  const legs = `${kind(g.legs_kind)} ${g.legs_n} manche${g.legs_n > 1 ? 's' : ''}`;
  const sets = g.sets_n ? `${kind(g.sets_kind)} ${g.sets_n} sets, ` : '';
  const mode = g.mode === 'double' ? ' · double 2v2' : '';
  return `${jeu}${mode} · ${sets}${legs}`;
}

// Calcule l'état d'une partie X01 à partir de ses volées
// (reste de chaque camp, manches et sets gagnés, camp au lancer)
export function etatPartie(game, sides, visits) {
  const ordre = [...visits].sort((a, b) =>
    a.set_no - b.set_no || a.leg_no - b.leg_no || a.visit_no - b.visit_no || a.id - b.id);
  const camps = sides.map((s) => s.side);
  const etat = {
    reste: Object.fromEntries(camps.map((c) => [c, game.start_score])),
    manches: Object.fromEntries(camps.map((c) => [c, 0])),
    sets: Object.fromEntries(camps.map((c) => [c, 0])),
    setCourant: 1,
    mancheCourante: 1,
    dernier: null,
  };
  let set = 1;
  let leg = 1;
  for (const v of ordre) {
    if (v.set_no !== set) {
      // Nouveau set : le camp qui a le plus de manches remporte le set précédent
      const gagnant = camps.reduce((a, b) => (etat.manches[b] > etat.manches[a] ? b : a), camps[0]);
      etat.sets[gagnant] += 1;
      for (const c of camps) etat.manches[c] = 0;
    }
    if (v.set_no !== set || v.leg_no !== leg) {
      set = v.set_no;
      leg = v.leg_no;
      for (const c of camps) etat.reste[c] = game.start_score;
    }
    if (!v.is_bust) etat.reste[v.side] = v.remaining_before - v.score;
    if (v.is_checkout) {
      etat.manches[v.side] += 1;
      for (const c of camps) etat.reste[c] = game.start_score;
    }
    etat.dernier = v;
  }
  etat.setCourant = set;
  etat.mancheCourante = leg;
  return etat;
}

// Enregistre le service worker (installation du site comme une appli)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
