#!/usr/bin/env node
// Niveaux de raisonnement déclarés, refusés et appris d'un refus
// (cf. docs/model-props.md, « Niveaux de raisonnement déclarés » et suivantes).
// Vérifie ce qu'aucun test QuickJS n'atteint : le menu et la pilule du
// composer, la remise à « défaut » persistée, le corps réellement envoyé, le
// rejeu sans paramètre après une 400, et la ligne de l'inspecteur.
//
// Modèles du stub (schéma OpenRouter, sans champ `capabilities`) :
//   mD — déclare low, medium, high, défaut medium ;
//   mR — ne déclare rien, refuse en 400 tout niveau hors none/high, avec le
//        message de la pile Mistral emballé par une passerelle (forme relevée
//        le 2026-10-07, reconstituée) ;
//   mX — ne déclare rien, refuse en 400 tout `reasoning_effort` avec un
//        message qui ne nomme aucun niveau (rien à apprendre).
//
// Checklist :
//   1. aucune erreur console au chargement (hors 404/400 du stub)
//   2. mD : menu « défaut (medium) », low, medium, high ; pilule « défaut (medium) »
//   3. mD : le défaut GLOBAL « none », non déclaré, ne part pas (prémisse : il vaut none)
//   4. mD : un niveau déclaré choisi part (high)
//   5. mR : rien de déclaré → liste statique ; le niveau « high » de la conversation reste
//   6. mR : « low » refusé → rejeu sans le paramètre, réponse affichée, aucun
//      message d'erreur ; conversation remise à « défaut » ET persistée
//   7. mR : menu réduit à défaut, none, high (appris) ; sélecteur visible ;
//      inspecteur « niveaux appris d'un refus : none, high »
//   8. mR : le défaut global « none », appris accepté, part
//   9. mR → mD : un niveau de conversation non déclaré par mD (none) est remis
//      à « défaut », persisté en IDB (prémisse : il était enregistré)
//  10. mX : « low » refusé sans liste lisible → seul low sort du menu, sélecteur visible
//  11. mX : tous les niveaux statiques refusés → sélecteur masqué, plus rien n'est envoyé
//  12. aucune erreur console sur l'ensemble
//
// VERIFY_DIST=<chemin> rejoue sur un autre build (rouge attendu sur le code
// d'avant : le premier refus y masquait le sélecteur, et rien n'était déclaré).
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const browser = await launchIsolated({ headless: !headed }, { serve: false, native: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
// 404 de la sonde Ollama et 400 voulues du stub : le navigateur les journalise.
const realErrors = () => consoleErrors.filter(e => !/Failed to load resource.*(404|400)/.test(e));

await page.route('**/api/tags', (r) => r.fulfill({
  status: 404, contentType: 'application/json', body: '{"error":"not found"}',
}));
await page.route('**/models', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [
    { id: 'mD', context_length: 131072, supported_parameters: ['reasoning', 'tools', 'max_tokens'],
      reasoning: { mandatory: false, default_enabled: true,
        supported_efforts: ['high', 'medium', 'low'], default_effort: 'medium' } },
    { id: 'mR' },
    { id: 'mX' },
  ] }),
}));

const GATEWAY_REFUSAL = (sent) => JSON.stringify({ error: { type: 'http_error',
  message: '400: ' + JSON.stringify({ object: 'Error',
    message: 'reasoning_effort ' + sent + " is not supported for this model, supported values: [<ReasoningEffort.high: 'high'>, <ReasoningEffort.none: 'none'>]",
    type: 'BadRequestError', code: 400 }) } });

// Tous les corps STREAMÉS, refusés compris ; `served` ne compte que les 200.
const streamed = [];
let served = 0;
await page.route('**/chat/completions', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  if (!body.stream) {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' }, finish_reason: 'stop' }] }) });
    return;
  }
  streamed.push(body);
  const e = body.reasoning_effort;
  if (e && body.model === 'mR' && e !== 'none' && e !== 'high') {
    await route.fulfill({ status: 400, contentType: 'application/json', body: GATEWAY_REFUSAL(e) });
    return;
  }
  if (e && body.model === 'mX') {
    await route.fulfill({ status: 400, contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Unrecognized request argument supplied' } }) });
    return;
  }
  served++;
  const chunks = [
    { choices: [{ delta: { content: 'Réponse de test suffisamment longue.' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ];
  await route.fulfill({ status: 200, contentType: 'text/event-stream',
    body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n' });
});

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('miaou-settings', JSON.stringify({
    showModelSelector: true, showReasoningSelector: true, reasoningEffort: 'none', earlyTitle: false,
  }));
  localStorage.setItem('miaou-api-servers', JSON.stringify([
    { id: 'srvA', name: 'Stub', url: 'http://stub.local/v1', key: 'x', model: 'mD' },
  ]));
  localStorage.setItem('miaou-active-api-server', 'srvA');
});
consoleErrors.length = 0;
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });
await page.waitForFunction(() => {
  const m = JSON.parse(localStorage.getItem('miaou-model-props') || '{}');
  return !!(m.srvA && m.srvA.models && m.srvA.models.mD && m.srvA.models.mD.efforts);
}, null, { timeout: 5000 }).catch(() => {});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail: detail || '' }); };
const shown = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && !el.hidden && el.getClientRects().length > 0;
}, sel);
// Libellés du menu tels que rendus, ouvert puis refermé.
const menuLabels = () => page.evaluate(() => {
  toggleComposerReasoningMenu();
  const out = [...document.querySelectorAll('#composer-reasoning-menu .model-opt span:first-child')].map(s => s.textContent);
  $('composer-reasoning-menu').classList.remove('show');
  return out;
});
const pill = () => page.evaluate(() => $('composer-reasoning-label').textContent);
// Envoie et attend une réponse SERVIE (200) : un refus + rejeu fait deux corps.
const send = async (text) => {
  const n = served;
  await page.evaluate((t) => sendUserText(t), text);
  for (let i = 0; i < 200 && served <= n; i++) await page.waitForTimeout(50);
  await page.waitForFunction(() => !sending, null, { timeout: 10000 }).catch(() => {});
};
const last = () => streamed[streamed.length - 1] || {};
const stored = () => page.evaluate(() => (loadConversation(currentConvId) || {}).reasoningEffort);

// ── 1 ────────────────────────────────────────────────────────────────────────
check('1. aucune erreur console au chargement', realErrors().length === 0, realErrors().join(' | '));

// ── 2-3. mD ──────────────────────────────────────────────────────────────────
await page.evaluate(() => pickComposerModel('mD', 'srvA'));
const menu2 = await menuLabels();
const pill2 = await pill();
check('2. mD : menu des niveaux déclarés, pilule « défaut (medium) »',
  JSON.stringify(menu2) === JSON.stringify(['défaut (medium)', 'low', 'medium', 'high']) && pill2 === 'défaut (medium)',
  JSON.stringify({ menu2, pill2 }));

const global3 = await page.evaluate(() => loadSettings().reasoningEffort);
await send('Premier message sur mD');
const body3 = last();
check('3. mD : le défaut global « none », non déclaré, ne part pas',
  global3 === 'none' && body3.model === 'mD' && !('reasoning_effort' in body3),
  JSON.stringify({ global3, model: body3.model, effort: body3.reasoning_effort }));

// ── 4 ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => pickComposerReasoningEffort('high'));
await send('Deuxième message sur mD');
check('4. mD : un niveau déclaré choisi part', last().reasoning_effort === 'high', JSON.stringify({ model: last().model, effort: last().reasoning_effort }));

// ── 5-8. mR ──────────────────────────────────────────────────────────────────
await page.evaluate(() => pickComposerModel('mR', 'srvA'));
const menu5 = await menuLabels();
const stored5 = await stored();
check('5. mR : liste statique, le niveau « high » de la conversation reste',
  JSON.stringify(menu5) === JSON.stringify(['défaut', 'none', 'low', 'medium', 'high']) && stored5 === 'high',
  JSON.stringify({ menu5, stored5 }));

await page.evaluate(() => pickComposerReasoningEffort('low'));
const before6 = streamed.length;
await send('Troisième message sur mR');
const bodies6 = streamed.slice(before6).map(b => b.reasoning_effort === undefined ? '(absent)' : b.reasoning_effort);
const res6 = await page.evaluate(() => {
  const msgs = [...document.querySelectorAll('#thread .msg.assistant')];
  return {
    lastText: msgs.length ? msgs[msgs.length - 1].textContent : '',
    errors: document.querySelectorAll('#thread .msg-error').length,
  };
});
const stored6 = await stored();
check('6. mR : « low » refusé → rejeu sans le paramètre, réponse affichée, conversation remise à « défaut »',
  JSON.stringify(bodies6) === JSON.stringify(['low', '(absent)']) && res6.lastText.includes('Réponse de test')
    && res6.errors === 0 && stored6 === undefined,
  JSON.stringify({ bodies6, res6, stored6 }));

const menu7 = await menuLabels();
const shown7 = await shown('#composer-reasoning');
await page.evaluate(() => openContextInspector());
const caps7 = await page.evaluate(() => { const el = $('ctx-caps-hint'); return el ? el.textContent : '(absent)'; });
await page.evaluate(() => closeContextInspector());
check('7. mR : menu appris (défaut, none, high), sélecteur visible, inspecteur « appris d\'un refus »',
  JSON.stringify(menu7) === JSON.stringify(['défaut', 'none', 'high']) && shown7
    && caps7.includes('appris d\'un refus : none, high'),
  JSON.stringify({ menu7, shown7, caps7 }));

await send('Quatrième message sur mR');
check('8. mR : le défaut global « none », accepté, part', last().reasoning_effort === 'none', JSON.stringify({ model: last().model, effort: last().reasoning_effort }));

// ── 9. mR → mD ───────────────────────────────────────────────────────────────
await page.evaluate(() => pickComposerReasoningEffort('none'));
const convId = await page.evaluate(() => currentConvId);
const premise9 = await stored();
await page.evaluate(() => pickComposerModel('mD', 'srvA'));
await page.waitForFunction(async (id) => {
  const d = await readConversationFromDB(id);
  return !!d && d.model === 'mD' && d.reasoningEffort === undefined;
}, convId, { timeout: 5000 }).catch(() => {});
const res9 = await page.evaluate(async (id) => {
  const d = await readConversationFromDB(id);
  return { mem: (loadConversation(id) || {}).reasoningEffort, idb: d ? d.reasoningEffort : '(absent)',
    pill: $('composer-reasoning-label').textContent };
}, convId);
check('9. mR → mD : « none », non déclaré par mD, remis à « défaut » et persisté',
  premise9 === 'none' && res9.mem === undefined && res9.idb === undefined && res9.pill === 'défaut (medium)',
  JSON.stringify({ premise9, res9 }));

// ── 10-11. mX ────────────────────────────────────────────────────────────────
await page.evaluate(() => pickComposerModel('mX', 'srvA'));
await page.evaluate(() => pickComposerReasoningEffort('low'));
await send('Cinquième message sur mX');
const menu10 = await menuLabels();
const shown10 = await shown('#composer-reasoning');
check('10. mX : refus sans liste lisible → seul low sort du menu, sélecteur visible',
  JSON.stringify(menu10) === JSON.stringify(['défaut', 'none', 'medium', 'high']) && shown10,
  JSON.stringify({ menu10, shown10 }));

for (const lvl of ['medium', 'high']) {
  await page.evaluate((l) => pickComposerReasoningEffort(l), lvl);
  await send('Message ' + lvl + ' sur mX');
}
// Le dernier niveau statique, « none », vient du défaut global : sa conversation
// est à « défaut » après le refus de high.
await send('Message none sur mX');
const shown11 = await shown('#composer-reasoning');
const n11 = streamed.length;
await send('Dernier message sur mX');
const after11 = streamed.slice(n11).map(b => b.reasoning_effort === undefined ? '(absent)' : b.reasoning_effort);
const refusedX = streamed.filter(b => b.model === 'mX' && b.reasoning_effort).map(b => b.reasoning_effort);
check('11. mX : tous les niveaux statiques refusés → sélecteur masqué, plus rien n\'est envoyé',
  JSON.stringify(refusedX) === JSON.stringify(['low', 'medium', 'high', 'none']) && shown11 === false
    && JSON.stringify(after11) === JSON.stringify(['(absent)']),
  JSON.stringify({ refusedX, shown11, after11 }));

// ── 12 ───────────────────────────────────────────────────────────────────────
check('12. aucune erreur console sur l\'ensemble', realErrors().length === 0, realErrors().join(' | '));

await browser.close();
let fail = 0;
results.sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));
for (const r of results) {
  if (!r.ok) fail++;
  console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail));
}
console.log(fail ? `\n${fail} échec(s)` : '\nTout est vert.');
console.log(`(stub : ${streamed.length} corps streamés, ${served} servis)`);
process.exit(fail ? 1 : 0);
