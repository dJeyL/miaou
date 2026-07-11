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
  it('opts.asPlainText: sans marqueur, texte inchangé', function() {
    expect(resolveConvRefs('bonjour', { asPlainText: true })).toBe('bonjour');
  });
  it('opts.asPlainText: ref vivante → label nu, pas de lien', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 'x', timestamp: Date.now(), messages: [] });
    var r = resolveConvRefs('[conv_ref:c1|Migration Postgres]', { asPlainText: true });
    expect(r).toBe('Migration Postgres');
    expect(r.indexOf('#miaou-conv:')).toBe(-1);
    expect(r.indexOf('[')).toBe(-1);
  });
  it('opts.asPlainText: ref supprimée → tombstone conservé (texte, pas un lien)', function() {
    localStorage.clear();
    var r = resolveConvRefs('[conv_ref:c1|Ancien titre]', { asPlainText: true });
    expect(r).toBe('~~Ancien titre (supprimée)~~');
  });
  it('sans opts (défaut), comportement écran inchangé (lien Markdown)', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 'x', timestamp: Date.now(), messages: [] });
    var r = resolveConvRefs('[conv_ref:c1|Migration Postgres]');
    expect(r).toBe('[Migration Postgres](#miaou-conv:c1)');
  });
});

describe('buildExportHtml', function() {
  var base = { title: 'Ma conversation', dateDisplay: '09/07/2026', theme: 'dark', styleCss: 'body{color:red}', bodyHtml: '<div class="msg">hello</div>' };
  it('produit un doctype et un html avec data-theme', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('<!doctype html>') >= 0).toBeTruthy();
    expect(r.indexOf('<html data-theme="dark">') >= 0).toBeTruthy();
  });
  it('échappe le titre dans <title> et la topbar', function() {
    var r = buildExportHtml(Object.assign({}, base, { title: '<b>Titre</b> & Cie' }));
    expect(r.indexOf('<b>Titre</b>') >= 0).toBeFalsy();
    expect(r.indexOf('&lt;b&gt;Titre&lt;/b&gt; &amp; Cie') >= 0).toBeTruthy();
  });
  it('insère le styleCss fourni dans <style>', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('<style>body{color:red}</style>') >= 0).toBeTruthy();
  });
  it('insère le bodyHtml fourni', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('<div class="msg">hello</div>') >= 0).toBeTruthy();
  });
  it('contient la topbar (titre + date) et le footer "Généré par MIAOU"', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('Ma conversation') >= 0).toBeTruthy();
    expect(r.indexOf('09/07/2026') >= 0).toBeTruthy();
    expect(r.indexOf('Généré par MIAOU') >= 0).toBeTruthy();
  });
  it('zéro <script> et zéro <link> dans la sortie (D1)', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('<script') >= 0).toBeFalsy();
    expect(r.indexOf('<link') >= 0).toBeFalsy();
  });
  it('theme "light" reflété dans data-theme', function() {
    var r = buildExportHtml(Object.assign({}, base, { theme: 'light' }));
    expect(r.indexOf('<html data-theme="light">') >= 0).toBeTruthy();
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

describe('moveSkillAcSelection (navigation clavier de l\'autocomplete)', function() {
  // Faux état { box, index } : seul l'arithmétique d'index est testée — le DOM
  // (classe .active, scrollIntoView) est hors de portée de QuickJS.
  function fakeState(n) {
    var opts = [];
    for (var i = 0; i < n; i++) opts.push({ classList: { toggle: function() {} } });
    return { box: { querySelectorAll: function() { return opts; } }, index: -1, trigger: null };
  }
  it('entrée par ↑ sans sélection → DERNIÈRE option (pas l\'avant-dernière)', function() {
    var s = fakeState(4);
    moveSkillAcSelection(s, -1);
    expect(s.index).toBe(3);
  });
  it('entrée par ↓ sans sélection → première option', function() {
    var s = fakeState(4);
    moveSkillAcSelection(s, 1);
    expect(s.index).toBe(0);
  });
  it('↑ depuis la première → wrap vers la dernière', function() {
    var s = fakeState(4);
    s.index = 0;
    moveSkillAcSelection(s, -1);
    expect(s.index).toBe(3);
  });
  it('↓ depuis la dernière → wrap vers la première', function() {
    var s = fakeState(4);
    s.index = 3;
    moveSkillAcSelection(s, 1);
    expect(s.index).toBe(0);
  });
  it('liste vide → index inchangé (garde)', function() {
    var s = fakeState(0);
    moveSkillAcSelection(s, -1);
    expect(s.index).toBe(-1);
  });
});

describe('searchConversations (recherche sidebar : titre, résumé, contenu)', function() {
  // Conversation candidate minimale, comme fournie par listAllConversations()
  // (pas de champ messages — c'est justement pourquoi le scan de contenu doit
  // repasser par un instantané loadConversations() distinct).
  function candidate(id, title) { return { id: id, title: title }; }

  it('match titre en substring : comportement existant inchangé', function() {
    localStorage.clear();
    var f = searchConversations('Postgres');
    expect(f(candidate('c1', 'Optimisation Postgres lente'))).toBe(true);
    expect(f(candidate('c2', 'Autre sujet'))).toBe(false);
  });

  it('match résumé via tokenize/scoreSummary : comportement existant inchangé', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 'Titre neutre', timestamp: Date.now(), messages: [] });
    saveSummary('c1', { title: 'Titre neutre', timestamp: Date.now(), summary: 'discussion sur le portail captif', keywords: ['portail'] });
    var f = searchConversations('portail');
    expect(f(candidate('c1', 'Titre neutre'))).toBe(true);
  });

  it('résumé tombstone ignoré (non-régression)', function() {
    localStorage.clear();
    saveConversation({ id: 'c1', title: 'Titre neutre', timestamp: Date.now(), messages: [] });
    saveSummary('c1', { title: 'Titre neutre', timestamp: Date.now(), summary: 'discussion sur le portail captif', keywords: ['portail'] });
    suppressSummary('c1');
    var f = searchConversations('portail');
    expect(f(candidate('c1', 'Titre neutre'))).toBe(false);
  });

  it('scan du contenu : match sur un message user (displayText absent → content)', function() {
    localStorage.clear();
    saveConversation({
      id: 'c1', title: 'Titre neutre', timestamp: Date.now(),
      messages: [{ role: 'user', content: 'Un mot rarissime : ornithorynque' }],
    });
    var f = searchConversations('ornithorynque');
    expect(f(candidate('c1', 'Titre neutre'))).toBe(true);
  });

  it('scan du contenu : match sur un message assistant', function() {
    localStorage.clear();
    saveConversation({
      id: 'c1', title: 'Titre neutre', timestamp: Date.now(),
      messages: [{ role: 'assistant', content: 'Réponse avec un mot rarissime : ornithorynque' }],
    });
    var f = searchConversations('ornithorynque');
    expect(f(candidate('c1', 'Titre neutre'))).toBe(true);
  });

  it('scan du contenu : displayText prioritaire sur le content baké (slash-skill)', function() {
    localStorage.clear();
    saveConversation({
      id: 'c1', title: 'Titre neutre', timestamp: Date.now(),
      messages: [{
        role: 'user',
        displayText: 'Regarde ce texte',
        content: 'Regarde ce texte\n\n--- skill: x ---\nCorpsSkillRarissime\n--- /skill: x ---',
      }],
    });
    // Le mot n'existe que dans le corps baké de la skill : ne doit PAS matcher,
    // seul le littéral tapé (displayText) est scanné côté user.
    var f = searchConversations('corpsskillrarissime');
    expect(f(candidate('c1', 'Titre neutre'))).toBe(false);
  });

  it('requête de 2 caractères : pas de scan contenu (mot présent uniquement dans le contenu)', function() {
    localStorage.clear();
    saveConversation({
      id: 'c1', title: 'Titre neutre', timestamp: Date.now(),
      messages: [{ role: 'user', content: 'ab mot present seulement ici' }],
    });
    var f = searchConversations('ab');
    expect(f(candidate('c1', 'Titre neutre'))).toBe(false);
  });

  it('entrées ack ignorées dans le scan de contenu', function() {
    localStorage.clear();
    saveConversation({
      id: 'c1', title: 'Titre neutre', timestamp: Date.now(),
      messages: [
        { role: 'tool-ack', kind: 'mcp_call', result: 'ornithorynque dans le result' },
        { role: 'assistant', content: 'Réponse neutre' },
      ],
    });
    var f = searchConversations('ornithorynque');
    expect(f(candidate('c1', 'Titre neutre'))).toBe(false);
  });
});

describe('modelName (fallback d\'affichage — serveur API actif)', function() {
  it('résout le modèle du serveur actif, pas settings.model legacy', function() {
    localStorage.clear();
    saveSettings({ model: 'legacy-model' });
    saveApiServers([{ id: 's1', name: 'A', url: 'http://a/v1', key: '', model: 'model-a' }]);
    setActiveApiServerId('s1');
    expect(modelName()).toBe('model-a');
  });
  it('retombe sur settings.model si le serveur actif n\'a pas de modèle', function() {
    localStorage.clear();
    saveSettings({ model: 'legacy-model' });
    saveApiServers([{ id: 's1', name: 'A', url: 'http://a/v1', key: '', model: '' }]);
    setActiveApiServerId('s1');
    expect(modelName()).toBe('legacy-model');
  });
  it('« modèle » si rien n\'est résolu', function() {
    localStorage.clear();
    saveApiServersRaw([]);   // court-circuite la migration
    expect(modelName()).toBe('modèle');
  });
});

describe('attachmentClickAction (A3-1 — clic sur un chip de bulle envoyée)', function() {
  it('record absent (plus en cache) → null, dégradation silencieuse', function() {
    expect(attachmentClickAction(null, false)).toBe(null);
  });
  it('record non-image (pas de w/h) → download, modificateur ignoré', function() {
    var rec = { name: 'a.pdf', mime: 'application/pdf', size: 10 };
    expect(attachmentClickAction(rec, false)).toBe('download');
    expect(attachmentClickAction(rec, true)).toBe('download');
  });
  it('record image (w/h posés) sans modificateur → lightbox', function() {
    var rec = { name: 'a.png', mime: 'image/png', w: 100, h: 80 };
    expect(attachmentClickAction(rec, false)).toBe('lightbox');
  });
  it('record image avec modificateur (Cmd/Ctrl) → nouvel onglet', function() {
    var rec = { name: 'a.png', mime: 'image/png', w: 100, h: 80 };
    expect(attachmentClickAction(rec, true)).toBe('tab');
  });
  it('record.class === "binary" seul (fichier binaire non-image) n\'est pas traité comme image', function() {
    var rec = { name: 'a.bin', mime: 'application/octet-stream', class: 'binary' };
    expect(attachmentClickAction(rec, false)).toBe('download');
  });
});
