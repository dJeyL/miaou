// tests/test-ui.js
// Seules les fonctions pures de ui.js sont couvertes ici (le DOM, les timers et
// le rendu se vérifient à la main). WAITER_WORDS est un const de ui.js, hors de
// portée du test (frontière de fichier dans le runner) : on teste donc des
// propriétés observables sans le référencer.

describe('pickWaiterWord', function() {
  it('retourne une chaîne non vide', function() {
    var w = pickWaiterWord();
    expect(typeof w).toBe('string');
    expect(w.length > 0).toBeTruthy();
  });
  it('ne répète jamais le mot précédent', function() {
    var prev = pickWaiterWord();
    var repeated = false;
    for (var i = 0; i < 100; i++) {
      var w = pickWaiterWord(prev);
      if (w === prev) { repeated = true; break; }
      prev = w;
    }
    expect(repeated).toBe(false);
  });
});

describe('resolveConvRefs', function() {
  it('sans marqueur, texte inchangé', function() {
    expect(resolveConvRefs('bonjour')).toBe('bonjour');
  });
  it('marqueur avec titre fourni par le modèle, conversation existante → lien Markdown avec ce titre', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 'x', timestamp: Date.now(), messages: [] });
    var r = resolveConvRefs('[conv_ref:c1|Migration Postgres]');
    expect(r).toBe('[Migration Postgres](#miaou-conv:c1)');
  });
  it('marqueur sans titre → lookup dans l\'index des résumés', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 'x', timestamp: Date.now(), messages: [] });
    saveSummary('c1', { title: 'Titre retrouvé', timestamp: Date.now(), summary: 's', keywords: [] });
    var r = resolveConvRefs('[conv_ref:c1]');
    expect(r).toBe('[Titre retrouvé](#miaou-conv:c1)');
  });
  it('marqueur sans titre, entrée tombstone → lien conservé avec le titre (suppressed ne concerne que le résumé, pas la conversation)', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 'x', timestamp: Date.now(), messages: [] });
    saveSummary('c1', { title: 'Titre', timestamp: Date.now(), summary: 's', keywords: [] });
    suppressSummary('c1');
    var r = resolveConvRefs('[conv_ref:c1]');
    expect(r).toBe('[Titre](#miaou-conv:c1)');
  });
  it('conversation réellement supprimée (deleteConv) → texte barré, pas de lien', function() {
    localStorage.clear();
    var r = resolveConvRefs('[conv_ref:c1|Ancien titre]');
    expect(r).toBe('~~Ancien titre (supprimée)~~');
    expect(r.indexOf('#miaou-conv:')).toBe(-1);
  });
  it('conversation supprimée, titre connu seulement via un résumé orphelin', function() {
    localStorage.clear();
    saveSummary('c1', { title: 'Titre orphelin', timestamp: Date.now(), summary: 's', keywords: [] });
    var r = resolveConvRefs('[conv_ref:c1]');
    expect(r).toBe('~~Titre orphelin (supprimée)~~');
  });
  it('conversation supprimée, aucun titre connu → repli sur l\'ID', function() {
    localStorage.clear();
    var r = resolveConvRefs('[conv_ref:inconnu]');
    expect(r).toBe('~~inconnu (supprimée)~~');
  });
  it('id encodé pour l\'URL (caractères spéciaux)', function() {
    localStorage.clear();
    saveConversation({ id: 'a b', title: 'x', timestamp: Date.now(), messages: [] });
    var r = resolveConvRefs('[conv_ref:a b|T]');
    expect(r).toBe('[T](#miaou-conv:a%20b)');
  });
});

describe('relativeWhen (libellé de date par conversation)', function() {
  // On teste le comportement (jour même → heure, plus « aujourd'hui »), pas le
  // format exact : QuickJS n'honore pas la locale fr-FR de toLocaleTimeString.
  it('affiche une heure (non « aujourd\'hui ») pour le jour même', function() {
    var label = relativeWhen(Date.now());
    expect(label === "aujourd'hui").toBe(false);
    expect(label).toContain(':');
  });
  it('affiche « hier à HH:MM » pour la veille', function() {
    var n = new Date();
    var yesterdayNoon = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1, 12, 0).getTime();
    var label = relativeWhen(yesterdayNoon);
    expect(label).toContain('hier');
    expect(label).toContain(':');
  });
  it('retourne une chaîne vide sans timestamp', function() {
    expect(relativeWhen(0)).toBe('');
  });
});
