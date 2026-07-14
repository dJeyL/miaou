#!/usr/bin/env node
// Vérification des trois lots d'acks non couverts par QuickJS (DOM + persistance) :
//
//   A. Bug de collapse du groupe (lot N) : expand groupe → expand dernier ack →
//      collapse groupe → re-expand : l'ack doit RESTER déplié. Le bridge
//      slotExpanded écoutait .ack-slot (caché en mode liste) : un toggle fait
//      dans .ack-list ne resynchronisait pas l'état de groupe, et le retour en
//      compact réappliquait l'état périmé (applySlotExpanded).
//
//   B. Rendu en erreur : ackIsError couvre `error` (MCP) ET `ok === false`
//      (js__eval : cap + plantage guest). Un js__eval en échec restait blanc.
//      Vérifie aussi que le label prend --err-soft (désaturé) et l'icône --err.
//
//   C. Acks d'échec des outils natifs (toolFail) : un handler en échec pousse un
//      ack tool_failed rouge — avant, AUCUN ack (appel invisible). Vérifié en
//      live (via callTool réel) ET après reload (persistance du champ `message`,
//      ajouté à ACK_COPY_FIELDS).
//
// Usage : node verify-ack-errors.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-ack-errors');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ════════════════════════════════════════════════════════════════════════════
console.log('\nA. Collapse du groupe : l\'expand d\'un ack fait en mode liste survit');
// ════════════════════════════════════════════════════════════════════════════
// Trois acks avec intent (donc chevron + détail repliable) dans une bulle fraîche.
await page.evaluate(() => {
  window.__wrap = startAssistantMessage('test-model');
  for (let i = 1; i <= 3; i++) {
    placeToolAck(window.__wrap, {
      id: 'a' + i, role: 'tool-ack', kind: 'mcp_call', server: 'srv',
      name: 'srv__tool_' + i, intent: 'Étape ' + i, args: {}, result: 'ok',
    }, false);
  }
});
await page.waitForTimeout(100);

// Le dernier ack (visible en slot) est REPLIÉ au départ. En mode compact, un SEUL
// .tool-ack est dans le DOM : renderAckGroup ne garde que le nœud visible dans le
// track, les autres ne vivent que dans la WeakMap ackNodeOf jusqu'au passage en liste.
const a0 = await page.evaluate(() => {
  const g = document.querySelector('.ack-group');
  const slotAck = document.querySelector('.ack-slot .tool-ack');
  return {
    mode: g.dataset.mode,
    count: g.dataset.count,
    inDom: document.querySelectorAll('.tool-ack').length,
    lastDetailHidden: slotAck.querySelector('.mcp-breadcrumb-detail').hasAttribute('hidden'),
  };
});
check('départ : groupe compact sur 3 acks (1 seul nœud en DOM, le dernier)',
  a0.mode === 'compact' && a0.count === '3' && a0.inDom === 1);
check('départ : détail du dernier ack replié', a0.lastDetailHidden === true);

// 1. Expand du GROUPE (badge) → mode liste.
await page.click('.ack-badge');
await page.waitForTimeout(350);   // laisse l'animation de swap finir
check('groupe déplié → mode liste',
  await page.evaluate(() => document.querySelector('.ack-group').dataset.mode === 'list'));

// 2. Expand du DERNIER ack, DANS la liste (c'est là que le bridge ne voyait rien).
await page.evaluate(() => {
  const acks = document.querySelectorAll('.ack-list .tool-ack');
  acks[acks.length - 1].querySelector('.mcp-intent-row').click();
});
await page.waitForTimeout(100);
check('dernier ack déplié en mode liste',
  await page.evaluate(() => {
    const acks = document.querySelectorAll('.ack-list .tool-ack');
    return !acks[acks.length - 1].querySelector('.mcp-breadcrumb-detail').hasAttribute('hidden');
  }));
await shot('a1-liste-dernier-ack-deplie.png');

// 3. Collapse du groupe → compact. L'ack déplié devient le nœud du slot.
await page.click('.ack-badge');
await page.waitForTimeout(350);
const a3 = await page.evaluate(() => {
  const slotAck = document.querySelector('.ack-slot .tool-ack');
  return {
    mode: document.querySelector('.ack-group').dataset.mode,
    detailHidden: slotAck.querySelector('.mcp-breadcrumb-detail').hasAttribute('hidden'),
  };
});
check('retour en compact : l\'ack reste DÉPLIÉ (bug : applySlotExpanded le repliait)',
  a3.mode === 'compact' && a3.detailHidden === false);

// 4. Re-expand du groupe → l'ack doit TOUJOURS être déplié.
await page.click('.ack-badge');
await page.waitForTimeout(350);
check('re-dépliage du groupe : l\'ack est toujours déplié',
  await page.evaluate(() => {
    const acks = document.querySelectorAll('.ack-list .tool-ack');
    return !acks[acks.length - 1].querySelector('.mcp-breadcrumb-detail').hasAttribute('hidden');
  }));
await shot('a2-apres-aller-retour.png');

// ════════════════════════════════════════════════════════════════════════════
console.log('\nB. Rendu en erreur : ackIsError (error MCP + ok:false js__eval)');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => {
  document.getElementById('thread').innerHTML = '';
  window.__wrap2 = startAssistantMessage('test-model');
  // 1. MCP en erreur (champ `error`) — marchait déjà.
  placeToolAck(window.__wrap2, {
    id: 'e1', role: 'tool-ack', kind: 'mcp_call', server: 'srv', name: 'srv__docs__read',
    intent: 'Lecture du fichier', error: true, args: {}, result: 'boom',
  }, false);
  // 2. js__eval refusé au cap (ok:false) — restait BLANC avant le fix.
  placeToolAck(window.__wrap2, {
    id: 'e2', role: 'tool-ack', kind: 'js_eval', handle: 'att-1', ok: false,
    outLen: 99999, code: 'x', intent: 'Analyse du fichier',
  }, false);
  // 3. js__eval réussi (ok:true) — doit rester NEUTRE (non-régression).
  placeToolAck(window.__wrap2, {
    id: 'e3', role: 'tool-ack', kind: 'js_eval', handle: 'att-1', ok: true,
    outLen: 3293, code: 'x', intent: 'Analyse réussie',
  }, false);
});
await page.waitForTimeout(100);
// Mode liste pour voir les trois d'un coup.
await page.click('.ack-badge');
await page.waitForTimeout(350);

// Mesuré dans les DEUX thèmes : l'atténuation visait le mode SOMBRE, le vérifier
// seulement en clair (thème par défaut de la page) ne prouverait rien.
const probeColors = () => page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const acks = Array.from(document.querySelectorAll('.ack-list .tool-ack'));
  const errSoft = cs.getPropertyValue('--err-soft').trim();
  const err = cs.getPropertyValue('--err').trim();
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    classes: acks.map(a => a.classList.contains('ack-error')),
    errLabel: getComputedStyle(acks[1].querySelector('.ack-label')).color,   // js_eval refusé
    errIcon: getComputedStyle(acks[1].querySelector('.ack-icon')).color,
    okLabel: getComputedStyle(acks[2].querySelector('.ack-label')).color,    // js_eval réussi
    tokensDiffer: errSoft !== '' && err !== '' && errSoft !== err,
  };
});

for (const theme of ['light', 'dark']) {
  await page.evaluate((t) => selectTheme(t), theme);
  await page.waitForTimeout(150);
  const b = await probeColors();
  const tag = ' [' + theme + ']';
  check('MCP en erreur : .ack-error' + tag, b.classes[0] === true);
  check('js__eval ok:false : .ack-error (était BLANC avant ackIsError)' + tag, b.classes[1] === true);
  check('js__eval ok:true : PAS .ack-error (non-régression)' + tag, b.classes[2] === false);
  check('--err-soft et --err distincts (sinon l\'atténuation est un no-op)' + tag, b.tokensDiffer);
  // Le label d'erreur est adouci (--err-soft) MAIS doit rester nettement distinct
  // du label d'un ack sain (--text-2) : sinon l'erreur ne se voit plus du tout.
  check('label d\'erreur ≠ label d\'un ack sain' + tag, b.errLabel !== b.okLabel);
  check('label adouci ≠ icône vive (--err-soft vs --err)' + tag, b.errLabel !== b.errIcon);
  await shot('b1-trois-acks-erreur-' + theme + '.png');
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nC. toolFail : ack d\'échec des outils natifs (live + persistance)');
// ════════════════════════════════════════════════════════════════════════════
await page.evaluate(() => selectTheme('dark'));   // captures cohérentes avec le bloc B
await page.waitForTimeout(150);
// Appel RÉEL d'un outil natif en échec (pas un ack fabriqué à la main) : c'est
// tout le chemin callTool → handler → toolFail → _pendingToolAcks qui est exercé.
const c1 = await page.evaluate(() => {
  clearPendingToolAcks();
  const res = callTool('miaou__update_memory', { id: 'inexistant', content: 'x' });
  const acks = getPendingToolAcks();
  return {
    text: flattenToolResult(res),
    n: acks.length,
    kind: acks[0] && acks[0].kind,
    name: acks[0] && acks[0].name,
    error: acks[0] && acks[0].error,
    isErr: acks[0] ? ackIsError(acks[0]) : false,
  };
});
check('update_memory sur id inconnu → 1 ack tool_failed', c1.n === 1 && c1.kind === 'tool_failed');
check('ack porte le nom canonique préfixé', c1.name === 'miaou__update_memory');
check('ack en erreur (ackIsError)', c1.error === true && c1.isErr === true);
check('tool result inchangé pour le modèle', c1.text.includes('introuvable'));

// Rendu de cet ack réel dans une bulle.
await page.evaluate(() => {
  document.getElementById('thread').innerHTML = '';
  const w = startAssistantMessage('test-model');
  const acks = getPendingToolAcks();
  placeToolAck(w, copyAckFields(acks[0], { role: 'tool-ack' }), false);
});
await page.waitForTimeout(100);
const c2 = await page.evaluate(() => {
  const a = document.querySelector('.tool-ack');
  return {
    isError: a.classList.contains('ack-error'),
    text: a.querySelector('.ack-label').textContent,
    hasIcon: !!a.querySelector('.ack-icon svg'),
  };
});
check('ack tool_failed rendu en rouge', c2.isError === true);
check('label porte le message d\'échec', c2.text.includes('introuvable'));
check('ack tool_failed a une icône (triangle d\'alerte)', c2.hasIcon === true);
await shot('c1-ack-echec-natif.png');

// ── Persistance : le champ `message` doit survivre au reload (ACK_COPY_FIELDS) ──
await page.evaluate(() => {
  const conv = {
    id: 'conv-verif-echec', title: 'Vérif ack échec', spaceId: 'default',
    createdAt: Date.now(), updatedAt: Date.now(),
    messages: [
      { role: 'user', content: 'oublie ce souvenir' },
      { role: 'tool-ack', kind: 'tool_failed', name: 'miaou__update_memory',
        message: 'Souvenir introuvable.', error: true, args: {}, result: 'Souvenir introuvable.' },
      { role: 'assistant', content: 'Je n\'ai pas trouvé ce souvenir.' },
    ],
  };
  saveConversation(conv);
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
// Attendre que l'overlay de boot s'efface. Il n'est JAMAIS retiré du DOM : il reçoit
// la classe .boot-done, après un délai plancher (BOOT_MIN_AFTER_READY_MS = 1800 ms).
// Sans cette attente, la capture montre l'écran de préchargement alors que les
// assertions DOM passent — faux positif visuel, pas un bug appli.
await page.waitForFunction(
  () => document.getElementById('boot-overlay').classList.contains('boot-done'),
  { timeout: 8000 });
await page.waitForTimeout(400);   // fondu de l'overlay
await page.evaluate(() => selectTheme('dark'));
await page.evaluate(() => selectConv('conv-verif-echec'));
await page.waitForTimeout(400);

const c3 = await page.evaluate(() => {
  const a = document.querySelector('#thread .tool-ack');
  if (!a) return { found: false };
  return {
    found: true,
    isError: a.classList.contains('ack-error'),
    text: a.querySelector('.ack-label').textContent,
  };
});
check('après reload : l\'ack d\'échec est toujours là', c3.found === true);
check('après reload : toujours rouge', c3.isError === true);
check('après reload : le message a survécu (champ dans ACK_COPY_FIELDS)',
  c3.found && c3.text.includes('introuvable'));
await shot('c2-apres-reload.png');

// ════════════════════════════════════════════════════════════════════════════
check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) console.log('\nErreurs console :\n' + consoleErrors.join('\n'));

console.log('\n' + '─'.repeat(60));
console.log(failures.length ? `  ÉCHEC — ${failures.length} :\n   - ` + failures.join('\n   - ')
                            : '  OK — toutes les vérifications passent');
await browser.close();
process.exit(failures.length ? 1 : 0);
