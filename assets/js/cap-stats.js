// =====================================================================
//  Espace capitaine : statistiques de l'équipe
//  - Bilan des rencontres de championnat de la saison (V / N / D, points)
//  - Stats de chaque joueur (mêmes parties que le classement) et sa forme
//    sur ses 5 dernières parties (script 037)
// =====================================================================

import { supabase, esc, avatar, nomAffiche } from './app.js?v=__VERSION__';
import { debutSaison, nomSaison } from './profil-commun.js?v=__VERSION__';

const virgule = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const PERIODES = { saison: 'Saison', mois: '30 derniers jours', tout: 'Depuis le début' };
let reglages = { periode: 'saison', jeu: '' };

function bornes() {
  if (reglages.periode === 'saison') return { p_debut: debutSaison().toISOString(), p_fin: null };
  if (reglages.periode === 'mois') return { p_debut: new Date(Date.now() - 30 * 86400000).toISOString(), p_fin: null };
  return { p_debut: null, p_fin: null };
}

function depuis(date) {
  if (!date) return 'jamais joué';
  const j = Math.floor((Date.now() - Date.parse(date)) / 86400000);
  return j <= 0 ? 'joué aujourd\'hui' : j === 1 ? 'joué hier' : `dernière partie il y a ${j} j`;
}

// Bilan de l'équipe en championnat (rencontres de la saison avec un score)
async function blocBilan(t) {
  const { data } = await supabase.from('rencontres').select('date_match, score_nous, score_eux, adversaire, domicile')
    .eq('team_id', t.id).not('score_nous', 'is', null)
    .gte('date_match', debutSaison().toLocaleDateString('fr-CA')).order('date_match');
  const r = data || [];
  if (!r.length) return `<p class="match__format">${esc(nomSaison())} : aucune rencontre jouée pour l'instant.</p>`;
  const code = (x) => (x.score_nous > x.score_eux ? 'V' : x.score_nous < x.score_eux ? 'D' : 'N');
  const n = { V: 0, N: 0, D: 0 };
  r.forEach((x) => { n[code(x)] += 1; });
  const pour = r.reduce((s, x) => s + x.score_nous, 0);
  const contre = r.reduce((s, x) => s + x.score_eux, 0);
  const forme = r.slice(-5).map((x) => `<span class="cs-forme__pt cs-forme__pt--${code(x)}" title="${esc(`${x.adversaire} : ${x.score_nous}-${x.score_eux}`)}">${code(x)}</span>`).join('');
  return `
    <div class="cs-bilan">
      <div class="cs-tuile"><b>${r.length}</b><span>Rencontre${r.length > 1 ? 's' : ''}</span></div>
      <div class="cs-tuile cs-tuile--v"><b>${n.V}</b><span>Victoire${n.V > 1 ? 's' : ''}</span></div>
      <div class="cs-tuile"><b>${n.N}</b><span>Nul${n.N > 1 ? 's' : ''}</span></div>
      <div class="cs-tuile"><b>${n.D}</b><span>Défaite${n.D > 1 ? 's' : ''}</span></div>
      <div class="cs-tuile"><b>${pour}<i>–</i>${contre}</b><span>Points pour / contre</span></div>
      <div class="cs-tuile"><b>${virgule(pour / r.length)}</b><span>Points par rencontre</span></div>
    </div>
    <p class="cs-forme"><span class="cs-forme__titre">Forme</span><span class="cs-forme__liste">${forme}</span><small>5 dernières rencontres</small></p>`;
}

const pastillesForme = (liste) => `<span class="cs-forme__liste">${liste.map((x) => `<span class="cs-forme__pt cs-forme__pt--${x}">${x}</span>`).join('')}</span>`;

// Carte d'un joueur qui a joué sur la période : identité + moyenne, puis 6 chiffres clés et sa forme
function carteJoueur(m, l, f) {
  const p = m.profiles;
  const lien = `profil.html?id=${encodeURIComponent(m.profile_id)}`;
  const moy = l.flechettes ? (l.points / l.flechettes) * 3 : null;
  const neuf = l.flechettes_9 ? (l.points_9 / l.flechettes_9) * 3 : null;
  const co = l.flechettes_double ? (l.finishs / l.flechettes_double) * 100 : null;
  const sous = f ? [depuis(f.derniere), f.parties_30j ? `${f.parties_30j} partie${f.parties_30j > 1 ? 's' : ''} en 30 j` : ''].filter(Boolean).join(' · ') : `${l.matchs} partie${l.matchs > 1 ? 's' : ''}`;
  return `
    <article class="cs-joueur">
      <a class="cs-joueur__tete" href="${lien}">
        ${avatar(p, 'cs-avatar')}
        <span class="cs-joueur__id"><strong>${esc(l.nom)}</strong><small>${esc(sous)}</small></span>
        <span class="cs-joueur__moy"><b>${virgule(moy, 2)}</b><small>moyenne</small></span>
      </a>
      <div class="cs-grille">
        <span><b>${virgule(neuf, 2)}</b><small>9 premières</small></span>
        <span><b>${co === null ? '–' : `${virgule(co, 1)} %`}</b><small>Checkout</small></span>
        <span><b>${l.victoires}<i>/</i>${l.matchs}</b><small>Victoires</small></span>
        <span><b>${l.meilleur_finish ?? '–'}</b><small>Meilleur finish</small></span>
        <span><b>${l.nb_180}</b><small>180</small></span>
        <span><b>${l.manches_gagnees}<i>–</i>${l.manches_perdues}</b><small>Manches</small></span>
      </div>
      ${f?.forme?.length ? `<p class="cs-forme cs-forme--joueur"><span class="cs-forme__titre">Forme</span>${pastillesForme(f.forme)}</p>` : ''}
    </article>`;
}

// Joueurs sans partie sur la période : une ligne compacte de pastilles
function sansPartie(liste) {
  if (!liste.length) return '';
  return `
    <div class="cs-sans">
      <span class="cs-sans__titre">Pas de partie sur la période <b>${liste.length}</b></span>
      <div class="cs-sans__liste">${liste.map((m) => `<a class="cs-sans__joueur" href="profil.html?id=${encodeURIComponent(m.profile_id)}">${avatar(m.profiles, 'cs-avatar cs-avatar--petit')}<span>${esc(nomAffiche(m.profiles))}</span></a>`).join('')}</div>
    </div>`;
}

async function blocJoueurs(zone, t, effectif) {
  zone.innerHTML = '<p class="vide">Chargement des statistiques…</p>';
  const [rc, rf] = await Promise.all([
    supabase.rpc('classement_membres', { ...bornes(), p_variant: reglages.jeu || null, p_equipe: t.id }),
    supabase.rpc('forme_equipe', { p_equipe: t.id, p_n: 5 }),
  ]);
  if (rc.error) { zone.innerHTML = `<p class="vide">Statistiques indisponibles : ${esc(rc.error.message)}</p>`; return; }
  const lignes = new Map((rc.data?.joueurs || []).map((l) => [l.profile_id, l]));
  const formes = new Map((rf.error ? [] : rf.data || []).map((f) => [f.profile_id, f]));
  const moy = (m) => { const l = lignes.get(m.profile_id); return l?.flechettes ? l.points / l.flechettes : -1; };
  const tries = [...effectif].sort((a, b) => moy(b) - moy(a));
  const actifs = tries.filter((m) => lignes.get(m.profile_id)?.flechettes);
  const inactifs = tries.filter((m) => !lignes.get(m.profile_id)?.flechettes);
  // Moyenne de l'équipe : toutes les fléchettes de ses joueurs sur la période
  const tous = [...lignes.values()];
  const pts = tous.reduce((s, l) => s + l.points, 0);
  const fl = tous.reduce((s, l) => s + l.flechettes, 0);
  zone.innerHTML = `
    ${fl ? `<p class="match__format cs-resume">Moyenne de l'équipe : <strong>${virgule((pts / fl) * 3, 2)}</strong> · ${tous.reduce((s, l) => s + l.matchs, 0)} parties jouées par ses joueurs</p>` : ''}
    ${actifs.length ? `<div class="cs-joueurs">${actifs.map((m) => carteJoueur(m, lignes.get(m.profile_id), formes.get(m.profile_id))).join('')}</div>` : ''}
    ${sansPartie(inactifs)}
    ${effectif.length ? '' : '<p class="vide">Aucun joueur dans l\'équipe.</p>'}
    <p class="match__format cs-note">Parties de 301 et 501 contre un adversaire, hors matchs amicaux et dartbot (comme le classement). Forme : 5 dernières parties, la plus récente à gauche.</p>`;
}

export async function afficherStatsEquipe(conteneur, t, effectif) {
  conteneur.innerHTML = `
    <h2 class="section__titre">Statistiques <span class="section__aide">${esc(nomSaison())}</span></h2>
    <div id="cs-bilan"><p class="vide">Chargement…</p></div>
    <h3 class="cs-sous-titre">Joueurs</h3>
    <div class="cs-filtres">
      <label class="champ">Période<select data-cs="periode">${Object.entries(PERIODES).map(([v, l]) => `<option value="${v}" ${reglages.periode === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="champ">Jeu<select data-cs="jeu"><option value="">301 et 501</option><option value="501" ${reglages.jeu === '501' ? 'selected' : ''}>501</option><option value="301" ${reglages.jeu === '301' ? 'selected' : ''}>301</option></select></label>
    </div>
    <div id="cs-joueurs"></div>`;
  conteneur.querySelector('#cs-bilan').innerHTML = await blocBilan(t);
  const zone = conteneur.querySelector('#cs-joueurs');
  conteneur.querySelectorAll('[data-cs]').forEach((s) => s.addEventListener('change', () => {
    reglages[s.dataset.cs] = s.value;
    blocJoueurs(zone, t, effectif);
  }));
  await blocJoueurs(zone, t, effectif);
}
