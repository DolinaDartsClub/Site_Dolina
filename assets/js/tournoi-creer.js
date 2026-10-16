// =====================================================================
//  Créer (ou modifier) un tournoi : formulaire, vérification, confirmation
//  tournoi-creer.html           → nouveau tournoi
//  tournoi-creer.html?id=…      → modifier les paramètres (organisateur)
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, brancherTypeMatch } from './app.js?v=__VERSION__';
import { FORMATS, MODES, STATUTS } from './tournoi-commun.js?v=__VERSION__';

const form = document.getElementById('form-tournoi');
const recap = document.getElementById('recap');
const zoneMsg = document.getElementById('message');
const zoneAcces = document.getElementById('acces');
const idModif = new URLSearchParams(location.search).get('id');

const choix = { team_mode: 'single', format: 'knockout' };
const typeMatch = brancherTypeMatch(document.getElementById('type-match'));
let existant = null;      // tournoi modifié
let nbInscrits = 0;
let envoi = false;

async function init() {
  const moi = await profilConnecte();
  if (!moi || moi.status !== 'active') {
    zoneAcces.hidden = false;
    zoneAcces.innerHTML = moi
      ? '<p class="vide">Votre compte doit être validé par un admin du club pour créer un tournoi.</p>'
      : '<p class="vide">Connectez-vous pour créer un tournoi. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  if (idModif) {
    const { data, error } = await supabase.from('tournaments')
      .select('*, tournament_entries(count)').eq('id', idModif).maybeSingle();
    if (error || !data || (data.created_by !== moi.id && moi.role !== 'admin')) {
      zoneAcces.hidden = false;
      zoneAcces.innerHTML = '<p class="vide">Ce tournoi n\'existe pas ou vous n\'en êtes pas l\'organisateur.</p>';
      return;
    }
    if (data.status === 'running' || data.status === 'finished') {
      zoneAcces.hidden = false;
      zoneAcces.innerHTML = `<p class="vide">Le tournoi a commencé : ses paramètres ne peuvent plus être modifiés. <a href="tournoi.html?id=${encodeURIComponent(data.id)}">Retour au tournoi</a></p>`;
      return;
    }
    existant = data;
    nbInscrits = data.tournament_entries?.[0]?.count ?? 0;
    remplir(data);
  }
  form.hidden = false;
  majAffichage();
}

function remplir(t) {
  document.title = `Modifier ${t.name} – Dolina Darts Club`;
  document.getElementById('titre-page').textContent = 'Modifier le tournoi';
  document.getElementById('titre-form').textContent = 'Paramètres du tournoi';
  document.getElementById('case-ouvrir').hidden = true;
  form.querySelector('[type=submit]').textContent = 'Vérifier les modifications';
  document.getElementById('btn-confirmer').textContent = 'Enregistrer les modifications';
  const f = form.elements;
  f.name.value = t.name;
  f.description.value = t.description || '';
  f.max_participants.value = t.max_participants;
  f.pool_qualifiers.value = t.pool_qualifiers || 2;
  f.third_place.checked = t.third_place;
  f.public_matches.checked = t.public_matches;
  f.show_checkout.checked = t.show_checkout !== false;
  if (t.match_type) typeMatch.definir(t.match_type);
  choix.team_mode = t.team_mode;
  choix.format = t.format;
  majOptionsPoules();
  f.pools_count.value = t.pools_count || '';
  // Individuel / double : figé dès qu'il y a des inscrits
  if (nbInscrits > 0) {
    document.querySelectorAll('[data-groupe="team_mode"] button').forEach((b) => { b.disabled = true; });
    document.getElementById('aide-mode').textContent = `${nbInscrits} inscrit${nbInscrits > 1 ? 's' : ''} : le choix individuel / double ne peut plus changer.`;
  }
}

// ---------- Choix par pastilles ----------

document.querySelectorAll('[data-groupe]').forEach((groupe) => {
  groupe.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    choix[groupe.dataset.groupe] = b.dataset.valeur;
    majAffichage();
  });
});

form.elements.max_participants.addEventListener('input', majOptionsPoules);
form.elements.pool_qualifiers.addEventListener('input', aidePoules);
form.elements.pools_count.addEventListener('change', aidePoules);

function majAffichage() {
  document.querySelectorAll('[data-groupe]').forEach((g) => {
    g.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valeur === choix[g.dataset.groupe])));
  });
  if (!existant || nbInscrits === 0) {
    document.getElementById('aide-mode').textContent = choix.team_mode === 'double'
      ? 'Chaque doublette s\'inscrit avec un seul compte (celui du joueur 1), qui choisit son partenaire : un membre ou un invité.'
      : 'Chaque joueur s\'inscrit avec son compte. L\'organisateur peut aussi ajouter des membres ou des invités sans compte.';
  }
  document.getElementById('bloc-poules').hidden = choix.format !== 'pools';
  majOptionsPoules();
}

// Nombre de poules possible : au moins 2 joueurs par poule
function majOptionsPoules() {
  const sel = form.elements.pools_count;
  const actuel = sel.value;
  const max = Math.max(1, Math.min(16, Math.floor((Number(form.elements.max_participants.value) || 2) / 2)));
  sel.innerHTML = '<option value="">Proposé au lancement</option>'
    + Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1} poule${i ? 's' : ''}</option>`).join('');
  if (actuel && Number(actuel) <= max) sel.value = actuel;
  aidePoules();
}

// Exemple de répartition équilibrée (écart d'au plus 1 joueur entre poules)
export function repartition(n, poules) {
  const base = Math.floor(n / poules);
  const plus = n % poules;
  return { grandes: plus, tailleGrande: base + 1, petites: poules - plus, taillePetite: base };
}

function aidePoules() {
  const n = Number(form.elements.max_participants.value) || 0;
  const q = Number(form.elements.pool_qualifiers.value) || 0;
  const p = Number(form.elements.pools_count.value) || 0;
  const zone = document.getElementById('aide-poules');
  if (!p || n < 2) {
    zone.textContent = 'La répartition sera proposée au lancement, selon le nombre réel d\'inscrits. Les poules ont des tailles qui diffèrent d\'au plus 1 joueur.';
    return;
  }
  const r = repartition(n, p);
  const morceaux = [];
  if (r.petites) morceaux.push(`${r.petites} poule${r.petites > 1 ? 's' : ''} de ${r.taillePetite}`);
  if (r.grandes) morceaux.push(`${r.grandes} poule${r.grandes > 1 ? 's' : ''} de ${r.tailleGrande}`);
  zone.textContent = `Avec ${n} joueurs : ${morceaux.join(' et ')} → ${p * q} qualifiés pour la phase finale.`
    + (q >= r.taillePetite ? ' Attention : il y a autant de qualifiés que de joueurs dans certaines poules.' : '');
}

// ---------- Vérification ----------

function lire() {
  const f = form.elements;
  return {
    name: f.name.value.trim(),
    description: f.description.value.trim(),
    team_mode: choix.team_mode,
    format: choix.format,
    max_participants: Number(f.max_participants.value),
    pool_qualifiers: choix.format === 'pools' ? Number(f.pool_qualifiers.value) : null,
    pools_count: choix.format === 'pools' && f.pools_count.value ? Number(f.pools_count.value) : null,
    third_place: f.third_place.checked,
    public_matches: f.public_matches.checked,
    show_checkout: f.show_checkout.checked,
    match_type: typeMatch.valeur() || 'club',
  };
}

function verifier(v) {
  if (typeMatch.manque()) return typeMatch.manque();
  if (v.name.length < 2) return 'Donnez un nom au tournoi (2 caractères minimum).';
  if (!Number.isInteger(v.max_participants) || v.max_participants < 2 || v.max_participants > 64) return 'Le nombre de places doit être compris entre 2 et 64.';
  if (existant && v.max_participants < nbInscrits) return `Il y a déjà ${nbInscrits} inscrits : le nombre de places ne peut pas être inférieur.`;
  if (v.format === 'pools') {
    if (!Number.isInteger(v.pool_qualifiers) || v.pool_qualifiers < 1 || v.pool_qualifiers > 8) return 'Le nombre de qualifiés par poule doit être compris entre 1 et 8.';
    if (v.max_participants < 3) return 'Un tournoi avec poules demande au moins 3 places.';
  }
  return null;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = lire();
  const probleme = verifier(v);
  if (probleme) return message(zoneMsg, probleme);
  message(zoneMsg, '');
  const ouvrir = !existant && form.elements.ouvrir.checked;
  const lignes = [
    ['Nom', esc(v.name)],
    ['Description', v.description ? esc(v.description) : '<em>Aucune</em>'],
    ['Participants', `${esc(MODES[v.team_mode])} · ${v.max_participants} places maximum`],
    ['Format', esc(FORMATS[v.format])],
  ];
  if (v.format === 'pools') {
    lignes.push(['Poules', `${v.pools_count ? `${v.pools_count} poules` : 'Nombre proposé au lancement'} · ${v.pool_qualifiers} qualifié${v.pool_qualifiers > 1 ? 's' : ''} par poule`]);
    lignes.push(['Classement des poules', '3 pts par victoire, 1 pt par défaite · égalité : manches gagnées, puis confrontation directe']);
  }
  lignes.push(['Match pour la 3e place', v.third_place ? 'Oui' : 'Non']);
  lignes.push(['Matchs', v.public_matches ? 'Publics (visibles dans « Matchs en cours »)' : 'Privés']);
  lignes.push(['Guide de finish', v.show_checkout ? 'Affiché dans le scorer' : 'Masqué']);
  lignes.push(['Type', { club: 'Tournoi de club (compte au classement)', ligue: 'Ligue (compte au classement)', amical: 'Amical (ne compte pas au classement)' }[v.match_type] || 'Club']);
  lignes.push(['Format des matchs', 'Choisi au lancement de chaque phase']);
  if (!existant) lignes.push(['Statut à la création', esc(STATUTS[ouvrir ? 'open' : 'draft'].libelle) + (ouvrir ? ' : le code est utilisable tout de suite' : ' : vous ouvrirez les inscriptions plus tard')]);
  document.getElementById('recap-liste').innerHTML = lignes.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('');
  form.hidden = true;
  recap.hidden = false;
  window.scrollTo({ top: 0 });
});

document.getElementById('btn-modifier').addEventListener('click', () => {
  recap.hidden = true;
  form.hidden = false;
});

document.getElementById('btn-confirmer').addEventListener('click', async () => {
  if (envoi) return;                 // pas de double création par double clic
  envoi = true;
  const bouton = document.getElementById('btn-confirmer');
  bouton.disabled = true;
  const v = lire();
  let res;
  if (existant) {
    res = await supabase.from('tournaments').update(v).eq('id', existant.id).select('id').single();
  } else {
    res = await supabase.from('tournaments')
      .insert({ ...v, status: form.elements.ouvrir.checked ? 'open' : 'draft' })
      .select('id').single();
  }
  // Base pas encore à jour (script 015 non exécuté) : enregistrement sans l'option « guide de finish »
  if (res.error && /match_type/.test(res.error.message || '')) {
    delete v.match_type;
    res = existant
      ? await supabase.from('tournaments').update(v).eq('id', existant.id).select('id').single()
      : await supabase.from('tournaments').insert({ ...v, status: form.elements.ouvrir.checked ? 'open' : 'draft' }).select('id').single();
  }
  if (res.error && /show_checkout/.test(res.error.message || '')) {
    const { show_checkout: _ignore, ...sansGuide } = v;
    res = existant
      ? await supabase.from('tournaments').update(sansGuide).eq('id', existant.id).select('id').single()
      : await supabase.from('tournaments').insert({ ...sansGuide, status: form.elements.ouvrir.checked ? 'open' : 'draft' }).select('id').single();
  }
  if (res.error) {
    envoi = false;
    bouton.disabled = false;
    recap.hidden = true;
    form.hidden = false;
    return message(zoneMsg, `${existant ? 'Les modifications n\'ont pas été enregistrées' : 'Le tournoi n\'a pas été créé'} : ${erreurFr(res.error)}`);
  }
  location.href = `tournoi.html?id=${encodeURIComponent(res.data.id)}${existant ? '&modifie=1' : '&nouveau=1'}`;
});

init();
