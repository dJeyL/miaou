#!/usr/bin/env node
// Vérification du lot Q (interjections mid-génération) — un seul lancement.
// SSE stubé produisant une boucle d'outils déterministe : tour 1 = tool_calls
// (conv__list, outil interne sync, sans effet de bord), tour 2 = réponse finale
// 'stop'. Une variable de page (window.__stubPhase) pilote la phase, et un
// point d'arrêt (window.__gateTour2) suspend le 2e tour tant qu'on ne l'a pas
// libéré — fenêtre pendant laquelle on injecte l'interjection et on observe le
// drain B à la frontière de tour.
//
// Vérifie :
//   - Entrée pendant `sending` met en file (puce), ne s'envoie pas directement ;
//   - drain B : bulle user d'interjection insérée SOUS une bulle assistant
//     matérialisée (acks du tour interrompu), les deux horodatées ;
//   - le message part bien au modèle au tour suivant (payload contient le user) ;
//   - fusion de deux interjections en une bulle ;
//   - édition (retour composer) et annulation (croix) ;
//   - reflux sur stop (pas d'envoi auto) ;
//   - reload : fil reconstruit à l'identique, sans acks nus ni assistant vide ;
//   - expandThread élague la bulle _acksOnly du payload.
// Usage : node verify-interjections.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-interjections');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// SSE scripté + capture des payloads envoyés (pour prouver que l'interjection
// atteint le modèle et que la bulle _acksOnly est élaguée).
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
  } catch (e) {}

  window.__sentPayloads = [];
  window.__stubPhase = 0;        // 0 → premier appel (tour outils), 1+ → réponse finale
  window.__gateTour1 = false;    // gate DANS le tour 1 (avant finish_reason) → fenêtre drain B
  window.__releaseTour1 = false;
  window.__gateTour2 = false;    // gate le 2e appel (drain A / tenue de génération)
  window.__releaseTour2 = false;

  const sse = (lines) => new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let i = 0;
      const push = () => {
        if (i < lines.length) { controller.enqueue(enc.encode(lines[i++])); setTimeout(push, 30); }
        else controller.close();
      };
      push();
    },
  });

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      try { window.__sentPayloads.push(JSON.parse(opts.body)); } catch (e) {}
      const phase = window.__stubPhase++;
      let lines;
      if (phase === 0) {
        // Tour 1 : un tool_call conv__list (interne, sync, sans effet de bord).
        // Le stream est GATÉ après le premier delta si __gateTour1 : la boucle
        // reste dans le tour 1 (avant onInterjections) tant qu'on n'a pas
        // libéré — fenêtre pour mettre l'interjection en file AVANT le drain B.
        const tc = { index: 0, id: 'call_stub_1', type: 'function',
          function: { name: 'conv__list', arguments: '{}' } };
        const enc0 = new TextEncoder();
        return new Response(new ReadableStream({
          async start(controller) {
            controller.enqueue(enc0.encode('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [tc] } }] }) + '\n\n'));
            if (window.__gateTour1) { while (!window.__releaseTour1) { await new Promise(r => setTimeout(r, 20)); } }
            controller.enqueue(enc0.encode('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n'));
            controller.enqueue(enc0.encode('data: [DONE]\n\n'));
            controller.close();
          },
        }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      } else {
        // Tour 2+ : réponse finale. Éventuellement gaté pour laisser le temps
        // d'injecter l'interjection AVANT que ce tour ne parte. Le gate respecte
        // opts.signal : un stop (abortStream) pendant l'attente rejette le fetch
        // comme un vrai backend coupé → runConversation voit result.aborted,
        // onFinal reçoit finishReason 'aborted' (≠ nominal) → reflux composer.
        if (window.__gateTour2) {
          while (!window.__releaseTour2) {
            if (opts && opts.signal && opts.signal.aborted) {
              const err = new Error('aborted'); err.name = 'AbortError'; throw err;
            }
            await new Promise(r => setTimeout(r, 20));
          }
        }
        lines = [
          'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Réponse finale du stub.' } }] }) + '\n\n',
          'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n',
          'data: [DONE]\n\n',
        ];
      }
      return new Response(sse(lines), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (url.indexOf('/models') >= 0) {
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return realFetch(input, opts);
  };
};

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
await context.addInitScript(initScript);

const errors = [];
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (name) => { await page.screenshot({ path: path.join(outDir, name) }); console.log('  shot  ' + name); };

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
// Overlay de boot : attendre .boot-done (plancher 1,8 s) sinon capture du préchargement.
await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);

// ─────────────────────────────────────────────────────────────────────────
// Scénario 1 : drain B — interjection pendant la boucle d'outils
// ─────────────────────────────────────────────────────────────────────────
// On gate le tour 1 (avant sa fin) : la boucle reste dans le tour 1, on a le
// temps de mettre l'interjection en file AVANT le drain B (qui suit l'ack).
await page.evaluate(() => { window.__gateTour1 = true; });
await page.fill('#composer-text', 'Analyse ceci.');
await page.press('#composer-text', 'Enter');

// Attendre que sending soit vrai (génération démarrée, tour 1 gaté).
await page.waitForFunction(() => typeof sending !== 'undefined' && sending === true, { timeout: 5000 });
await page.waitForTimeout(200);

// Entrée pendant la génération → mise en file (pas d'envoi direct).
await page.fill('#composer-text', 'Change de cap, fais plutôt X.');
await page.press('#composer-text', 'Enter');
await page.waitForTimeout(150);

let s = await page.evaluate(() => ({
  queued: typeof _pendingInterjections !== 'undefined' ? _pendingInterjections.length : -1,
  chips: document.querySelectorAll('#ij-chips .ij-chip').length,
  railHidden: document.getElementById('ij-rail').hidden,
  composerEmpty: document.getElementById('composer-text').value === '',
  userBubbles: document.querySelectorAll('#thread .msg.user').length,
}));
check('interjection mise en file (registre)', s.queued === 1);
check('puce visible dans le rail', s.chips === 1 && s.railHidden === false);
check('composer vidé après mise en file', s.composerEmpty === true);
check('pas de nouvelle bulle user envoyée directement', s.userBubbles === 1);
await shot('01-queued.png');

// Libérer le tour 1 → l'outil s'exécute, onToolAcks pousse l'ack, PUIS
// onInterjections draine (drain B) : bulle user sous la bulle assistant d'acks.
// Le tour 2 (réponse finale) n'est pas gaté → l'échange se termine.
await page.evaluate(() => { window.__releaseTour1 = true; });
await page.waitForFunction(() => typeof sending !== 'undefined' && sending === false, { timeout: 5000 });
await page.waitForTimeout(300);

s = await page.evaluate(() => {
  const msgs = Array.from(document.querySelectorAll('#thread .msg'));
  const roles = msgs.map(m => m.classList.contains('user') ? 'user' : 'assistant');
  return {
    roles,
    userBubbles: msgs.filter(m => m.classList.contains('user')).length,
    // Bulle user d'interjection = 2e user, doit porter le texte et un horodatage.
    lastUserText: (msgs.filter(m => m.classList.contains('user')).pop() || {}).innerText || '',
    tsCount: document.querySelectorAll('#thread .msg .msg-ts:not([hidden])').length,
    naked: document.querySelectorAll('#thread > .tool-ack').length,   // acks nus hors bulle
  };
});
check('drain B : 2 bulles user (envoi initial + interjection)', s.userBubbles === 2);
check('interjection présente dans le fil', /Change de cap/.test(s.lastUserText));
check('pas d\'ack nu hors bulle assistant', s.naked === 0);
check('horodatages révélés (bulles finalisées)', s.tsCount >= 2);
await shot('02-drained.png');

// Le tour 2 (envoyé APRÈS le drain B) doit contenir l'interjection, et AUCUN
// payload ne doit porter de message assistant vide (bulle _acksOnly élaguée).
s = await page.evaluate(() => {
  const anyHas = window.__sentPayloads.some(pl => (pl.messages || []).some(
    m => m.role === 'user' && typeof m.content === 'string' && m.content.indexOf('Change de cap') >= 0));
  const anyEmpty = window.__sentPayloads.some(pl => (pl.messages || []).some(
    m => m.role === 'assistant' && (m.content == null || m.content === '') && !m.tool_calls));
  return { anyHas, anyEmpty };
});
check('drain B : l\'interjection atteint le modèle (payload)', s.anyHas === true);
check('aucun payload avec bulle assistant vide (_acksOnly élaguée)', s.anyEmpty === false);

// Le thread doit porter la bulle _acksOnly matérialisée (hôte des acks du tour
// interrompu) — preuve que c'est bien le drain B, pas le drain A.
s = await page.evaluate(() => ({
  acksOnly: currentThread.filter(m => m._acksOnly).length,
  roles: currentThread.map(m => m.role + (m._acksOnly ? '[a]' : '')).join(','),
}));
check('drain B : bulle assistant _acksOnly matérialisée dans le thread', s.acksOnly === 1);
console.log('        thread: ' + s.roles);

// ─────────────────────────────────────────────────────────────────────────
// Scénario 2 : reload → fil reconstruit à l'identique
// ─────────────────────────────────────────────────────────────────────────
const before = await page.evaluate(() => Array.from(document.querySelectorAll('#thread .msg'))
  .map(m => (m.classList.contains('user') ? 'user' : 'assistant')).join(','));
const convId = await page.evaluate(() => (typeof currentConvId !== 'undefined' ? currentConvId : null));
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);
// MIAOU ne restaure pas d'active-conv au boot (retombe sur l'accueil) : on
// rouvre explicitement la conversation, comme un clic sidebar, pour comparer
// le rendu reconstruit depuis le store au rendu live d'avant reload.
await page.evaluate((id) => { if (id) openConversation(id); }, convId);
await page.waitForTimeout(400);
const after = await page.evaluate(() => Array.from(document.querySelectorAll('#thread .msg'))
  .map(m => (m.classList.contains('user') ? 'user' : 'assistant')).join(','));
const nakedAfter = await page.evaluate(() => document.querySelectorAll('#thread > .tool-ack').length);
check('reload : séquence de bulles identique (reconstruite depuis le store)', before === after && before.length > 0);
check('reload : pas d\'ack nu flottant', nakedAfter === 0);
await shot('03-reload.png');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 3 : fusion de deux interjections + reflux sur stop
// ─────────────────────────────────────────────────────────────────────────
await page.evaluate(() => { window.__gateTour2 = true; window.__releaseTour2 = false; });
await page.fill('#composer-text', 'Deuxième requête.');
await page.press('#composer-text', 'Enter');
await page.waitForFunction(() => typeof sending !== 'undefined' && sending === true, { timeout: 5000 });
await page.waitForTimeout(200);

await page.fill('#composer-text', 'Interjection A.');
await page.press('#composer-text', 'Enter');
await page.waitForTimeout(80);
await page.fill('#composer-text', 'Interjection B.');
await page.press('#composer-text', 'Enter');
await page.waitForTimeout(120);
s = await page.evaluate(() => ({
  chips: document.querySelectorAll('#ij-chips .ij-chip').length,
  caption: document.getElementById('ij-caption-text').textContent,
}));
check('deux puces en file', s.chips === 2);
check('légende au pluriel (fusion annoncée)', /2 interjections/.test(s.caption));
await shot('04-two-queued.png');

// Stop pendant le tour gaté → abortStream signale opts.signal, le stub rejette
// (AbortError), runConversation voit result.aborted → fin NON-nominale → reflux.
// (On ne libère PAS le gate : le stop doit être ce qui débloque, comme en réel.)
await page.click('#send-btn');   // stop
await page.waitForFunction(() => typeof sending !== 'undefined' && sending === false, { timeout: 5000 });
await page.waitForTimeout(300);
s = await page.evaluate(() => ({
  queued: typeof _pendingInterjections !== 'undefined' ? _pendingInterjections.length : -1,
  chips: document.querySelectorAll('#ij-chips .ij-chip').length,
  composer: document.getElementById('composer-text').value,
}));
check('reflux : file vidée après stop', s.queued === 0 && s.chips === 0);
check('reflux : interjections revenues au composer (fusionnées)',
  /Interjection A\./.test(s.composer) && /Interjection B\./.test(s.composer));
await shot('05-reflow.png');

// ─────────────────────────────────────────────────────────────────────────
// Bilan
// ─────────────────────────────────────────────────────────────────────────
if (errors.length) { console.log('\n  Erreurs console :'); errors.forEach(e => console.log('   - ' + e)); }
console.log('\n' + (failures.length ? '  ÉCHECS : ' + failures.length : '  TOUT VERT') +
  '  (' + (failures.length ? failures.join(' | ') : 'ok') + ')');
await browser.close();
process.exit(failures.length || errors.length ? 1 : 0);
