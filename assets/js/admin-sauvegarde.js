// =====================================================================
//  Administration : sauvegarde des données et place utilisée
//  Le plan gratuit de Supabase ne sauvegarde rien automatiquement :
//  l'admin télécharge un fichier avec toutes les données, par exemple
//  une fois par mois, et le range en lieu sûr.
// =====================================================================

import { supabase, esc, message, erreurFr } from './app.js?v=__VERSION__';

const LIMITE_BASE = 500 * 1024 * 1024;      // plan gratuit : 500 Mo de base de données
const LIMITE_FICHIERS = 1024 * 1024 * 1024; // plan gratuit : 1 Go de fichiers
const RAPPEL_JOURS = 30;

let zone;
let zoneMsg;

const taille = (o) => {
  if (o === null || o === undefined) return '–';
  if (o < 1024 * 1024) return `${Math.max(1, Math.round(o / 1024))} Ko`;
  return `${(o / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
};
const fmtDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export async function initSauvegarde(zoneMessage) {
  zone = document.getElementById('vue-sauvegarde');
  zoneMsg = zoneMessage;
  zone.addEventListener('click', clic);
  await charger();
}

function jauge(titre, utilise, limite, limiteTexte) {
  const pc = utilise === null || utilise === undefined ? null : Math.min(100, (utilise / limite) * 100);
  const niveau = pc === null ? '' : (pc >= 90 ? ' sv-jauge--alerte' : (pc >= 70 ? ' sv-jauge--attention' : ''));
  return `
    <div class="sv-jauge${niveau}">
      <div class="sv-jauge__haut"><strong>${titre}</strong><span>${utilise === null || utilise === undefined ? 'non mesuré' : `${taille(utilise)} sur ${limiteTexte}`}${pc === null ? '' : ` · ${pc < 1 ? '< 1' : Math.round(pc)} %`}</span></div>
      <div class="sv-jauge__barre" role="progressbar" aria-label="${titre}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pc === null ? 0 : Math.round(pc)}"><span style="width:${pc === null ? 0 : Math.max(pc, 1)}%"></span></div>
    </div>`;
}

async function charger() {
  const { data, error } = await supabase.rpc('espace_utilise');
  if (error) {
    zone.innerHTML = `<p class="vide">Sauvegarde indisponible : exécutez le script SQL 024 dans Supabase. (${esc(erreurFr(error))})</p>`;
    return;
  }
  const derniere = data.derniere_sauvegarde ? new Date(data.derniere_sauvegarde) : null;
  const jours = derniere ? Math.floor((Date.now() - derniere.getTime()) / 86400000) : null;
  const enRetard = jours === null || jours >= RAPPEL_JOURS;
  document.getElementById('nb-sauvegarde').hidden = !enRetard;

  zone.innerHTML = `
    <h2 class="section__titre">Place utilisée</h2>
    <p class="sv-aide">Limites du plan gratuit de Supabase. Au-delà, le plan payant serait nécessaire.</p>
    ${jauge('Base de données', data.base, LIMITE_BASE, '500 Mo')}
    ${jauge('Fichiers (photos, images des actus)', data.fichiers, LIMITE_FICHIERS, '1 Go')}

    <h2 class="section__titre">Sauvegarde des données</h2>
    <div class="sv-etat${enRetard ? ' sv-etat--retard' : ''}">
      ${derniere
    ? `Dernière sauvegarde : <strong>${esc(fmtDate.format(derniere))}</strong> (${jours === 0 ? "aujourd'hui" : `il y a ${jours} jour${jours > 1 ? 's' : ''}`})`
    : '<strong>Aucune sauvegarde pour l\'instant.</strong>'}
      ${enRetard ? `<br>${derniere ? 'Pensez à en faire une nouvelle.' : 'Pensez à en faire une.'}` : ''}
    </div>
    <p class="sv-aide">Le fichier contient toutes les données du site : membres et coordonnées, équipes, actus, parties et volées, tournois, demandes, réglages.
      Les photos et images ne sont pas dedans (seulement leurs noms). <strong>Il contient des données personnelles</strong> : rangez-le dans un endroit privé
      (par exemple le Google Drive du club), jamais dans un dossier partagé publiquement. Une sauvegarde par mois suffit.</p>
    <div class="actions">
      <button type="button" class="bouton bouton--plein" id="btn-sauvegarder">Télécharger la sauvegarde</button>
    </div>`;
}

async function clic(e) {
  const b = e.target.closest('#btn-sauvegarder');
  if (!b) return;
  b.disabled = true;
  const texte = b.textContent;
  b.textContent = 'Préparation…';
  const { data, error } = await supabase.rpc('sauvegarde_club');
  b.disabled = false;
  b.textContent = texte;
  if (error) return message(zoneMsg, erreurFr(error));
  const contenu = JSON.stringify(data);
  const jour = new Date().toLocaleDateString('fr-CA'); // AAAA-MM-JJ
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([contenu], { type: 'application/json' }));
  lien.download = `dolina-sauvegarde-${jour}.json`;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
  const total = Object.values(data.nombres || {}).reduce((a, n) => a + n, 0);
  message(zoneMsg, `Sauvegarde téléchargée (${total.toLocaleString('fr-FR')} lignes, ${taille(contenu.length)}). Rangez le fichier en lieu sûr.`, 'ok');
  await charger();
}
