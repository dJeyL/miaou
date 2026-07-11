#!/usr/bin/env node
// Vérification de l'overlay de préchargement (boot) :
//   - overlay présent et opaque au tout premier paint (masque le montage UI),
//   - logo + yeux inline présents,
//   - délai minimum d'affichage respecté (BOOT_MIN_MS ≈ 950ms) même si init()
//     finit vite,
//   - estompé (.boot-done) puis invisible une fois l'app en place,
//   - reduced-motion : overlay quand même retiré.
// Usage : node verify-boot-overlay.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-boot');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });

// ── 1. Overlay opaque au premier paint + délai minimum ───────────────────────
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const t0 = Date.now();
await page.goto('file://' + distPath, { waitUntil: 'commit' });
// Aussi tôt que possible : l'overlay doit exister et être opaque.
await page.waitForSelector('#boot-overlay', { timeout: 3000 });
const earlyState = await page.evaluate(() => {
  const el = document.getElementById('boot-overlay');
  const cs = getComputedStyle(el);
  return {
    present: !!el,
    opaque: cs.opacity === '1' && !el.classList.contains('boot-done'),
    hasLogo: !!el.querySelector('.boot-logo'),
    eyes: el.querySelectorAll('.boot-eye').length,
    z: cs.zIndex,
  };
});
check('overlay présent au premier paint', earlyState.present);
check('overlay opaque (masque le montage)', earlyState.opaque);
check('logo MIAOU inline présent', earlyState.hasLogo);
check('deux yeux (.boot-eye) présents', earlyState.eyes === 2);
check('overlay au-dessus de tout (z-index 200)', earlyState.z === '200');
// Bug corrigé : au tout premier paint (avant le start du blink à 0.7s), les yeux
// sont OUVERTS (scaleY ≈ 1), pas figés mi-clos par un delay négatif.
const eyeScaleEarly = await page.evaluate(() => {
  const eye = document.querySelector('.boot-eye');
  const m = new DOMMatrixReadOnly(getComputedStyle(eye).transform);
  return m.d;   // scaleY
});
check(`yeux ouverts au premier paint (scaleY≈1, mesuré ${eyeScaleEarly.toFixed(2)})`, eyeScaleEarly > 0.8);
await page.screenshot({ path: path.join(outDir, '01-boot-open-eyes.png') });
console.log('  shot  01-boot-open-eyes.png');
// Capture pendant le premier double-clin (~1.0s : blink démarré à 0.7s).
await page.waitForTimeout(1000 - (Date.now() - t0));
await page.screenshot({ path: path.join(outDir, '01b-boot-blink.png') });
console.log('  shot  01b-boot-blink.png');

// Attendre l'estompage (.boot-done) et mesurer le délai depuis goto.
await page.waitForFunction(() =>
  document.getElementById('boot-overlay').classList.contains('boot-done'), { timeout: 6000 });
const shownMs = Date.now() - t0;
// Minimum calé sur le début RÉEL des animations (.boot-ready, ~après paint) +
// 1800ms : le double-clin (fin ~1.7s après ready) joue toujours avant l'estompage.
check(`overlay tenu assez longtemps pour le blink (mesuré ${shownMs}ms ≥ 1750)`, shownMs >= 1750);
// Après la transition d'opacité (320ms), l'overlay est invisible.
await page.waitForTimeout(450);
check('overlay invisible après estompage (visibility hidden / opacity 0)', await page.evaluate(() => {
  const cs = getComputedStyle(document.getElementById('boot-overlay'));
  return cs.opacity === '0' || cs.visibility === 'hidden';
}));
check('app visible derrière (composer présent et focusable)', await page.evaluate(() =>
  !!document.getElementById('composer-text')));
await page.screenshot({ path: path.join(outDir, '02-after-boot.png') });
console.log('  shot  02-after-boot.png');
await page.close();

// ── 2. Reduced-motion : overlay quand même retiré ────────────────────────────
const page2 = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
await page2.goto('file://' + distPath, { waitUntil: 'commit' });
await page2.waitForSelector('#boot-overlay', { timeout: 3000 });
await page2.waitForFunction(() =>
  document.getElementById('boot-overlay').classList.contains('boot-done'), { timeout: 6000 });
await page2.waitForTimeout(200);
check('reduced-motion : overlay retiré (boot-done posé)', await page2.evaluate(() =>
  document.getElementById('boot-overlay').classList.contains('boot-done')));
await page2.close();

await browser.close();

console.log('');
console.log(failures.length ? `ÉCHEC — ${failures.length} : ${failures.join(' | ')}` : 'OK — toutes les vérifications passent');
process.exitCode = failures.length ? 1 : 0;
