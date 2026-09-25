#!/usr/bin/env node
// Non-régression du payload d'appels d'outils (422 de prod, 2026-09-17).
//
// LE DÉFAUT. Un backend strict rejette un message assistant qui annonce un
// tool_call sans `function.name`, ou dont le `tool_call_id` n'a pas de message
// `tool` en face. Les deux formes étaient atteignables, par deux chemins
// indépendants, et se payaient d'un 422 opaque : côté UI l'ack s'affichait
// normalement et l'inspecteur d'appel était complet, parce que ni l'un ni
// l'autre ne lit les champs dont le payload a besoin.
//
// CE QUE CE SCRIPT AJOUTE aux tests QuickJS (test-api.js / test-utils.js), qui
// couvrent déjà les deux chemins sur des fonctions isolées : il regarde le
// PAYLOAD RÉELLEMENT ENVOYÉ sur le fil, au tour d'après, dans la vraie
// application — vraie boucle, vrai thread, vraie persistance. Les tests purs
// stubent `streamCompletion` et `callTool` et n'observent que le tableau local
// de la boucle ; ici on lit ce que `fetch` reçoit, ce qu'aucun test pur ne voit.
//
// Ce que ce script exerce :
//   1. Un ack laissé EN VOL (args seul, sans name ni result — l'état où un
//      appel MCP dont la réponse n'est jamais revenue laisse le thread) :
//      l'envoi suivant ne doit produire aucun tool_call anonyme.
//   2. Tour nominal à deux outils : l'assistant porte les deux appels, suivis
//      de leurs deux résultats, dans cet ordre.
//   3. Tout tool_call de tout payload envoyé porte un `function.name` non vide.
//   4. Le thread persisté se recharge en un payload également valide.
//
// NON couvert, et c'est délibéré : le chemin d'émission d'api.js (assistant
// émis avec les seuls appels servis). Mesuré en écrivant ce script — un
// handler qui lève ne laisse aucun ack et son tableau `messages` ne repart
// jamais sur le fil, donc ce chemin est inobservable depuis le payload. Il est
// couvert par test-api.js, qui inspecte le tableau directement.
//
// Le modèle est STUBÉ (SSE scripté) : un vrai modèle n'appellerait pas deux
// outils sur commande — le test serait flaky.
// Cf. mémoire verify-stub-model-real-mcp pour le montage.
//
// Usage : node verify-toolcall-payload-integrity.mjs <dossier-captures> [--headed]
import { launchIsolated } from './stub-backend.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-toolcall-payload');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (cond || !detail ? '' : '\n         ' + detail));
  if (!cond) failures.push(label);
};

// ── Stub SSE ────────────────────────────────────────────────────────────────
// Deux outils au premier tour, réponse texte ensuite. Les outils visés sont
// INTERNES et sans effet de bord (`conv__list`) : ce qu'on teste est la forme
// du payload, pas ce que fait l'outil.
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',
    }));
  } catch (e) {}

  window.__sentBodies = [];
  window.__tourCount = 0;

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

    // TOUT payload streamé est capturé : c'est le témoin du test.
    window.__sentBodies.push(body);
    window.__tourCount++;
    const thisTour = window.__tourCount;

    const enc = new TextEncoder();
    return new Response(new ReadableStream({
      start(controller) {
        const send = (o) => controller.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));
        if (thisTour === 1) {
          // Deux appels dans le MÊME tour : c'est la configuration où le défaut
          // se manifestait (un seul des deux allant au bout).
          send({ choices: [{ delta: { tool_calls: [
            { index: 0, id: 'call_a', type: 'function', function: { name: 'conv__list', arguments: '{}' } },
            { index: 1, id: 'call_b', type: 'function', function: { name: 'conv__list', arguments: '{"limit":3}' } },
          ] } }] });
          send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
        } else {
          send({ choices: [{ delta: { content: 'Terminé.' } }] });
          send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        }
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
};

// Invariant, rejoué côté Node sur le payload capturé. Volontairement RÉÉCRIT
// ici plutôt qu'importé : ce script doit tomber si l'application casse, y
// compris si c'est `unservedToolCallIds` lui-même qui a été affaibli. Un
// contrôle qui partagerait son prédicat avec le sujet qu'il contrôle ne
// prouverait rien (cf. « instrument de mesure tautologique »).
function auditPayload(body) {
  const msgs = (body && body.messages) || [];
  const served = new Set();
  for (const m of msgs) {
    if (m && m.role === 'tool' && m.tool_call_id != null) served.add(m.tool_call_id);
  }
  const unserved = [];
  const unnamed = [];
  for (const m of msgs) {
    for (const tc of (m && m.tool_calls) || []) {
      if (!served.has(tc.id)) unserved.push(tc.id);
      if (!tc.function || !tc.function.name) unnamed.push(tc.id);
    }
  }
  return { unserved, unnamed };
}

const browser = await launchIsolated({ headless: !headed }, { serve: false });
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

const waitIdle = async () => {
  await page.waitForFunction(() => typeof isGenerating === 'function' && !isGenerating(), null, { timeout: 15000 });
  await page.waitForTimeout(250);
};

const send = async (text) => {
  await page.fill('#composer-text', text);
  await page.click('#send-btn');
};

// ─────────────────────────────────────────────────────────────────────────
// CAS 1 — un ack interrompu EN VOL, réinjecté au tour suivant.
//
// C'est le défaut réellement payé en prod. Sa forme exacte a été MESURÉE en
// écrivant ce script, et elle n'est pas celle qu'on suppose : un handler qui
// lève proprement ne la produit PAS (il ne laisse aucun ack, donc rien à
// réinjecter, et le tableau `messages` de la boucle ne repart jamais sur le
// fil puisque l'exception sort de runConversation). Un verify bâti sur cette
// hypothèse passe au vert avant comme après correctif — vérifié, il ne prouve
// rien.
//
// Le vrai défaut vient de `markEarlyAckPending` (lot Z-2), qui pose `args`
// SEUL sur l'ack d'un appel MCP dès l'émission, pour que l'inspecteur montre
// les arguments pendant le round-trip. Si la réponse n'arrive jamais,
// l'enrichissement (`name`/`result`/`ts`) n'a pas lieu : l'ack reste avec un
// `args` orphelin, franchit l'ancien prédicat `args != null`, et
// `expandThread` l'expanse en tool_call SANS `function.name` — 422 au premier
// envoi suivant. On reproduit donc l'ÉTAT, en injectant l'ack tel que ce
// chemin le laisse, puis on regarde le payload d'un nouvel envoi.
console.log('\nCAS 1 — ack interrompu en vol, réinjecté au tour suivant');

await send('premier échange');
await waitIdle();

// Ack tel que le laisse un appel MCP dont la réponse n'est jamais revenue.
// Injecté dans le thread ET persisté : c'est l'état d'une conversation que
// l'utilisateur rouvre après coup — celui qui rendait le fil inutilisable.
await page.evaluate(() => {
  currentThread.push({
    role: 'tool-ack', kind: 'mcp_call',
    args: { instance: 'prod', org_name: 'disfe' },
    group: 'g-verify-orphan',
  });
  persistCurrent();
});
await page.waitForTimeout(300);
await shot('01-orphan-ack-injected.png');

await page.evaluate(() => { window.__sentBodies = []; });
await send('relance avec ack orphelin');
await waitIdle();
await shot('01b-after-resend.png');

let bodies = await page.evaluate(() => window.__sentBodies);
check('un tour d\'outils a bien été émis', bodies.length >= 1,
  'payloads capturés : ' + bodies.length);

// Le cœur du test : TOUS les payloads envoyés respectent l'invariant. Avant le
// correctif, le tour qui suivait l'échec annonçait call_a ET call_b avec un
// seul message `tool`.
let worst = null;
for (let i = 0; i < bodies.length; i++) {
  const a = auditPayload(bodies[i]);
  if (a.unserved.length || a.unnamed.length) { worst = { i, ...a }; break; }
}
check('aucun payload n\'annonce un tool_call sans son résultat ni sans son nom',
  worst === null,
  worst ? 'payload #' + worst.i + ' — sans résultat : [' + worst.unserved.join(', ') +
          '] / sans nom : [' + worst.unnamed.join(', ') + ']' : '');

// ─────────────────────────────────────────────────────────────────────────
// CAS 2 — tour nominal à deux outils : l'ordre est le contrat.
console.log('\nCAS 2 — tour nominal à deux outils');
// Conversation NEUVE : le CAS 1 a laissé un échange en erreur dans le fil, et
// un tour d'outils s'évalue sur l'historique qui le précède. Repartir de zéro
// isole ce qu'on mesure.
await page.evaluate(() => newConversation());
await page.waitForTimeout(300);
await page.evaluate(() => {
  window.__sentBodies = [];
  window.__tourCount = 0;
  window.__callToolSeen = [];
  window.__failNthCall = 0;     // plus aucun échec
});

await send('deux outils, sans échec');
await waitIdle();
await shot('02-nominal-two-tools.png');

bodies = await page.evaluate(() => window.__sentBodies);
const last = bodies[bodies.length - 1];
const seq = ((last && last.messages) || []).map((m) => {
  if (m.role === 'assistant' && m.tool_calls) return 'assistant(' + m.tool_calls.length + 'tc)';
  return m.role;
}).join(',');
check('le dernier payload enchaîne assistant(2tc) puis ses deux résultats',
  seq.indexOf('assistant(2tc),tool,tool') >= 0, 'séquence : ' + seq);

const nominal = auditPayload(last || {});
check('payload nominal sans appel orphelin ni appel anonyme',
  nominal.unserved.length === 0 && nominal.unnamed.length === 0,
  'sans résultat : [' + nominal.unserved.join(', ') + '] / sans nom : [' + nominal.unnamed.join(', ') + ']');

// ─────────────────────────────────────────────────────────────────────────
// CAS 3 — réinjection après rechargement (chemin expandThread, distinct).
// Le payload d'un tour est construit par la boucle ; celui d'un envoi
// ULTÉRIEUR est reconstruit depuis le thread persisté. Deux chemins, deux
// correctifs — celui-ci est le seul qui répare une conversation déjà cassée.
console.log('\nCAS 3 — réinjection depuis le thread persisté (après reload)');
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);

// Rouvrir la conversation du CAS 2 : c'est ELLE qui porte des acks d'outils,
// donc la seule dont la réinjection ait quelque chose à prouver. Sur une
// conversation neuve, tous les contrôles ci-dessous passeraient à vide — d'où
// le témoin de non-vacuité en fin de cas.
await page.evaluate(() => {
  const convs = listAllConversations();
  const target = convs.find((c) => (c.title || '').indexOf('Titre stub') >= 0) || convs[0];
  if (target) openConversation(target.id);
});
await page.waitForTimeout(500);

// `__tourCount` haut : le stub répond directement `stop`, sans réclamer
// d'outil. Ce qu'on mesure est le payload ENVOYÉ, pas ce qu'il déclenche — et
// ce payload contient l'historique réinjecté depuis le thread persisté.
await page.evaluate(() => { window.__sentBodies = []; window.__tourCount = 99; });
await send('relance après rechargement');
await waitIdle();
await shot('03-after-reload.png');

bodies = await page.evaluate(() => window.__sentBodies);
check('un payload a bien été émis après rechargement', bodies.length >= 1,
  'payloads capturés : ' + bodies.length);

let reloadWorst = null;
for (let i = 0; i < bodies.length; i++) {
  const a = auditPayload(bodies[i]);
  if (a.unserved.length || a.unnamed.length) { reloadWorst = { i, ...a }; break; }
}
check('le thread rechargé se réinjecte en un payload valide',
  reloadWorst === null,
  reloadWorst ? 'payload #' + reloadWorst.i + ' — sans résultat : [' +
    reloadWorst.unserved.join(', ') + '] / sans nom : [' + reloadWorst.unnamed.join(', ') + ']' : '');

// Témoin de non-vacuité : un payload qui ne contiendrait AUCUN tool_call
// passerait tous les contrôles ci-dessus sans rien prouver. C'est la forme la
// plus courante de contrôle vert qui ne prouve rien — on l'exclut explicitement.
const totalToolCalls = bodies.reduce((n, b) => n +
  ((b.messages || []).reduce((k, m) => k + ((m.tool_calls || []).length), 0)), 0);
check('le payload rechargé contient bien des tool_calls à vérifier',
  totalToolCalls > 0, 'tool_calls vus : ' + totalToolCalls);

// ─────────────────────────────────────────────────────────────────────────
console.log('');
if (errors.length) {
  console.log('Erreurs console :');
  for (const e of errors.slice(0, 10)) console.log('  ! ' + e);
}
// L'échec d'outil du CAS 1 est provoqué : il peut légitimement laisser une
// trace console. On ne retient que ce qui n'en vient pas.
const unexpected = errors.filter((e) => String(e).indexOf('boom-verify') < 0);
check('aucune erreur console inattendue', unexpected.length === 0,
  unexpected.slice(0, 3).join(' | '));

await browser.close();
console.log('\n' + (failures.length ? 'ÉCHEC — ' + failures.length + ' : ' + failures.join(' | ')
                                    : 'OK — tous les contrôles passent'));
process.exit(failures.length ? 1 : 0);
