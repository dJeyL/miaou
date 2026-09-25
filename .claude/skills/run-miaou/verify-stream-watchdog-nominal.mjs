#!/usr/bin/env node
// Non-régression du chien de garde d'inactivité : une génération NORMALE, avec
// des chunks espacés, ne doit jamais être coupée. Le watchdog vise la connexion
// morte, pas la lenteur — on stube un flux volontairement lent (chunks toutes
// les 400 ms sur ~4 s) avec un watchdog raccourci à 1 s : chaque chunk le
// réarme, donc rien ne doit être interrompu.
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist/miaou.html');
const browser = await launchIsolated({ headless: !process.argv.includes('--headed') }, { serve: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const WORDS = ['Voici', ' une', ' réponse', ' produite', ' lentement', ' mais', ' sans', ' interruption', ' aucune.'];
// Flux SSE RÉELLEMENT espacé : un chunk toutes les 400 ms, servi par un
// `fetch` stubé dans la page qui rend un ReadableStream. L'ancien montage
// passait par `route.fulfill`, qui livre le corps d'un seul bloc — aucun
// silence entre chunks, donc un watchdog jamais réarmé serait passé lui aussi
// (le commentaire le reconnaissait). Il était en outre aiguillé sur le
// littéral 180000, que la config de build peut changer (`stream_idle_timeout_s`) :
// le raccourci ne mordait plus, et le contrôle était vert à vide deux fois.
await page.addInitScript((words) => {
  const realFetch = window.fetch.bind(window);
  window.__chunksServed = 0;
  window.fetch = async (input, opts) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') < 0) return realFetch(input, opts);
    const body = JSON.parse((opts && opts.body) || '{}');
    if (!body.stream) {
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant',
        content: JSON.stringify({ summary: 'S', keywords: ['k'] }) }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const enc = new TextEncoder();
    const chunks = words.map(w => 'data: ' + JSON.stringify({ choices: [{ delta: { content: w } }] }) + '\n\n')
      .concat(['data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n']);
    const signal = opts && opts.signal;
    const stream = new ReadableStream({
      async start(ctrl) {
        for (const c of chunks) {
          await new Promise(r => setTimeout(r, 400));
          if (signal && signal.aborted) { ctrl.error(new DOMException('aborted', 'AbortError')); return; }
          ctrl.enqueue(enc.encode(c));
          window.__chunksServed++;
        }
        ctrl.close();
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}, WORDS);
await page.route(/\/models/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'stub-model' }] }) }));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => {
  localStorage.removeItem('miaou-api-servers');
  localStorage.removeItem('miaou-active-api-server');
  localStorage.setItem('miaou-settings', JSON.stringify({ url: 'http://stub.local/v1', key: 'x', model: 'stub-model' }));
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });

// Watchdog raccourci à 1 s : sans réarmement par chunk, le flux serait coupé.
// Lu sur la constante VIVANTE, jamais en littéral (cf. plus haut). Les 400 ms
// du stub ne sont pas touchées : seul le watchdog est raccourci.
await page.evaluate(() => {
  const realST = window.setTimeout;
  const watchdog = STREAM_IDLE_TIMEOUT_MS;
  window.__watchdogShortened = 0;
  window.setTimeout = function (fn, ms, ...rest) {
    if (ms === watchdog) { window.__watchdogShortened++; ms = 1000; }
    return realST(fn, ms, ...rest);
  };
});

await page.click('#composer-text');
await page.type('#composer-text', 'Dis quelque chose, lentement.', { delay: 5 });
await page.evaluate(() => onSendBtn());
await page.waitForTimeout(5500);   // 10 chunks × 400 ms, plus la marge

const out = await page.evaluate(() => {
  const last = currentThread.filter(m => m.role === 'assistant').pop();
  return {
    content: (last && last.content) || '',
    truncated: !!(last && last.truncated),
    generating: isGenerating(currentConvId),
    composerError: (document.getElementById('composer-error') || {}).textContent || '',
    shortened: window.__watchdogShortened,
    chunks: window.__chunksServed,
  };
});
await browser.close();

const expected = WORDS.join('');
const results = [
  // Prémisses : sans elles, les quatre contrôles suivants passent à vide.
  ['prémisse : le watchdog a bien été raccourci (armé au moins une fois)', out.shortened > 0, 'armements=' + out.shortened],
  ['le flux espacé a été servi en entier (bien plus long que le watchdog raccourci)', out.chunks === WORDS.length + 1, 'chunks=' + out.chunks],
  ['A. la réponse complète est reçue', out.content === expected, JSON.stringify(out.content)],
  ['B. elle n\'est pas marquée tronquée', !out.truncated, 'truncated=' + out.truncated],
  ['C. aucune erreur de connexion affichée', !out.composerError, JSON.stringify(out.composerError)],
  ['D. la génération est bien terminée', !out.generating, 'isGenerating=' + out.generating],
];
let failed = 0;
for (const [n, ok, d] of results) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + '  — ' + d); if (!ok) failed++; }
if (consoleErrors.length) console.log('Console errors:\n' + JSON.stringify(consoleErrors, null, 2));
console.log(failed ? failed + ' échec(s)' : 'tout vert — pas de faux positif du watchdog');
process.exitCode = failed ? 1 : 0;
