// Tests des fonctions pures de main.js.
//
// projectConvMessages(conv) : projette conv.messages (persistés) vers la forme
// currentThread. Extrait de openConversation pour être relu APRÈS l'await (fix
// du bug multi-onglets « en retard d'un tour », cf. docs/multitab-sync.md +
// piège 24) : la projection doit refléter EXACTEMENT l'entrée fournie, sans état
// figé — c'est ce qui garantit qu'un saveConversation d'un pair survenu pendant
// l'await est capté à la relecture.

describe('projectConvMessages — projection fidèle des messages persistés', function () {

  it('conv nulle ou sans messages → tableau vide', function () {
    expect(projectConvMessages(null).length).toBe(0);
    expect(projectConvMessages({}).length).toBe(0);
    expect(projectConvMessages({ messages: [] }).length).toBe(0);
  });

  it('filtre les entrées falsy (null/undefined dans messages)', function () {
    const out = projectConvMessages({ messages: [null, { role: 'user', content: 'a' }, undefined] });
    expect(out.length).toBe(1);
    expect(out[0].content).toBe('a');
  });

  it('message user : role + content conservés', function () {
    const out = projectConvMessages({ messages: [{ role: 'user', content: 'salut', ts: 42 }] });
    expect(out[0].role).toBe('user');
    expect(out[0].content).toBe('salut');
    expect(out[0].ts).toBe(42);
  });

  it('message assistant : champs affichables conservés (model, server, reasoning, truncated)', function () {
    const out = projectConvMessages({ messages: [{
      role: 'assistant', content: 'réponse', model: 'm', server: 'srv',
      reasoning: 'je réfléchis', truncated: true, ts: 7,
    }] });
    const m = out[0];
    expect(m.role).toBe('assistant');
    expect(m.content).toBe('réponse');
    expect(m.model).toBe('m');
    expect(m.server).toBe('srv');
    expect(m.reasoning).toBe('je réfléchis');
    expect(m.truncated).toBe(true);
    expect(m.ts).toBe(7);
  });

  it('displayText : conservé tel quel', function () {
    const out = projectConvMessages({ messages: [{ role: 'user', content: 'corps skill', displayText: '/skill' }] });
    expect(out[0].displayText).toBe('/skill');
    expect(out[0].content).toBe('corps skill');
  });

  it('display legacy (données de test antérieures) normalisé vers displayText', function () {
    const out = projectConvMessages({ messages: [{ role: 'user', content: 'x', display: '/vieux' }] });
    expect(out[0].displayText).toBe('/vieux');
  });

  it('attachments (user) conservés', function () {
    const att = [{ name: 'img.png', w: 10, h: 20, size: 100 }];
    const out = projectConvMessages({ messages: [{ role: 'user', content: 'voir', attachments: att }] });
    expect(out[0].attachments.length).toBe(1);
    expect(out[0].attachments[0].name).toBe('img.png');
  });

  it('ack (tool-ack) : passe par la whitelist ACK_COPY_FIELDS, role préservé', function () {
    const out = projectConvMessages({ messages: [{
      role: 'tool-ack', kind: 'memory__create', id: 'mem1', content: 'un souvenir',
      champInconnu: 'ne doit pas passer', ts: 3,
    }] });
    const a = out[0];
    expect(a.role).toBe('tool-ack');
    expect(a.kind).toBe('memory__create');
    expect(a.id).toBe('mem1');
    expect(a.content).toBe('un souvenir');
    // Champ hors whitelist : absent (copyAckFields n'énumère que ACK_COPY_FIELDS).
    expect(a.champInconnu === undefined).toBe(true);
  });

  it('ordre et cardinalité : un thread complet est projeté 1:1', function () {
    const conv = { messages: [
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'r1' },
      { role: 'user', content: 'q2' },
      { role: 'assistant', content: 'r2' },
    ] };
    const out = projectConvMessages(conv);
    expect(out.length).toBe(4);
    expect(out.map(function (m) { return m.role; }).join(',')).toBe('user,assistant,user,assistant');
    expect(out[3].content).toBe('r2');
  });

  it('reflète la DERNIÈRE réponse ajoutée (invariant du fix : lecture fraîche)', function () {
    // Simule le storage AVANT puis APRÈS la persistance d'une réponse par un pair :
    // la projection de l'état « après » doit contenir la réponse — c'est ce que
    // la relecture post-await capte, là où l'ancien code figeait l'état « avant ».
    const before = { messages: [{ role: 'user', content: 'q' }] };
    const after = { messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'la réponse' }] };
    expect(projectConvMessages(before).length).toBe(1);
    const out = projectConvMessages(after);
    expect(out.length).toBe(2);
    expect(out[1].role).toBe('assistant');
    expect(out[1].content).toBe('la réponse');
  });
});

// projectThreadToMessages(thread) : projette un thread de travail (currentThread
// ou gen.thread) vers la forme persistée (conv.messages). Réciproque de
// projectConvMessages. Extrait du corps de persistCurrent (lot T-1a) pour être
// partagé avec persistGeneration : les deux chemins d'écriture — depuis l'écran
// et depuis une génération détachée — DOIVENT produire des messages strictement
// identiques. Deux formules divergentes feraient qu'une conversation persistée
// en arrière-plan ne serait pas byte-identique à la même persistée depuis
// l'écran ; ces tests verrouillent la formule unique.

describe('projectThreadToMessages — projection vers la forme persistée', function () {

  it('thread nul ou vide → tableau vide', function () {
    expect(projectThreadToMessages(null).length).toBe(0);
    expect(projectThreadToMessages([]).length).toBe(0);
  });

  it('message user minimal : role + content', function () {
    const out = projectThreadToMessages([{ role: 'user', content: 'salut' }]);
    expect(out.length).toBe(1);
    expect(out[0].role).toBe('user');
    expect(out[0].content).toBe('salut');
  });

  it('champs optionnels absents ne sont pas matérialisés', function () {
    const out = projectThreadToMessages([{ role: 'user', content: 'x' }]);
    expect('model' in out[0]).toBe(false);
    expect('ts' in out[0]).toBe(false);
    expect('reasoning' in out[0]).toBe(false);
    expect('truncated' in out[0]).toBe(false);
    expect('attachments' in out[0]).toBe(false);
  });

  it('message assistant complet : model, server, ts, reasoning, truncated', function () {
    const out = projectThreadToMessages([{
      role: 'assistant', content: 'réponse', model: 'm1', server: 'srv',
      ts: 42, reasoning: 'pensée', truncated: true,
    }]);
    expect(out[0].model).toBe('m1');
    expect(out[0].server).toBe('srv');
    expect(out[0].ts).toBe(42);
    expect(out[0].reasoning).toBe('pensée');
    expect(out[0].truncated).toBe(true);
  });

  it('displayText (slash-commande skill) est conservé', function () {
    const out = projectThreadToMessages([{ role: 'user', content: 'corps skill', displayText: '/skill' }]);
    expect(out[0].content).toBe('corps skill');
    expect(out[0].displayText).toBe('/skill');
  });

  it('displayText vide est conservé (!= null, pas de perte du littéral)', function () {
    const out = projectThreadToMessages([{ role: 'user', content: 'x', displayText: '' }]);
    expect(out[0].displayText).toBe('');
  });

  it('attachments (pièces jointes) sont conservées', function () {
    const att = [{ attId: 'a1', kind: 'image', name: 'p.png' }];
    const out = projectThreadToMessages([{ role: 'user', content: 'voir', attachments: att }]);
    expect(out[0].attachments.length).toBe(1);
    expect(out[0].attachments[0].attId).toBe('a1');
  });

  it('tool-ack : passe par la whitelist ACK_COPY_FIELDS, role préservé', function () {
    const out = projectThreadToMessages([{
      role: 'tool-ack', name: 'miaou__about', args: { topic: 'x' },
      result: 'ok', ts: 7, group: 'g1',
    }]);
    expect(out[0].role).toBe('tool-ack');
    expect(out[0].name).toBe('miaou__about');
    expect(out[0].result).toBe('ok');
    expect(out[0].group).toBe('g1');
  });

  it('agentResult (lot X-1) survit à la projection : sinon X-3 stylerait un champ disparu au reload', function () {
    const out = projectThreadToMessages([{
      role: 'user', content: '[Résultat d\'agent — terminé]', ts: 9,
      agentResult: { id: 'c123', status: 'stopped', intent: 'Rédiger la note' },
    }]);
    expect(out.length).toBe(1);
    expect(!!out[0].agentResult).toBe(true);
    expect(out[0].agentResult.id).toBe('c123');
    expect(out[0].agentResult.status).toBe('stopped');
    expect(out[0].agentResult.intent).toBe('Rédiger la note');
  });

  it('un message user ordinaire ne gagne pas de champ agentResult', function () {
    const out = projectThreadToMessages([{ role: 'user', content: 'salut' }]);
    expect(out[0].agentResult === undefined).toBe(true);
  });

  it('bulle _acksOnly (piège 27) : content vide préservé, hôte des acks au reload', function () {
    const out = projectThreadToMessages([{ role: 'assistant', content: '', model: 'm', ts: 3 }]);
    expect(out.length).toBe(1);
    expect(out[0].content).toBe('');
  });

  it('aller-retour projectThreadToMessages → projectConvMessages : stable', function () {
    const thread = [
      { role: 'user', content: 'question', ts: 1 },
      { role: 'tool-ack', name: 'files__list', args: {}, result: 'r', ts: 2, group: 'g' },
      { role: 'assistant', content: 'réponse', model: 'm', server: 's', ts: 3, reasoning: 'r' },
    ];
    const persisted = projectThreadToMessages(thread);
    const back = projectConvMessages({ messages: persisted });
    const again = projectThreadToMessages(back);
    expect(JSON.stringify(again)).toBe(JSON.stringify(persisted));
  });

  it('ne mute pas le thread source', function () {
    const thread = [{ role: 'user', content: 'x', ts: 1 }];
    const snapshot = JSON.stringify(thread);
    projectThreadToMessages(thread);
    expect(JSON.stringify(thread)).toBe(snapshot);
  });

  it('ordre des messages préservé', function () {
    const out = projectThreadToMessages([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);
    expect(out.map(m => m.content).join('')).toBe('abc');
  });
});

// splitTrailingAcks(thread) : sépare un thread en (corps, queue d'acks). Le fil
// d'une génération EN VOL se termine par les acks du tour courant SANS
// l'assistant qui les clôt (il n'existe qu'à onFinal). renderThread rend les
// acks DANS la bulle assistant qui les SUIT ; sans suivant, il retombe sur sa
// branche « acks orphelins » et les rend nus, hors bulle — divergence
// live/reload (le piège .ack-shell du lot Q). Le rebranchement (lot T-1b) rend
// donc le corps par renderThread — même chemin que le reload — et replace la
// queue dans la bulle vive.

describe('splitTrailingAcks — corps / queue d\'acks du tour en cours', function () {

  it('thread nul ou vide → deux tableaux vides', function () {
    const a = splitTrailingAcks(null);
    expect(a.body.length).toBe(0);
    expect(a.trailingAcks.length).toBe(0);
    const b = splitTrailingAcks([]);
    expect(b.body.length).toBe(0);
    expect(b.trailingAcks.length).toBe(0);
  });

  it('aucun ack en queue : tout est corps', function () {
    const t = [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'r' }];
    const out = splitTrailingAcks(t);
    expect(out.body.length).toBe(2);
    expect(out.trailingAcks.length).toBe(0);
  });

  it('génération en vol : les acks du tour courant sont en queue', function () {
    const t = [
      { role: 'user', content: 'q' },
      { role: 'tool-ack', name: 'a' },
      { role: 'tool-ack', name: 'b' },
    ];
    const out = splitTrailingAcks(t);
    expect(out.body.length).toBe(1);
    expect(out.body[0].role).toBe('user');
    expect(out.trailingAcks.length).toBe(2);
    expect(out.trailingAcks[0].name).toBe('a');
    expect(out.trailingAcks[1].name).toBe('b');
  });

  it('acks DÉJÀ clos par un assistant restent dans le corps', function () {
    // Tour terminé : renderThread sait les replacer dans la bulle qui suit.
    const t = [
      { role: 'user', content: 'q' },
      { role: 'tool-ack', name: 'a' },
      { role: 'assistant', content: 'r' },
    ];
    const out = splitTrailingAcks(t);
    expect(out.body.length).toBe(3);
    expect(out.trailingAcks.length).toBe(0);
  });

  it('tour clos PUIS nouveau tour en vol : seule la dernière salve est en queue', function () {
    const t = [
      { role: 'user', content: 'q' },
      { role: 'tool-ack', name: 'a' },
      { role: 'assistant', content: 'tour 1' },
      { role: 'tool-ack', name: 'b' },
    ];
    const out = splitTrailingAcks(t);
    expect(out.body.length).toBe(3);
    expect(out.trailingAcks.length).toBe(1);
    expect(out.trailingAcks[0].name).toBe('b');
  });

  it('thread entièrement fait d\'acks : corps vide, tout en queue', function () {
    const t = [{ role: 'tool-ack', name: 'a' }, { role: 'tool-ack', name: 'b' }];
    const out = splitTrailingAcks(t);
    expect(out.body.length).toBe(0);
    expect(out.trailingAcks.length).toBe(2);
  });

  it('bulle _acksOnly (piège 27) clôt bien la salve : elle reste dans le corps', function () {
    // Interjection mid-génération : l'assistant vide héberge les acks du tour.
    const t = [
      { role: 'tool-ack', name: 'a' },
      { role: 'assistant', content: '', _acksOnly: true },
      { role: 'user', content: 'interjection' },
      { role: 'tool-ack', name: 'b' },
    ];
    const out = splitTrailingAcks(t);
    expect(out.body.length).toBe(3);
    expect(out.trailingAcks.length).toBe(1);
    expect(out.trailingAcks[0].name).toBe('b');
  });

  it('concaténation corps+queue = thread d\'origine (aucune perte)', function () {
    const t = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'r' },
      { role: 'tool-ack', name: 'a' },
      { role: 'tool-ack', name: 'b' },
    ];
    const out = splitTrailingAcks(t);
    expect(JSON.stringify(out.body.concat(out.trailingAcks))).toBe(JSON.stringify(t));
  });

  it('ne mute pas le thread source', function () {
    const t = [{ role: 'user', content: 'q' }, { role: 'tool-ack', name: 'a' }];
    const snapshot = JSON.stringify(t);
    splitTrailingAcks(t);
    expect(JSON.stringify(t)).toBe(snapshot);
  });
});

describe('formatLibraryFileHeadline / formatDescriptionImageDescriptor (lot V-9)', function() {
  it('en-tête dérivé des seuls champs figés (name, mime, size) — aucun octet, aucune date', function() {
    var h = formatLibraryFileHeadline({ name: 'scan.jpg', mime: 'image/jpeg', size: 219136 });
    expect(h.indexOf('scan.jpg') >= 0).toBeTruthy();
    expect(h.indexOf('image/jpeg') >= 0).toBeTruthy();
    expect(h.indexOf(modelSize(219136)) >= 0).toBeTruthy();
  });
  it('byte-stable : deux appels sur le même record rendent la même chaîne (le manifeste <miaou_context> en dépend)', function() {
    var rec = { name: 'a.png', mime: 'image/png', size: 1024 };
    expect(formatLibraryFileHeadline(rec)).toBe(formatLibraryFileHeadline(rec));
  });
  it('record sans nom/mime → dégradé lisible, jamais undefined dans la chaîne', function() {
    var h = formatLibraryFileHeadline({ size: 0 });
    expect(h.indexOf('undefined') < 0).toBeTruthy();
  });
  it('descripteur de page PDF : dit que le document est scanné, sans promettre de handle de rappel', function() {
    var d = formatDescriptionImageDescriptor('pdf-page');
    expect(d.indexOf('scanné') >= 0).toBeTruthy();
    expect(d.indexOf('recall_attachment') < 0).toBeTruthy();   // aucune capacité annoncée sans handle
    expect(d.indexOf('attachment att-') < 0).toBeTruthy();
  });
  it('descripteur de fichier image : distinct de celui de la page PDF, sans handle non plus', function() {
    var d = formatDescriptionImageDescriptor('file');
    expect(d !== formatDescriptionImageDescriptor('pdf-page')).toBeTruthy();
    expect(d.indexOf('recall_attachment') < 0).toBeTruthy();
  });
});

// setGenPhase — machine à états de l'étape annoncée par le composer.
//
// Testée sur gen seul : `convId` volontairement absent du registre d'écran,
// donc genOwnsScreen rend faux et la moitié peinture ne s'exécute pas. Ce
// qu'on vérifie ici est la moitié DONNÉES, celle dont dépendent aussi les
// générations sans écran (agents, parent réveillé) — cf. piège 28.
describe('setGenPhase — étapes du composer, dont les deux d\'après-outils', function () {

  function g(phase) { return { convId: '__hors-ecran__', phase: phase }; }

  it('le cycle nominal avance : waiting → reasoning → answering', function () {
    const gen = g('waiting');
    setGenPhase(gen, 'reasoning');
    expect(gen.phase).toBe('reasoning');
    setGenPhase(gen, 'answering');
    expect(gen.phase).toBe('answering');
  });

  it('un raisonnement annoncé après le premier token est ignoré (pas de clignotement)', function () {
    const gen = g('answering');
    setGenPhase(gen, 'reasoning');
    expect(gen.phase).toBe('answering');
  });

  it('la frontière de tour d\'outils mène à analyzing, pas à waiting', function () {
    // C'est le fait que l'étape existe : après des résultats d'outils, le
    // composer ne doit plus retomber sur le libellé générique d'attente.
    const gen = g('tools');
    setGenPhase(gen, 'analyzing');
    expect(gen.phase).toBe('analyzing');
  });

  it('un raisonnement demandé depuis analyzing devient pondering', function () {
    // Dérivation portée par setGenPhase et non par l'appelant : les helpers
    // partagés (et donc les agents) demandent 'reasoning' sans rien savoir du
    // tour d'outils qui précède.
    const gen = g('analyzing');
    setGenPhase(gen, 'reasoning');
    expect(gen.phase).toBe('pondering');
  });

  it('depuis waiting, le raisonnement reste reasoning', function () {
    const gen = g('waiting');
    setGenPhase(gen, 'reasoning');
    expect(gen.phase).toBe('reasoning');
  });

  it('pondering cède au premier token de réponse, et ne revient pas', function () {
    const gen = g('pondering');
    setGenPhase(gen, 'answering');
    expect(gen.phase).toBe('answering');
    setGenPhase(gen, 'reasoning');
    expect(gen.phase).toBe('answering');
  });

  it('gen absente : aucun throw', function () {
    setGenPhase(null, 'answering');
    expect(true).toBeTruthy();
  });

  it('un tirage par ENTRÉE dans la phase, jamais à la repeinture', function () {
    // Le fait qui empêche le placeholder de clignoter. Une transition refusée
    // (la garde anti-retour) ou ignorée (phase identique) ne doit pas retirer :
    // sinon un onDelta par chunk changerait la formulation en cours de phrase.
    const gen = g('waiting');
    setGenPhase(gen, 'answering');
    const drawn = gen.phaseVariant;
    setGenPhase(gen, 'answering');           // même phase : sortie anticipée
    expect(gen.phaseVariant).toBe(drawn);
    setGenPhase(gen, 'reasoning');           // refusée par la garde
    expect(gen.phaseVariant).toBe(drawn);
  });

  it('le variant est un entier fini : la table le ramène modulo sa longueur', function () {
    // setGenPhase ne connaît pas le nombre de formulations d'une phase (c'est
    // tout l'intérêt : en ajouter une ne périme aucun tirage en vol). Ce qu'il
    // doit garantir est seulement que la valeur est exploitable par le modulo.
    const gen = g('waiting');
    for (let i = 0; i < 20; i++) {
      gen.phase = 'waiting';
      setGenPhase(gen, 'tools');
      expect(Number.isFinite(gen.phaseVariant)).toBeTruthy();
      expect(gen.phaseVariant >= 0).toBeTruthy();
      expect(Math.trunc(gen.phaseVariant)).toBe(gen.phaseVariant);
    }
  });

  it('une génération neuve ouvre sur la formulation historique', function () {
    // `phaseVariant: 0` au démarrage : le tout premier texte affiché d'un
    // échange est toujours le libellé d'origine, jamais une variante.
    const gen = createGeneration('c1', [], {});
    expect(gen.phase).toBe('waiting');
    expect(gen.phaseVariant).toBe(0);
  });
});

// ── `kind` de l'entrée du registre (lot AE, étape 8) ────────────────────────
// Une compaction entre au registre des générations pour occuper la
// conversation sur TOUS les onglets (relais readonly), sans rien peindre. Le
// contrat tient en trois exemptions nommées ; ces tests les gardent, parce
// qu'aucune d'elles ne se voit dans un rendu et qu'une régression y serait
// silencieuse — un stream jamais interrompu, ou une bulle vide au bas du fil.
describe('kind de génération — compaction au registre sans peindre', function () {

  it('createGeneration pose \'stream\' par défaut', function () {
    // Le défaut couvre tous les appels existants, qui ne passent pas de kind :
    // sans lui, chaque génération réelle deviendrait une compaction.
    const gen = createGeneration('c1', []);
    expect(gen.kind).toBe('stream');
  });

  it('createGeneration accepte \'compaction\' et remplit quand même le contrat', function () {
    // L'objet est COMPLET, jamais un littéral tronqué : un consommateur qui
    // déréférence gen.thread ou gen.abort ne doit pas planter au premier
    // chemin oublié. Ce qui n'est pas rempli l'est VIDE, pas omis.
    const gen = createGeneration('c1', [], { kind: 'compaction' });
    expect(gen.kind).toBe('compaction');
    expect(gen.convId).toBe('c1');
    expect(gen.abort).toBe(null);
    expect(gen.wrap).toBe(null);
    expect(Array.isArray(gen.thread)).toBeTruthy();
    expect(typeof gen.id).toBe('string');
  });

  it('genOwnsScreen : une compaction ne possède JAMAIS l\'écran, même sur la conv affichée', function () {
    // L'exemption porte sur le prédicat unique, jamais sur un test `kind`
    // réécrit chez un consommateur. Le témoin (même convId, kind stream)
    // prouve que le montage atteint bien le cas : sans lui, un genOwnsScreen
    // cassé rendrait ce test vert pour la mauvaise raison.
    const saved = currentConvId;
    currentConvId = 'c1';
    expect(genOwnsScreen({ kind: 'stream', convId: 'c1' })).toBe(true);
    expect(genOwnsScreen({ kind: 'compaction', convId: 'c1' })).toBe(false);
    currentConvId = saved;
  });

  it('streamGenerationFor écarte la compaction, isGenerating la VOIT', function () {
    // Les deux moitiés du choix, dans un seul test parce que c'est leur
    // conjonction qui fait le lot : le geste doit occuper la conversation
    // (isGenerating vrai → gardes AE-7, badge, relais readonly) tout en
    // restant invisible du rebranchement d'écran. Vérifier l'une sans l'autre
    // laisserait passer la moitié du défaut.
    _activeGenerations.clear();
    const gen = createGeneration('c1', [], { kind: 'compaction' });
    _activeGenerations.set('c1', gen);
    expect(isGenerating('c1')).toBe(true);
    expect(generationFor('c1')).toBe(gen);
    expect(streamGenerationFor('c1')).toBe(null);
    _activeGenerations.clear();
  });

  it('streamGenerationFor rend bien une génération de stream', function () {
    // Contre-épreuve : sans elle, un streamGenerationFor qui rendrait TOUJOURS
    // null passerait le test précédent.
    _activeGenerations.clear();
    const gen = createGeneration('c1', []);
    _activeGenerations.set('c1', gen);
    expect(streamGenerationFor('c1')).toBe(gen);
    _activeGenerations.clear();
  });

  it('abortStream n\'interrompt pas une compaction et ne lui pose pas de stopRequested', function () {
    // Le stop différé serait un mensonge : aucune boucle de tours ne consulte
    // stopRequested pour une compaction, et setStopping figerait le bouton
    // composer jusqu'à la fin du geste.
    _activeGenerations.clear();
    let aborted = false;
    const gen = createGeneration('c1', [], { kind: 'compaction' });
    gen.abort = { abort: function () { aborted = true; } };
    _activeGenerations.set('c1', gen);
    abortStream('c1');
    expect(aborted).toBe(false);
    expect(!!gen.stopRequested).toBe(false);
    _activeGenerations.clear();
  });

  it('une entrée SANS kind reste interruptible (le doute tombe du bon côté)', function () {
    // Asymétrie délibérée avec genOwnsScreen : ne pas interrompre un stream est
    // SILENCIEUX (il consomme sans que personne le voie), alors que refuser
    // d'interrompre une compaction ne l'est pas. D'où un test en
    // `=== 'compaction'` et non `!== 'stream'`. Fixtures et chemins futurs qui
    // construiraient l'objet à la main tombent donc du côté qui interrompt.
    _activeGenerations.clear();
    let aborted = false;
    _activeGenerations.set('c1', { convId: 'c1', abort: { abort: function () { aborted = true; } } });
    abortStream('c1');
    expect(aborted).toBe(true);
    _activeGenerations.clear();
  });
});
