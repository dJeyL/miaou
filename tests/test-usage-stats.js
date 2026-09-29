// Statistiques de consommation de tokens — purs de la collecte (usage-stats.js).
// L'enregistrement IndexedDB et l'accroche aux deux points réseau relèvent du
// runtime (verify-usage-stats-collect.mjs) : QuickJS n'a ni IDB ni fetch.

describe('localDayKey — jour calendaire local', function() {
  it('rend YYYY-MM-DD en heure locale, avec pad', function() {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
    expect(localDayKey(new Date(2026, 10, 30, 0, 0).getTime())).toBe('2026-11-30');
  });
  it('même calcul que le nom de fichier d\'export (délégation, pas de second pad)', function() {
    var ts = new Date(2024, 1, 29, 12).getTime();
    expect(localDayKey(ts)).toBe(exportDateStamp(ts));
  });
});

describe('normalizeUsagePurpose — pas de liste fermée, oubli visible', function() {
  it('nature déclarée → gardée telle quelle (trim)', function() {
    expect(normalizeUsagePurpose('chat')).toBe('chat');
    expect(normalizeUsagePurpose(' early-title ')).toBe('early-title');
  });
  it('nature inconnue → gardée : une nature future ne touche pas ce pur', function() {
    expect(normalizeUsagePurpose('nature-future')).toBe('nature-future');
  });
  it('absente, vide, blanche ou non-chaîne → other', function() {
    expect(normalizeUsagePurpose(undefined)).toBe('other');
    expect(normalizeUsagePurpose('')).toBe('other');
    expect(normalizeUsagePurpose('   ')).toBe('other');
    expect(normalizeUsagePurpose(42)).toBe('other');
  });
});

describe('modelCallCounts — prédicat unique des deux points réseau', function() {
  it('réponse reçue → compte', function() {
    expect(modelCallCounts({ answered: true })).toBe(true);
  });
  it('interrompu (Stop, chien de garde, timeout), même avant la réponse → compte', function() {
    expect(modelCallCounts({ aborted: true })).toBe(true);
    expect(modelCallCounts({ answered: true, aborted: true })).toBe(true);
  });
  it('refus HTTP → ne compte pas, même interrompu pendant la lecture du corps d\'erreur', function() {
    expect(modelCallCounts({ refused: true })).toBe(false);
    expect(modelCallCounts({ refused: true, aborted: true })).toBe(false);
  });
  it('ni réponse ni abort (erreur réseau) → ne compte pas', function() {
    expect(modelCallCounts({})).toBe(false);
    expect(modelCallCounts(undefined)).toBe(false);
  });
});

describe('usageStatsDelta — un appel, mesuré ou non', function() {
  it('usage complet → mesuré, cache connu', function() {
    expect(usageStatsDelta({ prompt_tokens: 1000, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 600 } }))
      .toEqual({ calls: 1, unmeasured: 0, inTokens: 1000, cachedTokens: 600, cachedKnownCalls: 1, outTokens: 40 });
  });
  it('cache à 0 → une MESURE (connu), pas un inconnu', function() {
    var d = usageStatsDelta({ prompt_tokens: 10, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } });
    expect(d.cachedKnownCalls).toBe(1);
    expect(d.cachedTokens).toBe(0);
  });
  it('usage sans cache → mesuré, cache inconnu (cachedKnownCalls 0)', function() {
    expect(usageStatsDelta({ prompt_tokens: 10, completion_tokens: 2 }))
      .toEqual({ calls: 1, unmeasured: 0, inTokens: 10, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 2 });
  });
  it('usage nul (stream interrompu, backend muet) → compté, non mesuré, aucun token', function() {
    expect(usageStatsDelta(null))
      .toEqual({ calls: 1, unmeasured: 1, inTokens: 0, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 0 });
  });
  it('usage sans aucun des deux compteurs principaux → non mesuré, même avec un cache', function() {
    var d = usageStatsDelta({ prompt_tokens_details: { cached_tokens: 5 } });
    expect(d.unmeasured).toBe(1);
    expect(d.cachedKnownCalls).toBe(0);
    expect(d.cachedTokens).toBe(0);
  });
  it('un seul compteur principal → mesuré, l\'autre compte 0', function() {
    var d = usageStatsDelta({ completion_tokens: 7 });
    expect(d.unmeasured).toBe(0);
    expect(d.inTokens).toBe(0);
    expect(d.outTokens).toBe(7);
  });
});

describe('usageStatsKey / mergeUsageStatsRecord — agrégat par (jour, serveur, modèle, nature)', function() {
  var key = { day: '2026-09-28', serverId: 'srv-1', model: 'qwen', purpose: 'chat' };

  it('clef dans l\'ordre du keyPath du store, nature normalisée', function() {
    expect(usageStatsKey(key)).toEqual(['2026-09-28', 'srv-1', 'qwen', 'chat']);
    expect(usageStatsKey({ day: '2026-09-28', serverId: '', model: '' })).toEqual(['2026-09-28', '', '', 'other']);
  });

  it('record absent → record neuf portant la clef, le nom et le delta', function() {
    var r = mergeUsageStatsRecord(undefined, usageStatsDelta({ prompt_tokens: 5, completion_tokens: 1 }), key, 'Maison');
    expect(r).toEqual({ day: '2026-09-28', serverId: 'srv-1', model: 'qwen', purpose: 'chat', serverName: 'Maison',
      calls: 1, unmeasured: 0, inTokens: 5, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 1 });
  });

  it('fusion : sommes champ à champ, mesuré et non mesuré mêlés', function() {
    var r = mergeUsageStatsRecord(undefined, usageStatsDelta({ prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 80 } }), key, 'A');
    r = mergeUsageStatsRecord(r, usageStatsDelta(null), key, 'A');
    r = mergeUsageStatsRecord(r, usageStatsDelta({ prompt_tokens: 50, completion_tokens: 5 }), key, 'A');
    expect([r.calls, r.unmeasured, r.inTokens, r.cachedTokens, r.cachedKnownCalls, r.outTokens])
      .toEqual([3, 1, 150, 80, 1, 15]);
  });

  it('nom du serveur RÉÉCRIT à chaque fusion (dernier nom connu)', function() {
    var r = mergeUsageStatsRecord(undefined, usageStatsDelta(null), key, 'Ancien nom');
    r = mergeUsageStatsRecord(r, usageStatsDelta(null), key, 'Nouveau nom');
    expect(r.serverName).toBe('Nouveau nom');
  });

  it('ne mute pas le record précédent', function() {
    var prev = mergeUsageStatsRecord(undefined, usageStatsDelta({ prompt_tokens: 1, completion_tokens: 1 }), key, 'A');
    mergeUsageStatsRecord(prev, usageStatsDelta({ prompt_tokens: 1, completion_tokens: 1 }), key, 'A');
    expect(prev.calls).toBe(1);
  });

  it('champ absent ou non numérique dans un record lu → traité comme 0', function() {
    var r = mergeUsageStatsRecord({ calls: 2, inTokens: 'x' }, usageStatsDelta({ prompt_tokens: 3, completion_tokens: 1 }), key, 'A');
    expect(r.calls).toBe(3);
    expect(r.inTokens).toBe(3);
    expect(r.unmeasured).toBe(0);
  });
});

describe('noteModelUsage — composition vers recordModelUsage', function() {
  var _saved;
  it('clef du serveur CAPTURÉ, nature normalisée, jour du moment, delta de l\'usage', function() {
    _saved = recordModelUsage;
    var got = null;
    recordModelUsage = function(k, d, name) { got = { k: k, d: d, name: name }; return Promise.resolve(true); };
    try {
      noteModelUsage({ id: 'srv-9', name: 'Bureau' }, 'mistral', undefined, { prompt_tokens: 4, completion_tokens: 2 });
    } finally { recordModelUsage = _saved; }
    expect(usageStatsKey(got.k).slice(1)).toEqual(['srv-9', 'mistral', 'other']);
    expect(got.k.day).toBe(localDayKey(Date.now()));
    expect(got.name).toBe('Bureau');
    expect(got.d.inTokens).toBe(4);
  });
  it('aucun serveur (config vide) → clef serveur vide, jamais une exception', function() {
    _saved = recordModelUsage;
    var got = null;
    recordModelUsage = function(k, d, name) { got = { k: k, name: name }; return Promise.resolve(true); };
    try { noteModelUsage(null, '', 'chat', null); } finally { recordModelUsage = _saved; }
    expect(got.k.serverId).toBe('');
    expect(got.name).toBe('');
  });
});

describe('export / import des statistiques d\'usage', function() {
  var rec = { day: '2026-09-28', serverId: 'srv-1', model: 'qwen', purpose: 'chat', serverName: 'Maison',
    calls: 3, unmeasured: 1, inTokens: 150, cachedTokens: 80, cachedKnownCalls: 1, outTokens: 15 };

  it('buildExportPayload : section idb.usageStats, tableau vide par défaut', function() {
    expect(buildExportPayload({}, [], []).idb.usageStats).toEqual([]);
    expect(buildExportPayload({}, [], [], [], [], [rec]).idb.usageStats).toEqual([rec]);
  });
  it('pas de bump de version pour un champ optionnel en plus', function() {
    expect(buildExportPayload({}, [], [], [], [], [rec]).version).toBe(EXPORT_FORMAT_VERSION);
  });

  it('aller-retour : ce que l\'export écrit, l\'import le relit à l\'identique', function() {
    var payload = buildExportPayload({}, [], [], [], [], [rec]);
    expect(extractImportedUsageStats(JSON.parse(JSON.stringify(payload)))).toEqual([rec]);
  });
  it('sauvegarde sans section (antérieure aux statistiques) → rien : remplacement intégral vers vide', function() {
    expect(extractImportedUsageStats({ version: 3, idb: { conversations: [] } })).toEqual([]);
    expect(extractImportedUsageStats({ version: 1 })).toEqual([]);
    expect(extractImportedUsageStats(null)).toEqual([]);
  });
  it('record sans clef valide → écarté (un put sans clef avorterait tout l\'import)', function() {
    var bad = [
      Object.assign({}, rec, { day: '28/09/2026' }),
      Object.assign({}, rec, { serverId: 42 }),
      Object.assign({}, rec, { model: undefined }),
      Object.assign({}, rec, { purpose: '' }),
      null,
    ];
    expect(extractImportedUsageStats({ idb: { usageStats: bad.concat([rec]) } }).length).toBe(1);
  });
  it('compteur absent ou non numérique → 0, champ inconnu → retiré', function() {
    var out = extractImportedUsageStats({ idb: { usageStats: [
      { day: '2026-09-28', serverId: 's', model: 'm', purpose: 'title', calls: 'deux', intrus: true },
    ] } })[0];
    expect(out.calls).toBe(0);
    expect(out.inTokens).toBe(0);
    expect(out.intrus === undefined).toBe(true);
    expect(out.serverName).toBe('');
  });
});

describe('rapport de stockage : ligne des statistiques d\'usage', function() {
  it('comptée dans le total mesuré', function() {
    var r = buildStorageReport({ conversations: 10, usageStats: 5 }, null);
    expect(r.detail.usageStats).toBe(5);
    expect(r.measured).toBe(15);
  });
  it('chaque catégorie du détail a son libellé à l\'écran, et inversement', function() {
    var keys = Object.keys(buildStorageReport({}, null).detail).sort();
    expect(Object.keys(STORAGE_REPORT_LABELS).sort()).toEqual(keys);
  });
});

describe('dates civiles des échelles', function() {
  it('usageAddDays traverse mois et années', function() {
    expect(usageAddDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(usageAddDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(usageAddDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('usageAddDays ignore les changements d\'heure (dates civiles, pas des horodatages)', function() {
    // Passages à l'heure d'été (29 mars 2026) et d'hiver (25 octobre 2026) en Europe.
    expect(usageAddDays('2026-03-30', -1)).toBe('2026-03-29');
    expect(usageAddDays('2026-03-29', -1)).toBe('2026-03-28');
    expect(usageAddDays('2026-10-26', -1)).toBe('2026-10-25');
  });
  it('usageAddMonths : même quantième', function() {
    expect(usageAddMonths('2026-09-28', -1)).toBe('2026-08-28');
    expect(usageAddMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(usageAddMonths('2026-09-28', -12)).toBe('2025-09-28');
  });
  it('usageAddMonths : quantième absent ramené au dernier jour du mois', function() {
    expect(usageAddMonths('2026-05-31', -1)).toBe('2026-04-30');
    expect(usageAddMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(usageAddMonths('2026-03-29', -1)).toBe('2026-02-28');
  });
  it('usageAddMonths : année bissextile', function() {
    expect(usageAddMonths('2024-03-31', -1)).toBe('2024-02-29');
    expect(usageAddMonths('2024-03-29', -1)).toBe('2024-02-29');
    expect(usageAddMonths('2025-02-28', -12)).toBe('2024-02-28');
    expect(usageAddMonths('2024-02-29', -12)).toBe('2023-02-28');
  });
  it('usageAddMonths : le repli ne se propage pas (calcul depuis l\'origine)', function() {
    // 31 mai − 3 mois = 28 février, pas « 30 avril − 2 mois ».
    expect(usageAddMonths('2026-05-31', -3)).toBe('2026-02-28');
    expect(usageAddMonths('2026-05-31', -2)).toBe('2026-03-31');
  });
  it('usageDaysBetween', function() {
    expect(usageDaysBetween('2026-09-01', '2026-09-28')).toBe(27);
    expect(usageDaysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });
});

describe('usageScaleWindow — fenêtres glissantes, bornes incluses', function() {
  var today = '2026-09-28';
  it('1 semaine = 7 jours se terminant aujourd\'hui', function() {
    expect(usageScaleWindow('week', today)).toEqual({ start: '2026-09-22', end: today });
  });
  it('1 mois = mois calendaire glissant, du lendemain du même quantième', function() {
    expect(usageScaleWindow('month', today)).toEqual({ start: '2026-08-29', end: today });
  });
  it('1 mois depuis un 31 mars → repli sur février, fenêtre depuis le 1er mars', function() {
    expect(usageScaleWindow('month', '2026-03-31').start).toBe('2026-03-01');
    expect(usageScaleWindow('month', '2024-03-31').start).toBe('2024-03-01');
  });
  it('3 mois = 13 semaines pleines = 91 jours', function() {
    var w = usageScaleWindow('quarter', today);
    expect(usageDaysBetween(w.start, w.end) + 1).toBe(91);
  });
  it('6 mois et 1 an tombent juste en mois glissants', function() {
    expect(usageScaleWindow('half', today).start).toBe('2026-03-29');
    expect(usageScaleWindow('year', today).start).toBe('2025-09-29');
  });
  it('échelle inconnue → null', function() {
    expect(usageScaleWindow('decade', today)).toBe(null);
  });
});

describe('availableUsageScales / resolveUsageScale', function() {
  var today = '2026-09-28';
  it('pas de données → aucune échelle', function() {
    expect(availableUsageScales(null, today)).toEqual([]);
    expect(resolveUsageScale('month', [])).toBe(null);
  });
  it('données de la semaine seulement → 1 semaine, qui devient le défaut', function() {
    var a = availableUsageScales('2026-09-25', today);
    expect(a).toEqual(['week']);
    expect(resolveUsageScale(null, a)).toBe('week');
  });
  it('donnée juste au début de la semaine → la semaine suffit (rien de plus en 1 mois)', function() {
    expect(availableUsageScales('2026-09-22', today)).toEqual(['week']);
  });
  it('donnée la veille du début de la semaine → 1 mois proposé, et défaut', function() {
    var a = availableUsageScales('2026-09-21', today);
    expect(a).toEqual(['week', 'month']);
    expect(resolveUsageScale(null, a)).toBe('month');
  });
  it('donnée ancienne → toutes les échelles', function() {
    expect(availableUsageScales('2024-01-01', today)).toEqual(['week', 'month', 'quarter', 'half', 'year']);
  });
  it('choix courant gardé s\'il est encore proposé, sinon défaut ou plus grande', function() {
    expect(resolveUsageScale('year', ['week', 'month', 'quarter', 'half', 'year'])).toBe('year');
    expect(resolveUsageScale('year', ['week', 'month'])).toBe('month');
    expect(resolveUsageScale('quarter', ['week'])).toBe('week');
  });
});

describe('sélection et totaux', function() {
  function r(day, serverId, model, o) {
    return Object.assign({ day: day, serverId: serverId, model: model, purpose: 'chat', serverName: 'N-' + serverId,
      calls: 0, unmeasured: 0, inTokens: 0, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 0 }, o);
  }
  var recs = [
    r('2026-09-28', 'a', 'm1', { calls: 2, inTokens: 100, cachedTokens: 40, cachedKnownCalls: 2, outTokens: 10 }),
    r('2026-09-27', 'a', 'm2', { calls: 3, unmeasured: 1, inTokens: 300, outTokens: 30 }),
    r('2026-09-10', 'b', 'm1', { calls: 1, inTokens: 50, cachedTokens: 0, cachedKnownCalls: 1, outTokens: 5 }),
    r('2026-07-01', 'gone', 'm3', { calls: 1, inTokens: 7, outTokens: 1, serverName: 'Ancien' }),
    r('2026-08-01', 'gone', 'm3', { calls: 1, inTokens: 7, outTokens: 1, serverName: 'Dernier nom' }),
  ];

  it('filtre serveur et modèle, absent = tous', function() {
    expect(filterUsageRecords(recs, {}).length).toBe(5);
    expect(filterUsageRecords(recs, { serverId: 'a' }).length).toBe(2);
    expect(filterUsageRecords(recs, { serverId: 'a', model: 'm1' }).length).toBe(1);
    expect(filterUsageRecords(recs, { model: 'm1' }).length).toBe(2);
  });
  it('clef vide = valeur RÉELLE, distincte de « tous » (null)', function() {
    var withEmpty = recs.concat([r('2026-09-28', 'a', '', { calls: 1 })]);
    expect(filterUsageRecords(withEmpty, { model: '' }).length).toBe(1);
    expect(filterUsageRecords(withEmpty, { model: null }).length).toBe(6);
    expect(usageModelOptions(withEmpty, 'a')).toEqual(['', 'm1', 'm2']);
  });
  it('plus ancienne donnée de la sélection', function() {
    expect(usageOldestDay(recs)).toBe('2026-07-01');
    expect(usageOldestDay(filterUsageRecords(recs, { serverId: 'a' }))).toBe('2026-09-27');
    expect(usageOldestDay([])).toBe(null);
  });
  it('serveurs : vivants (nom vivant) puis supprimés sous leur DERNIER nom', function() {
    var opts = usageServerOptions(recs, [{ id: 'b', name: 'Bureau' }, { id: 'a', name: 'Maison' }, { id: 'c', name: 'Neuf' }]);
    expect(opts).toEqual([
      { id: 'b', name: 'Bureau', deleted: false },
      { id: 'a', name: 'Maison', deleted: false },
      { id: 'c', name: 'Neuf', deleted: false },
      { id: 'gone', name: 'Dernier nom', deleted: true },
    ]);
  });
  it('modèles du serveur choisi, tous serveurs si vide, homonymes listés une fois', function() {
    expect(usageModelOptions(recs, 'a')).toEqual(['m1', 'm2']);
    expect(usageModelOptions(recs, null)).toEqual(['m1', 'm2', 'm3']);   // m1 : servi par a et b
  });

  var pair = function(x) { return x.serverId + '/' + x.model; };
  it('totaux : une ligne par couple (serveur, modèle), entrée décroissante, et la somme, fenêtre incluse', function() {
    var t = usageTotals(recs, { start: '2026-09-10', end: '2026-09-28' });
    // m1 est servi par a ET b : deux lignes, jamais une ligne par nom.
    expect(t.rows.map(pair)).toEqual(['a/m2', 'a/m1', 'b/m1']);
    expect([t.rows[1].calls, t.rows[1].inTokens]).toEqual([2, 100]);
    expect([t.rows[2].calls, t.rows[2].inTokens]).toEqual([1, 50]);
    expect([t.total.calls, t.total.unmeasured, t.total.inTokens, t.total.cachedTokens, t.total.outTokens])
      .toEqual([6, 1, 450, 40, 45]);
  });
  it('homonymes : sharedName sur les seuls noms servis par plusieurs serveurs de la sélection', function() {
    var t = usageTotals(recs, { start: '2026-09-10', end: '2026-09-28' });
    var shared = {};
    t.rows.forEach(function(x) { shared[pair(x)] = x.sharedName; });
    expect(shared).toEqual({ 'a/m2': false, 'a/m1': true, 'b/m1': true });
    // Sous un filtre serveur, jamais d'homonyme : une seule ligne par nom.
    var ta = usageTotals(filterUsageRecords(recs, { serverId: 'a' }), { start: '2026-09-10', end: '2026-09-28' });
    expect(ta.rows.map(function(x) { return x.sharedName; })).toEqual([false, false]);
    // Hors fenêtre, le second serveur ne compte pas : le nom n'est plus partagé.
    var tw = usageTotals(recs, { start: '2026-09-20', end: '2026-09-28' });
    expect(tw.rows.map(pair)).toEqual(['a/m2', 'a/m1']);
    expect(tw.rows[1].sharedName).toBe(false);
  });
  it('filtre modèle homonyme sous « tous les serveurs » : une ligne par serveur', function() {
    var t = usageTotals(filterUsageRecords(recs, { model: 'm1' }), { start: '2026-09-10', end: '2026-09-28' });
    expect(t.rows.map(pair)).toEqual(['a/m1', 'b/m1']);
    expect(t.total.inTokens).toBe(150);
  });
  it('clef de couple sans collision : serveur ou modèle vide restent distincts', function() {
    var t = usageTotals([
      r('2026-09-28', '', 'x', { calls: 1, inTokens: 3 }),
      r('2026-09-28', 'x', '', { calls: 1, inTokens: 2 }),
    ], null);
    expect(t.rows.map(pair)).toEqual(['/x', 'x/']);
  });
  it('état du cache : connu, n/d, partiel', function() {
    var t = usageTotals(recs, { start: '2026-09-10', end: '2026-09-28' });
    var state = {};
    t.rows.forEach(function(x) { state[pair(x)] = x.cacheState; });
    expect(state['a/m1']).toBe('known');   // mesuré par ses deux appels
    expect(state['b/m1']).toBe('known');   // cache à 0 compris : une mesure
    expect(state['a/m2']).toBe('unknown'); // aucun appel mesuré ne l'a renseigné
    expect(t.total.cacheState).toBe('partial');
  });
  it('appels non mesurés exclus de la question du cache', function() {
    expect(usageCacheState({ calls: 3, unmeasured: 1, cachedKnownCalls: 2 })).toBe('known');
    expect(usageCacheState({ calls: 1, unmeasured: 1, cachedKnownCalls: 0 })).toBe('unknown');
  });
  it('fenêtre vide → aucune ligne, total nul, cache n/d', function() {
    var t = usageTotals(recs, { start: '2027-01-01', end: '2027-01-31' });
    expect(t.rows.length).toBe(0);
    expect(t.total.calls).toBe(0);
    expect(t.total.cacheState).toBe('unknown');
  });
  it('formatUsageCount : exact sous 10 000, trois chiffres significatifs au-delà', function() {
    expect(formatUsageCount(0)).toBe('0');
    expect(formatUsageCount(9999)).toBe('9\u202f999');
    expect(formatUsageCount(10000)).toBe('10,0\u202fk');
    expect(formatUsageCount(123456)).toBe('123\u202fk');
    expect(formatUsageCount(1234567)).toBe('1,23\u202fM');
    expect(formatUsageCount(98765432)).toBe('98,8\u202fM');
    expect(formatUsageCount(1500000000)).toBe('1,50\u202fG');
    expect(formatUsageCount(1234567890123)).toBe('1235\u202fG');   // dernière unité : pas de suivante
  });
  it('formatUsageCount : l\'arrondi qui atteint 1 000 passe à l\'unité suivante', function() {
    expect(formatUsageCount(999499)).toBe('999\u202fk');
    expect(formatUsageCount(999500)).toBe('1,00\u202fM');
    expect(formatUsageCount(99950)).toBe('100\u202fk');
  });
  it('usageExactCount : seulement quand la cellule est compactée', function() {
    expect(usageExactCount(9999)).toBe(null);
    expect(usageExactCount(1234567)).toBe('1\u202f234\u202f567');
  });
  it('formatUsageDay', function() {
    expect(formatUsageDay('2026-09-28')).toBe('28 septembre 2026');
    expect(formatUsageDay('2026-08-01')).toBe('1er août 2026');
    expect(formatUsageDay('bad')).toBe('');
  });
});

// ── Graphe ──────────────────────────────────────────────────────────────────

describe('usageBins — bacs glissants, comptés depuis aujourd\'hui', function() {
  it('1 mois : un bac par jour, du début de la fenêtre à aujourd\'hui', function() {
    var today = '2026-09-28';
    var b = usageBins(usageScaleWindow('month', today), 'month');
    expect(b.length).toBe(31);
    expect(b[0]).toEqual({ start: '2026-08-29', end: '2026-08-29' });
    expect(b[30]).toEqual({ start: today, end: today });
  });
  it('1 semaine : 7 bacs d\'un jour', function() {
    expect(usageBins(usageScaleWindow('week', '2026-09-28'), 'week').length).toBe(7);
  });
  it('3 mois : 13 bacs de 7 jours, le dernier finit aujourd\'hui', function() {
    var today = '2026-09-28';
    var b = usageBins(usageScaleWindow('quarter', today), 'quarter');
    expect(b.length).toBe(13);
    expect(b.every(function(x) { return usageDaysBetween(x.start, x.end) === 6; })).toBe(true);
    expect(b[12].end).toBe(today);
    expect(b[0].start).toBe(usageScaleWindow('quarter', today).start);
  });
  it('mois au quantième calculés depuis aujourd\'hui, jamais en chaînant (repli de fin de mois)', function() {
    // Depuis un 31 mai : en chaînant, le repli d'avril (30) se propagerait et
    // le bac de mars finirait le 30. Calculé depuis l'origine, il finit le 31.
    var b = usageBins(usageScaleWindow('half', '2026-05-31'), 'half');
    expect(b.map(function(x) { return x.end; }))
      .toEqual(['2025-12-31', '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
    expect(b.map(function(x) { return x.start; }))
      .toEqual(['2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']);
  });
  it('fin février, année bissextile', function() {
    var b = usageBins(usageScaleWindow('year', '2024-03-31'), 'year');
    expect(b[10]).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    var c = usageBins(usageScaleWindow('year', '2025-03-31'), 'year');
    expect(c[10]).toEqual({ start: '2025-02-01', end: '2025-02-28' });
  });
  it('propriété : sur deux années de « aujourd\'hui », chaque échelle pave sa fenêtre sans trou ni recouvrement', function() {
    var bad = [];
    for (var d = 0; d < 731; d++) {
      var today = usageAddDays('2024-01-01', d);
      USAGE_SCALES.forEach(function(s) {
        var win = usageScaleWindow(s.id, today);
        var b = usageBins(win, s.id);
        if (b[0].start !== win.start || b[b.length - 1].end !== today) bad.push(today + ' ' + s.id + ' bornes');
        for (var i = 1; i < b.length; i++) {
          if (usageAddDays(b[i - 1].end, 1) !== b[i].start) bad.push(today + ' ' + s.id + ' bac ' + i);
        }
        var expected = s.id === 'month' ? usageDaysBetween(win.start, win.end) + 1 : (s.id === 'week' ? 7 : s.span);
        if (b.length !== expected) bad.push(today + ' ' + s.id + ' compte');
      });
    }
    expect(bad).toEqual([]);
  });
  it('échelle inconnue ou fenêtre absente → aucun bac', function() {
    expect(usageBins(null, 'month')).toEqual([]);
    expect(usageBins({ start: '2026-09-01', end: '2026-09-28' }, 'decade')).toEqual([]);
  });
});

describe('calendarMarkers — repères calendaires en fraction de la largeur', function() {
  it('échelle au jour : lundis (semaine) et 1ers (mois), à leur bac', function() {
    var bins = usageBins(usageScaleWindow('month', '2026-09-28'), 'month');
    var m = calendarMarkers(bins, 'day');
    expect(m.map(function(x) { return x.day + ':' + x.kind; }))
      .toEqual(['2026-08-31:week', '2026-09-01:month', '2026-09-07:week', '2026-09-14:week', '2026-09-21:week', '2026-09-28:week']);
    expect(m[1].pos).toBe(3 / 31);
  });
  it('un 1er qui tombe un lundi : UN repère, de mois', function() {
    // 1er juin 2026 : un lundi.
    var bins = usageBins(usageScaleWindow('month', '2026-06-15'), 'month');
    var onFirst = calendarMarkers(bins, 'day').filter(function(x) { return x.day === '2026-06-01'; });
    expect(onFirst.length).toBe(1);
    expect(onFirst[0].kind).toBe('month');
  });
  it('aucun repère au bord gauche (fenêtre qui commence un lundi, ou un 1er)', function() {
    // Depuis le 30 septembre 2026, la fenêtre d'un mois commence le lundi 31 août.
    var a = calendarMarkers(usageBins(usageScaleWindow('month', '2026-09-30'), 'month'), 'day');
    expect(a[0].day).toBe('2026-09-01');
    expect(a.every(function(x) { return x.pos > 0; })).toBe(true);
    // Depuis le 31 mars 2026, elle commence le dimanche 1er mars.
    var b = calendarMarkers(usageBins(usageScaleWindow('month', '2026-03-31'), 'month'), 'day');
    expect(b.some(function(x) { return x.day === '2026-03-01'; })).toBe(false);
  });
  it('échelle à la semaine : mois seulement, au prorata du jour dans son bac', function() {
    // 3 mois depuis le 28 septembre 2026 : premier bac du 30 juin au 6 juillet.
    var bins = usageBins(usageScaleWindow('quarter', '2026-09-28'), 'quarter');
    var m = calendarMarkers(bins, 'week');
    expect(m.map(function(x) { return x.day; })).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(m.every(function(x) { return x.kind === 'month'; })).toBe(true);
    expect(m[0].pos).toBe((0 + 1 / 7) / 13);
    // 1er août : 32 jours après le 30 juin → bac 4, 5e jour.
    expect(m[1].pos).toBe((4 + 4 / 7) / 13);
  });
  it('échelle au mois : un 1er par bac, au prorata d\'un bac de longueur variable', function() {
    var bins = usageBins(usageScaleWindow('year', '2026-09-28'), 'year');
    var m = calendarMarkers(bins, 'month');
    expect(m.length).toBe(12);
    // Premier bac : 29 septembre → 28 octobre (30 jours), le 1er octobre en est le 3e.
    expect(m[0]).toEqual({ day: '2025-10-01', kind: 'month', pos: (0 + 2 / 30) / 12 });
  });
});

describe('usageBinTotals — agrégation par bac, cache classé par enregistrement', function() {
  function r(day, serverId, model, o) {
    return Object.assign({ day: day, serverId: serverId, model: model, purpose: 'chat', serverName: '',
      calls: 0, unmeasured: 0, inTokens: 0, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 0 }, o);
  }
  var bins = [{ start: '2026-09-27', end: '2026-09-27' }, { start: '2026-09-28', end: '2026-09-28' }];
  it('renseigné / non renseigné classés par enregistrement, pas par bac', function() {
    var t = usageBinTotals([
      r('2026-09-28', 'a', 'm1', { calls: 2, inTokens: 100, cachedTokens: 60, cachedKnownCalls: 2, outTokens: 5 }),
      r('2026-09-28', 'b', 'm1', { calls: 1, inTokens: 40, outTokens: 1 }),
    ], bins);
    expect(t[1].freshIn).toBe(40);
    expect(t[1].cachedIn).toBe(60);
    expect(t[1].unknownIn).toBe(40);
    expect(t[1].inTokens).toBe(140);
    expect(t[1].cacheState).toBe('partial');
    expect(t[0].calls).toBe(0);
  });
  it('cache partiel dans un enregistrement : sa part est comptée comme connue', function() {
    var t = usageBinTotals([r('2026-09-27', 'a', 'm', { calls: 3, inTokens: 90, cachedTokens: 30, cachedKnownCalls: 2, outTokens: 3 })], bins);
    expect(t[0].cachedIn).toBe(30);
    expect(t[0].freshIn).toBe(60);
    expect(t[0].unknownIn).toBe(0);
    expect(t[0].cacheState).toBe('partial');
  });
  it('cache aberrant (supérieur à l\'entrée) borné : la pile ne dépasse jamais l\'entrée', function() {
    var t = usageBinTotals([r('2026-09-27', 'a', 'm', { calls: 1, inTokens: 10, cachedTokens: 25, cachedKnownCalls: 1 })], bins);
    expect(t[0].cachedIn + t[0].freshIn + t[0].unknownIn).toBe(10);
  });
  it('hors bacs : ignoré', function() {
    var t = usageBinTotals([r('2026-09-26', 'a', 'm', { calls: 1, inTokens: 10 }), r('2026-09-29', 'a', 'm', { calls: 1, inTokens: 10 })], bins);
    expect(t[0].calls + t[1].calls).toBe(0);
  });
  it('invariant : la somme des bacs égale le total du tableau sur la même fenêtre (ventilation par couple serveur/modèle comprise)', function() {
    var recs = [];
    for (var i = 0; i < 60; i++) {
      recs.push(r(usageAddDays('2026-07-20', i), i % 3 ? 'a' : 'b', i % 2 ? 'm1' : 'm2', {
        calls: 1 + (i % 4), unmeasured: i % 7 === 0 ? 1 : 0, inTokens: 100 * i, cachedTokens: i % 5 ? 10 * i : 0,
        cachedKnownCalls: i % 5 ? 1 : 0, outTokens: i }));
    }
    var win = usageScaleWindow('quarter', '2026-09-28');
    var bt = usageBinTotals(recs, usageBins(win, 'quarter'));
    var tot = usageTotals(recs, win).total;
    USAGE_STATS_SUM_FIELDS.forEach(function(f) {
      expect(f + '=' + bt.reduce(function(a, b) { return a + b[f]; }, 0)).toBe(f + '=' + tot[f]);
    });
    var stack = bt.reduce(function(a, b) { return a + b.freshIn + b.cachedIn + b.unknownIn; }, 0);
    expect(stack).toBe(tot.inTokens);
  });
});

describe('axes, libellés et infobulle du graphe', function() {
  it('usageChartAxis : pas ronds, maximum qui couvre la plus haute barre', function() {
    expect(usageChartAxis(1300000, 3)).toEqual({ step: 500000, max: 1500000 });
    expect(usageChartAxis(76, 1)).toEqual({ step: 100, max: 100 });
    expect(usageChartAxis(900, 3)).toEqual({ step: 500, max: 1000 });
    expect(usageChartAxis(75000, 3)).toEqual({ step: 25000, max: 75000 });
  });
  it('usageChartAxis : panneau vide ou minuscule → un pas de 1, jamais de fraction', function() {
    expect(usageChartAxis(0, 3)).toEqual({ step: 1, max: 1 });
    expect(usageChartAxis(2, 3)).toEqual({ step: 1, max: 2 });
  });
  it('usageChartAxis : un pas rond fractionnaire (2,5) est arrondi à l\'entier', function() {
    expect(usageChartAxis(7, 3)).toEqual({ step: 3, max: 9 });
  });
  it('formatUsageTick : notation du tableau sans zéros de queue, compacte dès 1 000 (une seule notation par axe)', function() {
    expect(formatUsageTick(1500000)).toBe('1,5 M');
    expect(formatUsageTick(1000000)).toBe('1 M');
    expect(formatUsageTick(500000)).toBe('500 k');
    expect(formatUsageTick(25000)).toBe('25 k');
    expect(formatUsageTick(2000)).toBe('2\u202fk');
    expect(formatUsageTick(5000)).toBe('5\u202fk');
    expect(formatUsageTick(2500)).toBe('2,5\u202fk');
    expect(formatUsageTick(500)).toBe('500');
    expect(formatUsageTick(2500000)).toBe('2,5 M');
  });
  it('libellés de repères et de bacs', function() {
    expect(usageMarkerLabel({ day: '2026-09-01', kind: 'month' })).toBe('sept.');
    expect(usageMarkerLabel({ day: '2026-01-01', kind: 'month' })).toBe('janv. 2026');
    expect(usageMarkerLabel({ day: '2026-09-07', kind: 'week' })).toBe('7 sept.');
    expect(usageShortDay('2026-09-28', true)).toBe('lun. 28 sept.');
    expect(usageShortDay('2026-10-01', false)).toBe('1er oct.');
    expect(usageBinTitle({ start: '2026-09-28', end: '2026-09-28' })).toBe('28 septembre 2026');
    expect(usageBinTitle({ start: '2026-09-22', end: '2026-09-28' })).toBe('Du 22 septembre 2026 au 28 septembre 2026');
  });
  it('usageBinTipDetail : entrée et cache, sortie, requêtes', function() {
    var base = { calls: 76, unmeasured: 0, inTokens: 1290000, cachedTokens: 870000, cachedKnownCalls: 76, outTokens: 29300 };
    expect(usageBinTipDetail(Object.assign({ cacheState: 'known' }, base)))
      .toBe('Entrée : 1,29 M (cache : 870 k)\nSortie : 29,3 k\nRequêtes : 76');
  });
  it('usageBinTipDetail : cache partiel marqué et expliqué, n/d, non mesurées', function() {
    var p = usageBinTipDetail({ calls: 3, unmeasured: 1, inTokens: 10, cachedTokens: 4, cachedKnownCalls: 1, outTokens: 1, cacheState: 'partial' });
    expect(p).toContain('(cache : 4*)');
    expect(p).toContain('Requêtes : 3, dont 1 non mesurée');
    expect(p).toContain('* cache renseigné par une partie des appels seulement');
    var u = usageBinTipDetail({ calls: 2, unmeasured: 2, inTokens: 0, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 0, cacheState: 'unknown' });
    expect(u).toContain('(cache : n/d)');
    expect(u).toContain('dont 2 non mesurées');
    expect(usageBinTipDetail({ calls: 0 })).toBe('Aucun appel');
  });
  it('usageChartSummary : période, granularité et totaux', function() {
    var s = usageChartSummary({ calls: 1465, inTokens: 23000000, cachedTokens: 15800000, outTokens: 859000, cacheState: 'partial' },
      { start: '2026-08-30', end: '2026-09-29' }, 'day', 31);
    expect(s).toContain('par jour (31 barres)');
    expect(s).toContain('du 30 août 2026 au 29 septembre 2026');
    expect(s).toContain('dont au moins 15,8 M servis par le cache');
    expect(s).toContain('1 465 requêtes');
    var one = usageChartSummary({ calls: 1, inTokens: 10, cachedTokens: 0, outTokens: 1, cacheState: 'unknown' },
      { start: '2026-09-29', end: '2026-09-29' }, 'day', 7);
    expect(one).toContain(' 1 requête.');
  });
  it('usageStackGeometry : espace de surface entre segments, 1 px minimum, nuls omis, bout arrondi au dernier', function() {
    var g = usageStackGeometry([50, 0, 50], 100, 100, 2);
    expect(g).toEqual([
      { index: 0, y: 50, h: 50, top: false },
      { index: 2, y: 0, h: 48, top: true },
    ]);
    var tiny = usageStackGeometry([100, 0.01], 100, 100, 2);
    expect(tiny[1].h).toBe(1);
    expect(usageStackGeometry([0, 0], 100, 100, 2)).toEqual([]);
  });
  it('usageStackGeometry : un segment fin au sommet ne sort jamais du panneau', function() {
    var g = usageStackGeometry([100, 0.5], 100, 100, 2);
    expect(g[1].h).toBe(1);
    expect(g[1].y).toBe(0);
  });
});
