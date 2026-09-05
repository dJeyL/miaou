#!/usr/bin/env node
// Reproduit le cas rapporté : onglet au premier plan, aucune activité, et le
// résumé ne part JAMAIS parce qu'une génération reste bloquée sur un stream qui
// ne se termine pas (réseau coupé sans FIN — Wi-Fi qui bascule, VPN, backend
// tué). isGenerating() reste vrai indéfiniment et summarizeIfNeeded sort à sa
// première garde à chaque cycle.
//
// AVANT le fix, les quatre contrôles montraient le défaut (génération jamais
// désenregistrée, conversation jamais résumée). Ils vérifient MAINTENANT que le
// chien de garde d'inactivité de streamCompletion coupe le flux mort et rend la
// main.
//
// Checklist :
//   A. le chien de garde libère la génération bloquée
//   B. la conversation concernée finit par être résumée
//   C. aucune génération fantôme ne subsiste
//   D. une autre conversation est résumée elle aussi
import { chromium } from 'playwright';

const distPath = '/Users/julien/llm-playground/miaou/dist/miaou.html';
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Le stream PEND : on ne répond jamais. C'est le cœur du scénario.
let hangs = 0;
await page.route(/chat\/completions/, async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  // Discriminant : le chat STREAME, le résumé/titrage non. Bien plus fiable
  // qu'un mot-clef dans le system prompt — celui de MIAOU contient « résumé »,
  // ce qui classait toutes les requêtes de chat comme des résumés.
  if (!body.stream) {
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ summary: 'S', keywords: ['k'] }) }, finish_reason: 'stop' }] }) });
  }
  hangs++;
  await new Promise(() => {});   // stream suspendu pour de bon
});
await page.route(/\/models/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'stub-model' }] }) }));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => {
  // Les cartes « serveurs API » (miaou-api-servers) priment sur miaou-settings :
  // sans cette purge, l'app tape sur le vrai backend de la machine et le stub
  // n'est jamais sollicité.
  localStorage.removeItem('miaou-api-servers');
  localStorage.removeItem('miaou-active-api-server');
  localStorage.setItem('miaou-settings', JSON.stringify({ url: 'http://stub.local/v1', key: 'x', model: 'stub-model' }));
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });

await page.evaluate(() => {
  window.__IDLE_MS = 1000;
  const realST = window.setTimeout;
  // 60000 = cycle de résumé, 180000 = chien de garde d'inactivité du stream.
  window.setTimeout = function (fn, ms, ...rest) {
    if (ms === 60000) ms = window.__IDLE_MS;
    else if (ms === 180000) ms = 2500;
    return realST(fn, ms, ...rest);
  };
});

// Conversation témoin (jamais touchée par la génération bloquée).
await page.evaluate(() => saveConversation({
  id: 'temoin', title: 'Témoin', timestamp: Date.now(), updatedAt: Date.now(), spaceId: 'default',
  messages: [{ role: 'user', content: 'Une question assez longue ici.' }, { role: 'assistant', content: 'Une reponse assez longue ici.' }],
}));

// Conversation qui va rester bloquée : on l'ouvre et on envoie.
await page.evaluate(() => saveConversation({
  id: 'bloquee', title: 'Bloquée', timestamp: Date.now(), updatedAt: Date.now(), spaceId: 'default',
  messages: [{ role: 'user', content: 'Une question assez longue ici.' }, { role: 'assistant', content: 'Une reponse assez longue ici.' }],
}));
await page.evaluate(() => selectConv('bloquee'));
await page.waitForTimeout(300);
await page.click('#composer-text');
await page.type('#composer-text', 'Relance qui va pendre pour toujours.', { delay: 5 });
// Purge de l'index AVANT l'envoi : la conversation a pu être résumée pendant
// l'ouverture (cycle d'inactivité), ce qui masquerait le défaut testé.
await page.evaluate(() => { removeSummaryRecord('bloquee'); removeSummaryRecord('temoin'); });
await page.evaluate(() => onSendBtn());
await page.waitForTimeout(6000);   // > watchdog (2,5 s) + plusieurs cycles de résumé

const state = await page.evaluate(() => ({
  generating: isGenerating('bloquee'),
  activeCount: _activeGenerations.size,
  sumBloquee: !!(getSummaryEntry('bloquee') && getSummaryEntry('bloquee').summary),
}));

// Puis on QUITTE la conversation bloquée — ce qui, chez Julien, a débloqué un
// résumé : celui de la conversation quittée, pas de la bloquée.
await page.evaluate(() => selectConv('temoin'));
await page.waitForTimeout(2500);
const after = await page.evaluate(() => ({
  sumBloquee: !!(getSummaryEntry('bloquee') && getSummaryEntry('bloquee').summary),
  sumTemoin: !!(getSummaryEntry('temoin') && getSummaryEntry('temoin').summary),
  stillGenerating: isGenerating('bloquee'),
}));

await browser.close();

const results = [
  ['A. le chien de garde libère la génération bloquée', !state.generating && state.activeCount === 0, 'isGenerating=' + state.generating + ', registre=' + state.activeCount],
  ['B. la conversation bloquée finit par être résumée', state.sumBloquee || after.sumBloquee, 'résumé=' + (state.sumBloquee || after.sumBloquee)],
  ['C. aucune génération fantôme ne subsiste', !after.stillGenerating, 'isGenerating=' + after.stillGenerating],
  ['D. la conversation témoin est résumée elle aussi', after.sumTemoin, 'résumé témoin=' + after.sumTemoin],
];
let failed = 0;
for (const [name, ok, detail] of results) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + '  — ' + detail);
  if (!ok) failed++;
}
console.log('\nrequêtes de chat laissées en suspens: ' + hangs);
if (consoleErrors.length) console.log('Console errors:\n' + JSON.stringify(consoleErrors, null, 2));
console.log(failed ? failed + ' échec(s)' : 'tout vert — hypothèse confirmée');
process.exitCode = failed ? 1 : 0;
