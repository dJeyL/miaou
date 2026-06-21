// tests/test-storage.js
// Adapter les noms de fonctions selon l'implémentation réelle.

describe('loadSettings (valeurs par défaut)', function() {
  it('retourne "propose" comme mode mémoire par défaut', function() {
    localStorage.clear();
    var s = loadSettings();
    expect(s.memoryMode).toBe('propose');
  });
});

describe('saveSettings / loadSettings', function() {
  it('persiste et restitue le modèle', function() {
    localStorage.clear();
    saveSettings({ url: 'http://test/v1', key: '', model: 'devstral-medium-2507', memoryMode: 'auto' });
    var s = loadSettings();
    expect(s.model).toBe('devstral-medium-2507');
    expect(s.memoryMode).toBe('auto');
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
    saveSettings({ model: 'devstral-medium-2512' });
    // currentConvModel vaut '' à l'état initial → fallback sur le défaut.
    expect(activeModel()).toBe('devstral-medium-2512');
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
