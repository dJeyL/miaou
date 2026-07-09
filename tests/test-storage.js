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

describe('backfillCandidates (isSummaryCandidate + hasSubstance)', function() {
  it('retient une conversation sans entrée de résumé et avec substance', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [
      { role: 'user', content: 'une question assez longue' },
      { role: 'assistant', content: 'une réponse assez longue' },
    ]});
    var cands = backfillCandidates();
    expect(cands.length).toBe(1);
    expect(cands[0].id).toBe('c1');
  });
  it('exclut une conversation déjà indexée (résumé ou tombstone)', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [
      { role: 'user', content: 'une question assez longue' },
      { role: 'assistant', content: 'une réponse assez longue' },
    ]});
    saveSummary('c1', { suppressed: true });
    expect(backfillCandidates().length).toBe(0);
  });
  it('exclut une conversation sans substance', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [
      { role: 'user', content: 'ok' },
    ]});
    expect(backfillCandidates().length).toBe(0);
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
    expect(s.showCalls).toBe(true);
  });
  it('objet complet → valeurs conservées', function() {
    var s = normalizeMcpServer({
      name: 'jira', url: 'https://h/mcp', transport: 'sse', enabled: false,
      authorization_token: 'tok', timeout: 5000,
      toolAllowlist: ['a'], toolDenylist: ['b'], showCalls: false,
    });
    expect(s.name).toBe('jira');
    expect(s.transport).toBe('sse');
    expect(s.enabled).toBe(false);
    expect(s.authorization_token).toBe('tok');
    expect(s.timeout).toBe(5000);
    expect(s.toolAllowlist).toEqual(['a']);
    expect(s.toolDenylist).toEqual(['b']);
    expect(s.showCalls).toBe(false);
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

describe('backfillMessageModels (modèle du serveur API actif)', function() {
  it('attribue le modèle du serveur actif aux réponses sans modèle, sans écraser', function() {
    localStorage.clear();
    saveSettings({ model: 'legacy-model' });
    saveApiServers([{ id: 's1', name: 'A', url: 'http://a/v1', key: '', model: 'model-a' }]);
    setActiveApiServerId('s1');
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'r' },
      { role: 'assistant', content: 'r2', model: 'kept' },
    ]});
    backfillMessageModels();
    var conv = loadConversation('c1');
    expect(conv.messages[1].model).toBe('model-a');
    expect(conv.messages[2].model).toBe('kept');
  });
  it('inerte si aucun modèle résolu (ni serveur, ni legacy)', function() {
    localStorage.clear();
    saveApiServersRaw([]);
    saveConversation({ id: 'c1', title: 't', timestamp: 1, messages: [
      { role: 'assistant', content: 'r' },
    ]});
    backfillMessageModels();
    expect(loadConversation('c1').messages[0].model === undefined).toBeTruthy();
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

describe('moveConversationsToSpace (brief Cter — déplacement entre Spaces)', function() {
  it('réécrit spaceId des conversations sélectionnées', function() {
    var convs = [
      { id: 'c1', spaceId: 'a' },
      { id: 'c2', spaceId: 'a' },
      { id: 'c3', spaceId: 'b' },
    ];
    var out = moveConversationsToSpace(convs, ['c1', 'c2'], 'target');
    expect(out.find(function(c) { return c.id === 'c1'; }).spaceId).toBe('target');
    expect(out.find(function(c) { return c.id === 'c2'; }).spaceId).toBe('target');
    expect(out.find(function(c) { return c.id === 'c3'; }).spaceId).toBe('b');
  });
  it('laisse les conversations non sélectionnées inchangées (même référence)', function() {
    var untouched = { id: 'c3', spaceId: 'b' };
    var out = moveConversationsToSpace([untouched], ['c1'], 'target');
    expect(out[0]).toBe(untouched);
  });
  it('id absent du lot : aucune mutation, retourne le tableau tel quel', function() {
    var convs = [{ id: 'c1', spaceId: 'a' }];
    var out = moveConversationsToSpace(convs, ['inconnu'], 'target');
    expect(out[0].spaceId).toBe('a');
  });
  it('convs vide ou ids vide : ne casse pas', function() {
    expect(moveConversationsToSpace([], ['c1'], 'target')).toEqual([]);
    expect(moveConversationsToSpace([{ id: 'c1', spaceId: 'a' }], [], 'target')[0].spaceId).toBe('a');
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
  it('liste les 9 clés localStorage du schéma', function() {
    expect(EXPORT_KEYS.length).toBe(9);
    expect(EXPORT_KEYS.indexOf('miaou-settings') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-conversations') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-summaries') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-memories') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-api-servers') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-active-api-server') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-mcp-servers') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-spaces') >= 0).toBeTruthy();
    expect(EXPORT_KEYS.indexOf('miaou-active-space') >= 0).toBeTruthy();
  });
});

describe('buildExportPayload', function() {
  it('produit la structure attendue avec format/version/exportedAt', function() {
    var payload = buildExportPayload({}, [], []);
    expect(payload.format).toBe('miaou-export');
    expect(payload.version).toBe(1);
    expect(typeof payload.exportedAt).toBe('number');
  });
  it('reprend les 9 clés localStorage désérialisées', function() {
    var ls = {
      'miaou-settings': { theme: 'dark' },
      'miaou-conversations': [{ id: 'c1' }],
      'miaou-summaries': { c1: { summary: 'x' } },
      'miaou-memories': [{ id: 'm1' }],
      'miaou-api-servers': [{ id: 's1' }],
      'miaou-active-api-server': 's1',
      'miaou-mcp-servers': [{ name: 'srv' }],
      'miaou-spaces': [{ id: 'sp1' }],
      'miaou-active-space': 'sp1',
    };
    var payload = buildExportPayload(ls, [], []);
    expect(payload.localStorage['miaou-settings']).toEqual({ theme: 'dark' });
    expect(payload.localStorage['miaou-conversations']).toEqual([{ id: 'c1' }]);
    expect(payload.localStorage['miaou-summaries']).toEqual({ c1: { summary: 'x' } });
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
    expect(payload.localStorage['miaou-conversations']).toEqual([]);
    expect(payload.localStorage['miaou-summaries']).toEqual({});
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
});

describe('snapshotLocalStorageForExport (lit les 9 clés, tolère le JSON corrompu)', function() {
  it('clés JSON valides → parsées', function() {
    localStorage.clear();
    localStorage.setItem('miaou-settings', JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('miaou-conversations', JSON.stringify([{ id: 'c1' }]));
    var snap = snapshotLocalStorageForExport();
    expect(snap['miaou-settings']).toEqual({ theme: 'dark' });
    expect(snap['miaou-conversations']).toEqual([{ id: 'c1' }]);
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
  it('version future (> 1) → erreur', function() {
    var res = validateImportPayload(Object.assign(validPayload(), { version: 2 }));
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
  it('sections localStorage/idb manquantes → défauts vides, pas une erreur', function() {
    var res = validateImportPayload({ format: 'miaou-export', version: 1, exportedAt: 1 });
    expect(res.ok).toBeTruthy();
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
  it('deux appels immédiats ne collisionnent pas (suffixe aléatoire — deux create_memory du même tour)', function() {
    expect(genMemoryId() === genMemoryId()).toBeFalsy();
  });
});
