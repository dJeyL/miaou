// tests/test-agents.js
// Agents — sous-conversations lancées par le modèle (lot X-1).
// Couverture PURE : prédicat de racine, exclusions et leur composition avec
// spaceConvIds, validation de la liste d'outils déléguée, garde de parenté,
// borne de tours, statuts terminaux, payload délivré au parent.

describe('isRootConversation / isAgentConversation (X-1, étape 1)', function() {
  it('un record SANS parentConvId est une racine', function() {
    expect(isRootConversation({ id: 'c1' })).toBe(true);
    expect(isAgentConversation({ id: 'c1' })).toBe(false);
  });
  it('un record AVEC parentConvId est un agent', function() {
    expect(isRootConversation({ id: 'c2', parentConvId: 'c1' })).toBe(false);
    expect(isAgentConversation({ id: 'c2', parentConvId: 'c1' })).toBe(true);
  });
  it('une CHAÎNE VIDE n\'est pas un parent — le record reste une racine', function() {
    // Cas d'un record legacy ou d'une désérialisation qui pose le champ sans
    // valeur : le traiter comme un agent le rendrait invisible partout sans
    // que rien ne le signale.
    expect(isRootConversation({ id: 'c3', parentConvId: '' })).toBe(true);
  });
  it('null / undefined → racine (jamais d\'exception sur un record absent)', function() {
    expect(isRootConversation(null)).toBe(true);
    expect(isRootConversation(undefined)).toBe(true);
  });
  it('parentConvId non-string (nombre) ne fait pas un agent', function() {
    expect(isRootConversation({ id: 'c4', parentConvId: 0 })).toBe(true);
  });
});

describe('convLabel (X-1, navigation ; AA, extrait provisoire) — le libellé d\'une conversation', function() {
  it('une racine titrée rend son titre, non provisoire', function() {
    expect(convLabel({ id: 'c1', title: 'Refonte export' })).toEqual({ text: 'Refonte export', provisional: false });
  });
  it('un AGENT non titré retombe sur agentIntent — sinon la topbar affiche « Nouvelle conversation »', function() {
    // Le cas qui motive le prédicat : title est figé à '' au spawn (exclusion
    // 3ter), et la description d'agent__spawn PROMET au modèle que l'intent
    // tient lieu de titre. Sans consommateur, cette promesse est un mensonge.
    expect(convLabel({ id: 'a1', parentConvId: 'p1', title: '', agentIntent: 'Rédiger la note' }))
      .toEqual({ text: 'Rédiger la note', provisional: false });
  });
  it('agentIntent n\'est PAS provisoire — c\'est un libellé définitif, pas une attente', function() {
    // La distinction qui empêche un futur lot d'« harmoniser » les deux cas
    // sans titre : un agent n'est jamais titré, rien ne remplacera son intent,
    // alors qu'un snippet attend le titrage. L'italique dirait le contraire.
    expect(convLabel({ id: 'a4', parentConvId: 'p1', title: '', agentIntent: 'Trier' }).provisional).toBe(false);
  });
  it('une RACINE non titrée ne récupère PAS un agentIntent résiduel', function() {
    // Défense contre un record hybride : agentIntent n'a de sens que porté par
    // un agent. Le lire sur une racine ferait apparaître un libellé fantôme.
    expect(convLabel({ id: 'c2', title: '', agentIntent: 'résidu' })).toEqual({ text: '', provisional: false });
  });
  it('un agent titré préfère son titre (le champ existe, on ne l\'ignore pas)', function() {
    expect(convLabel({ id: 'a2', parentConvId: 'p1', title: 'posé', agentIntent: 'intent' }))
      .toEqual({ text: 'posé', provisional: false });
  });
  it('une racine sans titre rend son snippet, marqué provisoire (AA)', function() {
    expect(convLabel({ id: 'c4', snippet: 'Comment configurer Caddy…' }))
      .toEqual({ text: 'Comment configurer Caddy…', provisional: true });
  });
  it('un TITRE bat le snippet — un extrait ne peut jamais écraser un titre (AA)', function() {
    // Le snippet n'est pas effacé quand le titre arrive (écriture inutile) :
    // c'est l'ORDRE du prédicat qui le rend inerte. Inverser les deux tests
    // ferait réapparaître l'extrait sur une conversation titrée.
    expect(convLabel({ id: 'c5', title: 'Reverse proxy Caddy', snippet: 'Comment configurer…' }))
      .toEqual({ text: 'Reverse proxy Caddy', provisional: false });
  });
  it('un agent portant un snippet résiduel rend quand même son agentIntent (AA)', function() {
    // maybeWriteSnippet s'abstient sur un agent, donc le cas ne se produit pas
    // ; l'ordre du prédicat le garantit en défense.
    expect(convLabel({ id: 'a5', parentConvId: 'p1', title: '', agentIntent: 'Trier', snippet: 'résidu' }))
      .toEqual({ text: 'Trier', provisional: false });
  });
  it('rend \'\' et jamais le placeholder — le fallback appartient à la surface', function() {
    // La topbar veut '' (son :empty::before parle), le document.title veut
    // « Nouvelle conversation ». Mélanger les deux ferait remonter un
    // placeholder là où un champ vide est attendu.
    expect(convLabel({ id: 'c3' })).toEqual({ text: '', provisional: false });
    expect(convLabel(null)).toEqual({ text: '', provisional: false });
  });
  it('un agent sans agentIntent rend \'\' plutôt que undefined', function() {
    expect(convLabel({ id: 'a3', parentConvId: 'p1' })).toEqual({ text: '', provisional: false });
  });
});

describe('agentChildrenOf (X-1, étape 1)', function() {
  var convs = [
    { id: 'p1' },
    { id: 'a1', parentConvId: 'p1' },
    { id: 'a2', parentConvId: 'p1' },
    { id: 'p2' },
    { id: 'b1', parentConvId: 'p2' },
  ];
  it('rend les enfants directs d\'un parent', function() {
    expect(agentChildrenOf('p1', convs).map(function(c) { return c.id; })).toEqual(['a1', 'a2']);
  });
  it('rend [] pour une conversation sans enfant', function() {
    expect(agentChildrenOf('b1', convs)).toEqual([]);
  });
  it('rend [] sur convId absent, sans exception', function() {
    expect(agentChildrenOf(null, convs)).toEqual([]);
    expect(agentChildrenOf('p1', null)).toEqual([]);
  });
});

describe('listAllConversations porte parentConvId (X-1, étape 1)', function() {
  // Sans ce champ dans la projection méta, agentChildrenOf balaierait un étage 1
  // qui ne sait pas ce qu'est un agent : aucun agent ne serait jamais exclu de
  // la sidebar, du backfill ni de la recherche — et aucun test ne le verrait.
  it('la projection méta transporte parentConvId et agentIntent', function() {
    localStorage.clear();
    saveConversation({ id: 'p1', title: 'parent', timestamp: 1, messages: [] });
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [],
      parentConvId: 'p1', agentIntent: 'Relire le brief' });
    var all = listAllConversations();
    var agent = all.filter(function(c) { return c.id === 'a1'; })[0];
    expect(agent.parentConvId).toBe('p1');
    expect(agent.agentIntent).toBe('Relire le brief');
    expect(agentChildrenOf('p1', all).length).toBe(1);
  });
});

describe('Composition spaceConvIds ∘ isRootConversation (X-1, étape 2)', function() {
  // Le joint entre deux fonctions pures est précisément ce qui n'est jamais
  // testé (project_pure_functions_compose_unguarded_contract). Les deux filtres
  // COMPOSENT, ils ne fusionnent jamais : l'exclusion des agents est orthogonale
  // à l'herméticité (piège 18).
  var convs = [
    { id: 'p1', spaceId: 'sA' },
    { id: 'a1', spaceId: 'sA', parentConvId: 'p1' },
    { id: 'p2', spaceId: 'sB' },
    { id: 'a2', spaceId: 'sB', parentConvId: 'p2' },
  ];
  it('spaceConvIds seul ramène AUSSI les agents du Space', function() {
    var ids = spaceConvIds('sA', convs);
    expect(ids.has('p1')).toBe(true);
    expect(ids.has('a1')).toBe(true);   // c'est bien pour ça qu'il faut composer
  });
  it('composé avec isRootConversation, seules les racines du Space restent', function() {
    var ids = spaceConvIds('sA', convs);
    var kept = convs.filter(function(c) { return ids.has(c.id) && isRootConversation(c); })
      .map(function(c) { return c.id; });
    expect(kept).toEqual(['p1']);
  });
  it('un agent d\'un AUTRE Space est exclu par les deux filtres, pas par un seul', function() {
    var ids = spaceConvIds('sA', convs);
    expect(ids.has('a2')).toBe(false);
    expect(isRootConversation({ id: 'a2', spaceId: 'sB', parentConvId: 'p2' })).toBe(false);
  });
});

describe('selectBackfillCandidates exclut les agents (X-1, étape 2)', function() {
  // L'exclusion la plus facile à rater : sans elle, elle tient tant que la page
  // est ouverte et SAUTE AU RELOAD (project_second_writer_must_realign_the_first).
  var substantial = [
    { role: 'user', content: 'bonjour, question longue' },
    { role: 'assistant', content: 'réponse suffisamment longue' },
  ];
  it('une racine substantielle sans résumé est candidate', function() {
    var out = selectBackfillCandidates([{ id: 'p1', messages: substantial }], {});
    expect(out.length).toBe(1);
  });
  it('un agent substantiel sans résumé n\'est JAMAIS candidat', function() {
    var out = selectBackfillCandidates(
      [{ id: 'a1', parentConvId: 'p1', messages: substantial }], {});
    expect(out.length).toBe(0);
  });
});

describe('pruneOrphanSummaries ne crée rien pour un agent (X-1, étape 2)', function() {
  it('un résumé dont la conversation est un agent est élagué comme un orphelin', function() {
    var summaries = { p1: { title: 'a' }, a1: { title: 'b' } };
    var out = pruneOrphanSummaries(summaries, [{ id: 'p1' }, { id: 'a1', parentConvId: 'p1' }]);
    expect(Object.prototype.hasOwnProperty.call(out, 'p1')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(out, 'a1')).toBe(false);
  });
});

describe('validateAgentToolList (X-1, étape 3)', function() {
  var avail = ['miaou__js__eval', 'miaou__conv__get', 'mcp_docs__docs__read'];
  it('défaut : aucun outil', function() {
    expect(validateAgentToolList(undefined, avail)).toEqual({ ok: true, tools: [] });
    expect(validateAgentToolList(null, avail)).toEqual({ ok: true, tools: [] });
    expect(validateAgentToolList([], avail)).toEqual({ ok: true, tools: [] });
  });
  it('accepte des noms valides et déduplique', function() {
    var r = validateAgentToolList(['miaou__js__eval', 'miaou__js__eval'], avail);
    expect(r.ok).toBe(true);
    expect(r.tools).toEqual(['miaou__js__eval']);
  });
  it('nom inconnu → refus LISTANT les noms valides', function() {
    var r = validateAgentToolList(['miaou__nawak'], avail);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('miaou__nawak');
    expect(r.error).toContain('miaou__js__eval');
    expect(r.error).toContain('mcp_docs__docs__read');
  });
  it('agent__spawn dans la liste → refus (pas de petits-enfants, X-b)', function() {
    var r = validateAgentToolList(['miaou__agent__spawn'], avail);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ne peut pas en lancer un autre');
  });
  it('agent__spawn refusé aussi sous sa forme nue', function() {
    expect(validateAgentToolList(['agent__spawn'], avail).ok).toBe(false);
  });
  it('non-tableau → refus explicite', function() {
    expect(validateAgentToolList('miaou__js__eval', avail).ok).toBe(false);
  });
});

describe('agentSpawnLimitError — le refus NOMME la borne atteinte (X-1, Q3)', function() {
  it('sous les deux bornes → null (lancement permis)', function() {
    expect(agentSpawnLimitError(0, 0, 3, 5)).toBe(null);
    expect(agentSpawnLimitError(2, 4, 3, 5)).toBe(null);
  });
  it('borne PAR CONVERSATION atteinte → message qui la nomme', function() {
    var e = agentSpawnLimitError(3, 3, 3, 5);
    expect(e).toContain('3 agents');
    expect(e).toContain('cette conversation');
  });
  it('borne GLOBALE atteinte → message distinct qui la nomme', function() {
    var e = agentSpawnLimitError(1, 5, 3, 5);
    expect(e).toContain('5 agents');
    expect(e).toContain('total');
  });
  it('les deux messages sont distincts (gestes différents du parent)', function() {
    expect(agentSpawnLimitError(3, 5, 3, 5) === agentSpawnLimitError(1, 5, 3, 5)).toBe(false);
  });
  it('les bornes par défaut valent 3 et 5 en l\'absence de clef de config', function() {
    // Dérivation BUILD_CONFIG (motif MAX_SUMMARIES) : sources non buildées → {}.
    expect(MAX_AGENTS_PER_CONV).toBe(3);
    expect(MAX_AGENTS_TOTAL).toBe(5);
  });
});

describe('shouldStopAgent — borne de tours (X-1, étape 5)', function() {
  it('sous la borne → false', function() {
    expect(shouldStopAgent(0, 12)).toBe(false);
    expect(shouldStopAgent(11, 12)).toBe(false);
  });
  it('à la borne → true', function() {
    expect(shouldStopAgent(12, 12)).toBe(true);
    expect(shouldStopAgent(13, 12)).toBe(true);
  });
  it('valeurs aberrantes → false, jamais d\'exception', function() {
    expect(shouldStopAgent(null, 12)).toBe(false);
    expect(shouldStopAgent(5, 0)).toBe(false);
    expect(shouldStopAgent('x', 'y')).toBe(false);
  });
  it('MAX_AGENT_TURNS a une valeur par défaut exploitable', function() {
    expect(MAX_AGENT_TURNS > 0).toBe(true);
  });
});

describe('collectAgentToolFailures — la trace remonte au parent (X-1, mesure 3)', function() {
  // Un échec d'outil est NON-isError délibérément : il vit dans l'ack. Sans
  // cette trace, le parent ne sait jamais POURQUOI la réponse est vide.
  it('dérive les échecs des acks via ackIsError, pas un second prédicat', function() {
    var thread = [
      { role: 'user', content: 'fais' },
      { role: 'tool-ack', kind: 'tool_failed', name: 'miaou__files__read', message: 'Fichier introuvable.', error: true },
      { role: 'tool-ack', kind: 'js_eval', ok: true },
      { role: 'tool-ack', kind: 'js_eval', ok: false, name: 'miaou__js__eval' },
      { role: 'assistant', content: 'je n\'ai pas pu' },
    ];
    var out = collectAgentToolFailures(thread);
    expect(out.length).toBe(2);
    expect(out[0]).toContain('miaou__files__read');
    expect(out[0]).toContain('Fichier introuvable.');
    expect(out[1]).toContain('miaou__js__eval');
  });
  it('aucun échec → tableau vide', function() {
    expect(collectAgentToolFailures([{ role: 'tool-ack', kind: 'js_eval', ok: true }])).toEqual([]);
    expect(collectAgentToolFailures(null)).toEqual([]);
  });
});

describe('lastAgentText (X-1, étape 6)', function() {
  it('rend le dernier assistant NON VIDE', function() {
    expect(lastAgentText([
      { role: 'assistant', content: 'premier' },
      { role: 'assistant', content: 'dernier' },
    ])).toBe('dernier');
  });
  it('ignore les bulles vides (_acksOnly, stop sans contenu)', function() {
    expect(lastAgentText([
      { role: 'assistant', content: 'le vrai résultat' },
      { role: 'assistant', content: '', _acksOnly: true },
      { role: 'assistant', content: '   ' },
    ])).toBe('le vrai résultat');
  });
  it('aucun assistant → chaîne vide', function() {
    expect(lastAgentText([{ role: 'user', content: 'x' }])).toBe('');
    expect(lastAgentText(null)).toBe('');
  });
});

describe('formatAgentResultForParent — cinq statuts DISTINCTS (X-1, étapes 5-6)', function() {
  function msg(status) {
    return formatAgentResultForParent({ id: 'a1', status: status, intent: 'Relire', text: 'ok' });
  }
  it('les cinq statuts terminaux produisent cinq messages distincts', function() {
    var seen = {};
    var statuses = ['done', 'exhausted', 'aborted', 'stopped', 'error'];
    for (var i = 0; i < statuses.length; i++) {
      var m = msg(statuses[i]);
      expect(!!seen[m]).toBe(false);   // aucun doublon
      seen[m] = true;
    }
    expect(Object.keys(seen).length).toBe(5);
  });
  it('exhausted dit explicitement que le résultat est PARTIEL', function() {
    // Un parent qui reçoit un résultat tronqué en le croyant complet prend une
    // décision fausse — écart qui ne casse rien de vérifiable.
    expect(msg('exhausted')).toContain('PARTIEL');
  });
  it('stopped (utilisateur) et aborted (modèle) ne se confondent pas', function() {
    expect(msg('stopped')).toContain('utilisateur');
    expect(msg('aborted')).toContain('toi');
  });
  it('porte l\'intent, l\'id et le texte de l\'agent', function() {
    var m = msg('done');
    expect(m).toContain('Relire');
    expect(m).toContain('a1');
    expect(m).toContain('ok');
  });
  it('sans texte → mention explicite, jamais un blanc', function() {
    expect(formatAgentResultForParent({ status: 'done', text: '' })).toContain('aucune réponse');
  });
  it('les échecs d\'outils apparaissent dans le message délivré', function() {
    var m = formatAgentResultForParent({
      status: 'done', text: 'je n\'ai pas pu',
      toolFailures: ['miaou__files__read : Fichier introuvable.'],
    });
    expect(m).toContain('Fichier introuvable.');
    expect(m).toContain('trousse corrigée');
  });
});

describe('buildAgentResultEntry — message user AUTHENTIQUE (X-1, Q1)', function() {
  it('role user, jamais _synthetic (l\'injection <miaou_context> doit pouvoir le viser)', function() {
    var e = buildAgentResultEntry({ id: 'a1', status: 'done', intent: 'Relire', text: 'ok' }, 42);
    expect(e.role).toBe('user');
    expect(e._synthetic === undefined).toBe(true);
    expect(e.ts).toBe(42);
  });
  it('porte un champ discriminant qui gouverne l\'AFFICHAGE, jamais le routage', function() {
    var e = buildAgentResultEntry({ id: 'a1', status: 'stopped', intent: 'Relire' }, 1);
    expect(e.agentResult.id).toBe('a1');
    expect(e.agentResult.status).toBe('stopped');
    expect(e.agentResult.intent).toBe('Relire');
  });
});

describe('buildAgentFirstMessage — cadrage puis tâche (X-1, mesure 1)', function() {
  it('le cadrage PRÉCÈDE la tâche (dernier texte lu = la tâche)', function() {
    var m = buildAgentFirstMessage('Compte les lignes du fichier.');
    expect(m.indexOf('outils sont exactement ceux de ton payload') < m.indexOf('Compte les lignes')).toBe(true);
  });
  it('ne liste AUCUN outil (le payload les porte déjà)', function() {
    var m = buildAgentFirstMessage('x');
    expect(m.indexOf('miaou__') < 0).toBe(true);
  });
  it('demande explicitement de signaler un outil manquant', function() {
    expect(buildAgentFirstMessage('x')).toContain('manque');
  });
  it('prompt vide ne casse pas', function() {
    expect(typeof buildAgentFirstMessage(null)).toBe('string');
  });
});

describe('agentStatus / setAgentTerminalStatus (X-1, Q5)', function() {
  it('un agent sans statut terminal et sans génération est « aborted » (reload)', function() {
    localStorage.clear();
    saveConversation({ id: 'a1', title: '', timestamp: 1, messages: [], parentConvId: 'p1' });
    expect(agentStatus('a1')).toBe('aborted');
  });
  it('le statut terminal persisté est restitué', function() {
    localStorage.clear();
    saveConversation({ id: 'a1', title: '', timestamp: 1, messages: [], parentConvId: 'p1' });
    setAgentTerminalStatus('a1', 'done');
    expect(agentStatus('a1')).toBe('done');
  });
  it('un statut hors de la liste des cinq est refusé', function() {
    localStorage.clear();
    saveConversation({ id: 'a1', title: '', timestamp: 1, messages: [], parentConvId: 'p1' });
    setAgentTerminalStatus('a1', 'running');   // jamais persisté : running est DÉRIVÉ
    expect(agentStatus('a1')).toBe('aborted');
  });
  it('ne ressuscite pas une conversation supprimée (piège 20)', function() {
    localStorage.clear();
    setAgentTerminalStatus('disparu', 'done');
    expect(loadConversation('disparu')).toBe(null);
  });
});

describe('resolveOwnedAgent — garde de parenté sans oracle (X-1, étape 3)', function() {
  function setup() {
    localStorage.clear();
    saveConversation({ id: 'p1', title: 'parent', timestamp: 1, messages: [] });
    saveConversation({ id: 'p2', title: 'autre parent', timestamp: 1, messages: [] });
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
    saveConversation({ id: 'a2', title: '', timestamp: 2, messages: [], parentConvId: 'p2' });
  }
  it('le parent résout SON agent', function() {
    setup();
    var r = resolveOwnedAgent('a1', { convId: 'p1', spaceId: 'default' });
    expect(!!r).toBe(true);
    expect(r.id).toBe('a1');
  });
  it('l\'agent d\'une AUTRE conversation → null, indistinguable d\'un inexistant', function() {
    setup();
    expect(resolveOwnedAgent('a2', { convId: 'p1', spaceId: 'default' })).toBe(null);
    expect(resolveOwnedAgent('jamais-existé', { convId: 'p1', spaceId: 'default' })).toBe(null);
  });
  it('une conversation RACINE n\'est pas un agent adressable', function() {
    setup();
    expect(resolveOwnedAgent('p2', { convId: 'p1', spaceId: 'default' })).toBe(null);
  });
  it('ctx sans convId → null (jamais de repli sur l\'écran, piège 28)', function() {
    setup();
    expect(resolveOwnedAgent('a1', {})).toBe(null);
    expect(resolveOwnedAgent('a1', null)).toBe(null);
  });
});

describe('convBadgeState étendu : un parent dont un agent travaille (X-1, étape 7)', function() {
  function setup() {
    localStorage.clear();
    _activeGenerations.clear();
    _unreadConvs.clear();
    saveConversation({ id: 'p1', title: 'parent', timestamp: 1, updatedAt: 1, messages: [], spaceId: 'sA' });
    saveConversation({ id: 'a1', title: '', timestamp: 2, updatedAt: 2, messages: [], spaceId: 'sA', parentConvId: 'p1' });
    saveConversation({ id: 'p2', title: 'autre', timestamp: 3, updatedAt: 3, messages: [], spaceId: 'sB' });
  }
  it('parent INERTE + enfant EN VOL → working', function() {
    setup();
    _activeGenerations.set('a1', { convId: 'a1', spaceId: 'sA' });
    expect(convBadgeState('p1')).toBe('working');
    _activeGenerations.clear();
  });
  it('parent inerte SANS enfant en vol → null', function() {
    setup();
    expect(convBadgeState('p1')).toBe(null);
  });
  it('priorité working > unread préservée', function() {
    setup();
    _unreadConvs.add('p1');
    expect(convBadgeState('p1')).toBe('unread');
    _activeGenerations.set('a1', { convId: 'a1', spaceId: 'sA' });
    expect(convBadgeState('p1')).toBe('working');
    _activeGenerations.clear();
    _unreadConvs.clear();
  });
  it('l\'enfant d\'une AUTRE conversation ne rend pas p1 working', function() {
    setup();
    saveConversation({ id: 'b1', title: '', timestamp: 4, updatedAt: 4, messages: [], spaceId: 'sB', parentConvId: 'p2' });
    _activeGenerations.set('b1', { convId: 'b1', spaceId: 'sB' });
    expect(convBadgeState('p1')).toBe(null);
    expect(convBadgeState('p2')).toBe('working');
    _activeGenerations.clear();
  });

  // ÉQUIVALENCE DES TROIS PRÉDICATS (le plan exige de trancher : ils sont
  // ALIGNÉS, les deux agrégats DÉRIVENT désormais de convBadgeState — le
  // commentaire qui l'affirmait depuis T-2 est enfin vrai).
  it('les deux agrégats voient le working d\'un parent à enfant actif', function() {
    setup();
    _activeGenerations.set('a1', { convId: 'a1', spaceId: 'sA' });
    expect(spaceBadgeState('sA')).toBe('working');
    expect(aggregateBadgeState(null)).toBe('working');
    // Vu depuis l'Espace sA, l'activité n'est PAS ailleurs.
    expect(aggregateBadgeState('sA')).toBe(null);
    _activeGenerations.clear();
  });
  it('un parent working par son enfant ne compte pas DEUX fois dans un agrégat', function() {
    // resolveActivityBadge réduit une liste d'états : working reste working.
    // L'assertion porte sur l'absence de troisième état, pas sur un compte.
    setup();
    _activeGenerations.set('a1', { convId: 'a1', spaceId: 'sA' });
    expect(spaceBadgeState('sA')).toBe('working');
    _activeGenerations.clear();
  });
  it('unread d\'un parent remonte encore aux agrégats après l\'alignement', function() {
    setup();
    _unreadConvs.add('p1');
    expect(spaceBadgeState('sA')).toBe('unread');
    expect(aggregateBadgeState(null)).toBe('unread');
    _unreadConvs.clear();
  });
  it('l\'agent lui-même n\'a AUCUNE surface propre : sa pastille est portée par le parent', function() {
    // Un agent est exclu de la sidebar (exclusion 3ter) : convBadgeState('a1')
    // vaut bien 'working', mais aucune ligne ne l'affiche — c'est précisément
    // ce qui rend l'extension nécessaire et non redondante.
    setup();
    _activeGenerations.set('a1', { convId: 'a1', spaceId: 'sA' });
    expect(convBadgeState('a1')).toBe('working');
    expect(isRootConversation(loadConversation('a1'))).toBe(false);
    _activeGenerations.clear();
  });
});

describe('countWorkingAgentsOf / countWorkingAgentsTotal (X-1, Q3)', function() {
  function setup() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [] });
    saveConversation({ id: 'p2', title: 'q', timestamp: 1, messages: [] });
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
    saveConversation({ id: 'a2', title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
    saveConversation({ id: 'b1', title: '', timestamp: 2, messages: [], parentConvId: 'p2' });
  }
  it('compte les agents en vol d\'une conversation', function() {
    setup();
    _activeGenerations.set('a1', { convId: 'a1' });
    _activeGenerations.set('b1', { convId: 'b1' });
    expect(countWorkingAgentsOf('p1')).toBe(1);
    expect(countWorkingAgentsOf('p2')).toBe(1);
    _activeGenerations.clear();
  });
  it('le total ne compte QUE les agents, pas les conversations racines', function() {
    // Une racine qui génère (l'utilisateur qui discute) n'occupe pas un slot
    // d'agent : la borne globale porte sur les agents, pas sur les générations.
    setup();
    _activeGenerations.set('p1', { convId: 'p1' });   // racine en vol
    _activeGenerations.set('a1', { convId: 'a1' });
    _activeGenerations.set('b1', { convId: 'b1' });
    expect(countWorkingAgentsTotal()).toBe(2);
    _activeGenerations.clear();
  });
  it('aucun agent en vol → 0', function() {
    setup();
    expect(countWorkingAgentsOf('p1')).toBe(0);
    expect(countWorkingAgentsTotal()).toBe(0);
  });
});

describe('parentThreadFor — LE prédicat de source du thread (X-1, étape 6)', function() {
  // Le vrai danger du lot : deux sources possibles pour le thread du parent
  // selon qu'il est affiché ou non. Un choix erroné écrase des messages.
  it('parent AFFICHÉ → currentThread, la MÊME RÉFÉRENCE', function() {
    localStorage.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [{ role: 'user', content: 'a' }] });
    var savedId = currentConvId, savedThread = currentThread;
    currentConvId = 'p1';
    currentThread = [{ role: 'user', content: 'a' }];
    expect(parentThreadFor('p1') === currentThread).toBe(true);
    currentConvId = savedId; currentThread = savedThread;
  });
  it('parent NON AFFICHÉ → projection du record, JAMAIS currentThread', function() {
    localStorage.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [{ role: 'user', content: 'du parent' }] });
    var savedId = currentConvId, savedThread = currentThread;
    currentConvId = 'autre';
    currentThread = [{ role: 'user', content: 'DE L\'ÉCRAN — ne doit jamais être rendu' }];
    var t = parentThreadFor('p1');
    expect(t === currentThread).toBe(false);
    expect(t.length).toBe(1);
    expect(t[0].content).toBe('du parent');
    currentConvId = savedId; currentThread = savedThread;
  });
});

describe('File des résultats d\'agent — DÉDIÉE (X-1, Q2)', function() {
  it('empile, rend et vide par conversation', function() {
    expect(hasPendingAgentResults('p1')).toBe(false);
    queueAgentResult('p1', { role: 'user', content: 'r1' });
    queueAgentResult('p1', { role: 'user', content: 'r2' });
    queueAgentResult('p2', { role: 'user', content: 'autre' });
    expect(hasPendingAgentResults('p1')).toBe(true);
    var batch = takePendingAgentResults('p1');
    expect(batch.length).toBe(2);
    expect(hasPendingAgentResults('p1')).toBe(false);
    // La file de p2 n'a pas été touchée : une file par conversation.
    expect(hasPendingAgentResults('p2')).toBe(true);
    takePendingAgentResults('p2');
  });
  it('drain d\'une file vide → tableau vide, jamais d\'exception', function() {
    expect(takePendingAgentResults('jamais-vu')).toEqual([]);
  });
  it('la file des résultats d\'agent est DISTINCTE de celle des interjections', function() {
    // Les deux files sont désormais clefées par conversation (X-1e : la file
    // d'interjections l'est devenue), mais elles restent DISTINCTES — ce que
    // ce test garde. Ce qui les sépare n'est plus leur condition de drain,
    // c'est ce qu'elles portent : une interjection est annulable, éditable et
    // reflue dans le composer à un arrêt ; un résultat d'agent est un fait
    // acquis, que personne ne peut retirer. Les fusionner ferait qu'un stop
    // utilisateur refoulerait dans le composer le compte rendu d'un agent.
    queueAgentResult('p9', { role: 'user', content: 'agent' });
    expect(interjectionsFor('p9').length).toBe(0);
    expect(hasPendingAgentResults('p9')).toBe(true);
    takePendingAgentResults('p9');
  });
});

describe('Suppression du parent : cascade et abort actif (X-1, étape 8 / X-c)', function() {
  it('supprimer le parent supprime ses agents en cascade', function() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [] });
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
    saveConversation({ id: 'a2', title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
    saveConversation({ id: 'p2', title: 'q', timestamp: 1, messages: [] });
    deleteConv('p1');
    expect(loadConversation('p1')).toBe(null);
    expect(loadConversation('a1')).toBe(null);
    expect(loadConversation('a2')).toBe(null);
    expect(!!loadConversation('p2')).toBe(true);   // une autre racine n'est pas touchée
  });
  it('un agent en vol est ABORTÉ activement, pas laissé tourner', function() {
    // persistGeneration ne ressusciterait pas la conversation (piège 20), donc
    // rien ne se corromprait — mais l'agent continuerait à consommer en silence.
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [] });
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
    var aborted = false;
    _activeGenerations.set('a1', { convId: 'a1', abort: { abort: function() { aborted = true; } } });
    deleteConv('p1');
    expect(aborted).toBe(true);
    _activeGenerations.clear();
  });
});

describe('Déplacement : refus si un enfant tourne, emport sinon (X-1, Q6 / X-a)', function() {
  function setup() {
    localStorage.clear();
    _activeGenerations.clear();
    _moveSelection = new Set();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'sA' });
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [], spaceId: 'sA', parentConvId: 'p1' });
  }
  it('un parent à enfant ACTIF est exclu de la présélection (jamais coché-grisé)', function() {
    // Sans l'exclusion : case cochée ET grisée — une sélection irrétractable,
    // dans une barre annonçant « 1 conversation » et un bouton qui échouerait.
    setup();
    var saved = currentConvId;
    currentConvId = 'p1';
    _activeGenerations.set('a1', { convId: 'a1' });
    enterMoveMode();
    expect(_moveSelection.has('p1')).toBe(false);
    expect(_moveSelection.size).toBe(0);
    exitMoveMode();
    _activeGenerations.clear();
    currentConvId = saved;
  });
  it('un parent SANS enfant actif reste présélectionné (comportement d\'origine)', function() {
    setup();
    var saved = currentConvId;
    currentConvId = 'p1';
    enterMoveMode();
    expect(_moveSelection.has('p1')).toBe(true);
    exitMoveMode();
    currentConvId = saved;
  });
  it('les enfants INERTES suivent leur parent', function() {
    setup();
    _moveSelection = new Set(['p1']);
    _moveMode = true;
    moveSelectedConversations('sB');
    expect(loadConversation('p1').spaceId).toBe('sB');
    expect(loadConversation('a1').spaceId).toBe('sB');   // sinon : agent orphelin de référentiel
  });
  it('un parent dont un enfant a démarré PENDANT le mode sélection n\'est pas déplacé', function() {
    // Fenêtre de réentrance (X-a) : la case grisée date du rendu de la liste,
    // pas du commit. La garde doit être relue à l'écriture.
    setup();
    _moveSelection = new Set(['p1']);
    _moveMode = true;
    _activeGenerations.set('a1', { convId: 'a1' });   // démarre après l'entrée dans le mode
    moveSelectedConversations('sB');
    expect(loadConversation('p1').spaceId).toBe('sA');
    expect(loadConversation('a1').spaceId).toBe('sA');
    _activeGenerations.clear();
  });
});

describe('AGENT_DOCTRINE — calibrage (X-1, étape 9)', function() {
  it('est dans ROOT_SYSTEM_PROMPT, inconditionnellement', function() {
    expect(ROOT_SYSTEM_PROMPT).toContain('miaou__agent__spawn');
    expect(ROOT_SYSTEM_PROMPT.indexOf(AGENT_DOCTRINE) >= 0).toBe(true);
  });
  it('énonce la PERMISSION avant l\'interdiction (sinon le modèle n\'ose plus)', function() {
    var permission = AGENT_DOCTRINE.indexOf('Lance-en un quand');
    var interdiction = AGENT_DOCTRINE.indexOf('fais le travail toi-même');
    expect(permission >= 0).toBe(true);
    expect(permission < interdiction).toBe(true);
  });
  it('nomme le motif VÉRIFIABLE (redémarrage à froid), pas seulement l\'interdit', function() {
    expect(AGENT_DOCTRINE).toContain('À FROID');
  });
  it('disqualifie les faux signaux nommément', function() {
    expect(AGENT_DOCTRINE).toContain('plusieurs angles');
    expect(AGENT_DOCTRINE).toContain('approfondie');
  });
  it('interdit de confabuler sur un agent en cours', function() {
    expect(AGENT_DOCTRINE).toContain('travaille encore');
  });
  it('annonce le réveil — capacité qui DOIT avoir son handle', function() {
    // « Tu seras prévenu » n'est vrai que parce que deliverAgentResult existe :
    // une capacité annoncée sans mécanisme serait un mensonge au modèle.
    expect(AGENT_DOCTRINE).toContain('prévenu automatiquement');
    expect(typeof deliverAgentResult).toBe('function');
  });
  it('renvoie vers la skill « agents » sans recopier aucune borne chiffrée', function() {
    // project_no_hardcoded_constant_in_system_skill_md : les bornes vivent dans
    // le JS et se font connaître par leur message de refus, qui les nomme.
    expect(AGENT_DOCTRINE).toContain('agents');
    expect(AGENT_DOCTRINE.indexOf(String(MAX_AGENT_TURNS)) < 0).toBe(true);
    expect(AGENT_DOCTRINE.indexOf('MAX_AGENTS') < 0).toBe(true);
  });
  it('n\'énonce aucune condition auto-évaluable (« si tu penses que… »)', function() {
    // Une condition que le modèle doit évaluer sur lui-même le fait s'abstenir
    // (project_model_facing_text_indicative_and_reachable, motif payé en V-8).
    expect(AGENT_DOCTRINE.indexOf('si tu penses') < 0).toBe(true);
    expect(AGENT_DOCTRINE.indexOf('si tu estimes') < 0).toBe(true);
  });
});

describe('toolDefinitions : restriction de payload d\'un agent (X-1, étapes 3-4)', function() {
  it('sans liste blanche, tout est exposé, ask_confirmation compris', function() {
    var names = toolDefinitions().map(function(d) { return d.function.name; });
    expect(names.indexOf('miaou__agent__spawn') >= 0).toBe(true);
    expect(names.indexOf('ask_confirmation') >= 0).toBe(true);
  });
  it('avec liste blanche, seuls les outils délégués sont dans le payload', function() {
    // Les outils non délégués sont ABSENTS, pas « appelables et refusés ».
    var names = toolDefinitions(['miaou__js__eval']).map(function(d) { return d.function.name; });
    expect(names).toEqual(['miaou__js__eval']);
  });
  it('ask_confirmation N\'EST PAS exposé à un agent', function() {
    // Un agent n'a pas d'utilisateur à qui poser une question : l'exposer serait
    // annoncer un handle inatteignable.
    var names = toolDefinitions([]).map(function(d) { return d.function.name; });
    expect(names).toEqual([]);
  });
  it('liste blanche vide ≠ absence de liste blanche', function() {
    expect(toolDefinitions([]).length).toBe(0);
    expect(toolDefinitions().length > 0).toBe(true);
  });
});

describe('agentDelegatableToolNames — aucun agent__* délégable (X-1, X-b)', function() {
  it('exclut les quatre outils agent__*', function() {
    var names = agentDelegatableToolNames();
    expect(names.indexOf('miaou__agent__spawn') < 0).toBe(true);
    expect(names.indexOf('miaou__agent__status') < 0).toBe(true);
    expect(names.indexOf('miaou__agent__result') < 0).toBe(true);
    expect(names.indexOf('miaou__agent__abort') < 0).toBe(true);
  });
  it('laisse passer les outils ordinaires', function() {
    expect(agentDelegatableToolNames().indexOf('miaou__js__eval') >= 0).toBe(true);
  });
});

describe('agent__spawn : le défaut de reasoning_effort est RÉELLEMENT appliqué (X-1, X-h)', function() {
  // Le piège de l'astuce : un schéma qui annonce un niveau pendant que le code
  // retombe sur '' est project_doc_promises_intent_code_never_confronted — ça
  // n'échoue jamais, et un lot suivant le fossilise. Un test dédié, pas une
  // relecture. Une seule source pour les deux (agentDefaultReasoningEffort).
  it('la description ANNONCE le niveau courant de la conversation', function() {
    localStorage.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], reasoningEffort: 'high' });
    var def = agentSpawnToolDef({ convId: 'p1', spaceId: 'default' });
    expect(def.inputSchema.properties.reasoning_effort.description).toContain('high');
  });
  it('le HANDLER applique exactement ce que la description annonce', function() {
    localStorage.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], reasoningEffort: 'high' });
    expect(agentDefaultReasoningEffort({ convId: 'p1', spaceId: 'default' })).toBe('high');
  });
  it('sans override de conversation, retombe sur le réglage global', function() {
    localStorage.clear();
    saveSettings({ reasoningEffort: 'low' });
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [] });
    expect(agentDefaultReasoningEffort({ convId: 'p1', spaceId: 'default' })).toBe('low');
    expect(agentSpawnToolDef({ convId: 'p1', spaceId: 'default' })
      .inputSchema.properties.reasoning_effort.description).toContain('low');
  });
  it('aucun niveau nulle part → la description ne promet pas une valeur inexistante', function() {
    localStorage.clear();
    saveSettings({ reasoningEffort: '' });
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [] });
    expect(agentDefaultReasoningEffort({ convId: 'p1', spaceId: 'default' })).toBe('');
    var d = agentSpawnToolDef({ convId: 'p1', spaceId: 'default' })
      .inputSchema.properties.reasoning_effort.description;
    expect(d).toContain('celui de l\'application');
  });
  it('la description ne dit JAMAIS que le défaut est celui du parent', function() {
    // L'astuce X-h : le modèle lit une valeur par défaut comme dans n'importe
    // quel schéma. Lui dire d'où elle sort ajouterait au contexte une
    // information sur LUI-MÊME, dont il tirerait des conclusions (motif V-8).
    localStorage.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], reasoningEffort: 'high' });
    var d = agentSpawnToolDef({ convId: 'p1', spaceId: 'default' })
      .inputSchema.properties.reasoning_effort.description;
    expect(d.indexOf('le tien') < 0).toBe(true);
    expect(d.indexOf('ton niveau') < 0).toBe(true);
  });
});

describe('Les quatre handlers agent__* : garde de parenté partagée (X-1, étape 3)', function() {
  function setup() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [] });
    saveConversation({ id: 'p2', title: 'q', timestamp: 1, messages: [] });
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [], parentConvId: 'p1',
      agentIntent: 'Relire le brief', agentStatus: 'done' });
    saveConversation({ id: 'a2', title: '', timestamp: 2, messages: [], parentConvId: 'p2' });
  }
  function call(name, args) {
    return callInternalTool(name, args, { convId: 'p1', spaceId: 'default' });
  }
  it('agent inexistant et agent ÉTRANGER rendent le MÊME message (pas d\'oracle)', function() {
    setup();
    var foreign = call('agent__status', { id: 'a2' }).content[0].text;
    var missing = call('agent__status', { id: 'jamais-existé' }).content[0].text;
    expect(foreign).toBe(missing);
    expect(foreign).toContain('introuvable');
  });
  it('l\'indistinguabilité vaut pour les quatre outils', function() {
    setup();
    var tools = ['agent__status', 'agent__result', 'agent__abort'];
    for (var i = 0; i < tools.length; i++) {
      var f = call(tools[i], { id: 'a2' }).content[0].text;
      var m = call(tools[i], { id: 'inconnu' }).content[0].text;
      expect(f).toBe(m);
    }
  });
  it('agent__status rend l\'état de SON agent', function() {
    setup();
    var out = JSON.parse(call('agent__status', { id: 'a1' }).content[0].text);
    expect(out.id).toBe('a1');
    expect(out.status).toBe('done');
    expect(out.intent).toBe('Relire le brief');
  });
  it('agent__result rend le résultat formaté, avec le statut', function() {
    setup();
    var txt = call('agent__result', { id: 'a1' }).content[0].text;
    expect(txt).toContain('Relire le brief');
    expect(txt).toContain('terminé');
  });
  it('agent__abort sur un agent déjà terminé le dit, sans échouer', function() {
    setup();
    expect(call('agent__abort', { id: 'a1' }).content[0].text).toContain('déjà terminé');
  });
  it('conv__get atteint l\'agent du parent (« pas trouvable » ≠ « pas atteignable »)', function() {
    setup();
    var out = JSON.parse(call('conv__get', { id: 'a1' }).content[0].text);
    expect(out.id).toBe('a1');
    expect(out.intent).toBe('Relire le brief');
  });
  it('conv__get sur l\'agent d\'une AUTRE conversation répond comme inexistant', function() {
    setup();
    var foreign = call('conv__get', { id: 'a2' }).content[0].text;
    expect(foreign).toContain('introuvable');
  });
});

describe('agent__spawn : bornes et refus (X-1, Q3)', function() {
  function setup() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [] });
  }
  it('un AGENT ne peut pas lancer d\'agent (X-b), même hors validation de liste', function() {
    setup();
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
    var out = callInternalTool('agent__spawn',
      { prompt: 'fais', intent: 'fais' }, { convId: 'a1', spaceId: 'default' });
    expect(out.content[0].text).toContain('profondeur');
  });
  it('prompt ou intent manquant → refus explicite', function() {
    setup();
    var c = { convId: 'p1', spaceId: 'default' };
    expect(callInternalTool('agent__spawn', { intent: 'x' }, c).content[0].text).toContain('prompt');
    expect(callInternalTool('agent__spawn', { prompt: 'x' }, c).content[0].text).toContain('intent');
  });
  it('outil inconnu → refus listant les noms valides', function() {
    setup();
    var out = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y', tools: ['nawak'] }, { convId: 'p1', spaceId: 'default' });
    expect(out.content[0].text).toContain('nawak');
    expect(out.content[0].text).toContain('miaou__js__eval');
  });
});

describe('agent__spawn : les deux bornes refusent EFFECTIVEMENT (X-1, Q3)', function() {
  // agentSpawnLimitError est testée pure plus haut ; ici on vérifie le CÂBLAGE —
  // que le handler la consulte réellement avec les bons comptes, et pas qu'elle
  // existe sans être appelée (project_quickjs_tests_dont_cover_orchestration_scope).
  function seed(nPerConv, nOther) {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [] });
    saveConversation({ id: 'p2', title: 'q', timestamp: 1, messages: [] });
    for (var i = 0; i < nPerConv; i++) {
      saveConversation({ id: 'a' + i, title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
      _activeGenerations.set('a' + i, { convId: 'a' + i });
    }
    for (var j = 0; j < nOther; j++) {
      saveConversation({ id: 'b' + j, title: '', timestamp: 2, messages: [], parentConvId: 'p2' });
      _activeGenerations.set('b' + j, { convId: 'b' + j });
    }
  }
  function spawn() {
    return callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y' }, { convId: 'p1', spaceId: 'default' }).content[0].text;
  }
  it('au-delà de MAX_AGENTS_PER_CONV, le refus nomme la borne PAR CONVERSATION', function() {
    seed(MAX_AGENTS_PER_CONV, 0);
    var out = spawn();
    expect(out).toContain('cette conversation');
    expect(out).toContain(String(MAX_AGENTS_PER_CONV));
    _activeGenerations.clear();
  });
  it('au-delà de MAX_AGENTS_TOTAL, le refus nomme la borne GLOBALE', function() {
    // Un seul agent sur p1 (sous la borne par conversation), mais la machine est
    // saturée par ceux d'ailleurs : c'est bien l'autre borne qui doit parler.
    seed(1, MAX_AGENTS_TOTAL - 1);
    var out = spawn();
    expect(out).toContain('total');
    expect(out).toContain(String(MAX_AGENTS_TOTAL));
    _activeGenerations.clear();
  });
  it('sous les deux bornes, le lancement n\'est pas refusé', function() {
    seed(0, 0);
    var out = spawn();
    expect(out.indexOf('Refusé') < 0).toBe(true);
    expect(out).toContain('Agent lancé');
    _activeGenerations.clear();
  });
  it('un agent lancé hérite du Space du CTX, jamais de l\'écran (piège 28)', function() {
    localStorage.clear();
    _activeGenerations.clear();
    var saved = activeSpaceId;
    activeSpaceId = 'ECRAN';   // l'écran est ailleurs
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'sGEN' });
    var out = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y' }, { convId: 'p1', spaceId: 'sGEN' }).content[0].text;
    var id = out.match(/identifiant : (\S+?)\./)[1];
    expect(loadConversation(id).spaceId).toBe('sGEN');
    expect(loadConversation(id).parentConvId).toBe('p1');
    activeSpaceId = saved;
    _activeGenerations.clear();
  });
  it('un agent naît sans titre, avec son intent comme libellé, et jamais titré', function() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'default' });
    var out = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'Relire le Brief' }, { convId: 'p1', spaceId: 'default' }).content[0].text;
    var id = out.match(/identifiant : (\S+?)\./)[1];
    var conv = loadConversation(id);
    expect(conv.title).toBe('');
    // Casse JAMAIS normalisée : le libellé appartient au modèle.
    expect(conv.agentIntent).toBe('Relire le Brief');
    _activeGenerations.clear();
  });
  it('le premier message de l\'agent porte le cadrage PUIS la tâche', function() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'default' });
    var out = callInternalTool('agent__spawn',
      { prompt: 'MA TACHE PRECISE', intent: 'y' }, { convId: 'p1', spaceId: 'default' }).content[0].text;
    var id = out.match(/identifiant : (\S+?)\./)[1];
    var gen = generationFor(id);
    var first = gen.thread[0];
    expect(first.role).toBe('user');
    expect(first.content).toContain('MA TACHE PRECISE');
    expect(first.content.indexOf('payload') < first.content.indexOf('MA TACHE PRECISE')).toBe(true);
    _activeGenerations.clear();
  });
  it('le retour du spawn dit explicitement que le tour continue', function() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'default' });
    var out = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y' }, { convId: 'p1', spaceId: 'default' }).content[0].text;
    expect(out).toContain('ne l\'attends pas');
    expect(out).toContain('aucun');   // trousse vide par défaut, dite explicitement
    _activeGenerations.clear();
  });
});

// ── Fichiers délégués à un agent (X-1b) ──────────────────────────────────────
// Le trou fermé ici : un agent démarre dans SA conversation, où aucun handle du
// parent ne résout — et le parent ne peut pas non plus lui recopier le contenu
// d'un binaire, qu'il n'a lui-même qu'en descripteur.

describe('agentDelegatedAlias (X-1b)', function() {
  it('réécrit les trois familles de record en un handle res_ unique', function() {
    expect(agentDelegatedAlias('att_abc123')).toBe('res_abc123');
    expect(agentDelegatedAlias('file_def456')).toBe('res_def456');
    expect(agentDelegatedAlias('res_ghi789')).toBe('res_ghi789');
  });
  it('est déterministe : deux appels rendent le même alias', function() {
    expect(agentDelegatedAlias('att_x1') === agentDelegatedAlias('att_x1')).toBe(true);
  });
  it('produit un handle que classifyHandleRef reconnaît comme une ressource', function() {
    // PRÉMISSE du choix de forme : sans cela, l'alias serait une quatrième
    // famille à ajouter partout (project_test_must_assert_its_own_premise).
    expect(classifyHandleRef(agentDelegatedAlias('att_abc123'))).toBe('resource');
    expect(classifyHandleRef(agentDelegatedAlias('file_def456'))).toBe('resource');
  });
  it('rend une chaîne vide sur une entrée vide', function() {
    expect(agentDelegatedAlias('')).toBe('');
    expect(agentDelegatedAlias(null)).toBe('');
  });
});

describe('buildAgentDelegatedFiles (X-1b)', function() {
  var recA = { id: 'att_aaa', name: 'rapport.pdf', mime: 'application/pdf', size: 2048 };
  var recB = { id: 'file_bbb', name: 'data.csv', mime: 'text/csv', size: 512 };
  it('défaut : aucun fichier', function() {
    expect(buildAgentDelegatedFiles(null)).toEqual({ ok: true, files: [] });
    expect(buildAgentDelegatedFiles([])).toEqual({ ok: true, files: [] });
  });
  it('fige l\'id de record et l\'alias, en gardant le handle parent pour la trace', function() {
    var r = buildAgentDelegatedFiles([{ ref: 'att-3', record: recA }]);
    expect(r.ok).toBe(true);
    expect(r.files.length).toBe(1);
    expect(r.files[0].recordId).toBe('att_aaa');
    expect(r.files[0].alias).toBe('res_aaa');
    expect(r.files[0].ref).toBe('att-3');
    expect(r.files[0].name).toBe('rapport.pdf');
  });
  it('handle non résolu → REFUS qui NOMME le handle fautif', function() {
    // Le silence laisserait le parent croire le fichier transmis ET l'agent
    // conclure à son absence : deux récits faux pour un seul geste.
    var r = buildAgentDelegatedFiles([{ ref: 'att-9', record: null }]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('att-9');
  });
  it('un refus porte sur TOUT le lot : rien n\'est délégué à moitié', function() {
    var r = buildAgentDelegatedFiles([{ ref: 'att-3', record: recA }, { ref: 'att-9', record: null }]);
    expect(r.ok).toBe(false);
  });
  it('déduplique deux handles qui désignent le même record', function() {
    var r = buildAgentDelegatedFiles([{ ref: 'att-3', record: recA }, { ref: 'res_aaa', record: recA }]);
    expect(r.ok).toBe(true);
    expect(r.files.length).toBe(1);
  });
  it('non-tableau → refus explicite', function() {
    expect(buildAgentDelegatedFiles('att-3').ok).toBe(false);
  });
  it('deux records distincts gardent deux alias distincts', function() {
    var r = buildAgentDelegatedFiles([{ ref: 'att-3', record: recA }, { ref: 'file-bbb', record: recB }]);
    expect(r.files.length).toBe(2);
    expect(r.files[0].alias === r.files[1].alias).toBe(false);
  });
});

describe('resolveDelegatedRecordId — la borne du partage (X-1b)', function() {
  var files = [{ alias: 'res_aaa', recordId: 'att_aaa' }];
  it('résout un alias présent dans la table', function() {
    expect(resolveDelegatedRecordId('res_aaa', files)).toBe('att_aaa');
  });
  it('un handle ABSENT de la table ne résout rien, même bien formé', function() {
    // C'est la borne : un agent n'atteint QUE ce que son parent a nommé.
    expect(resolveDelegatedRecordId('res_zzz', files)).toBe(null);
  });
  it('table vide ou absente → rien', function() {
    expect(resolveDelegatedRecordId('res_aaa', [])).toBe(null);
    expect(resolveDelegatedRecordId('res_aaa', null)).toBe(null);
  });
});

describe('formatAgentDelegatedFilesBlock — annoncer avec le handle (X-1b)', function() {
  it('liste chaque fichier AVEC son handle atteignable', function() {
    var b = formatAgentDelegatedFilesBlock([
      { alias: 'res_aaa', name: 'rapport.pdf', mime: 'application/pdf', size: 2048 }]);
    expect(b).toContain('rapport.pdf');
    expect(b).toContain('res_aaa');
  });
  it('rien de délégué → bloc VIDE, pas une phrase « aucun fichier »', function() {
    expect(formatAgentDelegatedFilesBlock([])).toBe('');
    expect(formatAgentDelegatedFilesBlock(null)).toBe('');
  });
});

describe('buildAgentFirstMessage — ordre cadrage / fichiers / tâche (X-1b)', function() {
  it('le bloc fichiers s\'intercale entre le cadrage et la tâche', function() {
    var files = [{ alias: 'res_aaa', name: 'r.pdf', mime: 'application/pdf', size: 10 }];
    var m = buildAgentFirstMessage('MA TACHE', files);
    expect(m.indexOf('res_aaa') > m.indexOf('Tu es un agent')).toBe(true);
    expect(m.indexOf('MA TACHE') > m.indexOf('res_aaa')).toBe(true);
  });
  it('sans fichier, le message est exactement celui d\'avant X-1b', function() {
    // Contrôle négatif : la nouveauté ne doit rien coûter au cas nominal.
    var m = buildAgentFirstMessage('MA TACHE', []);
    expect(m).toBe(AGENT_SCOPE_NOTICE + AGENT_TASK_SEPARATOR + 'MA TACHE');
  });
});

describe('agent__spawn délègue des fichiers (X-1b, bout en bout)', function() {
  it('un handle du parent devient un alias résolvable DANS l\'agent', function() {
    localStorage.clear();
    _activeGenerations.clear();
    _resourceCache['att_del1'] = { id: 'att_del1', attId: 'att-1', conversationId: 'p1',
      class: 'inline', mime: 'text/plain', name: 'notes.txt', size: 4,
      data: new Uint8Array([116, 101, 115, 116]).buffer };
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'default' });

    // PRÉMISSE : sans délégation, l'agent ne résout RIEN — c'est le trou fermé.
    var outBare = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y' }, { convId: 'p1', spaceId: 'default' }).content[0].text;
    var bareId = outBare.match(/identifiant : (\S+?)\./)[1];
    expect(resolveHandleRecord('att-1', { convId: bareId, spaceId: 'default' })).toBe(null);

    var out = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y', attachments: ['att-1'] },
      { convId: 'p1', spaceId: 'default' }).content[0].text;
    var id = out.match(/identifiant : (\S+?)\./)[1];
    expect(out).toContain('res_del1');
    expect(out).toContain('notes.txt');

    var rec = resolveHandleRecord('res_del1', { convId: id, spaceId: 'default' });
    expect(!!rec).toBe(true);
    expect(rec.id).toBe('att_del1');

    // Le cadrage le lui annonce, avec le handle.
    expect(generationFor(id).thread[0].content).toContain('res_del1');

    delete _resourceCache['att_del1'];
    _activeGenerations.clear();
  });

  it('un handle NON délégué reste introuvable dans l\'agent', function() {
    localStorage.clear();
    _activeGenerations.clear();
    _resourceCache['att_del2'] = { id: 'att_del2', attId: 'att-1', conversationId: 'p1',
      class: 'inline', mime: 'text/plain', name: 'a.txt', size: 1, data: new Uint8Array([1]).buffer };
    _resourceCache['att_del3'] = { id: 'att_del3', attId: 'att-2', conversationId: 'p1',
      class: 'inline', mime: 'text/plain', name: 'b.txt', size: 1, data: new Uint8Array([2]).buffer };
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'default' });
    var out = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y', attachments: ['att-1'] },
      { convId: 'p1', spaceId: 'default' }).content[0].text;
    var id = out.match(/identifiant : (\S+?)\./)[1];
    expect(!!resolveHandleRecord('res_del2', { convId: id, spaceId: 'default' })).toBe(true);
    // att-2 existe, appartient au parent, mais n'a PAS été délégué.
    expect(resolveHandleRecord('res_del3', { convId: id, spaceId: 'default' })).toBe(null);
    delete _resourceCache['att_del2'];
    delete _resourceCache['att_del3'];
    _activeGenerations.clear();
  });

  it('un handle que le PARENT ne peut pas adresser → refus nommant le handle', function() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'default' });
    var r = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y', attachments: ['att-42'] },
      { convId: 'p1', spaceId: 'default' });
    expect(r.content[0].text).toContain('att-42');
    // Aucun agent n'a été lancé.
    expect(_activeGenerations.size).toBe(0);
    _activeGenerations.clear();
  });

  it('la dérogation ne s\'ouvre PAS pour une conversation racine', function() {
    // Contrôle négatif central : X-1b n'élargit le scope de personne d'autre
    // que l'agent. Une racine qui porterait agentFiles ne doit rien résoudre.
    localStorage.clear();
    _activeGenerations.clear();
    _resourceCache['att_del4'] = { id: 'att_del4', attId: 'att-1', conversationId: 'other',
      class: 'inline', mime: 'text/plain', name: 'c.txt', size: 1, data: new Uint8Array([3]).buffer };
    saveConversation({ id: 'root1', title: 'r', timestamp: 1, messages: [], spaceId: 'default',
      agentFiles: [{ alias: 'res_del4', recordId: 'att_del4', name: 'c.txt', mime: 'text/plain', size: 1 }] });
    expect(agentDelegatedFilesOf('root1')).toEqual([]);
    expect(resolveHandleRecord('res_del4', { convId: 'root1', spaceId: 'default' })).toBe(null);
    delete _resourceCache['att_del4'];
    _activeGenerations.clear();
  });

  it('la table survit au reload : lue depuis le record quand la génération est finie', function() {
    localStorage.clear();
    _activeGenerations.clear();
    _resourceCache['att_del5'] = { id: 'att_del5', attId: 'att-1', conversationId: 'p1',
      class: 'inline', mime: 'text/plain', name: 'd.txt', size: 1, data: new Uint8Array([4]).buffer };
    saveConversation({ id: 'p1', title: 'p', timestamp: 1, messages: [], spaceId: 'default' });
    var out = callInternalTool('agent__spawn',
      { prompt: 'x', intent: 'y', attachments: ['att-1'] },
      { convId: 'p1', spaceId: 'default' }).content[0].text;
    var id = out.match(/identifiant : (\S+?)\./)[1];
    _activeGenerations.clear();   // plus aucune génération en vol
    expect(resolveDelegatedRecordId('res_del5', agentDelegatedFilesOf(id))).toBe('att_del5');
    delete _resourceCache['att_del5'];
  });
});

describe('isFinishedAgentConv — cause (b) du readonly (X-1e)', function() {
  function setup() {
    localStorage.clear();
    _activeGenerations.clear();
    saveConversation({ id: 'p1', title: 'parent', timestamp: 1, messages: [] });
    saveConversation({ id: 'a1', title: '', timestamp: 2, messages: [], parentConvId: 'p1' });
  }
  it('un agent AU TRAVAIL n\'est pas en lecture seule', function() {
    setup();
    _activeGenerations.set('a1', { convId: 'a1', spaceId: 'default' });
    expect(isFinishedAgentConv('a1')).toBe(false);
  });
  it('les CINQ statuts terminaux ferment le fil, sans exception', function() {
    // Aucune distinction parmi eux : dans les cinq cas deliverAgentResult a
    // notifié le parent et la génération est finie. Trancher ici ferait un
    // second prédicat de statut, concurrent d'agentStatus.
    var statuses = ['done', 'exhausted', 'aborted', 'stopped', 'error'];
    for (var i = 0; i < statuses.length; i++) {
      setup();
      setAgentTerminalStatus('a1', statuses[i]);
      expect(isFinishedAgentConv('a1')).toBe(true);
    }
  });
  it('un agent rechargé (aucun statut, aucune génération) est fermé', function() {
    // agentStatus retombe sur 'aborted' au reload : la génération n'a pas
    // survécu, personne n'a écrit de statut. Le fil ne repartira jamais.
    setup();
    expect(isFinishedAgentConv('a1')).toBe(true);
  });
  it('une conversation RACINE n\'est jamais fermée par ce prédicat', function() {
    // Même inerte, même sans génération : une racine se poursuit à volonté.
    // C'est la garde qui empêche la cause (b) de déborder sur tout le monde.
    setup();
    expect(isFinishedAgentConv('p1')).toBe(false);
  });
  it('id absent ou inconnu → false, jamais d\'exception', function() {
    setup();
    expect(isFinishedAgentConv(null)).toBe(false);
    expect(isFinishedAgentConv('')).toBe(false);
    expect(isFinishedAgentConv('jamais-vu')).toBe(false);
  });
});

describe('File d\'interjections clefée par conversation (X-1e)', function() {
  function reset() {
    _pendingInterjections.clear();
  }
  it('deux conversations ont deux files indépendantes', function() {
    reset();
    _pendingInterjections.set('c1', [{ id: 'i1', literal: 'pour c1' }]);
    _pendingInterjections.set('c2', [{ id: 'i2', literal: 'pour c2' }]);
    expect(interjectionsFor('c1').length).toBe(1);
    expect(interjectionsFor('c1')[0].literal).toBe('pour c1');
    expect(interjectionsFor('c2')[0].literal).toBe('pour c2');
  });
  it('drainer une conversation ne touche PAS l\'autre', function() {
    // Le cœur de la révision : sous la forme « état d'écran », un drain
    // emportait la file quel que soit le fil qui l'avait reçue.
    reset();
    _pendingInterjections.set('c1', [{ id: 'i1', literal: 'a' }]);
    _pendingInterjections.set('c2', [{ id: 'i2', literal: 'b' }]);
    var batch = takePendingInterjections('c1');
    expect(batch.length).toBe(1);
    expect(interjectionsFor('c1').length).toBe(0);
    expect(interjectionsFor('c2').length).toBe(1);
  });
  it('le drain VIDE la clef plutôt que d\'y laisser un tableau vide', function() {
    // Sans ça la Map croît d'une entrée morte par conversation visitée, et
    // `has` mentirait sur l'existence d'une file.
    reset();
    _pendingInterjections.set('c1', [{ id: 'i1', literal: 'a' }]);
    takePendingInterjections('c1');
    expect(_pendingInterjections.has('c1')).toBe(false);
  });
  it('drain d\'une conversation sans file → tableau vide, jamais d\'exception', function() {
    reset();
    expect(takePendingInterjections('jamais-vu')).toEqual([]);
    expect(takePendingInterjections(null)).toEqual([]);
  });
  it('interjectionsFor sans conversation (accueil) rend une liste vide', function() {
    reset();
    expect(interjectionsFor(null).length).toBe(0);
    expect(interjectionsFor('').length).toBe(0);
  });
  it('une conversation d\'AGENT a une file comme les autres (X-1f)', function() {
    // X-1e refusait la mise en file dans un fil d'agent, parce qu'un agent
    // câblait `onInterjections: () => null`. Les deux sont tombés ensemble : le
    // registre n'a jamais eu de notion de type de conversation, et c'est ce qui
    // rend la levée mécanique — rien ici ne distinguait le cas.
    reset();
    localStorage.clear();
    saveConversation({ id: 'p9', title: 'parent', timestamp: 1, messages: [] });
    saveConversation({ id: 'a9', title: '', timestamp: 2, messages: [], parentConvId: 'p9' });
    _pendingInterjections.set('a9', [{ id: 'i9', literal: 'corrige le tir' }]);
    expect(isAgentConversation(loadConversation('a9'))).toBe(true);
    expect(interjectionsFor('a9').length).toBe(1);
    var batch = takePendingInterjections('a9');
    expect(batch.length).toBe(1);
    expect(batch[0].literal).toBe('corrige le tir');
  });
});

describe('Entrée d\'interjection drainée par un agent (X-1f)', function() {
  // Le drain d'un agent (agents.js) et celui de l'écran (main.js) construisent
  // leur entrée de thread par la MÊME fonction pure. Ce qui est testable ici est
  // cette entrée ; le câblage des deux hooks, lui, relève du verify e2e (les
  // tests QuickJS ne couvrent pas l'orchestration).
  it('un littéral sans skill donne une entrée user sans displayText', function() {
    var e = buildInterjectionEntry('corrige le tir', 'corrige le tir', 1234);
    expect(e.role).toBe('user');
    expect(e.content).toBe('corrige le tir');
    expect(e.ts).toBe(1234);
    expect('displayText' in e).toBe(false);
  });
  it('une skill bakée garde le littéral en displayText', function() {
    // Doctrine displayText : content = ce qui part sur le fil, displayText = ce
    // que l'utilisateur a tapé. C'est aussi ce qui rend l'entrée byte-stable au
    // rejeu (expandThread relit content tel quel).
    var e = buildInterjectionEntry('/relire le brief', '<skill>…</skill>\nrelire le brief', 5);
    expect(e.content).toBe('<skill>…</skill>\nrelire le brief');
    expect(e.displayText).toBe('/relire le brief');
  });
  it('plusieurs littéraux fusionnent en UN message, jamais N', function() {
    // Arbitrage lot Q, inchangé : le fil d'un agent ne doit pas plus recevoir
    // deux messages user consécutifs que celui d'une conversation racine.
    var lit = joinInterjectionLiterals(['d\'abord ceci', 'puis cela']);
    expect(lit).toBe('d\'abord ceci\n\npuis cela');
    var e = buildInterjectionEntry(lit, lit, 7);
    expect(e.role).toBe('user');
    expect(e.content).toContain('puis cela');
  });
});

describe('agentResultBodyHtml — repli du compte rendu (X-1e)', function() {
  it('rend un <details> FERMÉ par défaut', function() {
    // Le repli par défaut est le point de la feature : un compte rendu long
    // arrivant au milieu du fil du parent y noierait la conversation.
    var h = agentResultBodyHtml('texte', { intent: 'Relire', status: 'done' });
    expect(h.indexOf('<details') >= 0).toBe(true);
    expect(h.indexOf('open>') >= 0).toBe(false);
    expect(h.indexOf(' open ') >= 0).toBe(false);
  });
  it('l\'en-tête est DANS le summary — zone de clic complète, sans JS', function() {
    // Imbriqué et non frère : c'est ce qui rend tout le bandeau cliquable au
    // repli comme au dépli (piège <details>/<summary>).
    var h = agentResultBodyHtml('x', { intent: 'i', status: 'done' });
    var sum = h.indexOf('<summary>');
    var head = h.indexOf('agent-result-head');
    var endSum = h.indexOf('</summary>');
    expect(sum >= 0 && head > sum && head < endSum).toBe(true);
  });
  it('porte l\'intent, seule chose lisible une fois replié', function() {
    var h = agentResultBodyHtml('corps', { intent: 'Relire le brief', status: 'done' });
    expect(h).toContain('Relire le brief');
  });
  it('échappe intent et statut — chaînes d\'origine MODÈLE (piège 21)', function() {
    var h = agentResultBodyHtml('corps', { intent: '<img src=x onerror=alert(1)>', status: 'done' });
    expect(h.indexOf('<img') >= 0).toBe(false);
    expect(h).toContain('&lt;img');
  });
  it('affiche le libellé UTILISATEUR du statut, pas celui du modèle', function() {
    // Les deux tables sont distinctes : « interrompu par toi » (modèle) désigne
    // le modèle qui a appelé agent__abort, pas le lecteur humain.
    var h = agentResultBodyHtml('c', { intent: 'i', status: 'aborted' });
    expect(h).toContain(AGENT_STATUS_UI_LABELS.aborted);
    expect(h.indexOf('agent__abort') >= 0).toBe(false);
  });
  it('un statut inconnu n\'affiche pas de libellé plutôt qu\'un « undefined »', function() {
    var h = agentResultBodyHtml('c', { intent: 'i', status: 'zzz' });
    expect(h.indexOf('undefined') >= 0).toBe(false);
  });
  it('sans intent, retombe sur un libellé générique (jamais un bandeau nu)', function() {
    var h = agentResultBodyHtml('c', {});
    expect(h).toContain('Agent');
  });
  it('descripteur absent → pas d\'exception', function() {
    expect(typeof agentResultBodyHtml('c', null)).toBe('string');
  });
});

describe('exposedTools résout les définitions dynamiques (X-1e)', function() {
  it('agent__spawn y porte sa VRAIE description, pas la chaîne vide de TOOLS', function() {
    // Dans TOOLS, agent__spawn a `description: ''` et un inputSchema vide : sa
    // définition est construite par agentSpawnToolDef. Tant que la résolution
    // vivait chez l'appelant (toolDefinitions), le drawer — qui lit
    // exposedTools() — affichait un outil vide.
    var t = exposedTools().find(function(x) { return x.name === 'miaou__agent__spawn'; });
    expect(!!t).toBe(true);
    expect(t.description.length > 50).toBe(true);
    expect(t.description).toContain('sous-conversation autonome');
  });
  it('et ses paramètres, prompt et intent en tête', function() {
    var t = exposedTools().find(function(x) { return x.name === 'miaou__agent__spawn'; });
    var props = Object.keys((t.inputSchema && t.inputSchema.properties) || {});
    expect(props.indexOf('prompt') >= 0).toBe(true);
    expect(props.indexOf('intent') >= 0).toBe(true);
    expect((t.inputSchema.required || []).indexOf('prompt') >= 0).toBe(true);
  });
  it('le payload modèle en dérive : UNE source, pas deux', function() {
    // Le contrôle qui compte : si les deux chemins se remettaient à construire
    // la définition séparément, ils divergeraient en silence.
    var exposed = exposedTools().find(function(x) { return x.name === 'miaou__agent__spawn'; });
    var payload = toolDefinitions().find(function(d) { return d.function.name === 'miaou__agent__spawn'; });
    expect(!!payload).toBe(true);
    expect(payload.function.description).toBe(exposed.description);
  });
  it('(contrôle) un outil à définition STATIQUE traverse inchangé', function() {
    // La résolution dynamique ne doit toucher qu'agent__spawn : sans ce
    // contrôle, une substitution trop large passerait inaperçue.
    var t = exposedTools().find(function(x) { return x.name === 'miaou__agent__abort'; });
    expect(!!t).toBe(true);
    expect(t.description).toContain('Interromp');
  });
});

describe('agentInventory (T-3) — l\'arbre « racine → agents » de ce qui travaille', function() {
  // Le prédicat est PUR : les conversations et le prédicat « ça génère » arrivent
  // en arguments. C'est ce qui permet de le tester sans IDB ni registre.
  var working = function(ids) { return function(id) { return ids.indexOf(id) >= 0; }; };

  it('une racine qui génère seule fait une entrée sans agent', function() {
    var convs = [{ id: 'p1', title: 'Refonte' }];
    var inv = agentInventory(convs, working(['p1']));
    expect(inv.length).toBe(1);
    expect(inv[0].conv.id).toBe('p1');
    expect(inv[0].working).toBe(true);
    expect(inv[0].agents.length).toBe(0);
  });

  it('un parent INERTE dont un agent travaille est listé — le cas que le registre seul manque', function() {
    // LE cas qui motive le prédicat (décision Julien, T-3) : `p1` n'a aucune
    // entrée au registre de générations, donc tout comptage fondé sur
    // _activeGenerations.size le manque. Il doit pourtant être la racine de son
    // agent, sans quoi l'agent apparaîtrait orphelin.
    var convs = [{ id: 'p1', title: 'Refonte' }, { id: 'a1', parentConvId: 'p1', agentIntent: 'Relire' }];
    var inv = agentInventory(convs, working(['a1']));
    expect(inv.length).toBe(1);
    expect(inv[0].conv.id).toBe('p1');
    expect(inv[0].working).toBe(false);
    expect(inv[0].agents.length).toBe(1);
    expect(inv[0].agents[0].id).toBe('a1');
  });

  it('un parent qui génère ET dont les agents travaillent : une entrée, deux agents', function() {
    var convs = [
      { id: 'p1', title: 'Refonte' },
      { id: 'a1', parentConvId: 'p1', agentIntent: 'Relire' },
      { id: 'a2', parentConvId: 'p1', agentIntent: 'Chiffrer' },
    ];
    var inv = agentInventory(convs, working(['p1', 'a1', 'a2']));
    expect(inv.length).toBe(1);
    expect(inv[0].working).toBe(true);
    expect(inv[0].agents.length).toBe(2);
  });

  it('les agents TERMINÉS ne sont jamais listés (pas d\'état « non lu » côté agent)', function() {
    var convs = [
      { id: 'p1', title: 'Refonte' },
      { id: 'a1', parentConvId: 'p1', agentIntent: 'Fini' },
      { id: 'a2', parentConvId: 'p1', agentIntent: 'En cours' },
    ];
    var inv = agentInventory(convs, working(['a2']));
    expect(inv[0].agents.length).toBe(1);
    expect(inv[0].agents[0].id).toBe('a2');
  });

  it('rien ne travaille → inventaire vide (la pilule et la commande disparaissent)', function() {
    var convs = [{ id: 'p1' }, { id: 'a1', parentConvId: 'p1' }];
    expect(agentInventory(convs, working([])).length).toBe(0);
  });

  it('un agent dont le parent a disparu devient sa PROPRE racine, jamais omis', function() {
    // Il travaille et il est atteignable : le taire ferait mentir le compte.
    var convs = [{ id: 'a1', parentConvId: 'ghost', agentIntent: 'Orphelin' }];
    var inv = agentInventory(convs, working(['a1']));
    expect(inv.length).toBe(1);
    expect(inv[0].conv.id).toBe('a1');
    expect(inv[0].agents.length).toBe(0);
  });

  it('CROSS-SPACE : deux Espaces remontent dans le même inventaire', function() {
    // L'inventaire répond à « qu'est-ce qui tourne, où que ce soit » : le filtrer
    // par Space actif le viderait précisément quand il est utile.
    var convs = [{ id: 'p1', spaceId: 's1' }, { id: 'p2', spaceId: 's2' }];
    var inv = agentInventory(convs, working(['p1', 'p2']));
    expect(inv.length).toBe(2);
  });

  it('l\'ordre suit `convs` — la liste ne se réordonne pas sous le curseur', function() {
    var convs = [{ id: 'p2' }, { id: 'p1' }];
    var inv = agentInventory(convs, working(['p1', 'p2']));
    expect(inv[0].conv.id).toBe('p2');
    expect(inv[1].conv.id).toBe('p1');
  });

  it('null / prédicat absent → inventaire vide, jamais d\'exception', function() {
    expect(agentInventory(null, null).length).toBe(0);
    expect(agentInventory([{ id: 'p1' }], null).length).toBe(0);
  });
});

describe('agentInventoryCount (T-3) — ce que la pilule annonce', function() {
  it('compte les LIGNES : racines ET agents', function() {
    // Le compte doit valoir exactement ce que le popover affiche. Un parent
    // inerte avec deux agents = trois lignes, pas deux.
    var convs = [
      { id: 'p1' },
      { id: 'a1', parentConvId: 'p1' },
      { id: 'a2', parentConvId: 'p1' },
    ];
    expect(agentInventoryCount(agentInventory(convs, function(id) { return id !== 'p1'; }))).toBe(3);
  });
  it('inventaire vide → 0 ; null → 0', function() {
    expect(agentInventoryCount([])).toBe(0);
    expect(agentInventoryCount(null)).toBe(0);
  });
});
