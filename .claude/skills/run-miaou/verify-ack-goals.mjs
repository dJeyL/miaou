#!/usr/bin/env node
// But d'une suite d'appels d'outils (lot AW, « étape » dans le code) dans le
// fil : rendu du groupe d'acks d'une bulle, segmenté au rendu par
// ackGoalSegments (utils.js) sur le champ `goal` des acks, que pose
// l'étiqueteur d'étapes de MIAOU (jamais le modèle qui travaille).
//
//   A. Compact en live : l'en-tête suit le segment de l'ack visible, n'apparaît
//      qu'à partir de deux appels sous le même but, puis ne s'éteint plus au
//      premier appel du but suivant ; fondu à chaque changement ;
//      badge « 2 buts · 5 étapes ».
//   B. Liste : un intertitre et un filet par segment à but ; l'en-tête compact
//      disparaît, il revient au retour en compact.
//   C. Appel isolé sans but (reste à nu dans la liste) ; but porté par un seul
//      appel (rien ne s'affiche, comme avant).
//   D. Ack MCP peint AVANT ses arguments (onEarlyAcks) : l'en-tête se met à
//      jour quand markEarlyAckPending les pose, sans attendre un autre rendu.
//   E. Génération réelle (modèle stubé, deux tours de deux appels internes,
//      étiqueteur stubé : une étape par tour) : requêtes d'étiquetage (une par
//      tour, hors contexte, sans outils, intentions lues), composer à l'étape
//      d'analyse, en-tête live, payload sans aucune trace d'étape, puis reload.
//      Avant le reload, aller-retour compact/liste sous l'espace de la bulle
//      envoyée : elle ne doit pas sautiller (plancher holdThreadTailSpaceFloor).
//   F. Loupe : le but posé sur l'ack s'affiche en tête, l'intention n'est pas
//      répétée dans la liste des arguments.
//   G. Réglage « Buts des appels d'outils » coupé : aucune requête
//      d'étiquetage, aucun en-tête.
//   H. Conversation d'avant l'étiqueteur : à l'ouverture, la bulle de deux
//      appels sans étape est nommée (une requête, tous ses tours), la bulle
//      d'un seul appel ne l'est pas ; l'étape est persistée, et une
//      réouverture après reload ne redemande rien.
//   I. Même rattrapage sur une bulle à DEUX étapes dont l'ack visible en
//      compact est un sous-produit MCP sans `group` (arrivé après son action) :
//      l'étiquette n'est posée que sur des acks dont le nœud est hors du
//      document (le compact ne garde que le nœud visible), et l'en-tête doit
//      pourtant apparaître sans passer par la liste.
//
// Usage : node verify-ack-goals.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (!cond && detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  if (!cond) failures.push(label);
};

// Le chat est stubé ici (serve: false) : deux tours d'outils, puis la réponse
// finale, retenue tant que `__releaseFinal` n'est pas posé pour que l'étape
// d'analyse reste observable. Branché sur le CONTENU de la requête (nombre de
// tours déjà servis), jamais sur un compteur : titrage, résumé et étiquetage
// passent par le même point (non streamés, servis en JSON). L'étiqueteur est
// reconnu à son prompt système, et répond selon qu'une étape est déjà nommée.
const browser = await launchIsolated({ headless: !headed }, { serve: false });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
await page.addInitScript(() => {
  window.__chat = { toolTurns: 0, finalTurns: 0, finalBodies: [], labelBodies: [] };
  window.__releaseFinal = false;
  const realFetch = window.fetch;
  const sse = (chunks) => new Response(chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (/\/v1\/models$/.test(url)) {
      return new Response(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (!/\/chat\/completions$/.test(url)) return realFetch(input, opts);
    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) { /* corps illisible */ }
    const sys0 = ((body.messages || [])[0] || {}).content || '';
    if (!body.stream && /^Tu nommes les étapes/.test(sys0)) {
      window.__chat.labelBodies.push(body);
      const user = (body.messages[1] || {}).content || '';
      const answer = /Demande : Compare mes agendas/.test(user) ? 'Lecture des agendas\nComparaison des créneaux'
        : /Tour 2 :/.test(user) ? 'Recensement des anciennes notes\n='
        : /Étapes déjà nommées : aucune/.test(user) ? 'Inventaire des conversations' : 'Lecture des conversations';
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (!body.stream) {
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const msgs = body.messages || [];
    // Tours déjà servis DANS cette conversation : messages assistant porteurs
    // de tool_calls depuis le dernier message utilisateur authentique.
    let lastUser = -1;
    msgs.forEach((m, i) => { if (m.role === 'user' && typeof m.content === 'string' && /inventaire/i.test(m.content)) lastUser = i; });
    const served = msgs.slice(lastUser + 1).filter(m => m.role === 'assistant' && m.tool_calls).length;
    if (served < 2) {
      window.__chat.toolTurns++;
      const call = (index, id, args) => ({ index, id, type: 'function',
        function: { name: 'miaou__conv__list', arguments: JSON.stringify(args) } });
      const y = served ? '2002' : '2000';
      return sse([
        { choices: [{ delta: { tool_calls: [
          call(0, 'call_a' + served, { since: y + '-01-01T00:00:00Z', miaou_intent: 'Liste des conversations depuis ' + y }),
          call(1, 'call_b' + served, { since: y + '-06-01T00:00:00Z', miaou_intent: 'Liste des conversations récentes' }),
        ] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ]);
    }
    window.__chat.finalTurns++;
    window.__chat.finalBodies.push(body);
    window.__finalHeld = true;
    while (!window.__releaseFinal) await new Promise(r => setTimeout(r, 30));
    return sse([
      { choices: [{ delta: { content: 'Voici l\'inventaire.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]);
  };
});
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });

// Fabrique d'acks d'appel dans la page : `goal` porte l'étape, comme la pose
// applyStepLabels (main.js) sur l'entrée du fil. Fonction, pas bloc unique :
// le reload de la section E efface ces globals, à reposer.
const installHelpers = () => page.evaluate(() => {
  window.__call = (n, group, goal) => {
    const a = { role: 'tool-ack', kind: 'mcp_call', server: 'srv', name: 'srv__tool_' + n,
      intent: 'Étape ' + n, group, args: { q: 'n' + n }, result: 'ok' };
    if (goal) a.goal = goal;
    return a;
  };
  window.__state = (wrap) => {
    const g = wrap.querySelector('.ack-group');
    const h = g.querySelector('.ack-goal');
    const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
    return {
      mode: g.dataset.mode,
      header: vis(h) ? h.textContent : '',
      fading: !!h && h.classList.contains('ack-goal-enter'),
      badge: g.querySelector('.ack-badge').textContent,
      segs: Array.from(g.querySelectorAll('.ack-list > .ack-goal-seg')).map(s => ({
        title: s.querySelector('.ack-goal-title').textContent,
        titleVisible: vis(s.querySelector('.ack-goal-title')),
        acks: s.querySelectorAll('.tool-ack').length,
        indent: parseFloat(getComputedStyle(s.querySelector('.tool-ack')).marginLeft),
      })),
      bare: Array.from(g.querySelectorAll('.ack-list > .tool-ack')).length,
      bareIndent: (() => { const b = g.querySelector('.ack-list > .tool-ack'); return b ? parseFloat(getComputedStyle(b).marginLeft) : null; })(),
    };
  };
});
await installHelpers();

// ════════════════════════════════════════════════════════════════════════════
console.log('\nA. Compact en live : deux buts, trois appels puis deux');
// ════════════════════════════════════════════════════════════════════════════
// L'étiqueteur pose l'étape sur TOUS les appels d'un tour nommé.
const plan = [[1, 'g1', 'Comparaison des deux contrats'], [2, 'g2', 'Comparaison des deux contrats'],
              [3, 'g3', 'Comparaison des deux contrats'],
              [4, 'g4', 'Rédaction de la synthèse'], [5, 'g5', 'Rédaction de la synthèse']];
const headers = [];
await page.evaluate(() => { document.getElementById('thread').innerHTML = ''; window.__wA = startAssistantMessage('test-model'); });
// Démarrages du fondu, comptés par événement (la classe, elle, est retirée à
// la fin de l'animation) : c'est la relance qui se voit, pas la classe.
await page.evaluate(() => {
  window.__fades = 0;
  document.addEventListener('animationstart', (e) => { if (e.animationName === 'ack-goal-in') window.__fades++; });
});
for (const [n, g, goal] of plan) {
  const s = await page.evaluate(({ n, g, goal }) => {
    placeToolAck(window.__wA, window.__call(n, g, goal), true);
    return window.__state(window.__wA);
  }, { n, g, goal });
  headers.push({ header: s.header, fading: s.fading });
  // Laisse aussi finir le fondu, pour que chaque arrivée parte d'un état net.
  await page.waitForTimeout(400);
  // Laisse finir l'arrivée animée du ticker avant l'ack suivant.
  await page.waitForFunction(() => !document.querySelector('.ack-slot.animating'), null, { timeout: 3000 });
}
// B s'affiche dès son premier appel : la bulle a déjà une étape de deux appels
// (A), donc l'en-tête ne s'éteint pas entre deux étapes (règle 3).
check('en-tête après chaque arrivée : —, A, A, B (dès son premier appel), B',
  JSON.stringify(headers.map(h => h.header)) === JSON.stringify(['', 'Comparaison des deux contrats',
    'Comparaison des deux contrats', 'Rédaction de la synthèse', 'Rédaction de la synthèse']), headers);
check('fondu à l\'entrée dans un segment à but (2e et 4e arrivées)', headers[1].fading && headers[3].fading && !headers[4].fading, headers);
const fades = await page.evaluate(() => window.__fades);
check('deux fondus en tout : pas de relance quand le but ne change pas', fades === 2, fades);
const a1 = await page.evaluate(() => window.__state(window.__wA));
check('badge compact : « 2 buts · 5 étapes »', a1.badge === '2 buts · 5 étapes', a1.badge);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nB. Liste : intertitres et filets par segment');
// ════════════════════════════════════════════════════════════════════════════
// Géométrie du compact AVANT bascule : en-tête, ligne de l'ack visible et son
// détail déplié (le dépliage est hérité par la liste, slotExpanded). Comparée
// plus bas aux mêmes éléments en liste : la bascule ne doit rien déplacer
// d'autre que la hauteur.
await page.evaluate(() => window.__wA.querySelector('.ack-slot .mcp-intent-row').click());
const geoCompact = await page.evaluate(() => {
  const r = (el) => { if (!el || !el.getClientRects().length) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top }; };
  const node = window.__wA.querySelector('.ack-slot .tool-ack');
  window.__visibleNode = node;
  return { header: r(window.__wA.querySelector('.ack-goal')), label: r(node.querySelector('.mcp-intent')),
    detail: r(node.querySelector('.mcp-breadcrumb-detail')) };
});
const fadesBefore = await page.evaluate(() => window.__fades);
await page.evaluate(() => window.__wA.querySelector('.ack-badge').click());
await page.waitForFunction(() => document.querySelector('.ack-slot').hidden === true, null, { timeout: 3000 });
const b1 = await page.evaluate(() => window.__state(window.__wA));
const geoList = await page.evaluate(() => {
  const r = (el) => { if (!el || !el.getClientRects().length) return null; const b = el.getBoundingClientRect(); return { x: b.left, y: b.top }; };
  const node = window.__visibleNode;
  return { title: r(window.__wA.querySelector('.ack-goal-title')), label: r(node.querySelector('.mcp-intent')),
    detail: r(node.querySelector('.mcp-breadcrumb-detail')),
    labels: Array.from(window.__wA.querySelectorAll('.ack-goal-seg .mcp-intent')).map(e => e.getBoundingClientRect().left),
    first: r(window.__wA.querySelector('.ack-goal-seg .mcp-intent')) };
});
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 0.5;
check('prémisse : en-tête, ligne et détail mesurés dans les deux modes',
  !!(geoCompact.header && geoCompact.label && geoCompact.detail && geoList.title && geoList.label && geoList.detail), { geoCompact, geoList });
check('bascule : le premier intertitre tombe à la place de l\'en-tête (x et y)',
  geoCompact.header && geoList.title && near(geoCompact.header.x, geoList.title.x) && near(geoCompact.header.y, geoList.title.y), { geoCompact, geoList });
check('bascule : la ligne de l\'ack visible garde son x',
  geoCompact.label && geoList.label && near(geoCompact.label.x, geoList.label.x), { geoCompact, geoList });
check('bascule : son détail garde son x',
  geoCompact.detail && geoList.detail && near(geoCompact.detail.x, geoList.detail.x), { geoCompact, geoList });
// Écart vertical but → première ligne d'ack, le même dans les deux modes :
// c'est ce que l'œil compare à la bascule (l'ack affiché en premier).
const gapCompact = geoCompact.header && geoCompact.label ? geoCompact.label.y - geoCompact.header.y : null;
const gapList = geoList.title && geoList.first ? geoList.first.y - geoList.title.y : null;
check('bascule : même écart vertical entre le but et la première ligne d\'ack', near(gapCompact, gapList), { gapCompact, gapList });
check('liste : toutes les lignes d\'acks des segments au même x',
  geoList.labels.length === 5 && geoList.labels.every(x => near(x, geoList.labels[0])), geoList.labels);
check('l\'en-tête vit dans le panneau compact (il s\'anime avec lui)',
  await page.evaluate(() => !!window.__wA.querySelector('.ack-slot > .ack-goal')));
check('deux segments, dans l\'ordre, 3 puis 2 acks',
  b1.segs.length === 2 && b1.segs[0].title === 'Comparaison des deux contrats' && b1.segs[0].acks === 3
  && b1.segs[1].title === 'Rédaction de la synthèse' && b1.segs[1].acks === 2, b1.segs);
check('intertitres visibles', b1.segs.length === 2 && b1.segs.every(s => s.titleVisible), b1.segs);
check('acks d\'un segment à but : en retrait sous l\'intertitre', b1.segs.length === 2 && b1.segs.every(s => s.indent > 2), b1.segs);
check('aucun ack à nu (tous les appels sont sous un but)', b1.bare === 0, b1.bare);
check('en-tête compact masqué en liste', b1.header === '', b1.header);
check('badge liste : « ▴ 2 buts · 5 étapes »', b1.badge === '▴ 2 buts · 5 étapes', b1.badge);
await page.evaluate(() => window.__wA.querySelector('.ack-badge').click());
await page.waitForFunction(() => document.querySelector('.ack-list').hidden === true, null, { timeout: 3000 });
const b2 = await page.evaluate(() => window.__state(window.__wA));
check('retour en compact : l\'en-tête revient sur le but de l\'ack visible', b2.header === 'Rédaction de la synthèse', b2.header);
const fadesAfter = await page.evaluate(() => window.__fades);
check('aller-retour compact/liste : aucun fondu relancé', fadesAfter === fadesBefore, { fadesBefore, fadesAfter });

// ════════════════════════════════════════════════════════════════════════════
console.log('\nC. Appel isolé sans but, puis but porté par un seul appel');
// ════════════════════════════════════════════════════════════════════════════
const c = await page.evaluate(() => {
  document.getElementById('thread').innerHTML = '';
  const w1 = startAssistantMessage('test-model');
  [window.__call(1, 'g1'), window.__call(2, 'g2', 'Comparaison'), window.__call(3, 'g3', 'Comparaison')].forEach(a => placeToolAck(w1, a, false));
  const compact1 = window.__state(w1);
  w1.querySelector('.ack-badge').click();
  const w2 = startAssistantMessage('test-model');
  [window.__call(1, 'g1', 'Un but'), window.__call(2, 'g2', 'Un autre')].forEach(a => placeToolAck(w2, a, false));
  const compact2 = window.__state(w2);
  w2.querySelector('.ack-badge').click();
  return { compact1, compact2, w1: true };
});
await page.waitForFunction(() => Array.from(document.querySelectorAll('.ack-slot')).every(s => s.hidden), null, { timeout: 3000 });
const c2 = await page.evaluate(() => Array.from(document.querySelectorAll('#thread .msg.assistant')).map(w => window.__state(w)));
check('(iii) compact : en-tête du but de l\'ack visible', c.compact1.header === 'Comparaison', c.compact1.header);
check('(iii) un seul but → badge sans « buts »', c.compact1.badge === '3 étapes', c.compact1.badge);
check('(iii) liste : l\'appel isolé reste à nu, sans retrait, puis un segment de 2 en retrait',
  c2[0].bare === 1 && c2[0].bareIndent === 2 && c2[0].segs.length === 1 && c2[0].segs[0].acks === 2
  && c2[0].segs[0].indent > c2[0].bareIndent, c2[0]);
check('(iv) buts sur un seul appel chacun : ni en-tête ni intertitre',
  c.compact2.header === '' && c2[1].segs.length === 0 && c2[1].bare === 2 && c.compact2.badge === '2 étapes', { c: c.compact2, l: c2[1] });

// ════════════════════════════════════════════════════════════════════════════
console.log('\nD. Ack MCP peint avant ses arguments');
// ════════════════════════════════════════════════════════════════════════════
const d = await page.evaluate(() => {
  document.getElementById('thread').innerHTML = '';
  const w = startAssistantMessage('test-model');
  placeToolAck(w, window.__call(1, 'g1', 'Comparaison'), false);
  // Comme onEarlyAcks : l'entrée est peinte sans args, puis complétée. Son
  // étape est déjà là (applyStepLabels nomme tout ack poussé depuis la
  // frontière du tour) : ce sont les args qui en font un appel qui compte.
  const early = { role: 'tool-ack', kind: 'mcp_call', server: 'srv', name: 'srv__tool_2', intent: 'Étape 2', goal: 'Comparaison' };
  const node = placeToolAck(w, early, false);
  const before = window.__state(w).header;
  markEarlyAckPending(early, node, { q: 'n2' });
  const after = window.__state(w).header;
  return { before, after };
});
check('prémisse : sans args, l\'appel ne compte pas encore (pas d\'en-tête)', d.before === '', d);
check('markEarlyAckPending pose les args → en-tête à jour aussitôt', d.after === 'Comparaison', d);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE. Génération réelle : composer, fil live, payload, reload');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => { document.getElementById('thread').innerHTML = ''; newConversation(); });
await page.fill('#composer-text', 'Fais l\'inventaire');
await page.evaluate(() => onSendBtn());
await page.waitForFunction(() => window.__finalHeld === true, null, { timeout: 10000 });
const e1 = await page.evaluate(() => ({
  placeholder: document.getElementById('composer-text').placeholder,
  wraps: document.querySelectorAll('#thread .msg.assistant').length,
  state: (() => { const w = document.querySelector('#thread .msg.assistant'); return w && w.querySelector('.ack-group') ? window.__state(w) : null; })(),
  body: window.__chat.finalBodies[0],
}));
check('prémisse : le stub a servi les deux tours d\'outils', await page.evaluate(() => window.__chat.toolTurns) === 2);
// L'étiquette du second tour arrive en asynchrone : attendre l'état terminal.
await page.waitForFunction(() => window.__chat.labelBodies.length === 2
  && document.getElementById('composer-text').placeholder.includes('Lecture des conversations'), null, { timeout: 5000 }).catch(() => {});
const e1b = await page.evaluate(() => ({
  placeholder: document.getElementById('composer-text').placeholder,
  state: (() => { const w = document.querySelector('#thread .msg.assistant'); return w && w.querySelector('.ack-group') ? window.__state(w) : null; })(),
  labels: window.__chat.labelBodies,
}));
check('étiqueteur : une requête par tour', e1b.labels.length === 2, e1b.labels.length);
const lb = e1b.labels;
check('étiqueteur : hors contexte (deux messages, aucun outil exposé)',
  lb.length === 2 && lb.every(b => b.messages.length === 2 && !b.tools), lb.map(b => ({ n: b.messages.length, tools: !!b.tools })));
check('étiqueteur : lit la demande et les intentions du tour',
  lb.length === 2 && /Demande : Fais l'inventaire/.test(lb[0].messages[1].content)
  && /conv__list — Liste des conversations depuis 2000/.test(lb[0].messages[1].content), lb[0] && lb[0].messages[1].content);
check('étiqueteur, second tour : l\'étape déjà nommée lui est rappelée, seul le nouveau tour est soumis',
  lb.length === 2 && /1\. Inventaire des conversations/.test(lb[1].messages[1].content)
  && /Tour 1 :\n   - conv__list — Liste des conversations depuis 2002/.test(lb[1].messages[1].content)
  && !/Tour 2/.test(lb[1].messages[1].content), lb[1] && lb[1].messages[1].content);
check('composer à l\'analyse : suffixe « · Lecture des conversations »',
  e1b.placeholder.includes(' · Lecture des conversations'), e1b.placeholder);
check('fil live : en-tête de l\'étape en cours, badge « 2 buts · 4 étapes »',
  e1b.state && e1b.state.header === 'Lecture des conversations' && e1b.state.badge === '2 buts · 4 étapes', e1b.state);
const finalBody = await page.evaluate(() => window.__chat.finalBodies[0]);
const assistantTc = (finalBody.messages || []).filter(m => m.role === 'assistant' && m.tool_calls).flatMap(m => m.tool_calls);
check('payload : quatre tool_calls rejoués', assistantTc.length === 4, assistantTc.length);
const payloadText = JSON.stringify(finalBody);
check('payload : aucune trace d\'étape (ni miaou_goal, ni intitulé, ni dans les schémas)',
  !/miaou_goal|Inventaire des conversations|Lecture des conversations/.test(payloadText), payloadText.match(/.{40}(miaou_goal|Inventaire des|Lecture des).{40}/));
await page.evaluate(() => { window.__releaseFinal = true; });
await page.waitForFunction(() => !sending, null, { timeout: 10000 });
const placeholderAfter = await page.evaluate(() => document.getElementById('composer-text').placeholder);
check('fin de génération : plus de suffixe de but', !placeholderAfter.includes('Inventaire'), placeholderAfter);

// Bascule compact/liste sous l'espace de la bulle envoyée (posé à l'envoi,
// la réponse est courte) : la bulle épinglée ne doit pas bouger d'une frame à
// l'autre. Sans plancher, le repli rabotait scrollTop à chaque frame avant que
// l'observateur de l'espace ne le regonfle (sautillement). Échantillonné à
// chaque frame, pas en début et fin : le défaut se résorbe à l'arrivée.
const sampleToggle = () => page.evaluate(() => new Promise((resolve) => {
  const user = document.querySelector('#thread .msg.user');
  const group = document.querySelector('#thread .ack-group');
  const y0 = user.getBoundingClientRect().top;
  // Corps de la réponse, SOUS le groupe : il doit aller dans un seul sens
  // (descendre au dépli, remonter au repli). Un aller-retour trahit une
  // hauteur de groupe qui creuse au milieu de la bascule.
  const body = group.parentNode.querySelector('.body');
  const ys = [];
  let maxDy = 0;
  const t0 = performance.now();
  group.querySelector('.ack-badge').click();
  const tick = () => {
    maxDy = Math.max(maxDy, Math.abs(user.getBoundingClientRect().top - y0));
    ys.push(body.getBoundingClientRect().top);
    if (performance.now() - t0 < 700) requestAnimationFrame(tick);
    else {
      let up = 0, down = 0;
      for (let i = 1; i < ys.length; i++) { const d = ys[i] - ys[i - 1]; if (d > 0.5) down += d; if (d < -0.5) up -= d; }
      resolve({ maxDy, mode: group.dataset.mode, reversal: Math.min(up, down), up, down });
    }
  };
  requestAnimationFrame(tick);
}));
// La vue descend encore vers la bulle envoyée juste après la génération
// (scrollToPinnedSentMessage, animé) : mesurer avant qu'elle y soit attribuait
// ce trajet au geste. Attendre la position épinglée, puis qu'elle tienne.
await page.waitForFunction(() => { const m = document.getElementById('messages');
  return Math.abs(m.scrollTop - pinnedScrollTarget(m)) < 1; }, null, { timeout: 5000 });
await page.waitForTimeout(300);
const g0 = await page.evaluate(() => ({ shown: threadTailSpaceShown(),
  floor: document.getElementById('thread-tail-space').style.minHeight }));
check('prémisse : l\'espace sous la bulle envoyée est posé', g0.shown, g0);
const gOpen = await sampleToggle();
const gClose = await sampleToggle();
check('dépli sous l\'espace : la bulle envoyée ne bouge pas', gOpen.mode === 'list' && gOpen.maxDy < 1, gOpen);
check('repli sous l\'espace : la bulle envoyée ne bouge pas', gClose.mode === 'compact' && gClose.maxDy < 1, gClose);
check('dépli : le corps de la réponse descend sans remonter', gOpen.down > 1 && gOpen.reversal < 1, gOpen);
check('repli : le corps de la réponse remonte sans redescendre', gClose.up > 1 && gClose.reversal < 1, gClose);
const gFloor = await page.evaluate(() => document.getElementById('thread-tail-space').style.minHeight);
check('plancher levé après le geste', gFloor === '', gFloor);

const convId = await page.evaluate(() => currentConvId);
await page.reload();
await page.waitForSelector('#composer-text');
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
await page.evaluate((id) => openConversation(id, true), convId);
await page.waitForFunction(() => !!document.querySelector('#thread .ack-group'), null, { timeout: 10000 });
const e2 = await page.evaluate(() => {
  const w = document.querySelector('#thread .ack-group').parentNode;
  const g = w.querySelector('.ack-group');
  const h = g.querySelector('.ack-goal');
  return { header: h && !h.hidden ? h.textContent : '', fading: !!h && h.classList.contains('ack-goal-enter'),
    badge: g.querySelector('.ack-badge').textContent };
});
check('reload : même en-tête, lu sur les acks persistés', e2.header === 'Lecture des conversations', e2);
check('reload : pas de fondu (reconstruction, pas arrivée)', !e2.fading, e2);
check('reload : badge « 2 buts · 4 étapes »', e2.badge === '2 buts · 4 étapes', e2.badge);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nF. Loupe : le but posé sur l\'ack en tête');
// ════════════════════════════════════════════════════════════════════════════
await installHelpers();
const f = await page.evaluate(() => {
  const read = (entry) => {
    openToolInspector(entry);
    const body = document.getElementById('inspect-body');
    const g = body.querySelector('.inspect-goal');
    const out = {
      goal: g && g.getClientRects().length > 0 ? g.textContent : null,
      label: g ? (g.querySelector('.inspect-goal-label') || {}).textContent : null,
      tip: g ? getTip(g.querySelector('.inspect-goal-label')) : null,
      keys: Array.from(body.querySelectorAll('.inspect-key')).map(k => k.textContent),
    };
    closeToolInspector();
    return out;
  };
  const withGoal = window.__call(1, 'g1', 'Comparaison des deux contrats');
  withGoal.args.miaou_intent = 'Étape 1';
  return { withGoal: read(withGoal), without: read(window.__call(2, 'g2')) };
});
check('loupe : « But » puis le texte du but, en tête',
  f.withGoal.label === 'But' && f.withGoal.goal === 'ButComparaison des deux contrats', f.withGoal);
check('loupe : l\'infobulle dit que MIAOU l\'a nommé', /MIAOU/.test(f.withGoal.tip || ''), f.withGoal.tip);
check('loupe : miaou_intent absent des arguments, q présent',
  f.withGoal.keys.includes('q') && !f.withGoal.keys.includes('miaou_intent'), f.withGoal.keys);
check('loupe : appel sans but → pas de ligne de but', f.without.goal === null && f.without.keys.includes('q'), f.without);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nG. Réglage coupé : aucun étiquetage');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => {
  saveSettings(Object.assign(loadSettings(), { toolSteps: false }));
  window.__releaseFinal = false; window.__finalHeld = false;
  window.__chat.labelBodies = []; window.__chat.toolTurns = 0;
  newConversation();
});
await page.fill('#composer-text', 'Refais l\'inventaire');
await page.evaluate(() => onSendBtn());
await page.waitForFunction(() => window.__finalHeld === true, null, { timeout: 10000 });
await page.waitForTimeout(300);
const g1 = await page.evaluate(() => ({
  turns: window.__chat.toolTurns, labels: window.__chat.labelBodies.length,
  placeholder: document.getElementById('composer-text').placeholder,
  state: (() => { const w = document.querySelector('#thread .msg.assistant:last-of-type'); return w && w.querySelector('.ack-group') ? window.__state(w) : null; })(),
}));
check('prémisse : les deux tours ont été servis', g1.turns === 2, g1.turns);
check('aucune requête d\'étiquetage', g1.labels === 0, g1.labels);
check('ni en-tête ni suffixe du composer', g1.state && g1.state.header === '' && !/ · /.test(g1.placeholder), g1);
await page.evaluate(() => { window.__releaseFinal = true; });
await page.waitForFunction(() => !sending, null, { timeout: 10000 });

// ════════════════════════════════════════════════════════════════════════════
console.log('\nH. Conversation d\'avant l\'étiqueteur : rattrapage à l\'ouverture');
// ════════════════════════════════════════════════════════════════════════════
const oldId = await page.evaluate(() => {
  saveSettings(Object.assign(loadSettings(), { toolSteps: true }));
  window.__chat.labelBodies = [];
  const ack = (n, group) => ({ role: 'tool-ack', kind: 'mcp_call', server: 'srv', name: 'srv__notes__list',
    intent: 'Liste des notes ' + n, group, args: { page: n, miaou_intent: 'Liste des notes ' + n }, result: 'ok', ts: 1 });
  const id = 'conv_old_steps';
  saveConversation({ id, title: 'Ancienne', timestamp: Date.now() - 86400000, spaceId: activeSpaceId, messages: [
    { role: 'user', content: 'Recense mes notes', ts: 1 },
    ack(1, 'gA'), ack(2, 'gA'), ack(3, 'gB'),
    { role: 'assistant', content: 'Voici le recensement.', model: 'stub-model', ts: 2 },
    { role: 'user', content: 'Et la première ?', ts: 3 },
    ack(4, 'gC'),
    { role: 'assistant', content: 'La voici.', model: 'stub-model', ts: 4 },
  ] });
  return id;
});
await page.evaluate((id) => openConversation(id, true), oldId);
await page.waitForFunction(() => { const h = document.querySelector('#thread .ack-goal'); return h && !h.hidden; }, null, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(300);
const h1 = await page.evaluate((id) => ({
  labels: window.__chat.labelBodies.map(b => b.messages[1].content),
  states: Array.from(document.querySelectorAll('#thread .msg.assistant')).filter(w => w.querySelector('.ack-group')).map(w => window.__state(w)),
  stored: loadConversation(id).messages.filter(m => m.role === 'tool-ack').map(m => m.goal || null),
}), oldId);
check('une seule requête, pour la bulle de deux appels et plus, ses deux tours d\'un coup',
  h1.labels.length === 1 && /Demande : Recense mes notes/.test(h1.labels[0]) && /Tour 2 :/.test(h1.labels[0])
  && !/Liste des notes 4/.test(h1.labels[0]), h1.labels);
check('bulle rattrapée : en-tête et badge à un but « 3 étapes »',
  h1.states.length === 2 && h1.states[0].header === 'Recensement des anciennes notes' && h1.states[0].badge === '3 étapes', h1.states);
check('bulle d\'un seul appel : rien', h1.states.length === 2 && h1.states[1].header === '', h1.states[1]);
check('étape persistée sur les trois acks de la bulle, pas sur l\'appel isolé',
  JSON.stringify(h1.stored) === JSON.stringify(['Recensement des anciennes notes', 'Recensement des anciennes notes', 'Recensement des anciennes notes', null]), h1.stored);
await page.reload();
await page.waitForSelector('#composer-text');
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
await installHelpers();
await page.evaluate((id) => openConversation(id, true), oldId);
await page.waitForFunction(() => !!document.querySelector('#thread .ack-group'), null, { timeout: 10000 });
await page.waitForTimeout(500);
const h2 = await page.evaluate(() => ({
  labels: window.__chat.labelBodies.length,
  header: (() => { const h = document.querySelector('#thread .ack-goal'); return h && !h.hidden ? h.textContent : ''; })(),
}));
check('après reload : l\'en-tête vient du stockage, aucune nouvelle requête',
  h2.header === 'Recensement des anciennes notes' && h2.labels === 0, h2);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nI. Rattrapage, deux étapes, ack visible sans group (compact)');
// ════════════════════════════════════════════════════════════════════════════
const twoId = await page.evaluate(() => {
  window.__chat.labelBodies = [];
  const ack = (n, group) => ({ role: 'tool-ack', kind: 'mcp_call', server: 'srv', name: 'srv__agenda__read',
    intent: 'Lecture ' + n, group, args: { day: n, miaou_intent: 'Lecture ' + n }, result: 'ok', ts: 1 });
  const id = 'conv_old_two_steps';
  saveConversation({ id, title: 'Agendas', timestamp: Date.now() - 86400000, spaceId: activeSpaceId, messages: [
    { role: 'user', content: 'Compare mes agendas', ts: 1 },
    ack(1, 'gD'), ack(2, 'gD'), ack(3, 'gE'), ack(4, 'gE'),
    // Sous-produit d'un appel distant : poussé APRÈS l'action, sans `group`
    // (seul l'ack d'action est enrichi) — c'est lui l'ack visible en compact.
    { role: 'tool-ack', kind: 'resource_stored', id: 'res_cmp', resourceName: 'creneaux.txt', mime: 'text/plain', ts: 1 },
    { role: 'assistant', content: 'Voici la comparaison.', model: 'stub-model', ts: 2 },
  ] });
  return id;
});
await page.evaluate((id) => openConversation(id, true), twoId);
await page.waitForFunction(() => window.__chat.labelBodies.length > 0, null, { timeout: 5000 }).catch(() => {});
await page.waitForFunction((id) => (loadConversation(id).messages || []).some(m => m.goal), twoId, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(300);
const i1 = await page.evaluate((id) => {
  const w = Array.from(document.querySelectorAll('#thread .msg.assistant')).find(x => x.querySelector('.ack-group'));
  return {
    labels: window.__chat.labelBodies.length,
    stored: loadConversation(id).messages.filter(m => m.role === 'tool-ack').map(m => m.goal || null),
    state: w ? window.__state(w) : null,
  };
}, twoId);
check('prémisse : une requête, étapes persistées sur les quatre appels, pas sur le sous-produit',
  i1.labels === 1 && JSON.stringify(i1.stored) === JSON.stringify(['Lecture des agendas', 'Lecture des agendas',
    'Comparaison des créneaux', 'Comparaison des créneaux', null]), i1);
check('compact, sans bascule : en-tête de l\'étape de l\'ack visible',
  i1.state && i1.state.mode === 'compact' && i1.state.header === 'Comparaison des créneaux', i1.state);
check('compact : badge « 2 buts · 5 étapes »', i1.state && i1.state.badge === '2 buts · 5 étapes', i1.state && i1.state.badge);

// ════════════════════════════════════════════════════════════════════════════
check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) console.log('\nErreurs console :\n' + consoleErrors.join('\n'));

console.log('\n' + '─'.repeat(60));
console.log(failures.length ? `  ÉCHEC — ${failures.length} :\n   - ` + failures.join('\n   - ')
                            : '  OK — toutes les vérifications passent');
await browser.close();
process.exit(failures.length ? 1 : 0);
