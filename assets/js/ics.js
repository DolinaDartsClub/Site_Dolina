// =====================================================================
//  Export agenda (.ics) : un fichier à ouvrir avec l'agenda du téléphone
//  (Apple Calendrier, Google Agenda, Outlook). Heures de Paris.
//  Le fichier n'est pas mis à jour tout seul : en cas de changement de
//  date, il faut le télécharger à nouveau.
// =====================================================================

const FUSEAU = `BEGIN:VTIMEZONE
TZID:Europe/Paris
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`;

// Échappement du texte (RFC 5545) et lignes repliées à 75 octets
const texte = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function replier(ligne) {
  const octets = new TextEncoder().encode(ligne);
  if (octets.length <= 75) return ligne;
  const morceaux = [];
  let courant = '';
  for (const c of ligne) {
    if (new TextEncoder().encode(courant + c).length > (morceaux.length ? 74 : 75)) { morceaux.push(courant); courant = ''; }
    courant += c;
  }
  morceaux.push(courant);
  return morceaux.join('\r\n ');
}
const jour = (d) => d.replace(/-/g, '');                       // 2026-11-05 → 20261105
const heure = (h) => h.slice(0, 5).replace(':', '') + '00';    // 20:30:00 → 203000
function lendemain(d) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}
function plusHeures(d, h, n) {
  const [hh, mm] = h.split(':').map(Number);
  const total = hh * 60 + mm + n * 60;
  const date = total >= 1440 ? lendemain(d) : d;
  const t = total % 1440;
  return [date, `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`];
}

// evenement : { uid, date, heure (HH:MM ou null), duree (h), titre, lieu, description }
function vevent(e) {
  const maintenant = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lignes = ['BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${maintenant}`];
  if (e.heure) {
    const [df, hf] = plusHeures(e.date, e.heure, e.duree || 3);
    lignes.push(`DTSTART;TZID=Europe/Paris:${jour(e.date)}T${heure(e.heure)}`, `DTEND;TZID=Europe/Paris:${jour(df)}T${heure(hf)}`);
  } else {
    lignes.push(`DTSTART;VALUE=DATE:${jour(e.date)}`, `DTEND;VALUE=DATE:${jour(lendemain(e.date))}`);
  }
  lignes.push(`SUMMARY:${texte(e.titre)}`);
  if (e.lieu) lignes.push(`LOCATION:${texte(e.lieu)}`);
  if (e.description) lignes.push(`DESCRIPTION:${texte(e.description)}`);
  // Deux rappels : la veille (24 h avant) et 3 h avant le match
  if (e.rappel !== false && e.heure) {
    lignes.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:Demain : ${texte(e.titre)}`, 'TRIGGER:-PT24H', 'END:VALARM');
    lignes.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${texte(e.titre)}`, 'TRIGGER:-PT3H', 'END:VALARM');
  }
  lignes.push('END:VEVENT');
  return lignes;
}

export function fichierIcs(evenements, nom = 'Dolina Darts Club') {
  const lignes = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dolina Darts Club//Calendrier//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${texte(nom)}`, ...FUSEAU.split('\n')];
  evenements.forEach((e) => lignes.push(...vevent(e)));
  lignes.push('END:VCALENDAR');
  return lignes.map(replier).join('\r\n') + '\r\n';
}

export function telechargerIcs(evenements, nomFichier, nomAgenda) {
  const blob = new Blob([fichierIcs(evenements, nomAgenda)], { type: 'text/calendar;charset=utf-8' });
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(blob);
  lien.download = nomFichier;
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
}
