#!/usr/bin/env node
// Vérification visuelle du lot N (ticker d'acks, repli à deux étages) — un seul
// lancement. Simule l'arrivée live de 4 acks dans une bulle assistant fraîche
// via placeToolAck (même chemin que onEarlyAcks/onToolAcks), puis vérifie :
//   - compact par défaut dès le 2e ack, transparent au 1er,
//   - ticker à l'arrivée (nœud remplacé, badge à jour),
//   - toggle badge → liste (tous les acks, chevrons individuels) → compact,
//   - héritage slot-expanded (détail déplié survit à l'arrivée suivante),
//   - réglage Animations coupe l'attribut html[data-motion] et donc la transition.
// Usage : node verify-ack-ticker.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-ack-ticker');
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

// ── Setup : une bulle assistant fraîche, un ack MCP avec intent (chevron) ────
await page.evaluate(() => {
  window.__wrap = startAssistantMessage('test-model');
  window.__mkAck = (i) => ({
    id: 'ack-' + i, role: 'tool-ack', server: null,
    intent: 'Étape ' + i, kind: 'mcp_call', toolName: 'demo_tool_' + i,
    args: {}, result: 'ok ' + i,
  });
});

// 1er ack : groupe posé, transparent (pas de badge, pas de chrome visible)
await page.evaluate(() => placeToolAck(window.__wrap, __mkAck(1)));
await page.waitForTimeout(50);
let s = await page.evaluate(() => ({
  count: document.querySelector('.ack-group').dataset.count,
  badgeHidden: document.querySelector('.ack-badge').hidden,
  acksInSlot: document.querySelectorAll('.ack-slot .tool-ack').length,
}));
check('1 ack : data-count=1', s.count === '1');
check('1 ack : badge masqué (transparence sous le seuil)', s.badgeHidden === true);
check('1 ack : le nœud est dans le slot', s.acksInSlot === 1);

// 2e ack : bascule compacte, badge visible "2 étapes"
await page.evaluate(() => placeToolAck(window.__wrap, __mkAck(2)));
await page.waitForTimeout(400);   // laisse la transition ticker se terminer
s = await page.evaluate(() => ({
  count: document.querySelector('.ack-group').dataset.count,
  mode: document.querySelector('.ack-group').dataset.mode,
  badgeText: document.querySelector('.ack-badge').textContent,
  acksInSlot: document.querySelectorAll('.ack-slot .tool-ack').length,
}));
check('2 acks : data-count=2', s.count === '2');
check('2 acks : mode compact', s.mode === 'compact');
check('2 acks : badge "2 étapes"', s.badgeText === '2 étapes');
check('2 acks : un seul nœud visible dans le slot (ticker)', s.acksInSlot === 1);
await shot('01-compact-2acks.png');

// 3e et 4e ack : ticker continue, badge suit le compte réel (source unique)
await page.evaluate(() => placeToolAck(window.__wrap, __mkAck(3)));
await page.waitForTimeout(400);
await page.evaluate(() => placeToolAck(window.__wrap, __mkAck(4)));
await page.waitForTimeout(400);
s = await page.evaluate(() => ({
  count: document.querySelector('.ack-group').dataset.count,
  badgeText: document.querySelector('.ack-badge').textContent,
  acksInSlot: document.querySelectorAll('.ack-slot .tool-ack').length,
  visibleIntent: document.querySelector('.ack-slot .mcp-intent') &&
    document.querySelector('.ack-slot .mcp-intent').textContent,
}));
check('4 acks : badge "4 étapes"', s.badgeText === '4 étapes');
check('4 acks : slot montre le DERNIER ack (Étape 4)', s.visibleIntent === 'Étape 4');
check('4 acks : un seul nœud visible (pas d\'accumulation)', s.acksInSlot === 1);
await shot('02-compact-4acks.png');

// Toggle → liste : tous les acks empilés, chevrons individuels préservés
// (état muté tout de suite au clic, animation simultanée des deux panneaux
// ~220ms — animateGroupPanelSwap).
await page.click('.ack-badge');
await page.waitForTimeout(300);
s = await page.evaluate(() => ({
  mode: document.querySelector('.ack-group').dataset.mode,
  listVisible: !document.querySelector('.ack-list').hidden,
  slotHidden: document.querySelector('.ack-slot').hidden,
  itemsInList: document.querySelectorAll('.ack-list .tool-ack').length,
  chevrons: document.querySelectorAll('.ack-list .mcp-chevron').length,
  badgeText: document.querySelector('.ack-badge').textContent,
  ariaExpanded: document.querySelector('.ack-badge').getAttribute('aria-expanded'),
}));
check('toggle liste : mode list', s.mode === 'list');
check('toggle liste : .ack-list visible, .ack-slot masqué', s.listVisible && s.slotHidden);
check('toggle liste : les 4 acks sont empilés (rebuild depuis state)', s.itemsInList === 4);
check('toggle liste : chaque ack garde son chevron self-contained', s.chevrons === 4);
check('toggle liste : badge "▴ 4 étapes"', s.badgeText === '▴ 4 étapes');
check('toggle liste : aria-expanded=true', s.ariaExpanded === 'true');
await shot('03-list-mode.png');

// Chevron individuel en liste : déplie sans affecter les autres
await page.click('.ack-list .mcp-intent-row');
await page.waitForTimeout(100);
check('liste : un chevron déplié ouvre SEULEMENT son propre détail', await page.evaluate(() =>
  document.querySelectorAll('.ack-list .mcp-breadcrumb-detail:not([hidden])').length === 1));

// Retour compact : le slot montre à nouveau le dernier ack, liste repliée
await page.click('.ack-badge');
await page.waitForTimeout(300);
s = await page.evaluate(() => ({
  mode: document.querySelector('.ack-group').dataset.mode,
  slotVisible: !document.querySelector('.ack-slot').hidden,
  visibleIntent: document.querySelector('.ack-slot .mcp-intent') &&
    document.querySelector('.ack-slot .mcp-intent').textContent,
}));
check('retour compact : mode compact, slot revisible, Étape 4 affichée', s.mode === 'compact' && s.slotVisible && s.visibleIntent === 'Étape 4');

// Héritage slot-expanded (§3) : déplier le détail du courant, un nouvel ack
// arrive déjà déplié.
await page.click('.ack-slot .mcp-intent-row');
await page.waitForTimeout(100);
check('slot-expanded : détail du courant déplié', await page.evaluate(() =>
  !document.querySelector('.ack-slot .mcp-breadcrumb-detail').hasAttribute('hidden')));
await page.evaluate(() => placeToolAck(window.__wrap, __mkAck(5)));
await page.waitForTimeout(400);
check('slot-expanded : héritage — le nouvel ack (Étape 5) arrive déjà déplié', await page.evaluate(() => {
  const d = document.querySelector('.ack-slot .mcp-breadcrumb-detail');
  return d && !d.hasAttribute('hidden');
}));
await shot('04-slot-expanded-inherited.png');

// ── Réglage Animations : coupe le gate reduced-motion ────────────────────────
check('Animations : data-motion absent par défaut (système, pas reduced ici)', await page.evaluate(() =>
  !document.documentElement.hasAttribute('data-motion')));
await page.evaluate(() => selectMotion('reduced'));
check('Animations "Réduites" : html[data-motion=reduced] posé', await page.evaluate(() =>
  document.documentElement.getAttribute('data-motion') === 'reduced'));
check('Animations "Réduites" : motionReduced() true', await page.evaluate(() => motionReduced()));
await page.evaluate(() => selectMotion('normal'));
check('Animations "Normales" : attribut retiré', await page.evaluate(() =>
  !document.documentElement.hasAttribute('data-motion')));
check('Animations "Normales" : motionReduced() false', await page.evaluate(() => !motionReduced()));

// Réglage visible dans le drawer Apparence
await page.evaluate(() => openSettings());
await page.waitForSelector('#drawer.show');
await page.waitForTimeout(200);
check('drawer Apparence : seg-group #motion-mode présent avec 3 options', await page.evaluate(() =>
  document.querySelectorAll('#motion-mode .seg').length === 3));
await shot('05-settings-motion.png');

await browser.close();

console.log('');
if (consoleErrors.length) {
  console.log('Console errors:', JSON.stringify(consoleErrors, null, 2));
  failures.push('console errors');
} else {
  console.log('No console errors.');
}
console.log(failures.length ? `ÉCHEC — ${failures.length} vérification(s) : ${failures.join(' | ')}` : 'OK — toutes les vérifications passent');
process.exitCode = failures.length ? 1 : 0;
