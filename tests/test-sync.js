// tests/test-sync.js
// Noyau pur de la synchronisation multi-onglets (lot J, sync.js).
// L'adaptateur impur (BroadcastChannel) est absent sous QuickJS : seules les
// fonctions pures sont couvertes ici. Le câblage récepteur (J3+) est vérifié
// manuellement (docs/manual-tests.md) via le script Playwright deux-onglets.

describe('makeEnvelope', function() {
  it('produit une enveloppe versionnée bien formée', function() {
    var e = makeEnvelope('conv-updated', 'tab_abc', { convId: 'c1', spaceId: 's1' });
    expect(e.v).toBe(1);
    expect(e.type).toBe('conv-updated');
    expect(e.tabId).toBe('tab_abc');
    expect(e.payload.convId).toBe('c1');
  });
  it('normalise un payload manquant en objet vide', function() {
    var e = makeEnvelope('full-reload', 'tab_x');
    expect(typeof e.payload).toBe('object');
    expect(Object.keys(e.payload).length).toBe(0);
  });
  it('coerce type et tabId en chaîne', function() {
    var e = makeEnvelope(123, 456, {});
    expect(e.type).toBe('123');
    expect(e.tabId).toBe('456');
  });
});

describe('validateEnvelope', function() {
  it('accepte une enveloppe conforme', function() {
    var e = validateEnvelope({ v: 1, type: 'conv-updated', tabId: 'tab_a', payload: { convId: 'c1' } });
    expect(!!e).toBe(true);
    expect(e.type).toBe('conv-updated');
    expect(e.payload.convId).toBe('c1');
  });
  it('rejette un objet nul ou non-objet', function() {
    expect(validateEnvelope(null)).toBe(null);
    expect(validateEnvelope('x')).toBe(null);
    expect(validateEnvelope(42)).toBe(null);
  });
  it('rejette une version de protocole inconnue', function() {
    expect(validateEnvelope({ v: 2, type: 'conv-updated', tabId: 'tab_a' })).toBe(null);
    expect(validateEnvelope({ type: 'conv-updated', tabId: 'tab_a' })).toBe(null);
  });
  it('rejette un type hors de la liste fermée', function() {
    expect(validateEnvelope({ v: 1, type: 'unknown-type', tabId: 'tab_a' })).toBe(null);
    expect(validateEnvelope({ v: 1, type: '', tabId: 'tab_a' })).toBe(null);
  });
  it('rejette un tabId absent ou vide', function() {
    expect(validateEnvelope({ v: 1, type: 'conv-updated' })).toBe(null);
    expect(validateEnvelope({ v: 1, type: 'conv-updated', tabId: '' })).toBe(null);
  });
  it('tolère un payload manquant (objet vide normalisé)', function() {
    var e = validateEnvelope({ v: 1, type: 'full-reload', tabId: 'tab_a' });
    expect(!!e).toBe(true);
    expect(typeof e.payload).toBe('object');
    expect(Object.keys(e.payload).length).toBe(0);
  });
});

describe('routeMessage', function() {
  var CTX = { tabId: 'me', currentConvId: 'c1', activeSpaceId: 's1' };

  it('ignore un message émis par cet onglet (défense self-loopback)', function() {
    var env = makeEnvelope('conv-updated', 'me', { convId: 'c1' });
    expect(routeMessage(env, CTX).action).toBe('ignore-self');
  });

  it('conv-updated sur la conv affichée → rehydrate', function() {
    var env = makeEnvelope('conv-updated', 'other', { convId: 'c1', spaceId: 's1', reason: 'title' });
    var d = routeMessage(env, CTX);
    expect(d.action).toBe('rehydrate');
    expect(d.convId).toBe('c1');
    expect(d.reason).toBe('title');
  });
  it('conv-updated sur une autre conv → render-list', function() {
    var env = makeEnvelope('conv-updated', 'other', { convId: 'c2', spaceId: 's1' });
    expect(routeMessage(env, CTX).action).toBe('render-list');
  });

  it('conv-deleted sur la conv affichée → conv-gone', function() {
    var env = makeEnvelope('conv-deleted', 'other', { convId: 'c1' });
    expect(routeMessage(env, CTX).action).toBe('conv-gone');
  });
  it('conv-deleted sur une autre conv → render-list', function() {
    var env = makeEnvelope('conv-deleted', 'other', { convId: 'c9' });
    expect(routeMessage(env, CTX).action).toBe('render-list');
  });

  it('space-changed → space-list', function() {
    var env = makeEnvelope('space-changed', 'other', { spaceId: 's2' });
    var d = routeMessage(env, CTX);
    expect(d.action).toBe('space-list');
    expect(d.spaceId).toBe('s2');
  });

  it('settings-updated → apply-settings avec la liste de clés', function() {
    var env = makeEnvelope('settings-updated', 'other', { keys: ['theme', 'model'] });
    var d = routeMessage(env, CTX);
    expect(d.action).toBe('apply-settings');
    expect(d.keys).toEqual(['theme', 'model']);
  });
  it('settings-updated sans keys → liste vide', function() {
    var env = makeEnvelope('settings-updated', 'other', {});
    expect(routeMessage(env, CTX).keys).toEqual([]);
  });

  it('resources-updated → invalidate-resources', function() {
    var env = makeEnvelope('resources-updated', 'other', { ids: ['res_1', 'res_2'], convId: 'c1' });
    var d = routeMessage(env, CTX);
    expect(d.action).toBe('invalidate-resources');
    expect(d.ids).toEqual(['res_1', 'res_2']);
    expect(d.convId).toBe('c1');
  });

  it('skills-updated → reload-skills', function() {
    var env = makeEnvelope('skills-updated', 'other', {});
    expect(routeMessage(env, CTX).action).toBe('reload-skills');
  });

  it('full-reload → full-reload', function() {
    var env = makeEnvelope('full-reload', 'other', {});
    expect(routeMessage(env, CTX).action).toBe('full-reload');
  });

  it('conv-opened sur la conv affichée → soft-lock', function() {
    var env = makeEnvelope('conv-opened', 'other', { convId: 'c1' });
    var d = routeMessage(env, CTX);
    expect(d.action).toBe('soft-lock');
    expect(d.tabId).toBe('other');
  });
  it('conv-opened sur une autre conv → ignore', function() {
    var env = makeEnvelope('conv-opened', 'other', { convId: 'c2' });
    expect(routeMessage(env, CTX).action).toBe('ignore');
  });
  it('conv-closed → soft-unlock avec le tabId émetteur', function() {
    var env = makeEnvelope('conv-closed', 'other', { convId: 'c1' });
    var d = routeMessage(env, CTX);
    expect(d.action).toBe('soft-unlock');
    expect(d.tabId).toBe('other');
  });

  it('conv-generation-started sur la conv affichée → readonly-on', function() {
    var env = makeEnvelope('conv-generation-started', 'other', { convId: 'c1' });
    expect(routeMessage(env, CTX).action).toBe('readonly-on');
  });
  it('conv-generation-started sur une autre conv → ignore', function() {
    var env = makeEnvelope('conv-generation-started', 'other', { convId: 'c2' });
    expect(routeMessage(env, CTX).action).toBe('ignore');
  });
  it('conv-generation-ended sur la conv affichée → readonly-off', function() {
    var env = makeEnvelope('conv-generation-ended', 'other', { convId: 'c1' });
    expect(routeMessage(env, CTX).action).toBe('readonly-off');
  });
  it('conv-generation-ended sur une autre conv → ignore', function() {
    var env = makeEnvelope('conv-generation-ended', 'other', { convId: 'c2' });
    expect(routeMessage(env, CTX).action).toBe('ignore');
  });

  it('tolère un contexte absent (pas de crash)', function() {
    var env = makeEnvelope('conv-updated', 'other', { convId: 'c1' });
    expect(routeMessage(env).action).toBe('render-list'); // c1 !== undefined → non affichée
  });
});

describe('generateTabId', function() {
  it('produit un id préfixé tab_', function() {
    expect(generateTabId(function() { return 0.5; }).indexOf('tab_')).toBe(0);
  });
  it('deux rand distincts → deux ids distincts', function() {
    var a = generateTabId(function() { return 0.111111; });
    var b = generateTabId(function() { return 0.999999; });
    expect(a === b).toBe(false);
  });
});
