#!/usr/bin/env node
// Vérif e2e du lot M (MIAOU) : docs__extract transfère le texte intégral d'un
// membre de zip (JSON) sans jamais le faire transiter par le contexte modèle,
// matérialisé côté client en res_… de classe 'inline', exploitable par js__eval.
//
// Chemin réellement exercé (MCP RÉEL, modèle STUBÉ) :
//   1. Le proxy miaou-mcp-servers (déjà lancé par Julien, port 8765) est réutilisé
//      tel quel — PAS de spawn ici (contrairement au script K qui isole sur 8799).
//   2. Un .zip oracle (untracked/test-files/test-extract.zip, membre data.json —
//      50 objets {id,name,value}, somme des value = 8925) est attaché en pièce
//      jointe réelle via #attach-file-input → att-N classifié 'binary'
//      (formatBinaryAttachmentDescriptor, docs/mcp.md point 12 "déclencheur").
//   Tour 1 : le stub émet p__docs__extract(ref=att-N, path=data.json) →
//     callDocsInflatedRemoteTool détecte le contrat ref+content_b64 déclaré par
//     l'outil, inline content_b64 au 1er appel (att pas encore poussé) → le
//     proxy matérialise le zip, extrait data.json en entier, renvoie
//     [descripteur text, resource.blob(mimeType text/plain)] → extractResultParts
//     route via _isTextualMime en store_inline_from_bytes (M1a) →
//     internResourcesFromResult stocke en classe 'inline' via le tail de
//     store_binary — handle seul au modèle, jamais le texte (M1b).
//   Tour 2 : le script lit le res_… matérialisé, l'injecte comme handle de
//     js__eval(handle, code) avec un code qui parse() et somme les .value →
//     vérifie que le calcul retombe sur 8925 (preuve que le texte complet du
//     membre a bien traversé le canal binaire jusqu'à l'IDB, décodable par
//     utf8Decode sans branche par classe).
//
// Checklist (mémoire projet no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - res_… matérialisé en IDB, class 'inline', mime textuel (text/plain ou JSON)
//   - aucun contenu du membre JSON (ex. "item-1") dans currentThread/contexte modèle
//   - docs__extract produit un ack résolu (resource_stored / mcp_call), pas d'erreur
//   - js__eval(handle=res_…, code) calcule la somme exacte (8925) → le texte
//     intégral est bien décodable depuis le stockage 'inline'
//   - le bloc resource n'apparaît pas dans la queue de rendu D8 (pas de bouton
//     téléchargement parasite) — retainPendingToolBlocks a fait son travail
//   - att-N/file-N non perturbés (smoke : hook généralisé, pas de régression)
//
// Usage : node verify-docs-extract.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait, proxy MCP déjà lancé sur :8765 (Julien).
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const zipPath = path.join(repoRoot, 'untracked/test-files/test-extract.zip');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-docs-extract');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail ? '  — ' + detail : ''));
  if (!cond) failures.push(label);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Prérequis fichiers ───────────────────────────────────────────────────────
if (!fs.existsSync(distPath)) { console.error('dist/miaou.html manquant — lance build.py'); process.exit(2); }
if (!fs.existsSync(zipPath)) { console.error('oracle manquant : ' + zipPath); process.exit(2); }

const zipBytes = fs.readFileSync(zipPath);

// ── Proxy MCP déjà lancé par Julien sur :8765 — on le réutilise tel quel ────
const PROXY_PORT = Number(process.env.VERIFY_PROXY_PORT || 8765);
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}/mcp`;
async function probeProxy() {
  try {
    const r = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } }),
    });
    return r.ok;
  } catch (e) { return false; }
}
const proxyUp = await probeProxy();
if (!proxyUp) {
  console.error('Le proxy MCP ne répond pas sur :' + PROXY_PORT + '. Lance-le (uv run mcp_proxy.py) avant ce script.');
  process.exit(2);
}
console.log('  ..  proxy MCP réutilisé sur :' + PROXY_PORT + '.');

// ── Stub SSE modèle, piloté par window.__scriptedToolCalls ────────────────
const initScript = ({ proxyUrl }) => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
    localStorage.setItem('miaou-mcp-servers', JSON.stringify([
      { name: 'p', url: proxyUrl, transport: 'streamable-http', enabled: true, timeout: 30000 },
    ]));
  } catch (e) {}

  window.__scriptedToolCalls = [];
  window.__stubTurns = [];

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      const tcs = Array.isArray(window.__scriptedToolCalls) ? window.__scriptedToolCalls : [];
      window.__stubTurns.push(tcs.map((t) => t.name));
      const lines = [];
      if (tcs.length) {
        tcs.forEach((tc, i) => {
          lines.push('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [
            { index: i, id: 'call_' + i, type: 'function',
              function: { name: tc.name, arguments: tc.arguments } },
          ] } }] }) + '\n\n');
        });
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }) + '\n\n');
      } else {
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Terminé.' } }] }) + '\n\n');
        lines.push('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
      }
      lines.push('data: [DONE]\n\n');
      const body = new ReadableStream({
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
      return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    }
    if (url.indexOf('/models') >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
        status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, opts);   // MCP réel + reste
  };
};

// ── Pilotage Playwright ──────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript(initScript, { proxyUrl: PROXY_URL });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error] ' + m.text()); });

let exitCode = 0;
try {
  await page.goto('file://' + distPath);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForFunction(() => typeof currentThread !== 'undefined', null, { timeout: 15000 });
  await page.waitForFunction(
    () => typeof _remoteTools !== 'undefined' && _remoteTools.p && _remoteTools.p.length > 0,
    null, { timeout: 20000 },
  ).catch(() => {});
  const toolCount = await page.evaluate(() => (typeof _remoteTools !== 'undefined' && _remoteTools.p) ? _remoteTools.p.length : 0);
  check('proxy MCP connecté depuis MIAOU (tools/list non vide)', toolCount > 0, toolCount + ' outils');
  const hasExtract = await page.evaluate(() =>
    (typeof _remoteTools !== 'undefined' && _remoteTools.p || []).some((t) => t.name === 'p__docs__extract'));
  check('docs__extract exposé par le proxy', hasExtract);

  // ── Attacher le zip oracle (att-N binaire, comme un vrai upload) ───────────
  await page.setInputFiles('#attach-file-input', {
    name: 'test-extract.zip', mimeType: 'application/zip', buffer: zipBytes,
  });
  await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });

  // ── TOUR 1 : docs__extract(ref=att-1, path=data.json) → res_… inline ───────
  const send = async (text) => {
    await page.fill('#composer-text', text);
    await page.evaluate(() => { if (typeof onSendBtn === 'function') onSendBtn(); });
  };
  await page.evaluate(() => {
    window.__scriptedToolCalls = [
      { name: 'p__docs__extract', arguments: JSON.stringify({ ref: 'att-1', path: 'data.json' }) },
    ];
  });
  await send('extrais le membre JSON de cette archive');

  await page.waitForFunction(() => {
    if (typeof _resourceCache === 'undefined') return false;
    return Object.keys(_resourceCache).some((k) => k.indexOf('res_') === 0 && _resourceCache[k].class === 'inline');
  }, null, { timeout: 30000 });

  const rec = await page.evaluate(() => {
    const id = Object.keys(_resourceCache).find((k) => k.indexOf('res_') === 0 && _resourceCache[k].class === 'inline');
    const r = _resourceCache[id];
    return { id, class: r.class, mime: r.mime, size: r.size, name: r.name };
  });
  check('res_… matérialisé, class inline', rec && rec.class === 'inline', rec && rec.id);
  check('mime textuel (text/plain ou json)', rec && /text|json/i.test(rec.mime || ''), rec && rec.mime);
  check('taille plausible (data.json ~2.2 Ko décompressé)', rec && rec.size > 1000 && rec.size < 10000, rec && String(rec.size));

  // Aucun contenu du membre JSON dans le contexte modèle (currentThread).
  const ctxLeak = await page.evaluate(() => {
    try {
      const msgs = (typeof currentThread !== 'undefined') ? currentThread : [];
      const blob = JSON.stringify(msgs);
      return blob.indexOf('item-1') >= 0 || blob.indexOf('"value":7') >= 0;
    } catch (e) { return true; }
  });
  check('aucun contenu du membre JSON dans le thread/contexte', !ctxLeak);

  // Le bloc resource n'a pas atterri dans la queue de rendu D8 (retainPendingToolBlocks).
  const pendingBlocksClean = await page.evaluate(() => {
    try {
      if (typeof getPendingToolBlocks !== 'function') return 'no-fn';
      return getPendingToolBlocks().length === 0 ? 'ok' : 'leftover:' + getPendingToolBlocks().length;
    } catch (e) { return 'throw:' + e.message; }
  });
  check('bloc resource retiré de la queue D8 (pas de bouton téléchargement parasite)',
    pendingBlocksClean === 'ok', pendingBlocksClean);

  // Ack docs__extract résolu, non-erreur.
  const extractAck = await page.evaluate(() => {
    const out = { called: false, error: null };
    try {
      const msgs = (typeof currentThread !== 'undefined') ? currentThread : [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m && m.role === 'tool-ack' && ((m.name || '') + '').indexOf('docs__extract') >= 0) {
          out.called = true; out.error = !!m.error; break;
        }
      }
    } catch (e) {}
    return out;
  });
  check('docs__extract a produit un ack résolu, non-erreur', extractAck.called && extractAck.error === false,
    JSON.stringify(extractAck));

  await page.screenshot({ path: path.join(outDir, '1-docs_extract.png'), fullPage: true }).catch(() => {});

  // ── TOUR 2 : js__eval(handle=res_…, code) → somme des .value == 8925 ───────
  await page.evaluate(() => { window.__scriptedToolCalls = []; });
  const sumCode = 'const rows = parse(); JSON.stringify(rows.reduce((s, r) => s + r.value, 0));';
  const evalResult = await page.evaluate(async ({ handle, code }) => {
    try {
      const r = await callTool('miaou__js__eval', { handle, code });
      return { ok: !r.isError, content: (r.content && r.content[0] && r.content[0].text) || '' };
    } catch (e) { return { ok: false, content: 'throw:' + e.message }; }
  }, { handle: rec.id, code: sumCode });
  check('js__eval calcule la somme exacte (8925) sur le res_… inline',
    evalResult.ok && evalResult.content.indexOf('8925') >= 0, JSON.stringify(evalResult));

  await page.screenshot({ path: path.join(outDir, '2-js_eval.png'), fullPage: true }).catch(() => {});

  // ── Smoke non-régression : att-N/file-N encore résolvables ──────────────────
  const attStillOk = await page.evaluate(() => {
    try {
      if (typeof getCachedRecordByAttId !== 'function' || typeof currentConvId === 'undefined') return 'no-fn';
      const rec = getCachedRecordByAttId('att-1', currentConvId);
      return rec ? 'ok' : 'missing';
    } catch (e) { return 'throw:' + e.message; }
  });
  check('att-1 (zip attaché) toujours résolvable (pas de régression du hook généralisé)',
    attStillOk === 'ok', attStillOk);

} catch (e) {
  console.error('  FAIL  exception : ' + (e && e.message));
  failures.push('exception: ' + (e && e.message));
  exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}

console.log('\n────────────────────────────────────────────');
if (failures.length) {
  console.log('  ÉCHECS (' + failures.length + ') :\n   - ' + failures.join('\n   - '));
  process.exit(exitCode || 1);
} else {
  console.log('  OK — tous les points de la checklist M sont verts.');
  process.exit(0);
}
