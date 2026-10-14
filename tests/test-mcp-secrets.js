// tests/test-mcp-secrets.js
// Secrets volatils (mcp-secrets.js). Purs seulement : les appels au proxy, la
// garde en session et les surfaces se vérifient contre un vrai proxy (cf.
// docs/mcp.md, « Secrets volatils »).

function consumer(upstream, state, verdict, detail) {
  return { upstream: upstream, state: state, verdict: verdict === undefined ? null : verdict, detail: detail === undefined ? null : detail };
}
function entry(key, consumers, held) {
  return { key: key, held: !!held, consumers: consumers };
}

describe('mcpDeclaresSecretsExtension', function() {
  it('présence de la clé dans capabilities.extensions', function() {
    expect(mcpDeclaresSecretsExtension({ capabilities: { extensions: { 'miaou/volatile-secrets': {} } } })).toBe(true);
  });
  it('absente, autre extension, forme inattendue : faux', function() {
    expect(mcpDeclaresSecretsExtension({ capabilities: { extensions: { 'miaou/self-update': {} } } })).toBe(false);
    expect(mcpDeclaresSecretsExtension({ capabilities: {} })).toBe(false);
    expect(mcpDeclaresSecretsExtension(null)).toBe(false);
  });
});

describe('normalizeVolatileSecretsStatus — lecture défensive à la frontière', function() {
  it('réponse du contrat, entrée par entrée', function() {
    var st = normalizeVolatileSecretsStatus({ status: { instance: '0123456789abcdef', secrets: [
      { key: 'Mot de passe SSO', held: true, consumers: [
        { upstream: 'api', state: 'ready', verdict: 'accepted', detail: null },
        { upstream: 'logs', state: 'pending', verdict: 'untested', detail: 'non testé : refus précédent' } ] } ] } });
    expect(st.instance).toBe('0123456789abcdef');
    expect(st.secrets.length).toBe(1);
    expect(st.secrets[0]).toEqual({ key: 'Mot de passe SSO', held: true, consumers: [
      { upstream: 'api', state: 'ready', verdict: 'accepted', detail: null },
      { upstream: 'logs', state: 'pending', verdict: 'untested', detail: 'non testé : refus précédent' } ] });
  });
  it('sans instance, non enveloppée, nulle : rien', function() {
    expect(normalizeVolatileSecretsStatus({ status: { secrets: [] } })).toBe(null);
    expect(normalizeVolatileSecretsStatus({ instance: 'x', secrets: [] })).toBe(null);
    expect(normalizeVolatileSecretsStatus(null)).toBe(null);
  });
  it('une clef illisible est retirée, pas la réponse', function() {
    var st = normalizeVolatileSecretsStatus({ status: { instance: 'i', secrets: [{ key: '' }, { key: 'k', consumers: [] }, 3] } });
    expect(st.secrets.map(function(e) { return e.key; })).toEqual(['k']);
  });
  it('verdict inconnu → indéterminé ; state inconnu → ready ; consommateur sans nom retiré', function() {
    var e = normalizeVolatileSecretEntry({ key: 'k', consumers: [
      { upstream: 'a', state: 'pending', verdict: 'expired' }, { upstream: 'b', state: 'building', verdict: null }, { state: 'pending' } ] });
    expect(e.consumers.length).toBe(2);
    expect(e.consumers[0].verdict).toBe('indeterminate');
    expect(e.consumers[1].state).toBe('ready');
    expect(e.consumers[1].verdict).toBe(null);
    expect(e.held).toBe(false);
  });
  it('réponse de submit / forget : { secret: entrée }', function() {
    expect(normalizeVolatileSecretResult({ secret: { key: 'k', held: false, consumers: [] } }).key).toBe('k');
    expect(normalizeVolatileSecretResult({ key: 'k' })).toBe(null);
  });
});

describe('volatileSecretOrigin — origine par motif', function() {
  it('schéma et hôte en minuscules, chemin retiré', function() {
    expect(volatileSecretOrigin('HTTP://LocalHost:8765/mcp')).toBe('http://localhost:8765');
  });
  it('ports par défaut retirés, comme location.origin', function() {
    expect(volatileSecretOrigin('http://localhost:80/mcp')).toBe('http://localhost');
    expect(volatileSecretOrigin('https://h.example:443/mcp')).toBe('https://h.example');
    expect(volatileSecretOrigin('http://h.example:443/mcp')).toBe('http://h.example:443');
  });
  it('userinfo retiré', function() {
    expect(volatileSecretOrigin('http://u:p@127.0.0.1:8765/mcp')).toBe('http://127.0.0.1:8765');
  });
  it('autre schéma, vide : chaîne vide', function() {
    expect(volatileSecretOrigin('file:///tmp/miaou.html')).toBe('');
    expect(volatileSecretOrigin('')).toBe('');
    expect(volatileSecretOrigin(null)).toBe('');
  });
});

describe('secretsAvailability — page servie par le proxy de la carte', function() {
  var card = 'http://127.0.0.1:8765/mcp';
  it('page servie, même origine, contexte sûr : disponible', function() {
    var a = secretsAvailability({ served: true, pageOrigin: 'http://127.0.0.1:8765', cardUrl: card, secure: true });
    expect(a.ok).toBe(true);
    expect(a.appUrl).toBe('http://127.0.0.1:8765/app/');
  });
  it('file:// : non servie, adresse de /app/ donnée', function() {
    var a = secretsAvailability({ served: false, pageOrigin: 'null', cardUrl: card, secure: true });
    expect(a).toEqual({ ok: false, reason: 'not-served', appUrl: 'http://127.0.0.1:8765/app/' });
  });
  it('127.0.0.1 et localhost : deux origines', function() {
    var a = secretsAvailability({ served: true, pageOrigin: 'http://localhost:8765', cardUrl: card, secure: true });
    expect(a.reason).toBe('other-origin');
  });
  it('carte sur un port par défaut explicite : même origine que la page', function() {
    expect(secretsAvailability({ served: true, pageOrigin: 'http://localhost', cardUrl: 'http://localhost:80/mcp', secure: true }).ok).toBe(true);
  });
  it('contexte non sécurisé : refus de transport', function() {
    var a = secretsAvailability({ served: true, pageOrigin: 'http://192.0.2.5:8765', cardUrl: 'http://192.0.2.5:8765/mcp', secure: false });
    expect(a.reason).toBe('insecure');
  });
  it('carte sans URL http(s) : autre origine, sans adresse', function() {
    var a = secretsAvailability({ served: true, pageOrigin: 'http://127.0.0.1:8765', cardUrl: '', secure: true });
    expect(a).toEqual({ ok: false, reason: 'other-origin', appUrl: '' });
  });
  it('texte de la carte : adresse à ouvrir, cause du transport', function() {
    expect(secretsUnavailableText({ reason: 'not-served', appUrl: 'http://127.0.0.1:8765/app/' })).toContain('http://127.0.0.1:8765/app/');
    expect(secretsUnavailableText({ reason: 'other-origin', appUrl: 'http://127.0.0.1:8765/app/' })).toContain('127.0.0.1 et localhost');
    expect(secretsUnavailableText({ reason: 'insecure', appUrl: '' })).toContain('en clair');
  });
});

describe('volatileSecretKeyState — phase lue sur les consommateurs en attente', function() {
  it('rien n\'attend : pas de phase', function() {
    var s = volatileSecretKeyState(entry('k', [consumer('a', 'ready', 'accepted')], true));
    expect(s.waiting).toBe(false);
    expect(s.phase).toBe('');
    expect(s.text).toBe('');
  });
  it('aucune saisie : requis, compte des services en attente', function() {
    var s = volatileSecretKeyState(entry('Mot de passe SSO', [consumer('a', 'pending'), consumer('b', 'pending')]));
    expect(s.phase).toBe('required');
    expect(s.text).toBe('Mot de passe « Mot de passe SSO » requis : 2 services en attente.');
  });
  it('refus : seul cas « incorrect », service nommé', function() {
    var s = volatileSecretKeyState(entry('k', [consumer('a', 'pending', 'rejected', 'identifiants refusés'), consumer('b', 'pending', 'untested', 'non testé')]));
    expect(s.phase).toBe('rejected');
    expect(s.upstream).toBe('a');
    expect(s.text).toContain('incorrect');
    expect(s.text).toContain('identifiants refusés');
  });
  it('indéterminé : cause dite, rien à ressaisir, jamais « incorrect »', function() {
    var s = volatileSecretKeyState(entry('k', [consumer('a', 'pending', 'indeterminate', 'annuaire *** en panne')]));
    expect(s.phase).toBe('indeterminate');
    expect(s.text).toContain('annuaire *** en panne');
    expect(s.text.indexOf('incorrect')).toBe(-1);
  });
  it('incomplet : configuration du proxy', function() {
    var s = volatileSecretKeyState(entry('k', [consumer('a', 'pending', 'incomplete', 'login absent')]));
    expect(s.phase).toBe('incomplete');
    expect(s.text).toContain('configuration incomplète');
  });
  it('le refus prime sur l\'indéterminé', function() {
    expect(volatileSecretKeyState(entry('k', [consumer('a', 'pending', 'indeterminate'), consumer('b', 'pending', 'rejected')])).phase).toBe('rejected');
  });
  it('remplacement refusé (prêt + refusé) : pas en attente, signalé à part', function() {
    var s = volatileSecretKeyState(entry('k', [consumer('a', 'ready', 'rejected', 'refusé')], true));
    expect(s.waiting).toBe(false);
    expect(s.replacementRefused).toBe(true);
    expect(s.text).toBe('');
  });
  it('compte des clefs en attente d\'un état lu', function() {
    expect(volatileSecretsWaitingCount({ instance: 'i', secrets: [
      entry('k1', [consumer('a', 'pending')]), entry('k2', [consumer('b', 'ready', 'accepted')]), entry('k3', [consumer('c', 'pending', 'rejected')]) ] })).toBe(2);
    expect(volatileSecretsWaitingCount(null)).toBe(0);
  });
  it('texte d\'un consommateur dans la carte', function() {
    expect(volatileSecretConsumerText(consumer('a', 'ready', 'rejected'))).toContain('l\'ancien reste en service');
    expect(volatileSecretConsumerText(consumer('a', 'pending', 'rejected'))).toBe('en attente, mot de passe refusé');
    expect(volatileSecretConsumerText(consumer('a', 'pending', 'indeterminate', 'délai'))).toBe('en attente, vérification impossible (délai)');
  });
});

describe('volatileSecretShouldResend — un renvoi par redémarrage constaté', function() {
  var waiting = entry('k', [consumer('a', 'pending'), consumer('b', 'pending')]);
  var kept = { value: 'v', acceptedInstance: 'old', resentFor: null };
  it('valeur gardée, proxy redémarré, consommateurs sans verdict : renvoyer', function() {
    expect(volatileSecretShouldResend(waiting, kept, 'new')).toBe(true);
  });
  it('déjà renvoyée à cette instance : non', function() {
    expect(volatileSecretShouldResend(waiting, { value: 'v', acceptedInstance: 'old', resentFor: 'new' }, 'new')).toBe(false);
  });
  it('même instance que l\'acceptation (« Oublier » fait ailleurs) : non', function() {
    expect(volatileSecretShouldResend(waiting, { value: 'v', acceptedInstance: 'new', resentFor: null }, 'new')).toBe(false);
  });
  it('aucune valeur gardée : non', function() {
    expect(volatileSecretShouldResend(waiting, null, 'new')).toBe(false);
    expect(volatileSecretShouldResend(waiting, { value: '' }, 'new')).toBe(false);
  });
  it('consommateurs déjà jugés (refus, indéterminé) ou prêts : non', function() {
    expect(volatileSecretShouldResend(entry('k', [consumer('a', 'pending', 'rejected')]), kept, 'new')).toBe(false);
    expect(volatileSecretShouldResend(entry('k', [consumer('a', 'ready', 'accepted')]), kept, 'new')).toBe(false);
  });
});

describe('volatileSecretAfterSubmit — garde en session après une saisie', function() {
  it('acceptée partout : gardée', function() {
    expect(volatileSecretAfterSubmit(entry('k', [consumer('a', 'ready', 'accepted'), consumer('b', 'ready', 'accepted')]), false)).toBe('store');
  });
  it('acceptée puis refusée par le suivant : pas gardée', function() {
    var e = entry('k', [consumer('a', 'ready', 'accepted'), consumer('b', 'pending', 'rejected')]);
    expect(volatileSecretAfterSubmit(e, false)).toBe('none');
    expect(volatileSecretAfterSubmit(e, true)).toBe('drop');
  });
  it('refus de la valeur gardée (renvoi) : oubliée', function() {
    expect(volatileSecretAfterSubmit(entry('k', [consumer('a', 'pending', 'rejected')]), true)).toBe('drop');
  });
  it('refus d\'une valeur nouvelle (remplacement refusé) : la gardée reste', function() {
    expect(volatileSecretAfterSubmit(entry('k', [consumer('a', 'ready', 'rejected')], true), false)).toBe('none');
  });
  it('indéterminé ou incomplet seulement : rien ne change', function() {
    expect(volatileSecretAfterSubmit(entry('k', [consumer('a', 'pending', 'indeterminate')]), true)).toBe('none');
    expect(volatileSecretAfterSubmit(entry('k', [consumer('a', 'pending', 'incomplete')]), false)).toBe('none');
  });
  it('accepté + indéterminé, sans refus : gardée', function() {
    expect(volatileSecretAfterSubmit(entry('k', [consumer('a', 'ready', 'accepted'), consumer('b', 'pending', 'indeterminate')]), false)).toBe('store');
  });
});

describe('volatileSecretSessionKey — carte, URL et clef', function() {
  it('même carte, URL normalisée : même entrée', function() {
    expect(volatileSecretSessionKey('proxy', 'HTTP://127.0.0.1:8765/mcp/', 'k')).toBe(volatileSecretSessionKey('proxy', 'http://127.0.0.1:8765/mcp', 'k'));
  });
  it('URL changée : autre entrée (la valeur ne suit pas la carte)', function() {
    expect(volatileSecretSessionKey('proxy', 'http://127.0.0.1:8765/mcp', 'k') === volatileSecretSessionKey('proxy', 'http://127.0.0.1:9000/mcp', 'k')).toBe(false);
  });
  it('préfixe propre, clefs avec espaces et deux-points sans collision', function() {
    var a = volatileSecretSessionKey('a:b', 'http://h/mcp', 'c');
    var b = volatileSecretSessionKey('a', 'http://h/mcp', 'b:c');
    expect(a.indexOf('miaou-volatile-secret:')).toBe(0);
    expect(a === b).toBe(false);
  });
});

describe('volatileSecretFailureText — refus de l\'extension, code par égalité', function() {
  it('garde d\'origine, clef inconnue, paramètres', function() {
    expect(volatileSecretFailureText({ message: 'ouvrir http://127.0.0.1:8765/app/', data: { code: 'SECRET_ORIGIN_REFUSED' } })).toContain('adresse de la page');
    expect(volatileSecretFailureText({ message: 'x', data: { code: 'SECRET_UNKNOWN_KEY' } })).toContain('n\'attend plus');
    expect(volatileSecretFailureText({ message: 'x', data: { code: 'SECRET_INVALID_PARAMS' } })).toContain('Saisie refusée');
  });
  it('code voisin : jamais par sous-chaîne', function() {
    expect(volatileSecretFailureText({ message: 'x', data: { code: 'SECRET_ORIGIN_REFUSED_V2' } })).toBe('Échec : x');
  });
});

describe('resolveAuthorizationPending — troisième cause : mot de passe requis', function() {
  function ok(up) { return { state: 'ok', count: 2, unauthorizedUpstreams: up || [] }; }
  it('mot de passe requis : compte des MOTS DE PASSE, cartes listées', function() {
    var r = resolveAuthorizationPending({ proxy: ok(), autre: ok() }, { proxy: 2 });
    expect(r.visible).toBe(true);
    expect(r.severity).toBe('secret');
    expect(r.count).toBe(2);
    expect(r.servers).toEqual(['proxy']);
    expect(r.label).toBe('2 mots de passe requis');
  });
  it('singulier', function() {
    expect(resolveAuthorizationPending({ proxy: ok() }, { proxy: 1 }).label).toBe('1 mot de passe requis');
  });
  it('avant « à autoriser »', function() {
    var r = resolveAuthorizationPending({ a: ok([{ name: 'jira' }]), b: ok() }, { b: 1 });
    expect(r.severity).toBe('secret');
    expect(r.servers).toEqual(['b']);
  });
  it('après l\'erreur', function() {
    var r = resolveAuthorizationPending({ a: { state: 'error', count: 0 }, b: ok() }, { b: 1 });
    expect(r.severity).toBe('error');
  });
  it('serveur en erreur : son attente ne compte pas', function() {
    var r = resolveAuthorizationPending({ a: { state: 'error', count: 0 } }, { a: 1 });
    expect(r.count).toBe(1);
    expect(r.label).toBe('1 serveur injoignable');
  });
  it('carte inconnue des statuts, compte nul : ignorés', function() {
    expect(resolveAuthorizationPending({ a: ok() }, { fantome: 3, a: 0 }).visible).toBe(false);
  });
  it('sans second argument : inchangé', function() {
    expect(resolveAuthorizationPending({ a: ok([{ name: 'jira' }]) }).severity).toBe('pending');
  });
});

describe('mcpStatusPill — mots de passe requis sur la carte', function() {
  it('annoncés, ton d\'attente', function() {
    var p = mcpStatusPill({ state: 'ok', count: 3 }, 1);
    expect(p.tone).toBe('pending');
    expect(p.text).toBe('● Connecté — 3 outils, 1 mot de passe requis');
  });
  it('avant les services à autoriser', function() {
    var p = mcpStatusPill({ state: 'ok', count: 1, unauthorizedUpstreams: [{ name: 'x' }] }, 2);
    expect(p.text).toBe('● Connecté — 1 outil, 2 mots de passe requis, 1 service à autoriser');
  });
  it('sans compte : inchangé', function() {
    expect(mcpStatusPill({ state: 'ok', count: 1 }).tone).toBe('ok');
  });
});

// ── Câblage : lecture, renvoi, dépôt, oubli (mcpRpc et connectMcpServer stubés) ──
// Le moteur des tests n'a ni `location` ni `sessionStorage` : posés ici, propres
// à ce fichier (un contexte par fichier de test).
var location = { protocol: 'http:', origin: 'http://127.0.0.1:8765' };
var sessionStorage = (function() {
  var store = {};
  return {
    getItem: function(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v) { store[k] = String(v); },
    removeItem: function(k) { delete store[k]; },
    key: function(i) { return Object.keys(store)[i] || null; },
    get length() { return Object.keys(store).length; },
    _all: function() { return store; },
  };
})();

var CARD = { name: 'proxy', url: 'http://127.0.0.1:8765/mcp', enabled: true };

function mountSecrets(opts) {
  var o = opts || {};
  var saved = { rpc: mcpRpc, connect: connectMcpServer };
  var calls = [], connects = [];
  var state = { instance: o.instance || 'inst-new', consumers: o.consumers || [consumer('api', 'pending')], verdict: o.verdict || 'accepted' };
  localStorage.setItem('miaou-mcp-servers', JSON.stringify([CARD]));
  _remoteStatus.proxy = { state: 'ok', count: 1, secretsDeclared: true };
  mcpRpc = function(server, method, params) {
    calls.push({ method: method, params: params });
    if (method === MCP_SECRETS_STATUS_METHOD) return Promise.resolve({ status: { instance: state.instance, secrets: [{ key: 'K', held: false, consumers: state.consumers }] } });
    if (method === MCP_SECRETS_SUBMIT_METHOD) {
      var v = typeof state.verdict === 'function' ? state.verdict(params.value) : state.verdict;
      state.consumers = state.consumers.map(function(c) { return consumer(c.upstream, v === 'accepted' ? 'ready' : c.state, v); });
      return Promise.resolve({ secret: { key: 'K', held: v === 'accepted', consumers: state.consumers } });
    }
    if (method === MCP_SECRETS_FORGET_METHOD) {
      state.consumers = state.consumers.map(function(c) { return consumer(c.upstream, 'pending', null); });
      return Promise.resolve({ secret: { key: 'K', held: false, consumers: state.consumers } });
    }
    return Promise.resolve({});
  };
  connectMcpServer = function(s) { connects.push(s.name); return Promise.resolve(true); };
  return { calls: calls, connects: connects, state: state,
    submits: function() { return calls.filter(function(c) { return c.method === MCP_SECRETS_SUBMIT_METHOD; }); },
    done: function() {
      mcpRpc = saved.rpc; connectMcpServer = saved.connect;
      delete _remoteStatus.proxy;
      _volatileSecrets = {};
      localStorage.removeItem('miaou-mcp-servers');
      var all = sessionStorage._all(); Object.keys(all).forEach(function(k) { delete all[k]; });
      location.protocol = 'http:'; location.origin = 'http://127.0.0.1:8765';
    } };
}

function keep(value, acceptedInstance, resentFor) {
  sessionStorage.setItem(volatileSecretSessionKey(CARD.name, CARD.url, 'K'), JSON.stringify({ value: value, acceptedInstance: acceptedInstance, resentFor: resentFor || null }));
}
function kept() { return JSON.parse(sessionStorage.getItem(volatileSecretSessionKey(CARD.name, CARD.url, 'K')) || 'null'); }

describe('readVolatileSecretsStatus — renvoi d\'une valeur gardée', function() {
  it('proxy redémarré : renvoyée une fois, gardée comme acceptée par la nouvelle instance, serveur reconnecté', function() {
    var m = mountSecrets({});
    try {
      keep('pw', 'inst-old');
      runAsync(readVolatileSecretsStatus(CARD));
      expect(m.submits().length).toBe(1);
      expect(m.submits()[0].params).toEqual({ key: 'K', value: 'pw' });
      expect(kept()).toEqual({ value: 'pw', acceptedInstance: 'inst-new', resentFor: 'inst-new' });
      expect(m.connects).toEqual(['proxy']);
      expect(volatileSecretWaitingFor('proxy')).toBe(0);
    } finally { m.done(); }
  });
  it('pas de second renvoi à la même instance, même si le proxy l\'a oubliée de nouveau', function() {
    var m = mountSecrets({ verdict: 'indeterminate' });
    try {
      keep('pw', 'inst-old');
      runAsync(readVolatileSecretsStatus(CARD));
      m.state.consumers = [consumer('api', 'pending')];
      runAsync(readVolatileSecretsStatus(CARD));
      expect(m.submits().length).toBe(1);
      expect(kept().value).toBe('pw');
      expect(m.connects.length).toBe(0);
    } finally { m.done(); }
  });
  it('même instance que l\'acceptation (oubli fait ailleurs) : aucun renvoi', function() {
    var m = mountSecrets({});
    try {
      keep('pw', 'inst-new');
      runAsync(readVolatileSecretsStatus(CARD));
      expect(m.submits().length).toBe(0);
      expect(volatileSecretWaitingFor('proxy')).toBe(1);
    } finally { m.done(); }
  });
  it('renvoi refusé : valeur oubliée de la session', function() {
    var m = mountSecrets({ verdict: 'rejected' });
    try {
      keep('pw', 'inst-old');
      runAsync(readVolatileSecretsStatus(CARD));
      expect(kept()).toBe(null);
      expect(m.connects.length).toBe(0);
    } finally { m.done(); }
  });
  it('page non servie : aucun appel, état illisible, rien compté', function() {
    var m = mountSecrets({});
    try {
      location.protocol = 'file:'; location.origin = 'null';
      keep('pw', 'inst-old');
      runAsync(readVolatileSecretsStatus(CARD));
      expect(m.calls.length).toBe(0);
      expect(volatileSecretsEntry('proxy').unavailable.reason).toBe('not-served');
      expect(volatileSecretWaitingFor('proxy')).toBe(0);
    } finally { m.done(); }
  });
});

describe('submitVolatileSecret / forgetVolatileSecret', function() {
  it('acceptée : gardée pour l\'instance relue juste avant, reconnexion', function() {
    var m = mountSecrets({});
    try {
      var r = runAsync(submitVolatileSecret('proxy', 'K', 'pw'));
      expect(r.error).toBe(null);
      expect(r.entry.consumers[0].verdict).toBe('accepted');
      expect(m.calls.map(function(c) { return c.method; })).toEqual([MCP_SECRETS_STATUS_METHOD, MCP_SECRETS_SUBMIT_METHOD]);
      expect(kept()).toEqual({ value: 'pw', acceptedInstance: 'inst-new', resentFor: 'inst-new' });
      expect(m.connects).toEqual(['proxy']);
    } finally { m.done(); }
  });
  it('nouvelle valeur refusée : la valeur gardée reste', function() {
    var m = mountSecrets({ verdict: 'rejected', consumers: [consumer('api', 'ready', 'accepted')] });
    try {
      keep('old', 'inst-new', 'inst-new');
      runAsync(submitVolatileSecret('proxy', 'K', 'nouveau'));
      expect(kept().value).toBe('old');
    } finally { m.done(); }
  });
  it('génération en cours : reconnexion différée jusqu\'à la fin', function() {
    var m = mountSecrets({});
    try {
      _activeGenerations.set('conv-x', {});
      runAsync(submitVolatileSecret('proxy', 'K', 'pw'));
      expect(m.connects.length).toBe(0);
      _activeGenerations.delete('conv-x');
      flushVolatileSecretReconnects();
      runAsync(Promise.resolve());
      expect(m.connects).toEqual(['proxy']);
    } finally { _activeGenerations.delete('conv-x'); m.done(); }
  });
  it('oubli : valeur retirée de la session, consommateurs en attente', function() {
    var m = mountSecrets({ consumers: [consumer('api', 'ready', 'accepted')] });
    try {
      runAsync(readVolatileSecretsStatus(CARD));
      keep('pw', 'inst-new', 'inst-new');
      var r = runAsync(forgetVolatileSecret('proxy', 'K'));
      expect(r.entry.consumers[0].state).toBe('pending');
      expect(kept()).toBe(null);
      expect(volatileSecretWaitingFor('proxy')).toBe(1);
    } finally { m.done(); }
  });
  it('carte supprimée ou URL changée : valeurs gardées purgées', function() {
    var m = mountSecrets({});
    try {
      keep('pw', 'inst-new');
      localStorage.setItem('miaou-mcp-servers', JSON.stringify([{ name: 'proxy', url: 'http://127.0.0.1:9999/mcp', enabled: true }]));
      pruneVolatileSecrets();
      expect(sessionStorage.length).toBe(0);
    } finally { m.done(); }
  });
});

describe('Refus SECRET_REQUIRED à l\'appel d\'outil — purs', function() {
  it('ackSecretTarget : code ET carte existante requis', function() {
    var m = { errorCode: 'SECRET_REQUIRED', mcpServer: 'proxy', upstream: 'api' };
    expect(ackSecretTarget(m, true)).toEqual({ server: 'proxy', upstream: 'api' });
    expect(ackSecretTarget(m, false)).toBe(null);
    expect(ackSecretTarget({ errorCode: 'AUTHORIZATION_REQUIRED', mcpServer: 'proxy' }, true)).toBe(null);
    expect(ackSecretTarget({ errorCode: 'SECRET_REQUIRED' }, true)).toBe(null);
  });
  it('applySecretRefusal pose les marqueurs, clearAuthorizationRefusal les retire ensemble', function() {
    var a = applySecretRefusal({ kind: 'mcp_call' }, 'SECRET_REQUIRED', { code: 'SECRET_REQUIRED', upstream: 'api' }, 'proxy');
    expect([a.errorCode, a.upstream, a.mcpServer]).toEqual(['SECRET_REQUIRED', 'api', 'proxy']);
    clearAuthorizationRefusal(a);
    expect([a.errorCode, a.upstream, a.mcpServer]).toEqual([undefined, undefined, undefined]);
    var b = applySecretRefusal({ kind: 'mcp_call' }, 'REF_UNKNOWN', {}, 'proxy');
    expect(b.errorCode).toBe(undefined);
  });
  it('les marqueurs sont dans la liste blanche des champs d\'ack (persistés)', function() {
    ['errorCode', 'upstream', 'mcpServer'].forEach(function(f) { expect(ACK_COPY_FIELDS.indexOf(f) >= 0).toBe(true); });
  });
  it('texte au modèle : seul l\'utilisateur, déjà affiché, jamais dans la conversation, temporaire', function() {
    var t = formatSecretRequiredForModel('proxy__api__get', 'upstream en attente');
    expect(t).toContain('upstream en attente');
    expect(t).toContain('seul l\'utilisateur');
    expect(t).toContain('déjà affiché');
    expect(t).toContain('JAMAIS ce mot de passe dans la conversation');
    expect(t).toContain('le même appel fonctionnera');
  });
});

describe('callRemoteTool sur SECRET_REQUIRED — renvoi puis rejeu unique', function() {
  function mountCall(opts) {
    var o = opts || {};
    var m = mountSecrets({ instance: 'inst-new', consumers: [consumer('api', 'pending')], verdict: o.verdict || 'accepted' });
    var base = mcpRpc;
    var tc = 0;
    mcpRpc = function(server, method, params) {
      if (method === 'tools/call') {
        tc++;
        var ready = m.state.consumers.every(function(c) { return c.state === 'ready'; });
        if (!ready) {
          var err = new Error('upstream « api » en attente d\'un mot de passe');
          err.data = { code: 'SECRET_REQUIRED', upstream: 'api' };
          err.applicative = true;
          return Promise.reject(err);
        }
        return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
      }
      return base(server, method, params);
    };
    m.toolCalls = function() { return tc; };
    return m;
  }
  it('valeur gardée, proxy redémarré : renvoyée, appel rejoué sur la même ligne, aucune trace d\'échec', function() {
    var m = mountCall({});
    try {
      keep('pw', 'inst-old');
      clearPendingToolAcks();
      var r = runAsync(callRemoteTool(CARD, 'api__get', {}, 'lire'));
      expect(r.isError).toBe(false);
      expect(m.toolCalls()).toBe(2);
      expect(m.submits().length).toBe(1);
      expect(_pendingToolAcks.length).toBe(1);
      expect([r.ackEntry.error, r.ackEntry.errorCode, r.ackEntry.mcpServer]).toEqual([undefined, undefined, undefined]);
      expect(m.connects.length).toBe(0);
    } finally { clearPendingToolAcks(); m.done(); }
  });
  it('sans valeur gardée : refus, marqueurs posés, texte au modèle, un seul appel', function() {
    var m = mountCall({});
    try {
      clearPendingToolAcks();
      var r = runAsync(callRemoteTool(CARD, 'api__get', {}, 'lire'));
      expect(r.isError).toBe(true);
      expect(m.toolCalls()).toBe(1);
      expect(r.ackEntry.errorCode).toBe('SECRET_REQUIRED');
      expect(r.ackEntry.upstream).toBe('api');
      expect(r.ackEntry.mcpServer).toBe('proxy');
      expect(r.content[0].text).toContain('JAMAIS ce mot de passe');
    } finally { clearPendingToolAcks(); m.done(); }
  });
  it('renvoi refusé : pas de rejeu, valeur oubliée', function() {
    var m = mountCall({ verdict: 'rejected' });
    try {
      keep('pw', 'inst-old');
      clearPendingToolAcks();
      var r = runAsync(callRemoteTool(CARD, 'api__get', {}, 'lire'));
      expect(r.isError).toBe(true);
      expect(m.toolCalls()).toBe(1);
      expect(kept()).toBe(null);
    } finally { clearPendingToolAcks(); m.done(); }
  });
});
