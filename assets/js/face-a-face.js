// =====================================================================
//  Face-à-face : deux membres (1 contre 1) ou deux doublettes (2 contre 2)
//  face-a-face.html?a=<id>&b=<id>  ·  face-a-face.html?mode=doublettes&a=<clé>&b=<clé>
// =====================================================================

import { supabase, esc, profilConnecte, nomAffiche, avatar } from './app.js?v=__VERSION__';
import { choisirMembre } from './tournoi-commun.js?v=__VERSION__';

const params = new URLSearchParams(location.search);
const zone = document.getElementById('resultat');
let mode = params.get('mode') === 'doublettes' ? 'doublettes' : 'joueurs';
const filtres = { periode: 'tout', jeu: '' };
let moi = null;
let choix = { a: null, b: null };          // joueurs : { id, nom } ; doublettes : { cle, noms }
let doublettes = null;

const virgule = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '–' : Number(n).toFixed(d).replace('.', ','));
const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
function debutSaison(d = new Date()) {
  const annee = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return new Date(annee, 8, 1);
}

async function init() {
  moi = await profilConnecte();
  const acces = document.getElementById('acces');
  if (!moi || moi.status !== 'active') {
    acces.hidden = false;
    acces.innerHTML = moi
      ? '<p class="vide">Votre compte doit être validé par un admin du club.</p>'
      : '<p class="vide">Le face-à-face est réservé aux membres du club. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  const s = debutSaison();
  document.getElementById('btn-saison').textContent = `Saison ${s.getFullYear()}-${s.getFullYear() + 1}`;
  document.getElementById('contenu').hidden = false;
  if (mode === 'joueurs') {
    const ids = [params.get('a') || moi.id, params.get('b')].filter(Boolean);
    const { data } = await supabase.from('profiles').select('id, first_name, last_name, nickname, use_nickname, photo_path').in('id', ids);
    const trouve = (x) => (data || []).find((p) => p.id === x);
    if (trouve(ids[0])) choix.a = { id: ids[0], nom: nomAffiche(trouve(ids[0])), profil: trouve(ids[0]) };
    if (ids[1] && trouve(ids[1])) choix.b = { id: ids[1], nom: nomAffiche(trouve(ids[1])), profil: trouve(ids[1]) };
  } else {
    await chargerDoublettes();
    choix.a = doublettes.find((d) => d.cle === params.get('a')) || null;
    choix.b = doublettes.find((d) => d.cle === params.get('b')) || null;
  }
  majOnglets();
  afficherChoix();
  charger();
}

async function chargerDoublettes() {
  if (doublettes) return;
  const { data } = await supabase.rpc('liste_doublettes');
  doublettes = data || [];
}

function majOnglets() {
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
}

// ---------- Choix des deux camps ----------

function afficherChoix() {
  for (const cote of ['a', 'b']) {
    const z = document.getElementById(`choix-${cote}`);
    const c = choix[cote];
    if (mode === 'joueurs') {
      z.innerHTML = `
        ${avatar(c?.profil || null, `avatar--grand${c ? '' : ' avatar--vide'}`)}
        <span class="ff-choix__nom">${c ? (c.id ? `<a href="profil.html?id=${encodeURIComponent(c.id)}">${esc(c.nom)}</a>` : esc(c.nom)) : 'Choisir un joueur'}</span>
        <button type="button" class="bouton bouton--petit${c ? '' : ' bouton--plein'}" data-choisir="${cote}">${c ? 'Changer' : 'Choisir'}</button>`;
    } else {
      const autre = choix[cote === 'a' ? 'b' : 'a'];
      z.innerHTML = `
        <label class="champ"><span class="visuellement-cache">Doublette ${cote === 'a' ? '1' : '2'}</span>
          <select data-doublette="${cote}">
            <option value="">Choisir une doublette</option>
            ${doublettes.filter((d) => !autre || d.cle !== autre.cle).map((d) => `<option value="${esc(d.cle)}"${c && c.cle === d.cle ? ' selected' : ''}>${esc(d.noms)} (${d.parties})</option>`).join('')}
          </select>
        </label>`;
    }
  }
  document.querySelectorAll('[data-choisir]').forEach((b) => b.addEventListener('click', async () => {
    const cote = b.dataset.choisir;
    const autre = choix[cote === 'a' ? 'b' : 'a'];
    const m = await choisirMembre({ titre: 'Choisir un joueur', exclure: new Set(autre ? [autre.id] : []) });
    if (!m) return;
    choix[cote] = { id: m.id, nom: nomAffiche(m), profil: m };
    afficherChoix();
    charger();
  }));
  document.querySelectorAll('[data-doublette]').forEach((s) => s.addEventListener('change', () => {
    choix[s.dataset.doublette] = doublettes.find((d) => d.cle === s.value) || null;
    afficherChoix();
    charger();
  }));
}

// ---------- Résultat ----------

async function charger() {
  if (!choix.a || !choix.b) {
    zone.innerHTML = `<p class="vide">${mode === 'joueurs' ? 'Choisissez deux joueurs pour voir leur face-à-face.' : (doublettes?.length ? 'Choisissez deux doublettes.' : 'Aucune partie en double n\'a encore été jouée.')}</p>`;
    return;
  }
  const url = mode === 'joueurs' ? `?a=${choix.a.id}&b=${choix.b.id}` : `?mode=doublettes&a=${encodeURIComponent(choix.a.cle)}&b=${encodeURIComponent(choix.b.cle)}`;
  history.replaceState(null, '', url);
  zone.innerHTML = '<p class="vide">Calcul…</p>';
  const p = { p_a: mode === 'joueurs' ? choix.a.id : choix.a.cle, p_b: mode === 'joueurs' ? choix.b.id : choix.b.cle, p_variant: filtres.jeu || null, p_debut: filtres.periode === 'saison' ? debutSaison().toISOString() : null };
  const { data, error } = await supabase.rpc(mode === 'joueurs' ? 'face_a_face' : 'face_a_face_doublettes', p);
  if (error) {
    zone.innerHTML = `<p class="vide">${esc(error.code === 'P0001' ? error.message : 'Face-à-face indisponible pour le moment (script SQL 023 à exécuter dans Supabase ?).')}</p>`;
    return;
  }
  afficher(data.bilan);
}

function afficher(b) {
  const nomA = mode === 'joueurs' ? choix.a.nom : choix.a.noms;
  const nomB = mode === 'joueurs' ? choix.b.nom : choix.b.noms;
  if (!b.matchs) {
    zone.innerHTML = `<p class="vide">${esc(nomA)} et ${esc(nomB)} ne se sont pas encore affrontés${mode === 'joueurs' ? ' en 1 contre 1' : ''} sur cette période.</p>`;
    return;
  }
  const A = b.a; const B = b.b;
  const moy = (x) => (x.flechettes ? (x.points / x.flechettes) * 3 : null);
  const dbl = (x) => (x.flechettes_double ? (x.manches / x.flechettes_double) * 100 : null);
  const lignes = [
    ['Matchs gagnés', A.victoires, B.victoires, (v) => v],
    ['Manches gagnées', A.manches, B.manches, (v) => v],
    ['Moyenne 3 fléchettes', moy(A), moy(B), (v) => virgule(v)],
    ['Réussite au double', dbl(A), dbl(B), (v) => (v === null ? '–' : `${virgule(v)} %`)],
    ['Meilleur finish', A.meilleur_finish, B.meilleur_finish, (v) => v ?? '–'],
    ['180', A.nb_180, B.nb_180, (v) => v],
    ['Meilleure volée', A.meilleure_volee, B.meilleure_volee, (v) => v ?? '–'],
  ];
  const mieux = (va, vb) => ((va ?? -1) > (vb ?? -1) ? 'a' : (vb ?? -1) > (va ?? -1) ? 'b' : '');
  zone.innerHTML = `
    <section class="ff-bilan" aria-label="Bilan">
      <div class="ff-bilan__camp${A.victoires > B.victoires ? ' ff-bilan__camp--tete' : ''}"><strong>${esc(nomA)}</strong></div>
      <div class="ff-bilan__score"><span class="${A.victoires >= B.victoires ? 's-gagne' : 's-perdu'}">${A.victoires}</span><i>–</i><span class="${B.victoires >= A.victoires ? 's-gagne' : 's-perdu'}">${B.victoires}</span>
        <small>${b.matchs} match${b.matchs > 1 ? 's' : ''} · dernier le ${esc(fmtDate.format(new Date(b.derniere)))}</small></div>
      <div class="ff-bilan__camp ff-bilan__camp--droite${B.victoires > A.victoires ? ' ff-bilan__camp--tete' : ''}"><strong>${esc(nomB)}</strong></div>
    </section>
    <section class="ff-comparaison" aria-label="Comparaison">
      ${lignes.map(([titre, va, vb, f]) => {
    const m = mieux(va, vb);
    return `<div class="ff-ligne"><span class="ff-val${m === 'a' ? ' ff-val--mieux' : ''}">${f(va)}</span><span class="ff-titre">${titre}</span><span class="ff-val ff-val--droite${m === 'b' ? ' ff-val--mieux' : ''}">${f(vb)}</span></div>`;
  }).join('')}
    </section>
    <section class="section" aria-labelledby="t-hist">
      <h2 class="section__titre" id="t-hist">Historique</h2>
      <div class="ff-historique">
        ${b.historique.map((h) => `
          <a class="ff-partie" href="live.html?id=${encodeURIComponent(h.game_id)}">
            <span class="ff-partie__date">${esc(fmtDate.format(new Date(h.date)))} · ${esc(h.variant)}${h.tournoi ? ' · tournoi' : ''}</span>
            <span class="ff-partie__score"><span class="${h.gagnant === 'a' ? 's-gagne' : 's-perdu'}">${h.manches_a}</span> – <span class="${h.gagnant === 'b' ? 's-gagne' : 's-perdu'}">${h.manches_b}</span></span>
            <span class="ff-partie__moy">Moy. ${virgule(h.moy_a)} / ${virgule(h.moy_b)}</span>
            <span class="ff-partie__gagnant">${esc(h.gagnant === 'a' ? nomA : nomB)} gagne</span>
          </a>`).join('')}
      </div>
    </section>`;
}

// ---------- Onglets et filtres ----------

document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', async () => {
  if (b.dataset.mode === mode) return;
  mode = b.dataset.mode;
  choix = { a: null, b: null };
  if (mode === 'doublettes') await chargerDoublettes();
  else {
    const { data: p } = await supabase.from('profiles').select('id, first_name, last_name, nickname, use_nickname, photo_path').eq('id', moi.id).maybeSingle();
    choix.a = { id: moi.id, nom: nomAffiche(p || moi), profil: p || moi };
  }
  majOnglets();
  afficherChoix();
  charger();
}));
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
