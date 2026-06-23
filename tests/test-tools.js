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
  it('expose create_memory, update_memory, delete_memory, ask_confirmation', function() {
    var defs = toolDefinitions();
    var names = defs.map(function(d) { return d.function.name; });
    expect(names.indexOf('create_memory') >= 0).toBeTruthy();
    expect(names.indexOf('update_memory') >= 0).toBeTruthy();
    expect(names.indexOf('delete_memory') >= 0).toBeTruthy();
    expect(names.indexOf('ask_confirmation') >= 0).toBeTruthy();
  });
});

describe('ask_confirmation — outil halting', function() {
  it('est exposé dans toolDefinitions avec un paramètre question requis', function() {
    var d = toolDefinitions().find(function(d) { return d.function.name === 'ask_confirmation'; });
    expect(d !== undefined).toBeTruthy();
    expect(d.function.parameters.properties.question.type).toBe('string');
    expect(d.function.parameters.required.indexOf('question') >= 0).toBeTruthy();
  });
  it('porte le flag halting sur son entrée TOOLS', function() {
    var t = TOOLS.find(function(t) { return t.definition.function.name === 'ask_confirmation'; });
    expect(t.halting).toBe(true);
  });
  it('toolIsHalting le reconnaît, et pas les outils non-halting ni inconnus', function() {
    expect(toolIsHalting('ask_confirmation')).toBe(true);
    expect(toolIsHalting('get_conversation')).toBe(false);
    expect(toolIsHalting('outil_inconnu')).toBe(false);
  });
});

describe('create_memory — écriture directe', function() {
  it('enregistre le souvenir, retourne un accusé avec identifiant et pousse un ack', function() {
    localStorage.clear();
    clearPendingMemoryAcks();
    var r = runTool('create_memory', { content: 'préfère les réponses courtes' });
    expect(r).toContain('enregistré');
    expect(r).toContain('Identifiant');
    var entries = listMemoryEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe('préfère les réponses courtes');
    var pending = getPendingMemoryAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].ackType).toBe('create');
    expect(pending[0].id).toBe(entries[0].id);
    expect(pending[0].content).toBe('préfère les réponses courtes');
  });
  it('rejette un contenu vide et ne pousse pas d\'ack', function() {
    localStorage.clear();
    clearPendingMemoryAcks();
    var r = runTool('create_memory', { content: '   ' });
    expect(r).toContain('ignoré');
    expect(listMemoryEntries().length).toBe(0);
    expect(getPendingMemoryAcks().length).toBe(0);
  });
});

describe('update_memory — correction in-place', function() {
  it('met à jour le contenu sans créer de nouvelle entrée et pousse un ack', function() {
    localStorage.clear();
    clearPendingMemoryAcks();
    saveMemory({ id: 'm1', content: 'avant', created_at: 1, updated_at: 1, suppressed: false });
    var r = runTool('update_memory', { id: 'm1', content: 'après' });
    expect(r).toContain('mis à jour');
    var all = loadMemories();
    expect(all.length).toBe(1);
    expect(all[0].content).toBe('après');
    var pending = getPendingMemoryAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].ackType).toBe('update');
    expect(pending[0].id).toBe('m1');
    expect(pending[0].content).toBe('après');
  });
  it('rejette les paramètres invalides et ne pousse pas d\'ack', function() {
    clearPendingMemoryAcks();
    var r = runTool('update_memory', { id: 'm1' });
    expect(r).toContain('invalide');
    expect(getPendingMemoryAcks().length).toBe(0);
  });
});

describe('delete_memory — tombstone', function() {
  it('pose une tombstone réversible et pousse un ack avec contenu', function() {
    localStorage.clear();
    clearPendingMemoryAcks();
    saveMemory({ id: 'm1', content: 'obsolète', created_at: 1, updated_at: 1, suppressed: false });
    var r = runTool('delete_memory', { id: 'm1' });
    expect(r).toContain('supprimé');
    expect(loadMemories()[0].suppressed).toBe(true);
    expect(listMemoryEntries().length).toBe(0);
    var pending = getPendingMemoryAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].ackType).toBe('delete');
    expect(pending[0].id).toBe('m1');
    expect(pending[0].content).toBe('obsolète');
  });
  it('rejette un id manquant et ne pousse pas d\'ack', function() {
    clearPendingMemoryAcks();
    var r = runTool('delete_memory', {});
    expect(r).toContain('manquant');
    expect(getPendingMemoryAcks().length).toBe(0);
  });
});

describe('toolsSystemPrompt', function() {
  it('contient le nom de chaque outil', function() {
    var s = toolsSystemPrompt();
    TOOLS.forEach(function(t) {
      expect(s.indexOf(t.definition.function.name) >= 0).toBeTruthy();
    });
  });
  it('retourne une chaîne non vide si TOOLS est peuplé', function() {
    expect(toolsSystemPrompt().length > 0).toBeTruthy();
  });
});

describe('memoryDoctrinePrompt', function() {
  it('retourne une chaîne non vide (create_memory et ask_confirmation sont présents)', function() {
    var s = memoryDoctrinePrompt();
    expect(s.length > 0).toBeTruthy();
  });
  it('mentionne create_memory et ask_confirmation pour orienter le modèle', function() {
    var s = memoryDoctrinePrompt();
    expect(s.indexOf('create_memory') >= 0).toBeTruthy();
    expect(s.indexOf('ask_confirmation') >= 0).toBeTruthy();
  });
});
