#!/usr/bin/env node
// Vérification visuelle Spaces (lot C, un seul lancement) :
//   - sélecteur sidebar (Général + Pro seedés), badge topbar masqué en default,
//   - switch de Space (herméticité sidebar/recherche/outils bidirectionnelle),
//   - création d'un Space → bascule immédiate + écran ouvert (retour utilisateur),
//   - description ajoutée après le prompt système global (jamais substituée),
//   - mémoire scopée + promotion vers profil,
//   - suppression D6 avec cascade et comptes.
// Usage : node verify-spaces-batch.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-spaces');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Seed : script de dev-seed.html évalué dans la page dist (même origine) ──
const seedHtml = fs.readFileSync(seedPath, 'utf8');
const seedScript = seedHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1];
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'log'; d.hidden = true;
  document.body.appendChild(d);
});
await page.evaluate(seedScript);
await page.waitForFunction(() => document.getElementById('log').textContent.includes('skill(s)'), { timeout: 5000 });
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);

// ── 1. Sélecteur sidebar : Général (actif) + Pro seedés ──────────────────────
check('sélecteur : label "Général" au boot (default Space)', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Général'));
await page.click('#space-select-btn');
await page.waitForTimeout(150);
const menuOpts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#space-menu .model-opt .space-opt-name')).map(e => e.textContent));
check('menu : Général + Pro listés', menuOpts.includes('Général') && menuOpts.includes('Pro'));
await shot('01-space-menu.png');

// ── 2. Badge topbar masqué en default Space, sidebar repliée ────────────────
await page.evaluate(() => { document.getElementById('space-menu').classList.remove('show'); toggleSidebar(); });
await page.waitForTimeout(300);
check('badge topbar masqué en default Space (sidebar repliée)', await page.evaluate(() =>
  document.getElementById('topbar-space-badge').hidden === true));
await shot('02-default-space-badge-hidden.png');
await page.evaluate(() => toggleSidebar());
await page.waitForTimeout(300);

// ── 3. Switch vers Pro : herméticité sidebar ─────────────────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .space-opt-name', { hasText: 'Pro' }).click();
await page.waitForTimeout(300);
check('switch : label devient "Pro"', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Pro'));
const proSidebar = await page.evaluate(() => document.querySelectorAll('#conv-list .conv').length);
check('sidebar Pro : seulement 5 conversations (seed-01..05)', proSidebar === 5);
await page.evaluate(() => toggleSidebar());
await page.waitForTimeout(300);
check('badge topbar visible en Space "Pro" (sidebar repliée)', await page.evaluate(() => {
  const b = document.getElementById('topbar-space-badge');
  return b.hidden === false && b.textContent === 'Pro';
}));
await shot('03-pro-space-badge-visible.png');
await page.evaluate(() => toggleSidebar());
await page.waitForTimeout(300);

// ── 4. Herméticité outils modèle (list_conversations depuis "Pro") ───────────
const toolList = await page.evaluate(() => JSON.parse(callTool('list_conversations', {}).content[0].text));
check('list_conversations (Pro) : 5 résultats, aucun seed-06+', toolList.length === 5 &&
  toolList.every(e => Number(e.id.replace('seed-', '')) <= 5));

// ── 5. Recherche sidebar hermétique ──────────────────────────────────────────
await page.fill('#conv-search', 'asyncio');   // titre présent seulement dans seed-02 (Pro) — devrait matcher ici
await page.waitForTimeout(150);
const foundInPro = await page.evaluate(() => document.querySelectorAll('#conv-list .conv').length);
check('recherche "asyncio" trouve un résultat dans Pro (seed-02 y appartient)', foundInPro >= 1);
await page.evaluate(() => clearConvSearch());

// ── 6. Retour à Général : conversations Pro invisibles ───────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .space-opt-name', { hasText: 'Général' }).click();
await page.waitForTimeout(300);
const generalSidebar = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#conv-list .conv .conv-title')).map(e => e.textContent));
// Titres EXACTS des 5 conversations Space Pro (seed-01..05) — pas un match flou
// sur un mot qui apparaîtrait aussi dans une conv hors-Space (ex. "Rappel —
// configuration Caddy" est une conv default Space distincte de seed-01).
const proTitles = ["Reverse proxy Caddy et Let's Encrypt", 'Asyncio — event loop bloqué dans FastAPI',
  'Git rebase interactif avant PR', 'Optimisation requête PostgreSQL lente', 'Docker Compose — communication inter-services'];
check('sidebar Général : ne contient aucun des 5 titres exacts du Space Pro',
  !generalSidebar.some(t => proTitles.includes(t)));

// ── 7. Mémoire scopée + promotion ─────────────────────────────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .space-opt-name', { hasText: 'Pro' }).click();
await page.waitForTimeout(300);
await page.click('#space-select-btn');
await page.waitForTimeout(150);
// Général reste toujours en tête du menu (unshift à la migration) : cibler par nom, pas par position.
await page.locator('#space-menu .model-opt', { hasText: 'Pro' }).locator('.space-opt-edit').click();
await page.waitForSelector('#space-drawer.show');
await page.waitForTimeout(350);
const proMemCount = await page.evaluate(() => document.querySelectorAll('#space-memory-list .mem-item').length);
check('écran Space Pro : souvenirs scopés listés (mem-seed-01/02/03)', proMemCount >= 2);
await shot('04-space-screen-pro.png');
const hasPromote = await page.evaluate(() =>
  !!document.querySelector('#space-memory-list .drawer-btn:not(.danger)'));
check('bouton "Promouvoir en profil" présent sur un souvenir Space', hasPromote);

// ── 8. Description ajoutée après le prompt global (jamais substituée) ───────
await page.fill('#space-description-input', 'Contexte de test Playwright pour la description.');
await page.evaluate(() => onSpaceFormInput());
await page.click('#space-save-btn');
await page.waitForTimeout(200);
check('drawer Space fermé après Enregistrer', await page.evaluate(() =>
  !document.getElementById('space-drawer').classList.contains('show')));
const sysMsg = await page.evaluate(() => buildSystemMessage().content);
check('system message contient le prompt global ET la description du Space (concaténés)',
  sysMsg.includes('Contexte de test Playwright pour la description.'));
await shot('05-space-saved-closed.png');

// ── 9. Création d'un Space : bascule immédiate + écran ouvert (retour Julien) ─
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .model-opt.space-new').click();
await page.waitForTimeout(300);
check('création : bascule immédiate (label ≠ Général/Pro)', await page.evaluate(() => {
  const l = document.getElementById('space-select-label').textContent;
  return l !== 'Général' && l !== 'Pro';
}));
check('création : écran Space ouvert directement (pas besoin de rouvrir)', await page.evaluate(() =>
  document.getElementById('space-drawer').classList.contains('show')));
check('création : champ nom focus + contenu sélectionné', await page.evaluate(() => {
  const input = document.getElementById('space-name-input');
  return document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
}));
await shot('06-new-space-created-and-open.png');
await page.fill('#space-name-input', 'Test Playwright');
await page.evaluate(() => onSpaceFormInput());
await page.click('#space-save-btn');
await page.waitForTimeout(200);
check('renommage : label sidebar suit le nouveau nom', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Test Playwright'));

// ── 10. Suppression D6 : cascade + comptes, arm-then-run ─────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .model-opt', { hasText: 'Test Playwright' }).locator('.space-opt-edit').click();
await page.waitForSelector('#space-drawer.show');
await page.waitForTimeout(300);
const delLabelBefore = await page.evaluate(() => document.getElementById('space-delete-btn').textContent);
check('bouton suppression affiche les comptes (0 conv., 0 souvenir — Space neuf)', /0 conv\.,\s*0 souvenir/.test(delLabelBefore));
await page.click('#space-delete-btn');
await page.waitForTimeout(100);
check('suppression : armée après 1er clic', await page.evaluate(() =>
  document.getElementById('space-delete-btn').classList.contains('armed')));
await shot('07-space-delete-armed.png');
await page.click('#space-delete-btn');
await page.waitForTimeout(300);
check('suppression : Space disparu, bascule vers Général', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Général' &&
  !document.getElementById('space-drawer').classList.contains('show')));

// ── 11. Default Space : pas de bouton suppression ────────────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .model-opt', { hasText: 'Général' }).locator('.space-opt-edit').click();
await page.waitForSelector('#space-drawer.show');
await page.waitForTimeout(300);
check('default Space : bouton suppression absent (hidden)', await page.evaluate(() =>
  document.getElementById('space-delete-btn').hidden === true));
check('default Space : champ nom désactivé', await page.evaluate(() =>
  document.getElementById('space-name-input').disabled === true));
await shot('08-default-space-no-delete.png');

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
