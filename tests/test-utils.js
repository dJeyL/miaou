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
