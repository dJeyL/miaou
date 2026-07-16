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
    // HELP_CONTENT vide sous QuickJS → topic inconnu retombe sur overview (défaut),
    // lui-même absent → message d'indisponibilité (jamais un crash).
    var out = aboutTool().handler({ topic: 'spaces' });
    expect(typeof out).toBe('string');
    var ack = _pendingToolAcks[_pendingToolAcks.length - 1];
    expect(ack.kind).toBe('about_read');
    expect(ack.topic).toBe('overview');   // 'spaces' absent de {} → défaut overview
  });
  it('handler : topic absent → défaut overview dans l\'ack', function() {
    _pendingToolAcks.length = 0;
    aboutTool().handler({});
    expect(_pendingToolAcks[_pendingToolAcks.length - 1].topic).toBe('overview');
  });
  it('ackLabel about_read : topic ou repli overview', function() {
    expect(ackLabel('about_read', { topic: 'spaces' })).toContain('spaces');
    expect(ackLabel('about_read', {})).toContain('overview');
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
  it('memory__update refuse un souvenir de scope profile (pas exposé aux outils Space)', function() {
    localStorage.clear();
    saveMemory({ id: 'm1', content: 'x', created_at: 1, updated_at: 1, suppressed: false, scope: 'profile' });
    activeSpaceId = 'sp1';
    try {
      var r = ct('memory__update', { id: 'm1', content: 'y' });
      expect(r).toContain('introuvable');
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

describe('js__eval exposé au modèle (registre TOOLS, lot L)', function() {
  it('miaou__js__eval est dans exposedTools avec handle+code requis', function() {
    var def = exposedTools().find(function(t) { return t.name === 'miaou__js__eval'; });
    expect(!!def).toBe(true);
    var props = def.inputSchema.properties;
    expect(!!props.handle).toBe(true);
    expect(!!props.code).toBe(true);
    expect(def.inputSchema.required.indexOf('handle') >= 0).toBeTruthy();
    expect(def.inputSchema.required.indexOf('code') >= 0).toBeTruthy();
  });
  it('rejette un handle vide/manquant en erreur synchrone (avant tout async)', function() {
    expect(flattenToolResult(callTool('miaou__js__eval', { code: '1' }))).toBe('Handle manquant.');
  });
  it('rejette un code manquant en erreur synchrone', function() {
    expect(flattenToolResult(callTool('miaou__js__eval', { handle: 'att-1' }))).toBe('Code manquant.');
  });
  it('rejette un handle de forme invalide en erreur synchrone', function() {
    var r = flattenToolResult(callTool('miaou__js__eval', { handle: 'res-x', code: '1' }));
    expect(r.indexOf('Handle invalide') >= 0).toBeTruthy();
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
