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
