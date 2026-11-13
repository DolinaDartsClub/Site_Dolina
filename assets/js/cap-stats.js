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
    supabase.rpc('classement_membres', { ...bornes(), p_variant: reglages.jeu || null, p_equipe: t.id, p_tous: true }),
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
    <p class="match__format cs-note">Parties de 301 et 501 contre un adversaire, hors matchs amicaux et dartbot (parties de club comprises, comme « Mes stats »). Forme : 5 dernières parties, la plus récente à gauche.</p>`;
}

// Bilan CPARD (script 072) : cumul des feuilles de match validées, joueurs réellement alignés
let triCpard = 'gagnes';
async function blocCpard(zone, t) {
  zone.innerHTML = '<p class="vide">Chargement…</p>';
  const b = bornes();
  const debut = b.p_debut ? new Date(b.p_debut).toLocaleDateString('fr-CA') : null;
  const { data, error } = await supabase.rpc('stats_cpard_equipe', { p_team: t.id, p_debut: debut });
  if (error) {
    zone.innerHTML = `<p class="vide">${/stats_cpard_equipe|schema cache|function/i.test(error.message) ? 'Bilan CPARD bientôt disponible (script 072 à exécuter dans Supabase).' : esc(error.message)}</p>`;
    return;
  }
  const liste = (data?.joueurs || []).map((x) => {
    const g = x.simples_g + x.doubles_g; const joues = g + x.simples_p + x.doubles_p;
    return { ...x, g, joues, pct: joues ? Math.round((g / joues) * 100) : 0 };
  });
  if (!liste.length) { zone.innerHTML = '<p class="vide">Aucune feuille de match validée sur la période.</p>'; return; }
  const ordre = {
    gagnes: (a, c) => c.g - a.g || c.pct - a.pct,
    pct: (a, c) => c.pct - a.pct || c.joues - a.joues,
    joues: (a, c) => c.joues - a.joues || c.g - a.g,
    journees: (a, c) => c.rencontres - a.rencontres || c.joues - a.joues,
  };
  const dessiner = () => {
    const j = [...liste].sort(ordre[triCpard] || ordre.gagnes);
    const ligne = (lib, g, p, mg, mp) => {
      const n = g + p;
      return `<span><b>${lib}</b> ${n ? `${n} joué${n > 1 ? 's' : ''}, <em>${g} gagné${g > 1 ? 's' : ''}</em> · ${Math.round((g / n) * 100)} %` : 'aucun'}${mg !== undefined && n ? ` <i>· manches ${mg}–${mp}</i>` : ''}</span>`;
    };
    zone.innerHTML = `
      <div class="cs-cp-tete">
        <p class="match__format" style="margin:0"><strong>${data.feuilles}</strong> journée${data.feuilles > 1 ? 's' : ''} jouée${data.feuilles > 1 ? 's' : ''} (feuilles validées)</p>
        <label class="cs-cp-tri">Trier par
          <select data-tri-cpard>
            ${[['gagnes', 'Matchs gagnés'], ['pct', '% de victoires'], ['joues', 'Matchs joués'], ['journees', 'Nombre de journées']].map(([v, l]) => `<option value="${v}"${v === triCpard ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
      <table class="cs-cp">
        <thead><tr><th>Joueur</th><th>Nombre de<br>journées</th><th>Matchs<br>joués</th><th>Matchs<br>gagnés</th><th>%</th></tr></thead>
        <tbody>${j.map((x, i) => `
          <tr class="cs-cp-ligne" data-detail="${i}" tabindex="0" aria-expanded="false">
            <th scope="row"><span class="cs-cp-nom">${esc(x.nom)}</span>${x.profile_id ? '' : '<small>invité</small>'}</th>
            <td>${x.rencontres}</td>
            <td>${x.joues}</td>
            <td class="cs-cp-g">${x.g}</td>
            <td class="cs-cp-pct"><span class="cs-cp-barre"><span style="width:${x.pct}%"></span></span><strong>${x.pct} %</strong></td>
          </tr>
          <tr class="cs-cp-detail" id="cs-cp-d${i}" hidden><td colspan="5">
            ${ligne('Simples', x.simples_g, x.simples_p, x.manches_simples_g, x.manches_simples_p)}
            ${ligne('Doubles', x.doubles_g, x.doubles_p, x.manches_doubles_g, x.manches_doubles_p)}
            <span><b>Manches</b> ${x.manches_g} gagnées, ${x.manches_p} perdues${x.profile_id ? ` · <a href="profil.html?id=${encodeURIComponent(x.profile_id)}">voir son profil</a>` : ''}</span>
          </td></tr>`).join('')}
        </tbody>
      </table>
      <p class="match__format cs-note">Touchez un joueur pour le détail simples / doubles / manches. Journées = feuilles de match où il a été aligné (remplacements compris) ; un double compte pour les deux joueurs de la paire.</p>`;
    zone.querySelector('[data-tri-cpard]').addEventListener('change', (e) => { triCpard = e.target.value; dessiner(); });
    zone.querySelectorAll('[data-detail]').forEach((tr) => {
      const basculer = () => {
        const d = zone.querySelector(`#cs-cp-d${tr.dataset.detail}`);
        d.hidden = !d.hidden;
        tr.setAttribute('aria-expanded', String(!d.hidden));
      };
      tr.addEventListener('click', (e) => { if (!e.target.closest('a')) basculer(); });
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); basculer(); } });
    });
  };
  dessiner();
}

export async function afficherStatsEquipe(conteneur, t, effectif) {
  conteneur.innerHTML = `
    <h2 class="section__titre">Statistiques <span class="section__aide">${esc(nomSaison())}</span></h2>
    <div id="cs-bilan"><p class="vide">Chargement…</p></div>
    <h3 class="cs-sous-titre">Championnat CPARD</h3>
    <div id="cs-cpard"></div>
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
    if (s.dataset.cs === 'periode') blocCpard(zoneCpard, t);
  }));
  const zoneCpard = conteneur.querySelector('#cs-cpard');
  blocCpard(zoneCpard, t);
  await blocJoueurs(zone, t, effectif);
}
