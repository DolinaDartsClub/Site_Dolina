// =====================================================================
//  Espace admin : membres sans email (script 035)
//  - « Identifiant + code » : le membre se connecte avec un identifiant
//    (ex. jean.dupont) et un code noté sur un papier par l'admin.
//  - « Profil géré » : pas de connexion ; un autre joueur saisit ses parties.
//  Code oublié → « Nouveau code » sur la fiche du membre.
// =====================================================================

import { supabase, esc, message, erreurFr } from './app.js?v=__VERSION__';

const codeAuHasard = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

// « Jean-Pierre Dupont » → « jeanpierre.dupont »
function proposerIdentifiant(prenom, nom) {
  const net = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  return [net(prenom), net(nom)].filter(Boolean).join('.').slice(0, 30);
}

function carteCodes(nom, identifiant, code) {
  return `
    <div class="se-codes" role="status">
      <strong>${esc(nom)} peut se connecter</strong>
      <span>Page « Connexion » du site, puis :</span>
      <dl>
        <dt>Identifiant</dt><dd>${esc(identifiant)}</dd>
        <dt>Code</dt><dd>${esc(code)}</dd>
      </dl>
      <small>Notez-les sur un papier pour le membre : le code ne sera plus affiché ensuite. Il pourra le changer dans « Mon compte ».</small>
    </div>`;
}

export function initSansEmail({ zoneMessage, equipes, recharger }) {
  const vue = document.getElementById('vue-membres');
  const bloc = document.createElement('div');
  bloc.className = 'se-bloc';
  bloc.innerHTML = `
    <button type="button" class="bouton bouton--petit" id="se-ouvrir" aria-expanded="false">+ Créer un membre sans email</button>
    <form class="carte-info se-form" id="se-form" hidden novalidate>
      <h2>Membre sans email</h2>
      <p class="match__format">Pour un membre qui n'utilise pas sa messagerie. Le compte est validé tout de suite.</p>
      <div class="deux-colonnes">
        <label class="champ">Prénom<input name="prenom" maxlength="60" required autocomplete="off"></label>
        <label class="champ">Nom<input name="nom" maxlength="60" required autocomplete="off"></label>
      </div>
      <label class="champ">Surnom <small>(facultatif)</small><input name="surnom" maxlength="40" autocomplete="off"></label>
      <fieldset class="bloc-choix">
        <legend>Accès au site</legend>
        <label class="se-choix"><input type="radio" name="type" value="identifiant" checked>
          <span><strong>Identifiant + code</strong><small>Il se connecte lui-même pour voir ses stats et jouer.</small></span></label>
        <label class="se-choix"><input type="radio" name="type" value="gere">
          <span><strong>Profil géré</strong><small>Pas de connexion : un autre joueur le choisit dans la liste des membres pour saisir ses parties.</small></span></label>
      </fieldset>
      <div class="deux-colonnes">
        <label class="champ">Identifiant<input name="identifiant" maxlength="30" autocapitalize="none" spellcheck="false" autocomplete="off" placeholder="jean.dupont"></label>
        <label class="champ" id="se-champ-code">Code <small>(6 caractères min.)</small><input name="code" maxlength="40" autocomplete="off"></label>
      </div>
      ${equipes.length ? `<fieldset class="bloc-choix"><legend>Équipe(s) <small>(facultatif)</small></legend>
        <div class="se-equipes">${equipes.map((t) => `<label><input type="checkbox" name="equipes" value="${t.id}"> ${esc(t.name)}</label>`).join('')}</div></fieldset>` : ''}
      <div class="actions">
        <button type="submit" class="bouton bouton--plein">Créer le membre</button>
        <button type="button" class="bouton" id="se-annuler">Annuler</button>
      </div>
    </form>
    <div id="se-resultat"></div>`;
  vue.insertBefore(bloc, vue.firstChild);

  const form = bloc.querySelector('#se-form');
  const f = form.elements;
  let identifiantTouche = false;
  const ouvrir = (oui) => {
    form.hidden = !oui;
    bloc.querySelector('#se-ouvrir').setAttribute('aria-expanded', String(oui));
    if (oui) { form.reset(); identifiantTouche = false; f.code.value = codeAuHasard(); majType(); f.prenom.focus(); }
  };
  const majType = () => { bloc.querySelector('#se-champ-code').hidden = f.type.value === 'gere'; };
  bloc.querySelector('#se-ouvrir').addEventListener('click', () => { bloc.querySelector('#se-resultat').innerHTML = ''; ouvrir(form.hidden); });
  bloc.querySelector('#se-annuler').addEventListener('click', () => ouvrir(false));
  form.addEventListener('change', (e) => { if (e.target.name === 'type') majType(); });
  f.identifiant.addEventListener('input', () => { identifiantTouche = true; });
  const suggerer = () => { if (!identifiantTouche) f.identifiant.value = proposerIdentifiant(f.prenom.value, f.nom.value); };
  f.prenom.addEventListener('input', suggerer);
  f.nom.addEventListener('input', suggerer);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const gere = f.type.value === 'gere';
    const prenom = f.prenom.value.trim();
    const nom = f.nom.value.trim();
    const identifiant = f.identifiant.value.trim().toLowerCase();
    const code = f.code.value.trim();
    if (!prenom || !nom) return message(zoneMessage, 'Indiquez le prénom et le nom.');
    if (!/^[a-z0-9][a-z0-9.-]{1,28}[a-z0-9]$/.test(identifiant) || identifiant.includes('..')) {
      return message(zoneMessage, 'Identifiant : 3 à 30 caractères, lettres minuscules, chiffres, point ou tiret (ex. jean.dupont).');
    }
    if (!gere && code.length < 6) return message(zoneMessage, 'Le code doit faire au moins 6 caractères.');
    const bouton = form.querySelector('[type=submit]');
    bouton.disabled = true;
    const { data, error } = await supabase.rpc('admin_creer_membre', {
      p_prenom: prenom, p_nom: nom, p_surnom: f.surnom.value.trim() || null,
      p_identifiant: identifiant, p_code: gere ? null : code,
      p_equipes: [...form.querySelectorAll('[name=equipes]:checked')].map((c) => c.value),
    });
    bouton.disabled = false;
    if (error) {
      return message(zoneMessage, /admin_creer_membre/.test(error.message || '') && error.code === 'PGRST202'
        ? 'Exécutez d\'abord le script SQL 035 dans Supabase.'
        : (error.code === 'P0001' ? error.message : erreurFr(error)));
    }
    ouvrir(false);
    bloc.querySelector('#se-resultat').innerHTML = gere
      ? `<div class="se-codes" role="status"><strong>Profil géré créé : ${esc(`${prenom} ${nom}`)}</strong><small>Il apparaît dans la liste des membres pour les parties. Pour lui donner un accès plus tard : « Nouveau code » sur sa fiche.</small></div>`
      : carteCodes(`${prenom} ${nom}`, data.identifiant, code);
    message(zoneMessage, 'Membre créé.', 'ok');
    recharger();
  });

  // « Nouveau code » sur la fiche d'un membre sans email
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-nouveau-code]');
    if (!b) return;
    const code = prompt(`Nouveau code pour ${b.dataset.nom} (6 caractères minimum) :`, codeAuHasard());
    if (code === null) return;
    if (code.trim().length < 6) return message(zoneMessage, 'Le code doit faire au moins 6 caractères.');
    b.disabled = true;
    const { data, error } = await supabase.rpc('admin_changer_code', { p_user: b.dataset.nouveauCode, p_code: code.trim() });
    b.disabled = false;
    if (error) return message(zoneMessage, error.code === 'P0001' ? error.message : erreurFr(error));
    const zone = b.closest('.fiche__contenu')?.querySelector('[data-codes]');
    if (zone) zone.innerHTML = carteCodes(b.dataset.nom, data.identifiant, code.trim());
    message(zoneMessage, 'Nouveau code enregistré.', 'ok');
  });
}
