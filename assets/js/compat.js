// =====================================================================
//  Compatibilité avec les anciens iPad / iPhone (iOS 14 – 15.3)
//  Fonctions récentes du navigateur ajoutées si elles manquent.
//  Script classique, chargé avant les modules de chaque page.
// =====================================================================
(function () {
  function ajouter(obj, nom, fn) {
    if (obj && !obj[nom]) Object.defineProperty(obj, nom, { value: fn, writable: true, configurable: true });
  }
  function at(i) {
    var n = Math.trunc(i) || 0;
    if (n < 0) n += this.length;
    return n < 0 || n >= this.length ? undefined : this[n];
  }
  ajouter(Array.prototype, 'at', at);
  ajouter(String.prototype, 'at', at);
  if (typeof Int8Array !== 'undefined') ajouter(Object.getPrototypeOf(Int8Array.prototype), 'at', at);
  ajouter(Array.prototype, 'findLast', function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; return undefined; });
  ajouter(Array.prototype, 'findLastIndex', function (f, t) { for (var i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i; return -1; });
  ajouter(Object, 'hasOwn', function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  ajouter(String.prototype, 'replaceAll', function (a, b) {
    return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(typeof b === 'function' ? b(a) : b);
  });
  if (window.crypto && !window.crypto.randomUUID && window.crypto.getRandomValues) {
    window.crypto.randomUUID = function () {
      var b = window.crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
      var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
      return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    };
  }
  ajouter(window, 'structuredClone', function (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); });
}());
