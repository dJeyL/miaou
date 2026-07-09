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
  it('exclut la conversation courante (currentConvId)', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't1', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c2', { title: 't2', timestamp: Date.parse('2026-03-02T00:00:00Z'), summary: 's', keywords: [] });
    currentConvId = 'c1';
    try {
      var r = JSON.parse(ct('list_conversations', {}));
      expect(r.length).toBe(1);
      expect(r[0].id).toBe('c2');
    } finally {
      currentConvId = null;
    }
  });
  it('miaou_intent (outil interne) enrichit l\'ack et n\'atteint jamais le handler', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveSummary('c1', { title: 't', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    ct('list_conversations', { since: '2000-01-01T00:00:00Z', miaou_intent: 'retrouver la conv sur X' });
    var pending = getPendingToolAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].intent).toBe('retrouver la conv sur X');
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
  it('ackLabel conversation_list : intent préfixe le libellé', function() {
    expect(ackLabel('conversation_list', { count: 3, intent: 'retrouver X' })).toBe('retrouver X : 3 conversations listées');
    expect(ackLabel('conversation_list', { count: 0, intent: 'retrouver X' })).toBe('retrouver X : Aucune conversation trouvée');
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

// ── B5 : l'intent n'enrichit que l'ack de SON propre outil ────────────────────
// Régression campagne 2026-07-09 : un handler qui sort en erreur précoce sans
// pousser d'ack ne doit pas voir son intent se coller à l'ack d'un outil
// antérieur du même tour multi-outils.
describe('callTool : intent ne déborde pas sur l\'ack d\'un outil précédent (B5)', function() {
  it('outil OK puis outil échouant sans ack : l\'intent du 2e ne réécrit pas le 1er', function() {
    localStorage.clear();
    clearPendingToolAcks();
    // 1er appel : create_memory pousse un ack memory_create + son intent.
    callTool('create_memory', { content: 'un fait à retenir', miaou_intent: 'intent-un' });
    // 2e appel : update_memory sur un id inexistant → 'Souvenir introuvable.',
    // AUCUN ack poussé. Son intent ne doit PAS se poser sur l'ack du 1er.
    callTool('update_memory', { id: 'inexistant', content: 'x', miaou_intent: 'intent-deux' });
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('memory_create');
    expect(acks[0].intent).toBe('intent-un');
  });
  it('deux outils poussant chacun un ack : chaque intent va sur le bon ack', function() {
    localStorage.clear();
    clearPendingToolAcks();
    callTool('create_memory', { content: 'premier fait', miaou_intent: 'intent-A' });
    callTool('create_memory', { content: 'second fait', miaou_intent: 'intent-B' });
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(2);
    expect(acks[0].intent).toBe('intent-A');
    expect(acks[1].intent).toBe('intent-B');
  });
});

// updateLastPendingToolAck : garde minLength (support direct du correctif B5)
describe('updateLastPendingToolAck : garde minLength', function() {
  it('sans minLength : enrichit le dernier ack', function() {
    clearPendingToolAcks();
    _pendingToolAcks.push({ kind: 'memory_create', id: '1' });
    updateLastPendingToolAck({ intent: 'x' });
    expect(getPendingToolAcks()[0].intent).toBe('x');
  });
  it('minLength égal à la longueur courante : n\'enrichit pas (aucun ack neuf)', function() {
    clearPendingToolAcks();
    _pendingToolAcks.push({ kind: 'memory_create', id: '1' });
    updateLastPendingToolAck({ intent: 'y' }, 1);   // length (1) <= minLength (1)
    expect(getPendingToolAcks()[0].intent).toBe(undefined);
  });
  it('minLength inférieur à la longueur : enrichit (un ack a été poussé)', function() {
    clearPendingToolAcks();
    _pendingToolAcks.push({ kind: 'memory_create', id: '1' });
    updateLastPendingToolAck({ intent: 'z' }, 0);   // length (1) > minLength (0)
    expect(getPendingToolAcks()[0].intent).toBe('z');
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
  it('stampe le scope avec le Space actif (brief D3)', function() {
    localStorage.clear();
    activeSpaceId = 'sp1';
    try {
      ct('create_memory', { content: 'x' });
      expect(listMemoryEntries()[0].scope).toBe('sp1');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
});

describe('Herméticité des Spaces — outils modèle (brief D2/D3)', function() {
  it('get_conversation sur une conv d\'un autre Space répond "introuvable" (pas d\'oracle)', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, spaceId: 'sp-other', messages: [] });
    activeSpaceId = 'sp1';
    try {
      var r = ct('get_conversation', { id: 'c1' });
      expect(r).toContain('introuvable');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('get_conversation sur une conv du Space actif fonctionne normalement', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, spaceId: 'sp1', messages: [] });
    activeSpaceId = 'sp1';
    try {
      var r = JSON.parse(ct('get_conversation', { id: 'c1' }));
      expect(r.summary).toBe('s');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('list_conversations exclut les conversations d\'un autre Space', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't1', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't1', timestamp: 1000, spaceId: 'sp1', messages: [] });
    saveSummary('c2', { title: 't2', timestamp: Date.parse('2026-03-02T00:00:00Z'), summary: 's', keywords: [] });
    saveConversation({ id: 'c2', title: 't2', timestamp: 1000, spaceId: 'sp-other', messages: [] });
    activeSpaceId = 'sp1';
    try {
      var r = JSON.parse(ct('list_conversations', {}));
      expect(r.length).toBe(1);
      expect(r[0].id).toBe('c1');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('update_memory refuse hors-Space ("Souvenir introuvable.")', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'sp-other' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('update_memory', { id: 'm1', content: 'y' });
      expect(r).toContain('introuvable');
      expect(loadMemories()[0].content).toBe('x');   // pas modifié
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('update_memory refuse un souvenir de scope profile (pas exposé aux outils Space)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('update_memory', { id: 'm1', content: 'y' });
      expect(r).toContain('introuvable');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('delete_memory refuse hors-Space ("Souvenir introuvable.")', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'sp-other' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('delete_memory', { id: 'm1' });
      expect(r).toContain('introuvable');
      expect(loadMemories()[0].suppressed).toBeFalsy();   // pas tombstoné
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('update_memory/delete_memory fonctionnent normalement dans le Space actif', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'sp1' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('update_memory', { id: 'm1', content: 'y' });
      expect(r).toContain('mis à jour');
      expect(loadMemories()[0].content).toBe('y');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
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

describe('MEMORY_DOCTRINE (constante, partie inconditionnelle de ROOT_SYSTEM_PROMPT)', function() {
  it('retourne une chaîne non vide', function() {
    expect(MEMORY_DOCTRINE.length > 0).toBeTruthy();
  });
  it('mentionne create_memory et ask_confirmation pour orienter le modèle', function() {
    expect(MEMORY_DOCTRINE.indexOf('create_memory') >= 0).toBeTruthy();
    expect(MEMORY_DOCTRINE.indexOf('ask_confirmation') >= 0).toBeTruthy();
  });
});

describe('intentDoctrinePrompt (conditionnel sur TOOLS.length && settings.intentTracing)', function() {
  it('intentTracing vrai (et TOOLS non vide) → renvoie INTENT_DOCTRINE', function() {
    localStorage.clear();
    saveSettings({ intentTracing: true });
    expect(intentDoctrinePrompt()).toContain('intent');
    expect(intentDoctrinePrompt()).toBe(INTENT_DOCTRINE);
  });
  it('intentTracing explicitement désactivé → chaîne vide', function() {
    localStorage.clear();
    saveSettings({ intentTracing: false });
    expect(intentDoctrinePrompt()).toBe('');
  });
  it('intentTracing absent (storage vierge) → true par défaut, doctrine renvoyée', function() {
    localStorage.clear();
    expect(intentDoctrinePrompt()).toBe(INTENT_DOCTRINE);
  });
});

describe('skillDoctrinePrompt (stage 2, conditionnel sur skills autotrigger)', function() {
  it('chaîne vide si aucune skill autotrigger', function() {
    setSkillsCache([]);
    expect(skillDoctrinePrompt()).toBe('');
    setSkillsCache([{ slug: 'a' }]);   // enabled, mais pas autotrigger
    expect(skillDoctrinePrompt()).toBe('');
  });
  it('non vide dès qu\'une skill autotrigger existe', function() {
    setSkillsCache([{ slug: 'a', autotrigger: true }]);
    expect(skillDoctrinePrompt().length > 0).toBeTruthy();
  });
  it('résout le paragraphe CONFIRMATION sur la valeur courante de confirmSkillAutoUse, jamais une condition laissée au modèle', function() {
    setSkillsCache([{ slug: 'a', autotrigger: true }]);
    saveSettings({ confirmSkillAutoUse: true });
    var on = skillDoctrinePrompt();
    expect(on.indexOf('ask_confirmation') >= 0).toBeTruthy();
    expect(on.indexOf('si le réglage') >= 0).toBeFalsy();   // pas de condition à évaluer par le modèle
    saveSettings({ confirmSkillAutoUse: false });
    var off = skillDoctrinePrompt();
    expect(off.indexOf('sans confirmation préalable') >= 0).toBeTruthy();
    expect(off.indexOf('appelle l\'outil ask_confirmation') >= 0).toBeFalsy();
  });
  it('mentionne miaou__skills__read et ask_confirmation', function() {
    setSkillsCache([{ slug: 'a', autotrigger: true }]);
    saveSettings({ confirmSkillAutoUse: true });
    var s = skillDoctrinePrompt();
    expect(s.indexOf('miaou__skills__read') >= 0).toBeTruthy();
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

describe('BINARY_DOCTRINE (constante, partie inconditionnelle de ROOT_SYSTEM_PROMPT)', function() {
  it('énonce la règle non-text sans toggle ni énumération', function() {
    expect(BINARY_DOCTRINE.indexOf('image') >= 0).toBeTruthy();
    expect(BINARY_DOCTRINE.indexOf('ne simule pas') >= 0).toBeTruthy();
    expect(BINARY_DOCTRINE.indexOf('base64') >= 0).toBeTruthy();
  });
  it('la règle ne vit PAS dans toolsSystemPrompt (énumération seule)', function() {
    expect(toolsSystemPrompt().indexOf('ne simule pas')).toBe(-1);
  });
  it('la règle ne vit PAS dans MEMORY_DOCTRINE', function() {
    expect(MEMORY_DOCTRINE.indexOf('ne simule pas')).toBe(-1);
  });
});

describe('ATTACHMENT_DOCTRINE (constante, partie de ROOT_SYSTEM_PROMPT)', function() {
  it('mentionne recall_attachment et est incluse dans ROOT_SYSTEM_PROMPT', function() {
    expect(ATTACHMENT_DOCTRINE.indexOf('recall_attachment') >= 0).toBeTruthy();
    expect(ROOT_SYSTEM_PROMPT.indexOf(ATTACHMENT_DOCTRINE) >= 0).toBeTruthy();
  });
  it('brief H : la phrase binaire est nuancée (renvoie vers la doctrine docs conditionnelle), plus affirmative "pas lisible" sans réserve', function() {
    expect(ATTACHMENT_DOCTRINE.indexOf('sauf si un outil') >= 0).toBeTruthy();
    expect(ATTACHMENT_DOCTRINE.indexOf('le résultat renvoie le') >= 0).toBeFalsy();
  });
});

describe('anyToolDeclaresAttachmentInflation (brief H — balayage générique du registre)', function() {
  it('false si _remoteTools vide', function() {
    expect(anyToolDeclaresAttachmentInflation()).toBe(false);
  });
  it('true dès qu\'un serveur, quel qu\'il soit, expose ref+content_b64', function() {
    _remoteTools['whatevername'] = [{
      name: 'whatevername__read',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {}, content_b64: {} } },
    }];
    expect(anyToolDeclaresAttachmentInflation()).toBe(true);
    delete _remoteTools['whatevername'];
  });
  it('false si un serveur existe mais ne déclare que ref (pas content_b64)', function() {
    _remoteTools['partial'] = [{
      name: 'partial__search',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {} } },
    }];
    expect(anyToolDeclaresAttachmentInflation()).toBe(false);
    delete _remoteTools['partial'];
  });
  it('plusieurs serveurs, un seul qualifiant → true', function() {
    _remoteTools['noop'] = [{ name: 'noop__x', description: '', inputSchema: { type: 'object', properties: {} } }];
    _remoteTools['docs'] = [{ name: 'docs__read', description: '', inputSchema: { type: 'object', properties: { ref: {}, content_b64: {} } } }];
    expect(anyToolDeclaresAttachmentInflation()).toBe(true);
    delete _remoteTools['noop'];
    delete _remoteTools['docs'];
  });
});

describe('docsDoctrinePrompt (brief H — conditionnel, pattern skillDoctrinePrompt)', function() {
  it('chaîne vide si aucun outil ne déclare le contrat', function() {
    expect(docsDoctrinePrompt()).toBe('');
  });
  it('non vide dès qu\'un outil déclare ref+content_b64, mentionne ref et content_b64 par CRITÈRE + docs__read en EXEMPLE', function() {
    _remoteTools['docs'] = [{ name: 'docs__read', description: '', inputSchema: { type: 'object', properties: { ref: {}, content_b64: {} } } }];
    var p = docsDoctrinePrompt();
    expect(p.length > 0).toBeTruthy();
    expect(p.indexOf('content_b64') >= 0).toBeTruthy();
    expect(p.indexOf('docs__read') >= 0).toBeTruthy();
    delete _remoteTools['docs'];
  });
  it('ne mentionne aucun nom de serveur en dur (renommable par l\'utilisateur)', function() {
    _remoteTools['monserveurperso'] = [{ name: 'monserveurperso__read', description: '', inputSchema: { type: 'object', properties: { ref: {}, content_b64: {} } } }];
    var p = docsDoctrinePrompt();
    expect(p.indexOf('monserveurperso') >= 0).toBeFalsy();
    delete _remoteTools['monserveurperso'];
  });
});

describe('recall_attachment (D4) — outil registre', function() {
  it('ref manquant → message d\'erreur explicite, pas de crash', function() {
    var r = ct('recall_attachment', {});
    expect(r).toContain('manquant');
  });
  it('ref inconnu du cache session → message explicite', function() {
    var r = ct('recall_attachment', { ref: 'att-999' });
    expect(r).toContain('introuvable');
  });
  it('image → tool result annonciateur + injection empilée (A2/D3, tour courant)', function() {
    var ab = new ArrayBuffer(3);
    new Uint8Array(ab).set([1, 2, 3]);
    _resourceCache['res_i'] = { id: 'res_i', attId: 'att-7', conversationId: 'cX',
      class: 'binary', mime: 'image/png', name: 'x.png', data: ab };
    currentConvId = 'cX';
    clearPendingImageInjections();
    var r = ct('recall_attachment', { ref: 'att-7' });
    expect(r).toContain('suit dans le message suivant');
    var inj = getPendingImageInjections();
    expect(inj.length).toBe(1);
    expect(inj[0].attId).toBe('att-7');
    expect(inj[0].dataUrl.indexOf('data:image/png;base64,')).toBe(0);
    clearPendingImageInjections();
    delete _resourceCache['res_i'];
    currentConvId = null;
  });
  it('texte inline → contenu en clair, aucune injection image empilée', function() {
    var buf = utf8Encode('coucou');
    _resourceCache['res_t'] = { id: 'res_t', attId: 'att-8', conversationId: 'cX',
      class: 'inline', mime: 'text/plain', name: 't.txt', data: buf };
    currentConvId = 'cX';
    clearPendingImageInjections();
    var r = ct('recall_attachment', { ref: 'att-8' });
    expect(r).toBe('coucou');
    expect(getPendingImageInjections().length).toBe(0);
    delete _resourceCache['res_t'];
    currentConvId = null;
  });
});

describe('files__list / files__read (lot Cbis) — outils registre', function() {
  function libRecord(over) {
    return Object.assign({ id: 'file_a1', spaceId: 'sp1', kind: 'library',
      class: 'inline', mime: 'text/plain', name: 'doc.txt', size: 5, createdAt: 1 }, over);
  }

  it('files__list : vide → count 0, JSON []', function() {
    localStorage.clear();
    activeSpaceId = 'sp1';
    try {
      var r = JSON.parse(ct('miaou__files__list', {}));
      expect(r.length).toBe(0);
    } finally { activeSpaceId = DEFAULT_SPACE_ID; }
  });

  it('files__list : scope au Space actif seul, ignore un autre Space', function() {
    localStorage.clear();
    _resourceCache['file_a1'] = libRecord({ spaceId: 'sp1' });
    _resourceCache['file_b1'] = libRecord({ id: 'file_b1', spaceId: 'sp-other', name: 'other.txt' });
    activeSpaceId = 'sp1';
    try {
      var r = JSON.parse(ct('miaou__files__list', {}));
      expect(r.length).toBe(1);
      expect(r[0].id).toBe('file-a1');
      expect(r[0].name).toBe('doc.txt');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_a1'];
      delete _resourceCache['file_b1'];
    }
  });

  it('files__list : pousse un ack files_list avec le compte', function() {
    localStorage.clear();
    clearPendingToolAcks();
    _resourceCache['file_a1'] = libRecord();
    activeSpaceId = 'sp1';
    try {
      ct('miaou__files__list', {});
      var pending = getPendingToolAcks();
      expect(pending.length).toBe(1);
      expect(pending[0].kind).toBe('files_list');
      expect(pending[0].count).toBe(1);
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_a1'];
    }
  });

  it('files__read : id manquant/malformé → "Fichier introuvable."', function() {
    localStorage.clear();
    expect(ct('miaou__files__read', { id: 'att-1' })).toBe('Fichier introuvable.');
    expect(ct('miaou__files__read', { id: '' })).toBe('Fichier introuvable.');
  });

  it('files__read : fichier d\'un autre Space → introuvable (pas d\'oracle)', function() {
    localStorage.clear();
    _resourceCache['file_a1'] = libRecord({ spaceId: 'sp-other' });
    activeSpaceId = 'sp1';
    try {
      expect(ct('miaou__files__read', { id: 'file-a1' })).toBe('Fichier introuvable.');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_a1'];
    }
  });

  it('files__read : fichier inline du Space actif → contenu en clair', function() {
    localStorage.clear();
    var buf = utf8Encode('contenu texte');
    _resourceCache['file_a1'] = libRecord({ class: 'inline', data: buf });
    activeSpaceId = 'sp1';
    try {
      expect(ct('miaou__files__read', { id: 'file-a1' })).toBe('contenu texte');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_a1'];
    }
  });

  it('files__read : fichier binaire → descripteur + renvoi vers mcp_docs, pas le contenu brut', function() {
    localStorage.clear();
    _resourceCache['file_a1'] = libRecord({ class: 'binary', mime: 'application/pdf', name: 'a.pdf' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('miaou__files__read', { id: 'file-a1' });
      expect(r).toContain('mcp_docs');
      expect(r).toContain('a.pdf');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_a1'];
    }
  });

  it('files__read : image sur serveur/modèle sans vision → posture explicite, pas de placeholder muet', function() {
    localStorage.clear();
    saveApiServers([{ id: 's1', name: 'A', url: 'http://a/v1', key: '', model: 'no-vision-model', vision: { 'no-vision-model': false } }]);
    setActiveApiServerId('s1');
    saveSettings({ model: 'no-vision-model' });
    _resourceCache['file_a1'] = libRecord({ class: 'binary', mime: 'image/png', name: 'photo.png' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('miaou__files__read', { id: 'file-a1' });
      expect(r).toContain('vision');
      expect(r.indexOf('data:image')).toBe(-1);
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_a1'];
    }
  });

  it('files__read : pousse un ack files_read avec le nom/mime', function() {
    localStorage.clear();
    clearPendingToolAcks();
    _resourceCache['file_a1'] = libRecord({ class: 'inline', data: utf8Encode('x') });
    activeSpaceId = 'sp1';
    try {
      ct('miaou__files__read', { id: 'file-a1' });
      var pending = getPendingToolAcks();
      expect(pending.length).toBe(1);
      expect(pending[0].kind).toBe('files_read');
      expect(pending[0].resourceName).toBe('doc.txt');
      expect(pending[0].mime).toBe('text/plain');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_a1'];
    }
  });
});

describe('validateFilesPromoteArgs (lot Cbis) — extrait du handler async pour rester testable', function() {
  it('ref manquant → message d\'erreur', function() {
    expect(validateFilesPromoteArgs({ description: 'x' })).toContain('invalides');
  });
  it('description manquante → message d\'erreur', function() {
    expect(validateFilesPromoteArgs({ ref: 'att-1' })).toContain('invalides');
  });
  it('description vide après trim → message d\'erreur', function() {
    expect(validateFilesPromoteArgs({ ref: 'att-1', description: '   ' })).toContain('invalides');
  });
  it('ref et description présents → chaîne vide (valide)', function() {
    expect(validateFilesPromoteArgs({ ref: 'att-1', description: 'Une description.' })).toBe('');
  });
  it('args absent → invalide, pas de crash', function() {
    expect(validateFilesPromoteArgs(undefined)).toContain('invalides');
  });
});

describe('files__promote — définition d\'outil et doctrine (lot Cbis, voie B)', function() {
  it('files__promote est dans TOOLS avec ref/description requis', function() {
    const def = TOOLS.find(t => t.name === 'files__promote');
    expect(def).toBeTruthy();
    expect(def.inputSchema.required.indexOf('ref') >= 0).toBeTruthy();
    expect(def.inputSchema.required.indexOf('description') >= 0).toBeTruthy();
  });
  it('FILES_DOCTRINE fait partie de ROOT_SYSTEM_PROMPT (toujours injectée)', function() {
    expect(ROOT_SYSTEM_PROMPT.indexOf('miaou__files__promote') >= 0).toBeTruthy();
  });
  it('FILES_DOCTRINE prescrit ask_confirmation avant tout appel (voie B, pas de généralisation du halting)', function() {
    expect(FILES_DOCTRINE.indexOf('ask_confirmation') >= 0).toBeTruthy();
    expect(FILES_DOCTRINE.indexOf('JAMAIS') >= 0).toBeTruthy();
  });
  it('toolIsHalting reste exclusivement câblé sur ask_confirmation (pas de régression voie A)', function() {
    expect(toolIsHalting('files__promote')).toBe(false);
    expect(toolIsHalting('miaou__files__promote')).toBe(false);
    expect(toolIsHalting('ask_confirmation')).toBe(true);
  });
});

describe('hook d\'inflation dispatcher (brief A, D6) — helpers purs', function() {
  it('toolDeclaresAttachmentInflation : capability détectée via ref+content_b64 déclarés, sans nom de serveur en dur', function() {
    _remoteTools['docstest'] = [{
      name: 'docstest__read',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, session_id: {} } },
    }];
    expect(toolDeclaresAttachmentInflation({ name: 'docstest' }, 'read')).toBe(true);
    delete _remoteTools['docstest'];
  });
  it('toolDeclaresAttachmentInflation : absent si ref seul (pas de content_b64 déclaré)', function() {
    _remoteTools['other'] = [{
      name: 'other__search',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {} } },
    }];
    expect(toolDeclaresAttachmentInflation({ name: 'other' }, 'search')).toBe(false);
    delete _remoteTools['other'];
  });
  it('toolDeclaresAttachmentInflation : outil inconnu du cache distant → false, pas de throw', function() {
    expect(toolDeclaresAttachmentInflation({ name: 'inconnu' }, 'x')).toBe(false);
  });
  it('ATTACHMENT_REF_RE : reconnaît att-N, rejette les autres formes', function() {
    expect(ATTACHMENT_REF_RE.test('att-1')).toBe(true);
    expect(ATTACHMENT_REF_RE.test('att-42')).toBe(true);
    expect(ATTACHMENT_REF_RE.test('res_abc')).toBe(false);
    expect(ATTACHMENT_REF_RE.test('att-')).toBe(false);
    expect(ATTACHMENT_REF_RE.test('att-1x')).toBe(false);
  });
  it('état poussé/non-poussé : scopé par (conversationId, attId), indépendant entre conversations', function() {
    expect(isAttachmentPushed('c1', 'att-1')).toBe(false);
    markAttachmentPushed('c1', 'att-1');
    expect(isAttachmentPushed('c1', 'att-1')).toBe(true);
    expect(isAttachmentPushed('c2', 'att-1')).toBe(false);   // autre conversation, même attId
    clearAttachmentPushState('c1');
    expect(isAttachmentPushed('c1', 'att-1')).toBe(false);
  });
  it('_isRefUnknownError : détecte le code machine REF_UNKNOWN, jamais par sous-chaîne du texte libre', function() {
    expect(_isRefUnknownError({ isError: true, errorCode: 'REF_UNKNOWN' })).toBe(true);
    expect(_isRefUnknownError({ isError: true, errorCode: 'AUTRE_ERREUR' })).toBe(false);
    expect(_isRefUnknownError({ isError: true, content: [{ type: 'text', text: 'contient REF_UNKNOWN dans le texte' }] })).toBe(false);
    expect(_isRefUnknownError(null)).toBe(false);
  });
  it('FILE_REF_RE : reconnaît file-<id>, rejette les autres formes (lot Cbis, généralisation §4)', function() {
    expect(FILE_REF_RE.test('file-a1b2')).toBe(true);
    expect(FILE_REF_RE.test('att-1')).toBe(false);
    expect(FILE_REF_RE.test('file_a1b2')).toBe(false);   // underscore, pas tiret
    expect(FILE_REF_RE.test('file-')).toBe(false);
  });
  it('état poussé/non-poussé fichiers : scopé par (spaceId, fileId), table distincte de _attachmentPushState', function() {
    expect(isFilePushed('sp1', 'file_a1')).toBe(false);
    markFilePushed('sp1', 'file_a1');
    expect(isFilePushed('sp1', 'file_a1')).toBe(true);
    expect(isFilePushed('sp-other', 'file_a1')).toBe(false);   // autre Space, même fileId
    expect(isAttachmentPushed('sp1', 'file_a1')).toBe(false);  // tables indépendantes
  });
  it('_resolveInflationRef : att-N résout via getCachedRecordByAttId, scopé conversation courante', function() {
    var ab = new ArrayBuffer(1);
    _resourceCache['res_x'] = { id: 'res_x', attId: 'att-3', conversationId: 'c1', class: 'binary', mime: 'application/pdf', name: 'x.pdf', data: ab };
    currentConvId = 'c1';
    try {
      var resolved = _resolveInflationRef('att-3');
      expect(resolved).toBeTruthy();
      expect(resolved.record.id).toBe('res_x');
      expect(resolved.sessionId).toBe('c1');
    } finally {
      delete _resourceCache['res_x'];
      currentConvId = null;
    }
  });
  it('_resolveInflationRef : file-<id> résout depuis le cache library, herméticité Space (pas conversation)', function() {
    _resourceCache['file_z9'] = { id: 'file_z9', spaceId: 'sp1', kind: 'library', class: 'binary', mime: 'application/pdf', name: 'z.pdf', data: new ArrayBuffer(1) };
    activeSpaceId = 'sp1';
    currentConvId = 'c-any';
    try {
      var resolved = _resolveInflationRef('file-z9');
      expect(resolved).toBeTruthy();
      expect(resolved.record.id).toBe('file_z9');
      expect(resolved.sessionId).toBe('c-any');   // session_id = conversation courante même pour un fichier d'espace
    } finally {
      delete _resourceCache['file_z9'];
      activeSpaceId = DEFAULT_SPACE_ID;
      currentConvId = null;
    }
  });
  it('_resolveInflationRef : file-<id> d\'un autre Space → null (pas d\'oracle, même hors dispatcher)', function() {
    _resourceCache['file_z9'] = { id: 'file_z9', spaceId: 'sp-other', kind: 'library', class: 'binary', mime: 'application/pdf', name: 'z.pdf', data: new ArrayBuffer(1) };
    activeSpaceId = 'sp1';
    try {
      expect(_resolveInflationRef('file-z9')).toBe(null);
    } finally {
      delete _resourceCache['file_z9'];
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('_resolveInflationRef : ref ne correspondant à aucune forme reconnue → null', function() {
    expect(_resolveInflationRef('bogus-ref')).toBe(null);
  });
});

describe('_declaresContentReadSignature — signal de lecture de contenu (D7)', function() {
  it('char_start présent, pas de query → lecture', function() {
    expect(_declaresContentReadSignature({ ref: {}, content_b64: {}, char_start: {} })).toBe(true);
  });
  it('line_start présent, pas de query → lecture', function() {
    expect(_declaresContentReadSignature({ ref: {}, content_b64: {}, line_start: {} })).toBe(true);
  });
  it('ni char_start ni line_start → pas lecture (ex. list : structure seule)', function() {
    expect(_declaresContentReadSignature({ ref: {}, content_b64: {}, path: {}, filename: {} })).toBe(false);
  });
  it('char_start présent MAIS query aussi → pas lecture (ex. search)', function() {
    expect(_declaresContentReadSignature({ ref: {}, content_b64: {}, char_start: {}, query: {} })).toBe(false);
  });
  it('props absent/vide → pas lecture', function() {
    expect(_declaresContentReadSignature(null)).toBe(false);
    expect(_declaresContentReadSignature({})).toBe(false);
  });
});

describe('findDocsInflationTool (D7, lot Cbis) — résolution sans nom en dur', function() {
  it('aucun serveur/outil qualifiant → null', function() {
    localStorage.clear();
    _remoteTools = {};
    expect(findDocsInflationTool()).toBe(null);
  });
  it('un seul outil qualifiant (ref+content_b64+char_start) → résout nom nu et serveur complet', function() {
    localStorage.clear();
    saveMcpServers([{ id: 's1', name: 'docstest', url: 'http://x/mcp', enabled: true }]);
    _remoteTools['docstest'] = [{
      name: 'docstest__read',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, session_id: {}, char_start: {} } },
    }];
    try {
      var found = findDocsInflationTool();
      expect(found).toBeTruthy();
      expect(found.toolName).toBe('read');
      expect(found.server.name).toBe('docstest');
    } finally {
      delete _remoteTools['docstest'];
    }
  });
  it('plusieurs outils qualifiant ref+content_b64 (list/read/search, contrat mcp_docs réel) → choisit CELUI qui lit du contenu, pas le premier du tableau', function() {
    // Reproduit le bug observé : list (structure) déclarée AVANT read (contenu)
    // dans le tableau _remoteTools — sans le signal char_start/line_start,
    // findDocsInflationTool choisissait list à tort (premier qualifiant trouvé).
    localStorage.clear();
    saveMcpServers([{ id: 's1', name: 'docs', url: 'http://x/mcp', enabled: true }]);
    _remoteTools['docs'] = [
      { name: 'docs__list', description: '', inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, session_id: {}, path: {}, filename: {} } } },
      { name: 'docs__read', description: '', inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, session_id: {}, path: {}, selector: {}, char_start: {}, char_end: {}, line_start: {}, line_end: {}, filename: {} } } },
      { name: 'docs__search', description: '', inputSchema: { type: 'object', properties: { ref: {}, query: {}, content_b64: {}, session_id: {}, path: {}, filename: {} } } },
    ];
    try {
      var found = findDocsInflationTool();
      expect(found).toBeTruthy();
      expect(found.toolName).toBe('read');
    } finally {
      delete _remoteTools['docs'];
    }
  });
  it('serveur disparu du registre localStorage entre connexion et appel → ignoré (pas de crash)', function() {
    localStorage.clear();   // aucun serveur sauvegardé
    _remoteTools['ghost'] = [{
      name: 'ghost__read',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, char_start: {} } },
    }];
    try {
      expect(findDocsInflationTool()).toBe(null);
    } finally {
      delete _remoteTools['ghost'];
    }
  });
  it('outil sans content_b64 déclaré → non qualifiant', function() {
    localStorage.clear();
    saveMcpServers([{ id: 's1', name: 'partial', url: 'http://x/mcp', enabled: true }]);
    _remoteTools['partial'] = [{
      name: 'partial__search',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {}, char_start: {} } },
    }];
    try {
      expect(findDocsInflationTool()).toBe(null);
    } finally {
      delete _remoteTools['partial'];
    }
  });
  it('seul outil qualifiant est une structure (list, sans char_start/line_start) → aucun outil de lecture trouvé, null', function() {
    localStorage.clear();
    saveMcpServers([{ id: 's1', name: 'liststuff', url: 'http://x/mcp', enabled: true }]);
    _remoteTools['liststuff'] = [{
      name: 'liststuff__list',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, path: {} } },
    }];
    try {
      expect(findDocsInflationTool()).toBe(null);
    } finally {
      delete _remoteTools['liststuff'];
    }
  });
});

