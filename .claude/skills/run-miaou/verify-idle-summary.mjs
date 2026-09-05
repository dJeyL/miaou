#!/usr/bin/env node
// Vérifie la tuyauterie du résumé sur inactivité (fix 2026-09-01).
//
// Checklist :
//   1. le timer tire seul, sans aucune interaction (cas « parti de l'ordinateur »)
//   2. un clic dans un drawer ne repousse PLUS le résumé (réarmement étroit)
//   3. taper dans le composer le repousse toujours (le réarmement légitime survit)
//   4. quitter la conversation résume celle qu'on quitte (chemin selectConv)
//   5. un lien d'ack conv_ref résume aussi (selectConv, point d'entrée unique)
//   6. visibilitychange -> hidden déclenche (départ de l'onglet)
//
// Le backend est stubé : /chat/completions rend un JSON de résumé valide, et on
// compte les appels dont le system prompt est celui du résumé.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Stub backend : on distingue résumé / titrage / chat par le system prompt.
await page.route('**/chat/completions', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const sys = (body.messages || []).find(m => m.role === 'system');
  const txt = (sys && sys.content) || '';
  const isSummary = /résum|resum|keywords/i.test(txt);
  const content = isSummary
    ? JSON.stringify({ summary: 'Un résumé de test.', keywords: ['test'] })
    : 'Titre de test';
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }),
  });
});
await page.route('**/models', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'stub-model' }] }),
}));

await page.goto('file://' + distPath);
await page.waitForSelector('.boot-done, #composer-text', { timeout: 15000 });

// Réglages minimaux + timer court, posés AVANT de fabriquer les conversations.
await page.evaluate(() => {
  localStorage.setItem('miaou-settings', JSON.stringify({
    url: 'http://stub.local/v1', key: 'x', model: 'stub-model',
  }));
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });

// Raccourcit le cycle d'inactivité. IDLE_SUMMARY_MS est un const inaccessible,
// et surcharger `armIdleSummaryTimer` ne suffirait PAS : les listeners de
// wireIdleSummaryActivity ont capturé la référence ORIGINALE au moment du
// addEventListener — ils continueraient d'armer le timer de 60 s, et le timer
// court posé à côté ne serait jamais annulé par la frappe (le test verrait un
// faux « la frappe ne repousse pas »).
//
// On intercepte donc setTimeout lui-même : tout délai égal à IDLE_SUMMARY_MS
// (60 000) est ramené à 1200 ms, quel que soit l'appelant. La fonction réelle
// reste en place, donc les listeners réarment bien CE timer-là.
await page.evaluate(() => {
  window.__IDLE_MS = 1200;
  const realST = window.setTimeout;
  window.setTimeout = function (fn, ms, ...rest) {
    return realST(fn, ms === 60000 ? window.__IDLE_MS : ms, ...rest);
  };
});

// Deux conversations substantielles (≥1 user et ≥1 assistant ≥8 car.).
const ids = await page.evaluate(async () => {
  const mk = async (id, title) => {
    const conv = {
      id, title, timestamp: Date.now(), updatedAt: Date.now(),
      spaceId: 'default',
      messages: [
        { role: 'user', content: 'Une question suffisamment longue pour compter.' },
        { role: 'assistant', content: 'Une réponse suffisamment longue pour compter.' },
      ],
    };
    saveConversation(conv);
    return id;
  };
  await mk('conv-A', 'Conversation A');
  await mk('conv-B', 'Conversation B');
  return ['conv-A', 'conv-B'];
});

const summaryOf = (id) => page.evaluate((i) => {
  const e = getSummaryEntry(i);
  return e && e.summary ? e.summary : null;
}, id);
const clearSummaries = () => page.evaluate((list) => {
  for (const i of list) removeSummaryRecord(i);
}, ids);

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail: detail || '' }); };

// ── 1. tire seul, sans aucune interaction ───────────────────────────────────
await page.evaluate(() => { selectConv('conv-A'); });
await page.waitForTimeout(400);
await clearSummaries();
await page.evaluate(() => armIdleSummaryTimer());
await page.waitForTimeout(2500);   // > IDLE, aucune interaction entre-temps
check('1. le timer tire seul, sans interaction', !!(await summaryOf('conv-A')));

// ── 2. un clic dans un drawer ne repousse plus ──────────────────────────────
await clearSummaries();
await page.evaluate(() => armIdleSummaryTimer());
await page.click('button[onclick="openSettings()"]');
await page.waitForSelector('#drawer.show', { timeout: 5000 });
await page.click('#drawer');                 // clic hors conversation
await page.waitForTimeout(2500);
const afterDrawer = await summaryOf('conv-A');
await page.evaluate(() => closeSettings && closeSettings());
check('2. un clic dans un drawer ne repousse plus le résumé', !!afterDrawer);

// ── 3. taper dans le composer repousse toujours ─────────────────────────────
await clearSummaries();
await page.click('#composer-text');
await page.evaluate(() => armIdleSummaryTimer());
// Frappe RÉELLE (page.type, pas page.fill : fill ne produit qu'un seul `input`
// et ne garantit pas le focus), à intervalle franchement sous le cycle.
for (let i = 0; i < 6; i++) {
  await page.type('#composer-text', 'x', { delay: 20 });
  await page.waitForTimeout(500);             // < IDLE (1200 ms)
}
const duringTyping = await summaryOf('conv-A');
await page.evaluate(() => { document.getElementById('composer-text').value = ''; });
await page.waitForTimeout(2500);              // on arrête de taper : ça doit partir
const afterTyping = await summaryOf('conv-A');
check('3. la frappe composer repousse, puis le résumé part',
  !duringTyping && !!afterTyping,
  'pendant=' + (duringTyping ? 'résumé (repoussement KO)' : 'aucun') + ', après=' + (afterTyping ? 'résumé' : 'aucun'));

// ── 4. quitter la conversation résume celle qu'on quitte ────────────────────
await clearSummaries();
await page.evaluate(() => { selectConv('conv-B'); });
await page.waitForTimeout(1500);
check('4. quitter via selectConv résume la conversation quittée', !!(await summaryOf('conv-A')));

// ── 5. un lien d'ack conv_ref résume aussi ──────────────────────────────────
// selectConv est le point d'entrée unique : on vérifie que les liens d'ack
// l'utilisent bien, en appelant ce que le onclick appelle désormais.
await clearSummaries();
await page.evaluate(() => { selectConv('conv-A'); });
await page.waitForTimeout(400);
await clearSummaries();
const usesSelectConv = await page.evaluate(() => {
  let called = null;
  const real = window.selectConv;
  window.selectConv = function (id, reveal) { called = id; return real.apply(this, arguments); };
  // reproduit exactement le handler de renderAgentAckLabel / lien conv_ref
  (() => selectConv('conv-B'))();
  window.selectConv = real;
  return called;
});
await page.waitForTimeout(1500);
check('5. un lien d\'ack passe par selectConv et résume', usesSelectConv === 'conv-B' && !!(await summaryOf('conv-A')));

// ── 6. visibilitychange -> hidden déclenche ─────────────────────────────────
await page.evaluate(() => { selectConv('conv-A'); });
await page.waitForTimeout(400);
await clearSummaries();
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(1500);
check('6. visibilitychange (hidden) déclenche le résumé', !!(await summaryOf('conv-A')));

await browser.close();

let failed = 0;
for (const r of results) {
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '  — ' + r.detail : ''));
  if (!r.ok) failed++;
}
if (consoleErrors.length) console.log('\nConsole errors:\n' + JSON.stringify(consoleErrors, null, 2));
console.log('\n' + (failed ? failed + ' échec(s)' : 'tout vert') + ' — ' + results.length + ' contrôles');
process.exitCode = failed ? 1 : 0;
