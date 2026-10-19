// =====================================================================
//  Espace capitaine : demandes pour rejoindre l'équipe, effectif,
//  prochaine rencontre et raccourcis vers le calendrier.
//  Un capitaine voit son équipe ; un admin choisit n'importe quelle équipe.
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, nomAffiche, avatar, estCapitaineDe, barreRubriques } from './app.js?v=__VERSION__';
import { blocRencontresRetard } from './retard.js?v=__VERSION__';
import { chargerClubs, logoAdversaire } from './logos.js?v=__VERSION__';
import { afficherStatsEquipe } from './cap-stats.js?v=__VERSION__';

const zone = document.getElementById('cap-zone');
const zoneMsg = document.getElementById('message');
const choix = document.getElementById('cap-equipes');
const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtCourt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const hm = (t) => (t ? t.slice(0, 5).replace(':', 'h') : '');

let moi = null;
let equipes = [];      // équipes accessibles
let active = null;

async function init() {
  moi = await profilConnecte().catch(() => null);
  const acces = document.getElementById('acces');
  if (!moi || moi.status !== 'active') {
    acces.hidden = false;
    acces.innerHTML = `<p class="vide">Espace réservé aux capitaines et aux admins. ${moi ? '' : '<a href="connexion.html">Se connecter</a>'}</p>`;
    return;
  }
  const { data } = await supabase.from('teams').select('*').order('sort_order');
  const admin = moi.role === 'admin';
  equipes = (data || []).filter((t) => admin || estCapitaineDe(t, moi.id));
  if (!equipes.length) {
    acces.hidden = false;
    acces.innerHTML = '<p class="vide">Cet espace est réservé aux capitaines d\'équipe et aux admins.</p>';
    return;
  }
  document.getElementById('contenu').hidden = false;
  const demandee = new URLSearchParams(location.search).get('equipe');
  active = (equipes.find((t) => t.id === demandee || t.name === demandee) || equipes.find((t) => estCapitaineDe(t, moi.id)) || equipes[0]).id;
  // Choix de l'équipe (liste déroulante) dès qu'il y en a plusieurs
  if (equipes.length > 1) {
    choix.hidden = false;
    choix.innerHTML = equipes.map((t) => `<button type="button" data-equipe="${t.id}" aria-pressed="${t.id === active}">${esc(t.name)}${estCapitaineDe(t, moi.id) ? ' <small>mon équipe</small>' : ''}</button>`).join('');
  }
  afficher();
}

// Bandeau de rubriques en haut de la page (comme l'accueil)
const I = (d) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
barreRubriques(document.getElementById('cap-rubriques'), [
  ['cap-equipe', 'Équipe', I('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>')],
  ['cap-retard', 'À scorer', I('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')],
  ['cap-demandes', 'Demandes', I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>')],
  ['cap-effectif', 'Effectif', I('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-7 7-7s7 3 7 7M17 4a4 4 0 0 1 0 8M22 21c0-3-2-6-5-6.5"/>')],
  ['cap-stats', 'Statistiques', I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>')],
]);

choix.addEventListener('click', (e) => {
  const b = e.target.closest('[data-equipe]');
  if (!b) return;
  active = b.dataset.equipe;
  choix.querySelectorAll('[data-equipe]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  const t = equipes.find((x) => x.id === active);
  history.replaceState(null, '', `?equipe=${encodeURIComponent(t.name)}`);
  message(zoneMsg, '');
  afficher();
});

async function afficher() {
  const t = equipes.find((x) => x.id === active);
  const lienEquipe = `equipes.html#${encodeURIComponent(t.name)}`;
  zone.innerHTML = '<p class="vide">Chargement…</p>';
  const auj = new Date().toLocaleDateString('fr-CA');
  const [rm, rr, rc] = await Promise.all([
    supabase.from('team_members')
      .select('profile_id, status, requested_at, profiles!team_members_profile_id_fkey(id, first_name, last_name, nickname, use_nickname, photo_path, status)')
      .eq('team_id', t.id).in('status', ['pending', 'accepted']).order('requested_at'),
    supabase.from('rencontres').select('*, salles(nom, adresse, lien_carte)').eq('team_id', t.id)
      .is('score_nous', null).gte('date_match', new Date(Date.now() - 20 * 86400000).toLocaleDateString('fr-CA'))
      .order('date_match').limit(6),
    t.captain_id ? supabase.from('profiles').select('first_name, last_name, nickname, use_nickname').eq('id', t.captain_id).maybeSingle() : Promise.resolve({ data: null }),
    chargerClubs(),
  ]);
  if (rm.error) { zone.innerHTML = `<p class="vide">${esc(erreurFr(rm.error))}</p>`; return; }
  const demandes = (rm.data || []).filter((m) => m.status === 'pending' && m.profiles);
  const effectif = (rm.data || []).filter((m) => m.status === 'accepted' && m.profiles?.status === 'active')
    .sort((a, b) => nomAffiche(a.profiles).localeCompare(nomAffiche(b.profiles), 'fr'));
  // Prochaine rencontre : la première pas encore jouée dont la période n'est pas passée
  const prochaine = (rr.data || []).find((r) => (r.date_fin || r.date_match) >= auj);
  const admin = moi.role === 'admin';

  const blocProchaine = prochaine ? (() => {
    const periode = prochaine.date_fin && prochaine.date_fin !== prochaine.date_match;
    const quand = periode
      ? `Entre le ${fmtCourt.format(new Date(`${prochaine.date_match}T12:00:00`))} et le ${fmtCourt.format(new Date(`${prochaine.date_fin}T12:00:00`))} · date à fixer`
      : `${fmt.format(new Date(`${prochaine.date_match}T12:00:00`))}${prochaine.heure_match ? ` à ${hm(prochaine.heure_match)}` : ''}`;
    return `
      <div class="cap-prochaine">
        <span class="cap-prochaine__titre">Prochaine rencontre${prochaine.journee ? ` · ${esc(prochaine.journee)}` : ''}</span>
        <strong class="cap-prochaine__affiche">${logoAdversaire(prochaine.adversaire, 'logo-adv--m')}<span>${esc(t.name)} ${prochaine.domicile ? 'reçoit' : 'chez'} ${esc(prochaine.adversaire)}</span></strong>
        <span>${esc(quand)}${prochaine.heure_rdv ? ` · RDV ${esc(hm(prochaine.heure_rdv))}` : ''}</span>
        ${prochaine.salles ? `<span class="match__format">${esc(prochaine.salles.nom)} · ${esc(prochaine.salles.adresse)}</span>` : ''}
        ${periode ? `<a class="bouton bouton--petit bouton--plein" href="equipes.html?modifier=${encodeURIComponent(prochaine.id)}#${encodeURIComponent(t.name)}">Fixer la date</a>` : ''}
      </div>`;
  })() : '<p class="match__format" style="margin:0">Aucune rencontre à venir dans le calendrier.</p>';

  zone.innerHTML = `
    <section class="carte-info cap-carte" id="cap-equipe">
      <div class="cap-carte__haut">
        <h2>${esc(t.name)}</h2>
        <span class="match__format">${rc.data ? `Capitaine : <strong>${esc(nomAffiche(rc.data))}</strong>` : `Pas de capitaine${admin ? ' · <a href="admin.html#equipes">le désigner</a>' : ''}`}</span>
      </div>
      ${blocVice(t, effectif, admin)}
      ${blocProchaine}
      <div class="cap-raccourcis">
        <a class="cap-raccourci" href="${lienEquipe}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg><span>Calendrier et scores</span></a>
        <a class="cap-raccourci" href="equipes.html?ajouter=1#${encodeURIComponent(t.name)}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span>Ajouter une rencontre</span></a>
        ${admin ? `<a class="cap-raccourci" href="admin.html#equipes"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg><span>Gérer dans l'admin</span></a>` : ''}
      </div>
    </section>

    <div id="cap-retard" class="cap-retard"></div>

    <section class="section" id="cap-demandes">
      <h2 class="section__titre">Demandes <span class="section__aide">${demandes.length ? `${demandes.length} en attente` : 'aucune en attente'}</span></h2>
      ${demandes.length ? `<ul class="cap-liste">${demandes.map((d) => {
    const valide = d.profiles.status === 'active';
    return `
        <li class="cap-ligne">
          ${avatar(d.profiles, 'avatar--liste')}
          <span class="cap-ligne__texte"><strong>${esc(nomAffiche(d.profiles))}</strong><small>${valide ? 'Veut rejoindre l\'équipe' : 'Compte pas encore validé par un admin'}</small></span>
          <span class="cap-ligne__actions">
            <button type="button" class="bouton bouton--petit bouton--plein" data-cap="accepted" data-id="${d.profile_id}"${valide ? '' : ' disabled title="Un admin doit d\'abord valider ce compte"'}>Accepter</button>
            <button type="button" class="bouton bouton--petit bouton--danger" data-cap="refused" data-id="${d.profile_id}">Refuser</button>
          </span>
        </li>`;
  }).join('')}</ul>` : '<p class="vide">Aucune demande en attente.</p>'}
    </section>

    <section class="section" id="cap-effectif">
      <h2 class="section__titre">Effectif <span class="section__aide">${effectif.length} joueur${effectif.length > 1 ? 's' : ''}</span></h2>
      ${effectif.length ? `<ul class="cap-liste">${effectif.map((m) => `
        <li class="cap-ligne">
          ${avatar(m.profiles, 'avatar--liste')}
          <a class="cap-ligne__texte" href="profil.html?id=${encodeURIComponent(m.profile_id)}"><strong>${esc(nomAffiche(m.profiles))}</strong>${m.profile_id === t.captain_id ? '<small class="eq-cap">Capitaine</small>' : (m.profile_id === t.vice_captain_id ? '<small class="eq-cap eq-cap--vice">Vice-capitaine</small>' : '')}</a>
          ${(admin || estCapitaineDe(t, moi.id)) && m.profile_id !== t.captain_id && m.profile_id !== moi.id ? `<span class="cap-ligne__actions"><button type="button" class="bouton bouton--petit" data-retirer="${m.profile_id}" data-nom="${esc(nomAffiche(m.profiles))}">Retirer</button></span>` : ''}
        </li>`).join('')}</ul>` : '<p class="vide">Aucun joueur dans l\'équipe pour l\'instant.</p>'}
    </section>

    <section class="section cap-stats" id="cap-stats"></section>`;
  blocRencontresRetard(document.getElementById('cap-retard'), t.id);
  afficherStatsEquipe(document.getElementById('cap-stats'), t, effectif);
}

// Vice-capitaine : mêmes accès que le capitaine ; choisi par un admin ou par le capitaine
function blocVice(t, effectif, admin) {
  if (!('vice_captain_id' in t)) return '';   // script 036 pas encore lancé
  const vice = effectif.find((m) => m.profile_id === t.vice_captain_id);
  const peutChoisir = admin || t.captain_id === moi.id;
  if (!peutChoisir) {
    return `<p class="match__format cap-vice">Vice-capitaine : <strong>${vice ? esc(nomAffiche(vice.profiles)) : 'aucun'}</strong></p>`;
  }
  const choixPossibles = effectif.filter((m) => m.profile_id !== t.captain_id && m.profiles?.status === 'active');
  return `
    <label class="champ cap-vice">Vice-capitaine <small>(mêmes accès que le capitaine)</small>
      <select data-vice data-liste="jamais">
        <option value="">Aucun</option>
        ${choixPossibles.map((m) => `<option value="${m.profile_id}" ${m.profile_id === t.vice_captain_id ? 'selected' : ''}>${esc(nomAffiche(m.profiles))}</option>`).join('')}
      </select>
    </label>`;
}

zone.addEventListener('change', async (e) => {
  const s = e.target.closest('select[data-vice]');
  if (!s) return;
  s.disabled = true;
  const { error } = await supabase.rpc('definir_vice_capitaine', { p_team: active, p_profile: s.value || null });
  s.disabled = false;
  if (error) { message(zoneMsg, error.code === 'P0001' ? error.message : erreurFr(error)); return afficher(); }
  const t = equipes.find((x) => x.id === active);
  t.vice_captain_id = s.value || null;
  message(zoneMsg, s.value ? `${s.selectedOptions[0].textContent} est vice-capitaine de ${t.name}.` : 'Plus de vice-capitaine pour cette équipe.', 'ok');
  afficher();
});

zone.addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.cap) {
    b.disabled = true;
    const { data, error } = await supabase.from('team_members').update({ status: b.dataset.cap })
      .eq('team_id', active).eq('profile_id', b.dataset.id).select('profile_id');
    if (error || !data?.length) { b.disabled = false; return message(zoneMsg, error ? erreurFr(error) : 'La demande n\'a pas pu être mise à jour.'); }
    message(zoneMsg, b.dataset.cap === 'accepted' ? 'Joueur ajouté à l\'équipe.' : 'Demande refusée.', 'ok');
    return afficher();
  }
  if (b.dataset.retirer) {
    const t = equipes.find((x) => x.id === active);
    if (!confirm(`Retirer ${b.dataset.nom} de l'équipe ${t.name} ?`)) return;
    const { data, error } = await supabase.from('team_members').delete().eq('team_id', active).eq('profile_id', b.dataset.retirer).select('profile_id');
    if (error) return message(zoneMsg, erreurFr(error));
    if (!data?.length) return message(zoneMsg, 'Ce joueur n\'a pas pu être retiré (le script SQL 037 est-il lancé ?).');
    message(zoneMsg, `${b.dataset.nom} a été retiré de l'équipe.`, 'ok');
    afficher();
  }
});

init();
