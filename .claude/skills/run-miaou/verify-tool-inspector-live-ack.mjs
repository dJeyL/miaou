#!/usr/bin/env node
// Lot Z-2 — la loupe d'inspection apparaît PENDANT la génération.
//
// Le bug : `buildToolAck` décide de l'affordance au moment où l'ack est créé, et
// un ack MCP est peint par `onEarlyAcks` AVANT le round-trip réseau — donc avant
// que `onEnrichLastAck` ne pose `args`/`result`. `ackHasInspectableDetail`
// répondait faux, la loupe n'apparaissait jamais ; il fallait quitter la
// conversation et y revenir pour que le reload relise l'entrée enrichie.
//
// Ce que ce script prouve, et qu'aucun test pur ne peut prouver (c'est un défaut
// de CÂBLAGE : le prédicat était juste, il n'était pas réévalué) :
//   - pendant le round-trip MCP, l'ack est affiché SANS loupe (état correct :
//     il n'y a encore rien à inspecter) ;
//   - dès la réponse de l'outil, la loupe apparaît — sans changer de conversation ;
//   - elle ouvre bien le drawer sur CET appel, avec ses arguments et son résultat ;
//   - elle n'est pas posée deux fois (idempotence) ;
//   - elle reste à sa place dans l'ordre des icônes.
//
// Usage : node verify-tool-inspector-live-ack.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-tool-inspector-live-ack');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Backend : le tour de l'utilisateur → un tool_call MCP ; le suivant → la
// réponse finale.
//
// Brancher sur le CONTENU de la requête, jamais sur un compteur d'appels :
// l'application émet plusieurs requêtes propres avant celle-ci (titrage,
// résumé…), si bien qu'au moment du send le compteur avait déjà dépassé 1 et
// que le tour d'outil n'était jamais servi. Le symptôme était muet — un
// timeout sur `__mcpCalled` sans une seule assertion rouge, parce que le code
// mesuré n'était jamais atteint.
await page.route('**/chat/completions', async (route) => {
  const payload = JSON.parse(route.request().postData() || '{}');
  const msgs = payload.messages || [];
  const asked = msgs.some(m => m.role === 'user' &&
    String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      .indexOf('berger australien') >= 0);
  // Une fois l'outil exécuté, la conversation porte un message role:'tool' :
  // c'est le signal du second tour (la réponse finale).
  const toolDone = msgs.some(m => m.role === 'tool');
  const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';
  let body;
  if (asked && !toolDone) {
    body = sse({ choices: [{ delta: { role: 'assistant', content: 'Je cherche.' } }] })
      + sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function',
          function: { name: 'brave__brave_image_search', arguments: '' } }] } }] })
      + sse({ choices: [{ delta: { tool_calls: [{ index: 0,
          function: { arguments: '{"query":"berger australien"}' } }] } }] })
      + sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      + 'data: [DONE]\n\n';
  } else {
    body = sse({ choices: [{ delta: { role: 'assistant', content: 'Voici ce que j\'ai trouvé.' } }] })
      + sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      + 'data: [DONE]\n\n';
  }
  await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
});
await page.route('**/models', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'stub-model' }] }),
}));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
// `.boot-done` marque la fin du boot en RENDANT L'OVERLAY INVISIBLE :
// waitForSelector attend la visibilité et expirerait donc toujours. On attend
// la présence de la classe, pas son affichage.
await page.waitForFunction(() => document.querySelector('.boot-done') !== null,
  { timeout: 15000 });

// Serveur MCP LENT : le délai est le cœur du test — c'est la fenêtre pendant
// laquelle l'ack existe sans son enrichissement. Stubé au niveau de mcpRpc pour
// que TOUT le chemin réel soit exercé (callRemoteTool pousse l'ack synchrone
// avant son await, onEarlyAcks le peint, onEnrichLastAck l'enrichit après).
await page.evaluate(() => {
  window.__mcpResolve = null;
  window.__mcpCalled = false;
  mcpRpc = async function (server, method) {
    // N'attendre QUE sur tools/call : `connectMcpServer` émet d'abord
    // `initialize` puis `tools/list`, et une attente indiscriminée bloquait la
    // connexion elle-même (le handshake ne rendait jamais la main) — l'outil
    // n'était alors jamais enregistré, et rien de ce que le script mesure ne
    // pouvait se produire.
    if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: {} };
    if (method === 'notifications/initialized') return {};
    if (method === 'tools/list') {
      return { tools: [{ name: 'brave_image_search', description: 'Cherche des images',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] };
    }
    if (method !== 'tools/call') return {};
    window.__mcpCalled = true;
    // Le round-trip est suspendu ici : c'est LA fenêtre que le test mesure —
    // l'ack est peint, l'enrichissement n'a pas encore eu lieu.
    await new Promise(res => { window.__mcpResolve = res; });
    return { content: [{ type: 'text', text: '{"results":[{"url":"https://x/y.jpg"}]}' }] };
  };
  saveMcpServers([{ name: 'brave', url: 'http://stub.local/mcp', enabled: true }]);
});
// Connexion réelle (listRemoteTools passe par le mcpRpc stubé ci-dessus) : sans
// elle, l'outil n'est pas dans le registre et le tool_call du modèle n'a aucune
// cible — le test passerait pour une raison qui n'est pas celle qu'on mesure.
const connected = await page.evaluate(async () => {
  await connectMcpServer(loadMcpServers()[0]);
  return remoteToolDefs().map(t => t.name);
});
// Prémisse asservie : sans l'outil au registre, le tool_call du modèle n'a
// aucune cible et TOUT le reste du script passerait sans rien prouver.
check('prémisse : l\'outil MCP est enregistré au registre',
  connected.indexOf('brave__brave_image_search') >= 0);

await page.fill('#composer-text', 'Trouve-moi une photo de berger australien');
await page.click('#send-btn');

// ── Pendant le round-trip MCP ───────────────────────────────────────────────
await page.waitForFunction(() => window.__mcpCalled === true, { timeout: 8000 });
await page.waitForSelector('#thread .tool-ack', { timeout: 8000 });
const during = await page.evaluate(() => ({
  ackVisible: !!document.querySelector('#thread .tool-ack'),
  hasInspect: !!document.querySelector('#thread .ack-inspect'),
  generating: !!document.querySelector('#thread .tool-ack'),
}));
check('l\'ack MCP est affiché pendant le round-trip', during.ackVisible);
check('pendant le round-trip : pas de loupe (rien à inspecter encore)',
  during.hasInspect === false);
await page.screenshot({ path: path.join(outDir, '01-pendant-appel.png') });

// ── L'outil répond : la loupe doit apparaître SANS changer de conversation ──
await page.evaluate(() => window.__mcpResolve && window.__mcpResolve());
await page.waitForTimeout(1200);

const after = await page.evaluate(() => {
  const acks = Array.from(document.querySelectorAll('#thread .tool-ack'));
  const mcp = acks.find(a => a.className.includes('ack-mcp_call')) || acks[0];
  return {
    hasInspect: !!(mcp && mcp.querySelector('.ack-inspect')),
    inspectCount: mcp ? mcp.querySelectorAll('.ack-inspect').length : 0,
    // Ordre : la loupe reste avant un éventuel bouton d'annulation.
    beforeUndo: (() => {
      if (!mcp) return true;
      const i = mcp.querySelector('.ack-inspect');
      const u = mcp.querySelector('.ack-undo, .ack-resolved');
      if (!i || !u) return true;
      return (i.compareDocumentPosition(u) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
    })(),
  };
});
check('la loupe apparaît dès la réponse de l\'outil, sans rouvrir la conversation',
  after.hasInspect);
check('elle n\'est posée qu\'une fois (idempotence)', after.inspectCount === 1);
check('elle reste avant le bouton d\'annulation dans l\'ordre des icônes',
  after.beforeUndo);
await page.screenshot({ path: path.join(outDir, '02-apres-reponse.png') });

// ── Elle ouvre le bon appel, avec ses données ───────────────────────────────
await page.evaluate(() => {
  const acks = Array.from(document.querySelectorAll('#thread .tool-ack'));
  const mcp = acks.find(a => a.className.includes('ack-mcp_call')) || acks[0];
  mcp.querySelector('.ack-inspect').click();
});
await page.waitForTimeout(500);
const drawer = await page.evaluate(() => {
  const d = document.getElementById('inspect-drawer');
  const body = document.getElementById('inspect-body');
  return {
    shown: !!(d && d.classList.contains('show')),
    text: body ? body.textContent : '',
  };
});
check('le drawer s\'ouvre sur cet appel', drawer.shown);
check('les ARGUMENTS enrichis y sont (ils n\'existaient pas au rendu de l\'ack)',
  drawer.text.includes('berger australien'));
check('le RÉSULTAT enrichi y est', drawer.text.includes('results'));
await page.screenshot({ path: path.join(outDir, '03-drawer.png') });

// ── Fin de génération : la loupe survit au re-rendu final ───────────────────
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);
const atEnd = await page.evaluate(() => {
  const acks = Array.from(document.querySelectorAll('#thread .tool-ack'));
  const mcp = acks.find(a => a.className.includes('ack-mcp_call')) || acks[0];
  return {
    stillThere: !!(mcp && mcp.querySelector('.ack-inspect')),
    count: mcp ? mcp.querySelectorAll('.ack-inspect').length : 0,
  };
});
check('la loupe est toujours là une fois la génération finie', atEnd.stillThere);
check('toujours une seule', atEnd.count === 1);
await page.screenshot({ path: path.join(outDir, '04-fin.png') });

check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) console.log('  ', consoleErrors.slice(0, 5).join('\n   '));

console.log('\n' + (failures.length
  ? `ÉCHEC — ${failures.length} contrôle(s) : ${failures.join(' | ')}`
  : 'OK — tous les contrôles passent'));
console.log('Captures : ' + outDir);
await browser.close();
process.exit(failures.length ? 1 : 0);
