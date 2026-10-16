// =====================================================================
//  Annonce vocale (synthèse vocale du navigateur, sans coût ni service externe)
//  Après chaque volée : le score ; si le joueur suivant est sur un finish,
//  ce qu'il lui reste ; « Game shot » en fin de manche, « Game shot and
//  the match » en fin de partie. En français ou en anglais façon « caller ».
//  Le réglage est gardé sur l'appareil.
// =====================================================================

const CLE = 'dolina-voix';
let memoire = { actif: false, langue: 'fr' };

export const voixDisponible = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function reglageVoix() {
  try {
    const r = JSON.parse(localStorage.getItem(CLE) || 'null');
    if (r) return { actif: !!r.actif, langue: r.langue === 'en' ? 'en' : 'fr' };
  } catch { /* stockage indisponible */ }
  return { ...memoire };
}

export function definirVoix(reglage) {
  memoire = { actif: !!reglage.actif, langue: reglage.langue === 'en' ? 'en' : 'fr' };
  try { localStorage.setItem(CLE, JSON.stringify(memoire)); } catch { /* idem */ }
}

let voixCache = {};
function choisirVoix(langue) {
  if (voixCache[langue]) return voixCache[langue];
  const toutes = window.speechSynthesis.getVoices() || [];
  const code = langue === 'en' ? 'en-GB' : 'fr-FR';
  const v = toutes.find((x) => x.lang === code) || toutes.find((x) => x.lang?.startsWith(langue));
  if (v) voixCache[langue] = v;
  return v || null;
}
try { if (voixDisponible()) window.speechSynthesis.onvoiceschanged = () => { voixCache = {}; }; } catch { /* sans effet */ }

// Dit une ou plusieurs phrases (la précédente annonce est coupée)
export function dire(phrases, langue = reglageVoix().langue) {
  if (!voixDisponible()) return;
  // Une voix qui échoue ne doit jamais bloquer la saisie des scores
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    [].concat(phrases).filter(Boolean).forEach((texte) => {
      const u = new SpeechSynthesisUtterance(texte);
      u.lang = langue === 'en' ? 'en-GB' : 'fr-FR';
      const v = choisirVoix(langue);
      if (v) u.voice = v;
      u.rate = langue === 'en' ? 0.95 : 1;
      synth.speak(u);
    });
  } catch (e) { console.warn('Annonce vocale impossible :', e); }
}

// Phrases d'une volée : { score, bust, finManche, finPartie, suivant: { nom, reste } | null }
export function phrasesVolee({ score, bust, finManche, finPartie, suivant }, langue = reglageVoix().langue) {
  const en = langue === 'en';
  const p = [];
  if (finPartie) p.push('Game shot, and the match!');
  else if (finManche) p.push('Game shot!');
  else if (bust) p.push(en ? 'Bust!' : 'Bust !');
  else if (score === 0) p.push(en ? 'No score.' : 'Pas de score.');
  else if (score === 180) p.push(en ? 'One hundred and eighty!' : 'Cent quatre-vingts !');
  else p.push(String(score));
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
