#!/usr/bin/env node
// Vérif e2e du lot K (MIAOU) : matérialisation d'une ressource web en `res_…`
// puis branchement de ce `res_…` comme handle d'entrée de `docs__*`.
//
// Chemin réellement exercé (MCP RÉEL, modèle STUBÉ) :
//   1. Le proxy miaou-mcp-servers (web + docs, port 8765) est lancé pour de vrai.
//   2. Un petit serveur HTTP local sert untracked/test-files/test.pdf en
//      application/pdf — l'oracle web.
//   3. MIAOU est configuré vers un serveur MCP « p » = le proxy. Les appels
//      MCP (mcpRpc → fetch vers :8765/mcp) partent RÉELLEMENT ; seul
//      /chat/completions est stubé (SSE scripté) pour émettre des tool_calls
//      déterministes sans dépendre d'un vrai modèle.
//   Tour 1 : le stub émet p__web__fetch_resource(url) → le proxy télécharge le
//     PDF, renvoie [descripteur text, resource.blob] → extractResultParts route
//     le blob en store_binary → record res_… (class binary) en IDB, avec
//     originUrl = l'uri du blob (l'URL locale). C'est §4.1.
//   Tour 2 : le script lit le res_… matérialisé en IDB, l'injecte dans le
//     script SSE, relance un envoi → le stub émet p__docs__read(ref=res_…).
//     callDocsInflatedRemoteTool résout res_… → content_b64 → le proxy
//     matérialise (nouveau _REF_RE côté serveur, commit 91de653) et extrait le
//     texte du PDF. C'est §4.2 end-to-end, y compris le déblocage serveur K0.
//
// Checklist (mémoire projet no_manual_verification : UN script à checklist,
// lancé UNIQUEMENT sur accord de Julien) :
//   - res_… matérialisé en IDB, class 'binary', mime application/pdf
//   - originUrl du record == l'URL locale servie
//   - aucun base64 du PDF dans le contexte modèle (apiMessages)
//   - docs__read sur le res_… renvoie du texte extrait (inflation content_b64 OK)
//   - un ack visible (resource_stored / mcp_call), pas de gate ask_confirmation
//   - att-N/file-N non touchés (la résolution reste généralisée — smoke : le
//     hook ne s'active que sur ref connue)
//
// Usage : node verify-res-docs-wiring.mjs [dossier-captures] [--headed]
//   Prérequis : `python3 build.py` fait, proxy PAS déjà lancé sur 8765.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const serversRoot = path.resolve(repoRoot, '../miaou-mcp-servers');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const pdfPath = path.join(repoRoot, 'untracked/test-files/test.pdf');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-res-docs');
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
if (!fs.existsSync(pdfPath)) { console.error('oracle manquant : ' + pdfPath); process.exit(2); }
if (!fs.existsSync(serversRoot)) { console.error('miaou-mcp-servers introuvable : ' + serversRoot); process.exit(2); }

const pdfBytes = fs.readFileSync(pdfPath);

// ── 1. Oracle HTTP local (sert le PDF) ───────────────────────────────────────
let ORACLE_PORT = 0;
const oracle = http.createServer((req, res) => {
  if (req.url === '/test.pdf') {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdfBytes.length });
    res.end(pdfBytes);
  } else {
    res.writeHead(404); res.end('nope');
  }
});
await new Promise((resolve) => oracle.listen(0, '127.0.0.1', resolve));
ORACLE_PORT = oracle.address().port;
const ORACLE_URL = `http://127.0.0.1:${ORACLE_PORT}/test.pdf`;
console.log('  ..  oracle PDF servi sur ' + ORACLE_URL);

// ── 2. Proxy MCP réel (web + docs) ───────────────────────────────────────────
// Port dédié (défaut 8799) pour ne JAMAIS heurter un proxy déjà lancé sur 8765
// (usage normal de Julien). Workdir docs éphémère pour ne pas polluer un cache.
const PROXY_PORT = Number(process.env.VERIFY_PROXY_PORT || 8799);
const docsWork = fs.mkdtempSync(path.join(outDir, 'docs-work-'));
const proxy = spawn('uv', ['run', 'mcp_proxy.py', '--port', String(PROXY_PORT)], {
  cwd: serversRoot,
  env: { ...process.env, MIAOU_DOCS_WORKDIR: docsWork },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let proxyLog = '';
proxy.stdout.on('data', (d) => { proxyLog += d; });
proxy.stderr.on('data', (d) => { proxyLog += d; });

const cleanup = async () => {
  try { proxy.kill('SIGTERM'); } catch (e) {}
  try { oracle.close(); } catch (e) {}
};

// Attente que le proxy réponde sur :${PROXY_PORT}/mcp (POST initialize minimal via probe).
const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}/mcp`;
async function waitProxy(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '0' } } }),
      });
      if (r.ok) return true;
    } catch (e) {}
    await sleep(400);
  }
  return false;
}
console.log('  ..  démarrage du proxy MCP (uv run mcp_proxy.py)…');
const proxyUp = await waitProxy(30000);
if (!proxyUp) {
  console.error('Le proxy MCP n\'a pas répondu sur ' + PROXY_PORT + ' en 30 s. Log :\n' + proxyLog.slice(-2000));
  await cleanup();
  process.exit(2);
}
console.log('  ..  proxy MCP prêt.');

// ── 3. Stub SSE modèle, piloté par window.__scriptedToolCalls ────────────────
// Le stub /chat/completions lit window.__scriptedToolCalls : soit un tour de
// tool_calls (finish_reason tool_calls), soit une réponse finale (stop) quand
// la liste est vide. Les fetch NON /chat/completions passent au travers (les
// appels MCP réels vers le proxy DOIVENT partir pour de vrai).
const initScript = ({ oracleUrl, proxyUrl }) => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
    }));
    // Serveur MCP « p » = le proxy réel. transport streamable-http.
    localStorage.setItem('miaou-mcp-servers', JSON.stringify([
      { name: 'p', url: proxyUrl, transport: 'streamable-http', enabled: true, timeout: 30000 },
    ]));
  } catch (e) {}

  window.__oracleUrl = oracleUrl;
  // Le tour courant à émettre. Réécrit par le script Node entre deux envois.
  window.__scriptedToolCalls = [
    { name: 'p__web__fetch_resource', arguments: JSON.stringify({ url: oracleUrl }) },
  ];
  window.__stubTurns = [];

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') >= 0) {
      let tcs = Array.isArray(window.__scriptedToolCalls) ? window.__scriptedToolCalls : [];
      // N'émettre CHAQUE tour scripté qu'UNE fois. MIAOU rappelle le modèle
      // après avoir servi les outils d'un tour : sans cette déduplication, le
      // stub réémettait le MÊME tool_call avec des arguments identiques, et
      // l'anti-redemande (`servedKeys`, piège 3) court-circuitait légitimement
      // le second appel — le test lisait « déjà fourni plus haut » au lieu du
      // texte extrait et accusait à tort le contrat d'inflation.
      // Déduplication par CLÉ (nom + arguments) plutôt que vidage global : le
      // script Node réarme `__scriptedToolCalls` pendant que l'échange
      // précédent tourne encore, un vidage inconditionnel consommerait le tour
      // suivant dans le relais au lieu du `send()` auquel il est destiné.
      window.__emittedKeys = window.__emittedKeys || {};
      const key = tcs.map((t) => t.name + ':' + t.arguments).join('|');
      if (key && window.__emittedKeys[key]) tcs = [];
      else if (key) window.__emittedKeys[key] = true;
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

// ── 4. Pilotage Playwright ───────────────────────────────────────────────────
const browser = await chromium.launch({ headless: !headed });
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.addInitScript(initScript, { oracleUrl: ORACLE_URL, proxyUrl: PROXY_URL });
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error] ' + m.text()); });

let exitCode = 0;
try {
  await page.goto('file://' + distPath);
  await page.waitForFunction(() => typeof currentThread !== 'undefined', null, { timeout: 15000 });
  // Laisser MIAOU connecter le serveur MCP (tools/list) avant d'envoyer.
  await page.waitForFunction(
    () => typeof _remoteTools !== 'undefined' && _remoteTools.p && _remoteTools.p.length > 0,
    null, { timeout: 20000 },
  ).catch(() => {});
  const toolCount = await page.evaluate(() => (typeof _remoteTools !== 'undefined' && _remoteTools.p) ? _remoteTools.p.length : 0);
  check('proxy MCP connecté depuis MIAOU (tools/list non vide)', toolCount > 0, toolCount + ' outils');

  // ── TOUR 1 : fetch_resource → res_… ────────────────────────────────────────
  const send = async (text) => {
    await page.fill('#composer-input, textarea', text).catch(async () => {
      await page.evaluate((t) => { const el = document.querySelector('textarea'); if (el) { el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); } }, text);
    });
    await page.evaluate(() => { if (typeof onSendBtn === 'function') onSendBtn(); });
  };
  await send('récupère la ressource web');
  // Attendre la matérialisation d'un res_… binaire en IDB (via le cache session).
  await page.waitForFunction(() => {
    if (typeof _resourceCache === 'undefined') return false;
    return Object.keys(_resourceCache).some((k) => k.indexOf('res_') === 0 && _resourceCache[k].class === 'binary');
  }, null, { timeout: 30000 });

  const rec = await page.evaluate(() => {
    const id = Object.keys(_resourceCache).find((k) => k.indexOf('res_') === 0 && _resourceCache[k].class === 'binary');
    const r = _resourceCache[id];
    return { id, class: r.class, mime: r.mime, size: r.size, originUrl: r.originUrl, name: r.name };
  });
  check('res_… matérialisé, class binary', rec && rec.class === 'binary', rec && rec.id);
  check('mime application/pdf', rec && rec.mime === 'application/pdf', rec && rec.mime);
  check('originUrl == URL locale servie', rec && rec.originUrl === ORACLE_URL, rec && String(rec.originUrl));
  check('taille plausible (PDF ~319 Ko)', rec && rec.size > 100000, rec && String(rec.size));

  // Aucun base64 du PDF dans le contexte modèle : inspecter apiMessages du dernier build.
  const ctxHasB64 = await page.evaluate((sz) => {
    // Reconstruire le contexte tel qu'envoyé et chercher une longue chaîne base64.
    try {
      const msgs = (typeof currentThread !== 'undefined') ? currentThread : [];
      const blob = JSON.stringify(msgs);
      // Une chaîne base64 de >50k caractères contigus = fuite du PDF.
      return /[A-Za-z0-9+/]{50000,}/.test(blob);
    } catch (e) { return false; }
  }, rec && rec.size);
  check('aucun base64 du PDF dans le thread/contexte', !ctxHasB64);

  await page.screenshot({ path: path.join(outDir, '1-fetch_resource.png'), fullPage: true }).catch(() => {});

  // ── TOUR 2 : docs__read(ref=res_…) → texte extrait ─────────────────────────
  // ATTENDRE LA FIN DU PREMIER ÉCHANGE — AVANT de réarmer le stub, et pour deux
  // raisons distinctes qui se cumulaient :
  //  (a) MIAOU rappelle le modèle après avoir servi les outils d'un tour ; un
  //      stub réarmé trop tôt voyait son tour 2 consommé par ce relais du tour 1,
  //      donc émis DANS le premier échange où plus rien ne l'attendait ;
  //  (b) `sending` valait encore true, et depuis le lot Q un texte tapé pendant
  //      une génération devient une INTERJECTION mise en file, pas un nouvel
  //      envoi — le second échange ne démarrait donc pas.
  // Les trois assertions échouaient en accusant le contrat d'inflation MCP,
  // alors que le serveur n'avait simplement jamais été appelé.
  // Prédicat : `_activeGenerations.size` (jamais `sending`, qui ne reflète que
  // la conversation AFFICHÉE — piège 28).
  await page.waitForFunction(
    () => typeof _activeGenerations !== 'undefined' && _activeGenerations.size === 0,
    null, { timeout: 60000 },
  );
  // Injecter le tour suivant : lire le res_… via docs__read, puis fin.
  await page.evaluate((resId) => {
    window.__scriptedToolCalls = [
      { name: 'p__docs__read', arguments: JSON.stringify({ ref: resId, selector: '1' }) },
    ];
  }, rec.id);
  // Après ce tour, plus rien (réponse stop).
  await page.exposeFunction('__afterDocsRead', () => {});
  // Capturer le résultat du tool docs__read via les acks du thread.
  await send('lis le document');
  // Attendre l'ack docs__read LUI-MÊME dans le fil, pas « un ack quelconque » :
  // un sélecteur DOM générique était déjà satisfait par l'ack du tour 1, donc
  // l'attente rendait la main aussitôt et le `sleep` qui suivait ne couvrait pas
  // un appel MCP réel (extraction d'un PDF de 320 Ko). Le test lisait alors un
  // fil où le second échange n'avait pas commencé — trois faux rouges.
  await page.waitForFunction(() => {
    const msgs = (typeof currentThread !== 'undefined') ? currentThread : [];
    return msgs.some((m) => m && m.role === 'tool-ack'
      && ((m.name || '') + '').indexOf('docs__read') >= 0 && m.result != null);
  }, null, { timeout: 60000 }).catch(() => {});

  // Vérifier le contenu extrait : on relit le dernier résultat d'outil docs__read
  // depuis l'état de la conversation (message role tool ou ack result).
  // Dans currentThread (fil visible), le résultat d'un tool_call est une entry
  // d'ack : role:'tool-ack', champ `name` (nom d'outil), `result` (texte aplati),
  // `error` (bool) — posés via copyAckFields/ACK_COPY_FIELDS + onEnrichLastAck.
  // (Le message role:'tool' d'api.js vit dans le tableau LOCAL de la boucle API,
  //  pas dans currentThread.)
  const docsRead = await page.evaluate(() => {
    const out = { called: false, textLen: 0, sample: '', error: null };
    try {
      const msgs = (typeof currentThread !== 'undefined') ? currentThread : [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m && m.role === 'tool-ack' && ((m.name || '') + '').indexOf('docs__read') >= 0) {
          out.called = true;
          const res = (m.result || '') + '';
          out.textLen = res.length;
          out.sample = res.slice(0, 160);
          out.error = !!m.error;
          break;
        }
      }
    } catch (e) { out.sample = 'ERR ' + e.message; }
    return out;
  });
  check('docs__read a produit une entry d\'ack dans le fil', docsRead.called,
    'len=' + docsRead.textLen + ' error=' + docsRead.error);
  check('docs__read non-erreur + texte extrait (inflation content_b64 OK, _REF_RE serveur élargi)',
    docsRead.called && docsRead.textLen > 0 && docsRead.error === false,
    'échantillon: ' + JSON.stringify(docsRead.sample));

  // Confirmer côté serveur : le workdir docs contient un fichier matérialisé
  // pour un ref res_… (preuve directe que le serveur a accepté le préfixe).
  const materialized = fs.existsSync(docsWork)
    ? fs.readdirSync(docsWork, { recursive: true }).filter((f) => String(f).indexOf('res_') >= 0)
    : [];
  check('serveur docs a matérialisé un fichier res_… (K0 e2e)', materialized.length > 0, materialized.join(', '));

  await page.screenshot({ path: path.join(outDir, '2-docs_read.png'), fullPage: true }).catch(() => {});

  // ── Smoke non-régression : le hook ne s'active pas sur ref inconnue ─────────
  const refUnknownSafe = await page.evaluate(() => {
    // _resolveInflationRef sur une ref res_… inconnue → null (pas de crash).
    try {
      if (typeof _resolveInflationRef !== 'function') return 'no-fn';
      return _resolveInflationRef('res_nonexistent999') === null ? 'ok' : 'unexpected';
    } catch (e) { return 'throw:' + e.message; }
  });
  check('res_… inconnu → résolution null, pas de crash (herméticité)', refUnknownSafe === 'ok', refUnknownSafe);

} catch (e) {
  console.error('  FAIL  exception : ' + (e && e.message));
  failures.push('exception: ' + (e && e.message));
  exitCode = 1;
} finally {
  await browser.close().catch(() => {});
  await cleanup();
}

console.log('\n────────────────────────────────────────────');
if (failures.length) {
  console.log('  ÉCHECS (' + failures.length + ') :\n   - ' + failures.join('\n   - '));
  process.exit(exitCode || 1);
} else {
  console.log('  OK — tous les points de la checklist K sont verts.');
  process.exit(0);
}
