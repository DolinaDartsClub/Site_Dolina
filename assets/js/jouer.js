// =====================================================================
//  Jouer : création d'un match X01 et reprise des parties en cours
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, nomAffiche, formatPartie, supprimerPartie, avatar } from './app.js?v=__VERSION__';

const MAX_JOUEURS = 4;
const DUREE_REPRISE_H = 24;

const form = document.getElementById('form-jeu');
const zoneMsg = document.getElementById('message');
const zoneAcces = document.getElementById('acces');

let moi = null;
let membres = [];
const choix = { variant: '501', mode: 'single', public: true, guide: true };
let joueurs = [];          // { type: 'membre' | 'invite', id?, nom }
let affectation = {};      // index du joueur -> 1 | 2 (doublettes)

// ---------- Accès ----------

async function init() {
  moi = await profilConnecte();
  if (!moi) {
    zoneAcces.hidden = false;
    zoneAcces.innerHTML = '<p class="vide">Connectez-vous pour lancer une partie. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  if (moi.status !== 'active') {
    zoneAcces.hidden = false;
    zoneAcces.innerHTML = '<p class="vide">Votre compte doit être validé par un admin du club avant de pouvoir jouer.</p>';
    return;
  }
  form.hidden = false;
  document.getElementById('lien-mes-parties').hidden = false;
  document.getElementById('liens-tournoi').hidden = false;
  joueurs = [{ type: 'membre', id: moi.id, nom: nomAffiche(moi) }];
  afficherJoueurs();
  majFormat();
  await Promise.all([chargerMembres(), chargerReprises()]);
}

// ---------- Parties à reprendre (24 h) ----------

async function chargerReprises() {
  const { data } = await supabase
    .from('games')
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, created_at, game_players(display_name, side)')
    .eq('created_by', moi.id)
    .eq('status', 'live')
    .order('created_at', { ascending: false });
  const limite = Date.now() - DUREE_REPRISE_H * 3600 * 1000;
  const anciennes = (data || []).filter((g) => Date.parse(g.created_at) < limite);
  const recentes = (data || []).filter((g) => Date.parse(g.created_at) >= limite);

  // Au-delà de 24 h, une partie interrompue ne se reprend plus : elle est supprimée
  await Promise.all(anciennes.map((g) => supprimerPartie(g.id)));

  const bloc = document.getElementById('reprendre');
  bloc.hidden = !recentes.length;
  document.getElementById('liste-reprendre').innerHTML = recentes.map((g) => {
    const noms = [...g.game_players].sort((a, b) => a.side - b.side).map((p) => p.display_name).join(' – ');
    const heure = new Date(g.created_at).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return `
      <article class="carte-info">
        <strong>${esc(noms)}</strong>
        <span class="match__format">${esc(formatPartie(g))} · commencée ${esc(heure)}</span>
        <div class="actions">
          <a class="bouton bouton--petit bouton--plein" href="scorer.html?id=${g.id}">Reprendre</a>
          <button type="button" class="bouton bouton--petit bouton--danger" data-abandon="${g.id}">Abandonner</button>
        </div>
      </article>`;
  }).join('');
}

document.getElementById('liste-reprendre').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-abandon]');
  if (!b || !confirm('Abandonner cette partie ? Elle sera supprimée définitivement, avec tous ses scores.')) return;
  await supprimerPartie(b.dataset.abandon);
  chargerReprises();
});

// ---------- Choix du jeu, du mode, du format ----------

form.querySelectorAll('.pastilles').forEach((groupe) => {
  groupe.addEventListener('click', (e) => {
    const b = e.target.closest('.pastille-choix');
    if (!b || b.disabled) return;
    groupe.querySelectorAll('.pastille-choix').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    choix[groupe.dataset.groupe] = b.dataset.valeur;
    document.getElementById('champ-libre').hidden = choix.variant !== 'libre';
    afficherJoueurs();
    majFormat();
  });
});

function corrigerImpair(kindChamp, nChamp) {
  // « Au meilleur de » : un nombre impair (3, 5, 7…)
  const n = Number(nChamp.value);
  if (kindChamp.value === 'best_of' && n % 2 === 0) nChamp.value = n + 1;
}

function majFormat() {
  const f = form.elements;
  f.sets_n.hidden = !f.sets_kind.value;
  const g = {
    variant: choix.variant,
    start_score: choix.variant === 'libre' ? Number(f.start_score.value) || '?' : Number(choix.variant),
    mode: choix.mode,
    legs_kind: f.legs_kind.value,
    legs_n: Number(f.legs_n.value) || 1,
    sets_kind: f.sets_kind.value || null,
    sets_n: f.sets_kind.value ? Number(f.sets_n.value) || 1 : null,
  };
  document.getElementById('resume-format').textContent = `${formatPartie(g)} · finish double`;
}

['legs_kind', 'legs_n', 'sets_kind', 'sets_n', 'start_score'].forEach((nom) => {
  form.elements[nom].addEventListener('change', () => {
    corrigerImpair(form.elements.legs_kind, form.elements.legs_n);
    corrigerImpair(form.elements.sets_kind, form.elements.sets_n);
    majFormat();
  });
});

// ---------- Joueurs ----------

function afficherJoueurs() {
  const puces = document.getElementById('puces-joueurs');
  puces.innerHTML = joueurs.map((j, i) => `
    <span class="puce">
      ${esc(j.nom)}${j.type === 'invite' ? ' <small>(invité)</small>' : ''}${j.id === moi?.id ? ' <small>(moi)</small>' : ''}
      <button type="button" class="puce__retirer" data-retirer="${i}" aria-label="Retirer ${esc(j.nom)}">✕</button>
    </span>`).join('') || '<span class="match__format">Aucun joueur pour l\'instant.</span>';

  const plein = joueurs.length >= MAX_JOUEURS;
  document.getElementById('ajout-joueurs').hidden = plein;
  document.getElementById('aide-joueurs').textContent = choix.mode === 'double'
    ? `Double 2v2 : ajoutez 4 joueurs (${joueurs.length}/4), puis formez les deux doublettes.`
    : `De 1 à 4 joueurs. Les statistiques sont enregistrées dans le compte de chaque membre.${joueurs.length === 1 ? ' Seul (sans adversaire), la partie ne compte pas dans les statistiques ni dans le classement.' : ''}`;

  // Doublettes
  const blocEquipes = document.getElementById('bloc-equipes');
  blocEquipes.hidden = choix.mode !== 'double';
  if (choix.mode === 'double') afficherAffectation();
}

function afficherAffectation() {
  const f = form.elements;
  const n1 = f.team1.value.trim() || 'Équipe 1';
  const n2 = f.team2.value.trim() || 'Équipe 2';
  document.getElementById('affectation').innerHTML = joueurs.map((j, i) => `
    <div class="ligne-equipe">
      <span class="ligne-equipe__nom">${esc(j.nom)}</span>
      <span class="ligne-equipe__actions" style="grid-column:auto">
        <button type="button" class="bouton bouton--petit ${affectation[i] === 1 ? 'bouton--plein' : ''}" data-equipe="1" data-index="${i}">${esc(n1)}</button>
        <button type="button" class="bouton bouton--petit ${affectation[i] === 2 ? 'bouton--plein' : ''}" data-equipe="2" data-index="${i}">${esc(n2)}</button>
      </span>
    </div>`).join('');
}

document.getElementById('puces-joueurs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-retirer]');
  if (!b) return;
  joueurs.splice(Number(b.dataset.retirer), 1);
  affectation = {};
  afficherJoueurs();
});

document.getElementById('affectation').addEventListener('click', (e) => {
  const b = e.target.closest('[data-equipe]');
  if (!b) return;
  const i = Number(b.dataset.index);
  const eq = Number(b.dataset.equipe);
  if (affectation[i] === eq) delete affectation[i];
  else if (Object.values(affectation).filter((x) => x === eq).length < 2) affectation[i] = eq;
  else message(zoneMsg, 'Une doublette compte 2 joueurs : retirez d\'abord un joueur de cette équipe.');
  afficherAffectation();
});
['team1', 'team2'].forEach((n) => form.elements[n].addEventListener('input', afficherAffectation));

// ----- Fenêtres -----

function ouvrir(id) {
  const f = document.getElementById(id);
  f.hidden = false;
  f.querySelector('input')?.focus();
}
function fermer(f) { f.hidden = true; }
document.querySelectorAll('.fenetre').forEach((f) => {
  f.addEventListener('click', (e) => {
    if (e.target === f || e.target.closest('[data-fermer]')) fermer(f);
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.fenetre:not([hidden])').forEach(fermer);
});

// ----- Membres (avec recherche) -----

async function chargerMembres() {
  const { data } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, nickname, use_nickname, photo_path, team_members!team_members_profile_id_fkey(status, teams(name))')
    .eq('status', 'active')
    .order('last_name');
  membres = data || [];
}

function afficherMembres() {
  const q = document.getElementById('recherche-membre').value.trim().toLowerCase();
  const deja = new Set(joueurs.filter((j) => j.type === 'membre').map((j) => j.id));
  const liste = membres.filter((m) => !deja.has(m.id)
    && (!q || [m.first_name, m.last_name, m.nickname].some((v) => (v || '').toLowerCase().includes(q))));
  const zone = document.getElementById('liste-membres');
  if (!liste.length) {
    zone.innerHTML = `
      <div class="vide">
        Aucun membre ne correspond. Le joueur n'a peut-être pas de compte.
        <div class="actions" style="margin-top:10px"><button type="button" class="bouton bouton--petit" id="vers-invite">L'ajouter comme invité</button></div>
      </div>`;
    return;
  }
  zone.innerHTML = liste.map((m) => {
    const equipes = (m.team_members || []).filter((t) => t.status === 'accepted').map((t) => t.teams?.name).filter(Boolean).join(', ');
    return `
      <button type="button" class="ligne-membre" data-membre="${m.id}">
        ${avatar(m, 'avatar--liste')}
        <span class="ligne-membre__texte"><strong>${esc(nomAffiche(m))}</strong><small>${esc(m.use_nickname ? `${m.first_name} ${m.last_name}` : (m.nickname || ''))}${equipes ? ` · ${esc(equipes)}` : ''}</small></span>
        <span class="ligne-membre__plus" aria-hidden="true">+</span>
      </button>`;
  }).join('');
}

document.getElementById('btn-membre').addEventListener('click', () => {
  document.getElementById('recherche-membre').value = '';
  afficherMembres();
  ouvrir('fenetre-membre');
});
document.getElementById('recherche-membre').addEventListener('input', afficherMembres);
document.getElementById('liste-membres').addEventListener('click', (e) => {
  if (e.target.closest('#vers-invite')) {
    const nom = document.getElementById('recherche-membre').value.trim();
    fermer(document.getElementById('fenetre-membre'));
    document.getElementById('form-invite').nom.value = nom;
    ouvrir('fenetre-invite');
    return;
  }
  const b = e.target.closest('[data-membre]');
  if (!b) return;
  const m = membres.find((x) => x.id === b.dataset.membre);
  joueurs.push({ type: 'membre', id: m.id, nom: nomAffiche(m) });
  fermer(document.getElementById('fenetre-membre'));
  afficherJoueurs();
});

// ----- Invités -----

document.getElementById('btn-invite').addEventListener('click', () => {
  document.getElementById('form-invite').reset();
  ouvrir('fenetre-invite');
});
document.getElementById('form-invite').addEventListener('submit', (e) => {
  e.preventDefault();
  const nom = e.target.nom.value.trim();
  if (!nom) return;
  joueurs.push({ type: 'invite', nom });
  fermer(document.getElementById('fenetre-invite'));
  afficherJoueurs();
});

// ---------- Partie publique / privée ----------

document.getElementById('btn-visi').addEventListener('click', (e) => {
  choix.public = !choix.public;
  e.currentTarget.textContent = choix.public ? 'Publique' : 'Privée';
  e.currentTarget.classList.toggle('bouton--plein', choix.public);
  e.currentTarget.setAttribute('aria-pressed', String(choix.public));
  document.getElementById('visi-titre').textContent = choix.public ? 'Partie publique' : 'Partie privée';
  document.getElementById('visi-aide').textContent = choix.public
    ? 'Visible de tous dans « Matchs en cours »'
    : 'Visible uniquement des membres connectés';
});

// ---------- Guide de finish affiché / masqué ----------

document.getElementById('btn-guide').addEventListener('click', (e) => {
  choix.guide = !choix.guide;
  e.currentTarget.textContent = choix.guide ? 'Affiché' : 'Masqué';
  e.currentTarget.classList.toggle('bouton--plein', choix.guide);
  e.currentTarget.setAttribute('aria-pressed', String(choix.guide));
  document.getElementById('guide-titre').textContent = choix.guide ? 'Guide de finish affiché' : 'Guide de finish masqué';
  document.getElementById('guide-aide').textContent = choix.guide
    ? 'Le scorer propose le chemin de sortie (ex. T20 · T19 · D12)'
    : 'Le scorer n\'affiche pas de suggestion de finish';
});

// ---------- Lancement ----------

// Camps de la partie : [{ side, nom, joueurs: [index…] }]
function construireCamps() {
  const f = form.elements;
  if (choix.mode === 'double') {
    return [1, 2].map((eq) => ({
      side: eq,
      nom: (f[`team${eq}`].value.trim() || `Équipe ${eq}`),
      joueurs: joueurs.map((_, i) => i).filter((i) => affectation[i] === eq),
    }));
  }
  return joueurs.map((j, i) => ({ side: i + 1, nom: j.nom, joueurs: [i] }));
}

function verifier() {
  const f = form.elements;
  if (choix.variant === 'libre') {
    const s = Number(f.start_score.value);
    if (!Number.isInteger(s) || s < 2 || s > 9999) return 'Le score de départ doit être un nombre entre 2 et 9999.';
  }
  if (!joueurs.length) return 'Ajoutez au moins un joueur.';
  if (choix.mode === 'double') {
    if (joueurs.length !== 4) return 'En double 2v2, il faut 4 joueurs.';
    const c = construireCamps();
    if (c.some((x) => x.joueurs.length !== 2)) return 'Affectez 2 joueurs à chaque doublette.';
  }
  return null;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const probleme = verifier();
  if (probleme) return message(zoneMsg, probleme);
  message(zoneMsg, '');
  const camps = construireCamps();
  if (camps.length === 1) return creerPartie(1);
  document.getElementById('liste-bull').innerHTML = camps.map((c) => `
    <button type="button" class="bouton bouton--large" data-premier="${c.side}">${esc(c.nom)}</button>`).join('');
  ouvrir('fenetre-bull');
});

document.getElementById('liste-bull').addEventListener('click', (e) => {
  const b = e.target.closest('[data-premier]');
  if (b) creerPartie(Number(b.dataset.premier));
});

async function creerPartie(premier) {
  const f = form.elements;
  const boutons = document.querySelectorAll('#liste-bull button, #lancer');
  boutons.forEach((b) => { b.disabled = true; });
  const camps = construireCamps();

  const ligneGame = {
    created_by: moi.id,
    variant: choix.variant,
    start_score: choix.variant === 'libre' ? Number(f.start_score.value) : Number(choix.variant),
    mode: choix.mode,
    legs_kind: f.legs_kind.value,
    legs_n: Number(f.legs_n.value) || 1,
    sets_kind: f.sets_kind.value || null,
    sets_n: f.sets_kind.value ? Number(f.sets_n.value) || 1 : null,
    visibility: choix.public ? 'public' : 'private',
    first_side: premier,
    show_checkout: choix.guide,
  };
  let { data: game, error } = await supabase.from('games').insert(ligneGame).select('id').single();
  // Base pas encore à jour (script 015 non exécuté) : on crée la partie sans l'option
  if (error && /show_checkout/.test(error.message || '')) {
    delete ligneGame.show_checkout;
    ({ data: game, error } = await supabase.from('games').insert(ligneGame).select('id').single());
  }

  const echec = async (err) => {
    if (game?.id) await supprimerPartie(game.id);
    boutons.forEach((b) => { b.disabled = false; });
    fermer(document.getElementById('fenetre-bull'));
    message(zoneMsg, `La partie n'a pas pu être créée. ${erreurFr(err)}`);
  };
  if (error) return echec(error);

  let res = await supabase.from('game_sides').insert(camps.map((c) => ({
    game_id: game.id, side: c.side, name: choix.mode === 'double' ? c.nom : null,
  })));
  if (res.error) return echec(res.error);

  res = await supabase.from('game_players').insert(camps.flatMap((c) => c.joueurs.map((i, ordre) => {
    const j = joueurs[i];
    return {
      game_id: game.id,
      side: c.side,
      profile_id: j.type === 'membre' ? j.id : null,
      guest_name: j.type === 'invite' ? j.nom : null,
      throw_order: ordre + 1,
    };
  })));
  if (res.error) return echec(res.error);

  location.href = `scorer.html?id=${game.id}`;
}

init();
