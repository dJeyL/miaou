// tests/test-mcp-update.js
// Mise à jour à la demande du proxy MCP (mcp-update.js). Purs seulement : les
// appels réseau, les toasts et la surface Réglages › Application se vérifient
// contre un vrai proxy (cf. docs/mcp.md, « Mise à jour du proxy »).

var SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
var SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function wireStatus(over) {
  var s = {
    state: 'behind', detail: null, remedy: null, branch: 'trunk', remote: 'fork',
    remote_ref: 'refs/heads/trunk', head: SHA_A, target: SHA_B, ahead: 0, behind: 2,
    dirty: [], update: { kind: 'proxy', paths: 3, subjects: ['feat: b', 'fix: a'], subjects_total: 2 },
    checked_at: '2026-10-13T10:00:00+00:00', supervised: true, applying: false, served_build: 'build1',
  };
  for (var k in (over || {})) s[k] = over[k];
  return { status: s };
}

describe('mcpDeclaresUpdateExtension', function() {
  it('présence de la clé dans capabilities.extensions', function() {
    expect(mcpDeclaresUpdateExtension({ capabilities: { extensions: { 'miaou/self-update': {} } } })).toBe(true);
  });
  it('absente, autre extension, forme inattendue : faux', function() {
    expect(mcpDeclaresUpdateExtension({ capabilities: { extensions: { 'io.modelcontextprotocol/skills': {} } } })).toBe(false);
    expect(mcpDeclaresUpdateExtension({ capabilities: {} })).toBe(false);
    expect(mcpDeclaresUpdateExtension(null)).toBe(false);
  });
});

describe('normalizeProxyUpdateStatus — lecture défensive à la frontière', function() {
  it('réponse enveloppée, renommage en camelCase', function() {
    var st = normalizeProxyUpdateStatus(wireStatus());
    expect(st.state).toBe('behind');
    expect(st.target).toBe(SHA_B);
    expect(st.servedBuild).toBe('build1');
    expect(st.checkedAt).toBe('2026-10-13T10:00:00+00:00');
    expect(st.update).toEqual({ kind: 'proxy', paths: 3, subjects: ['feat: b', 'fix: a'], subjectsTotal: 2 });
  });
  it('réponse à plat (non enveloppée) ou sans état : rien', function() {
    expect(normalizeProxyUpdateStatus(wireStatus().status)).toBe(null);
    expect(normalizeProxyUpdateStatus({ status: { state: '' } })).toBe(null);
    expect(normalizeProxyUpdateStatus({})).toBe(null);
    expect(normalizeProxyUpdateStatus(null)).toBe(null);
  });
  it('seuls behind et dirty portent une mise à jour', function() {
    expect(normalizeProxyUpdateStatus(wireStatus({ state: 'up_to_date' })).update).toBe(null);
    expect(normalizeProxyUpdateStatus(wireStatus({ state: 'dirty' })).update.kind).toBe('proxy');
  });
  it('mise à jour sans cible valide ou de genre inconnu : retirée', function() {
    expect(normalizeProxyUpdateStatus(wireStatus({ target: 'abc' })).update).toBe(null);
    expect(normalizeProxyUpdateStatus(wireStatus({ update: { kind: 'autre' } })).update).toBe(null);
  });
  it('état inconnu gardé, sans mise à jour', function() {
    var st = normalizeProxyUpdateStatus(wireStatus({ state: 'futur' }));
    expect(st.state).toBe('futur');
    expect(st.update).toBe(null);
  });
  it('checking : champs absents ramenés à des valeurs neutres', function() {
    var st = normalizeProxyUpdateStatus({ status: { state: 'checking', head: null, dirty: null, update: null, supervised: true } });
    expect(st.head).toBe(null);
    expect(st.dirty).toEqual([]);
    expect(st.behind).toBe(0);
    expect(st.supervised).toBe(true);
  });
});

describe('proxyUpdateAvailable / proxyUpdateApplicable', function() {
  it('behind, supervisé, rien en cours : applicable', function() {
    var st = normalizeProxyUpdateStatus(wireStatus());
    expect(proxyUpdateAvailable(st)).toBe(true);
    expect(proxyUpdateApplicable(st)).toBe(true);
  });
  it('dirty, non supervisé, application en cours : disponible mais pas applicable', function() {
    ['dirty'].forEach(function(state) {
      var st = normalizeProxyUpdateStatus(wireStatus({ state: state }));
      expect(proxyUpdateAvailable(st)).toBe(true);
      expect(proxyUpdateApplicable(st)).toBe(false);
    });
    expect(proxyUpdateApplicable(normalizeProxyUpdateStatus(wireStatus({ supervised: false })))).toBe(false);
    expect(proxyUpdateApplicable(normalizeProxyUpdateStatus(wireStatus({ applying: true })))).toBe(false);
  });
  it('à jour, ou état absent : rien', function() {
    expect(proxyUpdateAvailable(normalizeProxyUpdateStatus(wireStatus({ state: 'up_to_date' })))).toBe(false);
    expect(proxyUpdateAvailable(null)).toBe(false);
    expect(proxyUpdateApplicable(null)).toBe(false);
  });
});

describe('proxyUpdateKindLabel — le libellé suit le genre', function() {
  it('trois libellés distincts', function() {
    expect(proxyUpdateKindLabel('miaou')).toBe('Nouvelle version de MIAOU');
    expect(proxyUpdateKindLabel('proxy')).toBe('Mise à jour des serveurs MCP');
    expect(proxyUpdateKindLabel('both')).toBe('Nouvelle version de MIAOU et mise à jour des serveurs MCP');
  });
});

describe('isServedByProxy — page servie ET empreinte égale', function() {
  it('les deux conditions sont exigées', function() {
    expect(isServedByProxy(true, 'b1', 'b1')).toBe(true);
    expect(isServedByProxy(false, 'b1', 'b1')).toBe(false);
    expect(isServedByProxy(true, 'b2', 'b1')).toBe(false);
  });
  it('empreinte inconnue d\'un côté ou de l\'autre : faux', function() {
    expect(isServedByProxy(true, null, 'b1')).toBe(false);
    expect(isServedByProxy(true, '', '')).toBe(false);
  });
});

describe('proxyUpdateAfterApply — ce qui suit un apply réussi', function() {
  it('genre miaou, servi par ce proxy : pas de redémarrage, relecture de version.json', function() {
    expect(proxyUpdateAfterApply({ restart: false, kind: 'miaou' }, true)).toEqual({ waitRestart: false, checkReload: true });
  });
  it('genre proxy : redémarrage, jamais de rechargement', function() {
    expect(proxyUpdateAfterApply({ restart: true, kind: 'proxy' }, true)).toEqual({ waitRestart: true, checkReload: false });
  });
  it('genre both servi ailleurs : redémarrage seul', function() {
    expect(proxyUpdateAfterApply({ restart: true, kind: 'both' }, false)).toEqual({ waitRestart: true, checkReload: false });
    expect(proxyUpdateAfterApply({ restart: true, kind: 'both' }, true)).toEqual({ waitRestart: true, checkReload: true });
  });
});

describe('proxyRestartLanded — le nouveau processus, pas l\'ancien qui s\'arrête', function() {
  it('head = sha d\'avant : encore l\'ancien', function() {
    expect(proxyRestartLanded({ head: SHA_A }, SHA_A)).toBe(false);
  });
  it('head = cible, ou nul pendant la première sonde : le nouveau', function() {
    expect(proxyRestartLanded({ head: SHA_B }, SHA_A)).toBe(true);
    expect(proxyRestartLanded({ head: null }, SHA_A)).toBe(true);
  });
  it('état illisible : pas encore', function() {
    expect(proxyRestartLanded(null, SHA_A)).toBe(false);
  });
});

describe('proxyUpdateFailureText — la cause est gardée', function() {
  function rpcErr(message, data) { var e = new Error(message); e.data = data; return e; }
  it('refus applicatif : message du proxy repris', function() {
    var t = proxyUpdateFailureText(rpcErr('Une mise à jour est déjà en cours.', { code: 'UPDATE_IN_PROGRESS' }));
    expect(t).toBe('Mise à jour refusée : Une mise à jour est déjà en cours.');
  });
  it('retour arrière en échec : la commande suit', function() {
    var t = proxyUpdateFailureText(rpcErr('reset impossible', { code: 'UPDATE_ROLLBACK_FAILED', remedy: 'git reset --hard abc' }));
    expect(t.indexOf('le retour arrière a échoué') > 0).toBe(true);
    expect(t.indexOf('reset impossible') > 0).toBe(true);
    expect(t.indexOf('git reset --hard abc') > 0).toBe(true);
  });
  it('code testé par égalité : un préfixe proche n\'est pas un refus de mise à jour', function() {
    var t = proxyUpdateFailureText(rpcErr('x', { code: 'UPDATE' }));
    expect(t).toBe('Mise à jour impossible : x');
  });
  it('délai dépassé', function() {
    var e = new Error('Délai dépassé (1000 ms).'); e.timeout = true;
    expect(proxyUpdateFailureText(e).indexOf('n\'a pas répondu') > 0).toBe(true);
  });
});

describe('proxyUpdateStateText — la cause en clair pour chaque état non nominal', function() {
  function st(over) { return normalizeProxyUpdateStatus(wireStatus(over)); }
  it('en retard, supervisé : libellé du genre et retard', function() {
    expect(proxyUpdateStateText(st(), null)).toBe('Mise à jour des serveurs MCP disponible : 2 commits de retard.');
  });
  it('en retard, non supervisé : à faire à la main, avec la raison', function() {
    var t = proxyUpdateStateText(st({ supervised: false }), null);
    expect(t.indexOf('superviseur') > 0).toBe(true);
    expect(t.indexOf('à la main') > 0).toBe(true);
  });
  it('arbre sale : bloquée, fichiers nommés', function() {
    var t = proxyUpdateStateText(st({ state: 'dirty', dirty: ['config.site.json'] }), null);
    expect(t.indexOf('bloquée') > 0).toBe(true);
    expect(t.indexOf('config.site.json') > 0).toBe(true);
  });
  it('état non nominal : cause brute et commande du proxy reprises', function() {
    var t = proxyUpdateStateText(st({ state: 'repo_refused', update: null, detail: 'dubious ownership', remedy: 'git config --global --add safe.directory X' }), null);
    expect(t.indexOf('Cause : dubious ownership') > 0).toBe(true);
    expect(t.indexOf('Commande : git config') > 0).toBe(true);
  });
  it('état inconnu montré brut', function() {
    expect(proxyUpdateStateText(st({ state: 'futur', update: null }), null)).toBe('État « futur ».');
  });
  it('lecture en échec : son erreur', function() {
    expect(proxyUpdateStateText(null, 'Délai dépassé')).toBe('État illisible : Délai dépassé');
  });
  it('à jour, arbre sale sans mise à jour : signalé sans alarme', function() {
    expect(proxyUpdateStateText(st({ state: 'up_to_date', update: null, dirty: ['a', 'b'] }), null))
      .toBe('À jour. Fichiers suivis modifiés dans le clone du proxy : 2.');
  });
});

describe('proxyUpdateToastText', function() {
  function st(over) { return normalizeProxyUpdateStatus(wireStatus(over)); }
  it('un seul proxy : sans son nom', function() {
    expect(proxyUpdateToastText(st({ update: { kind: 'miaou', paths: 1, subjects: [], subjects_total: 0 } }), 'local', false))
      .toBe('Nouvelle version de MIAOU disponible.');
  });
  it('plusieurs : nommé ; non applicable : à faire à la main', function() {
    expect(proxyUpdateToastText(st({ supervised: false }), 'travail', true))
      .toBe('Mise à jour des serveurs MCP disponible (« travail »), à faire à la main.');
  });
});

describe('proxyUpdateToastAction — une proposition par cible', function() {
  function st(over) { return normalizeProxyUpdateStatus(wireStatus(over)); }
  it('nouvelle cible : montrer ; cible déjà proposée : rien', function() {
    expect(proxyUpdateToastAction(st(), '')).toBe('show');
    expect(proxyUpdateToastAction(st(), SHA_B)).toBe('');
  });
  it('plus rien à prendre, ou application en cours ailleurs : retirer', function() {
    expect(proxyUpdateToastAction(st({ state: 'up_to_date' }), SHA_B)).toBe('dismiss');
    expect(proxyUpdateToastAction(st({ applying: true }), SHA_B)).toBe('dismiss');
  });
  it('lecture en échec : ne rien changer (le proxy redémarre peut-être)', function() {
    expect(proxyUpdateToastAction(null, SHA_B)).toBe('');
  });
});

describe('proxyUpdateLocalBlock — génération en cours dans cet onglet', function() {
  it('redémarrage + génération : refus expliqué', function() {
    expect(proxyUpdateLocalBlock('proxy', 1).indexOf('Génération en cours') === 0).toBe(true);
    expect(proxyUpdateLocalBlock('both', 2) !== '').toBe(true);
  });
  it('genre miaou (rien ne redémarre), ou rien en cours : permis', function() {
    expect(proxyUpdateLocalBlock('miaou', 3)).toBe('');
    expect(proxyUpdateLocalBlock('proxy', 0)).toBe('');
  });
});

describe('shouldReadProxyUpdates', function() {
  it('première lecture immédiate, puis au plus une par intervalle', function() {
    expect(shouldReadProxyUpdates(0, 5, 60000)).toBe(true);
    expect(shouldReadProxyUpdates(1000, 60999, 60000)).toBe(false);
    expect(shouldReadProxyUpdates(1000, 61000, 60000)).toBe(true);
  });
});

describe('proxyReloadDecision — recharger automatiquement, sauf perte', function() {
  it('nouvelle empreinte servie, rien à perdre : rechargement automatique', function() {
    expect(proxyReloadDecision('b2', '')).toBe('reload');
  });
  it('nouvelle empreinte, brouillon ou génération : repli sur le toast « Recharger »', function() {
    expect(proxyReloadDecision('b2', 'Génération en cours…')).toBe('offer');
  });
  it('empreinte inchangée (seules des icônes ont bougé, ou lecture en échec) : rien', function() {
    expect(proxyReloadDecision('', '')).toBe('none');
    expect(proxyReloadDecision('', 'Génération en cours…')).toBe('none');
  });
});

// ── Cycle de vie du proxy (extension miaou/lifecycle) ────────────────────────

function wireLifecycle(over, config) {
  var c = { state: 'unchanged', changed: [], changed_total: 0, detail: null,
    layers: ['/srv/proxy/config.defaults.json', '/srv/proxy/config.json'], checked_at: '2026-10-15T10:05:00+00:00' };
  for (var k in (config || {})) c[k] = config[k];
  var s = { instance: '0123456789abcdef', started_at: '2026-10-15T10:00:00+00:00', restartable: true, restarting: false, config: c };
  for (var j in (over || {})) s[j] = over[j];
  // Le SDK ajoute ces deux clés à tout résultat : la lecture ne doit pas s'y fier.
  return { status: s, _meta: { serverInfo: { name: 'miaou-proxy' } }, resultType: 'complete' };
}

describe('mcpDeclaresLifecycleExtension', function() {
  it('présence de la clé, indépendante de miaou/self-update', function() {
    expect(mcpDeclaresLifecycleExtension({ capabilities: { extensions: { 'miaou/lifecycle': {} } } })).toBe(true);
    expect(mcpDeclaresLifecycleExtension({ capabilities: { extensions: { 'miaou/self-update': {} } } })).toBe(false);
    expect(mcpDeclaresUpdateExtension({ capabilities: { extensions: { 'miaou/lifecycle': {} } } })).toBe(false);
    expect(mcpDeclaresLifecycleExtension(null)).toBe(false);
  });
});

describe('normalizeLifecycleStatus — lecture défensive à la frontière', function() {
  it('réponse enveloppée, renommage en camelCase, _meta et resultType ignorés', function() {
    var st = normalizeLifecycleStatus(wireLifecycle({}, { state: 'changed', changed: ['mcpServers.weather', 'port'], changed_total: 2 }));
    expect(st.instance).toBe('0123456789abcdef');
    expect(st.startedAt).toBe('2026-10-15T10:00:00+00:00');
    expect(st.restartable).toBe(true);
    expect(st.restarting).toBe(false);
    expect(st.config).toEqual({ state: 'changed', changed: ['mcpServers.weather', 'port'], changedTotal: 2, detail: null,
      layers: ['/srv/proxy/config.defaults.json', '/srv/proxy/config.json'], checkedAt: '2026-10-15T10:05:00+00:00' });
  });
  it('sans instance, à plat ou vide : illisible', function() {
    expect(normalizeLifecycleStatus(wireLifecycle({ instance: '' }))).toBe(null);
    expect(normalizeLifecycleStatus(wireLifecycle({ instance: 42 }))).toBe(null);
    expect(normalizeLifecycleStatus(wireLifecycle().status)).toBe(null);
    expect(normalizeLifecycleStatus(null)).toBe(null);
  });
  it('config absente : état nul, listes vides', function() {
    var st = normalizeLifecycleStatus({ status: { instance: 'abc' } });
    expect(st.config.state).toBe(null);
    expect(st.config.changed).toEqual([]);
    expect(st.config.layers).toEqual([]);
    expect(st.restartable).toBe(false);
  });
  it('état inconnu gardé tel quel', function() {
    expect(normalizeLifecycleStatus(wireLifecycle({}, { state: 'futur' })).config.state).toBe('futur');
  });
  it('changed_total jamais inférieur à la liste, entrées non textuelles retirées', function() {
    var st = normalizeLifecycleStatus(wireLifecycle({}, { state: 'changed', changed: ['port', 3, '', 'auth'], changed_total: 1 }));
    expect(st.config.changed).toEqual(['port', 'auth']);
    expect(st.config.changedTotal).toBe(2);
    expect(normalizeLifecycleStatus(wireLifecycle({}, { state: 'changed', changed: ['port'], changed_total: 25 })).config.changedTotal).toBe(25);
  });
  it('restartable et restarting : vrai seulement si booléen vrai', function() {
    var st = normalizeLifecycleStatus(wireLifecycle({ restartable: 'true', restarting: 1 }));
    expect(st.restartable).toBe(false);
    expect(st.restarting).toBe(false);
  });
});

describe('proxyInstanceChanged — un autre processus', function() {
  it('instance différente : le nouveau', function() {
    expect(proxyInstanceChanged({ instance: 'b' }, 'a')).toBe(true);
  });
  it('même instance : encore l\'ancien, qui s\'arrête', function() {
    expect(proxyInstanceChanged({ instance: 'a' }, 'a')).toBe(false);
  });
  it('sans identité d\'avant, ou lecture illisible : non', function() {
    expect(proxyInstanceChanged({ instance: 'b' }, null)).toBe(false);
    expect(proxyInstanceChanged({ instance: 'b' }, '')).toBe(false);
    expect(proxyInstanceChanged(null, 'a')).toBe(false);
  });
});

describe('proxyRestartWaitPlan / proxyRestartLandedFor — par instance, repli sur head', function() {
  it('instance connue : attente par instance, même quand head ne bouge pas (redémarrage sans mise à jour)', function() {
    var plan = proxyRestartWaitPlan('a', SHA_A);
    expect(plan).toEqual({ by: 'instance', before: 'a' });
    expect(proxyRestartLandedFor(plan, true, { instance: 'b', head: SHA_A })).toBe(true);
    expect(proxyRestartLandedFor(plan, true, { instance: 'a', head: SHA_B })).toBe(false);
  });
  it('instance inconnue (proxy antérieur à miaou/lifecycle) : repli sur head', function() {
    var plan = proxyRestartWaitPlan(null, SHA_A);
    expect(plan).toEqual({ by: 'head', before: SHA_A });
    expect(proxyRestartLandedFor(plan, true, { head: SHA_A })).toBe(false);
    expect(proxyRestartLandedFor(plan, true, { head: SHA_B })).toBe(true);
  });
  it('extension plus déclarée après reconnexion : revenu (l\'ancien la publiait)', function() {
    expect(proxyRestartLandedFor(proxyRestartWaitPlan('a', SHA_A), false, null)).toBe(true);
    expect(proxyRestartLandedFor(proxyRestartWaitPlan(null, SHA_A), false, null)).toBe(true);
  });
  it('lecture illisible : pas encore', function() {
    expect(proxyRestartLandedFor(proxyRestartWaitPlan('a', SHA_A), true, null)).toBe(false);
  });
});

var LC_CARD = { name: 'proxy', url: 'http://127.0.0.1:8765/mcp', enabled: true };

function mountLifecycle(responses) {
  var saved = mcpRpc;
  var calls = [];
  var queue = responses.slice();
  localStorage.setItem('miaou-mcp-servers', JSON.stringify([LC_CARD]));
  _remoteStatus.proxy = { state: 'ok', count: 1, lifecycleDeclared: true };
  mcpRpc = function(server, method, params) {
    calls.push({ method: method, params: params });
    var r = queue.shift();
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return { calls: calls, done: function() {
    mcpRpc = saved;
    delete _remoteStatus.proxy;
    _proxyLifecycle = {};
    localStorage.removeItem('miaou-mcp-servers');
  } };
}

describe('readProxyLifecycleStatus / proxyInstanceBeforeRestart', function() {
  it('lit status sans paramètre, range l\'état normalisé', function() {
    var m = mountLifecycle([wireLifecycle({}, { state: 'changed', changed: ['port'], changed_total: 1 })]);
    try {
      var st = runAsync(readProxyLifecycleStatus(LC_CARD));
      expect(m.calls[0].method).toBe('miaou/lifecycle/status');
      expect(m.calls[0].params).toEqual({});
      expect(st.config.changed).toEqual(['port']);
      expect(proxyLifecycleEntry('proxy').status.instance).toBe('0123456789abcdef');
      expect(proxyLifecycleEntry('proxy').error).toBe(null);
    } finally { m.done(); }
  });
  it('échec de lecture : état nul, cause gardée', function() {
    var m = mountLifecycle([new Error('connexion refusée')]);
    try {
      expect(runAsync(readProxyLifecycleStatus(LC_CARD))).toBe(null);
      expect(proxyLifecycleEntry('proxy').error).toBe('connexion refusée');
    } finally { m.done(); }
  });
  it('identité d\'avant relue à l\'instant, jamais celle de la dernière lecture', function() {
    var m = mountLifecycle([wireLifecycle({ instance: 'fedcba9876543210' })]);
    try {
      _proxyLifecycle.proxy = { status: normalizeLifecycleStatus(wireLifecycle()), error: null, readAt: 1 };
      expect(runAsync(proxyInstanceBeforeRestart(LC_CARD))).toBe('fedcba9876543210');
      expect(m.calls.length).toBe(1);
    } finally { m.done(); }
  });
  it('extension non déclarée : null, sans appel', function() {
    var m = mountLifecycle([]);
    try {
      _remoteStatus.proxy.lifecycleDeclared = false;
      expect(runAsync(proxyInstanceBeforeRestart(LC_CARD))).toBe(null);
      expect(m.calls.length).toBe(0);
    } finally { m.done(); }
  });
});

function lcStatus(over, config) { return normalizeLifecycleStatus(wireLifecycle(over, config)); }

describe('proxyLifecycleCutPaths — ce qui coupera MIAOU du proxy relancé', function() {
  it('port, host, auth toujours ; un serveur ou self_update jamais', function() {
    expect(proxyLifecycleCutPaths(['auth', 'host', 'mcpServers.weather', 'port', 'self_update'], false)).toEqual(['auth', 'host', 'port']);
  });
  it('miaou_dist seulement si la page est servie par ce proxy', function() {
    expect(proxyLifecycleCutPaths(['miaou_dist'], false)).toEqual([]);
    expect(proxyLifecycleCutPaths(['miaou_dist'], true)).toEqual(['miaou_dist']);
  });
  it('liste absente : rien', function() {
    expect(proxyLifecycleCutPaths(null, true)).toEqual([]);
  });
});

describe('proxyMaybeServesPage — dans le doute, oui', function() {
  it('file:// : jamais', function() {
    expect(proxyMaybeServesPage(false, null, 'build1')).toBe(false);
  });
  it('page servie, empreinte du proxy inconnue (pas de self_update) : peut-être', function() {
    expect(proxyMaybeServesPage(true, null, 'build1')).toBe(true);
  });
  it('page servie, empreinte connue : le prédicat d\'AT', function() {
    expect(proxyMaybeServesPage(true, { servedBuild: 'build1' }, 'build1')).toBe(true);
    expect(proxyMaybeServesPage(true, { servedBuild: 'autre' }, 'build1')).toBe(false);
    expect(proxyMaybeServesPage(true, { servedBuild: null }, 'build1')).toBe(false);
  });
});

describe('proxyRestartWarningText — dire quoi faire', function() {
  it('rien à craindre : texte vide', function() {
    expect(proxyRestartWarningText([])).toBe('');
  });
  it('port : l\'adresse, et où la modifier', function() {
    var t = proxyRestartWarningText(['port']);
    expect(t.indexOf('touche port :') > 0).toBe(true);
    expect(t.indexOf('son adresse peut changer') > 0).toBe(true);
    expect(t.indexOf('Serveurs MCP') > 0).toBe(true);
  });
  it('auth et miaou_dist : chacun sa phrase', function() {
    var t = proxyRestartWarningText(['auth', 'miaou_dist']);
    expect(t.indexOf('jeton') > 0).toBe(true);
    expect(t.indexOf('cette page comprise') > 0).toBe(true);
    expect(t.indexOf('adresse') < 0).toBe(true);
  });
});

describe('proxyLifecycleStateText — la ligne d\'Application', function() {
  it('inchangée, avec l\'heure du démarrage', function() {
    expect(proxyLifecycleStateText(lcStatus(), null, '15/10 10:00', false)).toBe('Configuration inchangée depuis le démarrage du proxy (15/10 10:00).');
  });
  it('modifiée : les chemins, et le reste compté', function() {
    var t = proxyLifecycleStateText(lcStatus({}, { state: 'changed', changed: ['mcpServers.weather', 'port'], changed_total: 23 }), null, '', false);
    expect(t).toBe('Configuration modifiée depuis le démarrage du proxy : mcpServers.weather, port et 21 de plus.');
  });
  it('invalide : la cause brute du proxy', function() {
    var t = proxyLifecycleStateText(lcStatus({}, { state: 'invalid', changed: ['port'], changed_total: 1, detail: 'config.json n\'est pas un JSON valide' }), null, '', false);
    expect(t).toBe('Configuration modifiée mais invalide : le proxy ne redémarrerait pas. Cause : config.json n\'est pas un JSON valide');
  });
  it('non supervisé : redémarrage à faire à la main', function() {
    var t = proxyLifecycleStateText(lcStatus({ restartable: false }), null, '', false);
    expect(t.indexOf('Redémarrage à faire à la main') > 0).toBe(true);
    expect(t.indexOf('scripts/supervise.sh') > 0).toBe(true);
  });
  it('mise à jour proposée qui redémarre : elle prendra aussi la config', function() {
    var t = proxyLifecycleStateText(lcStatus({}, { state: 'changed', changed: ['port'], changed_total: 1 }), null, '', true);
    expect(t.indexOf('La mise à jour proposée redémarrera aussi le proxy.') > 0).toBe(true);
    expect(proxyLifecycleStateText(lcStatus(), null, '', true).indexOf('mise à jour') < 0).toBe(true);
  });
  it('lecture en échec, état inconnu, redémarrage en cours', function() {
    expect(proxyLifecycleStateText(null, 'connexion refusée', '', false)).toBe('Configuration : état illisible : connexion refusée');
    expect(proxyLifecycleStateText(lcStatus({}, { state: 'futur' }), null, '', false)).toBe('Configuration : état « futur ».');
    expect(proxyLifecycleStateText(lcStatus({ restarting: true }), null, '', false).indexOf('Redémarrage du proxy en cours.') > 0).toBe(true);
  });
});

describe('proxyLifecycleToastAction — un toast par modification', function() {
  var changed = lcStatus({}, { state: 'changed', changed: ['port'], changed_total: 1 });
  it('modifiée, pas encore annoncée : montrer', function() {
    expect(proxyLifecycleToastAction(changed, undefined)).toBe('show');
  });
  it('même modification déjà annoncée (fermée à la croix) : rien', function() {
    expect(proxyLifecycleToastAction(changed, proxyLifecycleSignature(changed))).toBe('');
  });
  it('autre modification : montrer de nouveau', function() {
    var other = lcStatus({}, { state: 'changed', changed: ['mcpServers.weather', 'port'], changed_total: 2 });
    expect(proxyLifecycleToastAction(other, proxyLifecycleSignature(changed))).toBe('show');
  });
  it('invalide : montrer, même chemins que la modification annoncée', function() {
    var inv = lcStatus({}, { state: 'invalid', changed: ['port'], changed_total: 1, detail: 'JSON tronqué' });
    expect(proxyLifecycleToastAction(inv, proxyLifecycleSignature(changed))).toBe('show');
  });
  it('revenue à l\'identique, ou redémarrage en cours : retirer', function() {
    expect(proxyLifecycleToastAction(lcStatus(), proxyLifecycleSignature(changed))).toBe('dismiss');
    expect(proxyLifecycleToastAction(lcStatus({ restarting: true }, { state: 'changed', changed: ['port'], changed_total: 1 }), '')).toBe('dismiss');
  });
  it('lecture en échec : rien ne change', function() {
    expect(proxyLifecycleToastAction(null, proxyLifecycleSignature(changed))).toBe('');
  });
  it('autre processus, même config modifiée : nouvelle annonce', function() {
    var again = lcStatus({ instance: 'fedcba9876543210' }, { state: 'changed', changed: ['port'], changed_total: 1 });
    expect(proxyLifecycleToastAction(again, proxyLifecycleSignature(changed))).toBe('show');
  });
});

describe('proxyLifecycleToastText', function() {
  it('modifiée, superviseur ou non', function() {
    expect(proxyLifecycleToastText(lcStatus({}, { state: 'changed' }), 'p', false)).toBe('Configuration du proxy MCP modifiée.');
    expect(proxyLifecycleToastText(lcStatus({ restartable: false }, { state: 'changed' }), 'p', false)).toBe('Configuration du proxy MCP modifiée, redémarrage à faire à la main.');
  });
  it('invalide : la cause ; plusieurs serveurs : le nom', function() {
    expect(proxyLifecycleToastText(lcStatus({}, { state: 'invalid', detail: 'port refusé' }), 'p', true)).toBe('Configuration du proxy MCP invalide (« p ») : port refusé');
  });
});

describe('proxyRestartInFlight / proxyRestartForceText — le compte vient du refus', function() {
  function rpcErr(message, data) { var e = new Error(message); e.data = data; return e; }
  it('RESTART_TOOLS_IN_FLIGHT : data.count', function() {
    expect(proxyRestartInFlight(rpcErr('3 appels en cours', { code: 'RESTART_TOOLS_IN_FLIGHT', count: 3 }))).toBe(3);
  });
  it('compte absent : 0, la confirmation reste due', function() {
    expect(proxyRestartInFlight(rpcErr('appels en cours', { code: 'RESTART_TOOLS_IN_FLIGHT' }))).toBe(0);
  });
  it('autre refus, ou code voisin : null (égalité, pas sous-chaîne)', function() {
    expect(proxyRestartInFlight(rpcErr('x', { code: 'RESTART_CONFIG_INVALID', count: 3 }))).toBe(null);
    expect(proxyRestartInFlight(rpcErr('x', { code: 'RESTART_TOOLS_IN_FLIGHT_V2', count: 3 }))).toBe(null);
    expect(proxyRestartInFlight(new Error('réseau'))).toBe(null);
  });
  it('texte : singulier, pluriel, inconnu', function() {
    expect(proxyRestartForceText(1).indexOf('1 appel d’outil en cours sera coupé') === 0).toBe(true);
    expect(proxyRestartForceText(4).indexOf('4 appels d’outils en cours seront coupés') === 0).toBe(true);
    expect(proxyRestartForceText(0).indexOf('Des appels d’outils') === 0).toBe(true);
    expect(proxyRestartForceText(2).indexOf('tous clients du proxy MCP confondus') > 0).toBe(true);
  });
});

describe('proxyRestartFailureText — la cause est gardée', function() {
  function rpcErr(message, data) { var e = new Error(message); e.data = data; return e; }
  it('config invalide : le message du proxy, qui porte la cause', function() {
    expect(proxyRestartFailureText(rpcErr('Config invalide : port refusé', { code: 'RESTART_CONFIG_INVALID', detail: 'port refusé' })))
      .toBe('Redémarrage refusé, configuration invalide : Config invalide : port refusé');
  });
  it('non supervisé, mise à jour en cours : refusé, message repris', function() {
    expect(proxyRestartFailureText(rpcErr('Pas de superviseur.', { code: 'RESTART_NOT_SUPERVISED' }))).toBe('Redémarrage refusé : Pas de superviseur.');
    expect(proxyRestartFailureText(rpcErr('Mise à jour en cours.', { code: 'RESTART_UPDATE_IN_PROGRESS' }))).toBe('Redémarrage refusé : Mise à jour en cours.');
  });
  it('délai dépassé, autre échec', function() {
    var t = new Error('délai'); t.timeout = true;
    expect(proxyRestartFailureText(t)).toBe('Le proxy n’a pas répondu à la demande de redémarrage : délai');
    expect(proxyRestartFailureText(rpcErr('x', { code: 'RESTART_INCONNU' }))).toBe('Redémarrage impossible : x');
  });
});

describe('proxyRestartAcceptedInstance / proxyRestartLocalBlock / proxyBusyHoldsOffers', function() {
  it('l\'instance rendue par restart, sinon la dernière lue', function() {
    expect(proxyRestartAcceptedInstance({ restarting: true, instance: 'aaaa', _meta: {} }, 'bbbb')).toBe('aaaa');
    expect(proxyRestartAcceptedInstance({ restarting: true }, 'bbbb')).toBe('bbbb');
  });
  it('génération en cours : bloqué, sans forçage', function() {
    expect(proxyRestartLocalBlock(0)).toBe('');
    expect(proxyRestartLocalBlock(1).indexOf('Génération en cours') === 0).toBe(true);
  });
  it('les trois gestes qui redémarrent suspendent les propositions, pas la vérification', function() {
    expect(proxyBusyHoldsOffers('reboot')).toBe(true);
    expect(proxyBusyHoldsOffers('apply')).toBe(true);
    expect(proxyBusyHoldsOffers('restart')).toBe(true);
    expect(proxyBusyHoldsOffers('check')).toBe(false);
    expect(proxyBusyHoldsOffers(undefined)).toBe(false);
  });
  it('seule l\'attente du retour tient la santé à l\'écart, pas l\'apply ni la vérification', function() {
    expect(proxyBusyAwaitsRestart('reboot')).toBe(true);
    expect(proxyBusyAwaitsRestart('restart')).toBe(true);
    expect(proxyBusyAwaitsRestart('apply')).toBe(false);
    expect(proxyBusyAwaitsRestart('check')).toBe(false);
    expect(proxyBusyAwaitsRestart(undefined)).toBe(false);
  });
});

describe('proxyRestartTimeoutText', function() {
  it('chemins de coupure : la carte d\'abord', function() {
    expect(proxyRestartTimeoutText(3, ['port']).indexOf('modifier sa carte') > 0).toBe(true);
    expect(proxyRestartTimeoutText(3, []).indexOf('modifier sa carte') < 0).toBe(true);
    expect(proxyRestartTimeoutText(3, []).indexOf('après 3 minutes') > 0).toBe(true);
  });
});
