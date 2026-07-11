// tests/test-context.js — brief B (context inspector)

describe('estimateTokens', function() {
  it('arrondit au supérieur', function() {
    expect(estimateTokens('abcde')).toBe(2);   // 5/4 = 1.25 → 2
    expect(estimateTokens('abcd')).toBe(1);    // 4/4 = 1
  });
  it('chaîne vide ou null/undefined → 0', function() {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });
  it('compte les caractères unicode comme des chars JS (pas de normalisation)', function() {
    expect(estimateTokens('café')).toBe(1);   // 4 chars → 1
  });
});

describe('buildContextManifest', function() {
  function baseSysParts() {
    return { root: 'ROOT', toolsSystem: '', intent: '', skills: '', docs: '', user: 'USER PROMPT' };
  }
  function baseDynParts() {
    return { contextDateModel: 'Date: x', memories: '', summaries: '', skillsContext: '' };
  }

  it('les segments somment au total (chars et tokens)', function() {
    var thread = [
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'hi there!' },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var sumChars = m.entries.reduce(function(a, e) { return a + e.chars; }, 0);
    var sumTokens = m.entries.reduce(function(a, e) { return a + e.tokens; }, 0);
    expect(sumChars).toBe(m.totalChars);
    expect(sumTokens).toBe(m.totalTokens);
  });

  it('omet les sous-blocs vides (pas d\'entrée à 0 chars)', function() {
    var m = buildContextManifest(baseSysParts(), baseDynParts(), [], '', null);
    var sources = m.entries.map(function(e) { return e.source; });
    expect(sources.indexOf('tools_system')).toBe(-1);
    expect(sources.indexOf('intent_doctrine')).toBe(-1);
    expect(sources.indexOf('memories')).toBe(-1);
    expect(sources.indexOf('space_library')).toBe(-1);
  });

  it('sp.identity non vide → entrée identity_blurb, comptée une seule fois (lot I, piège B)', function() {
    var sp = baseSysParts();
    sp.identity = 'IDENTITE MIAOU';
    var m = buildContextManifest(sp, baseDynParts(), [], '', null);
    var matches = m.entries.filter(function(e) { return e.source === 'identity_blurb'; });
    expect(matches.length).toBe(1);
    expect(matches[0].chars).toBe(sp.identity.length);
  });

  it('dp.library non vide → entrée space_library (lot Cbis, D4)', function() {
    var dp = baseDynParts();
    dp.library = 'file-abc — doc.txt (text/plain, 1.0 KB)';
    var m = buildContextManifest(baseSysParts(), dp, [], '', null);
    var entry = m.entries.filter(function(e) { return e.source === 'space_library'; })[0];
    expect(entry).toBeTruthy();
    expect(entry.chars).toBe(dp.library.length);
  });

  it('les définitions d\'outils sont mesurées depuis leur JSON, pas depuis les messages', function() {
    var toolDefsJson = JSON.stringify([{ type: 'function', function: { name: 'x' } }]);
    var m = buildContextManifest(baseSysParts(), baseDynParts(), [], toolDefsJson, null);
    var entry = m.entries.filter(function(e) { return e.source === 'tool_definitions'; })[0];
    expect(entry.chars).toBe(toolDefsJson.length);
  });

  it('thread agrégé = somme des sous-comptes par rôle', function() {
    var thread = [
      { role: 'user', content: 'aaaa' },
      { role: 'user', content: 'bbbb' },
      { role: 'assistant', content: 'cccc' },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var threadEntry = m.entries.filter(function(e) { return e.source === 'thread'; })[0];
    var sumByRole = threadEntry.byRole.reduce(function(a, r) { return a + r.chars; }, 0);
    expect(sumByRole).toBe(threadEntry.chars);
    expect(threadEntry.chars).toBe(12);
  });

  it('une part image_url compte IMAGE_TOKENS_ESTIMATE, jamais le base64 en chars', function() {
    var thread = [
      { role: 'user', content: [
        { type: 'text', text: 'voici' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,' + 'A'.repeat(10000) } },
      ] },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var imgEntry = m.entries.filter(function(e) { return e.source === 'attachment_images'; })[0];
    expect(imgEntry.tokens).toBe(IMAGE_TOKENS_ESTIMATE);
    expect(imgEntry.images).toBe(1);
    // le texte de la thread entry ne doit PAS inclure les 10000 'A' du base64
    var threadEntry = m.entries.filter(function(e) { return e.source === 'thread'; })[0];
    expect(threadEntry.chars).toBe(5);   // seulement "voici"
  });

  it('apiUsage est repassé tel quel (crochet réservé, non calculé)', function() {
    var usage = { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 };
    var m = buildContextManifest(baseSysParts(), baseDynParts(), [], '', usage);
    expect(m.apiUsage).toEqual(usage);
  });

  it('apiUsage absent → null', function() {
    var m = buildContextManifest(baseSysParts(), baseDynParts(), [], '', undefined);
    expect(m.apiUsage).toBe(null);
  });
});

describe('scaleManifestToUsage (Bbis, prorata sur l\'estimé)', function() {
  function baseSysParts() {
    return { root: 'ROOT', toolsSystem: '', intent: '', skills: '', docs: '', user: 'USER PROMPT' };
  }
  function baseDynParts() {
    return { contextDateModel: 'Date: x', memories: '', summaries: '', skillsContext: '' };
  }

  it('usage null → manifeste inchangé', function() {
    var m = buildContextManifest(baseSysParts(), baseDynParts(), [{ role: 'user', content: 'hello' }], '', null);
    var out = scaleManifestToUsage(m, null);
    expect(out).toEqual(m);
  });

  it('usage.prompt_tokens absent → manifeste inchangé', function() {
    var m = buildContextManifest(baseSysParts(), baseDynParts(), [{ role: 'user', content: 'hello' }], '', null);
    var out = scaleManifestToUsage(m, { completion_tokens: 5 });
    expect(out).toEqual(m);
  });

  it('totalTokens estimé à 0 (hors images) → manifeste inchangé (pas de division par zéro)', function() {
    var m = buildContextManifest(baseSysParts(), baseDynParts(), [], '', null);
    m.totalTokens = 0;
    m.entries = [];
    var out = scaleManifestToUsage(m, { prompt_tokens: 100 });
    expect(out).toEqual(m);
  });

  it('la somme des lignes (hors images) égale exactement prompt_tokens (résidu d\'arrondi absorbé)', function() {
    var thread = [
      { role: 'user', content: 'a'.repeat(101) },
      { role: 'assistant', content: 'b'.repeat(53) },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var out = scaleManifestToUsage(m, { prompt_tokens: 777 });
    var sum = out.entries.reduce(function(a, e) { return a + e.tokens; }, 0);
    expect(sum).toBe(777);
    expect(out.totalTokens).toBe(777);
    expect(out.real).toBe(true);
  });

  it('ligne attachment_images exclue du facteur et non proratisée', function() {
    var thread = [
      { role: 'user', content: [
        { type: 'text', text: 'texte'.repeat(20) },
        { type: 'image_url', image_url: { url: 'data:x' } },
      ] },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var imgTokensBefore = m.entries.filter(function(e) { return e.source === 'attachment_images'; })[0].tokens;
    var out = scaleManifestToUsage(m, { prompt_tokens: 999 });
    var imgEntry = out.entries.filter(function(e) { return e.source === 'attachment_images'; })[0];
    expect(imgEntry.tokens).toBe(imgTokensBefore);   // inchangée
    // total = prompt_tokens (texte réel) + tokens image (constante, hors budget réel)
    expect(out.totalTokens).toBe(999 + imgTokensBefore);
  });

  it('apiUsage posé sur le retour', function() {
    var m = buildContextManifest(baseSysParts(), baseDynParts(), [{ role: 'user', content: 'hello' }], '', null);
    var usage = { prompt_tokens: 50, completion_tokens: 3 };
    var out = scaleManifestToUsage(m, usage);
    expect(out.apiUsage).toEqual(usage);
  });
});

describe('usageDerived (Bbis)', function() {
  it('usage null → tout null', function() {
    expect(usageDerived(null)).toEqual({ inTokens: null, outTokens: null, cachedTokens: null, cachedRatio: null });
  });
  it('usage complet avec cached_tokens → ratio correct', function() {
    var d = usageDerived({ prompt_tokens: 1000, completion_tokens: 44, prompt_tokens_details: { cached_tokens: 250 } });
    expect(d.inTokens).toBe(1000);
    expect(d.outTokens).toBe(44);
    expect(d.cachedTokens).toBe(250);
    expect(d.cachedRatio).toBe(0.25);
  });
  it('cached_tokens absent (ex. Ollama) → cachedTokens et cachedRatio null', function() {
    var d = usageDerived({ prompt_tokens: 1000, completion_tokens: 44 });
    expect(d.cachedTokens).toBe(null);
    expect(d.cachedRatio).toBe(null);
    expect(d.inTokens).toBe(1000);
  });
});

describe('systemMessageParts / buildSystemMessage (brief B, refactor)', function() {
  it('buildSystemMessage reste identique à la concaténation des parts (pas de régression du séparateur)', function() {
    var sp = systemMessageParts();
    var expected = [sp.identity, sp.root, sp.toolsSystem, sp.intent, sp.skills, sp.docs, sp.codeblock, sp.user]
      .filter(Boolean).join('\n\n---\n\n');
    expect(buildSystemMessage().content).toBe(expected);
  });
  it('la part identity est présente, inconditionnelle et EN TÊTE (lot I)', function() {
    var sp = systemMessageParts();
    expect(sp.identity).toBe(IDENTITY_BLURB);
    expect(sp.identity.length > 0).toBe(true);
    // En tête du join : le message système commence par le blurb.
    expect(buildSystemMessage().content.indexOf(IDENTITY_BLURB)).toBe(0);
  });
  it('root/codeblock inconditionnelles (retrait du gate mort TOOLS.length, lot I)', function() {
    var sp = systemMessageParts();
    expect(sp.root).toBe(ROOT_SYSTEM_PROMPT);
    expect(sp.codeblock).toBe(CODEBLOCK_DOCTRINE);
  });
});

describe('buildSummaryBlock (résumés matchés injectés dans le contexte)', function() {
  it('[] → chaîne vide (pas de bloc creux)', function() {
    expect(buildSummaryBlock([])).toBe('');
  });
  it('absent → chaîne vide', function() {
    expect(buildSummaryBlock(undefined || [])).toBe('');
  });
  it('1+ match → bloc contenant id, titre et résumé', function() {
    var b = buildSummaryBlock([{ id: 'c1', title: 'Titre X', summary: 'Un résumé concis' }]);
    expect(b).toContain('c1');
    expect(b).toContain('Titre X');
    expect(b).toContain('Un résumé concis');
    expect(b).toContain('list_conversations');
  });
});

describe('buildMemoryEntriesBlock (souvenirs actifs, scope profile + Space actif)', function() {
  it('aucun souvenir → chaîne vide', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    expect(buildMemoryEntriesBlock()).toBe('');
  });
  it('un souvenir de scope profile → bloc le listant', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    saveMemory({ id: 'm1', content: 'Aime le café noir', scope: 'profile' });
    var b = buildMemoryEntriesBlock();
    expect(b).toContain('m1');
    expect(b).toContain('Aime le café noir');
  });
  it('souvenir hors scope (autre Space) → absent du bloc', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    saveMemory({ id: 'm1', content: 'Souvenir isolé', scope: 'sp-autre' });
    expect(buildMemoryEntriesBlock()).toBe('');
  });
});

describe('buildSkillsContextBlock (skills autotrigger, stage 2)', function() {
  it('aucun skill autotrigger → chaîne vide', function() {
    setSkillsCache([]);
    expect(buildSkillsContextBlock()).toBe('');
    setSkillsCache([{ slug: 'a' }]);   // enabled mais pas autotrigger
    expect(buildSkillsContextBlock()).toBe('');
  });
  it('≥1 skill enabled+autotrigger → bloc les listant', function() {
    setSkillsCache([{ slug: 'my-skill', name: 'Ma Skill', description: 'fait un truc', autotrigger: true }]);
    var b = buildSkillsContextBlock();
    expect(b).toContain('my-skill');
    expect(b).toContain('Ma Skill');
    expect(b).toContain('fait un truc');
    expect(b).toContain('miaou_skills_context');
  });
});

// NOTE : contextBlockParts()/buildContextBlock() appellent Intl.DateTimeFormat
// (contextDateModel) — Intl n'est pas stubé sous QuickJS (tests/runner.py),
// donc non testables ici tels quels. Couverts indirectement via leurs
// sous-blocs purs ci-dessus (buildSummaryBlock/buildMemoryEntriesBlock/
// buildSkillsContextBlock).

describe('contextWindowFor', function() {
  it('valeur vide/non numérique → null (inconnu)', function() {
    localStorage.clear();
    expect(contextWindowFor('any-model')).toBe(null);
  });
  it('valeur numérique positive persistée → retournée en entier', function() {
    localStorage.clear();
    saveSettings({ contextWindow: '128000' });
    expect(contextWindowFor('any-model')).toBe(128000);
  });
});
