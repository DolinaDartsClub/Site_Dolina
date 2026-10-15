// =====================================================================
//  Page profil d'un membre (profil.html?id=…, sans id : mon profil)
//  C'est la seule page où le nom complet (prénom, surnom, nom) est affiché.
//  Réservée aux membres validés.
// =====================================================================

import { supabase, esc, profilConnecte, nomAffiche, nomCompletHtml, avatar, dateFr } from './app.js?v=__VERSION__';
import { debutSaison, nomSaison, resumeSaison } from './profil-commun.js?v=__VERSION__';

const zone = document.getElementById('profil');
const idDemande = new URLSearchParams(location.search).get('id');
const virgule = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(d).replace('.', ','));
const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

async function init() {
  const moi = await profilConnecte();
  if (!moi || moi.status !== 'active') {
    zone.innerHTML = moi
      ? '<p class="vide">Votre compte doit être validé par un admin du club pour voir les profils.</p>'
      : '<p class="vide">Les profils sont réservés aux membres du club. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  const id = idDemande || moi.id;
  const soi = id === moi.id;
  // Mon propre profil : la page de référence est « Mon compte »
  if (soi) { location.replace('compte.html'); return; }
  const saison = debutSaison();
  const [rp, rs, rg] = await Promise.all([
    supabase.from('profiles')
      .select('id, first_name, last_name, nickname, use_nickname, photo_path, hand, dart_weight, dart_brand, status, created_at, team_members!team_members_profile_id_fkey(status, teams(name, sort_order))')
      .eq('id', id).maybeSingle(),
    supabase.rpc('stats_joueur', { p_profile: id, p_debut: saison.toISOString(), p_fin: null, p_variant: null }),
    supabase.from('games')
      .select('id, variant, winner_side, finished_at, mode, tournament_match_id, game_sides(side, name), game_players(side, profile_id, display_name, throw_order), moi:game_players!inner(profile_id, side)')
      .eq('moi.profile_id', id).eq('status', 'finished')
      .order('finished_at', { ascending: false }).limit(6),
  ]);
  const p = rp.data;
  if (!p || p.status !== 'active') {
    zone.innerHTML = '<p class="vide">Ce membre n\'existe pas ou n\'est plus actif.</p>';
    return;
  }
  document.title = `${nomAffiche(p)} – Dolina Darts Club`;

  const equipes = (p.team_members || []).filter((t) => t.status === 'accepted' && t.teams).sort((a, b) => a.teams.sort_order - b.teams.sort_order).map((t) => t.teams.name);
  const materiel = [p.hand === 'gaucher' ? 'Gaucher' : (p.hand === 'droitier' ? 'Droitier' : ''), p.dart_brand, p.dart_weight ? `${Number(p.dart_weight).toLocaleString('fr-FR')} g` : ''].filter(Boolean);

  // Résumé de la saison
  const s = rs.data;
  const resume = resumeSaison(s);

  // Dernières parties
  const parties = rg.data || [];
  let finishs = [];
  if (parties.length) {
    const { data } = await supabase.from('visits').select('game_id, side').in('game_id', parties.map((g) => g.id)).eq('is_checkout', true);
    finishs = data || [];
  }
  const nomCamp = (g, side) => {
    const camp = g.game_sides.find((x) => x.side === side);
    const noms = g.game_players.filter((x) => x.side === side).sort((a, b) => a.throw_order - b.throw_order).map((x) => x.display_name).join(' / ');
    return g.mode === 'double' && camp?.name ? camp.name : noms;
  };
  const lignesParties = parties.map((g) => {
    const monCamp = g.moi?.[0]?.side;
    const camps = g.game_sides.map((x) => x.side).sort((a, b) => a - b);
    const adversaires = camps.filter((c) => c !== monCamp).map((c) => nomCamp(g, c)).join(', ');
    const manches = (c) => finishs.filter((f) => f.game_id === g.id && f.side === c).length;
    const gagne = camps.length >= 2 ? g.winner_side === monCamp : null;
    return `
      <a class="ff-partie" href="live.html?id=${encodeURIComponent(g.id)}">
        <span class="ff-partie__date">${esc(fmtDate.format(new Date(g.finished_at)))} · ${esc(g.variant)}${g.tournament_match_id ? ' · tournoi' : ''}${g.mode === 'double' ? ' · double' : ''}</span>
        <span class="ff-partie__score">${gagne === null
    ? `<span class="s-perdu">${manches(monCamp)} manche${manches(monCamp) > 1 ? 's' : ''}</span>`
    : `<span class="${gagne ? 's-gagne' : 's-perdu'}">${manches(monCamp)}</span> – ${camps.filter((c) => c !== monCamp).map((c) => `<span class="${gagne === false && g.winner_side === c ? 's-gagne' : 's-perdu'}">${manches(c)}</span>`).join(' – ')}`}</span>
        <span class="ff-partie__moy">${adversaires ? `contre ${esc(adversaires)}` : 'Seul'}</span>
        <span class="ff-partie__gagnant">${gagne === null ? '' : (gagne ? 'Victoire' : 'Défaite')}</span>
      </a>`;
  }).join('');

  zone.innerHTML = `
    <section class="pr-entete">
      ${avatar(p, 'avatar--profil')}
      <div class="pr-identite">
        <h1 class="pr-nom">${nomCompletHtml(p)}</h1>
        ${p.use_nickname && p.nickname ? `<p class="pr-sous">Affiché sur le site : <strong>${esc(nomAffiche(p))}</strong></p>` : ''}
        <div class="pr-badges">
          ${equipes.length ? equipes.map((e) => `<span class="t-role t-role--joueur">${esc(e)}</span>`).join('') : '<span class="t-role">Sans équipe</span>'}
        </div>
        ${materiel.length ? `<p class="pr-sous">${esc(materiel.join(' · '))}</p>` : ''}
        <p class="pr-sous">Membre depuis le ${esc(dateFr(p.created_at))}</p>
      </div>
    </section>
    <div class="actions pr-actions">
      ${soi
    ? '<a class="bouton bouton--plein" href="compte.html">Modifier mon profil</a>'
    : `<a class="bouton bouton--plein" href="face-a-face.html?a=${encodeURIComponent(moi.id)}&b=${encodeURIComponent(p.id)}">Face-à-face avec moi</a>`}
      <a class="bouton" href="stats.html${soi ? '' : `?id=${encodeURIComponent(p.id)}`}">Toutes les stats</a>
      <a class="bouton" href="classement.html">Classement</a>
    </div>
    <section class="section s-section" aria-labelledby="t-saison">
      <h2 class="section__titre" id="t-saison">${nomSaison(saison)}</h2>
      ${resume}
    </section>
    <section class="section s-section" aria-labelledby="t-parties">
      <h2 class="section__titre" id="t-parties">Dernières parties</h2>
      ${lignesParties ? `<div class="ff-historique">${lignesParties}</div>` : '<p class="vide">Aucune partie terminée pour l\'instant.</p>'}
    </section>`;
}

init();
