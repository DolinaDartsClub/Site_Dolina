// =====================================================================
//  Mes stats (ou celles d'un membre : stats.html?id=…)
//  Calculées par la base (fonction stats_joueur), réservées aux membres.
// =====================================================================

import { supabase, esc, profilConnecte } from './app.js?v=__VERSION__';

const zone = document.getElementById('stats');
const idDemande = new URLSearchParams(location.search).get('id');
const filtres = { periode: 'saison', jeu: '' };
let moi = null;
let idJoueur = null;

const virgule = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toFixed(d).replace('.', ','));
const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const fmtDateLongue = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// Saison : du 1er septembre au 31 août
function debutSaison(d = new Date()) {
  const annee = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(annee, 8, 1);
}

function bornes() {
  const maintenant = new Date();
  if (filtres.periode === 'mois') return { debut: new Date(maintenant.getFullYear(), maintenant.getMonth(), 1), fin: null };
  if (filtres.periode === 'saison') return { debut: debutSaison(maintenant), fin: null };
  return { debut: null, fin: null };
}

async function init() {
  moi = await profilConnecte();
  const acces = document.getElementById('acces');
  if (!moi) {
    acces.hidden = false;
    acces.innerHTML = '<p class="vide">Les statistiques sont réservées aux membres du club. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  if (moi.status !== 'active') {
    acces.hidden = false;
    acces.innerHTML = '<p class="vide">Votre compte doit être validé par un admin du club pour voir les statistiques.</p>';
    return;
  }
  idJoueur = idDemande || moi.id;
  const saison = debutSaison();
  document.getElementById('btn-saison').textContent = `Saison ${saison.getFullYear()}-${saison.getFullYear() + 1}`;
  document.getElementById('contenu').hidden = false;
  if (idJoueur !== moi.id) document.getElementById('lien-parties').hidden = true;
  charger();
}

async function charger() {
  zone.innerHTML = '<p class="vide">Calcul des statistiques…</p>';
  const { debut, fin } = bornes();
  const { data, error } = await supabase.rpc('stats_joueur', {
    p_profile: idJoueur,
    p_debut: debut ? debut.toISOString() : null,
    p_fin: fin ? fin.toISOString() : null,
    p_variant: filtres.jeu || null,
  });
  if (error) {
    zone.innerHTML = `<p class="vide">${esc(error.code === 'P0001' ? error.message : 'Statistiques indisponibles pour le moment (script SQL 019 à exécuter dans Supabase ?).')}</p>`;
    return;
  }
  afficher(data);
}

function tuile(titre, valeur, detail = '', principale = false) {
  return `
    <div class="s-tuile${principale ? ' s-tuile--principale' : ''}">
      <span class="s-tuile__titre">${titre}</span>
      <span class="s-tuile__valeur">${valeur}</span>
      ${detail ? `<span class="s-tuile__detail">${detail}</span>` : ''}
    </div>`;
}

function afficher(s) {
  derniereStats = s;
  const nom = s.joueur?.nom || 'Joueur';
  const autre = idJoueur !== moi.id;
  document.getElementById('titre-stats').textContent = autre ? `Stats de ${nom}` : 'Mes stats';
  document.getElementById('titre-page').textContent = autre ? nom : 'Mes stats';
  document.title = `${autre ? `Stats de ${nom}` : 'Mes stats'} – Dolina Darts Club`;

  if (!s.parties) {
    zone.innerHTML = `<p class="vide">Aucune partie comptée sur cette période.${autre ? '' : ' <a href="jouer.html">Lancer un match</a>'}</p>`;
    return;
  }
  const moyenne = s.flechettes ? (s.points / s.flechettes) * 3 : null;
  const neuf = s.flechettes_9 ? (s.points_9 / s.flechettes_9) * 3 : null;
  const double = s.flechettes_double ? (s.finishs / s.flechettes_double) * 100 : null;
  const pctVictoires = s.parties_bilan ? (s.victoires / s.parties_bilan) * 100 : null;

  zone.innerHTML = `
    <section class="s-grille s-grille--haut" aria-label="Moyennes">
      ${tuile('Moyenne 3 fléchettes', virgule(moyenne), `${s.flechettes} fléchettes · ${s.parties} partie${s.parties > 1 ? 's' : ''}`, true)}
      ${tuile('9 premières fléchettes', virgule(neuf), 'Moyenne des 3 premières volées')}
      ${tuile('Réussite au double', double === null ? '–' : `${virgule(double)} %`, `${s.finishs} finish${s.finishs > 1 ? 's' : ''} / ${s.flechettes_double} fléchette${s.flechettes_double > 1 ? 's' : ''} au double`)}
      ${tuile('Meilleur finish', s.meilleur_finish ?? '–')}
    </section>

    <section class="section s-section" aria-labelledby="t-bilan">
      <h2 class="section__titre" id="t-bilan">Bilan</h2>
      <div class="s-grille">
        ${tuile('Victoires – défaites', `${s.victoires} – ${s.defaites}`, pctVictoires === null ? 'Aucun match contre un adversaire' : `${virgule(pctVictoires, 0)} % de victoires · ${s.parties_bilan} match${s.parties_bilan > 1 ? 's' : ''}`)}
        ${tuile('Manches gagnées – perdues', `${s.manches_gagnees} – ${s.manches_perdues}`)}
      </div>
    </section>

    <section class="section s-section" aria-labelledby="t-records">
      <h2 class="section__titre" id="t-records">Volées et records</h2>
      <div class="s-grille s-grille--petite">
        ${tuile('180', s.nb_180)}
        ${tuile('140 et +', s.nb_140)}
        ${tuile('100 et +', s.nb_100)}
        ${tuile('Meilleure volée', s.meilleure_volee ?? '–')}
        ${tuile('Meilleure moyenne de partie', virgule(s.meilleure_moyenne_partie))}
        ${tuile('Manche la plus courte', s.manche_courte_501 ? `${s.manche_courte_501} fl.` : '–', '501')}
        ${tuile('Manche la plus courte', s.manche_courte_301 ? `${s.manche_courte_301} fl.` : '–', '301')}
      </div>
    </section>

    <section class="section s-section" aria-labelledby="t-evolution">
      <h2 class="section__titre" id="t-evolution">Évolution de la moyenne</h2>
      ${courbe(s.evolution || [])}
    </section>`;
  brancherCourbe(s.evolution || []);
}

// ---------- Courbe : une moyenne par partie (60 dernières) ----------

// Largeur réelle du cadre : le texte garde sa taille sur téléphone comme sur ordinateur
let L = 640;
const H = 240;
const M = { haut: 16, droite: 16, bas: 28, gauche: 40 };

function echelle(pts) {
  const vals = pts.map((p) => Number(p.moyenne));
  const min = Math.max(0, Math.floor((Math.min(...vals) - 5) / 10) * 10);
  const brut = Math.ceil((Math.max(...vals) + 5) / 10) * 10;
  const pasGrille = Math.max(10, Math.ceil((brut - min) / 4 / 10) * 10);   // graduations rondes
  const max = min + 4 * pasGrille;
  const x = (i) => M.gauche + (pts.length === 1 ? (L - M.gauche - M.droite) / 2 : (i * (L - M.gauche - M.droite)) / (pts.length - 1));
  const y = (v) => M.haut + ((max - v) * (H - M.haut - M.bas)) / (max - min);
  return { min, max, x, y };
}

function courbe(pts) {
  L = Math.max(300, Math.min(900, (zone.clientWidth || 640) - 10));
  if (pts.length < 2) {
    return '<p class="vide">La courbe apparaît à partir de 2 parties sur la période.</p>';
  }
  const { min, max, x, y } = echelle(pts);
  const pas = (max - min) / 4;
  const grilles = Array.from({ length: 5 }, (_, i) => min + i * pas).map((v) => `
    <line x1="${M.gauche}" x2="${L - M.droite}" y1="${y(v)}" y2="${y(v)}" class="c-grille"/>
    <text x="${M.gauche - 6}" y="${y(v) + 4}" class="c-axe" text-anchor="end">${Math.round(v)}</text>`).join('');
  const chemin = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.moyenne).toFixed(1)}`).join(' ');
  const etiquettes = [0, Math.floor((pts.length - 1) / 2), pts.length - 1]
    .filter((v, i, t) => t.indexOf(v) === i)
    .map((i) => `<text x="${x(i)}" y="${H - 8}" class="c-axe" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${esc(fmtDate.format(new Date(pts[i].date)))}</text>`).join('');
  const derniers = pts.length - 1;
  return `
    <div class="c-cadre">
      <svg class="c-svg" viewBox="0 0 ${L} ${H}" role="img" aria-label="Moyenne 3 fléchettes de chaque partie, de ${esc(fmtDateLongue.format(new Date(pts[0].date)))} à ${esc(fmtDateLongue.format(new Date(pts[derniers].date)))}">
        ${grilles}
        <path d="${chemin}" class="c-ligne"/>
        ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.moyenne)}" r="${i === derniers ? 5 : 3.5}" class="c-point${i === derniers ? ' c-point--dernier' : ''}"/>`).join('')}
        <text x="${x(derniers) - 8}" y="${y(pts[derniers].moyenne) - 10}" class="c-valeur" text-anchor="end">${virgule(pts[derniers].moyenne)}</text>
        <line class="c-repere" x1="0" x2="0" y1="${M.haut}" y2="${H - M.bas}" hidden/>
        ${etiquettes}
        <rect class="c-zone" x="${M.gauche}" y="0" width="${L - M.gauche - M.droite}" height="${H}" fill="transparent"/>
      </svg>
      <div class="c-info" hidden></div>
    </div>
    <details class="c-tableau">
      <summary>Voir les données</summary>
      <table class="p-tableau">
        <thead><tr><th>Date</th><th>Jeu</th><th>Moyenne</th></tr></thead>
        <tbody>${[...pts].reverse().map((p) => `<tr><td>${esc(fmtDateLongue.format(new Date(p.date)))}</td><td>${esc(p.variant)}</td><td>${virgule(p.moyenne)}</td></tr>`).join('')}</tbody>
      </table>
    </details>`;
}

// Survol : repère vertical et bulle sur la partie la plus proche
function brancherCourbe(pts) {
  const svg = zone.querySelector('.c-svg');
  if (!svg || pts.length < 2) return;
  const { x, y } = echelle(pts);
  const repere = svg.querySelector('.c-repere');
  const info = zone.querySelector('.c-info');
  const cadre = zone.querySelector('.c-cadre');
  const deplacer = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * L;
    let i = 0;
    pts.forEach((_, k) => { if (Math.abs(x(k) - px) < Math.abs(x(i) - px)) i = k; });
    repere.setAttribute('x1', x(i));
    repere.setAttribute('x2', x(i));
    repere.hidden = false;
    const p = pts[i];
    info.innerHTML = `<strong>${virgule(p.moyenne)}</strong><span>${esc(fmtDateLongue.format(new Date(p.date)))} · ${esc(p.variant)}</span>`;
    info.hidden = false;
    const gauche = (x(i) / L) * r.width;
    const haut = (y(p.moyenne) / H) * r.height;
    info.style.left = `${Math.min(Math.max(gauche, 60), r.width - 60)}px`;
    info.style.top = `${haut}px`;
  };
  const cacher = () => { repere.hidden = true; info.hidden = true; };
  svg.addEventListener('pointermove', deplacer);
  svg.addEventListener('pointerdown', deplacer);
  svg.addEventListener('pointerleave', cacher);
  cadre.addEventListener('blur', cacher, true);
}

// Redessiner la courbe si la largeur change (rotation du téléphone…)
let derniereStats = null;
let attenteRedim = null;
window.addEventListener('resize', () => {
  clearTimeout(attenteRedim);
  attenteRedim = setTimeout(() => { if (derniereStats) afficher(derniereStats); }, 250);
});

// ---------- Filtres ----------

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
