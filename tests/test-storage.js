// tests/test-storage.js
// Adapter les noms de fonctions selon l'implémentation réelle.

describe('loadSettings (valeurs par défaut)', function() {
  it('retourne "propose" comme mode mémoire par défaut', function() {
    localStorage.clear();
    var s = loadSettings();
    expect(s.summaryInjectionMode).toBe('propose');
  });
  it('describeFiles par défaut à true (D7, lot Cbis)', function() {
    localStorage.clear();
    var s = loadSettings();
    expect(s.describeFiles).toBe(true);
  });
  it('describeFiles persiste à false quand explicitement désactivé', function() {
    localStorage.clear();
    saveSettings({ describeFiles: false });
    var s = loadSettings();
    expect(s.describeFiles).toBe(false);
  });
});

describe('saveSettings / loadSettings', function() {
  it('persiste et restitue le modèle', function() {
    localStorage.clear();
    saveSettings({ url: 'http://test/v1', key: '', model: 'gemma4:26b-nvfp4', summaryInjectionMode: 'auto' });
    var s = loadSettings();
    expect(s.model).toBe('gemma4:26b-nvfp4');
    expect(s.summaryInjectionMode).toBe('auto');
  });
});

describe('showModelSelector (sélecteur de modèle composer)', function() {
  it('est masqué par défaut', function() {
    localStorage.clear();
    expect(loadSettings().showModelSelector).toBe(false);
  });
  it('persiste l\'activation', function() {
    localStorage.clear();
    saveSettings({ showModelSelector: true });
    expect(loadSettings().showModelSelector).toBe(true);
  });
});

describe('sidebarWidth (largeur de la sidebar)', function() {
  it('vaut 264 par défaut', function() {
    localStorage.clear();
    expect(loadSettings().sidebarWidth).toBe(264);
  });
  it('persiste une largeur redimensionnée', function() {
    localStorage.clear();
    saveSettings({ sidebarWidth: 420 });
    expect(loadSettings().sidebarWidth).toBe(420);
  });
});

describe('activeModel (override conv vs modèle par défaut)', function() {
  it('retombe sur le modèle des réglages sans override de conversation', function() {
    localStorage.clear();
    saveSettings({ model: 'gemma4:26b-nvfp4' });
    // currentConvModel vaut '' à l'état initial → fallback sur le défaut.
    expect(activeModel()).toBe('gemma4:26b-nvfp4');
  });
});

describe('activeReasoningEffort (override conv vs niveau par défaut)', function() {
  it('retombe sur le niveau des réglages sans override de conversation', function() {
    localStorage.clear();
    saveSettings({ reasoningEffort: 'high' });
    // currentConvReasoningEffort vaut '' à l'état initial → fallback sur le défaut.
    expect(activeReasoningEffort()).toBe('high');
  });
  it('vaut \'\' (aucun paramètre) sans réglage ni override', function() {
    localStorage.clear();
    saveSettings({});
    expect(activeReasoningEffort()).toBe('');
  });
});

describe('flag vision manuel par (serveur, modèle) — D5 brief A2', function() {
  it('normalizeApiServer : map vision par défaut vide, ne garde que les false', function() {
    var s = normalizeApiServer({ name: 'S', url: 'u', model: 'm',
      vision: { a: false, b: true, c: false } });
    expect(s.vision.a).toBe(false);
    expect(s.vision.c).toBe(false);
    // 'b: true' n'est pas conservé (true = équivaut à absent = envoyer)
    expect('b' in s.vision).toBeFalsy();
  });
  it('normalizeApiServer : vision absent → map vide, pas de crash', function() {
    var s = normalizeApiServer({ name: 'S', url: 'u', model: 'm' });
    expect(s.vision).toEqual({});
  });
  it('serverModelVisionEnabled : true par défaut (modèle inconnu de la map)', function() {
    expect(serverModelVisionEnabled({ vision: {} }, 'gemma')).toBe(true);
    expect(serverModelVisionEnabled({ vision: { autre: false } }, 'gemma')).toBe(true);
  });
  it('serverModelVisionEnabled : false seulement si explicitement marqué', function() {
    expect(serverModelVisionEnabled({ vision: { gemma: false } }, 'gemma')).toBe(false);
  });
  it('serverModelVisionEnabled : serveur nul/sans map → true (envoyer)', function() {
    expect(serverModelVisionEnabled(null, 'm')).toBe(true);
    expect(serverModelVisionEnabled({}, 'm')).toBe(true);
  });
});

describe('hasSubstance (piège 5 — seuil conversation avortée)', function() {
  it('1 user substantiel + 1 assistant substantiel → true', function() {
    expect(hasSubstance([
      { role: 'user', content: 'une question suffisamment longue' },
      { role: 'assistant', content: 'une réponse suffisamment longue' },
    ])).toBe(true);
  });
  it('assistant trivial (< 8 car.) ne compte pas → false', function() {
    expect(hasSubstance([
      { role: 'user', content: 'une question suffisamment longue' },
      { role: 'assistant', content: 'ok' },
    ])).toBe(false);
  });
  it('2 users substantiels, 0 assistant → false', function() {
    expect(hasSubstance([
      { role: 'user', content: 'première question assez longue' },
      { role: 'user', content: 'deuxième question assez longue' },
    ])).toBe(false);
  });
  it('tableau vide → false', function() {
    expect(hasSubstance([])).toBe(false);
  });
  it('non-array (null/undefined/string) → false (garde Array.isArray)', function() {
    expect(hasSubstance(null)).toBe(false);
    expect(hasSubstance(undefined)).toBe(false);
    expect(hasSubstance('x')).toBe(false);
  });
  it('content non-string (content parts/objet) ignoré (len=0)', function() {
    expect(hasSubstance([
      { role: 'user', content: [] },
      { role: 'assistant', content: 'une réponse suffisamment longue' },
    ])).toBe(false);
  });
  it('exactement 8 caractères compte (borne >=8, pas >8)', function() {
    expect(hasSubstance([
      { role: 'user', content: 'abcdefgh' },
      { role: 'assistant', content: 'abcdefgh' },
    ])).toBe(true);
  });
});

describe('migration localStorage -> IDB (U-2, helpers purs)', function() {
  it('parseLegacyConversations garde les conversations identifiables', function() {
    var out = parseLegacyConversations(JSON.stringify([
      { id: 'c1', title: 'A', messages: [] },
      { id: 'c2', title: 'B', messages: [] }
    ]));
    expect(out.length).toBe(2);
    expect(out[0].id).toBe('c1');
  });

  it('parseLegacyConversations ignore les entrees sans id exploitable', function() {
    var out = parseLegacyConversations(JSON.stringify([
      { id: 'c1' }, { title: 'sans id' }, null, { id: '' }, { id: 42 }
    ]));
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('c1');
  });

  it('parseLegacyConversations : cle absente = rien a migrer (tableau vide)', function() {
    expect(parseLegacyConversations(null).length).toBe(0);
    expect(parseLegacyConversations(undefined).length).toBe(0);
  });

  it('parseLegacyConversations : contenu illisible = null (ne pas purger)', function() {
    expect(parseLegacyConversations('pas du json')).toBe(null);
    expect(parseLegacyConversations('{"pas":"un tableau"}')).toBe(null);
  });

  it('parseLegacySummaries convertit l objet indexe en tableau de records', function() {
    var out = parseLegacySummaries(JSON.stringify({
      c1: { summary: 'x' },
      c2: { summary: 'y', suppressed: true }
    }));
    expect(out.length).toBe(2);
    var byId = {};
    out.forEach(function(e) { byId[e.id] = e; });
    expect(byId.c1.summary).toBe('x');
    expect(byId.c2.suppressed).toBe(true);
  });

  it('parseLegacySummaries retablit id depuis la cle (keyPath du store)', function() {
    var out = parseLegacySummaries(JSON.stringify({ c1: { summary: 'sans id interne' } }));
    expect(out[0].id).toBe('c1');
  });

  it('parseLegacySummaries fait primer la cle sur un id interne divergent', function() {
    var out = parseLegacySummaries(JSON.stringify({ c1: { id: 'autre', summary: 'x' } }));
    expect(out[0].id).toBe('c1');
  });

  it('parseLegacySummaries : cle absente = rien a migrer (tableau vide)', function() {
    expect(parseLegacySummaries(null).length).toBe(0);
    expect(parseLegacySummaries(undefined).length).toBe(0);
  });

  it('parseLegacySummaries : contenu illisible ou de forme inattendue = null', function() {
    expect(parseLegacySummaries('nope')).toBe(null);
    expect(parseLegacySummaries('[]')).toBe(null);
  });

  it('selectRecordsToMigrate sur du null n ecrit rien', function() {
    expect(selectRecordsToMigrate(null, new Set()).length).toBe(0);
  });

  it('selectRecordsToMigrate ecarte ce qui est deja en base', function() {
    var todo = selectRecordsToMigrate(
      [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
      new Set(['c2'])
    );
    expect(todo.length).toBe(2);
    expect(todo[0].id).toBe('c1');
    expect(todo[1].id).toBe('c3');
  });

  it('selectRecordsToMigrate accepte un tableau d ids', function() {
    var todo = selectRecordsToMigrate([{ id: 'c1' }, { id: 'c2' }], ['c1']);
    expect(todo.length).toBe(1);
    expect(todo[0].id).toBe('c2');
  });

  it('selectRecordsToMigrate sans base existante garde tout', function() {
    expect(selectRecordsToMigrate([{ id: 'c1' }, { id: 'c2' }], null).length).toBe(2);
  });
});

describe('selectBackfillCandidates (index + substance)', function() {
  // Cœur pur du backfill (lot U-1) : la lecture des conversations est passée en
  // IDB (async), l'invariant testable est le prédicat de sélection.
  var SUBSTANTIAL = [
    { role: 'user', content: 'une question assez longue' },
    { role: 'assistant', content: 'une réponse assez longue' },
  ];
  it('retient une conversation sans entrée de résumé et avec substance', function() {
    var cands = selectBackfillCandidates([{ id: 'c1', messages: SUBSTANTIAL }], {});
    expect(cands.length).toBe(1);
    expect(cands[0].id).toBe('c1');
  });
  it('exclut une conversation déjà indexée (résumé)', function() {
    var cands = selectBackfillCandidates([{ id: 'c1', messages: SUBSTANTIAL }], { c1: { id: 'c1', summary: 'x' } });
    expect(cands.length).toBe(0);
  });
  it('exclut une conversation tombstonée (compte comme présente)', function() {
    var cands = selectBackfillCandidates([{ id: 'c1', messages: SUBSTANTIAL }], { c1: { id: 'c1', suppressed: true } });
    expect(cands.length).toBe(0);
  });
  it('exclut une conversation sans substance', function() {
    var cands = selectBackfillCandidates([{ id: 'c1', messages: [{ role: 'user', content: 'ok' }] }], {});
    expect(cands.length).toBe(0);
  });
  it('entrées nulles ignorées, pas d\'exception', function() {
    expect(selectBackfillCandidates([null, undefined], {}).length).toBe(0);
    expect(selectBackfillCandidates(null, null).length).toBe(0);
  });
});

describe('Serveurs API : migration one-shot (miaou-api-servers)', function() {
  it('clé absente + settings avec url/model → crée "Par défaut" et l\'active', function() {
    localStorage.clear();
    localStorage.setItem('miaou-settings', JSON.stringify({ url: 'http://a/v1', model: 'model-a' }));
    var arr = loadApiServers();
    expect(arr.length).toBe(1);
    expect(arr[0].name).toBe('Par défaut');
    expect(getActiveApiServerId()).toBe(arr[0].id);
  });
  it('clé absente + settings sans url → [] et pas de serveur actif', function() {
    localStorage.clear();
    localStorage.setItem('miaou-settings', JSON.stringify({ model: 'model-a' }));
    var arr = loadApiServers();
    expect(arr.length).toBe(0);
    expect(getActiveApiServerId()).toBe('');
  });
  it('clé déjà présente (même []) → migration ne fait rien (one-shot)', function() {
    localStorage.clear();
    localStorage.setItem('miaou-api-servers', JSON.stringify([]));
    localStorage.setItem('miaou-settings', JSON.stringify({ url: 'http://a/v1', model: 'model-a' }));
    var arr = loadApiServers();
    expect(arr.length).toBe(0);
  });
});

describe('Serveurs API : CRUD (upsert/delete/get/activeApiServer/activeApiConfig)', function() {
  it('upsertApiServer insère puis met à jour par id', function() {
    localStorage.clear();
    saveApiServersRaw([]);
    upsertApiServer({ id: 's1', name: 'A', url: 'http://a/v1' });
    expect(loadApiServers().length).toBe(1);
    upsertApiServer({ id: 's1', name: 'A renommé', url: 'http://a/v1' });
    var arr = loadApiServers();
    expect(arr.length).toBe(1);
    expect(arr[0].name).toBe('A renommé');
    upsertApiServer({ id: 's2', name: 'B', url: 'http://b/v1' });
    expect(loadApiServers().length).toBe(2);
  });
  it('deleteApiServer retire par id', function() {
    localStorage.clear();
    saveApiServersRaw([{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }]);
    var arr = deleteApiServer('s1');
    expect(arr.length).toBe(1);
    expect(arr[0].id).toBe('s2');
  });
  it('getApiServer trouve ou null', function() {
    localStorage.clear();
    saveApiServersRaw([{ id: 's1', name: 'A' }]);
    expect(getApiServer('s1').name).toBe('A');
    expect(getApiServer('inconnu')).toBe(null);
  });
  it('activeApiServer : id actif périmé → retombe sur le premier du tableau', function() {
    localStorage.clear();
    saveApiServersRaw([{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }]);
    setActiveApiServerId('id-inexistant');
    expect(activeApiServer().id).toBe('s1');
  });
  it('normalizeApiServer : disabled false par défaut, true seulement si strictement true', function() {
    expect(normalizeApiServer({ name: 'S', url: 'u' }).disabled).toBe(false);
    expect(normalizeApiServer({ name: 'S', url: 'u', disabled: false }).disabled).toBe(false);
    expect(normalizeApiServer({ name: 'S', url: 'u', disabled: 'oui' }).disabled).toBe(false);
    expect(normalizeApiServer({ name: 'S', url: 'u', disabled: true }).disabled).toBe(true);
  });
  it('listSelectableApiServers : exclut les désactivés et ceux sans URL', function() {
    localStorage.clear();
    saveApiServersRaw([
      normalizeApiServer({ id: 's1', name: 'A', url: 'http://a/v1' }),
      normalizeApiServer({ id: 's2', name: 'B', url: 'http://b/v1', disabled: true }),
      normalizeApiServer({ id: 's3', name: 'C', url: '' }),
    ]);
    var ids = listSelectableApiServers().map(function(s) { return s.id; });
    expect(ids.join(',')).toBe('s1');
  });
  it('activeApiServer : repli ignore les serveurs désactivés', function() {
    localStorage.clear();
    saveApiServersRaw([
      normalizeApiServer({ id: 's1', name: 'A', url: 'http://a/v1', disabled: true }),
      normalizeApiServer({ id: 's2', name: 'B', url: 'http://b/v1' }),
    ]);
    setActiveApiServerId('id-inexistant');
    expect(activeApiServer().id).toBe('s2');
  });
  it('activeApiServer : un serveur désactivé EXPLICITEMENT actif le reste', function() {
    localStorage.clear();
    saveApiServersRaw([
      normalizeApiServer({ id: 's1', name: 'A', url: 'http://a/v1', disabled: true }),
      normalizeApiServer({ id: 's2', name: 'B', url: 'http://b/v1' }),
    ]);
    setActiveApiServerId('s1');
    expect(activeApiServer().id).toBe('s1');
  });
  it('activeApiServer : tous désactivés → premier du tableau (jamais null si un serveur existe)', function() {
    localStorage.clear();
    saveApiServersRaw([
      normalizeApiServer({ id: 's1', name: 'A', url: 'http://a/v1', disabled: true }),
      normalizeApiServer({ id: 's2', name: 'B', url: 'http://b/v1', disabled: true }),
    ]);
    setActiveApiServerId('');
    expect(activeApiServer().id).toBe('s1');
  });
  it('activeApiServer : aucun serveur → null', function() {
    localStorage.clear();
    saveApiServersRaw([]);
    expect(activeApiServer()).toBe(null);
  });
  it('activeApiConfig : model du serveur actif si présent', function() {
    localStorage.clear();
    saveApiServersRaw([{ id: 's1', name: 'A', url: 'http://a/v1', key: 'k', model: 'model-a' }]);
    setActiveApiServerId('s1');
    expect(activeApiConfig()).toEqual({ url: 'http://a/v1', key: 'k', model: 'model-a' });
  });
  it('activeApiConfig : model vide sur le serveur actif → filet loadSettings().model', function() {
    localStorage.clear();
    saveSettings({ model: 'legacy-model' });
    saveApiServersRaw([{ id: 's1', name: 'A', url: 'http://a/v1', key: '', model: '' }]);
    setActiveApiServerId('s1');
    expect(activeApiConfig().model).toBe('legacy-model');
  });
  it('activeApiConfig : aucun serveur → url/key vides, model de loadSettings()', function() {
    localStorage.clear();
    saveSettings({ model: 'legacy-model' });
    saveApiServersRaw([]);
    expect(activeApiConfig()).toEqual({ url: '', key: '', model: 'legacy-model' });
  });
});

describe('normalizeMcpServer (defaults et coercition)', function() {
  it('objet vide → tous les defaults', function() {
    var s = normalizeMcpServer({});
    expect(s.name).toBe('');
    expect(s.url).toBe('');
    expect(s.transport).toBe('streamable-http');
    expect(s.enabled).toBe(true);
    expect(s.authorization_token).toBe('');
    expect(s.timeout).toBe(30000);
    expect(s.toolAllowlist).toEqual([]);
    expect(s.toolDenylist).toEqual([]);
  });
  it('objet complet → valeurs conservées', function() {
    var s = normalizeMcpServer({
      name: 'jira', url: 'https://h/mcp', transport: 'sse', enabled: false,
      authorization_token: 'tok', timeout: 5000,
      toolAllowlist: ['a'], toolDenylist: ['b'],
    });
    expect(s.name).toBe('jira');
    expect(s.transport).toBe('sse');
    expect(s.enabled).toBe(false);
    expect(s.authorization_token).toBe('tok');
    expect(s.timeout).toBe(5000);
    expect(s.toolAllowlist).toEqual(['a']);
    expect(s.toolDenylist).toEqual(['b']);
  });
  it('champs de type inattendu → coercition (transport inconnu, timeout non-positif, listes non-array)', function() {
    var s = normalizeMcpServer({ transport: 'websocket', timeout: -5, toolAllowlist: 'x', toolDenylist: null });
    expect(s.transport).toBe('streamable-http');
    expect(s.timeout).toBe(30000);
    expect(s.toolAllowlist).toEqual([]);
    expect(s.toolDenylist).toEqual([]);
  });
});

describe('getMcpServer / deleteMcpServer (clé d\'identité = name)', function() {
  it('getMcpServer trouve par name ou null', function() {
    localStorage.clear();
    upsertMcpServer({ name: 'jira', url: 'https://h/mcp' });
    expect(getMcpServer('jira').url).toBe('https://h/mcp');
    expect(getMcpServer('inconnu')).toBe(null);
  });
});

describe('toggleConversationPin (épinglage)', function() {
  it('bascule pinned à true puis false et persiste', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [] });
    expect(toggleConversationPin('c1')).toBe(true);
    expect(loadConversation('c1').pinned).toBe(true);
    expect(toggleConversationPin('c1')).toBe(false);
    expect(loadConversation('c1').pinned).toBe(false);
  });
  it('retourne null pour une conversation inexistante', function() {
    localStorage.clear();
    expect(toggleConversationPin('nope')).toBe(null);
  });
  it('expose pinned dans listAllConversations', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [] });
    toggleConversationPin('c1');
    var c = listAllConversations().find(function(x) { return x.id === 'c1'; });
    expect(c.pinned).toBe(true);
  });
});

describe('listAllConversations — tri par updatedAt', function() {
  it('expose updatedAt si présent', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, updatedAt: 99, messages: [] });
    var c = listAllConversations().find(function(x) { return x.id === 'c1'; });
    expect(c.updatedAt).toBe(99);
  });
  it('trie par updatedAt quand présent, indépendamment de timestamp', function() {
    localStorage.clear();
    saveConversation({ id: 'old', title: 'a', timestamp: 10, updatedAt: 200, messages: [] });
    saveConversation({ id: 'new', title: 'b', timestamp: 100, updatedAt: 50, messages: [] });
    var ids = listAllConversations().map(function(c) { return c.id; });
    expect(ids[0]).toBe('old');   // updatedAt 200 > 50
    expect(ids[1]).toBe('new');
  });
  it('tombe sur timestamp si updatedAt absent', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 'a', timestamp: 10, messages: [] });
    saveConversation({ id: 'c2', title: 'b', timestamp: 20, messages: [] });
    var ids = listAllConversations().map(function(c) { return c.id; });
    expect(ids[0]).toBe('c2');
    expect(ids[1]).toBe('c1');
  });
});

describe('miaou-memories — CRUD et tombstones', function() {
  it('saveMemory persiste une entrée et loadMemories la retourne', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'je suis allergique aux chats', created_at: 1000, updated_at: 1000, suppressed: false });
    var all = loadMemories();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('m1');
    expect(all[0].content).toBe('je suis allergique aux chats');
  });
  it('listMemoryEntries n\'expose pas les entrées supprimées', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'actif',   created_at: 1, updated_at: 1, suppressed: false });
    saveMemory({ id: 'm2', content: 'tombstoné', created_at: 2, updated_at: 2, suppressed: true });
    var active = listMemoryEntries();
    expect(active.length).toBe(1);
    expect(active[0].id).toBe('m1');
  });
  it('editMemory met à jour content et updated_at sans créer de nouvelle entrée', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'avant', created_at: 100, updated_at: 100, suppressed: false });
    editMemory('m1', 'après');
    var all = loadMemories();
    expect(all.length).toBe(1);
    expect(all[0].content).toBe('après');
    expect(all[0].updated_at > 100).toBeTruthy();
  });
  it('suppressMemory pose une tombstone (contenu préservé)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'à supprimer', created_at: 1, updated_at: 1, suppressed: false });
    suppressMemory('m1');
    var all = loadMemories();
    expect(all[0].suppressed).toBe(true);
    expect(all[0].content).toBe('à supprimer');
    expect(listMemoryEntries().length).toBe(0);
  });
  it('restoreMemory lève la tombstone', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: true });
    restoreMemory('m1');
    expect(listMemoryEntries().length).toBe(1);
    expect(loadMemories()[0].suppressed).toBeFalsy();
  });
  it('forgetMemory supprime définitivement l\'entrée par id', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'original', created_at: 1, updated_at: 1, suppressed: false });
    saveMemory({ id: 'm2', content: 'autre',    created_at: 2, updated_at: 2, suppressed: false });
    forgetMemory('m1');
    var all = loadMemories();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('m2');
  });
});

describe('miaou-summaries — tombstone réversible', function() {
  it('une conversation sans entrée est candidate au backfill', function() {
    localStorage.clear();
    expect(isSummaryCandidate('c1')).toBeTruthy();
  });
  it('après suppression, la conversation n\'est plus candidate', function() {
    localStorage.clear();
    suppressSummary('c1');
    expect(isSummaryCandidate('c1')).toBeFalsy();
  });
  it('après ré-autorisation, elle redevient candidate', function() {
    localStorage.clear();
    suppressSummary('c1');
    restoreSummary('c1');
    expect(isSummaryCandidate('c1')).toBeTruthy();
  });
  it('une conversation avec résumé présent n\'est pas candidate', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 0, summary: 's', keywords: [] });
    expect(isSummaryCandidate('c1')).toBeFalsy();
  });
});

describe('Serveurs MCP : CRUD (miaou-mcp-servers)', function() {
  it('liste vide par défaut', function() {
    localStorage.clear();
    expect(loadMcpServers().length).toBe(0);
  });
  it('upsert insère puis met à jour par name', function() {
    localStorage.clear();
    upsertMcpServer({ name: 'jira', url: 'https://h/mcp' });
    expect(loadMcpServers().length).toBe(1);
    upsertMcpServer({ name: 'jira', url: 'https://h2/mcp' });
    var arr = loadMcpServers();
    expect(arr.length).toBe(1);
    expect(arr[0].url).toBe('https://h2/mcp');
  });
  it('normalise transport/timeout/enabled par défaut', function() {
    localStorage.clear();
    upsertMcpServer({ name: 'x', url: 'https://h/mcp' });
    var s = getMcpServer('x');
    expect(s.transport).toBe('streamable-http');
    expect(s.timeout).toBe(30000);
    expect(s.enabled).toBe(true);
  });
  it('delete retire par name', function() {
    localStorage.clear();
    upsertMcpServer({ name: 'a', url: 'https://h/mcp' });
    upsertMcpServer({ name: 'b', url: 'https://h/mcp' });
    deleteMcpServer('a');
    var arr = loadMcpServers();
    expect(arr.length).toBe(1);
    expect(arr[0].name).toBe('b');
  });
  it('listEnabledMcpServers ignore désactivés et sans url', function() {
    localStorage.clear();
    upsertMcpServer({ name: 'on', url: 'https://h/mcp', enabled: true });
    upsertMcpServer({ name: 'off', url: 'https://h/mcp', enabled: false });
    upsertMcpServer({ name: 'nourl', url: '', enabled: true });
    var en = listEnabledMcpServers();
    expect(en.length).toBe(1);
    expect(en[0].name).toBe('on');
  });
});

describe('applyMessageModelBackfill (cœur pur du backfill modèle)', function() {
  // La lecture/écriture est passée en IDB (async) au lot U-1 ; l'invariant
  // testable est la mutation : remplir les assistants sans modèle, ne jamais
  // écraser un modèle déjà posé, et signaler s'il faut réécrire.
  it('attribue le modèle aux réponses sans modèle, sans écraser', function() {
    var conv = { id: 'c1', messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'r' },
      { role: 'assistant', content: 'r2', model: 'kept' },
    ]};
    expect(applyMessageModelBackfill(conv, 'model-a')).toBe(true);
    expect(conv.messages[1].model).toBe('model-a');
    expect(conv.messages[2].model).toBe('kept');
  });
  it('ne touche pas les messages user', function() {
    var conv = { id: 'c1', messages: [{ role: 'user', content: 'q' }] };
    expect(applyMessageModelBackfill(conv, 'model-a')).toBe(false);
    expect(conv.messages[0].model === undefined).toBe(true);
  });
  it('inerte si aucun modèle résolu', function() {
    var conv = { id: 'c1', messages: [{ role: 'assistant', content: 'r' }] };
    expect(applyMessageModelBackfill(conv, '')).toBe(false);
    expect(conv.messages[0].model === undefined).toBe(true);
  });
  it('rend false si rien à faire (tout déjà attribué)', function() {
    var conv = { id: 'c1', messages: [{ role: 'assistant', content: 'r', model: 'x' }] };
    expect(applyMessageModelBackfill(conv, 'model-a')).toBe(false);
  });
  it('conversation aberrante : false, pas d\'exception', function() {
    expect(applyMessageModelBackfill(null, 'm')).toBe(false);
    expect(applyMessageModelBackfill({ id: 'c1' }, 'm')).toBe(false);
  });
});

// ── Espaces (miaou-spaces) — feature Spaces (lot C) ──────────────────────────

describe('Spaces : CRUD (miaou-spaces)', function() {
  it('registre vide par défaut (avant migration)', function() {
    localStorage.clear();
    expect(loadSpaces().length).toBe(0);
  });
  it('upsertSpace insère puis met à jour par id', function() {
    localStorage.clear();
    upsertSpace({ id: 'sp1', name: 'Perso' });
    expect(loadSpaces().length).toBe(1);
    upsertSpace({ id: 'sp1', name: 'Perso 2' });
    var arr = loadSpaces();
    expect(arr.length).toBe(1);
    expect(arr[0].name).toBe('Perso 2');
  });
  it('normalizeSpace pose id/name/description/createdAt par défaut', function() {
    localStorage.clear();
    upsertSpace({ name: 'x' });
    var s = loadSpaces()[0];
    expect(typeof s.id).toBe('string');
    expect(s.description).toBe('');
    expect(typeof s.createdAt).toBe('number');
  });
  it('getSpace retrouve par id, null sinon', function() {
    localStorage.clear();
    upsertSpace({ id: 'sp1', name: 'a' });
    expect(getSpace('sp1').name).toBe('a');
    expect(getSpace('nope')).toBe(null);
  });
  it('deleteSpaceEntry retire par id', function() {
    localStorage.clear();
    upsertSpace({ id: 'a', name: 'A' });
    upsertSpace({ id: 'b', name: 'B' });
    deleteSpaceEntry('a');
    var arr = loadSpaces();
    expect(arr.length).toBe(1);
    expect(arr[0].id).toBe('b');
  });
  it('deleteSpaceEntry est un no-op sur le default Space', function() {
    localStorage.clear();
    upsertSpace({ id: DEFAULT_SPACE_ID, name: 'Général' });
    deleteSpaceEntry(DEFAULT_SPACE_ID);
    expect(loadSpaces().length).toBe(1);
  });
  it('getActiveSpaceId retombe sur DEFAULT_SPACE_ID si rien de persisté', function() {
    localStorage.clear();
    expect(getActiveSpaceId()).toBe(DEFAULT_SPACE_ID);
  });
  it('setActiveSpaceId / getActiveSpaceId round-trip', function() {
    localStorage.clear();
    setActiveSpaceId('sp1');
    expect(getActiveSpaceId()).toBe('sp1');
  });
});

describe('migrateSpacesIfNeeded — backfill idempotent', function() {
  it('crée le registre avec le default Space si absent', function() {
    localStorage.clear();
    migrateSpacesIfNeeded();
    var spaces = loadSpaces();
    expect(spaces.length).toBe(1);
    expect(spaces[0].id).toBe(DEFAULT_SPACE_ID);
    expect(spaces[0].name).toBe('Général');
  });
  it('stampe spaceId=default sur les conversations qui en manquent', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [] });
    migrateSpacesIfNeeded();
    expect(loadConversation('c1').spaceId).toBe(DEFAULT_SPACE_ID);
  });
  it('stampe scope=default sur les souvenirs qui en manquent (PAS profile)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false });
    migrateSpacesIfNeeded();
    expect(loadMemories()[0].scope).toBe(DEFAULT_SPACE_ID);
  });
  it('double passe = même état (idempotence)', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, spaceId: 'sp-custom', messages: [] });
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    migrateSpacesIfNeeded();
    migrateSpacesIfNeeded();
    expect(loadSpaces().length).toBe(1);
    expect(loadConversation('c1').spaceId).toBe('sp-custom');   // pas écrasé
    expect(loadMemories()[0].scope).toBe('profile');            // pas écrasé
  });
});

describe('spaceConvIds — prédicat d\'herméticité', function() {
  it('retourne les ids des conversations du Space donné', function() {
    var convs = [
      { id: 'c1', spaceId: 'a' },
      { id: 'c2', spaceId: 'b' },
      { id: 'c3', spaceId: 'a' },
    ];
    var ids = spaceConvIds('a', convs);
    expect(ids.has('c1')).toBeTruthy();
    expect(ids.has('c3')).toBeTruthy();
    expect(ids.has('c2')).toBeFalsy();
  });
  it('traite une conv sans spaceId comme appartenant au default Space', function() {
    var convs = [{ id: 'c1' }];
    expect(spaceConvIds(DEFAULT_SPACE_ID, convs).has('c1')).toBeTruthy();
    expect(spaceConvIds('other', convs).has('c1')).toBeFalsy();
  });
});

describe('memoryScopesForSpace / isMemoryInScope — portée mémoire du Space actif', function() {
  it('la portée est le scope transverse profile PLUS le Space actif', function() {
    expect(memoryScopesForSpace('sp1').join(',')).toBe('profile,sp1');
  });
  it('spaceId absent → default Space (jamais une portée vide)', function() {
    expect(memoryScopesForSpace(null).join(',')).toBe('profile,' + DEFAULT_SPACE_ID);
  });
  it('souvenir du Space actif → dans la portée', function() {
    expect(isMemoryInScope({ id: 'm', scope: 'sp1' }, 'sp1')).toBe(true);
  });
  it('souvenir de profil → dans la portée, depuis n\'importe quel Space', function() {
    expect(isMemoryInScope({ id: 'm', scope: 'profile' }, 'sp1')).toBe(true);
    expect(isMemoryInScope({ id: 'm', scope: 'profile' }, 'sp-autre')).toBe(true);
  });
  it('souvenir d\'un autre Space → hors portée (herméticité)', function() {
    expect(isMemoryInScope({ id: 'm', scope: 'sp-other' }, 'sp1')).toBe(false);
  });
  it('entrée sans scope (pré-migration) vaut default Space', function() {
    expect(isMemoryInScope({ id: 'm' }, DEFAULT_SPACE_ID)).toBe(true);
    expect(isMemoryInScope({ id: 'm' }, 'sp1')).toBe(false);
  });
  it('entrée absente → hors portée, jamais de throw', function() {
    expect(isMemoryInScope(null, 'sp1')).toBe(false);
    expect(isMemoryInScope(undefined, 'sp1')).toBe(false);
  });
});

describe('listMemoryEntries — filtrage par scope', function() {
  it('sans argument, retourne toutes les entrées actives (comportement historique)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'a', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    saveMemory({ id: 'm2', content: 'b', created_at: 2, updated_at: 2, suppressed: false, scope: 'sp1' });
    expect(listMemoryEntries().length).toBe(2);
  });
  it('avec scopes, ne retourne que les scopes autorisés', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'a', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    saveMemory({ id: 'm2', content: 'b', created_at: 2, updated_at: 2, suppressed: false, scope: 'sp1' });
    saveMemory({ id: 'm3', content: 'c', created_at: 3, updated_at: 3, suppressed: false, scope: 'sp2' });
    var entries = listMemoryEntries(['profile', 'sp1']);
    expect(entries.length).toBe(2);
    expect(entries.some(function(e) { return e.id === 'm3'; })).toBeFalsy();
  });
  it('respecte toujours les tombstones sous filtrage par scope', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'a', created_at: 1, updated_at: 1, suppressed: true, scope: 'profile' });
    expect(listMemoryEntries(['profile']).length).toBe(0);
  });
});

describe('listAllConversations — expose spaceId', function() {
  it('retombe sur DEFAULT_SPACE_ID si absent', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [] });
    expect(listAllConversations()[0].spaceId).toBe(DEFAULT_SPACE_ID);
  });
  it('reprend le spaceId posé sur la conv', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, spaceId: 'sp1', messages: [] });
    expect(listAllConversations()[0].spaceId).toBe('sp1');
  });
});

describe('resolveUserSystemPrompt — description du Space ajoutée après le prompt global (D4 corrigé)', function() {
  it('concatène description du Space APRÈS le prompt global (jamais un remplacement), avec intro générique sans nom', function() {
    var r = resolveUserSystemPrompt('Prompt global', { description: 'Description du Space' });
    expect(r).toBe('Prompt global\n\n---\n\nDescription de cet espace :\nDescription du Space');
  });
  it('nom d\'espace fourni → intro le nomme', function() {
    var r = resolveUserSystemPrompt('Prompt global', { name: 'Projet X', description: 'Description du Space' });
    expect(r).toBe('Prompt global\n\n---\n\nDescription de l\'espace Projet X :\nDescription du Space');
  });
  it('seul le prompt global si le Space n\'a pas de description', function() {
    var r = resolveUserSystemPrompt('Prompt global', { description: '' });
    expect(r).toBe('Prompt global');
  });
  it('seul le prompt global si le Space est null (introuvable)', function() {
    var r = resolveUserSystemPrompt('Prompt global', null);
    expect(r).toBe('Prompt global');
  });
  it('seule la description (avec intro) si pas de prompt global', function() {
    var r = resolveUserSystemPrompt('', { description: 'Description du Space' });
    expect(r).toBe('Description de cet espace :\nDescription du Space');
  });
  it('chaîne vide si ni Space ni global', function() {
    expect(resolveUserSystemPrompt('', null)).toBe('');
    expect(resolveUserSystemPrompt('', { description: '' })).toBe('');
  });
  it('trim des deux côtés', function() {
    expect(resolveUserSystemPrompt('  global  ', null)).toBe('global');
    expect(resolveUserSystemPrompt('', { description: '  space  ' })).toBe('Description de cet espace :\nspace');
  });
});

// ── Export / import complet des données (feature E) ─────────────────────────

describe('EXPORT_KEYS', function() {
  it('liste les 7 clés localStorage du schéma', function() {
    expect(EXPORT_KEYS.length).toBe(7);
    expect(EXPORT_KEYS.indexOf('miaou-settings') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-memories') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-api-servers') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-active-api-server') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-mcp-servers') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-spaces') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-active-space') >= 0).toBeTruthy();
  });
  // U-4 : sorties d'EXPORT_KEYS, elles n'existent plus en localStorage depuis la
  // migration U-2. Les y laisser n'échouait sur rien — l'export produisait un
  // fichier valide et vide d'historique.
  it('ne contient PLUS miaou-conversations ni miaou-summaries (migrées en IDB, U-2)', function() {
    expect(EXPORT_KEYS.indexOf('miaou-conversations') === -1).toBe(true);
    expect(EXPORT_KEYS.indexOf('miaou-summaries') === -1).toBe(true);
  });
});

describe('buildExportPayload', function() {
  it('produit la structure attendue avec format/version/exportedAt', function() {
    var payload = buildExportPayload({}, [], []);
    expect(payload.format).toBe('miaou-export');
    expect(payload.version).toBe(2);
    expect(typeof payload.exportedAt).toBe('number');
  });
  it('reprend les 7 clés localStorage désérialisées', function() {
    var ls = {
      'miaou-settings': { theme: 'dark' },
      'miaou-memories': [{ id: 'm1' }],
      'miaou-api-servers': [{ id: 's1' }],
      'miaou-active-api-server': 's1',
      'miaou-mcp-servers': [{ name: 'srv' }],
      'miaou-spaces': [{ id: 'sp1' }],
      'miaou-active-space': 'sp1',
    };
    var payload = buildExportPayload(ls, [], []);
    expect(payload.localStorage['miaou-settings']).toEqual({ theme: 'dark' });
    expect(payload.localStorage['miaou-memories']).toEqual([{ id: 'm1' }]);
    expect(payload.localStorage['miaou-api-servers']).toEqual([{ id: 's1' }]);
    expect(payload.localStorage['miaou-active-api-server']).toBe('s1');
    expect(payload.localStorage['miaou-mcp-servers']).toEqual([{ name: 'srv' }]);
    expect(payload.localStorage['miaou-spaces']).toEqual([{ id: 'sp1' }]);
    expect(payload.localStorage['miaou-active-space']).toBe('sp1');
  });
  it('miaou-active-api-server et miaou-active-space restent des strings brutes (pas désérialisées en objet)', function() {
    var payload = buildExportPayload({ 'miaou-active-api-server': 'srv_xyz', 'miaou-active-space': 'sp_xyz' }, [], []);
    expect(typeof payload.localStorage['miaou-active-api-server']).toBe('string');
    expect(typeof payload.localStorage['miaou-active-space']).toBe('string');
  });
  it('sections manquantes → défauts vides (tableaux/objets), pas de crash', function() {
    var payload = buildExportPayload({}, [], []);
    expect(payload.localStorage['miaou-settings']).toEqual({});
    expect(payload.localStorage['miaou-memories']).toEqual([]);
    expect(payload.localStorage['miaou-api-servers']).toEqual([]);
    expect(payload.localStorage['miaou-active-api-server']).toBe('');
    expect(payload.localStorage['miaou-mcp-servers']).toEqual([]);
    expect(payload.localStorage['miaou-spaces']).toEqual([]);
    expect(payload.localStorage['miaou-active-space']).toBe('');
  });
  it('embarque skills et resources dans idb', function() {
    var payload = buildExportPayload({}, [{ slug: 's1' }], [{ id: 'res_1', data: 'QQ==' }]);
    expect(payload.idb.skills).toEqual([{ slug: 's1' }]);
    expect(payload.idb.resources).toEqual([{ id: 'res_1', data: 'QQ==' }]);
  });
  it('embarque conversations et résumés dans idb, PAS dans localStorage (v2)', function() {
    var convs = [{ id: 'c1', messages: [{ role: 'user', content: 'hop' }] }];
    var sums = [{ id: 'c1', summary: 'x' }];
    var payload = buildExportPayload({}, [], [], convs, sums);
    expect(payload.idb.conversations).toEqual(convs);
    expect(payload.idb.summaries).toEqual(sums);
    expect(payload.localStorage['miaou-conversations'] === undefined).toBe(true);
    expect(payload.localStorage['miaou-summaries'] === undefined).toBe(true);
  });
  it('conversations/résumés omis → tableaux vides dans idb, pas de crash', function() {
    var payload = buildExportPayload({}, [], []);
    expect(payload.idb.conversations).toEqual([]);
    expect(payload.idb.summaries).toEqual([]);
  });
  it('les messages sont conservés intégralement (l\'export est une assurance-vie)', function() {
    var msgs = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    var payload = buildExportPayload({}, [], [], [{ id: 'c1', messages: msgs }], []);
    expect(payload.idb.conversations[0].messages.length).toBe(2);
  });
});

describe('snapshotLocalStorageForExport (lit les 7 clés, tolère le JSON corrompu)', function() {
  it('clés JSON valides → parsées', function() {
    localStorage.clear();
    localStorage.setItem('miaou-settings', JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('miaou-memories', JSON.stringify([{ id: 'm1' }]));
    var snap = snapshotLocalStorageForExport();
    expect(snap['miaou-settings']).toEqual({ theme: 'dark' });
    expect(snap['miaou-memories']).toEqual([{ id: 'm1' }]);
  });
  it('ne lit plus miaou-conversations, même si la clé traîne encore', function() {
    localStorage.clear();
    localStorage.setItem('miaou-conversations', JSON.stringify([{ id: 'residu' }]));
    var snap = snapshotLocalStorageForExport();
    expect(snap['miaou-conversations'] === undefined).toBe(true);
  });
  it('miaou-active-api-server / miaou-active-space restent des strings brutes', function() {
    localStorage.clear();
    localStorage.setItem('miaou-active-api-server', 'srv_xyz');
    localStorage.setItem('miaou-active-space', 'sp_xyz');
    var snap = snapshotLocalStorageForExport();
    expect(snap['miaou-active-api-server']).toBe('srv_xyz');
    expect(snap['miaou-active-space']).toBe('sp_xyz');
  });
  it('clé au JSON corrompu → null sans crash', function() {
    localStorage.clear();
    localStorage.setItem('miaou-memories', '{not json');
    var snap = snapshotLocalStorageForExport();
    expect(snap['miaou-memories']).toBe(null);
  });
});

describe('validateImportPayload', function() {
  function validPayload() {
    return {
      format: 'miaou-export', version: 1, exportedAt: 123,
      localStorage: {
        'miaou-settings': {}, 'miaou-conversations': [{ id: 'c1' }, { id: 'c2' }],
        'miaou-summaries': {}, 'miaou-memories': [{ id: 'm1' }],
        'miaou-api-servers': [{ id: 's1' }], 'miaou-active-api-server': 's1',
        'miaou-mcp-servers': [{ name: 'srv1' }, { name: 'srv2' }],
        'miaou-spaces': [{ id: 'sp1' }], 'miaou-active-space': 'sp1',
      },
      idb: { skills: [{ slug: 'sk1' }], resources: [{ id: 'r1' }, { id: 'r2' }] },
    };
  }

  it('payload valide → ok:true avec les compteurs corrects', function() {
    var res = validateImportPayload(validPayload());
    expect(res.ok).toBeTruthy();
    expect(res.counts.conversations).toBe(2);
    expect(res.counts.memories).toBe(1);
    expect(res.counts.skills).toBe(1);
    expect(res.counts.resources).toBe(2);
    expect(res.counts.servers).toBe(3);   // 1 api-server + 2 mcp-servers
    expect(res.counts.spaces).toBe(1);
  });
  it('format inconnu → erreur', function() {
    var res = validateImportPayload(Object.assign(validPayload(), { format: 'autre-chose' }));
    expect(res.ok).toBeFalsy();
    expect(typeof res.error).toBe('string');
  });
  it('format absent (objet quelconque) → erreur', function() {
    var res = validateImportPayload({ foo: 'bar' });
    expect(res.ok).toBeFalsy();
  });
  it('version future (> 2) → erreur', function() {
    var res = validateImportPayload(Object.assign(validPayload(), { version: 3 }));
    expect(res.ok).toBeFalsy();
  });
  it('version absente/non numérique → erreur', function() {
    var res = validateImportPayload(Object.assign(validPayload(), { version: '1' }));
    expect(res.ok).toBeFalsy();
  });
  it('null/undefined → erreur, pas de crash', function() {
    expect(validateImportPayload(null).ok).toBeFalsy();
    expect(validateImportPayload(undefined).ok).toBeFalsy();
  });
  it('compte les résumés (v1 : objet indexé sous localStorage)', function() {
    var p = validPayload();
    p.localStorage['miaou-summaries'] = { c1: { summary: 'x' }, c2: { summary: 'y' } };
    var res = validateImportPayload(p);
    expect(res.counts.summaries).toBe(2);
  });
  it('sections localStorage/idb manquantes → défauts vides, pas une erreur', function() {
    var res = validateImportPayload({ format: 'miaou-export', version: 1, exportedAt: 1 });
    expect(res.ok).toBeTruthy();
    expect(res.counts.summaries).toBe(0);
    expect(res.counts.conversations).toBe(0);
    expect(res.counts.memories).toBe(0);
    expect(res.counts.skills).toBe(0);
    expect(res.counts.resources).toBe(0);
    expect(res.counts.servers).toBe(0);
    expect(res.counts.spaces).toBe(0);
  });
  it('types invalides dans localStorage (ex. conversations non-tableau) → compte à 0, pas de crash', function() {
    var p = validPayload();
    p.localStorage['miaou-conversations'] = 'pas un tableau';
    p.idb.skills = { slug: 'objet-au-lieu-de-tableau' };
    var res = validateImportPayload(p);
    expect(res.ok).toBeTruthy();
    expect(res.counts.conversations).toBe(0);
    expect(res.counts.skills).toBe(0);
  });
  it('version 1 exactement (limite) est acceptée', function() {
    var res = validateImportPayload(validPayload());
    expect(res.ok).toBeTruthy();
  });
});

describe('pruneOrphanSummaries', function() {
  it('retire les entrées dont la conversation n\'existe plus', function() {
    var summaries = { c1: { id: 'c1', summary: 'a' }, c2: { id: 'c2', summary: 'b' } };
    var convs = [{ id: 'c1' }];
    var out = pruneOrphanSummaries(summaries, convs);
    expect(Object.keys(out).length).toBe(1);
    expect(out.c1).toBeTruthy();
    expect(out.c2).toBe(undefined);
  });
  it('conserve les tombstones dont la conversation existe encore', function() {
    var summaries = { c1: { id: 'c1', suppressed: true } };
    var convs = [{ id: 'c1' }];
    var out = pruneOrphanSummaries(summaries, convs);
    expect(out.c1.suppressed).toBe(true);
  });
  it('objet vide → objet vide, pas de crash', function() {
    var out = pruneOrphanSummaries({}, []);
    expect(Object.keys(out).length).toBe(0);
  });
  it('aucune conversation supprimée → index inchangé', function() {
    var summaries = { c1: { id: 'c1', summary: 'a' } };
    var convs = [{ id: 'c1' }, { id: 'c2' }];
    var out = pruneOrphanSummaries(summaries, convs);
    expect(Object.keys(out).length).toBe(1);
  });
});

describe('genMemoryId', function() {
  it('préfixe m + base36', function() {
    var id = genMemoryId();
    expect(/^m[a-z0-9]+$/.test(id)).toBeTruthy();
  });
  it('deux appels immédiats ne collisionnent pas (suffixe aléatoire — deux memory__create du même tour)', function() {
    expect(genMemoryId() === genMemoryId()).toBeFalsy();
  });
});

// ── U-4 : format d'export v2 et rétrocompatibilité v1 ────────────────────────
// Importer un fichier `version: 1` EST une migration (les conversations y sont
// sous `localStorage`, purgé depuis U-2). C'est le seul chemin de migration qui
// reste après U-2, et il est déclenché par un fichier — donc jamais exercé par
// un scénario qui part d'une base neuve sans importer.

describe('normalizeLegacySummaryMap (forme héritée { id: entry } → records)', function() {
  it('objet indexé → tableau de records portant leur id', function() {
    var out = normalizeLegacySummaryMap({ c1: { summary: 'x' }, c2: { summary: 'y' } });
    expect(out.length).toBe(2);
    expect(out[0].id).toBe('c1');
    expect(out[0].summary).toBe('x');
    expect(out[1].id).toBe('c2');
  });
  it('id réaffirmé depuis la clé, même si l\'entrée en porte un autre (la clé fait foi)', function() {
    var out = normalizeLegacySummaryMap({ c1: { id: 'autre', summary: 'x' } });
    expect(out[0].id).toBe('c1');
  });
  it('entrées non-objet ignorées, le reste passe', function() {
    var out = normalizeLegacySummaryMap({ c1: { summary: 'x' }, c2: null, c3: 'nope' });
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('c1');
  });
  it('objet vide → tableau vide', function() {
    expect(normalizeLegacySummaryMap({})).toEqual([]);
  });
  it('tableau ou non-objet → null (présent mais illisible, jamais confondu avec vide)', function() {
    expect(normalizeLegacySummaryMap([])).toBe(null);
    expect(normalizeLegacySummaryMap('nope')).toBe(null);
    expect(normalizeLegacySummaryMap(null)).toBe(null);
  });
  it('parseLegacySummaries délègue bien ici (une seule formule de conversion)', function() {
    var viaRaw = parseLegacySummaries(JSON.stringify({ c1: { summary: 'x' } }));
    var viaObj = normalizeLegacySummaryMap({ c1: { summary: 'x' } });
    expect(viaRaw).toEqual(viaObj);
  });
});

describe('extractImportedConvRecords (routage v1/v2 vers les records IDB)', function() {
  function v2(conversations, summaries) {
    return { format: 'miaou-export', version: 2, idb: { conversations: conversations, summaries: summaries } };
  }
  function v1(conversations, summariesMap) {
    return { format: 'miaou-export', version: 1, localStorage: { 'miaou-conversations': conversations, 'miaou-summaries': summariesMap } };
  }

  it('v2 : lit la section idb telle quelle', function() {
    var out = extractImportedConvRecords(v2([{ id: 'c1', messages: [] }], [{ id: 'c1', summary: 'x' }]));
    expect(out.conversations.length).toBe(1);
    expect(out.conversations[0].id).toBe('c1');
    expect(out.summaries.length).toBe(1);
    expect(out.summaries[0].id).toBe('c1');
  });
  it('v1 : lit la section localStorage et convertit les résumés en records', function() {
    var out = extractImportedConvRecords(v1([{ id: 'c1', messages: [] }], { c1: { summary: 'x' } }));
    expect(out.conversations.length).toBe(1);
    expect(out.conversations[0].id).toBe('c1');
    expect(out.summaries.length).toBe(1);
    expect(out.summaries[0].id).toBe('c1');
    expect(out.summaries[0].summary).toBe('x');
  });
  it('v1 : les messages traversent intacts (c\'est tout l\'enjeu de l\'import)', function() {
    var msgs = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    var out = extractImportedConvRecords(v1([{ id: 'c1', messages: msgs }], {}));
    expect(out.conversations[0].messages.length).toBe(2);
    expect(out.conversations[0].messages[1].content).toBe('b');
  });
  it('un record sans id est écarté (id = keyPath, le put jetterait)', function() {
    var out = extractImportedConvRecords(v2([{ id: 'c1' }, { messages: [] }, null, { id: '' }], []));
    expect(out.conversations.length).toBe(1);
    expect(out.conversations[0].id).toBe('c1');
  });
  it('v2 : ne complète PAS depuis localStorage (la section a autorité pour sa version)', function() {
    var p = v2([], []);
    p.localStorage = { 'miaou-conversations': [{ id: 'vieux' }] };
    expect(extractImportedConvRecords(p).conversations).toEqual([]);
  });
  it('v1 : ignore une section idb.conversations qui traînerait', function() {
    var p = v1([{ id: 'c1' }], {});
    p.idb = { conversations: [{ id: 'intrus' }] };
    var out = extractImportedConvRecords(p);
    expect(out.conversations.length).toBe(1);
    expect(out.conversations[0].id).toBe('c1');
  });
  it('sections absentes → tableaux vides, pas de crash', function() {
    expect(extractImportedConvRecords({ version: 2 }).conversations).toEqual([]);
    expect(extractImportedConvRecords({ version: 1 }).summaries).toEqual([]);
    expect(extractImportedConvRecords({}).conversations).toEqual([]);
    expect(extractImportedConvRecords(null).conversations).toEqual([]);
  });
  it('v1 aux résumés illisibles (tableau au lieu d\'objet) → vide, pas de crash', function() {
    var out = extractImportedConvRecords(v1([{ id: 'c1' }], [{ id: 'c1' }]));
    expect(out.summaries).toEqual([]);
    expect(out.conversations.length).toBe(1);
  });
  it('aller-retour v2 : ce que buildExportPayload écrit, extract le relit à l\'identique', function() {
    var convs = [{ id: 'c1', title: 'T', messages: [{ role: 'user', content: 'a' }] }];
    var sums = [{ id: 'c1', summary: 'x' }];
    var payload = buildExportPayload({}, [], [], convs, sums);
    var out = extractImportedConvRecords(payload);
    expect(out.conversations).toEqual(convs);
    expect(out.summaries).toEqual(sums);
  });
  it('le compte de validateImportPayload correspond à ce qu\'extract rendra (v1 comme v2)', function() {
    var p1 = v1([{ id: 'c1' }, { id: 'c2' }], { c1: { summary: 'x' } });
    p1.exportedAt = 1;
    expect(validateImportPayload(p1).counts.conversations).toBe(extractImportedConvRecords(p1).conversations.length);
    expect(validateImportPayload(p1).counts.summaries).toBe(extractImportedConvRecords(p1).summaries.length);
    var p2 = v2([{ id: 'c1' }], [{ id: 'c1' }, { id: 'c2' }]);
    p2.exportedAt = 1;
    expect(validateImportPayload(p2).counts.conversations).toBe(extractImportedConvRecords(p2).conversations.length);
    expect(validateImportPayload(p2).counts.summaries).toBe(extractImportedConvRecords(p2).summaries.length);
  });
});

// splitConvRecord / joinConvRecord (lot U-1) : la frontière entre les deux
// étages du cache RAM. L'invariant tenu ici — « jamais de messages en étage 1,
// toujours un tableau en étage 2 » — n'est vérifiable que sur ces deux
// fonctions pures : le cache lui-même est du câblage IDB, hors QuickJS.
describe('splitConvRecord / joinConvRecord — frontière des deux étages du cache', function() {
  it('sépare les métadonnées des messages', function() {
    var out = splitConvRecord({ id: 'c1', title: 'T', timestamp: 5, messages: [{ role: 'user', content: 'a' }] });
    expect(out.meta.id).toBe('c1');
    expect(out.meta.title).toBe('T');
    expect(out.meta.timestamp).toBe(5);
    expect(out.messages.length).toBe(1);
  });
  it('l\'étage 1 ne porte JAMAIS de messages, même volumineux', function() {
    var out = splitConvRecord({ id: 'c1', messages: [{ role: 'user', content: 'x' }] });
    expect('messages' in out.meta).toBe(false);
  });
  it('conserve TOUS les champs de métadonnées, y compris ceux ajoutés plus tard', function() {
    // Une liste blanche figée périmerait en silence à l'ajout d'un champ (pin,
    // modèle, effort de raisonnement…) : le split copie tout sauf `messages`.
    var out = splitConvRecord({
      id: 'c1', title: 'T', timestamp: 1, updatedAt: 2, pinned: true,
      spaceId: 'sp', model: 'm', reasoningEffort: 'high', champInedit: 42, messages: [],
    });
    expect(out.meta.pinned).toBe(true);
    expect(out.meta.spaceId).toBe('sp');
    expect(out.meta.model).toBe('m');
    expect(out.meta.reasoningEffort).toBe('high');
    expect(out.meta.champInedit).toBe(42);
  });
  it('messages absent ou non-tableau → tableau vide (jamais undefined)', function() {
    expect(splitConvRecord({ id: 'c1' }).messages.length).toBe(0);
    expect(splitConvRecord({ id: 'c1', messages: null }).messages.length).toBe(0);
    expect(splitConvRecord({ id: 'c1', messages: 'oups' }).messages.length).toBe(0);
  });
  it('joinConvRecord recompose, et messages reste toujours un tableau', function() {
    var conv = joinConvRecord({ id: 'c1', title: 'T' }, [{ role: 'user', content: 'a' }]);
    expect(conv.id).toBe('c1');
    expect(conv.title).toBe('T');
    expect(conv.messages.length).toBe(1);
    expect(joinConvRecord({ id: 'c1' }, null).messages.length).toBe(0);
    expect(joinConvRecord({ id: 'c1' }, undefined).messages.length).toBe(0);
  });
  it('aller-retour split → join : conversation identique', function() {
    var conv = { id: 'c1', title: 'T', timestamp: 3, pinned: true, spaceId: 'sp',
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] };
    var out = splitConvRecord(conv);
    expect(joinConvRecord(out.meta, out.messages)).toEqual(conv);
  });
  it('joinConvRecord ne mute pas les métadonnées d\'étage 1', function() {
    // L'étage 1 est PARTAGÉ : une mutation depuis la recomposition
    // contaminerait la sidebar de toutes les conversations recomposées.
    var meta = { id: 'c1', title: 'T' };
    joinConvRecord(meta, [{ role: 'user', content: 'a' }]);
    expect('messages' in meta).toBe(false);
  });
});

describe('utf8ByteLength (mesure du stockage)', function() {
  it('compte 1 octet par caractère ASCII', function() {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('')).toBe(0);
  });
  it('compte 2 octets pour un accent latin', function() {
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('résumé')).toBe(8);
  });
  it('compte 3 octets pour un caractère hors latin', function() {
    expect(utf8ByteLength('☺')).toBe(3);
  });
  it('compte 4 octets pour une paire de substitution (emoji)', function() {
    // Un emoji hors BMP est une paire surrogate en UTF-16 : 4 octets en UTF-8,
    // pas 6 — c'est le cas que rate un comptage naïf par charCodeAt.
    expect(utf8ByteLength('😺')).toBe(4);
  });
  it('tolère null et undefined', function() {
    expect(utf8ByteLength(null)).toBe(0);
    expect(utf8ByteLength(undefined)).toBe(0);
  });
});

describe('sumRecordBytes / recordByteLength', function() {
  it('somme le poids JSON des enregistrements', function() {
    var recs = [{ a: 1 }, { b: 2 }];
    expect(sumRecordBytes(recs)).toBe(recordByteLength(recs[0]) + recordByteLength(recs[1]));
  });
  it('rend 0 sur une liste vide ou absente', function() {
    expect(sumRecordBytes([])).toBe(0);
    expect(sumRecordBytes(null)).toBe(0);
  });
  it('rend 0 plutôt que de lever sur une structure circulaire', function() {
    var a = {}; a.self = a;
    expect(recordByteLength(a)).toBe(0);
  });
});

describe('buildStorageReport', function() {
  it('totalise le détail et calcule le pourcentage de quota', function() {
    var r = buildStorageReport(
      { settings: 100, conversations: 200, summaries: 50, resources: 400, skills: 250 },
      { usage: 2000, quota: 10000 });
    expect(r.measured).toBe(1000);
    expect(r.usage).toBe(2000);
    expect(r.quota).toBe(10000);
    expect(r.percent).toBe(20);
  });
  it('rend usage/quota/percent à null quand estimate() est indisponible', function() {
    // Navigateur sans navigator.storage.estimate : l'UI doit pouvoir retomber
    // sur `measured` sans arithmétique sur du null.
    var r = buildStorageReport({ conversations: 42 }, null);
    expect(r.measured).toBe(42);
    expect(r.usage).toBe(null);
    expect(r.quota).toBe(null);
    expect(r.percent).toBe(null);
  });
  it('pas de division par zéro si le quota est nul', function() {
    var r = buildStorageReport({}, { usage: 5, quota: 0 });
    expect(r.percent).toBe(null);
  });
  it('normalise les catégories absentes à 0', function() {
    var r = buildStorageReport({ conversations: 10 }, null);
    expect(r.detail.resources).toBe(0);
    expect(r.detail.skills).toBe(0);
    expect(r.detail.settings).toBe(0);
  });
});
