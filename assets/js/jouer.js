// =====================================================================
//  Jouer : création d'un match X01 et reprise des parties en cours
// =====================================================================

import { BOT_DEFAUT, nomCampBot, bullBot } from './dartbot.js?v=__VERSION__';
import { cibleSvg, pointCible, marque } from './cible.js?v=__VERSION__';
import { reglageVoix, definirVoix, voixDisponible, dire, voixDeLaLangue, quandVoixChangent, tonDuScore } from './voix.js?v=__VERSION__';
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

// ---------- Onglets du choix des jeux : « Jouer un match » / « S'entraîner et s'échauffer » ----------
const CLE_ONGLET = 'dolina-jouer-onglet';
function choisirOnglet(nom) {
  document.querySelectorAll('[data-onglet-jeux]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ongletJeux === nom)));
  document.getElementById('panneau-jouer').hidden = nom !== 'jouer';
  document.getElementById('panneau-entrainer').hidden = nom !== 'entrainer';
  try { localStorage.setItem(CLE_ONGLET, nom); } catch { /* sans importance */ }
}
document.querySelector('.jeux__onglets')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-onglet-jeux]');
  if (b) choisirOnglet(b.dataset.ongletJeux);
});
(() => {
  let nom = location.hash === '#entrainement' ? 'entrainer' : null;
  if (!nom) { try { nom = localStorage.getItem(CLE_ONGLET); } catch { /* idem */ } }
  choisirOnglet(nom === 'entrainer' ? 'entrainer' : 'jouer');
})();

// ---------- Accès ----------

// La page Jouer affiche le choix des jeux ; « Match X01 » (#match) ouvre la création de match
function afficherVue() {
  const match = location.hash === '#match';
  document.getElementById('hub').hidden = match;
  form.hidden = !match || !moi || moi.status !== 'active';
  zoneAcces.hidden = !match || (moi && moi.status === 'active');
  // Une partie en cours s'affiche tout en haut, sur le choix des jeux comme sur « Match X01 »
  document.getElementById('reprendre').hidden = !document.getElementById('liste-reprendre').children.length;
  if (match) window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', afficherVue);

async function init() {
  moi = await profilConnecte();
  if (!moi) {
    zoneAcces.innerHTML = '<p class="vide">Connectez-vous pour lancer un match. <a href="connexion.html">Se connecter</a></p>';
  } else if (moi.status !== 'active') {
    zoneAcces.innerHTML = '<p class="vide">Votre compte doit être validé par un admin du club avant de pouvoir jouer.</p>';
  }
  afficherVue();
  if (!moi || moi.status !== 'active') return;
  document.getElementById('lien-mes-parties').hidden = false;
  joueurs = [{ type: 'membre', id: moi.id, nom: nomAffiche(moi) }];
  afficherJoueurs();
  majFormat();
  await Promise.all([chargerMembres(), chargerReprises()]);
  afficherVue();
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
  document.getElementById('titre-reprendre').textContent = recentes.length > 1 ? 'Matchs en cours' : 'Match en cours';
  document.getElementById('liste-reprendre').innerHTML = recentes.map((g, i) => {
    const noms = [...g.game_players].sort((a, b) => a.side - b.side).map((p) => p.display_name).join(' – ');
    const heure = new Date(g.created_at).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return `
      <article class="carte-info"${i >= 2 ? ' data-autre hidden' : ''}>
        <strong>${esc(noms)}</strong>
        <span class="match__format">${esc(formatPartie(g))} · commencée ${esc(heure)}</span>
        <div class="actions">
          <a class="bouton bouton--petit bouton--plein" href="scorer.html?id=${g.id}">Reprendre le match</a>
          <button type="button" class="bouton bouton--petit bouton--danger" data-abandon="${g.id}">Abandonner</button>
        </div>
      </article>`;
  }).join('') + (recentes.length > 2
    ? `<button type="button" class="bouton bouton--petit bouton--discret" data-voir-autres>Voir les ${recentes.length - 2} autres</button>` : '');
}

document.getElementById('liste-reprendre').addEventListener('click', async (e) => {
  // Au-delà de 2 parties, les autres restent repliées pour garder le formulaire visible
  const voir = e.target.closest('[data-voir-autres]');
  if (voir) { document.querySelectorAll('#liste-reprendre [data-autre]').forEach((x) => { x.hidden = false; }); voir.remove(); return; }
  const b = e.target.closest('[data-abandon]');
  if (!b || !confirm('Abandonner cette partie ? Elle sera supprimée définitivement, avec tous ses scores.')) return;
  await supprimerPartie(b.dataset.abandon);
  chargerReprises();
});

// ---------- Choix du jeu, du mode, du format ----------

form.querySelectorAll('.pastilles[data-groupe]').forEach((groupe) => {
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

  const bot = choix.mode === 'bot';
  const plein = joueurs.length >= (bot ? 1 : MAX_JOUEURS);
  document.getElementById('ajout-joueurs').hidden = plein;
  document.getElementById('bloc-bot').hidden = !bot;
  document.getElementById('bloc-visi').hidden = bot;   // contre le dartbot : partie toujours privée
  document.getElementById('aide-joueurs').textContent = choix.mode === 'double'
    ? `Double 2v2 : ajoutez 4 joueurs (${joueurs.length}/4), puis formez les deux doublettes.`
    : bot ? (joueurs.length > 1 ? 'Contre le dartbot, un seul joueur : retirez les autres.' : 'Un joueur seul contre le dartbot.')
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

// Annonce vocale : réglage gardé sur cet appareil (il sert aussi aux matchs de tournoi)
function majVoix() {
  const r = reglageVoix();
  const val = r.actif ? r.langue : 'off';
  document.querySelectorAll('[data-voix-val]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.voixVal === val)));
  // Liste des voix de l'appareil pour la langue choisie (la plus naturelle en premier)
  const liste = r.actif ? voixDeLaLangue(r.langue) : [];
  document.getElementById('voix-reglage').hidden = !liste.length;
  document.getElementById('voix-nom').innerHTML = `<option value="">Automatique · ${esc(liste[0]?.name || '')}</option>`
    + liste.map((v) => `<option value="${esc(v.name)}"${v.name === r.voix ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
}
const phraseTest = (langue) => (langue === 'en'
  ? ['Game on!', { texte: 'One hundred and forty!', ...tonDuScore(140) }]
  : ['Annonce vocale activée.', { texte: 'Cent quarante !', ...tonDuScore(140) }]);
if (!voixDisponible()) {
  document.getElementById('bloc-voix').hidden = true;
} else {
  majVoix();
  document.querySelector('[data-voix]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-voix-val]');
    if (!b) return;
    const v = b.dataset.voixVal;
    definirVoix(v === 'off' ? { actif: false, langue: reglageVoix().langue } : { actif: true, langue: v, voix: v === reglageVoix().langue ? reglageVoix().voix : '' });
    majVoix();
    if (v !== 'off') dire(phraseTest(v), v);
  });
  document.getElementById('voix-nom').addEventListener('change', (e) => {
    const r = reglageVoix();
    definirVoix({ ...r, voix: e.target.value });
    dire(phraseTest(r.langue), r.langue);
  });
  document.getElementById('voix-test').addEventListener('click', () => {
    const r = reglageVoix();
    dire(phraseTest(r.langue), r.langue);
  });
  quandVoixChangent(majVoix);
}

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
  if (choix.mode === 'bot') {
    return [{ side: 1, nom: joueurs[0]?.nom, joueurs: [0] }, { side: 2, nom: 'Dartbot', joueurs: [], bot: true }];
  }
  return joueurs.map((j, i) => ({ side: i + 1, nom: j.nom, joueurs: [i] }));
}

// ---------- Réglages du dartbot (gardés sur l'appareil) ----------

function reglageBot() {
  return { moyenne: Number(form.elements.bot_moyenne.value), doubles: Number(form.elements.bot_doubles.value) };
}
function majBot() {
  const r = reglageBot();
  document.getElementById('val-moyenne').textContent = r.moyenne;
  document.getElementById('val-doubles').textContent = `${r.doubles} %`;
  try { localStorage.setItem('dolina-bot', JSON.stringify(r)); } catch { /* stockage indisponible */ }
}
(() => {
  let r = BOT_DEFAUT;
  try { r = { ...BOT_DEFAUT, ...JSON.parse(localStorage.getItem('dolina-bot') || '{}') }; } catch { /* idem */ }
  form.elements.bot_moyenne.value = r.moyenne;
  form.elements.bot_doubles.value = r.doubles;
  majBot();
  ['bot_moyenne', 'bot_doubles'].forEach((n) => form.elements[n].addEventListener('input', majBot));
})();

function verifier() {
  const f = form.elements;
  if (choix.variant === 'libre') {
    const s = Number(f.start_score.value);
    if (!Number.isInteger(s) || s < 2 || s > 9999) return 'Le score de départ doit être un nombre entre 2 et 9999.';
  }
  if (!joueurs.length) return 'Ajoutez au moins un joueur.';
  if (choix.mode === 'bot' && joueurs.length !== 1) return 'Contre le dartbot, un seul joueur : retirez les autres.';
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
  if (choix.mode === 'bot') return ouvrirBullBot();
  document.getElementById('liste-bull').innerHTML = camps.map((c) => `
    <button type="button" class="bouton bouton--large" data-premier="${c.side}">${esc(c.nom)}</button>`).join('');
  ouvrir('fenetre-bull');
});

// ----- Tirage au bull contre le dartbot : le joueur montre où sa fléchette est tombée,
// le bot lance à une distance réaliste pour son niveau -----

let bullJoueur = null;
let premierBull = null;
const mm = (d) => `${(d / 10).toFixed(1).replace('.', ',')} cm`;
const distance = (p) => Math.hypot(p.x, p.y);

function ouvrirBullBot() {
  bullJoueur = null;
  premierBull = null;
  document.getElementById('bull-cible').innerHTML = cibleSvg({ id: 'cible-bull', etiquette: 'Cible : touchez l\'endroit où votre fléchette est tombée' });
  document.getElementById('bull-bot-texte').textContent = 'Lancez une fléchette vers le bull, puis touchez la cible là où elle est tombée.';
  const ok = document.getElementById('bull-bot-ok');
  ok.textContent = 'Valider ma fléchette';
  ok.disabled = true;
  ouvrir('fenetre-bull-bot');
}

document.getElementById('bull-cible').addEventListener('click', (e) => {
  const svg = e.target.closest('svg');
  if (!svg || premierBull || document.getElementById('bull-bot-ok').dataset.attente) return;
  bullJoueur = pointCible(svg, e);
  if (distance(bullJoueur) > 200) return;
  svg.querySelector('.cible-marques').innerHTML = marque(bullJoueur, 'Vous', 'cible-fleche--joueur');
  document.getElementById('bull-bot-texte').textContent = `Votre fléchette : à ${mm(distance(bullJoueur))} du centre. Touchez ailleurs pour corriger.`;
  document.getElementById('bull-bot-ok').disabled = false;
});

document.getElementById('bull-bot-ok').addEventListener('click', (e) => {
  const ok = e.currentTarget;
  if (premierBull) return creerPartie(premierBull);
  if (!bullJoueur) return;
  ok.disabled = true;
  ok.dataset.attente = '1';
  document.getElementById('bull-bot-texte').textContent = 'Le dartbot lance…';
  setTimeout(() => {
    delete ok.dataset.attente;
    const bot = bullBot(reglageBot());
    const marques = document.querySelector('#cible-bull .cible-marques');
    marques.insertAdjacentHTML('beforeend', marque(bot, 'Bot', 'cible-fleche--bot'));
    const dJ = Math.round(distance(bullJoueur));
    const dB = Math.round(bot.distance);
    const texte = document.getElementById('bull-bot-texte');
    if (dJ === dB) {
      texte.textContent = `Égalité, les deux fléchettes sont à ${mm(dJ)} du centre. Relancez et touchez à nouveau la cible.`;
      bullJoueur = null;
      setTimeout(() => { marques.innerHTML = ''; }, 1500);
      ok.textContent = 'Valider ma fléchette';
      return;
    }
    premierBull = dJ < dB ? 1 : 2;
    texte.innerHTML = `Vous : ${mm(dJ)} · Bot : ${mm(dB)}.<br><strong>${premierBull === 1 ? 'Vous êtes le plus proche : vous commencez.' : 'Le dartbot est le plus proche : il commence.'}</strong>`;
    ok.textContent = 'Lancer la partie';
    ok.disabled = false;
  }, 900);
});

document.getElementById('liste-bull').addEventListener('click', (e) => {
  const b = e.target.closest('[data-premier]');
  if (b) creerPartie(Number(b.dataset.premier));
});

async function creerPartie(premier) {
  const f = form.elements;
  const boutons = document.querySelectorAll('#liste-bull button, #lancer, #bull-bot-ok');
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
    visibility: choix.public && choix.mode !== 'bot' ? 'public' : 'private',
    first_side: premier,
    show_checkout: choix.guide,
    match_type: 'club',   // les matchs de ligue se jouent uniquement depuis la rubrique Ligue
  };
  let { data: game, error } = await supabase.from('games').insert(ligneGame).select('id').single();
  // Base pas encore à jour (script 029 non exécuté) : on crée la partie sans le type
  if (error && /match_type/.test(error.message || '')) {
    delete ligneGame.match_type;
    ({ data: game, error } = await supabase.from('games').insert(ligneGame).select('id').single());
  }
  // Base pas encore à jour (script 015 non exécuté) : on crée la partie sans l'option
  if (error && /show_checkout/.test(error.message || '')) {
    delete ligneGame.show_checkout;
    ({ data: game, error } = await supabase.from('games').insert(ligneGame).select('id').single());
  }

  const echec = async (err) => {
    if (game?.id) await supprimerPartie(game.id);
    boutons.forEach((b) => { b.disabled = false; });
    fermer(document.getElementById('fenetre-bull'));
    fermer(document.getElementById('fenetre-bull-bot'));
    message(zoneMsg, `La partie n'a pas pu être créée. ${erreurFr(err)}`);
  };
  if (error) return echec(error);

  let res = await supabase.from('game_sides').insert(camps.map((c) => ({
    game_id: game.id, side: c.side,
    name: choix.mode === 'double' ? c.nom : (c.bot ? nomCampBot(reglageBot()) : null),
    is_bot: !!c.bot,
  })));
  if (res.error) return echec(res.error);

  res = await supabase.from('game_players').insert(camps.flatMap((c) => (c.bot ? [{ game_id: game.id, side: c.side, throw_order: 1 }] : c.joueurs.map((i, ordre) => {
    const j = joueurs[i];
    return {
      game_id: game.id,
      side: c.side,
      profile_id: j.type === 'membre' ? j.id : null,
      guest_name: j.type === 'invite' ? j.nom : null,
      throw_order: ordre + 1,
    };
  }))));
  if (res.error) return echec(res.error);

  location.href = `scorer.html?id=${game.id}`;
}

init();
