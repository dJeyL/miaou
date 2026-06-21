// tests/test-ui.js
// Seules les fonctions pures de ui.js sont couvertes ici (le DOM, les timers et
// le rendu se vérifient à la main). WAITER_WORDS est un const de ui.js, hors de
// portée du test (frontière de fichier dans le runner) : on teste donc des
// propriétés observables sans le référencer.

describe('pickWaiterWord', function() {
  it('retourne une chaîne non vide', function() {
    var w = pickWaiterWord();
    expect(typeof w).toBe('string');
    expect(w.length > 0).toBeTruthy();
  });
  it('ne répète jamais le mot précédent', function() {
    var prev = pickWaiterWord();
    var repeated = false;
    for (var i = 0; i < 100; i++) {
      var w = pickWaiterWord(prev);
      if (w === prev) { repeated = true; break; }
      prev = w;
    }
    expect(repeated).toBe(false);
  });
});

describe('relativeWhen (libellé de date par conversation)', function() {
  // On teste le comportement (jour même → heure, plus « aujourd'hui »), pas le
  // format exact : QuickJS n'honore pas la locale fr-FR de toLocaleTimeString.
  it('affiche une heure (non « aujourd\'hui ») pour le jour même', function() {
    var label = relativeWhen(Date.now());
    expect(label === "aujourd'hui").toBe(false);
    expect(label).toContain(':');
  });
  it('affiche « hier à HH:MM » pour la veille', function() {
    var n = new Date();
    var yesterdayNoon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1, 12, 0).getTime();
    var label = relativeWhen(yesterdayNoon);
    expect(label).toContain('hier');
    expect(label).toContain(':');
  });
  it('retourne une chaîne vide sans timestamp', function() {
    expect(relativeWhen(0)).toBe('');
  });
});
