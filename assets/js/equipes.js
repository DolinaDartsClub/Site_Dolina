// =====================================================================
//  Équipes : calendrier et résultats de Dolinos, Dolina 1 et Dolina 2
//  (cahier des charges § 6.5). Public ; l'effectif n'est visible que des
//  membres connectés. Le capitaine saisit les rencontres de son équipe,
//  l'admin celles des trois équipes. Export vers l'agenda (.ics).
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, nomAffiche, avatar } from './app.js?v=__VERSION__';
import { debutSaison, nomSaison } from './profil-commun.js?v=__VERSION__';
import { telechargerIcs } from './ics.js?v=__VERSION__';

const zone = document.getElementById('eq-contenu');
const zoneMsg = document.getElementById('message');
const onglets = document.getElementById('eq-onglets');
const form = document.getElementById('form-rencontre');

const fmtJour = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const fmtMois = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const fmtLong = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtCourt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

let moi = null;
let equipes = [];
let rencontres = [];
let salles = [];
let effectifs = {};     // team_id -> [profils]
let equipeActive = null;
let saison = null;      // date de début de la saison affichée (AAAA-MM-JJ)
let enEdition = null;   // rencontre modifiée (null = nouvelle)
let domicile = true;
let vue = 'avenir';     // filtre : 'avenir', 'resultats' ou 'tout'

// ---------- Outils ----------

const dateLocale = (d) => new Date(`${d}T12:00:00`);
const aujourdhui = () => new Date().toLocaleDateString('fr-CA');
const hm = (t) => (t ? t.slice(0, 5).replace(':', 'h') : '');
const isoJour = (d) => d.toLocaleDateString('fr-CA');
const saisonDe = (d) => isoJour(debutSaison(dateLocale(d)));
// Journée dont la date exacte n'est pas encore fixée : une période (du … au …)
const aConfirmer = (r) => !!r.date_fin && r.date_fin !== r.date_match;
const finDe = (r) => r.date_fin || r.date_match;
const periode = (r) => `Entre le ${fmtCourt.format(dateLocale(r.date_match)).replace('.', '')} et le ${fmtCourt.format(dateLocale(r.date_fin)).replace('.', '')}`;
const salleDe = (r) => salles.find((s) => s.id === r.salle_id) || null;
const peutGerer = (teamId) => !!moi && moi.status === 'active'
  && (moi.role === 'admin' || equipes.some((t) => t.id === teamId && t.captain_id === moi.id));
const gereUneEquipe = () => !!moi && moi.status === 'active' && (moi.role === 'admin' || equipes.some((t) => t.captain_id === moi.id));

export function resultat(r) {
  if (r.score_nous === null || r.score_eux === null || r.score_nous === undefined) return null;
  if (r.score_nous > r.score_eux) return { code: 'V', libelle: 'Victoire', classe: 'gagne' };
  if (r.score_nous < r.score_eux) return { code: 'D', libelle: 'Défaite', classe: 'perdu' };
  return { code: 'N', libelle: 'Nul', classe: 'nul' };
}

function lienCarte(s) {
  if (!s) return null;
  return s.lien_carte || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.adresse)}`;
}

// « 2 » → « Division 2 », « D2 » reste « D2 » ; idem pour la poule et la journée
const prefixe = (v, mot) => (v ? (/^[\dA-Z]{1,2}$/i.test(v) && !/^[DJP]\d/i.test(v) ? `${mot} ${v}` : v) : null);
function libelleMeta(r) {
  return [prefixe(r.division, 'Division'), prefixe(r.poule, 'Poule'), prefixe(r.journee, 'Journée')].filter(Boolean).join(' · ');
}

// ---------- Chargement ----------

async function charger() {
  moi = await profilConnecte().catch(() => null);
  const [rt, rr, rs] = await Promise.all([
    supabase.from('teams').select('id, name, captain_id, sort_order').order('sort_order'),
    supabase.from('rencontres').select('*').order('date_match').order('heure_match', { nullsFirst: true }),
    supabase.from('salles').select('*').order('nom'),
  ]);
  if (rt.error) { zone.innerHTML = `<p class="vide">${esc(erreurFr(rt.error))}</p>`; return; }
  if (rr.error || rs.error) {
    zone.innerHTML = `<p class="vide">Le calendrier n'est pas encore disponible${moi?.role === 'admin' ? ' : exécutez le script SQL 030 dans Supabase' : ''}.</p>`;
    return;
  }
  equipes = rt.data || [];
  rencontres = rr.data || [];
  salles = rs.data || [];

  // Effectif : membres connectés seulement
  effectifs = {};
  if (moi?.status === 'active') {
    const { data } = await supabase.from('team_members')
      .select('team_id, profiles!team_members_profile_id_fkey(id, first_name, last_name, nickname, use_nickname, photo_path, status)')
      .eq('status', 'accepted');
    (data || []).forEach((m) => {
      if (!m.profiles || m.profiles.status !== 'active') return;
      (effectifs[m.team_id] ||= []).push(m.profiles);
    });
    Object.values(effectifs).forEach((l) => l.sort((a, b) => nomAffiche(a).localeCompare(nomAffiche(b), 'fr')));
  }

  const demandee = decodeURIComponent(location.hash.slice(1));
  const mienne = moi && equipes.find((t) => t.captain_id === moi.id || (effectifs[t.id] || []).some((p) => p.id === moi.id));
  equipeActive = (equipes.find((t) => t.id === demandee || t.name === demandee) || mienne || equipes[0])?.id || null;
  saison = isoJour(debutSaison());
  afficher();
}

// ---------- Affichage ----------

function afficherOnglets() {
  onglets.innerHTML = equipes.map((t) => `<button type="button" class="onglet" data-equipe="${t.id}" aria-selected="${t.id === equipeActive}">${esc(t.name)}</button>`).join('');
}

function carteRencontre(r, gerer) {
  const d = dateLocale(r.date_match);
  const s = salleDe(r);
  const res = resultat(r);
  const equipe = equipes.find((t) => t.id === r.team_id);
  const meta = libelleMeta(r);
  const heures = [r.heure_match && `Match ${hm(r.heure_match)}`, r.heure_rdv && `RDV ${hm(r.heure_rdv)}`].filter(Boolean).join(' · ');
  return `
    <article class="eq-rencontre${res ? ` eq-rencontre--${res.classe}` : ''}" id="r-${r.id}">
      ${aConfirmer(r) ? `
      <div class="eq-date eq-date--periode" aria-label="${esc(periode(r))}">
        <span class="eq-date__jour">dès le</span>
        <span class="eq-date__num">${d.getDate()}</span>
        <span class="eq-date__mois">${esc(fmtMois.format(d).replace('.', ''))}</span>
      </div>` : `
      <div class="eq-date" aria-label="${esc(fmtLong.format(d))}">
        <span class="eq-date__jour">${esc(fmtJour.format(d).replace('.', ''))}</span>
        <span class="eq-date__num">${d.getDate()}</span>
        <span class="eq-date__mois">${esc(fmtMois.format(d).replace('.', ''))}</span>
      </div>`}
      <div class="eq-rencontre__corps">
        <div class="eq-rencontre__haut">
          <span class="eq-badge${r.domicile ? ' eq-badge--dom' : ''}">${r.domicile ? 'Domicile' : 'Extérieur'}</span>
          ${meta ? `<span class="eq-meta">${esc(meta)}</span>` : ''}
        </div>
        <h3 class="eq-affiche">${esc(equipe?.name || '')} <span>${r.domicile ? 'reçoit' : 'chez'}</span> ${esc(r.adversaire)}</h3>
        ${aConfirmer(r) ? `<p class="eq-periode">${esc(periode(r))}${res ? '' : ' · date à confirmer'}</p>` : ''}
        ${heures ? `<p class="eq-heures">${esc(heures)}</p>` : ''}
        ${s ? `<p class="eq-salle"><strong>${esc(s.nom)}</strong> · ${esc(s.adresse)} <a href="${esc(lienCarte(s))}" target="_blank" rel="noopener">Itinéraire</a></p>` : ''}
        ${r.note ? `<p class="eq-note">${esc(r.note)}</p>` : ''}
        <div class="eq-rencontre__actions">
          ${!res && !aConfirmer(r) ? `<button type="button" class="bouton bouton--petit" data-agenda="${r.id}">Ajouter à mon agenda</button>` : ''}
          ${gerer ? `<button type="button" class="bouton bouton--petit" data-modifier="${r.id}">${res ? 'Modifier' : 'Modifier / score'}</button>` : ''}
          ${moi?.role === 'admin' && moi.status === 'active' ? `<a class="bouton bouton--petit" href="admin.html?rencontre=${encodeURIComponent(r.id)}#actus">Nouvel article</a>` : ''}
        </div>
      </div>
      ${res ? `
      <div class="eq-score" aria-label="${esc(res.libelle)} ${r.score_nous} à ${r.score_eux}">
        <span class="eq-score__chiffres">${r.score_nous}<i>–</i>${r.score_eux}</span>
        <span class="eq-score__res">${esc(res.libelle)}</span>
      </div>` : ''}
    </article>`;
}

function afficher() {
  afficherOnglets();
  const t = equipes.find((x) => x.id === equipeActive);
  if (!t) { zone.innerHTML = '<p class="vide">Aucune équipe pour le moment.</p>'; return; }
  const gerer = peutGerer(t.id);
  const toutes = rencontres.filter((r) => r.team_id === t.id);
  const saisons = [...new Set([saison, ...toutes.map((r) => saisonDe(r.date_match))])].sort().reverse();
  const liste = toutes.filter((r) => saisonDe(r.date_match) === saison);
  const auj = aujourdhui();
  const avenir = liste.filter((r) => !resultat(r) && finDe(r) >= auj);
  const jouees = liste.filter((r) => resultat(r) || finDe(r) < auj).reverse();
  const agendables = avenir.filter((r) => !aConfirmer(r));
  const bilan = { V: 0, N: 0, D: 0 };
  liste.forEach((r) => { const x = resultat(r); if (x) bilan[x.code] += 1; });
  const capitaine = (effectifs[t.id] || []).find((p) => p.id === t.captain_id);
  const effectif = effectifs[t.id];

  zone.innerHTML = `
    <section class="carte-info eq-tete">
      <div class="eq-tete__haut">
        <h2>${esc(t.name)}</h2>
        ${saisons.length > 1 ? `<label class="eq-saison"><span class="visuellement-cache">Saison</span><select id="eq-saison">${saisons.map((s) => `<option value="${s}"${s === saison ? ' selected' : ''}>${esc(nomSaison(dateLocale(s)))}</option>`).join('')}</select></label>`
    : `<span class="match__format">${esc(nomSaison(dateLocale(saison)))}</span>`}
      </div>
      <div class="eq-bilan" aria-label="Bilan de la saison">
        <span class="eq-bilan__case eq-bilan__case--v"><b>${bilan.V}</b>victoire${bilan.V > 1 ? 's' : ''}</span>
        <span class="eq-bilan__case"><b>${bilan.N}</b>nul${bilan.N > 1 ? 's' : ''}</span>
        <span class="eq-bilan__case eq-bilan__case--d"><b>${bilan.D}</b>défaite${bilan.D > 1 ? 's' : ''}</span>
      </div>
      ${capitaine ? `<p class="match__format" style="margin:0">Capitaine : <strong>${esc(nomAffiche(capitaine))}</strong></p>` : ''}
      <div class="actions">
        ${gerer ? '<button type="button" class="bouton bouton--plein bouton--petit" id="btn-ajouter">+ Ajouter une rencontre</button>' : ''}
        ${agendables.length ? `<button type="button" class="bouton bouton--petit" id="btn-agenda-saison">${agendables.length > 1 ? `Les ${agendables.length} prochains matchs` : 'Le prochain match'} dans mon agenda</button>` : ''}
      </div>
    </section>

    <div class="mp-filtre eq-filtre" role="group" aria-label="Afficher">
      ${[['avenir', `À venir <b>${avenir.length}</b>`], ['resultats', `Résultats <b>${jouees.length}</b>`], ['tout', 'Tout']].map(([v, l]) => `<button type="button" data-vue="${v}" aria-pressed="${vue === v}">${l}</button>`).join('')}
    </div>

    <section class="section"${vue === 'resultats' ? ' hidden' : ''}>
      <h2 class="section__titre">À venir</h2>
      <div class="eq-liste">${avenir.length ? avenir.map((r) => carteRencontre(r, gerer)).join('') : `<p class="vide">Aucune rencontre à venir${gerer ? ' : ajoutez la première avec « Ajouter une rencontre »' : ''}.</p>`}</div>
    </section>

    <section class="section"${vue === 'avenir' ? ' hidden' : ''}>
      <h2 class="section__titre">Résultats</h2>
      <div class="eq-liste">${jouees.length ? jouees.map((r) => carteRencontre(r, gerer)).join('') : '<p class="vide">Pas encore de résultat cette saison.</p>'}</div>
    </section>

    ${effectif ? `
    <section class="section">
      <h2 class="section__titre">Effectif <span class="section__aide">${effectif.length} joueur${effectif.length > 1 ? 's' : ''} · visible des membres</span></h2>
      <div class="eq-effectif">${effectif.map((p) => `
        <a class="eq-joueur" href="profil.html?id=${encodeURIComponent(p.id)}">
          ${avatar(p, 'avatar--liste')}
          <span>${esc(nomAffiche(p))}${p.id === t.captain_id ? ' <small class="eq-cap">Capitaine</small>' : ''}</span>
        </a>`).join('') || '<p class="vide">Aucun joueur.</p>'}</div>
    </section>` : (moi ? '' : '<p class="match__format eq-connexion"><a href="connexion.html">Connectez-vous</a> pour voir les joueurs de chaque équipe.</p>')}

    ${gereUneEquipe() ? blocSalles() : ''}`;
}

function blocSalles() {
  const admin = moi?.role === 'admin';
  return `
    <details class="carte-info eq-carnet">
      <summary>Carnet de salles (${salles.length})</summary>
      <p class="match__format" style="margin:0">Les salles servent pour toutes les équipes. Une salle s'ajoute aussi depuis le formulaire d'une rencontre.${admin ? '' : ' Seul un admin peut en supprimer une.'}</p>
      <ul class="eq-salles">${salles.map((s) => `
        <li class="eq-salle-ligne" data-salle="${s.id}">
          <div class="eq-salle-ligne__texte"><strong>${esc(s.nom)}</strong><small>${esc(s.adresse)}</small></div>
          <span class="eq-salle-ligne__actions">
            <a class="bouton bouton--petit" href="${esc(lienCarte(s))}" target="_blank" rel="noopener">Carte</a>
            <button type="button" class="bouton bouton--petit" data-salle-modifier="${s.id}">Modifier</button>
            ${admin ? `<button type="button" class="bouton bouton--petit bouton--danger" data-salle-supprimer="${s.id}">Supprimer</button>` : ''}
          </span>
        </li>`).join('')}</ul>
    </details>`;
}

// ---------- Agenda (.ics) ----------

function evenement(r) {
  const t = equipes.find((x) => x.id === r.team_id);
  const s = salleDe(r);
  const description = [
    r.heure_rdv && `Rendez-vous à ${hm(r.heure_rdv)}`,
    libelleMeta(r),
    s && lienCarte(s),
    r.note,
    'Dolina Darts Club',
  ].filter(Boolean).join('\n');
  return {
    uid: `rencontre-${r.id}@dolinadartsclub`,
    date: r.date_match,
    heure: r.heure_match ? r.heure_match.slice(0, 5) : null,
    duree: 3,
    titre: `${t?.name || 'Dolina'} – ${r.adversaire} (${r.domicile ? 'dom.' : 'ext.'})`,
    lieu: s ? `${s.nom}, ${s.adresse}` : '',
    description,
  };
}

// ---------- Formulaire ----------

function optionsSalles(choisie) {
  form.elements.salle_id.innerHTML = '<option value="">— Non précisée —</option>'
    + salles.map((s) => `<option value="${s.id}"${s.id === choisie ? ' selected' : ''}>${esc(s.nom)}</option>`).join('')
    + '<option value="nouvelle">+ Nouvelle salle…</option>';
  document.getElementById('eq-nouvelle-salle').hidden = true;
}

function majDomicile(valeur) {
  domicile = valeur;
  form.querySelectorAll('[data-domicile]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.domicile === '1') === domicile)));
  const t = equipes.find((x) => x.id === equipeActive);
  document.getElementById('lib-score-nous').textContent = t?.name || 'Nous';
  document.getElementById('lib-score-eux').textContent = form.elements.adversaire.value.trim() || 'Adversaire';
}

function ouvrirFormulaire(r = null) {
  enEdition = r;
  form.reset();
  document.getElementById('titre-rencontre').textContent = r ? 'Modifier la rencontre' : 'Nouvelle rencontre';
  document.getElementById('btn-supprimer-rencontre').hidden = !r;
  const f = form.elements;
  if (r) {
    ['adversaire', 'date_match', 'date_fin', 'division', 'poule', 'journee', 'note'].forEach((k) => { f[k].value = r[k] || ''; });
    f.heure_match.value = r.heure_match ? r.heure_match.slice(0, 5) : '';
    f.heure_rdv.value = r.heure_rdv ? r.heure_rdv.slice(0, 5) : '';
    f.score_nous.value = r.score_nous ?? '';
    f.score_eux.value = r.score_eux ?? '';
    optionsSalles(r.salle_id);
  } else {
    // Reprend division et poule de la dernière rencontre de l'équipe
    const derniere = rencontres.filter((x) => x.team_id === equipeActive).at(-1);
    f.division.value = derniere?.division || '';
    f.poule.value = derniere?.poule || '';
    optionsSalles(salles.find((s) => /dolina/i.test(s.nom))?.id || null);
  }
  majDomicile(r ? r.domicile : true);
  document.getElementById('fen-rencontre').hidden = false;
  f.adversaire.focus();
}

function fermerFormulaire() {
  document.getElementById('fen-rencontre').hidden = true;
}

form.addEventListener('click', (e) => {
  const b = e.target.closest('[data-domicile]');
  if (b) {
    majDomicile(b.dataset.domicile === '1');
    // Domicile : la salle du club par défaut ; extérieur : à choisir
    const club = salles.find((s) => /dolina/i.test(s.nom));
    if (club && domicile && !form.elements.salle_id.value) form.elements.salle_id.value = club.id;
    if (club && !domicile && form.elements.salle_id.value === club.id) form.elements.salle_id.value = '';
  }
  if (e.target.closest('[data-fermer]')) fermerFormulaire();
});
form.elements.adversaire.addEventListener('input', () => majDomicile(domicile));
form.elements.salle_id.addEventListener('change', (e) => {
  document.getElementById('eq-nouvelle-salle').hidden = e.target.value !== 'nouvelle';
  if (e.target.value === 'nouvelle') form.elements.salle_nom.focus();
});
document.getElementById('fen-rencontre').addEventListener('click', (e) => {
  if (e.target.id === 'fen-rencontre') fermerFormulaire();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('fen-rencontre').hidden) fermerFormulaire();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = form.elements;
  const adversaire = f.adversaire.value.trim();
  if (!adversaire) return message(zoneMsg, 'Indiquez l\'adversaire.') || f.adversaire.focus();
  if (!f.date_match.value) return message(zoneMsg, 'Indiquez la date de la rencontre.') || f.date_match.focus();
  if (f.date_fin.value && f.date_fin.value < f.date_match.value) return message(zoneMsg, 'La date limite doit être après la date de début.');
  const sn = f.score_nous.value === '' ? null : Number(f.score_nous.value);
  const se = f.score_eux.value === '' ? null : Number(f.score_eux.value);
  if ((sn === null) !== (se === null)) return message(zoneMsg, 'Saisissez le score des deux équipes, ou laissez les deux cases vides.');
  const bouton = document.getElementById('btn-enregistrer');
  bouton.disabled = true;

  let salleId = f.salle_id.value || null;
  if (salleId === 'nouvelle') {
    const nom = f.salle_nom.value.trim();
    const adresse = f.salle_adresse.value.trim();
    const lien = f.salle_lien.value.trim() || null;
    if (!nom || !adresse) { bouton.disabled = false; return message(zoneMsg, 'Donnez le nom et l\'adresse de la nouvelle salle.'); }
    if (lien && !/^https:\/\//.test(lien)) { bouton.disabled = false; return message(zoneMsg, 'Le lien de la carte doit commencer par https://'); }
    const { data, error } = await supabase.from('salles').insert({ nom, adresse, lien_carte: lien }).select('*').single();
    if (error) { bouton.disabled = false; return message(zoneMsg, error.code === '23505' ? 'Une salle porte déjà ce nom : choisissez-la dans la liste.' : erreurFr(error)); }
    salles.push(data);
    salles.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    salleId = data.id;
  }

  const ligne = {
    team_id: enEdition?.team_id || equipeActive,
    adversaire,
    domicile,
    date_match: f.date_match.value,
    date_fin: f.date_fin.value && f.date_fin.value !== f.date_match.value ? f.date_fin.value : null,
    heure_match: f.heure_match.value || null,
    heure_rdv: f.heure_rdv.value || null,
    salle_id: salleId,
    division: f.division.value.trim() || null,
    poule: f.poule.value.trim() || null,
    journee: f.journee.value.trim() || null,
    note: f.note.value.trim() || null,
    score_nous: sn,
    score_eux: se,
  };
  const req = enEdition
    ? supabase.from('rencontres').update(ligne).eq('id', enEdition.id).select('*').single()
    : supabase.from('rencontres').insert(ligne).select('*').single();
  const { data, error } = await req;
  bouton.disabled = false;
  if (error) return message(zoneMsg, erreurFr(error));
  rencontres = rencontres.filter((x) => x.id !== data.id).concat(data)
    .sort((a, b) => (a.date_match + (a.heure_match || '')).localeCompare(b.date_match + (b.heure_match || '')));
  saison = saisonDe(data.date_match);
  if (vue !== 'tout') vue = resultat(data) || finDe(data) < aujourdhui() ? 'resultats' : 'avenir';
  fermerFormulaire();
  message(zoneMsg, enEdition ? 'Rencontre mise à jour.' : 'Rencontre ajoutée au calendrier.', 'ok');
  afficher();
  document.getElementById(`r-${data.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

document.getElementById('btn-supprimer-rencontre').addEventListener('click', async () => {
  if (!enEdition || !confirm(`Supprimer la rencontre contre ${enEdition.adversaire} du ${fmtLong.format(dateLocale(enEdition.date_match))} ?`)) return;
  const { error } = await supabase.from('rencontres').delete().eq('id', enEdition.id);
  if (error) return message(zoneMsg, erreurFr(error));
  rencontres = rencontres.filter((x) => x.id !== enEdition.id);
  fermerFormulaire();
  message(zoneMsg, 'Rencontre supprimée.', 'ok');
  afficher();
});

// ---------- Carnet de salles ----------

async function modifierSalle(id) {
  const s = salles.find((x) => x.id === id);
  const li = zone.querySelector(`[data-salle="${id}"]`);
  if (!s || !li) return;
  li.innerHTML = `
    <form class="eq-salle-form" data-salle-form="${id}">
      <label class="champ">Nom<input name="nom" maxlength="80" value="${esc(s.nom)}" required></label>
      <label class="champ">Adresse<input name="adresse" maxlength="200" value="${esc(s.adresse)}" required></label>
      <label class="champ">Lien Google Maps<input name="lien" type="url" maxlength="300" value="${esc(s.lien_carte || '')}" placeholder="https://…"></label>
      <div class="actions"><button type="submit" class="bouton bouton--petit bouton--plein">Enregistrer</button><button type="button" class="bouton bouton--petit" data-salle-annuler>Annuler</button></div>
    </form>`;
}

zone.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-salle-form]');
  if (!f) return;
  e.preventDefault();
  const lien = f.lien.value.trim() || null;
  if (lien && !/^https:\/\//.test(lien)) return message(zoneMsg, 'Le lien de la carte doit commencer par https://');
  const { data, error } = await supabase.from('salles')
    .update({ nom: f.nom.value.trim(), adresse: f.adresse.value.trim(), lien_carte: lien })
    .eq('id', f.dataset.salleForm).select('*').single();
  if (error) return message(zoneMsg, erreurFr(error));
  salles = salles.map((s) => (s.id === data.id ? data : s));
  message(zoneMsg, 'Salle mise à jour.', 'ok');
  afficher();
  zone.querySelector('.eq-carnet').open = true;
});

// ---------- Clics ----------

onglets.addEventListener('click', (e) => {
  const b = e.target.closest('[data-equipe]');
  if (!b) return;
  equipeActive = b.dataset.equipe;
  const t = equipes.find((x) => x.id === equipeActive);
  history.replaceState(null, '', `#${encodeURIComponent(t?.name || equipeActive)}`);
  saison = isoJour(debutSaison());
  message(zoneMsg, '');
  afficher();
});

zone.addEventListener('change', (e) => {
  if (e.target.id === 'eq-saison') { saison = e.target.value; afficher(); }
});

zone.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.vue) {
    vue = b.dataset.vue;
    afficher();
    zone.querySelector('.eq-filtre')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    return;
  }
  if (b.id === 'btn-ajouter') return ouvrirFormulaire();
  if (b.dataset.modifier) return ouvrirFormulaire(rencontres.find((r) => r.id === b.dataset.modifier));
  if (b.dataset.agenda) {
    const r = rencontres.find((x) => x.id === b.dataset.agenda);
    const t = equipes.find((x) => x.id === r.team_id);
    return telechargerIcs([evenement(r)], `${t?.name || 'dolina'}-${r.date_match}.ics`.replace(/\s+/g, '-').toLowerCase(), `Dolina – ${t?.name || ''}`);
  }
  if (b.id === 'btn-agenda-saison') {
    const t = equipes.find((x) => x.id === equipeActive);
    const auj = aujourdhui();
    const liste = rencontres.filter((r) => r.team_id === equipeActive && !resultat(r) && r.date_match >= auj && !aConfirmer(r));
    return telechargerIcs(liste.map(evenement), `calendrier-${t.name}.ics`.replace(/\s+/g, '-').toLowerCase(), `Dolina – ${t.name}`);
  }
  if (b.dataset.salleModifier) return modifierSalle(b.dataset.salleModifier);
  if ('salleAnnuler' in b.dataset) { afficher(); zone.querySelector('.eq-carnet').open = true; return; }
  if (b.dataset.salleSupprimer) {
    const s = salles.find((x) => x.id === b.dataset.salleSupprimer);
    const n = rencontres.filter((r) => r.salle_id === s.id).length;
    if (!confirm(`Supprimer la salle « ${s.nom} » du carnet ?${n ? `\n\n${n} rencontre${n > 1 ? 's' : ''} n'aura plus de salle indiquée.` : ''}`)) return;
    const { error } = await supabase.from('salles').delete().eq('id', s.id);
    if (error) return message(zoneMsg, erreurFr(error));
    salles = salles.filter((x) => x.id !== s.id);
    rencontres.forEach((r) => { if (r.salle_id === s.id) r.salle_id = null; });
    message(zoneMsg, 'Salle supprimée.', 'ok');
    afficher();
    zone.querySelector('.eq-carnet').open = true;
  }
});

// Hauteur de l'en-tête collant : le filtre se colle juste en dessous
function majHauteurEntete() {
  const h = document.querySelector('.entete')?.offsetHeight || 64;
  document.documentElement.style.setProperty('--entete-h', `${h}px`);
}
majHauteurEntete();
window.addEventListener('resize', majHauteurEntete);

// Lien vers une autre équipe (#Dolina%202) sans recharger la page
window.addEventListener('hashchange', () => {
  const demandee = decodeURIComponent(location.hash.slice(1));
  const t = equipes.find((x) => x.id === demandee || x.name === demandee);
  if (t && t.id !== equipeActive) { equipeActive = t.id; saison = isoJour(debutSaison()); afficher(); }
});

charger();
