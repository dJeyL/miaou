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
