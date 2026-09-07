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
  it('produit un doctype et un <html> SANS data-theme', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('<!doctype html>') >= 0).toBeTruthy();
    // Lot R : la case #theme-switch est la seule source de vérité du thème.
    // Un data-theme figé sur <html> gagnerait sur elle en permanence — sans JS
    // pour le mettre à jour, le clic changeait l'icône mais pas les couleurs.
    expect(r.indexOf('<html>') >= 0).toBeTruthy();
    expect(r.indexOf('data-theme') >= 0).toBeFalsy();
  });
  it('thème sombre : case décochée', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('<input type="checkbox" id="theme-switch">') >= 0).toBeTruthy();
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
  it('contient la topbar (titre + date) et le footer "Généré par ... MIAOU"', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('Ma conversation') >= 0).toBeTruthy();
    expect(r.indexOf('09/07/2026') >= 0).toBeTruthy();
    // Le mot MIAOU peut être enveloppé d'un <a> (cf. brandHtmlFor) : on vérifie
    // le préfixe et le nom séparément, jamais la chaîne d'un bloc.
    expect(r.indexOf('Généré par ') >= 0).toBeTruthy();
    expect(r.indexOf('MIAOU') >= 0).toBeTruthy();
  });
  it('le footer porte le nom MIAOU une seule fois', function() {
    var r = buildExportHtml(base);
    var body = r.slice(r.indexOf('export-footer\">'));
    expect(body.split('MIAOU').length - 1).toBe(1);
  });

  it('zéro <script> sans scriptTag ; un seul <link> (favicon)', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('<script') >= 0).toBeFalsy();
    expect(r.indexOf('<link rel="icon"') >= 0).toBeTruthy();
  });
  it('theme "light" reflété par la case cochée', function() {
    var r = buildExportHtml(Object.assign({}, base, { theme: 'light' }));
    expect(r.indexOf('<input type="checkbox" id="theme-switch" checked>') >= 0).toBeTruthy();
  });
  it('la bascule de thème est du markup STATIQUE (présente sans scriptTag)', function() {
    var r = buildExportHtml(base);
    expect(r.indexOf('<script') >= 0).toBeFalsy();
    expect(r.indexOf('class="theme-switch-label"') >= 0).toBeTruthy();
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

  // Depuis U-3, le scan de CONTENU ne se fait plus dans le prédicat (une
  // conversation froide n'a pas ses messages en RAM) : il est précalculé en
  // async et remis sous forme d'un Set d'ids. Le prédicat n'en fait plus qu'une
  // consultation ; ce que le scan retient est testé sur convContentMatches.
  it('appartenance à contentHits : la conversation matche', function() {
    localStorage.clear();
    var f = searchConversations('ornithorynque', new Set(['c1']));
    expect(f(candidate('c1', 'Titre neutre'))).toBe(true);
    expect(f(candidate('c2', 'Titre neutre'))).toBe(false);
  });

  it('contentHits omis : titre et résumé seulement, jamais le contenu', function() {
    localStorage.clear();
    saveConversation({
      id: 'c1', title: 'Titre neutre', timestamp: Date.now(),
      messages: [{ role: 'user', content: 'Un mot rarissime : ornithorynque' }],
    });
    var f = searchConversations('ornithorynque');
    expect(f(candidate('c1', 'Titre neutre'))).toBe(false);
  });
});

describe('convContentMatches (scan de contenu, U-3)', function() {
  it('match sur un message user (displayText absent → content)', function() {
    var c = { id: 'c1', messages: [{ role: 'user', content: 'Un mot rarissime : ornithorynque' }] };
    expect(convContentMatches(c, 'ornithorynque')).toBe(true);
  });

  it('match sur un message assistant', function() {
    var c = { id: 'c1', messages: [{ role: 'assistant', content: 'Réponse avec ornithorynque' }] };
    expect(convContentMatches(c, 'ornithorynque')).toBe(true);
  });

  it('displayText prioritaire sur le content baké (slash-skill)', function() {
    // Le mot n'existe que dans le corps baké de la skill : ne doit PAS matcher,
    // seul le littéral tapé (displayText) est scanné côté user.
    var c = { id: 'c1', messages: [{
      role: 'user',
      displayText: 'Regarde ce texte',
      content: 'Regarde ce texte\n\n--- skill: x ---\nCorpsSkillRarissime\n--- /skill: x ---',
    }] };
    expect(convContentMatches(c, 'corpsskillrarissime')).toBe(false);
  });

  it('entrées ack ignorées (result potentiellement énorme et hors-sujet)', function() {
    var c = { id: 'c1', messages: [
      { role: 'tool-ack', kind: 'mcp_call', result: 'ornithorynque dans le result' },
      { role: 'assistant', content: 'Réponse neutre' },
    ] };
    expect(convContentMatches(c, 'ornithorynque')).toBe(false);
  });

  it('conversation sans messages ou requête vide : pas de match, pas d\'exception', function() {
    expect(convContentMatches({ id: 'c1' }, 'x')).toBe(false);
    expect(convContentMatches({ id: 'c1', messages: [] }, 'x')).toBe(false);
    expect(convContentMatches(null, 'x')).toBe(false);
    expect(convContentMatches({ id: 'c1', messages: [{ role: 'user', content: 'abc' }] }, '')).toBe(false);
  });

  it('seuil de scan : CONTENT_SCAN_MIN_CHARS vaut 3 (le prédicat ne scanne pas sous ce seuil)', function() {
    // Le seuil est appliqué par collectContentSearchHits (storage.js, async) :
    // sous 3 caractères, aucune lecture IDB n'est faite et la table reste vide.
    // Seule la valeur est testable ici ; le câblage l'est en Playwright.
    expect(CONTENT_SCAN_MIN_CHARS).toBe(3);
  });

  it('requête multi-mots : ET sur les termes, jamais un OU', function() {
    var c = { id: 'c1', messages: [{ role: 'user', content: 'des petits chiens et des gros chats' }] };
    // Les deux mots sont là, même éloignés : la conversation remonte.
    expect(convContentMatches(c, 'petits chats')).toBe(true);
    // Un seul des deux ne suffit pas.
    expect(convContentMatches(c, 'petits girafes')).toBe(false);
  });

  it('guillemets : la suite exacte est exigée, la requête nue ne l\'exige pas', function() {
    var c = { id: 'c1', messages: [{ role: 'user', content: 'des petits chiens et des gros chats' }] };
    expect(convContentMatches(c, '"petits chats"')).toBe(false);
    expect(convContentMatches(c, '"gros chats"')).toBe(true);
    expect(convContentMatches(c, 'petits chats')).toBe(true);
  });
});

describe('convContentMatch (extrait du passage matché)', function() {
  it('rend l\'extrait du message matché, surlignage compris', function() {
    var c = { id: 'c1', messages: [{ role: 'user', content: 'Un mot rarissime : ornithorynque, voilà' }] };
    var ex = convContentMatch(c, 'ornithorynque');
    expect(ex.text.indexOf('ornithorynque') >= 0).toBe(true);
    expect(ex.text.slice(ex.ranges[0].start, ex.ranges[0].end)).toBe('ornithorynque');
  });

  it('mots contigus dans le texte : UNE marque continue, pas un zébrage', function() {
    var c = { id: 'c1', messages: [{ role: 'assistant', content: 'voici des gros chats gris' }] };
    var ex = convContentMatch(c, 'gros chats');
    expect(ex.ranges.length).toBe(1);
    expect(ex.text.slice(ex.ranges[0].start, ex.ranges[0].end)).toBe('gros chats');
  });

  it('terme EXACT : la suite est marquée d\'un bloc, ses mots isolés ne le sont pas', function() {
    // Le défaut que les guillemets corrigent : sans eux, le « de » de tête est
    // surligné alors qu'il n'appartient pas au passage cherché.
    var c = { id: 'c1', messages: [{ role: 'user', content: 'parle de chien de race stp' }] };
    var ex = convContentMatch(c, '"chien de race"');
    expect(ex.ranges.length).toBe(1);
    expect(ex.text.slice(ex.ranges[0].start, ex.ranges[0].end)).toBe('chien de race');
  });

  it('terme exact : la suite doit se retrouver TELLE QUELLE', function() {
    var c = { id: 'c1', messages: [{ role: 'user', content: 'un chien puis une race' }] };
    expect(convContentMatch(c, '"chien de race"')).toBe(null);
    // Sans guillemets, les mêmes mots dispersés matchent (ET, ordre libre).
    expect(convContentMatch(c, 'chien race') === null).toBe(false);
  });

  it('ET sur les termes : tous présents, ordre libre', function() {
    var c = { id: 'c1', messages: [{ role: 'user', content: 'la race avant le chien' }] };
    expect(convContentMatch(c, 'chien race') === null).toBe(false);
    expect(convContentMatch(c, 'chien girafe')).toBe(null);
  });

  it('PREMIER message matché, pas un autre plus loin', function() {
    var c = { id: 'c1', messages: [
      { role: 'user', content: 'premier ornithorynque ici' },
      { role: 'assistant', content: 'second ornithorynque là' },
    ] };
    expect(convContentMatch(c, 'ornithorynque').text.indexOf('premier') >= 0).toBe(true);
  });

  it('mêmes exclusions que le booléen : acks ignorés, displayText côté user', function() {
    var acks = { id: 'c1', messages: [
      { role: 'tool-ack', kind: 'mcp_call', result: 'ornithorynque dans le result' },
    ] };
    expect(convContentMatch(acks, 'ornithorynque')).toBe(null);
    var baked = { id: 'c2', messages: [{
      role: 'user', displayText: 'Regarde ce texte', content: 'Regarde\n\nCorpsSkillRarissime',
    }] };
    expect(convContentMatch(baked, 'corpsskillrarissime')).toBe(null);
  });

  it('aucun match → null (c\'est ce dont le booléen est le !!)', function() {
    expect(convContentMatch({ id: 'c1', messages: [] }, 'x')).toBe(null);
    expect(convContentMatch(null, 'x')).toBe(null);
    expect(convContentMatch({ id: 'c1', messages: [{ role: 'user', content: 'abc' }] }, '')).toBe(null);
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

describe('ackGroupReduce (brief N — réducteur pur du groupe d\'acks / ticker)', function() {
  it('arrive incrémente acks.length sans muter l\'état précédent', function() {
    var s0 = ackGroupInitState();
    var s1 = ackGroupReduce(s0, { type: 'arrive', ack: { id: 'a1' } });
    expect(s0.acks.length).toBe(0);
    expect(s1.acks.length).toBe(1);
  });
  it('1 ack → ackGroupIsCompact false (transparence sous le seuil)', function() {
    var s = ackGroupReduce(ackGroupInitState(), { type: 'arrive', ack: { id: 'a1' } });
    expect(ackGroupIsCompact(s)).toBe(false);
  });
  it('2e ack → ackGroupIsCompact true, mode compact conservé', function() {
    var s = ackGroupInitState();
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a1' } });
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a2' } });
    expect(ackGroupIsCompact(s)).toBe(true);
    expect(s.mode).toBe('compact');
  });
  it('arrive conserve slotExpanded (héritage §3)', function() {
    var s = ackGroupReduce(ackGroupInitState(), { type: 'toggleSlot' });
    expect(s.slotExpanded).toBe(true);
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a1' } });
    expect(s.slotExpanded).toBe(true);
  });
  it('toggleMode bascule compact vers list', function() {
    var s = ackGroupReduce(ackGroupInitState(), { type: 'toggleMode' });
    expect(s.mode).toBe('list');
  });
  it('toggleMode bascule list vers compact (aller-retour)', function() {
    var s = ackGroupReduce(ackGroupInitState(), { type: 'toggleMode' });
    s = ackGroupReduce(s, { type: 'toggleMode' });
    expect(s.mode).toBe('compact');
  });
  it('arrive après toggle en mode list garde le mode list (bascule mid-stream)', function() {
    var s = ackGroupReduce(ackGroupInitState(), { type: 'toggleMode' });
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a1' } });
    expect(s.mode).toBe('list');
  });
  it('toggleSlot bascule le booléen dans les deux sens', function() {
    var s = ackGroupReduce(ackGroupInitState(), { type: 'toggleSlot' });
    expect(s.slotExpanded).toBe(true);
    s = ackGroupReduce(s, { type: 'toggleSlot' });
    expect(s.slotExpanded).toBe(false);
  });
});

describe('ackGroupVisibleAck / ackGroupCount (dérivées pures)', function() {
  it('ackGroupVisibleAck renvoie le dernier ack arrivé', function() {
    var s = ackGroupInitState();
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a1' } });
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a2' } });
    expect(ackGroupVisibleAck(s).id).toBe('a2');
  });
  it('ackGroupVisibleAck sur groupe vide → null', function() {
    expect(ackGroupVisibleAck(ackGroupInitState())).toBe(null);
  });
  it('ackGroupCount reflète le nombre réel d\'acks (source unique du badge)', function() {
    var s = ackGroupInitState();
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a1' } });
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a2' } });
    s = ackGroupReduce(s, { type: 'arrive', ack: { id: 'a3' } });
    expect(ackGroupCount(s)).toBe(3);
  });
});

describe('resolveMotionReduced (réglage Animations — brief N §8)', function() {
  it('"normal" → false, quelle que soit la préférence système', function() {
    expect(resolveMotionReduced('normal', true)).toBe(false);
    expect(resolveMotionReduced('normal', false)).toBe(false);
  });
  it('"reduced" → true, quelle que soit la préférence système', function() {
    expect(resolveMotionReduced('reduced', true)).toBe(true);
    expect(resolveMotionReduced('reduced', false)).toBe(true);
  });
  it('"system" → reflète la préférence système injectée (true)', function() {
    expect(resolveMotionReduced('system', true)).toBe(true);
  });
  it('"system" → reflète la préférence système injectée (false)', function() {
    expect(resolveMotionReduced('system', false)).toBe(false);
  });
});


describe('brandHtmlFor — lien du dépôt sur le mot MIAOU (footer d\'export)', function() {
  it('URL non vide : lien vers cette URL, cible et rel posés', function() {
    var h = brandHtmlFor('https://example.org/repo');
    expect(h.indexOf('href=\"https://example.org/repo\"') >= 0).toBeTruthy();
    expect(h.indexOf('target=\"_blank\"') >= 0).toBeTruthy();
    expect(h.indexOf('rel=\"noopener\"') >= 0).toBeTruthy();
    expect(h.indexOf('>MIAOU</a>') >= 0).toBeTruthy();
  });
  it('chaîne vide : simple texte, aucun <a>', function() {
    expect(brandHtmlFor('')).toBe('MIAOU');
  });
  it('valeur non-chaîne (null/undefined) : simple texte, pas d\'exception', function() {
    expect(brandHtmlFor(null)).toBe('MIAOU');
    expect(brandHtmlFor(undefined)).toBe('MIAOU');
  });
  it('URL échappée (chemin string→HTML de l\'export, piège 21)', function() {
    var h = brandHtmlFor('https://x/\"><script>alert(1)</script>');
    expect(h.indexOf('<script') >= 0).toBeFalsy();
    expect(h.indexOf('&quot;') >= 0).toBeTruthy();
  });
});

describe('cappedScrollTop', function() {
  it('ne REMONTE jamais la vue : une position déjà plus basse est conservée', function() {
    // Après une édition/régénération le fil est court et la vue vient d'être
    // amenée au fond ; sans cette borne, la naissance de la bulle assistant
    // faisait sauter la vue en arrière pour coller l'ancre en haut.
    expect(cappedScrollTop(1500, 5000, 800, 28, 3000)).toBe(3000);
  });
  it('la position courante ne dépasse jamais le fond', function() {
    // currentTop aberrant (mesure prise avant un raccourcissement du fil) :
    // borné par le fond, jamais rendu tel quel.
    expect(cappedScrollTop(1500, 2000, 800, 28, 9999)).toBe(1200);
  });
  it('sans position courante, le plafond s\'applique tel quel', function() {
    expect(cappedScrollTop(1500, 5000, 800, 28)).toBe(1472);
  });
  it('contenu plus court que le viewport : plafond sans effet, on va au fond (0)', function() {
    // scrollHeight <= clientHeight → il n'y a nulle part où défiler.
    expect(cappedScrollTop(40, 500, 800, 28)).toBe(0);
  });
  it('ancre dans le premier écran : le plafond ne mord pas encore, on suit le fond', function() {
    // fond = 2000-800 = 1200 ; plafond = 300-28 = 272 → c'est le plafond qui
    // gagne dès que l'ancre a dépassé un écran de contenu au-dessus d'elle.
    expect(cappedScrollTop(300, 2000, 800, 28)).toBe(272);
  });
  it('réponse plus haute que l\'écran : on s\'arrête au plafond, pas au fond', function() {
    // fond = 5000-800 = 4200, très en dessous du plafond 1500-28 = 1472.
    expect(cappedScrollTop(1500, 5000, 800, 28)).toBe(1472);
  });
  it('réponse encore courte : le fond est au-dessus du plafond, c\'est lui qui borne', function() {
    // fond = 1000-800 = 200 < plafond 900-28 = 872 → jamais au-delà du fond.
    expect(cappedScrollTop(900, 1000, 800, 28)).toBe(200);
  });
  it('ancre en tête de fil (offsetTop inférieur au padding) : jamais de scrollTop négatif', function() {
    expect(cappedScrollTop(10, 3000, 800, 28)).toBe(0);
  });
  it('padding absent (0 ou omis) : le plafond vaut l\'offsetTop de l\'ancre', function() {
    expect(cappedScrollTop(600, 4000, 800, 0)).toBe(600);
    expect(cappedScrollTop(600, 4000, 800)).toBe(600);
  });
});
