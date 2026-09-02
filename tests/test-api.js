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
