#!/usr/bin/env node
// memory__update de bout en bout, appelé par un modèle (stubé) au fil d'un vrai
// échange — pas par callTool direct :
//
//   A. Le modèle lit l'id du souvenir dans SON contexte (bloc ESPACE du message
//      système), l'appelle, et reçoit « Souvenir mis à jour. ». Le stub extrait
//      l'id du payload plutôt que de le connaître d'avance : si l'id servi au
//      modèle ne correspondait pas au stockage, l'appel raterait ici aussi.
//   B. Le stockage a changé pour CE souvenir, et pour lui seul (voisin du même
//      Space et souvenir de profil intacts).
//   C. La liste « Souvenirs » de l'Espace, ouverte à côté du fil pendant
//      l'appel, montre le nouveau contenu sans geste (rafraîchissement au point
//      d'écriture, persistMemories → refreshVisibleMemoryLists). Avant, elle
//      gardait l'ancien jusqu'au prochain rendu.
//   D. Une liste où l'utilisateur a un brouillon n'est PAS re-rendue (sa saisie
//      serait détruite) ; sans brouillon, elle l'est.
//   E. Après reload, le nouveau contenu est toujours là (stockage ET liste).
//
// Usage : node verify-memory-update.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined && !cond ? '  → ' + JSON.stringify(detail) : ''));
  if (!cond) failures.push(label);
};

const OLD = "L'utilisateur boit du thé le matin.";
const NEW = "L'utilisateur boit du café le matin.";
const NEIGHBOUR = "L'utilisateur range ses notes par projet.";
const PROFILE = "L'utilisateur préfère des réponses courtes.";

const browser = await launchIsolated({ headless: !headed }, { serve: false });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// ── Modèle stubé ────────────────────────────────────────────────────────────
// Tour discriminé sur le CONTENU (présence d'un role:'tool'), jamais sur un
// compteur : titrage et résumé passent aussi par ici (SKILL.md).
const stub = { toolTurns: 0, seenId: null, toolResult: null };
await page.route('**/chat/completions', async (route) => {
  let body = {};
  try { body = JSON.parse(route.request().postData() || '{}'); } catch { /* illisible */ }
  if (!body.stream) {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' } }] }) });
    return;
  }
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const sse = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
  const toolMsg = msgs.find((m) => m && m.role === 'tool');
  let out;
  if (!toolMsg) {
    stub.toolTurns++;
    const sys = msgs.filter((m) => m.role === 'system').map((m) => String(m.content)).join('\n');
    const m = sys.match(/\[id: ([^\]]+)\] L'utilisateur boit du thé/);
    stub.seenId = m ? m[1] : null;
    const args = JSON.stringify({ id: stub.seenId || 'absent-du-contexte', content: NEW });
    out = sse({ choices: [{ delta: { role: 'assistant', content: 'Je corrige.' } }] })
      + sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function',
          function: { name: 'miaou__memory__update', arguments: '' } }] } }] })
      + sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] })
      + sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      + 'data: [DONE]\n\n';
  } else {
    stub.toolResult = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content);
    out = sse({ choices: [{ delta: { role: 'assistant', content: 'C\'est corrigé.' } }] })
      + sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      + 'data: [DONE]\n\n';
  }
  await route.fulfill({ status: 200, contentType: 'text/event-stream', body: out });
});
await page.route('**/models', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'stub-model' }] }) }));

const boot = async () => {
  await page.waitForSelector('#composer-text', { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 15000 });
};
await page.goto('file://' + distPath);
await boot();

// Fixtures : deux souvenirs dans le Space par défaut, un de profil.
const ids = await page.evaluate(({ OLD, NEIGHBOUR, PROFILE }) => {
  const now = Date.now();
  const mk = (content, scope) => {
    const id = genMemoryId();
    saveMemory({ id, content, created_at: now, updated_at: now, suppressed: false, scope });
    return id;
  };
  return { target: mk(OLD, DEFAULT_SPACE_ID), neighbour: mk(NEIGHBOUR, DEFAULT_SPACE_ID), profile: mk(PROFILE, 'profile') };
}, { OLD, NEIGHBOUR, PROFILE });

// La liste de l'Espace, ouverte AVANT l'échange — c'est elle qu'on regardait.
await page.evaluate(() => selectSpaceTab('memories'));
const listText = () => page.evaluate(() => $('space-memory-list').textContent);
const listVisible = await page.evaluate(() => $('space-memory-list').getClientRects().length > 0);
check('prémisse : liste des souvenirs de l\'Espace visible', listVisible);
check('prémisse : la liste montre l\'ancien contenu', (await listText()).includes(OLD));

// ════════════════════════════════════════════════════════════════════════════
console.log('\nA. Appel par le modèle');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => newConversation());
await page.fill('#composer-text', 'Corrige : je bois du café, pas du thé.');
await page.click('#send-btn');
await page.waitForFunction(() => document.querySelector('#thread .tool-ack') !== null, { timeout: 10000 });
await page.waitForFunction(() => typeof sending !== 'undefined' && sending === false, { timeout: 15000 });

check('stub sollicité pour le tour d\'appel', stub.toolTurns >= 1, stub.toolTurns);
check('l\'id lu dans le contexte du modèle est celui du stockage', stub.seenId === ids.target, { seen: stub.seenId, stored: ids.target });
check('le modèle reçoit « Souvenir mis à jour. »', (stub.toolResult || '').includes('Souvenir mis à jour.'), stub.toolResult);
const ackText = await page.evaluate(() => document.querySelector('#thread .tool-ack').textContent);
check('ack « Souvenir mis à jour » avec le nouveau contenu', ackText.includes('Souvenir mis à jour') && ackText.includes('café'), ackText);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nB. Stockage');
// ════════════════════════════════════════════════════════════════════════════
const stored = () => page.evaluate(() => Object.fromEntries(loadMemories().map((m) => [m.id, m.content])));
const s1 = await stored();
check('souvenir ciblé réécrit', s1[ids.target] === NEW, s1[ids.target]);
check('voisin du même Space intact', s1[ids.neighbour] === NEIGHBOUR, s1[ids.neighbour]);
check('souvenir de profil intact', s1[ids.profile] === PROFILE, s1[ids.profile]);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nC. Liste ouverte rafraîchie sans geste');
// ════════════════════════════════════════════════════════════════════════════
const t1 = await listText();
check('la liste montre le nouveau contenu', t1.includes(NEW), t1);
check('la liste ne montre plus l\'ancien', !t1.includes(OLD), t1);

// ════════════════════════════════════════════════════════════════════════════
console.log('\nD. Brouillon protégé, puis rafraîchi sans brouillon');
// ════════════════════════════════════════════════════════════════════════════
// Écriture directe par editMemory : même point d'écriture que le handler, seul
// l'état de la liste change entre les deux essais.
const d = await page.evaluate(({ id }) => {
  const input = $('mem-add-input-space-memory-list');
  input.value = 'brouillon en cours';
  input.blur();
  editMemory(id, 'Version pendant le brouillon.');
  const kept = $('mem-add-input-space-memory-list').value;
  const staleWhileDraft = !$('space-memory-list').textContent.includes('Version pendant le brouillon.');
  $('mem-add-input-space-memory-list').value = '';
  editMemory(id, 'Version sans brouillon.');
  const fresh = $('space-memory-list').textContent.includes('Version sans brouillon.');
  return { kept, staleWhileDraft, fresh };
}, { id: ids.target });
check('brouillon conservé pendant une écriture', d.kept === 'brouillon en cours', d.kept);
check('liste NON re-rendue tant qu\'il y a un brouillon', d.staleWhileDraft);
check('liste re-rendue une fois le brouillon vide', d.fresh);
// Retour au contenu posé par le modèle pour le bloc E.
await page.evaluate(({ id, NEW }) => editMemory(id, NEW), { id: ids.target, NEW });

// ════════════════════════════════════════════════════════════════════════════
console.log('\nE. Après reload');
// ════════════════════════════════════════════════════════════════════════════
await page.reload();
await boot();
const s2 = await stored();
check('stockage : nouveau contenu persisté', s2[ids.target] === NEW, s2[ids.target]);
await page.evaluate(() => selectSpaceTab('memories'));
const t2 = await listText();
check('liste après reload : nouveau contenu', t2.includes(NEW) && !t2.includes(OLD), t2);

check('aucune erreur console', consoleErrors.length === 0, consoleErrors);

await browser.close();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nOK — tout passe');
process.exit(failures.length ? 1 : 0);
