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

describe('parseConvRefs', function() {
  it('aucun marqueur → tableau vide', function() {
    expect(parseConvRefs('bonjour, rien à signaler')).toEqual([]);
  });
  it('marqueur sans titre', function() {
    var r = parseConvRefs('vois [conv_ref:c1] pour plus de détails');
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('c1');
    expect(r[0].title).toBe(null);
  });
  it('marqueur avec titre', function() {
    var r = parseConvRefs('[conv_ref:c1|Migration Postgres]');
    expect(r[0].id).toBe('c1');
    expect(r[0].title).toBe('Migration Postgres');
  });
  it('titre pouvant contenir des deux-points', function() {
    var r = parseConvRefs('[conv_ref:c1|Bug: crash au démarrage]');
    expect(r[0].title).toBe('Bug: crash au démarrage');
  });
  it('plusieurs marqueurs dans le même texte', function() {
    var r = parseConvRefs('[conv_ref:c1|Un] et [conv_ref:c2|Deux]');
    expect(r.length).toBe(2);
    expect(r[0].id).toBe('c1');
    expect(r[1].id).toBe('c2');
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

describe('formatDateRelative', function() {
  it("même jour calendaire → aujourd'hui", function() {
    var now = new Date();
    var ts = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0).getTime();
    expect(formatDateRelative(ts, now.getTime())).toBe("aujourd'hui");
  });

  it("00:10 aujourd'hui → aujourd'hui (calendaire, pas 24h glissant)", function() {
    var n = new Date();
    var ref = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 50, 0).getTime();
    var ts  = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 10, 0).getTime();
    expect(formatDateRelative(ts, ref)).toBe("aujourd'hui");
  });

  it('−1 jour → hier', function() {
    var now = new Date();
    var ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0).getTime();
    expect(formatDateRelative(ts, now.getTime())).toBe('hier');
  });

  it('−2 jours → avant-hier', function() {
    var now = new Date();
    var ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 12, 0, 0).getTime();
    expect(formatDateRelative(ts, now.getTime())).toBe('avant-hier');
  });

  it('−10 jours → nom de mois, pas d\'année 4 chiffres, pas de label relatif', function() {
    var now = new Date();
    var ts = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10, 12, 0, 0).getTime();
    var result = formatDateRelative(ts, now.getTime());
    expect(result !== "aujourd'hui" && result !== 'hier' && result !== 'avant-hier').toBeTruthy();
    expect(/\d{4}/.test(result)).toBe(false);
    // contient un nom de mois français
    var months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    var hasMo = months.some(function(m) { return result.indexOf(m) >= 0; });
    expect(hasMo).toBeTruthy();
  });

  it('−1 an → contient l\'année et le nom du mois', function() {
    var now = new Date();
    var ts = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 12, 0, 0).getTime();
    var result = formatDateRelative(ts, now.getTime());
    expect(/\d{4}/.test(result)).toBeTruthy();
    var months = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
    var hasMo = months.some(function(m) { return result.indexOf(m) >= 0; });
    expect(hasMo).toBeTruthy();
  });

  it('retourne une chaîne vide sans timestamp', function() {
    expect(formatDateRelative(0, Date.now())).toBe('');
  });

  it('DST spring-forward FR (31 mars 2024) : 2 avr → 31 mars = avant-hier', function() {
    // France passe à l'heure d'été le 31 mars 2024 : le jour dure 23h.
    // Math.floor(23h/24h) = 0 → hier classé aujourd'hui. Math.round corrige.
    var now = new Date(2024, 3, 2, 12, 0, 0).getTime();  // 2 avril 2024
    var ts  = new Date(2024, 2, 31, 12, 0, 0).getTime(); // 31 mars 2024
    expect(formatDateRelative(ts, now)).toBe('avant-hier');
  });
});

describe('parseToolName (split sur le PREMIER __ seulement)', function() {
  it('sépare préfixe et nom nu', function() {
    var r = parseToolName('jira__search');
    expect(r.serverPrefix).toBe('jira');
    expect(r.toolName).toBe('search');
  });
  it('un toolName contenant lui-même __ n\'est PAS corrompu', function() {
    var r = parseToolName('jira__a__b__c');
    expect(r.serverPrefix).toBe('jira');
    expect(r.toolName).toBe('a__b__c');
  });
  it('sans séparateur : préfixe vide, nom entier', function() {
    var r = parseToolName('create_memory');
    expect(r.serverPrefix).toBe('');
    expect(r.toolName).toBe('create_memory');
  });
  it('outil interne préfixé miaou', function() {
    var r = parseToolName('miaou__create_memory');
    expect(r.serverPrefix).toBe('miaou');
    expect(r.toolName).toBe('create_memory');
  });
});

describe('groupByNamespace (projection pure, nom nu)', function() {
  it('groupe par tous-sauf-dernier et expose uniquement le dernier segment', function() {
    var g = groupByNamespace([
      { name: 'miaou__create_memory' },
      { name: 'jira__search' },
      { name: 'jira__a__b' },
    ]);
    // miaou__create_memory → ns=miaou, bareName=create_memory
    // jira__search        → ns=jira,  bareName=search
    // jira__a__b          → ns=jira__a, bareName=b  (sous-namespace distinct)
    expect(g.length).toBe(3);
    expect(g[0].namespace).toBe('miaou');
    expect(g[0].tools[0].bareName).toBe('create_memory');
    expect(g[1].namespace).toBe('jira');
    expect(g[1].tools[0].bareName).toBe('search');
    expect(g[2].namespace).toBe('jira__a');
    expect(g[2].tools[0].bareName).toBe('b');
  });
  it('nom sans préfixe → namespace miaou', function() {
    var g = groupByNamespace([{ name: 'ask_confirmation' }]);
    expect(g[0].namespace).toBe('miaou');
    expect(g[0].tools[0].bareName).toBe('ask_confirmation');
  });
});

describe('guessMcpTransport (pré-remplissage, jamais override)', function() {
  it('/sse → sse', function() { expect(guessMcpTransport('https://h/sse')).toBe('sse'); });
  it('/mcp → streamable-http', function() { expect(guessMcpTransport('https://h/mcp')).toBe('streamable-http'); });
  it('chemin inconnu → streamable-http par défaut', function() { expect(guessMcpTransport('https://h/x')).toBe('streamable-http'); });
  it('/sse avec query', function() { expect(guessMcpTransport('https://h/sse?x=1')).toBe('sse'); });
});

describe('validateMcpServerName', function() {
  it('accepte un nom valide', function() { expect(validateMcpServerName('jira', [])).toBe(null); });
  it('rejette miaou (réservé)', function() { expect(validateMcpServerName('miaou', [])).toContain('réservé'); });
  it('rejette un nom contenant __', function() { expect(validateMcpServerName('a__b', [])).toContain('__'); });
  it('rejette un espace', function() { expect(validateMcpServerName('a b', [])).toBeTruthy(); });
  it('rejette un doublon', function() { expect(validateMcpServerName('jira', ['jira'])).toContain('utilisé'); });
  it('rejette un nom vide', function() { expect(validateMcpServerName('', [])).toBeTruthy(); });
});

describe('filterMcpTools (D7, denylist gagne)', function() {
  var tools = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  it('vide/vide → tout passe', function() { expect(filterMcpTools(tools, [], []).length).toBe(3); });
  it('allowlist restreint', function() {
    var r = filterMcpTools(tools, ['a', 'b'], []);
    expect(r.length).toBe(2);
  });
  it('denylist retire', function() {
    var r = filterMcpTools(tools, [], ['b']);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('a,c');
  });
  it('denylist gagne sur allowlist en conflit', function() {
    var r = filterMcpTools(tools, ['a', 'b'], ['b']);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('a');
  });
});

describe('filterMcpTools (sous-namespaces)', function() {
  var tools = [{ name: 'proxy__get_data' }, { name: 'proxy__send' }, { name: 'other__get_data' }, { name: 'bare' }];
  it('allowlist par suffix matche les sous-namespaces', function() {
    var r = filterMcpTools(tools, ['get_data'], []);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('proxy__get_data,other__get_data');
  });
  it('denylist par suffix retire les sous-namespaces', function() {
    var r = filterMcpTools(tools, [], ['get_data']);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('proxy__send,bare');
  });
  it('match exact prime sur suffix (nom nu = valeur)', function() {
    var r = filterMcpTools(tools, ['bare'], []);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('bare');
  });
  it('denylist suffix gagne sur allowlist suffix', function() {
    var r = filterMcpTools(tools, ['get_data'], ['get_data']);
    expect(r.length).toBe(0);
  });
});

describe('filterMcpTools (globs)', function() {
  var tools = [
    { name: 'ns1__ns2__get_image' },
    { name: 'ns1__ns2__send' },
    { name: 'ns1__ns2__tool' },
    { name: 'ns1__other__tool' },
    { name: 'bare_tool' }
  ];
  it('suffix glob ns2* matche les outils sous ns2', function() {
    var r = filterMcpTools(tools, ['ns2*'], []);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('ns1__ns2__get_image,ns1__ns2__send,ns1__ns2__tool');
  });
  it('glob *_image matche par suffixe de nom', function() {
    var r = filterMcpTools(tools, ['*_image'], []);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('ns1__ns2__get_image');
  });
  it('glob *tool matche les noms terminant par tool', function() {
    var r = filterMcpTools(tools, ['*tool'], []);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('ns1__ns2__tool,ns1__other__tool,bare_tool');
  });
  it('denylist glob ns2* retire les outils sous ns2', function() {
    var r = filterMcpTools(tools, [], ['ns2*']);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('ns1__other__tool,bare_tool');
  });
  it('denylist glob gagne sur allowlist glob', function() {
    var r = filterMcpTools(tools, ['ns2*'], ['*_image']);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('ns1__ns2__send,ns1__ns2__tool');
  });
  it('glob ns2* ne matche pas ns1__other__tool', function() {
    var r = filterMcpTools(tools, ['ns2*'], []);
    expect(r.some(function(t){return t.name === 'ns1__other__tool';})).toBe(false);
  });
  it('glob ns1* matche tous les outils sous ns1', function() {
    var r = filterMcpTools(tools, ['ns1*'], []);
    expect(r.map(function(t){return t.name;}).join(',')).toBe('ns1__ns2__get_image,ns1__ns2__send,ns1__ns2__tool,ns1__other__tool');
  });
});

describe('stampTs', function() {
  it('sans ts retourne le résultat tel quel', function() {
    expect(stampTs(null, 'hello')).toBe('hello');
    expect(stampTs(0, 'hello')).toBe('hello');
  });
  it('avec ts préfixe la date en français', function() {
    var ts = new Date(2024, 2, 15, 14, 30, 0).getTime(); // 15 mars 2024 vendredi
    var r = stampTs(ts, 'résultat');
    expect(r.indexOf('2024') >= 0).toBeTruthy();
    expect(r.indexOf('mars') >= 0).toBeTruthy();
    expect(r.indexOf('résultat') >= 0).toBeTruthy();
    // la date précède le résultat
    expect(r.indexOf('[Résultat du')).toBe(0);
    expect(r.indexOf('résultat') > r.indexOf('2024')).toBeTruthy();
  });
  it('result null ou undefined → chaîne vide (pas de crash)', function() {
    expect(stampTs(null, null)).toBe('');
    expect(stampTs(null, undefined)).toBe('');
  });
});

describe('formatToolAcksMd', function() {
  it('liste vide → chaîne vide', function() {
    expect(formatToolAcksMd([])).toBe('');
    expect(formatToolAcksMd(null)).toBe('');
  });
  it('un seul appel : en-tête singulier, sans numérotation', function() {
    var r = formatToolAcksMd([{ name: 'miaou__create_memory', args: { content: 'x' }, result: '{"id":"m1"}' }]);
    expect(r.indexOf('**Outil appelé :**') >= 0).toBeTruthy();
    expect(r.indexOf('Outils appelés') >= 0).toBeFalsy();
    expect(r.indexOf('`miaou__create_memory`') >= 0).toBeTruthy();
    expect(r.indexOf('Arguments :') >= 0).toBeTruthy();
    expect(r.indexOf('Résultat :') >= 0).toBeTruthy();
  });
  it('intent présent → rendu "— intent" après le nom', function() {
    var r = formatToolAcksMd([{ name: 'weather__get', intent: 'vérifier la météo', args: {}, result: 'ok' }]);
    expect(r.indexOf('`weather__get` — vérifier la météo') >= 0).toBeTruthy();
  });
  it('pas d\'intent → pas de tiret après le nom', function() {
    var r = formatToolAcksMd([{ name: 'miaou__create_memory', args: {}, result: 'ok' }]);
    expect(r.indexOf('`miaou__create_memory` —') >= 0).toBeFalsy();
  });
  it('plusieurs appels : en-tête pluriel avec compte, liste numérotée', function() {
    var r = formatToolAcksMd([
      { name: 'a', args: {}, result: '1' },
      { name: 'b', args: {}, result: '2' },
    ]);
    expect(r.indexOf('**Outils appelés (2) :**') >= 0).toBeTruthy();
    expect(r.indexOf('1. `a`') >= 0).toBeTruthy();
    expect(r.indexOf('2. `b`') >= 0).toBeTruthy();
  });
  it('erreur : "Résultat (erreur)" au lieu de "Résultat"', function() {
    var r = formatToolAcksMd([{ name: 'a', args: {}, result: 'timeout', error: true }]);
    expect(r.indexOf('Résultat (erreur) :') >= 0).toBeTruthy();
    expect(r.indexOf('Résultat :') >= 0).toBeFalsy();
  });
  it('résultat long tronqué avec "..." (pas de mention "tronqué")', function() {
    var long = new Array(400).join('x');
    var r = formatToolAcksMd([{ name: 'a', args: {}, result: long }]);
    expect(r.indexOf('...') >= 0).toBeTruthy();
    expect(r.indexOf('tronqué') >= 0).toBeFalsy();
    expect(r.indexOf(long) >= 0).toBeFalsy();
  });
  it('résultat court : pas de troncature, pas de "..."', function() {
    var r = formatToolAcksMd([{ name: 'a', args: {}, result: 'court' }]);
    expect(r.indexOf('court...') >= 0).toBeFalsy();
    expect(r.indexOf('court') >= 0).toBeTruthy();
  });
  it('resource_presented : note de ressource avec nom et mime, sans data embarquée', function() {
    var r = formatToolAcksMd([{ name: 'weather__get_map', kind: 'resource_presented',
      args: {}, result: '[resource_ref:res_1]', resourceName: 'carte.png', mime: 'image/png' }]);
    expect(r.indexOf('Ressource présentée automatiquement') >= 0).toBeTruthy();
    expect(r.indexOf('carte.png') >= 0).toBeTruthy();
    expect(r.indexOf('image/png') >= 0).toBeTruthy();
    expect(r.indexOf('data:') >= 0).toBeFalsy();
  });
  it('nom de ressource long tronqué avec "..."', function() {
    var longName = new Array(80).join('a') + '.png';
    var r = formatToolAcksMd([{ name: 'x', kind: 'resource_presented', args: {}, result: 'r', resourceName: longName }]);
    expect(r.indexOf(longName) >= 0).toBeFalsy();
    expect(r.indexOf('...') >= 0).toBeTruthy();
  });
  it('pas d\'args (absent) : pas de ligne Arguments', function() {
    var r = formatToolAcksMd([{ name: 'a', result: 'ok' }]);
    expect(r.indexOf('Arguments :') >= 0).toBeFalsy();
  });
  it('résultat multiligne : \\n rendu visible, pas de saut de ligne brut dans le code span', function() {
    var r = formatToolAcksMd([{ name: 'a', args: {}, result: 'ligne1\nligne2\r\nligne3' }]);
    expect(r.indexOf('ligne1\\nligne2\\nligne3') >= 0).toBeTruthy();
    expect(r.indexOf('ligne1\nligne2') >= 0).toBeFalsy();
  });
});

describe('_hashId9', function() {
  it('renvoie toujours exactement 9 caractères', function() {
    expect(_hashId9('').length).toBe(9);
    expect(_hashId9('abc').length).toBe(9);
    expect(_hashId9('a very long group identifier string 0').length).toBe(9);
  });

  it('renvoie uniquement des caractères [a-z0-9]', function() {
    var inputs = ['', 'gmqyyccce', 'solo', 'x\x001', 'abc\x000'];
    inputs.forEach(function(s) {
      expect(/^[a-z0-9]+$/.test(_hashId9(s))).toBeTruthy();
    });
  });

  it('est déterministe', function() {
    expect(_hashId9('mygroup\x000')).toBe(_hashId9('mygroup\x000'));
    expect(_hashId9('solo\x000')).toBe(_hashId9('solo\x000'));
  });

  it('entrées adjacentes (k=0 vs k=1) produisent des ids distincts', function() {
    expect(_hashId9('grp\x000') === _hashId9('grp\x001')).toBeFalsy();
  });
});

describe('expandThread', function() {
  // Helper : ack enrichi minimal
  function ack(overrides) {
    return Object.assign({ role: 'tool-ack', kind: 'mcp_call', name: 'srv__foo',
      args: { q: 1 }, result: 'ok', ts: 0, group: 'g1' }, overrides);
  }

  it('thread vide → tableau vide', function() {
    expect(expandThread([])).toEqual([]);
  });

  it('messages ordinaires passent sans transformation', function() {
    var t = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }];
    var r = expandThread(t);
    expect(r.length).toBe(2);
    expect(r[0].role).toBe('user');
    expect(r[1].role).toBe('assistant');
  });

  it('ack legacy (sans args) est élagué', function() {
    var t = [
      { role: 'user', content: 'hi' },
      { role: 'tool-ack', kind: 'memory_create', id: 'x' },
      { role: 'assistant', content: 'done' },
    ];
    var r = expandThread(t);
    expect(r.length).toBe(2);
    expect(r[0].role).toBe('user');
    expect(r[1].role).toBe('assistant');
  });

  it('ack enrichi seul → assistant+tool_calls + tool', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: 'gA' }),
      { role: 'assistant', content: 'réponse' },
    ];
    var r = expandThread(t);
    expect(r.length).toBe(4); // user, assistant(tc), tool, assistant(final)
    expect(r[1].role).toBe('assistant');
    expect(Array.isArray(r[1].tool_calls)).toBeTruthy();
    expect(r[1].tool_calls.length).toBe(1);
    expect(r[1].tool_calls[0].function.name).toBe('srv__foo');
    expect(r[2].role).toBe('tool');
    expect(r[2].tool_call_id).toBe(r[1].tool_calls[0].id);
    expect(r[3].role).toBe('assistant');
  });

  it('deux acks du même groupe → un seul assistant avec 2 tool_calls', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ name: 'srv__a', group: 'gB' }),
      ack({ name: 'srv__b', group: 'gB' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    // user, assistant(2 tc), tool, tool, assistant
    expect(r.length).toBe(5);
    expect(r[1].tool_calls.length).toBe(2);
    expect(r[1].tool_calls[0].function.name).toBe('srv__a');
    expect(r[1].tool_calls[1].function.name).toBe('srv__b');
    expect(r[2].role).toBe('tool');
    expect(r[3].role).toBe('tool');
    // ids cohérents assistant↔tool
    expect(r[2].tool_call_id).toBe(r[1].tool_calls[0].id);
    expect(r[3].tool_call_id).toBe(r[1].tool_calls[1].id);
  });

  it('deux groupes séquentiels → deux paires assistant+tool', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ name: 'srv__x', group: 'gC1' }),
      ack({ name: 'srv__y', group: 'gC2' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    // user, assistant(tc1), tool1, assistant(tc2), tool2, assistant(final)
    expect(r.length).toBe(6);
    expect(r[1].tool_calls[0].function.name).toBe('srv__x');
    expect(r[3].tool_calls[0].function.name).toBe('srv__y');
  });

  it('assistantText absorbé depuis le standalone précédent', function() {
    var t = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'je vais chercher' },
      ack({ name: 'srv__foo', group: 'gD', assistantText: 'je vais chercher' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    // Le standalone est absorbé : user, assistant(tc+content), tool, assistant(final)
    expect(r.length).toBe(4);
    expect(r[1].content).toBe('je vais chercher');
    expect(Array.isArray(r[1].tool_calls)).toBeTruthy();
  });

  it('stampTs injecté dans le content du message tool', function() {
    var ts = new Date(2024, 2, 15, 14, 30, 0).getTime();
    var t = [
      { role: 'user', content: 'q' },
      ack({ result: 'data', ts: ts, group: 'gE' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    var toolMsg = r[2];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content.indexOf('[Résultat du')).toBe(0);
    expect(toolMsg.content.indexOf('data') > 0).toBeTruthy();
  });

  it('recall image (D3 voie b) : user synthétique inséré APRÈS le tool result', function() {
    var t = [
      { role: 'user', content: 'montre att-1' },
      ack({ name: 'miaou__recall_attachment', args: { ref: 'att-1' },
            kind: 'attachment_recalled', attId: 'att-1', mime: 'image/jpeg',
            result: 'Image att-1 ré-affichée…', group: 'gImg',
            recallImage: 'data:image/jpeg;base64,AAAA' }),
      { role: 'assistant', content: 'la voici' },
    ];
    var r = expandThread(t);
    // user, assistant(tc), tool, user(synthétique image), assistant(final)
    expect(r.length).toBe(5);
    expect(r[2].role).toBe('tool');
    expect(r[3].role).toBe('user');
    expect(Array.isArray(r[3].content)).toBeTruthy();
    expect(r[3].content[0].type).toBe('text');
    expect(r[3].content[1].type).toBe('image_url');
    expect(r[3].content[1].image_url.url).toBe('data:image/jpeg;base64,AAAA');
    expect(r[3]._synthetic).toBe(true);   // marqueur S1 : exclu du calcul lastUserIdx
    expect(r[4].role).toBe('assistant');
  });

  it('recall image sans recallImage (record purgé) : aucun user synthétique', function() {
    var t = [
      { role: 'user', content: 'montre att-1' },
      ack({ name: 'miaou__recall_attachment', kind: 'attachment_recalled',
            attId: 'att-1', mime: 'image/jpeg', result: 'txt', group: 'gImg2' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    // user, assistant(tc), tool, assistant — pas de user synthétique
    expect(r.length).toBe(4);
    expect(r[3].role).toBe('assistant');
    expect(r.some(function(m) { return m.role === 'user' && Array.isArray(m.content); })).toBeFalsy();
  });

  it('tool_call_id : format 9 chars [a-z0-9] uniquement', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: 'gmqyyccce' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    var id = r[1].tool_calls[0].id;
    expect(id.length).toBe(9);
    expect(/^[a-z0-9]+$/.test(id)).toBeTruthy();
  });

  it('tool_call_id déterministe : même groupe → même id', function() {
    var mkThread = function() {
      return [
        { role: 'user', content: 'q' },
        ack({ group: 'stable' }),
        { role: 'assistant', content: 'fin' },
      ];
    };
    var id1 = expandThread(mkThread())[1].tool_calls[0].id;
    var id2 = expandThread(mkThread())[1].tool_calls[0].id;
    expect(id1).toBe(id2);
  });

  it('ack sans group (solo) → id valide 9 chars', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: undefined }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    var id = r[1].tool_calls[0].id;
    expect(id.length).toBe(9);
    expect(/^[a-z0-9]+$/.test(id)).toBeTruthy();
    expect(r[2].tool_call_id).toBe(id);
  });

  it('arguments JSON sérialisés dans function.arguments', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ args: { id: 'abc', with_contents: true }, group: 'gF' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    var parsed = JSON.parse(r[1].tool_calls[0].function.arguments);
    expect(parsed.id).toBe('abc');
    expect(parsed.with_contents).toBe(true);
  });

  it('content en tableau de content parts (tour d\'attache, brief A lot 2) passe tel quel', function() {
    var parts = [{ type: 'text', text: 'vois' }, { type: 'image_url', image_url: { url: 'data:x' } }];
    var t = [{ role: 'user', content: parts }];
    var r = expandThread(t);
    expect(r.length).toBe(1);
    expect(r[0].content).toBe(parts);   // même référence : aucune transformation
  });
});

// ── messageTextForSummary (brief A lot 2 — durcissement generateTitle/generateSummary) ─

describe('messageTextForSummary', function() {
  it('content string simple → renvoyé tel quel', function() {
    expect(messageTextForSummary({ role: 'user', content: 'bonjour' })).toBe('bonjour');
  });
  it('displayText prioritaire sur content (slash-skill bakée)', function() {
    expect(messageTextForSummary({ role: 'user', content: 'corps baké', displayText: '/skill x' })).toBe('/skill x');
  });
  it('content en tableau de parts (tour d\'attache image) → extrait seulement le texte, jamais "[object Object]"', function() {
    var m = { role: 'user', content: [{ type: 'text', text: 'analyse ceci' }, { type: 'image_url', image_url: { url: 'data:x' } }] };
    var out = messageTextForSummary(m);
    expect(out).toBe('analyse ceci');
    expect(out.indexOf('object Object') < 0).toBeTruthy();
  });
  it('plusieurs parts texte concaténées', function() {
    var m = { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] };
    expect(messageTextForSummary(m)).toBe('A\n\nB');
  });
  it('content absent/null → chaîne vide, pas de crash', function() {
    expect(messageTextForSummary({ role: 'assistant', content: null })).toBe('');
  });
});

describe('parseToolFilterList', function() {
  it('découpe sur virgules et retours ligne, trim, sans vides', function() {
    expect(parseToolFilterList('a, b\nc ,, ')).toEqual(['a', 'b', 'c']);
  });
  it('vide → tableau vide', function() { expect(parseToolFilterList('').length).toBe(0); });
});

describe('copyAckFields (whitelist unique des champs d\'ack)', function() {
  it('copie les champs présents et préserve la cible', function() {
    var src = { kind: 'mcp_call', server: 'srv', name: 'srv__t', args: { a: 1 },
                result: 'r', ts: 42, group: 'g1', assistantText: 'lead', intent: 'but' };
    var out = copyAckFields(src, { role: 'tool-ack' });
    expect(out.role).toBe('tool-ack');
    expect(out.kind).toBe('mcp_call');
    expect(out.server).toBe('srv');
    expect(out.args).toEqual({ a: 1 });
    expect(out.group).toBe('g1');
    expect(out.intent).toBe('but');
  });
  it('n\'introduit pas de clefs pour les champs absents', function() {
    var out = copyAckFields({ kind: 'memory_create', id: 'm1', content: 'c' }, { role: 'tool-ack' });
    expect('title' in out).toBe(false);
    expect('args' in out).toBe(false);
    expect('error' in out).toBe(false);
  });
  it('error/resolved en sémantique truthy (jamais false explicite)', function() {
    var out1 = copyAckFields({ kind: 'mcp_call', error: true, resolved: true }, {});
    expect(out1.error).toBe(true);
    expect(out1.resolved).toBe(true);
    var out2 = copyAckFields({ kind: 'mcp_call', error: false, resolved: false }, {});
    expect('error' in out2).toBe(false);
    expect('resolved' in out2).toBe(false);
  });
  it('champ hors whitelist non copié', function() {
    var out = copyAckFields({ kind: 'mcp_call', rogue: 'x' }, {});
    expect('rogue' in out).toBe(false);
  });
  it('couvre les champs piégeux déjà payés (convId, slug)', function() {
    var out = copyAckFields({ kind: 'conversation_read', convId: 'c1', slug: 's1' }, {});
    expect(out.convId).toBe('c1');
    expect(out.slug).toBe('s1');
  });
});

describe('parseCodeFenceInfo', function() {
  it('lang seul, pas de filename', function() {
    var r = parseCodeFenceInfo('python');
    expect(r.lang).toBe('python');
    expect(r.filename).toBe('');
  });
  it('lang + filename séparés par un espace', function() {
    var r = parseCodeFenceInfo('python filename=foo.py');
    expect(r.lang).toBe('python');
    expect(r.filename).toBe('foo.py');
  });
  it('espaces multiples entre lang et filename', function() {
    var r = parseCodeFenceInfo('js  filename=x.js');
    expect(r.lang).toBe('js');
    expect(r.filename).toBe('x.js');
  });
  it('filename entre guillemets, avec espace interne', function() {
    var r = parseCodeFenceInfo('python filename="a b.py"');
    expect(r.lang).toBe('python');
    expect(r.filename).toBe('a b.py');
  });
  it('virgule terminale sur le lang (ancienne forme cassée) nettoyée', function() {
    var r = parseCodeFenceInfo('python, filename=foo.py');
    expect(r.lang).toBe('python');
    expect(r.filename).toBe('foo.py');
  });
  it('info string vide', function() {
    var r = parseCodeFenceInfo('');
    expect(r.lang).toBe('');
    expect(r.filename).toBe('');
  });
  it('info string absente (undefined)', function() {
    var r = parseCodeFenceInfo(undefined);
    expect(r.lang).toBe('');
    expect(r.filename).toBe('');
  });
});

describe('sanitizeDownloadName', function() {
  it('nom simple avec extension inchangé', function() {
    expect(sanitizeDownloadName('foo.py', 'python')).toBe('foo.py');
  });
  it('retire les séparateurs de chemin', function() {
    expect(sanitizeDownloadName('a/b.py', 'python')).toBe('a_b.py');
  });
  it('neutralise une traversée de répertoire', function() {
    expect(sanitizeDownloadName('../etc/passwd', 'text')).toBe('_etc_passwd.txt');
  });
  it('suffixe une extension dérivée du langage si absente', function() {
    expect(sanitizeDownloadName('fibonacci', 'python')).toBe('fibonacci.py');
  });
  it('retire les caractères de contrôle', function() {
    expect(sanitizeDownloadName('foo\x00bar.js', 'js')).toBe('foobar.js');
  });
  it('chaîne vide → chaîne vide (fallback à l\'appelant)', function() {
    expect(sanitizeDownloadName('', 'python')).toBe('');
  });
  it('undefined → chaîne vide', function() {
    expect(sanitizeDownloadName(undefined, 'python')).toBe('');
  });
});
