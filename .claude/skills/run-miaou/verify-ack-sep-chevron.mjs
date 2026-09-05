#!/usr/bin/env node
// Vérification du remplacement du ':' par un chevron coloré '›' (.ack-sep,
// ex-.mcp-call-sep renommé générique) dans les acks "Action : cible" sans
// intent, et de l'ajout de la taille human-readable sur resource_stored.
//
// Usage : node verify-ack-sep-chevron.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-ack-sep-chevron');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

await page.evaluate(() => {
  document.getElementById('thread').innerHTML = '';
  const w = startAssistantMessage('test-model');
  placeToolAck(w, { id: 'r1', role: 'tool-ack', kind: 'resource_stored', resourceName: 'notes.txt', size: 2048 }, false);
  placeToolAck(w, { id: 'r2', role: 'tool-ack', kind: 'resource_presented', resourceName: 'photo.png' }, false);
  placeToolAck(w, { id: 'r3', role: 'tool-ack', kind: 'files_read', resourceName: 'guide.md' }, false);
  placeToolAck(w, { id: 'r4', role: 'tool-ack', kind: 'skill_read', title: 'ma-skill' }, false);
  placeToolAck(w, { id: 'r5', role: 'tool-ack', kind: 'file_promote', resourceName: 'archive.zip' }, false);
  placeToolAck(w, { id: 'r6', role: 'tool-ack', kind: 'tool_failed', name: 'miaou__foo', message: 'Erreur test' }, false);
});
await page.waitForTimeout(150);
await page.click('.ack-badge');
await page.waitForTimeout(350);

const data = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('.ack-list .tool-ack')).map(a => ({
    kind: a.className.match(/ack-(\w+)/)[1],
    hasSep: !!a.querySelector('.ack-sep'),
    sepText: a.querySelector('.ack-sep') ? a.querySelector('.ack-sep').textContent : null,
    sepColor: a.querySelector('.ack-sep') ? getComputedStyle(a.querySelector('.ack-sep')).color : null,
    labelText: a.querySelector('.ack-label').textContent,
    noColon: !a.querySelector('.ack-label').textContent.includes(' : '),
  }));
});

for (const d of data) {
  check(d.kind + ' : porte un .ack-sep', d.hasSep);
  check(d.kind + ' : le séparateur est bien "›"', d.sepText === '›');
  check(d.kind + ' : plus de " : " littéral dans le label', d.noColon);
}
// Unité FRANÇAISE : l'ack est une surface d'interface, donc humanSize (« Ko »).
// modelSize (« KB ») est réservé aux descripteurs adressés au modèle, figé pour
// ne pas invalider les descripteurs déjà persistés (cf. resources.js).
check('resource_stored : taille human-readable affichée (2048 → "2.0 Ko")',
  data[0].labelText.includes('2.0 Ko'));

const accentCheck = await page.evaluate(() => {
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue('--accent').trim();
  return { accent, sepColors: Array.from(document.querySelectorAll('.ack-sep')).map(s => getComputedStyle(s).color) };
});
console.log('  info  --accent =', accentCheck.accent, ' sep colors =', JSON.stringify([...new Set(accentCheck.sepColors)]));
check('tous les .ack-sep partagent la même couleur (teinte accent)',
  new Set(accentCheck.sepColors).size === 1);

await page.screenshot({ path: path.join(outDir, 'acks-chevron.png') });
console.log('  shot  acks-chevron.png');

check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) console.log('\nErreurs console :\n' + consoleErrors.join('\n'));

console.log('\n' + '─'.repeat(60));
console.log(failures.length ? `  ÉCHEC — ${failures.length} :\n   - ` + failures.join('\n   - ')
                            : '  OK — toutes les vérifications passent');
await browser.close();
process.exit(failures.length ? 1 : 0);
