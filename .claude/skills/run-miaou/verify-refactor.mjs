#!/usr/bin/env node
// Vérification visuelle post-refactor (un seul lancement) :
//   - seed des fixtures dev-seed.html injecté DANS la page dist (même origine),
//   - sidebar (épinglé, sections), acks enrichis (intent 2 niveaux, erreur,
//     multi-outils + conv_ref), displayText slash-skill, raisonnement,
//   - suppression armée (sidebar + carte skill), cartes cfg (API/MCP/skills),
//   - dropdown pilule transport MCP (cfgPillSelect) + devinette d'URL,
//   - thème clair résolu en JS.
// Usage : node verify-refactor.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots');
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
await page.waitForTimeout(400);   // loadSkillsCache + rendus initiaux

// ── 1. Sidebar : conversations + section Épinglé ─────────────────────────────
const sidebar = await page.evaluate(() => ({
  convs: document.querySelectorAll('#conv-list .conv').length,
  sections: Array.from(document.querySelectorAll('#conv-list .conv-section')).map(s => s.textContent),
}));
check('sidebar : 20 conversations seedées', sidebar.convs === 20);
check('sidebar : section « Épinglé » en tête', sidebar.sections[0] === 'Épinglé');

// ── 2. seed-18 : deux acks enrichis + conv_ref cliquable ─────────────────────
await page.click('.conv-title:text("Multi-outils : mémoire + historique")');
await page.waitForTimeout(300);
const s18 = await page.evaluate(() => ({
  acks: document.querySelectorAll('#thread .tool-ack').length,
  intents: document.querySelectorAll('#thread .mcp-intent-row').length,
  undo: document.querySelectorAll('#thread .ack-undo').length,
  convLink: !!document.querySelector('#thread a[href^="#miaou-conv:"]'),
}));
check('seed-18 : 2 acks dans la bulle', s18.acks === 2);
// Un seul rendu deux-niveaux attendu : memory_create n'a pas de renderLabel
// (label texte simple même avec intent) ; seul conversation_read l'a ici.
check('seed-18 : rendu intent à deux niveaux (conversation_read seul)', s18.intents === 1);
check('seed-18 : bouton annuler sur le memory_create', s18.undo >= 1);
check('seed-18 : conv_ref rendu en lien', s18.convLink);
// déplie le détail technique du premier ack
await page.click('#thread .mcp-intent-row');
await page.waitForTimeout(150);
await shot('01-seed18-acks-convref.png');

// ── 3. seed-16 : mcp_call + raisonnement ; seed-17 : ack en erreur ───────────
await page.click('.conv-title:text("Météo Brest via outil MCP")');
await page.waitForTimeout(300);
await page.click('#thread .reasoning-toggle');
await page.click('#thread .mcp-intent-row');
await page.waitForTimeout(150);
const s16 = await page.evaluate(() => ({
  reasoningVisible: !!document.querySelector('#thread .reasoning:not([hidden])'),
  breadcrumb: (document.querySelector('#thread .mcp-breadcrumb-detail') || {}).textContent || '',
}));
check('seed-16 : panneau raisonnement déplié', s16.reasoningVisible);
check('seed-16 : breadcrumb meteo › get_weather', s16.breadcrumb.includes('get_weather'));
await shot('02-seed16-reasoning-intent.png');

await page.click('.conv-title:text("Appel MCP en échec — timeout")');
await page.waitForTimeout(300);
check('seed-17 : ack en erreur (.ack-error)', await page.evaluate(() =>
  !!document.querySelector('#thread .tool-ack.ack-error')));

// ── 4. seed-19 : displayText (littéral affiché, pas le corps baké) ───────────
await page.click('.conv-title:text("Slash-skill : revue de code")');
await page.waitForTimeout(300);
const s19 = await page.evaluate(() => document.querySelector('#thread .msg.user .body').textContent);
check('seed-19 : bulle user = littéral /revue…', s19.startsWith('/revue'));
check('seed-19 : corps de skill invisible', !s19.includes('--- skill:'));

// ── 5. Suppression armée : poubelle sidebar ──────────────────────────────────
const firstConv = page.locator('#conv-list .conv').last();   // une non-active
await firstConv.hover();
await firstConv.locator('.conv-del').click();
check('conv-del : armé après 1er clic', await page.evaluate(() =>
  !!document.querySelector('#conv-list .conv-del.armed')));
await shot('03-conv-del-armed.png');
await page.waitForTimeout(3000);
const afterDisarm = await page.evaluate(() => ({
  armed: !!document.querySelector('#conv-list .conv-del.armed'),
  convs: document.querySelectorAll('#conv-list .conv').length,
}));
check('conv-del : désarmé après timeout, rien supprimé', !afterDisarm.armed && afterDisarm.convs === 20);

// ── 6. Réglages + serveurs API (cartes cfg) ──────────────────────────────────
await page.evaluate(() => openSettings());
await page.waitForSelector('#drawer.show');
await page.waitForTimeout(350);
await shot('04-settings.png');
await page.evaluate(() => { closeSettings(); openApiServers(); });
await page.waitForSelector('#api-drawer.show');
await page.waitForTimeout(350);
const api = await page.evaluate(() => ({
  cards: document.querySelectorAll('#api-list .cfg-card').length,
  active: !!document.querySelector('#api-list .api-status.active'),
}));
check('API : carte migrée « Par défaut » présente et active', api.cards >= 1 && api.active);
await page.click('#api-list .drawer-btn:text("Modifier")');
await page.waitForTimeout(200);
await shot('05-api-card-edit.png');

// ── 7. MCP : carte neuve, pilule transport + devinette d'URL ─────────────────
await page.evaluate(() => { closeApiServers(); openMcpServers(); });
await page.waitForSelector('#mcp-drawer.show');
await page.waitForTimeout(350);
await page.evaluate(() => addMcpServerCard());
const tLabel = () => page.evaluate(() =>
  document.querySelector('#mcp-list .cfg-pill-select .composer-reasoning-btn span').textContent);
check('MCP : pilule transport par défaut streamable-http', (await tLabel()) === 'streamable-http');
await page.fill('#mcp-list .mcp-url', 'https://host/sse');
check('MCP : devinette d\'URL → sse (différé)', (await tLabel()) === 'sse (différé)');
await page.click('#mcp-list .cfg-pill-select .composer-reasoning-btn');
await page.waitForTimeout(150);
check('MCP : menu pilule ouvert avec coche', await page.evaluate(() =>
  !!document.querySelector('#mcp-list .cfg-pill-select .model-menu.show .model-opt.selected')));
await shot('06-mcp-transport-pill.png');
// choix explicite → touché → la devinette n'écrase plus
await page.locator('#mcp-list .cfg-pill-select .model-opt', { hasText: 'streamable-http' }).first().dispatchEvent('mousedown');
await page.fill('#mcp-list .mcp-url', 'https://host2/sse');
check('MCP : choix explicite non écrasé par la devinette', (await tLabel()) === 'streamable-http');
check('MCP : input hidden .mcp-transport porte la valeur', await page.evaluate(() =>
  document.querySelector('#mcp-list .mcp-transport').value === 'streamable-http'));

// ── 8. Skills : cartes seedées + suppression armée « Confirmer ? » ──────────
await page.evaluate(() => { closeMcpServers(); openSkills(); });
await page.waitForSelector('#skills-drawer.show');
await page.waitForTimeout(350);
const skills = await page.evaluate(() => document.querySelectorAll('#skill-list .cfg-card').length);
check('skills : 2 cartes seedées (IDB)', skills === 2);
await page.locator('#skill-list .drawer-btn:text("Modifier")').first().click();
await page.waitForTimeout(200);
await page.locator('#skill-list .skill-del').first().click();
check('skill-del : libellé « Confirmer ? » armé', await page.evaluate(() =>
  document.querySelector('#skill-list .skill-del.armed') !== null &&
  document.querySelector('#skill-list .skill-del').textContent === 'Confirmer ?'));
await shot('07-skill-del-armed.png');
await page.waitForTimeout(3000);
check('skill-del : désarmé, libellé restauré, rien supprimé', await page.evaluate(() =>
  !document.querySelector('#skill-list .skill-del.armed') &&
  document.querySelector('#skill-list .skill-del').textContent === 'Supprimer' &&
  document.querySelectorAll('#skill-list .cfg-card').length === 2));

// ── 9. Thème clair (résolu en JS) ────────────────────────────────────────────
await page.evaluate(() => { closeSkills(); selectTheme('light'); });
await page.click('.conv-title:text("Multi-outils : mémoire + historique")');
await page.waitForTimeout(300);
check('thème : data-theme=light posé', await page.evaluate(() =>
  document.documentElement.getAttribute('data-theme') === 'light'));
await shot('08-light-theme.png');

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
