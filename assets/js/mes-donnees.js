// =====================================================================
//  Mes données (RGPD) : tout ce que le site garde sur le joueur connecté,
//  présenté de façon lisible. La page s'imprime ou s'enregistre en PDF ;
//  le fichier brut (JSON) reste téléchargeable pour la portabilité.
// =====================================================================

import { supabase, esc, profilConnecte, erreurFr, formatPartie } from './app.js?v=__VERSION__';

const zone = document.getElementById('donnees');
const fmtJour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtHeure = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const jour = (d) => (d ? fmtJour.format(new Date(d)) : '—');
const heure = (d) => (d ? fmtHeure.format(new Date(d)) : '—');
const val = (v) => (v === null || v === undefined || v === '' ? '<span class="md-vide">Non renseigné</span>' : esc(v));
const STATUTS_COMPTE = { pending: 'En attente de validation', active: 'Validé', refused: 'Refusé' };
const ROLES = { member: 'Membre', admin: 'Administrateur' };
const STATUTS_EQUIPE = { pending: 'Demande en attente', accepted: 'Membre de l\'équipe', refused: 'Demande refusée' };
const STATUTS_PARTIE = { live: 'En cours', finished: 'Terminée', abandoned: 'Abandonnée' };
const STATUTS_TOURNOI = { draft: 'Brouillon', open: 'Inscriptions ouvertes', running: 'En cours', finished: 'Terminé' };

let brut = null;

function ligne(titre, valeur) {
  return `<div class="md-ligne"><dt>${titre}</dt><dd>${valeur}</dd></div>`;
}

function bloc(titre, contenu, note = '') {
  return `<section class="carte-info md-bloc"><h2>${titre}</h2>${note ? `<p class="md-note">${note}</p>` : ''}${contenu}</section>`;
}

// Une partie : date, format, adversaires, résultat, manches et moyenne (calculées sur mes volées)
function lignePartie(x) {
  const g = x.partie;
  const moi = (x.joueurs || []).find((j) => j.moi);
  const monCamp = moi?.camp;
  const adversaires = (x.joueurs || []).filter((j) => j.camp !== monCamp).map((j) => j.nom);
  const partenaires = (x.joueurs || []).filter((j) => j.camp === monCamp && !j.moi).map((j) => j.nom);
  const volees = x.mes_volees || [];
  const manchesJouees = new Set(volees.map((v) => `${v.set_no}-${v.leg_no}`)).size;
  const gagnees = volees.filter((v) => v.is_checkout).length;
  const points = volees.reduce((s, v) => s + (v.is_bust ? 0 : v.score), 0);
  const flechettes = volees.reduce((s, v) => s + (v.is_checkout ? v.darts_used : 3), 0);
  const moyenne = flechettes ? ((points / flechettes) * 3).toFixed(1).replace('.', ',') : '—';
  let resultat = STATUTS_PARTIE[g.status] || g.status;
  if (g.status === 'finished' && adversaires.length) resultat = g.winner_side === monCamp ? 'Victoire' : 'Défaite';
  const detail = [`${gagnees} manche${gagnees > 1 ? 's' : ''} gagnée${gagnees > 1 ? 's' : ''} sur ${manchesJouees}`, `moyenne ${moyenne}`, `${volees.length} volée${volees.length > 1 ? 's' : ''}`].join(' · ');
  return `
    <li class="md-partie">
      <div class="md-partie__haut">
        <span class="md-partie__date">${esc(jour(g.finished_at || g.created_at))}</span>
        <span class="md-partie__res${resultat === 'Victoire' ? ' s-gagne' : ''}">${esc(resultat)}</span>
      </div>
      <div class="md-partie__contre">${adversaires.length ? `contre ${esc(adversaires.join(', '))}` : 'Seul'}${partenaires.length ? ` <small>(avec ${esc(partenaires.join(', '))})</small>` : ''}</div>
      <div class="md-partie__info">${esc(formatPartie(g))}${g.tournament_match_id ? ' · match de tournoi' : ''}</div>
      <div class="md-partie__info">${esc(detail)}</div>
    </li>`;
}

function afficher(d) {
  const p = d.profil || {};
  const c = d.coordonnees || {};
  const parties = d.parties || [];
  const materiel = [p.hand === 'gaucher' ? 'Gaucher' : (p.hand === 'droitier' ? 'Droitier' : ''), p.dart_brand,
    p.dart_weight ? `${Number(p.dart_weight).toLocaleString('fr-FR')} g` : ''].filter(Boolean).join(' · ');
  const nbVolees = parties.reduce((s, x) => s + (x.mes_volees || []).length, 0);

  zone.innerHTML = `
    <div class="md-entete">
      <h1>Mes données</h1>
      <p class="intro">Voici toutes les informations que le site du Dolina Darts Club garde sur vous, au ${esc(heure(d.date_export))}.</p>
      <div class="actions md-actions">
        <a class="bouton bouton--plein" id="btn-imprimer" href="mes-donnees.html?imprimer=1" target="_blank" rel="noopener">Imprimer ou enregistrer en PDF</a>
        <button type="button" class="bouton" id="btn-json">Télécharger le fichier de données</button>
        <a class="bouton" href="compte.html">Retour à mon compte</a>
      </div>
      <p class="md-note md-ecran">Le fichier de données (format JSON) contient les mêmes informations, dans un format lisible par un autre logiciel.</p>
    </div>

    ${bloc('Mon compte', `<dl class="md-liste">
      ${ligne('Email de connexion', val(d.compte?.email))}
      ${ligne('Compte créé le', esc(heure(d.compte?.cree_le || p.created_at)))}
      ${ligne('Statut', esc(STATUTS_COMPTE[p.status] || p.status || '—'))}
      ${p.validated_at ? ligne('Validé le', esc(heure(p.validated_at))) : ''}
      ${ligne('Rôle', esc(ROLES[p.role] || p.role || '—'))}
    </dl>`)}

    ${bloc('Mon profil', `<dl class="md-liste">
      ${ligne('Prénom', val(p.first_name))}
      ${ligne('Nom', val(p.last_name))}
      ${ligne('Surnom', val(p.nickname))}
      ${ligne('Surnom utilisé sur le site', p.use_nickname ? 'Oui' : 'Non')}
      ${ligne('Matériel', val(materiel))}
      ${ligne('Photo de profil', p.photo_path ? 'Oui' : 'Aucune')}
      ${ligne('Accord pour afficher ma photo aux membres', p.photo_consent ? 'Oui' : 'Non')}
    </dl>`, 'Visible des membres validés du club (jamais des visiteurs).')}

    ${bloc('Mes coordonnées', `<dl class="md-liste">
      ${ligne('Email', val(c.email))}
      ${ligne('Téléphone', val(c.phone))}
      ${ligne('Politique de confidentialité acceptée le', esc(heure(c.privacy_accepted_at)))}
    </dl>`, 'Visibles uniquement par vous et les administrateurs du club.')}

    ${bloc('Mes équipes', (d.equipes || []).length
    ? `<ul class="md-puces">${d.equipes.map((e) => `<li><strong>${esc(e.equipe)}</strong> — ${esc(STATUTS_EQUIPE[e.statut] || e.statut)} (demande du ${esc(jour(e.demande_le))})</li>`).join('')}</ul>`
    : '<p class="md-vide">Aucune équipe.</p>')}

    ${bloc(`Mes parties (${parties.length})`, parties.length
    ? `<ul class="md-parties">${[...parties].sort((a, b) => new Date(b.partie.finished_at || b.partie.created_at) - new Date(a.partie.finished_at || a.partie.created_at)).map(lignePartie).join('')}</ul>`
    : '<p class="md-vide">Aucune partie enregistrée.</p>',
  parties.length ? `${nbVolees} volées enregistrées au total. Le détail de chaque volée (score, reste, fléchettes) figure dans le fichier de données.` : '')}

    ${bloc('Mes tournois', `
      <h3 class="md-sous">Inscriptions</h3>
      ${(d.tournois_inscrit || []).length
    ? `<ul class="md-puces">${d.tournois_inscrit.map((t) => `<li><strong>${esc(t.tournoi)}</strong>${t.doublette ? ` (doublette « ${esc(t.doublette)} »)` : ''} — ${esc(STATUTS_TOURNOI[t.statut] || t.statut)}, inscrit le ${esc(jour(t.inscrit_le))}</li>`).join('')}</ul>`
    : '<p class="md-vide">Aucune inscription.</p>'}
      <h3 class="md-sous">Tournois que j'organise</h3>
      ${(d.tournois_organises || []).length
    ? `<ul class="md-puces">${d.tournois_organises.map((t) => `<li><strong>${esc(t.tournoi)}</strong> — ${esc(STATUTS_TOURNOI[t.statut] || t.statut)}, créé le ${esc(jour(t.cree_le))}</li>`).join('')}</ul>`
    : '<p class="md-vide">Aucun tournoi organisé.</p>'}`)}

    <p class="md-note">Pour corriger une information, utilisez « Modifier mon profil » dans Mon compte, ou écrivez à dolinadartsclub@gmail.com. Vous pouvez aussi supprimer votre compte depuis Mon compte.</p>`;

  document.getElementById('btn-json').addEventListener('click', telechargerJson);
}

function telechargerJson() {
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([JSON.stringify(brut, null, 2)], { type: 'application/json' }));
  lien.download = `mes-donnees-dolina-${new Date().toLocaleDateString('fr-CA')}.json`;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
}

async function init() {
  const moi = await profilConnecte();
  if (!moi) {
    zone.innerHTML = '<p class="vide">Connectez-vous pour voir vos données. <a href="connexion.html">Se connecter</a></p>';
    return;
  }
  const { data, error } = await supabase.rpc('mes_donnees');
  if (error) {
    zone.innerHTML = `<p class="vide">Vos données ne peuvent pas être affichées pour le moment. ${esc(erreurFr(error))}</p>`;
    return;
  }
  brut = data;
  afficher(data);
  // Ouverte dans un nouvel onglet pour l'impression : la fenêtre d'impression s'ouvre seule
  if (new URLSearchParams(location.search).has('imprimer')) {
    document.title = `Mes données Dolina Darts Club – ${new Date().toLocaleDateString('fr-FR')}`;
    setTimeout(() => window.print(), 600);
  }
}

init();
