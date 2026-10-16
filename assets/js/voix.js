// =====================================================================
//  Annonce vocale (synthèse vocale du navigateur, sans coût ni service externe)
//  Après chaque volée : le score ; si le joueur suivant est sur un finish,
//  ce qu'il lui reste ; « Game shot » en fin de manche, « Game shot and
//  the match » en fin de partie. En français ou en anglais façon « caller ».
//  Le ton monte avec les gros scores (au-dessus de 80), comme un vrai annonceur.
//  On choisit la voix la plus naturelle de l'appareil (voix « naturelles »,
//  « améliorées » ou Google) ; le joueur peut aussi en choisir une autre.
//  Le réglage est gardé sur l'appareil.
// =====================================================================

const CLE = 'dolina-voix';
let memoire = { actif: false, langue: 'fr', voix: '' };

export const voixDisponible = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function reglageVoix() {
  try {
    const r = JSON.parse(localStorage.getItem(CLE) || 'null');
    if (r) return { actif: !!r.actif, langue: r.langue === 'en' ? 'en' : 'fr', voix: r.voix || '' };
  } catch { /* stockage indisponible */ }
  return { ...memoire };
}

export function definirVoix(reglage) {
  const avant = reglageVoix();
  memoire = {
    actif: !!reglage.actif,
    langue: reglage.langue === 'en' ? 'en' : 'fr',
    // La voix choisie ne vaut que pour sa langue
    voix: reglage.voix !== undefined ? reglage.voix : (reglage.langue === avant.langue ? avant.voix : ''),
  };
  try { localStorage.setItem(CLE, JSON.stringify(memoire)); } catch { /* idem */ }
}

// ---------- Choix de la voix : la plus humaine disponible ----------

function noteVoix(v, langue) {
  const nom = `${v.name} ${v.voiceURI || ''}`.toLowerCase();
  let n = 0;
  if (/natural|neural|naturelle|online/.test(nom)) n += 50;   // voix neuronales (Edge, Windows, Android récents)
  if (/premium|enhanced|améliorée|amelioree/.test(nom)) n += 40;   // voix de qualité iPhone / Mac
  if (/google/.test(nom)) n += 30;                             // voix Google (Chrome, Android)
  if (v.localService === false) n += 10;                       // voix « en ligne », souvent meilleures
  if (/compact|espeak|robot|novelty|eloquence|zarvox|trinoids|bells|bad news|whisper/.test(nom)) n -= 60;
  const code = langue === 'en' ? 'en-gb' : 'fr-fr';
  const lang = (v.lang || '').toLowerCase().replace('_', '-');
  if (lang === code) n += 8;
  if (langue === 'en' && /^en-(gb|ie|au)/.test(lang)) n += 3;   // accent britannique : ambiance « caller »
  return n;
}

export function voixDeLaLangue(langue) {
  if (!voixDisponible()) return [];
  let liste = [];
  try { liste = window.speechSynthesis.getVoices() || []; } catch { liste = []; }
  return liste
    .filter((v) => (v.lang || '').toLowerCase().startsWith(langue))
    .sort((a, b) => noteVoix(b, langue) - noteVoix(a, langue));
}

function choisirVoix(langue) {
  const liste = voixDeLaLangue(langue);
  const nom = reglageVoix().voix;
  return (nom && liste.find((v) => v.name === nom)) || liste[0] || null;
}

// Les voix arrivent parfois après le chargement de la page
const ecouteurs = new Set();
export function quandVoixChangent(f) { ecouteurs.add(f); }
try {
  if (voixDisponible()) window.speechSynthesis.onvoiceschanged = () => ecouteurs.forEach((f) => f());
} catch { /* sans effet */ }

// ---------- Parler ----------

// Dit une ou plusieurs phrases (la précédente annonce est coupée).
// Une phrase : texte, ou { texte, ton, vitesse } (ton 1 = normal, jusqu'à 2)
export function dire(phrases, langue = reglageVoix().langue) {
  if (!voixDisponible()) return;
  // Une voix qui échoue ne doit jamais bloquer la saisie des scores
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const voix = choisirVoix(langue);
    [].concat(phrases).filter(Boolean).forEach((p) => {
      const { texte, ton = 1, vitesse = 1 } = typeof p === 'string' ? { texte: p } : p;
      const u = new SpeechSynthesisUtterance(texte);
      u.lang = voix?.lang || (langue === 'en' ? 'en-GB' : 'fr-FR');
      if (voix) u.voice = voix;
      u.pitch = ton;
      u.rate = vitesse * (langue === 'en' ? 0.95 : 1);
      u.volume = 1;
      synth.speak(u);
    });
  } catch (e) { console.warn('Annonce vocale impossible :', e); }
}

// Le ton monte avec le score au-dessus de 80 (jusqu'à 180), et le débit ralentit un peu :
// « cent… quatre-vingts ! »
export function tonDuScore(score) {
  if (score <= 80) return { ton: 1, vitesse: 1 };
  const k = Math.min(1, (score - 80) / 100);
  return { ton: 1 + 0.55 * k, vitesse: 1 - 0.15 * k };
}

// Phrases d'une volée : { score, bust, finManche, finPartie, suivant: { nom, reste } | null }
export function phrasesVolee({ score, bust, finManche, finPartie, suivant }, langue = reglageVoix().langue) {
  const en = langue === 'en';
  const p = [];
  if (finPartie) p.push({ texte: 'Game shot, and the match!', ton: 1.4, vitesse: 0.9 });
  else if (finManche) p.push({ texte: 'Game shot!', ton: 1.3, vitesse: 0.9 });
  else if (bust) p.push(en ? 'Bust!' : 'Bust !');
  else if (score === 0) p.push(en ? 'No score.' : 'Pas de score.');
  else if (score === 180) p.push({ texte: en ? 'One hundred and eighty!' : 'Cent quatre-vingts !', ...tonDuScore(180) });
  else p.push({ texte: String(score), ...tonDuScore(score) });
  if (!finPartie && !finManche && suivant) {
    p.push(en ? `${suivant.nom}, you require ${suivant.reste}.` : `${suivant.nom}, il vous reste ${suivant.reste}.`);
  }
  return p;
}

export function annoncerVolee(infos) {
  const r = reglageVoix();
  if (!r.actif) return;
  dire(phrasesVolee(infos, r.langue), r.langue);
}
