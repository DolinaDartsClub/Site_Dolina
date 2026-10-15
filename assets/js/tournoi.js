// =====================================================================
//  Page d'un tournoi : présentation, code, participants, gestion
//  (organisateur). Poules, arbre et matchs : étapes T2 et T3.
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, nomAffiche, BASE_URL, dateFr } from './app.js?v=__VERSION__';
import { badgeStatut, resumeFormat, COLONNES_INSCRIT, nomInscrit, estMoi, choisirMembre, STATUTS } from './tournoi-commun.js?v=__VERSION__';

const id = new URLSearchParams(location.search).get('id');
const zone = document.getElementById('tournoi');
const zoneMsg = document.getElementById('message');
const fenAjout = document.getElementById('fen-ajout');

let moi = null;
let t = null;
let inscrits = [];
let onglet = 'participants';
let enCours = false;          // une action est en cours (anti double clic)

async function init() {
  moi = await profilConnecte();
  if (!moi) {
    zone.innerHTML = '<p class="vide">Connectez-vous pour voir ce tournoi. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  const p = new URLSearchParams(location.search);
  if (p.get('nouveau')) message(zoneMsg, 'Tournoi créé. Partagez le code ci-dessous pour que les joueurs s\'inscrivent.', 'ok');
  if (p.get('inscrit')) message(zoneMsg, 'Inscription enregistrée. Bienvenue dans le tournoi !', 'ok');
  if (p.get('modifie')) message(zoneMsg, 'Paramètres enregistrés.', 'ok');
  if (p.get('nouveau') || p.get('inscrit') || p.get('modifie')) history.replaceState(null, '', `tournoi.html?id=${encodeURIComponent(id)}`);
  await charger();
}

async function charger() {
  if (!id) {
    zone.innerHTML = '<p class="vide">Aucun tournoi indiqué. <a href="tournois.html">Voir mes tournois</a></p>';
    return;
  }
  const [rt, ri] = await Promise.all([
    supabase.from('tournaments').select('*, organisateur:profiles!tournaments_created_by_fkey(id, first_name, last_name, nickname, use_nickname)').eq('id', id).maybeSingle(),
    supabase.from('tournament_entries').select(COLONNES_INSCRIT).eq('tournament_id', id).order('created_at'),
  ]);
  if (rt.error || !rt.data) {
    zone.innerHTML = `<div class="vide">Ce tournoi n'existe pas, ou vous n'y êtes pas inscrit.
      <div class="actions" style="justify-content:center;margin-top:10px"><a class="bouton bouton--plein" href="tournois.html">Rejoindre un tournoi avec son code</a></div></div>`;
    return;
  }
  t = rt.data;
  inscrits = ri.data || [];
  document.title = `${t.name} – Dolina Darts Club`;
  afficher();
}

const estOrganisateur = () => t && (t.created_by === moi.id || moi.role === 'admin');
const avantLancement = () => t.status === 'draft' || t.status === 'open';

// ---------- Affichage ----------

function afficher() {
  const orga = estOrganisateur();
  const monInscription = inscrits.find((e) => estMoi(e, moi.id));
  const nb = inscrits.length;
  const lien = `${BASE_URL}tournois.html?code=${t.code}`;

  const onglets = [
    ['participants', `Participants <span class="t-compte">${nb}</span>`],
    [t.format === 'pools' ? 'poules' : 'arbre', t.format === 'pools' ? 'Poules' : 'Arbre'],
    ...(t.format === 'pools' ? [['arbre', 'Phase finale']] : []),
    ['matchs', 'Matchs'],
    ['infos', 'Infos'],
  ];

  zone.innerHTML = `
    <section class="t-entete">
      <div class="t-entete__haut">${badgeStatut(t.status)}${orga ? '<span class="t-role">Organisateur</span>' : ''}${monInscription ? '<span class="t-role t-role--joueur">Inscrit</span>' : ''}</div>
      <h1 class="t-titre">${esc(t.name)}</h1>
      <p class="t-sous">${esc(resumeFormat(t))} · organisé par ${esc(t.organisateur ? nomAffiche(t.organisateur) : '—')}</p>
      ${t.description ? `<p class="t-description">${esc(t.description)}</p>` : ''}
      <div class="t-jauge" role="img" aria-label="${nb} inscrits sur ${t.max_participants}">
        <span style="width:${Math.min(100, Math.round((nb / t.max_participants) * 100))}%"></span>
      </div>
      <p class="t-places">${nb} / ${t.max_participants} inscrits · ${esc(STATUTS[t.status].aide)}</p>
    </section>

    <section class="t-code" aria-label="Code du tournoi">
      <div>
        <span class="t-code__titre">Code du tournoi</span>
        <span class="t-code__valeur" id="valeur-code">${esc(t.code)}</span>
      </div>
      <div class="t-code__actions">
        <button type="button" class="bouton bouton--petit" id="btn-copier">Copier le code</button>
        <button type="button" class="bouton bouton--petit bouton--plein" id="btn-partager">Partager</button>
      </div>
      <p class="t-code__aide" id="aide-code">${t.status === 'open'
        ? 'Les membres saisissent ce code dans Tournois › Rejoindre un tournoi.'
        : (avantLancement() ? 'Inscriptions fermées : ouvrez-les pour que le code fonctionne.' : 'Les inscriptions sont terminées.')}</p>
    </section>

    ${orga ? panneauOrganisateur() : ''}

    <nav class="t-onglets" role="tablist" aria-label="Sections du tournoi">
      ${onglets.map(([cle, lib]) => `<button type="button" role="tab" aria-selected="${cle === onglet}" data-onglet="${cle}">${lib}</button>`).join('')}
    </nav>
    <section class="t-panneau" role="tabpanel">${contenuOnglet(onglet, orga, monInscription)}</section>`;

  brancher(lien);
}

function panneauOrganisateur() {
  const nb = inscrits.length;
  if (!avantLancement()) return '';
  const ouvert = t.status === 'open';
  return `
    <section class="t-gestion" aria-label="Gestion du tournoi">
      <h2 class="t-gestion__titre">Gestion du tournoi</h2>
      <div class="t-gestion__ligne">
        <span><strong>Inscriptions ${ouvert ? 'ouvertes' : 'fermées'}</strong><small>${ouvert ? 'Le code permet de rejoindre le tournoi.' : 'Le code est refusé tant que les inscriptions sont fermées.'}</small></span>
        <button type="button" class="bouton bouton--petit${ouvert ? '' : ' bouton--plein'}" data-action="basculer">${ouvert ? 'Fermer les inscriptions' : 'Ouvrir les inscriptions'}</button>
      </div>
      <div class="actions">
        <button type="button" class="bouton bouton--petit" data-action="ajouter"${nb >= t.max_participants ? ' disabled title="Tournoi complet"' : ''}>+ Ajouter un participant</button>
        <a class="bouton bouton--petit" href="tournoi-creer.html?id=${encodeURIComponent(t.id)}">Modifier les paramètres</a>
        <button type="button" class="bouton bouton--petit" disabled title="Étape suivante">Lancer le tournoi <small>(bientôt)</small></button>
        <button type="button" class="bouton bouton--petit bouton--danger" data-action="supprimer">Supprimer le tournoi</button>
      </div>
    </section>`;
}

function contenuOnglet(cle, orga, monInscription) {
  if (cle === 'participants') {
    if (!inscrits.length) {
      return `<p class="vide">Aucun inscrit pour l'instant.${orga ? ' Partagez le code ou ajoutez des participants.' : ''}</p>`;
    }
    const lignes = inscrits.map((e, i) => {
      const n = nomInscrit(e);
      const moiIci = estMoi(e, moi.id);
      const peutRetirer = avantLancement() && (orga || e.profile_id === moi.id);
      return `
        <li class="t-inscrit${moiIci ? ' t-inscrit--moi' : ''}">
          <span class="t-inscrit__num">${i + 1}</span>
          <span class="t-inscrit__nom"><strong>${esc(n.nom)}</strong>${n.detail ? `<small>${esc(n.detail)}</small>` : ''}</span>
          ${moiIci ? '<span class="t-moi">Vous</span>' : ''}
          ${peutRetirer ? `<button type="button" class="bouton bouton--icone bouton--danger" data-retirer="${e.id}" aria-label="${e.profile_id === moi.id && !orga ? 'Me désinscrire' : `Retirer ${esc(n.nom)}`}" title="${e.profile_id === moi.id ? 'Me désinscrire' : 'Retirer'}">✕</button>` : ''}
        </li>`;
    }).join('');
    const quitter = monInscription && monInscription.profile_id === moi.id && avantLancement()
      ? `<button type="button" class="bouton bouton--petit bouton--danger" data-retirer="${monInscription.id}" data-moi="1">Me désinscrire</button>` : '';
    return `<ol class="t-inscrits">${lignes}</ol>${quitter ? `<div class="actions">${quitter}</div>` : ''}`;
  }
  if (cle === 'poules' || cle === 'arbre' || cle === 'matchs') {
    const quoi = { poules: 'Les poules et leurs classements', arbre: 'L\'arbre du tournoi', matchs: 'La liste des matchs' }[cle];
    return `<p class="vide">${quoi} apparaîtront au lancement du tournoi, une fois les inscriptions terminées.</p>`;
  }
  // Infos
  const lignes = [
    ['Participants', `${t.team_mode === 'double' ? 'Double (2v2)' : 'Individuel'} · ${t.max_participants} places maximum`],
    ['Format', t.format === 'pools' ? 'Poules puis élimination directe' : 'Élimination directe'],
  ];
  if (t.format === 'pools') {
    lignes.push(['Poules', `${t.pools_count ? `${t.pools_count} poules` : 'Nombre proposé au lancement'} · ${t.pool_qualifiers} qualifié${t.pool_qualifiers > 1 ? 's' : ''} par poule`]);
    lignes.push(['Classement des poules', '3 points par victoire, 1 point par défaite. Égalité : le plus de manches gagnées, puis le vainqueur du match entre les joueurs à égalité.']);
  }
  lignes.push(['Match pour la 3e place', t.third_place ? 'Oui' : 'Non']);
  lignes.push(['Matchs', t.public_matches ? 'Publics (visibles dans « Matchs en cours »)' : 'Privés']);
  lignes.push(['Format des matchs', 'Choisi par l\'organisateur au lancement de chaque phase']);
  lignes.push(['Créé le', esc(dateFr(t.created_at))]);
  return `<dl class="t-recap">${lignes.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

// ---------- Actions ----------

function brancher(lien) {
  zone.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => {
    onglet = b.dataset.onglet;
    afficher();
  }));

  document.getElementById('btn-copier').addEventListener('click', async (e) => {
    const ok = await copier(t.code);
    e.target.textContent = ok ? 'Code copié ✓' : 'Copie impossible';
    setTimeout(() => { e.target.textContent = 'Copier le code'; }, 2000);
  });
  document.getElementById('btn-partager').addEventListener('click', async (e) => {
    const texte = `Rejoins le tournoi « ${t.name} » du Dolina Darts Club avec le code ${t.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: t.name, text: texte, url: lien }); } catch { /* partage annulé */ }
      return;
    }
    const ok = await copier(`${texte} : ${lien}`);
    e.target.textContent = ok ? 'Lien copié ✓' : 'Copie impossible';
    setTimeout(() => { e.target.textContent = 'Partager'; }, 2000);
  });

  zone.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => retirer(b.dataset.retirer, !!b.dataset.moi || inscrits.find((x) => x.id === b.dataset.retirer)?.profile_id === moi.id)));
  zone.querySelector('[data-action="basculer"]')?.addEventListener('click', basculer);
  zone.querySelector('[data-action="supprimer"]')?.addEventListener('click', supprimer);
  zone.querySelector('[data-action="ajouter"]')?.addEventListener('click', ouvrirAjout);
}

async function copier(texte) {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    const zoneTexte = document.createElement('textarea');
    zoneTexte.value = texte;
    document.body.appendChild(zoneTexte);
    zoneTexte.select();
    const ok = document.execCommand('copy');
    zoneTexte.remove();
    return ok;
  }
}

async function action(fn) {
  if (enCours) return;
  enCours = true;
  try { await fn(); } finally { enCours = false; }
}

function basculer() {
  action(async () => {
    const statut = t.status === 'open' ? 'draft' : 'open';
    const { error } = await supabase.from('tournaments').update({ status: statut }).eq('id', t.id).select('id').single();
    if (error) return message(zoneMsg, erreurFr(error));
    message(zoneMsg, statut === 'open' ? 'Inscriptions ouvertes : le code fonctionne.' : 'Inscriptions fermées.', 'ok');
    await charger();
  });
}

function supprimer() {
  if (!confirm(`Supprimer définitivement le tournoi « ${t.name} » et toutes ses inscriptions ?`)) return;
  action(async () => {
    const { data, error } = await supabase.from('tournaments').delete().eq('id', t.id).select('id');
    if (error || !data?.length) return message(zoneMsg, error ? erreurFr(error) : 'Le tournoi n\'a pas pu être supprimé.');
    location.href = 'tournois.html';
  });
}

function retirer(idInscrit, soiMeme) {
  const e = inscrits.find((x) => x.id === idInscrit);
  if (!e) return;
  const texte = soiMeme ? 'Vous désinscrire de ce tournoi ?' : `Retirer ${nomInscrit(e).nom} du tournoi ?`;
  if (!confirm(texte)) return;
  action(async () => {
    const { data, error } = await supabase.from('tournament_entries').delete().eq('id', idInscrit).select('id');
    if (error || !data?.length) return message(zoneMsg, error ? erreurFr(error) : 'Ce participant n\'a pas pu être retiré.');
    if (soiMeme && !estOrganisateur()) {
      location.href = 'tournois.html';
      return;
    }
    message(zoneMsg, soiMeme ? 'Vous êtes désinscrit.' : 'Participant retiré.', 'ok');
    await charger();
  });
}

// ---------- Ajout manuel (organisateur) ----------

const choixAjout = { 1: null, 2: null };    // membre choisi pour joueur 1 / joueur 2

function ouvrirAjout() {
  const double = t.team_mode === 'double';
  fenAjout.querySelectorAll('[data-double]').forEach((el) => { el.hidden = !double; });
  fenAjout.querySelectorAll('[data-simple]').forEach((el) => { el.hidden = double; });
  document.getElementById('form-ajout').reset();
  document.getElementById('erreur-ajout').textContent = '';
  choixAjout[1] = null;
  choixAjout[2] = null;
  zoneJoueur(1);
  if (double) zoneJoueur(2);
  fenAjout.hidden = false;
}

function dejaInscrits() {
  return new Set(inscrits.flatMap((e) => [e.profile_id, e.partner_profile_id]).filter(Boolean));
}

function zoneJoueur(n) {
  const z = fenAjout.querySelector(`[data-zone="${n}"]`);
  const m = choixAjout[n];
  z.innerHTML = m
    ? `<span class="puce">${esc(nomAffiche(m))} <button type="button" class="puce__retirer" data-vider="${n}" aria-label="Retirer">✕</button></span>`
    : `<button type="button" class="bouton bouton--petit" data-choisir="${n}">Choisir un membre</button>
       <span class="t-ou">ou</span>
       <input type="text" data-invite="${n}" maxlength="40" placeholder="Nom d'un invité (sans compte)" aria-label="Nom de l'invité">`;
  z.querySelector('[data-choisir]')?.addEventListener('click', async () => {
    const exclure = dejaInscrits();
    const autre = choixAjout[n === 1 ? 2 : 1];
    if (autre) exclure.add(autre.id);
    const choisi = await choisirMembre({ titre: 'Ajouter un membre', exclure });
    if (choisi) { choixAjout[n] = choisi; zoneJoueur(n); }
  });
  z.querySelector('[data-vider]')?.addEventListener('click', () => { choixAjout[n] = null; zoneJoueur(n); });
}

fenAjout.addEventListener('click', (e) => {
  if (e.target === fenAjout || e.target.closest('[data-fermer]')) fenAjout.hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fenAjout.hidden = true; });

document.getElementById('form-ajout').addEventListener('submit', (e) => {
  e.preventDefault();
  const erreur = document.getElementById('erreur-ajout');
  const double = t.team_mode === 'double';
  const invite = (n) => fenAjout.querySelector(`[data-invite="${n}"]`)?.value.trim() || null;
  const ligne = {
    tournament_id: t.id,
    profile_id: choixAjout[1]?.id || null,
    guest_name: choixAjout[1] ? null : invite(1),
  };
  if (!ligne.profile_id && !ligne.guest_name) { erreur.textContent = 'Choisissez un membre ou saisissez le nom d\'un invité.'; return; }
  if (double) {
    ligne.team_name = e.target.elements.team_name.value.trim();
    ligne.partner_profile_id = choixAjout[2]?.id || null;
    ligne.partner_guest_name = choixAjout[2] ? null : invite(2);
    if (!ligne.team_name) { erreur.textContent = 'Donnez un nom à la doublette.'; return; }
    if (!ligne.partner_profile_id && !ligne.partner_guest_name) { erreur.textContent = 'Indiquez le joueur 2 (membre ou invité).'; return; }
  }
  const bouton = e.target.querySelector('[type=submit]');
  action(async () => {
    bouton.disabled = true;
    const { error } = await supabase.from('tournament_entries').insert(ligne).select('id').single();
    bouton.disabled = false;
    if (error) { erreur.textContent = erreurFr(error); return; }
    fenAjout.hidden = true;
    message(zoneMsg, 'Participant ajouté.', 'ok');
    onglet = 'participants';
    await charger();
  });
});

init();
