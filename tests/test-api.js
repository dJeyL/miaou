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

describe('serverVerdictOnFailure (un échec accuse-t-il le payload ou le réseau ?)', function() {
  // Le défaut payé le 2026-09-22 : un timeout sur backend lent marquait
  // l'endpoint comme rejetant reasoning_effort, ce qui rallumait le
  // raisonnement pour TOUTE la session (appels plus lents, donc d'autres
  // timeouts, et un modèle qui part en prose au lieu de rendre son JSON).
  it('AbortError (timeout du garde-fou) → aucun verdict serveur', function() {
    var e = new Error('aborted');
    e.name = 'AbortError';
    expect(serverVerdictOnFailure(e)).toBe(false);
  });
  it('TypeError (fetch échoué avant toute réponse) → aucun verdict serveur', function() {
    var e = new TypeError('Failed to fetch');
    expect(serverVerdictOnFailure(e)).toBe(false);
  });
  it('refus HTTP du serveur → verdict, le paramètre est bien accusé', function() {
    expect(serverVerdictOnFailure(new Error('silentCompletion 400'))).toBe(true);
  });
  // Revue 2026-09-22 : un 5xx (502/504 d un proxy devant un backend lent) est un
  // incident serveur, pas un refus du payload.
  it('status porte par l erreur : 4xx verdict, 5xx non', function() {
    var e400 = new Error('silentCompletion 400'); e400.status = 400;
    var e422 = new Error('x'); e422.status = 422;
    var e502 = new Error('silentCompletion 502'); e502.status = 502;
    var e504 = new Error('x'); e504.status = 504;
    expect(serverVerdictOnFailure(e400)).toBe(true);
    expect(serverVerdictOnFailure(e422)).toBe(true);
    expect(serverVerdictOnFailure(e502)).toBe(false);
    expect(serverVerdictOnFailure(e504)).toBe(false);
  });
  it('408 et 429 decrivent l etat du serveur, pas le payload', function() {
    expect(httpStatusIsVerdict(408)).toBe(false);
    expect(httpStatusIsVerdict(429)).toBe(false);
    expect(httpStatusIsVerdict(400)).toBe(true);
    expect(httpStatusIsVerdict(500)).toBe(false);
    expect(httpStatusIsVerdict(200)).toBe(false);
  });
  // Conservateur par défaut : on ne retire que les cas dont on est SÛR qu'ils
  // ne disent rien du payload. Une forme inconnue reste traitée comme un rejet,
  // exactement comme avant le correctif.
  it('erreur de forme inconnue → traitée comme un rejet (conservateur)', function() {
    expect(serverVerdictOnFailure(new Error('boom'))).toBe(true);
    expect(serverVerdictOnFailure(null)).toBe(true);
  });
});

describe('formatErrorDetail (détail lisible d\'une réponse HTTP en échec)', function() {
  it('body vide → chaîne vide (« HTTP <code> » reste seul)', function() {
    expect(formatErrorDetail('')).toBe('');
    expect(formatErrorDetail(null)).toBe('');
    expect(formatErrorDetail('   ')).toBe('');
  });
  it('forme { message } (ex. vLLM) → préfixe « : » + message', function() {
    var body = '{"object":"error","message":"Assistant message must have either content or tool_calls, but not none.","type":"invalid_request_assistant_message","code":"3240"}';
    expect(formatErrorDetail(body)).toBe(' : Assistant message must have either content or tool_calls, but not none.');
  });
  it('forme OpenAI { error: { message } }', function() {
    var body = '{"error":{"message":"Invalid API key","type":"auth_error"}}';
    expect(formatErrorDetail(body)).toBe(' : Invalid API key');
  });
  it('forme { error: "…" } (error string)', function() {
    expect(formatErrorDetail('{"error":"model not found"}')).toBe(' : model not found');
  });
  it('forme tableau Gemini/Google [{ error: { message } }] → message déballé', function() {
    var body = '[{"error":{"code":429,"message":"You exceeded your current quota.","status":"RESOURCE_EXHAUSTED"}}]';
    expect(formatErrorDetail(body)).toBe(' : You exceeded your current quota.');
  });
  it('tableau vide → texte brut du body (pas de throw)', function() {
    expect(formatErrorDetail('[]')).toBe(' : []');
  });
  it('JSON illisible → texte brut conservé, préfixé', function() {
    expect(formatErrorDetail('{oops not json')).toBe(' : {oops not json');
  });
  it('texte brut non-JSON (ex. proxy HTML) → tel quel, préfixé', function() {
    expect(formatErrorDetail('Bad Gateway')).toBe(' : Bad Gateway');
  });
  it('JSON sans champ de message reconnu → texte brut du body', function() {
    expect(formatErrorDetail('{"foo":1}')).toBe(' : {"foo":1}');
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
  it('extrait une part thinking du tableau content (vLLM/Mistral)', function() {
    expect(reasoningDelta({ content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'hmm' }] },
    ] })).toBe('hmm');
  });
  it('concatène plusieurs segments de texte d\'une même part thinking', function() {
    expect(reasoningDelta({ content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
    ] })).toBe('ab');
  });
  it('ignore les parts de texte quand il cherche le raisonnement', function() {
    expect(reasoningDelta({ content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'r' }] },
      { type: 'text', text: 'réponse' },
    ] })).toBe('r');
  });
  it('renvoie null sur un tableau content sans aucune part thinking', function() {
    expect(reasoningDelta({ content: [{ type: 'text', text: 'salut' }] })).toBe(null);
  });
  it('part thinking sans texte exploitable → présence (chaîne vide), pas null', function() {
    expect(reasoningDelta({ content: [{ type: 'thinking', thinking: [] }] })).toBe('');
  });
  it('champ thinking string (Ollama) et part thinking (vLLM) ne se confondent pas', function() {
    // delta.thinking = string → branche champ dédié ; part.thinking = tableau
    // imbriqué → branche parts. Le champ dédié prime quand les deux existent.
    expect(reasoningDelta({ thinking: 'ollama', content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'vllm' }] },
    ] })).toBe('ollama');
  });
});

describe('contentDelta (normalisation du texte de réponse)', function() {
  it('renvoie la chaîne telle quelle (OpenAI/Ollama)', function() {
    expect(contentDelta({ content: 'salut' })).toBe('salut');
  });
  it('concatène les parts de texte d\'un tableau (vLLM/Mistral)', function() {
    expect(contentDelta({ content: [
      { type: 'text', text: 'Voici ' },
      { type: 'text', text: 'la réponse.' },
    ] })).toBe('Voici la réponse.');
  });
  it('exclut les parts thinking du texte de réponse', function() {
    expect(contentDelta({ content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'raisonnement' }] },
      { type: 'text', text: 'réponse' },
    ] })).toBe('réponse');
  });
  it('accepte une part sans type explicite comme du texte', function() {
    expect(contentDelta({ content: [{ text: 'nu' }] })).toBe('nu');
  });
  it('renvoie une chaîne vide quand il n\'y a pas de contenu', function() {
    expect(contentDelta({})).toBe('');
    expect(contentDelta(null)).toBe('');
    expect(contentDelta({ content: [] })).toBe('');
  });
  it('ne renvoie jamais [object Object] sur un tableau de parts', function() {
    // Symptôme d'origine : concaténation directe de delta.content en tableau.
    const out = contentDelta({ content: [
      { type: 'thinking', thinking: [{ type: 'text', text: 'r' }] },
    ] });
    expect(out.indexOf('[object Object]')).toBe(-1);
  });
});

describe('normalizeTitle (nettoyage du titre généré)', function() {
  it('laisse intact un titre déjà propre', function() {
    expect(normalizeTitle('Migration vers PostgreSQL')).toBe('Migration vers PostgreSQL');
  });
  it('retire le gras Markdown (symptôme devstral)', function() {
    expect(normalizeTitle('**Sujet principal**')).toBe('Sujet principal');
  });
  it('retire italique, code et barré', function() {
    expect(normalizeTitle('_Sujet_')).toBe('Sujet');
    expect(normalizeTitle('`Sujet`')).toBe('Sujet');
    expect(normalizeTitle('~~Sujet~~')).toBe('Sujet');
  });
  it('retire les guillemets même sous du gras', function() {
    // Ordre des passes : le formatage part avant le rognage des guillemets.
    expect(normalizeTitle('**"Sujet"**')).toBe('Sujet');
  });
  it('retire un préfixe de titre Markdown', function() {
    expect(normalizeTitle('## Sujet du jour')).toBe('Sujet du jour');
  });
  it('retire une puce de liste, y compris en astérisque', function() {
    expect(normalizeTitle('- Sujet')).toBe('Sujet');
    expect(normalizeTitle('* Sujet')).toBe('Sujet');
  });
  it('ne touche JAMAIS à la casse : la majuscule relève du prompt seul', function() {
    // Une graphie intentionnelle en minuscules (npm, nginx) n'est pas
    // distinguable d'un mot ordinaire par la forme du mot : on ne capitalise
    // rien plutôt que d'écrire "Npm".
    expect(normalizeTitle('npm et Node')).toBe('npm et Node');
    expect(normalizeTitle('nginx en production')).toBe('nginx en production');
    expect(normalizeTitle('vLLM et le streaming')).toBe('vLLM et le streaming');
    expect(normalizeTitle('iPhone en entreprise')).toBe('iPhone en entreprise');
    expect(normalizeTitle('migration vers postgres')).toBe('migration vers postgres');
  });
  it('retire le formatage sans capitaliser pour autant', function() {
    expect(normalizeTitle('**npm et Node**')).toBe('npm et Node');
  });
  it('conserve les accents intacts', function() {
    expect(normalizeTitle('Études de cas')).toBe('Études de cas');
  });
  it('retire la ponctuation finale et les guillemets', function() {
    expect(normalizeTitle('"Sujet du jour."')).toBe('Sujet du jour');
  });
  it('borne la longueur à 60 caractères', function() {
    expect(normalizeTitle('a'.repeat(80)).length).toBe(60);
  });
  it('tolère une entrée vide ou nulle', function() {
    expect(normalizeTitle('')).toBe('');
    expect(normalizeTitle(null)).toBe('');
  });
});

describe('exportConvFilename (nom de fichier d\'export, MD et HTML)', function() {
  const now = new Date(2026, 7, 21).getTime();
  it('produit miaou-<slug>-<date>.<ext>', function() {
    expect(exportConvFilename('Migration PostgreSQL', now, 'md'))
      .toBe('miaou-migration-postgresql-2026-08-21.md');
  });
  it('donne le MÊME gabarit pour les deux extensions', function() {
    const md = exportConvFilename('Sujet', now, 'md');
    const html = exportConvFilename('Sujet', now, 'html');
    expect(md.slice(0, -2)).toBe(html.slice(0, -4));
  });
  it('translittère les accents via slugTitle', function() {
    expect(exportConvFilename('Café et thé', now, 'md'))
      .toBe('miaou-cafe-et-the-2026-08-21.md');
  });
  it('retombe sur le slug par défaut si le titre est vide', function() {
    expect(exportConvFilename('', now, 'html'))
      .toBe('miaou-miaou-conversation-2026-08-21.html');
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

describe('silentCompletion : choix du modèle (lot V-9, retour utilisateur)', function() {
  // La fonction est async et fait du réseau : on ne teste ici que la RÉSOLUTION
  // du modèle, extraite telle quelle de son corps (`(o.model && o.model.trim()) || cfg.model`).
  // Le câblage réel (describeFileIfNeeded passe activeModel()) relève du runtime.
  var resolve = function(oModel, cfgModel) { return (oModel && oModel.trim()) || cfgModel; };

  it('o.model fourni → il prime sur le modèle du serveur (la pilule fait foi)', function() {
    expect(resolve('qwen-vl', 'mistral-small')).toBe('qwen-vl');
  });
  it('o.model absent → modèle du serveur (titrage, résumé : comportement inchangé)', function() {
    expect(resolve(undefined, 'mistral-small')).toBe('mistral-small');
  });
  it('o.model vide ou blanc → modèle du serveur, jamais une chaîne vide envoyée au backend', function() {
    expect(resolve('', 'mistral-small')).toBe('mistral-small');
    expect(resolve('   ', 'mistral-small')).toBe('mistral-small');
  });
});

describe('shouldDegradeVision / applyVisionDegradation / claimVisionRetry (lot V-9) — prédicat et geste uniques', function() {
  var withImage = function() {
    return [{ role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'décris' }, { type: 'image_url', image_url: { url: 'data:x' } }] }];
  };

  it('pas de part image → jamais de dégradation, même sur un modèle marqué sans vision', function() {
    var msgs = [{ role: 'user', content: 'texte seul' }];
    expect(shouldDegradeVision(msgs, 'http://w1/v1', 'm', true)).toBeFalsy();
  });
  it('parts image + modèle non marqué et vision activée → pas de dégradation (on tente)', function() {
    expect(shouldDegradeVision(withImage(), 'http://w2/v1', 'm', false)).toBeFalsy();
  });
  it('parts image + visionDisabled manuel → dégradation proactive', function() {
    expect(shouldDegradeVision(withImage(), 'http://w3/v1', 'm', true)).toBeTruthy();
  });
  it('parts image + rejet déjà essuyé cette session → dégradation proactive', function() {
    markVisionRejected('http://w4/v1', 'm');
    expect(shouldDegradeVision(withImage(), 'http://w4/v1', 'm', false)).toBeTruthy();
  });

  it('applyVisionDegradation : remplace les parts image ET pose la note (le geste complet, pas la moitié)', function() {
    var out = applyVisionDegradation(withImage(), ['[image : rendu de page]']);
    expect(typeof out[1].content).toBe('string');
    expect(out[1].content.indexOf('data:x') < 0).toBeTruthy();
    expect(out[1].content.indexOf('[image : rendu de page]') >= 0).toBeTruthy();
    expect(out[1].content.indexOf(VISION_DEGRADED_NOTE) >= 0).toBeTruthy();
    expect(out[0].content).toBe('sys');   // system message intact (piège 16)
  });

  it('claimVisionRetry : premier échec avec images → réclame le rejeu et marque le couple', function() {
    expect(isVisionRejected('http://w5/v1', 'm')).toBeFalsy();
    expect(claimVisionRetry(withImage(), 'http://w5/v1', 'm')).toBeTruthy();
    expect(isVisionRejected('http://w5/v1', 'm')).toBeTruthy();
  });
  it('claimVisionRetry : deuxième échec sur le même couple → refuse (pas de boucle infinie)', function() {
    claimVisionRetry(withImage(), 'http://w6/v1', 'm');
    expect(claimVisionRetry(withImage(), 'http://w6/v1', 'm')).toBeFalsy();
  });
  it('claimVisionRetry : échec sans images → ne réclame rien et ne marque RIEN (un 400 non-vision ne doit pas rendre un modèle aveugle)', function() {
    var msgs = [{ role: 'user', content: 'texte seul' }];
    expect(claimVisionRetry(msgs, 'http://w7/v1', 'm')).toBeFalsy();
    expect(isVisionRejected('http://w7/v1', 'm')).toBeFalsy();
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

describe('activeChatTemperature / setChatTemperature (override console, lot température)', function() {
  it('sans override → défaut du build (0.7 hors config.json)', function() {
    setChatTemperature(null);
    expect(activeChatTemperature()).toBe(0.7);
  });
  it('override numérique → valeur posée', function() {
    setChatTemperature(0.2);
    expect(activeChatTemperature()).toBe(0.2);
    setChatTemperature(null);
  });
  it('0 est une valeur valide (greedy), pas un reset', function() {
    setChatTemperature(0);
    expect(activeChatTemperature()).toBe(0);
    setChatTemperature(null);
  });
  it('null remet le défaut du build', function() {
    setChatTemperature(0.2);
    setChatTemperature(null);
    expect(activeChatTemperature()).toBe(0.7);
  });
  it('hors bornes → ignoré, valeur précédente conservée', function() {
    setChatTemperature(0.2);
    setChatTemperature(5);
    expect(activeChatTemperature()).toBe(0.2);
    setChatTemperature(-1);
    expect(activeChatTemperature()).toBe(0.2);
    setChatTemperature(null);
  });
  it('NaN → ignoré (le !(t >= 0 && t <= 2) le rejette)', function() {
    setChatTemperature(0.2);
    setChatTemperature(NaN);
    expect(activeChatTemperature()).toBe(0.2);
    setChatTemperature(null);
  });
  it('chaîne numérique → ignorée (typeof strict)', function() {
    setChatTemperature(0.2);
    setChatTemperature('0.9');
    expect(activeChatTemperature()).toBe(0.2);
    setChatTemperature(null);
  });
});

describe('TITLE_PROMPT à texte CONSTANT après extraction de TITLE_RULES (lot AA)', function() {
  it('reste byte-identique au littéral historique', function() {
    // Le SEUL cas du dépôt où recopier un littéral dans un test est correct :
    // ce test EST l'oracle qui atteste que le rangement (extraction de la
    // racine commune TITLE_RULES, partagée avec EARLY_TITLE_PROMPT) n'a rien
    // changé au prompt affûté. Sans lui, on aurait modifié le comportement du
    // titrage en croyant seulement réorganiser du code — l'espace en tête de
    // TITLE_RULES suffirait à faire diverger la chaîne sans que rien n'échoue.
    var HISTORIQUE =
      "Génère un titre court (3 à 6 mots) résumant le sujet principal de la " +
      "conversation. Pas de ponctuation finale, pas de guillemets, pas de préfixe. " +
      "Commence par une majuscule, SAUF si le premier mot est un nom propre dont la " +
      "graphie officielle commence par une minuscule (npm, nginx, vLLM, iPhone, " +
      "macOS) : dans ce cas respecte scrupuleusement sa casse d'origine. " +
      "Aucun formatage : pas d'astérisques, pas de gras, pas d'italique, pas de " +
      "Markdown, pas de balises. Du texte brut uniquement. " +
      "Réponds uniquement par le titre.";
    expect(TITLE_PROMPT).toBe(HISTORIQUE);
  });
  it('EARLY_TITLE_PROMPT partage la MÊME racine de règles, sans la recopier', function() {
    // Ce qui garantit que les deux prompts ne divergeront pas au premier
    // ajustement de forme : une liste de contraintes en prose n'annonce pas son
    // propre compte, aucun grep de compteur ne verrait la dérive.
    expect(EARLY_TITLE_PROMPT).toContain(TITLE_RULES);
    expect(TITLE_PROMPT).toContain(TITLE_RULES);
  });
  it('EARLY_TITLE_PROMPT dit explicitement que l\'assistant n\'a pas répondu', function() {
    // La raison d'être du prompt dédié : donné TITLE_PROMPT, le modèle
    // chercherait à résumer « la conversation » dont il ne voit qu'une moitié.
    expect(EARLY_TITLE_PROMPT).toContain('pas encore répondu');
  });
  it('EARLY_TITLE_PROMPT demande de RETENIR le spécifique, jamais de résumer (AA-2)', function() {
    // Retour d'usage : « résumant le sujet » faisait monter en généralité — un
    // seul message porte moins de matière qu'un échange, et résumer produit la
    // catégorie de la demande au lieu de son objet. Le verbe est l'invariant :
    // le remettre à « résume » rouvrirait exactement le défaut corrigé.
    expect(EARLY_TITLE_PROMPT).toContain('les termes les plus spécifiques');
    expect(EARLY_TITLE_PROMPT).toContain('monter en généralité');
  });
});

// ── Boucle d'outils : invariant de payload (runConversation) ─────────────────
// PORTÉE DE CES TESTS, à lire avant d'en ajouter. `streamCompletion` et
// `callTool` sont STUBÉS : ce qui est couvert ici, c'est la boucle et ce
// qu'elle laisse dans `messages` — rien du streaming SSE, du routage d'outil
// ni du transport. Un `describe` qui laisserait croire à une couverture d'api.js
// entière serait une fixture partielle, pas une garantie.
//
// Ce qui rend le montage possible : `messages` est muté EN PLACE, donc
// l'appelant garde la référence et peut l'inspecter après coup — exactement ce
// que font les trois appelants de production. Et les deux frontières sont des
// déclarations `function`, donc des globals réassignables dans le realm partagé
// (la contrainte « tout est global » du projet joue ici en faveur du test).
//
// `runAsync` est OBLIGATOIRE sur tout appel : sans lui, la promesse reste
// pending et le test passerait au vert sans rien exécuter (cf. son commentaire
// dans runner.py).
describe('runConversation — invariant « tout tool_call a son résultat »', function() {
  var _savedStream, _savedCallTool;

  // Pas de `gen` : l'appel hors génération est un cas NOMINAL (drawer d'outils,
  // tests), et `toolExecContext` y vaut `undefined` par construction — le repli
  // sur l'écran est fait par `toolCtx`. Ce montage a révélé qu'un site le
  // déréférençait à la main ; le garder sans `gen` pin la correction.

  function stubTurns(toolCalls, toolImpl) {
    _savedStream = streamCompletion;
    _savedCallTool = callTool;
    var turn = 0;
    streamCompletion = function() {
      turn++;
      if (turn === 1) {
        return Promise.resolve({ content: '', toolCalls: toolCalls,
          finishReason: 'tool_calls', usage: null, reasoning: '' });
      }
      return Promise.resolve({ content: 'fini', toolCalls: [],
        finishReason: 'stop', usage: null, reasoning: '' });
    };
    callTool = toolImpl;
  }

  function restore() {
    streamCompletion = _savedStream;
    callTool = _savedCallTool;
  }

  function tc(id, name) {
    return { id: id, type: 'function', function: { name: name, arguments: '{}' } };
  }

  function rolesOf(msgs) {
    return msgs.map(function(m) { return m.role; }).join(',');
  }

  it('un handler qui lève ne laisse aucun tool_call sans résultat', function() {
    stubTurns([tc('call_ok', 'miaou__a'), tc('call_bad', 'miaou__b')],
      function(name) {
        if (name === 'miaou__b') return Promise.reject(new Error('boom'));
        return Promise.resolve('res-a');
      });
    try {
      var msgs = [{ role: 'user', content: 'go' }];
      // L'exception du handler remonte et sort de runConversation, comme en
      // production : c'est CE chemin qui laissait un assistant bancal derrière
      // lui. On vérifie l'état du tableau APRÈS la sortie en erreur.
      var err = runAsyncReject(runConversation(msgs, {}));
      expect(err.message).toContain('boom');
      expect(unservedToolCallIds(msgs).length).toBe(0);
      // Aucun appel n'a été servi : ni assistant, ni tool. Un assistant à
      // `tool_calls: []` serait rejeté à son tour (piège 27).
      expect(rolesOf(msgs)).toBe('user');
    } finally {
      restore();
    }
  });

  it('un tour nominal à deux outils émet l\'assistant puis les deux résultats', function() {
    stubTurns([tc('c1', 'miaou__a'), tc('c2', 'miaou__b')],
      function() { return Promise.resolve('ok'); });
    try {
      var msgs = [{ role: 'user', content: 'go' }];
      runAsync(runConversation(msgs, {}));
      expect(unservedToolCallIds(msgs).length).toBe(0);
      // L'ORDRE est le contrat : assistant porteur des appels, puis leurs
      // résultats. Différer le push de l'assistant ne doit pas le déplacer.
      expect(rolesOf(msgs)).toBe('user,assistant,tool,tool');
      expect(msgs[1].tool_calls.length).toBe(2);
      expect(msgs[2].tool_call_id).toBe('c1');
      expect(msgs[3].tool_call_id).toBe('c2');
    } finally {
      restore();
    }
  });

  it('un échec sur le PREMIER de deux outils n\'émet rien du tour', function() {
    // Variante de position : le défaut d'origine se voyait sur le second appel,
    // mais rien ne garantit que l'échec arrive en fin de liste. Sans ce cas, un
    // correctif qui ne traiterait que « le dernier » passerait pour bon.
    stubTurns([tc('c1', 'miaou__a'), tc('c2', 'miaou__b')],
      function(name) {
        if (name === 'miaou__a') return Promise.reject(new Error('boom-first'));
        return Promise.resolve('ok');
      });
    try {
      var msgs = [{ role: 'user', content: 'go' }];
      var err = runAsyncReject(runConversation(msgs, {}));
      expect(err.message).toContain('boom-first');
      expect(unservedToolCallIds(msgs).length).toBe(0);
      expect(rolesOf(msgs)).toBe('user');
    } finally {
      restore();
    }
  });

  it('tout tool_call émis porte un id apparié à un message tool', function() {
    // Assertion sur la SORTIE composée plutôt que sur un compte : elle dit
    // LEQUEL manque quand elle tombe, là où un cardinal nu reste muet.
    stubTurns([tc('x1', 'miaou__a'), tc('x2', 'miaou__b'), tc('x3', 'miaou__c')],
      function() { return Promise.resolve('ok'); });
    try {
      var msgs = [{ role: 'user', content: 'go' }];
      runAsync(runConversation(msgs, {}));
      var announced = [];
      var served = [];
      msgs.forEach(function(m) {
        (m.tool_calls || []).forEach(function(t) { announced.push(t.id); });
        if (m.role === 'tool') served.push(m.tool_call_id);
      });
      expect(announced).toEqual(['x1', 'x2', 'x3']);
      expect(served).toEqual(['x1', 'x2', 'x3']);
    } finally {
      restore();
    }
  });
});

// ── Garde du harnais lui-même ───────────────────────────────────────────────
// Sans pompage, une promesse reste pending pour toujours et un test asynchrone
// passerait au vert sans rien exécuter. Ces deux tests vérifient que le helper
// fait bien la différence, donc qu'un faux vert reste impossible.
describe('runAsync (helper de pompage)', function() {
  it('déroule une chaîne d\'await et rend la valeur finale', function() {
    var f = async function() {
      var a = await Promise.resolve(1);
      var b = await Promise.resolve(2);
      return a + b;
    };
    expect(runAsync(f())).toBe(3);
  });

  it('relance le rejet pour qu\'un it le voie comme une exception', function() {
    var f = async function() { await null; throw new Error('nope'); };
    var err = runAsyncReject(f());
    expect(err.message).toBe('nope');
  });

  it('échoue franchement sur une promesse qui ne retombe jamais', function() {
    // Le faux vert que le helper existe pour empêcher.
    var jamais = new Promise(function() {});
    var caught = null;
    try { runAsync(jamais); } catch (e) { caught = e.message; }
    expect(String(caught)).toContain('jamais retombée');
  });

  it('refuse une valeur qui n\'est pas une promesse', function() {
    var caught = null;
    try { runAsync(42); } catch (e) { caught = e.message; }
    expect(String(caught)).toContain('attend une promesse');
  });
});

describe('COMPACTION_PROMPT (recompaction, revue 2026-09-22)', function() {
  it('demande d integrer un resume anterieur, qui cessera d etre transmis', function() {
    // La consigne ne repose pas sur le seul libelle de la projection.
    expect(/r[ée]sum[ée] ant[ée]rieur/.test(COMPACTION_PROMPT)).toBe(true);
  });
});

// ── Propriétés déclarées des modèles (lot AF) ───────────────────────────────
// Fixtures RÉELLES, élaguées aux clés utiles plus un peu de bruit :
// - schéma Mistral servi par vLLM : réponse `/v1/models` relevée par la sonde
//   `backend-capabilities.py` le 2026-09-23 (objet `capabilities` brut recopié) ;
// - Ollama 0.34.2 : `/api/tags` et `/api/show` relevés le 2026-09-23.
// `/api/ps` est reconstruit sur la forme documentée, avec la valeur mesurée le
// 2026-09-22 (32768 servis pour 262144 déclarés) : aucun modèle n'était chargé
// au relevé, et en charger un pour la fixture aurait occupé la VRAM.

var AF_MISTRAL_MODELS = {
  object: 'list',
  data: [
    { id: 'mistral-medium-3-5-0', object: 'model', owned_by: 'mistral', max_context_length: 262144,
      default_model_temperature: 0.7,
      capabilities: { completion_chat: true, stop_tokens: true, function_calling: true, grammar: true,
        fine_tuning: true, vision: true, priority: true, tier: true, multiple_sequences: true,
        custom_grammar: true, reasoning: true } },
    { id: 'mistral-small-2603', object: 'model', owned_by: 'mistral', max_context_length: 262144,
      capabilities: { completion_chat: true, stop_tokens: true, function_calling: true, grammar: true,
        vision: true, priority: true, tier: true, multiple_sequences: true, custom_grammar: true,
        reasoning: true } },
  ],
};

var AF_OLLAMA_TAGS = {
  models: [
    { name: 'ornith-1.5:9b', model: 'ornith-1.5:9b',
      details: { parent_model: '', format: 'gguf', family: 'qwen35', families: ['qwen35'], parameter_size: '9.0B',
        quantization_level: 'Q4_K_M', context_length: 262144, embedding_length: 4096 },
      capabilities: ['completion', 'vision'] },
    { name: 'gemma4:26b-nvfp4', model: 'gemma4:26b-nvfp4',
      details: { parent_model: '', format: 'safetensors', family: '', families: null, parameter_size: '',
        quantization_level: 'nvfp4' },
      capabilities: ['completion', 'vision', 'tools', 'thinking'] },
    { name: 'ornith-1.5-txt:9b-nvfp4', model: 'ornith-1.5-txt:9b-nvfp4',
      details: { parent_model: '', format: 'safetensors', family: '', families: null, parameter_size: '',
        quantization_level: '' },
      capabilities: ['completion', 'tools', 'thinking'] },
  ],
};

var AF_OLLAMA_SHOW_GGUF = {
  capabilities: ['tools', 'thinking', 'completion', 'vision'],
  model_info: { 'general.architecture': 'qwen35', 'qwen35.block_count': 32,
    'qwen35.context_length': 262144, 'qwen35.embedding_length': 4096 },
  details: { format: 'gguf', family: 'qwen35' },
};

var AF_OLLAMA_SHOW_SAFETENSORS = {
  capabilities: ['completion', 'vision', 'tools', 'thinking'],
  model_info: { 'gemma4.block_count': 30, 'gemma4.context_length': 262144,
    'gemma4.embedding_length': 2816, 'general.architecture': 'gemma4' },
  parameters: 'temperature                    1\ntop_k                          64\ntop_p                          0.95',
};

var AF_OLLAMA_PS = {
  models: [
    { name: 'ornith-1.5-txt:9b', model: 'ornith-1.5-txt:9b', size: 7000000000, size_vram: 7000000000,
      expires_at: '2026-09-22T21:00:00Z', context_length: 32768 },
  ],
};

describe('normalizeModelCaps (tri-état, forme reconnue seulement)', function() {
  it('objet Mistral : alias function_calling → tools, reasoning → thinking', function() {
    expect(normalizeModelCaps(AF_MISTRAL_MODELS.data[0].capabilities, false))
      .toEqual({ vision: true, tools: true, thinking: true });
  });
  it('objet reconnu : une clé à false, ou absente, vaut false', function() {
    expect(normalizeModelCaps({ completion_chat: true, vision: false }, false))
      .toEqual({ vision: false, tools: false, thinking: false });
  });
  it('liste Ollama autoritative : absence = false', function() {
    expect(normalizeModelCaps(['completion', 'tools', 'thinking'], false))
      .toEqual({ vision: false, tools: true, thinking: true });
  });
  it('positiveOnly (/api/tags) : absence = inconnu, présence = true', function() {
    expect(normalizeModelCaps(['completion', 'vision'], true))
      .toEqual({ vision: true, tools: null, thinking: null });
  });
  it('un modèle d\'embedding reconnu est bien sans vision', function() {
    expect(normalizeModelCaps(['embedding'], false))
      .toEqual({ vision: false, tools: false, thinking: false });
  });
  it('aucun nom connu → inconnu partout, jamais false', function() {
    expect(normalizeModelCaps({ image_input: true, tool_use: true }, false))
      .toEqual({ vision: null, tools: null, thinking: null });
    expect(normalizeModelCaps([], false))
      .toEqual({ vision: null, tools: null, thinking: null });
  });
  it('forme absente ou exotique → inconnu', function() {
    expect(normalizeModelCaps(undefined, false)).toEqual({ vision: null, tools: null, thinking: null });
    expect(normalizeModelCaps('vision', false)).toEqual({ vision: null, tools: null, thinking: null });
  });
  it('insensible à la casse', function() {
    expect(normalizeModelCaps(['Completion', 'VISION'], false).vision).toBe(true);
  });
});

describe('extractModelContextMax', function() {
  it('clé à plat du schéma Mistral', function() {
    expect(extractModelContextMax(AF_MISTRAL_MODELS.data[0])).toEqual({ value: 262144, key: 'max_context_length' });
  });
  it('vLLM nu : max_model_len', function() {
    expect(extractModelContextMax({ id: 'x', max_model_len: 32768 })).toEqual({ value: 32768, key: 'max_model_len' });
  });
  it('model_info d\'Ollama : clé préfixée par l\'architecture', function() {
    expect(extractModelContextMax(AF_OLLAMA_SHOW_GGUF.model_info)).toEqual({ value: 262144, key: 'qwen35.context_length' });
  });
  it('l\'architecture déclarée l\'emporte sur une autre clé suffixée (synthétique)', function() {
    var mi = { 'clip.vision.context_length': 1024, 'general.architecture': 'qwen35', 'qwen35.context_length': 262144 };
    expect(extractModelContextMax(mi)).toEqual({ value: 262144, key: 'qwen35.context_length' });
  });
  it('sans general.architecture : repli sur le suffixe', function() {
    expect(extractModelContextMax({ 'gemma4.context_length': 131072 })).toEqual({ value: 131072, key: 'gemma4.context_length' });
  });
  it('details safetensors sans fenêtre → null', function() {
    expect(extractModelContextMax(AF_OLLAMA_TAGS.models[1].details)).toBe(null);
  });
  it('valeurs non entières ou nulles ignorées', function() {
    expect(extractModelContextMax({ max_context_length: '262144' })).toBe(null);
    expect(extractModelContextMax({ context_length: 0 })).toBe(null);
    expect(extractModelContextMax(null)).toBe(null);
  });
});

describe('modelPropsFromOpenAIModels (schéma Mistral réel)', function() {
  it('fenêtre, source et capacités pour chaque modèle listé', function() {
    var p = modelPropsFromOpenAIModels(AF_MISTRAL_MODELS);
    expect(Object.keys(p).sort()).toEqual(['mistral-medium-3-5-0', 'mistral-small-2603']);
    expect(p['mistral-medium-3-5-0']).toEqual({
      contextMax: 262144, contextSource: 'models:max_context_length', contextConfigured: null, served: null,
      caps: { vision: true, tools: true, thinking: true },
    });
  });
  it('vLLM nu : fenêtre connue, capacités inconnues', function() {
    var p = modelPropsFromOpenAIModels({ data: [{ id: 'm', object: 'model', max_model_len: 32768 }] });
    expect(p.m.contextMax).toBe(32768);
    expect(p.m.caps).toEqual({ vision: null, tools: null, thinking: null });
  });
  it('/v1/models d\'Ollama (id seul) : tout inconnu', function() {
    var p = modelPropsFromOpenAIModels({ object: 'list', data: [{ id: 'gemma4:26b-nvfp4', object: 'model', owned_by: 'library' }] });
    expect(p['gemma4:26b-nvfp4']).toEqual({ contextMax: null, contextSource: null, contextConfigured: null, served: null,
      caps: { vision: null, tools: null, thinking: null } });
  });
  it('réponse illisible → objet vide', function() {
    expect(modelPropsFromOpenAIModels(null)).toEqual({});
    expect(modelPropsFromOpenAIModels({ data: 'x' })).toEqual({});
  });
});

describe('modelPropsFromOllamaTags / Show (Ollama réel)', function() {
  it('/api/tags : GGUF sous-déclaré → tools/thinking inconnus, fenêtre lue dans details', function() {
    var p = modelPropsFromOllamaTags(AF_OLLAMA_TAGS)['ornith-1.5:9b'];
    expect(p.caps).toEqual({ vision: true, tools: null, thinking: null });
    expect(p.contextMax).toBe(262144);
    expect(p.contextSource).toBe('tags:context_length');
  });
  it('/api/tags : safetensors sans fenêtre, sans vision → vision inconnue et non false', function() {
    var p = modelPropsFromOllamaTags(AF_OLLAMA_TAGS)['ornith-1.5-txt:9b-nvfp4'];
    expect(p.contextMax).toBe(null);
    expect(p.caps).toEqual({ vision: null, tools: true, thinking: true });
  });
  it('/api/show GGUF : capacités complètes et fenêtre préfixée', function() {
    expect(modelPropsFromOllamaShow(AF_OLLAMA_SHOW_GGUF)).toEqual({
      contextMax: 262144, contextSource: 'show:qwen35.context_length', contextConfigured: null, served: null,
      caps: { vision: true, tools: true, thinking: true },
    });
  });
  it('/api/show safetensors : parameters sans num_ctx → pas de fenêtre configurée', function() {
    var p = modelPropsFromOllamaShow(AF_OLLAMA_SHOW_SAFETENSORS);
    expect(p.contextMax).toBe(262144);
    expect(p.contextConfigured).toBe(null);
  });
  it('/api/show : num_ctx du Modelfile → contextConfigured', function() {
    var show = { capabilities: ['completion'], model_info: { 'general.architecture': 'llama', 'llama.context_length': 131072 },
      parameters: 'num_ctx                        16384\ntemperature                    0.7' };
    expect(modelPropsFromOllamaShow(show).contextConfigured).toBe(16384);
  });
  it('/api/show illisible → record inconnu, jamais une exception', function() {
    expect(modelPropsFromOllamaShow(null)).toEqual({ contextMax: null, contextSource: null, contextConfigured: null, served: null,
      caps: { vision: null, tools: null, thinking: null } });
  });
});

describe('chemin natif Ollama : racine et appariement des noms (AF-1)', function() {
  it('racine dérivée en retirant /v1, slash final toléré', function() {
    expect(ollamaNativeRoot('https://trinity.home.djeyl.net:11435/v1')).toBe('https://trinity.home.djeyl.net:11435');
    expect(ollamaNativeRoot('http://h:11434/v1/')).toBe('http://h:11434');
  });
  it('URL sans /v1 final → pas de racine devinée', function() {
    expect(ollamaNativeRoot('https://h/api')).toBe(null);
    expect(ollamaNativeRoot('https://h/v1beta')).toBe(null);
    expect(ollamaNativeRoot('')).toBe(null);
  });
  it('forme complète : :latest ajouté seulement sans étiquette, cherchée après le dernier /', function() {
    expect(ollamaFullModelName('llama3')).toBe('llama3:latest');
    expect(ollamaFullModelName('ornith-1.5:9b')).toBe('ornith-1.5:9b');
    expect(ollamaFullModelName('hf.co/org/repo:Q4_K_M')).toBe('hf.co/org/repo:Q4_K_M');
    expect(ollamaFullModelName('registry:5000/org/model')).toBe('registry:5000/org/model:latest');
    expect(ollamaFullModelName('')).toBe('');
  });
  it('réponse /api/tags reconnue, liste vide comprise ; le reste ne l\'est pas', function() {
    expect(isOllamaTagsResponse(AF_OLLAMA_TAGS)).toBe(true);
    expect(isOllamaTagsResponse({ models: [] })).toBe(true);
    expect(isOllamaTagsResponse({ data: [] })).toBe(false);
    expect(isOllamaTagsResponse({ error: { message: '404' } })).toBe(false);
    expect(isOllamaTagsResponse(null)).toBe(false);
  });
  it('noms natifs rattachés aux ids listés sur la forme complète, dans les deux sens', function() {
    var out = alignOllamaNames(['llama3:latest', 'qwen:7b', 'mistral'],
      { 'llama3': 1, 'qwen:7b': 2, 'mistral:latest': 3, 'absent:1b': 4 });
    expect(out).toEqual({ 'llama3:latest': 1, 'qwen:7b': 2, 'mistral': 3 });
  });
  it('/api/ps aligné → records servis datés, rien d\'autre de connu', function() {
    var served = alignOllamaNames(['ornith-1.5-txt:9b'], servedContextsFromOllamaPs(AF_OLLAMA_PS));
    var r = servedRecords(served, 1000)['ornith-1.5-txt:9b'];
    expect(r.served).toEqual({ value: 32768, at: 1000 });
    expect(r.contextMax).toBe(null);
    expect(r.caps).toEqual({ vision: null, tools: null, thinking: null });
  });
});

describe('servedContextsFromOllamaPs', function() {
  it('fenêtre servie par modèle chargé', function() {
    expect(servedContextsFromOllamaPs(AF_OLLAMA_PS)).toEqual({ 'ornith-1.5-txt:9b': 32768 });
  });
  it('aucun modèle chaud → objet vide', function() {
    expect(servedContextsFromOllamaPs({ models: [] })).toEqual({});
    expect(servedContextsFromOllamaPs(null)).toEqual({});
  });
});

describe('mergeModelProps', function() {
  it('/api/show complète /api/tags : l\'inconnu est comblé, le connu confirmé', function() {
    var tags = modelPropsFromOllamaTags(AF_OLLAMA_TAGS)['ornith-1.5:9b'];
    var show = modelPropsFromOllamaShow(AF_OLLAMA_SHOW_GGUF);
    var m = mergeModelProps(tags, show);
    expect(m.caps).toEqual({ vision: true, tools: true, thinking: true });
    expect(m.contextSource).toBe('show:qwen35.context_length');
  });
  it('une inconnue de la surcouche n\'efface jamais un connu', function() {
    var base = modelPropsRecord(262144, 'show:qwen35.context_length', { vision: false, tools: true, thinking: true }, 8192);
    var m = mergeModelProps(base, modelPropsRecord());
    expect(m).toEqual(base);
  });
  it('un false déclaré par la surcouche remplace un true de la base', function() {
    var base = modelPropsRecord(null, null, { vision: true, tools: null, thinking: null });
    var over = modelPropsRecord(null, null, { vision: false, tools: true, thinking: false });
    expect(mergeModelProps(base, over).caps).toEqual({ vision: false, tools: true, thinking: false });
  });
});

describe('modelListFromResponse (ids ET props du même appel)', function() {
  it('schéma Mistral : ids triés, props par id', function() {
    var r = modelListFromResponse(AF_MISTRAL_MODELS);
    expect(r.ids).toEqual(['mistral-medium-3-5-0', 'mistral-small-2603']);
    expect(r.props['mistral-small-2603'].caps.vision).toBe(true);
  });
  it('liste de chaînes nues : ids lus comme avant, aucune prop', function() {
    var r = modelListFromResponse({ models: ['b', 'a'] });
    expect(r.ids).toEqual(['a', 'b']);
    expect(r.props).toEqual({});
  });
  it('réponse vide ou illisible : rien, sans exception', function() {
    expect(modelListFromResponse({})).toEqual({ ids: [], props: {} });
    expect(modelListFromResponse(null)).toEqual({ ids: [], props: {} });
  });
});

describe('reasoningEffortBlocked (rejet de session OU déclaré sans raisonnement)', function() {
  it('bloqué pour un modèle du serveur actif déclaré sans raisonnement, pas pour les autres', function() {
    localStorage.removeItem('miaou-model-props');
    saveApiServersRaw([{ id: 'srvR', name: 'r', url: 'https://r/v1', key: '' }]);
    setActiveApiServerId('srvR');
    recordListedModelProps(getApiServer('srvR'), ['noThink', 'think'], {
      noThink: modelPropsRecord(null, null, { vision: null, tools: null, thinking: false }),
      think: modelPropsRecord(null, null, { vision: null, tools: null, thinking: true }),
    });
    expect(reasoningEffortBlocked('https://r/v1', 'noThink')).toBe(true);
    expect(reasoningEffortBlocked('https://r/v1', 'think')).toBe(false);
    expect(reasoningEffortBlocked('https://r/v1', 'inconnu')).toBe(false);
    // Une URL qui n'est pas celle du serveur actif n'emprunte pas sa déclaration.
    expect(reasoningEffortBlocked('https://autre/v1', 'noThink')).toBe(false);
  });
});
