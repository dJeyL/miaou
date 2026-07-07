#!/usr/bin/env node
// Vérification du scroll conditionnel pendant le streaming (un seul lancement) :
//   - streamInto() ne doit PAS ramener la vue en bas si l'utilisateur a scrollé
//     vers le haut avant le delta suivant (isAtBottom() === false),
//   - il doit continuer à suivre si l'utilisateur est resté en bas,
//   - il doit "réembrayer" (suivre à nouveau) si l'utilisateur remonte tout en
//     bas manuellement pendant qu'un streaming est encore en cours.
// Usage : node verify-autoscroll.mjs [--headed]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// Fabrique assez de bulles pour que #messages ait un vrai overflow, puis
// démarre une bulle assistant "en streaming" via l'API interne (startAssistantMessage).
await page.evaluate(() => {
  for (let i = 0; i < 30; i++) {
    appendUserMessage('Message de remplissage numéro ' + i, Date.now());
  }
  window.__wrap = startAssistantMessage('test-model', undefined);
});

const scrollState = () => page.evaluate(() => {
  const m = document.getElementById('messages');
  return { scrollTop: m.scrollTop, scrollHeight: m.scrollHeight, clientHeight: m.clientHeight, atBottom: isAtBottom() };
});

// ── 1. En bas au démarrage (startAssistantMessage force le scroll) ──────────
let s = await scrollState();
check('après startAssistantMessage : vue en bas', s.atBottom);

// ── 2. Deltas successifs alors qu'on reste en bas → doit continuer à suivre ─
let text = '';
for (let i = 0; i < 20; i++) {
  text += 'Ligne de texte générée en streaming numéro ' + i + '.\n';
  await page.evaluate((t) => { streamInto(window.__wrap, t); }, text);
  await page.waitForTimeout(110);   // laisse passer le throttle de 90ms
}
s = await scrollState();
check('streaming en restant en bas : autoscroll actif', s.atBottom);

// ── 3. L'utilisateur remonte manuellement pendant le streaming ──────────────
await page.evaluate(() => { document.getElementById('messages').scrollTop = 0; });
let beforeTop = (await scrollState()).scrollTop;
check('scroll manuel vers le haut effectif', beforeTop === 0);

for (let i = 0; i < 15; i++) {
  text += 'Nouvelle ligne pendant que l\'utilisateur lit plus haut ' + i + '.\n';
  await page.evaluate((t) => { streamInto(window.__wrap, t); }, text);
  await page.waitForTimeout(110);
}
s = await scrollState();
check('streaming pendant lecture en haut : vue NON arrachée (scrollTop toujours ~0)', s.scrollTop < 5);
check('isAtBottom() reflète bien "pas en bas"', !s.atBottom);

// ── 4. L'utilisateur redescend tout en bas → l'autoscroll doit réembrayer ───
await page.evaluate(() => {
  const m = document.getElementById('messages');
  m.scrollTop = m.scrollHeight;
});
s = await scrollState();
check('retour manuel en bas : isAtBottom() redevient true', s.atBottom);

for (let i = 0; i < 10; i++) {
  text += 'Ligne après réembrayage ' + i + '.\n';
  await page.evaluate((t) => { streamInto(window.__wrap, t); }, text);
  await page.waitForTimeout(110);
}
s = await scrollState();
check('après réembrayage, le streaming suit à nouveau le bas', s.atBottom);

// ── 5. finalizeAssistant respecte aussi le comportement conditionnel ────────
await page.evaluate(() => { document.getElementById('messages').scrollTop = 0; });
await page.evaluate((t) => { finalizeAssistant(window.__wrap, t); }, text);
await page.waitForTimeout(50);
s = await scrollState();
check('finalizeAssistant : ne force pas le scroll si l\'utilisateur avait remonté', s.scrollTop < 5);

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
