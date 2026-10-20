// =====================================================================
//  Recadrage d'une photo de profil avant l'envoi
//  Le membre déplace la photo (doigt ou souris) et zoome (pincement,
//  molette ou curseur) pour la placer dans le cercle. Résultat : un carré
//  de `taille` px en JPEG. Renvoie null si le membre annule.
// =====================================================================

export function recadrerPhoto(fichier, taille = 400) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('lecture')); };
    img.onload = () => ouvrir();
    img.src = url;

    function ouvrir() {
      const fen = document.createElement('div');
      fen.className = 'fenetre recadrage';
      fen.setAttribute('role', 'dialog');
      fen.setAttribute('aria-modal', 'true');
      fen.setAttribute('aria-label', 'Ajuster la photo');
      fen.innerHTML = `
        <div class="fenetre__boite recadrage__boite">
          <h2>Ajuster la photo</h2>
          <p class="match__format" style="margin:0">Faites glisser la photo et zoomez pour placer votre visage dans le cercle.</p>
          <div class="recadrage__cadre" tabindex="0" aria-label="Zone de recadrage : flèches pour déplacer, + et − pour zoomer">
            <canvas class="recadrage__toile"></canvas>
            <div class="recadrage__masque" aria-hidden="true"></div>
          </div>
          <label class="recadrage__zoom">
            <span aria-hidden="true">−</span>
            <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">
            <span aria-hidden="true">+</span>
          </label>
          <div class="actions">
            <button type="button" class="bouton bouton--plein" data-valider>Valider</button>
            <button type="button" class="bouton" data-annuler>Annuler</button>
          </div>
        </div>`;
      document.body.appendChild(fen);
      document.body.style.overflow = 'hidden';

      const cadre = fen.querySelector('.recadrage__cadre');
      const toile = fen.querySelector('canvas');
      const curseur = fen.querySelector('input[type=range]');
      const ctx = toile.getContext('2d');
      const ratio = window.devicePixelRatio || 1;
      let C = 0;                 // côté du cadre affiché (px CSS)
      let base = 1;              // échelle qui remplit tout juste le cadre
      let zoom = 1;
      let x = 0; let y = 0;      // position du centre de l'image par rapport au centre du cadre

      const borner = () => {
        const w = img.width * base * zoom; const h = img.height * base * zoom;
        const mx = Math.max(0, (w - C) / 2); const my = Math.max(0, (h - C) / 2);
        x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
      };
      const dessiner = () => {
        borner();
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.fillStyle = '#141414';
        ctx.fillRect(0, 0, C, C);
        const w = img.width * base * zoom; const h = img.height * base * zoom;
        ctx.drawImage(img, C / 2 + x - w / 2, C / 2 + y - h / 2, w, h);
      };
      const dimensionner = () => {
        C = Math.round(cadre.clientWidth);
        toile.width = C * ratio; toile.height = C * ratio;
        toile.style.width = `${C}px`; toile.style.height = `${C}px`;
        base = C / Math.min(img.width, img.height);
        dessiner();
      };
      const zoomer = (z, cx = 0, cy = 0) => {
        const nz = Math.min(4, Math.max(1, z));
        // Le point sous le doigt reste en place
        x = cx - ((cx - x) * nz) / zoom; y = cy - ((cy - y) * nz) / zoom;
        zoom = nz;
        curseur.value = String(zoom);
        dessiner();
      };

      // Glisser (souris, doigt) et pincer (deux doigts)
      const pointeurs = new Map();
      let depart = null;
      const centreRel = (e) => { const r = cadre.getBoundingClientRect(); return [e.clientX - r.left - C / 2, e.clientY - r.top - C / 2]; };
      cadre.addEventListener('pointerdown', (e) => {
        cadre.setPointerCapture(e.pointerId);
        pointeurs.set(e.pointerId, [e.clientX, e.clientY]);
        depart = null;
      });
      cadre.addEventListener('pointermove', (e) => {
        if (!pointeurs.has(e.pointerId)) return;
        const avant = pointeurs.get(e.pointerId);
        pointeurs.set(e.pointerId, [e.clientX, e.clientY]);
        if (pointeurs.size === 1) {
          x += e.clientX - avant[0]; y += e.clientY - avant[1];
          dessiner();
        } else if (pointeurs.size === 2) {
          const [a, b] = [...pointeurs.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          const r = cadre.getBoundingClientRect();
          const cx = (a[0] + b[0]) / 2 - r.left - C / 2; const cy = (a[1] + b[1]) / 2 - r.top - C / 2;
          if (depart) zoomer(depart.zoom * (d / depart.d), cx, cy);
          else depart = { d, zoom };
        }
      });
      const lacher = (e) => { pointeurs.delete(e.pointerId); depart = null; };
      cadre.addEventListener('pointerup', lacher);
      cadre.addEventListener('pointercancel', lacher);
      cadre.addEventListener('wheel', (e) => { e.preventDefault(); const [cx, cy] = centreRel(e); zoomer(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), cx, cy); }, { passive: false });
      cadre.addEventListener('keydown', (e) => {
        const pas = 12;
        if (e.key === 'ArrowLeft') x += pas; else if (e.key === 'ArrowRight') x -= pas;
        else if (e.key === 'ArrowUp') y += pas; else if (e.key === 'ArrowDown') y -= pas;
        else if (e.key === '+' || e.key === '=') return zoomer(zoom * 1.1);
        else if (e.key === '-') return zoomer(zoom / 1.1);
        else return;
        e.preventDefault();
        dessiner();
      });
      curseur.addEventListener('input', () => zoomer(Number(curseur.value)));

      const fermer = (resultat) => {
        window.removeEventListener('resize', dimensionner);
        document.removeEventListener('keydown', echap);
        document.body.style.overflow = '';
        fen.remove();
        URL.revokeObjectURL(url);
        resolve(resultat);
      };
      const echap = (e) => { if (e.key === 'Escape') fermer(null); };
      document.addEventListener('keydown', echap);
      fen.querySelector('[data-annuler]').addEventListener('click', () => fermer(null));
      fen.querySelector('[data-valider]').addEventListener('click', () => {
        // Même cadrage, à la taille finale
        const sortie = document.createElement('canvas');
        sortie.width = taille; sortie.height = taille;
        const s = sortie.getContext('2d');
        const k = taille / C;
        s.fillStyle = '#141414';
        s.fillRect(0, 0, taille, taille);
        const w = img.width * base * zoom * k; const h = img.height * base * zoom * k;
        s.drawImage(img, taille / 2 + x * k - w / 2, taille / 2 + y * k - h / 2, w, h);
        sortie.toBlob((b) => (b ? fermer(b) : reject(new Error('conversion'))), 'image/jpeg', 0.85);
      });
      window.addEventListener('resize', dimensionner);
      requestAnimationFrame(dimensionner);
      cadre.focus();
    }
  });
}
