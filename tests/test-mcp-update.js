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
