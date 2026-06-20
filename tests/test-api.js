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
