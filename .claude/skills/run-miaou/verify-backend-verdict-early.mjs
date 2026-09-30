#!/usr/bin/env node
// Vérif e2e — verdict de santé du backend API : posé TÔT, et sur le BON serveur.
//
// Trois défauts corrigés, un bloc chacun :
//   1. le « rétabli » n'arrivait qu'en fin d'échange (onFinal/onHalt), après la
//      réponse complète, tours d'outils compris — alors que le premier chunk
//      streamé prouvait déjà que le serveur répond. Il tombe désormais au
//      premier chunk SSE valide (streamCompletion) ;
//   2. un résumé ou un titre obtenu (silentCompletion) ne posait aucun verdict ;
//   3. le verdict, global, jugeait le serveur ACTIF au moment de l'écriture :
//      un échange lancé sur A et fini après une bascule vers B absolvait B.
//
// Conditions dont dépendent les assertions (cf. SKILL.md) :
//   - Le chat est servi en FLUX RÉEL (ReadableStream), avec une porte après le
//     premier chunk (bloc 1) ou avant lui (bloc 3). Un corps SSE livré d'un bloc
//     ne laisserait aucun instant « streamé mais pas fini » à observer, et le
//     bloc 1 passerait sur l'ancien code.
//   - Les appels NON streamés (titrage précoce, résumés) répondent 500 pendant
//     les blocs 1 et 3 : le titrage précoce part dès l'envoi, et son succès
//     poserait « joignable » avant le premier chunk (bloc 1 creux) ou sur B
//     après la bascule (bloc 3 faussement rouge). Un 500 de silentCompletion ne
//     pose aucun verdict, donc ne pollue rien.
//   - L'état SALE (verdict « injoignable ») est posé et vérifié avant chaque
//     retour attendu au vert : une remise à ok ne se teste que sur un rouge.
//   - Deux serveurs, A (stub.local) et B (stub-b.local), tous deux servis par le
//     stub de ce script (`serve: false`, `server: false`, `native: false`).
//
// Usage : node verify-backend-verdict-early.mjs [--headed]
//   Prérequis : `python3 build.py` fait.
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.MIAOU_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
function check(label, cond, detail) {
  if (cond) { console.log('  PASS  ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { console.log('  FAIL  ' + label + (detail ? '  (' + detail + ')' : '')); failures.push(label); }
}

// ── Stub : deux serveurs, chat en flux réel avec portes ──────────────────────
function installStub() {
  if (localStorage.getItem('miaou-api-servers') === null) {
    localStorage.setItem('miaou-api-servers', JSON.stringify([
      { id: 'srv-a', name: 'Alpha', url: 'http://stub.local/v1', key: 'k', model: 'stub-model' },
      { id: 'srv-b', name: 'Bravo', url: 'http://stub-b.local/v1', key: 'k', model: 'stub-model' },
    ]));
    localStorage.setItem('miaou-active-api-server', 'srv-a');
  }
  const S = window.__stub = {
    streams: 0, firstSent: 0, silent: 0, models: 0,
    silentFail: false,
    holdBefore: false, holdAfter: false,   // portes, relâchées par __stub.release()
    _waiters: [],
    release() { S.holdBefore = false; S.holdAfter = false; S._waiters.splice(0).forEach(f => f()); },
  };
  const wait = (flag) => new Promise((resolve) => {
    if (!S[flag]) return resolve();
    S._waiters.push(resolve);
  });
  const realFetch = window.fetch.bind(window);
  const json = (body, status) => new Response(JSON.stringify(body),
    { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  const sse = (obj) => new TextEncoder().encode('data: ' + JSON.stringify(obj) + '\n\n');
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/^http:\/\/stub(-b)?\.local\//.test(url)) return realFetch(input, opts);
    if (/\/api\/(tags|ps|show)$/.test(url)) return json({ error: 'not found' }, 404);
    if (/\/v1\/models$/.test(url)) {
      S.models++;
      return json({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] });
    }
    if (/\/chat\/completions$/.test(url)) {
      let body = {};
      try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) { /* illisible */ }
      if (!body.stream) {
        S.silent++;
        if (S.silentFail) return json({ error: 'boom' }, 500);
        return json({ choices: [{ message: { role: 'assistant', content: 'Titre factice' }, finish_reason: 'stop' }] });
      }
      S.streams++;
      const stream = new ReadableStream({
        async start(ctrl) {
          await wait('holdBefore');
          ctrl.enqueue(sse({ choices: [{ delta: { reasoning_content: 'Je réfléchis.' } }] }));
          S.firstSent++;
          await wait('holdAfter');
          ctrl.enqueue(sse({ choices: [{ delta: { content: 'Réponse complète du serveur factice.' } }] }));
          ctrl.enqueue(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
          ctrl.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          ctrl.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return json({ error: 'not found' }, 404);
  };
}

const probe = () => (_backendProbe ? _backendProbe.ok : null);
const toastTexts = () => [...document.querySelectorAll('#toasts .toast-text')].map(e => e.textContent);

async function send(page, text) {
  await page.fill('#composer-text', text);
  await page.evaluate(() => sendMessage());
}

const browser = await launchIsolated({ headless: !headed }, { serve: false, server: false, native: false });
const page = await browser.newPage();
await page.addInitScript(installStub);
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error] ' + m.text()); });

let exitCode = 0;
try {
  await page.goto('file://' + distPath);
  await page.waitForSelector('#composer-text');
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });

  const boot = await page.evaluate(() => ({ active: activeApiServer().id, models: window.__stub.models }));
  check('prémisse : serveur actif = Alpha au démarrage', boot.active === 'srv-a', boot.active);
  check('témoin : le stub a servi /models au démarrage', boot.models > 0, boot.models + ' appel(s)');

  // ── 1. « Rétabli » au premier chunk, pendant que la réponse est retenue ──────
  await page.evaluate(() => { window.__stub.silentFail = true; noteBackendProbe(false); });
  check('état sale : verdict « injoignable » posé', (await page.evaluate(probe)) === false);
  await page.evaluate(() => { window.__stub.holdAfter = true; });
  await send(page, 'Bonjour bloc un');
  await page.waitForFunction(() => window.__stub.firstSent >= 1, null, { timeout: 10000 });
  const ok1 = await page.waitForFunction(() => _backendProbe && _backendProbe.ok === true, null, { timeout: 3000 })
    .then(() => true, () => false);
  const mid = await page.evaluate(() => ({ gen: isGenerating(currentConvId), toasts: [...document.querySelectorAll('#toasts .toast-text')].map(e => e.textContent) }));
  check('témoin : la génération est toujours en vol (réponse retenue)', mid.gen === true, String(mid.gen));
  check('verdict « joignable » posé dès le premier chunk, avant la fin', ok1);
  check('toast « rétabli » affiché pendant le flux',
    mid.toasts.some(t => /Alpha.*rétabli/.test(t)), JSON.stringify(mid.toasts));
  await page.evaluate(() => window.__stub.release());
  await page.waitForFunction(() => !isGenerating(currentConvId), null, { timeout: 10000 });

  // ── 2. silentCompletion réussi : verdict « joignable » ──────────────────────
  await page.evaluate(() => { window.__stub.silentFail = false; noteBackendProbe(false); });
  check('état sale : verdict « injoignable » posé', (await page.evaluate(probe)) === false);
  const silentBefore = await page.evaluate(() => window.__stub.silent);
  await page.evaluate(() => silentCompletion([{ role: 'user', content: 'Titre ?' }]));
  const s2 = await page.evaluate(() => ({ ok: _backendProbe.ok, silent: window.__stub.silent }));
  check('témoin : silentCompletion a sollicité le stub', s2.silent > silentBefore, (s2.silent - silentBefore) + ' appel(s)');
  check('un silentCompletion réussi pose « joignable »', s2.ok === true, String(s2.ok));

  // Échec d'un silentCompletion : AUCUN verdict (un timeout de fond n'est pas une panne).
  await page.evaluate(() => { window.__stub.silentFail = true; });
  await page.evaluate(() => silentCompletion([{ role: 'user', content: 'x' }]).catch(() => null));
  check('un silentCompletion en échec ne pose pas « injoignable »', (await page.evaluate(probe)) === true);

  // ── 3. Bascule de serveur pendant l'échange : le verdict de A épargne B ─────
  await page.evaluate(() => { window.__stub.holdBefore = true; });
  const streamsBefore = await page.evaluate(() => window.__stub.streams);
  await send(page, 'Bonjour bloc trois');
  await page.waitForFunction((n) => window.__stub.streams > n, streamsBefore, { timeout: 10000 });
  await page.evaluate(() => { setActiveApiServerId('srv-b'); noteBackendProbe(false); });
  const s3a = await page.evaluate(() => ({ active: activeApiServer().id, ok: _backendProbe.ok }));
  check('prémisse : Bravo est actif et jugé injoignable', s3a.active === 'srv-b' && s3a.ok === false, JSON.stringify(s3a));
  await page.evaluate(() => window.__stub.release());
  await page.waitForFunction(() => !isGenerating(currentConvId), null, { timeout: 10000 });
  const s3b = await page.evaluate(() => ({ ok: _backendProbe.ok, first: window.__stub.firstSent,
    last: (currentThread[currentThread.length - 1] || {}).content }));
  check('témoin : l\'échange sur Alpha a bien streamé et abouti',
    s3b.first >= 2 && /Réponse complète/.test(s3b.last || ''), JSON.stringify(s3b));
  check('les verdicts d\'Alpha (premier chunk ET fin d\'échange) ne blanchissent pas Bravo',
    s3b.ok === false, String(s3b.ok));
} catch (e) {
  console.log('  ERREUR  ' + (e && e.stack || e));
  exitCode = 2;
} finally {
  await browser.close();
}

if (failures.length) { console.log('\n' + failures.length + ' échec(s)'); process.exit(1); }
console.log(exitCode ? '\nInterrompu' : '\nOK — tout est passé');
process.exit(exitCode);
