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
      role: 'tool-ack', kind: 'create_memory', id: 'mem1', content: 'un souvenir',
      champInconnu: 'ne doit pas passer', ts: 3,
    }] });
    const a = out[0];
    expect(a.role).toBe('tool-ack');
    expect(a.kind).toBe('create_memory');
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
