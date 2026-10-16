// =====================================================================
//  Page d'accueil : matchs en cours (temps réel) + actualités
// =====================================================================

import { supabase, esc, dateFr, formatPartie, etatPartie, urlImage, profilConnecte } from './app.js?v=__VERSION__';

const CATEGORIES = {
  annonce: 'Annonce de match',
  resultat: 'Résultat',
  vie_club: 'Vie du club',
  evenement: 'Événement',
};

// ---------- Matchs en cours ----------

async function chargerMatchs() {
  const zone = document.getElementById('matchs');
  const { data: games, error } = await supabase
    .from('games')
    .select('id, variant, start_score, mode, legs_kind, legs_n, sets_kind, sets_n, first_side, status, game_sides(side, name, is_bot), game_players(side, display_name, throw_order)')
    .eq('status', 'live')
    .eq('visibility', 'public')
    .gte('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(12);

  if (error) {
    zone.innerHTML = '<p class="vide">Impossible de charger les matchs pour le moment.</p>';
    return;
  }
  if (!games.length) {
    zone.innerHTML = '<p class="vide">Aucun match en cours. Les parties publiques apparaissent ici dès qu\'elles commencent.</p>';
    return;
  }

  const { data: visits } = await supabase
    .from('visits')
    .select('id, game_id, set_no, leg_no, visit_no, side, score, remaining_before, is_bust, is_checkout, darts_used, darts_at_double')
    .in('game_id', games.map((g) => g.id));

  zone.innerHTML = games.map((g) => carteMatch(g, (visits || []).filter((v) => v.game_id === g.id))).join('');
}

function nomCamp(g, side) {
  const s = g.game_sides.find((x) => x.side === side);
  const joueurs = g.game_players
    .filter((p) => p.side === side)
    .sort((a, b) => a.throw_order - b.throw_order)
    .map((p) => p.display_name);
  if (g.mode === 'double' && s?.name) return `${s.name} (${joueurs.join(' / ')})`;
  return joueurs.join(' / ') || (s?.is_bot ? 'Dartbot' : '—');
}

function carteMatch(g, visits) {
  const sides = [...g.game_sides].sort((a, b) => a.side - b.side);
  const etat = etatPartie(g, sides, visits);
  const lien = `live.html?id=${encodeURIComponent(g.id)}`;

  if (sides.length === 2) {
    const [a, b] = sides.map((s) => s.side);
    const score = g.sets_n
      ? `${etat.sets[a]} – ${etat.sets[b]}`
      : `${etat.manches[a]} – ${etat.manches[b]}`;
    return `
      <a class="match" href="${lien}">
        <span class="match__format">${esc(formatPartie(g))}</span>
        <span class="match__ligne">
          <span class="match__camp">
            <span class="match__nom">${esc(nomCamp(g, a))}</span>
            <span class="match__reste">reste ${etat.reste[a]}</span>
          </span>
          <span class="match__score">${score}</span>
          <span class="match__camp match__camp--droite">
            <span class="match__nom">${esc(nomCamp(g, b))}</span>
            <span class="match__reste">reste ${etat.reste[b]}</span>
          </span>
        </span>
        <span class="match__lien">Suivre le score en direct →</span>
      </a>`;
  }

  // 3 ou 4 joueurs
  const lignes = sides.map((s) => `
    <span class="match__ligne" style="grid-template-columns: minmax(0,1fr) auto">
      <span class="match__nom">${esc(nomCamp(g, s.side))}</span>
      <span class="match__reste">${etat.manches[s.side]} manche(s) · reste ${etat.reste[s.side]}</span>
    </span>`).join('');
  return `
    <a class="match" href="${lien}">
      <span class="match__format">${esc(formatPartie(g))}</span>
      ${lignes}
      <span class="match__lien">Suivre le score en direct →</span>
    </a>`;
}

// ---------- Tournois en cours (visible des visiteurs) ----------

// Prochaines rencontres (membres connectés) : la prochaine de chaque équipe
async function chargerProchaines() {
  const bloc = document.getElementById('bloc-prochaines');
  if (!bloc) return;
  const moi = await profilConnecte().catch(() => null);
  if (!moi || moi.status !== 'active') { bloc.hidden = true; return; }
  const auj = new Date().toLocaleDateString('fr-CA');
  const depuis = new Date(Date.now() - 25 * 86400000).toLocaleDateString('fr-CA');
  const [rr, rt, rm] = await Promise.all([
    supabase.from('rencontres').select('id, team_id, date_match, date_fin, heure_match, heure_rdv, journee, adversaire, domicile, salles(nom, adresse, lien_carte)')
      .is('score_nous', null).gte('date_match', depuis).order('date_match').order('heure_match', { nullsFirst: false }).limit(40),
    supabase.from('teams').select('id, name, sort_order').order('sort_order'),
    supabase.from('team_members').select('team_id').eq('profile_id', moi.id).eq('status', 'accepted'),
  ]);
  if (rr.error || rt.error) { bloc.hidden = true; return; }
  const mesEquipes = new Set((rm.data || []).map((m) => m.team_id));
  const prochaines = rt.data
    .map((t) => ({ t, r: rr.data.find((r) => r.team_id === t.id && (r.date_fin || r.date_match) >= auj) }))
    .filter((x) => x.r)
    // Mon équipe d'abord, puis par date
    .sort((a, b) => (mesEquipes.has(b.t.id) - mesEquipes.has(a.t.id)) || a.r.date_match.localeCompare(b.r.date_match));
  if (!prochaines.length) { bloc.hidden = true; return; }
  const jour = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const court = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  const d = (x) => new Date(`${x}T12:00:00`);
  const hm = (t) => (t ? t.slice(0, 5).replace(':', 'h') : '');
  const carte = (s) => s.lien_carte || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.adresse)}`;
  document.getElementById('prochaines').innerHTML = prochaines.map(({ t, r }) => {
    const periode = r.date_fin && r.date_fin !== r.date_match;
    const aujourdhui = !periode && r.date_match === auj;
    const quand = periode
      ? `Entre le ${court.format(d(r.date_match))} et le ${court.format(d(r.date_fin))}`
      : (aujourdhui ? 'Aujourd\'hui' : jour.format(d(r.date_match)));
    const heures = [r.heure_match && hm(r.heure_match), r.heure_rdv && `RDV ${hm(r.heure_rdv)}`].filter(Boolean).join(' · ');
    return `
      <article class="pr-carte${mesEquipes.has(t.id) ? ' pr-carte--mienne' : ''}${aujourdhui ? ' pr-carte--jour' : ''}">
        <div class="pr-carte__haut">
          <span class="pr-equipe">${esc(t.name)}${mesEquipes.has(t.id) ? ' <small>mon équipe</small>' : ''}</span>
          <span class="eq-badge${r.domicile ? ' eq-badge--dom' : ''}">${r.domicile ? 'Domicile' : 'Extérieur'}</span>
        </div>
        <a class="pr-affiche" href="equipes.html#${encodeURIComponent(t.name)}">${r.domicile ? 'reçoit' : 'chez'} <strong>${esc(r.adversaire)}</strong></a>
        <span class="pr-quand">${esc(quand)}${heures ? ` · ${esc(heures)}` : ''}${periode ? ' <small>date à confirmer</small>' : ''}${r.journee ? ` <small>${esc(r.journee)}</small>` : ''}</span>
        ${r.salles ? `<span class="pr-salle">${esc(r.salles.nom)} · <a href="${esc(carte(r.salles))}" target="_blank" rel="noopener">Itinéraire</a></span>` : ''}
      </article>`;
  }).join('') + '<a class="res-tout" href="equipes.html">Tout le calendrier →</a>';
  bloc.hidden = false;
}

// Derniers résultats des équipes (championnat CPARD, script 030)
async function chargerResultats() {
  const bloc = document.getElementById('bloc-resultats');
  if (!bloc) return;
  const [rr, rt] = await Promise.all([
    supabase.from('rencontres').select('id, team_id, date_match, date_fin, journee, adversaire, domicile, score_nous, score_eux')
      .not('score_nous', 'is', null).order('date_match', { ascending: false }).limit(4),
    supabase.from('teams').select('id, name'),
  ]);
  if (rr.error || rt.error || !rr.data?.length) { bloc.hidden = true; return; }
  const nom = (id) => rt.data.find((t) => t.id === id)?.name || 'Dolina';
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  document.getElementById('resultats-equipes').innerHTML = rr.data.map((r) => {
    const code = r.score_nous > r.score_eux ? 'V' : (r.score_nous < r.score_eux ? 'D' : 'N');
    const libelle = { V: 'Victoire', D: 'Défaite', N: 'Nul' }[code];
    return `
      <a class="res-ligne${code === 'V' ? ' res-ligne--gagne' : ''}" href="equipes.html#${encodeURIComponent(nom(r.team_id))}" aria-label="${esc(`${libelle} de ${nom(r.team_id)} contre ${r.adversaire}, ${r.score_nous} à ${r.score_eux}`)}">
        <span class="res-ligne__res" aria-hidden="true">${code}</span>
        <span class="res-ligne__texte"><strong>${esc(nom(r.team_id))} – ${esc(r.adversaire)}</strong><small>${esc(r.date_fin && r.date_fin !== r.date_match ? (r.journee ? `Journée ${r.journee.replace(/^J/i, '')}` : 'Championnat') : fmt.format(new Date(`${r.date_match}T12:00:00`)))} · ${r.domicile ? 'à domicile' : 'à l\'extérieur'}</small></span>
        <span class="res-ligne__score">${r.score_nous} – ${r.score_eux}</span>
      </a>`;
  }).join('') + '<a class="res-tout" href="equipes.html">Calendrier des équipes →</a>';
  bloc.hidden = false;
}

async function chargerTournois() {
  const bloc = document.getElementById('bloc-tournois');
  const zone = document.getElementById('tournois-en-cours');
  const { data, error } = await supabase.rpc('tournois_en_cours');
  if (error) {
    // Base pas encore à jour (scripts 012 à 014) : on prévient seulement les admins
    const moi = await profilConnecte().catch(() => null);
    if (moi?.role === 'admin') {
      bloc.hidden = false;
      zone.innerHTML = `<p class="vide">Bloc « Tournois » indisponible : exécutez les scripts SQL 012, 013 puis 014 dans Supabase. (${esc(error.message || '')})</p>`;
    } else {
      bloc.hidden = true;
    }
    return;
  }
  if (!data?.length) {
    bloc.hidden = true;
    return;
  }
  bloc.hidden = false;
  const nomsTours = { 1: 'Finale', 2: 'Demi-finales', 3: 'Quarts de finale', 4: 'Huitièmes de finale', 5: 'Seizièmes de finale' };
  zone.innerHTML = data.map((t) => {
    const ouvert = (t.status || 'running') === 'open';
    const restants = t.tours && t.tour ? t.tours - t.tour + 1 : null;
    const phase = ouvert ? 'Inscriptions ouvertes'
      : (t.phase === 'pool' ? 'Phase de poules' : (restants ? (nomsTours[restants] || `Tour ${t.tour}`) : 'Phase finale'));
    const type = `${t.team_mode === 'double' ? 'Double' : 'Individuel'} · ${t.format === 'pools' ? 'Poules puis élimination directe' : 'Élimination directe'}`;
    const avancement = ouvert
      ? `${t.inscrits}${t.max_participants ? ` / ${t.max_participants}` : ''} inscrit${t.inscrits > 1 ? 's' : ''} · rejoindre avec le code de l'organisateur`
      : `${t.inscrits} ${t.team_mode === 'double' ? 'doublettes' : 'joueurs'} · ${t.matchs_joues} / ${t.matchs_total} matchs joués`;
    const lien = ouvert ? 'tournois.html#code' : (t.public_matches ? `tournoi.html?id=${encodeURIComponent(t.id)}` : null);
    const contenu = `
      <span class="ta-carte__haut"><span class="ta-carte__phase${ouvert ? ' ta-carte__phase--ouvert' : ''}">${esc(phase)}</span>${t.matchs_en_cours ? `<span class="m-statut m-statut--live">${t.matchs_en_cours} match${t.matchs_en_cours > 1 ? 's' : ''} en cours</span>` : ''}</span>
      <strong class="ta-carte__nom">${esc(t.name)}</strong>
      <span class="ta-carte__info">${esc(type)}</span>
      <span class="ta-carte__info">${esc(avancement)}</span>
      ${lien ? `<span class="match__lien">${ouvert ? 'Rejoindre (membres du club) →' : 'Voir le tournoi →'}</span>` : '<span class="ta-carte__prive">Suivi réservé aux participants</span>'}`;
    return lien
      ? `<a class="ta-carte${ouvert ? ' ta-carte--ouvert' : ''}" href="${lien}">${contenu}</a>`
      : `<div class="ta-carte">${contenu}</div>`;
  }).join('');
}

// ---------- Actualités ----------

async function chargerArticles() {
  const zone = document.getElementById('articles');
  const { data, error } = await supabase
    .from('articles')
    .select('id, title, body, category, image_path, published_at')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(20);

  if (error) {
    zone.innerHTML = '<p class="vide">Impossible de charger les actualités pour le moment.</p>';
    return;
  }
  if (!data.length) {
    zone.innerHTML = '<p class="vide">Les premières actualités du club arrivent très bientôt.</p>';
    return;
  }

  // Bandeau d'annonces qui défile tout seul toutes les 5 secondes
  const annonces = data.slice(0, 10);
  zone.innerHTML = `
    <div class="actus" role="region" aria-roledescription="carrousel" aria-label="Actualités du club">
      <div class="actus__piste" tabindex="0">
        ${annonces.map((a, i) => {
    const lien = `article.html?id=${encodeURIComponent(a.id)}`;
    const extrait = a.body && a.body.length > 220 ? `${a.body.slice(0, 220).trim()}…` : a.body;
    return `
        <article class="actu" aria-roledescription="annonce" aria-label="${i + 1} sur ${annonces.length}">
          <a class="actu__visuel${a.image_path ? '' : ' actu__visuel--vide'}" href="${lien}" tabindex="-1" aria-hidden="true">
            ${a.image_path ? `<img src="${esc(urlImage(a.image_path))}" alt="" loading="${i ? 'lazy' : 'eager'}">` : '<img src="assets/img/logo.png" alt="">'}
            <span class="etiquette etiquette--${esc(a.category)}">${esc(CATEGORIES[a.category] || a.category)}</span>
          </a>
          <div class="actu__corps">
            <span class="article__meta">${esc(dateFr(a.published_at))}</span>
            <h3 class="article__titre"><a class="lien-titre" href="${lien}">${esc(a.title)}</a></h3>
            ${extrait ? `<p class="actu__texte">${esc(extrait)}</p>` : ''}
            <a class="match__lien" href="${lien}">Lire et partager →</a>
          </div>
        </article>`;
  }).join('')}
      </div>
      ${annonces.length > 1 ? `
      <div class="actus__nav">
        <button type="button" class="actus__fleche" data-actu="-1" aria-label="Annonce précédente"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <div class="actus__points">${annonces.map((_, i) => `<button type="button" data-point-actu="${i}" aria-label="Annonce ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}><span></span></button>`).join('')}</div>
        <button type="button" class="actus__fleche" data-actu="1" aria-label="Annonce suivante"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>` : ''}
    </div>`;
  if (annonces.length > 1) carrouselActus(zone.querySelector('.actus'));
}

// Défile toutes les 5 s ; pause au survol, au toucher ou au clavier ; glissement du doigt natif
function carrouselActus(racine) {
  const piste = racine.querySelector('.actus__piste');
  const slides = [...piste.children];
  const points = [...racine.querySelectorAll('[data-point-actu]')];
  const calme = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let actuelle = 0;
  let minuteur = null;
  let enPause = false;
  const aller = (i) => {
    actuelle = (i + slides.length) % slides.length;
    piste.scrollTo({ left: slides[actuelle].offsetLeft - piste.offsetLeft, behavior: calme ? 'auto' : 'smooth' });
  };
  const marquer = () => {
    points.forEach((b, k) => (k === actuelle ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    racine.style.setProperty('--actu-duree', enPause || calme ? '0s' : '5s');
    racine.classList.remove('actus--anim'); void racine.offsetWidth; racine.classList.add('actus--anim');
  };
  const lancer = () => {
    clearInterval(minuteur);
    enPause = false;
    marquer();
    if (!calme) minuteur = setInterval(() => aller(actuelle + 1), 5000);
  };
  const arreter = () => { clearInterval(minuteur); enPause = true; racine.classList.add('actus--pause'); };
  const reprendre = () => { racine.classList.remove('actus--pause'); lancer(); };
  let attenteScroll = null;
  piste.addEventListener('scroll', () => {
    clearTimeout(attenteScroll);
    attenteScroll = setTimeout(() => {
      const i = Math.round(piste.scrollLeft / piste.clientWidth);
      if (i !== actuelle) { actuelle = Math.max(0, Math.min(slides.length - 1, i)); }
      marquer();
    }, 80);
  }, { passive: true });
  racine.addEventListener('click', (e) => {
    const f = e.target.closest('[data-actu]');
    const p = e.target.closest('[data-point-actu]');
    if (f) aller(actuelle + Number(f.dataset.actu));
    else if (p) aller(Number(p.dataset.pointActu));
    else return;
    lancer();
  });
  racine.addEventListener('mouseenter', arreter);
  racine.addEventListener('mouseleave', reprendre);
  racine.addEventListener('focusin', arreter);
  racine.addEventListener('focusout', (e) => { if (!racine.contains(e.relatedTarget)) reprendre(); });
  piste.addEventListener('touchstart', arreter, { passive: true });
  piste.addEventListener('touchend', () => setTimeout(reprendre, 1500), { passive: true });
  piste.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); aller(actuelle + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); aller(actuelle - 1); }
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? arreter() : reprendre()));
  lancer();
}

// ---------- Temps réel : on recharge les matchs à chaque volée ----------

let attente = null;
function rafraichirBientot() {
  clearTimeout(attente);
  attente = setTimeout(chargerMatchs, 400);
}

supabase
  .channel('accueil-matchs')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'visits' }, rafraichirBientot)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, rafraichirBientot)
  .subscribe();

chargerTournois();
chargerProchaines();
chargerResultats();

chargerMatchs();
chargerArticles();

// ---------- Diaporama « Rejoindre le club » ----------
// Défile tout seul (5 s), se met en pause au survol ou au toucher, flèches, points et glissement du doigt.
(function diaporama() {
  const racine = document.getElementById('diaporama');
  if (!racine) return;
  const photos = [...racine.querySelectorAll('.diaporama__photo')];
  const points = racine.querySelector('.diaporama__points');
  if (photos.length < 2) return;
  let actuelle = 0;
  let minuteur = null;
  const calme = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  points.innerHTML = photos.map((_, i) => `<button type="button" data-point="${i}" aria-label="Photo ${i + 1}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('');
  const montrer = (i) => {
    actuelle = (i + photos.length) % photos.length;
    photos.forEach((p, k) => p.classList.toggle('est-visible', k === actuelle));
    points.querySelectorAll('button').forEach((b, k) => (k === actuelle ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  };
  const lancer = () => { if (!calme) { clearInterval(minuteur); minuteur = setInterval(() => montrer(actuelle + 1), 5000); } };
  const arreter = () => clearInterval(minuteur);
  racine.addEventListener('click', (e) => {
    const f = e.target.closest('[data-diapo]');
    const p = e.target.closest('[data-point]');
    if (f) montrer(actuelle + Number(f.dataset.diapo));
    else if (p) montrer(Number(p.dataset.point));
    else return;
    lancer();
  });
  racine.addEventListener('mouseenter', arreter);
  racine.addEventListener('mouseleave', lancer);
  let x0 = null;
  racine.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; arreter(); }, { passive: true });
  racine.addEventListener('touchend', (e) => {
    if (x0 !== null) {
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) montrer(actuelle + (dx < 0 ? 1 : -1));
    }
    x0 = null;
    lancer();
  });
  document.addEventListener('visibilitychange', () => (document.hidden ? arreter() : lancer()));
  lancer();
}());

// Horaires : met en avant le jour d'entraînement (mardi, jeudi) et « ce soir » avant 22h30
(function horaires() {
  const maintenant = new Date();
  const jour = maintenant.getDay();
  document.querySelectorAll('.horaires__jour').forEach((el) => el.classList.toggle('horaires__jour--aujourdhui', Number(el.dataset.jour) === jour));
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();
  const ceSoir = document.getElementById('ce-soir');
  if (ceSoir && (jour === 2 || jour === 4) && minutes < 22 * 60 + 30) {
    ceSoir.hidden = false;
    if (minutes >= 19 * 60) ceSoir.textContent = 'Entraînement en cours !';
  }
}());
