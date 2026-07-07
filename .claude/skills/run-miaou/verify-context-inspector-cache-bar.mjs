#!/usr/bin/env node
// Vérification ciblée Bbis (usage API réel) : rendu de la 2e barre "cache"
// quand le backend renvoie prompt_tokens_details.cached_tokens, alignement
// des lignes de la table (fix post-screenshot : .ctx-table td:first-child
// était en display:flex, cassait l'alignement de bordure + le border-top de
// la ligne Total), et présence de la ligne "Réponse (sortie)".
// Pilotage direct des fonctions globales (pas de vrai stream réseau), même
// principe que verify-context-inspector-batch.mjs.
// Usage : node verify-context-inspector-cache-bar.mjs [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = path.join(repoRoot, 'untracked/muscle');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// Profil éphémère : évite la dette connue (Chromium Playwright réutilise un
// profil persistant, IndexedDB peut y être à une version supérieure à celle
// attendue par le seed d'une exécution précédente → "requested version is
// less than existing version"). cf. HANDOVER.md "Environnement de test".
const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Seed : uniquement conversations/résumés/mémoires (localStorage, fonction
// seed() du fixture). seedSkills()/seedAttachmentResources() ouvrent IndexedDB
// en version 2 (tests/dev-seed.html), périmée face à resources.js (version 3
// actuelle) — dette pré-existante, hors scope ici. Pas besoin d'IDB pour cette
// vérification : le tool-ack/outil est simulé directement sur currentThread. ──
const seedHtml = fs.readFileSync(seedPath, 'utf8');
const fullScript = seedHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1];
// Coupe avant seedSkills()/seedAttachmentResources() (IndexedDB v2, périmé
// face à resources.js v3) : garde toutes les défs + seed() + son appel final.
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

// ── Simule un tour terminé avec usage API réel, cached_tokens compris ──────────
const state = await page.evaluate(() => {
  currentThread.push({ role: 'user', content: 'Question de test assez longue pour peser sur le total de tokens envoyés au modèle.' });
  currentThread.push({
    role: 'tool-ack', name: 'get_weather', args: { city: 'Brest' },
    result: 'x'.repeat(3000), ts: Date.now(), group: 'gtest',
  });
  currentThread.push({ role: 'assistant', content: 'Réponse de synthèse après outil.', model: 'test-model', ts: Date.now() });

  recomputeLastContextManifest([]);
  const usage = {
    prompt_tokens: 34397,
    completion_tokens: 167,
    total_tokens: 34564,
    prompt_tokens_details: { cached_tokens: 24000 },
  };
  applyUsageToLastManifest(usage);
  syncContextCounter();

  return {
    pill: document.getElementById('ctx-counter-label').textContent,
    manifestReal: !!_lastContextManifest.real,
    apiUsage: _lastContextManifest.apiUsage,
    totalTokens: _lastContextManifest.totalTokens,
  };
});

check('manifest calibré sur l\'usage API (real=true)', state.manifestReal);
check('pilule sans ≈ (chiffre réel)', !state.pill.startsWith('≈'));
check('total = prompt_tokens réel (+ tokens image éventuels)', state.totalTokens >= state.apiUsage.prompt_tokens);
console.log(`  info  pilule="${state.pill}" apiUsage=${JSON.stringify(state.apiUsage)}`);

await page.evaluate(() => openContextInspector());
await page.waitForSelector('#ctx-drawer.show');
await page.waitForTimeout(200);

const drawerState = await page.evaluate(() => {
  const barCache = document.getElementById('ctx-bar-cache');
  const hint = document.getElementById('ctx-source-hint').textContent;
  const rows = Array.from(document.querySelectorAll('#ctx-table-body tr')).map(r => r.textContent.trim());
  const totalRow = document.querySelector('#ctx-table-body tr.ctx-total');
  const outputRow = document.querySelector('#ctx-table-body tr.ctx-output');
  return {
    barCacheHidden: barCache.hidden,
    barCacheHasSeg: !!barCache.querySelector('.ctx-bar-seg'),
    barCacheSegWidth: barCache.querySelector('.ctx-bar-seg')?.style.width,
    hint,
    rows,
    totalText: totalRow ? totalRow.textContent : null,
    outputText: outputRow ? outputRow.textContent : null,
  };
});

check('2e barre cache visible (hidden=false) quand cached_tokens connu', drawerState.barCacheHidden === false);
check('2e barre cache a un segment avec une largeur proportionnelle', !!drawerState.barCacheSegWidth);
check('hint mentionne "tokens rapportés par l\'API"', drawerState.hint.includes('rapportés par l\'API'));
check('ligne "Réponse (sortie)" présente avec 167', !!drawerState.outputText && drawerState.outputText.includes('167'));
check('total sans ≈ dans la table', !!drawerState.totalText && !drawerState.totalText.includes('≈'));
console.log(`  info  hint="${drawerState.hint}"`);
console.log(`  info  cache seg width=${drawerState.barCacheSegWidth}`);

// ── Alignement des lignes (vérification box-model, pas juste visuelle) ─────────
const alignment = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#ctx-table-body tr'));
  return rows.map(r => {
    const tds = Array.from(r.children);
    const rects = tds.map(td => td.getBoundingClientRect());
    return {
      text: r.textContent.trim().slice(0, 30),
      tops: rects.map(rc => Math.round(rc.top)),
      bottoms: rects.map(rc => Math.round(rc.bottom)),
    };
  });
});
const misaligned = alignment.filter(r => new Set(r.tops).size > 1 || new Set(r.bottoms).size > 1);
check('toutes les cellules d\'une même ligne partagent le même top/bottom (pas d\'escalier)', misaligned.length === 0);
if (misaligned.length) console.log('  info  lignes désalignées :', JSON.stringify(misaligned, null, 2));

await page.screenshot({ path: path.join(outDir, 'context-inspector-cache-bar.png') });
console.log('  shot  ' + path.join(outDir, 'context-inspector-cache-bar.png'));

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
