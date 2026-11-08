// =====================================================================
//  Match à distance (script 071) : vidéo entre les deux joueurs
//  Chaque téléphone filme sa cible (caméra arrière) et affiche celle de
//  l'adversaire. La vidéo passe directement d'un téléphone à l'autre
//  (WebRTC) : rien n'est enregistré ni stocké sur le site.
//  Les messages de mise en relation passent par un canal Supabase Realtime,
//  le même qui prévient l'autre téléphone d'une nouvelle volée.
// =====================================================================

import { SERVEURS_TURN } from './config.js?v=__VERSION__';

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

// canal : canal Supabase Realtime déjà créé (non encore abonné)
// monCamp : 1 ou 2 ; zone : élément qui reçoit le lecteur vidéo
export function brancherVideo({ canal, monCamp, nomAdverse, zone }) {
  const poli = monCamp === 2;   // en cas d'offres croisées, le camp 2 cède
  const ident = `${monCamp}-${Math.random().toString(36).slice(2, 8)}`;
  let pc = null;
  let fluxLocal = null;
  let camera = 'environment';
  let offreEnCours = false;
  let ignorer = false;
  let etat = 'attente';

  zone.innerHTML = `
    <div class="dv-ecran">
      <video class="dv-adverse" id="dv-adverse" playsinline autoplay></video>
      <div class="dv-vide" id="dv-vide"><strong>Caméra de ${nomAdverse}</strong><span id="dv-etat">En attente de ${nomAdverse}…</span></div>
      <video class="dv-moi" id="dv-moi" playsinline autoplay muted hidden></video>
      <button type="button" class="dv-son" id="dv-son" hidden>Toucher pour activer le son</button>
    </div>
    <div class="dv-barre">
      <button type="button" class="bouton bouton--petit bouton--plein" id="dv-demarrer">Activer ma caméra</button>
      <button type="button" class="bouton bouton--petit" id="dv-cam" hidden>Caméra off</button>
      <button type="button" class="bouton bouton--petit" id="dv-micro" hidden>Micro off</button>
      <button type="button" class="bouton bouton--petit" id="dv-tourner" hidden>⟲ Caméra</button>
      <button type="button" class="bouton bouton--petit" id="dv-taille" aria-pressed="false">Agrandir</button>
    </div>`;
  const $ = (s) => zone.querySelector(s);
  const vAdv = $('#dv-adverse');
  const vMoi = $('#dv-moi');

  const afficherEtat = (texte) => { $('#dv-etat').textContent = texte; };
  const envoyer = (donnees) => canal.send({ type: 'broadcast', event: 'video', payload: { de: ident, camp: monCamp, ...donnees } });

  function nouvellePc() {
    if (pc) { try { pc.close(); } catch { /* déjà fermée */ } }
    pc = new RTCPeerConnection({ iceServers: [...STUN, ...SERVEURS_TURN] });
    offreEnCours = false; ignorer = false;
    pc.onicecandidate = ({ candidate }) => { if (candidate) envoyer({ candidat: candidate.toJSON() }); };
    pc.ontrack = ({ track, streams }) => {
      const flux = streams[0] || new MediaStream([track]);
      if (vAdv.srcObject !== flux) vAdv.srcObject = flux;
      $('#dv-vide').hidden = true;
      vAdv.play().catch(() => { $('#dv-son').hidden = false; });
    };
    pc.onnegotiationneeded = async () => {
      try {
        offreEnCours = true;
        await pc.setLocalDescription();
        envoyer({ description: pc.localDescription.toJSON() });
      } catch (e) { console.warn('négociation', e); } finally { offreEnCours = false; }
    };
    pc.onconnectionstatechange = () => {
      etat = pc.connectionState;
      if (etat === 'connected') afficherEtat('Connecté');
      else if (etat === 'failed') {
        $('#dv-vide').hidden = false;
        afficherEtat('La vidéo ne passe pas entre vos deux réseaux. Essayez en Wi-Fi (ou en 4G) des deux côtés. Les scores, eux, continuent de fonctionner.');
      } else if (etat === 'disconnected') afficherEtat('Connexion perdue, reconnexion…');
    };
    if (fluxLocal) fluxLocal.getTracks().forEach((t) => pc.addTrack(t, fluxLocal));
  }

  async function recevoir({ de, camp, description, candidat, bonjour, fin }) {
    if (camp === monCamp || de === ident) return;   // mon autre onglet, ou moi-même
    try {
      if (bonjour) {
        // L'adversaire arrive (ou revient) : on repart d'une connexion neuve
        nouvellePc();
        if (bonjour === 'premier') envoyer({ bonjour: 'retour' });
        if (!fluxLocal) afficherEtat(`${nomAdverse} est là. Activez votre caméra.`);
        return;
      }
      if (fin) {
        vAdv.srcObject = null; $('#dv-vide').hidden = false;
        afficherEtat(`${nomAdverse} a quitté le match.`);
        nouvellePc();
        return;
      }
      if (description) {
        const collision = description.type === 'offer' && (offreEnCours || pc.signalingState !== 'stable');
        ignorer = !poli && collision;
        if (ignorer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          envoyer({ description: pc.localDescription.toJSON() });
        }
      } else if (candidat) {
        try { await pc.addIceCandidate(candidat); } catch (e) { if (!ignorer) console.warn('candidat', e); }
      }
    } catch (e) { console.warn('vidéo', e); }
  }

  async function ouvrirCamera() {
    const video = { facingMode: { ideal: camera }, width: { ideal: 1280 }, height: { ideal: 720 } };
    try {
      return await navigator.mediaDevices.getUserMedia({ video, audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      if (e?.name === 'NotAllowedError') throw e;
      return navigator.mediaDevices.getUserMedia({ video, audio: false });   // pas de micro : la vidéo seule
    }
  }

  $('#dv-demarrer').addEventListener('click', async () => {
    const b = $('#dv-demarrer');
    if (!navigator.mediaDevices?.getUserMedia) { afficherEtat('Ce navigateur ne permet pas d\'utiliser la caméra. Essayez Chrome ou Safari à jour.'); return; }
    b.disabled = true; b.textContent = 'Ouverture de la caméra…';
    try {
      fluxLocal = await ouvrirCamera();
      vMoi.srcObject = fluxLocal; vMoi.hidden = false;
      fluxLocal.getTracks().forEach((t) => pc.addTrack(t, fluxLocal));
      b.hidden = true;
      ['#dv-cam', '#dv-tourner'].forEach((s) => { $(s).hidden = false; });
      $('#dv-micro').hidden = !fluxLocal.getAudioTracks().length;
      if (etat !== 'connected') afficherEtat(`Votre caméra est allumée. En attente de ${nomAdverse}…`);
      vAdv.play().catch(() => {});
    } catch (e) {
      b.disabled = false; b.textContent = 'Activer ma caméra';
      afficherEtat(e?.name === 'NotAllowedError'
        ? 'Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur, puis réessayez.'
        : 'Impossible d\'ouvrir la caméra (déjà utilisée par une autre appli ?).');
    }
  });
  $('#dv-cam').addEventListener('click', (e) => {
    const t = fluxLocal?.getVideoTracks()[0]; if (!t) return;
    t.enabled = !t.enabled;
    e.currentTarget.textContent = t.enabled ? 'Caméra off' : 'Caméra on';
    vMoi.classList.toggle('dv-moi--coupe', !t.enabled);
  });
  $('#dv-micro').addEventListener('click', (e) => {
    const t = fluxLocal?.getAudioTracks()[0]; if (!t) return;
    t.enabled = !t.enabled;
    e.currentTarget.textContent = t.enabled ? 'Micro off' : 'Micro on';
  });
  $('#dv-tourner').addEventListener('click', async () => {
    camera = camera === 'environment' ? 'user' : 'environment';
    try {
      const nouveau = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: camera }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      const piste = nouveau.getVideoTracks()[0];
      const ancienne = fluxLocal.getVideoTracks()[0];
      const emetteur = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (emetteur) await emetteur.replaceTrack(piste);
      fluxLocal.removeTrack(ancienne); ancienne.stop(); fluxLocal.addTrack(piste);
      vMoi.srcObject = fluxLocal;
    } catch { afficherEtat('Une seule caméra disponible.'); }
  });
  $('#dv-taille').addEventListener('click', (e) => {
    const grand = document.body.classList.toggle('scorer--video-grande');
    e.currentTarget.setAttribute('aria-pressed', String(grand));
    e.currentTarget.textContent = grand ? 'Réduire' : 'Agrandir';
  });
  $('#dv-son').addEventListener('click', () => { vAdv.play().then(() => { $('#dv-son').hidden = true; }).catch(() => {}); });

  canal.on('broadcast', { event: 'video' }, ({ payload }) => recevoir(payload));
  nouvellePc();

  return {
    // À appeler une fois le canal abonné
    pret() { envoyer({ bonjour: 'premier' }); },
    fermer() {
      envoyer({ fin: true });
      fluxLocal?.getTracks().forEach((t) => t.stop());
      try { pc?.close(); } catch { /* déjà fermée */ }
    },
  };
}
