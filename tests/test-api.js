// tests/test-api.js
// On teste uniquement les fonctions pures extraites du flux SSE.
// Le fetch réel n'est pas testable ici.

describe('parseSSELine', function() {
  it('retourne null sur une ligne vide', function() {
    expect(parseSSELine('')).toBeFalsy();
  });
  it('retourne null sur [DONE]', function() {
    expect(parseSSELine('data: [DONE]')).toBeFalsy();
  });
  it('extrait le delta content', function() {
    var line = 'data: {"choices":[{"delta":{"content":"hello"}}]}';
    expect(parseSSELine(line)).toBe('hello');
  });
  it('ne plante pas sur du JSON malformé', function() {
    expect(parseSSELine('data: {invalide')).toBeFalsy();
  });
});

describe('reasoningDelta (détection du raisonnement streamé)', function() {
  it('extrait le champ reasoning', function() {
    expect(reasoningDelta({ reasoning: 'hmm' })).toBe('hmm');
  });
  it('extrait reasoning_content (style DeepSeek/vLLM)', function() {
    expect(reasoningDelta({ reasoning_content: 'abc' })).toBe('abc');
  });
  it('extrait thinking (relais Ollama natif)', function() {
    expect(reasoningDelta({ thinking: 'xyz' })).toBe('xyz');
  });
  it('renvoie null quand aucun champ de raisonnement n\'est présent', function() {
    expect(reasoningDelta({ content: 'salut' })).toBe(null);
  });
  it('renvoie null sur un delta vide ou nul', function() {
    expect(reasoningDelta({})).toBe(null);
    expect(reasoningDelta(null)).toBe(null);
  });
  it('traite la chaîne vide comme une présence (capacité), pas une absence', function() {
    expect(reasoningDelta({ reasoning: '' })).toBe('');
  });
});

describe('joinReasoning (accumulation entre tours)', function() {
  it('renvoie le second segment si le premier est vide', function() {
    expect(joinReasoning('', 'b')).toBe('b');
  });
  it('renvoie le premier segment si le second est vide', function() {
    expect(joinReasoning('a', '')).toBe('a');
  });
  it('concatène les deux avec une séparation', function() {
    expect(joinReasoning('a', 'b')).toBe('a\n\nb');
  });
  it('renvoie une chaîne vide si les deux sont vides', function() {
    expect(joinReasoning('', '')).toBe('');
  });
});

describe('searchSummaries (exclusion de la conversation courante)', function() {
  it('exclut la conversation dont l\'id est passé en second argument', function() {
    localStorage.clear();
    saveSummary('conv-current', { title: 'actuelle', timestamp: 1000, summary: 'docker compose réseau', keywords: ['docker'] });
    saveSummary('conv-other',   { title: 'autre',    timestamp: 1000, summary: 'docker compose réseau', keywords: ['docker'] });
    var results = searchSummaries('docker', 'conv-current');
    var ids = results.map(function(r) { return r.id; });
    expect(ids.indexOf('conv-current') >= 0).toBe(false);
    expect(ids.indexOf('conv-other') >= 0).toBe(true);
    localStorage.clear();
  });
  it('inclut toutes les conversations si excludeId est absent', function() {
    localStorage.clear();
    saveSummary('conv-a', { title: 'a', timestamp: 1000, summary: 'docker compose réseau', keywords: ['docker'] });
    saveSummary('conv-b', { title: 'b', timestamp: 1000, summary: 'docker compose réseau', keywords: ['docker'] });
    var results = searchSummaries('docker');
    expect(results.length).toBe(2);
    localStorage.clear();
  });
});

describe('parseSummaryJSON (parsing défensif des résumés)', function() {
  it('parse un JSON propre', function() {
    var r = parseSummaryJSON('{"summary":"x","keywords":["a","b"]}');
    expect(r.summary).toBe('x');
  });
  it('retire les fences markdown avant de parser', function() {
    var r = parseSummaryJSON('```json\n{"summary":"x","keywords":[]}\n```');
    expect(r.summary).toBe('x');
  });
  it('retourne null si le JSON est invalide', function() {
    var r = parseSummaryJSON('ceci n\'est pas du JSON');
    expect(r).toBeFalsy();
  });
});

describe('rejet de reasoning_effort (cache session par endpoint+modèle)', function() {
  it('non marqué → pas rejeté', function() {
    expect(isReasoningEffortRejected('http://u1/v1', 'm1')).toBeFalsy();
  });
  it('marqué → rejeté pour ce couple exact', function() {
    markReasoningEffortRejected('http://u2/v1', 'm1');
    expect(isReasoningEffortRejected('http://u2/v1', 'm1')).toBeTruthy();
  });
  it('clé composite : même endpoint, autre modèle → indépendant', function() {
    markReasoningEffortRejected('http://u3/v1', 'm1');
    expect(isReasoningEffortRejected('http://u3/v1', 'm2')).toBeFalsy();
  });
  it('clé composite : même modèle, autre endpoint → indépendant', function() {
    markReasoningEffortRejected('http://u4/v1', 'm1');
    expect(isReasoningEffortRejected('http://u5/v1', 'm1')).toBeFalsy();
  });
});
