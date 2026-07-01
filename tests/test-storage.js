// tests/test-storage.js
// Adapter les noms de fonctions selon l'implémentation réelle.

describe('loadSettings (valeurs par défaut)', function() {
  it('retourne "propose" comme mode mémoire par défaut', function() {
    localStorage.clear();
    var s = loadSettings();
    expect(s.summaryInjectionMode).toBe('propose');
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

describe('includeToolsInSystemPrompt (injection outils dans le prompt système)', function() {
  it('est désactivé par défaut', function() {
    localStorage.clear();
    expect(loadSettings().includeToolsInSystemPrompt).toBe(false);
  });
  it('persiste l\'activation', function() {
    localStorage.clear();
    saveSettings({ includeToolsInSystemPrompt: true });
    expect(loadSettings().includeToolsInSystemPrompt).toBe(true);
  });
  it('vaut false pour un storage sans la clef (utilisateur existant)', function() {
    localStorage.clear();
    localStorage.setItem('miaou-settings', JSON.stringify({ url: 'http://test/v1', model: 'gpt-4o' }));
    expect(loadSettings().includeToolsInSystemPrompt).toBe(false);
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
  it('normalise transport/timeout/enabled/showCalls par défaut', function() {
    localStorage.clear();
    upsertMcpServer({ name: 'x', url: 'https://h/mcp' });
    var s = getMcpServer('x');
    expect(s.transport).toBe('streamable-http');
    expect(s.timeout).toBe(30000);
    expect(s.enabled).toBe(true);
    expect(s.showCalls).toBe(true);
  });
  it('showCalls false est préservé à la normalisation', function() {
    localStorage.clear();
    upsertMcpServer({ name: 'x', url: 'https://h/mcp', showCalls: false });
    expect(getMcpServer('x').showCalls).toBe(false);
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
