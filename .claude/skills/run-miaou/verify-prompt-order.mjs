#!/usr/bin/env node
// Le réglage `promptOrder` d'une carte de serveur API survit-il à un
// enregistrement, et déplace-t-il l'entrée `tool_definitions` du manifeste ?
//
// Aucun test QuickJS ne peut répondre : la chaîne traverse le DOM (pilule
// cfgPillSelect → input hidden → onSaveApiCard → localStorage), et c'est
// exactement là que le câblage casse en silence — le champ s'affiche, la valeur
// se perd à l'enregistrement.
//
// Usage: node verify-prompt-order.mjs [--headed]
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
};

// ── 1. Un serveur existe (seed direct : on teste la persistance du champ,
// pas le parcours de création, déjà couvert ailleurs).
await page.evaluate(() => {
  saveApiServers([normalizeApiServer({
    name: 'Sonde', url: 'http://localhost:1/v1', model: 'm',
  })]);
  const s = loadApiServers()[0];
  setActiveApiServerId(s.id);
});

const seeded = await page.evaluate(() => loadApiServers()[0].promptOrder);
check('un serveur neuf porte le défaut tools-first', seeded === 'tools-first', `reçu ${seeded}`);

// ── 2. La carte expose bien le champ, en édition.
await page.click('button[onclick="openSettings()"]');
await page.waitForSelector('#drawer.show', { timeout: 5000 });
await page.waitForTimeout(300);
// Les cartes ne se re-rendent pas sur un seed direct du store : forcer le rendu,
// sinon #api-list est vide et tout ce qui suit teste un DOM absent.
await page.evaluate(() => renderApiServers());
await page.waitForTimeout(200);

// Déplier la carte du serveur (bouton d'édition de la première carte).
const opened = await page.evaluate(() => {
  const card = document.querySelector('.api-card');
  if (!card) return 'aucune carte .api-card';
  const btn = card.querySelector('.api-edit') ||
              [...card.querySelectorAll('button')].find(b => /modifier|éditer/i.test(b.textContent));
  if (btn) { btn.click(); return 'ok'; }
  card.classList.add('is-editing');   // repli : la section d'édition est dans le DOM
  return 'ok (forcé)';
});
await page.waitForTimeout(200);

const fieldPresent = await page.evaluate(() =>
  !!document.querySelector('.api-card .api-prompt-order'));
check('le champ .api-prompt-order est dans la carte', fieldPresent, opened);

// ── 3. Régler sur 'tools-last' PAR LE GESTE RÉEL (clic sur l'option du menu),
// pas en forçant la valeur du hidden : c'est le geste qui est en cause.
const picked = await page.evaluate(() => {
  const card = document.querySelector('.api-card');
  const hidden = card.querySelector('.api-prompt-order');
  if (!hidden) return 'champ absent';
  const root = hidden.closest('.pill-select');
  if (!root) return 'pas de .pill-select parent';
  root.querySelector('.pill-select-btn').click();          // rend les options
  const opts = [...root.querySelectorAll('.model-opt')];
  const target = opts.find(o => /après/i.test(o.textContent));
  if (!target) return 'option « après » introuvable (' + opts.length + ' options)';
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return hidden.value;
});
check('le clic sur « Outils après » pose la valeur dans le hidden',
  picked === 'tools-last', `hidden = ${picked}`);

// ── 4. Enregistrer, puis RELIRE LE STORE (le point qui casse).
await page.evaluate(() => {
  const card = document.querySelector('.api-card');
  (card.querySelector('.api-save') ||
   [...card.querySelectorAll('button')].find(b => /enregistrer/i.test(b.textContent))).click();
});
await page.waitForTimeout(300);

const persisted = await page.evaluate(() => loadApiServers()[0].promptOrder);
check('la valeur survit à l\'enregistrement', persisted === 'tools-last', `store = ${persisted}`);

const active = await page.evaluate(() => activePromptOrder());
check('activePromptOrder() rend la valeur du serveur actif', active === 'tools-last', `reçu ${active}`);

// ── 5. Effet réel sur le manifeste : l'entrée tool_definitions se déplace.
const order = await page.evaluate(() => {
  const m = computeContextManifestNow();
  const src = m.entries.map(e => e.source);
  return { src, tools: src.indexOf('tool_definitions'), id: src.indexOf('identity_blurb') };
});
check('en tools-last, tool_definitions suit identity_blurb',
  order.tools > order.id && order.tools >= 0 && order.id >= 0,
  `tool_definitions@${order.tools}, identity_blurb@${order.id}`);

// ── 6. Repasser en tools-first et vérifier que ça rebascule (sinon on aurait pu
// mesurer un manifeste figé plutôt qu'un ordre réellement piloté).
const back = await page.evaluate(() => {
  const arr = loadApiServers();
  arr[0].promptOrder = 'tools-first';
  saveApiServers(arr.map(normalizeApiServer));
  const src = computeContextManifestNow().entries.map(e => e.source);
  return { tools: src.indexOf('tool_definitions'), id: src.indexOf('identity_blurb') };
});
check('en tools-first, tool_definitions précède identity_blurb',
  back.tools < back.id && back.tools >= 0,
  `tool_definitions@${back.tools}, identity_blurb@${back.id}`);

// ── 7. Parcours de CRÉATION : une carte neuve (addApiServerCard) porte-t-elle
// le champ, et sa valeur se persiste-t-elle ? Le littéral de la carte neuve ne
// passait pas par normalizeApiServer — un champ ajouté plus tard y manquerait
// en silence, sans que rien ne tombe.
const created = await page.evaluate(() => {
  addApiServerCard();
  const card = document.querySelector('.api-card.is-editing') || document.querySelector('.api-card');
  const hidden = card.querySelector('.api-prompt-order');
  if (!hidden) return { err: 'champ absent de la carte neuve' };
  const initial = hidden.value;
  const root = hidden.closest('.pill-select');
  root.querySelector('.pill-select-btn').click();
  const target = [...root.querySelectorAll('.model-opt')].find(o => /après/i.test(o.textContent));
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  card.querySelector('.api-name').value = 'Neuf';
  card.querySelector('.api-url').value = 'http://localhost:8080/v1';
  card.querySelector('.api-save').click();
  return { initial, saved: (loadApiServers().find(s => s.name === 'Neuf') || {}).promptOrder };
});
check('une carte NEUVE porte le champ, au défaut',
  created.initial === 'tools-first', `initial = ${created.initial || created.err}`);
check('la valeur choisie à la création se persiste',
  created.saved === 'tools-last', `store = ${created.saved}`);

await browser.close();

if (consoleErrors.length) {
  console.log('\nErreurs console :');
  consoleErrors.forEach((e) => console.log('  ' + e));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} contrôles verts`);
process.exit(failed.length ? 1 : 0);
