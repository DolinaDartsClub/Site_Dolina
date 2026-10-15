// =====================================================================
//  Tournois : mes tournois, créer un tournoi, rejoindre avec un code
// =====================================================================

import { supabase, esc, profilConnecte, erreurFr, nomAffiche } from './app.js?v=__VERSION__';
import { badgeStatut, resumeFormat, normaliserCode, choisirMembre } from './tournoi-commun.js?v=__VERSION__';

const zoneAcces = document.getElementById('acces');
const contenu = document.getElementById('contenu');
const formCode = document.getElementById('form-code');
const champCode = document.getElementById('code');
const erreurCode = document.getElementById('erreur-code');
const apercu = document.getElementById('apercu');

let moi = null;
let tournoiTrouve = null;
let partenaire = null;        // membre choisi comme partenaire (double)

async function init() {
  moi = await profilConnecte();
  if (!moi) {
    zoneAcces.hidden = false;
    zoneAcces.innerHTML = '<p class="vide">Connectez-vous pour créer ou rejoindre un tournoi. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  if (moi.status !== 'active') {
    zoneAcces.hidden = false;
    zoneAcces.innerHTML = '<p class="vide">Votre compte doit être validé par un admin du club pour participer aux tournois.</p>';
    return;
  }
  contenu.hidden = false;
  // Lien partagé : tournois.html?code=K7DX4P
  const code = new URLSearchParams(location.search).get('code');
  if (code) {
    champCode.value = normaliserCode(code);
    chercher();
  } else if (location.hash === '#code') {
    champCode.focus();
  }
  chargerTournois();
}

// ---------- Mes tournois ----------

async function chargerTournois() {
  const zone = document.getElementById('mes-tournois');
  const [{ data: tournois, error }, { data: inscriptions }] = await Promise.all([
    supabase.from('tournaments')
      .select('id, code, name, format, team_mode, pool_qualifiers, status, max_participants, created_by, created_at, tournament_entries(count)')
      .order('created_at', { ascending: false }),
    supabase.from('tournament_entries').select('tournament_id')
      .or(`profile_id.eq.${moi.id},partner_profile_id.eq.${moi.id}`),
  ]);
  if (error) {
    zone.innerHTML = `<p class="vide">Impossible de charger les tournois pour le moment. ${esc(erreurFr(error))}</p>`;
    return;
  }
  const inscrit = new Set((inscriptions || []).map((i) => i.tournament_id));
  const miens = tournois.filter((t) => t.created_by === moi.id || inscrit.has(t.id));
  const autres = tournois.filter((t) => !miens.includes(t));   // visibles seulement par un admin

  zone.innerHTML = miens.length
    ? miens.map((t) => carte(t, inscrit.has(t.id))).join('')
    : '<p class="vide">Vous ne participez à aucun tournoi pour l\'instant. Créez-en un ou rejoignez-en un avec son code.</p>';

  document.getElementById('bloc-admin').hidden = !autres.length;
  document.getElementById('autres-tournois').innerHTML = autres.map((t) => carte(t, false)).join('');
}

function carte(t, inscrit) {
  const nb = t.tournament_entries?.[0]?.count ?? 0;
  const roles = [];
  if (t.created_by === moi.id) roles.push('<span class="t-role">Organisateur</span>');
  if (inscrit) roles.push('<span class="t-role t-role--joueur">Inscrit</span>');
  return `
    <a class="t-carte" href="tournoi.html?id=${encodeURIComponent(t.id)}">
      <span class="t-carte__haut">${badgeStatut(t.status)}${roles.join('')}</span>
      <strong class="t-carte__nom">${esc(t.name)}</strong>
      <span class="t-carte__format">${esc(resumeFormat(t))}</span>
      <span class="t-carte__bas">
        <span>${nb} / ${t.max_participants} inscrit${nb > 1 ? 's' : ''}</span>
        <span class="t-code-mini">Code <b>${esc(t.code)}</b></span>
      </span>
    </a>`;
}

// ---------- Rejoindre avec un code ----------

champCode.addEventListener('input', () => {
  const pos = champCode.value.length;
  champCode.value = champCode.value.toUpperCase();
  champCode.setSelectionRange(pos, pos);
  erreurCode.textContent = '';
});

formCode.addEventListener('submit', (e) => {
  e.preventDefault();
  chercher();
});

async function chercher() {
  const code = normaliserCode(champCode.value);
  erreurCode.textContent = '';
  apercu.hidden = true;
  if (code.length !== 6) {
    erreurCode.textContent = 'Le code d\'un tournoi compte 6 caractères (lettres et chiffres).';
    champCode.focus();
    return;
  }
  const bouton = formCode.querySelector('button');
  bouton.disabled = true;
  const { data, error } = await supabase.rpc('apercu_tournoi', { p_code: code });
  bouton.disabled = false;
  if (error) {
    erreurCode.textContent = erreurFr(error);
    return;
  }
  tournoiTrouve = data;
  partenaire = null;
  afficherApercu();
}

function afficherApercu() {
  const t = tournoiTrouve;
  const places = t.max_participants - t.inscrits;
  let action = '';
  if (t.deja_inscrit) {
    action = `<p class="message message--ok">Vous êtes déjà inscrit à ce tournoi.</p>
      <a class="bouton bouton--plein" href="tournoi.html?id=${encodeURIComponent(t.id)}">Ouvrir le tournoi</a>`;
  } else if (t.status === 'draft') {
    action = '<p class="message message--erreur">Les inscriptions à ce tournoi ne sont pas encore ouvertes. Réessayez plus tard ou contactez l\'organisateur.</p>';
  } else if (t.status === 'running') {
    action = '<p class="message message--erreur">Les inscriptions sont terminées : ce tournoi a déjà commencé.</p>';
  } else if (t.status === 'finished') {
    action = '<p class="message message--erreur">Ce tournoi est terminé.</p>';
  } else if (places <= 0) {
    action = `<p class="message message--erreur">Le tournoi est complet (${t.max_participants} places).</p>`;
  } else {
    action = `
      ${t.team_mode === 'double' ? `
        <div class="t-doublette">
          <p class="match__format" style="margin:0">Tournoi en double : inscrivez votre doublette. Vous en êtes le joueur 1, avec votre compte.</p>
          <label class="champ">Nom de la doublette<input type="text" id="nom-equipe" maxlength="40" required></label>
          <div class="champ"><span>Partenaire</span>
            <div class="t-partenaire" id="zone-partenaire"></div>
          </div>
        </div>` : ''}
      <p class="t-erreur" id="erreur-rejoindre" role="alert"></p>
      <button type="button" class="bouton bouton--plein" id="btn-rejoindre">Rejoindre le tournoi</button>`;
  }
  apercu.innerHTML = `
    <div class="t-apercu__haut">${badgeStatut(t.status)}<span class="t-code-mini">Code <b>${esc(t.code)}</b></span></div>
    <h2>${esc(t.name)}</h2>
    <span class="match__format">${esc(resumeFormat(t))} · organisé par ${esc(t.organisateur || '—')}</span>
    ${t.description ? `<p class="t-description">${esc(t.description)}</p>` : ''}
    <span class="t-places">${t.inscrits} / ${t.max_participants} inscrits · ${places > 0 ? `${places} place${places > 1 ? 's' : ''} disponible${places > 1 ? 's' : ''}` : 'complet'}</span>
    ${action}`;
  apercu.hidden = false;
  if (t.team_mode === 'double' && !t.deja_inscrit) afficherPartenaire();
  document.getElementById('btn-rejoindre')?.addEventListener('click', rejoindre);
  apercu.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function afficherPartenaire() {
  const zone = document.getElementById('zone-partenaire');
  if (!zone) return;
  const erreur = document.getElementById('erreur-rejoindre');
  if (erreur) erreur.textContent = '';
  zone.innerHTML = partenaire
    ? `<span class="puce">${esc(nomAffiche(partenaire))} <button type="button" class="puce__retirer" id="retirer-partenaire" aria-label="Retirer le partenaire">✕</button></span>`
    : `<button type="button" class="bouton bouton--petit" id="choisir-partenaire">Choisir un membre</button>
       <span class="t-ou">ou</span>
       <input type="text" id="partenaire-invite" maxlength="40" placeholder="Nom d'un invité (sans compte)" aria-label="Nom du partenaire invité">`;
  document.getElementById('choisir-partenaire')?.addEventListener('click', async () => {
    const m = await choisirMembre({ titre: 'Choisir votre partenaire', exclure: new Set([moi.id]) });
    if (m) { partenaire = m; afficherPartenaire(); }
  });
  document.getElementById('retirer-partenaire')?.addEventListener('click', () => { partenaire = null; afficherPartenaire(); });
}

async function rejoindre() {
  const bouton = document.getElementById('btn-rejoindre');
  const erreur = document.getElementById('erreur-rejoindre');
  erreur.textContent = '';
  const params = { p_code: tournoiTrouve.code };
  if (tournoiTrouve.team_mode === 'double') {
    params.p_team_name = document.getElementById('nom-equipe').value.trim();
    params.p_partner_profile = partenaire?.id || null;
    params.p_partner_guest = partenaire ? null : (document.getElementById('partenaire-invite')?.value.trim() || null);
    if (!params.p_team_name) { erreur.textContent = 'Donnez un nom à la doublette.'; return; }
    if (!params.p_partner_profile && !params.p_partner_guest) { erreur.textContent = 'Indiquez votre partenaire (membre ou invité).'; return; }
  }
  bouton.disabled = true;          // pas de double inscription par double clic
  bouton.textContent = 'Inscription…';
  const { data, error } = await supabase.rpc('rejoindre_tournoi', params);
  if (error) {
    bouton.disabled = false;
    bouton.textContent = 'Rejoindre le tournoi';
    erreur.textContent = erreurFr(error);
    return;
  }
  location.href = `tournoi.html?id=${encodeURIComponent(data)}&inscrit=1`;
}

init();
