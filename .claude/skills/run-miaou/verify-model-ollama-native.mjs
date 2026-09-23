#!/usr/bin/env node
// Lot AF, étape 5 — chemin natif d'Ollama. Vérifie le câblage qu'aucun test
// QuickJS n'atteint : quand les lectures natives partent, combien, vers quelle
// racine, ce qu'elles écrivent, et ce qui en devient visible.
//
// Checklist :
//   1. aucune erreur console au chargement
//   2. chargement : /api/tags et /api/ps sur la racine SANS /v1, un seul
//      /api/show, pour le modèle actif (saisi sans étiquette), jamais pour les
//      autres modèles listés
//   3. /api/show persisté sous l'id LISTÉ (forme complète `:latest`) et fait
//      autorité sur /api/tags (outils/raisonnement que tags omet)
//   4. modèle froid au chargement : fenêtre = maximum déclaré par /api/show
//   5. après un échange : /api/ps relu, fenêtre servie « pendant cette session »
//      à l'inspecteur
//   6. second échange : aucune relecture de /api/ps (une par modèle et session)
//   7. changement de modèle : /api/show du nouveau modèle, vision déclarée
//   8. retour au premier modèle : pas de second /api/show (déjà lu)
//   9. glyphe de la fiche serveur : relit liste, /api/tags, /api/ps, /api/show
//  10. serveur au schéma Mistral (pas un Ollama) : /api/tags tenté, puis ni
//      /api/ps ni /api/show, pas même après un échange
//  11. aucune erreur console sur l'ensemble (hors 404 attendu du 10)
//
// VERIFY_DIST=<chemin> fait tourner le script sur un autre build : c'est ainsi
// qu'on vérifie qu'il passe au ROUGE sur le code d'avant l'étape.
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

// Journal de tous les appels aux deux backends stubés : `hôte chemin [modèle]`.
const calls = [];
const count = (prefix) => calls.filter(c => c.startsWith(prefix)).length;

// ── Ollama stubé ─────────────────────────────────────────────────────────────
// `llama3:latest` : tags le dit sans vision déclarée ni outils (GGUF
// sous-déclaré) ; show le déclare outils + raisonnement, sans vision, 131072.
// `gem:4b` : vision déclarée. Chaud (servi à 32768) seulement après un échange.
let chatCalls = 0;
const SHOW = {
  llama3: { capabilities: ['completion', 'tools', 'thinking'],
    model_info: { 'general.architecture': 'llama', 'llama.context_length': 131072 }, parameters: 'temperature 0.7' },
  'gem:4b': { capabilities: ['completion', 'vision'],
    model_info: { 'general.architecture': 'gemma3', 'gemma3.context_length': 32000 } },
};
await page.route('http://ollama.local/**', async (route) => {
  const req = route.request();
  const p = new URL(req.url()).pathname;
  const json = (o, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (p === '/v1/models') {
    calls.push('O /v1/models');
    return json({ object: 'list', data: [
      { id: 'llama3:latest', object: 'model' }, { id: 'gem:4b', object: 'model' }, { id: 'autre:1b', object: 'model' },
    ] });
  }
  if (p === '/api/tags') {
    calls.push('O /api/tags');
    return json({ models: [
      { name: 'llama3:latest', capabilities: ['completion'], details: { format: 'gguf' } },
      { name: 'gem:4b', capabilities: ['completion', 'vision'], details: {} },
      { name: 'autre:1b', capabilities: ['completion'], details: {} },
    ] });
  }
  if (p === '/api/ps') {
    calls.push('O /api/ps');
    return json({ models: chatCalls ? [{ name: 'llama3:latest', context_length: 32768 }] : [] });
  }
  if (p === '/api/show') {
    const m = JSON.parse(req.postData() || '{}').model;
    calls.push('O /api/show ' + m);
    return SHOW[m] ? json(SHOW[m]) : json({ error: 'not found' }, 404);
  }
  if (p === '/v1/chat/completions') return chat(route, 'O');
  return json({ error: 'stub: ' + p }, 404);
});

// ── Backend au schéma Mistral (pas un Ollama) ────────────────────────────────
await page.route('http://mistral.local/**', async (route) => {
  const p = new URL(route.request().url()).pathname;
  const json = (o, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(o) });
  calls.push('M ' + p);
  if (p === '/v1/models') {
    return json({ object: 'list', data: [{ id: 'mistral-medium', object: 'model', max_context_length: 262144,
      capabilities: { completion_chat: true, function_calling: true, vision: true, reasoning: false } }] });
  }
  if (p === '/v1/chat/completions') return chat(route, 'M');
  return json({ error: { message: '404: {"detail":"Not Found"}' } }, 404);
});

async function chat(route, host) {
  const body = JSON.parse(route.request().postData() || '{}');
  if (body.stream) chatCalls++;   // chaud après un échange, pas après un appel silencieux du démarrage
  calls.push(host + (body.stream ? " chat " : " silent ") + body.model);
  if (body.stream) {
    const chunks = [
      { choices: [{ delta: { content: 'Réponse de test suffisamment longue.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ];
    return route.fulfill({ status: 200, contentType: 'text/event-stream',
      body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n' });
  }
  return route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' }, finish_reason: 'stop' }] }) });
}

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('miaou-api-servers', JSON.stringify([
    { id: 'srvO', name: 'Ollama', url: 'http://ollama.local/v1', key: 'x', model: 'llama3' },
    { id: 'srvM', name: 'Mistral', url: 'http://mistral.local/v1', key: 'x', model: 'mistral-medium' },
  ]));
  localStorage.setItem('miaou-active-api-server', 'srvO');
});
consoleErrors.length = 0;
calls.length = 0;
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail: detail || '' }); };
const safe = (fn, arg, dflt) => page.evaluate(fn, arg).catch(() => dflt);
const settle = async (pred, ms) => { for (let i = 0; i < (ms || 3000) / 50 && !pred(); i++) await page.waitForTimeout(50); };
const winInfo = (m) => safe((mm) => contextWindowInfo(mm), m, { value: null, source: '(absent)' });
let chatSeen = 0;
const send = async (text) => {
  const before = calls.filter(c => c.includes(' chat ')).length;
  await page.evaluate((t) => sendUserText(t), text);
  await settle(() => calls.filter(c => c.includes(' chat ')).length > before, 5000);
  await page.waitForFunction(() => !sending, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);   // titrage/résumé silencieux et lecture /api/ps qui suit
  chatSeen = calls.filter(c => c.includes(' chat ')).length;
};

// ── 1 ────────────────────────────────────────────────────────────────────────
check('1. aucune erreur console au chargement', consoleErrors.length === 0, consoleErrors.join(' | '));

// ── 2 ────────────────────────────────────────────────────────────────────────
await settle(() => count('O /api/show') > 0);
await page.waitForTimeout(300);
const c2 = { tags: count('O /api/tags'), ps: count('O /api/ps'), show: calls.filter(c => c.startsWith('O /api/show')) };
check('2. chargement : tags + ps sur la racine native, un seul show pour le modèle actif',
  c2.tags === 1 && c2.ps === 1 && JSON.stringify(c2.show) === '["O /api/show llama3"]', JSON.stringify(c2));

// ── 3 ────────────────────────────────────────────────────────────────────────
const rec3 = await safe(() => {
  const m = JSON.parse(localStorage.getItem('miaou-model-props') || '{}');
  return m.srvO && m.srvO.models && m.srvO.models['llama3:latest'];
}, null, null);
check('3. show persisté sous llama3:latest, fait autorité (outils et raisonnement vrais, vision fausse)',
  !!rec3 && rec3.caps.tools === true && rec3.caps.thinking === true && rec3.caps.vision === false
    && rec3.contextMax === 131072 && rec3.contextSource === 'show:llama.context_length',
  JSON.stringify(rec3));

// ── 4 ────────────────────────────────────────────────────────────────────────
const w4 = await winInfo('llama3');
check('4. modèle froid : fenêtre = maximum déclaré 131072', w4.value === 131072 && w4.source === 'declared', JSON.stringify(w4));

// ── 5 ────────────────────────────────────────────────────────────────────────
await send('Premier message');
await settle(() => count('O /api/ps') >= 2);
await page.waitForTimeout(200);
const w5 = await winInfo('llama3');
await safe(() => openContextInspector(), null, null);
const line5 = await safe(() => { const el = $('ctx-window-hint'); return el ? el.textContent : '(absent)'; }, null, '(absent)');
await safe(() => closeContextInspector(), null, null);
check('5. après un échange : /api/ps relu, 32768 servie cette session, dite à l\'inspecteur',
  count('O /api/ps') === 2 && w5.value === 32768 && w5.source === 'served-now'
    && line5.replace(/\s/g, '').includes('32768') && line5.includes('pendant cette session'),
  JSON.stringify({ ps: count('O /api/ps'), w5, line5 }));

// ── 6 ────────────────────────────────────────────────────────────────────────
await send('Second message');
check('6. second échange : pas de nouvelle lecture /api/ps', count('O /api/ps') === 2 && chatSeen >= 2,
  JSON.stringify({ ps: count('O /api/ps'), chats: chatSeen }));

// ── 7 ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => setConvModel('gem:4b'));
await settle(() => count('O /api/show gem:4b') > 0);
await page.waitForTimeout(200);
const vis7 = await safe(() => modelVisionState(activeApiServer(), 'gem:4b'), null, null);
check('7. changement de modèle : show de gem:4b, vision déclarée',
  count('O /api/show gem:4b') === 1 && !!vis7 && vis7.enabled === true && vis7.source === 'declared',
  JSON.stringify({ calls: calls.filter(c => c.includes('show')), vis7 }));

// ── 8 ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => setConvModel('llama3'));
await page.waitForTimeout(500);
check('8. retour à llama3 : pas de second show', count('O /api/show llama3') === 1,
  JSON.stringify(calls.filter(c => c.includes('show'))));

// ── 9 ────────────────────────────────────────────────────────────────────────
const before9 = { models: count('O /v1/models'), tags: count('O /api/tags'), ps: count('O /api/ps'), show: count('O /api/show llama3') };
await page.evaluate(() => openApiServers());
const glyph = page.locator('#api-list .api-card').first().locator('.api-refresh');
const hasGlyph = await glyph.count() === 1;
if (hasGlyph) await glyph.click();
await settle(() => count('O /api/show llama3') > before9.show);
await page.waitForTimeout(300);
const after9 = { models: count('O /v1/models'), tags: count('O /api/tags'), ps: count('O /api/ps'), show: count('O /api/show llama3') };
check('9. glyphe de la fiche : liste, tags, ps et show relus une fois chacun',
  hasGlyph && after9.models === before9.models + 1 && after9.tags === before9.tags + 1
    && after9.ps === before9.ps + 1 && after9.show === before9.show + 1,
  JSON.stringify({ hasGlyph, before9, after9 }));
await page.evaluate(() => closeApiServers());

// ── 10 ───────────────────────────────────────────────────────────────────────
await page.evaluate(() => onUseApiServer('srvM'));
await settle(() => count('M /api/tags') > 0);
await send('Message au backend Mistral');
const m10 = calls.filter(c => c.startsWith('M '));
check('10. serveur non-Ollama : tags tenté, ni ps ni show, même après un échange',
  count('M /api/tags') === 1 && count('M /api/ps') === 0 && count('M /api/show') === 0 && count('M chat') >= 1,
  JSON.stringify(m10));

// ── 11 ───────────────────────────────────────────────────────────────────────
const errs = consoleErrors.filter(e => !/Failed to load resource.*404/.test(e));
check('11. aucune erreur console sur l\'ensemble (hors 404 attendu)', errs.length === 0, errs.join(' | '));

await browser.close();
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail));
}
console.log(fail ? `\n${fail} échec(s)` : '\nTout est vert.');
process.exit(fail ? 1 : 0);
