#!/usr/bin/env node
// Lot AF, étape 4 — vision et raisonnement branchés sur la déclaration du
// serveur. Vérifie ce qu'aucun test QuickJS n'atteint : la marque appareil
// photo (bouton et menu), la fiche serveur quand la vision est déclarée, la
// ligne de capacités de l'inspecteur, le sélecteur de raisonnement, et le
// corps réellement envoyé.
//
// Checklist :
//   1. aucune erreur console au chargement
//   2. mV (vision déclarée) : appareil photo visible sur le bouton de modèle
//   3. menu : appareil photo sur mV seulement (pas mN déclaré sans, pas mU inconnu)
//   4. mV : la déclaration l'emporte sur un « Sans vision » manuel (prémisse : le flag est posé)
//   5. mV : sélecteur de raisonnement visible, reasoning_effort envoyé (prémisses de 6-7)
//   6. mN (déclaré sans vision ni raisonnement) : plus d'appareil photo, sélecteur masqué
//   7. mN : reasoning_effort ABSENT du corps envoyé, alors que le défaut des réglages le demande
//   8. inspecteur sur mN : capacités « ✗ » partout, outils envoyés quand même
//   9. mU (rien de déclaré) : le flag manuel décide, et l'inspecteur le nomme
//  10. fiche serveur : libellé figé pour mV, pilule de retour pour mU
//  11. enregistrer la fiche ne touche pas au flag manuel de mV
//  12. aucune erreur console sur l'ensemble
//  13. le niveau de raisonnement de la conversation survit à un passage par un
//      modèle déclaré sans raisonnement, puis à la réouverture de la
//      conversation après rechargement de la page (prémisse : il est enregistré)
//
// Backend stubé au schéma Mistral. VERIFY_DIST=<chemin> rejoue sur un autre
// build (vérifier qu'il passe au rouge sur le code d'avant l'étape).
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Racine native d'Ollama (étape 5) : tout serveur en `/v1` reçoit un
// GET /api/tags à chaque chargement de liste. Ce stub n'est pas un Ollama, il
// répond comme la passerelle du boulot — un 404, que le navigateur journalise
// en console : les bilans console l'écartent, et lui seul.
await page.route('**/api/tags', (r) => r.fulfill({
  status: 404, contentType: 'application/json',
  body: JSON.stringify({ error: { message: '404: {"detail":"Not Found"}' } }),
}));
const realErrors = () => consoleErrors.filter(e => !/Failed to load resource.*404/.test(e));

await page.route('**/models', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', data: [
    { id: 'mV', object: 'model', max_context_length: 131072,
      capabilities: { completion_chat: true, function_calling: true, vision: true, reasoning: true } },
    { id: 'mN', object: 'model', max_context_length: 32768,
      capabilities: { completion_chat: true, function_calling: false, vision: false, reasoning: false } },
    { id: 'mU', object: 'model' },
  ] }),
}));

// Corps des envois STREAMÉS (le chat) ; les appels silencieux (titrage) ne
// sont pas streamés et ne portent jamais le reasoning_effort du composer.
const streamed = [];
await page.route('**/chat/completions', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  if (body.stream) {
    streamed.push(body);
    const chunks = [
      { choices: [{ delta: { content: 'Réponse de test suffisamment longue.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ];
    await route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n' });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' }, finish_reason: 'stop' }] }) });
});

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('miaou-settings', JSON.stringify({
    showModelSelector: true, showReasoningSelector: true, reasoningEffort: 'high', earlyTitle: false,
  }));
  // Flags MANUELS « Sans vision » sur mV (que la déclaration doit battre) et mU
  // (qui doit décider, rien n'étant déclaré).
  localStorage.setItem('miaou-api-servers', JSON.stringify([
    { id: 'srvA', name: 'Stub', url: 'http://stub.local/v1', key: 'x', model: 'mV', vision: { mV: false, mU: false } },
  ]));
  localStorage.setItem('miaou-active-api-server', 'srvA');
});
consoleErrors.length = 0;
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });
// Les propriétés arrivent avec la liste des modèles (prefetch au démarrage).
await page.waitForFunction(() => {
  const m = JSON.parse(localStorage.getItem('miaou-model-props') || '{}');
  return !!(m.srvA && m.srvA.models && m.srvA.models.mN);
}, null, { timeout: 5000 }).catch(() => {});

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail: detail || '' }); };
// Visible = présent, non `hidden`, et pas `display: none` au calcul (une règle
// de classe peut battre `[hidden]`, cf. SKILL.md : compter des nœuds ne dit pas
// ce que l'utilisateur voit).
const shown = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  return !el.hidden && getComputedStyle(el).display !== 'none' && !el.closest('[hidden]');
}, sel);
const safe = (fn, dflt) => page.evaluate(fn).catch(() => dflt);
// Attend qu'un NOUVEAU corps streamé soit arrivé au stub. `!sending` ne suffit
// pas : il est vrai aussi AVANT que l'envoi ait démarré.
const waitStreamed = async (n) => {
  for (let i = 0; i < 100 && streamed.length <= n; i++) await page.waitForTimeout(50);
  await page.waitForFunction(() => !sending, null, { timeout: 10000 }).catch(() => {});
};

// ── 1 ────────────────────────────────────────────────────────────────────────
check('1. aucune erreur console au chargement', realErrors().length === 0, realErrors().join(' | '));

// ── 2 ────────────────────────────────────────────────────────────────────────
check('2. mV : appareil photo visible sur le bouton de modèle', await shown('#composer-model-vision'));

// ── 3 ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => toggleComposerModelMenu());
await page.waitForTimeout(200);
const menuMarks = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll('#composer-model-menu .model-opt').forEach(o => {
    const name = o.querySelector('span').textContent;
    out[name] = !!o.querySelector('.model-opt-vision');
  });
  return out;
});
await page.evaluate(() => { const m = $('composer-model-menu'); if (m) m.classList.remove('show'); });
check('3. menu : appareil photo sur mV seulement',
  menuMarks.mV === true && menuMarks.mN === false && menuMarks.mU === false, JSON.stringify(menuMarks));

// ── 4 ────────────────────────────────────────────────────────────────────────
const vis4 = await page.evaluate(() => ({
  manual: getApiServer('srvA').vision.mV === false,
  enabled: serverModelVisionEnabled(getApiServer('srvA'), 'mV'),
}));
check('4. mV : la vision déclarée bat le « Sans vision » manuel (posé)',
  vis4.manual === true && vis4.enabled === true, JSON.stringify(vis4));

// ── 5 ────────────────────────────────────────────────────────────────────────
const reasonShownV = await shown('#composer-reasoning');
const before5 = streamed.length;
await page.evaluate(() => sendUserText('Premier message sur mV'));
await waitStreamed(before5);
const bodyV = streamed[streamed.length - 1] || {};
check('5. mV : sélecteur visible, reasoning_effort envoyé (prémisses)',
  reasonShownV && bodyV.model === 'mV' && bodyV.reasoning_effort === 'high',
  JSON.stringify({ reasonShownV, model: bodyV.model, effort: bodyV.reasoning_effort }));

// ── 6 ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => pickComposerModel('mN', 'srvA'));
await page.waitForTimeout(150);
const cam6 = await shown('#composer-model-vision');
const reason6 = await shown('#composer-reasoning');
check('6. mN : plus d\'appareil photo, sélecteur de raisonnement masqué',
  cam6 === false && reason6 === false, JSON.stringify({ cam6, reason6 }));

// ── 7 ────────────────────────────────────────────────────────────────────────
const before7 = streamed.length;
await page.evaluate(() => sendUserText('Second message sur mN'));
await waitStreamed(before7);
const bodyN = streamed.length > before7 ? streamed[streamed.length - 1] : null;
const effort7 = await safe(() => activeReasoningEffort(), '(absent)');
check('7. mN : reasoning_effort absent du corps, malgré le défaut « high » des réglages',
  !!bodyN && bodyN.model === 'mN' && !('reasoning_effort' in bodyN) && effort7 === 'high',
  JSON.stringify({ sent: !!bodyN, model: bodyN && bodyN.model, effort: bodyN && bodyN.reasoning_effort, activeEffort: effort7 }));

// ── 8 ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => openContextInspector());
const caps8 = await safe(() => { const el = $('ctx-caps-hint'); return el ? el.textContent : '(absent)'; }, '(absent)');
check('8. inspecteur sur mN : « ✗ » partout, outils envoyés quand même',
  caps8.includes('lecture d\'images ✗, outils ✗, raisonnement ✗') && caps8.includes('envoyés quand même'), caps8);

// ── 9 ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => pickComposerModel('mU', 'srvA'));
await page.waitForTimeout(150);
const res9 = await page.evaluate(() => {
  const el = $('ctx-caps-hint');
  return { enabled: serverModelVisionEnabled(getApiServer('srvA'), 'mU'), line: el ? el.textContent : '(absent)' };
});
check('9. mU : flag manuel décisif, nommé par l\'inspecteur',
  res9.enabled === false && res9.line.includes('non déclarées') && res9.line.includes('Sans vision'), JSON.stringify(res9));
await page.evaluate(() => closeContextInspector());

// ── 10-11. fiche serveur ─────────────────────────────────────────────────────
await page.evaluate(() => openApiServers());
const card = page.locator('#api-list .api-card').first();
await card.locator('.cfg-view button', { hasText: 'Modifier' }).click();
await card.locator('.api-model').fill('mV');
await card.locator('.api-model').dispatchEvent('change');
const cardV = await card.evaluate((c) => {
  const fixed = c.querySelector('.cfg-fixed');
  const pill = c.querySelector('.api-vision') ? c.querySelector('.api-vision').closest('.pill-select') : null;
  return {
    fixed: fixed && !fixed.hidden ? fixed.textContent : null,
    pillShown: !!pill && getComputedStyle(pill).display !== 'none',
  };
});
await card.locator('.api-model').fill('mU');
await card.locator('.api-model').dispatchEvent('change');
const cardU = await card.evaluate((c) => {
  const fixed = c.querySelector('.cfg-fixed');
  const pill = c.querySelector('.api-vision') ? c.querySelector('.api-vision').closest('.pill-select') : null;
  return { fixedShown: !!fixed && !fixed.hidden, pillShown: !!pill && getComputedStyle(pill).display !== 'none' };
});
check('10. fiche : libellé figé pour mV, pilule de retour pour mU',
  cardV.fixed === 'Lit les images' && cardV.pillShown === false && cardU.fixedShown === false && cardU.pillShown === true,
  JSON.stringify({ cardV, cardU }));

await card.locator('.api-model').fill('mV');
await card.locator('.api-model').dispatchEvent('change');
await card.locator('.api-save').click();
await page.waitForTimeout(300);
const vision11 = await page.evaluate(() => getApiServer('srvA').vision);
check('11. enregistrer la fiche sur mV garde son flag manuel intact',
  JSON.stringify(vision11) === '{"mV":false,"mU":false}', JSON.stringify(vision11));

// ── 13. niveau conservé (avant 12 : la console couvre aussi ce parcours) ─────
await page.evaluate(() => { closeApiServers(); pickComposerModel('mV', 'srvA'); setConvReasoningEffort('medium'); });
const convId = await page.evaluate(() => currentConvId);
const premise13 = await page.evaluate((id) => (loadConversation(id) || {}).reasoningEffort, convId);
await page.evaluate(() => pickComposerModel('mN', 'srvA'));
const afterSwitch = await page.evaluate((id) => ({
  stored: (loadConversation(id) || {}).reasoningEffort, hidden: $('composer-reasoning').hidden,
}), convId);
// Rechargement : la conversation rouvre sur mN (son modèle enregistré). C'est
// l'OUVERTURE qui effaçait le niveau dans la version fautive.
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });
await page.evaluate((id) => openConversation(id, true), convId);
await page.waitForFunction((id) => currentConvId === id, convId, { timeout: 5000 }).catch(() => {});
const afterReopen = await page.evaluate((id) => ({
  model: activeModel(), stored: (loadConversation(id) || {}).reasoningEffort,
}), convId);
await page.evaluate(() => pickComposerModel('mV', 'srvA'));
const back = await page.evaluate(() => ({
  effort: activeReasoningEffort(), label: $('composer-reasoning-label').textContent,
  shown: !$('composer-reasoning').hidden,
}));
check('13. niveau « medium » conservé : passage par mN, réouverture après rechargement, retour sur mV',
  premise13 === 'medium' && afterSwitch.stored === 'medium' && afterSwitch.hidden === true
    && afterReopen.model === 'mN' && afterReopen.stored === 'medium'
    && back.effort === 'medium' && back.label === 'medium' && back.shown === true,
  JSON.stringify({ premise13, afterSwitch, afterReopen, back }));

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
process.exit(fail ? 1 : 0);
