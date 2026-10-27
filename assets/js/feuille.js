// =====================================================================
//  Feuille de match CPARD (championnat par équipes FFD, script 056)
//  feuille.html                 : les rencontres de mes équipes
//  feuille.html?rencontre=<id>  : ouvrir la feuille d'une rencontre
//  feuille.html?id=<id>         : la feuille (capitaine, joueurs, membres)
//  feuille.html?code=<code>     : lien du capitaine adverse (sans compte)
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, estCapitaineDe, BASE_URL, dateFr } from './app.js?v=__VERSION__';

// Ordre officiel des 20 matchs (feuille FFD) : poste A, poste E, camp qui commence (⊙)
export const ORDRE = [
  [1, 'A', 'F', 'A'], [2, 'B', 'E', 'E'], [3, 'C', 'H', 'A'], [4, 'D', 'G', 'E'],
  [5, 'A', 'E', 'E'], [6, 'B', 'F', 'A'], [7, 'C', 'G', 'E'], [8, 'D', 'H', 'A'],
  [9, 'A1', 'E1', 'A'], [10, 'A2', 'E2', 'A'],
  [11, 'A', 'G', 'A'], [12, 'C', 'E', 'A'], [13, 'B', 'H', 'E'], [14, 'D', 'F', 'E'],
  [15, 'A', 'H', 'E'], [16, 'D', 'E', 'A'], [17, 'B', 'G', 'A'], [18, 'C', 'F', 'E'],
  [19, 'A1', 'E2', 'E'], [20, 'A2', 'E1', 'E'],
].map(([n, a, e, premier]) => ({ n, a, e, premier }));
// Matchs joués en même temps (chaque joueur n'y apparaît qu'une fois)
const VAGUES = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10], [11, 12, 13, 14], [15, 16, 17, 18], [19, 20]];
const POSTES = { A: ['A', 'B', 'C', 'D'], E: ['E', 'F', 'G', 'H'] };
const REMPL = { A: 'Y', E: 'Z' };
const PAIRES = { A: ['A1', 'A2'], E: ['E1', 'E2'] };
const EMAIL_CPARD = 'dscpard@gmail.com';

const params = new URLSearchParams(location.search);
const zone = document.getElementById('feuille');
const zoneMsg = document.getElementById('message');
const fenScore = document.getElementById('fen-score');

let moi = null;
let d = null;              // détail de la feuille (feuille_detail)
let code = params.get('code');
let occupe = false;        // action en cours (anti double clic)
let sale = { A: false, E: false };   // composition modifiée, pas encore enregistrée
let minuteur = null;

// ---------- Outils ----------

const f = () => d.feuille;
const nomEquipe = (camp) => (camp === f().notre_camp ? d.equipe.name : d.rencontre.adversaire);
const peutGerer = () => d.role === 'gerer';
const peutJouer = () => ['gerer', 'joueur'].includes(d.role) && f().statut !== 'validee';
const commence = () => d.matchs.some((m) => m.statut !== 'a_jouer');
const lancee = () => !!f().lancee_le;
const visible = (camp) => f()[`voir_${camp.toLowerCase()}`] !== false;
const pret = (camp) => f()[`pret_${camp.toLowerCase()}`];
// Avant le lancement, chaque capitaine ne saisit (et ne voit) que son équipe (script 057)
function peutComposer(camp) {
  if (f().statut === 'validee') return false;
  if (peutGerer()) return camp === f().notre_camp || lancee();
  return d.role === 'adverse' && camp !== f().notre_camp && !lancee();
}
const compo = (camp) => (camp === 'A' ? f().compo_a : f().compo_e) || {};
const rempl = (camp) => (camp === 'A' ? f().rempl_a : f().rempl_e);
const nomPoste = (camp, poste) => compo(camp)[poste]?.n || '';
const noms = (liste) => (liste || []).map((j) => j?.n || '?').join(' / ');
function totaux() {
  const t = { pa: 0, pe: 0, ma: 0, me: 0, faits: 0 };
  d.matchs.forEach((m) => {
    if (m.statut !== 'termine') return;
    t.faits += 1;
    t.ma += m.manches_a; t.me += m.manches_e;
    if (m.manches_a > m.manches_e) t.pa += 1; else t.pe += 1;
  });
  return t;
}
// Cible de chaque match : les matchs d'une vague se répartissent sur les cibles disponibles
function cibleDe(n) {
  const v = VAGUES.find((x) => x.includes(n));
  const i = v.indexOf(n);
  return { cible: (i % f().cibles) + 1, tour: Math.floor(i / f().cibles) };
}
const fmtDate = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dateMatch = (x) => fmtDate.format(new Date(`${x}T12:00:00`));

async function appel(fn, args, ok) {
  if (occupe) return null;
  occupe = true;
  const { data, error } = await supabase.rpc(fn, args);
  occupe = false;
  if (error) { message(zoneMsg, error.code === 'P0001' ? error.message : erreurFr(error)); return null; }
  message(zoneMsg, ok || '', ok ? 'ok' : undefined);
  return data ?? true;
}

// ---------- Démarrage ----------

async function demarrer() {
  moi = await profilConnecte().catch(() => null);
  if (params.get('rencontre')) return ouvrirRencontre(params.get('rencontre'));
  if (params.get('nouvelle')) return nouvelleRencontre(params.get('nouvelle'));
  if (!params.get('id') && !code) return listeRencontres();
  await charger();
}

async function charger() {
  const { data, error } = await supabase.rpc('feuille_detail', code ? { p_code: code } : { p_feuille: params.get('id') });
  if (error) {
    zone.innerHTML = `<p class="vide">${esc(error.code === 'P0001' ? error.message : erreurFr(error))}</p>${moi ? '' : '<p class="match__format"><a href="connexion.html">Connectez-vous</a> pour voir les feuilles de match.</p>'}`;
    return;
  }
  d = data;
  afficher();
  clearInterval(minuteur);
  if (f().statut !== 'validee') minuteur = setInterval(actualiser, 8000);
}

// Suivi en direct des autres cibles, sans toucher aux compositions en cours de saisie
async function actualiser() {
  if (document.hidden || occupe || !fenScore.hidden) return;
  const { data } = await supabase.rpc('feuille_detail', code ? { p_code: code } : { p_feuille: f().id });
  if (!data || JSON.stringify(data) === JSON.stringify(d)) return;
  const cle = (x) => JSON.stringify([x.compo_a, x.compo_e, x.statut, x.rempl_a, x.rempl_e, x.lancee_le, x.pret_a, x.pret_e]);
  const compoChangee = cle(data.feuille) !== cle(d.feuille);
  const saisieEnCours = sale.A || sale.E || zone.querySelector('.fm-compo :focus, .fm-signature canvas.fm-signe');
  d = data;
  if (compoChangee && !saisieEnCours) afficher();
  else { afficherMatchs(); afficherBandeau(); }
}

// ---------- Liste des rencontres de mes équipes ----------

async function listeRencontres() {
  if (!moi || moi.status !== 'active') {
    zone.innerHTML = '<p class="vide">Les feuilles de match sont réservées aux membres du club. <a href="connexion.html">Connectez-vous</a>.</p>';
    return;
  }
  const [rt, rm] = await Promise.all([
    supabase.from('teams').select('*').order('sort_order'),
    supabase.from('team_members').select('team_id').eq('profile_id', moi.id).eq('status', 'accepted'),
  ]);
  const admin = moi.role === 'admin';
  const miennes = new Set((rm.data || []).map((x) => x.team_id));
  const equipes = (rt.data || []).filter((t) => admin || miennes.has(t.id) || estCapitaineDe(t, moi.id));
  if (!equipes.length) {
    zone.innerHTML = '<p class="vide">Vous n\'êtes dans aucune équipe : les feuilles de match concernent les joueurs des équipes du championnat.</p>';
    return;
  }
  // Saison en cours (depuis le 1er août) : feuilles déjà ouvertes + rencontres des 3 dernières semaines et à venir
  const auj = new Date();
  const debutSaison = `${auj.getMonth() >= 7 ? auj.getFullYear() : auj.getFullYear() - 1}-08-01`;
  const depuis = new Date(Date.now() - 21 * 86400000).toLocaleDateString('fr-CA');
  const { data: toutes } = await supabase.from('rencontres').select('*').in('team_id', equipes.map((t) => t.id))
    .gte('date_match', debutSaison).order('date_match').limit(500);
  const { data: feuilles } = toutes?.length
    ? await supabase.rpc('feuilles_rencontres', { p_rencontres: toutes.map((r) => r.id) })
    : { data: [] };
  const parRencontre = new Map((feuilles || []).map((x) => [x.rencontre_id, x]));
  const rencontres = (toutes || []).filter((r) => parRencontre.has(r.id) || (r.date_fin || r.date_match) >= depuis);
  const STATUT = { composition: 'Composition', en_cours: 'En cours', validee: 'Validée' };
  const court = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const ligne = (r, t) => {
    const fe = parRencontre.get(r.id);
    const gerer = admin || estCapitaineDe(t, moi.id);
    const action = fe ? `<a class="bouton bouton--petit${fe.statut === 'validee' ? '' : ' bouton--plein'}" href="feuille.html?id=${fe.feuille_id}">Ouvrir</a>`
      : (gerer ? `<a class="bouton bouton--petit" href="feuille.html?rencontre=${r.id}">Ouvrir la feuille</a>` : '<span class="match__format">Pas encore ouverte</span>');
    return `
      <article class="fm-ligne">
        <div><strong>${r.domicile ? 'Reçoit' : 'Chez'} ${esc(r.adversaire)}</strong>
        <small>${esc(court.format(new Date(`${r.date_match}T12:00:00`)))}${r.journee ? ` · ${esc(r.journee)}` : ''}${fe ? ` · <b class="fm-statut fm-statut--${fe.statut}">${STATUT[fe.statut]}</b>` : ''}${r.score_nous !== null ? ` · ${r.score_nous}-${r.score_eux}` : ''}</small></div>
        ${action}
      </article>`;
  };
  // Onglet ouvert : l'équipe demandée (#nom), sinon celle du joueur, sinon celle avec une feuille en cours
  const demandee = decodeURIComponent(location.hash.slice(1));
  const enCours = (feuilles || []).find((x) => x.statut !== 'validee');
  const active = (equipes.find((t) => t.name === demandee || t.id === demandee)
    || equipes.find((t) => estCapitaineDe(t, moi.id)) || equipes.find((t) => miennes.has(t.id))
    || equipes.find((t) => enCours && rencontres.some((r) => r.id === enCours.rencontre_id && r.team_id === t.id)) || equipes[0]).id;
  zone.innerHTML = `
    <section class="carte-info">
      <h2>Feuilles de match</h2>
      <p class="intro" style="margin:0">Le capitaine ouvre la feuille d'une rencontre, saisit son équipe et envoie un lien au capitaine adverse. Les 20 matchs sont créés dans l'ordre officiel FFD, puis joués au scorer ou saisis directement.</p>
    </section>
    <nav class="onglets eq-onglets fm-onglets" aria-label="Choisir une équipe">${equipes.map((t) => `<button type="button" class="onglet" data-onglet="${t.id}" aria-selected="${t.id === active}">${esc(t.name)}</button>`).join('')}</nav>
    ${equipes.map((t) => {
    const liste = rencontres.filter((r) => r.team_id === t.id);
    const nb = liste.filter((r) => parRencontre.has(r.id)).length;
    return `
    <section class="section fm-equipe" data-equipe="${t.id}"${t.id === active ? '' : ' hidden'}>
      <h2 class="section__titre">${esc(t.name)}${nb ? ` <span class="section__aide">${nb} feuille${nb > 1 ? 's' : ''}</span>` : ''}</h2>
      ${admin || estCapitaineDe(t, moi.id) ? `<a class="bouton bouton--plein fm-nouvelle" href="feuille.html?nouvelle=${t.id}">+ Nouvelle rencontre</a>` : ''}
      ${liste.length ? [[true, 'Domicile'], [false, 'Extérieur']].map(([dom, titre]) => {
    const groupe = liste.filter((r) => r.domicile === dom);
    return groupe.length ? `<p class="fm-ligne-groupe">${titre} · ${groupe.length}</p><div class="fm-liste">${groupe.map((r) => ligne(r, t)).join('')}</div>` : '';
  }).join('') : '<p class="vide">Aucune rencontre récente ou à venir : ajoutez-la dans le calendrier de l\'équipe (page Équipes).</p>'}
    </section>`;
  }).join('')}
    <p class="match__format"><a href="equipes.html">Calendrier des équipes →</a></p>`;
  zone.querySelectorAll('[data-onglet]').forEach((bt) => bt.addEventListener('click', () => {
    zone.querySelectorAll('[data-onglet]').forEach((x) => x.setAttribute('aria-selected', x === bt));
    zone.querySelectorAll('.fm-equipe').forEach((x) => { x.hidden = x.dataset.equipe !== bt.dataset.onglet; });
    history.replaceState(null, '', `#${encodeURIComponent(equipes.find((t) => t.id === bt.dataset.onglet).name)}`);
  }));
}

// ---------- Créer une rencontre (et sa feuille) directement d'ici ----------

const champsFeuille = (domicile) => `
      <p class="fm-info">${domicile ? 'Nous recevons : notre équipe est l\'<strong>équipe A</strong> (A, B, C, D), à gauche sur la feuille.' : 'Nous nous déplaçons : notre équipe est l\'<strong>équipe E</strong> (E, F, G, H), l\'équipe qui reçoit est A.'}</p>
      <label class="champ">Cibles disponibles
        <select name="cibles">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}"${n === 4 ? ' selected' : ''}>${n} cible${n > 1 ? 's' : ''}</option>`).join('')}</select>
        <small>Les matchs sont répartis sur les cibles, sans qu'un joueur ait deux matchs en même temps. Modifiable ensuite.</small>
      </label>`;

async function nouvelleRencontre(teamId) {
  const [rt, rs, rr] = await Promise.all([
    supabase.from('teams').select('*').eq('id', teamId).maybeSingle(),
    supabase.from('salles').select('*').order('nom'),
    supabase.from('rencontres').select('adversaire, domicile, salle_id, division, poule, journee, date_match').eq('team_id', teamId).order('date_match', { ascending: false }).limit(60),
  ]);
  const t = rt.data;
  if (!t || !moi || !(moi.role === 'admin' || estCapitaineDe(t, moi.id))) {
    zone.innerHTML = '<p class="vide">Seuls le capitaine, le vice-capitaine de l\'équipe et les admins peuvent créer une rencontre.</p>';
    return;
  }
  const passees = rr.data || [];
  const derniere = passees[0] || {};
  // Salle habituelle à domicile : la plus utilisée pour les matchs à domicile
  const compte = {};
  passees.filter((r) => r.domicile && r.salle_id).forEach((r) => { compte[r.salle_id] = (compte[r.salle_id] || 0) + 1; });
  const salleDom = Object.entries(compte).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const adversaires = [...new Set(passees.map((r) => r.adversaire))].sort((a, b) => a.localeCompare(b, 'fr'));
  const auj = new Date().toLocaleDateString('fr-CA');
  zone.innerHTML = `
    <form class="carte-info fm-creer" id="form-nouvelle" novalidate>
      <h2>Nouvelle rencontre · ${esc(t.name)}</h2>
      <p class="intro" style="margin:0">La rencontre est ajoutée au calendrier de l'équipe et sa feuille de match est ouverte aussitôt.</p>
      <fieldset class="champ"><legend>Lieu</legend>
        <div class="fm-choix">
          <label><input type="radio" name="domicile" value="1" checked><span>Domicile<small>${esc(t.name)} reçoit</small></span></label>
          <label><input type="radio" name="domicile" value="0"><span>Extérieur<small>${esc(t.name)} se déplace</small></span></label>
        </div>
      </fieldset>
      <label class="champ">Adversaire<input type="text" name="adversaire" maxlength="80" required list="fm-adversaires" placeholder="ex. Darting Club"></label>
      <datalist id="fm-adversaires">${adversaires.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
      <div class="fm-deux">
        <label class="champ">Date<input type="date" name="date_match" value="${auj}" required></label>
        <label class="champ">Heure<input type="time" name="heure_match"></label>
      </div>
      <label class="champ">Salle
        <select name="salle_id"><option value="">— Non précisée —</option>${(rs.data || []).map((x) => `<option value="${x.id}"${x.id === salleDom ? ' selected' : ''}>${esc(x.nom)}</option>`).join('')}</select>
        <small>Une nouvelle salle s'ajoute depuis le calendrier de l'équipe (page Équipes).</small>
      </label>
      <div class="fm-trois">
        <label class="champ">Division<input type="text" name="division" maxlength="40" value="${esc(derniere.division || '')}"></label>
        <label class="champ">Poule<input type="text" name="poule" maxlength="40" value="${esc(derniere.poule || '')}"></label>
        <label class="champ">Journée<input type="text" name="journee" maxlength="20" placeholder="ex. J3"></label>
      </div>
      ${champsFeuille(true)}
      <p class="t-erreur" id="erreur-nouvelle" role="alert"></p>
      <div class="actions"><a class="bouton" href="feuille.html#${encodeURIComponent(t.name)}">Annuler</a><button type="submit" class="bouton bouton--plein">Créer la rencontre et sa feuille</button></div>
    </form>`;
  const form = document.getElementById('form-nouvelle');
  // Domicile / extérieur : salle habituelle et camp FFD suivent le choix
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'domicile') return;
    const dom = e.target.value === '1';
    form.salle_id.value = dom ? salleDom : '';
    form.querySelector('.fm-info').outerHTML = champsFeuille(dom).split('\n').find((l) => l.includes('fm-info'));
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('erreur-nouvelle');
    err.textContent = '';
    const adversaire = form.adversaire.value.trim();
    if (!adversaire) { err.textContent = 'Indiquez l\'adversaire.'; form.adversaire.focus(); return; }
    if (!form.date_match.value) { err.textContent = 'Indiquez la date.'; return; }
    if (occupe) return;
    occupe = true;
    const bouton = form.querySelector('button[type=submit]');
    bouton.disabled = true;
    const { data: r, error } = await supabase.from('rencontres').insert({
      team_id: t.id,
      date_match: form.date_match.value,
      heure_match: form.heure_match.value || null,
      domicile: form.domicile.value === '1',
      adversaire,
      salle_id: form.salle_id.value || null,
      division: form.division.value.trim() || null,
      poule: form.poule.value.trim() || null,
      journee: form.journee.value.trim() || null,
    }).select('id').single();
    occupe = false;
    if (error) { bouton.disabled = false; err.textContent = erreurFr(error); return; }
    const idf = await appel('creer_feuille', { p_rencontre: r.id, p_notre_camp: form.domicile.value === '1' ? 'A' : 'E', p_cibles: Number(form.cibles.value) });
    bouton.disabled = false;
    location.replace(idf ? `feuille.html?id=${idf}` : `feuille.html?rencontre=${r.id}`);
  });
}

// ---------- Ouvrir la feuille d'une rencontre ----------

async function ouvrirRencontre(idRencontre) {
  const { data: r } = await supabase.from('rencontres').select('*, teams(*)').eq('id', idRencontre).maybeSingle();
  if (!r) { zone.innerHTML = '<p class="vide">Rencontre introuvable.</p>'; return; }
  const { data: deja } = await supabase.rpc('feuilles_rencontres', { p_rencontres: [r.id] });
  if (deja?.length) { location.replace(`feuille.html?id=${deja[0].feuille_id}`); return; }
  zone.innerHTML = `
    <form class="carte-info fm-creer" id="form-creer">
      <h2>Ouvrir la feuille de match</h2>
      <p class="intro" style="margin:0"><strong>${esc(r.teams?.name || '')}</strong> ${r.domicile ? 'reçoit' : 'chez'} <strong>${esc(r.adversaire)}</strong><br>${esc(dateMatch(r.date_match))}${r.journee ? ` · ${esc(r.journee)}` : ''}</p>
      ${champsFeuille(r.domicile)}
      <div class="actions"><a class="bouton" href="feuille.html">Annuler</a><button type="submit" class="bouton bouton--plein">Ouvrir la feuille</button></div>
    </form>`;
  document.getElementById('form-creer').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const idf = await appel('creer_feuille', { p_rencontre: r.id, p_cibles: Number(fd.get('cibles')) });
    if (idf) location.replace(`feuille.html?id=${idf}`);
  });
}

// ---------- Feuille ----------

function afficher() {
  const r = d.rencontre;
  const meta = [r.division && `Division ${r.division}`, r.poule && `Poule ${r.poule}`, r.journee && `Journée ${String(r.journee).replace(/^J/i, '')}`].filter(Boolean).join(' · ');
  zone.innerHTML = `
    <section class="carte-info fm-tete">
      <p class="fm-tete__meta">${esc(meta || 'Championnat par équipes')}</p>
      <div class="fm-affiche">
        <div class="fm-affiche__eq"><span class="fm-lettre">A</span><strong>${esc(nomEquipe('A'))}</strong></div>
        <div class="fm-affiche__score" id="fm-score"></div>
        <div class="fm-affiche__eq"><span class="fm-lettre">E</span><strong>${esc(nomEquipe('E'))}</strong></div>
      </div>
      <p class="match__format" style="margin:0;text-align:center">${esc(dateMatch(r.date_match))}${r.salle ? ` · ${esc(r.salle.nom)}` : ''}</p>
      <div id="fm-bandeau"></div>
    </section>

    ${peutGerer() && f().code ? blocLien() : ''}

    <details class="carte-info fm-section" id="fm-compos"${lancee() && commence() ? '' : ' open'}>
      <summary><h2>Compositions</h2></summary>
      <div class="fm-compos">${['A', 'E'].map((c) => blocCompo(c)).join('')}</div>
    </details>

    ${peutGerer() && f().statut !== 'validee' ? `
    <details class="carte-info fm-section">
      <summary><h2>${lancee() ? 'Cibles et remplacements' : 'Cibles'}</h2></summary>
      <label class="champ">Cibles disponibles
        <select id="fm-cibles">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}"${n === f().cibles ? ' selected' : ''}>${n} cible${n > 1 ? 's' : ''}</option>`).join('')}</select>
      </label>
      ${lancee() ? ['A', 'E'].map((c) => blocRemplacement(c)).join('') : '<p class="match__format" style="margin:0">Les remplacements se font une fois la rencontre lancée.</p>'}
    </details>` : ''}

    <section class="section">
      <h2 class="section__titre">Matchs <span class="section__aide">501 · meilleur des 3 manches · finish double · ⊙ commence</span></h2>
      <div id="fm-matchs"></div>
    </section>

    <section class="carte-info" id="fm-fin"></section>
    ${peutGerer() && f().statut !== 'validee' ? '<p class="match__format"><button type="button" class="lien-bouton" id="fm-supprimer">Supprimer cette feuille de match</button></p>' : ''}`;
  sale = { A: false, E: false };
  afficherMatchs();
  afficherBandeau();
  brancherCompos();
}

function afficherBandeau() {
  const t = totaux();
  document.getElementById('fm-score').innerHTML = `<b>${t.pa}</b><i>–</i><b>${t.pe}</b><small>${t.ma} – ${t.me} manches</small>`;
  const ban = document.getElementById('fm-bandeau');
  if (f().statut === 'validee') {
    ban.innerHTML = `<p class="message message--ok">Feuille validée le ${esc(dateFr(f().validee_le))}.</p>`;
  } else if (!lancee()) {
    // Avant le lancement : où en est chaque équipe, sans rien dévoiler de la composition adverse
    const etat = (c) => `<span class="fm-etat${pret(c) ? ' fm-etat--ok' : ''}"><b>${c}</b> ${esc(nomEquipe(c))} : ${pret(c) ? 'équipe envoyée ✓' : 'en attente'}</span>`;
    const lui = d.role === 'adverse' ? (f().notre_camp === 'A' ? 'E' : 'A') : f().notre_camp;
    ban.innerHTML = `
      <div class="fm-etats">${etat('A')}${etat('E')}</div>
      <p class="match__format" style="margin:0;text-align:center">Les compositions restent masquées l'une de l'autre jusqu'au lancement de la rencontre.</p>
      ${peutGerer() ? (pret('A') && pret('E')
    ? '<div class="actions" style="justify-content:center"><button type="button" class="bouton bouton--plein" id="fm-lancer">Lancer la rencontre</button></div>'
    : '<p class="fm-alerte">Le lancement sera possible quand les deux équipes seront complètes.</p>')
    : (pret(lui) ? '<p class="fm-alerte">Votre équipe est envoyée. Le capitaine qui reçoit lancera la rencontre.</p>' : '')}`;
  } else {
    ban.innerHTML = `<p class="match__format" style="text-align:center;margin:0">${t.faits} match${t.faits > 1 ? 's' : ''} joué${t.faits > 1 ? 's' : ''} sur 20</p>
      ${peutGerer() && !commence() ? '<p class="match__format" style="text-align:center;margin:0"><button type="button" class="lien-bouton" id="fm-annuler-lancement">Annuler le lancement</button></p>' : ''}`;
  }
  document.getElementById('fm-lancer')?.addEventListener('click', async () => {
    if (!confirm('Lancer la rencontre ? Les deux compositions deviennent visibles et les matchs peuvent commencer. Seul le capitaine qui reçoit pourra encore les corriger.')) return;
    if (await appel('lancer_rencontre', { p_feuille: f().id }, 'Rencontre lancée : bons matchs !')) await charger();
  });
  document.getElementById('fm-annuler-lancement')?.addEventListener('click', async () => {
    if (!confirm('Annuler le lancement ? Les compositions sont de nouveau masquées et modifiables par chaque capitaine.')) return;
    if (await appel('annuler_lancement_feuille', { p_feuille: f().id }, 'Lancement annulé.')) await charger();
  });
  afficherFin();
}

function blocLien() {
  const url = `${BASE_URL}feuille.html?code=${f().code}`;
  const texte = `Feuille de match ${nomEquipe('A')} – ${nomEquipe('E')} : saisissez la composition de votre équipe ici`;
  return `
    <details class="carte-info fm-section"${lancee() ? '' : ' open'}>
      <summary><h2>Lien pour le capitaine adverse</h2></summary>
      <p class="intro" style="margin:0">Il saisit sa composition sans créer de compte, puis suit les résultats.</p>
      <input type="text" readonly value="${esc(url)}" id="fm-lien" aria-label="Lien de la feuille">
      <div class="actions">
        ${navigator.share ? '<button type="button" class="bouton bouton--petit bouton--plein" id="fm-partager">Partager…</button>' : ''}
        <a class="bouton bouton--petit" href="https://wa.me/?text=${encodeURIComponent(`${texte} : ${url}`)}" target="_blank" rel="noopener">WhatsApp</a>
        <button type="button" class="bouton bouton--petit" id="fm-copier">Copier le lien</button>
      </div>
    </details>`;
}

// ----- Composition d'une équipe -----

function blocCompo(camp) {
  if (!visible(camp)) {
    return `
    <div class="fm-compo fm-compo--masquee">
      <h3><span class="fm-lettre">${camp}</span>${esc(nomEquipe(camp))}</h3>
      <p class="fm-masque">${pret(camp) ? '✓ Équipe envoyée' : 'En attente de la composition'}</p>
      <p class="match__format" style="margin:0">Visible au lancement de la rencontre.</p>
    </div>`;
  }
  const c = compo(camp);
  const edit = peutComposer(camp);
  const nous = camp === f().notre_camp;
  const effectif = d.effectif || [];
  const champJoueur = (poste) => {
    const j = c[poste];
    if (!edit) return `<span class="fm-nom">${esc(j?.n || '—')}</span>`;
    if (nous && peutGerer()) {
      const libre = j && !j.p;
      return `
        <select data-poste="${poste}" data-camp="${camp}" aria-label="Joueur ${poste}">
          <option value="">—</option>
          ${effectif.map((p) => `<option value="${p.id}"${j?.p === p.id ? ' selected' : ''}>${esc(p.nom)}</option>`).join('')}
          ${j?.p && !effectif.some((p) => p.id === j.p) ? `<option value="${esc(j.p)}" selected>${esc(j.n)}</option>` : ''}
          <option value="libre"${libre ? ' selected' : ''}>Autre joueur (nom libre)…</option>
        </select>
        <input type="text" maxlength="40" data-libre="${poste}" data-camp="${camp}" placeholder="Prénom Nom" value="${libre ? esc(j.n) : ''}"${libre ? '' : ' hidden'} aria-label="Nom du joueur ${poste}">`;
    }
    return `<input type="text" maxlength="40" data-libre="${poste}" data-camp="${camp}" placeholder="Prénom Nom" value="${esc(j?.n || '')}" aria-label="Joueur ${poste}">`;
  };
  const champPaire = (paire) => {
    const val = c[paire] || [];
    if (!edit) return `<span class="fm-nom">${esc(val.map((l) => `${nomPoste(camp, l) || l}`).join(' / ') || '—')}</span>`;
    return [0, 1].map((k) => `
      <select data-paire="${paire}" data-k="${k}" data-camp="${camp}" aria-label="Double ${paire}, joueur ${k + 1}">
        <option value="">—</option>
        ${POSTES[camp].map((l) => `<option value="${l}"${val[k] === l ? ' selected' : ''}>${l}${nomPoste(camp, l) ? ` · ${esc(nomPoste(camp, l))}` : ''}</option>`).join('')}
      </select>`).join('');
  };
  return `
    <form class="fm-compo" data-compo="${camp}" novalidate>
      <h3><span class="fm-lettre">${camp}</span>${esc(nomEquipe(camp))}${nous ? '' : ' <small>(adversaire)</small>'}</h3>
      <p class="fm-sous">Simples</p>
      ${POSTES[camp].map((p) => `<div class="fm-poste"><b>${p}</b>${champJoueur(p)}</div>`).join('')}
      <p class="fm-sous">Doubles</p>
      ${PAIRES[camp].map((p) => `<div class="fm-poste fm-poste--paire"><b>${p}</b><div class="fm-paire">${champPaire(p)}</div></div>`).join('')}
      <p class="fm-sous">Remplaçant</p>
      <div class="fm-poste"><b>${REMPL[camp]}</b>${champJoueur(REMPL[camp])}</div>
      ${edit ? `<div class="actions"><button type="submit" class="bouton bouton--plein bouton--petit">Enregistrer l'équipe ${camp}</button></div>` : ''}
    </form>`;
}

function lireCompo(camp) {
  const form = zone.querySelector(`[data-compo="${camp}"]`);
  const res = {};
  [...POSTES[camp], REMPL[camp]].forEach((p) => {
    const sel = form.querySelector(`select[data-poste="${p}"]`);
    const txt = form.querySelector(`input[data-libre="${p}"]`);
    if (sel && sel.value && sel.value !== 'libre') res[p] = { p: sel.value };
    else if (txt && txt.value.trim()) res[p] = { n: txt.value.trim() };
  });
  PAIRES[camp].forEach((p) => {
    const v = [0, 1].map((k) => form.querySelector(`select[data-paire="${p}"][data-k="${k}"]`)?.value).filter(Boolean);
    if (v.length) res[p] = v;
  });
  return res;
}

function brancherCompos() {
  zone.querySelectorAll('.fm-compo').forEach((form) => {
    const camp = form.dataset.compo;
    form.addEventListener('input', () => { sale[camp] = true; });
    form.addEventListener('change', (e) => {
      sale[camp] = true;
      const sel = e.target.closest('select[data-poste]');
      if (sel) {
        const txt = form.querySelector(`input[data-libre="${sel.dataset.poste}"]`);
        if (txt) { txt.hidden = sel.value !== 'libre'; if (!txt.hidden) txt.focus(); }
      }
      // Double A1 choisi : A2 prend les deux autres joueurs
      const paire = e.target.closest('select[data-paire]');
      if (paire && paire.dataset.paire === PAIRES[camp][0]) {
        const choisis = [0, 1].map((k) => form.querySelector(`select[data-paire="${PAIRES[camp][0]}"][data-k="${k}"]`).value).filter(Boolean);
        const autres = POSTES[camp].filter((l) => !choisis.includes(l));
        if (choisis.length === 2) [0, 1].forEach((k) => { form.querySelector(`select[data-paire="${PAIRES[camp][1]}"][data-k="${k}"]`).value = autres[k]; });
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = await appel('enregistrer_compo', { p_feuille: code ? null : f().id, p_camp: camp, p_compo: lireCompo(camp), p_code: code || null }, `Équipe ${camp} enregistrée.`);
      if (ok) { sale[camp] = false; await rechargerSansPerdre(camp); }
    });
  });
  document.getElementById('fm-cibles')?.addEventListener('change', async (e) => {
    if (await appel('definir_cibles_feuille', { p_feuille: f().id, p_cibles: Number(e.target.value) }, 'Répartition sur les cibles mise à jour.')) { f().cibles = Number(e.target.value); afficherMatchs(); }
  });
  zone.querySelectorAll('[data-rempl]').forEach((b) => b.addEventListener('click', () => enregistrerRemplacement(b.dataset.rempl, b.dataset.retirer === '1')));
  document.getElementById('fm-copier')?.addEventListener('click', async () => {
    const champ = document.getElementById('fm-lien');
    try { await navigator.clipboard.writeText(champ.value); } catch { champ.select(); document.execCommand('copy'); }
    message(zoneMsg, 'Lien copié.', 'ok');
  });
  document.getElementById('fm-partager')?.addEventListener('click', () => {
    navigator.share({ title: 'Feuille de match', text: `Feuille de match ${nomEquipe('A')} – ${nomEquipe('E')} : saisissez la composition de votre équipe`, url: document.getElementById('fm-lien').value }).catch(() => {});
  });
  document.getElementById('fm-supprimer')?.addEventListener('click', async () => {
    if (!confirm('Supprimer cette feuille de match ? Les compositions et les résultats saisis seront effacés. Les parties déjà jouées au scorer restent dans les statistiques.')) return;
    if (await appel('supprimer_feuille', { p_feuille: f().id })) location.replace('feuille.html');
  });
}

// Après l'enregistrement d'une équipe, l'autre garde ce qui est en cours de saisie
async function rechargerSansPerdre(camp) {
  const autre = camp === 'A' ? 'E' : 'A';
  const brouillon = sale[autre] ? lireCompo(autre) : null;
  const { data } = await supabase.rpc('feuille_detail', code ? { p_code: code } : { p_feuille: f().id });
  if (!data) return;
  d = data;
  const ouvert = document.getElementById('fm-compos')?.open;
  afficher();
  document.getElementById('fm-compos').open = ouvert !== false;
  if (brouillon) {
    // Remet les choix non enregistrés de l'autre équipe
    const form = zone.querySelector(`[data-compo="${autre}"]`);
    Object.entries(brouillon).forEach(([p, v]) => {
      if (Array.isArray(v)) v.forEach((l, k) => { const s = form.querySelector(`select[data-paire="${p}"][data-k="${k}"]`); if (s) s.value = l; });
      else {
        const s = form.querySelector(`select[data-poste="${p}"]`);
        const t = form.querySelector(`input[data-libre="${p}"]`);
        if (v.p && s) s.value = v.p;
        else if (t) { if (s) s.value = 'libre'; t.hidden = false; t.value = v.n; }
      }
    });
    sale[autre] = true;
  }
}

// ----- Remplacement (un par équipe) -----

function blocRemplacement(camp) {
  const r = rempl(camp);
  const nomR = nomPoste(camp, REMPL[camp]);
  return `
    <div class="fm-rempl">
      <h3>Équipe ${camp} · remplaçant ${REMPL[camp]}${nomR ? ` (${esc(nomR)})` : ''}</h3>
      ${!nomR ? `<p class="match__format" style="margin:0">Indiquez d'abord le remplaçant ${REMPL[camp]} dans la composition.</p>` : `
      <div class="fm-rempl__ligne">
        <label>remplace<select data-rempl-joueur="${camp}">${POSTES[camp].map((l) => `<option value="${l}"${r?.joueur === l ? ' selected' : ''}>${l}${nomPoste(camp, l) ? ` · ${esc(nomPoste(camp, l))}` : ''}</option>`).join('')}</select></label>
        <label>après le match<select data-rempl-apres="${camp}">${Array.from({ length: 20 }, (_, i) => i).map((n) => `<option value="${n}"${r?.apres === n ? ' selected' : ''}>${n ? `#${n}` : 'dès le début'}</option>`).join('')}</select></label>
      </div>
      <div class="actions">
        <button type="button" class="bouton bouton--petit bouton--plein" data-rempl="${camp}">${r ? 'Modifier' : 'Enregistrer'} le remplacement</button>
        ${r ? `<button type="button" class="bouton bouton--petit" data-rempl="${camp}" data-retirer="1">Annuler le remplacement</button>` : ''}
      </div>
      ${r ? `<p class="fm-info">${esc(nomR)} joue à la place de ${esc(nomPoste(camp, r.joueur) || r.joueur)} à partir du match #${r.apres + 1}, doubles compris.</p>` : ''}`}
    </div>`;
}

async function enregistrerRemplacement(camp, retirer) {
  const joueur = retirer ? null : zone.querySelector(`[data-rempl-joueur="${camp}"]`).value;
  const apres = retirer ? null : Number(zone.querySelector(`[data-rempl-apres="${camp}"]`).value);
  if (retirer && !confirm('Annuler ce remplacement ?')) return;
  if (await appel('definir_remplacement', { p_feuille: f().id, p_camp: camp, p_joueur: joueur, p_apres: apres },
    retirer ? 'Remplacement annulé.' : 'Remplacement enregistré : les matchs suivants passent au remplaçant.')) await rechargerSansPerdre(camp);
}

// ----- Matchs -----

function afficherMatchs() {
  const el = document.getElementById('fm-matchs');
  if (!el) return;
  const jouable = lancee() && !f().manque_a && !f().manque_e;
  el.innerHTML = VAGUES.map((v, i) => `
    <div class="fm-vague">
      <p class="fm-vague__titre">${v.length === 2 ? 'Doubles' : `Simples · série ${[1, 2, null, 3, 4][i]}`}</p>
      <div class="fm-grille">${v.map((n) => carteMatch(n, jouable)).join('')}</div>
    </div>`).join('');
}

function carteMatch(n, pret) {
  const o = ORDRE[n - 1];
  const m = d.matchs[n - 1];
  const fini = m.statut === 'termine';
  const { cible, tour } = cibleDe(n);
  const ligne = (camp) => {
    const gagne = fini && (camp === 'A' ? m.manches_a > m.manches_e : m.manches_e > m.manches_a);
    return `
      <div class="fm-camp${gagne ? ' fm-camp--gagne' : ''}">
        <span class="fm-premier" aria-label="${o.premier === camp ? 'commence' : ''}">${o.premier === camp ? '⊙' : ''}</span>
        <span class="fm-poste-l">${camp === 'A' ? o.a : o.e}</span>
        <span class="fm-joueur">${esc(noms(m.joueurs?.[camp.toLowerCase()]) || '—')}</span>
        <b class="fm-manches">${fini ? (camp === 'A' ? m.manches_a : m.manches_e) : ''}</b>
      </div>`;
  };
  let actions = '';
  if (m.statut === 'en_cours' && m.game_id) {
    actions = `<a class="bouton bouton--petit bouton--plein" href="scorer.html?id=${m.game_id}">Scorer</a><a class="bouton bouton--petit" href="live.html?id=${m.game_id}">Suivre</a>`;
  } else if (fini) {
    actions = `${m.game_id ? `<a class="bouton bouton--petit" href="live.html?id=${m.game_id}">Récap</a>` : '<span class="fm-info">Manches saisies</span>'}${peutGerer() && f().statut !== 'validee' ? `<button type="button" class="bouton bouton--petit" data-remettre="${n}">Corriger</button>` : ''}`;
  } else if (peutJouer() && pret) {
    actions = `<button type="button" class="bouton bouton--petit bouton--plein" data-jouer="${n}">Jouer au scorer</button><button type="button" class="bouton bouton--petit" data-saisir="${n}">Saisir le score</button>`;
  }
  return `
    <article class="fm-match fm-match--${m.statut}${o.a.length === 2 ? ' fm-match--double' : ''}" id="fm-m-${n}">
      <div class="fm-match__haut"><b>Match #${n}</b><span>${m.statut === 'en_cours' ? '<i class="fm-direct">En cours</i>' : `Cible ${cible}${tour ? ' · ensuite' : ''}`}</span></div>
      ${ligne('A')}${ligne('E')}
      ${actions ? `<div class="fm-match__actions">${actions}</div>` : ''}
    </article>`;
}

zone.addEventListener('click', async (e) => {
  const jouer = e.target.closest('[data-jouer]');
  if (jouer) {
    const g = await appel('lancer_match_feuille', { p_feuille: f().id, p_numero: Number(jouer.dataset.jouer) });
    if (g) location.href = `scorer.html?id=${g}`;
    return;
  }
  const saisir = e.target.closest('[data-saisir]');
  if (saisir) return ouvrirScore(Number(saisir.dataset.saisir));
  const remettre = e.target.closest('[data-remettre]');
  if (remettre) {
    const n = Number(remettre.dataset.remettre);
    const m = d.matchs[n - 1];
    if (!confirm(`Remettre le match #${n} à jouer ?${m.game_id ? '\n\nLa partie jouée au scorer sera effacée, avec ses statistiques.' : ''}`)) return;
    if (await appelSurPlace('remettre_match_feuille', { p_feuille: f().id, p_numero: n })) await actualiserSurPlace(n);
  }
});

async function actualiserMaintenant() {
  const { data } = await supabase.rpc('feuille_detail', code ? { p_code: code } : { p_feuille: f().id });
  if (data) { d = data; afficherMatchs(); afficherBandeau(); }
}

function ouvrirScore(n) {
  const m = d.matchs[n - 1];
  const a = noms(m.joueurs?.a); const e = noms(m.joueurs?.e);
  document.getElementById('t-score').textContent = `Score du match #${n}`;
  document.getElementById('score-joueurs').textContent = `${a} (A) contre ${e} (E)`;
  document.getElementById('erreur-score').textContent = '';
  document.getElementById('score-choix').innerHTML = [[2, 0], [2, 1], [1, 2], [0, 2]].map(([x, y]) => `
    <button type="button" class="bouton" data-score="${x}-${y}"><b>${x} – ${y}</b><small>${esc(x > y ? a : e)} gagne</small></button>`).join('');
  fenScore.dataset.n = n;
  fenScore.hidden = false;
}
fenScore.addEventListener('click', async (e) => {
  if (e.target === fenScore || e.target.closest('[data-fermer]')) { fenScore.hidden = true; return; }
  const b = e.target.closest('[data-score]');
  if (!b) return;
  const [x, y] = b.dataset.score.split('-').map(Number);
  const n = Number(fenScore.dataset.n);
  const ok = await appelSurPlace('saisir_resultat_feuille', { p_feuille: f().id, p_numero: n, p_manches_a: x, p_manches_e: y }, document.getElementById('erreur-score'));
  if (ok) { fenScore.hidden = true; await actualiserSurPlace(n); }
});

// Saisie d'un score ou correction : la page reste à sa place (pas de remontée vers le message du haut)
async function appelSurPlace(fn, args, zoneErreur = null) {
  if (occupe) return null;
  occupe = true;
  const { error } = await supabase.rpc(fn, args);
  occupe = false;
  if (error) {
    const texte = error.code === 'P0001' ? error.message : erreurFr(error);
    if (zoneErreur) zoneErreur.textContent = texte; else alert(texte);
    return null;
  }
  return true;
}
async function actualiserSurPlace(n) {
  const y = window.scrollY;
  await actualiserMaintenant();
  window.scrollTo(0, y);
  // Le match mis à jour s'allume un instant
  const carte = document.getElementById(`fm-m-${n}`);
  if (carte) { carte.classList.remove('fm-match--maj'); void carte.offsetWidth; carte.classList.add('fm-match--maj'); }
}

// ----- Totaux, validation, PDF -----

function afficherFin() {
  const el = document.getElementById('fm-fin');
  if (!el) return;
  const t = totaux();
  const resultat = t.faits < 20 ? ''
    : (t.pa === t.pe ? `Match nul ${t.pa} – ${t.pe}` : `${esc(nomEquipe(t.pa > t.pe ? 'A' : 'E'))} ${Math.max(t.pa, t.pe)} bat ${esc(nomEquipe(t.pa > t.pe ? 'E' : 'A'))} ${Math.min(t.pa, t.pe)}`);
  const validee = f().statut === 'validee';
  el.innerHTML = `
    <h2>Résultat</h2>
    <table class="fm-totaux">
      <thead><tr><th></th><th>A · ${esc(nomEquipe('A'))}</th><th>E · ${esc(nomEquipe('E'))}</th></tr></thead>
      <tbody><tr><th>Points</th><td>${t.pa}</td><td>${t.pe}</td></tr><tr><th>Manches</th><td>${t.ma}</td><td>${t.me}</td></tr></tbody>
    </table>
    ${resultat ? `<p class="fm-resultat">${resultat}</p>` : `<p class="match__format" style="margin:0">${20 - t.faits} match${20 - t.faits > 1 ? 's' : ''} encore à jouer.</p>`}
    ${peutGerer() && !validee && t.faits === 20 ? `
      <div class="fm-signatures">
        ${['A', 'E'].map((c) => `
        <div class="fm-signature">
          <span>Signature du capitaine de l'équipe ${c} <small>(${esc(nomEquipe(c))})</small></span>
          <canvas width="600" height="200" data-signature="${c}" aria-label="Zone de signature, équipe ${c}"></canvas>
          <button type="button" class="lien-bouton" data-effacer="${c}">Effacer</button>
        </div>`).join('')}
      </div>
      <label class="fm-case"><input type="checkbox" id="fm-article" checked> Publier un article avec le résultat sur le site</label>
      <div class="actions"><button type="button" class="bouton bouton--plein" id="fm-valider">Valider la feuille</button></div>
      <p class="match__format" style="margin:0">Le score est reporté dans le calendrier de l'équipe. Ensuite : export PDF à envoyer au CPARD.</p>` : ''}
    ${validee ? `
      <div class="actions">
        <button type="button" class="bouton bouton--plein" id="fm-pdf">Télécharger le PDF</button>
        <a class="bouton" href="mailto:${EMAIL_CPARD}?subject=${encodeURIComponent(sujetMail())}&body=${encodeURIComponent(`Bonjour,\n\nVeuillez trouver ci-joint la feuille de match ${nomEquipe('A')} – ${nomEquipe('E')} (${t.pa}-${t.pe}).\n\nSportivement,\n${d.equipe.name}`)}">Envoyer au CPARD</a>
        ${f().article_id ? `<a class="bouton" href="article.html?id=${f().article_id}">Voir l'article</a>` : ''}
      </div>
      <p class="match__format" style="margin:0">« Télécharger le PDF » ouvre l'impression : choisissez « Enregistrer au format PDF », puis joignez le fichier au mail du CPARD (${EMAIL_CPARD}).</p>
      ${peutGerer() ? '<p class="match__format"><button type="button" class="lien-bouton" id="fm-rouvrir">Rouvrir la feuille pour corriger</button></p>' : ''}` : ''}
    ${!validee && peutGerer() ? '<p class="match__format" style="margin:0"><button type="button" class="lien-bouton" id="fm-apercu">Aperçu du PDF</button></p>' : ''}`;
  el.querySelectorAll('canvas[data-signature]').forEach(brancherSignature);
  el.querySelectorAll('[data-effacer]').forEach((b) => b.addEventListener('click', () => {
    const cv = el.querySelector(`canvas[data-signature="${b.dataset.effacer}"]`);
    cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    cv.classList.remove('fm-signe');
  }));
  document.getElementById('fm-valider')?.addEventListener('click', valider);
  document.getElementById('fm-pdf')?.addEventListener('click', imprimer);
  document.getElementById('fm-apercu')?.addEventListener('click', imprimer);
  document.getElementById('fm-rouvrir')?.addEventListener('click', async () => {
    if (!confirm('Rouvrir la feuille ? Les signatures seront effacées : il faudra la valider et la signer à nouveau. L\'article déjà publié reste en ligne.')) return;
    if (await appel('rouvrir_feuille', { p_feuille: f().id }, 'Feuille rouverte.')) await charger();
  });
}

const sujetMail = () => {
  const r = d.rencontre;
  return `Feuille de match ${[r.division && `D${r.division}`, r.poule && `P${r.poule}`, r.journee].filter(Boolean).join(' ')} – ${nomEquipe('A')} / ${nomEquipe('E')}`;
};

function brancherSignature(cv) {
  const ctx = cv.getContext('2d');
  ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  let trace = false;
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
  cv.addEventListener('pointerdown', (e) => { trace = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); });
  cv.addEventListener('pointermove', (e) => { if (!trace) return; ctx.lineTo(...pos(e)); ctx.stroke(); cv.classList.add('fm-signe'); });
  ['pointerup', 'pointercancel'].forEach((t) => cv.addEventListener(t, () => { trace = false; }));
}

async function valider() {
  const sig = (c) => {
    const cv = zone.querySelector(`canvas[data-signature="${c}"]`);
    return cv.classList.contains('fm-signe') ? cv.toDataURL('image/png') : '';
  };
  const sa = sig('A'); const se = sig('E');
  if (!sa || !se) { message(zoneMsg, 'Les deux capitaines doivent signer avant de valider.'); return; }
  const res = await appel('valider_feuille', { p_feuille: f().id, p_signature_a: sa, p_signature_e: se, p_article: document.getElementById('fm-article').checked },
    'Feuille validée : le score est reporté dans le calendrier.');
  if (res) await charger();
}

// Feuille au format FFD, imprimée (ou enregistrée en PDF) depuis le navigateur
function imprimer() {
  const r = d.rencontre;
  const t = totaux();
  const dt = new Date(`${r.date_match}T12:00:00`).toLocaleDateString('fr-FR');
  const ligneJoueurs = (camp) => POSTES[camp].map((p) => `<tr><th>${p}</th><td>${esc(nomPoste(camp, p))}</td></tr>`).join('');
  const lignePaires = (camp) => PAIRES[camp].map((p) => `<tr><th>${p}</th><td>${esc((compo(camp)[p] || []).map((l) => nomPoste(camp, l)).join(' / '))}</td></tr>`).join('');
  const blocRempl = (camp) => {
    const rp = rempl(camp);
    return `<table class="pdf-t"><tr><th>${REMPL[camp]}</th><td>${esc(nomPoste(camp, REMPL[camp]))}</td></tr></table>
      <p class="pdf-rempl">remplace le joueur # <b>${rp ? rp.joueur : ''}</b> après le match # <b>${rp ? rp.apres : ''}</b></p>`;
  };
  const caseMatch = (n) => {
    const o = ORDRE[n - 1]; const m = d.matchs[n - 1]; const fini = m.statut === 'termine';
    return `<div class="pdf-m${o.a.length === 2 ? ' pdf-m--d' : ''}">
      <div class="pdf-m__t">MATCH #${n}</div>
      <div class="pdf-m__l"><span>${o.premier === 'A' ? '⊙' : ''}</span><b>${o.a}</b><i>${fini ? m.manches_a : ''}</i></div>
      <div class="pdf-m__l"><span>${o.premier === 'E' ? '⊙' : ''}</span><b>${o.e}</b><i>${fini ? m.manches_e : ''}</i></div>
    </div>`;
  };
  const scoreCol = d.matchs.map((m) => `<tr><td>${m.statut === 'termine' ? (m.manches_a > m.manches_e ? 1 : 0) : ''}</td><th>#${m.numero}</th><td>${m.statut === 'termine' ? (m.manches_e > m.manches_a ? 1 : 0) : ''}</td></tr>`).join('');
  const vainqueur = t.pa >= t.pe ? 'A' : 'E';
  document.getElementById('impression').innerHTML = `
    <div class="pdf">
      <div class="pdf-haut">
        <img class="pdf-logo" src="assets/img/ffd.jpg" alt="FFD">
        <h1>FÉDÉRATION FRANÇAISE DE DARTS<br>CHAMPIONNAT PAR ÉQUIPES</h1>
        <span class="pdf-site">https://www.ffdarts.fr</span>
      </div>
      <div class="pdf-info">
        <span>DATE : <b>${esc(dt)}</b></span><span>LIEU : <b>${esc(r.salle?.nom || '')}</b></span>
        <span>DIVISION : <b>${esc(r.division || '')}</b></span><span>POULE : <b>${esc(r.poule || '')}</b></span><span>JOURNÉE : <b>${esc(String(r.journee || '').replace(/^J/i, ''))}</b></span>
      </div>
      <div class="pdf-equipes">
        ${['A', 'E'].map((c) => `<div>
          <p class="pdf-eq">ÉQUIPE ${c} : <b>${esc(nomEquipe(c))}</b></p>
          <p class="pdf-sous">SIMPLES</p><table class="pdf-t">${ligneJoueurs(c)}</table>
          <p class="pdf-sous">DOUBLES</p><table class="pdf-t">${lignePaires(c)}</table>
          <p class="pdf-sous">REMPLAÇANT</p>${blocRempl(c)}
        </div>`).join('')}
      </div>
      <p class="pdf-regle">Tous les matchs se jouent au meilleur des 3 manches de 501 points, départ direct, finish double. L'ordre de lancer est déterminé par le signe ⊙. Dans la colonne [SCORE], « 1 » pour un match gagné et « 0 » pour un match perdu.</p>
      <div class="pdf-corps">
        <div class="pdf-grille">${ORDRE.map((o) => caseMatch(o.n)).join('')}</div>
        <table class="pdf-score"><thead><tr><th>A</th><th>SCORE</th><th>E</th></tr></thead><tbody>${scoreCol}</tbody></table>
      </div>
      <div class="pdf-bas">
        <div class="pdf-final">
          <table class="pdf-totaux">
            <thead><tr><th></th><th>A · ${esc(nomEquipe('A'))}</th><th>E · ${esc(nomEquipe('E'))}</th></tr></thead>
            <tbody><tr><th>TOTAL</th><td>${t.pa}</td><td>${t.pe}</td></tr><tr><th>MANCHES</th><td>${t.ma}</td><td>${t.me}</td></tr></tbody>
          </table>
          <div class="pdf-resultat"><span>RÉSULTAT</span>
            <p><b>${esc(nomEquipe(vainqueur))}</b> <i>${Math.max(t.pa, t.pe)}</i></p>
            <p class="pdf-bat">${t.pa === t.pe ? 'MATCH NUL AVEC' : 'BAT'}</p>
            <p><b>${esc(nomEquipe(vainqueur === 'A' ? 'E' : 'A'))}</b> <i>${Math.min(t.pa, t.pe)}</i></p>
          </div>
        </div>
        <div class="pdf-sig">${['A', 'E'].map((c) => `<div>signature cap équipe ${c}${f()[`signature_${c.toLowerCase()}`] ? `<img src="${f()[`signature_${c.toLowerCase()}`]}" alt="">` : ''}</div>`).join('')}</div>
      </div>
      <div class="pdf-pied"><img class="pdf-logo pdf-logo--cpard" src="assets/img/cpard.jpg" alt="CPARD"><p class="pdf-envoi">Envoyer à : ${EMAIL_CPARD}</p></div>
    </div>`;
  const titre = document.title;
  document.title = sujetMail();
  // Les logos doivent être chargés avant l'impression
  const images = [...document.querySelectorAll('#impression img')];
  Promise.all(images.map((im) => (im.complete ? null : new Promise((ok) => { im.onload = ok; im.onerror = ok; }))))
    .then(() => setTimeout(() => { window.print(); document.title = titre; }, 50));
}

demarrer();
