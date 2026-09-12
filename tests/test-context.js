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
    return { root: 'ROOT', intent: '', skills: '', user: 'USER PROMPT' };
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

  // Le fil est scindé au dernier message user AUTHENTIQUE : c'est là que
  // dispatchSend colle le préfixe éphémère, donc là que le payload cesse d'être
  // servissable par un cache de préfixe. Les deux entrées somment au fil entier.
  it('le fil est scindé au dernier message user, et les deux moitiés somment au tout', function() {
    var thread = [
      { role: 'user', content: 'aaaa' },
      { role: 'assistant', content: 'cccc' },
      { role: 'user', content: 'bbbbbbbb' },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var hist = m.entries.filter(function(e) { return e.source === 'thread_history'; })[0];
    var last = m.entries.filter(function(e) { return e.source === 'thread_last_user'; })[0];
    expect(hist.chars).toBe(8);    // 'aaaa' + 'cccc'
    expect(last.chars).toBe(8);    // dernier user seul
  });

  // Un user SYNTHÉTIQUE (recall d'image, expandThread) n'est pas un tour : le
  // préfixe éphémère ne s'y colle pas, donc la coupe ne s'y fait pas non plus.
  // Si les deux prédicats divergeaient, la barre décrirait un découpage que le
  // payload ne suit pas.
  it('un message user synthétique ne tient pas lieu de dernier message', function() {
    var thread = [
      { role: 'user', content: 'authentique' },
      { role: 'user', content: 'synthetique', _synthetic: true },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var last = m.entries.filter(function(e) { return e.source === 'thread_last_user'; })[0];
    expect(last.chars).toBe('authentique'.length);
  });

  // Mi-échange (boucle d'outils), le fil se termine par des tool-acks : ce qui
  // SUIT le dernier user est compté avec l'historique. L'entrée mesure un
  // volume de fil, pas un segment contigu du payload.
  it('ce qui suit le dernier message user est compté avec l\'historique', function() {
    var thread = [
      { role: 'user', content: 'question' },
      { role: 'tool', content: 'resultat-outil' },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var hist = m.entries.filter(function(e) { return e.source === 'thread_history'; })[0];
    var last = m.entries.filter(function(e) { return e.source === 'thread_last_user'; })[0];
    expect(hist.chars).toBe('resultat-outil'.length);
    expect(last.chars).toBe('question'.length);
  });

  // Aucun user authentique (fil purement assistant/outil) : pas d'entrée
  // thread_last_user creuse, tout va dans l'historique.
  it('fil sans message user authentique → pas d\'entrée thread_last_user', function() {
    var thread = [{ role: 'assistant', content: 'seul' }];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var sources = m.entries.map(function(e) { return e.source; });
    expect(sources.indexOf('thread_last_user')).toBe(-1);
    expect(sources.indexOf('thread_history') >= 0).toBe(true);
  });

  // L'ORDRE des entrées est l'ordre réel du payload, donc la cachabilité
  // décroissante (campagne cache, axe 2) : c'est ce qui donne son sens à la
  // barre empilée et à la barre de cache dessinée sur la même échelle. Une
  // entrée réordonnée pour des raisons de présentation casserait la lecture
  // sans qu'aucun autre test ne bronche. Formulé en positions RELATIVES, pas en
  // liste recopiée : une part ajoutée plus tard ne doit pas rendre ce test faux.
  it('les entrées sortent dans l\'ordre du payload (cachabilité décroissante)', function() {
    var sp = baseSysParts();
    sp.identity = 'ID';
    var dp = { contextDateModel: 'D', summaries: 'S', library: 'L' };
    var thread = [
      { role: 'user', content: 'ancien' },
      { role: 'assistant', content: 'reponse' },
      { role: 'user', content: [{ type: 'text', text: 'nouveau' },
                                { type: 'image_url', image_url: { url: 'data:x' } }] },
    ];
    var m = buildContextManifest(sp, dp, thread, '{"tools":[]}', null);
    var sources = m.entries.map(function(e) { return e.source; });
    var at = function(src) { return sources.indexOf(src); };
    expect(at('identity_blurb') < at('tool_definitions')).toBe(true);
    expect(at('tool_definitions') < at('thread_history')).toBe(true);
    expect(at('thread_history') < at('context_date_model')).toBe(true);
    expect(at('context_date_model') < at('summaries')).toBe(true);
    expect(at('summaries') < at('space_library')).toBe(true);
    expect(at('space_library') < at('thread_last_user')).toBe(true);
    expect(at('thread_last_user') < at('attachment_images')).toBe(true);
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
    // le texte de l'entrée de fil ne doit PAS inclure les 10000 'A' du base64
    var lastUser = m.entries.filter(function(e) { return e.source === 'thread_last_user'; })[0];
    expect(lastUser.chars).toBe(5);   // seulement "voici"
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
    return { root: 'ROOT', intent: '', skills: '', user: 'USER PROMPT' };
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

  // Le résidu d'arrondi va sur la plus grosse ligne, cherchée dynamiquement.
  // La scission du fil (axe 2) a retiré `thread`, qui était typiquement cette
  // ligne : le résidu se pose donc ailleurs. L'invariant tenu n'est PAS
  // « quelle ligne le porte » mais « la somme vaut exactement prompt_tokens »,
  // et aucune ligne ne devient négative en l'absorbant.
  it('le résidu se pose sur la plus grosse ligne quelle qu\'elle soit, sans la rendre négative', function() {
    var thread = [
      { role: 'user', content: 'a'.repeat(37) },
      { role: 'assistant', content: 'b'.repeat(1301) },
      { role: 'user', content: 'c'.repeat(59) },
    ];
    var m = buildContextManifest(baseSysParts(), baseDynParts(), thread, '', null);
    var out = scaleManifestToUsage(m, { prompt_tokens: 421 });
    var sum = out.entries.reduce(function(a, e) { return a + e.tokens; }, 0);
    expect(sum).toBe(421);
    out.entries.forEach(function(e) { expect(e.tokens >= 0).toBe(true); });
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
  // Toute part non vide de systemMessageParts() doit se retrouver dans le
  // message, et les parts être JOINTES par le séparateur. Formulé SANS recopier
  // l'ordre du join : une liste recopiée ici dériverait au premier ajout de
  // part, et un test qui recopie le code qu'il mesure ne mesure rien.
  //
  // Le séparateur ne se compte PAS par un split du contenu : ROOT_SYSTEM_PROMPT
  // porte déjà des '\n\n---\n\n' internes (il concatène ses propres doctrines),
  // donc le compte global mesurerait autre chose que les jointures. On vérifie
  // à la place que chaque part est suivie du séparateur, sauf la dernière.
  it('toute part non vide est présente dans le message, jointe par le séparateur', function() {
    var sp = systemMessageParts();
    var content = buildSystemMessage().content;
    var present = Object.keys(sp).map(function(k) { return sp[k]; }).filter(Boolean);
    expect(present.length > 0).toBe(true);
    present.forEach(function(part, i) {
      var at = content.indexOf(part);
      expect(at >= 0).toBe(true);
      var after = content.slice(at + part.length);
      // Dernière part du message : rien après elle. Sinon, le séparateur.
      var isLast = (i === present.length - 1);
      expect(isLast ? after === '' : after.indexOf('\n\n---\n\n') === 0).toBe(true);
    });
  });
  // GARDE DE POSITION, pas de mise en page. `skillsContext` (« aucune skill
  // n'est obligatoire ») contredit DOCS_DOCTRINE, incluse dans `root`
  // (« lis la skill docs avant ton premier appel »). Tant que le contexte
  // skills vivait dans le préfixe éphémère, il l'emportait par proximité avec
  // le dernier message user ; remonté dans le système, seul l'ordre du join
  // rejoue cet arbitrage. L'inverser ressusciterait un défaut mesuré en test
  // réel (gemma-4-e4b, 2026-08-29).
  it('le contexte skills reste APRÈS le prompt racine dans le message système', function() {
    setSkillsCache([{ slug: 'docs', name: 'Docs', autotrigger: true }]);
    var content = buildSystemMessage().content;
    var iRoot = content.indexOf(ROOT_SYSTEM_PROMPT);
    var iSkillsCtx = content.indexOf('miaou_skills_context');
    expect(iRoot >= 0).toBe(true);
    expect(iSkillsCtx > iRoot).toBe(true);
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
  // Les fixtures de `buildContextManifest` plus haut passent `root: 'ROOT'` : elles
  // prouvent que la LIGNE root_prompt somme au total, jamais que les doctrines
  // réelles y sont. Assertion de bout en bout sur les vraies constantes — chaque
  // doctrine concaténée dans ROOT_SYSTEM_PROMPT est bien PAYÉE dans l'inspecteur.
  it('chaque doctrine de ROOT_SYSTEM_PROMPT est comptée dans le manifeste (root_prompt)', function() {
    var sp = systemMessageParts();
    var m = buildContextManifest(sp, {}, [], '', null);
    var root = m.entries.filter(function(e) { return e.source === 'root_prompt'; })[0];
    expect(root.chars).toBe(ROOT_SYSTEM_PROMPT.length);
    var doctrines = [
      BINARY_DOCTRINE, ATTACHMENT_DOCTRINE, DOCS_DOCTRINE, WEB_DOCTRINE,
      AUTHORIZATION_DOCTRINE, CONV_REF_DOCTRINE, MEMORY_DOCTRINE, FILES_DOCTRINE,
      JS_EVAL_DOCTRINE, RESOURCE_DOCTRINE, AGENT_DOCTRINE,
    ];
    var summed = 0;
    doctrines.forEach(function(d) {
      expect(ROOT_SYSTEM_PROMPT.indexOf(d) >= 0).toBe(true);
      summed += d.length;
    });
    // Somme des doctrines <= la ligne comptée : ce qui est concaténé est facturé.
    expect(summed <= root.chars).toBe(true);
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
    expect(b).toContain('conv__list');
  });
});

// Les souvenirs sont désormais SCINDÉS par destination : le scope `profile`
// part dans le message système (transverse, stable), le scope du Space actif
// reste dans le préfixe éphémère (il change au switch de Space). Les deux
// prédicats ci-dessous sont ce qui porte la portée — `buildMemoryEntriesBlock`
// n'est plus qu'un formateur, et l'appeler sans scopes ne filtre RIEN (contrat
// de `listMemoryEntries`). C'est pourquoi les cas d'herméticité sont assertés
// sur les deux prédicats, jamais sur le formateur nu.
describe('buildProfileMemoriesBlock / buildSpaceMemoriesBlock (scission par destination)', function() {
  it('aucun souvenir → chaîne vide des deux côtés', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    expect(buildProfileMemoriesBlock()).toBe('');
    expect(buildSpaceMemoriesBlock()).toBe('');
  });
  it('un souvenir de scope profile → dans le bloc système, pas dans l\'éphémère', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    saveMemory({ id: 'm1', content: 'Aime le café noir', scope: 'profile' });
    var b = buildProfileMemoriesBlock();
    expect(b).toContain('m1');
    expect(b).toContain('Aime le café noir');
    expect(buildSpaceMemoriesBlock()).toBe('');
  });
  it('un souvenir du Space actif → dans le bloc éphémère, pas dans le système', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    saveMemory({ id: 'm2', content: 'Le projet livre un seul fichier', scope: DEFAULT_SPACE_ID });
    var b = buildSpaceMemoriesBlock();
    expect(b).toContain('m2');
    expect(b).toContain('Le projet livre un seul fichier');
    expect(buildProfileMemoriesBlock()).toBe('');
  });
  it('souvenir d\'un AUTRE Space → absent des deux blocs (herméticité, piège 18)', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    saveMemory({ id: 'm3', content: 'Souvenir isolé', scope: 'sp-autre' });
    expect(buildProfileMemoriesBlock()).toBe('');
    expect(buildSpaceMemoriesBlock()).toBe('');
  });
  it('la réunion des deux couvre exactement memoryScopesForSpace', function() {
    // Garde d'exhaustivité : si la portée gagne un scope, il doit atterrir
    // dans l'un des deux blocs, jamais nulle part. Un souvenir par scope
    // atteignable, puis vérification que chacun est cité quelque part.
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    var scopes = memoryScopesForSpace(activeSpaceId);
    for (var i = 0; i < scopes.length; i++) {
      saveMemory({ id: 'mm' + i, content: 'Contenu ' + i, scope: scopes[i] });
    }
    var both = buildProfileMemoriesBlock() + '\n' + buildSpaceMemoriesBlock();
    for (var j = 0; j < scopes.length; j++) {
      expect(both).toContain('mm' + j);
    }
  });
});

// Campagne cache : trois blocs quittent le préfixe éphémère (role:user) pour le
// message système, parce qu'ils ne changent qu'à un geste explicite de
// l'utilisateur et jamais d'un tour à l'autre. Les laisser en éphémère les
// faisait glisser derrière chaque nouveau message user, donc ne jamais être
// servis du cache. Ces tests gardent la RÉPARTITION, pas le contenu (couvert
// ailleurs) — c'est elle qui se défait en silence.
describe('répartition système / éphémère (campagne cache)', function() {
  it('les consignes MCP et le contexte skills sont dans les parts SYSTÈME', function() {
    setSkillsCache([{ slug: 'docs', name: 'Docs', autotrigger: true }]);
    var sp = systemMessageParts();
    expect(sp.skillsContext).toContain('miaou_skills_context');
    // mcpInstructions vaut '' sans serveur branché : la clé doit exister quand même,
    // sinon buildContextManifest cesse silencieusement de la compter.
    expect(typeof sp.mcpInstructions).toBe('string');
  });
  // Les deux moitiés sont dans le message système, mais dans DEUX parts
  // distinctes : le profil à sa place propre (transverse), le scope de l'Espace
  // à l'intérieur du bloc Espace. C'est ce qui rend contigu tout ce qu'un switch
  // de Space invalide.
  it('les souvenirs de profil ont leur part, ceux du Space vivent dans le bloc Espace', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    saveMemory({ id: 'mp', content: 'Souvenir transverse', scope: 'profile' });
    saveMemory({ id: 'ms', content: 'Souvenir local', scope: DEFAULT_SPACE_ID });
    var sp = systemMessageParts();
    expect(sp.memoriesProfile).toContain('Souvenir transverse');
    expect(sp.memoriesProfile.indexOf('Souvenir local')).toBe(-1);
    expect(sp.space).toContain('Souvenir local');
    expect(sp.space.indexOf('Souvenir transverse')).toBe(-1);
  });
  // Exclusivité : le système annonce un cardinal OU l'éphémère développe la
  // liste, jamais les deux — sinon le modèle lit deux fois la même information,
  // dont une payée intégralement à chaque tour.
  it('note de bibliothèque et manifeste complet sont mutuellement exclusifs', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    // Défaut (réglage absent) : note côté système (dans le bloc Espace),
    // manifeste éteint côté éphémère.
    expect(loadSettings().libraryManifestInContext).toBe(false);
    // Manifeste demandé : la note disparaît du bloc Espace — sinon le système
    // annoncerait un cardinal que l'éphémère développe juste en dessous.
    saveSettings({ libraryManifestInContext: true });
    expect(systemMessageParts().space.indexOf('files__list')).toBe(-1);
  });
});

// Le bloc Espace rassemble TOUT ce qui décrit l'Espace actif en une part
// contiguë du message système : description, note de bibliothèque, souvenirs de
// l'Espace. Avant regroupement, ces éléments étaient à quatre endroits — dont
// deux en préfixe éphémère, où le nom de l'Espace était réécrit à chaque tour
// alors que le système le portait déjà.
// CTX_PALETTE et CTX_EXPLAIN (ui.js) sont indexées par `source` de
// buildContextManifest, qui reste LA source de la liste. Une part ajoutée au
// manifeste sans couleur s'affiche avec un segment invisible ; sans explication,
// sans tooltip — deux dégradations SILENCIEUSES, que rien ne signale. Le test
// dérive les sources d'un manifeste réel plutôt que d'une liste recopiée.
describe('alignement CTX_PALETTE / CTX_EXPLAIN sur les sources du manifeste', function() {
  it('chaque source produite porte une couleur et une explication', function() {
    localStorage.clear();
    activeSpaceId = DEFAULT_SPACE_ID;
    saveMemory({ id: 'mp', content: 'Profil', scope: 'profile' });
    setSkillsCache([{ slug: 'docs', name: 'Docs', autotrigger: true }]);
    var sp = systemMessageParts();
    // dynParts non atteignable ici (Intl absent sous QuickJS) : fourni à la main,
    // toutes clés non vides, pour que chaque source dynamique soit produite.
    var dp = { contextDateModel: 'D', summaries: 'S', library: 'L' };
    // Le fil doit produire les DEUX entrées de sa scission : un dernier message
    // user porteur de texte (sans quoi `thread_last_user` n'existe pas et le
    // test resterait vert sans jamais avoir vu cette source), plus un tour
    // antérieur pour `thread_history` et une image pour `attachment_images`.
    var thread = [{ role: 'user', content: 'bonjour' },
                  { role: 'assistant', content: 'salut' },
                  { role: 'user', content: [{ type: 'text', text: 'et voici' },
                                            { type: 'image_url' }] }];
    var m = buildContextManifest(sp, dp, thread, '{"tools":[]}', null);
    expect(m.entries.length > 0).toBe(true);
    // Garde de la fixture elle-même : la boucle ci-dessous ne prouve rien sur
    // une source que le manifeste n'a pas produite.
    var produced = m.entries.map(function(e) { return e.source; });
    expect(produced.indexOf('thread_history') >= 0).toBe(true);
    expect(produced.indexOf('thread_last_user') >= 0).toBe(true);
    m.entries.forEach(function(e) {
      expect(typeof CTX_PALETTE[e.source]).toBe('string');
      expect(typeof CTX_EXPLAIN[e.source]).toBe('string');
    });
  });
});

describe('buildSpaceBlock (regroupement de ce qui décrit l\'Espace actif)', function() {
  var space = { name: 'Projet X', description: 'Un projet de test.' };
  it('rien à dire sur l\'Espace → chaîne vide, pas d\'en-tête creux', function() {
    expect(buildSpaceBlock({ name: 'Vide' }, '', '')).toBe('');
    expect(buildSpaceBlock(null, '', '')).toBe('');
  });
  // L'en-tête porte le RÉFÉRENTIEL : la ligne « Espace : <nom> » ayant quitté le
  // bloc éphémère, c'est le seul endroit qui dit encore que ce qui suit décrit
  // l'Espace COURANT et non un Espace quelconque. Sans lui, le bloc devient
  // ambigu pour le modèle (défaut « référentiel implicite »).
  it('nomme l\'Espace et le désigne comme l\'actif, une seule fois en tête', function() {
    var b = buildSpaceBlock(space, '', '');
    expect(b).toContain('Projet X');
    expect(b).toContain('actif');
    // L'en-tête vient EN TÊTE : le nom y apparaît avant tout sous-bloc.
    expect(b.indexOf('Projet X') < b.indexOf('Un projet de test.')).toBe(true);
  });
  it('sans nom d\'Espace → en-tête générique, jamais de nom vide', function() {
    var b = buildSpaceBlock({ description: 'Sans nom.' }, '', '');
    expect(b).toContain('actif');
    expect(b).toContain('Sans nom.');
  });
  it('agrège description, note de bibliothèque et souvenirs de l\'Espace', function() {
    var b = buildSpaceBlock(space, 'NOTE-BIBLIO', 'SOUVENIRS-ESPACE');
    expect(b).toContain('Un projet de test.');
    expect(b).toContain('NOTE-BIBLIO');
    expect(b).toContain('SOUVENIRS-ESPACE');
  });
  it('omet proprement un sous-bloc absent (pas de séparateur orphelin)', function() {
    var b = buildSpaceBlock(space, '', 'SOUVENIRS-ESPACE');
    expect(b).toContain('SOUVENIRS-ESPACE');
    expect(b.indexOf('\n\n\n')).toBe(-1);
  });
  it('un Espace sans description mais avec des fichiers produit quand même le bloc', function() {
    var b = buildSpaceBlock({ name: 'Y' }, 'NOTE-BIBLIO', '');
    expect(b).toContain('NOTE-BIBLIO');
    expect(b).toContain('Y');
  });
  it('byte-stable : deux appels identiques produisent le même bloc', function() {
    expect(buildSpaceBlock(space, 'N', 'M')).toBe(buildSpaceBlock(space, 'N', 'M'));
  });
});

describe('buildSkillsContextBlock (skills autotrigger, stage 2)', function() {
  it('aucune skill autotrigger → chaîne vide', function() {
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
  // Le « tu PEUX / aucune n'est obligatoire » de ce bloc contredisait
  // frontalement les doctrines du prompt système qui EXIGENT la lecture d'une
  // skill avant un geste (DOCS_DOCTRINE, FILES_PROMOTE_DOCTRINE). Comme ce bloc
  // est recalculé à chaque tour, il est plus proche du dernier message user que
  // le prompt système — et c'est lui que le modèle suivait (gemma-4-e4b : skill
  // `docs` listée, jamais lue, selector inventé). L'exception nommée doit rester.
  it('réserve explicitement le cas des skills exigées par une doctrine', function() {
    setSkillsCache([{ slug: 'docs', name: 'Docs', autotrigger: true }]);
    var b = buildSkillsContextBlock();
    expect(b).toContain('EXCEPTION');
    expect(b).toContain('obligatoire');
  });
  // Le garde-fou anti-balayage reste : l'exception ne doit pas se généraliser en
  // « lis ce qui te semble utile » (mémoire weak_model_discovery_tool_oversweep).
  it('sans lever la dissuasion générale contre le balayage', function() {
    setSkillsCache([{ slug: 'docs', name: 'Docs', autotrigger: true }]);
    expect(buildSkillsContextBlock()).toContain('au cas où');
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
