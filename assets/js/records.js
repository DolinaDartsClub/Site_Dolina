// =====================================================================
//  Records du club (membres connectés) : meilleure moyenne sur une partie
//  et plus haut finish, par trimestre de saison ou depuis toujours.
//  Trimestres de la saison (qui commence le 1er septembre) :
//  sept–nov, déc–fév, mars–mai, juin–août.
// =====================================================================

import { supabase, esc, profilConnecte, avatar, erreurFr } from './app.js?v=__VERSION__';
import { debutSaison, nomSaison } from './profil-commun.js?v=__VERSION__';

const acces = document.getElementById('acces');
const contenu = document.getElementById('contenu');
const grille = document.getElementById('rc-grille');
const choixSaison = document.getElementById('rc-saison');
const zoneTrimestres = document.getElementById('rc-trimestres');

const TRIMESTRES = [
  { nom: 'Sept – nov', mois: 0 },
  { nom: 'Déc – fév', mois: 3 },
  { nom: 'Mars – mai', mois: 6 },
  { nom: 'Juin – août', mois: 9 },
];
const fmtJour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const virgule = (n) => Number(n).toFixed(2).replace('.', ',');

let saison = debutSaison();          // Date du 1er septembre
let trimestre = trimestreDe(new Date()); // 0..3, ou 'tout' (depuis toujours), ou 'saison'
let jeu = '';

function trimestreDe(d) {
  const ecart = (d.getFullYear() - debutSaison(d).getFullYear()) * 12 + d.getMonth() - 8;
  return Math.floor(ecart / 3);
}
function bornes() {
  if (trimestre === 'tout') return [null, null];
  if (trimestre === 'saison') return [saison, new Date(saison.getFullYear() + 1, 8, 1)];
  const debut = new Date(saison.getFullYear(), 8 + TRIMESTRES[trimestre].mois, 1);
  return [debut, new Date(debut.getFullYear(), debut.getMonth() + 3, 1)];
}

function afficherFiltres() {
  const actuelle = debutSaison();
  const saisons = [];
  for (let a = actuelle.getFullYear(); a >= 2026; a--) saisons.push(new Date(a, 8, 1));
  if (!saisons.length) saisons.push(actuelle);
  choixSaison.innerHTML = saisons.map((s) => `<option value="${s.getFullYear()}"${s.getFullYear() === saison.getFullYear() ? ' selected' : ''}>${esc(nomSaison(s))}</option>`).join('');
  choixSaison.disabled = trimestre === 'tout';
  const enCours = saison.getFullYear() === actuelle.getFullYear() ? trimestreDe(new Date()) : 4;
  zoneTrimestres.innerHTML = TRIMESTRES.map((t, i) => `<button type="button" data-trimestre="${i}" aria-pressed="${trimestre === i}"${i > enCours ? ' disabled title="Trimestre pas encore commencé"' : ''}>${esc(t.nom)}${i === enCours ? ' <small>en cours</small>' : ''}</button>`).join('')
    + `<button type="button" data-trimestre="saison" aria-pressed="${trimestre === 'saison'}">Saison</button>`
    + `<button type="button" data-trimestre="tout" aria-pressed="${trimestre === 'tout'}">Depuis toujours</button>`;
  document.querySelectorAll('#rc-jeu [data-jeu]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.jeu === jeu)));
  const [d, f] = bornes();
  document.getElementById('rc-periode-texte').textContent = trimestre === 'tout'
    ? 'Tous les records depuis l\'ouverture du site.'
    : `Du ${fmtJour.format(d)} au ${fmtJour.format(new Date(f.getTime() - 86400000))}.`;
}

function carte(titre, icone, lignes, valeur, unite, vide) {
  const podium = lignes.slice(0, 3);
  const reste = lignes.slice(3);
  return `
    <section class="carte-info rc-carte">
      <h2 class="rc-carte__titre">${icone}${esc(titre)}</h2>
      ${lignes.length ? `
      <ol class="rc-podium">${podium.map((x, i) => `
        <li class="rc-podium__place rc-podium__place--${i + 1}">
          <a href="live.html?id=${encodeURIComponent(x.game_id)}" class="rc-podium__lien" title="Voir la partie">
            <span class="rc-rang">${i + 1}</span>
            ${avatar(x, i === 0 ? 'avatar--grand' : 'avatar--liste')}
            <span class="rc-podium__nom">${esc(x.nom)}</span>
            <span class="rc-valeur">${valeur(x)}<small>${unite}</small></span>
            <span class="rc-detail">${esc(x.adversaires ? `contre ${x.adversaires}` : '')}<br>${esc(fmtJour.format(new Date(x.quand)))} · ${esc(x.variant)}</span>
          </a>
        </li>`).join('')}
      </ol>
      ${reste.length ? `<ol class="rc-liste" start="4">${reste.map((x, i) => `
        <li><a href="live.html?id=${encodeURIComponent(x.game_id)}">
          <span class="rc-rang">${i + 4}</span>${avatar(x, 'avatar--liste')}
          <span class="rc-liste__nom">${esc(x.nom)}<small>${esc(fmtJour.format(new Date(x.quand)))}${x.adversaires ? ` · contre ${esc(x.adversaires)}` : ''}</small></span>
          <span class="rc-valeur">${valeur(x)}</span>
        </a></li>`).join('')}</ol>` : ''}`
    : `<p class="vide">${vide}</p>`}
    </section>`;
}

async function charger() {
  afficherFiltres();
  grille.innerHTML = '<p class="vide">Chargement…</p>';
  const [d, f] = bornes();
  const { data, error } = await supabase.rpc('records_club', {
    p_debut: d ? d.toISOString() : null, p_fin: f ? f.toISOString() : null, p_variant: jeu || null, p_limite: 10,
  });
  if (error) {
    grille.innerHTML = `<p class="vide">${esc(error.code === 'P0001' ? error.message : `Records indisponibles pour le moment (script SQL 032 à exécuter dans Supabase ?). ${erreurFr(error)}`)}</p>`;
    return;
  }
  const iconeMoy = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>';
  const iconeFin = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>';
  const vide = 'Pas encore de record sur cette période. Jouez des parties de club ou de ligue pour l\'inaugurer !';
  grille.innerHTML = carte('Meilleure moyenne sur une partie', iconeMoy, data.moyennes || [], (x) => virgule(x.moyenne), ' de moy.', vide)
    + carte('Plus haut finish', iconeFin, data.finishs || [], (x) => x.finish, '', vide);
}

zoneTrimestres.addEventListener('click', (e) => {
  const b = e.target.closest('[data-trimestre]');
  if (!b || b.disabled) return;
  trimestre = /^\d$/.test(b.dataset.trimestre) ? Number(b.dataset.trimestre) : b.dataset.trimestre;
  charger();
});
choixSaison.addEventListener('change', () => {
  saison = new Date(Number(choixSaison.value), 8, 1);
  if (saison.getFullYear() !== debutSaison().getFullYear() && typeof trimestre === 'number') trimestre = 'saison';
  if (saison.getFullYear() === debutSaison().getFullYear() && trimestre === 'saison') trimestre = trimestreDe(new Date());
  charger();
});
document.getElementById('rc-jeu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-jeu]');
  if (!b) return;
  jeu = b.dataset.jeu;
  charger();
});

async function init() {
  const moi = await profilConnecte().catch(() => null);
  if (!moi || moi.status !== 'active') {
    acces.hidden = false;
    acces.innerHTML = `<p class="vide">Les records du club sont réservés aux membres. ${moi ? 'Votre compte doit d\'abord être validé.' : '<a href="connexion.html">Se connecter</a>'}</p>`;
    return;
  }
  contenu.hidden = false;
  charger();
}

init();
