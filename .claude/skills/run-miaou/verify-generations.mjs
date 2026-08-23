#!/usr/bin/env node
// Vérification du lot T-1 (générations découplées de l'affichage) — un lancement.
//
// T-1 n'a pas de pixel à montrer : son critère est un INVARIANT — « une
// génération écrit dans SA conversation, jamais dans l'écran » (piège 28). Ce
// script exerce donc des états concurrents, pas une apparence.
//
// Le stub SSE est GATÉ PAR CONVERSATION : chaque requête est étiquetée par le
// dernier message user de son payload, ce qui permet de tenir la génération de A
// ouverte pendant qu'on navigue, qu'on en lance une sur B, et de les libérer
// dans l'ordre voulu. C'est ce qui rend N générations concurrentes observables.
//
// Scénarios (numérotation du brief T-1 §8) :
//   1. Survie simple      — quitter pendant le stream, revenir : contenu complet
//   2. Non-corruption     — A finit pendant qu'on est sur B : B intacte (storage)
//   3. Concurrence réelle — deux générations en vol, chacune dans sa conv
//   4. Cross-Space+outils — chaque génération voit SON Espace (foyer 3, T-1c)
//   5. Abort ciblé        — stopper l'affichée n'arrête pas l'autre
//   6. Rebranchement      — revenir mid-stream : texte partiel affiché
//
// Le scénario 7 (relay lot J, deux onglets) demande un second contexte : hors
// périmètre de ce script, cf. verify-multitab-sync.mjs.
//
// Usage : node verify-generations.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-generations');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// ── Stub SSE gaté par conversation ──────────────────────────────────────────
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',   // pas de bannière : elle bloquerait dispatchSend
    }));
  } catch (e) {}

  window.__sent = [];        // payloads envoyés, étiquetés par tag
  window.__gates = {};       // tag → 'hold' tant que non libéré
  window.__released = {};    // tag → true
  window.__toolTags = {};    // tag → true : ce tag fait un tour d'outils
  window.__toolCalls = [];   // { tag, name } observés

  // Étiquette d'une requête : le premier mot-clef trouvé dans le dernier
  // message user. Les envois portent des textes distincts par conversation
  // (« CONV-A … »), ce qui suffit à router les gates sans toucher au code app.
  const tagOf = (body) => {
    const msgs = (body && body.messages) || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'user') continue;
      const txt = typeof m.content === 'string' ? m.content : '';
      const hit = txt.match(/CONV-([A-Z])/);
      if (hit) return hit[1];
    }
    return '?';
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') < 0) {
      if (url.indexOf('/models') >= 0) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(input, opts);
    }

    let body = {};
    try { body = JSON.parse(opts.body); } catch (e) {}

    // Appels SILENCIEUX (titrage, résumé — silentCompletion) : non streamés, et
    // leur payload est une TRANSCRIPTION qui contient « CONV-X ». Sans ce
    // filtre, ils seraient étiquetés comme une génération et fausseraient les
    // comptages (bug de comptage payé en écrivant ce script). On leur répond
    // platement : ils ne sont pas l'objet du lot.
    if (body.stream !== true) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Titre stub' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const tag = tagOf(body);
    window.__sent.push({ tag, body });

    const enc = new TextEncoder();
    const hasToolResult = (body.messages || []).some(m => m.role === 'tool');
    const wantTool = !!window.__toolTags[tag] && !hasToolResult;

    return new Response(new ReadableStream({
      async start(controller) {
        const send = (o) => controller.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));

        if (wantTool) {
          // Tour d'outils : conv__list (interne, synchrone, scopé par Espace —
          // c'est LUI qui révèle le foyer 3 s'il lit l'écran au lieu du ctx).
          send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + tag, type: 'function',
            function: { name: 'conv__list', arguments: '{}' } }] } }] });
          // GATE AVANT finish_reason : l'outil ne s'exécute qu'après libération.
          // Sans ce gate, le tour d'outils partait immédiatement — donc AVANT le
          // changement d'Espace — et l'outil tournait alors que l'écran était
          // encore dans le bon Espace : le test passait même avec la régression
          // (vacuité constatée en la réinjectant). C'est ce gate qui crée la
          // divergence écran/génération que le scénario doit exercer.
          while (window.__gates[tag] && !window.__released[tag]) {
            if (opts && opts.signal && opts.signal.aborted) {
              const err = new Error('aborted'); err.name = 'AbortError'; throw err;
            }
            await new Promise(r => setTimeout(r, 20));
          }
          send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        // Premier fragment : rend le stream OBSERVABLE avant le gate (c'est le
        // texte partiel que le rebranchement doit restituer, scénario 6).
        send({ choices: [{ delta: { content: 'Début-' + tag + '. ' } }] });

        // Gate : tient CETTE génération ouverte. Respecte opts.signal pour que
        // abortStream se comporte comme un vrai backend coupé (scénario 5).
        while (window.__gates[tag] && !window.__released[tag]) {
          if (opts && opts.signal && opts.signal.aborted) {
            const err = new Error('aborted'); err.name = 'AbortError'; throw err;
          }
          await new Promise(r => setTimeout(r, 20));
        }

        send({ choices: [{ delta: { content: 'Fin-' + tag + '.' } }] });
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
};

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
await context.addInitScript(initScript);

const errors = [];
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (n) => { await page.screenshot({ path: path.join(outDir, n) }); console.log('  shot  ' + n); };

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);

// Helpers de pilotage.
const gate = (tag) => page.evaluate((t) => { window.__gates[t] = true; }, tag);
const release = (tag) => page.evaluate((t) => { window.__released[t] = true; }, tag);
const send = async (text) => {
  await page.fill('#composer-text', text);
  await page.press('#composer-text', 'Enter');
};
const newConv = async () => {
  await page.evaluate(() => resetToEmpty());
  await page.waitForTimeout(120);
};
// Attend qu'une génération soit enregistrée pour une conv donnée.
const waitGenCount = (n) => page.waitForFunction(
  (want) => _activeGenerations.size === want, n, { timeout: 8000 });

// ─────────────────────────────────────────────────────────────────────────
// Scénarios 1 + 6 : survie simple et rebranchement mid-stream
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénarios 1 & 6 : survie + rebranchement mid-stream');
await gate('A');
await send('CONV-A première question.');
await waitGenCount(1);
await page.waitForTimeout(250);

const convA = await page.evaluate(() => currentConvId);

// Quitter A vers une conv neuve PENDANT le stream.
await newConv();
let s = await page.evaluate((a) => ({
  genAlive: _activeGenerations.has(a),
  detached: (_activeGenerations.get(a) || {}).wrap === null,
  screenEmpty: document.querySelectorAll('#thread .msg').length === 0,
  sending,
}), convA);
check('génération de A survit à la navigation', s.genAlive === true);
check('génération de A détachée de l\'écran (wrap null)', s.detached === true);
check('écran vidé (conv neuve)', s.screenEmpty === true);
check('sending retombe à false sur une conv inerte', s.sending === false);
await shot('01-detached.png');

// Revenir sur A MID-STREAM : le texte partiel doit être restitué.
await page.evaluate((a) => selectConv(a), convA);
await page.waitForTimeout(300);
s = await page.evaluate((a) => {
  const gen = _activeGenerations.get(a);
  return {
    reattached: !!(gen && gen.wrap),
    threadIsGenThread: gen ? currentThread === gen.thread : false,
    partial: gen ? gen.partialContent : '',
    domText: document.querySelector('#thread .msg.assistant .body')?.innerText || '',
    sending,
  };
}, convA);
check('rebranchement : gen.wrap réattaché', s.reattached === true);
check('currentThread EST gen.thread (même référence)', s.threadIsGenThread === true);
check('texte partiel conservé sur la génération', /Début-A/.test(s.partial));
check('texte partiel réaffiché au retour (scénario 6)', /Début-A/.test(s.domText));
check('sending redevient true sur la conv qui génère', s.sending === true);
await shot('02-reattached.png');

// Laisser A finir, écran sur A.
await release('A');
await waitGenCount(0);
await page.waitForTimeout(300);
s = await page.evaluate((a) => {
  const conv = loadConversation(a);
  const asst = (conv.messages || []).filter(m => m.role === 'assistant');
  return {
    bubbles: document.querySelectorAll('#thread .msg.assistant').length,
    persisted: asst.length,
    text: asst.map(m => m.content).join('|'),
    domText: document.querySelector('#thread .msg.assistant .body')?.innerText || '',
  };
}, convA);
check('une seule bulle assistant (pas de doublon au rebranchement)', s.bubbles === 1);
check('un seul message assistant persisté', s.persisted === 1);
check('contenu complet persisté (début + fin)', /Début-A/.test(s.text) && /Fin-A/.test(s.text));
check('contenu complet affiché', /Début-A/.test(s.domText) && /Fin-A/.test(s.domText));
await shot('03-completed.png');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 2 : non-corruption croisée (le bug que T-1a corrige)
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 2 : non-corruption croisée');
await newConv();
await page.evaluate(() => { window.__released = {}; window.__gates = {}; });
await gate('B');
await send('CONV-B question longue.');
await waitGenCount(1);
await page.waitForTimeout(200);
const convB = await page.evaluate(() => currentConvId);

// Créer une conv C et y écrire un message, pendant que B génère.
await newConv();
// C gatée elle aussi : non gatée, elle pouvait démarrer ET finir entre deux
// sondages de waitGenCount(2), qui ne voyait alors jamais le registre à 2.
await gate('C');
await send('CONV-C message court.');
await waitGenCount(2);
const convC = await page.evaluate(() => currentConvId);
await release('C');
await waitGenCount(1);
await page.waitForTimeout(200);

// Laisser B finir alors que l'écran est sur C.
await release('B');
await waitGenCount(0);
await page.waitForTimeout(350);

s = await page.evaluate(([b, c]) => {
  const cb = loadConversation(b), cc = loadConversation(c);
  const txt = (conv) => (conv.messages || []).map(m => (m.role || '') + ':' + (typeof m.content === 'string' ? m.content : '')).join('|');
  return { b: txt(cb), c: txt(cc), bLen: (cb.messages || []).length, cLen: (cc.messages || []).length };
}, [convB, convC]);
check('B a reçu SA réponse', /Fin-B/.test(s.b));
check('B ne contient rien de C', !/CONV-C/.test(s.b) && !/Fin-C/.test(s.b));
check('C intacte : pas de contenu de B (non-corruption)', !/CONV-B/.test(s.c) && !/Fin-B/.test(s.c));
check('C garde exactement ses 2 messages', s.cLen === 2);
await shot('04-no-crosstalk.png');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 3 : concurrence réelle — deux générations en vol
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 3 : concurrence réelle');
await newConv();
await page.evaluate(() => { window.__released = {}; window.__gates = {}; });
await gate('D');
await send('CONV-D question.');
await waitGenCount(1);
const convD = await page.evaluate(() => currentConvId);

await newConv();
await gate('E');
await send('CONV-E question.');
await waitGenCount(2);
const convE = await page.evaluate(() => currentConvId);

s = await page.evaluate(([d, e]) => ({
  size: _activeGenerations.size,
  dConv: (_activeGenerations.get(d) || {}).convId,
  eConv: (_activeGenerations.get(e) || {}).convId,
  dDetached: (_activeGenerations.get(d) || {}).wrap === null,
  eAttached: !!(_activeGenerations.get(e) || {}).wrap,
}), [convD, convE]);
check('deux générations simultanées au registre', s.size === 2);
check('chaque génération porte SA conversation', s.dConv === convD && s.eConv === convE);
check('seule la génération affichée possède l\'écran', s.dDetached === true && s.eAttached === true);
await shot('05-concurrent.png');

await release('D'); await release('E');
await waitGenCount(0);
await page.waitForTimeout(400);
s = await page.evaluate(([d, e]) => {
  const txt = (id) => (loadConversation(id).messages || []).map(m => String(m.content || '')).join('|');
  return { d: txt(d), e: txt(e) };
}, [convD, convE]);
check('D a sa réponse, et seulement la sienne', /Fin-D/.test(s.d) && !/Fin-E/.test(s.d));
check('E a sa réponse, et seulement la sienne', /Fin-E/.test(s.e) && !/Fin-D/.test(s.e));

// ─────────────────────────────────────────────────────────────────────────
// Scénario 3bis : deux tours d'OUTILS concurrents (mesure de l'arbitrage A2)
// ─────────────────────────────────────────────────────────────────────────
// A2 était laissé ouvert « à trancher sur mesure » : les registres pendants de
// tools.js (_pendingToolAcks / _pendingImageInjections / _pendingToolBlocks)
// sont des singletons de module. Le drain est synchrone dans le tour qui les
// produit, mais deux `await toolPromise` concurrents pourraient mélanger les
// acks. Ce volet CONSTRUIT le cas plutôt que de raisonner dessus : deux
// générations bloquées ensemble dans leur tour d'outils, libérées puis menées à
// terme. Si les acks se mélangeaient, une conversation porterait l'ack de
// l'autre — ou en porterait deux.
console.log('\n— Scénario 3bis : deux tours d\'outils concurrents (A2)');
await newConv();
await page.evaluate(() => { window.__released = {}; window.__gates = {}; window.__toolTags = {}; });
await page.evaluate(() => { window.__toolTags['I'] = true; window.__gates['I'] = true; });
await send('CONV-I question outillée.');
await waitGenCount(1);
await page.waitForFunction(() => window.__sent.some(x => x.tag === 'I'), { timeout: 8000 });
const convI = await page.evaluate(() => currentConvId);

await newConv();
await page.evaluate(() => { window.__toolTags['J'] = true; window.__gates['J'] = true; });
await send('CONV-J question outillée.');
await waitGenCount(2);
await page.waitForFunction(() => window.__sent.some(x => x.tag === 'J'), { timeout: 8000 });
const convJ = await page.evaluate(() => currentConvId);
await page.waitForTimeout(250);

// Les deux sont bloquées DANS leur tour d'outils, en même temps.
check('deux générations simultanément en tour d\'outils', await page.evaluate(() => _activeGenerations.size === 2));

// Libérer les deux quasi simultanément : les tours d'outils s'exécutent, puis
// chaque génération enchaîne son tour final (non gaté, les gates sont consommés).
await page.evaluate(() => { window.__released['I'] = true; window.__released['J'] = true; });
await waitGenCount(0);
await page.waitForTimeout(500);

s = await page.evaluate(([i, j]) => {
  const acks = (id) => (loadConversation(id).messages || []).filter(m => m.role === 'tool-ack');
  const txt = (id) => (loadConversation(id).messages || []).map(m => String(m.content || '')).join('|');
  return {
    iAcks: acks(i).length, jAcks: acks(j).length,
    iNames: acks(i).map(a => a.name).join(','), jNames: acks(j).map(a => a.name).join(','),
    i: txt(i), j: txt(j),
  };
}, [convI, convJ]);
check('I porte exactement UN ack (pas celui de J en plus)', s.iAcks === 1);
check('J porte exactement UN ack (pas celui de I en plus)', s.jAcks === 1);
check('les acks sont bien des conv__list', s.iNames === 'conv__list' && s.jNames === 'conv__list');
check('I a sa réponse finale, sans contenu de J', /Fin-I/.test(s.i) && !/Fin-J/.test(s.i));
check('J a sa réponse finale, sans contenu de I', /Fin-J/.test(s.j) && !/Fin-I/.test(s.j));
await shot('08-concurrent-tools.png');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 5 : abort ciblé
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 5 : abort ciblé');
await newConv();
await page.evaluate(() => { window.__released = {}; window.__gates = {}; });
await gate('F');
await send('CONV-F question.');
await waitGenCount(1);
const convF = await page.evaluate(() => currentConvId);

await newConv();
await gate('G');
await send('CONV-G question.');
await waitGenCount(2);
const convG = await page.evaluate(() => currentConvId);

// Écran sur G : le bouton stop ne doit interrompre QUE G.
await page.click('#send-btn');
await page.waitForFunction((f) => _activeGenerations.size === 1 && _activeGenerations.has(f),
  convF, { timeout: 8000 });
s = await page.evaluate(([f, g]) => ({
  fAlive: _activeGenerations.has(f),
  gGone: !_activeGenerations.has(g),
}), [convF, convG]);
check('la génération affichée est stoppée', s.gGone === true);
check('la génération détachée CONTINUE (abort ciblé)', s.fAlive === true);
await shot('06-abort-targeted.png');

await release('F');
await waitGenCount(0);
await page.waitForTimeout(300);
s = await page.evaluate((f) => ({ f: (loadConversation(f).messages || []).map(m => String(m.content || '')).join('|') }), convF);
check('F termine normalement après l\'abort de G', /Fin-F/.test(s.f));

// ─────────────────────────────────────────────────────────────────────────
// Scénario 4 : cross-Space + outils (le test qui attrape le foyer 3)
// ─────────────────────────────────────────────────────────────────────────
// Sans lui, T-1 est « vert et faux » : un conv__list exécuté par la génération
// de X pendant que l'écran est dans l'Espace Y listerait les conversations de Y.
console.log('\n— Scénario 4 : cross-Space + outils (foyer 3 / T-1c)');
await newConv();
await page.evaluate(() => { window.__released = {}; window.__gates = {}; window.__sent = []; });

// Deux Espaces, chacun avec une conversation-témoin RÉSUMÉE (conv__list liste
// les résumés scopés au Space) portant un titre reconnaissable.
const spaces = await page.evaluate(() => {
  const mk = (name) => { const s = upsertSpace({ name }); return s[s.length - 1].id; };
  const spX = mk('Espace X'), spY = mk('Espace Y');
  saveConversation({ id: 'witness-x', title: 'TEMOIN-X', timestamp: 1000, spaceId: spX, messages: [] });
  saveSummary('witness-x', { title: 'TEMOIN-X', timestamp: 1000, summary: 'sx', keywords: [] });
  saveConversation({ id: 'witness-y', title: 'TEMOIN-Y', timestamp: 2000, spaceId: spY, messages: [] });
  saveSummary('witness-y', { title: 'TEMOIN-Y', timestamp: 2000, summary: 'sy', keywords: [] });
  return { spX, spY };
});

// Génération dans l'Espace X, avec un tour d'outils, gatée.
await page.evaluate((id) => followSpace(id), spaces.spX);
await page.waitForTimeout(150);
await newConv();
await page.evaluate(() => { window.__toolTags['H'] = true; window.__gates['H'] = true; });
await send('CONV-H question outillée.');
await waitGenCount(1);
// Attendre que le tour d'OUTILS soit effectivement parti et bloqué sur le gate :
// c'est la fenêtre pendant laquelle on change d'Espace.
await page.waitForFunction(() => window.__sent.some(x => x.tag === 'H'), { timeout: 8000 });
await page.waitForTimeout(250);

// Basculer sur l'Espace Y PENDANT que la génération de X tourne.
await page.evaluate((id) => followSpace(id), spaces.spY);
await page.waitForTimeout(200);
await newConv();
s = await page.evaluate((sx) => ({ screenSpace: activeSpaceId, genSpace: Array.from(_activeGenerations.values())[0]?.spaceId, matches: Array.from(_activeGenerations.values())[0]?.spaceId === sx }), spaces.spX);
check('l\'écran a changé d\'Espace', s.screenSpace === spaces.spY);
check('la génération garde SON Espace (figé au démarrage)', s.matches === true);

// Libérer : l'outil s'exécute pendant que l'écran est dans l'Espace Y.
await release('H');
await waitGenCount(0);
await page.waitForTimeout(400);

// Le tool result renvoyé au modèle doit lister le témoin de X, jamais celui de Y.
s = await page.evaluate(() => {
  const toolMsgs = [];
  for (const p of window.__sent) {
    for (const m of (p.body.messages || [])) if (m.role === 'tool') toolMsgs.push(String(m.content || ''));
  }
  return { joined: toolMsgs.join('\n'), count: toolMsgs.length };
});
check('un tool result a bien circulé', s.count >= 1);
check('conv__list a vu l\'Espace de la GÉNÉRATION (TEMOIN-X)', /TEMOIN-X/.test(s.joined));
check('conv__list n\'a PAS vu l\'Espace affiché (TEMOIN-Y)', !/TEMOIN-Y/.test(s.joined));
await shot('07-cross-space-tools.png');

// ─────────────────────────────────────────────────────────────────────────
console.log('');
if (errors.length) {
  console.log('Erreurs console :');
  for (const e of errors.slice(0, 10)) console.log('  ! ' + e);
}
check('aucune erreur console', errors.length === 0);

await browser.close();
console.log('\n' + (failures.length ? 'ÉCHEC — ' + failures.length + ' : ' + failures.join(' | ')
                                    : 'OK — tous les contrôles passent'));
process.exit(failures.length ? 1 : 0);
