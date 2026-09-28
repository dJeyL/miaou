#!/usr/bin/env node
// Collecte des statistiques de consommation de tokens (lot AJ, étape 1) :
// l'accroche RÉELLE aux deux points réseau, que les tests QuickJS ne peuvent pas
// voir (ni IDB ni fetch). Cf. docs/usage-stats.md.
//
// Ce que ce script exerce, contre un chat et des appels silencieux stubés :
//   1. Un échange à un tour d'outils = DEUX appels `chat` comptés, usages
//      sommés (cache compris), à l'inverse de l'inspecteur qui ne garde que le
//      dernier tour.
//   2. Chaque appel silencieux est rangé sous SA nature : le stub classe chaque
//      requête non streamée d'après son prompt système (constantes vivantes de
//      l'appli, lues par leur nom nu), et le nombre de requêtes servies par
//      nature doit égaler `calls` en base. Un appelant qui perd son `purpose`
//      fait passer ses appels sous `other` : rouge.
//   3. Stop AVANT la réponse (flux qui ne rend jamais ses en-têtes) = un appel
//      compté, non mesuré.
//   4. Refus HTTP (503) = rien compté. Flux 2xx coupé par une erreur réseau
//      (pas un abort) = compté, non mesuré. Réponse silencieuse dont
//      l'extraction lève après un 2xx = compté UNE fois (revue du 2026-09-29 :
//      l'enregistrement précédait l'extraction, le `catch` recomptait).
//   5. Serveur crédité = celui actif AU DÉBUT de l'appel : on bascule le serveur
//      actif pendant qu'un flux est retenu, la consommation reste au premier.
//   6. Sauvegarde complète (étape 2) : le zip RÉEL du bouton porte les records
//      sous idb.usageStats ; le réimporter REMPLACE la base (un record ajouté
//      après l'export disparaît) ; une sauvegarde sans section vide les
//      statistiques ; le rapport de stockage a sa ligne.
//
// Usage : node verify-usage-stats-collect.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(path.resolve(__dirname, '../../..'), 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  if (!cond) failures.push(label);
};

const initScript = () => {
  if (localStorage.getItem('__aj_seeded') === null) {
    localStorage.setItem('__aj_seeded', '1');
    // Deux serveurs à la MÊME URL (le stub répond pour les deux) : seul l'id
    // les distingue, c'est lui que la bascule du scénario 5 doit préserver.
    localStorage.setItem('miaou-api-servers', JSON.stringify([
      { id: 'srv-stub', name: 'Stub', url: 'http://stub.local/v1', key: 'k', model: 'stub-model' },
      { id: 'srv-other', name: 'Autre', url: 'http://stub.local/v1', key: 'k', model: 'stub-model' },
    ]));
    localStorage.setItem('miaou-active-api-server', 'srv-stub');
    localStorage.setItem('miaou-settings', JSON.stringify({ summaryInjectionMode: 'never' }));
  }

  // Compteurs de ce que le stub a SERVI (2xx) : la référence à laquelle la base
  // est comparée. Un stub jamais sollicité rendrait la checklist creuse.
  window.__served = { stream: 0, silent: {} };
  window.__hold = false;          // retient le prochain flux « BASCULE »
  window.__streamPending = false;

  const enc = new TextEncoder();
  const sseResponse = (chunks) => new Response(new ReadableStream({
    start(c) {
      for (const o of chunks) c.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));
      c.enqueue(enc.encode('data: [DONE]\n\n'));
      c.close();
    },
  }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  const lastUser = (msgs) => {
    const u = (msgs || []).filter(m => m.role === 'user').pop();
    return u ? (typeof u.content === 'string' ? u.content : JSON.stringify(u.content)) : '';
  };
  const classify = (sys) => {
    try {
      if (sys === EARLY_TITLE_PROMPT) return 'early-title';
      if (sys === TITLE_PROMPT) return 'title';
      if (sys === SUMMARY_PROMPT) return 'summary';
      if (sys === DID_YOU_KNOW_PROMPT) return 'did-you-know';
    } catch (e) { /* constantes pas encore chargées : impossible à ce stade */ }
    return 'unclassified';
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('http://stub.local/') !== 0) return realFetch(input, opts);
    if (/\/api\/(tags|ps|show)$/.test(url)) return new Response('{}', { status: 404 });
    if (/\/v1\/models$/.test(url)) {
      return new Response(JSON.stringify({ data: [{ id: 'stub-model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    let body = {};
    try { body = JSON.parse(opts.body); } catch (e) {}

    if (!body.stream) {
      // Phase d'import (section 6) : le boot qui suit chaque import relance des
      // appels silencieux (astuce, résumés de rattrapage) qui s'ajouteraient
      // légitimement à la base. Refusés ici (non-2xx = jamais comptés), pour
      // que la base après import ne reflète que ce que l'import a écrit.
      // Drapeau en localStorage : il doit survivre aux rechargements.
      if (localStorage.getItem('__aj_refuse_silent') === '1') {
        return new Response('{"error":"phase import"}', { status: 503 });
      }
      if (body.messages && body.messages[0] && body.messages[0].content === 'SONDE-TABLEAU') {
        // `content` en tableau de parts : `.trim()` lève dans silentCompletion.
        window.__served.probe = (window.__served.probe || 0) + 1;
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: [{ type: 'text', text: 'x' }] }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 3, completion_tokens: 1 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const kind = classify(body.messages && body.messages[0] && body.messages[0].content);
      window.__served.silent[kind] = (window.__served.silent[kind] || 0) + 1;
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'Titre factice' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 5 },   // sans cache : cachedKnownCalls reste 0
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const text = lastUser(body.messages);
    if (/REFUS/.test(text)) {
      return new Response('{"error":"indisponible"}', { status: 503 });
    }
    if (/COUPURE/.test(text)) {
      // 200, un fragment, puis la connexion tombe : `reader.read()` rejette
      // avec une erreur qui n'est PAS un AbortError.
      window.__served.stream++;
      return new Response(new ReadableStream({
        start(c) {
          c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Début…' } }] }) + '\n\n'));
          setTimeout(() => c.error(new TypeError('network error')), 50);
        },
      }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    if (/STOPAVANT/.test(text)) {
      // Jamais d'en-têtes : seul l'abort termine la requête.
      window.__streamPending = true;
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (/BASCULE/.test(text)) {
      window.__streamPending = true;
      while (window.__hold) await new Promise(r => setTimeout(r, 20));
      window.__served.stream++;
      return sseResponse([
        { choices: [{ delta: { content: 'Après bascule.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
        { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } } },
      ]);
    }
    // Échange outillé : premier tour → tool_call, second (un message `tool`
    // présent) → réponse. Aiguillage sur le CONTENU, jamais sur un compteur.
    window.__served.stream++;
    if (!(body.messages || []).some(m => m.role === 'tool')) {
      return sseResponse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'conv__list', arguments: '{}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 600 } } },
      ]);
    }
    return sseResponse([
      { choices: [{ delta: { content: 'Voilà la liste des conversations demandée.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 1100, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1000 } } },
    ]);
  };
};

const browser = await launchIsolated({ headless: !headed }, { serve: false, native: false });
const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
await context.addInitScript(initScript);
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });

const send = async (text) => {
  await page.fill('#composer-text', text);
  await page.press('#composer-text', 'Enter');
};
const newConv = async () => { await page.evaluate(() => resetToEmpty()); await page.waitForTimeout(150); };
const idle = () => page.waitForFunction(() => _activeGenerations.size === 0, null, { timeout: 15000 });
const stats = () => page.evaluate(() => readAllUsageStats());
const find = (rows, f) => rows.filter(r => Object.keys(f).every(k => r[k] === f[k]));
const sum = (rows, field) => rows.reduce((a, r) => a + r[field], 0);
// Les écritures ne sont pas attendues par l'appli : on relit jusqu'à ce que la
// base ait rattrapé ce que le stub a servi (ou délai écoulé → les checks disent
// ce qui manque).
const settle = async (pred) => {
  for (let i = 0; i < 50; i++) {
    const rows = await stats();
    if (pred(rows)) return rows;
    await page.waitForTimeout(100);
  }
  return stats();
};

const today = await page.evaluate(() => localDayKey(Date.now()));

// ── 1. Échange à un tour d'outils ──────────────────────────────────────────
console.log('\n— 1. Un tour d\'outils = deux appels chat, usages sommés');
await send('Liste mes conversations, avec un outil.');
await idle();
let rows = await settle(r => sum(find(r, { purpose: 'chat' }), 'calls') >= 2);
let chat = find(rows, { purpose: 'chat', serverId: 'srv-stub' });
check('prémisse : le stub a servi deux tours streamés', await page.evaluate(() => window.__served.stream) === 2);
check('un seul record chat (jour, serveur, modèle, nature)', chat.length === 1, chat.length);
const c = chat[0] || {};
check('clef : jour local, serveur capturé, modèle', c.day === today && c.model === 'stub-model' && c.serverName === 'Stub',
  { day: c.day, model: c.model, serverName: c.serverName });
check('deux appels, tous deux mesurés', c.calls === 2 && c.unmeasured === 0, { calls: c.calls, unmeasured: c.unmeasured });
check('entrée, cache et sortie sommés sur les DEUX tours', c.inTokens === 2100 && c.cachedTokens === 1600 && c.outTokens === 50,
  { in: c.inTokens, cached: c.cachedTokens, out: c.outTokens });
check('cache connu sur les deux appels', c.cachedKnownCalls === 2, c.cachedKnownCalls);

// ── 3. Stop avant la réponse ────────────────────────────────────────────────
console.log('\n— 3. Stop avant les en-têtes = appel compté, non mesuré');
await newConv();
await send('STOPAVANT, réponds lentement.');
await page.waitForFunction(() => window.__streamPending === true, null, { timeout: 8000 });
await page.evaluate(() => onSendBtn());   // Stop
await idle();
rows = await settle(r => sum(find(r, { purpose: 'chat', serverId: 'srv-stub' }), 'calls') >= 3);
chat = find(rows, { purpose: 'chat', serverId: 'srv-stub' })[0] || {};
check('un troisième appel chat compté', chat.calls === 3, chat.calls);
check('… non mesuré, sans token ajouté', chat.unmeasured === 1 && chat.inTokens === 2100 && chat.outTokens === 50,
  { unmeasured: chat.unmeasured, in: chat.inTokens, out: chat.outTokens });
check('cache connu inchangé (un appel non mesuré n\'est pas « cache connu »)', chat.cachedKnownCalls === 2, chat.cachedKnownCalls);

// ── 4. Refus HTTP ──────────────────────────────────────────────────────────
console.log('\n— 4. Refus HTTP = rien compté');
await newConv();
await send('REFUS attendu.');
await idle();
await page.waitForTimeout(400);
rows = await stats();
chat = find(rows, { purpose: 'chat', serverId: 'srv-stub' })[0] || {};
check('toujours trois appels chat (le 503 ne compte pas)', chat.calls === 3, chat.calls);

await newConv();
await send('COUPURE en plein flux.');
await idle();
rows = await settle(r => sum(find(r, { purpose: 'chat', serverId: 'srv-stub' }), 'calls') >= 4);
chat = find(rows, { purpose: 'chat', serverId: 'srv-stub' })[0] || {};
check('flux 2xx coupé par une erreur réseau : compté, non mesuré', chat.calls === 4 && chat.unmeasured === 2,
  { calls: chat.calls, unmeasured: chat.unmeasured });

await page.evaluate(() => silentCompletion([{ role: 'system', content: 'SONDE-TABLEAU' }], { purpose: 'probe', timeout: 5000 }).catch(() => null));
rows = await settle(r => find(r, { purpose: 'probe' }).length > 0);
const probe = find(rows, { purpose: 'probe' })[0] || {};
check('prémisse : la sonde a été servie une fois', await page.evaluate(() => window.__served.probe) === 1);
check('réponse silencieuse dont l\'extraction lève : UN appel, pas deux', probe.calls === 1, probe);

// ── 5. Bascule de serveur pendant l'appel ───────────────────────────────────
console.log('\n— 5. Serveur crédité = serveur actif au DÉBUT de l\'appel');
await newConv();
await page.evaluate(() => { window.__hold = true; window.__streamPending = false; });
await send('BASCULE de serveur en cours de route.');
await page.waitForFunction(() => window.__streamPending === true, null, { timeout: 8000 });
await page.evaluate(() => setActiveApiServerId('srv-other'));
check('prémisse : le serveur actif a bien changé pendant l\'appel', await page.evaluate(() => activeApiServer().id) === 'srv-other');
await page.evaluate(() => { window.__hold = false; });
await idle();
rows = await settle(r => sum(find(r, { purpose: 'chat', serverId: 'srv-stub' }), 'calls') >= 5);
chat = find(rows, { purpose: 'chat', serverId: 'srv-stub' })[0] || {};
check('l\'appel est crédité au serveur du début (srv-stub)', chat.calls === 5 && chat.inTokens === 2107, { calls: chat.calls, in: chat.inTokens });
check('aucun appel chat crédité au serveur de fin', find(rows, { purpose: 'chat', serverId: 'srv-other' }).length === 0);
check('cache à 0 mesuré : compte comme cache connu', chat.cachedKnownCalls === 3, chat.cachedKnownCalls);

// ── 2. Natures des appels silencieux ───────────────────────────────────────
console.log('\n— 2. Chaque appel silencieux sous SA nature');
await page.waitForTimeout(1500);   // laisse finir les titrages de fin d'échange
const served = await page.evaluate(() => window.__served.silent);
rows = await settle(r => Object.entries(served).every(([k, n]) => sum(find(r, { purpose: k }), 'calls') === n));
console.log('        servi par nature : ' + JSON.stringify(served));
check('prémisse : titrage précoce ET titrage de fin servis', (served['early-title'] || 0) >= 1 && (served['title'] || 0) >= 1, served);
check('aucune requête silencieuse inclassable par le stub', !served.unclassified, served.unclassified);
for (const [kind, n] of Object.entries(served)) {
  const got = sum(find(rows, { purpose: kind }), 'calls');
  check('nature « ' + kind + ' » : ' + n + ' servie(s) = ' + got + ' comptée(s)', got === n);
  const r = find(rows, { purpose: kind });
  check('nature « ' + kind + ' » : 100 tokens d\'entrée par appel, cache inconnu',
    sum(r, 'inTokens') === 100 * n && sum(r, 'cachedKnownCalls') === 0 && sum(r, 'unmeasured') === 0);
}
check('aucun appel rangé sous « other » (nature oubliée)', find(rows, { purpose: 'other' }).length === 0,
  find(rows, { purpose: 'other' }));

// ── 6. Export, import, rapport de stockage ─────────────────────────────────
console.log('\n— 6. Sauvegarde complète : export, import en remplacement, rapport');
await page.evaluate(() => localStorage.setItem('__aj_refuse_silent', '1'));
await page.waitForTimeout(500);   // laisse retomber un appel silencieux déjà en vol
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aj-usage-'));
const before = (await stats()).map(r => JSON.stringify(r)).sort();
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.evaluate(() => exportAllData()),
]);
const zipFile = path.join(tmpDir, 'export.zip');
await download.saveAs(zipFile);
const manifest = await page.evaluate(async (arr) => {
  const ff = await ensureFflate();
  const files = ff.unzipSync(new Uint8Array(arr));
  return JSON.parse(new TextDecoder('utf-8').decode(files['manifest.json']));
}, Array.from(fs.readFileSync(zipFile)));
const exported = (manifest.idb.usageStats || []).map(r => JSON.stringify(r)).sort();
check('prémisse : la base porte des statistiques à exporter', before.length >= 4, before.length);
check('le zip réel porte idb.usageStats, identique à la base', JSON.stringify(exported) === JSON.stringify(before),
  { exported: exported.length, base: before.length });

// Un record posé APRÈS l'export : le remplacement intégral doit le faire
// disparaître (sans lui, un import qui ne viderait pas le store passerait).
await page.evaluate(() => recordModelUsage({ day: '2000-01-01', serverId: 'srv-stub', model: 'x', purpose: 'chat' },
  usageStatsDelta(null), 'Stub'));
check('prémisse : le record intrus est en base avant import',
  (await stats()).some(r => r.day === '2000-01-01'));

const importFile = async (file) => {
  await page.evaluate(() => { openSettings(); resetImportDataUI(); });
  await page.setInputFiles('#import-data-input', file);
  await page.waitForSelector('#import-data-summary:not([hidden]) button', { timeout: 8000 });
  const btn = await page.$('#import-data-summary button');
  await btn.click();                // 1er clic : arme
  await page.waitForTimeout(150);
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
    btn.click(),                    // 2e clic : applique puis recharge
  ]);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });
};
await importFile(zipFile);
const after = (await stats()).map(r => JSON.stringify(r)).sort();
check('import du zip : la base redevient exactement celle de l\'export (intrus retiré)',
  JSON.stringify(after) === JSON.stringify(before), { after: after.length, before: before.length });

// Sauvegarde sans section (antérieure aux statistiques) : remplacement vers rien.
const legacy = JSON.parse(JSON.stringify(manifest));
delete legacy.idb.usageStats;
const legacyFile = path.join(tmpDir, 'sans-stats.json');
fs.writeFileSync(legacyFile, JSON.stringify(legacy));
await importFile(legacyFile);
check('import d\'une sauvegarde sans statistiques : la base est vidée', (await stats()).length === 0);

await page.evaluate(() => openSettings());
await page.locator('.set-cat-head:has-text("Données")').click();
await page.waitForFunction(() => (document.getElementById('storage-report-detail') || {}).textContent
  && document.getElementById('storage-report-detail').textContent.length > 0, null, { timeout: 8000 });
check('rapport de stockage : ligne « Statistiques d\'usage »',
  await page.evaluate(() => document.getElementById('storage-report-detail').textContent.includes('Statistiques d\'usage')));
fs.rmSync(tmpDir, { recursive: true, force: true });

const unexpected = errors.filter(e => !/503|indisponible|phase import|Failed to load resource/.test(e));
check('aucune erreur console hors le 503 provoqué', unexpected.length === 0, unexpected);

await browser.close();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est vert');
process.exit(failures.length ? 1 : 0);
