// =====================================================================
//  Mon compte : état du compte, équipes, espace capitaine, accès admin,
//  changement de mot de passe, déconnexion
//  profil modifiable, photo de profil
// =====================================================================

import { supabase, esc, profilConnecte, message, erreurFr, nomCompletHtml, nomAffiche, avatar, dateFr, DOSSIER_PHOTOS, oublierLienPhoto, identifiantDe, estCapitaineDe } from './app.js?v=__VERSION__';
import { debutSaison, nomSaison, resumeSaison } from './profil-commun.js?v=__VERSION__';

const zone = document.getElementById('contenu');
const boutonDeco = document.getElementById('deconnexion');

const STATUTS = {
  pending: ['statut--attente', 'En attente de validation par un admin'],
  active: ['statut--ok', 'Compte validé'],
  refused: ['statut--refus', 'Inscription refusée'],
};
const STATUTS_EQUIPE = {
  pending: ['statut--attente', 'En attente du capitaine'],
  accepted: ['statut--ok', 'Membre de l\'équipe'],
  refused: ['statut--refus', 'Demande refusée'],
};

let profil = null;
let messageGeneral = null;

async function afficher() {
  profil = await profilConnecte();
  if (!profil) {
    location.replace('connexion.html');
    return;
  }
  boutonDeco.hidden = false;
  const estActif = profil.status === 'active';
  const estAdmin = estActif && profil.role === 'admin';

  // Équipes du club, mes rattachements, mon profil détaillé et mon téléphone
  const [{ data: equipes }, { data: mesRattachements }, { data: detail }, { data: prive }] = await Promise.all([
    supabase.from('teams').select('*').order('sort_order'),
    supabase.from('team_members').select('team_id, status').eq('profile_id', profil.id),
    supabase.from('profiles').select('first_name, last_name, nickname, use_nickname, hand, dart_weight, dart_brand, photo_path, photo_consent, created_at').eq('id', profil.id).maybeSingle(),
    supabase.from('profile_private').select('phone').eq('id', profil.id).maybeSingle(),
  ]);
  const p = detail || {};
  // Résumé du matériel, ex. « Droitier · Target · 23,5 g »
  const poidsTexte = p.dart_weight ? `${Number(p.dart_weight).toLocaleString('fr-FR')} g` : '';
  const materiel = [p.hand === 'gaucher' ? 'Gaucher' : (p.hand === 'droitier' ? 'Droitier' : ''), p.dart_brand, poidsTexte]
    .filter(Boolean).join(' · ');

  // Espace capitaine : demandes en attente pour mon équipe
  const monEquipe = (equipes || []).find((t) => estCapitaineDe(t, profil.id) && estActif);
  let demandes = [];
  if (monEquipe) {
    const { data } = await supabase
      .from('team_members')
      .select('profile_id, status, requested_at, profiles!team_members_profile_id_fkey(first_name, last_name, nickname, status)')
      .eq('team_id', monEquipe.id)
      .eq('status', 'pending')
      .order('requested_at');
    demandes = data || [];
  }

  // Résumé de ma saison (membres validés)
  let resume = '';
  if (estActif) {
    const { data: st } = await supabase.rpc('stats_joueur', { p_profile: profil.id, p_debut: debutSaison().toISOString(), p_fin: null, p_variant: null });
    resume = resumeSaison(st);
  }

  // Admin : nombre d'inscriptions à valider
  let nbAttente = 0;
  if (estAdmin) {
    const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    nbAttente = count || 0;
  }

  const [classe, libelle] = STATUTS[profil.status] || STATUTS.pending;
  const nom = profil.first_name ? `${profil.first_name} ${profil.last_name}` : profil.email;

  let explication = '';
  if (profil.status === 'pending') {
    explication = '<p class="intro">Votre demande est enregistrée. Un admin du club doit maintenant valider votre compte. Revenez sur cette page pour suivre son avancement.</p>';
  } else if (profil.status === 'refused') {
    explication = '<p class="intro">Votre inscription n\'a pas été acceptée. Pour toute question, écrivez à <a href="mailto:dolinadartsclub@gmail.com">dolinadartsclub@gmail.com</a>.</p>';
  }

  // ----- Bloc admin -----
  const blocAdmin = estAdmin ? `
    <div class="alerte">
      <span>${nbAttente
        ? `<strong>${nbAttente} inscription${nbAttente > 1 ? 's' : ''}</strong> en attente de validation`
        : 'Aucune inscription en attente'}</span>
      <a class="bouton bouton--plein" href="admin.html">Espace admin</a>
    </div>` : '';

  // ----- Bloc capitaine -----
  const blocCapitaine = monEquipe ? `
    <div class="carte-info" id="capitaine">
      <div class="cap-bloc-tete"><h2>Capitaine · ${esc(monEquipe.name)}</h2><a class="lien-equipe" href="capitaine.html">Espace capitaine →</a></div>
      ${demandes.length ? demandes.map((d) => {
        const p = d.profiles || {};
        const valide = p.status === 'active';
        return `
          <div class="ligne-equipe">
            <span class="ligne-equipe__nom">${nomCompletHtml(p)}</span>
            ${valide ? '<span class="statut statut--attente">Veut intégrer l\'équipe</span>' : '<span class="statut statut--attente">Compte pas encore validé</span>'}
            <span class="ligne-equipe__actions">
              <button type="button" class="bouton bouton--petit bouton--plein" data-action="cap-accepter" data-id="${d.profile_id}" ${valide ? '' : 'disabled title="Un admin doit d\'abord valider ce compte"'}>Accepter</button>
              <button type="button" class="bouton bouton--petit bouton--danger" data-action="cap-refuser" data-id="${d.profile_id}">Refuser</button>
            </span>
          </div>`;
      }).join('') : '<p class="intro">Aucune demande en attente pour votre équipe.</p>'}
    </div>` : '';

  // ----- Mon équipe : seulement les équipes demandées ou rejointes -----
  const rattachements = mesRattachements || [];
  const mesEquipes = (equipes || []).filter((t) => rattachements.some((x) => x.team_id === t.id));
  const autresEquipes = (equipes || []).filter((t) => !rattachements.some((x) => x.team_id === t.id));
  const lignesEquipes = mesEquipes.map((t) => {
    const m = rattachements.find((x) => x.team_id === t.id);
    const capitaine = t.captain_id === profil.id;
    const vice = t.vice_captain_id === profil.id;
    let action = '';
    if (m.status === 'pending') action = `<button type="button" class="bouton bouton--mini bouton--danger" data-action="annuler" data-team="${t.id}">Annuler la demande</button>`;
    else if (m.status === 'refused') action = `<button type="button" class="bouton bouton--petit" data-action="redemander" data-team="${t.id}">Refaire une demande</button>`;
    const [c, l] = STATUTS_EQUIPE[m.status];
    return `
      <div class="ligne-equipe">
        <span class="ligne-equipe__nom">${esc(t.name)}${capitaine ? ' <span class="statut statut--ok">Capitaine</span>' : (vice ? ' <span class="statut statut--ok">Vice-capitaine</span>' : '')}
          ${m.status === 'accepted' ? `<a class="lien-equipe" href="equipes.html#${encodeURIComponent(t.name)}">Calendrier de l'équipe →</a>` : ''}</span>
        <span class="statut ${c}">${l}</span>
        <span class="ligne-equipe__actions">${action}</span>
      </div>`;
  }).join('');
  const aucuneEquipe = !rattachements.some((m) => m.status === 'accepted');

  // Bouton « Rejoindre une équipe » : déplie la liste des autres équipes
  const blocRejoindre = autresEquipes.length ? `
    <details class="repli rejoindre">
      <summary class="bouton bouton--petit">Rejoindre une équipe</summary>
      <div class="repli__contenu">
        <p class="match__format" style="margin:0">Votre demande sera envoyée au capitaine de l'équipe, qui l'acceptera ou la refusera.</p>
        ${autresEquipes.map((t) => `
          <div class="ligne-equipe">
            <span class="ligne-equipe__nom">${esc(t.name)}</span>
            <button type="button" class="bouton bouton--petit bouton--plein" data-action="rejoindre" data-team="${t.id}">Demander à rejoindre</button>
          </div>`).join('')}
      </div>
    </details>` : '';

  const equipesAcceptees = mesEquipes.filter((t) => rattachements.find((x) => x.team_id === t.id)?.status === 'accepted');
  const blocPhoto = `
        <section class="photo-profil" id="bloc-photo" aria-labelledby="t-photo">
          <h3 id="t-photo" class="donnees__titre">Ma photo</h3>
          <div class="message" id="message-photo" role="alert" hidden></div>
          <div class="photo-profil__actions">
            <input type="file" id="champ-photo" class="visuellement-cache" accept="image/jpeg,image/png,image/webp">
            <label for="champ-photo" class="bouton bouton--petit${p.photo_consent ? '' : ' bouton--inactif'}" id="btn-choisir-photo" ${p.photo_consent ? '' : 'aria-disabled="true"'}>${p.photo_path ? 'Changer ma photo' : 'Ajouter une photo'}</label>
            ${p.photo_path ? '<button type="button" class="bouton bouton--petit bouton--danger" id="btn-retirer-photo">Retirer ma photo</button>' : ''}
          </div>
          <label class="case case--simple"><input type="checkbox" id="accord-photo" ${p.photo_consent ? 'checked' : ''}>J'accepte que ma photo soit visible des membres connectés du club (jamais des visiteurs).</label>
          <small class="match__format">La photo est recadrée en carré et réduite automatiquement. Décocher la case retire votre photo.</small>
        </section>`;

  zone.innerHTML = `
    <div class="message" id="message-general" role="alert" hidden></div>
    <section class="carte-info cp-profil" aria-label="Mon profil">
      <div class="pr-entete cp-entete">
        <button type="button" class="cp-photo" id="btn-photo-entete" aria-label="${p.photo_path ? 'Changer ma photo' : 'Ajouter une photo'}" title="${p.photo_path ? 'Changer ma photo' : 'Ajouter une photo'}">
          ${avatar({ ...p, id: profil.id }, 'avatar--profil')}
          <span class="cp-photo__badge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg></span>
        </button>
        <div class="pr-identite">
          <h1 class="pr-nom">${profil.first_name ? nomCompletHtml({ ...profil, ...p }) : esc(nom)}</h1>
          ${p.use_nickname && p.nickname ? `<p class="pr-sous">Affiché sur le site : <strong>${esc(nomAffiche({ ...profil, ...p }))}</strong></p>` : ''}
          <div class="pr-badges">
            ${estActif ? (equipesAcceptees.length ? equipesAcceptees.map((t) => `<span class="t-role t-role--joueur">${esc(t.name)}</span>`).join('') : '<span class="t-role">Sans équipe</span>') : `<span class="statut ${classe}">${libelle}</span>`}
            ${estAdmin ? '<span class="t-role">Administrateur</span>' : ''}
          </div>
          ${materiel ? `<p class="pr-sous">${esc(materiel)}</p>` : ''}
          <p class="pr-sous">${identifiantDe(profil.email) ? `Identifiant : <strong>${esc(identifiantDe(profil.email))}</strong>` : esc(profil.email)}${p.created_at ? ` · ${estActif ? 'membre depuis' : 'inscrit'} le ${esc(dateFr(p.created_at))}` : ''}</p>
        </div>
      </div>
      ${explication}
      ${estActif ? `<div class="actions cp-actions">
        <a class="bouton" href="mes-parties.html">Mes parties</a>
        <a class="bouton" href="stats.html">Mes stats</a>
        <a class="bouton" href="classement.html">Classement</a>
      </div>` : ''}
    </section>
    ${blocAdmin}
    ${estActif ? `<section class="section s-section cp-saison" aria-labelledby="t-saison">
      <div class="cp-saison__titre"><h2 class="section__titre" id="t-saison">Ma ${nomSaison().toLowerCase()}</h2><a href="stats.html">Toutes mes stats →</a></div>
      ${resume}
    </section>` : ''}
    ${blocCapitaine}
    <div class="carte-info">
      <h2>${mesEquipes.length > 1 ? 'Mes équipes' : 'Mon équipe'}</h2>
      ${!mesEquipes.length ? '<p class="intro" style="margin:0">Vous n\'êtes dans aucune équipe : vous avez accès à tout le site, sauf aux espaces équipe.</p>'
        : (aucuneEquipe ? '<p class="intro" style="margin:0">En attente de la réponse du capitaine.</p>' : '')}
      ${lignesEquipes}
      ${blocRejoindre}
    </div>
    <details class="carte-info repli" id="bloc-profil">
      <summary>Modifier mon profil et ma photo</summary>
      <div class="repli__contenu">
        ${blocPhoto}
      <form class="cp-form" id="form-profil" novalidate>
        <h3 class="donnees__titre">Mes informations</h3>
        <div class="message" id="message-profil" role="alert" hidden></div>
        <label class="champ">Surnom<input name="nickname" type="text" maxlength="40" value="${esc(p.nickname || '')}"></label>
        <label class="case case--simple"><input type="checkbox" name="use_nickname" ${p.use_nickname ? 'checked' : ''}>Utiliser mon surnom sur l'ensemble du site (matchs, score en direct, classements). Mon nom complet reste visible sur ma fiche.</label>
        <label class="champ">Téléphone<input name="phone" type="tel" maxlength="30" value="${esc(prive?.phone || '')}">
          <small>Visible uniquement par vous et les admins du club.</small></label>
        <div class="deux-colonnes">
          <label class="champ">Main
            <select name="hand">
              <option value="" ${!p.hand ? 'selected' : ''}>—</option>
              <option value="droitier" ${p.hand === 'droitier' ? 'selected' : ''}>Droitier</option>
              <option value="gaucher" ${p.hand === 'gaucher' ? 'selected' : ''}>Gaucher</option>
            </select>
          </label>
          <label class="champ">Poids (g)<input name="dart_weight" type="number" inputmode="decimal" min="10" max="50" step="0.5" value="${esc(p.dart_weight ?? '')}"></label>
        </div>
        <label class="champ">Marque des fléchettes<input name="dart_brand" type="text" maxlength="40" placeholder="Ex. Target, Winmau, Harrows…" value="${esc(p.dart_brand || '')}"></label>
        <p class="match__format" style="margin:0">Pour corriger votre nom ou prénom, demandez à un admin du club.</p>
        <button class="bouton bouton--plein" type="submit">Enregistrer mon profil</button>
      </form>
      </div>
    </details>
    <details class="carte-info repli" id="bloc-mdp">
      <summary>Changer mon mot de passe</summary>
      <form class="repli__contenu" id="form-mdp" novalidate>
        <div class="message" id="message-mdp" role="alert" hidden></div>
        <label class="champ">Mot de passe actuel<input name="actuel" type="password" autocomplete="current-password" required></label>
        <label class="champ">Nouveau mot de passe<input name="nouveau" type="password" autocomplete="new-password" minlength="8" required>
          <small>8 caractères minimum.</small></label>
        <label class="champ">Confirmer le nouveau mot de passe<input name="nouveau2" type="password" autocomplete="new-password" required></label>
        <button class="bouton bouton--plein" type="submit">Enregistrer le nouveau mot de passe</button>
      </form>
    </details>
    <details class="carte-info repli" id="bloc-donnees">
      <summary>Mes données et suppression du compte</summary>
      <div class="repli__contenu">
        <div class="message" id="message-donnees" role="alert" hidden></div>
        <p class="match__format" style="margin:0">Consultez toutes les données du site qui vous concernent (profil, coordonnées, équipes, parties, tournois), à imprimer, enregistrer en PDF ou télécharger en fichier.</p>
        <a class="bouton bouton--petit" href="mes-donnees.html" style="align-self:flex-start">Voir mes données</a>
        <h3 class="donnees__titre">Supprimer mon compte</h3>
        <p class="match__format" style="margin:0">Votre profil, vos coordonnées, votre photo et vos parties jouées seul ou contre des invités sont effacés.
          Dans les parties contre d'autres membres et dans les tournois, vous apparaîtrez comme « Ancien joueur » pour que leurs résultats restent justes.
          <strong>Cette action est définitive.</strong></p>
        <label class="champ">Pour confirmer, tapez SUPPRIMER<input type="text" id="confirmer-suppression" autocomplete="off" autocapitalize="characters"></label>
        <button type="button" class="bouton bouton--petit bouton--danger" id="btn-supprimer-compte" style="align-self:flex-start">Supprimer définitivement mon compte</button>
      </div>
    </details>
    <p><a href="./">← Retour à l'accueil</a></p>`;

  messageGeneral = document.getElementById('message-general');
  brancherChangementMotDePasse(profil.email);
  signalerProvisoire(profil.id);
  brancherProfil();
  brancherPhoto(p);
  brancherDonnees(p);
  // Toucher la photo en haut : ouvre « Modifier mon profil et ma photo » sur la partie photo
  document.getElementById('btn-photo-entete').addEventListener('click', () => {
    document.getElementById('bloc-profil').open = true;
    document.getElementById('bloc-photo').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

// ---------- Mes données (RGPD) et suppression du compte ----------

function brancherDonnees(p) {
  const zoneMsg = document.getElementById('message-donnees');

  document.getElementById('btn-supprimer-compte').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (document.getElementById('confirmer-suppression').value.trim().toUpperCase() !== 'SUPPRIMER') {
      return message(zoneMsg, 'Tapez SUPPRIMER dans la case pour confirmer.');
    }
    if (!confirm('Supprimer définitivement votre compte ? Cette action ne peut pas être annulée.')) return;
    b.disabled = true;
    // La photo est effacée d'abord (le dossier de photos ne s'efface que par le site)
    if (p.photo_path) {
      await supabase.storage.from(DOSSIER_PHOTOS).remove([p.photo_path]).catch(() => {});
      await supabase.from('profiles').update({ photo_path: null }).eq('id', profil.id);
    }
    const { error } = await supabase.rpc('delete_my_account');
    if (error) {
      b.disabled = false;
      return message(zoneMsg, error.code === 'P0001' ? error.message : erreurFr(error));
    }
    // Compte supprimé : on ferme la session
    await supabase.auth.signOut().catch(() => {});
    boutonDeco.hidden = true;
    zone.innerHTML = `
      <h1>Compte supprimé</h1>
      <p class="intro">Votre compte et vos données personnelles ont été effacés. Merci d'avoir joué avec le Dolina Darts Club !</p>
      <p><a class="bouton bouton--plein" href="./">Retour à l'accueil</a></p>`;
  });
}

// ---------- Photo de profil ----------

const TAILLE_PHOTO = 400;

// Recadre la photo en carré (centre de l'image), 400 × 400, en JPEG
function preparerPhoto(fichier) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(fichier);
    img.onload = () => {
      const cote = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = TAILLE_PHOTO;
      canvas.height = TAILLE_PHOTO;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, 0, TAILLE_PHOTO, TAILLE_PHOTO);
      ctx.drawImage(img, (img.width - cote) / 2, (img.height - cote) / 2, cote, cote, 0, 0, TAILLE_PHOTO, TAILLE_PHOTO);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('conversion'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('lecture')); };
    img.src = url;
  });
}

function brancherPhoto(p) {
  const zoneMsg = document.getElementById('message-photo');
  const champ = document.getElementById('champ-photo');
  const accord = document.getElementById('accord-photo');
  const ancien = p.photo_path;

  async function terminer(texte) {
    if (ancien) oublierLienPhoto(ancien);
    await afficher();
    document.getElementById('bloc-profil').open = true;
    message(document.getElementById('message-photo'), texte, 'ok');
  }

  document.getElementById('btn-choisir-photo').addEventListener('click', (e) => {
    if (!accord.checked) {
      e.preventDefault();
      message(zoneMsg, 'Cochez d\'abord la case d\'accord pour ajouter une photo.');
    }
  });

  champ.addEventListener('change', async () => {
    const f = champ.files[0];
    champ.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return message(zoneMsg, 'Format non accepté : choisissez une image JPEG, PNG ou WebP.');
    message(zoneMsg, 'Envoi de la photo…', 'ok');
    let blob;
    try {
      blob = await preparerPhoto(f);
    } catch {
      return message(zoneMsg, 'Impossible de lire cette image. Essayez avec une autre photo.');
    }
    const chemin = `${profil.id}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`;
    const envoi = await supabase.storage.from(DOSSIER_PHOTOS).upload(chemin, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (envoi.error) return message(zoneMsg, `La photo n'a pas pu être envoyée. ${erreurFr(envoi.error)}`);
    const maj = await supabase.from('profiles').update({ photo_path: chemin, photo_consent: true }).eq('id', profil.id);
    if (maj.error) {
      await supabase.storage.from(DOSSIER_PHOTOS).remove([chemin]);
      return message(zoneMsg, erreurFr(maj.error));
    }
    if (ancien) await supabase.storage.from(DOSSIER_PHOTOS).remove([ancien]);
    await terminer('Photo enregistrée.');
  });

  async function retirer(retirerAccord) {
    const maj = await supabase.from('profiles').update(retirerAccord ? { photo_path: null, photo_consent: false } : { photo_path: null }).eq('id', profil.id);
    if (maj.error) return message(zoneMsg, erreurFr(maj.error));
    if (ancien) await supabase.storage.from(DOSSIER_PHOTOS).remove([ancien]);
    await terminer(retirerAccord ? (ancien ? 'Accord retiré : votre photo a été supprimée.' : 'Accord retiré.') : 'Photo retirée.');
  }

  document.getElementById('btn-retirer-photo')?.addEventListener('click', () => {
    if (confirm('Retirer votre photo de profil ?')) retirer(false);
  });

  accord.addEventListener('change', async () => {
    if (accord.checked) {
      const maj = await supabase.from('profiles').update({ photo_consent: true }).eq('id', profil.id);
      if (maj.error) { accord.checked = false; return message(zoneMsg, erreurFr(maj.error)); }
      await terminer('Accord enregistré : vous pouvez ajouter une photo.');
    } else if (!ancien || confirm('Retirer votre accord ? Votre photo sera supprimée.')) {
      await retirer(true);
    } else {
      accord.checked = true;
    }
  });
}

// ---------- Modification du profil ----------

function brancherProfil() {
  const form = document.getElementById('form-profil');
  const zoneMsg = document.getElementById('message-profil');
  const bouton = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = form.elements;
    const poids = f.dart_weight.value.trim().replace(',', '.');
    if (poids && (Number.isNaN(Number(poids)) || Number(poids) < 10 || Number(poids) > 50)) {
      return message(zoneMsg, 'Le poids doit être compris entre 10 et 50 grammes.');
    }
    if (f.phone.value.trim() && f.phone.value.replace(/[^0-9]/g, '').length < 9) {
      return message(zoneMsg, 'Indiquez un numéro de téléphone valide.');
    }

    bouton.disabled = true;
    const [r1, r2] = await Promise.all([
      supabase.from('profiles').update({
        nickname: f.nickname.value.trim() || null,
        use_nickname: f.use_nickname.checked && !!f.nickname.value.trim(),
        hand: f.hand.value || null,
        dart_weight: poids ? Number(poids) : null,
        dart_brand: f.dart_brand.value.trim() || null,
      }).eq('id', profil.id),
      supabase.from('profile_private').update({ phone: f.phone.value.trim() }).eq('id', profil.id),
    ]);
    bouton.disabled = false;
    const erreur = r1.error || r2.error;
    if (erreur) return message(zoneMsg, erreurFr(erreur));

    await afficher();
    const msg = document.getElementById('message-profil');
    document.getElementById('bloc-profil').open = true;
    message(msg, 'Profil enregistré.', 'ok');
  });
}

// ---------- Actions : équipes et capitaine ----------

zone.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-action]');
  if (!b) return;
  const team = b.dataset.team;
  const id = b.dataset.id;
  let res = { error: null };
  b.disabled = true;

  switch (b.dataset.action) {
    case 'rejoindre':
      res = await supabase.from('team_members').insert({ team_id: team, profile_id: profil.id });
      break;
    case 'annuler':
      res = await supabase.from('team_members').delete().eq('team_id', team).eq('profile_id', profil.id);
      break;
    case 'redemander':
      // Une demande refusée est supprimée, puis refaite
      res = await supabase.from('team_members').delete().eq('team_id', team).eq('profile_id', profil.id);
      if (!res.error) res = await supabase.from('team_members').insert({ team_id: team, profile_id: profil.id });
      break;
    case 'quitter':
      if (!confirm(`Quitter l'équipe ${b.dataset.nom} ?`)) { b.disabled = false; return; }
      res = await supabase.from('team_members').delete().eq('team_id', team).eq('profile_id', profil.id);
      break;
    case 'cap-accepter':
    case 'cap-refuser': {
      const equipe = ((await supabase.from('teams').select('*')).data || []).find((t) => estCapitaineDe(t, profil.id));
      res = await supabase.from('team_members')
        .update({ status: b.dataset.action === 'cap-accepter' ? 'accepted' : 'refused' })
        .eq('team_id', equipe?.id).eq('profile_id', id);
      break;
    }
    default:
      return;
  }

  if (res.error) {
    b.disabled = false;
    message(messageGeneral, res.error.code === 'P0001' ? res.error.message : erreurFr(res.error));
    return;
  }
  await afficher();
});

// ---------- Changement du mot de passe (connecté) ----------

function brancherChangementMotDePasse(email) {
  const form = document.getElementById('form-mdp');
  const zoneMsg = document.getElementById('message-mdp');
  const bouton = form.querySelector('button');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const { actuel, nouveau, nouveau2 } = form.elements;
    if (!actuel.value) return message(zoneMsg, 'Indiquez votre mot de passe actuel.');
    if (nouveau.value.length < 8) return message(zoneMsg, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
    if (nouveau.value !== nouveau2.value) return message(zoneMsg, 'Les deux nouveaux mots de passe ne sont pas identiques.');

    bouton.disabled = true;
    // On vérifie d'abord le mot de passe actuel (sécurité si le téléphone est resté ouvert)
    const verif = await supabase.auth.signInWithPassword({ email, password: actuel.value });
    if (verif.error) {
      bouton.disabled = false;
      return message(zoneMsg, 'Mot de passe actuel incorrect.');
    }
    const { error } = await supabase.auth.updateUser({ password: nouveau.value });
    bouton.disabled = false;
    if (error) return message(zoneMsg, erreurFr(error));

    form.reset();
    message(zoneMsg, 'Mot de passe modifié. Utilisez-le dès votre prochaine connexion.', 'ok');
    // Le mot de passe provisoire donné par un admin est remplacé : le bandeau disparaît
    supabase.rpc('mot_de_passe_change').then(() => document.getElementById('bandeau-provisoire')?.remove(), () => {});
  });
}

// Mot de passe provisoire (script 038) : on invite le membre à choisir le sien
async function signalerProvisoire(id) {
  const { data, error } = await supabase.from('profiles').select('mdp_provisoire').eq('id', id).maybeSingle();
  if (error || !data?.mdp_provisoire) return;
  const bloc = document.getElementById('bloc-mdp');
  bloc.open = true;
  const champ = bloc.querySelector('[name=actuel]')?.closest('label');
  if (champ?.firstChild) champ.firstChild.textContent = 'Mot de passe provisoire (reçu de l\'admin)';
  const bandeau = document.createElement('div');
  bandeau.id = 'bandeau-provisoire';
  bandeau.className = 'bandeau-provisoire';
  bandeau.innerHTML = '<strong>Vous utilisez un mot de passe provisoire.</strong><span>Choisissez votre propre mot de passe pour sécuriser votre compte.</span><a class="bouton bouton--petit bouton--plein" href="#bloc-mdp">Choisir mon mot de passe</a>';
  const main = document.querySelector('main') || document.body;
  main.insertBefore(bandeau, main.firstChild);
}

boutonDeco.addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.replace('./');
});

// Laisse le temps à une session venue d'un lien email d'être enregistrée
setTimeout(afficher, 300);
