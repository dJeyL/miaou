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
    var res = callTool('conv__list', {});
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
    var res = callTool('conv__list', {});
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

describe('conv__get', function() {
  it('retourne résumé+keywords sans with_contents', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: ['k'] });
    var r = JSON.parse(ct('conv__get', { id: 'c1' }));
    expect(r.summary !== undefined).toBeTruthy();
    expect(r.messages).toBeFalsy();
  });
  it('inclut messages avec with_contents=true', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: ['k'] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, messages: [{ role: 'user', content: 'salut' }] });
    var r = JSON.parse(ct('conv__get', { id: 'c1', with_contents: true }));
    expect(r.messages !== undefined).toBeTruthy();
  });
  it('introuvable si aucun souvenir', function() {
    localStorage.clear();
    var r = ct('conv__get', { id: 'inexistant' });
    expect(r).toContain('introuvable');
  });
  it('introuvable si le souvenir est une tombstone', function() {
    localStorage.clear();
    suppressSummary('c1');
    var r = ct('conv__get', { id: 'c1' });
    expect(r).toContain('introuvable');
  });
  it('pousse un ack conversation_read avec le titre quand trouvé', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveSummary('c1', { title: 'Mon titre', timestamp: 1000, summary: 's', keywords: [] });
    ct('conv__get', { id: 'c1' });
    var pending = getPendingToolAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].kind).toBe('conversation_read');
    expect(pending[0].title).toBe('Mon titre');
  });
  it('pousse un ack d\'échec quand introuvable (jamais un conversation_read)', function() {
    localStorage.clear();
    clearPendingToolAcks();
    ct('conv__get', { id: 'inexistant' });
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('tool_failed');
    expect(acks[0].name).toBe('miaou__conv__get');
    expect(acks[0].error).toBe(true);
  });
});

describe('conv__list', function() {
  it('sans since, liste toutes les conversations', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't1', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c0', { title: 't0', timestamp: Date.parse('2025-01-01T00:00:00Z'), summary: 's', keywords: [] });
    var r = JSON.parse(ct('conv__list', {}));
    expect(Array.isArray(r)).toBeTruthy();
    expect(r.length).toBe(2);
  });
  it('rejette une date fournie mais invalide', function() {
    var r = ct('conv__list', { since: 'pas une date' });
    expect(r).toContain('invalide');
  });
  it('filtre par date', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c0', { title: 'vieux', timestamp: Date.parse('2025-01-01T00:00:00Z'), summary: 's', keywords: [] });
    var r = JSON.parse(ct('conv__list', { since: '2026-01-01T00:00:00Z' }));
    expect(Array.isArray(r)).toBeTruthy();
    expect(r.length).toBe(1);
    expect(r[0].id).toBe('c1');
  });
  it('exclut les tombstones', function() {
    localStorage.clear();
    suppressSummary('c1');
    var r = JSON.parse(ct('conv__list', { since: '2000-01-01T00:00:00Z' }));
    expect(r.length).toBe(0);
  });
  it('pousse un ack conversation_list avec le count post-filtre', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveSummary('c1', { title: 't', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveSummary('c0', { title: 'vieux', timestamp: Date.parse('2025-01-01T00:00:00Z'), summary: 's', keywords: [] });
    ct('conv__list', { since: '2026-01-01T00:00:00Z' });
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
      var r = JSON.parse(ct('conv__list', {}));
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
    ct('conv__list', { since: '2000-01-01T00:00:00Z', miaou_intent: 'retrouver la conv sur X' });
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
  it('outil OK puis outil échouant : l\'intent du 2e va sur SON ack d\'échec, pas sur le 1er', function() {
    localStorage.clear();
    clearPendingToolAcks();
    // 1er appel : memory__create pousse un ack memory_create + son intent.
    callTool('memory__create', { content: 'un fait à retenir', miaou_intent: 'intent-un' });
    // 2e appel : memory__update sur un id inexistant → 'Souvenir introuvable.'.
    // Depuis les acks d'échec, il pousse SON PROPRE ack tool_failed : l'intent du
    // 2e doit s'y poser, et surtout PAS réécrire celui du 1er (invariant B5).
    callTool('memory__update', { id: 'inexistant', content: 'x', miaou_intent: 'intent-deux' });
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(2);
    expect(acks[0].kind).toBe('memory_create');
    expect(acks[0].intent).toBe('intent-un');
    expect(acks[1].kind).toBe('tool_failed');
    expect(acks[1].intent).toBe('intent-deux');
    expect(acks[1].name).toBe('miaou__memory__update');
    expect(acks[1].error).toBe(true);
  });
  it('deux outils poussant chacun un ack : chaque intent va sur le bon ack', function() {
    localStorage.clear();
    clearPendingToolAcks();
    callTool('memory__create', { content: 'premier fait', miaou_intent: 'intent-A' });
    callTool('memory__create', { content: 'second fait', miaou_intent: 'intent-B' });
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
  it('expose miaou__conv__get et miaou__conv__list (préfixés V2)', function() {
    var defs = toolDefinitions();
    var names = defs.map(function(d) { return d.function.name; });
    expect(names.indexOf('miaou__conv__get') >= 0).toBeTruthy();
    expect(names.indexOf('miaou__conv__list') >= 0).toBeTruthy();
  });
  it('conv__get et conv__list déclarent un booléen with_contents', function() {
    var defs = toolDefinitions();
    ['miaou__conv__get', 'miaou__conv__list'].forEach(function(name) {
      var d = defs.find(function(d) { return d.function.name === name; });
      expect(d.function.parameters.properties.with_contents.type).toBe('boolean');
    });
  });
  it('expose miaou__create/update/memory__delete et ask_confirmation (nu)', function() {
    var defs = toolDefinitions();
    var names = defs.map(function(d) { return d.function.name; });
    expect(names.indexOf('miaou__memory__create') >= 0).toBeTruthy();
    expect(names.indexOf('miaou__memory__update') >= 0).toBeTruthy();
    expect(names.indexOf('miaou__memory__delete') >= 0).toBeTruthy();
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

describe('about — aide utilisateur (lot I)', function() {
  function aboutTool() { return TOOLS.find(function(t) { return t.name === 'about'; }); }

  it('est enregistré et exposé préfixé miaou__about', function() {
    expect(aboutTool()).toBeTruthy();
    var names = toolDefinitions().map(function(d) { return d.function.name; });
    expect(names.indexOf('miaou__about') >= 0).toBeTruthy();
  });
  it('inputSchema : topic enum dérivé de Object.keys(HELP_CONTENT), required absent', function() {
    var schema = aboutTool().inputSchema;
    expect(schema.properties.topic.type).toBe('string');
    // Sous QuickJS HELP_CONTENT = {} → enum vide (assumé, audit §3) ; on vérifie
    // que c'est bien le tableau des clefs, pas une liste en dur.
    expect(Array.isArray(schema.properties.topic.enum)).toBe(true);
    expect(schema.properties.topic.enum.length).toBe(Object.keys(HELP_CONTENT).length);
    expect(schema.required === undefined || schema.required.length === 0).toBeTruthy();
  });
  it('handler : pousse un ack about_read avec le topic normalisé et retourne une string', function() {
    _pendingToolAcks.length = 0;
    // HELP_CONTENT vide sous QuickJS → topic inconnu retombe sur apercu (défaut),
    // lui-même absent → message d'indisponibilité (jamais un crash).
    var out = aboutTool().handler({ topic: 'espaces' });
    expect(typeof out).toBe('string');
    var ack = _pendingToolAcks[_pendingToolAcks.length - 1];
    expect(ack.kind).toBe('about_read');
    expect(ack.topic).toBe('apercu');   // 'espaces' absent de {} → défaut apercu
  });
  it('handler : topic absent → défaut apercu dans l\'ack', function() {
    _pendingToolAcks.length = 0;
    aboutTool().handler({});
    expect(_pendingToolAcks[_pendingToolAcks.length - 1].topic).toBe('apercu');
  });
  it('ackLabel about_read : topic ou repli apercu', function() {
    expect(ackLabel('about_read', { topic: 'espaces' })).toContain('espaces');
    expect(ackLabel('about_read', {})).toContain('apercu');
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
    expect(toolIsHalting('conv__get')).toBe(false);
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
    ['conv__get', 'conv__list'].forEach(function(name) {
      var t = TOOLS.find(function(t) { return t.name === name; });
      expect(t.annotations.readOnlyHint).toBe(true);
    });
  });
  it('les outils d\'écriture sont readOnlyHint: false', function() {
    ['memory__create', 'memory__update', 'memory__delete'].forEach(function(name) {
      var t = TOOLS.find(function(t) { return t.name === name; });
      expect(t.annotations.readOnlyHint).toBe(false);
    });
  });
  it('ask_confirmation n\'est pas dans TOOLS (pas de readOnlyHint sur le registre)', function() {
    var t = TOOLS.find(function(t) { return t.name === 'ask_confirmation'; });
    expect(t).toBeFalsy();
  });
});

describe('memory__create — écriture directe', function() {
  it('enregistre le souvenir, retourne un accusé avec identifiant et pousse un ack', function() {
    localStorage.clear();
    clearPendingToolAcks();
    var r = ct('memory__create', { content: 'préfère les réponses courtes' });
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
  it('rejette un contenu vide : rien d\'écrit, ack d\'échec (pas de memory_create)', function() {
    localStorage.clear();
    clearPendingToolAcks();
    var r = ct('memory__create', { content: '   ' });
    expect(r).toContain('ignoré');
    expect(listMemoryEntries().length).toBe(0);
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('tool_failed');
    expect(acks[0].name).toBe('miaou__memory__create');
  });
  it('stampe le scope avec le Space actif (brief D3)', function() {
    localStorage.clear();
    activeSpaceId = 'sp1';
    try {
      ct('memory__create', { content: 'x' });
      expect(listMemoryEntries()[0].scope).toBe('sp1');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
});

describe('Herméticité des Spaces — outils modèle (brief D2/D3)', function() {
  it('conv__get sur une conv d\'un autre Space répond "introuvable" (pas d\'oracle)', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, spaceId: 'sp-other', messages: [] });
    activeSpaceId = 'sp1';
    try {
      var r = ct('conv__get', { id: 'c1' });
      expect(r).toContain('introuvable');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('conv__get sur une conv du Space actif fonctionne normalement', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, spaceId: 'sp1', messages: [] });
    activeSpaceId = 'sp1';
    try {
      var r = JSON.parse(ct('conv__get', { id: 'c1' }));
      expect(r.summary).toBe('s');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('conv__list exclut les conversations d\'un autre Space', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't1', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't1', timestamp: 1000, spaceId: 'sp1', messages: [] });
    saveSummary('c2', { title: 't2', timestamp: Date.parse('2026-03-02T00:00:00Z'), summary: 's', keywords: [] });
    saveConversation({ id: 'c2', title: 't2', timestamp: 1000, spaceId: 'sp-other', messages: [] });
    activeSpaceId = 'sp1';
    try {
      var r = JSON.parse(ct('conv__list', {}));
      expect(r.length).toBe(1);
      expect(r[0].id).toBe('c1');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('memory__update refuse hors-Space ("Souvenir introuvable.")', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'sp-other' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('memory__update', { id: 'm1', content: 'y' });
      expect(r).toContain('introuvable');
      expect(loadMemories()[0].content).toBe('x');   // pas modifié
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  // Le scope 'profile' est transverse, PAS « un autre Space » : il est injecté au
  // modèle par buildMemoryEntriesBlock() avec son id, donc le refuser était un
  // mensonge (« introuvable » sur une entrée qu'il venait de lire). L'ancien test
  // verrouillait ce comportement au motif que le profil ne serait « pas exposé
  // aux outils Space » — il l'est. La portée modifiable suit désormais la portée
  // visible (memoryScopesForSpace).
  it('memory__update accepte un souvenir de scope profile (transverse, visible du modèle)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('memory__update', { id: 'm1', content: 'y' });
      expect(r).toContain('mis à jour');
      expect(loadMemories()[0].content).toBe('y');
      expect(loadMemories()[0].scope).toBe('profile');   // scope préservé, pas re-stampé
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('memory__delete accepte un souvenir de scope profile (tombstone, scope préservé)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('memory__delete', { id: 'm1' });
      expect(r).toContain('supprimé');
      expect(loadMemories()[0].suppressed).toBe(true);
      expect(loadMemories()[0].scope).toBe('profile');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('un souvenir de profil reste éditable depuis N\'IMPORTE quel Space (transverse)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    activeSpaceId = 'sp-tout-autre';
    try {
      expect(ct('memory__update', { id: 'm1', content: 'y' })).toContain('mis à jour');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('memory__delete refuse toujours un souvenir d\'un AUTRE Space (herméticité intacte)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'sp-other' });
    activeSpaceId = 'sp1';
    try {
      expect(ct('memory__delete', { id: 'm1' })).toContain('introuvable');
      expect(loadMemories()[0].suppressed).toBeFalsy();
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('ce que le modèle VOIT est exactement ce qu\'il peut TOUCHER (pas de divergence)', function() {
    localStorage.clear();
    saveMemory({ id: 'mp', content: 'profil', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    saveMemory({ id: 'ms', content: 'space', created_at: 2, updated_at: 2, suppressed: false, scope: 'sp1' });
    saveMemory({ id: 'mo', content: 'autre', created_at: 3, updated_at: 3, suppressed: false, scope: 'sp-other' });
    activeSpaceId = 'sp1';
    try {
      var visibles = listMemoryEntries(memoryScopesForSpace(activeSpaceId)).map(function(e) { return e.id; });
      expect(visibles.join(',')).toBe('mp,ms');
      // chaque entrée visible est modifiable…
      visibles.forEach(function(id) {
        expect(ct('memory__update', { id: id, content: 'z' })).toContain('mis à jour');
      });
      // …et l'invisible ne l'est pas.
      expect(ct('memory__update', { id: 'mo', content: 'z' })).toContain('introuvable');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('memory__delete refuse hors-Space ("Souvenir introuvable.")', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'sp-other' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('memory__delete', { id: 'm1' });
      expect(r).toContain('introuvable');
      expect(loadMemories()[0].suppressed).toBeFalsy();   // pas tombstoné
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
  it('memory__update/memory__delete fonctionnent normalement dans le Space actif', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'sp1' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('memory__update', { id: 'm1', content: 'y' });
      expect(r).toContain('mis à jour');
      expect(loadMemories()[0].content).toBe('y');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
    }
  });
});

describe('memory__update — correction in-place', function() {
  it('met à jour le contenu sans créer de nouvelle entrée et pousse un ack', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveMemory({ id: 'm1', content: 'avant', created_at: 1, updated_at: 1, suppressed: false });
    var r = ct('memory__update', { id: 'm1', content: 'après' });
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
  it('rejette les paramètres invalides : ack d\'échec, pas de memory_update', function() {
    clearPendingToolAcks();
    var r = ct('memory__update', { id: 'm1' });
    expect(r).toContain('invalide');
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('tool_failed');
    expect(acks[0].name).toBe('miaou__memory__update');
  });
});

describe('memory__delete — tombstone', function() {
  it('pose une tombstone réversible et pousse un ack avec contenu', function() {
    localStorage.clear();
    clearPendingToolAcks();
    saveMemory({ id: 'm1', content: 'obsolète', created_at: 1, updated_at: 1, suppressed: false });
    var r = ct('memory__delete', { id: 'm1' });
    expect(r).toContain('supprimé');
    expect(loadMemories()[0].suppressed).toBe(true);
    expect(listMemoryEntries().length).toBe(0);
    var pending = getPendingToolAcks();
    expect(pending.length).toBe(1);
    expect(pending[0].kind).toBe('memory_delete');
    expect(pending[0].id).toBe('m1');
    expect(pending[0].content).toBe('obsolète');
  });
  it('rejette un id manquant : ack d\'échec, pas de memory_delete', function() {
    clearPendingToolAcks();
    var r = ct('memory__delete', {});
    expect(r).toContain('manquant');
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('tool_failed');
    expect(acks[0].name).toBe('miaou__memory__delete');
  });
});

describe('MEMORY_DOCTRINE (constante, partie inconditionnelle de ROOT_SYSTEM_PROMPT)', function() {
  it('retourne une chaîne non vide', function() {
    expect(MEMORY_DOCTRINE.length > 0).toBeTruthy();
  });
  it('mentionne memory__create et ask_confirmation pour orienter le modèle', function() {
    expect(MEMORY_DOCTRINE.indexOf('memory__create') >= 0).toBeTruthy();
    expect(MEMORY_DOCTRINE.indexOf('ask_confirmation') >= 0).toBeTruthy();
  });
});

describe('intentDoctrinePrompt (conditionnel sur settings.intentTracing)', function() {
  it('intentTracing vrai → renvoie INTENT_DOCTRINE', function() {
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
  it('jamais de confirmation : ask_confirmation casserait le contenu lu au tour suivant (fork B)', function() {
    setSkillsCache([{ slug: 'a', autotrigger: true }]);
    var s = skillDoctrinePrompt();
    expect(s.indexOf('sans confirmation préalable') >= 0).toBeTruthy();
    expect(s.indexOf('ask_confirmation') >= 0).toBeFalsy();
  });
  it('mentionne miaou__skills__read', function() {
    setSkillsCache([{ slug: 'a', autotrigger: true }]);
    var s = skillDoctrinePrompt();
    expect(s.indexOf('miaou__skills__read') >= 0).toBeTruthy();
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
    expect(names.indexOf('miaou__memory__create') >= 0).toBeTruthy();
    expect(names.indexOf('ask_confirmation') >= 0).toBeTruthy();   // hors registre, NON préfixé
    expect(names.indexOf('memory__create') < 0).toBeTruthy();        // plus de nom nu exposé
  });
});

describe('callTool (routage par préfixe, D1)', function() {
  it('miaou__ route vers le dispatch interne', function() {
    var r = callTool('miaou__conv__get', { id: 'inexistant' });
    expect(r.isError).toBeFalsy();
    expect(flattenToolResult(r)).toContain('introuvable');
  });
  it('nom nu (sans préfixe) route aussi vers l\'interne', function() {
    var r = callTool('conv__get', { id: 'inexistant' });
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

describe('JS_EVAL_DOCTRINE (constante inconditionnelle de ROOT_SYSTEM_PROMPT, lot L)', function() {
  it('incluse dans ROOT_SYSTEM_PROMPT (inconditionnelle, AL4)', function() {
    expect(ROOT_SYSTEM_PROMPT.indexOf(JS_EVAL_DOCTRINE) >= 0).toBeTruthy();
  });
  it('renvoie vers la skill système js-eval pour le mode d\'emploi détaillé', function() {
    expect(JS_EVAL_DOCTRINE.indexOf('skills__read') >= 0).toBeTruthy();
    expect(JS_EVAL_DOCTRINE.indexOf('js-eval') >= 0).toBeTruthy();
  });
  it('énonce le refus sur dépassement (pas troncature) et le cap', function() {
    expect(JS_EVAL_DOCTRINE.indexOf('REFUS') >= 0).toBeTruthy();
    expect(JS_EVAL_DOCTRINE.indexOf(String(JS_EVAL_OUTPUT_CAP)) >= 0).toBeTruthy();
  });
  it('handle only : jamais le contenu ni un chemin', function() {
    expect(JS_EVAL_DOCTRINE.indexOf('handle') >= 0).toBeTruthy();
    expect(JS_EVAL_DOCTRINE.indexOf('att-N') >= 0).toBeTruthy();
  });
});

describe('js__eval exposé au modèle (registre TOOLS, lot L, multi-entrées L-2)', function() {
  it('miaou__js__eval est dans exposedTools avec input_handles+code requis', function() {
    var def = exposedTools().find(function(t) { return t.name === 'miaou__js__eval'; });
    expect(!!def).toBe(true);
    var props = def.inputSchema.properties;
    expect(!!props.input_handles).toBe(true);
    expect(props.input_handles.type).toBe('object');
    expect(!!props.code).toBe(true);
    expect(def.inputSchema.required.indexOf('input_handles') >= 0).toBeTruthy();
    expect(def.inputSchema.required.indexOf('code') >= 0).toBeTruthy();
    // Le paramètre scalaire du lot L a DISPARU (décision 3 du brief L-2 : une
    // seule forme d'appel, pas de compat parallèle qui ferait deux syntaxes à
    // documenter au modèle).
    expect(!!props.handle).toBe(false);
    expect(def.inputSchema.required.indexOf('handle') >= 0).toBe(false);
  });
  it('rejette input_handles manquant en erreur synchrone (avant tout async)', function() {
    var r = flattenToolResult(callTool('miaou__js__eval', { code: '1' }));
    expect(r.indexOf('input_handles manquant ou invalide') >= 0).toBeTruthy();
  });
  it('rejette un input_handles qui n\'est pas un objet (string)', function() {
    var r = flattenToolResult(callTool('miaou__js__eval', { input_handles: 'att-1', code: '1' }));
    expect(r.indexOf('input_handles manquant ou invalide') >= 0).toBeTruthy();
  });
  it('rejette un TABLEAU : typeof object ne suffit pas, la garde Array.isArray est nécessaire', function() {
    // Contrôle de prémisse du test : un tableau EST bien un typeof 'object' en JS,
    // donc sans Array.isArray il passerait la première garde et Object.keys en
    // ferait des clés numériques — une forme positionnelle acceptée en douce.
    expect(typeof []).toBe('object');
    var r = flattenToolResult(callTool('miaou__js__eval', { input_handles: ['att-1'], code: '1' }));
    expect(r.indexOf('input_handles manquant ou invalide') >= 0).toBeTruthy();
  });
  it('rejette un input_handles vide', function() {
    var r = flattenToolResult(callTool('miaou__js__eval', { input_handles: {}, code: '1' }));
    expect(r.indexOf('input_handles est vide') >= 0).toBeTruthy();
  });
  it('rejette au-delà de JS_EVAL_MAX_INPUTS clés, en nommant le compte et la limite', function() {
    var many = {};
    for (var i = 0; i <= JS_EVAL_MAX_INPUTS; i++) many['k' + i] = 'att-1';
    var r = flattenToolResult(callTool('miaou__js__eval', { input_handles: many, code: '1' }));
    expect(r.indexOf(String(JS_EVAL_MAX_INPUTS + 1) + ' clés') >= 0).toBeTruthy();
    expect(r.indexOf('maximum ' + JS_EVAL_MAX_INPUTS) >= 0).toBeTruthy();
    // Contrôle de prémisse : le MÊME appel à la limite exacte ne bute PAS sur ce
    // message (sinon le test passerait pour une raison sans rapport).
    var ok = {};
    for (var j = 0; j < JS_EVAL_MAX_INPUTS; j++) ok['k' + j] = 'att-1';
    var r2 = flattenToolResult(callTool('miaou__js__eval', { input_handles: ok, code: '1' }));
    expect(r2.indexOf('maximum') >= 0).toBe(false);
  });
  it('rejette un code manquant en erreur synchrone', function() {
    expect(flattenToolResult(callTool('miaou__js__eval', { input_handles: { a: 'att-1' } })))
      .toBe('Code manquant.');
  });
  it('rejette un handle de forme invalide en NOMMANT la clé fautive', function() {
    var r = flattenToolResult(callTool('miaou__js__eval', { input_handles: { src: 'res-x' }, code: '1' }));
    expect(r.indexOf('Handle invalide pour la clé "src"') >= 0).toBeTruthy();
  });
  it('REFUS TOTAL : c\'est la PREMIÈRE clé fautive qui arrête tout, pas la dernière lue', function() {
    // Deux clés fautives : le message doit nommer la PREMIÈRE (ordre d'insertion
    // de Object.keys), preuve que la boucle s'arrête net au lieu de poursuivre la
    // résolution et de rendre l'erreur de la dernière. Hors environnement de test
    // aucun handle n'est résoluble, donc on éprouve la garde de FORME, atteinte
    // avant toute résolution — d'où deux handles malformés plutôt qu'un valide.
    var r = flattenToolResult(callTool('miaou__js__eval',
      { input_handles: { premiere: 'pas-un-handle', seconde: 'pas-non-plus' }, code: '1' }));
    expect(r.indexOf('Handle invalide pour la clé "premiere"') >= 0).toBeTruthy();
    expect(r.indexOf('"seconde"') >= 0).toBe(false);
  });
  it('un handle de forme VALIDE mais non résoluble est refusé en nommant sa clé', function() {
    // Cas distinct du précédent : la forme passe, c'est resolveHandleRecord qui
    // rend null (herméticité piège 18 — un handle hors-scope répond « introuvable »,
    // sans oracle). La clé doit être nommée là aussi.
    var r = flattenToolResult(callTool('miaou__js__eval',
      { input_handles: { absente: 'att-1' }, code: '1' }));
    expect(r.indexOf('Handle introuvable pour la clé "absente"') >= 0).toBeTruthy();
  });
  it('rejette une clé dont le handle est une string vide, en la nommant', function() {
    var r = flattenToolResult(callTool('miaou__js__eval', { input_handles: { vide: '   ' }, code: '1' }));
    expect(r.indexOf('Handle manquant pour la clé "vide"') >= 0).toBeTruthy();
  });
});

describe('_jsEvalStringify (sérialisation du retour guest, lot L)', function() {
  it('null → "null"', function() {
    expect(_jsEvalStringify(null)).toBe('null');
  });
  it('undefined → "undefined"', function() {
    expect(_jsEvalStringify(undefined)).toBe('undefined');
  });
  it('objet → JSON.stringify', function() {
    expect(_jsEvalStringify({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });
  it('string déjà string → re-sérialisée avec guillemets (JSON.stringify, pas passthrough)', function() {
    expect(_jsEvalStringify('bonjour')).toBe('"bonjour"');
  });
  it('nombre → sérialisé nu', function() {
    expect(_jsEvalStringify(42)).toBe('42');
  });
  it('cycle → JSON.stringify échoue, fallback String(val) sans planter', function() {
    var cyc = {};
    cyc.self = cyc;
    var s = _jsEvalStringify(cyc);
    expect(s).toBe('[object Object]');
  });
});

describe('_jsEvalErrText (normalisation des erreurs guest, lot L)', function() {
  it('extrait « name: message » d\'un objet erreur dumpé (pas [object Object])', function() {
    var s = _jsEvalErrText({ name: 'TypeError', message: 'x is not a function' });
    expect(s.indexOf('TypeError: x is not a function') >= 0).toBeTruthy();
    expect(s.indexOf('[object Object]') >= 0).toBe(false);
  });
  it('accole un hint nommant les primitives réservées sur une collision de nom', function() {
    // « const lines = lines() » → invalid redefinition ; le message brut ne nomme
    // ni l'identifiant ni la cause — sans le hint les modèles tâtonnent (observé).
    var s = _jsEvalErrText({ name: 'SyntaxError', message: 'invalid redefinition of global identifier' });
    expect(s.indexOf('réservés') >= 0).toBeTruthy();
    expect(s.indexOf('lines') >= 0).toBeTruthy();
  });
  it('n\'accole PAS le hint sur une erreur sans rapport', function() {
    var s = _jsEvalErrText({ name: 'RangeError', message: 'invalid array length' });
    expect(s.indexOf('réservés') >= 0).toBe(false);
  });
  it('gère une string brute (filet host) sans planter', function() {
    expect(_jsEvalErrText('interrupted').indexOf('interrupted') >= 0).toBeTruthy();
  });
});

describe('DOCS_DOCTRINE v2 (lot V-1 — statique, inconditionnelle, motif WEB_DOCTRINE)', function() {
  it('est intégrée au prompt racine (plus de part conditionnelle)', function() {
    expect(ROOT_SYSTEM_PROMPT.indexOf(DOCS_DOCTRINE) >= 0).toBe(true);
  });
  it('porte les deux blocs balisés, comme WEB_DOCTRINE', function() {
    expect(DOCS_DOCTRINE.indexOf('<OUVERTURE_DE_DOCUMENTS>') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('</OUVERTURE_DE_DOCUMENTS>') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('<SANS_OUVERTURE_DE_DOCUMENTS>') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('</SANS_OUVERTURE_DE_DOCUMENTS>') >= 0).toBe(true);
  });
  it('aiguille les CINQ formats vers les outils natifs (v6 : la puce serveur a disparu)', function() {
    expect(DOCS_DOCTRINE.indexOf('miaou__docs__list') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('miaou__docs__extract') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('miaou__docs__read') >= 0).toBe(true);
    // Les quatre formats à lecteur natif y sont nommés, avec le zip.
    expect(DOCS_DOCTRINE.indexOf('PDF') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('EXCEL') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('WORD') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('POWERPOINT') >= 0).toBe(true);
    expect(DOCS_DOCTRINE.indexOf('ARCHIVE ZIP') >= 0).toBe(true);
  });
  it('ne renvoie PLUS aucun format vers le contrat serveur ref+content_b64 (V-5 étape 3)', function() {
    // La puce serveur avait un occupant de moins à chaque étape de V-5 ; le
    // PowerPoint était le dernier. Une doctrine qui continuerait d'aiguiller un
    // format vers un outil serveur enverrait le modèle chercher un outil qui
    // peut ne pas être branché, alors que le natif sait le lire.
    expect(DOCS_DOCTRINE.indexOf('content_b64') >= 0).toBe(false);
  });
  it('dit de PRÉFÉRER le natif quand les deux existent — sans quoi le modèle tire au sort', function() {
    expect(DOCS_DOCTRINE.indexOf('PRÉFÈRE LE NATIF') >= 0).toBe(true);
  });
  it('ne dépend d\'aucun état de registre : identique avec ou sans serveur branché (piège 16)', function() {
    var before = ROOT_SYSTEM_PROMPT;
    _remoteTools['monserveurperso'] = [{
      name: 'monserveurperso__read',
      description: '',
      inputSchema: { type: 'object', properties: { ref: {}, content_b64: {}, char_start: {} } },
    }];
    expect(ROOT_SYSTEM_PROMPT === before).toBe(true);
    delete _remoteTools['monserveurperso'];
  });
  it('ne mentionne aucun nom de serveur en dur (renommable par l\'utilisateur)', function() {
    expect(DOCS_DOCTRINE.indexOf('mcp_docs') >= 0).toBe(false);
    expect(DOCS_DOCTRINE.indexOf('miaou-proxy') >= 0).toBe(false);
  });
});

// recall_attachment est ASYNC depuis X-1d (allocation d'attId → écriture IDB) :
// callTool renvoie donc TOUJOURS un thenable, y compris sur un retour anticipé,
// et le runner QuickJS n'a pas d'await. Les quatre tests synchrones d'origine
// mesuraient le message de refus et la branche de contenu ; la partie décidable
// est extraite en helper pur (recallableImageError), motif déjà appliqué à
// validateFilesPromoteArgs / validateResourceCreateArgs
// (project_extract_pure_helper_over_idb_stub). Le câblage complet — pixels
// réellement ré-injectés, agent compris — est couvert par verify-agents.mjs.
describe('recallableImageError (X-1d) — décision pure du rappel', function() {
  it('record absent → message « introuvable »', function() {
    expect(recallableImageError(null)).toContain('introuvable');
  });
  it('record sans octets en session → refus explicite, pas un crash', function() {
    expect(recallableImageError({ id: 'res_x', mime: 'image/png' })).toContain('indisponible');
  });
  it('record image complet → aucun refus', function() {
    var ab = new ArrayBuffer(3);
    expect(recallableImageError({ id: 'res_x', mime: 'image/png', data: ab })).toBe('');
  });
  it('un record NON-image complet passe aussi : l\'outil sert les deux', function() {
    // Le refus porte sur la disponibilité, JAMAIS sur le type : recall_attachment
    // rend le texte en clair pour un inline et un descripteur pour un binaire.
    expect(recallableImageError({ id: 'res_t', mime: 'text/plain', data: utf8Encode('x') })).toBe('');
  });
});

describe('recall_attachment (X-1d) — les deux familles de handle', function() {
  it('un handle de ressource est reconnu comme tel par le classifieur', function() {
    // PRÉMISSE de l'élargissement : c'est classifyHandleRef qui aiguille le
    // handler vers resolveHandleRecord (donc vers la délégation d'agent) plutôt
    // que vers le lookup conversation-scopé.
    expect(classifyHandleRef('att-3')).toBe('att');
    expect(classifyHandleRef('res_abc123')).toBe('resource');
    expect(classifyHandleRef('file-abc123')).toBe('file');
  });
  it('le schéma annonce les trois familles, pas seulement att-N', function() {
    // Une capacité qui n'est pas annoncée n'existe pas pour le modèle : c'est
    // exactement ce qui faisait patiner un agent tenant un handle d'image.
    var def = TOOLS.find(function(t) { return t.name === 'recall_attachment'; });
    var d = def.inputSchema.properties.ref.description;
    expect(d).toContain('att-N');
    expect(d).toContain('res_');
    expect(d).toContain('file-');
  });
  it('la description dit que c\'est le SEUL moyen de voir une image', function() {
    var def = TOOLS.find(function(t) { return t.name === 'recall_attachment'; });
    expect(def.description).toContain('SEUL moyen');
  });
});

describe('BINARY_DOCTRINE (X-1d) — l\'affichage n\'est pas la vision', function() {
  it('dit explicitement que la présentation vise l\'utilisateur, pas le modèle', function() {
    // Sans cette phrase, « les images sont affichées directement dans
    // l'interface » se lit comme « tu les vois » — et le modèle ne rappelle
    // jamais l'image dont il détient pourtant le handle.
    expect(BINARY_DOCTRINE).toContain("L'UTILISATEUR");
    expect(BINARY_DOCTRINE).toContain('jamais les pixels');
  });
  it('nomme l\'outil qui donne accès aux pixels', function() {
    expect(BINARY_DOCTRINE).toContain('miaou__recall_attachment');
  });
  it('interdit explicitement de lire une image comme du texte', function() {
    // Le comportement observé : l'agent tentait de lire un PNG avec js__eval.
    expect(BINARY_DOCTRINE).toContain('octets illisibles');
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
  // Lot V : la famille de handle est tranchée dans le validateur pur.
  it('ref res_… (ressource de session) → valide, deuxième source acceptée', function() {
    expect(validateFilesPromoteArgs({ ref: 'res_4ekl9b53', description: 'Un CSV de test.' })).toBe('');
  });
  it('ref file-<id> → refus explicite (déjà dans la bibliothèque)', function() {
    const msg = validateFilesPromoteArgs({ ref: 'file-a1', description: 'Une description.' });
    expect(msg).toContain('déjà dans la bibliothèque');
  });
  it('ref d\'une famille inconnue → handle invalide', function() {
    expect(validateFilesPromoteArgs({ ref: 'call:abc', description: 'x' })).toContain('Handle invalide');
  });
  it('un handle mal formé n\'est pas confondu avec une ressource', function() {
    expect(validateFilesPromoteArgs({ ref: 'res-4ekl', description: 'x' })).toContain('Handle invalide');
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
  it('FILES_DOCTRINE renvoie vers la skill système files-promote pour la doctrine complète (ask_confirmation, voie B)', function() {
    expect(FILES_DOCTRINE.indexOf('skills__read') >= 0).toBeTruthy();
    expect(FILES_DOCTRINE.indexOf('files-promote') >= 0).toBeTruthy();
  });
  it('toolIsHalting reste exclusivement câblé sur ask_confirmation (pas de régression voie A)', function() {
    expect(toolIsHalting('files__promote')).toBe(false);
    expect(toolIsHalting('miaou__files__promote')).toBe(false);
    expect(toolIsHalting('ask_confirmation')).toBe(true);
  });
});

describe('validateResourceCreateArgs (lot O) — extrait du handler async pour rester testable', function() {
  it('content manquant → message d\'erreur', function() {
    expect(validateResourceCreateArgs({})).toContain('vide');
  });
  it('content vide → message d\'erreur', function() {
    expect(validateResourceCreateArgs({ content: '' })).toContain('vide');
  });
  it('content présent → chaîne vide (valide)', function() {
    expect(validateResourceCreateArgs({ content: 'du texte' })).toBe('');
  });
  it('args absent → invalide, pas de crash', function() {
    expect(validateResourceCreateArgs(undefined)).toContain('vide');
  });
});

describe('resource__create — définition d\'outil et doctrine (lot O)', function() {
  it('resource__create est dans TOOLS avec content requis, mode inline uniquement', function() {
    const def = TOOLS.find(t => t.name === 'resource__create');
    expect(def).toBeTruthy();
    expect(def.inputSchema.required.indexOf('content') >= 0).toBeTruthy();
    expect(def.inputSchema.properties.ref).toBe(undefined);
  });
  it('RESOURCE_DOCTRINE fait partie de ROOT_SYSTEM_PROMPT (toujours injectée)', function() {
    expect(ROOT_SYSTEM_PROMPT.indexOf('miaou__resource__create') >= 0).toBeTruthy();
    expect(ROOT_SYSTEM_PROMPT.indexOf('miaou__resource__from_result') >= 0).toBeTruthy();
  });
  it('la description de resource__create pointe vers js__eval et exclut la conversion de tool result', function() {
    const def = TOOLS.find(t => t.name === 'resource__create');
    expect(def.description.indexOf('js__eval') >= 0).toBeTruthy();
    expect(def.description.indexOf('resource__from_result') >= 0).toBeTruthy();
  });
  it('toolIsHalting reste exclusivement câblé sur ask_confirmation (pas de régression)', function() {
    expect(toolIsHalting('resource__create')).toBe(false);
    expect(toolIsHalting('miaou__resource__create')).toBe(false);
  });
});

describe('validateResourceFromResultArgs (lot O-2) — extrait du handler async', function() {
  it('ref + description présents → chaîne vide (valide)', function() {
    expect(validateResourceFromResultArgs({ ref: 'call:abc', description: 'un résumé' })).toBe('');
  });
  it('ref manquant → invalide', function() {
    expect(validateResourceFromResultArgs({ description: 'x' })).toContain('requis');
  });
  it('description manquante → invalide', function() {
    expect(validateResourceFromResultArgs({ ref: 'call:abc' })).toContain('requis');
  });
  it('description blanche (espaces) → invalide', function() {
    expect(validateResourceFromResultArgs({ ref: 'call:abc', description: '   ' })).toContain('requis');
  });
  it('args absent → invalide, pas de crash', function() {
    expect(validateResourceFromResultArgs(undefined)).toContain('requis');
  });
});

describe('isInlineHandleResult (idempotence resource__from_result, lot O-2)', function() {
  it('reconnaît une sortie de formatInlineHandleForModel comme déjà-handle', function() {
    const handle = formatInlineHandleForModel('res_x', 'text/plain', null);
    expect(isInlineHandleResult(handle)).toBe(true);
  });
  it('un résultat d\'outil ordinaire n\'est pas un handle', function() {
    expect(isInlineHandleResult('Voici le contenu de la page web récupérée.')).toBe(false);
  });
  it('null/undefined → false, pas de crash', function() {
    expect(isInlineHandleResult(null)).toBe(false);
    expect(isInlineHandleResult(undefined)).toBe(false);
  });
});

describe('resource__from_result — définition d\'outil (lot O-2)', function() {
  it('resource__from_result est dans TOOLS avec ref ET description requis (schéma pleinement contraint)', function() {
    const def = TOOLS.find(t => t.name === 'resource__from_result');
    expect(def).toBeTruthy();
    expect(def.inputSchema.required.indexOf('ref') >= 0).toBeTruthy();
    expect(def.inputSchema.required.indexOf('description') >= 0).toBeTruthy();
    expect(def.inputSchema.properties.content).toBe(undefined);   // pas de mode inline ici
  });
  it('la description pointe vers js__eval, l\'allègement de contexte, et renvoie vers resource__create', function() {
    const def = TOOLS.find(t => t.name === 'resource__from_result');
    expect(def.description.indexOf('js__eval') >= 0).toBeTruthy();
    expect(def.description.indexOf('resource__create') >= 0).toBeTruthy();
    expect(def.description.indexOf('call:') >= 0).toBeTruthy();
  });
  it('n\'est pas halting', function() {
    expect(toolIsHalting('resource__from_result')).toBe(false);
    expect(toolIsHalting('miaou__resource__from_result')).toBe(false);
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
  it('RESOURCE_REF_RE : reconnaît res_<base36>, rejette tiret/majuscule/vide (lot K)', function() {
    expect(RESOURCE_REF_RE.test('res_abc123')).toBe(true);
    expect(RESOURCE_REF_RE.test('res_2rhku6t4')).toBe(true);
    expect(RESOURCE_REF_RE.test('res-abc')).toBe(false);   // tiret, PAS underscore
    expect(RESOURCE_REF_RE.test('res_ABC')).toBe(false);   // base36 minuscule uniquement
    expect(RESOURCE_REF_RE.test('res_')).toBe(false);      // suffixe vide
    expect(RESOURCE_REF_RE.test('att-1')).toBe(false);     // autre famille
    expect(RESOURCE_REF_RE.test('file-abc')).toBe(false);  // autre famille
  });
  it('_resourcePushState : scopé (conversationId, resId), table distincte, purgée par conversation (lot K)', function() {
    expect(isResourcePushed('c1', 'res_x')).toBe(false);
    markResourcePushed('c1', 'res_x');
    expect(isResourcePushed('c1', 'res_x')).toBe(true);
    expect(isResourcePushed('c2', 'res_x')).toBe(false);   // autre conversation, même resId
    expect(isAttachmentPushed('c1', 'res_x')).toBe(false); // table distincte de _attachmentPushState
    clearResourcePushState('c1');
    expect(isResourcePushed('c1', 'res_x')).toBe(false);
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

describe('classifyHandleRef (famille de handle, lot L)', function() {
  it('att-N → att', function() {
    expect(classifyHandleRef('att-1')).toBe('att');
    expect(classifyHandleRef('att-42')).toBe('att');
  });
  it('file-<id> → file', function() {
    expect(classifyHandleRef('file-abc')).toBe('file');
    expect(classifyHandleRef('file-a1b2c3')).toBe('file');
  });
  it('res_<id> → resource', function() {
    expect(classifyHandleRef('res_abc')).toBe('resource');
    expect(classifyHandleRef('res_x9y8')).toBe('resource');
  });
  it('chaîne vide → null', function() {
    expect(classifyHandleRef('')).toBe(null);
  });
  it('res-x (tiret au lieu du underscore) → null', function() {
    expect(classifyHandleRef('res-x')).toBe(null);
  });
  it('attN (sans tiret) → null', function() {
    expect(classifyHandleRef('attN')).toBe(null);
  });
  it('att- majuscule dans l\'id file → null (le motif exige [a-z0-9])', function() {
    expect(classifyHandleRef('file-ABC')).toBe(null);
  });
  it('non-string → null', function() {
    expect(classifyHandleRef(null)).toBe(null);
    expect(classifyHandleRef(undefined)).toBe(null);
    expect(classifyHandleRef(42)).toBe(null);
  });
});


// Acks d'échec des outils natifs : avant toolFail, un handler en échec retournait
// sa chaîne SANS pousser d'ack — le modèle voyait l'erreur, mais l'appel était
// invisible dans le fil. Les échecs TECHNIQUES (outil inconnu, throw = bug) étaient
// les plus anormaux et pourtant les plus muets.
describe('toolFail — ack d\'échec des outils natifs', function() {
  it('pousse un ack tool_failed en erreur et renvoie le message inchangé', function() {
    clearPendingToolAcks();
    var msg = toolFail('memory__update', 'Souvenir introuvable.');
    expect(msg).toBe('Souvenir introuvable.');   // tool result byte-identique
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('tool_failed');
    expect(acks[0].error).toBe(true);
    expect(acks[0].message).toBe('Souvenir introuvable.');
  });
  it('préfixe le nom nu en nom canonique (miaou__), une seule fois', function() {
    clearPendingToolAcks();
    toolFail('files__read', 'Fichier introuvable.');
    expect(getPendingToolAcks()[0].name).toBe('miaou__files__read');
  });
  it('outil inconnu : isError ET ack d\'échec (avant : isError muet)', function() {
    clearPendingToolAcks();
    var r = callTool('outil_qui_nexiste_pas', {});
    expect(r.isError).toBe(true);
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('tool_failed');
    expect(acks[0].error).toBe(true);
  });
  it('handler qui throw : isError ET ack d\'échec (un bug laisse une trace)', function() {
    clearPendingToolAcks();
    TOOLS.push({
      // Nom SANS `__` en tête : parseToolName splitte sur le PREMIER `__`, donc
      // `__test_boom` serait lu comme préfixe vide + outil `test_boom` (introuvable).
      name: 'testboom', description: 'x', inputSchema: { type: 'object', properties: {} },
      handler: () => { throw new Error('boum'); },
    });
    try {
      var r = callTool('testboom', {});
      expect(r.isError).toBe(true);
      var acks = getPendingToolAcks();
      expect(acks.length).toBe(1);
      expect(acks[0].kind).toBe('tool_failed');
      expect(acks[0].message).toContain('boum');
    } finally {
      TOOLS.pop();
    }
  });
  it('l\'ack d\'échec est rouge (ackIsError le reconnaît via error)', function() {
    clearPendingToolAcks();
    toolFail('memory__create', 'Contenu vide — souvenir ignoré.');
    expect(ackIsError(getPendingToolAcks()[0])).toBe(true);
  });
});

// Court-circuit anti-redemande (servedKeys, api.js) : un tool_call identique à
// un appel déjà servi dans l'échange n'exécute AUCUN handler — sans ack dédié,
// il était invisible dans le fil.
describe('pushDuplicateCallAck — ack du court-circuit anti-redemande', function() {
  it('pousse un ack tool_failed en erreur, reconnu par ackIsError', function() {
    clearPendingToolAcks();
    pushDuplicateCallAck('miaou__conv__get', '(déjà fourni plus haut dans cet échange)');
    var acks = getPendingToolAcks();
    expect(acks.length).toBe(1);
    expect(acks[0].kind).toBe('tool_failed');
    expect(acks[0].error).toBe(true);
    expect(acks[0].message).toBe('(déjà fourni plus haut dans cet échange)');
    expect(ackIsError(acks[0])).toBe(true);
  });
  it('name déjà canonique : AUCUN préfixe ajouté (contrairement à toolFail)', function() {
    clearPendingToolAcks();
    pushDuplicateCallAck('brave__web_search', 'x');
    expect(getPendingToolAcks()[0].name).toBe('brave__web_search');
  });
});

// ── Contexte d'exécution des outils (lot T-1c) ──────────────────────────────
// Un outil s'exécute POUR une conversation et DANS un Espace : ceux de la
// GÉNÉRATION qui l'a demandé, jamais ceux de l'écran. Avec N générations
// concurrentes (lot T), un outil scopé lancé par la génération de A pendant que
// l'écran affiche B répondrait sinon dans le référentiel de B — mauvaise
// réponse, silencieuse, herméticité des Spaces comprise (piège 18).
//
// Ces tests posent délibérément des globales d'écran CONTRADICTOIRES : ils
// échouent si un handler relit la globale au lieu d'honorer son ctx. C'est le
// filet du critère de complétude A1 (grep sans occurrence), côté comportement.

describe('T-1c — ctx d\'exécution : le ctx explicite prime sur l\'écran', function() {

  it('toolCtx : ctx complet honoré tel quel', function() {
    var c = toolCtx({ convId: 'cX', spaceId: 'spX' });
    expect(c.convId).toBe('cX');
    expect(c.spaceId).toBe('spX');
  });

  it('toolCtx : sans ctx, repli sur l\'écran (appel hors génération)', function() {
    activeSpaceId = 'sp-ecran';
    try {
      var c = toolCtx(undefined);
      expect(c.spaceId).toBe('sp-ecran');
    } finally { activeSpaceId = DEFAULT_SPACE_ID; }
  });

  it('toolCtx : convId null explicite est une VALEUR, pas une absence', function() {
    // Une génération sur une conversation non encore créée porte convId null ;
    // retomber sur l'écran ici ferait répondre dans une autre conversation.
    activeSpaceId = 'sp-ecran';
    try {
      var c = toolCtx({ convId: null, spaceId: 'spX' });
      expect(c.convId).toBe(null);
      expect(c.spaceId).toBe('spX');
    } finally { activeSpaceId = DEFAULT_SPACE_ID; }
  });

  it('conv__get : le ctx décide de l\'herméticité, pas l\'écran', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, spaceId: 'sp-gen', messages: [] });
    // Écran sur un AUTRE Space que la génération : sans ctx honoré, la conv
    // serait déclarée introuvable alors qu'elle est dans le Space de la génération.
    activeSpaceId = 'sp-ecran';
    try {
      var r = JSON.parse(flattenToolResult(
        callTool('conv__get', { id: 'c1' }, { convId: 'c9', spaceId: 'sp-gen' })));
      expect(r.summary).toBe('s');
    } finally { activeSpaceId = DEFAULT_SPACE_ID; }
  });

  it('conv__get : une conv hors du Space de la GÉNÉRATION reste introuvable', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't', timestamp: 1000, summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't', timestamp: 1000, spaceId: 'sp-autre', messages: [] });
    // L'écran, lui, EST dans le bon Space : un handler qui relirait la globale
    // laisserait fuiter la conversation. Pas d'oracle : « introuvable ».
    activeSpaceId = 'sp-autre';
    try {
      var r = flattenToolResult(
        callTool('conv__get', { id: 'c1' }, { convId: 'c9', spaceId: 'sp-gen' }));
      expect(r).toContain('introuvable');
    } finally { activeSpaceId = DEFAULT_SPACE_ID; }
  });

  it('conv__list : scope sur le Space de la génération', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't1', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't1', timestamp: 1000, spaceId: 'sp-gen', messages: [] });
    saveSummary('c2', { title: 't2', timestamp: Date.parse('2026-03-02T00:00:00Z'), summary: 's', keywords: [] });
    saveConversation({ id: 'c2', title: 't2', timestamp: 1000, spaceId: 'sp-ecran', messages: [] });
    activeSpaceId = 'sp-ecran';
    try {
      var r = JSON.parse(flattenToolResult(
        callTool('conv__list', {}, { convId: 'c9', spaceId: 'sp-gen' })));
      expect(r.length).toBe(1);
      expect(r[0].id).toBe('c1');
    } finally { activeSpaceId = DEFAULT_SPACE_ID; }
  });

  it('conv__list : exclut la conv de la GÉNÉRATION, pas celle affichée', function() {
    localStorage.clear();
    saveSummary('c1', { title: 't1', timestamp: Date.parse('2026-03-01T00:00:00Z'), summary: 's', keywords: [] });
    saveConversation({ id: 'c1', title: 't1', timestamp: 1000, spaceId: 'sp-gen', messages: [] });
    saveSummary('c2', { title: 't2', timestamp: Date.parse('2026-03-02T00:00:00Z'), summary: 's', keywords: [] });
    saveConversation({ id: 'c2', title: 't2', timestamp: 1000, spaceId: 'sp-gen', messages: [] });
    // « La conversation en cours » = celle de la génération (c1), pas l'affichée (c2).
    currentConvId = 'c2';
    activeSpaceId = 'sp-gen';
    try {
      var r = JSON.parse(flattenToolResult(
        callTool('conv__list', {}, { convId: 'c1', spaceId: 'sp-gen' })));
      expect(r.length).toBe(1);
      expect(r[0].id).toBe('c2');
    } finally { currentConvId = null; activeSpaceId = DEFAULT_SPACE_ID; }
  });

  it('files__list : bibliothèque du Space de la génération', function() {
    localStorage.clear();
    _resourceCache['file_g1'] = { id: 'file_g1', spaceId: 'sp-gen', kind: 'library',
      class: 'inline', mime: 'text/plain', name: 'gen.txt', size: 5, createdAt: 1 };
    _resourceCache['file_e1'] = { id: 'file_e1', spaceId: 'sp-ecran', kind: 'library',
      class: 'inline', mime: 'text/plain', name: 'ecran.txt', size: 5, createdAt: 2 };
    activeSpaceId = 'sp-ecran';
    try {
      var r = JSON.parse(flattenToolResult(
        callTool('miaou__files__list', {}, { convId: 'c9', spaceId: 'sp-gen' })));
      expect(r.length).toBe(1);
      expect(r[0].name).toBe('gen.txt');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_g1'];
      delete _resourceCache['file_e1'];
    }
  });

  it('files__read : un fichier du Space AFFICHÉ est inconnu de la génération', function() {
    localStorage.clear();
    _resourceCache['file_e1'] = { id: 'file_e1', spaceId: 'sp-ecran', kind: 'library',
      class: 'inline', mime: 'text/plain', name: 'ecran.txt', size: 5, createdAt: 2,
      data: new ArrayBuffer(1) };
    activeSpaceId = 'sp-ecran';
    try {
      var r = flattenToolResult(
        callTool('miaou__files__read', { id: 'file-e1' }, { convId: 'c9', spaceId: 'sp-gen' }));
      expect(r).toContain('introuvable');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_e1'];
    }
  });

  it('memory__create : le souvenir est scopé au Space de la génération', function() {
    localStorage.clear();
    activeSpaceId = 'sp-ecran';
    try {
      callTool('memory__create', { content: 'fait de la génération' },
        { convId: 'c9', spaceId: 'sp-gen' });
      var mems = loadMemories();
      expect(mems.length).toBe(1);
      expect(mems[0].scope).toBe('sp-gen');
    } finally { activeSpaceId = DEFAULT_SPACE_ID; }
  });

  it('resolveHandleRecord : un file-<id> d\'un autre Space reste null', function() {
    _resourceCache['file_e1'] = { id: 'file_e1', spaceId: 'sp-ecran', kind: 'library',
      class: 'inline', mime: 'text/plain', name: 'ecran.txt', size: 5, createdAt: 2 };
    activeSpaceId = 'sp-ecran';
    try {
      expect(resolveHandleRecord('file-e1', { convId: 'c9', spaceId: 'sp-gen' })).toBe(null);
      // Contrôle positif : avec le bon Space, le record est bien résolu.
      var ok = resolveHandleRecord('file-e1', { convId: 'c9', spaceId: 'sp-ecran' });
      expect(!!ok).toBe(true);
      expect(ok.name).toBe('ecran.txt');
    } finally {
      activeSpaceId = DEFAULT_SPACE_ID;
      delete _resourceCache['file_e1'];
    }
  });
});

// ── Lot Y — resource__append + output_handle/emit ────────────────────────────

describe('validateResourceAppendArgs (lot Y) — extrait du handler async', function() {
  it('id res_… + content présents → chaîne vide (valide)', function() {
    expect(validateResourceAppendArgs({ id: 'res_abc', content: 'du texte' })).toBe('');
  });
  it('id manquant → invalide', function() {
    expect(validateResourceAppendArgs({ content: 'x' })).toContain('Handle manquant');
  });
  it('content vide → refus explicite, pas un no-op', function() {
    expect(validateResourceAppendArgs({ id: 'res_abc', content: '' })).toContain('vide');
  });
  it('args absent → invalide, pas de crash', function() {
    expect(validateResourceAppendArgs(undefined)).toContain('Handle manquant');
  });
  it('GARDE DE FAMILLE : att-N refusé au niveau du schéma', function() {
    const msg = validateResourceAppendArgs({ id: 'att-1', content: 'x' });
    expect(msg.indexOf('res_<id>') >= 0).toBe(true);
  });
  it('GARDE DE FAMILLE : file-<id> refusé au niveau du schéma', function() {
    const msg = validateResourceAppendArgs({ id: 'file-deadbeef', content: 'x' });
    expect(msg.indexOf('res_<id>') >= 0).toBe(true);
  });
  it('handle d\'aucune famille connue → refus', function() {
    expect(validateResourceAppendArgs({ id: 'bogus', content: 'x' }).length > 0).toBe(true);
  });
  it('content à espaces seuls reste VALIDE (un saut de ligne est du contenu)', function() {
    // Contrôle de prémisse du refus « vide » : c'est la chaîne VIDE qui est
    // refusée, pas le blanc — un '\n' entre deux blocs est un ajout légitime.
    expect(validateResourceAppendArgs({ id: 'res_abc', content: '\n' })).toBe('');
  });
});

describe('resource__append — définition d\'outil et doctrine (lot Y)', function() {
  it('est dans TOOLS avec id et content requis', function() {
    const def = TOOLS.find(t => t.name === 'resource__append');
    expect(def).toBeTruthy();
    expect(def.inputSchema.required.indexOf('id') >= 0).toBe(true);
    expect(def.inputSchema.required.indexOf('content') >= 0).toBe(true);
  });
  it('n\'expose ni mime ni name (contrairement à resource__create)', function() {
    const def = TOOLS.find(t => t.name === 'resource__append');
    expect(def.inputSchema.properties.mime).toBe(undefined);
    expect(def.inputSchema.properties.name).toBe(undefined);
  });
  it('annotations : écriture d\'état (readOnlyHint false)', function() {
    const def = TOOLS.find(t => t.name === 'resource__append');
    expect(def.annotations.readOnlyHint).toBe(false);
  });
  it('RESOURCE_DOCTRINE nomme les TROIS outils, dans ROOT_SYSTEM_PROMPT', function() {
    expect(ROOT_SYSTEM_PROMPT.indexOf('miaou__resource__create') >= 0).toBe(true);
    expect(ROOT_SYSTEM_PROMPT.indexOf('miaou__resource__from_result') >= 0).toBe(true);
    expect(ROOT_SYSTEM_PROMPT.indexOf('miaou__resource__append') >= 0).toBe(true);
  });
  it('RESOURCE_DOCTRINE ne dit plus « Deux outils » (énumération fermée)', function() {
    expect(RESOURCE_DOCTRINE.indexOf('Deux outils') >= 0).toBe(false);
    expect(RESOURCE_DOCTRINE.indexOf('Trois outils') >= 0).toBe(true);
  });
  it('toolIsHalting reste exclusivement câblé sur ask_confirmation', function() {
    expect(toolIsHalting('resource__append')).toBe(false);
    expect(toolIsHalting('miaou__resource__append')).toBe(false);
  });
});

describe('js__eval + output_handle / emit (lot Y)', function() {
  it('output_handle est un paramètre OPTIONNEL (absent de required)', function() {
    const def = TOOLS.find(t => t.name === 'js__eval');
    expect(def.inputSchema.properties.output_handle).toBeTruthy();
    expect(def.inputSchema.required.indexOf('output_handle') >= 0).toBe(false);
    // Contrôle de prémisse : les deux autres, eux, SONT requis.
    expect(def.inputSchema.required.indexOf('input_handles') >= 0).toBe(true);
    expect(def.inputSchema.required.indexOf('code') >= 0).toBe(true);
  });
  it('readOnlyHint est false : l\'outil écrit dès qu\'un output_handle est fourni', function() {
    const def = TOOLS.find(t => t.name === 'js__eval');
    expect(def.annotations.readOnlyHint).toBe(false);
  });
  it('la description mentionne output_handle et emit', function() {
    const def = TOOLS.find(t => t.name === 'js__eval');
    expect(def.description.indexOf('output_handle') >= 0).toBe(true);
    expect(def.description.indexOf('emit()') >= 0).toBe(true);
  });
  it('les quatre primitives de lecture prennent une clé (lot L-2), pas zéro argument', function() {
    // La clé est OBLIGATOIRE (décision 3 du brief L-2) : plus aucune forme sans
    // argument, y compris à une seule ressource — une seule syntaxe à documenter.
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('function text(key)') >= 0).toBe(true);
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('function lines(key)') >= 0).toBe(true);
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('function jsonLines(key)') >= 0).toBe(true);
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('function parse(key)') >= 0).toBe(true);
    // Le pont host est appelé AVEC la clé (une signature élargie, pas un second pont).
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('__miaou_text(key)') >= 0).toBe(true);
  });
  it('SURFACE GUEST FERMÉE : le prélude de base ne définit QUE les quatre lectures', function() {
    // Piège 25 — emit ne doit PAS être dans le prélude de base : sans
    // output_handle, la primitive n'existe pas (ReferenceError au lieu d'un
    // no-op silencieux).
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('function text(') >= 0).toBe(true);
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('function lines(') >= 0).toBe(true);
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('function jsonLines(') >= 0).toBe(true);
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('function parse(') >= 0).toBe(true);
    expect(JS_EVAL_GUEST_PRELUDE.indexOf('emit') >= 0).toBe(false);
  });
  it('le prélude emit est SÉPARÉ et pose la cinquième primitive', function() {
    expect(JS_EVAL_EMIT_PRELUDE.indexOf('function emit(') >= 0).toBe(true);
  });
  it('PONT DÉDIÉ : emit passe par __miaou_emit, jamais par __miaou_text', function() {
    // Le pont d'entrée reste ce qu'il était ; la sortie en ouvre un second,
    // explicitement (brief §3, piège 25).
    expect(JS_EVAL_EMIT_PRELUDE.indexOf('__miaou_emit') >= 0).toBe(true);
    expect(JS_EVAL_EMIT_PRELUDE.indexOf('__miaou_text') >= 0).toBe(false);
  });
  it('AUCUN autre pont host→guest que les deux énumérés', function() {
    // Toute host function est posée par ctx.newFunction dans runInQuickJs : le
    // compte des occurrences borne la surface. Deux, pas trois.
    const src = String(runInQuickJs);
    const bridges = src.match(/ctx\.newFunction\(/g) || [];
    expect(bridges.length).toBe(2);
  });
});

describe('marqueurs de refus d\'autorisation sur un ack (campagne AB)', function() {
  var CODE = 'AUTHORIZATION_REQUIRED';
  function refusal() {
    return { code: CODE, upstream: 'notion', authorization_url: 'http://127.0.0.1:8765/authorize/notion' };
  }

  it('pose les trois champs, en camelCase (le snake_case est la convention du fil)', function() {
    var ack = { kind: 'mcp_call', name: 'proxy__notion__search', error: true };
    applyAuthorizationRefusal(ack, CODE, refusal());
    expect(ack.errorCode).toBe(CODE);
    expect(ack.authorizationUrl).toBe('http://127.0.0.1:8765/authorize/notion');
    expect(ack.upstream).toBe('notion');
  });
  it('ne pose RIEN sur un autre code machine (REF_UNKNOWN reste ephemere)', function() {
    var ack = { kind: 'mcp_call', error: true };
    applyAuthorizationRefusal(ack, 'REF_UNKNOWN', { code: 'REF_UNKNOWN' });
    expect(ack.errorCode).toBe(undefined);
    expect(ack.authorizationUrl).toBe(undefined);
  });
  it('ne pose rien quand il n\'y a aucun code', function() {
    var ack = { kind: 'mcp_call', error: true };
    applyAuthorizationRefusal(ack, undefined, undefined);
    expect(ack.errorCode).toBe(undefined);
  });
  it('pose le code meme sans url : le proxy peut n\'avoir aucun parcours a proposer', function() {
    // ackAuthorizationTarget refusera d'afficher un lien, et c'est le
    // comportement voulu — mais le code, lui, est l'information vraie.
    var ack = { kind: 'mcp_call', error: true };
    applyAuthorizationRefusal(ack, CODE, { code: CODE, authorization_url: null });
    expect(ack.errorCode).toBe(CODE);
    expect(ack.authorizationUrl).toBe(undefined);
  });
  it('retire les TROIS champs ensemble au rejeu reussi', function() {
    // L'invariant : poses ensemble, retires ensemble. En laisser un derriere
    // afficherait un lien perime sous un appel qui a fini par reussir.
    var ack = { kind: 'mcp_call', error: true };
    applyAuthorizationRefusal(ack, CODE, refusal());
    clearAuthorizationRefusal(ack);
    expect(ack.errorCode).toBe(undefined);
    expect(ack.authorizationUrl).toBe(undefined);
    expect(ack.upstream).toBe(undefined);
  });
  it('le nettoyage ne touche pas au reste de l\'ack', function() {
    var ack = { kind: 'mcp_call', name: 'proxy__x', intent: 'chercher', error: true };
    applyAuthorizationRefusal(ack, CODE, refusal());
    clearAuthorizationRefusal(ack);
    expect(ack.name).toBe('proxy__x');
    expect(ack.intent).toBe('chercher');
    expect(ack.error).toBe(true);
  });
  it('un ack nettoye n\'est plus une cible presentable', function() {
    // Le joint entre les deux fonctions pures et le predicat de rendu.
    var ack = { kind: 'mcp_call', error: true };
    applyAuthorizationRefusal(ack, CODE, refusal());
    expect(ackAuthorizationTarget(ack).origin).toBe('127.0.0.1:8765');
    clearAuthorizationRefusal(ack);
    expect(ackAuthorizationTarget(ack)).toBe(null);
  });
  it('tolere un ack absent', function() {
    expect(applyAuthorizationRefusal(null, CODE, refusal())).toBe(null);
    expect(clearAuthorizationRefusal(null)).toBe(null);
  });
});

describe('refus d\'autorisation : la whitelist d\'ack laisse passer les trois champs', function() {
  it('copyAckFields propage errorCode, authorizationUrl et upstream', function() {
    // Sans ces trois lignes dans ACK_COPY_FIELDS, les champs seraient poses par
    // callRemoteTool puis perdus au premier passage par la whitelist : ni
    // persistes, ni rendus au reload.
    var src = {
      kind: 'mcp_call', name: 'proxy__notion__search', error: true,
      errorCode: 'AUTHORIZATION_REQUIRED',
      authorizationUrl: 'http://127.0.0.1:8765/authorize/notion',
      upstream: 'notion',
    };
    var out = copyAckFields(src, { role: 'tool-ack' });
    expect(out.errorCode).toBe('AUTHORIZATION_REQUIRED');
    expect(out.authorizationUrl).toBe('http://127.0.0.1:8765/authorize/notion');
    expect(out.upstream).toBe('notion');
    expect(ackAuthorizationTarget(out).origin).toBe('127.0.0.1:8765');
  });
});

describe('texte du refus d\'autorisation adresse au MODELE (campagne AB)', function() {
  var SRV = "Le serveur 'notion' exige une autorisation OAuth qui n'a pas encore ete accordee. Ouvrir ce lien pour l'accorder : http://127.0.0.1:8765/authorize/notion";
  var out = formatAuthorizationRefusalForModel('proxy__notion__search', SRV);

  it('conserve le message serveur (prose humaine, affichable, jamais parsee)', function() {
    expect(out).toContain("exige une autorisation OAuth");
  });
  it('nomme QUI agit : l\'utilisateur, pas le modele', function() {
    expect(out).toContain('seul l\'utilisateur peut accorder');
  });
  it('dit explicitement que le modele n\'a pas d\'outil pour ca', function() {
    // Sans cette phrase, un modele lit l'imperatif du message serveur comme une
    // consigne pour lui, cherche l'outil, et conclut de travers.
    expect(out).toContain("tu n'as pas d'outil");
  });
  it('dit que le lien est DEJA affiche — rien a transmettre', function() {
    expect(out).toContain('lui est déjà affiché dans la conversation');
  });
  it('dit que l\'echec est temporaire, pour que la capacite ne soit pas rayee', function() {
    expect(out).toContain('le même appel fonctionnera');
  });
  it('ne REPETE pas l\'url : elle est deja dans le message serveur', function() {
    // La repeter la mettrait deux fois dans le contexte, dont une dans une
    // phrase que le modele pourrait recopier en reponse — remettant un lien
    // d'origine reseau sur un chemin de rendu sans la garde du predicat.
    var n = out.split('http://127.0.0.1:8765/authorize/notion').length - 1;
    expect(n).toBe(1);
  });
  it('tolere un message serveur absent', function() {
    var o = formatAuthorizationRefusalForModel('proxy__x', null);
    expect(o).toContain('proxy__x');
    expect(o).toContain('seul l\'utilisateur peut accorder');
  });
});

// ── Aide : jetons {{…}} et liste des sujets ──────────────────────────────────
// Deux fonctions pures, testées ici sur des entrées injectées : sous QuickJS
// HELP_CONTENT vaut {} (sources non buildées), donc on ne dépend pas du contenu
// réel de help.md — ce que garde le contrôle Python run_help_placeholders_check.

describe('resolveHelpPlaceholders — substitution des valeurs configurables', function() {
  it('remplace un jeton connu par sa valeur', function() {
    expect(resolveHelpPlaceholders('au plus {{N}} images', { N: '4' }))
      .toBe('au plus 4 images');
  });
  it('remplace toutes les occurrences d\'un même jeton', function() {
    expect(resolveHelpPlaceholders('{{A}} puis {{A}}', { A: 'x' })).toBe('x puis x');
  });
  it('laisse un jeton INCONNU tel quel : un trou silencieux se remarque moins', function() {
    expect(resolveHelpPlaceholders('{{ABSENT}} ici', { N: '4' })).toBe('{{ABSENT}} ici');
  });
  it('tolère un markdown vide ou nul sans exception', function() {
    expect(resolveHelpPlaceholders(null, {})).toBe('');
    expect(resolveHelpPlaceholders('', {})).toBe('');
  });
  it('tolère une table de valeurs absente', function() {
    expect(resolveHelpPlaceholders('{{N}}', null)).toBe('{{N}}');
  });
  it('ne touche pas à un texte sans jeton', function() {
    expect(resolveHelpPlaceholders('rien à faire ici', { N: '4' })).toBe('rien à faire ici');
  });
});

describe('formatHelpTopicList — liste des sujets composée, jamais rédigée', function() {
  var content = { apercu: 'a', espaces: 'b', mcp: 'c' };
  var labels = { apercu: 'vue d\'ensemble', espaces: 'Espaces', mcp: 'serveurs compagnons MCP' };

  it('une puce par sujet, slug entre backticks puis libellé', function() {
    expect(formatHelpTopicList(content, labels, 'apercu'))
      .toBe('- `espaces` — Espaces\n- `mcp` — serveurs compagnons MCP');
  });
  it('exclut le sujet demandé (apercu ne s\'annonce pas lui-même)', function() {
    expect(formatHelpTopicList(content, labels, 'apercu').indexOf('`apercu`') < 0).toBeTruthy();
  });
  it('un slug SANS libellé se rabat sur le slug, plutôt que de disparaître', function() {
    expect(formatHelpTopicList({ x: 'c' }, {}, 'apercu')).toBe('- `x` — x');
  });
  it('suit le contenu réel : une section ajoutée est annoncée sans rien rédiger', function() {
    var grown = { apercu: 'a', espaces: 'b', mcp: 'c', nouvelle: 'd' };
    expect(formatHelpTopicList(grown, labels, 'apercu').indexOf('`nouvelle`') >= 0).toBeTruthy();
  });
  it('tolère un contenu ou des libellés absents', function() {
    expect(formatHelpTopicList(null, null, 'apercu')).toBe('');
  });
});
