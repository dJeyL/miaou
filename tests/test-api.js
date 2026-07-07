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

describe('sseDataObject sur un chunk terminal stream_options.include_usage (Bbis)', function() {
  it('choices vide + usage présent → objet exploitable indépendamment de choices', function() {
    var line = 'data: {"usage":{"prompt_tokens":10351,"total_tokens":10395,"completion_tokens":44,"prompt_tokens_details":{"cached_tokens":9824}},"choices":[]}';
    var chunk = sseDataObject(line);
    expect(chunk).toBeTruthy();
    expect(Array.isArray(chunk.choices)).toBeTruthy();
    expect(chunk.choices.length).toBe(0);
    expect(chunk.usage.prompt_tokens).toBe(10351);
    expect(chunk.usage.prompt_tokens_details.cached_tokens).toBe(9824);
  });
  it('chunk normal sans usage → champ usage absent', function() {
    var chunk = sseDataObject('data: {"choices":[{"delta":{"content":"hi"}}]}');
    expect(chunk.usage).toBeFalsy();
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

// ── Dégradation vision-less (D5, brief A lot 2) ──────────────────────────────

describe('rejet vision (cache session par endpoint+modèle)', function() {
  it('non marqué → pas rejeté', function() {
    expect(isVisionRejected('http://v1/v1', 'm1')).toBeFalsy();
  });
  it('marqué → rejeté pour ce couple exact', function() {
    markVisionRejected('http://v2/v1', 'm1');
    expect(isVisionRejected('http://v2/v1', 'm1')).toBeTruthy();
  });
  it('clé composite : même endpoint, autre modèle → indépendant (ne dégrade pas un autre modèle vision-capable)', function() {
    markVisionRejected('http://v3/v1', 'm1');
    expect(isVisionRejected('http://v3/v1', 'm2')).toBeFalsy();
  });
  it('clé composite : même modèle, autre endpoint → indépendant', function() {
    markVisionRejected('http://v4/v1', 'm1');
    expect(isVisionRejected('http://v5/v1', 'm1')).toBeFalsy();
  });
});

describe('messagesHaveImageParts', function() {
  it('aucun message en content parts → false', function() {
    expect(messagesHaveImageParts([{ role: 'user', content: 'texte' }])).toBeFalsy();
  });
  it('content parts sans image_url → false', function() {
    expect(messagesHaveImageParts([{ role: 'user', content: [{ type: 'text', text: 'x' }] }])).toBeFalsy();
  });
  it('au moins une part image_url → true', function() {
    var msgs = [{ role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'image_url', image_url: { url: 'data:x' } }] }];
    expect(messagesHaveImageParts(msgs)).toBeTruthy();
  });
});

describe('degradeVisionMessages', function() {
  it('remplace les parts image par texte + descripteurs (brief D5, jamais un strip nu)', function() {
    var msgs = [{ role: 'user', content: [{ type: 'text', text: 'analyse' }, { type: 'image_url', image_url: { url: 'data:x' } }] }];
    var desc = formatAttachmentDescriptor({ attId: 'att-1', name: 'diagram.png', w: 1280, h: 960, size: 219136 });
    var out = degradeVisionMessages(msgs, [desc]);
    expect(typeof out[0].content).toBe('string');
    expect(out[0].content).toBe('analyse\n\n' + desc);
    expect(out[0].content.indexOf('data:x') < 0).toBeTruthy();   // plus de base64
  });
  it('plusieurs descripteurs → une ligne chacun, dans l\'ordre fourni', function() {
    var msgs = [{ role: 'user', content: [{ type: 'text', text: 'deux' },
      { type: 'image_url', image_url: { url: 'data:a' } },
      { type: 'image_url', image_url: { url: 'data:b' } }] }];
    var out = degradeVisionMessages(msgs, ['[attachment att-1: X]', '[attachment att-2: Y]']);
    expect(out[0].content).toBe('deux\n\n[attachment att-1: X]\n[attachment att-2: Y]');
  });
  it('sans descripteurs fournis → collapse en texte seul (filet, pas de crash)', function() {
    var msgs = [{ role: 'user', content: [{ type: 'text', text: 'analyse' }, { type: 'image_url', image_url: { url: 'data:x' } }] }];
    var out = degradeVisionMessages(msgs);
    expect(out[0].content).toBe('analyse');
  });
  it('messages sans content-parts inchangés (descripteurs jamais collés sur un message string)', function() {
    var msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'q' }];
    var out = degradeVisionMessages(msgs, ['[attachment att-1: X]']);
    expect(out[0].content).toBe('sys');
    expect(out[1].content).toBe('q');
  });
  it('ne mute pas le tableau reçu', function() {
    var original = [{ role: 'user', content: [{ type: 'text', text: 'a' }] }];
    degradeVisionMessages(original, ['d']);
    expect(Array.isArray(original[0].content)).toBeTruthy();
  });
});

describe('injectVisionDegradedNote', function() {
  it('insère la note DANS le bloc <miaou_context> existant du dernier message user', function() {
    var msgs = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '<miaou_context>\nDate : x\n</miaou_context>\n\n---\n\ntexte user' },
    ];
    var out = injectVisionDegradedNote(msgs);
    var c = out[1].content;
    expect(c.indexOf('</miaou_context>') > c.indexOf(VISION_DEGRADED_NOTE)).toBeTruthy();
    expect(c.indexOf('texte user') >= 0).toBeTruthy();
  });
  it('pas de <miaou_context> → préfixe simple, ne touche pas le system message', function() {
    var msgs = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'texte user' }];
    var out = injectVisionDegradedNote(msgs);
    expect(out[0].content).toBe('sys');   // system message intact (piège 16)
    expect(out[1].content.indexOf(VISION_DEGRADED_NOTE)).toBe(0);
    expect(out[1].content.indexOf('texte user') >= 0).toBeTruthy();
  });
  it('cible le DERNIER message user (pas le premier)', function() {
    var msgs = [
      { role: 'user', content: 'premier' },
      { role: 'assistant', content: 'réponse' },
      { role: 'user', content: 'second' },
    ];
    var out = injectVisionDegradedNote(msgs);
    expect(out[0].content).toBe('premier');   // inchangé
    expect(out[2].content.indexOf('second') >= 0).toBeTruthy();
    expect(out[2].content.indexOf(VISION_DEGRADED_NOTE) >= 0).toBeTruthy();
  });
  it('aucun message user → renvoie le tableau inchangé', function() {
    var msgs = [{ role: 'system', content: 'sys' }];
    expect(injectVisionDegradedNote(msgs)).toEqual(msgs);
  });
});

describe('FILE_DESCRIPTION_PROMPT (D7, lot Cbis) — distinct de SUMMARY_PROMPT, no-volatile', function() {
  it('distinct de SUMMARY_PROMPT (pas le même prompt réutilisé)', function() {
    expect(FILE_DESCRIPTION_PROMPT === SUMMARY_PROMPT).toBeFalsy();
  });
  it('prescrit un cap de deux phrases', function() {
    expect(FILE_DESCRIPTION_PROMPT.indexOf('DEUX phrases') >= 0).toBeTruthy();
  });
  it('interdit les expressions temporelles relatives (no-volatile, KV cache manifeste)', function() {
    expect(FILE_DESCRIPTION_PROMPT.indexOf('temps relatif') >= 0).toBeTruthy();
  });
  it('décrit ce que le fichier EST, pas un résumé de son contenu', function() {
    expect(FILE_DESCRIPTION_PROMPT.indexOf('PAS un résumé') >= 0).toBeTruthy();
  });
});
