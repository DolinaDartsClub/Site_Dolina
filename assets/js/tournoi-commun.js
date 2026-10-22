// =====================================================================
//  Tournois : éléments communs aux pages Tournois, Créer et Tournoi
// =====================================================================

import { supabase, esc, nomAffiche, avatar } from './app.js?v=__VERSION__';

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
  if (t.est_ligue) return `Ligue interne · chacun contre chacun${t.pools_count > 1 ? ` · ${t.pools_count} poules` : ''}${t.pool_qualifiers ? ` · ${t.pool_qualifiers} qualifiés${t.pools_count > 1 ? ' par poule' : ''} pour le Master` : ''}`;
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

export async function chargerMembres() {
  if (membresCache) return membresCache;
  const { data } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, nickname, use_nickname, photo_path')
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
            ${avatar(m, 'avatar--liste')}
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

// ---------------------------------------------------------------------
// Classement d'une poule (règles du club)
//   3 points par victoire, 1 point par défaite, 0 par forfait ;
//   match nul (ligue interne) : 1 point chacun.
//   Égalité de points : le plus de manches gagnées ;
//   puis le résultat des matchs entre les joueurs à égalité.
//   matchs : matchs de la poule (status 'done' comptés)
// ---------------------------------------------------------------------
export const POINTS_VICTOIRE = 3;
export const POINTS_DEFAITE = 1;
export const POINTS_NUL = 1;        // match nul de la ligue interne, pour chaque joueur

export function classementPoule(idsInscrits, matchs) {
  const lignes = new Map(idsInscrits.map((id) => [id, { id, joues: 0, victoires: 0, defaites: 0, nuls: 0, pour: 0, contre: 0, points: 0, critere: '' }]));
  for (const m of matchs.filter((x) => x.status === 'done' && x.nul)) {
    const a = lignes.get(m.entry_a);
    const b = lignes.get(m.entry_b);
    if (!a || !b) continue;
    a.joues += 1; b.joues += 1; a.nuls += 1; b.nuls += 1;
    a.points += POINTS_NUL; b.points += POINTS_NUL;
  }
  const joues = matchs.filter((m) => m.status === 'done' && m.winner_entry);
  for (const m of joues) {
    const a = lignes.get(m.entry_a);
    const b = lignes.get(m.entry_b);
    if (!a || !b) continue;
    const la = m.legs_a ?? m.score_a ?? 0;
    const lb = m.legs_b ?? m.score_b ?? 0;
    a.joues += 1; b.joues += 1;
    a.pour += la; a.contre += lb;
    b.pour += lb; b.contre += la;
    const [g, p] = m.winner_entry === m.entry_a ? [a, b] : [b, a];
    g.victoires += 1; g.points += POINTS_VICTOIRE;
    p.defaites += 1; p.points += m.forfeit ? 0 : POINTS_DEFAITE;
  }
  const liste = [...lignes.values()];

  // Points puis manches gagnées
  liste.sort((x, y) => y.points - x.points || y.pour - x.pour);

  // Groupes encore à égalité : matchs entre eux
  const resultat = [];
  for (let i = 0; i < liste.length;) {
    let j = i + 1;
    while (j < liste.length && liste[j].points === liste[i].points && liste[j].pour === liste[i].pour) j += 1;
    const groupe = liste.slice(i, j);
    if (groupe.length > 1 && groupe.some((x) => x.joues > 0)) {
      const ids = new Set(groupe.map((x) => x.id));
      const entre = Object.fromEntries(groupe.map((x) => [x.id, 0]));
      for (const m of joues) {
        if (ids.has(m.entry_a) && ids.has(m.entry_b)) entre[m.winner_entry] += 1;
      }
      groupe.sort((x, y) => entre[y.id] - entre[x.id]);
      const departages = new Set(groupe.map((x) => entre[x.id])).size > 1;
      groupe.forEach((x) => { x.critere = departages ? 'Départagé par le match entre eux' : 'Égalité parfaite'; });
    }
    resultat.push(...groupe);
    i = j;
  }
  resultat.forEach((x, i) => { x.rang = i + 1; });
  return resultat;
}

// Nom d'un tour de l'arbre selon le nombre de matchs de ce tour
export function nomTour(nbMatchs, troisieme = false) {
  if (troisieme) return 'Match pour la 3e place';
  return { 1: 'Finale', 2: 'Demi-finales', 4: 'Quarts de finale', 8: 'Huitièmes de finale', 16: 'Seizièmes de finale', 32: 'Trente-deuxièmes' }[nbMatchs] || `Tour de ${nbMatchs * 2}`;
}

export const LETTRES = 'ABCDEFGHIJKLMNOP';
export const lettrePoule = (n) => LETTRES[(n || 1) - 1] || String(n);
