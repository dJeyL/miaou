// tests/test-tools.js

// Helpers : flattenToolResult(callTool(...)) reproduit l'ancien runTool(name, args).
function ct(name, args) { return flattenToolResult(callTool(name, args)); }

describe('flattenToolResult', function() {
  it('renvoie une chaîne vide sur entrée nulle ou sans content', function() {
    expect(flattenToolResult(null)).toBe('');
    expect(flattenToolResult({})).toBe('');
    expect(flattenToolResult({ content: null })).toBe('');
  });
  it('extrait le texte d\'un seul bloc text', function() {
    expect(flattenToolResult({ content: [{ type: 'text', text: 'hello' }], isError: false })).toBe('hello');
  });
  it('joint plusieurs blocs text par un saut de ligne', function() {
    var r = flattenToolResult({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], isError: false });
    expect(r).toBe('a\nb');
  });
  it('remplace les blocs non-text par un marqueur neutre, jamais le binaire (Correction A)', function() {
    var r = flattenToolResult({ content: [
      { type: 'image', data: 'AAAABBBBCCCC' },
      { type: 'text', text: 'visible' },
      { type: 'resource', resource: { blob: 'ZZZZ' } },
    ], isError: false });
    expect(r).toContain('visible');
    expect(r).toContain('[image rendue dans l\'interface]');
    expect(r).toContain('[ressource rendue dans l\'interface]');
    expect(r.indexOf('AAAABBBBCCCC')).toBe(-1);   // aucun base64 réinjecté
    expect(r.indexOf('ZZZZ')).toBe(-1);
  });
  it('resource avec text → passé au LLM (JSON structuré)', function() {
    var r = flattenToolResult({ content: [{ type: 'resource', resource: { text: '{"foo":1}', mimeType: 'application/json' } }], isError: false });
    expect(r).toBe('{"foo":1}');
  });
  it('résultat image-only → marqueur neutre, pas une chaîne vide', function() {
    var r = flattenToolResult({ content: [{ type: 'image', data: 'xxx', mimeType: 'image/png' }], isError: false });
    expect(r).toBe('[image rendue dans l\'interface]');
  });
  it('extrait le texte d\'un résultat isError: true (surfacé au modèle)', function() {
    var r = flattenToolResult({ content: [{ type: 'text', text: 'Erreur outil X : boom' }], isError: true });
    expect(r).toContain('Erreur');
    expect(r).toContain('boom');
  });
});

describe('callTool — dispatch registre', function() {
  it('renvoie { content, isError } pour un outil connu', function() {
    localStorage.clear();
    var res = callTool('list_conversations', {});
    expect(typeof res).toBe('object');
    expect(Array.isArray(res.content)).toBeTruthy();
    expect(res.isError).toBe(false);
  });
  it('renvoie isError: true pour un outil inconnu', function() {
    var res = callTool('outil_qui_n_existe_pas', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].type).toBe('text');
    expect(res.content[0].text).toContain('inconnu');
  });
  it('les blocs content sont de type text', function() {
    localStorage.clear();
    var res = callTool('list_conversations', {});
    res.content.forEach(function(b) { expect(b.type).toBe('text'); });
  });
});

describe('callTool — outil inconnu (via flattenToolResult)', function() {
  it('retourne un message d\'erreur explicite', function() {
    var r = ct('outil_qui_n_existe_pas', {});
    expect(typeof r).toBe('string');
    expect(r).toContain('inconnu');
  });
});

describe('get_conversation', function() {
  it('retourne résumé+keywords sans with_contents', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: ['k'] });
    var r = JSON.parse(ct('get_conversation', { id: 'c1' }));
    expect(r.summary !== undefined).toBeTruthy();
    expect(r.messages).toBeFalsy();
  });
  it('inclut messages avec with_contents=true', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: ['k'] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, messages: [{ role: 'user', content: 'salut' }] });
    var r = JSON.parse(ct('get_conversation', { id: 'c1', with_contents: true }));
    expect(r.messages !== undefined).toBeTruthy();
  });
  it('introuvable si aucun souvenir', function() {
    localStorage.clear();
    var r = ct('get_conversation', { id: 'inexistant' });
    expect(r).toContain('introuvable');
  });
  it('introuvable si le souvenir est une tombstone', function() {
    localStorage.clear();
    suppressSummary('c1');
    var r = ct('get_conversation', { id: 'c1' });
    expect(r).toContain('introuvable');
  });
  it('pousse un ack conversation_read avec le titre quand trouvé', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveSummary('c1', { title: 'Mon titre', timestamp: 1000, summary: 's', keywords: [] });
    ct('get_conversation', { id: 'c1' });
    var pending = getPendingToolAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].kind).toBe('conversation_read');
    expect(pending[0].title).toBe('Mon titre');
  });
  it('ne pousse pas d\'ack quand introuvable', function() {
    localStorage.clear();
    clearPendingToolAcks();
    ct('get_conversation', { id: 'inexistant' });
    expect(getPendingToolAcks().length).toBe(0);
  });
});

describe('list_conversations', function() {
  it('sans since, liste toutes les conversations', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't1', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c0', { title: 't0', timestamp: Date.parse('2025-01-01T00:00:00Z'), summary: 's', keywords: [] });
    var r = JSON.parse(ct('list_conversations', {}));
    expect(Array.isArray(r)).toBeTruthy();
    expect(r.length).toBe(2);
  });
  it('rejette une date fournie mais invalide', function() {
    var r = ct('list_conversations', { since: 'pas une date' });
    expect(r).toContain('invalide');
  });
  it('filtre par date', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c0', { title: 'vieux', timestamp: Date.parse('2025-01-01T00:00:00Z'), summary: 's', keywords: [] });
    var r = JSON.parse(ct('list_conversations', { since: '2026-01-01T00:00:00Z' }));
    expect(Array.isArray(r)).toBeTruthy();
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('c1');
  });
  it('exclut les tombstones', function() {
    localStorage.clear();
    suppressSummary('c1');
    var r = JSON.parse(ct('list_conversations', { since: '2000-01-01T00:00:00Z' }));
    expect(r.length).toBe(0);
  });
  it('pousse un ack conversation_list avec le count post-filtre', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveSummary('c1', { title: 't', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c0', { title: 'vieux', timestamp: Date.parse('2025-01-01T00:00:00Z'), summary: 's', keywords: [] });
    ct('list_conversations', { since: '2026-01-01T00:00:00Z' });
    var pending = getPendingToolAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].kind).toBe('conversation_list');
    expect(pending[0].count).toBe(1);
  });
});

describe('acks d\'outils — helpers', function() {
  it('isAckRole reconnaît le rôle neuf et le legacy', function() {
    expect(isAckRole('tool-ack')).toBe(true);
    expect(isAckRole('memory-ack')).toBe(true);
    expect(isAckRole('assistant')).toBe(false);
    expect(isAckRole('user')).toBe(false);
  });
  it('ackKindOf : kind présent, legacy ackType, ou null', function() {
    expect(ackKindOf({ kind: 'conversation_read' })).toBe('conversation_read');
    expect(ackKindOf({ ackType: 'create' })).toBe('memory_create');
    expect(ackKindOf({ ackType: 'delete' })).toBe('memory_delete');
    expect(ackKindOf({})).toBe(null);
  });
  it('ackLabel mémoire reproduit les libellés existants', function() {
    expect(ackLabel('memory_create', { content: 'x' })).toContain('Mémorisé');
    expect(ackLabel('memory_update', { content: 'x' })).toContain('mis à jour');
    expect(ackLabel('memory_delete', { content: 'x' })).toContain('supprimé');
    // delete sans content : pas de séparateur
    expect(ackLabel('memory_delete', {})).toBe('Souvenir supprimé');
  });
  it('ackLabel conversation_read : titre ou repli', function() {
    expect(ackLabel('conversation_read', { title: 'Titre' })).toContain('Titre');
    expect(ackLabel('conversation_read', {})).toContain('sans titre');
  });
  it('ackLabel conversation_list : branches 0 / 1 / n / null', function() {
    expect(ackLabel('conversation_list', { count: 0 })).toContain('Aucune');
    expect(ackLabel('conversation_list', { count: 1 })).toBe('1 conversation listée');
    expect(ackLabel('conversation_list', { count: 3 })).toBe('3 conversations listées');
    expect(ackLabel('conversation_list', {})).toContain('?');
  });
  it('ackLabel mcp_call : breadcrumb avec les deux segments', function() {
    var lbl = ackLabel('mcp_call', { name: 'bench__echo' });
    expect(lbl).toContain('bench');
    expect(lbl).toContain('echo');
    expect(lbl).toContain('›');
  });
  it('ackLabel mcp_call : 3 segments (namespace gateway)', function() {
    var lbl = ackLabel('mcp_call', { name: 'gw__bench__echo' });
    expect(lbl).toContain('gw');
    expect(lbl).toContain('bench');
    expect(lbl).toContain('echo');
  });
  it('ackLabel mcp_call : segments vides filtrés (double/triple __)', function() {
    var lbl = ackLabel('mcp_call', { name: '__echo__' });
    expect(lbl).toContain('echo');
    // aucun segment vide ne produit de › orphelin
    expect(lbl.indexOf('››') >= 0).toBe(false);
  });
  it('ackLabel mcp_call : name absent → libellé neutre', function() {
    var lbl = ackLabel('mcp_call', {});
    expect(lbl).toContain('Appel');
  });
});

describe('toolDefinitions', function() {
  it('expose miaou__get_conversation et miaou__list_conversations (préfixés V2)', function() {
    var defs = toolDefinitions();
    var names = defs.map(function(d) { return d.function.name; });
    expect(names.indexOf('miaou__get_conversation') >= 0).toBeTruthy();
    expect(names.indexOf('miaou__list_conversations') >= 0).toBeTruthy();
  });
  it('get_conversation et list_conversations déclarent un booléen with_contents', function() {
    var defs = toolDefinitions();
    ['miaou__get_conversation', 'miaou__list_conversations'].forEach(function(name) {
      var d = defs.find(function(d) { return d.function.name === name; });
      expect(d.function.parameters.properties.with_contents.type).toBe('boolean');
    });
  });
  it('expose miaou__create/update/delete_memory et ask_confirmation (nu)', function() {
    var defs = toolDefinitions();
    var names = defs.map(function(d) { return d.function.name; });
    expect(names.indexOf('miaou__create_memory') >= 0).toBeTruthy();
    expect(names.indexOf('miaou__update_memory') >= 0).toBeTruthy();
    expect(names.indexOf('miaou__delete_memory') >= 0).toBeTruthy();
    expect(names.indexOf('ask_confirmation') >= 0).toBeTruthy();   // hors registre, NON préfixé
  });
  it('chaque définition est au format OpenAI (type function, parameters)', function() {
    toolDefinitions().forEach(function(d) {
      expect(d.type).toBe('function');
      expect(typeof d.function.name).toBe('string');
      expect(typeof d.function.parameters).toBe('object');
    });
  });
});

describe('ask_confirmation — outil halting', function() {
  it('est exposé dans toolDefinitions avec un paramètre question requis', function() {
    var d = toolDefinitions().find(function(d) { return d.function.name === 'ask_confirmation'; });
    expect(d !== undefined).toBeTruthy();
    expect(d.function.parameters.properties.question.type).toBe('string');
    expect(d.function.parameters.required.indexOf('question') >= 0).toBeTruthy();
  });
  it('toolIsHalting le reconnaît, et pas les outils non-halting ni inconnus', function() {
    expect(toolIsHalting('ask_confirmation')).toBe(true);
    expect(toolIsHalting('get_conversation')).toBe(false);
    expect(toolIsHalting('outil_inconnu')).toBe(false);
  });
  it('n\'est pas dans le registre MCP TOOLS (callTool renvoie isError: true)', function() {
    var res = callTool('ask_confirmation', { question: 'test ?' });
    expect(res.isError).toBe(true);
  });
});

describe('registre MCP — annotations', function() {
  it('tous les outils TOOLS portent readOnlyHint et destructiveHint', function() {
    TOOLS.forEach(function(t) {
      expect(typeof t.annotations.readOnlyHint).toBe('boolean');
      expect(typeof t.annotations.destructiveHint).toBe('boolean');
    });
  });
  it('les outils de lecture sont readOnlyHint: true', function() {
    ['get_conversation', 'list_conversations'].forEach(function(name) {
      var t = TOOLS.find(function(t) { return t.name === name; });
      expect(t.annotations.readOnlyHint).toBe(true);
    });
  });
  it('les outils d\'écriture sont readOnlyHint: false', function() {
    ['create_memory', 'update_memory', 'delete_memory'].forEach(function(name) {
      var t = TOOLS.find(function(t) { return t.name === name; });
      expect(t.annotations.readOnlyHint).toBe(false);
    });
  });
  it('ask_confirmation n\'est pas dans TOOLS (pas de readOnlyHint sur le registre)', function() {
    var t = TOOLS.find(function(t) { return t.name === 'ask_confirmation'; });
    expect(t).toBeFalsy();
  });
});

describe('create_memory — écriture directe', function() {
  it('enregistre le souvenir, retourne un accusé avec identifiant et pousse un ack', function() {
    localStorage.clear();
    clearPendingToolAcks();
    var r = ct('create_memory', { content: 'préfère les réponses courtes' });
    expect(r).toContain('enregistré');
    expect(r).toContain('Identifiant');
    var entries = listMemoryEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].content).toBe('préfère les réponses courtes');
    var pending = getPendingToolAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].kind).toBe('memory_create');
    expect(pending[0].id).toBe(entries[0].id);
    expect(pending[0].content).toBe('préfère les réponses courtes');
  });
  it('rejette un contenu vide et ne pousse pas d\'ack', function() {
    localStorage.clear();
    clearPendingToolAcks();
    var r = ct('create_memory', { content: '   ' });
    expect(r).toContain('ignoré');
    expect(listMemoryEntries().length).toBe(0);
    expect(getPendingToolAcks().length).toBe(0);
  });
});

describe('update_memory — correction in-place', function() {
  it('met à jour le contenu sans créer de nouvelle entrée et pousse un ack', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveMemory({ id: 'm1', content: 'avant', created_at: 1, updated_at: 1, suppressed: false });
    var r = ct('update_memory', { id: 'm1', content: 'après' });
    expect(r).toContain('mis à jour');
    var all = loadMemories();
    expect(all.length).toBe(1);
    expect(all[0].content).toBe('après');
    var pending = getPendingToolAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].kind).toBe('memory_update');
    expect(pending[0].id).toBe('m1');
    expect(pending[0].content).toBe('après');
    expect(pending[0].prevContent).toBe('avant');   // capturé avant écrasement pour l'undo
  });
  it('rejette les paramètres invalides et ne pousse pas d\'ack', function() {
    clearPendingToolAcks();
    var r = ct('update_memory', { id: 'm1' });
    expect(r).toContain('invalide');
    expect(getPendingToolAcks().length).toBe(0);
  });
});

describe('delete_memory — tombstone', function() {
  it('pose une tombstone réversible et pousse un ack avec contenu', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveMemory({ id: 'm1', content: 'obsolète', created_at: 1, updated_at: 1, suppressed: false });
    var r = ct('delete_memory', { id: 'm1' });
    expect(r).toContain('supprimé');
    expect(loadMemories()[0].suppressed).toBe(true);
    expect(listMemoryEntries().length).toBe(0);
    var pending = getPendingToolAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].kind).toBe('memory_delete');
    expect(pending[0].id).toBe('m1');
    expect(pending[0].content).toBe('obsolète');
  });
  it('rejette un id manquant et ne pousse pas d\'ack', function() {
    clearPendingToolAcks();
    var r = ct('delete_memory', {});
    expect(r).toContain('manquant');
    expect(getPendingToolAcks().length).toBe(0);
  });
});

describe('toolsSystemPrompt', function() {
  it('contient le nom de chaque outil du registre MCP', function() {
    var s = toolsSystemPrompt();
    TOOLS.forEach(function(t) {
      expect(s.indexOf(t.name) >= 0).toBeTruthy();
    });
  });
  it('contient aussi ask_confirmation (hors registre MCP mais dans le prompt)', function() {
    expect(toolsSystemPrompt().indexOf('ask_confirmation') >= 0).toBeTruthy();
  });
  it('retourne une chaîne non vide si TOOLS est peuplé', function() {
    expect(toolsSystemPrompt().length > 0).toBeTruthy();
  });
});

describe('memoryDoctrinePrompt', function() {
  it('retourne une chaîne non vide (create_memory est dans le registre)', function() {
    var s = memoryDoctrinePrompt();
    expect(s.length > 0).toBeTruthy();
  });
  it('mentionne create_memory et ask_confirmation pour orienter le modèle', function() {
    var s = memoryDoctrinePrompt();
    expect(s.indexOf('create_memory') >= 0).toBeTruthy();
    expect(s.indexOf('ask_confirmation') >= 0).toBeTruthy();
  });
});

describe('exposedTools / préfixage miaou__ (V2)', function() {
  it('chaque outil interne exposé est préfixé miaou__', function() {
    var ex = exposedTools();
    expect(ex.length).toBe(TOOLS.length);   // aucun serveur distant en test
    ex.forEach(function(t) {
      expect(t.name.indexOf('miaou__')).toBe(0);
    });
  });
  it('toolDefinitions expose les noms préfixés + ask_confirmation nu', function() {
    var defs = toolDefinitions();
    var names = defs.map(function(d){ return d.function.name; });
    expect(names.indexOf('miaou__create_memory') >= 0).toBeTruthy();
    expect(names.indexOf('ask_confirmation') >= 0).toBeTruthy();   // hors registre, NON préfixé
    expect(names.indexOf('create_memory') < 0).toBeTruthy();        // plus de nom nu exposé
  });
});

describe('callTool (routage par préfixe, D1)', function() {
  it('miaou__ route vers le dispatch interne', function() {
    var r = callTool('miaou__get_conversation', { id: 'inexistant' });
    expect(r.isError).toBeFalsy();
    expect(flattenToolResult(r)).toContain('introuvable');
  });
  it('nom nu (sans préfixe) route aussi vers l\'interne', function() {
    var r = callTool('get_conversation', { id: 'inexistant' });
    expect(r.isError).toBeFalsy();
  });
  it('outil interne inconnu → erreur propre', function() {
    var r = callTool('miaou__pas_un_outil', {});
    expect(r.isError).toBeTruthy();
    expect(flattenToolResult(r)).toContain('inconnu');
  });
  it('préfixe distant inconnu/désactivé → erreur propre (pas de throw)', function() {
    localStorage.removeItem('miaou-mcp-servers');
    var r = callTool('jira__search', { q: 'x' });
    expect(r.isError).toBeTruthy();
    expect(flattenToolResult(r)).toContain('désactivé');
  });
});

describe('toolsDoctrinePrompt (comportement transverse, inconditionnel)', function() {
  it('énonce la règle non-text sans toggle ni énumération', function() {
    var s = toolsDoctrinePrompt();
    expect(s.indexOf('image') >= 0).toBeTruthy();
    expect(s.indexOf('ne simule pas') >= 0).toBeTruthy();
    expect(s.indexOf('base64') >= 0).toBeTruthy();
  });
  it('la règle ne vit PLUS dans toolsSystemPrompt (énumération seule)', function() {
    expect(toolsSystemPrompt().indexOf('ne simule pas')).toBe(-1);
  });
  it('la règle ne vit PAS dans MEMORY_DOCTRINE', function() {
    expect(memoryDoctrinePrompt().indexOf('ne simule pas')).toBe(-1);
  });
});
