// =====================================================================
//  Cible de fléchettes en SVG, aux dimensions réelles (en millimètres,
//  centre en 0,0) : sert au tirage au bull (et plus tard à la saisie
//  fléchette par fléchette).
// =====================================================================

export const CIBLE_ORDRE = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
// Rayons officiels (mm)
export const R = { bull: 6.35, demiBull: 15.9, tripleIn: 99, tripleOut: 107, doubleIn: 162, doubleOut: 170, numeros: 186, bord: 200 };

const rad = (deg) => (deg * Math.PI) / 180;
const pt = (r, deg) => `${(r * Math.cos(rad(deg))).toFixed(2)} ${(r * Math.sin(rad(deg))).toFixed(2)}`;
function secteur(r1, r2, a1, a2, couleur) {
  return `<path d="M ${pt(r1, a1)} L ${pt(r2, a1)} A ${r2} ${r2} 0 0 1 ${pt(r2, a2)} L ${pt(r1, a2)} A ${r1} ${r1} 0 0 0 ${pt(r1, a1)} Z" fill="${couleur}"/>`;
}

export function cibleSvg({ id = 'cible', etiquette = 'Cible de fléchettes' } = {}) {
  const NOIR = '#1d1d1d'; const CREME = '#eadfc4'; const ROUGE = '#d23a2f'; const VERT = '#1f8a4c';
  let parts = `<circle r="${R.bord}" fill="#111"/>`;
  CIBLE_ORDRE.forEach((n, i) => {
    const a1 = -90 - 9 + 18 * i; const a2 = a1 + 18;
    const fonce = i % 2 === 0;
    const simple = fonce ? NOIR : CREME; const anneau = fonce ? ROUGE : VERT;
    parts += secteur(R.demiBull, R.tripleIn, a1, a2, simple)
      + secteur(R.tripleIn, R.tripleOut, a1, a2, anneau)
      + secteur(R.tripleOut, R.doubleIn, a1, a2, simple)
      + secteur(R.doubleIn, R.doubleOut, a1, a2, anneau);
    const [x, y] = pt(R.numeros, -90 + 18 * i).split(' ');
    parts += `<text x="${x}" y="${y}" fill="#f8f8f8" font-size="19" font-weight="700" text-anchor="middle" dominant-baseline="central" font-family="Barlow, sans-serif">${n}</text>`;
  });
  parts += `<circle r="${R.demiBull}" fill="${VERT}"/><circle r="${R.bull}" fill="${ROUGE}"/>`;
  return `<svg id="${id}" class="cible-svg" viewBox="-${R.bord} -${R.bord} ${R.bord * 2} ${R.bord * 2}" role="img" aria-label="${etiquette}">${parts}<g class="cible-marques"></g></svg>`;
}

// Point touché (coordonnées de la cible, en mm) à partir d'un clic
export function pointCible(svg, evenement) {
  const p = svg.createSVGPoint();
  p.x = evenement.clientX; p.y = evenement.clientY;
  const q = p.matrixTransform(svg.getScreenCTM().inverse());
  return { x: q.x, y: q.y };
}

// Marque d'une fléchette sur la cible
export function marque({ x, y }, texte, classe) {
  const gauche = x > 120;
  return `<g class="cible-fleche ${classe}">
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7"/>
    <text x="${(x + (gauche ? -12 : 12)).toFixed(1)}" y="${(y - 10).toFixed(1)}" text-anchor="${gauche ? 'end' : 'start'}">${texte}</text>
  </g>`;
}
