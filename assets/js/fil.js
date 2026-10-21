// =====================================================================
//  Fil du club (membres connectés) – script SQL 047
//  Annonces automatiques à chaque match terminé : finish 100+, 180,
//  volées de 120+, moyenne de 60+, records perso et du club.
//  Affiché dans Équipes, onglet « Fil du club ».
// =====================================================================

import { supabase, esc, nomAffiche, avatar, erreurFr, dateFr } from './app.js?v=__VERSION__';

const PAR_PAGE = 15;
const virgule = (n) => (n === null || n === undefined ? '–' : Number(n).toFixed(1).replace('.', ','));

function quand(date) {
  const min = Math.round((Date.now() - Date.parse(date)) / 60000);
  if (min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return j === 1 ? 'hier' : (j < 7 ? `il y a ${j} jours` : dateFr(date));
}

// Titre de l'annonce : l'exploit le plus marquant
function titre(a) {
  const nom = esc(nomAffiche(a.joueur));
  if (a.record_club_moyenne) return `${nom} bat le record du club : ${virgule(a.moyenne)} de moyenne !`;
  if (a.record_club_finish) return `${nom} bat le record de finish du club : ${a.meilleur_finish} !`;
  if (a.nb_180 > 1) return `${nom} a tapé ${a.nb_180} fois 180 !`;
  if (a.nb_180) return `${nom} a tapé un 180 !`;
  if (a.meilleur_finish >= 100) return `${nom} a fini ${a.meilleur_finish} !`;
  if (a.record_perso_moyenne) return `${nom} bat son record de moyenne : ${virgule(a.moyenne)}`;
  if (a.record_perso_finish) return `${nom} bat son record de finish : ${a.meilleur_finish}`;
  if (a.nb_120) return `${nom} a tapé ${a.meilleure_volee}`;
  return `${nom} tourne à ${virgule(a.moyenne)} de moyenne`;
}

function badges(a) {
  const b = [];
  if (a.record_club_moyenne || a.record_club_finish) b.push(['record', `Record du club${a.record_club_moyenne && a.record_club_finish ? 's' : ''}`]);
  if (a.record_perso_moyenne || a.record_perso_finish) b.push(['perso', 'Record perso']);
  if (a.nb_180) b.push(['fort', `180${a.nb_180 > 1 ? ` ×${a.nb_180}` : ''}`]);
  if (a.meilleur_finish >= 100) b.push(['fort', `Finish ${a.meilleur_finish}`]);
  if (a.nb_120) b.push(['', `${a.nb_120} volée${a.nb_120 > 1 ? 's' : ''} de 120+`]);
  if (a.moyenne >= 60) b.push(['', `Moy. ${virgule(a.moyenne)}`]);
  return b.map(([c, t]) => `<span class="fil-badge${c ? ` fil-badge--${c}` : ''}">${esc(t)}</span>`).join('');
}

function carte(a) {
  const score = `${a.manches_pour}–${a.manches_contre}`;
  const contexte = a.tournoi ? 'tournoi' : (a.type === 'ligue' ? 'ligue' : '');
  return `
    <a class="fil-carte${a.record_club_moyenne || a.record_club_finish ? ' fil-carte--record' : ''}" href="live.html?id=${encodeURIComponent(a.game_id)}">
      ${avatar(a.joueur, 'fil-avatar')}
      <span class="fil-carte__corps">
        <strong class="fil-carte__titre">${titre(a)}</strong>
        <span class="fil-carte__match">${a.gagne ? 'Victoire' : 'Défaite'} ${score} contre ${esc(a.adversaire || '—')} · ${esc(a.variant === 'libre' ? String(a.start_score) : a.variant)}${contexte ? ` · ${contexte}` : ''} · moy. ${virgule(a.moyenne)}</span>
        <span class="fil-badges">${badges(a)}</span>
        <small class="fil-carte__quand">${esc(quand(a.fin))}</small>
      </span>
    </a>`;
}

export async function afficherFil(conteneur) {
  conteneur.innerHTML = `
    <p class="intro fil-intro">Les exploits des membres, ajoutés automatiquement à chaque match terminé : finish de 100 ou plus, 180, volées de 120 ou plus, moyenne de 60 ou plus, et records. Hors dartbot et matchs amicaux.</p>
    <div class="fil" id="fil-liste"><p class="vide">Chargement…</p></div>`;
  const liste = conteneur.querySelector('#fil-liste');
  let decalage = 0;
  const charger = async () => {
    const { data, error } = await supabase.rpc('fil_du_club', { p_decalage: decalage, p_limite: PAR_PAGE });
    liste.querySelector('.fil-plus')?.remove();
    if (error) {
      const absente = /schema cache|function/i.test(error.message || '');
      liste.innerHTML = `<p class="vide">${absente ? 'Le fil du club sera disponible après l\'exécution du script SQL 047 dans Supabase.' : esc(erreurFr(error))}</p>`;
      return;
    }
    if (!decalage) liste.innerHTML = '';
    if (!data.length && !decalage) {
      liste.innerHTML = '<p class="vide">Rien pour l\'instant : le premier finish de 100 ou le premier 180 apparaîtra ici.</p>';
      return;
    }
    liste.insertAdjacentHTML('beforeend', data.map(carte).join(''));
    decalage += data.length;
    if (data.length === PAR_PAGE) {
      liste.insertAdjacentHTML('beforeend', '<button type="button" class="bouton bouton--large fil-plus">Afficher plus d\'annonces</button>');
      liste.querySelector('.fil-plus').addEventListener('click', (e) => { e.target.disabled = true; charger(); });
    }
  };
  await charger();
}
