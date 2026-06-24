// tests/test-utils.js
// Adapter les noms de fonctions si l'implémentation choisit d'autres noms.

describe('escHtml', function() {
  it('échappe < et >', function() {
    expect(escHtml('<b>test</b>')).toBe('&lt;b&gt;test&lt;/b&gt;');
  });
  it('échappe les esperluettes', function() {
    expect(escHtml('a & b')).toBe('a &amp; b');
  });
  it('échappe les guillemets doubles', function() {
    expect(escHtml('"quote"')).toBe('&quot;quote&quot;');
  });
  it('ne modifie pas une chaîne sans caractères spéciaux', function() {
    expect(escHtml('hello world')).toBe('hello world');
  });
});

describe('tokenize', function() {
  it('met en minuscules', function() {
    expect(tokenize('WiFi Captive Portal')).toEqual(['wifi', 'captive', 'portal']);
  });
  it('filtre les stopwords', function() {
    var t = tokenize('le wifi et la box');
    expect(t.indexOf('le')).toBe(-1);
    expect(t.indexOf('et')).toBe(-1);
    expect(t.indexOf('wifi') >= 0).toBeTruthy(); // présent (indexOf peut valoir 0)
  });
  it('filtre les tokens trop courts', function() {
    var t = tokenize('un ip ok');
    expect(t.indexOf('ok')).toBeTruthy(); // 'ok' a 2 lettres -> selon seuil, à ajuster si besoin
  });
});

describe('scoreSummary', function() {
  it('un keyword vaut plus qu\'un mot du texte', function() {
    var s1 = scoreSummary(['portail'], { title: '', summary: 'rien à voir', keywords: ['portail'] });
    var s2 = scoreSummary(['portail'], { title: '', summary: 'le portail captif est mentionné', keywords: [] });
    expect(s1 > s2).toBeTruthy();
  });
  it('retourne 0 sans recouvrement', function() {
    var s = scoreSummary(['quelquechosederare'], { title: 'x', summary: 'y', keywords: ['z'] });
    expect(s).toBe(0);
  });
});

describe('formatMessageTime', function() {
  // Constructions locales pour éviter les effets DST (pas de soustraction brute d'epoch).

  it('même jour → HH:MM', function() {
    var now = new Date();
    var ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 8, 54, 0).getTime();
    expect(formatMessageTime(ts, now.getTime())).toBe('08:54');
  });

  it('veille → "hier à HH:MM"', function() {
    var now = new Date();
    var ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 17, 28, 0).getTime();
    expect(formatMessageTime(ts, now.getTime())).toBe('hier à 17:28');
  });

  it('veille 23:50 avec < 24h écoulées → "hier" (distinc. calendaire vs 24h glissant)', function() {
    var n = new Date();
    var ref = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 10, 0, 0).getTime();
    var ts  = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1, 23, 50, 0).getTime();
    expect(formatMessageTime(ts, ref)).toBe('hier à 23:50');
  });

  it('00:10 aujourd\'hui → HH:MM même si 9h50 écoulées (même jour calendaire)', function() {
    var n = new Date();
    var ref = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 10, 0, 0).getTime();
    var ts  = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 10, 0).getTime();
    expect(formatMessageTime(ts, ref)).toBe('00:10');
  });

  it('10 jours avant → forme datée sans année (/ une seule fois)', function() {
    var now = new Date();
    var ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10, 14, 30, 0).getTime();
    var result = formatMessageTime(ts, now.getTime());
    expect(result.indexOf('14:30') >= 0).toBeTruthy();
    expect((result.match(/\//g) || []).length).toBe(1);
  });

  it('1 an avant → forme datée avec année (/ deux fois)', function() {
    var now = new Date();
    var ts = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 8, 0, 0).getTime();
    var result = formatMessageTime(ts, now.getTime());
    expect((result.match(/\//g) || []).length).toBe(2);
  });

  it('retourne une chaîne vide sans timestamp', function() {
    expect(formatMessageTime(0, Date.now())).toBe('');
  });
});

describe('formatFullDateFr', function() {
  it('retourne une date complète en français (vendredi 15 mars 2024 à 14:30)', function() {
    // 15 mars 2024 est un vendredi
    var ts = new Date(2024, 2, 15, 14, 30, 0).getTime();
    var result = formatFullDateFr(ts);
    expect(result.indexOf('mars') >= 0).toBeTruthy();
    expect(result.indexOf('2024') >= 0).toBeTruthy();
    expect(result.indexOf('14:30') >= 0).toBeTruthy();
    expect(result.indexOf('vendredi') >= 0).toBeTruthy();
  });

  it('retourne une chaîne vide sans timestamp', function() {
    expect(formatFullDateFr(0)).toBe('');
  });
});
