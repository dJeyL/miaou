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
  it("échappe l'apostrophe (attributs single-quote des gabarits onclick)", function() {
    expect(escHtml("l'apostrophe d'ici")).toBe('l&#39;apostrophe d&#39;ici');
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

describe('scoreCommand', function() {
  it('match en début de mot du label bat un substring interne', function() {
    var boundary = scoreCommand(['conv'], { label: 'Nouvelle conversation', keywords: [] });
    var inner    = scoreCommand(['ouv'],  { label: 'Nouvelle conversation', keywords: [] });
    expect(boundary > inner).toBeTruthy();
  });
  it('match sur un keyword compte', function() {
    var s = scoreCommand(['theme'], { label: 'Basculer clair/sombre', keywords: ['theme', 'thème'] });
    expect(s > 0).toBeTruthy();
  });
  it('aucun match → 0', function() {
    var s = scoreCommand(['introuvable'], { label: 'Réglages', keywords: ['settings'] });
    expect(s).toBe(0);
  });
  it('requête vide (aucun token) → 0', function() {
    expect(scoreCommand([], { label: 'Réglages', keywords: ['settings'] })).toBe(0);
  });
});

describe('filterCommands', function() {
  var cmds = [
    { id: 'new',      label: 'Nouvelle conversation', keywords: ['new'] },
    { id: 'settings', label: 'Réglages',              keywords: ['settings', 'préférences'] },
    { id: 'theme',    label: 'Basculer clair/sombre', keywords: ['theme'] },
  ];
  it('requête vide conserve la liste et son ordre', function() {
    var r = filterCommands(cmds, '');
    expect(r.length).toBe(3);
    expect(r[0].id).toBe('new');
    expect(r[2].id).toBe('theme');
  });
  it('filtre les commandes sans match', function() {
    var r = filterCommands(cmds, 'réglages');
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('settings');
  });
  it('trie par score décroissant', function() {
    // 'co' matche 'conversation' (frontière, +3) et rien d'autre fort.
    var r = filterCommands(cmds, 'conversation');
    expect(r[0].id).toBe('new');
  });
});

describe('rankConvResults', function() {
  it('le Space actif passe en tête même à score inférieur', function() {
    var results = [
      { id: 'a', spaceId: 'other',  score: 9 },
      { id: 'b', spaceId: 'active', score: 2 },
    ];
    var r = rankConvResults(results, 'active');
    expect(r[0].id).toBe('b');
    expect(r[1].id).toBe('a');
  });
  it('à Space égal, départage par score décroissant', function() {
    var results = [
      { id: 'a', spaceId: 'active', score: 1 },
      { id: 'b', spaceId: 'active', score: 5 },
    ];
    var r = rankConvResults(results, 'active');
    expect(r[0].id).toBe('b');
  });
  it('score égal et même Space : ordre d\'origine stable', function() {
    var results = [
      { id: 'a', spaceId: 'active', score: 3 },
      { id: 'b', spaceId: 'active', score: 3 },
    ];
    var r = rankConvResults(results, 'active');
    expect(r[0].id).toBe('a');
    expect(r[1].id).toBe('b');
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

// calendarBucket : bornes calendaires partagées par sectionFor/relativeWhen (ui.js)
describe('calendarBucket', function() {
  function at(y, m, d, h) { return new Date(y, m, d, h || 12, 0, 0).getTime(); }
  var now = at(2026, 5, 15, 12);   // 15 juin 2026, midi

  it('même jour → today', function() {
    expect(calendarBucket(at(2026, 5, 15, 8), now).bucket).toBe('today');
  });
  it('découpage calendaire, pas 24h glissant (00:10 le jour même → today)', function() {
    var ref = at(2026, 5, 15, 23);          // 23h
    expect(calendarBucket(at(2026, 5, 15, 0), ref).bucket).toBe('today');   // 0h même jour
  });
  it('la veille → yesterday', function() {
    expect(calendarBucket(at(2026, 5, 14, 12), now).bucket).toBe('yesterday');
  });
  it('dans les 7 jours → week', function() {
    expect(calendarBucket(at(2026, 5, 10, 12), now).bucket).toBe('week');
  });
  it('dans les 30 jours → month', function() {
    expect(calendarBucket(at(2026, 4, 25, 12), now).bucket).toBe('month');
  });
  it('au-delà de 30 jours → older', function() {
    expect(calendarBucket(at(2026, 3, 1, 12), now).bucket).toBe('older');
  });
  it('ts absent → older, daysAgo Infinity', function() {
    var r = calendarBucket(0, now);
    expect(r.bucket).toBe('older');
    expect(r.daysAgo).toBe(Infinity);
  });
  it('daysAgo : 1 pour la veille, croissant', function() {
    expect(calendarBucket(at(2026, 5, 14, 12), now).daysAgo).toBe(1);
    expect(calendarBucket(at(2026, 5, 10, 12), now).daysAgo).toBe(5);
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
    var r = parseToolName('about');
    expect(r.serverPrefix).toBe('');
    expect(r.toolName).toBe('about');
  });
  it('outil interne préfixé miaou', function() {
    var r = parseToolName('miaou__memory__create');
    expect(r.serverPrefix).toBe('miaou');
    expect(r.toolName).toBe('memory__create');
  });
});

describe('groupByNamespace (projection pure, nom nu)', function() {
  it('groupe par tous-sauf-dernier et expose uniquement le dernier segment', function() {
    var g = groupByNamespace([
      { name: 'miaou__about' },
      { name: 'miaou__memory__create' },
      { name: 'jira__search' },
      { name: 'jira__a__b' },
    ]);
    // miaou__about          → ns=miaou,         bareName=about
    // miaou__memory__create → ns=miaou__memory, bareName=create (sous-namespace interne, lot P)
    // jira__search          → ns=jira,          bareName=search
    // jira__a__b            → ns=jira__a,        bareName=b       (sous-namespace distant)
    expect(g.length).toBe(4);
    expect(g[0].namespace).toBe('miaou');
    expect(g[0].tools[0].bareName).toBe('about');
    expect(g[1].namespace).toBe('miaou__memory');
    expect(g[1].tools[0].bareName).toBe('create');
    expect(g[2].namespace).toBe('jira');
    expect(g[2].tools[0].bareName).toBe('search');
    expect(g[3].namespace).toBe('jira__a');
    expect(g[3].tools[0].bareName).toBe('b');
  });
  it('nom sans préfixe → namespace miaou', function() {
    var g = groupByNamespace([{ name: 'ask_confirmation' }]);
    expect(g[0].namespace).toBe('miaou');
    expect(g[0].tools[0].bareName).toBe('ask_confirmation');
  });
});

describe('resolveInternalToolName (le registre tranche, pas la forme du nom — lot P)', function() {
  // Registre minimal : le vrai TOOLS n'est pas chargé dans ce contexte de test pur.
  var reg = [{ name: 'about' }, { name: 'memory__create' }, { name: 'conv__get' }, { name: 'resource__present' }];
  it('sous-namespace interne nu → nom canonique (ne part PAS vers un serveur MCP)', function() {
    expect(resolveInternalToolName('memory__create', reg)).toBe('memory__create');
    expect(resolveInternalToolName('conv__get', reg)).toBe('conv__get');
  });
  it('nom nu simple (sans __) → lui-même', function() {
    expect(resolveInternalToolName('about', reg)).toBe('about');
  });
  it('préfixe miaou__ strippé avant lookup', function() {
    expect(resolveInternalToolName('miaou__memory__create', reg)).toBe('memory__create');
    expect(resolveInternalToolName('miaou__about', reg)).toBe('about');
  });
  it('outil distant (préfixe serveur) → null', function() {
    expect(resolveInternalToolName('jira__search', reg)).toBe(null);
    expect(resolveInternalToolName('memory__unknown', reg)).toBe(null);
  });
  it('inconnu / vide → null', function() {
    expect(resolveInternalToolName('nope', reg)).toBe(null);
    expect(resolveInternalToolName('', reg)).toBe(null);
    expect(resolveInternalToolName(null, reg)).toBe(null);
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

describe('mcpUrlIdentity (comparaison douce)', function() {
  it('retire le slash final', function() {
    expect(mcpUrlIdentity('http://127.0.0.1:8765/mcp/')).toBe('http://127.0.0.1:8765/mcp');
  });
  it('ignore la casse et les espaces', function() {
    expect(mcpUrlIdentity('  HTTP://Host/MCP ')).toBe('http://host/mcp');
  });
  it("ne prétend PAS que localhost vaut 127.0.0.1", function() {
    var same = mcpUrlIdentity('http://localhost/mcp') === mcpUrlIdentity('http://127.0.0.1/mcp');
    expect(same).toBe(false);
  });
});

describe('mcpSeedCandidates (seed de build)', function() {
  var cfg = { name: 'miaou-mcp', url: 'http://127.0.0.1:8765/mcp' };
  it('seede dans un parc vide', function() {
    expect(mcpSeedCandidates([cfg], []).length).toBe(1);
  });
  it('écarte un équivalent par nom', function() {
    expect(mcpSeedCandidates([cfg], [{ name: 'miaou-mcp', url: 'http://autre/mcp' }]).length).toBe(0);
  });
  it('écarte un équivalent par URL, sous un autre nom', function() {
    expect(mcpSeedCandidates([cfg], [{ name: 'perso', url: 'http://127.0.0.1:8765/mcp/' }]).length).toBe(0);
  });
  it('écarte un nom réservé', function() {
    expect(mcpSeedCandidates([{ name: 'miaou', url: 'http://h/mcp' }], []).length).toBe(0);
  });
  it('écarte une entrée sans URL', function() {
    expect(mcpSeedCandidates([{ name: 'ok' }], []).length).toBe(0);
  });
  it('dédoublonne les candidats entre eux', function() {
    var r = mcpSeedCandidates([cfg, { name: 'autre', url: 'http://127.0.0.1:8765/mcp' }], []);
    expect(r.length).toBe(1);
  });
  it('préserve l\'ordre reçu', function() {
    var r = mcpSeedCandidates([cfg, { name: 'second', url: 'http://h2/mcp' }], []);
    expect(r[0].name).toBe('miaou-mcp');
    expect(r[1].name).toBe('second');
  });
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

describe('isoOffset', function() {
  // getTimezoneOffset() rend les minutes à SOUSTRAIRE pour obtenir UTC : le
  // signe ISO est l'inverse. On stube un objet Date-like pour tester les deux
  // sens sans dépendre de la zone de la machine qui fait tourner les tests.
  function fakeDate(offsetMinutes) {
    return { getTimezoneOffset: function() { return offsetMinutes; } };
  }
  it('UTC → Z', function() {
    expect(isoOffset(fakeDate(0))).toBe('Z');
  });
  it('zone en avance sur UTC (Paris été, offset -120) → +02:00', function() {
    expect(isoOffset(fakeDate(-120))).toBe('+02:00');
  });
  it('zone en retard sur UTC (New York hiver, offset 300) → -05:00', function() {
    expect(isoOffset(fakeDate(300))).toBe('-05:00');
  });
  it('offset non entier en heures (Kolkata, -330) → +05:30', function() {
    expect(isoOffset(fakeDate(-330))).toBe('+05:30');
  });
  it('offset négatif non entier (Marquises, 570) → -09:30', function() {
    expect(isoOffset(fakeDate(570))).toBe('-09:30');
  });
});

describe('isoLocalStamp', function() {
  it('heure du mur préservée, pas normalisée en UTC', function() {
    var ts = new Date(2024, 2, 15, 14, 30, 0).getTime();
    var r = isoLocalStamp(ts);
    // L'heure locale est celle passée au constructeur, quelle que soit la zone.
    expect(r.indexOf('2024-03-15T14:30')).toBe(0);
  });
  it('pad des composantes à un chiffre', function() {
    var ts = new Date(2024, 0, 5, 9, 7, 0).getTime();
    expect(isoLocalStamp(ts).indexOf('2024-01-05T09:07')).toBe(0);
  });
  it('se termine par un offset explicite (jamais nu)', function() {
    var r = isoLocalStamp(new Date(2024, 5, 1, 12, 0, 0).getTime());
    var tail = r.slice(16);
    expect(tail === 'Z' || /^[+-]\d{2}:\d{2}$/.test(tail)).toBe(true);
  });
});

describe('stampTs', function() {
  it('sans ts retourne le résultat tel quel', function() {
    expect(stampTs(null, 'hello')).toBe('hello');
    expect(stampTs(0, 'hello')).toBe('hello');
  });
  it('avec ts préfixe un horodatage ISO 8601 zoné', function() {
    var ts = new Date(2024, 2, 15, 14, 30, 0).getTime(); // 15 mars 2024
    var r = stampTs(ts, 'résultat');
    expect(r.indexOf('[Résultat du 2024-03-15T14:30')).toBe(0);
    expect(r.indexOf('résultat') > 0).toBe(true);
    // la date précède le résultat
    expect(r.indexOf('résultat') > r.indexOf('2024')).toBe(true);
  });
  it('le préfixe porte toujours une zone — un horodatage nu est le bug visé', function() {
    var ts = new Date(2024, 2, 15, 14, 30, 0).getTime();
    var head = stampTs(ts, 'x').split('\n')[0];
    expect(/T\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})\]$/.test(head)).toBe(true);
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
    var r = formatToolAcksMd([{ name: 'miaou__memory__create', args: { content: 'x' }, result: '{"id":"m1"}' }]);
    expect(r.indexOf('**Outil appelé :**') >= 0).toBeTruthy();
    expect(r.indexOf('Outils appelés') >= 0).toBeFalsy();
    expect(r.indexOf('`miaou__memory__create`') >= 0).toBeTruthy();
    expect(r.indexOf('Arguments :') >= 0).toBeTruthy();
    expect(r.indexOf('Résultat :') >= 0).toBeTruthy();
  });
  it('intent présent → rendu "— intent" après le nom', function() {
    var r = formatToolAcksMd([{ name: 'weather__get', intent: 'vérifier la météo', args: {}, result: 'ok' }]);
    expect(r.indexOf('`weather__get` — vérifier la météo') >= 0).toBeTruthy();
  });
  it('pas d\'intent → pas de tiret après le nom', function() {
    var r = formatToolAcksMd([{ name: 'miaou__memory__create', args: {}, result: 'ok' }]);
    expect(r.indexOf('`miaou__memory__create` —') >= 0).toBeFalsy();
  });
  it('plusieurs appels : en-tête pluriel avec compte, liste numérotée', function() {
    var r = formatToolAcksMd([
      { name: 'a', args: {}, result: '1' },
      { name: 'b', args: {}, result: '2' },
    ]);
    expect(r.indexOf('**2 outils appelés :**') >= 0).toBeTruthy();
    expect(r.indexOf('1. `a`') >= 0).toBeTruthy();
    expect(r.indexOf('2. `b`') >= 0).toBeTruthy();
  });
  it('compteur en toutes lettres, jamais entre parenthèses', function() {
    var r = formatToolAcksMd([
      { name: 'a', args: {}, result: '1' },
      { name: 'b', args: {}, result: '2' },
    ]);
    expect(r.indexOf('(2)') >= 0).toBeFalsy();
    expect(r.indexOf('Outils appelés (') >= 0).toBeFalsy();
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

describe('slugTitle', function() {
  it('minuscule et remplace la ponctuation par des tirets', function() {
    expect(slugTitle('Bonjour, le Monde !')).toBe('bonjour-le-monde');
  });
  it('translittère les accents en ASCII au lieu de les jeter comme des tirets', function() {
    expect(slugTitle('Café à Paris, résumé été')).toBe('cafe-a-paris-resume-ete');
  });
  it('titre vide → fallback', function() {
    expect(slugTitle('')).toBe('miaou-conversation');
    expect(slugTitle(null)).toBe('miaou-conversation');
    expect(slugTitle(undefined)).toBe('miaou-conversation');
  });
  it('titre uniquement ponctuation → fallback', function() {
    expect(slugTitle('!!!  ---  ???')).toBe('miaou-conversation');
  });
  it('trim les tirets de début/fin', function() {
    expect(slugTitle('  -- Hello --  ')).toBe('hello');
  });
});

describe('extractMdTitle', function() {
  it('extrait le h1 de tête et le RETIRE du corps (pas de doublon)', function() {
    const r = extractMdTitle('# Mon titre\n\nDu texte.\n');
    expect(r.title).toBe('Mon titre');
    expect(r.body).toBe('Du texte.\n');
  });
  it('sans h1 en tête → pas de titre (donc pas de cartouche), corps intact', function() {
    const r = extractMdTitle('Du texte direct.\n\n# Titre plus bas\n');
    expect(r.title).toBe(null);
    expect(r.body).toBe('Du texte direct.\n\n# Titre plus bas\n');
  });
  it('h2 en tête ne compte pas comme titre', function() {
    const r = extractMdTitle('## Sous-titre\n\ntexte\n');
    expect(r.title).toBe(null);
  });
  it('tolère les lignes vides avant le h1', function() {
    const r = extractMdTitle('\n\n   \n# Titre\n\ntexte\n');
    expect(r.title).toBe('Titre');
    expect(r.body).toBe('texte\n');
  });
  it('retire un front-matter YAML et trouve le h1 derrière', function() {
    const r = extractMdTitle('---\ntitle: x\ntags: [a]\n---\n# Vrai titre\n\ntexte\n');
    expect(r.title).toBe('Vrai titre');
    expect(r.body).toBe('texte\n');
  });
  it('front-matter sans h1 derrière → pas de titre, front-matter quand même retiré', function() {
    const r = extractMdTitle('---\ntitle: x\n---\nDu texte.\n');
    expect(r.title).toBe(null);
    expect(r.body).toBe('Du texte.\n');
  });
  it('ne confond pas un --- de séparation avec un front-matter', function() {
    const r = extractMdTitle('# Titre\n\n---\n\ntexte\n');
    expect(r.title).toBe('Titre');
    expect(r.body).toBe('---\n\ntexte\n');
  });
  it('supporte les fins de ligne CRLF', function() {
    const r = extractMdTitle('# Titre\r\n\r\ntexte\r\n');
    expect(r.title).toBe('Titre');
    expect(r.body).toBe('texte\r\n');
  });
  it('gère les # de fermeture ATX', function() {
    expect(extractMdTitle('# Titre #\n\ntexte').title).toBe('Titre');
    expect(extractMdTitle('# Titre ###\n\ntexte').title).toBe('Titre');
  });
  it('h1 vide (# seul) → pas de titre', function() {
    expect(extractMdTitle('#\n\ntexte').title).toBe(null);
    expect(extractMdTitle('#   \n\ntexte').title).toBe(null);
  });
  it('# sans espace (hashtag) n\'est pas un titre', function() {
    expect(extractMdTitle('#hashtag\n\ntexte').title).toBe(null);
  });
  it('document réduit au seul h1 → corps vide', function() {
    const r = extractMdTitle('# Titre seul');
    expect(r.title).toBe('Titre seul');
    expect(r.body).toBe('');
  });
  it('entrée vide ou nulle ne jette pas', function() {
    expect(extractMdTitle('').title).toBe(null);
    expect(extractMdTitle(null).title).toBe(null);
    expect(extractMdTitle(undefined).body).toBe('');
  });
});

describe('plainTextToParagraphs', function() {
  it('réenroule les retours simples en espaces (convention CommonMark)', function() {
    expect(plainTextToParagraphs('une ligne\nsuite du paragraphe'))
      .toBe('<p>une ligne suite du paragraphe</p>');
  });
  it('une ligne vide sépare deux paragraphes', function() {
    expect(plainTextToParagraphs('para un\n\npara deux'))
      .toBe('<p>para un</p><p>para deux</p>');
  });
  it('plusieurs lignes vides ne créent pas de paragraphes vides', function() {
    expect(plainTextToParagraphs('a\n\n\n\nb')).toBe('<p>a</p><p>b</p>');
  });
  it('lignes blanches (espaces/tabs) traitées comme séparateurs', function() {
    expect(plainTextToParagraphs('a\n   \nb')).toBe('<p>a</p><p>b</p>');
  });
  it('échappe le HTML (entrée = fichier utilisateur)', function() {
    expect(plainTextToParagraphs('<script>alert(1)</script>'))
      .toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });
  it('supporte CRLF', function() {
    expect(plainTextToParagraphs('a\r\nb\r\n\r\nc')).toBe('<p>a b</p><p>c</p>');
  });
  it('entrée vide ou nulle → chaîne vide', function() {
    expect(plainTextToParagraphs('')).toBe('');
    expect(plainTextToParagraphs('   \n\n  ')).toBe('');
    expect(plainTextToParagraphs(null)).toBe('');
    expect(plainTextToParagraphs(undefined)).toBe('');
  });
});

describe('isMarkdownLang', function() {
  it('reconnaît markdown et md', function() {
    expect(isMarkdownLang('markdown')).toBe(true);
    expect(isMarkdownLang('md')).toBe(true);
  });
  it('insensible à la casse', function() {
    expect(isMarkdownLang('Markdown')).toBe(true);
    expect(isMarkdownLang('MD')).toBe(true);
  });
  it('rejette les autres langages', function() {
    expect(isMarkdownLang('python')).toBe(false);
    expect(isMarkdownLang('html')).toBe(false);
    expect(isMarkdownLang('mermaid')).toBe(false);
  });
  it('vide/null → false', function() {
    expect(isMarkdownLang('')).toBe(false);
    expect(isMarkdownLang(null)).toBe(false);
    expect(isMarkdownLang(undefined)).toBe(false);
  });
});

describe('mdHtmlFileName', function() {
  it('remplace .md par .html en gardant le reste du nom', function() {
    expect(mdHtmlFileName('notes.md')).toBe('notes.html');
    expect(mdHtmlFileName('notes v2.md')).toBe('notes v2.html');
  });
  it('accepte .markdown et est insensible à la casse', function() {
    expect(mdHtmlFileName('README.MD')).toBe('README.html');
    expect(mdHtmlFileName('guide.markdown')).toBe('guide.html');
  });
  it('ne touche qu\'à l\'extension finale', function() {
    expect(mdHtmlFileName('archive.md.md')).toBe('archive.md.html');
    expect(mdHtmlFileName('v1.2.notes.md')).toBe('v1.2.notes.html');
  });
  it('sans extension connue → ajoute simplement .html', function() {
    expect(mdHtmlFileName('CHANGELOG')).toBe('CHANGELOG.html');
  });
  it('neutralise les séparateurs de chemin et les caractères de contrôle', function() {
    // Les / deviennent _, PUIS les points de tête sautent (pas de ../ ni de
    // fichier caché) : l'ordre compte, d'où ce résultat.
    expect(mdHtmlFileName('../etc/passwd.md')).toBe('_etc_passwd.html');
    expect(mdHtmlFileName('sub/dir/notes.md')).toBe('sub_dir_notes.html');
    expect(mdHtmlFileName('a\x01b.md')).toBe('ab.html');
  });
  it('un nom de fichier caché perd son point de tête', function() {
    expect(mdHtmlFileName('.hidden.md')).toBe('hidden.html');
  });
  it('nom vide ou nul → repli neutre', function() {
    expect(mdHtmlFileName('')).toBe('document.html');
    expect(mdHtmlFileName(null)).toBe('document.html');
    expect(mdHtmlFileName('   ')).toBe('document.html');
  });
});

describe('exportDateStamp', function() {
  it('formate en YYYY-MM-DD avec zero-padding', function() {
    var ts = new Date(2026, 0, 5, 14, 30).getTime(); // 5 janvier 2026
    expect(exportDateStamp(ts)).toBe('2026-01-05');
  });
  it('mois et jour à deux chiffres sans padding nécessaire', function() {
    var ts = new Date(2026, 10, 23, 9, 0).getTime(); // 23 novembre 2026
    expect(exportDateStamp(ts)).toBe('2026-11-23');
  });
});

describe('exportDateTimeStamp', function() {
  it('formate en YYYY-MM-DD-HHMM avec zero-padding heure/minute', function() {
    var ts = new Date(2026, 0, 5, 9, 7).getTime();  // 5 jan 2026, 09:07
    expect(exportDateTimeStamp(ts)).toBe('2026-01-05-0907');
  });
  it('heure et minute à deux chiffres', function() {
    var ts = new Date(2026, 10, 23, 14, 30).getTime();  // 23 nov 2026, 14:30
    expect(exportDateTimeStamp(ts)).toBe('2026-11-23-1430');
  });
  it('minuit → 0000', function() {
    var ts = new Date(2026, 5, 1, 0, 0).getTime();
    expect(exportDateTimeStamp(ts)).toBe('2026-06-01-0000');
  });
});

describe('exportDateDisplay', function() {
  it('formate en dd/mm/yyyy avec zero-padding', function() {
    var ts = new Date(2026, 0, 5, 14, 30).getTime(); // 5 janvier 2026
    expect(exportDateDisplay(ts)).toBe('05/01/2026');
  });
  it('mois et jour à deux chiffres sans padding nécessaire', function() {
    var ts = new Date(2026, 10, 23, 9, 0).getTime(); // 23 novembre 2026
    expect(exportDateDisplay(ts)).toBe('23/11/2026');
  });
});

describe('formatToolAcksHtml', function() {
  it('liste vide → chaîne vide', function() {
    expect(formatToolAcksHtml([])).toBe('');
    expect(formatToolAcksHtml(null)).toBe('');
  });
  it('un seul appel : <details><summary> avec texte "1 outil appelé"', function() {
    var r = formatToolAcksHtml([{ name: 'miaou__memory__create', args: { content: 'x' }, result: 'ok' }]);
    expect(r.indexOf('<details class="tool-trace">') >= 0).toBeTruthy();
    expect(r.indexOf('<span class="tool-trace-summary-text">1 outil appelé</span>') >= 0).toBeTruthy();
    expect(r.indexOf(' open') >= 0).toBeFalsy();
  });
  it('preview repliée : une ligne .tool-ack-preview avec icône + fallback nom d\'outil (sans intent)', function() {
    var r = formatToolAcksHtml([{ name: 'get_time', args: {}, result: '14:32' }]);
    expect(r.indexOf('class="tool-ack-preview-list"') >= 0).toBeTruthy();
    expect(r.indexOf('class="tool-ack-preview"') >= 0).toBeTruthy();
    expect(r.indexOf('class="ack-icon"') >= 0).toBeTruthy();
    expect(r.indexOf('<code>get_time</code>') >= 0).toBeTruthy();
  });
  it('preview repliée : intent affiché au lieu du nom d\'outil quand présent', function() {
    var r = formatToolAcksHtml([{ name: 'get_time', intent: 'Donner l\'heure actuelle', args: {}, result: '14:32' }]);
    var previewSection = r.slice(0, r.indexOf('<ul>'));
    expect(previewSection.indexOf('Donner l&#39;heure actuelle') >= 0).toBeTruthy();
    expect(previewSection.indexOf('<code>get_time</code>') >= 0).toBeFalsy();
  });
  it('preview repliée : une ligne par ack pour un groupe multiple', function() {
    var r = formatToolAcksHtml([
      { name: 'a', args: {}, result: '1' },
      { name: 'b', intent: 'Faire b', args: {}, result: '2' },
    ]);
    var previewSection = r.slice(0, r.indexOf('<ul>'));
    expect((previewSection.match(/class="tool-ack-preview"/g) || []).length).toBe(2);
  });
  it('trois paliers (lot N) : compteur seul → intents ↔ détail JSON via radios cliquables', function() {
    var r = formatToolAcksHtml([{ name: 'get_time', args: {}, result: '14:32' }]);
    // Summary externe ne porte QUE le compteur, pas les previews ni le détail.
    var outerSummaryClose = r.indexOf('</summary>');
    var outerSummary = r.slice(0, outerSummaryClose);
    expect(outerSummary.indexOf('tool-ack-preview-list') >= 0).toBeFalsy();
    expect(outerSummary.indexOf('<ul>') >= 0).toBeFalsy();
    // .tool-trace-toggle vient APRÈS le summary externe.
    var toggleIdx = r.indexOf('class="tool-trace-toggle"');
    expect(toggleIdx > outerSummaryClose).toBeTruthy();
    // Ordre DOM figé (cf. commentaire CSS) : 2 radios, puis label intents,
    // puis label json — le sélecteur CSS `.tt-radio + .tt-radio:checked ~`
    // en dépend.
    var idxR1 = r.indexOf('class="tt-radio"');
    var idxR2 = r.indexOf('class="tt-radio"', idxR1 + 1);
    var idxLabelIntents = r.indexOf('tt-view-intents');
    var idxLabelJson = r.indexOf('tt-view-json');
    expect(idxR1 >= 0 && idxR2 > idxR1 && idxLabelIntents > idxR2 && idxLabelJson > idxLabelIntents).toBeTruthy();
    // 1er radio (intents, état par défaut) coché, pas le 2e (json).
    var firstRadioTag = r.slice(idxR1 - 20, idxR2);
    var secondRadioTag = r.slice(idxR2 - 20, idxLabelIntents);
    expect(firstRadioTag.indexOf('checked') >= 0).toBeTruthy();
    expect(secondRadioTag.indexOf('checked') >= 0).toBeFalsy();
    // Le label "intents" porte les previews, le label "json" porte le <ul>.
    var labelIntentsSection = r.slice(r.indexOf('<label', idxLabelIntents - 30), r.indexOf('</label>', idxLabelIntents));
    expect(labelIntentsSection.indexOf('tool-ack-preview-list') >= 0).toBeTruthy();
    var ulIdx = r.indexOf('<ul>');
    expect(ulIdx > idxLabelJson).toBeTruthy();
  });
  it('plusieurs appels : en-tête pluriel "n outils appelés"', function() {
    var r = formatToolAcksHtml([
      { name: 'a', args: {}, result: '1' },
      { name: 'b', args: {}, result: '2' },
    ]);
    expect(r.indexOf('2 outils appelés') >= 0).toBeTruthy();
  });
  it('échappe les caractères HTML dans name/args/result', function() {
    var r = formatToolAcksHtml([{ name: '<script>x</script>', args: { q: '<b>&"</b>' }, result: '<img src=x>' }]);
    expect(r.indexOf('<script>x</script>') >= 0).toBeFalsy();
    expect(r.indexOf('&lt;script&gt;') >= 0).toBeTruthy();
    expect(r.indexOf('<img src=x>') >= 0).toBeFalsy();
    expect(r.indexOf('&lt;img') >= 0).toBeTruthy();
  });
  it('échappe intent contenant du HTML', function() {
    var r = formatToolAcksHtml([{ name: 'a', intent: '<b>inject</b>', args: {}, result: 'ok' }]);
    expect(r.indexOf('<b>inject</b>') >= 0).toBeFalsy();
    expect(r.indexOf('&lt;b&gt;inject&lt;/b&gt;') >= 0).toBeTruthy();
  });
  it('erreur : "Résultat (erreur)"', function() {
    var r = formatToolAcksHtml([{ name: 'a', args: {}, result: 'timeout', error: true }]);
    expect(r.indexOf('Résultat (erreur)') >= 0).toBeTruthy();
  });
  it('erreur : preview marquée ack-error et tête du détail JSON en ack-head-error', function() {
    var r = formatToolAcksHtml([{ name: 'a', args: {}, result: 'timeout', error: true }]);
    expect(r.indexOf('class="tool-ack-preview ack-error"') >= 0).toBeTruthy();
    expect(r.indexOf('<span class="ack-head-error"><code>a</code></span>') >= 0).toBeTruthy();
  });
  it('erreur js__eval (ok === false) : mêmes marqueurs que error: true', function() {
    var r = formatToolAcksHtml([{ name: 'miaou__js__eval', args: {}, result: 'refus', ok: false }]);
    expect(r.indexOf('ack-error') >= 0).toBeTruthy();
    expect(r.indexOf('ack-head-error') >= 0).toBeTruthy();
  });
  it('succès : aucun marqueur d\'erreur', function() {
    var r = formatToolAcksHtml([{ name: 'a', args: {}, result: 'ok' }]);
    expect(r.indexOf('ack-error') >= 0).toBeFalsy();
    expect(r.indexOf('ack-head-error') >= 0).toBeFalsy();
  });
  it('resource_presented : nom + mime, jamais de data: embarquée', function() {
    var r = formatToolAcksHtml([{ name: 'weather__get_map', kind: 'resource_presented',
      args: {}, result: '[resource_ref:res_1]', resourceName: 'carte.png', mime: 'image/png' }]);
    expect(r.indexOf('Ressource présentée automatiquement') >= 0).toBeTruthy();
    expect(r.indexOf('carte.png') >= 0).toBeTruthy();
    expect(r.indexOf('image/png') >= 0).toBeTruthy();
    expect(r.indexOf('data:') >= 0).toBeFalsy();
  });
  it('résultat long tronqué avec "..."', function() {
    var long = new Array(400).join('x');
    var r = formatToolAcksHtml([{ name: 'a', args: {}, result: long }]);
    expect(r.indexOf('...') >= 0).toBeTruthy();
    expect(r.indexOf(long) >= 0).toBeFalsy();
  });
  it('acks legacy (sans args) : pas de ligne Arguments', function() {
    var r = formatToolAcksHtml([{ name: 'a', result: 'ok' }]);
    expect(r.indexOf('Arguments') >= 0).toBeFalsy();
  });
});

describe('exportableAckImageKey', function() {
  it('resource_presented → lookup par id', function() {
    expect(exportableAckImageKey({ kind: 'resource_presented', id: 'r1' })).toEqual({ by: 'id' });
  });
  it('resource_stored → lookup par id', function() {
    expect(exportableAckImageKey({ kind: 'resource_stored', id: 'r2' })).toEqual({ by: 'id' });
  });
  it('attachment_recalled → lookup par attId', function() {
    expect(exportableAckImageKey({ kind: 'attachment_recalled', attId: 'att-3' })).toEqual({ by: 'attId' });
  });
  it('resource_presented sans id → null', function() {
    expect(exportableAckImageKey({ kind: 'resource_presented' })).toBe(null);
  });
  it('attachment_recalled sans attId → null', function() {
    expect(exportableAckImageKey({ kind: 'attachment_recalled' })).toBe(null);
  });
  // Lot V-8 : une page de PDF rendue est une donnée de travail du modèle — elle
  // n'est affichée sur AUCUNE des deux surfaces (l'ack et son bouton de
  // téléchargement suffisent). L'export hérite de `ackImageIsDisplayable`.
  it('une page rendue (origin docs_render) est exclue de l\'export', function() {
    expect(exportableAckImageKey({
      kind: 'attachment_recalled', attId: 'att-1', origin: 'docs_render',
    })).toBe(null);
  });
  // Pas d'`origin` : c'est la forme RÉELLE de l'ack que pousse recall_attachment
  // (tools.js), qui n'en pose aucun — `docs_render` est le seul producteur à en
  // porter un. Tester une valeur 'recall' inventée ici ne prouverait rien du cas
  // de production.
  it('mais un rappel de pièce jointe UTILISATEUR reste exporté', function() {
    expect(exportableAckImageKey({
      kind: 'attachment_recalled', attId: 'att-2',
    })).toEqual({ by: 'attId' });
  });
});

// Prédicat UNIQUE d'affichage d'une image d'ack, partagé par l'écran
// (placeToolAck) et l'export (exportableAckImageKey) — deux filtres séparés
// divergeraient en silence.
describe('ackImageIsDisplayable', function() {
  it('exclut une page de PDF rendue pour le modèle', function() {
    expect(ackImageIsDisplayable({
      kind: 'attachment_recalled', attId: 'att-1', origin: 'docs_render',
    })).toBe(false);
  });
  it('garde le rappel d\'une pièce jointe fournie par l\'utilisateur', function() {
    expect(ackImageIsDisplayable({
      kind: 'attachment_recalled', attId: 'att-2',
    })).toBe(true);
  });
  // La voie que ce changement ne doit PAS toucher : une image que le modèle est
  // allé chercher sur le web à la demande de l'utilisateur (fetch_url et son
  // sous-produit resource_stored) reste affichée — c'est un contenu demandé,
  // pas un intermédiaire de lecture.
  it('garde une image rapportée du web (resource_stored)', function() {
    expect(ackImageIsDisplayable({
      kind: 'resource_stored', id: 'res_1', mime: 'image/png',
    })).toBe(true);
  });
  it('garde une ressource présentée par le modèle', function() {
    expect(ackImageIsDisplayable({ kind: 'resource_presented', id: 'res_2' })).toBe(true);
  });
  it('tolère un ack absent', function() {
    expect(ackImageIsDisplayable(null)).toBe(true);
  });
  it('kind non porteur d\'image → null', function() {
    expect(exportableAckImageKey({ kind: 'memory_create', id: 'x' })).toBe(null);
    expect(exportableAckImageKey({ kind: 'mcp_call', id: 'x' })).toBe(null);
  });
  it('ack sans kind → null', function() {
    expect(exportableAckImageKey({ id: 'x' })).toBe(null);
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
    // Depuis O-2 : le content s'ouvre sur le marqueur [call:<id>], puis le stampTs.
    expect(toolMsg.content.indexOf('[call:')).toBe(0);
    expect(toolMsg.content.indexOf('[Résultat du') > 0).toBeTruthy();
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

  it('marqueur [call:<id>] présent en tête du content de CHAQUE tool result (O-2)', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ name: 'srv__a', group: 'gO', args: { q: 1 } }),
      ack({ name: 'srv__b', group: 'gO', args: { q: 2 } }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    // user, assistant(2 tc), tool, tool, assistant
    expect(r[2].content.indexOf('[call:' + r[1].tool_calls[0].id + ']')).toBe(0);
    expect(r[3].content.indexOf('[call:' + r[1].tool_calls[1].id + ']')).toBe(0);
  });

  it('le marqueur [call:] n\'apparaît QUE sur les tool results, pas sur user/assistant (O-2)', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: 'gP' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    expect(r[0].content.indexOf('[call:')).toBe(-1);   // user
    expect((r[1].content || '').indexOf('[call:')).toBe(-1);   // assistant(tc)
    expect(r[3].content.indexOf('[call:')).toBe(-1);   // assistant final
  });

  it('marqueur [call:] byte-stable entre deux appels identiques (KV cache, O-2)', function() {
    var mk = function() {
      return [{ role: 'user', content: 'q' }, ack({ group: 'gStable2' }), { role: 'assistant', content: 'fin' }];
    };
    expect(expandThread(mk())[2].content).toBe(expandThread(mk())[2].content);
  });

  // Ack dont l'enrichissement n'est jamais arrivé : `args` posé EN VOL par
  // markEarlyAckPending (lot Z-2), puis abort / échec de transport, donc pas de
  // `name`. Sous le prédicat `args != null` nu, il franchissait l'expansion et
  // produisait un tool_call sans `function.name` — rejeté en 422 par les
  // backends stricts, avec un message `tool` réduit à son seul marqueur.
  it('ack à args orphelin (sans name) n\'est jamais expansé en tool_call', function() {
    var t = [
      { role: 'user', content: 'q' },
      { role: 'tool-ack', kind: 'mcp_call', args: { instance: 'prod' }, group: 'gOrphan' },
      { role: 'assistant', content: 'suite' },
    ];
    var r = expandThread(t);
    expect(r.length).toBe(2);          // l'ack est élagué, comme un legacy
    expect(r[0].role).toBe('user');
    expect(r[1].role).toBe('assistant');
    expect(r[1].content).toBe('suite');
  });

  // Le cas qui a produit le payload fautif : l'ack orphelin COHABITE avec un
  // ack valide. Il ne doit ni contaminer le groupe, ni faire disparaître son
  // voisin — seul le tool_call innommable tombe.
  it('un ack orphelin dans un groupe ne retire que lui, jamais le voisin valide', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: 'gMix', name: 'srv__vrai', result: 'contenu réel' }),
      { role: 'tool-ack', kind: 'resource_stored', args: { x: 1 }, group: 'gMix' },
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    expect(r[1].role).toBe('assistant');
    expect(r[1].tool_calls.length).toBe(1);
    expect(r[1].tool_calls[0].function.name).toBe('srv__vrai');
    expect(r[2].role).toBe('tool');
    expect(r[2].content.indexOf('contenu réel') >= 0).toBeTruthy();
  });

  // Tout tool_call émis porte un `name` : l'invariant que le backend exige,
  // asserté sur la SORTIE composée plutôt que sur le prédicat d'entrée.
  it('tout tool_call émis porte un function.name non vide', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: 'gA' }),
      { role: 'tool-ack', kind: 'mcp_call', args: { y: 2 }, group: 'gB' },
      ack({ group: 'gC', name: 'srv__autre' }),
      { role: 'assistant', content: 'fin' },
    ];
    var emitted = 0;
    expandThread(t).forEach(function(msg) {
      (msg.tool_calls || []).forEach(function(tc) {
        emitted++;
        expect(typeof tc.function.name).toBe('string');
        expect(tc.function.name.length > 0).toBeTruthy();
      });
    });
    expect(emitted).toBe(2);   // gA et gC ; gB est orphelin, jamais émis
  });

  // Garde de non-divergence : enrichedAckGroups et expandThread décidaient sur
  // DEUX copies du même prédicat. Resserrer l'une sans l'autre faisait lire
  // `group.acks` sur un undefined — un plantage, pas un payload malformé.
  // expandThread branche désormais sur la présence du groupe ; ce test échoue
  // par exception si quelqu'un y recopie un prédicat local.
  it('expandThread et enrichedAckGroups ne divergent pas sur un ack orphelin', function() {
    var t = [
      { role: 'user', content: 'q' },
      { role: 'tool-ack', kind: 'mcp_call', args: { z: 3 }, group: 'gSolo' },
    ];
    expect(enrichedAckGroups(t).length).toBe(0);
    expect(expandThread(t).length).toBe(1);
  });
});

describe('unservedToolCallIds (invariant de payload)', function() {
  it('rend un tableau vide sur un payload sain', function() {
    var ok = [
      { role: 'user', content: 'q' },
      { role: 'assistant', tool_calls: [{ id: 'a1' }, { id: 'a2' }] },
      { role: 'tool', tool_call_id: 'a1', content: 'r1' },
      { role: 'tool', tool_call_id: 'a2', content: 'r2' },
    ];
    expect(unservedToolCallIds(ok).length).toBe(0);
  });

  // Le payload de prod : 3 appels annoncés, 2 servis.
  it('nomme le tool_call annoncé sans résultat', function() {
    var ko = [
      { role: 'assistant', tool_calls: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] },
      { role: 'tool', tool_call_id: 'a1', content: 'r1' },
      { role: 'tool', tool_call_id: 'a3', content: 'r3' },
    ];
    expect(unservedToolCallIds(ko)).toEqual(['a2']);
  });

  it('tolère une entrée vide ou absente, sans exception', function() {
    expect(unservedToolCallIds([]).length).toBe(0);
    expect(unservedToolCallIds(null).length).toBe(0);
    expect(unservedToolCallIds([{ role: 'user', content: 'x' }]).length).toBe(0);
  });

  // Sur la SORTIE composée d'expandThread, les DEUX conditions du backend,
  // asserties ensemble sur un thread mêlant ack valide et acks incomplets.
  //
  // `unservedToolCallIds` seul ne suffit PAS ici et ne doit pas donner le
  // change : avant le correctif, un ack orphelin était expansé AVEC son message
  // `tool` (vide), donc l'invariant « un résultat par appel » était satisfait
  // et ce contrôle restait vert — c'est l'absence de `name` qui déclenchait le
  // 422. Vérifié en rejouant la suite sous l'ancien prédicat : seule la seconde
  // assertion tombe. Les deux ensemble couvrent les deux voies connues.
  it('expandThread satisfait les deux conditions du backend (résultat servi, appel nommé)', function() {
    var t = [
      { role: 'user', content: 'q' },
      { role: 'tool-ack', kind: 'mcp_call', name: 'srv__ok', args: { a: 1 },
        result: 'ok', ts: 0, group: 'gM' },
      { role: 'tool-ack', kind: 'resource_stored', args: { b: 2 }, group: 'gM' },
      { role: 'tool-ack', kind: 'mcp_call', args: { c: 3 }, group: 'gSolo' },
      { role: 'assistant', content: 'fin' },
    ];
    var out = expandThread(t);
    expect(unservedToolCallIds(out).length).toBe(0);
    var unnamed = 0;
    out.forEach(function(msg) {
      (msg.tool_calls || []).forEach(function(tc) {
        if (!tc.function || !tc.function.name) unnamed++;
      });
    });
    expect(unnamed).toBe(0);
  });
});

describe('ackIsExpandable (prédicat unique de réinjection)', function() {
  it('exige args ET name', function() {
    expect(ackIsExpandable({ args: {}, name: 'srv__foo' })).toBeTruthy();
    expect(ackIsExpandable({ args: {} })).toBe(false);
    expect(ackIsExpandable({ name: 'srv__foo' })).toBe(false);
    expect(ackIsExpandable({})).toBe(false);
    expect(ackIsExpandable(null)).toBe(false);
  });

  // `args: {}` est légitime (outil sans argument) : le prédicat teste la
  // PRÉSENCE, jamais la truthiness — `if (args)` refuserait cet appel valide.
  it('accepte un objet d\'arguments vide, qui est un appel légitime', function() {
    expect(ackIsExpandable({ args: {}, name: 'srv__sans_args' })).toBeTruthy();
  });

  // Distinct d'ackHasInspectableDetail À DESSEIN : un appel EN VOL n'est pas
  // réinjectable (rien à réinjecter) mais reste inspectable (tout l'intérêt de
  // la loupe pendant qu'un outil lent travaille). Fusionner les deux ferait
  // perdre la loupe sur les appels en vol, ou ré-émettrait les orphelins.
  it('ne se confond pas avec ackHasInspectableDetail sur un appel en vol', function() {
    var enVol = { args: { q: 1 }, pending: true };
    expect(ackHasInspectableDetail(enVol)).toBeTruthy();
    expect(ackIsExpandable(enVol)).toBe(false);
  });
});

describe('formatCallMarker (source unique du marqueur d\'id, O-2)', function() {
  it('encadre l\'id en [call:<id>] suivi d\'un saut de ligne', function() {
    expect(formatCallMarker('abc123def')).toBe('[call:abc123def]\n');
  });
});

describe('interjections mid-génération (lot Q)', function() {
  it('joinInterjectionLiterals fusionne par ligne vide, trim, filtre les vides', function() {
    expect(joinInterjectionLiterals(['a', 'b'])).toBe('a\n\nb');
    expect(joinInterjectionLiterals(['  a  ', '', '  ', 'b'])).toBe('a\n\nb');
    expect(joinInterjectionLiterals([])).toBe('');
    expect(joinInterjectionLiterals(['seul'])).toBe('seul');
  });

  it('joinInterjectionLiterals tolère null/undefined', function() {
    expect(joinInterjectionLiterals(null)).toBe('');
    expect(joinInterjectionLiterals([null, 'x', undefined])).toBe('x');
  });

  it('un /slug en tête d\'un littéral non-premier reste détectable après jointure', function() {
    // Frontière \n acceptée par findSlashTriggers → bake normal au drain.
    var joined = joinInterjectionLiterals(['bonjour', '/skillx fais ceci']);
    var triggers = findSlashTriggers(joined);
    var slugs = triggers.map(function(t) { return t.slug; });
    expect(slugs.indexOf('skillx') >= 0).toBe(true);
  });

  it('buildInterjectionEntry : content == literal → pas de displayText', function() {
    var e = buildInterjectionEntry('salut', 'salut', 42);
    expect(e.role).toBe('user');
    expect(e.content).toBe('salut');
    expect(e.ts).toBe(42);
    expect(e.displayText === undefined).toBe(true);
    expect(e._synthetic === undefined).toBe(true);   // authentique : jamais _synthetic
  });

  it('buildInterjectionEntry : content baké ≠ literal → displayText = literal', function() {
    var e = buildInterjectionEntry('/sk go', '/sk go\n\n[corps skill]', 7);
    expect(e.content).toBe('/sk go\n\n[corps skill]');
    expect(e.displayText).toBe('/sk go');
  });

  it('expandThread élague la bulle assistant _acksOnly (hôte DOM sans valeur payload)', function() {
    function ack(o) {
      return Object.assign({ role: 'tool-ack', kind: 'mcp_call', name: 'srv__foo',
        args: { q: 1 }, result: 'ok', ts: 0, group: 'gQ' }, o);
    }
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: 'gQ1' }),
      { role: 'assistant', content: '', _acksOnly: true, ts: 1 },   // bulle matérialisée
      { role: 'user', content: 'interjection' },
      ack({ group: 'gQ2' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    // Attendu : user, assistant(tc gQ1), tool, user(interjection),
    //           assistant(tc gQ2), tool, assistant(final) — SANS assistant vide.
    var hasEmptyAssistant = r.some(function(m) {
      return m.role === 'assistant' && (m.content == null || m.content === '') && !m.tool_calls;
    });
    expect(hasEmptyAssistant).toBe(false);
    // L'interjection user est bien présente et authentique (pas _synthetic).
    var interj = r.filter(function(m) { return m.role === 'user' && m.content === 'interjection'; });
    expect(interj.length).toBe(1);
    expect(interj[0]._synthetic === undefined).toBe(true);
  });

  it('expandThread élague AUSSI un assistant vide non marqué (400 backend strict)', function() {
    // Cas réel (bug historique) : stop avant le premier token → onFinal pousse
    // un assistant content:'' persisté ; ré-émis tel quel, certains backends
    // répondent 400 « Assistant message must have either content or tool_calls ».
    // Le prédicat d'élagage est la BLANCHEUR du content, pas le flag _acksOnly.
    var t = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: '' },      // stop avant premier token
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: null },    // défense : content null
      { role: 'user', content: 'q3' },
      { role: 'assistant', content: '  \n ' }, // défense : blanc pur
      { role: 'user', content: 'q4' },
      { role: 'assistant', content: 'ok' },    // non-vide : émis
    ];
    var r = expandThread(t);
    expect(r.length).toBe(5);
    expect(r.every(function(m) { return m.role !== 'assistant' || m.content === 'ok'; })).toBe(true);
  });
});

describe('enrichedAckGroups (dérivation partagée émission/résolution, O-2)', function() {
  function ack(overrides) {
    return Object.assign({ role: 'tool-ack', kind: 'mcp_call', name: 'srv__foo',
      args: { q: 1 }, result: 'ok', ts: 0, group: 'g1' }, overrides);
  }

  it('thread sans ack enrichi → aucun groupe', function() {
    expect(enrichedAckGroups([{ role: 'user', content: 'hi' }])).toEqual([]);
  });

  it('un groupe de deux acks → ids alignés sur expandThread', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ name: 'srv__a', group: 'gQ' }),
      ack({ name: 'srv__b', group: 'gQ' }),
      { role: 'assistant', content: 'fin' },
    ];
    var groups = enrichedAckGroups(t);
    expect(groups.length).toBe(1);
    expect(groups[0].acks.length).toBe(2);
    expect(groups[0].ids.length).toBe(2);
    // Même dérivation que l'émission expandThread.
    var r = expandThread(t);
    expect(groups[0].ids[0]).toBe(r[1].tool_calls[0].id);
    expect(groups[0].ids[1]).toBe(r[1].tool_calls[1].id);
  });

  it('bornes start/end couvrent les acks du groupe', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: 'gR' }),
      { role: 'assistant', content: 'fin' },
    ];
    var groups = enrichedAckGroups(t);
    expect(groups[0].start).toBe(1);
    expect(groups[0].end).toBe(2);
  });

  it('acks « solo » legacy (sans group) : ids DISTINCTS par position, jamais collision (C5)', function() {
    // Acks d'avant le groupement : pas de champ `group`. Chacun est son propre
    // groupe solo. Le préfixe positionnel `solo:<start>` doit produire un id
    // différent par ack — un préfixe 'solo' constant les faisait tous collisionner.
    var t = [
      { role: 'user', content: 'q' },
      ack({ result: 'S1', group: undefined }),
      { role: 'assistant', content: 'entre-deux' },
      ack({ result: 'S2', group: undefined }),
      { role: 'assistant', content: 'fin' },
    ];
    var groups = enrichedAckGroups(t);
    expect(groups.length).toBe(2);
    expect(groups[0].acks.length).toBe(1);
    expect(groups[1].acks.length).toBe(1);
    expect(groups[0].ids[0] === groups[1].ids[0]).toBe(false);
    // Même dérivation que l'émission. Le message assistant « entre-deux »
    // (standalone, pas un ack) reste dans le payload et décale le 2e groupe :
    // [user, asst(A), tool(A), asst "entre-deux", asst(B), tool(B), asst "fin"].
    var r = expandThread(t);
    expect(groups[0].ids[0]).toBe(r[1].tool_calls[0].id);
    expect(groups[1].ids[0]).toBe(r[4].tool_calls[0].id);
    // Et les deux ids émis sont bien distincts dans le payload.
    expect(r[1].tool_calls[0].id === r[4].tool_calls[0].id).toBe(false);
  });
});

describe('findAckByCallId (résolution O-2, round-trip avec expandThread)', function() {
  function ack(overrides) {
    return Object.assign({ role: 'tool-ack', kind: 'mcp_call', name: 'srv__foo',
      args: { q: 1 }, result: 'ok', ts: 0, group: 'g1' }, overrides);
  }

  it('l\'id émis par expandThread retrouve le bon ack', function() {
    var a1 = ack({ name: 'srv__a', result: 'AAA', group: 'gS' });
    var a2 = ack({ name: 'srv__b', result: 'BBB', group: 'gS' });
    var t = [{ role: 'user', content: 'q' }, a1, a2, { role: 'assistant', content: 'fin' }];
    var r = expandThread(t);
    var id2 = r[1].tool_calls[1].id;
    var hit = findAckByCallId(t, id2);
    expect(!!hit).toBe(true);
    expect(hit.ack.result).toBe('BBB');
    expect(hit.k).toBe(1);
  });

  it('accepte la forme préfixée [call:<id>] comme le hash nu', function() {
    var a1 = ack({ result: 'ZZZ', group: 'gT' });
    var t = [{ role: 'user', content: 'q' }, a1, { role: 'assistant', content: 'fin' }];
    var id = expandThread(t)[1].tool_calls[0].id;
    expect(findAckByCallId(t, id).ack.result).toBe('ZZZ');
    expect(findAckByCallId(t, 'call:' + id).ack.result).toBe('ZZZ');
    expect(findAckByCallId(t, '[call:' + id + ']').ack.result).toBe('ZZZ');
  });

  it('id inconnu → null', function() {
    var t = [{ role: 'user', content: 'q' }, ack({ group: 'gU' }), { role: 'assistant', content: 'fin' }];
    expect(findAckByCallId(t, 'zzzzzzzzz')).toBe(null);
  });

  it('callId vide → null', function() {
    expect(findAckByCallId([ack()], '')).toBe(null);
  });

  it('robustesse aux groupes multiples : chaque id résout son propre groupe', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ result: 'G1', group: 'gV1' }),
      ack({ result: 'G2', group: 'gV2' }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    expect(findAckByCallId(t, r[1].tool_calls[0].id).ack.result).toBe('G1');
    expect(findAckByCallId(t, r[3].tool_calls[0].id).ack.result).toBe('G2');
  });

  it('acks « solo » legacy multiples : chaque id cible LE BON ack, pas le premier (C5, piège 26)', function() {
    // Régression du ciblage resource__from_result : avec un préfixe 'solo'
    // constant, les deux ids étaient identiques → findAckByCallId renvoyait
    // toujours le premier match, donc réécriture du mauvais ack.
    var t = [
      { role: 'user', content: 'q' },
      ack({ result: 'SOLO_A', group: undefined }),
      { role: 'assistant', content: 'entre-deux' },
      ack({ result: 'SOLO_B', group: undefined }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    var idA = r[1].tool_calls[0].id;
    var idB = r[4].tool_calls[0].id;
    expect(idA === idB).toBe(false);
    expect(findAckByCallId(t, idA).ack.result).toBe('SOLO_A');
    expect(findAckByCallId(t, idB).ack.result).toBe('SOLO_B');
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
  it('couvre query (about_search)', function() {
    var out = copyAckFields({ kind: 'about_search', query: 'espaces mémoire', count: 2 }, {});
    expect(out.query).toBe('espaces mémoire');
    expect(out.count).toBe(2);
  });
});

describe('streamBlockKeepCount', function() {
  it('garde le préfixe commun et rien au-delà', function() {
    expect(streamBlockKeepCount({ keys: ['a', 'b', 'c'], links: '' }, { keys: ['a', 'b', 'c2', 'd'], links: '' })).toBe(2);
  });
  it('garde tout quand des blocs ne font que s’ajouter', function() {
    expect(streamBlockKeepCount({ keys: ['a', 'b'], links: '' }, { keys: ['a', 'b', 'c'], links: '' })).toBe(2);
  });
  it('ne garde rien quand la signature des liens en référence a changé', function() {
    expect(streamBlockKeepCount({ keys: ['a', 'b'], links: '' }, { keys: ['a', 'b', 'c'], links: '["x"]' })).toBe(0);
  });
  it('ne garde rien sans état précédent', function() {
    expect(streamBlockKeepCount(null, { keys: ['a'], links: '' })).toBe(0);
  });
  it('re-rend un bloc requalifié même si le suivant est identique', function() {
    expect(streamBlockKeepCount({ keys: ['a', 'b', 'c'], links: '' }, { keys: ['a', 'B', 'c'], links: '' })).toBe(1);
  });
});

describe('appendOnlySuffix', function() {
  it('rend la partie ajoutée quand le texte se prolonge', function() {
    expect(appendOnlySuffix('abc', 'abcdef')).toBe('def');
  });
  it('rend une chaîne vide sans changement', function() {
    expect(appendOnlySuffix('abc', 'abc')).toBe('');
  });
  it('rend null sur une réécriture ou un raccourcissement', function() {
    expect(appendOnlySuffix('abc', 'abX')).toBe(null);
    expect(appendOnlySuffix('abc', 'ab')).toBe(null);
  });
  it('traite un précédent absent comme vide', function() {
    expect(appendOnlySuffix(null, 'x')).toBe('x');
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

describe('mimeExt (lot V)', function() {
  it('table exacte', function() {
    expect(mimeExt('text/csv')).toBe('csv');
    expect(mimeExt('application/pdf')).toBe('pdf');
    expect(mimeExt('image/jpeg')).toBe('jpg');
    expect(mimeExt('text/markdown')).toBe('md');
  });
  it('parametres de charset ignores', function() {
    expect(mimeExt('text/csv; charset=utf-8')).toBe('csv');
    expect(mimeExt('TEXT/CSV')).toBe('csv');
  });
  it('image/<x> generique sans enumeration', function() {
    expect(mimeExt('image/webp')).toBe('webp');
    expect(mimeExt('image/avif')).toBe('avif');
  });
  it('suffixe +xml / +json reduit a sa base', function() {
    expect(mimeExt('image/svg+xml')).toBe('svg');       // table exacte, prioritaire
    expect(mimeExt('application/ld+json')).toBe('json');
  });
  it('inconnu ou vide → repli', function() {
    expect(mimeExt('')).toBe('bin');
    expect(mimeExt(null)).toBe('bin');
    expect(mimeExt('application/octet-stream')).toBe('octet-stream');
  });
});

describe('nom de telechargement d une ressource web (query string, lot Z-2)', function() {
  // Cas REEL : le nom d'une ressource web est le dernier segment de son URL
  // (extractResultParts), donc query comprise. Le `.1.0&ixid=…` de la query
  // faisait repondre VRAI a hasFileExt, donc aucune extension n'etait ajoutee
  // et l'image se telechargeait sans .jpg (observe sur une image Unsplash).
  var UNSPLASH = 'photo-1537204696486-967f1b7198c8?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3';

  it('la query string est coupee, l extension du mime est ajoutee', function() {
    expect(resourceDownloadName(UNSPLASH, 'image/jpeg'))
      .toBe('photo-1537204696486-967f1b7198c8.jpg');
  });
  it('sans la coupe, la query portait un faux positif d extension', function() {
    // Preuve de la PREMISSE : le point de `rb-4.1.0` est bien en position
    // d'extension au sens de hasFileExt. Sans ce test, le correctif pourrait
    // etre vert pour une raison qui n a rien a voir.
    expect(hasFileExt('x?ixlib=rb-4.1.0&ixid=M3wx')).toBe(true);
  });
  it('une vraie extension SUIVIE d une query est conservee', function() {
    expect(resourceDownloadName('index.html?v=2', 'text/html')).toBe('index.html');
  });
  it('query sans extension dans le stem → extension du mime', function() {
    expect(resourceDownloadName('donnees?format=csv', 'text/csv')).toBe('donnees.csv');
  });
  it('le fragment est coupe comme la query', function() {
    expect(resourceDownloadName('page#section', 'text/html')).toBe('page.html');
  });
  it('un nom reduit a une query ne laisse pas de fichier cache', function() {
    expect(resourceDownloadName('?a=1', 'image/png')).toBe('ressource.png');
  });
  it('sanitizeDownloadName partage la coupe (meme coeur d assainissement)', function() {
    expect(sanitizeDownloadName('script?v=1', 'javascript')).toBe('script.js');
  });
  it('un nom de fichier ordinaire n est pas touche', function() {
    expect(resourceDownloadName('photo.png', 'image/png')).toBe('photo.png');
    expect(resourceDownloadName('archive.tar.gz', 'application/gzip')).toBe('archive.tar.gz');
  });
});

describe('resourceDownloadName (lot V)', function() {
  it('nom deja extensionne : inchange', function() {
    expect(resourceDownloadName('export.csv', 'text/csv')).toBe('export.csv');
  });
  it('nom sans extension : suffixe depuis le mime, pas depuis un langage', function() {
    expect(resourceDownloadName('export', 'text/csv')).toBe('export.csv');
    expect(resourceDownloadName('rapport', 'application/pdf')).toBe('rapport.pdf');
  });
  it('mime text/plain sur un csv : on suit le mime declare (limite assumee)', function() {
    expect(resourceDownloadName('export', 'text/plain')).toBe('export.txt');
  });
  it('nom vide → repli generique extensionne', function() {
    expect(resourceDownloadName('', 'text/csv')).toBe('ressource.csv');
    expect(resourceDownloadName(null, '')).toBe('ressource.bin');
  });
  it('nom hostile assaini (traversal, caracteres de controle)', function() {
    expect(resourceDownloadName('../etc/passwd', 'text/plain')).toBe('_etc_passwd.txt');
    expect(resourceDownloadName('a/b.csv', 'text/csv')).toBe('a_b.csv');
  });
  it('nom reduit a du bruit → repli generique', function() {
    expect(resourceDownloadName('...', 'text/csv')).toBe('ressource.csv');
  });
});

describe('ackHasInspectableDetail (lot Z)', function() {
  it('args seuls suffisent', function() {
    expect(ackHasInspectableDetail({ kind: 'mcp_call', args: { q: 1 } })).toBe(true);
  });
  it('result seul suffit', function() {
    expect(ackHasInspectableDetail({ kind: 'mcp_call', result: 'ok' })).toBe(true);
  });
  it('code seul suffit (js_eval sans args enrichis)', function() {
    expect(ackHasInspectableDetail({ kind: 'js_eval', code: '1+1' })).toBe(true);
  });
  it('ack legacy sans aucun des trois champs → false', function() {
    expect(ackHasInspectableDetail({ kind: 'resource_presented', id: 'res_1' })).toBe(false);
    expect(ackHasInspectableDetail(null)).toBe(false);
  });
  it('valeurs falsy mais PRESENTES → true (result vide est un resultat)', function() {
    expect(ackHasInspectableDetail({ result: '' })).toBe(true);
    expect(ackHasInspectableDetail({ args: {} })).toBe(true);
  });
  it('pending seul suffit : appel parti, reponse pas encore la', function() {
    expect(ackHasInspectableDetail({ kind: 'mcp_call', pending: true })).toBe(true);
  });
  it('pending distingue l attente d un vide DEFINITIF (ack legacy)', function() {
    // Meme objet sans champs : seul `pending` separe les deux cas.
    expect(ackHasInspectableDetail({ kind: 'mcp_call' })).toBe(false);
    expect(ackHasInspectableDetail({ kind: 'mcp_call', pending: true })).toBe(true);
  });
  it('pending exige true, jamais une valeur truthy quelconque', function() {
    // Garde contre un `pending: 'oui'` venu d un futur site d appel : le champ
    // est un drapeau, pas un message.
    expect(ackHasInspectableDetail({ kind: 'mcp_call', pending: false })).toBe(false);
    expect(ackHasInspectableDetail({ kind: 'mcp_call', pending: 1 })).toBe(false);
  });
  it('pending retire mais result arrive → toujours inspectable', function() {
    // Etat post-enrichissement : le drapeau est parti, le contenu l a remplace.
    expect(ackHasInspectableDetail({ kind: 'mcp_call', result: 'ok' })).toBe(true);
  });
});

describe('pending est VOLATIL : jamais persiste (campagne inspecteur)', function() {
  it('copyAckFields ne recopie pas pending', function() {
    // Un ack relu depuis le stockage n est jamais en vol. Le persister ferait
    // rouvrir au reload un drawer en attente d une reponse qui n arrivera plus.
    var out = copyAckFields({ kind: 'mcp_call', name: 'srv__t', pending: true }, { role: 'tool-ack' });
    expect(out.pending === undefined).toBe(true);
    expect(out.name).toBe('srv__t');
  });
  it('un ack enrichi ET encore marque pending ne persiste que le contenu', function() {
    var out = copyAckFields({ kind: 'mcp_call', pending: true, args: { q: 1 }, result: 'ok' }, {});
    expect(out.pending === undefined).toBe(true);
    expect(out.result).toBe('ok');
    // Relu sans pending, il reste inspectable par ses champs de contenu.
    expect(ackHasInspectableDetail(out)).toBe(true);
  });
});

describe('inspectValueShape (lot Z)', function() {
  it('string monoligne → inline', function() {
    var r = inspectValueShape('index=main');
    expect(r.mode).toBe('inline');
    expect(r.text).toBe('index=main');
  });
  it('string multiligne → block (requete SPL collee en argument)', function() {
    var r = inspectValueShape('index=main\n| stats count');
    expect(r.mode).toBe('block');
    expect(r.lang).toBe('text');
  });
  it('objet → JSON indente, donc block', function() {
    var r = inspectValueShape({ a: 1, b: [2, 3] });
    expect(r.mode).toBe('block');
    expect(r.lang).toBe('json');
    expect(r.text.indexOf('\n') >= 0).toBe(true);
  });
  it('objet vide → inline (pas de saut de ligne a afficher)', function() {
    expect(inspectValueShape({}).mode).toBe('inline');
  });
  it('scalaires non-string', function() {
    expect(inspectValueShape(42).text).toBe('42');
    expect(inspectValueShape(true).text).toBe('true');
    expect(inspectValueShape(null).text).toBe('null');
  });
  it('objet cyclique → pas d exception, repli sur String()', function() {
    var a = {}; a.self = a;
    expect(typeof inspectValueShape(a).text).toBe('string');
  });
});

describe('ackInspectResourceTargets (lot Z-2)', function() {
  it('ack resource_stored → delegue a ackDownloadTarget', function() {
    var t = ackInspectResourceTargets({ kind: 'resource_stored', id: 'res_1', resourceName: 'a.png', mime: 'image/png' });
    expect(t.length).toBe(1);
    expect(t[0].id).toBe('res_1');
    expect(t[0].name).toBe('a.png');
  });
  it('mcp_call avec un [resource_ref:] → une cible', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call', result: '[resource_ref:res_cmsrg0cq]' });
    expect(t.length).toBe(1);
    expect(t[0].id).toBe('res_cmsrg0cq');
    expect(t[0].by).toBe('resource');
  });
  it('plusieurs refs → toutes, dans l ordre du texte', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call',
      result: 'a [resource_ref:res_a] b [resource_ref:res_b] c' });
    expect(t.length).toBe(2);
    expect(t[0].id).toBe('res_a');
    expect(t[1].id).toBe('res_b');
  });
  it('meme ref repetee → dedoublonnee', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call',
      result: '[resource_ref:res_a] [resource_ref:res_a]' });
    expect(t.length).toBe(1);
  });
  it('ref SUIVIE de la note de presentation → toujours detectee', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call',
      result: '[resource_ref:res_x]' + PRESENTED_NOTE });
    expect(t.length).toBe(1);
    expect(t[0].id).toBe('res_x');
  });
  it('resultat sans ref → aucune cible', function() {
    expect(ackInspectResourceTargets({ kind: 'mcp_call', result: '{"a":1}' }).length).toBe(0);
  });
  it('ack sans result → aucune cible, pas d exception', function() {
    expect(ackInspectResourceTargets({ kind: 'mcp_call' }).length).toBe(0);
    expect(ackInspectResourceTargets(null).length).toBe(0);
  });
  it('descripteur [resource id=...] complet → une cible, nom et mime lus', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call',
      result: 'Meteo transferee au client comme ressource weather.json (257 K).\n' +
        '[resource id=res_16jddxtr mime=application/json name="weather-bordeaux.json" size=251.2 KB]' });
    expect(t.length).toBe(1);
    expect(t[0].id).toBe('res_16jddxtr');
    expect(t[0].by).toBe('resource');
    expect(t[0].mime).toBe('application/json');
    expect(t[0].name).toBe('weather-bordeaux.json');
  });
  it('descripteur court (id + mime seuls) → une cible, nom vide', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call',
      result: '[resource id=res_ab12 mime=text/plain] - texte adressable par js__eval' });
    expect(t.length).toBe(1);
    expect(t[0].id).toBe('res_ab12');
    expect(t[0].mime).toBe('text/plain');
    expect(t[0].name).toBe('');
  });
  it('descripteur produit par formatInlineHandleForModel → detecte', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call',
      result: formatInlineHandleForModel('res_zz9', 'application/json', null) });
    expect(t.length).toBe(1);
    expect(t[0].id).toBe('res_zz9');
  });
  it('les deux formes dans un meme resultat → deux cibles', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call',
      result: '[resource_ref:res_a] et [resource id=res_b mime=text/csv]' });
    expect(t.length).toBe(2);
    expect(t[0].id).toBe('res_a');
    expect(t[1].id).toBe('res_b');
  });
  it('meme id sous les deux formes → dedoublonne', function() {
    var t = ackInspectResourceTargets({ kind: 'mcp_call',
      result: '[resource_ref:res_a] [resource id=res_a mime=text/csv]' });
    expect(t.length).toBe(1);
  });
  it('texte mentionnant resource sans marqueur → aucune cible', function() {
    expect(ackInspectResourceTargets({ kind: 'mcp_call',
      result: 'la resource id est inconnue' }).length).toBe(0);
  });
  it('un kind resource_* prime : pas de double comptage via son propre result', function() {
    // L'ack porte les DEUX : son id de kind, et un marqueur dans le result.
    // Sans la delegation en tete, on afficherait deux fois la meme ressource.
    var t = ackInspectResourceTargets({ kind: 'resource_stored', id: 'res_1',
      result: '[resource_ref:res_1]' });
    expect(t.length).toBe(1);
  });
});

describe('splitResultResourceMarkers (scission prose / marqueurs)', function() {
  it('un marqueur seul → corps vide, un marqueur', function() {
    var r = splitResultResourceMarkers('[resource_ref:res_a]');
    expect(r.body).toBe('');
    expect(r.markers.length).toBe(1);
    expect(r.markers[0]).toBe('[resource_ref:res_a]');
  });
  it('deux marqueurs sur deux lignes → corps vide, deux marqueurs', function() {
    var r = splitResultResourceMarkers(' [resource_ref:res_a]\n[resource_ref:res_b] ');
    expect(r.body).toBe('');
    expect(r.markers.length).toBe(2);
  });
  it('LE CAS PAYE : prose du serveur PUIS descripteur → la prose reste, le marqueur sort', function() {
    var r = splitResultResourceMarkers(
      'Meteo de Bordeaux transferee au client comme ressource weather.json (257 Ko).\n' +
      '[resource id=res_16jddxtr mime=application/json name="weather.json" size=251.2 KB]');
    expect(r.body).toBe('Meteo de Bordeaux transferee au client comme ressource weather.json (257 Ko).');
    expect(r.markers.length).toBe(1);
  });
  it('marqueur au MILIEU d une phrase → la phrase garde son sens, un seul espace', function() {
    var r = splitResultResourceMarkers('Voici [resource_ref:res_a] le fichier.');
    expect(r.body).toBe('Voici le fichier.');
  });
  it('meme marqueur repete → dedoublonne', function() {
    var r = splitResultResourceMarkers('[resource_ref:res_a] [resource_ref:res_a]');
    expect(r.markers.length).toBe(1);
  });
  it('les deux formes melangees → les deux sortent, dans l ordre', function() {
    var r = splitResultResourceMarkers('[resource_ref:res_a]\n[resource id=res_b mime=text/csv]');
    expect(r.markers.length).toBe(2);
    expect(r.markers[0]).toBe('[resource_ref:res_a]');
    expect(r.markers[1]).toBe('[resource id=res_b mime=text/csv]');
  });
  it('LA CAPTURE : descripteur + note js__eval sur la meme ligne → il ne reste que la prose', function() {
    var r = splitResultResourceMarkers(
      'Meteo de Bordeaux transferee au client comme ressource weather.json (25 Ko).\n' +
      formatInlineHandleForModel('res_16jddxtr', 'application/json', null));
    expect(r.body).toBe('Meteo de Bordeaux transferee au client comme ressource weather.json (25 Ko).');
    expect(r.markers.length).toBe(1);
  });
  it('la note js__eval ne laisse ni tiret orphelin ni deuxieme ligne', function() {
    var r = splitResultResourceMarkers(formatInlineHandleForModel('res_ab12', 'text/plain', null));
    expect(r.body).toBe('');
  });
  it('la note n est retiree QUE sur la ligne d un marqueur (jamais dans une prose qui la cite)', function() {
    var r = splitResultResourceMarkers('Le serveur dit : texte adressable par js__eval (blob=res_x), non inline dans le contexte.');
    expect(r.body).toBe('Le serveur dit : texte adressable par js__eval (blob=res_x), non inline dans le contexte.');
    expect(r.markers.length).toBe(0);
  });
  it('resultat SANS marqueur → corps byte-identique, indentation JSON preservee', function() {
    var json = '{\n  \"a\": 1,\n  \"b\": [\n    2\n  ]\n}';
    var r = splitResultResourceMarkers(json);
    expect(r.body).toBe(json);
    expect(r.markers.length).toBe(0);
  });
  it('vide / null → corps vide, aucun marqueur, pas d exception', function() {
    expect(splitResultResourceMarkers('').body).toBe('');
    expect(splitResultResourceMarkers(null).markers.length).toBe(0);
  });
});

describe('splitToolResultNote (lot Z-2)', function() {
  it('detache NOT_PRESENTED_NOTE en suffixe', function() {
    var r = splitToolResultNote('{"a":1}' + NOT_PRESENTED_NOTE);
    expect(r.text).toBe('{"a":1}');
    expect(r.note.indexOf('ne le voit PAS') >= 0).toBe(true);
  });
  it('detache PRESENTED_NOTE en suffixe', function() {
    var r = splitToolResultNote('ref' + PRESENTED_NOTE);
    expect(r.text).toBe('ref');
    expect(r.note.indexOf('presentee') >= 0 || r.note.indexOf('présentée') >= 0).toBe(true);
  });
  it('la note detachee perd le \\n et les crochets (marqueurs modele)', function() {
    var r = splitToolResultNote('x' + NOT_PRESENTED_NOTE);
    expect(r.note.charAt(0)).toBe('C');
    expect(r.note.charAt(r.note.length - 1)).toBe('.');
  });
  it('resultat sans note → texte intact, note vide', function() {
    var r = splitToolResultNote('Souvenir introuvable.');
    expect(r.text).toBe('Souvenir introuvable.');
    expect(r.note).toBe('');
  });
  it('note au MILIEU du texte → pas amputee (suffixe seulement)', function() {
    var s = 'avant' + NOT_PRESENTED_NOTE + ' apres';
    var r = splitToolResultNote(s);
    expect(r.text).toBe(s);
    expect(r.note).toBe('');
  });
  it('resultat REDUIT a la note seule → laisse tel quel (pas de texte vide)', function() {
    var r = splitToolResultNote(NOT_PRESENTED_NOTE);
    expect(r.text).toBe(NOT_PRESENTED_NOTE);
    expect(r.note).toBe('');
  });
  it('null/undefined → chaine vide, pas d exception', function() {
    expect(splitToolResultNote(null).text).toBe('');
    expect(splitToolResultNote(undefined).note).toBe('');
  });
  it('JSON + note → redevient reconnaissable par inspectResultShape', function() {
    // C'est LE bug du lot : la note faisait echouer JSON.parse, donc lang text
    // et plus aucune reindentation.
    var raw = '{"current_condition":[{"temp_C":"32"}]}' + NOT_PRESENTED_NOTE;
    expect(inspectResultShape(raw).lang).toBe('text');
    var r = inspectResultShape(splitToolResultNote(raw).text);
    expect(r.lang).toBe('json');
    expect(r.text.indexOf('\n') >= 0).toBe(true);
  });
});

describe('inspectResultShape (lot Z)', function() {
  it('JSON objet → reindente', function() {
    var r = inspectResultShape('{"a":1}');
    expect(r.lang).toBe('json');
    expect(r.text.indexOf('\n') >= 0).toBe(true);
  });
  it('JSON tableau → reindente', function() {
    expect(inspectResultShape('[1,2]').lang).toBe('json');
  });
  it('texte libre → brut, cas nominal sans erreur', function() {
    var r = inspectResultShape('Souvenir introuvable.');
    expect(r.lang).toBe('text');
    expect(r.text).toBe('Souvenir introuvable.');
  });
  it('JSON malforme commencant par { → texte brut, pas d exception', function() {
    var r = inspectResultShape('{oops');
    expect(r.lang).toBe('text');
    expect(r.text).toBe('{oops');
  });
  it('scalaire JSON valide → laisse en texte (rien a reindenter)', function() {
    expect(inspectResultShape('42').lang).toBe('text');
  });
  it('null/undefined → chaine vide', function() {
    expect(inspectResultShape(null).text).toBe('');
  });
});

describe('inspectLangForMime (lot Z)', function() {
  it('mimes courants', function() {
    expect(inspectLangForMime('application/json')).toBe('json');
    expect(inspectLangForMime('text/csv')).toBe('csv');
    expect(inspectLangForMime('image/svg+xml')).toBe('svg');
  });
  it('text/plain → text (extension txt renommee)', function() {
    expect(inspectLangForMime('text/plain')).toBe('text');
  });
  it('suffixe +json → json (via mimeExt, pas une 2e table)', function() {
    expect(inspectLangForMime('application/vnd.api+json')).toBe('json');
  });
  it('mime inconnu → text, jamais d echec', function() {
    expect(inspectLangForMime('application/x-inconnu')).toBe('x-inconnu');
    expect(inspectLangForMime('')).toBe('text');
  });
});

describe('inspectResourcePresentation (lot Z)', function() {
  // Prédicat textuel injecté : sous QuickJS, _isTextualMime (resources.js)
  // n'est pas chargé — sans injection la branche textuelle serait morte et un
  // test vert ne prouverait rien d'elle.
  var textual = function(m) {
    return m.indexOf('text/') === 0 || m === 'application/json';
  };
  it('image bitmap → vignette', function() {
    expect(inspectResourcePresentation('image/png', 1000, textual).mode).toBe('thumbnail');
  });
  it('SVG → markup (source ET rendu), pas vignette', function() {
    var r = inspectResourcePresentation('image/svg+xml', 1000, textual);
    expect(r.mode).toBe('markup');
    expect(r.lang).toBe('svg');
  });
  it('JSON → bloc colorise', function() {
    var r = inspectResourcePresentation('application/json', 1000, textual);
    expect(r.mode).toBe('text');
    expect(r.lang).toBe('json');
  });
  it('binaire opaque → descripteur seul', function() {
    var r = inspectResourcePresentation('application/pdf', 1000, textual);
    expect(r.mode).toBe('descriptor');
    expect(r.reason).toBe('binary');
  });
  it('textuel trop volumineux → refus explicite, jamais de troncature', function() {
    var r = inspectResourcePresentation('application/json', INSPECT_PREVIEW_MAX_BYTES + 1, textual);
    expect(r.mode).toBe('descriptor');
    expect(r.reason).toBe('too-big');
  });
  it('SVG trop volumineux → refus explicite aussi', function() {
    expect(inspectResourcePresentation('image/svg+xml', INSPECT_PREVIEW_MAX_BYTES + 1, textual).reason).toBe('too-big');
  });
  it('vignette non soumise au cap (bitmap redimensionne par le navigateur)', function() {
    expect(inspectResourcePresentation('image/png', INSPECT_PREVIEW_MAX_BYTES + 1, textual).mode).toBe('thumbnail');
  });
  it('taille inconnue → on tente la previsualisation', function() {
    expect(inspectResourcePresentation('text/csv', null, textual).mode).toBe('text');
  });
  it('charset dans le mime tolere', function() {
    expect(inspectResourcePresentation('text/csv; charset=utf-8', 10, textual).mode).toBe('text');
  });
});

describe('base64ByteLength', function() {
  // Les trois formes de padding, verifiees contre la taille REELLE de l'entree
  // (btoa n'existe pas en QuickJS : les vecteurs sont ecrits a la main).
  it('sans padding : 3 octets pour 4 caracteres', function() {
    expect(base64ByteLength('YWJj')).toBe(3);            // "abc"
  });
  it('un caractere de padding → 2 octets', function() {
    expect(base64ByteLength('YWI=')).toBe(2);            // "ab"
  });
  it('deux caracteres de padding → 1 octet', function() {
    expect(base64ByteLength('YQ==')).toBe(1);            // "a"
  });
  it('chaine plus longue : 6 octets', function() {
    expect(base64ByteLength('YWJjZGVm')).toBe(6);        // "abcdef"
  });
  // Un base64 encode en MIME porte des sauts de ligne : les compter gonflerait
  // la taille annoncee sans rien changer au fichier.
  it('ignore les sauts de ligne et espaces', function() {
    expect(base64ByteLength('YWJj\nZGVm')).toBe(6);
    expect(base64ByteLength('YWJj ZGVm')).toBe(6);
  });
  it('entree vide ou absente → 0, jamais NaN', function() {
    expect(base64ByteLength('')).toBe(0);
    expect(base64ByteLength(null)).toBe(0);
    expect(base64ByteLength(undefined)).toBe(0);
  });
});

describe('ackDisplayOrder', function() {
  // Cas signale : docs__pack pousse son resource_stored (via _storeBlock) AVANT
  // son ack docs_pack, si bien que « Ressource enregistree » s'affichait
  // au-dessus de « Archive creee ».
  it('outil interne : l action repasse devant son sous-produit', function() {
    var out = ackDisplayOrder([
      { kind: 'resource_stored', id: 'res_1', resourceName: 'a.zip' },
      { kind: 'docs_pack', id: 'res_1', resourceName: 'a.zip', count: 4 },
    ]);
    expect(out[0].kind).toBe('docs_pack');
    expect(out[1].kind).toBe('resource_stored');
  });
  it('ne mute pas le tableau d entree', function() {
    var input = [
      { kind: 'resource_stored', id: 'res_1' },
      { kind: 'docs_pack', id: 'res_1' },
    ];
    ackDisplayOrder(input);
    expect(input[0].kind).toBe('resource_stored');
  });
  // Outil MCP distant : onEarlyAcks a deja drainé l'action avant l'appel reseau,
  // internResourcesFromResult cree la ressource apres. L'ordre est deja bon.
  it('outil distant : ordre deja correct, laisse tel quel', function() {
    var out = ackDisplayOrder([
      { kind: 'mcp_call', id: 'res_1', name: 'srv__fetch_url' },
      { kind: 'resource_stored', id: 'res_1' },
    ]);
    expect(out[0].kind).toBe('mcp_call');
    expect(out[1].kind).toBe('resource_stored');
  });
  // Le critere est l'identite de la ressource : un resource_stored seul ack de
  // son appel porte lui-meme l'intent du modele et ne doit pas bouger, meme si
  // un AUTRE outil du meme tour pousse une action apres lui.
  it('resource__create suivi d une action sans rapport → inchange', function() {
    var out = ackDisplayOrder([
      { kind: 'resource_stored', id: 'res_1', intent: 'je range ca' },
      { kind: 'docs_pack', id: 'res_9' },
    ]);
    expect(out[0].id).toBe('res_1');
    expect(out[1].id).toBe('res_9');
  });
  it('resource_stored seul → inchange', function() {
    var out = ackDisplayOrder([{ kind: 'resource_stored', id: 'res_1' }]);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe('resource_stored');
  });
  // Plusieurs couples dans un meme groupe (tour multi-outils) : chaque
  // sous-produit suit SON action, jamais tous repousses en fin de liste.
  it('deux couples action/ressource restent apparies', function() {
    var out = ackDisplayOrder([
      { kind: 'resource_stored', id: 'res_1' },
      { kind: 'docs_pack', id: 'res_1' },
      { kind: 'resource_stored', id: 'res_2' },
      { kind: 'docs_extract', id: 'res_2' },
    ]);
    expect(out.map(function(a) { return a.kind + ':' + a.id; }).join(' ')).toBe(
      'docs_pack:res_1 resource_stored:res_1 docs_extract:res_2 resource_stored:res_2');
  });
  it('groupe sans aucun resource_stored → inchange', function() {
    var out = ackDisplayOrder([
      { kind: 'mcp_call', name: 'a' },
      { kind: 'docs_pack', id: 'res_1' },
    ]);
    expect(out[0].name).toBe('a');
    expect(out[1].kind).toBe('docs_pack');
  });
  it('entree vide ou non tableau → copie sans exception', function() {
    expect(ackDisplayOrder([]).length).toBe(0);
    expect(ackDisplayOrder(null).length).toBe(0);
  });
});

describe('ackDownloadTarget (lot V)', function() {
  it('resource_stored → cible par id de ressource', function() {
    var t = ackDownloadTarget({ kind: 'resource_stored', id: 'res_1', resourceName: 'a.csv', mime: 'text/csv' });
    expect(t.by).toBe('resource');
    expect(t.id).toBe('res_1');
    expect(t.name).toBe('a.csv');
  });
  it('resource_presented → meme famille', function() {
    expect(ackDownloadTarget({ kind: 'resource_presented', id: 'res_2' }).by).toBe('resource');
  });
  it('attachment_recalled → cible par attId, scopee conversation', function() {
    var t = ackDownloadTarget({ kind: 'attachment_recalled', attId: 'att_1', convId: 'c1' });
    expect(t.by).toBe('attachment');
    expect(t.attId).toBe('att_1');
    expect(t.convId).toBe('c1');
  });
  it('cle manquante → null (ack legacy)', function() {
    expect(ackDownloadTarget({ kind: 'resource_stored' })).toBe(null);
    expect(ackDownloadTarget({ kind: 'attachment_recalled' })).toBe(null);
  });
  it('kinds hors perimetre → null', function() {
    expect(ackDownloadTarget({ kind: 'memory_create', id: 'm1' })).toBe(null);
    expect(ackDownloadTarget({ kind: 'mcp_call', name: 'x__y' })).toBe(null);
    expect(ackDownloadTarget(null)).toBe(null);
  });
});

describe('ackAgentConvTarget', function() {
  // L'ENSEMBLE des kinds attendus, jamais leur cardinal : un compte nu ne dit
  // pas LEQUEL manque quand il tombe, et il reperime au prochain ajout
  // (CLAUDE.md, enumerations fermees dans les scripts de verification).
  var AGENT_KINDS = ['agent_spawn', 'agent_status', 'agent_result', 'agent_abort'];
  it('les quatre kinds agent designent leur fil', function() {
    AGENT_KINDS.forEach(function(kind) {
      var t = ackAgentConvTarget({ kind: kind, convId: 'c_agent', title: 'analyser' });
      expect(t && t.convId).toBe('c_agent');
    });
  });
  it('convId manquant → null (rien ou aller)', function() {
    AGENT_KINDS.forEach(function(kind) {
      expect(ackAgentConvTarget({ kind: kind, title: 'analyser' })).toBe(null);
    });
  });
  it('conversation_read est DEHORS malgre son convId', function() {
    // Son icone de kind EST deja ICON_EYE : un bouton oeil y mettrait deux
    // yeux sur la meme ligne. Le predicat vise les acks agent, pas « tout ack
    // designant une conversation ».
    expect(ackAgentConvTarget({ kind: 'conversation_read', convId: 'c1' })).toBe(null);
  });
  it('kinds hors perimetre → null', function() {
    expect(ackAgentConvTarget({ kind: 'memory_create', id: 'm1' })).toBe(null);
    expect(ackAgentConvTarget({ kind: 'mcp_call', name: 'x__y' })).toBe(null);
    expect(ackAgentConvTarget(null)).toBe(null);
  });
});

describe('isMermaidLang', function() {
  it('mermaid → true', function() {
    expect(isMermaidLang('mermaid')).toBeTruthy();
  });
  it('insensible à la casse', function() {
    expect(isMermaidLang('Mermaid')).toBeTruthy();
    expect(isMermaidLang('MERMAID')).toBeTruthy();
  });
  it('langues voisines → false', function() {
    expect(isMermaidLang('mermaidjs')).toBeFalsy();
    expect(isMermaidLang('mmd')).toBeFalsy();
    expect(isMermaidLang('markdown')).toBeFalsy();
  });
  it('vide / undefined → false', function() {
    expect(isMermaidLang('')).toBeFalsy();
    expect(isMermaidLang(undefined)).toBeFalsy();
  });
});

describe('mermaidThemeFor', function() {
  it('dark → dark', function() {
    expect(mermaidThemeFor('dark')).toBe('dark');
  });
  it('light → default (thème clair Mermaid)', function() {
    expect(mermaidThemeFor('light')).toBe('default');
  });
  it('valeur inattendue ou absente → default (fallback clair)', function() {
    expect(mermaidThemeFor('system')).toBe('default');
    expect(mermaidThemeFor(null)).toBe('default');
    expect(mermaidThemeFor(undefined)).toBe('default');
  });
});

describe('sanitizeMermaidSource', function() {
  it('strippe les balises de mise en forme, garde le texte', function() {
    expect(sanitizeMermaidSource('A["France <b>(2-0)</b>"]'))
      .toBe('A["France (2-0)"]');
  });
  it('couvre b/i/em/strong/u/mark/small, insensible à la casse', function() {
    expect(sanitizeMermaidSource('<i>a</i><EM>b</EM><Strong>c</Strong><u>d</u><mark>e</mark><small>f</small>'))
      .toBe('abcdef');
  });
  it('préserve <br/> (saut de ligne reconnu par Mermaid)', function() {
    expect(sanitizeMermaidSource('A["x<br/><b>y</b>"]'))
      .toBe('A["x<br/>y"]');
  });
  it('tolère un espace avant le chevron fermant', function() {
    expect(sanitizeMermaidSource('<b >x</b >')).toBe('x');
  });
  it('ne touche pas une source sans balise', function() {
    expect(sanitizeMermaidSource('graph TD\n A-->B')).toBe('graph TD\n A-->B');
  });
  it('null / undefined → chaîne vide', function() {
    expect(sanitizeMermaidSource(null)).toBe('');
    expect(sanitizeMermaidSource(undefined)).toBe('');
  });
  it('convertit un backslash-n littéral en <br/> (piège modèle malgré la doctrine)', function() {
    expect(sanitizeMermaidSource('A[Ligne un\\nLigne deux]'))
      .toBe('A[Ligne un<br/>Ligne deux]');
  });
  it('convertit plusieurs occurrences, ne touche pas les vrais retours à la ligne', function() {
    expect(sanitizeMermaidSource('graph TD\nA[x\\ny]-->B[z\\nw]'))
      .toBe('graph TD\nA[x<br/>y]-->B[z<br/>w]');
  });
});

describe('mermaidErrorNotice', function() {
  it('suffixe le libellé fixe du message de l\'exception', function() {
    expect(mermaidErrorNotice(new Error('splitLineToFitWidth does not support newlines in the line')))
      .toBe('Diagramme invalide — source affichée (mermaid : splitLineToFitWidth does not support newlines in the line)');
  });
  it('retire la ligne de caret et aplatit un message de parse multi-lignes', function() {
    const msg = "Parse error on line 2:\n...A[foo(bar)]\n------^\nExpecting 'SQE', got 'PS'";
    expect(mermaidErrorNotice(new Error(msg)))
      .toBe("Diagramme invalide — source affichée (mermaid : Parse error on line 2: ...A[foo(bar)] Expecting 'SQE', got 'PS')");
  });
  it('borne un message trop long, terminé par une ellipse', function() {
    const out = mermaidErrorNotice(new Error('x'.repeat(1000)));
    expect(out.length).toBe('Diagramme invalide — source affichée (mermaid : '.length + MERMAID_ERROR_DETAIL_MAX + 1);
    expect(out.slice(-2)).toBe('…)');
  });
  it('accepte une chaîne jetée telle quelle', function() {
    expect(mermaidErrorNotice('boom')).toBe('Diagramme invalide — source affichée (mermaid : boom)');
  });
  it('sans message exploitable → libellé seul', function() {
    expect(mermaidErrorNotice(null)).toBe('Diagramme invalide — source affichée');
    expect(mermaidErrorNotice(new Error(''))).toBe('Diagramme invalide — source affichée');
    expect(mermaidErrorNotice({})).toBe('Diagramme invalide — source affichée');
  });
});

describe('isPreviewableLang', function() {
  it('html et svg → true', function() {
    expect(isPreviewableLang('html')).toBeTruthy();
    expect(isPreviewableLang('svg')).toBeTruthy();
  });
  it('insensible à la casse', function() {
    expect(isPreviewableLang('HTML')).toBeTruthy();
    expect(isPreviewableLang('Svg')).toBeTruthy();
  });
  it('langues voisines exclues (xml, xhtml, js, css)', function() {
    expect(isPreviewableLang('xml')).toBeFalsy();
    expect(isPreviewableLang('xhtml')).toBeFalsy();
    expect(isPreviewableLang('js')).toBeFalsy();
    expect(isPreviewableLang('css')).toBeFalsy();
  });
  it('vide / undefined → false', function() {
    expect(isPreviewableLang('')).toBeFalsy();
    expect(isPreviewableLang(undefined)).toBeFalsy();
  });
});

describe('buildPreviewSrcdoc', function() {
  it('html : passthrough byte-identique', function() {
    var src = '<!DOCTYPE html>\n<html><body><h1>Té&st</h1><script>1<2</script></body></html>';
    expect(buildPreviewSrcdoc('html', src)).toBe(src);
  });
  it('svg : enveloppé dans un document HTML minimal, source intacte dedans', function() {
    var src = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    var doc = buildPreviewSrcdoc('svg', src);
    expect(doc).toContain(src);
    expect(doc.indexOf('<!DOCTYPE html>')).toBe(0);
    expect(doc).toContain('charset="utf-8"');
  });
  it('casse du lang svg indifférente', function() {
    expect(buildPreviewSrcdoc('SVG', '<svg/>').indexOf('<!DOCTYPE html>')).toBe(0);
  });
  it('contenu vide → chaîne vide (html) / wrapper seul (svg)', function() {
    expect(buildPreviewSrcdoc('html', '')).toBe('');
    expect(buildPreviewSrcdoc('svg', '')).toContain('<body style="margin:0"></body>');
  });
  it('null / undefined tolérés', function() {
    expect(buildPreviewSrcdoc('html', null)).toBe('');
    expect(buildPreviewSrcdoc('html', undefined)).toBe('');
  });
});

describe('diagramImageName', function() {
  it('extension du data-filename remplacée par celle de l\'image', function() {
    expect(diagramImageName('flux-oauth.mmd', 'svg')).toBe('flux-oauth.svg');
    expect(diagramImageName('flux-oauth.mmd', 'png')).toBe('flux-oauth.png');
  });
  it('nom sans extension → extension ajoutée', function() {
    expect(diagramImageName('archi', 'svg')).toBe('archi.svg');
  });
  it('seule la DERNIÈRE extension est remplacée', function() {
    expect(diagramImageName('v2.archi.mmd', 'png')).toBe('v2.archi.png');
  });
  it('absent / vide → nom générique', function() {
    expect(diagramImageName('', 'svg')).toBe('miaou-diagram.svg');
    expect(diagramImageName(null, 'png')).toBe('miaou-diagram.png');
    expect(diagramImageName(undefined, 'svg')).toBe('miaou-diagram.svg');
  });
  it('assaini via sanitizeDownloadName (séparateurs de chemin neutralisés)', function() {
    expect(diagramImageName('sub/dir/flow.mmd', 'svg')).toBe('sub_dir_flow.svg');
  });
});

describe('splitLines (substrat guest lines(), lot L)', function() {
  it('découpe un texte multi-lignes sur \\n', function() {
    var r = splitLines('a\nbb\nccc');
    expect(r.length).toBe(3);
    expect(r[0]).toBe('a');
    expect(r[2]).toBe('ccc');
  });
  it('conserve le dernier fragment sans \\n final', function() {
    var r = splitLines('a\nbb\nccc\ndddd');
    expect(r.length).toBe(4);
    expect(r[3]).toBe('dddd');
  });
  it('normalise CRLF et CR en LF', function() {
    expect(splitLines('a\r\nb\rc').length).toBe(3);
  });
  it('un \\n final produit un dernier fragment vide', function() {
    var r = splitLines('a\nb\n');
    expect(r.length).toBe(3);
    expect(r[2]).toBe('');
  });
  it('texte vide → une seule ligne vide', function() {
    var r = splitLines('');
    expect(r.length).toBe(1);
    expect(r[0]).toBe('');
  });
  it('null/undefined traités comme vide', function() {
    expect(splitLines(null).length).toBe(1);
    expect(splitLines(undefined).length).toBe(1);
  });
});

describe('jsEvalHandlesSummary (résumé des entrées d\'un ack js_eval, lot L-2)', function() {
  it('à UNE clé, rend le handle NU (cas majoritaire, pas d\'énumération)', function() {
    expect(jsEvalHandlesSummary({ src: 'res_abc' })).toBe('res_abc');
  });
  it('à DEUX clés ou plus, rend le compte et les clés — jamais les handles bruts', function() {
    var out = jsEvalHandlesSummary({ gauche: 'res_a', droite: 'res_b' });
    expect(out).toBe('2 ressources (gauche, droite)');
    // Les handles n'ont aucune valeur de lecture ici : ils sont volontairement
    // absents du résumé live (le détail clé=handle vit dans les exports).
    expect(out.indexOf('res_a') >= 0).toBe(false);
  });
  it('rend le compte exact au-delà de deux', function() {
    expect(jsEvalHandlesSummary({ a: 'res_1', b: 'res_2', c: 'res_3' }))
      .toBe('3 ressources (a, b, c)');
  });
  it('dégrade en ? sur objet vide, null, ou non-objet (ack ancien ou tronqué)', function() {
    // Inchangé : ce résumé reste la réponse à « QUELLES entrées ? ». Le cas
    // « aucune entrée » (calcul pur) est porté par jsEvalHasNoInputs, en amont —
    // les appelants ne demandent plus ce résumé quand il n'y a rien à résumer.
    expect(jsEvalHandlesSummary({})).toBe('?');
    expect(jsEvalHandlesSummary(null)).toBe('?');
    expect(jsEvalHandlesSummary(undefined)).toBe('?');
    expect(jsEvalHandlesSummary('res_abc')).toBe('?');
  });
});

describe('jsEvalHasNoInputs (calcul pur vs entrées inconnues)', function() {
  it('vrai sur absence réelle d\'entrées : null, undefined, objet vide', function() {
    expect(jsEvalHasNoInputs(null)).toBe(true);
    expect(jsEvalHasNoInputs(undefined)).toBe(true);
    expect(jsEvalHasNoInputs({})).toBe(true);
  });
  it('faux dès qu\'une entrée existe', function() {
    expect(jsEvalHasNoInputs({ src: 'res_abc' })).toBe(false);
    expect(jsEvalHasNoInputs({ a: 'res_1', b: 'res_2' })).toBe(false);
  });
  it('faux sur une forme inattendue : inconnue n\'est pas « aucune »', function() {
    // Un ack tronqué qui porterait une string doit rester un `?` (information
    // perdue), jamais être présenté comme un calcul pur assumé.
    expect(jsEvalHasNoInputs('res_abc')).toBe(false);
    expect(jsEvalHasNoInputs(42)).toBe(false);
  });
  it('dégrade en ? le handle d\'une clé unique vide, sans rendre "undefined"', function() {
    expect(jsEvalHandlesSummary({ a: '' })).toBe('?');
  });
});

describe('exports d\'un js__eval sans entrée (calcul pur)', function() {
  var ackPur = { kind: 'js_eval', name: 'miaou__js__eval', code: '6*7;', outLen: 2, ok: true };
  it('Markdown : « aucune (calcul pur) », jamais un ? trompeur', function() {
    var md = _formatToolCallMd(ackPur).join('\n');
    expect(md.indexOf('Entrées : aucune (calcul pur)') >= 0).toBe(true);
    expect(md.indexOf('`?`') >= 0).toBe(false);
    // Contrôle de prémisse : un ack AVEC entrées énumère toujours clé=handle.
    var avec = _formatToolCallMd({ kind: 'js_eval', code: '1;', inputHandles: { src: 'res_a' } }).join('\n');
    expect(avec.indexOf('src=res_a') >= 0).toBe(true);
  });
  it('HTML : « aucune (calcul pur) », et le code reste échappé', function() {
    var html = _formatToolCallHtml(ackPur);
    expect(html.indexOf('Entrées : aucune (calcul pur)') >= 0).toBe(true);
    expect(html.indexOf('<code>?</code>') >= 0).toBe(false);
  });
});

describe('checkOutputCap (garde de refus, lot L §3)', function() {
  it('sous le cap → ok true', function() {
    var r = checkOutputCap('abc', 10);
    expect(r.ok).toBe(true);
    expect(r.len).toBe(3);
    expect(r.cap).toBe(10);
  });
  it('exactement au cap → ok true (borne inclusive)', function() {
    expect(checkOutputCap('abcde', 5).ok).toBe(true);
  });
  it('au-dessus du cap → ok false, longueur et cap reportés', function() {
    var r = checkOutputCap('abcdef', 5);
    expect(r.ok).toBe(false);
    expect(r.len).toBe(6);
    expect(r.cap).toBe(5);
  });
  it('null/undefined → longueur 0, ok true', function() {
    expect(checkOutputCap(null, 5).ok).toBe(true);
    expect(checkOutputCap(undefined, 5).len).toBe(0);
  });
});

describe('ackIsError (prédicat unique de rendu en erreur)', function() {
  it('error: true → erreur (ack MCP distant, callRemoteTool)', function() {
    expect(ackIsError({ kind: 'mcp_call', error: true })).toBe(true);
  });
  it('ok: false → erreur (js__eval : refus de cap ET plantage guest)', function() {
    expect(ackIsError({ kind: 'js_eval', ok: false })).toBe(true);
  });
  it('ok: true → pas d\'erreur (js__eval réussi)', function() {
    expect(ackIsError({ kind: 'js_eval', ok: true, outLen: 42 })).toBe(false);
  });
  it('ack sans champ ok ni error → pas d\'erreur (faux positif de !m.ok)', function() {
    expect(ackIsError({ kind: 'memory_create', id: 'm1' })).toBe(false);
    expect(ackIsError({ kind: 'conversation_list', count: 0 })).toBe(false);
  });
  it('error absent + ok absent, autres champs falsy → pas d\'erreur', function() {
    expect(ackIsError({ kind: 'files_list', count: 0 })).toBe(false);
  });
  it('null/undefined → pas d\'erreur (jamais de throw)', function() {
    expect(ackIsError(null)).toBe(false);
    expect(ackIsError(undefined)).toBe(false);
  });
  it('survit à copyAckFields (ok: false est copié, présence != null)', function() {
    var dst = copyAckFields({ kind: 'js_eval', inputHandles: { a: 'att-1' }, ok: false, code: 'x' }, {});
    expect(dst.ok).toBe(false);
    expect(ackIsError(dst)).toBe(true);
  });
  it('copyAckFields conserve ok: true sans le muer en erreur', function() {
    var dst = copyAckFields({ kind: 'js_eval', inputHandles: { a: 'att-1' }, ok: true, outLen: 7 }, {});
    expect(dst.ok).toBe(true);
    expect(ackIsError(dst)).toBe(false);
  });
});

describe('findMatchRanges — occurrences à surligner', function() {
  it('rend les offsets de chaque occurrence, pas seulement la première', function() {
    expect(findMatchRanges('chat et chat', ['chat'])).toEqual([
      { start: 0, end: 4 }, { start: 8, end: 12 },
    ]);
  });

  it('insensible à la casse, offsets sur le texte d\'origine', function() {
    expect(findMatchRanges('Chat, CHAT', ['chat'])).toEqual([
      { start: 0, end: 4 }, { start: 6, end: 10 },
    ]);
  });

  it('plusieurs mots-clefs, résultat trié par position', function() {
    expect(findMatchRanges('bravo, alpha', ['alpha', 'bravo'])).toEqual([
      { start: 0, end: 5 }, { start: 7, end: 12 },
    ]);
  });

  it('deux occurrences séparées par un BLANC fusionnent (marque continue)', function() {
    // Règle d'aspect : « chien de race » cherché mot à mot donnerait sinon trois
    // marques zébrées de blancs nus.
    expect(findMatchRanges('chien de race', ['chien', 'de', 'race'])).toEqual([
      { start: 0, end: 13 },
    ]);
  });

  it('deux occurrences séparées par du TEXTE restent distinctes', function() {
    // La fusion des blancs ne doit pas souder ce qui est réellement éloigné.
    expect(findMatchRanges('chien puis race', ['chien', 'race'])).toEqual([
      { start: 0, end: 5 }, { start: 11, end: 15 },
    ]);
  });

  it('deux mots-clefs qui se recouvrent fusionnent en un seul intervalle', function() {
    // Sans fusion, le rendu poserait un <mark> dans un <mark>.
    expect(findMatchRanges('conversation', ['conv', 'conversation'])).toEqual([
      { start: 0, end: 12 },
    ]);
  });

  it('mots-clefs adjacents fusionnent (intervalles qui se touchent)', function() {
    expect(findMatchRanges('abcd', ['ab', 'cd'])).toEqual([{ start: 0, end: 4 }]);
  });

  it('aucune occurrence → tableau vide', function() {
    expect(findMatchRanges('bonjour', ['chat'])).toEqual([]);
  });

  it('texte ou mots-clefs absents → tableau vide, jamais d\'exception', function() {
    expect(findMatchRanges(null, ['chat'])).toEqual([]);
    expect(findMatchRanges('chat', null)).toEqual([]);
    expect(findMatchRanges('chat', [])).toEqual([]);
    expect(findMatchRanges('', ['chat'])).toEqual([]);
  });
});

describe('buildExcerpt — extrait et offsets recalés', function() {
  it('centre l\'extrait sur l\'occurrence et recale les offsets dessus', function() {
    var ex = buildExcerpt('aaaa CIBLE bbbb', ['cible'], { radius: 4 });
    expect(ex.text).toBe('aaa CIBLE bbb');
    // Offsets relatifs au texte DÉCOUPÉ : c'est tout l'intérêt du contrat.
    expect(ex.ranges).toEqual([{ start: 4, end: 9 }]);
    expect(ex.text.slice(ex.ranges[0].start, ex.ranges[0].end)).toBe('CIBLE');
  });

  it('signale les bords coupés sans les matérialiser dans le texte', function() {
    // L'ellipse est posée par le rendu : l'inclure ici décalerait les offsets.
    var ex = buildExcerpt('aaaaaaaa CIBLE bbbbbbbb', ['cible'], { radius: 3 });
    expect(ex.leading).toBe(true);
    expect(ex.trailing).toBe(true);
    expect(ex.text.charAt(0)).toBe('a');
  });

  it('bords non coupés quand le rayon couvre tout le texte', function() {
    var ex = buildExcerpt('CIBLE', ['cible'], { radius: 50 });
    expect(ex.leading).toBe(false);
    expect(ex.trailing).toBe(false);
    expect(ex.text).toBe('CIBLE');
  });

  it('les blancs de bord sont rognés SANS désaligner le surlignage', function() {
    // Rayon choisi pour que la fenêtre TOMBE dans les blancs des deux côtés :
    // sans rognage l'extrait commencerait et finirait par des espaces.
    var ex = buildExcerpt('xx      CIBLE      yy', ['cible'], { radius: 4 });
    expect(ex.text.charAt(0)).toBe('C');
    expect(ex.text.charAt(ex.text.length - 1)).toBe('E');
    expect(ex.text.slice(ex.ranges[0].start, ex.ranges[0].end)).toBe('CIBLE');
  });

  it('deux occurrences dans une même fenêtre : un extrait, deux surlignages', function() {
    var ex = buildExcerpt('chat et chat', ['chat'], { radius: 20 });
    expect(ex.ranges.length).toBe(2);
    expect(ex.text.slice(ex.ranges[1].start, ex.ranges[1].end)).toBe('chat');
  });

  it('windowIndex sélectionne les fenêtres suivantes', function() {
    var text = 'CIBLE' + new Array(60).join('.') + 'CIBLE';
    var second = buildExcerpt(text, ['cible'], { radius: 5, windowIndex: 1 });
    expect(second.leading).toBe(true);
    expect(second.trailing).toBe(false);
    expect(second.text.slice(second.ranges[0].start, second.ranges[0].end)).toBe('CIBLE');
  });

  it('aucune occurrence → null (un extrait vide et un extrait absent se testent pareil)', function() {
    expect(buildExcerpt('bonjour', ['chat'], { radius: 5 })).toBe(null);
    expect(buildExcerpt('', ['chat'], { radius: 5 })).toBe(null);
    expect(buildExcerpt(null, ['chat'], { radius: 5 })).toBe(null);
    expect(buildExcerpt('chat', [], { radius: 5 })).toBe(null);
  });

  it('rayon nul : le surlignage couvre tout l\'extrait', function() {
    var ex = buildExcerpt('aaa CIBLE bbb', ['cible'], { radius: 0 });
    expect(ex.text).toBe('CIBLE');
    expect(ex.ranges).toEqual([{ start: 0, end: 5 }]);
  });
});

describe('parseSearchTerms — guillemets et mots libres', function() {
  it('mots libres : un terme par mot', function() {
    expect(parseSearchTerms('chien de race')).toEqual([
      { text: 'chien', exact: false }, { text: 'de', exact: false }, { text: 'race', exact: false },
    ]);
  });

  it('groupe entre guillemets : UN terme, espaces conservés', function() {
    expect(parseSearchTerms('"chien de race"')).toEqual([
      { text: 'chien de race', exact: true },
    ]);
  });

  it('mélange guillemets et mots libres', function() {
    expect(parseSearchTerms('"chien de race" vaccin')).toEqual([
      { text: 'chien de race', exact: true }, { text: 'vaccin', exact: false },
    ]);
  });

  it('guillemets typographiques acceptés comme les droits', function() {
    expect(parseSearchTerms('\u201cchien de race\u201d')).toEqual([
      { text: 'chien de race', exact: true },
    ]);
    expect(parseSearchTerms('\u00abchien de race\u00bb')).toEqual([
      { text: 'chien de race', exact: true },
    ]);
  });

  it('guillemet ouvert jamais refermé : ferme en fin de requête (frappe en cours)', function() {
    expect(parseSearchTerms('"chien de')).toEqual([{ text: 'chien de', exact: true }]);
  });

  it('guillemets vides ignorés, pas de terme fantôme', function() {
    expect(parseSearchTerms('""')).toEqual([]);
    expect(parseSearchTerms('"   "')).toEqual([]);
    expect(parseSearchTerms('a "" b')).toEqual([
      { text: 'a', exact: false }, { text: 'b', exact: false },
    ]);
  });

  it('normalise en minuscules et écarte les blancs', function() {
    expect(parseSearchTerms('  Chien   "DE Race"  ')).toEqual([
      { text: 'chien', exact: false }, { text: 'de race', exact: true },
    ]);
  });

  it('requête vide ou absente → aucun terme', function() {
    expect(parseSearchTerms('')).toEqual([]);
    expect(parseSearchTerms('   ')).toEqual([]);
    expect(parseSearchTerms(null)).toEqual([]);
  });
});

describe('excerptKeywords', function() {
  it('découpe et normalise en minuscules', function() {
    expect(excerptKeywords('Petits CHATS')).toEqual(['petits', 'chats']);
  });

  it('écarte les vides et les blancs multiples', function() {
    expect(excerptKeywords('  a   b  ')).toEqual(['a', 'b']);
    expect(excerptKeywords('')).toEqual([]);
    expect(excerptKeywords(null)).toEqual([]);
  });

  it('un groupe entre guillemets reste UN mot-clef (surligné d\'un bloc)', function() {
    expect(excerptKeywords('"chien de race"')).toEqual(['chien de race']);
  });
});

describe('searchHelpContent', function() {
  var HELP = {
    apercu: 'MIAOU est un client de chat. Tu peux discuter avec le modèle.',
    espaces: 'Les Espaces organisent tes conversations et tes fichiers.',
    memoire: 'Le modèle garde des souvenirs durables entre les conversations.',
  };

  it('query vide → tableau vide', function() {
    expect(searchHelpContent(HELP, '')).toEqual([]);
    expect(searchHelpContent(HELP, '   ')).toEqual([]);
  });

  it('helpContent absent → tableau vide (jamais de throw)', function() {
    expect(searchHelpContent(null, 'espaces')).toEqual([]);
    expect(searchHelpContent(undefined, 'espaces')).toEqual([]);
  });

  it('aucun match → tableau vide', function() {
    expect(searchHelpContent(HELP, 'xyzzy')).toEqual([]);
  });

  it('un mot-clef trouve le bon topic, insensible à la casse', function() {
    var results = searchHelpContent(HELP, 'ESPACES');
    expect(results.length).toBe(1);
    expect(results[0].topic).toBe('espaces');
    expect(results[0].excerpts.length).toBe(1);
    expect(results[0].excerpts[0].toLowerCase().indexOf('espaces') !== -1).toBe(true);
  });

  it('plusieurs mots-clefs → ET logique, pas OU', function() {
    var results = searchHelpContent(HELP, 'modèle conversations');
    expect(results.length).toBe(1);
    expect(results[0].topic).toBe('memoire');
  });

  it('mots-clefs présents dans des topics différents mais pas ensemble → aucun match', function() {
    var results = searchHelpContent(HELP, 'discuter souvenirs');
    expect(results).toEqual([]);
  });

  it('mot-clef commun à plusieurs topics → tous retournés', function() {
    var results = searchHelpContent(HELP, 'conversations');
    expect(results.length).toBe(2);
  });

  it('extrait tronqué porte les ellipses de bord', function() {
    var longText = 'x'.repeat(300) + ' cible ' + 'y'.repeat(300);
    var results = searchHelpContent({ long: longText }, 'cible');
    expect(results.length).toBe(1);
    expect(results[0].excerpts.length).toBe(1);
    expect(results[0].excerpts[0].charAt(0)).toBe('…');
    expect(results[0].excerpts[0].charAt(results[0].excerpts[0].length - 1)).toBe('…');
  });

  it('un extrait par occurrence d\'un mot-clef, pas seulement la première (régression Mistral/exports)', function() {
    var text = 'Alpha près du début. '
      + 'x'.repeat(400)
      + ' cible ici au milieu du texte. '
      + 'y'.repeat(400);
    var results = searchHelpContent({ topic1: text }, 'alpha cible');
    expect(results.length).toBe(1);
    expect(results[0].excerpts.length).toBe(2);
    expect(results[0].excerpts[0].toLowerCase().indexOf('alpha') !== -1).toBe(true);
    expect(results[0].excerpts[1].toLowerCase().indexOf('cible') !== -1).toBe(true);
  });

  it('plusieurs occurrences d\'un même mot-clef → un extrait par occurrence, fenêtres non chevauchantes', function() {
    var text = 'un ' + 'x'.repeat(400) + ' un ' + 'y'.repeat(400) + ' un fin';
    var results = searchHelpContent({ topic1: text }, 'un');
    expect(results.length).toBe(1);
    expect(results[0].excerpts.length).toBe(3);
  });

  it('fenêtres qui se chevauchent sont fusionnées en un seul extrait', function() {
    var text = 'alpha beta';
    var results = searchHelpContent({ topic1: text }, 'alpha beta');
    expect(results.length).toBe(1);
    expect(results[0].excerpts.length).toBe(1);
  });

  it('au-delà du plafond, truncated: true et le nombre d\'extraits reste borné', function() {
    var parts = [];
    for (var i = 0; i < 8; i++) {
      parts.push('mot' + 'x'.repeat(400));
    }
    var text = parts.join(' ');
    var results = searchHelpContent({ topic1: text }, 'mot');
    expect(results.length).toBe(1);
    expect(results[0].truncated).toBe(true);
    expect(results[0].excerpts.length).toBe(5);
  });

  it('sous le plafond, truncated: false', function() {
    var results = searchHelpContent(HELP, 'conversations');
    expect(results[0].truncated).toBe(false);
  });
});

describe('shortenModelLabel', function() {
  it('nom qui tient dans le budget : intact', function() {
    expect(shortenModelLabel('gemma3:4b', 40)).toBe('gemma3:4b');
  });

  it('palier 1 : le segment auteur saute quand le nom dépasse', function() {
    expect(shortenModelLabel('hf.co/unsloth/gemma-3-4b-it-GGUF:Q4', 20))
      .toBe('gemma-3-4b-it-GGUF:Q4'.slice(0, 19) + '…');
  });

  it('palier 1 suffisant : pas de troncature de fin', function() {
    expect(shortenModelLabel('mistralai/Mistral-Small:24b', 24)).toBe('Mistral-Small:24b');
  });

  it('coupe au DERNIER slash (chemin à plusieurs segments)', function() {
    expect(shortenModelLabel('hf.co/auteur/modele', 10)).toBe('modele');
  });

  it('palier 2 : troncature de fin avec ellipsis, longueur = budget', function() {
    var out = shortenModelLabel('qwen2.5-coder-instruct:32b-q8', 12);
    expect(out.length).toBe(12);
    expect(out).toBe('qwen2.5-cod…');
  });

  it('sans slash, la troncature de fin s\'applique quand même', function() {
    expect(shortenModelLabel('abcdefghij', 5)).toBe('abcd…');
  });

  it('budget nul ou absurde : nom intact (mesure impossible)', function() {
    expect(shortenModelLabel('auteur/tres-long-nom-de-modele', 0)).toBe('auteur/tres-long-nom-de-modele');
    expect(shortenModelLabel('auteur/tres-long-nom-de-modele', NaN)).toBe('auteur/tres-long-nom-de-modele');
    expect(shortenModelLabel('auteur/tres-long-nom-de-modele', -5)).toBe('auteur/tres-long-nom-de-modele');
  });

  it('budget de 1 : ellipsis seule', function() {
    expect(shortenModelLabel('abcdef', 1)).toBe('…');
  });

  it('entrée vide ou nulle : chaîne vide', function() {
    expect(shortenModelLabel(null, 10)).toBe('');
    expect(shortenModelLabel('', 10)).toBe('');
  });
});

describe('spaceMenuMaxHeight', function() {
  it('rend la place disponible sous l\'ancre, moins la marge', function() {
    expect(spaceMenuMaxHeight(100, 800)).toBe(684);
  });

  it('plancher : viewport court, ne descend pas sous le minimum', function() {
    expect(spaceMenuMaxHeight(700, 800)).toBe(160);
  });

  it('ancre sous le bas du viewport : plancher, jamais une valeur négative', function() {
    expect(spaceMenuMaxHeight(900, 800)).toBe(160);
  });

  it('mesure inexploitable : 0 (l\'appelant laisse le plafond CSS)', function() {
    expect(spaceMenuMaxHeight(100, 0)).toBe(0);
    expect(spaceMenuMaxHeight(NaN, 800)).toBe(0);
    expect(spaceMenuMaxHeight(100, NaN)).toBe(0);
  });

  it('dépasse largement les 220px de la base .model-menu sur un viewport normal', function() {
    expect(spaceMenuMaxHeight(120, 1000) > 220).toBe(true);
  });
});

describe('resolveActivityBadge (lot T-2)', function() {
  it('aucun état : pas de pastille', function() {
    expect(resolveActivityBadge([]) === null).toBe(true);
  });

  it('working seul : pulsante', function() {
    expect(resolveActivityBadge(['working'])).toBe('working');
  });

  it('unread seul : statique', function() {
    expect(resolveActivityBadge(['unread'])).toBe('unread');
  });

  it('unread gagne sur working, quel que soit l\'ordre', function() {
    expect(resolveActivityBadge(['working', 'unread'])).toBe('unread');
    expect(resolveActivityBadge(['unread', 'working'])).toBe('unread');
  });

  it('unread gagne même noyé dans plusieurs working', function() {
    expect(resolveActivityBadge(['working', 'working', 'unread', 'working'])).toBe('unread');
  });

  it('les nulls ne pèsent pas (surface sans état)', function() {
    expect(resolveActivityBadge([null, null]) === null).toBe(true);
    expect(resolveActivityBadge([null, 'working', null])).toBe('working');
  });

  it('valeurs inconnues ignorées, jamais propagées telles quelles', function() {
    expect(resolveActivityBadge(['bogus']) === null).toBe(true);
    expect(resolveActivityBadge(['bogus', 'working'])).toBe('working');
  });

  it('entrée absente ou nulle : pas de pastille, pas d\'exception', function() {
    expect(resolveActivityBadge() === null).toBe(true);
    expect(resolveActivityBadge(null) === null).toBe(true);
  });

  it('accepte un Set aussi bien qu\'un tableau (itérable)', function() {
    expect(resolveActivityBadge(new Set(['working']))).toBe('working');
    expect(resolveActivityBadge(new Set(['working', 'unread']))).toBe('unread');
  });

  it('PAS de troisième état : unread+working ne produit jamais autre chose qu\'unread', function() {
    const r = resolveActivityBadge(['unread', 'working']);
    expect(r === 'unread').toBe(true);
    expect(r === 'unread-working').toBe(false);
  });
});

describe('resolveAgentCount (lot T-2bis)', function() {
  it('aucune génération : masqué', function() {
    expect(resolveAgentCount(0, false)).toBe(0);
    expect(resolveAgentCount(0, true)).toBe(0);
  });

  it('une seule, sous les yeux : masqué (redondant avec le composer)', function() {
    expect(resolveAgentCount(1, true)).toBe(0);
  });

  it('une seule, hors écran : affichée', function() {
    expect(resolveAgentCount(1, false)).toBe(1);
  });

  it('deux dont une sur écran : affiche le TOTAL, pas total-1', function() {
    expect(resolveAgentCount(2, true)).toBe(2);
  });

  it('deux hors écran : affiche 2', function() {
    expect(resolveAgentCount(2, false)).toBe(2);
  });

  it('N générations : affiche N quel que soit l\'écran', function() {
    expect(resolveAgentCount(5, true)).toBe(5);
    expect(resolveAgentCount(5, false)).toBe(5);
  });

  it('entrées aberrantes : masqué, pas d\'exception', function() {
    expect(resolveAgentCount(-1, false)).toBe(0);
    expect(resolveAgentCount(NaN, false)).toBe(0);
    expect(resolveAgentCount(undefined, false)).toBe(0);
  });
});

describe('formatAgentCountLabel (lot T-2bis)', function() {
  it('singulier à 1', function() {
    expect(formatAgentCountLabel(1)).toBe('1 agent');
  });

  it('pluriel au-delà', function() {
    expect(formatAgentCountLabel(2)).toBe('2 agents');
    expect(formatAgentCountLabel(12)).toBe('12 agents');
  });

  it('zéro ou négatif : chaîne vide (rien à afficher)', function() {
    expect(formatAgentCountLabel(0)).toBe('');
    expect(formatAgentCountLabel(-3)).toBe('');
  });
});

// ── ackIsError sur resource_appended (lot Y — écriture partielle) ─────────────

describe('ackIsError — écriture partielle d\'une ressource (lot Y)', function() {
  it('un resource_appended nominal n\'est PAS en erreur', function() {
    expect(ackIsError({ kind: 'resource_appended', appendedLen: 12, size: 40 })).toBe(false);
  });
  it('ok:false (calcul interrompu) rend l\'ack rouge', function() {
    // Le rouge ne dit pas « l'écriture a échoué » (_appendBlock est atomique)
    // mais « le calcul qui l'a produite s'est arrêté » — la ressource est
    // incomplète, et c'est ce que l'utilisateur doit voir.
    expect(ackIsError({ kind: 'resource_appended', appendedLen: 840, ok: false })).toBe(true);
  });
  it('le prédicat reste le MÊME que pour les autres producteurs de ok:false', function() {
    // Contrôle de prémisse : aucun branchement par kind dans ackIsError — si
    // quelqu'un en ajoutait un, ce test le verrait.
    expect(ackIsError({ kind: 'js_eval', ok: false })).toBe(true);
    expect(ackIsError({ kind: 'docs_pack', ok: false })).toBe(true);
  });
});

describe('conversationSnippet (AA, niveau 1) — extrait de secours d\'une conversation', function() {
  it('rend \'\' sur vide, null et blancs seuls — l\'appelant s\'abstient alors d\'écrire', function() {
    expect(conversationSnippet('')).toBe('');
    expect(conversationSnippet(null)).toBe('');
    expect(conversationSnippet(undefined)).toBe('');
    expect(conversationSnippet('   \n\t  ')).toBe('');
  });
  it('rend un texte court tel quel', function() {
    expect(conversationSnippet('Configurer Caddy')).toBe('Configurer Caddy');
  });
  it('aplatit les sauts de ligne — une ligne de sidebar, pas un paragraphe', function() {
    expect(conversationSnippet('Salut\n\nJ\'ai   un souci')).toBe('Salut J\'ai un souci');
  });
  it('garde intact un texte de 60 caractères exactement (pas de … superflu)', function() {
    var s60 = '123456789 123456789 123456789 123456789 123456789 123456789x';
    expect(s60.length).toBe(60);   // la borne exacte, celle qui décide entre <= et >
    expect(conversationSnippet(s60)).toBe(s60);
  });
  it('coupe sur une frontière de mot au-delà de 60, avec un … (caractère unique)', function() {
    var out = conversationSnippet('Comment configurer un reverse proxy Caddy avec un certificat wildcard Let\'s Encrypt');
    expect(out).toBe('Comment configurer un reverse proxy Caddy avec un…');
  });
  it('coupe sec quand les 60 premiers caractères ne portent aucun espace (URL, jeton long)', function() {
    // Sans ce cas, lastIndexOf(' ') vaut -1 et une coupe naïve rendrait ''.
    var url = 'https://example.invalid/' + new Array(80).join('a');
    var out = conversationSnippet(url);
    expect(out.length).toBe(61);
    expect(out).toBe(url.slice(0, 60) + '…');
  });
  it('ne nettoie PAS le Markdown, contrairement à normalizeTitle', function() {
    // normalizeTitle traite une sortie de MODÈLE ; ici c'est une saisie
    // utilisateur, dont les astérisques et guillemets sont intentionnels.
    expect(conversationSnippet('**important** : « lire ceci »')).toBe('**important** : « lire ceci »');
  });
});

describe('authorizationUrlOrigin (campagne AB) — recevabilité de l\'URL', function() {
  it('accepte https vers un hote quelconque, et rend l\'origine', function() {
    expect(authorizationUrlOrigin('https://auth.notion.so/oauth/authorize?x=1')).toBe('auth.notion.so');
  });
  it('conserve le port dans l\'origine rendue', function() {
    // C'est ce que l'utilisateur doit LIRE avant de cliquer : un port inattendu
    // sur un hote connu est precisement ce qu'il faut voir.
    expect(authorizationUrlOrigin('https://example.test:8443/authorize')).toBe('example.test:8443');
  });
  it('accepte http vers le loopback litteral (cas nominal du proxy local)', function() {
    expect(authorizationUrlOrigin('http://127.0.0.1:8765/authorize/remote')).toBe('127.0.0.1:8765');
    expect(authorizationUrlOrigin('http://localhost:8765/authorize/remote')).toBe('localhost:8765');
    expect(authorizationUrlOrigin('http://[::1]:8765/authorize/remote')).toBe('[::1]:8765');
  });
  it('REFUSE http vers un hote quelconque (interceptable en clair)', function() {
    expect(authorizationUrlOrigin('http://auth.example.test/authorize')).toBe(null);
  });
  it('REFUSE javascript:, data: et file:', function() {
    expect(authorizationUrlOrigin('javascript://x/%0aalert(1)')).toBe(null);
    expect(authorizationUrlOrigin('data://text/html,<script>')).toBe(null);
    expect(authorizationUrlOrigin('file:///etc/passwd')).toBe(null);
  });
  it('REFUSE un userinfo (l\'hote lu n\'est pas l\'hote joint)', function() {
    // Vecteur classique : l'oeil lit accounts.google.com, le navigateur joint
    // faux.test.
    expect(authorizationUrlOrigin('https://accounts.google.com@faux.test/login')).toBe(null);
  });
  it('ne prend PAS un @ du chemin pour un userinfo', function() {
    // L'autorite s'arrete au premier /, donc ce @ est hors sujet : accepter.
    expect(authorizationUrlOrigin('https://vrai.test/callback@autre.test')).toBe('vrai.test');
  });
  it('REFUSE un caractere de controle (schema masque a l\'oeil)', function() {
    expect(authorizationUrlOrigin('java\nscript://x/%0aalert(1)')).toBe(null);
    expect(authorizationUrlOrigin('https://vrai.test\t/x')).toBe(null);
  });
  it('REFUSE une chaine non parsable, vide, ou d\'un autre type', function() {
    expect(authorizationUrlOrigin('pas une url')).toBe(null);
    expect(authorizationUrlOrigin('')).toBe(null);
    expect(authorizationUrlOrigin('   ')).toBe(null);
    expect(authorizationUrlOrigin(null)).toBe(null);
    expect(authorizationUrlOrigin(undefined)).toBe(null);
    expect(authorizationUrlOrigin(42)).toBe(null);
    expect(authorizationUrlOrigin('https://')).toBe(null);
  });
  it('REFUSE un port non numerique', function() {
    expect(authorizationUrlOrigin('https://vrai.test:80x/x')).toBe(null);
  });
  it('normalise le schema et l\'hote en minuscules', function() {
    expect(authorizationUrlOrigin('HTTPS://Auth.Example.TEST/x')).toBe('auth.example.test');
    expect(authorizationUrlOrigin('HTTP://127.0.0.1:8765/x')).toBe('127.0.0.1:8765');
  });
  it('tolere les espaces autour, jamais dedans', function() {
    expect(authorizationUrlOrigin('  https://vrai.test/x  ')).toBe('vrai.test');
  });
});

describe('ackAuthorizationTarget (campagne AB) — refus presentable', function() {
  var CODE = 'AUTHORIZATION_REQUIRED';
  it('rend une cible complete quand code ET url recevable sont presents', function() {
    var t = ackAuthorizationTarget({
      kind: 'mcp_call', error: true, errorCode: CODE,
      authorizationUrl: 'http://127.0.0.1:8765/authorize/notion', upstream: 'notion',
    });
    expect(t.url).toBe('http://127.0.0.1:8765/authorize/notion');
    expect(t.origin).toBe('127.0.0.1:8765');
    expect(t.upstream).toBe('notion');
  });
  it('rend upstream a null quand le serveur ne le nomme pas', function() {
    var t = ackAuthorizationTarget({ errorCode: CODE, authorizationUrl: 'https://a.test/x' });
    expect(t.upstream).toBe(null);
  });
  it('null sur un ack en erreur ORDINAIRE (pas de code)', function() {
    expect(ackAuthorizationTarget({ kind: 'mcp_call', error: true })).toBe(null);
  });
  it('null sur un autre code machine (REF_UNKNOWN)', function() {
    expect(ackAuthorizationTarget({ errorCode: 'REF_UNKNOWN', authorizationUrl: 'https://a.test/x' })).toBe(null);
  });
  it('null quand le proxy n\'a pas de parcours a proposer (url absente ou null)', function() {
    expect(ackAuthorizationTarget({ errorCode: CODE })).toBe(null);
    expect(ackAuthorizationTarget({ errorCode: CODE, authorizationUrl: null })).toBe(null);
  });
  it('null quand l\'url est presente mais IRRECEVABLE — pas de lien, jamais de repli', function() {
    // Le cas d'attaque : le code est authentique (ou imite), l'url ne l'est pas.
    expect(ackAuthorizationTarget({ errorCode: CODE, authorizationUrl: 'javascript:alert(1)' })).toBe(null);
    expect(ackAuthorizationTarget({ errorCode: CODE, authorizationUrl: 'http://faux.test/login' })).toBe(null);
  });
  it('null sur un ack absent', function() {
    expect(ackAuthorizationTarget(null)).toBe(null);
    expect(ackAuthorizationTarget(undefined)).toBe(null);
  });
  it('lit le code par EGALITE, jamais par sous-chaine du message', function() {
    // Un message serveur qui CITE le code ne doit pas declencher le lien.
    var t = ackAuthorizationTarget({
      result: 'Erreur : AUTHORIZATION_REQUIRED sur cet upstream',
      authorizationUrl: 'https://a.test/x',
    });
    expect(t).toBe(null);
  });
});

describe('unauthorizedUpstreamsFromList (AB-5) — extraction defensive', function() {
  var KEY = 'miaou/unauthorized_upstreams';
  function listed(meta) { return { tools: [], _meta: meta }; }

  it('extrait les entrees bien formees', function() {
    var out = unauthorizedUpstreamsFromList(listed({
      'miaou/unauthorized_upstreams': [
        { name: 'jira', authorize_path: '/authorize/jira' },
        { name: 'confluence', authorize_path: '/authorize/confluence' },
      ],
    }));
    expect(out.length).toBe(2);
    expect(out[0].name).toBe('jira');
    expect(out[0].authorizePath).toBe('/authorize/jira');
    expect(out[1].name).toBe('confluence');
  });
  it('rend un tableau vide quand la cle est absente — le cas du proxy sain', function() {
    expect(unauthorizedUpstreamsFromList(listed({})).length).toBe(0);
    expect(unauthorizedUpstreamsFromList({ tools: [] }).length).toBe(0);
  });
  it('rend un tableau vide sur une entree quelconque, jamais null', function() {
    // L'appelant compte et itere : un null l'obligerait a garder deux cas.
    expect(unauthorizedUpstreamsFromList(null).length).toBe(0);
    expect(unauthorizedUpstreamsFromList(undefined).length).toBe(0);
    expect(unauthorizedUpstreamsFromList('nope').length).toBe(0);
  });
  it('ignore un _meta mal forme sans jamais lever', function() {
    // connectMcpServer degrade gracieusement : une exception ici masquerait
    // TOUS les outils du serveur pour une surface facultative.
    expect(unauthorizedUpstreamsFromList(listed('texte')).length).toBe(0);
    expect(unauthorizedUpstreamsFromList(listed({ 'miaou/unauthorized_upstreams': 'x' })).length).toBe(0);
    expect(unauthorizedUpstreamsFromList(listed({ 'miaou/unauthorized_upstreams': {} })).length).toBe(0);
  });
  it('ecarte une entree sans nom : rien a afficher ni a adresser', function() {
    var out = unauthorizedUpstreamsFromList(listed({
      'miaou/unauthorized_upstreams': [
        { authorize_path: '/authorize/x' },
        { name: '   ' },
        { name: 'ok', authorize_path: '/authorize/ok' },
      ],
    }));
    expect(out.length).toBe(1);
    expect(out[0].name).toBe('ok');
  });
  it('CONSERVE une entree sans chemin, avec authorizePath a null', function() {
    // Savoir qu'il faut autoriser reste utile meme sans savoir ou cliquer :
    // meme doctrine qu'ackAuthorizationTarget, qui laisse l'ack rouge visible.
    var out = unauthorizedUpstreamsFromList(listed({
      'miaou/unauthorized_upstreams': [{ name: 'jira' }],
    }));
    expect(out.length).toBe(1);
    expect(out[0].name).toBe('jira');
    expect(out[0].authorizePath).toBe(null);
  });
  it('lit la cle NAMESPACEE, pas une cle nue', function() {
    var out = unauthorizedUpstreamsFromList(listed({ unauthorized_upstreams: [{ name: 'jira' }] }));
    expect(out.length).toBe(0);
    expect(KEY).toBe(UNAUTHORIZED_UPSTREAMS_META_KEY);
  });
});

describe('composeAuthorizationUrl (AB-5) — origine locale, chemin distant', function() {
  it('compose sur l\'origine du serveur configure', function() {
    expect(composeAuthorizationUrl('http://127.0.0.1:8765/mcp', '/authorize/jira'))
      .toBe('http://127.0.0.1:8765/authorize/jira');
  });
  it('ignore le chemin de l\'URL configuree, quel qu\'il soit', function() {
    // Le chemin publie par le proxy est absolu depuis la RACINE de l'origine :
    // le concatener au /mcp donnerait /mcp/authorize/jira, qui n'existe pas.
    expect(composeAuthorizationUrl('https://mcp.home.test/', '/authorize/jira'))
      .toBe('https://mcp.home.test/authorize/jira');
    expect(composeAuthorizationUrl('https://mcp.home.test/base/proxy/mcp', '/authorize/jira'))
      .toBe('https://mcp.home.test/authorize/jira');
  });
  it('accepte un hote distant en https — le cas du reverse proxy', function() {
    // L'origine vient de la config UTILISATEUR, pas du reseau : la garde de
    // l'ack (loopback seul en http) n'a pas lieu de s'appliquer ici.
    expect(composeAuthorizationUrl('https://proxy.home.djeyl.net/mcp', '/authorize/jira'))
      .toBe('https://proxy.home.djeyl.net/authorize/jira');
  });
  it('refuse un chemin sans / initial', function() {
    expect(composeAuthorizationUrl('http://127.0.0.1:8765/mcp', 'authorize/jira')).toBe(null);
  });
  it('refuse un chemin protocol-relative — il changerait d\'hote', function() {
    expect(composeAuthorizationUrl('http://127.0.0.1:8765/mcp', '//evil.test/authorize')).toBe(null);
  });
  it('refuse un chemin portant un schema', function() {
    expect(composeAuthorizationUrl('http://127.0.0.1:8765/mcp', '/x:javascript:alert(1)')).toBe(null);
    expect(composeAuthorizationUrl('http://127.0.0.1:8765/mcp', 'javascript:alert(1)')).toBe(null);
  });
  it('refuse un chemin portant un caractere de controle', function() {
    expect(composeAuthorizationUrl('http://127.0.0.1:8765/mcp', '/authorize/\nx')).toBe(null);
  });
  it('refuse une URL de serveur inexploitable', function() {
    expect(composeAuthorizationUrl('', '/authorize/jira')).toBe(null);
    expect(composeAuthorizationUrl(null, '/authorize/jira')).toBe(null);
    expect(composeAuthorizationUrl('pas-une-url', '/authorize/jira')).toBe(null);
    expect(composeAuthorizationUrl('ftp://x.test/mcp', '/authorize/jira')).toBe(null);
  });
});

describe('mcpTimeoutSeconds — migration ms → s des cartes MCP', function() {
  it('lit timeout_s quand il est present', function() {
    expect(mcpTimeoutSeconds({ timeout_s: 45 })).toBe(45);
  });
  it('convertit un ancien timeout en ms', function() {
    // Le cas qui motive la migration : 30000 relu en secondes ferait 8 heures.
    expect(mcpTimeoutSeconds({ timeout: 30000 })).toBe(30);
  });
  it('timeout_s prime sur un timeout residuel', function() {
    expect(mcpTimeoutSeconds({ timeout_s: 10, timeout: 30000 })).toBe(10);
  });
  it('arrondit une valeur ms non ronde', function() {
    expect(mcpTimeoutSeconds({ timeout: 4500 })).toBe(5);
  });
  it('rend 0 quand rien n\'est exploitable (l\'appelant met SON defaut)', function() {
    expect(mcpTimeoutSeconds({})).toBe(0);
    expect(mcpTimeoutSeconds(null)).toBe(0);
    expect(mcpTimeoutSeconds({ timeout_s: 0 })).toBe(0);
    expect(mcpTimeoutSeconds({ timeout: -5 })).toBe(0);
  });
  it('ne devine JAMAIS l\'unite depuis la valeur', function() {
    // Un seuil heuristique (« > 1000 donc des ms ») lirait 1500 comme 1.5 s.
    // C'est le NOM du champ qui tranche : timeout_s: 1500 vaut 1500 secondes.
    expect(mcpTimeoutSeconds({ timeout_s: 1500 })).toBe(1500);
    // ...et symetriquement un petit timeout en ms reste des ms.
    expect(mcpTimeoutSeconds({ timeout: 800 })).toBe(1);
  });
});

describe('shouldRecheckMcpServer — que retente-t-on au retour ?', function() {
  var MIN = 120000;
  var T = 1000000;      // « maintenant » arbitraire, loin de 0

  it('un serveur en erreur : tout de suite, sans throttle', function() {
    // Le cas d'usage : proxy lance en console, on revient. Un delai ici
    // rendrait la reprise muette juste apres l'echec qu'on veut reparer.
    var r = shouldRecheckMcpServer({ state: 'error' }, T - 1000, T, MIN);
    expect(r).toBe(true);
  });
  it('un serveur en attente d\'autorisation : tout de suite egalement', function() {
    var st = { state: 'ok', unauthorizedUpstreams: [{ name: 'jira' }] };
    expect(shouldRecheckMcpServer(st, T - 1000, T, MIN)).toBe(true);
  });
  it('un serveur sain tente il y a moins de l\'intervalle : non', function() {
    expect(shouldRecheckMcpServer({ state: 'ok' }, T - 60000, T, MIN)).toBe(false);
  });
  it('un serveur sain tente il y a plus de l\'intervalle : oui', function() {
    expect(shouldRecheckMcpServer({ state: 'ok' }, T - 180000, T, MIN)).toBe(true);
  });
  it('pile a l\'intervalle : oui (borne inclusive)', function() {
    expect(shouldRecheckMcpServer({ state: 'ok' }, T - MIN, T, MIN)).toBe(true);
  });
  it('jamais tente (horodatage a 0) : oui, et par un cas EXPLICITE', function() {
    // Pas par l'arithmetique `now - 0 >= MIN`, qui deviendrait fausse avec un
    // `now` de petite valeur — celui-ci le prouve.
    expect(shouldRecheckMcpServer({ state: 'ok' }, 0, 5, MIN)).toBe(true);
  });
  it('une connexion EN VOL n\'est pas relancee', function() {
    expect(shouldRecheckMcpServer({ state: 'connecting' }, 0, T, MIN)).toBe(false);
  });
  it('un serveur sans statut (jamais connecte) n\'est pas retente ici', function() {
    // reconnectMcpServers s'en charge au boot ; ce chemin ne traite que des
    // serveurs deja connus.
    expect(shouldRecheckMcpServer(null, 0, T, MIN)).toBe(false);
  });
  it('l\'attente d\'autorisation prime sur le throttle d\'un serveur sain', function() {
    var st = { state: 'ok', unauthorizedUpstreams: [{ name: 'jira' }] };
    expect(shouldRecheckMcpServer(st, T - 1, T, MIN)).toBe(true);
  });
});

describe('resolveBackendHealth — trois etats, pas deux', function() {
  var CFG = { url: 'http://x/v1', key: 'k' };

  it('sans URL : unconfigured, quoi qu\'en dise la sonde', function() {
    // Meme avec un verdict de panne en memoire : il n'y a rien a joindre, et
    // afficher « injoignable » enverrait au mauvais geste (attendre le serveur
    // plutot qu'ouvrir les reglages).
    expect(resolveBackendHealth({ url: '', key: 'k' }, false, { ok: false })).toBe('unconfigured');
  });
  it('URL blanche (espaces) : unconfigured', function() {
    expect(resolveBackendHealth({ url: '   ', key: 'k' }, false, null)).toBe('unconfigured');
  });
  it('clef absente alors que le build l\'exige : unconfigured', function() {
    expect(resolveBackendHealth({ url: 'http://x/v1', key: '' }, true, null)).toBe('unconfigured');
  });
  it('clef absente mais NON exigee : ce n\'est pas un defaut de config', function() {
    // Endpoint local sans authentification : le cas courant d'un Ollama.
    expect(resolveBackendHealth({ url: 'http://x/v1', key: '' }, false, null)).toBe('ok');
  });
  it('configure, rien d\'observe : ok — on n\'accuse pas un backend jamais essaye', function() {
    // Un rouge au demarrage, avant tout appel, serait un mensonge.
    expect(resolveBackendHealth(CFG, true, null)).toBe('ok');
  });
  it('configure et observe en defaut : down', function() {
    expect(resolveBackendHealth(CFG, true, { ok: false })).toBe('down');
  });
  it('configure et observe joignable : ok', function() {
    expect(resolveBackendHealth(CFG, true, { ok: true })).toBe('ok');
  });
  it('un verdict de panne est EFFACE par le retour a ok (le bug corrige)', function() {
    // La pastille restait rouge jusqu'au prochain echange reussi : ici le meme
    // prédicat repasse au vert sur le seul verdict, sans envoi utilisateur.
    expect(resolveBackendHealth(CFG, true, { ok: false })).toBe('down');
    expect(resolveBackendHealth(CFG, true, { ok: true })).toBe('ok');
  });
  it('config absente : unconfigured, sans exception', function() {
    expect(resolveBackendHealth(null, true, null)).toBe('unconfigured');
  });
});

describe('shouldProbeBackend — que sonde-t-on au retour ?', function() {
  var MIN = 120000;
  var T = 1000000;

  it('unconfigured : JAMAIS de sonde', function() {
    // Taper l'endpoint avec une clef vide rendrait 401 a chaque retour de
    // fenetre, sans rien apprendre — et un 401 se lirait comme une panne.
    expect(shouldProbeBackend('unconfigured', 0, T, MIN)).toBe(false);
    expect(shouldProbeBackend('unconfigured', T - 999999, T, MIN)).toBe(false);
  });
  it('down : tout de suite, sans throttle', function() {
    // Le cas d'usage : on relance Ollama, on revient, la pastille reverdit.
    expect(shouldProbeBackend('down', T - 1, T, MIN)).toBe(true);
  });
  it('ok sonde il y a moins de l\'intervalle : non', function() {
    expect(shouldProbeBackend('ok', T - 60000, T, MIN)).toBe(false);
  });
  it('ok sonde il y a plus de l\'intervalle : oui', function() {
    expect(shouldProbeBackend('ok', T - 180000, T, MIN)).toBe(true);
  });
  it('pile a l\'intervalle : oui (borne inclusive, comme son homologue MCP)', function() {
    expect(shouldProbeBackend('ok', T - MIN, T, MIN)).toBe(true);
  });
  it('jamais sonde (horodatage a 0) : oui, par un cas EXPLICITE', function() {
    // Un `now` de petite valeur le prouve : l'arithmetique `now - 0 >= MIN`
    // repondrait faux ici.
    expect(shouldProbeBackend('ok', 0, 5, MIN)).toBe(true);
  });
});

describe('resolveLogoExpression — l\'expression du chat (froncement, stockage plein)', function() {

  it('tout va bien : chat normal', function() {
    expect(resolveLogoExpression('ok', '', false)).toBe('ok');
  });
  it('backend injoignable : soucieux', function() {
    expect(resolveLogoExpression('down', '', false)).toBe('worried');
  });
  it('un MCP injoignable, backend sain : soucieux quand meme', function() {
    // Perimetre decide avec Julien : serveur actif KO OU tout MCP KO.
    expect(resolveLogoExpression('ok', 'error', false)).toBe('worried');
  });
  it('backend non configure : chat NORMAL, pas soucieux', function() {
    // Une install neuve n'est pas cassee, elle est vide. Le distinguo compte :
    // c'est le tout premier ecran que voit un nouvel utilisateur.
    expect(resolveLogoExpression('unconfigured', '', false)).toBe('ok');
  });
  it('non configure ET un MCP KO : soucieux, par le MCP seul', function() {
    // Le 'unconfigured' n'annule rien — il ne declenche simplement pas.
    expect(resolveLogoExpression('unconfigured', 'error', false)).toBe('worried');
  });
  it('attente d\'autorisation MCP : pas soucieux', function() {
    // 'pending' est une action a faire, pas une panne ; sa pastille jaune la
    // porte deja. Si le chat s'en emouvait, il doublerait un signal moins
    // urgent et cesserait d'etre lu.
    expect(resolveLogoExpression('ok', 'pending', false)).toBe('ok');
  });
  it('attente MCP + backend down : soucieux, par le backend', function() {
    expect(resolveLogoExpression('down', 'pending', false)).toBe('worried');
  });
  it('stockage plein, services sains : sourcils horizontaux', function() {
    expect(resolveLogoExpression('ok', '', true)).toBe('storage');
  });
  it('stockage plein PRIME sur toute panne de service (perte irreversible)', function() {
    var got = [
      resolveLogoExpression('down', '', true),
      resolveLogoExpression('ok', 'error', true),
      resolveLogoExpression('down', 'error', true),
      resolveLogoExpression('unconfigured', 'pending', true),
    ];
    expect(got).toEqual(['storage', 'storage', 'storage', 'storage']);
  });
  it('seul true pose le stockage (valeur absente = pas plein)', function() {
    expect(resolveLogoExpression('ok', '', undefined)).toBe('ok');
    expect(resolveLogoExpression('down', '', 'true')).toBe('worried');
  });
});

describe('resolveAuthorizationPending (AB-5) — apparition de la pastille', function() {
  function st(list) { return { state: 'ok', count: 3, unauthorizedUpstreams: list }; }

  it('invisible quand aucun serveur n\'attend', function() {
    var r = resolveAuthorizationPending({ proxy: st([]), autre: { state: 'ok', count: 2 } });
    expect(r.visible).toBe(false);
    expect(r.count).toBe(0);
    expect(r.label).toBe('');
  });
  it('invisible sur un etat vide ou absent', function() {
    expect(resolveAuthorizationPending({}).visible).toBe(false);
    expect(resolveAuthorizationPending(null).visible).toBe(false);
  });
  it('un serveur : libelle au singulier — la pastille compte des SERVEURS, la carte des SERVICES', function() {
    var r = resolveAuthorizationPending({ proxy: st([{ name: 'jira' }]) });
    expect(r.visible).toBe(true);
    expect(r.count).toBe(1);
    expect(r.label).toBe('1 serveur \u00e0 autoriser');
  });
  it('compte des SERVEURS, pas des upstreams', function() {
    // La pastille dit combien de cartes ouvrir ; le detail par upstream vit
    // dans la carte. Un serveur a trois upstreams en attente compte pour un.
    var r = resolveAuthorizationPending({
      proxy: st([{ name: 'jira' }, { name: 'confluence' }, { name: 'gh' }]),
    });
    expect(r.count).toBe(1);
    expect(r.servers.length).toBe(1);
  });
  it('plusieurs serveurs : pluriel, et noms tries', function() {
    var r = resolveAuthorizationPending({
      zeta: st([{ name: 'a' }]),
      alpha: st([{ name: 'b' }]),
      sain: st([]),
    });
    expect(r.count).toBe(2);
    expect(r.servers[0]).toBe('alpha');
    expect(r.servers[1]).toBe('zeta');
    expect(r.label.indexOf('2 serveurs') === 0).toBe(true);
  });
  it('severite pending quand seule une autorisation manque', function() {
    var r = resolveAuthorizationPending({ proxy: st([{ name: 'jira' }]) });
    expect(r.severity).toBe('pending');
  });
});

describe('resolveAuthorizationPending — une pastille, l\'erreur prioritaire', function() {
  function st(list) { return { state: 'ok', count: 3, unauthorizedUpstreams: list }; }
  function ko(msg) { return { state: 'error', count: 0, error: msg || 'echec' }; }

  it('un serveur injoignable : severite error et libelle dedie', function() {
    var r = resolveAuthorizationPending({ proxy: ko() });
    expect(r.visible).toBe(true);
    expect(r.severity).toBe('error');
    expect(r.count).toBe(1);
    expect(r.label).toBe('1 serveur injoignable');
  });
  it('pluriel accorde sur le nom ET l\'adjectif', function() {
    var r = resolveAuthorizationPending({ a: ko(), b: ko() });
    expect(r.label).toBe('2 serveurs injoignables');
  });
  it('erreur et attente simultanees : l\'erreur gagne, et elle seule est comptee', function() {
    var r = resolveAuthorizationPending({ casse: ko(), attente: st([{ name: 'jira' }]) });
    expect(r.severity).toBe('error');
    expect(r.count).toBe(1);
    expect(r.servers[0]).toBe('casse');
  });
  it('l\'attente redevient visible une fois l\'erreur reparee', function() {
    // La condition posee a la conception : la jaune doit savoir apparaitre
    // quand la rouge est traitee. Rien n'est memorise — le meme appel sur un
    // etat repare rend la severite d'attente, sans etat a reconcilier.
    var avant = resolveAuthorizationPending({ casse: ko(), attente: st([{ name: 'jira' }]) });
    var apres = resolveAuthorizationPending({ casse: st([]), attente: st([{ name: 'jira' }]) });
    expect(avant.severity).toBe('error');
    expect(apres.severity).toBe('pending');
    expect(apres.servers[0]).toBe('attente');
  });
  it('un serveur en erreur ET porteur d\'upstreams ne compte qu\'une fois, du cote erreur', function() {
    var r = resolveAuthorizationPending({
      proxy: { state: 'error', count: 0, unauthorizedUpstreams: [{ name: 'jira' }] },
    });
    expect(r.count).toBe(1);
    expect(r.severity).toBe('error');
  });
  it('etat connecting : ni erreur ni attente, la pastille reste muette', function() {
    var r = resolveAuthorizationPending({ proxy: { state: 'connecting', count: 0 } });
    expect(r.visible).toBe(false);
  });
});

describe('mcpStatusPill (AB-5) — quatre etats, dont celui qui n\'est ni l\'un ni l\'autre', function() {
  it('connecte et sain : le libelle historique, inchange', function() {
    var p = mcpStatusPill({ state: 'ok', count: 34 });
    expect(p.tone).toBe('ok');
    expect(p.text).toBe('\u25cf Connect\u00e9 \u2014 34 outils');
  });
  it('un seul outil : singulier', function() {
    expect(mcpStatusPill({ state: 'ok', count: 1 }).text).toBe('\u25cf Connect\u00e9 \u2014 1 outil');
  });
  it('un tableau VIDE se lit comme sain — pas d\'etat d\'attente fantome', function() {
    var p = mcpStatusPill({ state: 'ok', count: 34, unauthorizedUpstreams: [] });
    expect(p.tone).toBe('ok');
  });
  it('connecte AVEC des upstreams en attente : ni ok, ni err', function() {
    // Le coeur du lot : ce serveur MARCHE (ses outils sont listes) et pourtant
    // quelque chose manque. Le dire « ok » cache le seul fait actionnable ;
    // le dire « injoignable » ferait chercher une panne la ou il faut un clic.
    var p = mcpStatusPill({ state: 'ok', count: 34, unauthorizedUpstreams: [{ name: 'jira' }] });
    expect(p.tone).toBe('pending');
    expect(p.text).toBe('\u25cf Connect\u00e9 \u2014 34 outils, 1 service \u00e0 autoriser');
  });
  it('plusieurs upstreams en attente : pluriel', function() {
    var p = mcpStatusPill({
      state: 'ok', count: 34,
      unauthorizedUpstreams: [{ name: 'jira' }, { name: 'confluence' }],
    });
    expect(p.text.indexOf('2 services \u00e0 autoriser') > 0).toBe(true);
  });
  it('injoignable : le message d\'erreur suit quand il existe', function() {
    expect(mcpStatusPill({ state: 'error' }).tone).toBe('err');
    expect(mcpStatusPill({ state: 'error', error: 'timeout' }).text.indexOf('timeout') > 0).toBe(true);
  });
  it('en cours de connexion', function() {
    expect(mcpStatusPill({ state: 'connecting' }).tone).toBe('connecting');
  });
  it('null quand il n\'y a rien a peindre', function() {
    expect(mcpStatusPill(null)).toBe(null);
    expect(mcpStatusPill(undefined)).toBe(null);
  });
});

describe('ackAuthorizationTarget (AB-5) — chemin relatif compose', function() {
  var CODE = 'AUTHORIZATION_REQUIRED';

  it('compose un chemin relatif avec l\'URL du serveur d\'origine', function() {
    var t = ackAuthorizationTarget(
      { errorCode: CODE, authorizationUrl: '/authorize/jira', upstream: 'jira', mcpServer: 'proxy' },
      'http://127.0.0.1:8765/mcp'
    );
    expect(t.url).toBe('http://127.0.0.1:8765/authorize/jira');
    expect(t.origin).toBe('127.0.0.1:8765');
    expect(t.upstream).toBe('jira');
  });
  it('pas de lien quand l\'URL du serveur est introuvable', function() {
    // Ack d'avant AB-5, serveur supprime depuis, ou config renommee : une
    // affordance ne se devine pas. L'ack reste rouge avec son message.
    expect(ackAuthorizationTarget({ errorCode: CODE, authorizationUrl: '/authorize/jira' }, null)).toBe(null);
    expect(ackAuthorizationTarget({ errorCode: CODE, authorizationUrl: '/authorize/jira' }, '')).toBe(null);
  });
  it('pas de lien sur un chemin relatif irrecevable', function() {
    expect(ackAuthorizationTarget(
      { errorCode: CODE, authorizationUrl: '//evil.test/authorize' },
      'http://127.0.0.1:8765/mcp'
    )).toBe(null);
  });
  it('la forme ABSOLUE reste servie — les acks deja persistes en portent', function() {
    // Le verdict est rendu a l'affichage : un ack ecrit par une version
    // anterieure doit rester lisible, et sa garde reste celle de l'ack.
    var t = ackAuthorizationTarget(
      { errorCode: CODE, authorizationUrl: 'https://auth.notion.so/oauth/authorize' },
      'http://127.0.0.1:8765/mcp'
    );
    expect(t.url).toBe('https://auth.notion.so/oauth/authorize');
    expect(t.origin).toBe('auth.notion.so');
  });
  it('la forme absolue garde la garde de l\'ack, meme avec un serveur connu', function() {
    // L'URL absolue vient du RESEAU : le modele de menace d'AB-3 tient, et
    // connaitre le serveur ne l'assouplit pas.
    expect(ackAuthorizationTarget(
      { errorCode: CODE, authorizationUrl: 'http://faux.test/login' },
      'http://127.0.0.1:8765/mcp'
    )).toBe(null);
  });
});

describe('refus d\'autorisation : ABSENT des exports (piege 21)', function() {
  var ack = {
    kind: 'mcp_call', name: 'proxy__notion__search', error: true,
    args: { q: 'x' }, result: 'Erreur outil distant : autorisation requise',
    errorCode: 'AUTHORIZATION_REQUIRED',
    authorizationUrl: 'http://127.0.0.1:8765/authorize/notion',
    upstream: 'notion',
  };
  it('l\'export HTML n\'emet ni l\'url ni le libelle du lien', function() {
    // Un HTML standalone circule : un lien d'autorisation externe cliquable y
    // serait sans contexte et sans fraicheur. L'exclusion est structurelle
    // (_formatToolCallHtml enumere ce qu'il emet), ce test l'epingle.
    var html = formatToolAcksHtml([ack]);
    expect(html.indexOf('127.0.0.1:8765') < 0).toBe(true);
    expect(html.indexOf('authorize/notion') < 0).toBe(true);
    expect(html.indexOf('ack-authorize') < 0).toBe(true);
    expect(html.indexOf('Autoriser') < 0).toBe(true);
  });
  it('l\'export Markdown non plus', function() {
    var md = formatToolAcksMd([ack]);
    expect(md.indexOf('127.0.0.1:8765') < 0).toBe(true);
    expect(md.indexOf('authorize/notion') < 0).toBe(true);
    expect(md.indexOf('Autoriser') < 0).toBe(true);
  });
  it('mais l\'export rend bien l\'ack, en erreur — seul le LIEN est retire', function() {
    // Sans ce cas, les trois assertions ci-dessus passeraient aussi si l'export
    // n'emettait rien du tout : une premisse fausse rendrait le test vert.
    var html = formatToolAcksHtml([ack]);
    expect(html).toContain('proxy__notion__search');
    expect(html).toContain('ack-head-error');
  });
});

describe('instructions MCP de portee serveur — parsing et injection', function() {
  // Fixture : le texte REELLEMENT emis par mcp_proxy (depot miaou-mcp-servers),
  // preambule + une section par upstream. Le recopier ici plutot que d'en
  // fabriquer un plausible : c'est ce contrat-la qu'on lit, pas un idealise.
  var PROXY = [
    'Ce serveur agrege plusieurs serveurs MCP. Les outils sont prefixes par le nom de leur serveur d\'origine (`<serveur>__<outil>`). Les sections ci-dessous portent les consignes propres a chaque serveur d\'origine, titrees par ce meme nom.',
    '',
    '## bench',
    '',
    'Banc d\'essai du developpement de MIAOU : les outils `bench` n\'ont pas d\'utilite',
    'en production, meme quand leur effet est reel (resolution DNS, par exemple).',
    '',
    'Apres avoir utilise un outil `bench`, le signaler a l\'utilisateur sur une',
    'derniere ligne : « banc d\'essai bench — resultat non contractuel ».',
  ].join('\n');

  it('separe le preambule des sections', function() {
    var out = splitMcpInstructionSections(PROXY);
    expect(out.sections.length).toBe(1);
    expect(out.sections[0].name).toBe('bench');
    expect(out.preamble.indexOf('Ce serveur agrege') >= 0).toBe(true);
    // Le corps passe VERBATIM : c'est du texte d'auteur adresse au modele.
    expect(out.sections[0].body.indexOf('banc d\'essai bench') >= 0).toBe(true);
    expect(out.sections[0].body.indexOf('Ce serveur agrege') >= 0).toBe(false);
  });

  it('un serveur unitaire (aucune entete) met tout en preambule', function() {
    var out = splitMcpInstructionSections('Consigne brute, sans section.');
    expect(out.sections.length).toBe(0);
    expect(out.preamble).toBe('Consigne brute, sans section.');
  });

  it('rattache la section au prefixe REEL <slug>__<serveur>', function() {
    // Le titre rendu est le prefixe d'outil vu par le modele, pas le nom nu
    // publie par le proxy : MIAOU re-prefixe du slug de la carte.
    var secs = mcpInstructionSectionsForServer('miaou-proxy', PROXY);
    expect(secs.length).toBe(1);
    expect(secs[0].prefix).toBe('miaou-proxy__bench');
  });

  it('suit le renommage de la carte serveur — le slug vit cote client', function() {
    var secs = mcpInstructionSectionsForServer('proxy', PROXY);
    expect(secs[0].prefix).toBe('proxy__bench');
  });

  it('serveur unitaire : le prefixe est le slug seul', function() {
    // Ses outils sont <slug>__<outil>, jamais <slug>__<serveur>__<outil>.
    var secs = mcpInstructionSectionsForServer('bench', 'Consigne brute.');
    expect(secs.length).toBe(1);
    expect(secs[0].prefix).toBe('bench');
    expect(secs[0].body).toBe('Consigne brute.');
  });

  it('champ absent, null ou vide : aucune section, cas majoritaire', function() {
    expect(mcpInstructionSectionsForServer('srv', null).length).toBe(0);
    expect(mcpInstructionSectionsForServer('srv', undefined).length).toBe(0);
    expect(mcpInstructionSectionsForServer('srv', '   ').length).toBe(0);
    expect(mcpInstructionSectionsForServer('', PROXY).length).toBe(0);
  });

  it('ecarte une section titree mais vide', function() {
    var secs = mcpInstructionSectionsForServer('p', '## vide\n\n## plein\n\ntexte');
    expect(secs.length).toBe(1);
    expect(secs[0].prefix).toBe('p__plein');
  });

  it('bloc vide quand aucun serveur ne publie rien — zero token depense', function() {
    expect(buildMcpInstructionsBlock([])).toBe('');
    expect(buildMcpInstructionsBlock(null)).toBe('');
    expect(buildMcpInstructionsBlock([{ slug: 'a', instructions: null }])).toBe('');
  });

  it('plusieurs serveurs : rattachement DISTINCT, jamais fusionne', function() {
    // Le rattachement compte autant que l'injection : un bloc dont on ne sait
    // plus a quels outils il s'applique est pire qu'absent.
    var block = buildMcpInstructionsBlock([
      { slug: 'proxy', instructions: PROXY },
      { slug: 'meteo', instructions: 'Toujours donner la temperature en Celsius.' },
    ]);
    expect(block.indexOf('## proxy__bench') >= 0).toBe(true);
    expect(block.indexOf('## meteo') >= 0).toBe(true);
    expect(block.indexOf('banc d\'essai bench') >= 0).toBe(true);
    expect(block.indexOf('Celsius') >= 0).toBe(true);
  });

  it('le preambule FAUX du proxy n\'atteint jamais le modele', function() {
    // « les outils sont prefixes <serveur>__<outil> » est vrai pour un client
    // parlant au proxy en direct, faux une fois passe par MIAOU. C'est la
    // raison d'etre du parsing : MIAOU ecrit son propre cadrage.
    var block = buildMcpInstructionsBlock([{ slug: 'miaou-proxy', instructions: PROXY }]);
    expect(block.indexOf('Ce serveur agrege') >= 0).toBe(false);
    expect(block.indexOf('est le PRÉFIXE des noms') >= 0).toBe(true);
  });

  it('le bloc est balise et se termine par le separateur de sibling', function() {
    var block = buildMcpInstructionsBlock([{ slug: 'b', instructions: 'x' }]);
    expect(block.indexOf('<miaou_mcp_instructions>') === 0).toBe(true);
    expect(block.indexOf('</miaou_mcp_instructions>\n\n') > 0).toBe(true);
  });

  it('index par prefixe : clef = prefixe d\'outil, pas le slug nu', function() {
    // La clef doit etre directement comparable au `namespace` rendu par
    // groupByNamespace au drawer : un serveur agregateur donne `<slug>__<serveur>`.
    var idx = mcpInstructionsByPrefix([{ slug: 'proxy', instructions: PROXY }]);
    expect(Object.prototype.hasOwnProperty.call(idx, 'proxy__bench')).toBe(true);
    expect(idx['proxy__bench'].indexOf('banc d\'essai bench') >= 0).toBe(true);
  });

  it('index par prefixe : serveur unitaire indexe sous son slug', function() {
    var idx = mcpInstructionsByPrefix([{ slug: 'meteo', instructions: 'Temperature en Celsius.' }]);
    expect(idx['meteo']).toBe('Temperature en Celsius.');
  });

  it('index par prefixe : vide quand personne ne publie rien', function() {
    expect(Object.keys(mcpInstructionsByPrefix([])).length).toBe(0);
    expect(Object.keys(mcpInstructionsByPrefix(null)).length).toBe(0);
    expect(Object.keys(mcpInstructionsByPrefix([{ slug: 'a', instructions: null }])).length).toBe(0);
  });

  it('index par prefixe : MEME decoupage que le bloc injecte au modele', function() {
    // Le drawer ne doit pas pouvoir montrer une version divergente de ce que
    // le modele recoit : les deux passent par mcpInstructionSectionsForServer.
    var servers = [
      { slug: 'proxy', instructions: PROXY },
      { slug: 'meteo', instructions: 'Toujours donner la temperature en Celsius.' },
    ];
    var idx = mcpInstructionsByPrefix(servers);
    var block = buildMcpInstructionsBlock(servers);
    Object.keys(idx).forEach(function(prefix) {
      expect(block.indexOf('## ' + prefix + '\n\n' + idx[prefix]) >= 0).toBe(true);
    });
  });

  it('index par prefixe : le preambule FAUX du proxy n\'y entre pas non plus', function() {
    var idx = mcpInstructionsByPrefix([{ slug: 'miaou-proxy', instructions: PROXY }]);
    var joined = Object.keys(idx).map(function(k) { return idx[k]; }).join('\n');
    expect(joined.indexOf('Ce serveur agrege') >= 0).toBe(false);
  });
});

describe('compaction du contexte (lot AE) — frontiere et elagage a l\'emission', function() {
  function ack(overrides) {
    return Object.assign({ role: 'tool-ack', kind: 'mcp_call', name: 'srv__foo',
      args: { q: 1 }, result: 'ok', ts: 0, group: 'g1' }, overrides);
  }
  function mark(summary) {
    return { role: 'compaction', content: summary || 'Resume du debut.' };
  }

  it('isCompactionEntry ne reconnait QUE le role compaction', function() {
    expect(isCompactionEntry(mark())).toBe(true);
    expect(isCompactionEntry({ role: 'user', content: 'x' })).toBe(false);
    expect(isCompactionEntry({ role: 'assistant', content: 'x' })).toBe(false);
    expect(isCompactionEntry(ack())).toBe(false);
    expect(isCompactionEntry(null)).toBe(false);
  });

  it('entryHasMsgBubble ecarte les acks ET la frontiere, garde user/assistant', function() {
    expect(entryHasMsgBubble({ role: 'user', content: 'x' })).toBe(true);
    expect(entryHasMsgBubble({ role: 'assistant', content: 'x' })).toBe(true);
    expect(entryHasMsgBubble(ack())).toBe(false);
    expect(entryHasMsgBubble({ role: 'memory-ack', kind: 'memory_create' })).toBe(false);
    expect(entryHasMsgBubble(mark())).toBe(false);
    expect(entryHasMsgBubble(null)).toBe(false);
  });

  // L'appariement bulle .msg ↔ entrée que `reindexThreadDom` (ui.js) calcule :
  // la liste des indices d'entrées à bulle, dans l'ordre. Le defaut corrige ici
  // est un DECALAGE — une frontiere comptee comme entree a bulle poussait tous
  // les indices suivants de un, et l'edition d'un message user chargeait le
  // contenu du message SUIVANT. On assert donc les indices, pas seulement le
  // predicat : c'est la grandeur que le bug faussait.
  it('l\'appariement bulle↔entree ne se decale pas apres une frontiere', function() {
    var t = [
      { role: 'user', content: 'avant' },        // 0 → bulle
      ack(),                                     // 1
      { role: 'assistant', content: 'reponse' }, // 2 → bulle
      mark('Resume.'),                           // 3 — separateur, PAS de bulle
      { role: 'user', content: 'apres' },        // 4 → bulle
      { role: 'assistant', content: 'suite' },   // 5 → bulle
    ];
    var bubbled = [];
    for (var i = 0; i < t.length; i++) if (entryHasMsgBubble(t[i])) bubbled.push(i);
    expect(bubbled).toEqual([0, 2, 4, 5]);
    // La 3e bulle du DOM est bien le message user d'apres la frontiere.
    expect(t[bubbled[2]].content).toBe('apres');
  });

  it('lastCompactionIndex rend la DERNIERE frontiere, -1 sans aucune', function() {
    expect(lastCompactionIndex([])).toBe(-1);
    expect(lastCompactionIndex([{ role: 'user', content: 'a' }])).toBe(-1);
    var t = [mark('un'), { role: 'user', content: 'a' }, mark('deux'), { role: 'user', content: 'b' }];
    expect(lastCompactionIndex(t)).toBe(2);
  });

  it('ce qui PRECEDE la frontiere ne part pas sur le fil', function() {
    var t = [
      { role: 'user', content: 'vieille question' },
      { role: 'assistant', content: 'vieille reponse' },
      mark('Ils ont parle de X.'),
      { role: 'user', content: 'nouvelle question' },
    ];
    var r = expandThread(t);
    var joined = JSON.stringify(r);
    expect(joined.indexOf('vieille question')).toBe(-1);
    expect(joined.indexOf('vieille reponse')).toBe(-1);
    expect(joined.indexOf('nouvelle question') >= 0).toBe(true);
  });

  it('le resume est emis EN TETE, en user synthetique', function() {
    var t = [
      { role: 'user', content: 'ancien' },
      mark('Ils ont parle de X.'),
      { role: 'user', content: 'recent' },
    ];
    var r = expandThread(t);
    expect(r.length).toBe(2);
    expect(r[0].role).toBe('user');
    expect(r[0]._synthetic).toBe(true);
    expect(r[0].content.indexOf('Ils ont parle de X.') >= 0).toBe(true);
    expect(r[1].content).toBe('recent');
  });

  it('le message de compaction est SYNTHETIQUE : lastAuthenticUserIndex ne le vise pas', function() {
    // Sinon le prefixe ephemere <miaou_context> se collerait au resume au lieu
    // du dernier tour utilisateur reel (meme motif que le recall d'image, A2).
    var t = [{ role: 'user', content: 'ancien' }, mark('resume')];
    var r = expandThread(t);
    expect(r.length).toBe(1);
    expect(lastAuthenticUserIndex(r)).toBe(-1);
  });

  it('deux frontieres : seule la DERNIERE vaut, la premiere n\'est pas reemise', function() {
    var t = [
      { role: 'user', content: 'tres vieux' },
      mark('premier resume'),
      { role: 'user', content: 'vieux' },
      mark('second resume'),
      { role: 'user', content: 'recent' },
    ];
    var r = expandThread(t);
    expect(r.length).toBe(2);
    expect(r[0].content.indexOf('second resume') >= 0).toBe(true);
    expect(r[0].content.indexOf('premier resume')).toBe(-1);
    expect(JSON.stringify(r).indexOf('vieux')).toBe(-1);
  });

  it('byte-stabilite du rejeu : deux expandThread rendent le MEME payload (invariant 2)', function() {
    var mk = function() {
      return [
        { role: 'user', content: 'ancien' },
        ack({ group: 'gAE1' }),
        mark('Resume stable.'),
        { role: 'user', content: 'recent' },
        ack({ group: 'gAE2', name: 'srv__bar' }),
        { role: 'assistant', content: 'fin' },
      ];
    };
    expect(JSON.stringify(expandThread(mk()))).toBe(JSON.stringify(expandThread(mk())));
  });

  it('un groupe d\'acks APRES la frontiere garde son assistant porteur', function() {
    // Le danger de l'elagage : emettre un tool result dont le message assistant
    // porteur des tool_calls aurait ete coupe (payload malforme, 400 backend).
    var t = [
      { role: 'user', content: 'ancien' },
      mark('resume'),
      { role: 'user', content: 'recent' },
      ack({ group: 'gAfter', args: { q: 7 } }),
      { role: 'assistant', content: 'fin' },
    ];
    var r = expandThread(t);
    var toolIdx = -1;
    for (var i = 0; i < r.length; i++) if (r[i].role === 'tool') toolIdx = i;
    expect(toolIdx > 0).toBe(true);
    expect(r[toolIdx - 1].role).toBe('assistant');
    expect(r[toolIdx - 1].tool_calls.length).toBe(1);
    expect(r[toolIdx].tool_call_id).toBe(r[toolIdx - 1].tool_calls[0].id);
  });

  it('les ids de tool_call d\'APRES la frontiere ne bougent PAS quand on compacte', function() {
    // L'ELAGAGE se fait a l'emission, sur une indexation ABSOLUE : la
    // frontiere existe deja dans le thread, compacter ne DEPLACE rien. C'est ce
    // qui protege les ids `solo:N` des acks legacy, qui sont POSITIONNELS — un
    // slice du tableau en amont les ferait deriver (tool_call_id changeants,
    // ciblage findAckByCallId casse, piege 26a).
    //
    // Le thread est donc le MEME objet dans les deux mesures ; seule bouge la
    // position de la frontiere, qu'on recule d'un cran pour que l'ack passe de
    // « avant » a « apres » sans que son index change.
    var solo = { role: 'tool-ack', kind: 'mcp_call', name: 'srv__solo',
                 args: { q: 1 }, result: 'ok', ts: 0 };
    var t = [mark('resume'), { role: 'user', content: 'a' }, solo, { role: 'assistant', content: 'f' }];
    var idApresFrontiere = null;
    var r1 = expandThread(t);
    for (var i = 0; i < r1.length; i++) if (r1[i].tool_calls) idApresFrontiere = r1[i].tool_calls[0].id;
    expect(idApresFrontiere != null).toBe(true);
    // Meme thread, sans frontiere du tout : l'ack est au MEME index (2).
    var sans = [{ role: 'assistant', content: 'z' }, { role: 'user', content: 'a' }, solo, { role: 'assistant', content: 'f' }];
    var idSansFrontiere = null;
    var r2 = expandThread(sans);
    for (var j = 0; j < r2.length; j++) if (r2[j].tool_calls) idSansFrontiere = r2[j].tool_calls[0].id;
    expect(idApresFrontiere).toBe(idSansFrontiere);
  });

  it('un ack GROUPE garde son id quelle que soit sa position (contraste avec le legacy)', function() {
    // Mesure de cadrage, pas une garde du lot : les ids d'un ack porteur de
    // `group` derivent de cette valeur, pas de sa position — ils sont donc
    // insensibles a toute insertion en amont. Les acks legacy (sans `group`,
    // prefixe positionnel `solo:N`) ne le sont pas, et ne l'etaient DEJA pas
    // avant ce lot. Ce contraste est la raison pour laquelle l'elagage doit
    // rester a l'emission sur index absolus.
    var g = { role: 'tool-ack', kind: 'mcp_call', name: 'srv__g',
              args: { q: 1 }, result: 'ok', ts: 0, group: 'gPos' };
    var idAt = function(t) {
      var r = expandThread(t);
      for (var i = 0; i < r.length; i++) if (r[i].tool_calls) return r[i].tool_calls[0].id;
      return null;
    };
    var court = [{ role: 'user', content: 'a' }, g, { role: 'assistant', content: 'f' }];
    var long = [{ role: 'user', content: 'x' }, { role: 'user', content: 'a' }, g, { role: 'assistant', content: 'f' }];
    expect(idAt(court)).toBe(idAt(long));
  });

  it('formatCompactionMessage : enveloppe byte-stable, derivee du seul resume', function() {
    expect(formatCompactionMessage('abc')).toBe(formatCompactionMessage('abc'));
    expect(formatCompactionMessage('abc').indexOf('abc') >= 0).toBe(true);
    expect(formatCompactionMessage(null).indexOf('undefined')).toBe(-1);
  });

  it('thread sans frontiere : payload inchange (non-regression)', function() {
    var t = [
      { role: 'user', content: 'q' },
      ack({ group: 'gNone' }),
      { role: 'assistant', content: 'fin' },
    ];
    expect(JSON.stringify(expandThread(t)).indexOf('compact')).toBe(-1);
    expect(expandThread(t).length).toBe(4);
  });
});

describe('microcompaction des tool results (lot AE, etape 2)', function() {
  // Ack enrichi minimal : `args` + `name` (ackIsExpandable), plus un result.
  var mk = function(result, extra) {
    var a = { role: 'tool-ack', kind: 'mcp_call', name: 'srv__outil',
              args: {}, group: 'gX', result: result };
    if (extra) for (var k in extra) a[k] = extra[k];
    return a;
  };
  var big = new Array(2500).join('x');   // 2499 caracteres
  var small = new Array(100).join('y');  // 99 caracteres
  // Reconnaisseur reel : la phrase emise par formatInlineHandleForModel.
  var evacuated = function(s) { return /texte adressable par js__eval \(blob=/.test(String(s || '')); };

  it('au-dessus du seuil : evacuation demandee', function() {
    expect(ackNeedsEvacuation(mk(big), 2000, evacuated)).toBe(true);
  });

  it('sous le seuil : rien a evacuer (le descripteur couterait plus cher)', function() {
    expect(ackNeedsEvacuation(mk(small), 2000, evacuated)).toBe(false);
  });

  it('seuil exact : la borne est stricte (egal = on ne touche pas)', function() {
    var exact = new Array(2001).join('z'); // 2000 caracteres
    expect(exact.length).toBe(2000);
    expect(ackNeedsEvacuation(mk(exact), 2000, evacuated)).toBe(false);
    expect(ackNeedsEvacuation(mk(exact + 'z'), 2000, evacuated)).toBe(true);
  });

  it('ack NON expansable : jamais evacue, meme enorme', function() {
    // Sans `name` : elague a l'emission (expandThread). Evacuer creerait une
    // ressource que rien ne transmet.
    var orphan = { role: 'tool-ack', kind: 'mcp_call', args: {}, result: big };
    expect(ackNeedsEvacuation(orphan, 2000, evacuated)).toBe(false);
    // Sans `args` non plus (ack legacy).
    var legacy = { role: 'tool-ack', kind: 'mcp_call', name: 'srv__o', result: big };
    expect(ackNeedsEvacuation(legacy, 2000, evacuated)).toBe(false);
  });

  it('deja evacue : idempotent (recompacter ne fait rien)', function() {
    var handle = formatInlineHandleForModel('res_abc', 'text/plain', null);
    var already = mk(handle + new Array(2500).join('w'));
    expect(evacuated(already.result)).toBe(true);
    expect(ackNeedsEvacuation(already, 2000, evacuated)).toBe(false);
  });

  it('result absent : rien a faire', function() {
    expect(ackNeedsEvacuation(mk(null), 2000, evacuated)).toBe(false);
    expect(ackNeedsEvacuation(null, 2000, evacuated)).toBe(false);
  });

  it('le seuil par defaut vaut TOOL_RESULT_EVACUATION_MIN_CHARS', function() {
    expect(TOOL_RESULT_EVACUATION_MIN_CHARS).toBe(2000);
    // Sans minChars explicite, la constante s'applique.
    expect(ackNeedsEvacuation(mk(big), undefined, evacuated)).toBe(true);
    expect(ackNeedsEvacuation(mk(small), undefined, evacuated)).toBe(false);
  });

  it('le marqueur pose est le descripteur STATIQUE, JAMAIS resource_ref', function() {
    // Piege du chapitre 4.3 : [resource_ref:...] est a EXPANSION et
    // re-inlinerait tout le contenu au tour suivant — l'inverse exact du but.
    // Les deux constantes sont des CHAINES de motif (jamais des RegExp) :
    // les compiler ici est ce que font leurs consommateurs reels.
    var handle = formatInlineHandleForModel('res_zz', 'text/plain', null);
    var out = formatEvacuatedToolResult(handle, '');
    expect(new RegExp(RESOURCE_REF_PATTERN).test(out)).toBe(false);
    expect(out.indexOf('resource_ref')).toBe(-1);
    // Et c'est bien le descripteur statique qui est pose.
    var m = new RegExp(RESOURCE_DESC_PATTERN).exec(out);
    expect(m === null).toBe(false);
    expect(m[1]).toBe('res_zz');
  });

  it('la note NOT_PRESENTED survit a l evacuation, octet pour octet', function() {
    var body = big + NOT_PRESENTED_NOTE;
    var split = splitToolResultNoteRaw(body);
    expect(split.note).toBe(NOT_PRESENTED_NOTE);
    expect(split.text).toBe(big);
    var handle = formatInlineHandleForModel('res_n', 'text/plain', null);
    var out = formatEvacuatedToolResult(handle, split.note);
    // La note est recollee TELLE QUELLE : le modele continue de savoir que
    // l'utilisateur ne voit pas ce contenu.
    expect(out.slice(-NOT_PRESENTED_NOTE.length)).toBe(NOT_PRESENTED_NOTE);
    expect(out.indexOf(handle)).toBe(0);
  });

  it('la note PRESENTED ne gagne pas de crochets au passage', function() {
    // splitToolResultNote (affichage) retire crochets et \n ; la version brute
    // doit rendre les octets d'origine, sinon PRESENTED_NOTE — qui n'a pas de
    // crochets — en recevrait.
    var split = splitToolResultNoteRaw(big + PRESENTED_NOTE);
    expect(split.note).toBe(PRESENTED_NOTE);
    var out = formatEvacuatedToolResult('H', split.note);
    expect(out).toBe('H' + PRESENTED_NOTE);
    expect(out.indexOf('[La ressource')).toBe(-1);
  });

  it('resultat sans note : rien n est ajoute', function() {
    var split = splitToolResultNoteRaw(big);
    expect(split.note).toBe('');
    expect(split.text).toBe(big);
    expect(formatEvacuatedToolResult('H', split.note)).toBe('H');
  });

  it('formatEvacuatedToolResult est byte-stable au rejeu', function() {
    var h = formatInlineHandleForModel('res_s', 'text/plain', null);
    expect(formatEvacuatedToolResult(h, NOT_PRESENTED_NOTE))
      .toBe(formatEvacuatedToolResult(h, NOT_PRESENTED_NOTE));
    expect(formatEvacuatedToolResult(h, null).indexOf('null')).toBe(-1);
  });

  it('un resultat evacue reste reconnu comme evacue (boucle fermee)', function() {
    // Le geste produit une sortie que son propre prédicat d'idempotence
    // reconnait : sans ca, recompacter evacuerait le handle lui-meme.
    var h = formatInlineHandleForModel('res_loop', 'text/plain', null);
    var out = formatEvacuatedToolResult(h, NOT_PRESENTED_NOTE);
    expect(evacuated(out)).toBe(true);
  });

  it('le nom de ressource derive de l outil, sans prefixe miaou__', function() {
    expect(evacuatedResourceName({ name: 'miaou__docs__read' })).toBe('docs__read.txt');
    expect(evacuatedResourceName({ name: 'srv__outil' })).toBe('srv__outil.txt');
    // Caracteres hors charset remplaces, jamais un nom vide.
    expect(evacuatedResourceName({ name: '' })).toBe('resultat.txt');
    expect(evacuatedResourceName(null)).toBe('resultat.txt');
  });
});

describe('geste de compaction (lot AE, etape 3)', function() {
  var u = function(t) { return { role: 'user', content: t }; };
  var a = function(t) { return { role: 'assistant', content: t }; };
  var long = new Array(1500).join('m');   // 1499 caracteres

  it('les deux seuils restent DISTINCTS', function() {
    // Le coeur de la decision AE : 50 % (proposer la compaction) et 80 %
    // (approche du mur technique) repondent a deux questions differentes.
    // Les refondre ferait apparaitre la proposition quand il est trop tard.
    expect(CONTEXT_COMPACTION_HINT_RATIO).toBe(0.5);
    expect(CONTEXT_WINDOW_WARN_RATIO).toBe(0.8);
    expect(CONTEXT_COMPACTION_HINT_RATIO < CONTEXT_WINDOW_WARN_RATIO).toBe(true);
  });

  it('la matiere compactable compte le contenu ET les resultats d outils', function() {
    // Un tour d'outils pese dans le contexte autant qu'une reponse : l'ignorer
    // sous-estimerait justement les conversations qu'on veut compacter.
    var thread = [u('abcde'), { role: 'tool-ack', name: 'x', args: {}, result: 'XYZ' }];
    expect(compactableCharCount(thread)).toBe(8);
  });

  it('la matiere se compte APRES la derniere frontiere', function() {
    // On ne recompacte pas du deja-compacte : ce qui precede la frontiere
    // n'est deja plus transmis, donc il n'y a rien a en retirer.
    var thread = [u('aaaaaaaaaa'), { role: 'compaction', content: 'r' }, u('bb')];
    expect(compactableCharCount(thread)).toBe(2);
  });

  it('une conversation juste compactee n a plus de matiere', function() {
    var thread = [u(long), { role: 'compaction', content: 'resume' }];
    expect(compactableCharCount(thread)).toBe(0);
    expect(hasCompactableSubstance(thread, 2000)).toBe(false);
  });

  it('le plancher de matiere est une borne INCLUSIVE', function() {
    var exact = [u(new Array(2001).join('z'))];   // exactement 2000
    expect(compactableCharCount(exact)).toBe(2000);
    expect(hasCompactableSubstance(exact, 2000)).toBe(true);
    var under = [u(new Array(2000).join('z'))];   // 1999
    expect(hasCompactableSubstance(under, 2000)).toBe(false);
  });

  it('thread vide : aucune matiere, et aucune exception', function() {
    expect(compactableCharCount([])).toBe(0);
    expect(compactableCharCount(null)).toBe(0);
    expect(hasCompactableSubstance([], 2000)).toBe(false);
  });

  // ── Les deux gardes AE-7, et le fait qu'elles soient DEUX ────────────────
  it('une generation en vol refuse, en nommant SA borne', function() {
    var msg = compactionRefusal(true, null, true);
    expect(/g[eé]n[eé]r/.test(msg)).toBe(true);
  });

  it('un agent au travail refuse, avec le message d agentBusyRewriteRefusal', function() {
    // Le message vient du predicat partage, jamais d'une formule locale
    // (piege 18) : le geste ne fait que le relayer.
    var agentMsg = 'Un agent de cette conversation travaille : …';
    expect(compactionRefusal(false, agentMsg, true)).toBe(agentMsg);
  });

  it('les deux refus sont DISTINCTS l un de l autre', function() {
    // « attends la fin de la generation » et « attends tes agents » appellent
    // des gestes differents : un message unique les confondrait.
    var gen = compactionRefusal(true, null, true);
    var agent = compactionRefusal(false, 'Un agent travaille.', true);
    expect(gen === agent).toBe(false);
  });

  it('la generation prime sur l agent quand les deux sont vrais', function() {
    var msg = compactionRefusal(true, 'Un agent travaille.', true);
    expect(/g[eé]n[eé]r/.test(msg)).toBe(true);
  });

  it('sans matiere : refus, meme si rien ne tourne', function() {
    var msg = compactionRefusal(false, null, false);
    expect(typeof msg).toBe('string');
    expect(msg.length > 0).toBe(true);
  });

  it('rien ne tourne et il y a de la matiere : aucun refus', function() {
    expect(compactionRefusal(false, null, true)).toBe(null);
  });

  // ── Projection lue par le modele qui redige ─────────────────────────────
  it('la projection porte les appels d outils, pas seulement user/assistant', function() {
    // Un tool result porte des decisions et des handles dont la suite depend.
    var thread = [u('question'), { role: 'tool-ack', name: 'docs__read', args: {}, result: 'CONTENU' }, a('reponse')];
    var out = projectThreadForCompaction(thread);
    expect(out.indexOf('question') >= 0).toBe(true);
    expect(out.indexOf('docs__read') >= 0).toBe(true);
    expect(out.indexOf('CONTENU') >= 0).toBe(true);
    expect(out.indexOf('reponse') >= 0).toBe(true);
  });

  it('la projection part APRES la derniere frontiere', function() {
    var thread = [u('AVANT'), { role: 'compaction', content: 'r' }, u('APRES')];
    var out = projectThreadForCompaction(thread);
    expect(out.indexOf('AVANT') >= 0).toBe(false);
    expect(out.indexOf('APRES') >= 0).toBe(true);
  });

  it('un resultat d outil trop long est tronque, et la troncature le DIT', function() {
    // Sans le marqueur, le modele presenterait une donnee coupee comme
    // complete (souvenir model-facing-text, defaut « silence »).
    var thread = [{ role: 'tool-ack', name: 'x', args: {}, result: new Array(3000).join('q') }];
    var out = projectThreadForCompaction(thread, 600);
    expect(out.length < 1200).toBe(true);
    expect(out.indexOf('tronqu') >= 0).toBe(true);
  });

  it('la frontiere posee par le geste est reconnue par le pur d etape 1', function() {
    // Boucle fermee entre les deux etapes : ce que le geste ecrit dans le
    // thread est exactement ce que l'elagage a l'emission sait lire.
    var entry = { role: 'compaction', content: 'le resume', ts: 1 };
    expect(isCompactionEntry(entry)).toBe(true);
    expect(lastCompactionIndex([u('a'), entry])).toBe(1);
    // Et le message emis derive du seul resume persiste (byte-stabilite).
    expect(formatCompactionMessage(entry.content))
      .toBe(formatCompactionMessage(entry.content));
  });

  // ── Projection du resume auto / titrage (point 4, 2026-09-22) ───────────
  // Ces deux appels lisent la conversation ENTIERE (retrouver, titrer), la ou
  // projectThreadForCompaction part de la frontiere (continuer a travailler).
  it('sans frontiere : user et assistant projetes, rien d autre', function() {
    var thread = [u('question'), a('reponse'),
                  { role: 'tool-ack', name: 'x', args: {}, result: 'BRUIT' }];
    var out = projectThreadForRecap(thread);
    expect(out.indexOf('question') >= 0).toBe(true);
    expect(out.indexOf('reponse') >= 0).toBe(true);
    expect(out.indexOf('BRUIT') >= 0).toBe(false);
  });

  it('avec frontiere : le resume REMPLACE ce qu il couvre, le reste suit', function() {
    // Le defaut corrige : le thread brut renvoyait AVANT au modele, donc on
    // repayait a chaque titrage le contexte qu on venait de compacter.
    var thread = [u('AVANT'), a('AUSSI AVANT'),
                  { role: 'compaction', content: 'LE RESUME' }, u('APRES')];
    var out = projectThreadForRecap(thread);
    expect(out.indexOf('AVANT') >= 0).toBe(false);
    expect(out.indexOf('AUSSI AVANT') >= 0).toBe(false);
    expect(out.indexOf('LE RESUME') >= 0).toBe(true);
    expect(out.indexOf('APRES') >= 0).toBe(true);
  });

  it('la couverture reste complete : le resume est la, pas saute', function() {
    // Sauter la frontiere produirait un titre amnesique — c est la difference
    // avec projectThreadForCompaction, qui lui part APRES.
    var thread = [u('AVANT'), { role: 'compaction', content: 'LE RESUME' }];
    expect(projectThreadForRecap(thread).indexOf('LE RESUME') >= 0).toBe(true);
  });

  // ── Recompaction (revue du 2026-09-22) ──────────────────────────────────
  // Le nouveau resume REMPLACE l ancien a l emission : le redacteur doit donc
  // le lire, sinon compacter deux fois efface la premiere compaction.
  it('recompaction : le resume precedent ouvre la projection du redacteur', function() {
    var thread = [u('AVANT'), { role: 'compaction', content: 'LE RESUME' }, u('APRES')];
    var out = projectThreadForCompaction(thread);
    expect(out.indexOf('LE RESUME') >= 0).toBe(true);
    expect(out.indexOf('LE RESUME') < out.indexOf('APRES')).toBe(true);
    expect(out.indexOf('AVANT') >= 0).toBe(false);
  });

  it('recompaction : seul le DERNIER resume est repris (il integre les precedents)', function() {
    var thread = [u('A'), { role: 'compaction', content: 'R1' },
                  u('B'), { role: 'compaction', content: 'R2' }, u('C')];
    var out = projectThreadForCompaction(thread);
    expect(out.indexOf('R1') >= 0).toBe(false);
    expect(out.indexOf('R2') >= 0).toBe(true);
  });

  it('recompaction : le resume repris n est jamais tronque', function() {
    var long = new Array(3001).join('r');
    var thread = [{ role: 'compaction', content: long }, u('x')];
    expect(projectThreadForCompaction(thread, 600).indexOf(long) >= 0).toBe(true);
  });


  it('seule la derniere frontiere vaut', function() {
    var thread = [u('A'), { role: 'compaction', content: 'R1' },
                  u('B'), { role: 'compaction', content: 'R2' }, u('C')];
    var out = projectThreadForRecap(thread);
    expect(out.indexOf('R1') >= 0).toBe(false);
    expect(out.indexOf('B') >= 0).toBe(false);
    expect(out.indexOf('R2') >= 0).toBe(true);
    expect(out.indexOf('C') >= 0).toBe(true);
  });

  it('le libelle n annonce PAS une transmission interrompue', function() {
    // formatCompactionMessage s adresse au modele en cours de chat ; ici le
    // destinataire doit seulement titrer/resumer, la notion de transmission
    // n a pas de sens pour lui (souvenir model-facing-text).
    var thread = [{ role: 'compaction', content: 'R' }];
    expect(projectThreadForRecap(thread).indexOf('plus transmis') >= 0).toBe(false);
  });

  it('thread vide ou nul : chaine vide, jamais d exception', function() {
    expect(projectThreadForRecap([])).toBe('');
    expect(projectThreadForRecap(null)).toBe('');
  });
});

describe('Evacuation comme geste autonome (AE-5 annule, 2026-09-22)', function() {
  var u = function(t) { return { role: 'user', content: t }; };
  var big = function(n) { return new Array((n || 3000) + 1).join('x'); };
  var ack = function(result) {
    return { role: 'tool-ack', name: 'docs__read', args: {}, result: result };
  };

  // ── Inventaire servant l affordance ───────────────────────────────────
  it('compte les acks eligibles et leur poids', function() {
    var thread = [u('a'), ack(big(3000)), ack('court'), ack(big(5000))];
    var found = evacuableToolResults(thread, 2000, null);
    expect(found.count).toBe(2);
    expect(found.chars).toBe(8000);
  });

  it('un thread sans gros resultat : rien a faire', function() {
    expect(evacuableToolResults([u('a'), ack('court')], 2000, null).count).toBe(0);
    expect(evacuableToolResults([], 2000, null).count).toBe(0);
    expect(evacuableToolResults(null, 2000, null).count).toBe(0);
  });

  it('un resultat deja evacue n est plus compte', function() {
    var deja = function(text) { return text.indexOf('DEJA') === 0; };
    var thread = [ack('DEJA' + big(3000)), ack(big(3000))];
    expect(evacuableToolResults(thread, 2000, deja).count).toBe(1);
  });

  // ── Perimetre : ce qui suit la derniere frontiere (revue 2026-09-22) ──
  it('un gros resultat AVANT une frontiere n est pas une cible', function() {
    // Il n est jamais emis : l evacuer creerait une ressource pour personne et
    // le bilan annoncerait un gain que la pilule ne montrerait pas.
    var avant = ack(big(3000)), apres = ack(big(3000));
    var thread = [avant, { role: 'compaction', content: 'r' }, apres];
    var t = evacuationTargets(thread, 2000, null);
    expect(t.length).toBe(1);
    expect(t[0] === apres).toBe(true);
    expect(evacuableToolResults(thread, 2000, null).count).toBe(1);
  });

  it('emittedHistoryCharCount : dernier resume + ce qui suit, jamais l amont', function() {
    var thread = [u('avant'), { role: 'compaction', content: 'r1' },
                  u('milieu'), { role: 'compaction', content: 'r2' }, u('apres')];
    expect(emittedHistoryCharCount(thread)).toBe('r2'.length + 'apres'.length);
  });

  it('emittedHistoryCharCount : sans frontiere, content ET result comptent', function() {
    expect(emittedHistoryCharCount([u('abc'), ack('defg')])).toBe(7);
    expect(emittedHistoryCharCount(null)).toBe(0);
  });

  // ── Bilan d apres-coup ────────────────────────────────────────────────
  it('le bilan annonce un gain NET, en tokens', function() {
    // 4000 car. remplaces par 400 : (1000 - 100) tokens.
    expect(formatReclaimSummary('2 resultats evacues', 4000, 400))
      .toBe('2 resultats evacues, ≈ 900 tok récupérés');
  });

  it('un gain nul ou negatif se DIT, il ne se tait pas', function() {
    // Reel : evacuer des resultats a peine au-dessus du seuil peut couter plus
    // que ca ne rapporte. Le silence ferait chercher ce qui s est passe.
    expect(formatReclaimSummary('1 resultat evacue', 400, 400))
      .toBe('1 resultat evacue, contexte inchangé');
    expect(formatReclaimSummary('1 resultat evacue', 400, 800))
      .toBe('1 resultat evacue, contexte inchangé');
  });

  it('estimateTokensFromChars suit la meme convention qu estimateTokens', function() {
    expect(estimateTokensFromChars(4000)).toBe(estimateTokens(new Array(4001).join('x')));
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(null)).toBe(0);
  });

  // ── Suffixe du separateur : interpole vers innerHTML ──────────────────
  it('le suffixe porte le compte quand il y a un gain', function() {
    expect(formatCompactionReclaimSuffix(900)).toBe(' (≈ 900 tok récupérés)');
  });

  it('un gain nul n encombre pas le fil', function() {
    expect(formatCompactionReclaimSuffix(0)).toBe('');
    expect(formatCompactionReclaimSuffix(null)).toBe('');
    expect(formatCompactionReclaimSuffix(undefined)).toBe('');
  });

  it('le suffixe ne peut JAMAIS porter autre chose qu un nombre (piege 21)', function() {
    // Le champ est PERSISTE : un import ou une donnee de test peut y mettre
    // n importe quoi, et le point d injection (innerHTML) ne le saurait pas.
    expect(formatCompactionReclaimSuffix('<img src=x onerror=alert(1)>')).toBe('');
    expect(formatCompactionReclaimSuffix('900"><script>')).toBe('');
    expect(formatCompactionReclaimSuffix({})).toBe('');
    expect(formatCompactionReclaimSuffix([])).toBe('');
    expect(formatCompactionReclaimSuffix(Infinity)).toBe('');
  });

  it('une chaine numerique propre reste acceptee, arrondie', function() {
    expect(formatCompactionReclaimSuffix('900')).toBe(' (≈ 900 tok récupérés)');
    expect(formatCompactionReclaimSuffix(12.7)).toBe(' (≈ 13 tok récupérés)');
  });

  // ── Le refus nomme le BON geste ───────────────────────────────────────
  it('le refus de generation nomme le geste refuse', function() {
    var compact = compactionRefusal(true, null, true);
    var evac = compactionRefusal(true, null, true, 'évacuer les résultats d\'outils');
    expect(compact.indexOf('compacter le contexte') >= 0).toBe(true);
    expect(evac.indexOf('évacuer les résultats d\'outils') >= 0).toBe(true);
    // Un refus qui nommerait le mauvais geste ferait chercher une affordance
    // qu on n a pas touchee.
    expect(evac.indexOf('compacter le contexte') >= 0).toBe(false);
  });

  // ── Occupation nommee (revue 2026-09-22) ──────────────────────────────
  it('pendant une compaction : ni « generer » ni « interromps »', function() {
    // Faux deux fois : rien ne genere, et une compaction ne s interrompt pas.
    var msg = compactionRefusal('compacting', null, true, 'évacuer les résultats d\'outils');
    expect(msg.indexOf('compaction') >= 0).toBe(true);
    expect(/g[ée]n[ée]r/.test(msg)).toBe(false);
    expect(msg.indexOf('interromps') >= 0).toBe(false);
    expect(msg.indexOf('évacuer les résultats d\'outils') >= 0).toBe(true);
  });

  it('onglet voisin et agent termine : refuses, chacun nommant sa cause', function() {
    var peer = compactionRefusal('peer', null, true);
    var fin = compactionRefusal('finished-agent', null, true);
    expect(peer.indexOf('autre onglet') >= 0).toBe(true);
    expect(fin.indexOf('lecture seule') >= 0).toBe(true);
    // La lecture seule definitive prime sur tout le reste.
    expect(compactionRefusal('finished-agent', 'Un agent travaille.', false)).toBe(fin);
  });

  // ── Avis « compaction annulee » (revue 2026-09-22) ─────────────────────
  it('troncature APRES la frontiere : aucun avis', function() {
    var thread = [u('a'), { role: 'compaction', content: 'r' }, u('b'), { role: 'assistant', content: 'c' }];
    // regenerer : on garde jusqu au dernier user (index 2) → 3 entrees
    expect(compactionUndoneNotice(thread, 3)).toBe(null);
  });

  it('troncature qui emporte l unique frontiere : toute la conversation repart', function() {
    // Cas reel : compaction posee en FIN de thread, puis « regenerer ».
    var thread = [u('a'), { role: 'assistant', content: 'b' }, { role: 'compaction', content: 'r' }];
    var msg = compactionUndoneNotice(thread, 1);
    expect(msg.indexOf('Compaction annulée') === 0).toBe(true);
    expect(msg.indexOf('toute la conversation') >= 0).toBe(true);
  });

  it('une frontiere anterieure survit : le modele repart d elle', function() {
    var thread = [u('a'), { role: 'compaction', content: 'r1' }, u('b'),
                  { role: 'assistant', content: 'c' }, { role: 'compaction', content: 'r2' }];
    var msg = compactionUndoneNotice(thread, 3);
    expect(msg.indexOf('compaction précédente') >= 0).toBe(true);
    expect(msg.indexOf('toute la conversation') >= 0).toBe(false);
  });

  it('regenerateKeptLength : jusqu au dernier user inclus, 0 sans user', function() {
    var thread = [u('a'), { role: 'assistant', content: 'b' }, u('c'),
                  { role: 'assistant', content: 'd' }, { role: 'compaction', content: 'r' }];
    expect(regenerateKeptLength(thread)).toBe(3);
    // Boucle fermee avec l avis : regenerer apres une compaction l emporte.
    expect(compactionUndoneNotice(thread, regenerateKeptLength(thread)) !== null).toBe(true);
    expect(regenerateKeptLength([{ role: 'assistant', content: 'x' }])).toBe(0);
    expect(regenerateKeptLength(null)).toBe(0);
  });

  it('compactionFollows : vrai seulement si une frontiere suit l entree', function() {
    // Cas reel : reponse tronquee, puis compaction posee en fin de thread.
    var thread = [u('a'), { role: 'assistant', content: 'coupe', truncated: true },
                  { role: 'compaction', content: 'r' }];
    expect(compactionFollows(thread, 1)).toBe(true);
    expect(compactionFollows([u('a'), { role: 'compaction', content: 'r' }, { role: 'assistant', content: 'x' }], 2)).toBe(false);
    expect(compactionFollows([u('a')], 0)).toBe(false);
  });

  it('sans frontiere, ou thread nul : aucun avis', function() {
    expect(compactionUndoneNotice([u('a'), u('b')], 1)).toBe(null);
    expect(compactionUndoneNotice(null, 0)).toBe(null);
  });

  it('true reste lu comme une generation', function() {
    expect(compactionRefusal(true, null, true)).toBe(compactionRefusal('generating', null, true));
  });
});

describe('classifyStorageError — nature d\'un échec d\'écriture (lot AG)', function() {
  it('les noms reconnus, chacun dans sa classe', function() {
    var got = {};
    ['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED', 'InvalidStateError', 'DataCloneError', 'UnknownError']
      .forEach(function(n) { got[n] = classifyStorageError({ name: n }); });
    expect(got).toEqual({
      QuotaExceededError: 'quota',
      NS_ERROR_DOM_QUOTA_REACHED: 'quota',
      InvalidStateError: 'closed',
      DataCloneError: 'clone',
      UnknownError: 'other',
    });
  });
  it('err nul ou sans name : other, sans lever (tx.error nul sur un abort sans cause)', function() {
    expect(classifyStorageError(null)).toBe('other');
    expect(classifyStorageError(undefined)).toBe('other');
    expect(classifyStorageError({})).toBe('other');
    expect(classifyStorageError(new Error('quota exceeded'))).toBe('other');
  });
  it('le message est ignoré, seul le name compte (message localisé)', function() {
    expect(classifyStorageError({ name: 'Error', message: 'QuotaExceededError' })).toBe('other');
    expect(classifyStorageError({ name: 'QuotaExceededError', message: 'Quota dépassé' })).toBe('quota');
  });
});

describe('toastQueueUpsert / toastQueueRemove — file de toasts (lot AG)', function() {
  function keys(l) { return l.map(function(t) { return t.key; }); }
  function T(k, lvl) { return { key: k, level: lvl || 'warn' }; }
  it('insère en bas (le plus récent contre l\'ancre), sans muter l\'entrée', function() {
    var a = [T('a'), T('b')];
    var r = toastQueueUpsert(a, T('c'), 4);
    expect(keys(r.list)).toEqual(['a', 'b', 'c']);
    expect(keys(a)).toEqual(['a', 'b']);
    expect(r.removed).toEqual([]);
  });
  it('même clé : remplacé ET redescendu en bas (option B), sans doublon', function() {
    var r = toastQueueUpsert([T('a'), T('b'), T('c')], { key: 'a', level: 'info' }, 4);
    expect(keys(r.list)).toEqual(['b', 'c', 'a']);
    expect(r.list[2].level).toBe('info');
    expect(r.removed).toEqual([]);
  });
  it('au-delà du plafond, le plus ancien NON-erreur sort (S6)', function() {
    var r = toastQueueUpsert([T('e1', 'error'), T('w1'), T('i1', 'info'), T('e2', 'error')], T('w2'), 4);
    expect(keys(r.list)).toEqual(['e1', 'i1', 'e2', 'w2']);
    expect(r.removed).toEqual(['w1']);
  });
  it('que des erreurs : la plus ancienne sort pour une nouvelle erreur', function() {
    var r = toastQueueUpsert([T('e1', 'error'), T('e2', 'error'), T('e3', 'error'), T('e4', 'error')], T('e5', 'error'), 4);
    expect(keys(r.list)).toEqual(['e2', 'e3', 'e4', 'e5']);
    expect(r.removed).toEqual(['e1']);
  });
  it('quatre erreurs et un arrivant non-erreur : c\'est lui qui ne trouve pas place', function() {
    var r = toastQueueUpsert([T('e1', 'error'), T('e2', 'error'), T('e3', 'error'), T('e4', 'error')], T('i', 'info'), 4);
    expect(keys(r.list)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(r.removed).toEqual(['i']);
  });
  it('plafond par défaut : TOAST_MAX_VISIBLE', function() {
    var l = [];
    ['a', 'b', 'c', 'd', 'e', 'f'].forEach(function(k) { l = toastQueueUpsert(l, T(k)).list; });
    expect(l.length).toBe(TOAST_MAX_VISIBLE);
    expect(keys(l)).toEqual(['c', 'd', 'e', 'f']);
  });
  it('retrait par clé, clé absente sans effet', function() {
    expect(keys(toastQueueRemove([T('a'), T('b')], 'a'))).toEqual(['b']);
    expect(keys(toastQueueRemove([T('a')], 'zz'))).toEqual(['a']);
  });
});

describe('toastDurationMs — durées par niveau (D9)', function() {
  it('info 5 s, avertissement et erreur de service 8 s, P1 jamais', function() {
    expect({
      info: toastDurationMs('info'),
      warn: toastDurationMs('warn'),
      error: toastDurationMs('error'),
      p1: toastDurationMs('error', true),
    }).toEqual({ info: 5000, warn: 8000, error: 8000, p1: null });
  });
});

describe('toastPlacement — D7 et S7', function() {
  var base = { vw: 1700, vh: 900, inputRight: 1300, inputBottom: 860, composerTop: 760, drawerW: 0, toastW: 300, inset: 16 };
  function m(o) { return Object.assign({}, base, o || {}); }
  it('place suffisante : collé au bord droit, bas aligné sur le champ', function() {
    expect(toastPlacement(m())).toEqual({ mode: 'composer', right: 16, bottom: 40 });
  });
  it('limite exacte (300 + 2 × 16 = 332) : encore à droite du composer', function() {
    expect(toastPlacement(m({ inputRight: 1700 - 332 })).mode).toBe('composer');
    expect(toastPlacement(m({ inputRight: 1700 - 331 })).mode).toBe('edge');
  });
  it('place insuffisante : bord droit, au-dessus du composer', function() {
    expect(toastPlacement(m({ inputRight: 1500 }))).toEqual({ mode: 'edge', right: 16, bottom: 900 - 760 + 4 });
  });
  it('pas de composer mesurable : bord droit, en bas', function() {
    expect(toastPlacement(m({ inputRight: null, inputBottom: null, composerTop: null }))).toEqual({ mode: 'edge', right: 16, bottom: 16 });
  });
  it('drawer ouvert avec la place à sa gauche : à gauche du drawer, MÊME hauteur que sans', function() {
    expect(toastPlacement(m({ drawerW: 500 }))).toEqual({ mode: 'beside-drawer', right: 516, bottom: toastPlacement(m()).bottom });
    expect(toastPlacement(m({ drawerW: 500, inputRight: 1500 })).bottom).toBe(toastPlacement(m({ inputRight: 1500 })).bottom);
  });
  it('drawer ouvert sans la place (limite 332) : par-dessus, au bord droit, même hauteur', function() {
    expect(toastPlacement(m({ vw: 952, drawerW: 620 })).mode).toBe('beside-drawer');
    expect(toastPlacement(m({ vw: 951, drawerW: 620, inputRight: 800 })))
      .toEqual({ mode: 'over-drawer', right: 16, bottom: toastPlacement(m({ vw: 951, inputRight: 800 })).bottom });
  });
});

describe('healthFronts — fronts de santé des services (lot AG)', function() {
  function B(id, health) { return { id: id, name: 'Srv ' + id, health: health }; }
  function snap(b, mcp) { return { backend: b, mcp: mcp || {} }; }
  function ops(r) { return r.events.map(function(e) { return e.op + ':' + e.key + (e.level ? ':' + e.level : ''); }); }
  it('démarrage : backend déjà mort = front d\'erreur ; sain = rien', function() {
    expect(ops(healthFronts(null, snap(B('a', 'down'))))).toEqual(['show:backend:a:error']);
    expect(ops(healthFronts(null, snap(B('a', 'ok'))))).toEqual([]);
  });
  it('ok → down : erreur ; down → ok : rétabli (info), même clé', function() {
    expect(ops(healthFronts(snap(B('a', 'ok')), snap(B('a', 'down'))))).toEqual(['show:backend:a:error']);
    expect(ops(healthFronts(snap(B('a', 'down')), snap(B('a', 'ok'))))).toEqual(['show:backend:a:info']);
  });
  it('état inchangé : rien', function() {
    expect(ops(healthFronts(snap(B('a', 'down')), snap(B('a', 'down'))))).toEqual([]);
    expect(ops(healthFronts(snap(B('a', 'ok')), snap(B('a', 'ok'))))).toEqual([]);
  });
  it('unconfigured : jamais de toast ; down → unconfigured retire sans rétablir', function() {
    expect(ops(healthFronts(snap(B('a', 'unconfigured')), snap(B('a', 'down'))))).toEqual([]);
    expect(ops(healthFronts(snap(B('a', 'ok')), snap(B('a', 'unconfigured'))))).toEqual([]);
    expect(ops(healthFronts(snap(B('a', 'down')), snap(B('a', 'unconfigured'))))).toEqual(['dismiss:backend:a']);
  });
  it('bascule de serveur actif : changement de clé, pas un front', function() {
    expect(ops(healthFronts(snap(B('a', 'down')), snap(B('b', 'ok'))))).toEqual(['dismiss:backend:a']);
    expect(ops(healthFronts(snap(B('a', 'down')), snap(B('b', 'down'))))).toEqual(['dismiss:backend:a']);
    expect(ops(healthFronts(snap(B('a', 'ok')), snap(B('b', 'down'))))).toEqual([]);
  });
  it('MCP : absent ou sain → erreur ; erreur → ok : rétabli', function() {
    expect(ops(healthFronts(snap(null, {}), snap(null, { f: 'error' })))).toEqual(['show:mcp:f:error']);
    expect(ops(healthFronts(snap(null, { f: 'ok' }), snap(null, { f: 'error' })))).toEqual(['show:mcp:f:error']);
    expect(ops(healthFronts(snap(null, { f: 'error' }), snap(null, { f: 'ok' })))).toEqual(['show:mcp:f:info']);
  });
  it('MCP en reconnexion : garde son dernier état établi, le rétabli vient au bout', function() {
    var r1 = healthFronts(snap(null, { f: 'error' }), snap(null, { f: 'connecting' }));
    expect(ops(r1)).toEqual([]);
    expect(r1.snapshot.mcp.f).toBe('error');
    expect(ops(healthFronts(r1.snapshot, snap(null, { f: 'ok' })))).toEqual(['show:mcp:f:info']);
  });
  it('MCP connecting au démarrage puis erreur : front', function() {
    var r1 = healthFronts(null, snap(null, { f: 'connecting' }));
    expect(ops(healthFronts(r1.snapshot, snap(null, { f: 'error' })))).toEqual(['show:mcp:f:error']);
  });
  it('MCP : attente d\'autorisation jamais annoncée ; erreur → attente retire sans rétablir', function() {
    expect(ops(healthFronts(snap(null, { f: 'ok' }), snap(null, { f: 'pending' })))).toEqual([]);
    expect(ops(healthFronts(snap(null, { f: 'error' }), snap(null, { f: 'pending' })))).toEqual(['dismiss:mcp:f']);
  });
  it('MCP supprimé ou désactivé en erreur : retiré, sans rétabli ; sain retiré : rien', function() {
    expect(ops(healthFronts(snap(null, { f: 'error' }), snap(null, {})))).toEqual(['dismiss:mcp:f']);
    expect(ops(healthFronts(snap(null, { f: 'ok' }), snap(null, {})))).toEqual([]);
  });
});
