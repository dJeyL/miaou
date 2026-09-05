#!/usr/bin/env node
// Non-régression du chien de garde d'inactivité : une génération NORMALE, avec
// des chunks espacés, ne doit jamais être coupée. Le watchdog vise la connexion
// morte, pas la lenteur — on stube un flux volontairement lent (chunks toutes
// les 400 ms sur ~4 s) avec un watchdog raccourci à 1 s : chaque chunk le
// réarme, donc rien ne doit être interrompu.
import { chromium } from 'playwright';

const distPath = '/Users/julien/llm-playground/miaou/dist/miaou.html';
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const WORDS = ['Voici', ' une', ' réponse', ' produite', ' lentement', ' mais', ' sans', ' interruption', ' aucune.'];
await page.route(/chat\/completions/, async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  if (!body.stream) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ summary: 'S', keywords: ['k'] }) }, finish_reason: 'stop' }] }) });
  }
  // Flux SSE lent : un chunk toutes les 400 ms. Playwright ne streame pas
  // réellement, mais le corps est produit après un délai global suffisant pour
  // dépasser le watchdog raccourci si celui-ci n'était pas réarmé.
  const sse = WORDS.map(w => 'data: ' + JSON.stringify({ choices: [{ delta: { content: w } }] }) + '\n\n').join('')
    + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n'
    + 'data: [DONE]\n\n';
  await route.fulfill({ status: 200, headers: { 'Content-Type': 'text/event-stream' }, body: sse });
});
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
await page.evaluate(() => {
  const realST = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) { return realST(fn, ms === 180000 ? 1000 : ms, ...rest); };
});

await page.click('#composer-text');
await page.type('#composer-text', 'Dis quelque chose, lentement.', { delay: 5 });
await page.evaluate(() => onSendBtn());
await page.waitForTimeout(4000);

const out = await page.evaluate(() => {
  const last = currentThread.filter(m => m.role === 'assistant').pop();
  return {
    content: (last && last.content) || '',
    truncated: !!(last && last.truncated),
    generating: isGenerating(currentConvId),
    composerError: (document.getElementById('composer-error') || {}).textContent || '',
  };
});
await browser.close();

const expected = WORDS.join('');
const results = [
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
