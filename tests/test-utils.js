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
  it('groupe par préfixe et expose le nom nu', function() {
    var g = groupByNamespace([
      { name: 'miaou__create_memory' },
      { name: 'jira__search' },
      { name: 'jira__a__b' },
    ]);
    expect(g.length).toBe(2);
    expect(g[0].namespace).toBe('miaou');
    expect(g[0].tools[0].bareName).toBe('create_memory');
    expect(g[1].namespace).toBe('jira');
    expect(g[1].tools[0].bareName).toBe('search');
    expect(g[1].tools[1].bareName).toBe('a__b');
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
});

describe('parseToolFilterList', function() {
  it('découpe sur virgules et retours ligne, trim, sans vides', function() {
    expect(parseToolFilterList('a, b\nc ,, ')).toEqual(['a', 'b', 'c']);
  });
  it('vide → tableau vide', function() { expect(parseToolFilterList('').length).toBe(0); });
});
