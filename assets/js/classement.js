// =====================================================================
//  Classement du club : joueurs (individuel) et doublettes (2v2)
//  Calcul par la base (classement_membres / classement_doublettes).
//  Ordre officiel : matchs gagnés, manches gagnées, réussite au double, moyenne.
// =====================================================================

import { supabase, esc, profilConnecte, message, erreurFr } from './app.js?v=__VERSION__';

const zone = document.getElementById('classement');
const zoneMsg = document.getElementById('message');
const filtres = { periode: 'saison', jeu: '', equipe: '' };
let vue = 'joueurs';
let moi = null;
let donnees = null;
let tri = { cle: 'rang', sens: 1 };

const virgule = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(d).replace('.', ','));

function debutSaison(d = new Date()) {
  const annee = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(annee, 8, 1);
}
function bornes() {
  const m = new Date();
  if (filtres.periode === 'mois') return new Date(m.getFullYear(), m.getMonth(), 1);
  if (filtres.periode === 'saison') return debutSaison(m);
  return null;
}

async function init() {
  moi = await profilConnecte();
  const acces = document.getElementById('acces');
  if (!moi || moi.status !== 'active') {
    acces.hidden = false;
    acces.innerHTML = moi
      ? '<p class="vide">Votre compte doit être validé par un admin du club pour voir le classement.</p>'
      : '<p class="vide">Le classement est réservé aux membres du club. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  const s = debutSaison();
  document.getElementById('btn-saison').textContent = `Saison ${s.getFullYear()}-${s.getFullYear() + 1}`;
  const { data: equipes } = await supabase.from('teams').select('id, name').order('sort_order');
  document.getElementById('filtre-equipe').insertAdjacentHTML('beforeend',
    (equipes || []).map((t) => `<button type="button" data-valeur="${t.id}">${esc(t.name)}</button>`).join(''));
  document.getElementById('contenu').hidden = false;
  if (location.hash === '#doublettes') choisirVue('doublettes'); else charger();
}

async function charger() {
  zone.innerHTML = '<p class="vide">Calcul du classement…</p>';
  const debut = bornes();
  const params = { p_debut: debut ? debut.toISOString() : null, p_fin: null, p_variant: filtres.jeu || null };
  const { data, error } = vue === 'joueurs'
    ? await supabase.rpc('classement_membres', { ...params, p_equipe: filtres.equipe || null })
    : await supabase.rpc('classement_doublettes', params);
  if (error) {
    zone.innerHTML = `<p class="vide">${esc(error.code === 'P0001' ? error.message : 'Classement indisponible pour le moment (script SQL 021 à exécuter dans Supabase ?).')}</p>`;
    return;
  }
  const liste = (vue === 'joueurs' ? data.joueurs : data.doublettes).map((l) => ({
    ...l,
    nom: l.nom || l.noms,
    moyenne: l.flechettes ? (l.points / l.flechettes) * 3 : null,
    neuf: l.flechettes_9 ? (l.points_9 / l.flechettes_9) * 3 : null,
    double: l.flechettes_double ? (l.finishs / l.flechettes_double) * 100 : null,
    pct: l.matchs ? (l.victoires / l.matchs) * 100 : null,
    classe: l.classe ?? (l.manches_jouees >= data.seuil),
  }));
  // Ordre officiel : matchs gagnés, manches gagnées, réussite au double, moyenne
  const officiel = (a, b) => b.victoires - a.victoires || b.manches_gagnees - a.manches_gagnees
    || (b.double ?? -1) - (a.double ?? -1) || (b.moyenne ?? -1) - (a.moyenne ?? -1);
  const classes = liste.filter((l) => l.classe).sort(officiel);
  classes.forEach((l, i) => { l.rang = i + 1; });
  donnees = { seuil: data.seuil, classes, autres: liste.filter((l) => !l.classe).sort(officiel) };
  afficher();
}

const COLONNES = {
  joueurs: [
    ['rang', '#', (l) => l.rang ?? 999, 'Rang'],
    ['nom', 'Joueur', (l) => l.nom],
    ['equipes', 'Équipe', (l) => l.equipes || ''],
    ['matchs', 'MJ', (l) => l.matchs, 'Matchs joués'],
    ['victoires', 'V', (l) => l.victoires, 'Matchs gagnés'],
    ['pct', '% V', (l) => l.pct ?? -1, 'Pourcentage de victoires'],
    ['manches', 'Manches', (l) => l.manches_gagnees, 'Manches gagnées – perdues'],
    ['double', 'Double', (l) => l.double ?? -1, 'Réussite au double'],
    ['moyenne', 'Moy.', (l) => l.moyenne ?? -1, 'Moyenne 3 fléchettes'],
    ['neuf', '9 prem.', (l) => l.neuf ?? -1, 'Moyenne des 9 premières fléchettes'],
    ['nb_180', '180', (l) => l.nb_180, 'Nombre de 180'],
    ['meilleur_finish', 'Finish', (l) => l.meilleur_finish ?? -1, 'Meilleur finish'],
  ],
};
COLONNES.doublettes = COLONNES.joueurs.filter(([c]) => !['equipes', 'neuf'].includes(c)).map((c) => (c[0] === 'nom' ? ['nom', 'Doublette', c[2]] : c));

function trier(liste) {
  const col = COLONNES[vue].find((c) => c[0] === tri.cle) || COLONNES[vue][0];
  return [...liste].sort((a, b) => {
    const va = col[2](a); const vb = col[2](b);
    if (typeof va === 'string') return va.localeCompare(vb, 'fr') * tri.sens;
    return (va - vb) * tri.sens || (a.rang ?? 999) - (b.rang ?? 999);
  });
}

function ligne(l) {
  const mien = moi && (l.profile_id === moi.id || (l.cle || '').split('|').includes(moi.id));
  const cellules = {
    rang: `<td class="cl-rang">${l.rang ?? '–'}</td>`,
    nom: `<th scope="row" class="ts-nom">${l.profile_id ? `<a href="profil.html?id=${encodeURIComponent(l.profile_id)}">${esc(l.nom)}</a>` : `<a href="face-a-face.html?mode=doublettes&a=${encodeURIComponent(l.cle)}" title="Face-à-face de cette doublette">${esc(l.nom)}</a>`}${mien ? ' <span class="t-moi">Vous</span>' : ''}</th>`,
    equipes: `<td class="cl-equipe">${esc(l.equipes || '')}</td>`,
    matchs: `<td>${l.matchs}</td>`,
    victoires: `<td class="s-gagne ts-fort">${l.victoires}</td>`,
    pct: `<td>${l.pct === null ? '–' : `${virgule(l.pct, 0)} %`}</td>`,
    manches: `<td><span class="s-gagne">${l.manches_gagnees}</span>-<span class="s-perdu">${l.manches_perdues}</span></td>`,
    double: `<td>${l.double === null ? '–' : `${virgule(l.double)} %`}</td>`,
    moyenne: `<td class="ts-fort">${virgule(l.moyenne)}</td>`,
    neuf: `<td>${virgule(l.neuf)}</td>`,
    nb_180: `<td>${l.nb_180}</td>`,
    meilleur_finish: `<td>${l.meilleur_finish ?? '–'}</td>`,
  };
  return `<tr class="${mien ? 'p-moi' : ''}${l.rang && l.rang <= 3 ? ` cl-podium cl-podium--${l.rang}` : ''}">${COLONNES[vue].map(([c]) => cellules[c]).join('')}</tr>`;
}

function tableau(liste) {
  const entete = COLONNES[vue].map(([cle, lib, , titre]) => {
    const actif = cle === tri.cle;
    return `<th scope="col"${cle === 'nom' ? ' class="ts-nom"' : ''} aria-sort="${actif ? (tri.sens < 0 ? 'descending' : 'ascending') : 'none'}"><button type="button" data-tri="${cle}"${titre ? ` title="${titre}"` : ''}>${lib}${actif && cle !== 'rang' ? (tri.sens < 0 ? ' ▾' : ' ▴') : ''}</button></th>`;
  }).join('');
  return `
    <div class="p-tableau-cadre ts-cadre">
      <table class="p-tableau ts-tableau cl-tableau">
        <thead><tr>${entete}</tr></thead>
        <tbody>${trier(liste).map(ligne).join('')}</tbody>
      </table>
    </div>`;
}

function afficher() {
  const { seuil, classes, autres } = donnees;
  const nom = vue === 'joueurs' ? 'joueur' : 'doublette';
  zone.innerHTML = `
    <p class="t-legende">Ordre du classement : matchs gagnés, puis manches gagnées, puis réussite au double, puis moyenne. Touchez un titre de colonne pour trier autrement.
      Pour être classé : au moins <strong>${seuil} manche${seuil > 1 ? 's' : ''}</strong> jouée${seuil > 1 ? 's' : ''} sur la période${moi.role === 'admin' ? ' <button type="button" class="a-tour__modifier" id="btn-seuil">Modifier le seuil</button>' : ''}.</p>
    ${classes.length ? tableau(classes) : `<p class="vide">Aucun${vue === 'joueurs' ? '' : 'e'} ${nom} classé${vue === 'joueurs' ? '' : 'e'} sur cette période.</p>`}
    ${autres.length ? `
      <section class="section cl-autres">
        <h2 class="section__titre">Pas encore classé${vue === 'joueurs' ? 's' : 'es'} <small class="t-petit">(moins de ${seuil} manches jouées)</small></h2>
        ${tableau(autres)}
      </section>` : ''}
    <p class="t-legende">Comptent : les parties terminées en 301 et 501 (matchs de tournoi et parties contre un invité compris)${vue === 'joueurs' ? ', en individuel. Les parties à deux contre deux sont dans l\'onglet Doublettes' : ', à deux contre deux, pour chaque paire de joueurs'}.</p>`;
  zone.querySelectorAll('[data-tri]').forEach((b) => b.addEventListener('click', () => {
    const cle = b.dataset.tri;
    tri = tri.cle === cle ? { cle, sens: -tri.sens } : { cle, sens: ['nom', 'equipes', 'rang'].includes(cle) ? 1 : -1 };
    afficher();
  }));
  document.getElementById('btn-seuil')?.addEventListener('click', modifierSeuil);
}

async function modifierSeuil() {
  const valeur = prompt('Nombre minimum de manches jouées sur la période pour apparaître au classement :', String(donnees.seuil));
  if (valeur === null) return;
  const n = Number(valeur);
  if (!Number.isInteger(n) || n < 0 || n > 200) return message(zoneMsg, 'Indiquez un nombre entier entre 0 et 200.');
  const { error } = await supabase.from('settings').update({ value: n }).eq('key', 'ranking_min_legs');
  if (error) return message(zoneMsg, erreurFr(error));
  message(zoneMsg, `Seuil enregistré : ${n} manche${n > 1 ? 's' : ''}.`, 'ok');
  charger();
}

function choisirVue(v) {
  vue = v;
  tri = { cle: 'rang', sens: 1 };
  document.querySelectorAll('[data-vue]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vue === v)));
  document.getElementById('filtre-equipe').hidden = v !== 'joueurs';
  history.replaceState(null, '', v === 'doublettes' ? '#doublettes' : location.pathname);
  charger();
}

document.querySelectorAll('[data-vue]').forEach((b) => b.addEventListener('click', () => choisirVue(b.dataset.vue)));
document.querySelectorAll('[data-filtre]').forEach((groupe) => {
  groupe.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    groupe.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    filtres[groupe.dataset.filtre] = b.dataset.valeur;
    charger();
  });
});

init();
