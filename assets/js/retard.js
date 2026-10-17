// =====================================================================
//  Rencontres en retard : date passée sans score (« À scorer ») ou
//  période passée sans date fixée (« À mettre à jour »). Bloc partagé
//  par l'espace admin et l'espace capitaine.
// =====================================================================

import { esc, rencontresEnRetard, ETATS_RETARD } from './app.js?v=__VERSION__';

const court = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const d = (x) => court.format(new Date(`${x}T12:00:00`));

// Remplit `zone` et renvoie le nombre de rencontres à traiter
export async function blocRencontresRetard(zone, equipe = null, { titre = true } = {}) {
  if (!zone) return 0;
  const liste = await rencontresEnRetard(equipe);
  if (!liste.length) { zone.innerHTML = ''; return 0; }
  zone.innerHTML = `
    <section class="carte-info retard">
      ${titre ? `<h2 class="retard__titre"><span class="retard__icone" aria-hidden="true">!</span>Rencontres à mettre à jour <span class="compteur">${liste.length}</span></h2>
      <p class="match__format" style="margin:0">Ces rencontres sont passées mais n'ont pas encore de score. Saisissez le résultat, ou fixez la date si le match a été décalé.</p>` : ''}
      <ul class="retard__liste">${liste.map((r) => {
    const nom = r.teams?.name || '';
    const quand = r.etat === 'maj' ? `Période du ${d(r.date_match)} au ${d(r.date_fin)} dépassée, date jamais fixée` : `Jouée le ${d(r.date_match)}`;
    return `
        <li class="retard__ligne retard__ligne--${r.etat}">
          <span class="retard__badge">${ETATS_RETARD[r.etat]}</span>
          <span class="retard__texte"><strong>${esc(nom)} ${r.domicile ? 'reçoit' : 'chez'} ${esc(r.adversaire)}</strong><small>${r.journee ? `${esc(r.journee)} · ` : ''}${esc(quand)}</small></span>
          <a class="bouton bouton--petit bouton--plein" href="equipes.html?modifier=${encodeURIComponent(r.id)}#${encodeURIComponent(nom)}">${r.etat === 'maj' ? 'Mettre à jour' : 'Saisir le score'}</a>
        </li>`;
  }).join('')}</ul>
    </section>`;
  return liste.length;
}
