// =====================================================================
//  Répertoire des joueurs (script 074) : membres + invités déjà venus
//  Partout où l'on ajoute un joueur (Jouer, tournoi, feuille de match),
//  une recherche propose les membres et les invités enregistrés.
// =====================================================================

import { supabase, esc } from './app.js?v=__VERSION__';

let invites = null;   // [{ id, nom, team_id, nb_utilisations, equipe }]

// Comparaison sans casse ni accents
export const cle = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function chargerInvites(force = false) {
  if (invites && !force) return invites;
  const { data, error } = await supabase.from('joueurs_invites')
    .select('id, nom, team_id, nb_utilisations, utilise_le, teams(name)')
    .order('nb_utilisations', { ascending: false }).limit(2000);
  invites = error ? [] : (data || []).map((x) => ({ ...x, equipe: x.teams?.name || '' }));   // erreur = script 074 absent
  return invites;
}

// Invités dont le nom contient la recherche ; ceux de l'équipe d'abord
export function chercherInvites(q, { equipe = null, exclure = [] } = {}) {
  const k = cle(q);
  if (!k || !invites) return [];
  const deja = new Set(exclure.map(cle));
  return invites
    .filter((x) => cle(x.nom).includes(k) && !deja.has(cle(x.nom)))
    .sort((a, b) => (Number(b.team_id === equipe) - Number(a.team_id === equipe))
      || (Number(cle(b.nom).startsWith(k)) - Number(cle(a.nom).startsWith(k)))
      || (b.nb_utilisations - a.nb_utilisations))
    .slice(0, 8);
}

// Liste déroulante sous un champ texte.
// options.membres() : membres proposés aussi (tableau [{ id, nom, detail }]), facultatif
// options.surChoix(item) : item = { type: 'invite' | 'membre', id, nom }
export function brancherSuggestions(input, { equipe = null, membres = null, exclure = () => [], surChoix } = {}) {
  if (!input || input.dataset.suggestions) return;
  input.dataset.suggestions = '1';
  input.setAttribute('autocomplete', 'off');
  const boite = document.createElement('div');
  boite.className = 'rj-liste';
  boite.hidden = true;
  input.insertAdjacentElement('afterend', boite);
  let items = [];

  const afficher = async () => {
    await chargerInvites();
    const q = input.value;
    const k = cle(q);
    if (k.length < 2) { boite.hidden = true; return; }
    const m = (membres ? membres() : []).filter((x) => cle(x.nom).includes(k)).slice(0, 5).map((x) => ({ ...x, type: 'membre' }));
    const i = chercherInvites(q, { equipe, exclure: [...exclure(), ...m.map((x) => x.nom)] }).map((x) => ({
      type: 'invite', id: x.id, nom: x.nom, detail: `Invité${x.equipe ? ` · ${x.equipe}` : ''} · ${x.nb_utilisations} fois`,
    }));
    items = [...m, ...i].filter((x) => cle(x.nom) !== k || x.type === 'membre');
    if (!items.length) { boite.hidden = true; return; }
    boite.innerHTML = items.map((x, n) => `
      <button type="button" class="rj-item" data-n="${n}">
        <strong>${esc(x.nom)}</strong><small>${esc(x.type === 'membre' ? (x.detail || 'Membre du club') : x.detail)}</small>
      </button>`).join('');
    boite.hidden = false;
  };
  input.addEventListener('input', afficher);
  input.addEventListener('focus', afficher);
  input.addEventListener('blur', () => setTimeout(() => { boite.hidden = true; }, 200));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') boite.hidden = true; });
  // pointerdown : avant la perte du focus
  boite.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    e.preventDefault();
    const it = items[Number(b.dataset.n)];
    boite.hidden = true;
    if (surChoix) surChoix(it);
    else input.value = it.nom;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    boite.hidden = true;
  });
}
