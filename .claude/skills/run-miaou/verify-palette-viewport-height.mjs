#!/usr/bin/env node
// Vérification ponctuelle : à faible hauteur de viewport (715px, cas remonté
// laptop pro), .cmdk-box ne doit plus être plafonnée à 60vh fixe (fix
// max-height: min(60vh, calc(100vh - 12vh))) — la palette doit utiliser
// l'espace réellement disponible plutôt que couper artificiellement.
// Usage : node verify-palette-viewport-height.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-palette-viewport-height');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 715 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-done', { timeout: 10000 });
await page.waitForTimeout(1800);

const MOD = 'Meta';
await page.keyboard.press(MOD + '+KeyK');
await page.waitForTimeout(150);

const metrics = await page.evaluate(() => {
  const box = document.querySelector('.cmdk-box');
  const list = document.getElementById('cmdk-list');
  const r = box.getBoundingClientRect();
  return {
    boxHeight: r.height,
    boxBottom: r.bottom,
    viewportHeight: window.innerHeight,
    listScrollHeight: list.scrollHeight,
    listClientHeight: list.clientHeight,
    itemCount: document.querySelectorAll('#cmdk-list .cmdk-item').length,
  };
});
console.log(JSON.stringify(metrics, null, 2));

check('viewport = 715px', metrics.viewportHeight === 715);
check('boîte reste dans le viewport (bottom <= viewport)', metrics.boxBottom <= metrics.viewportHeight);
check('pas de scroll interne nécessaire pour la liste racine (tous les items tiennent, plus de coupe artificielle à 60vh)',
  metrics.listScrollHeight <= metrics.listClientHeight + 1);

await page.screenshot({ path: path.join(outDir, 'palette-715.png') });
console.log('  shot  palette-715.png');

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
