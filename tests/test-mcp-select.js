// tests/test-mcp-select.js
// Sélecteur de serveurs MCP (mcp-select.js) : fonctions PURES.

// Jeu d'outils d'un proxy : `p__<enfant>__<outil>`, plus un outil PROPRE de la
// carte (`p__status`, deux segments) qui ne fait pas un enfant.
var PROXY_TOOLS = ['p__bench__echo', 'p__bench__ping', 'p__web__search', 'p__status'];

describe('mcpServerChildren — deuxième segment des outils de la carte', function() {
  it('outils de la carte + upstreams à autoriser, sans doublon, triés', function() {
    expect(mcpServerChildren('p', PROXY_TOOLS, [{ name: 'jira' }]))
      .toEqual(['bench', 'jira', 'web']);
  });
  it('un outil de la carte (deux segments) n\'est pas un enfant', function() {
    expect(mcpServerChildren('p', ['p__status'], [])).toEqual([]);
  });
  it('un outil d\'une autre carte est ignoré', function() {
    expect(mcpServerChildren('p', ['q__bench__echo'], [])).toEqual([]);
  });
  it('un nom déjà vu comme outil ne double pas depuis les upstreams', function() {
    expect(mcpServerChildren('p', ['p__bench__echo'], [{ name: 'bench' }])).toEqual(['bench']);
  });
  it('seul le DEUXIÈME segment compte, quel que soit le nombre de segments', function() {
    expect(mcpServerChildren('p', ['p__a__b__c'], [])).toEqual(['a']);
  });
  it('un segment vide ne fabrique pas un enfant', function() {
    expect(mcpServerChildren('p', ['p____echo'], [])).toEqual([]);
  });
  it('entrées nulles ou de type faux : tableau vide', function() {
    expect(mcpServerChildren('p', null, undefined)).toEqual([]);
    expect(mcpServerChildren(null, PROXY_TOOLS, [])).toEqual([]);
    expect(mcpServerChildren('p', [3, null, {}], [null, 3])).toEqual([]);
  });
  it('upstream sans name chaîne non vide, ou contenant __ : ignoré', function() {
    // `__` est le séparateur réservé : un nom qui en porte ne peut pas être une
    // clé d'enfant.
    expect(mcpServerChildren('p', [], [{ name: '' }, { name: '  ' }, { name: 'p__x' }, { name: 3 }, null]))
      .toEqual([]);
  });
  it('upstream à autoriser : le nom est trimé', function() {
    expect(mcpServerChildren('p', [], [{ name: ' jira ' }])).toEqual(['jira']);
  });
  it('ne mute ni toolNames ni unauthorized (ni leurs éléments)', function() {
    var tools = PROXY_TOOLS.slice();
    var unauth = [{ name: 'jira' }];
    var toolsBefore = JSON.stringify(tools);
    var unauthBefore = JSON.stringify(unauth);
    mcpServerChildren('p', tools, unauth);
    expect(JSON.stringify(tools)).toBe(toolsBefore);
    expect(JSON.stringify(unauth)).toBe(unauthBefore);
  });
});

describe('buildMcpSelectionTree — arbre ordonné, clés et enfants', function() {
  var SERVERS = [
    { name: 'p', state: 'ok', toolNames: ['p__bench__echo'], unauthorizedUpstreams: [{ name: 'jira' }] },
    { name: 'solo', state: 'error' },
  ];
  it('forme exacte : key === name, state recopié, enfants dans l\'ordre', function() {
    expect(buildMcpSelectionTree(SERVERS)).toEqual([
      { key: 'p', name: 'p', state: 'ok', children: [
        { key: 'p__bench', name: 'bench', unauthorized: false },
        { key: 'p__jira', name: 'jira', unauthorized: true },
      ] },
      { key: 'solo', name: 'solo', state: 'error', children: [] },
    ]);
  });
  it('state absent → null ; serveur sans name non vide → ignoré', function() {
    expect(buildMcpSelectionTree([{ name: 'a' }, null, { state: 'ok' }, { name: '' }, { name: 3 }]))
      .toEqual([{ key: 'a', name: 'a', state: null, children: [] }]);
  });
  it('un serveur sans unauthorizedUpstreams ni toolNames n\'a aucun enfant', function() {
    expect(buildMcpSelectionTree([{ name: 'solo' }])[0].children).toEqual([]);
  });
  it('entrée qui n\'est pas un tableau → tableau vide', function() {
    expect(buildMcpSelectionTree(null)).toEqual([]);
    expect(buildMcpSelectionTree('p')).toEqual([]);
  });
  it('ne mute ni le tableau ni ses serveurs', function() {
    var servers = [
      { name: 'p', state: 'ok', toolNames: ['p__bench__echo'], unauthorizedUpstreams: [{ name: 'jira' }] },
    ];
    var before = JSON.stringify(servers);
    buildMcpSelectionTree(servers);
    expect(JSON.stringify(servers)).toBe(before);
  });
});

describe('normalizeMcpDisabled — chaînes trimées, uniques, triées', function() {
  it('garde le non-vide trimé, écarte le reste', function() {
    expect(normalizeMcpDisabled([' p__bench ', 'solo', 'p__bench', '', 3, null]))
      .toEqual(['p__bench', 'solo']);
  });
  it('tout ce qui n\'est pas un tableau → tableau vide', function() {
    expect(normalizeMcpDisabled('solo')).toEqual([]);
    expect(normalizeMcpDisabled(null)).toEqual([]);
    expect(normalizeMcpDisabled(undefined)).toEqual([]);
  });
  it('rend toujours un NOUVEAU tableau, sans muter la source', function() {
    var src = [' p ', 'p'];
    var before = JSON.stringify(src);
    var out = normalizeMcpDisabled(src);
    expect(JSON.stringify(src)).toBe(before);
    expect(out).toEqual(['p']);
    expect(out === src).toBe(false);
  });
});

describe('mcpNodeActive — l\'activité se déduit, elle ne se stocke pas', function() {
  it('(p, []) → actif', function() { expect(mcpNodeActive('p', [])).toBe(true); });
  it('(p, [p]) → inactif', function() { expect(mcpNodeActive('p', ['p'])).toBe(false); });
  it('carte coupée : l\'enfant est inactif', function() {
    expect(mcpNodeActive('p__bench', ['p'])).toBe(false);
  });
  it('enfant coupé nommément : inactif', function() {
    expect(mcpNodeActive('p__bench', ['p__bench'])).toBe(false);
  });
  it('un AUTRE enfant coupé ne touche pas celui-ci', function() {
    expect(mcpNodeActive('p__web', ['p__bench'])).toBe(true);
  });
  it('couper un enfant ne coupe pas le parent', function() {
    expect(mcpNodeActive('p', ['p__bench'])).toBe(true);
  });
  it('le parent se lit au PREMIER __ : pp n\'est pas p', function() {
    expect(mcpNodeActive('pp__bench', ['p'])).toBe(true);
  });
  it('disabled absent ou faux type : rien n\'est désactivé', function() {
    expect(mcpNodeActive('p', null)).toBe(true);
    expect(mcpNodeActive('p', 'p')).toBe(true);
  });
  it('clé de type faux : neutre (actif)', function() {
    expect(mcpNodeActive(null, ['p'])).toBe(true);
    expect(mcpNodeActive(undefined, ['p'])).toBe(true);
  });
  it('ne mute pas disabled', function() {
    var d = ['p'];
    mcpNodeActive('p__bench', d);
    mcpNodeActive('p', d);
    expect(d).toEqual(['p']);
  });
});

describe('mcpNodeEditable — une carte l\'est toujours, un enfant dépend du parent', function() {
  it('(p, [p]) → carte modifiable, elle se réactive', function() {
    expect(mcpNodeEditable('p', ['p'])).toBe(true);
  });
  it('(p__bench, [p]) → enfant figé tant que la carte est coupée', function() {
    expect(mcpNodeEditable('p__bench', ['p'])).toBe(false);
  });
  it('(p__bench, [p__bench]) → enfant modifiable, la carte est active', function() {
    expect(mcpNodeEditable('p__bench', ['p__bench'])).toBe(true);
  });
  it('disabled absent : tout est modifiable', function() {
    expect(mcpNodeEditable('p__bench', null)).toBe(true);
  });
});

describe('toggleMcpDisabled — bascule d\'une clé, sans effet de bord', function() {
  it('([], p) → [p]', function() {
    expect(toggleMcpDisabled([], 'p')).toEqual(['p']);
  });
  it('([p], p) → []', function() {
    expect(toggleMcpDisabled(['p'], 'p')).toEqual([]);
  });
  it('couper une carte CONSERVE l\'état de ses enfants', function() {
    expect(toggleMcpDisabled(['p__bench'], 'p')).toEqual(['p', 'p__bench']);
  });
  it('réactiver une carte CONSERVE l\'état de ses enfants', function() {
    expect(toggleMcpDisabled(['p', 'p__bench'], 'p')).toEqual(['p__bench']);
  });
  it('enfant figé par une carte coupée : liste inchangée', function() {
    expect(toggleMcpDisabled(['p'], 'p__bench')).toEqual(['p']);
  });
  it('un autre enfant de la même carte reste basculable', function() {
    expect(toggleMcpDisabled(['p__bench'], 'p__web')).toEqual(['p__bench', 'p__web']);
  });
  it('clé vide ou non chaîne : liste normalisée inchangée', function() {
    expect(toggleMcpDisabled(['p'], '')).toEqual(['p']);
    expect(toggleMcpDisabled(['p'], null)).toEqual(['p']);
    expect(toggleMcpDisabled(['p'], 3)).toEqual(['p']);
  });
  it('rend une liste normalisée, sans muter l\'argument', function() {
    var before = [' p__bench '];
    var snapshot = JSON.stringify(before);
    var out = toggleMcpDisabled(before, 'p');
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(out).toEqual(['p', 'p__bench']);
  });
});

describe('countActiveMcp — cartes ET enfants actifs', function() {
  // Arbre de référence : p avec bench et jira, plus solo — 4 nœuds.
  var TREE = buildMcpSelectionTree([
    { name: 'p', state: 'ok', toolNames: ['p__bench__echo'], unauthorizedUpstreams: [{ name: 'jira' }] },
    { name: 'solo', state: 'error' },
  ]);
  it('disabled vide → 4', function() { expect(countActiveMcp(TREE, [])).toBe(4); });
  it('un enfant coupé → 3', function() { expect(countActiveMcp(TREE, ['p__jira'])).toBe(3); });
  it('la carte coupée coupe ses deux enfants → 1', function() {
    expect(countActiveMcp(TREE, ['p'])).toBe(1);
  });
  it('tout coupé → 0', function() { expect(countActiveMcp(TREE, ['p', 'solo'])).toBe(0); });
  it('les deux enfants coupés, carte et solo actifs → 2', function() {
    expect(countActiveMcp(TREE, ['p__bench', 'p__jira'])).toBe(2);
  });
  it('arbre non tableau → 0', function() {
    expect(countActiveMcp(null, [])).toBe(0);
  });
  it('ne mute ni l\'arbre ni disabled', function() {
    var treeBefore = JSON.stringify(TREE);
    var d = ['p__bench'];
    countActiveMcp(TREE, d);
    expect(JSON.stringify(TREE)).toBe(treeBefore);
    expect(d).toEqual(['p__bench']);
  });
});

describe('mcpToolAllowed — une clé désactivée coupe ce qui commence par k + __', function() {
  it('carte coupée', function() { expect(mcpToolAllowed('p__bench__echo', ['p'])).toBe(false); });
  it('enfant coupé', function() { expect(mcpToolAllowed('p__bench__echo', ['p__bench'])).toBe(false); });
  it('un autre enfant coupé ne touche pas celui-ci', function() {
    expect(mcpToolAllowed('p__web__search', ['p__bench'])).toBe(true);
  });
  it('l\'outil propre de la carte survit à un enfant coupé', function() {
    expect(mcpToolAllowed('p__status', ['p__bench'])).toBe(true);
  });
  it('p ne coupe pas pp (le séparateur est exigé)', function() {
    expect(mcpToolAllowed('pp__x', ['p'])).toBe(true);
  });
  it('p__bench ne coupe pas p__bench2', function() {
    expect(mcpToolAllowed('p__bench2__x', ['p__bench'])).toBe(true);
  });
  it('les outils internes miaou__… sont toujours permis', function() {
    expect(mcpToolAllowed('miaou__memory__create', ['p'])).toBe(true);
  });
  it('disabled non tableau → tout est permis', function() {
    expect(mcpToolAllowed('p__x', null)).toBe(true);
    expect(mcpToolAllowed('p__x', 'p')).toBe(true);
  });
  it('ne mute pas disabled', function() {
    var d = ['p__bench'];
    mcpToolAllowed('p__bench__echo', d);
    mcpToolAllowed('p__web__search', d);
    expect(d).toEqual(['p__bench']);
  });
});

describe('filterMcpToolDefs — garde l\'ordre, écarte ce qui n\'est pas adressable', function() {
  it('garde les outils permis, dans l\'ordre', function() {
    var defs = [
      { name: 'p__bench__echo' },
      { name: 'p__web__search' },
      { name: 'solo__x' },
    ];
    expect(filterMcpToolDefs(defs, ['p__bench']).map(function(d) { return d.name; }))
      .toEqual(['p__web__search', 'solo__x']);
  });
  it('élément sans name chaîne : écarté ; entrée non tableau : vide', function() {
    expect(filterMcpToolDefs([null, 3, { name: 4 }, { name: 'ok__x' }], []))
      .toEqual([{ name: 'ok__x' }]);
    expect(filterMcpToolDefs(null, [])).toEqual([]);
  });
  it('ne mute pas defs', function() {
    var defs = [{ name: 'p__x' }];
    var before = JSON.stringify(defs);
    filterMcpToolDefs(defs, ['p']);
    expect(JSON.stringify(defs)).toBe(before);
  });
});

describe('buildMcpInstructionsBlock(servers, disabled) — consignes des nœuds coupés', function() {
  var PROXY = '## bench\n\nConsigne bench.\n\n## web\n\nConsigne web.';
  var SERVERS = [
    { slug: 'p', instructions: PROXY, toolNames: ['p__bench__echo', 'p__web__search'] },
    { slug: 'solo', instructions: 'Consigne solo.', toolNames: ['solo__x'] },
  ];
  it('absent ou vide : sortie strictement inchangée', function() {
    var ref = buildMcpInstructionsBlock(SERVERS);
    expect(ref === buildMcpInstructionsBlock(SERVERS, [])).toBe(true);
    expect(ref === buildMcpInstructionsBlock(SERVERS, null)).toBe(true);
    expect(ref.indexOf('## p__bench') >= 0).toBe(true);
    expect(ref.indexOf('## p__web') >= 0).toBe(true);
    expect(ref.indexOf('## solo') >= 0).toBe(true);
  });
  it('un enfant coupé : sa section disparaît, pas celle des autres', function() {
    var block = buildMcpInstructionsBlock(SERVERS, ['p__bench']);
    expect(block.indexOf('## p__web') >= 0).toBe(true);
    expect(block.indexOf('## solo') >= 0).toBe(true);
    expect(block.indexOf('## p__bench')).toBe(-1);
    expect(block.indexOf('Consigne bench.')).toBe(-1);
    // Le piège : le texte ENTIER du proxy (mode « unitaire ») ne doit pas
    // revenir sous le slug après avoir filtré les toolNames.
    expect(block.indexOf('## p\n\n')).toBe(-1);
  });
  it('la carte coupée : ses deux sections disparaissent, solo reste', function() {
    var block = buildMcpInstructionsBlock(SERVERS, ['p']);
    expect(block.indexOf('## p__web')).toBe(-1);
    expect(block.indexOf('## p__bench')).toBe(-1);
    expect(block.indexOf('## solo') >= 0).toBe(true);
  });
  it('tout coupé : bloc vide', function() {
    expect(buildMcpInstructionsBlock(SERVERS, ['p', 'solo'])).toBe('');
  });
  it('tous les enfants coupés : plus aucune section p__, solo reste', function() {
    var block = buildMcpInstructionsBlock(SERVERS, ['p__bench', 'p__web']);
    expect(block.indexOf('## solo') >= 0).toBe(true);
    expect(block.indexOf('## p__bench')).toBe(-1);
    expect(block.indexOf('## p__web')).toBe(-1);
  });
  it('un serveur unitaire coupé disparaît sous son slug', function() {
    var block = buildMcpInstructionsBlock(
      [{ slug: 'notes', instructions: 'Consigne notes.', toolNames: ['notes__x'] }], ['notes']);
    expect(block).toBe('');
  });
});

describe('mcpSkillAllowed — carte, puis enfant lu dans l\'URI skill://<enfant>/…', function() {
  it('carte coupée', function() {
    expect(mcpSkillAllowed('p', 'skill://bench/bench/SKILL.md', ['p'])).toBe(false);
  });
  it('enfant coupé, lu au segment après skill://', function() {
    expect(mcpSkillAllowed('p', 'skill://bench/bench/SKILL.md', ['p__bench'])).toBe(false);
  });
  it('un autre enfant coupé ne touche pas celle-ci', function() {
    expect(mcpSkillAllowed('p', 'skill://web/search/SKILL.md', ['p__bench'])).toBe(true);
  });
  it('serveur ordinaire, rien de coupé', function() {
    expect(mcpSkillAllowed('solo', 'skill://guide/SKILL.md', [])).toBe(true);
  });
  it('URI hors forme skill://<seg>/… : seule la carte compte', function() {
    expect(mcpSkillAllowed('p', 'pas-une-uri', ['p__bench'])).toBe(true);
  });
  it('la clé d\'enfant est portée par la carte, pas par l\'enfant nu', function() {
    expect(mcpSkillAllowed('p', 'skill://bench/x/SKILL.md', ['q__bench'])).toBe(true);
  });
  it('disabled non tableau : permis', function() {
    expect(mcpSkillAllowed('p', 'skill://bench/x/SKILL.md', null)).toBe(true);
  });
  it('ne mute pas disabled', function() {
    var d = ['p__bench'];
    mcpSkillAllowed('p', 'skill://bench/x/SKILL.md', d);
    expect(d).toEqual(['p__bench']);
  });
});

describe('filterMcpSkillEntries — garde l\'ordre, écarte les skills coupées', function() {
  it('garde les skills permises, dans l\'ordre', function() {
    var entries = [
      { name: 'a', description: '', server: 'p', uri: 'skill://bench/bench/SKILL.md' },
      { name: 'b', description: '', server: 'p', uri: 'skill://web/search/SKILL.md' },
      { name: 'c', description: '', server: 'solo', uri: 'skill://guide/SKILL.md' },
    ];
    expect(filterMcpSkillEntries(entries, ['p__bench']).map(function(e) { return e.name; }))
      .toEqual(['b', 'c']);
  });
  it('entrée non tableau → tableau vide', function() {
    expect(filterMcpSkillEntries(null, [])).toEqual([]);
  });
  it('ne mute pas entries', function() {
    var entries = [{ name: 'a', server: 'p', uri: 'skill://bench/x/SKILL.md' }];
    var before = JSON.stringify(entries);
    filterMcpSkillEntries(entries, ['p']);
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe('resolveMcpDisabled — une conversation muette suit les défauts', function() {
  it('tableau vide enregistré : il l\'emporte', function() {
    expect(resolveMcpDisabled({ mcpDisabled: [] }, ['p'])).toEqual([]);
  });
  it('rien d\'enregistré : défauts globaux', function() {
    expect(resolveMcpDisabled({}, ['p'])).toEqual(['p']);
  });
  it('conversation nulle : défauts normalisés', function() {
    expect(resolveMcpDisabled(null, ['solo', 'p'])).toEqual(['p', 'solo']);
  });
  it('mcpDisabled d\'un type faux : défauts', function() {
    expect(resolveMcpDisabled({ mcpDisabled: 'p' }, ['solo'])).toEqual(['solo']);
  });
  it('ne mute ni la conversation ni les défauts', function() {
    var conv = { mcpDisabled: [' b ', 'a'] };
    var defaults = ['z', ' y '];
    var convBefore = JSON.stringify(conv);
    var defaultsBefore = JSON.stringify(defaults);
    resolveMcpDisabled(conv, defaults);
    expect(JSON.stringify(conv)).toBe(convBefore);
    expect(JSON.stringify(defaults)).toBe(defaultsBefore);
  });
});

describe('mcpSelectorLabel — entier ≥ 0, sinon 0', function() {
  it('entier positif', function() { expect(mcpSelectorLabel(3)).toBe('3 MCP'); });
  it('zéro', function() { expect(mcpSelectorLabel(0)).toBe('0 MCP'); });
  it('négatif', function() { expect(mcpSelectorLabel(-1)).toBe('0 MCP'); });
  it('chaîne numérique', function() { expect(mcpSelectorLabel('2')).toBe('0 MCP'); });
  it('absent ou fractionnaire', function() {
    expect(mcpSelectorLabel(null)).toBe('0 MCP');
    expect(mcpSelectorLabel(undefined)).toBe('0 MCP');
    expect(mcpSelectorLabel(1.5)).toBe('0 MCP');
    expect(mcpSelectorLabel(NaN)).toBe('0 MCP');
  });
});

// ── mcpDisabledFor : LA lecture impure de l'état (impur mais synchrone, donc
//    exerçable en QuickJS). Trois branches, dans l'ordre de priorité voulu.
describe('mcpDisabledFor — génération en vol, puis écran, puis record/défauts', function() {
  it('une génération en vol PRIME sur la conversation affichée', function() {
    var saveConv = currentConvId, saveScreen = currentConvMcpDisabled;
    currentConvId = 'c-gen';
    currentConvMcpDisabled = ['screen'];   // l'écran dit autre chose
    _activeGenerations.set('c-gen', { mcpDisabled: ['gen'] });
    try {
      expect(mcpDisabledFor({ convId: 'c-gen', spaceId: 'sp' })).toEqual(['gen']);
    } finally {
      _activeGenerations.delete('c-gen');
      currentConvId = saveConv;
      currentConvMcpDisabled = saveScreen;
    }
  });
  it('sans génération, la conversation AFFICHÉE lit sa variable d\'écran', function() {
    var saveConv = currentConvId, saveScreen = currentConvMcpDisabled;
    currentConvId = 'c-ecran';
    currentConvMcpDisabled = [' b ', 'a'];   // non normalisée à la pose
    try {
      expect(mcpDisabledFor({ convId: 'c-ecran', spaceId: 'sp' })).toEqual(['a', 'b']);
    } finally {
      currentConvId = saveConv;
      currentConvMcpDisabled = saveScreen;
    }
  });
  it('sinon le RECORD de la conversation, puis les défauts globaux', function() {
    var saveConv = currentConvId, saveScreen = currentConvMcpDisabled;
    currentConvId = null;
    currentConvMcpDisabled = null;
    localStorage.clear();
    try {
      saveConversation({ id: 'c-record', messages: [], mcpDisabled: [' p ', 'a'] });
      expect(mcpDisabledFor({ convId: 'c-record', spaceId: 'sp' })).toEqual(['a', 'p']);
      // Conversation absente : les défauts globaux prennent la main.
      saveMcpDisabledDefaults(['solo', ' p ']);
      expect(mcpDisabledFor({ convId: 'c-inconnue', spaceId: 'sp' })).toEqual(['p', 'solo']);
      // Aucun défaut enregistré : liste vide.
      localStorage.removeItem('miaou-mcp-disabled');
      expect(mcpDisabledFor({ convId: 'c-inconnue', spaceId: 'sp' })).toEqual([]);
    } finally {
      localStorage.clear();
      currentConvId = saveConv;
      currentConvMcpDisabled = saveScreen;
    }
  });
});

describe('loadMcpDisabledDefaults — absent, illisible, mal normalisé', function() {
  it('absent → tableau vide', function() {
    localStorage.clear();
    expect(loadMcpDisabledDefaults()).toEqual([]);
  });
  it('JSON illisible → tableau vide (jamais d\'exception)', function() {
    localStorage.clear();
    localStorage.setItem('miaou-mcp-disabled', '{');
    expect(loadMcpDisabledDefaults()).toEqual([]);
  });
  it('liste relue : trimée, dédoublonnée, triée', function() {
    localStorage.clear();
    localStorage.setItem('miaou-mcp-disabled', '["b","a","a"]');
    expect(loadMcpDisabledDefaults()).toEqual(['a', 'b']);
    localStorage.clear();
  });
});

describe('saveMcpDisabledDefaults — écrit et rend la liste normalisée', function() {
  it('rend la liste normalisée qu\'il vient d\'écrire', function() {
    localStorage.clear();
    try {
      expect(saveMcpDisabledDefaults(['b', 'a', 'a'])).toEqual(['a', 'b']);
      expect(loadMcpDisabledDefaults()).toEqual(['a', 'b']);
    } finally { localStorage.clear(); }
  });
});

describe('createGeneration — une sélection MCP fournie prime sur les défauts', function() {
  it('un tableau fourni est normalisé ; sinon les défauts globaux', function() {
    localStorage.clear();
    try {
      saveMcpDisabledDefaults(['p']);
      expect(createGeneration('x', [], { mcpDisabled: ['solo'] }).mcpDisabled).toEqual(['solo']);
      expect(createGeneration('x', [], {}).mcpDisabled).toEqual(['p']);
      expect(createGeneration('x', [], { mcpDisabled: 'solo' }).mcpDisabled).toEqual(['p']);
    } finally { localStorage.clear(); }
  });
});

describe('exposedTools(ctx) — la sélection de la conversation filtre les outils distants', function() {
  it('un enfant coupé écarte ses outils, garde ceux de la même carte', function() {
    localStorage.clear();
    saveMcpServers([{ id: 's1', name: 'p', url: 'http://x/mcp', enabled: true }]);
    _remoteTools['p'] = [
      { name: 'p__bench__echo', description: '', inputSchema: { type: 'object', properties: {} } },
      { name: 'p__web__search', description: '', inputSchema: { type: 'object', properties: {} } },
    ];
    saveMcpDisabledDefaults(['p__bench']);
    try {
      var names = exposedTools({ convId: 'ctx-1', spaceId: 'sp' }).map(function(t) { return t.name; });
      expect(names.indexOf('p__bench__echo')).toBe(-1);
      expect(names.indexOf('p__web__search') >= 0).toBeTruthy();
    } finally {
      delete _remoteTools['p'];
      localStorage.clear();
    }
  });
  it('sans rien de coupé, l\'outil distant est exposé', function() {
    localStorage.clear();
    saveMcpServers([{ id: 's1', name: 'p', url: 'http://x/mcp', enabled: true }]);
    _remoteTools['p'] = [
      { name: 'p__bench__echo', description: '', inputSchema: { type: 'object', properties: {} } },
    ];
    try {
      var names = exposedTools({ convId: 'ctx-1', spaceId: 'sp' }).map(function(t) { return t.name; });
      expect(names.indexOf('p__bench__echo') >= 0).toBeTruthy();
    } finally {
      delete _remoteTools['p'];
      localStorage.clear();
    }
  });
});

describe('callTool — un serveur coupé pour la conversation est refusé sans réseau', function() {
  it('carte coupée : erreur, texte nommant la carte', function() {
    localStorage.clear();
    saveMcpServers([{ id: 's1', name: 'p', url: 'http://x/mcp', enabled: true }]);
    saveMcpDisabledDefaults(['p']);
    try {
      var r = callTool('p__bench__echo', { q: 1 }, { convId: 'ctx-1', spaceId: 'sp' });
      expect(r.isError).toBeTruthy();
      expect(flattenToolResult(r)).toContain('Serveur MCP inconnu ou désactivé : p');
    } finally { localStorage.clear(); }
  });
  it('enfant coupé : le préfixe annoncé est la clé d\'enfant', function() {
    localStorage.clear();
    saveMcpServers([{ id: 's1', name: 'p', url: 'http://x/mcp', enabled: true }]);
    saveMcpDisabledDefaults(['p__bench']);
    try {
      var r = callTool('p__bench__echo', {}, { convId: 'ctx-1', spaceId: 'sp' });
      expect(r.isError).toBeTruthy();
      expect(flattenToolResult(r)).toContain('désactivé : p__bench');
    } finally { localStorage.clear(); }
  });
});
