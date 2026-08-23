#!/usr/bin/env node
// Repro ciblée du bug « lot J » signalé par Julien :
//   Même conversation ouverte dans deux onglets (A et B, même contexte donc
//   même localStorage + BroadcastChannel). On envoie un message depuis A ;
//   B passe readonly pendant la génération de A (attendu), MAIS à la fin B se
//   débloque SANS afficher la nouvelle réponse assistant.
//
// Backend : stub réseau injecté (addInitScript) — window.fetch intercepté pour
//   /chat/completions renvoie un SSE scripté déterministe (pas d'Ollama réel).
//   Les autres fetch (/models…) passent au travers sans casser.
//
// Instrumentation : on trace côté page les décisions sync appliquées par B
//   (applySyncDecision) dans un tableau global window.__syncTrace, relu après.
//
// Usage : node verify-multitab-sync.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-multitab');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// ── Stub réseau + trace, injecté AVANT tout script de page ───────────────────
// On pose aussi la config API plate (miaou-settings) pour que l'app soit
// « configured » (composer déverrouillé) sans passer par l'UI de réglages.
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
  } catch (e) {}

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      // Appels silencieux (titrage/résumé) : non streamés, jamais l'objet du
      // test — réponse plate, pour ne pas les confondre avec une génération.
      try { if (JSON.parse(opts.body).stream !== true) {
        return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'Titre stub' } }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }));
      } } catch (e) {}
      // SSE scripté : d'ABORD des deltas de RAISONNEMENT (delta.reasoning),
      // PUIS des deltas de contenu, puis [DONE]. Reproduit le cas signalé par
      // Julien (« avec raisonnement »). Réponse stable pour repérer la bulle.
      const reasoningParts = ['Je ', 'réfléchis ', 'un ', 'peu... '];
      const contentParts = ['Réponse ', 'du ', 'stub ', 'multi-onglets.'];
      // Gate (scénario 7, lot T-1) : tient CE stream ouvert jusqu'à libération,
      // pour maintenir deux générations en vol dans deux onglets à la fois.
      if (window.__gateStream) {
        const enc = new TextEncoder();
        return Promise.resolve(new Response(new ReadableStream({
          async start(controller) {
            controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Début. ' } }] }) + '\n\n'));
            while (window.__gateStream && !window.__releaseStream) {
              if (opts && opts.signal && opts.signal.aborted) {
                const e = new Error('aborted'); e.name = 'AbortError'; throw e;
              }
              await new Promise(r => setTimeout(r, 20));
            }
            controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Fin.' } }] }) + '\n\n'));
            controller.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n'));
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
      }
      const lines = [];
      for (const r of reasoningParts) {
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: { reasoning: r } }] }) + '\n\n');
      }
      for (const c of contentParts) {
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: { content: c } }] }) + '\n\n');
      }
      lines.push('data: [DONE]\n\n');
      const body = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          let i = 0;
          const push = function () {
            if (i < lines.length) {
              controller.enqueue(enc.encode(lines[i++]));
              // Étalement LENT : > SYNC_HEARTBEAT_MS (5 s) au total pour
              // déclencher au moins un heartbeat conv-generation-started et
              // reproduire les conditions réelles (génération de plusieurs s).
              setTimeout(push, window.__stubSlow ? 900 : 60);
            } else {
              controller.close();
            }
          };
          push();
        },
      });
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }));
    }
    // /models et autres : réponse vide plausible (pas de réseau réel).
    if (url.indexOf('/models') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }));
    }
    return realFetch(input, opts);
  };
};

// Instrumentation de trace : enveloppe applySyncDecision pour journaliser les
// actions reçues par CET onglet. Appelé après chargement complet.
const traceScript = () => {
  window.__syncTrace = [];
  if (typeof applySyncDecision === 'function' && !window.__syncTraced) {
    const orig = applySyncDecision;
    // Redéfinit le global (script concaténé : applySyncDecision est un global nu).
    // eslint-disable-next-line no-global-assign
    applySyncDecision = function (d) {
      try {
        window.__syncTrace.push({
          action: d && d.action,
          sending: typeof sending !== 'undefined' ? sending : null,
          readonly: typeof _convReadonly !== 'undefined' ? _convReadonly : null,
          assistBubbles: document.querySelectorAll('#thread .msg.assistant').length,
          queued: typeof _pendingSyncActions !== 'undefined' ? _pendingSyncActions.length : null,
        });
      } catch (e) {}
      return orig(d);
    };
    window.__syncTraced = true;
  }
};

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
await context.addInitScript(initScript);

const errors = [];
const openTab = async (label) => {
  const p = await context.newPage();
  p.on('console', (m) => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
  p.on('pageerror', (e) => errors.push(label + ': ' + String(e)));
  await p.goto('file://' + distPath);
  await p.waitForSelector('#composer-text', { timeout: 10000 });
  await p.waitForTimeout(300);
  return p;
};

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};

// ── Onglet A : crée une conversation et envoie un premier message ────────────
const A = await openTab('A');
// Envoi depuis A pour matérialiser une conversation (id créé au 1er envoi).
await A.fill('#composer-text', 'Bonjour depuis A');
await A.evaluate(traceScript);
await A.click('#send-btn');
// Attendre la fin du 1er tour dans A (bulle assistant présente, plus de streaming).
await A.waitForFunction(
  () => document.querySelectorAll('#thread .msg.assistant').length >= 1
        && !document.getElementById('send-btn').classList.contains('streaming'),
  { timeout: 15000 },
);
await A.waitForTimeout(300);

const convId = await A.evaluate(() => currentConvId);
check('A : conversation créée (currentConvId non nul)', !!convId);
const aAssistAfter1 = await A.evaluate(() => document.querySelectorAll('#thread .msg.assistant').length);
check('A : 1 réponse assistant après le 1er tour', aAssistAfter1 === 1);

// ── Onglet B : ouvrir LA MÊME conversation ───────────────────────────────────
const B = await openTab('B');
await B.evaluate((id) => { if (typeof openConversation === 'function') openConversation(id); }, convId);
await B.waitForTimeout(400);
await B.evaluate(traceScript);

const bSameConv = await B.evaluate(() => currentConvId);
check('B : même conversation ouverte', bSameConv === convId);
const bAssistBefore = await B.evaluate(() => document.querySelectorAll('#thread .msg.assistant').length);
check('B : 1 réponse assistant visible avant le 2e tour', bAssistBefore === 1);

// Bandeau « même conv ouverte ailleurs » (soft-lock) attendu des deux côtés.
await A.waitForTimeout(200);
const bannerA = await A.evaluate(() => {
  const el = document.getElementById('tab-banner');
  return !!(el && el.classList.contains('show'));
});
const bannerB = await B.evaluate(() => {
  const el = document.getElementById('tab-banner');
  return !!(el && el.classList.contains('show'));
});
check('A : bandeau multi-onglets affiché', bannerA);
check('B : bandeau multi-onglets affiché', bannerB);
await shot(B, '01-B-avant-envoi-A.png');

// ── Cœur du test : 2e message envoyé depuis A (stream LENT → heartbeat) ──────
await A.evaluate(() => { window.__stubSlow = true; });
await A.fill('#composer-text', 'Deuxième message depuis A');
await A.click('#send-btn');

// Pendant la génération de A, B doit passer readonly.
await B.waitForFunction(
  () => document.body.classList.contains('conv-readonly'),
  { timeout: 8000 },
).catch(() => {});
const bReadonlyDuring = await B.evaluate(() => document.body.classList.contains('conv-readonly'));
check('B : readonly ACTIF pendant la génération de A', bReadonlyDuring);
await shot(B, '02-B-readonly-pendant-A.png');

// Attendre la fin du 2e tour dans A.
await A.waitForFunction(
  () => document.querySelectorAll('#thread .msg.assistant').length >= 2
        && !document.getElementById('send-btn').classList.contains('streaming'),
  { timeout: 15000 },
);
// Laisser B traiter les messages sync de fin (conv-updated + readonly-off).
await B.waitForTimeout(1200);

// ── Vérifications finales sur B ──────────────────────────────────────────────
const bReadonlyAfter = await B.evaluate(() => document.body.classList.contains('conv-readonly'));
check('B : readonly LEVÉ après la fin de A', !bReadonlyAfter);

const bAssistAfter = await B.evaluate(() => document.querySelectorAll('#thread .msg.assistant').length);
check('B : 2 réponses assistant visibles après le 2e tour  <<< LE BUG', bAssistAfter === 2);

const bLastText = await B.evaluate(() => {
  const nodes = document.querySelectorAll('#thread .msg.assistant .body');
  const last = nodes[nodes.length - 1];
  return last ? (last.textContent || '').trim() : '';
});
check('B : dernière bulle assistant porte le texte du stub', /stub multi-onglets/.test(bLastText));

// Le bloc de raisonnement doit être présent dans la DERNIÈRE bulle de B (c'est
// le cas signalé : « avec raisonnement »). On vérifie le rendu du reasoning.
const bLastReasoning = await B.evaluate(() => {
  const bubbles = document.querySelectorAll('#thread .msg.assistant');
  const last = bubbles[bubbles.length - 1];
  if (!last) return { has: false, text: '' };
  const r = last.querySelector('.reasoning');
  return { has: !!r, text: r ? (r.textContent || '').trim() : '' };
});
check('B : dernière bulle porte un bloc de raisonnement', bLastReasoning.has);
check('B : raisonnement contient le texte du stub', /réfléchis/.test(bLastReasoning.text));

const bTrace = await B.evaluate(() => window.__syncTrace || []);
console.log('  B trace sync (action / sending / readonly / bulles / queued) :');
for (const t of bTrace) {
  console.log('     ' + [t.action, 's=' + t.sending, 'ro=' + t.readonly,
                         'b=' + t.assistBubbles, 'q=' + t.queued].join('  '));
}
check('B : a bien reçu une action rehydrate', bTrace.some(t => t.action === 'rehydrate'));
// Le rehydrate final (après la fin de A) doit s'exécuter, pas être différé :
// s'il arrive avec sending=true côté B, il est mis en file et jamais drainé
// (B ne fait pas setSending(false)) → 2e réponse jamais rendue. C'est le bug.
const rehydrates = bTrace.filter(t => t.action === 'rehydrate');
const lastRehydrate = rehydrates[rehydrates.length - 1];
if (lastRehydrate) {
  console.log('  dernier rehydrate reçu avec sending=' + lastRehydrate.sending
              + ', queued=' + lastRehydrate.queued);
  check('B : dernier rehydrate NON différé (sending=false)', lastRehydrate.sending === false);
}

await shot(B, '03-B-apres-fin-A.png');

// Comparatif : état de A (référence, doit avoir 2 bulles).
const aAssistFinal = await A.evaluate(() => document.querySelectorAll('#thread .msg.assistant').length);
check('A : 2 réponses assistant (référence)', aAssistFinal === 2);
await shot(A, '04-A-reference.png');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 7 (lot T-1) : le relais est par CONVERSATION, pas par onglet
// ─────────────────────────────────────────────────────────────────────────
// Avant T-1, un onglet ne générait que sur la conv affichée : _genRelayConvId
// était un scalaire et setSending le point d'appariement. T-1 casse les deux —
// un onglet peut générer sur N conversations, et `sending` ne parle plus que de
// l'écran. Le relais est donc devenu une Map<convId, timerId> pilotée par le
// cycle de vie de la génération.
//
// Ce que ce volet vérifie : deux générations en vol sur DEUX conversations
// différentes, chacune verrouille SA conv chez le pair, et la fin de l'une ne
// libère PAS l'autre (le scalaire d'avant T-1 aurait émis le -ended de la
// première sur la conv de la seconde).
console.log('\n— Scénario 7 : relais par conversation (lot T-1)');

// Deux conversations distinctes, créées depuis A (stub rapide, non gaté).
await A.evaluate(() => { window.__stubSlow = false; });
const mkConv = async (text) => {
  await A.evaluate(() => resetToEmpty());
  await A.waitForTimeout(150);
  await A.fill('#composer-text', text);
  await A.click('#send-btn');
  await A.waitForFunction(() => _activeGenerations.size === 0
    && document.querySelectorAll('#thread .msg.assistant').length >= 1, { timeout: 15000 });
  await A.waitForTimeout(200);
  return A.evaluate(() => currentConvId);
};
const convP = await mkConv('Conversation P');
const convQ = await mkConv('Conversation Q');
check('scénario 7 : deux conversations distinctes créées', !!convP && !!convQ && convP !== convQ);

// A génère sur P (gaté), puis sur Q (gaté) : DEUX générations en vol dans A.
await A.evaluate(() => { window.__gateStream = true; window.__releaseStream = false; });
await A.evaluate((id) => selectConv(id), convP);
await A.waitForTimeout(250);
await A.fill('#composer-text', 'Relance P');
await A.click('#send-btn');
await A.waitForFunction(() => _activeGenerations.size === 1, { timeout: 8000 });

await A.evaluate((id) => selectConv(id), convQ);
await A.waitForTimeout(250);
await A.fill('#composer-text', 'Relance Q');
await A.click('#send-btn');
await A.waitForFunction(() => _activeGenerations.size === 2, { timeout: 8000 });
check('A : deux générations en vol sur deux conversations', true);

// Le relais doit porter les DEUX conversations (Map, pas scalaire).
const relayKeys = await A.evaluate(() => Array.from(_genRelayTimers.keys()));
check('A : le relais suit les DEUX conversations (Map, pas scalaire)',
  relayKeys.length === 2 && relayKeys.indexOf(convP) >= 0 && relayKeys.indexOf(convQ) >= 0);

// B ouvre P : il doit passer readonly (P génère chez A).
await B.evaluate((id) => openConversation(id), convP);
await B.waitForFunction(() => document.body.classList.contains('conv-readonly'), { timeout: 9000 }).catch(() => {});
check('B sur P : readonly ACTIF (P génère chez A)',
  await B.evaluate(() => document.body.classList.contains('conv-readonly')));
await shot(B, '05-B-readonly-P.png');

// Libérer : les deux générations de A se terminent.
await A.evaluate(() => { window.__releaseStream = true; });
await A.waitForFunction(() => _activeGenerations.size === 0, { timeout: 10000 });
await A.waitForTimeout(1200);

check('A : plus aucun relais actif après la fin des deux générations',
  await A.evaluate(() => _genRelayTimers.size === 0));
check('B sur P : readonly LEVÉ après la fin',
  await B.evaluate(() => !document.body.classList.contains('conv-readonly')));

// Chaque conversation a reçu SA réponse, et une seule fois.
const both = await A.evaluate(([p, q]) => {
  const txt = (id) => (loadConversation(id).messages || []).map(m => String(m.content || '')).join('|');
  const nAsst = (id) => (loadConversation(id).messages || []).filter(m => m.role === 'assistant').length;
  return { p: txt(p), q: txt(q), np: nAsst(p), nq: nAsst(q) };
}, [convP, convQ]);
check('P a exactement 2 réponses assistant (initiale + relance)', both.np === 2);
check('Q a exactement 2 réponses assistant (initiale + relance)', both.nq === 2);
check('P ne contient rien de Q', !/Relance Q/.test(both.p));
check('Q ne contient rien de P', !/Relance P/.test(both.q));
await shot(B, '06-B-apres-fin.png');

if (errors.length) {
  console.log('\n  Erreurs console :');
  for (const e of errors) console.log('   - ' + e);
}

console.log('\n' + (failures.length ? 'FAIL (' + failures.length + ') : ' + failures.join(' | ')
                                     : 'Tous les checks passent.'));
await browser.close();
process.exit(failures.length ? 1 : 0);
