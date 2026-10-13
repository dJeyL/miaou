// tests/test-stall.js
// Modale de silence (stall.js) et chien de garde qui la déclenche (api.js).
// Purs seulement : la modale elle-même, le compte à rebours réel et la
// pastille d'icône se vérifient en navigateur
// (.claude/skills/run-miaou/verify-stall-dialog.mjs).

describe('watchdogExpiryAction — que faire quand le flux se tait', function() {
  it('une conversation racine pose la question dès la première expiration', function() {
    expect(watchdogExpiryAction(1, true, 3)).toBe('prompt');
  });
  it('la question est reposée à chaque expiration, sans limite de nombre', function() {
    // Le plafond d'une question sans réponse est porté par la modale, pas ici :
    // un utilisateur présent peut attendre autant de fois qu'il le veut.
    expect(watchdogExpiryAction(10, true, 3)).toBe('prompt');
  });
  it('sans question (agent), attente silencieuse jusqu\'au plafond, puis coupure', function() {
    expect(watchdogExpiryAction(1, false, 3)).toBe('rearm');
    expect(watchdogExpiryAction(2, false, 3)).toBe('rearm');
    expect(watchdogExpiryAction(3, false, 3)).toBe('abort');
  });
});

describe('stallRowRemainingMs — plafond d\'une ligne sans réponse', function() {
  it('décompte le plafond depuis l\'apparition de la ligne', function() {
    expect(stallRowRemainingMs(1000, 1000, 90000, 3)).toBe(270000);
    expect(stallRowRemainingMs(1000, 91000, 90000, 3)).toBe(180000);
  });
  it('ne descend jamais sous zéro', function() {
    expect(stallRowRemainingMs(0, 999999, 90000, 3)).toBe(0);
  });
});

describe('formats de la modale', function() {
  it('compte à rebours en m:ss, arrondi au-dessus', function() {
    expect(formatStallCountdown(270000)).toBe('4:30');
    expect(formatStallCountdown(5500)).toBe('0:06');
    expect(formatStallCountdown(0)).toBe('0:00');
  });
  it('durée de silence en secondes puis en minutes, avec insécables', function() {
    expect(formatStallDuration(45000)).toBe('45 s');
    expect(formatStallDuration(90000)).toBe('1 min 30 s');
    expect(formatStallDuration(120000)).toBe('2 min');
  });
});

describe('stallRowLabel — quelle conversation, et dans quel Espace', function() {
  var spaces = [{ id: 's1', name: 'Perso' }, { id: 's2', name: 'Boulot' }];
  it('Espace actif : le titre seul', function() {
    expect(stallRowLabel({ id: 'c', title: 'Recette', spaceId: 's1' }, 's1', spaces)).toEqual({ title: 'Recette', space: '' });
  });
  it('autre Espace : son nom en plus', function() {
    expect(stallRowLabel({ id: 'c', title: 'Recette', spaceId: 's2' }, 's1', spaces)).toEqual({ title: 'Recette', space: 'Boulot' });
  });
  it('libellé par convLabel : un extrait de secours tient lieu de titre', function() {
    expect(stallRowLabel({ id: 'c', snippet: 'Bonjour', spaceId: 's1' }, 's1', spaces).title).toBe('Bonjour');
  });
  it('sans titre ni extrait : un libellé de repli, jamais une ligne vide', function() {
    expect(stallRowLabel({ id: 'c', spaceId: 's1' }, 's1', spaces).title).toBe('Nouvelle conversation');
  });
  it('sans spaceId : Espace par défaut', function() {
    expect(stallRowLabel({ id: 'c', title: 'T' }, DEFAULT_SPACE_ID, spaces).space).toBe('');
  });
});

describe('stallHooksFor — la question n\'est posée que pour une racine', function() {
  it('racine : hooks fournis ; agent : aucun ; conversation inconnue : aucun', function() {
    resetConvCacheForTests();
    saveConversation({ id: 'R', title: 'racine', timestamp: 1, updatedAt: 1, messages: [] });
    saveConversation({ id: 'A', parentConvId: 'R', timestamp: 1, updatedAt: 1, messages: [] });
    var root = stallHooksFor({ convId: 'R' });
    expect(typeof root.onStall).toBe('function');
    expect(typeof root.onStallEnd).toBe('function');
    expect(stallHooksFor({ convId: 'A' })).toBe(null);
    expect(stallHooksFor({ convId: 'inconnue' })).toBe(null);
  });
});

describe('stall-attention — pastille d\'icône partagée entre fenêtres', function() {
  var CTX = { tabId: 'me', currentConvId: 'c1', activeSpaceId: 's1' };
  it('fait partie de la liste fermée des types', function() {
    expect(!!validateEnvelope({ v: 1, type: 'stall-attention', tabId: 'tab_a', payload: { on: true } })).toBe(true);
  });
  it('routé avec l\'onglet émetteur, quelle que soit la conv affichée', function() {
    expect(routeMessage(makeEnvelope('stall-attention', 'other', { on: true }), CTX))
      .toEqual({ action: 'stall-attention', tabId: 'other', on: true });
  });
  it('tout ce qui n\'est pas exactement true vaut levée', function() {
    expect(routeMessage(makeEnvelope('stall-attention', 'other', { on: 'yes' }), CTX).on).toBe(false);
    expect(routeMessage(makeEnvelope('stall-attention', 'other', {}), CTX).on).toBe(false);
  });
  it('un pair compte tant que son heartbeat est frais', function() {
    expect(stallPeersWaiting({ t1: 1000 }, 5000, 10000)).toBe(true);
    expect(stallPeersWaiting({ t1: 1000 }, 20000, 10000)).toBe(false);
    expect(stallPeersWaiting({}, 0, 10000)).toBe(false);
  });
});
