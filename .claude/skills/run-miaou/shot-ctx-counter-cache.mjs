#!/usr/bin/env node
// Screenshot ciblé : liseré de cache sur la pilule #ctx-counter (composer),
// même setup que verify-context-inspector-cache-bar.mjs mais cadré sur la
// pilule seule pour vérification visuelle rapide.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = path.join(repoRoot, 'untracked/muscle');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
const page = await context.newPage();

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

const seedHtml = fs.readFileSync(seedPath, 'utf8');
const fullScript = seedHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1];
const seedOnlyScript = fullScript
  .replace(/\nseedSkills\(\);\nseedAttachmentResources\(\);\n$/, '')
  .replace(/function seedSkills\(\)[\s\S]*$/, 'seed();');
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'log'; d.hidden = true;
  document.body.appendChild(d);
});
await page.evaluate(seedOnlyScript);
await page.waitForFunction(() => document.getElementById('log').textContent.includes('conversation(s)'), { timeout: 5000 });
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);

await page.click('.conv-title:text("Multi-outils : mémoire + historique")');
await page.waitForTimeout(300);

const state = await page.evaluate(() => {
  currentThread.push({ role: 'user', content: 'Question de test assez longue pour peser sur le total de tokens envoyés au modèle.' });
  currentThread.push({ role: 'assistant', content: 'Réponse de synthèse.', model: 'test-model', ts: Date.now() });
  recomputeLastContextManifest([]);
  const usage = {
    prompt_tokens: 34397,
    completion_tokens: 167,
    total_tokens: 34564,
    prompt_tokens_details: { cached_tokens: 24000 },
  };
  applyUsageToLastManifest(usage);
  syncContextCounter();
  const cacheEl = document.getElementById('ctx-counter-cache');
  return {
    pill: document.getElementById('ctx-counter-label').textContent,
    cacheHidden: cacheEl.hidden,
    cacheWidth: cacheEl.style.width,
    cacheTitle: cacheEl.title,
  };
});
console.log('pill:', state.pill);
console.log('cache liseré hidden:', state.cacheHidden, 'width:', state.cacheWidth, 'title:', state.cacheTitle);

const pill = await page.$('#ctx-counter');
await pill.screenshot({ path: path.join(outDir, 'ctx-counter-cache-closeup.png') });

// Zoom x4 pour bien voir le liseré de 2px
const box = await pill.boundingBox();
await page.evaluate(({ w, h }) => {
  document.body.style.zoom = '4';
}, { w: box.width, h: box.height });
await page.waitForTimeout(150);
const pillZoomed = await page.$('#ctx-counter');
await pillZoomed.screenshot({ path: path.join(outDir, 'ctx-counter-cache-closeup-4x.png') });

await browser.close();
console.log('shot: ' + path.join(outDir, 'ctx-counter-cache-closeup.png'));
console.log('shot: ' + path.join(outDir, 'ctx-counter-cache-closeup-4x.png'));
