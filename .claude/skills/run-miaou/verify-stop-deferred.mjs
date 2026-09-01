#!/usr/bin/env node
// Vérification du Stop différé pendant un tour d'outils (échange du
// 2026-09-01 : le bouton Stop du composer restait inopérant tant qu'un appel
// d'outil — MCP distant, js__eval — était en vol, gen.abort étant momentanément
// null entre deux tours de streamCompletion).
//
// Ce que ce script exerce :
//   1. Cliquer Stop pendant un tour d'outils en vol pose gen.stopRequested
//      (gen.abort n'existe pas à ce moment) et fige le bouton (.stopping,
//      disabled) SANS interrompre l'outil en cours.
//   2. Un second clic pendant l'attente ne fait rien de plus (pas de double
//      abort, pas d'exception).
//   3. À la frontière de tour suivante (outil terminé, avant la relance),
//      l'échange s'arrête bien — comme un abort classique (piège 10) — et
//      AUCUN outil suivant ne part.
//   4. gen.stopRequested reste accroché à SA génération : quitter la
//      conversation puis y revenir rematérialise l'état .stopping/disabled
//      (régression trouvée en écrivant cette vérif : setSending réactivait le
//      bouton juste après que setStopping l'ait désactivé — ordre corrigé).
//
// Usage : node verify-stop-deferred.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-stop-deferred');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// ── Stub SSE (non gaté : le fetch se termine tout de suite après avoir
// annoncé le tool_calls, exactement comme un vrai backend) + gate sur
// callTool lui-même — LE point d'entrée que runConversation attend
// (api.js:734, `await toolPromise`), donc la fenêtre observée est fidèlement
// celle où gen.abort est momentanément null (remis à null dans le `finally`
// de streamCompletion, AVANT que le tour d'outils ne débute).
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',
    }));
  } catch (e) {}

  window.__gate = 'hold';       // 'hold' | 'released'
  window.__toolTourCount = 0;   // nombre de tours d'outils effectivement PARTIS (un fetch stream=true par tour)
  window.__toolCallCount = 0;   // nombre d'appels callTool réellement exécutés
  window.__sentBodies = [];

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
    if (body.stream !== true) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Titre stub' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    window.__sentBodies.push(body);
    window.__toolTourCount++;
    const thisTour = window.__toolTourCount;

    const enc = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        const send = (o) => controller.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + thisTour, type: 'function',
          function: { name: 'conv__list', arguments: '{}' } }] } }] });
        send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
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

// Gate côté outil, posée APRÈS le chargement du script app (pas dans
// l'initScript, qui tourne AVANT : la déclaration top-level `function
// callTool(...)` de tools.js réécraserait un patch posé trop tôt, puisque
// c'est une déclaration de fonction — hoistée et (re)assignée globalement au
// chargement du script concaténé). Le PREMIER appel réel à callTool (utilisé
// par runConversation, api.js:734) reste en attente jusqu'à libération —
// c'est pendant cette attente que gen.abort vaut null (le fetch SSE du tour
// est déjà terminé, cf. api.js:582 vs :745) et que le test clique Stop. Posé
// une seule fois : tient pour tout le script, pas de rechargement de page.
await page.evaluate(() => {
  window.__toolCallCount = 0;
  window.__firstToolCallStarted = false;
  const realCallTool = window.callTool;
  window.callTool = function (name, args, ctx) {
    window.__toolCallCount++;
    const n = window.__toolCallCount;
    if (n === 1) {
      window.__firstToolCallStarted = true;
      return new Promise((resolve) => {
        const poll = () => {
          if (window.__gate === 'released') resolve(realCallTool(name, args, ctx));
          else setTimeout(poll, 20);
        };
        poll();
      });
    }
    return realCallTool(name, args, ctx);
  };
});

const send = async (text) => {
  await page.fill('#composer-text', text);
  await page.press('#composer-text', 'Enter');
};
const newConv = async () => { await page.evaluate(() => resetToEmpty()); await page.waitForTimeout(120); };
const waitGenCount = (n) => page.waitForFunction((want) => _activeGenerations.size === want, n, { timeout: 8000 });

// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Stop pendant un tour d\'outils en vol');
await send('Question outillée.');
await waitGenCount(1);
const convId = await page.evaluate(() => currentConvId);
// Attend que callTool soit réellement entré et bloqué sur le gate — la
// FENÊTRE RÉELLE où gen.abort vaut null (le fetch SSE du tour est déjà
// terminé, cf. api.js:582 vs :745).
await page.waitForFunction(() => window.__firstToolCallStarted === true, { timeout: 8000 });
await page.waitForTimeout(200);

let s = await page.evaluate((id) => {
  const gen = _activeGenerations.get(id);
  return { hasAbort: !!(gen && gen.abort), stopRequested: !!(gen && gen.stopRequested) };
}, convId);
check('en plein tour d\'outils, gen.abort est momentanément null', s.hasAbort === false);
check('stopRequested pas encore posé avant le clic', s.stopRequested === false);
await shot('01-tool-in-flight.png');

// Clic Stop : doit poser stopRequested SANS rien interrompre dans l'instant.
await page.click('#send-btn');
await page.waitForTimeout(150);
s = await page.evaluate((id) => {
  const gen = _activeGenerations.get(id);
  const btn = document.getElementById('send-btn');
  return {
    stopRequested: !!(gen && gen.stopRequested),
    genStillAlive: _activeGenerations.has(id),
    btnDisabled: btn.disabled,
    btnStoppingClass: btn.classList.contains('stopping'),
    btnTitle: btn.title,
  };
}, convId);
check('le clic pose gen.stopRequested (pris en compte tout de suite)', s.stopRequested === true);
check('la génération n\'est PAS interrompue (l\'outil en vol continue)', s.genStillAlive === true);
check('le bouton composer se désactive (second clic impossible)', s.btnDisabled === true);
check('le bouton porte la classe .stopping', s.btnStoppingClass === true);
check('le title annonce l\'attente', s.btnTitle === 'Arrêt en cours…');
await shot('02-stop-clicked-pending.png');

// Second clic pendant l'attente : ne doit rien casser ni redemander un abort.
await page.click('#send-btn', { force: true }).catch(() => {});
await page.waitForTimeout(100);
s = await page.evaluate((id) => ({ genStillAlive: _activeGenerations.has(id) }), convId);
check('un second clic pendant l\'attente ne casse rien', s.genStillAlive === true);

// Libère l'outil : le tour se termine, la frontière de tour doit honorer le
// stop et NE PAS relancer de second tour d'outils.
await page.evaluate(() => { window.__gate = 'released'; });
await waitGenCount(0);
await page.waitForTimeout(300);

s = await page.evaluate(() => window.__toolTourCount);
check('aucun second tour d\'outils n\'est parti (stop honoré à la frontière)', s === 1);

s = await page.evaluate((id) => {
  const conv = loadConversation(id);
  const msgs = conv.messages || [];
  return {
    // Le tour d'outils n'a émis aucun texte avant le tool_call : `truncated`
    // ne se pose QUE si du contenu a déjà été reçu (main.js — « stopper avant
    // le premier token laisse une bulle vide »), donc absent ici à raison.
    // Le signal fiable que le stop a bien été honoré est ailleurs : un seul
    // ack (celui du tour en vol), aucun deuxième round d'outil.
    ackCount: msgs.filter(m => m.role === 'tool-ack').length,
    btn: (() => { const b = document.getElementById('send-btn'); return { disabled: b.disabled, stopping: b.classList.contains('stopping'), streaming: b.classList.contains('streaming') }; })(),
  };
}, convId);
check('un seul ack persisté (le tour en vol, pas de relance)', s.ackCount === 1);
check('le bouton redevient normal une fois le stop honoré', s.btn.disabled === false && s.btn.stopping === false && s.btn.streaming === false);
await shot('03-stop-honored.png');

// ─────────────────────────────────────────────────────────────────────────
console.log('\n— L\'attente reste accrochée à SA conversation (navigation + retour)');
await page.evaluate(() => {
  window.__gate = 'hold';
  window.__toolTourCount = 0;
  window.__toolCallCount = 0;
  window.__firstToolCallStarted = false;
  window.__sentBodies = [];
});
await newConv();
await send('Deuxième question outillée.');
await waitGenCount(1);
const convId2 = await page.evaluate(() => currentConvId);
await page.waitForFunction(() => window.__firstToolCallStarted === true, { timeout: 8000 });
await page.waitForTimeout(200);

await page.click('#send-btn');
await page.waitForTimeout(150);
s = await page.evaluate((id) => !!(_activeGenerations.get(id) || {}).stopRequested, convId2);
check('stopRequested posé avant de quitter la conversation', s === true);

// Quitte la conversation PENDANT l'attente (l'outil tourne toujours).
await newConv();
await page.waitForTimeout(150);
s = await page.evaluate((id) => ({
  genAlive: _activeGenerations.has(id),
  stopRequested: !!(_activeGenerations.get(id) || {}).stopRequested,
  btnOnNewConv: (() => { const b = document.getElementById('send-btn'); return { disabled: b.disabled, stopping: b.classList.contains('stopping') }; })(),
}), convId2);
check('la génération quittée survit (multitâche, piège 28)', s.genAlive === true);
check('stopRequested reste accroché à SA génération après le départ', s.stopRequested === true);
check('la conversation neuve affichée n\'hérite PAS de l\'état .stopping', s.btnOnNewConv.disabled === false && s.btnOnNewConv.stopping === false);
await shot('04-left-while-pending.png');

// Retour sur la conversation : l'état .stopping/disabled doit se
// rematérialiser (régression trouvée et corrigée en écrivant cette vérif :
// setSending réactivait le bouton juste après que setStopping l'ait
// désactivé, à cause de l'ordre des affectations sur send.disabled).
await page.evaluate((id) => selectConv(id), convId2);
await page.waitForTimeout(200);
s = await page.evaluate(() => {
  const b = document.getElementById('send-btn');
  return { disabled: b.disabled, stopping: b.classList.contains('stopping'), title: b.title };
});
check('retour sur la conv : bouton toujours désactivé (rematérialisé)', s.disabled === true);
check('retour sur la conv : classe .stopping rematérialisée', s.stopping === true);
check('retour sur la conv : title toujours "Arrêt en cours…"', s.title === 'Arrêt en cours…');
await shot('05-reattached-still-pending.png');

// Libère : la frontière de tour honore enfin le stop.
await page.evaluate(() => { window.__gate = 'released'; });
await waitGenCount(0);
await page.waitForTimeout(300);
s = await page.evaluate(() => window.__toolTourCount);
check('toujours aucun second tour d\'outils, même après navigation aller-retour', s === 1);
s = await page.evaluate(() => {
  const b = document.getElementById('send-btn');
  return { disabled: b.disabled, stopping: b.classList.contains('stopping') };
});
check('le bouton se libère une fois le stop honoré, même après un aller-retour', s.disabled === false && s.stopping === false);
await shot('06-honored-after-roundtrip.png');

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
