// =====================================================================
//  Pentadarts et Capital : règles du club (feuille de match du Dolina)
//  Module « pur » (aucun accès à la page ni à la base) : testé par
//  outils/test-pentadarts.mjs.
//
//  La partie est rejouée à partir de la liste des actions (événements) :
//  annuler = retirer la dernière action, reprendre = rejouer la liste.
//
//  Jeux, dans l'ordre : 1 Le centre · 2 Le mickey · 3 Le finish ·
//  4 Le 301 (1re manche) · 4' Le 301 (2e manche) · 5 Le capital.
//  Seuls les 3 premiers de chaque jeu marquent des points.
//  L'ordre de départ (tiré à la bulle) tourne d'un joueur à chaque jeu.
//  Tous les joueurs lancent le même nombre de volées, sauf au 301
//  (le premier qui finit gagne la manche).
//  Égalité dans un jeu : départage à la bulle (le premier qui touche la
//  bulle ou la demi-bulle prend la meilleure place) ; au finish, les
//  joueurs bloqués sur le même finish le rejouent (le premier qui le
//  réussit passe devant). Égalité au total pour la 1re ou la 2e place :
//  une manche de 501.
// =====================================================================

import { valeurFleche } from './compter-calcul.js?v=__VERSION__';

export const JEUX = {
  centre: { titre: 'Le centre', num: '1', points: [3, 1, 0] },
  mickey: { titre: 'Le mickey', num: '2', points: [3, 1, 0] },
  finish: { titre: 'Le finish', num: '3', points: [6, 2, 0] },
  '301a': { titre: 'Le 301 (1re manche)', num: '4', points: [3, 1, 0] },
  '301b': { titre: 'Le 301 (2e manche)', num: "4'", points: [3, 1, 0] },
  capital: { titre: 'Le capital', num: '5', points: [7, 3, 0] },
};
export const ORDRE_PENTADARTS = ['centre', 'mickey', 'finish', '301a', '301b', 'capital'];

export const CENTRE_BUT = 11;
export const CIBLES_MICKEY = ['20', '19', '18', '17', '16', '15', 'C', 'T', 'D'];
export const LIBELLES_MICKEY = { C: 'Centre', T: 'Triple', D: 'Double' };
export const FINISHS = [50, 40, 36, 32, 24, 7];
export const MANCHES_CAPITAL = ['$', '20', 'D', '19', 'T', '18', '57', 'C'];
export const LIBELLES_CAPITAL = { $: 'Capital', D: 'Double', T: 'Triple', C: 'Centre', 57: '57' };

const somme = (t) => t.reduce((a, b) => a + b, 0);
const rotation = (ordre, k) => ordre.map((_, i) => ordre[(i + k) % ordre.length]);
export const IMPOSSIBLES_301 = [163, 166, 169, 172, 173, 175, 176, 178, 179];

// ---------- Les jeux ----------
// Chaque jeu : creer(ordre) · courant(st) · jouer(st, action) · fini(st) · groupes(st)
// groupes : classement par groupes d'ex æquo, du meilleur au moins bon.

function grouper(joueurs, cle) {
  const tries = [...joueurs].sort((a, b) => cle(b) - cle(a));
  const g = [];
  tries.forEach((p) => {
    const dernier = g.at(-1);
    if (dernier && cle(dernier[0]) === cle(p)) dernier.push(p); else g.push([p]);
  });
  return g;
}

const parTours = {
  courant: (st) => st.ordre[st.t % st.ordre.length],
  tourComplet: (st) => st.t % st.ordre.length === 0,
};

// Points d'une fléchette au centre : 25 = 1, 50 = 2
export const pointsCentre = (d) => (d === 50 || d === 'Bull' ? 2 : d === 25 || d === '25' ? 1 : 0);

const MOTEURS = {
  centre: {
    creer: (ordre) => ({ ordre, t: 0, volees: ordre.map(() => []), total: ordre.map(() => 0) }),
    ...parTours,
    jouer(st, a) {
      const p = this.courant(st);
      const fl = (a.fleches || []).slice(0, 3).map((d) => (d === 50 || d === 25 ? d : 0));
      st.volees[p].push(fl);
      st.total[p] += somme(fl.map(pointsCentre));
      st.t += 1;
    },
    fini: (st) => st.t > 0 && st.t % st.ordre.length === 0 && Math.max(...st.total) >= CENTRE_BUT,
    groupes: (st) => grouper(st.ordre, (p) => st.total[p]),
  },

  mickey: {
    creer: (ordre) => ({ ordre, t: 0, touches: ordre.map(() => Object.fromEntries(CIBLES_MICKEY.map((c) => [c, 0]))), volees: ordre.map(() => []) }),
    ...parTours,
    jouer(st, a) {
      const p = this.courant(st);
      const fl = (a.fleches || []).slice(0, 3);
      fl.forEach((c) => { if (c && CIBLES_MICKEY.includes(c) && st.touches[p][c] < 3) st.touches[p][c] += 1; });
      st.volees[p].push(fl);
      st.t += 1;
    },
    total: (st, p) => somme(Object.values(st.touches[p])),
    ferme: (st, p) => CIBLES_MICKEY.every((c) => st.touches[p][c] >= 3),
    fini(st) { return st.t > 0 && st.t % st.ordre.length === 0 && st.ordre.some((p) => this.ferme(st, p)); },
    groupes(st) { return grouper(st.ordre, (p) => this.total(st, p)); },
  },

  finish: {
    creer: (ordre) => ({ ordre, t: 0, etape: ordre.map(() => 0), volees: ordre.map(() => []) }),
    ...parTours,
    jouer(st, a) {
      const p = this.courant(st);
      st.volees[p].push({ cible: FINISHS[st.etape[p]], reussi: !!a.reussi });
      if (a.reussi && st.etape[p] < FINISHS.length) st.etape[p] += 1;
      st.t += 1;
    },
    fini: (st) => st.t > 0 && st.t % st.ordre.length === 0 && st.ordre.some((p) => st.etape[p] >= FINISHS.length),
    groupes: (st) => grouper(st.ordre, (p) => st.etape[p]),
  },

  x01: {
    creer: (ordre, depart = 301) => ({ ordre, t: 0, depart, reste: ordre.map(() => depart), volees: ordre.map(() => []), gagnant: null }),
    courant: (st) => st.ordre[st.t % st.ordre.length],
    jouer(st, a) {
      const p = this.courant(st);
      const s = Number(a.score) || 0;
      const r = st.reste[p];
      let nature = 'normale';
      if (s === r && a.fin) { st.reste[p] = 0; st.gagnant = p; nature = 'finish'; }
      else if (s >= r || r - s === 1) nature = 'bust';
      else st.reste[p] = r - s;
      st.volees[p].push({ score: s, nature });
      st.t += 1;
    },
    fini: (st) => st.gagnant !== null,
    // Le gagnant d'abord ; les autres selon le reste (le plus petit devant)
    groupes: (st) => grouper(st.ordre, (p) => -st.reste[p]),
  },

  capital: {
    creer: (ordre) => ({ ordre, t: 0, capital: ordre.map(() => 0), volees: ordre.map(() => []) }),
    ...parTours,
    manche: (st) => Math.floor(st.t / st.ordre.length),
    jouer(st, a) {
      const p = this.courant(st);
      const m = MANCHES_CAPITAL[this.manche(st)];
      const fl = (a.fleches || []).slice(0, 3);
      const pts = pointsCapital(m, fl);
      const avant = st.capital[p];
      st.capital[p] = pts > 0 ? avant + pts : Math.ceil(avant / 2);
      st.volees[p].push({ manche: m, fleches: fl, points: pts, capital: st.capital[p] });
      st.t += 1;
    },
    fini: (st) => st.t >= st.ordre.length * MANCHES_CAPITAL.length,
    groupes: (st) => grouper(st.ordre, (p) => st.capital[p]),
  },
};
MOTEURS['301a'] = MOTEURS.x01;
MOTEURS['301b'] = MOTEURS.x01;

// Points marqués sur une manche du capital (labels : '20', 'D16', 'T19', '25', 'Bull', '0')
export function pointsCapital(manche, fleches) {
  const v = fleches.map((l) => valeurFleche(l || '0'));
  const num = (l) => (l === 'Bull' || l === '25' ? 25 : Number(String(l).replace(/^[TD]/, '')) || 0);
  switch (manche) {
    case '$': return somme(v);
    case 'D': return somme(fleches.map((l, i) => (l && (l.startsWith('D') || l === 'Bull') ? v[i] : 0)));
    case 'T': return somme(fleches.map((l, i) => (l && l.startsWith('T') ? v[i] : 0)));
    case 'C': return somme(fleches.map((l, i) => (l === '25' || l === 'Bull' ? v[i] : 0)));
    case '57': return somme(v) === 57 ? 57 : 0;
    default: return somme(fleches.map((l, i) => (l && num(l) === Number(manche) ? v[i] : 0)));
  }
}

// ---------- Départages ----------
// Les groupes d'ex æquo qui chevauchent des places payées différemment doivent être départagés.
function aDepartager(groupes, points) {
  let pos = 0;
  for (const g of groupes) {
    const vals = g.map((_, i) => points[pos + i] ?? 0);
    if (g.length > 1 && new Set(vals).size > 1) return { groupe: g, position: pos };
    pos += g.length;
  }
  return null;
}

function creerDepartage(type, groupe, position, ordre, info = {}) {
  // Les joueurs du groupe lancent dans l'ordre du jeu
  const g = ordre.filter((p) => groupe.includes(p));
  return { type, restants: g, position, places: [], t: 0, ...info,
    x01: type === '501' ? MOTEURS.x01.creer(g, 501) : null };
}

function joueurDepartage(d) {
  if (d.type === '501') return MOTEURS.x01.courant(d.x01);
  return d.restants[d.t % d.restants.length];
}

// Renvoie true quand le départage est terminé ; d.places reçoit les joueurs dans l'ordre gagné
function jouerDepartage(d, a, etapes, points) {
  const p = joueurDepartage(d);
  let gagne = false;
  if (d.type === 'bulle') gagne = !!a.touche;
  else if (d.type === 'finish') {
    gagne = !!a.reussi;
    if (gagne) etapes[p] += 1;
  } else if (d.type === '501') {
    MOTEURS.x01.jouer(d.x01, a);
    gagne = d.x01.gagnant === p;
  }
  d.journal = [...(d.journal || []), { joueur: p, ...a }];
  if (gagne) {
    d.places.push(p);
    d.restants = d.restants.filter((x) => x !== p);
    if (d.type === '501') {
      d.x01 = MOTEURS.x01.creer(d.restants, 501);
    }
    d.t = 0;
  } else d.t += 1;
  // Fini quand il reste un seul joueur, ou quand les places restantes rapportent toutes la même chose
  const pos = d.position + d.places.length;
  const vals = d.restants.map((_, i) => points[pos + i] ?? 0);
  return d.restants.length <= 1 || new Set(vals).size <= 1;
}

// ---------- La partie ----------

export function phasesDe(config) {
  return config.mode === 'capital' ? ['capital'] : ORDRE_PENTADARTS;
}

// Rejoue la partie : renvoie l'état complet pour l'affichage
export function calculer(config, actions) {
  const n = config.joueurs.length;
  const ordre0 = config.ordre?.length === n ? config.ordre : config.joueurs.map((_, i) => i);
  const phases = phasesDe(config);
  const etat = { phases, k: 0, jeux: {}, resultats: {}, departage: null, final: null, termine: false };

  const ouvrir = (k) => {
    const cle = phases[k];
    const ordre = config.mode === 'capital' ? ordre0 : rotation(ordre0, k);
    etat.jeux[cle] = MOTEURS[cle].creer(ordre);
  };
  ouvrir(0);

  const points = (cle) => (config.mode === 'capital' ? [] : JEUX[cle].points);

  // Fin d'un jeu : classement, départage éventuel, puis points
  const cloturer = () => {
    const cle = phases[etat.k];
    const st = etat.jeux[cle];
    const groupes = MOTEURS[cle].groupes.call(MOTEURS[cle], st);
    const res = etat.resultats[cle] || { groupes, departages: [] };
    res.groupes = res.groupes || groupes;
    etat.resultats[cle] = res;
    const besoin = config.mode === 'capital' ? null : aDepartager(res.groupes, points(cle));
    if (besoin) {
      const etapeCommune = cle === 'finish' ? st.etape[besoin.groupe[0]] : null;
      const type = cle === 'finish' && etapeCommune < FINISHS.length ? 'finish' : 'bulle';
      etat.departage = creerDepartage(type, besoin.groupe, besoin.position, st.ordre,
        { jeu: cle, cible: type === 'finish' ? FINISHS[etapeCommune] : null });
      return;
    }
    // Places et points
    const classement = res.groupes.flat();
    res.classement = classement;
    res.rangs = {};
    let pos = 0;
    res.groupes.forEach((g) => { g.forEach((p) => { res.rangs[p] = pos + 1; }); pos += g.length; });
    res.points = Object.fromEntries(config.joueurs.map((_, p) => [p, 0]));
    pos = 0;
    res.groupes.forEach((g) => { g.forEach((p, i) => { res.points[p] = points(cle)[pos + i] ?? 0; }); pos += g.length; });
    if (etat.k + 1 < phases.length) { etat.k += 1; ouvrir(etat.k); } else finir();
  };

  // Départage terminé : on remplace le groupe d'ex æquo par l'ordre obtenu
  const appliquerDepartage = () => {
    const d = etat.departage;
    const res = etat.resultats[d.jeu];
    const ordreGagne = [...d.places, ...d.restants];
    const nouveaux = [];
    res.groupes.forEach((g) => {
      if (g.length === d.places.length + d.restants.length && g.every((p) => ordreGagne.includes(p))) {
        d.places.forEach((p) => nouveaux.push([p]));
        if (d.restants.length) nouveaux.push([...d.restants]);
      } else nouveaux.push(g);
    });
    res.groupes = nouveaux;
    res.departages.push({ type: d.type, cible: d.cible, ordre: ordreGagne, journal: d.journal || [] });
    etat.departage = null;
  };

  // Fin de partie : total des points ; égalité pour la 1re ou la 2e place → manche de 501
  const finir = () => {
    if (config.mode === 'capital') {
      const st = etat.jeux.capital;
      etat.final = { groupes: MOTEURS.capital.groupes(st), totaux: Object.fromEntries(st.ordre.map((p) => [p, st.capital[p]])) };
      etat.termine = true;
      return;
    }
    const totaux = Object.fromEntries(config.joueurs.map((_, p) => [p, somme(phases.map((c) => etat.resultats[c]?.points?.[p] || 0))]));
    const groupes = etat.final?.groupes || grouper(ordre0, (p) => totaux[p]);
    etat.final = { totaux, groupes, departages: etat.final?.departages || [] };
    const besoin = aDepartager(groupes, [2, 1, 0]);   // seules les 1re et 2e places se départagent
    if (besoin) {
      etat.departage = creerDepartage('501', besoin.groupe, besoin.position, ordre0, { jeu: 'final' });
      return;
    }
    etat.termine = true;
  };

  const appliquerDepartageFinal = () => {
    const d = etat.departage;
    const ordreGagne = [...d.places, ...d.restants];
    const nouveaux = [];
    etat.final.groupes.forEach((g) => {
      if (g.every((p) => ordreGagne.includes(p)) && g.length === ordreGagne.length) {
        d.places.forEach((p) => nouveaux.push([p]));
        if (d.restants.length) nouveaux.push([...d.restants]);
      } else nouveaux.push(g);
    });
    etat.final.groupes = nouveaux;
    etat.final.departages.push({ type: '501', ordre: ordreGagne, journal: d.journal || [] });
    etat.departage = null;
  };

  for (const a of actions) {
    if (etat.termine) break;
    if (etat.departage) {
      const d = etat.departage;
      const etapes = d.jeu === 'finish' ? etat.jeux.finish.etape : [];
      const pts = d.jeu === 'final' ? [2, 1, 0] : points(d.jeu);
      if (jouerDepartage(d, a, etapes, pts)) {
        if (d.jeu === 'final') { appliquerDepartageFinal(); finir(); } else { appliquerDepartage(); cloturer(); }
      }
      continue;
    }
    const cle = phases[etat.k];
    const moteur = MOTEURS[cle];
    moteur.jouer.call(moteur, etat.jeux[cle], a);
    if (moteur.fini.call(moteur, etat.jeux[cle])) cloturer();
  }
  // Qui lance ?
  if (!etat.termine) {
    if (etat.departage) etat.joueur = joueurDepartage(etat.departage);
    else { const cle = phases[etat.k]; etat.joueur = MOTEURS[cle].courant.call(MOTEURS[cle], etat.jeux[cle]); }
  }
  etat.jeu = etat.departage ? etat.departage.jeu : phases[etat.k];
  return etat;
}

// Utilitaires d'affichage
export const totalMickey = (st, p) => MOTEURS.mickey.total(st, p);
export const mancheCapital = (st) => MOTEURS.capital.manche(st);
export const mickeyFerme = (st, p) => MOTEURS.mickey.ferme(st, p);
