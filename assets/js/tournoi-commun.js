// =====================================================================
//  Tournois : éléments communs aux pages Tournois, Créer et Tournoi
// =====================================================================

import { supabase, esc, nomAffiche } from './app.js?v=__VERSION__';

export const STATUTS = {
  draft: { libelle: 'En préparation', classe: 'prep', aide: 'Inscriptions fermées' },
  open: { libelle: 'Inscriptions ouvertes', classe: 'ouvert', aide: 'Les membres peuvent rejoindre avec le code' },
  running: { libelle: 'En cours', classe: 'cours', aide: 'Les matchs se jouent' },
  finished: { libelle: 'Terminé', classe: 'fini', aide: 'Le tournoi est terminé' },
};

export const FORMATS = {
  knockout: 'Élimination directe',
  pools: 'Poules puis élimination directe',
};

export const MODES = { single: 'Individuel', double: 'Double (2v2)' };

export function badgeStatut(status) {
  const s = STATUTS[status] || STATUTS.draft;
  return `<span class="t-statut t-statut--${s.classe}">${esc(s.libelle)}</span>`;
}

// Résumé du format, ex. « Individuel · Poules puis élimination directe · 2 qualifiés par poule »
export function resumeFormat(t) {
  const morceaux = [MODES[t.team_mode] || '', FORMATS[t.format] || ''];
  if (t.format === 'pools' && t.pool_qualifiers) {
    morceaux.push(`${t.pool_qualifiers} qualifié${t.pool_qualifiers > 1 ? 's' : ''} par poule`);
  }
  return morceaux.filter(Boolean).join(' · ');
}

// Colonnes à lire pour un inscrit (avec les profils du joueur et de son partenaire)
export const COLONNES_INSCRIT = 'id, tournament_id, profile_id, guest_name, partner_profile_id, partner_guest_name, team_name, created_at, '
  + 'joueur:profiles!tournament_entries_profile_id_fkey(id, first_name, last_name, nickname, use_nickname), '
  + 'partenaire:profiles!tournament_entries_partner_profile_id_fkey(id, first_name, last_name, nickname, use_nickname)';

function nomPersonne(profil, invite, idPresent) {
  if (profil) return nomAffiche(profil);
  if (invite) return invite;
  return idPresent ? 'Membre' : 'Ancien joueur';
}

// Nom affiché d'un inscrit, et la composition de la doublette
export function nomInscrit(e) {
  const j1 = nomPersonne(e.joueur, e.guest_name, e.profile_id);
  if (e.team_name) {
    const j2 = nomPersonne(e.partenaire, e.partner_guest_name, e.partner_profile_id);
    return { nom: e.team_name, detail: `${j1} & ${j2}` };
  }
  return { nom: j1, detail: e.profile_id ? '' : (e.guest_name ? 'Invité' : '') };
}

// L'utilisateur fait-il partie de cet inscrit ? (par identifiant, jamais par le nom)
export function estMoi(e, moiId) {
  return !!moiId && (e.profile_id === moiId || e.partner_profile_id === moiId);
}

// Normalise un code saisi : majuscules, sans espaces ni tirets
export function normaliserCode(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

// ---------------------------------------------------------------------
// Fenêtre de choix d'un membre (recherche par nom, prénom ou surnom)
//   choisirMembre({ titre, exclure: Set d'identifiants }) → membre ou null
// ---------------------------------------------------------------------
let membresCache = null;

async function chargerMembres() {
  if (membresCache) return membresCache;
  const { data } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, nickname, use_nickname')
    .eq('status', 'active')
    .order('last_name');
  membresCache = data || [];
  return membresCache;
}

export function choisirMembre({ titre = 'Choisir un membre', exclure = new Set() } = {}) {
  return new Promise((resolve) => {
    const f = document.createElement('div');
    f.className = 'fenetre';
    f.setAttribute('role', 'dialog');
    f.setAttribute('aria-modal', 'true');
    f.innerHTML = `
      <div class="fenetre__boite fenetre__boite--pleine">
        <div class="fenetre__entete">
          <h2>${esc(titre)}</h2>
          <button type="button" class="bouton bouton--icone" data-fermer aria-label="Fermer">✕</button>
        </div>
        <label class="champ"><span class="visuellement-cache">Rechercher un membre</span>
          <input type="search" placeholder="Nom, prénom ou surnom" autocomplete="off">
        </label>
        <div class="liste-membres"><p class="vide">Chargement…</p></div>
      </div>`;
    document.body.appendChild(f);
    const champ = f.querySelector('input');
    const zone = f.querySelector('.liste-membres');
    let membres = [];

    const fin = (m) => {
      document.removeEventListener('keydown', echap);
      f.remove();
      resolve(m);
    };
    const echap = (e) => { if (e.key === 'Escape') fin(null); };
    document.addEventListener('keydown', echap);

    const afficher = () => {
      const q = champ.value.trim().toLowerCase();
      const liste = membres.filter((m) => !exclure.has(m.id)
        && (!q || [m.first_name, m.last_name, m.nickname].some((v) => (v || '').toLowerCase().includes(q))));
      zone.innerHTML = liste.length
        ? liste.map((m) => `
          <button type="button" class="ligne-membre" data-membre="${m.id}">
            <span class="ligne-membre__initiale" aria-hidden="true">${esc((m.first_name || '?').charAt(0))}</span>
            <span class="ligne-membre__texte"><strong>${esc(nomAffiche(m))}</strong><small>${esc(m.use_nickname ? `${m.first_name} ${m.last_name}` : (m.nickname || ''))}</small></span>
            <span class="ligne-membre__plus" aria-hidden="true">+</span>
          </button>`).join('')
        : '<p class="vide">Aucun membre ne correspond. Un joueur sans compte s\'ajoute comme invité.</p>';
    };

    f.addEventListener('click', (e) => {
      if (e.target === f || e.target.closest('[data-fermer]')) return fin(null);
      const b = e.target.closest('[data-membre]');
      if (b) fin(membres.find((m) => m.id === b.dataset.membre) || null);
    });
    champ.addEventListener('input', afficher);
    champ.focus();
    chargerMembres().then((liste) => { membres = liste; afficher(); });
  });
}
