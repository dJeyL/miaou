// tests/test-tools.js
// Outils réels : get_conversation(id, with_contents) et
// list_conversations(since, with_contents). Voir le brief correctif.

describe('runTool — outil inconnu', function() {
  it('retourne un message d\'erreur explicite', function() {
    var r = runTool('outil_qui_n_existe_pas', {});
    expect(typeof r).toBe('string');
    expect(r).toContain('inconnu');
  });
});

describe('get_conversation', function() {
  it('retourne résumé+keywords sans with_contents', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: ['k'] });
    var r = JSON.parse(runTool('get_conversation', { id: 'c1' }));
    expect(r.summary !== undefined).toBeTruthy();
    expect(r.messages).toBeFalsy();
  });
  it('inclut messages avec with_contents=true', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: ['k'] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, messages: [{ role: 'user', content: 'salut' }] });
    var r = JSON.parse(runTool('get_conversation', { id: 'c1', with_contents: true }));
    expect(r.messages !== undefined).toBeTruthy();
  });
  it('introuvable si aucun souvenir', function() {
    localStorage.clear();
    var r = runTool('get_conversation', { id: 'inexistant' });
    expect(r).toContain('introuvable');
  });
  it('introuvable si le souvenir est une tombstone', function() {
    localStorage.clear();
    suppressSummary('c1');
    var r = runTool('get_conversation', { id: 'c1' });
    expect(r).toContain('introuvable');
  });
});

describe('list_conversations', function() {
  it('sans since, liste toutes les conversations', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't1', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c0', { title: 't0', timestamp: Date.parse('2025-01-01T00:00:00Z'), summary: 's', keywords: [] });
    var r = JSON.parse(runTool('list_conversations', {}));
    expect(Array.isArray(r)).toBeTruthy();
    expect(r.length).toBe(2);
  });
  it('rejette une date fournie mais invalide', function() {
    var r = runTool('list_conversations', { since: 'pas une date' });
    expect(r).toContain('invalide');
  });
  it('filtre par date', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c0', { title: 'vieux', timestamp: Date.parse('2025-01-01T00:00:00Z'), summary: 's', keywords: [] });
    var r = JSON.parse(runTool('list_conversations', { since: '2026-01-01T00:00:00Z' }));
    expect(Array.isArray(r)).toBeTruthy();
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('c1');
  });
  it('exclut les tombstones', function() {
    localStorage.clear();
    suppressSummary('c1');
    var r = JSON.parse(runTool('list_conversations', { since: '2000-01-01T00:00:00Z' }));
    expect(r.length).toBe(0);
  });
});

describe('toolDefinitions', function() {
  it('expose get_conversation et list_conversations', function() {
    var defs = toolDefinitions();
    var names = defs.map(function(d) { return d.function.name; });
    expect(names.indexOf('get_conversation') >= 0).toBeTruthy();
    expect(names.indexOf('list_conversations') >= 0).toBeTruthy();
  });
  it('get_conversation et list_conversations déclarent un booléen with_contents', function() {
    var defs = toolDefinitions();
    ['get_conversation', 'list_conversations'].forEach(function(name) {
      var d = defs.find(function(d) { return d.function.name === name; });
      expect(d.function.parameters.properties.with_contents.type).toBe('boolean');
    });
  });
});
