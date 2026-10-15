// =====================================================================
//  Correction d'une partie terminée (créateur de la partie ou admin)
//  On modifie le score d'une volée : les restes, le bust et le finish de
//  la manche sont recalculés. L'ordre des volées et les vainqueurs de
//  manche ne changent pas (sinon, la correction est refusée).
// =====================================================================

import { supabase, esc, message, erreurFr, profilConnecte, formatPartie } from './app.js?v=__VERSION__';
import { recalculerPartie, finissable, suggestionFinish } from './x01.js?v=__VERSION__';

const id = new URLSearchParams(location.search).get('id');
const zone = document.getElementById('zone');
const zoneMsg = document.getElementById('message');
const barre = document.getElementById('barre');
const btnEnregistrer = document.getElementById('enregistrer');

let game = null;
let origine = [];      // volées telles qu'en base (triées par id)
let saisies = new Map(); // id -> { score?, darts_used?, darts_at_double? } modifiés par l'utilisateur
let calcul = { volees: [], erreurs: [] };

const CHAMPS = ['score', 'remaining_before', 'is_bust', 'is_checkout', 'darts_used', 'darts_at_double'];

async function init() {
  if (!id) { zone.innerHTML = '<p class="vide">Aucune partie indiquée.</p>'; return; }
  document.getElementById('lien-retour').href = `live.html?id=${encodeURIComponent(id)}`;

  const moi = await profilConnecte();
  if (!moi) {
    zone.innerHTML = `<p class="vide">Connectez-vous pour corriger une partie. <a href="connexion.html">Se connecter</a></p>`;
    return;
  }
  const { data, error } = await supabase
    .from('games')
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, first_side, status, winner_side, created_by, game_sides(side, name, is_bot), game_players(id, side, display_name, throw_order)')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) { zone.innerHTML = '<p class="vide">Cette partie est introuvable.</p>'; return; }
  game = data;
  document.getElementById('format').textContent = `${formatPartie(game)} · finish double`;

  if (game.created_by !== moi.id && moi.role !== 'admin') {
    zone.innerHTML = '<p class="vide">Seul le joueur qui a créé la partie, ou un admin, peut la corriger.</p>';
    return;
  }
  if (game.status !== 'finished') {
    zone.innerHTML = game.status === 'live'
      ? `<p class="vide">La partie est en cours : corrigez la dernière volée directement dans le <a href="scorer.html?id=${encodeURIComponent(id)}">scorer</a>.</p>`
      : '<p class="vide">Cette partie a été abandonnée : elle ne peut pas être corrigée.</p>';
    return;
  }

  const res = await supabase.from('visits').select('*').eq('game_id', id).order('id');
  origine = (res.data || []).sort((a, b) => a.id - b.id);
  barre.hidden = false;
  recalculer();
  afficher();
}

// ---------- Calcul ----------

function recalculer() {
  const modifiees = origine.map((v) => ({ ...v, ...(saisies.get(v.id) || {}) }));
  calcul = recalculerPartie(game, modifiees);
}

function changees() {
  return calcul.volees.filter((n, i) => CHAMPS.some((c) => n[c] !== origine[i][c]));
}

// ---------- Affichage ----------

function nomCamp(side) {
  const s = game.game_sides.find((x) => x.side === side);
  const joueurs = game.game_players.filter((p) => p.side === side).sort((a, b) => a.throw_order - b.throw_order).map((p) => p.display_name);
  if (game.mode === 'double') return s?.name || joueurs.join(' / ');
  return joueurs.join(' / ') || '—';
}
function nomVolee(v) {
  if (game.mode === 'double' && v.player_id) {
    const p = game.game_players.find((x) => x.id === v.player_id);
    if (p) return `${nomCamp(v.side)} · ${p.display_name}`;
  }
  return nomCamp(v.side);
}

function options(min, max, val) {
  let h = '';
  for (let n = min; n <= max; n++) h += `<option value="${n}"${n === val ? ' selected' : ''}>${n}</option>`;
  return h;
}

// Cellule « fléchettes » d'une volée : finish (fléchettes + au double) ou au double seul
function celluleDouble(n) {
  if (n.is_checkout) {
    const mini = suggestionFinish(n.remaining_before)?.length || 1;
    return `<label class="corr__mini">Fl.<select data-champ="darts_used" data-id="${n.id}" aria-label="Fléchettes pour finir">${options(Math.min(mini, 3), 3, n.darts_used)}</select></label>`
      + `<label class="corr__mini">Dbl<select data-champ="darts_at_double" data-id="${n.id}" aria-label="Fléchettes au double">${options(1, n.darts_used, n.darts_at_double)}</select></label>`;
  }
  if (n.remaining_before <= 50 && finissable(n.remaining_before)) {
    return `<label class="corr__mini">Dbl<select data-champ="darts_at_double" data-id="${n.id}" aria-label="Fléchettes au double">${options(0, 3, n.darts_at_double)}</select></label>`;
  }
  return '<span class="corr__vide">–</span>';
}

function ligne(n, i) {
  const o = origine[i];
  const modif = CHAMPS.some((c) => n[c] !== o[c]);
  const err = calcul.erreurs.find((e) => e.id === n.id);
  const apres = n.is_checkout ? 0 : (n.is_bust ? n.remaining_before : n.remaining_before - n.score);
  const volee = n.is_checkout
    ? `<span class="corr__finish" title="Le finish est égal au reste">${n.score}</span>`
    : `<input class="corr__score" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="3" value="${saisies.get(n.id)?.score ?? n.score}" data-champ="score" data-id="${n.id}" aria-label="Score de la volée ${n.visit_no} de ${esc(nomCamp(n.side))}">`;
  return `
    <tr class="${modif ? 'corr--modif' : ''}${err ? ' corr--erreur' : ''}${n.is_checkout ? ' corr--checkout' : ''}" data-ligne="${n.id}">
      <td class="corr__no">${n.visit_no}</td>
      <td class="corr__nom">${esc(nomVolee(n))}<small>reste ${n.remaining_before}</small></td>
      <td>${volee}${n.is_bust ? '<small class="corr__bust">Bust</small>' : ''}</td>
      <td class="corr__dbl">${celluleDouble(n)}</td>
      <td class="corr__reste">${n.is_checkout ? '✓' : apres}</td>
    </tr>
    ${err ? `<tr class="corr__msg"><td colspan="5">${esc(err.message)}</td></tr>` : ''}`;
}

function afficher() {
  const manches = [];
  calcul.volees.forEach((n, i) => {
    const cle = `${n.set_no}-${n.leg_no}`;
    let m = manches.find((x) => x.cle === cle);
    if (!m) { m = { cle, set: n.set_no, leg: n.leg_no, lignes: [] }; manches.push(m); }
    m.lignes.push([n, i]);
  });

  zone.innerHTML = `
    <p class="intro">Modifiez le score d'une volée saisie par erreur : les restes et le finish de la manche se recalculent tout seuls.
    Le vainqueur de chaque manche ne change pas ; si une correction le changerait, elle est refusée.</p>
    ${manches.map((m) => {
      const fin = m.lignes.find(([n]) => n.is_checkout)?.[0];
      return `
      <section class="corr-manche">
        <header>
          <strong>${game.sets_n ? `Set ${m.set} · ` : ''}Manche ${m.leg}</strong>
          <span>${fin ? `Gagnée par ${esc(nomCamp(fin.side))} · finish ${fin.score}` : ''}</span>
        </header>
        <table class="corr">
          <thead><tr><th>#</th><th>Joueur</th><th>Volée</th><th>Fléch.</th><th>Reste</th></tr></thead>
          <tbody>${m.lignes.map(([n, i]) => ligne(n, i)).join('')}</tbody>
        </table>
      </section>`;
    }).join('')}`;
  majBarre();
}

function majBarre() {
  const nb = changees().length;
  const nbErr = calcul.erreurs.length;
  document.getElementById('etat-correction').textContent = nbErr
    ? `${nbErr} correction${nbErr > 1 ? 's' : ''} impossible${nbErr > 1 ? 's' : ''}`
    : (nb ? `${nb} volée${nb > 1 ? 's' : ''} modifiée${nb > 1 ? 's' : ''}` : 'Aucune modification');
  barre.classList.toggle('barre-correction--erreur', nbErr > 0);
  btnEnregistrer.disabled = !nb || nbErr > 0;
}

// Après une saisie : on recalcule et on redessine, en gardant le curseur dans le champ
function apresSaisie(champ) {
  const idVolee = champ.dataset.id;
  const nom = champ.dataset.champ;
  const pos = champ.selectionStart;
  recalculer();
  afficher();
  const nouveau = zone.querySelector(`[data-id="${idVolee}"][data-champ="${nom}"]`);
  if (nouveau && nom === 'score') {
    nouveau.focus();
    try { nouveau.setSelectionRange(pos, pos); } catch { /* champ non texte */ }
  }
}

zone.addEventListener('input', (e) => {
  const c = e.target.closest('input[data-champ="score"]');
  if (!c) return;
  c.value = c.value.replace(/\D/g, '').slice(0, 3);
  const idVolee = Number(c.dataset.id);
  const s = { ...(saisies.get(idVolee) || {}) };
  if (c.value === '') return;      // on attend un chiffre
  s.score = Number(c.value);
  saisies.set(idVolee, s);
  apresSaisie(c);
});

zone.addEventListener('change', (e) => {
  const c = e.target.closest('select[data-champ]');
  if (!c) return;
  const idVolee = Number(c.dataset.id);
  const s = { ...(saisies.get(idVolee) || {}) };
  s[c.dataset.champ] = Number(c.value);
  if (c.dataset.champ === 'darts_used') s.darts_at_double = Math.min(s.darts_at_double ?? calcul.volees.find((v) => v.id === idVolee).darts_at_double, s.darts_used);
  saisies.set(idVolee, s);
  apresSaisie(c);
});

// Champ vidé puis quitté : on remet le score d'origine
zone.addEventListener('focusout', (e) => {
  const c = e.target.closest('input[data-champ="score"]');
  if (c && c.value === '') {
    const s = { ...(saisies.get(Number(c.dataset.id)) || {}) };
    delete s.score;
    saisies.set(Number(c.dataset.id), s);
    recalculer();
    afficher();
  }
});

// ---------- Enregistrement ----------

btnEnregistrer.addEventListener('click', async () => {
  const liste = changees();
  if (!liste.length || calcul.erreurs.length) return;
  btnEnregistrer.disabled = true;
  btnEnregistrer.textContent = 'Enregistrement…';
  const { error } = await supabase.rpc('corriger_partie', {
    p_game: id,
    p_volees: liste.map((n) => Object.fromEntries([['id', n.id], ...CHAMPS.map((c) => [c, n[c]])])),
  });
  if (error) {
    btnEnregistrer.textContent = 'Enregistrer';
    majBarre();
    message(zoneMsg, `La correction n'a pas été enregistrée : ${erreurFr(error)}`);
    return;
  }
  location.href = `live.html?id=${encodeURIComponent(id)}&corrige=1`;
});

window.addEventListener('beforeunload', (e) => {
  if (changees().length && btnEnregistrer.textContent !== 'Enregistrement…') e.preventDefault();
});

init();
