#!/usr/bin/env node
// Vérification du lot U-1 (conversations & résumés en IndexedDB) — un lancement.
//
// U-1 est un lot d'infrastructure : son critère de réussite est un INVARIANT
// (rien ne bouge à l'écran, la persistance change de support), pas un pixel.
// Les tests QuickJS ne couvrent NI l'IDB NI le câblage — or U-1 est
// exactement de l'IDB et du câblage. D'où ce script : il vérifie ce que le
// runner ne peut structurellement pas voir.
//
// Scénarios :
//   1. les stores IDB v4 existent (conversations + index by_space, summaries)
//   2. une conversation sauvegardée atterrit RÉELLEMENT dans IDB
//   3. localStorage ne porte plus les conversations (U-1 n'écrit plus là)
//   4. hydratation au boot : après reload, la sidebar retrouve ses entrées
//   5. les messages d'une conversation rouverte reviennent (warmConversation)
//   6. NON-RÉGRESSION D'ÉCRASEMENT : épingler une conversation FROIDE ne vide
//      pas ses messages (persistConversationField ne touche jamais `messages`)
//   7. idem pour un renommage de titre sur conversation froide
//   8. éviction LRU : au-delà du plafond, les métadonnées SURVIVENT (étage 1
//      permanent) même quand les messages sont évincés (étage 2 borné)
//   9. le résumé d'une conversation persiste et se relit après reload
//
// Usage : node verify-conv-idb.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-conv-idb');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.addInitScript(() => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',
    }));
  } catch (e) {}
});

const boot = async () => {
  await page.goto('file://' + distPath);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  // L'overlay de boot masque l'écran jusqu'à finishBoot() : sans cette attente
  // on capture le préchargement (cf. project_boot_overlay_hides_playwright_shots).
  await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
};

await boot();

// ── 1. Schéma IDB v4 ────────────────────────────────────────────────────────
const schema = await page.evaluate(async () => {
  const db = await openConvDB();
  const stores = Array.from(db.objectStoreNames);
  const tx = db.transaction('conversations', 'readonly');
  const idx = Array.from(tx.objectStore('conversations').indexNames);
  return { version: db.version, stores, idx };
});
check('base ouverte en v4', schema.version === 4);
check('store `conversations` présent', schema.stores.includes('conversations'));
check('store `summaries` présent', schema.stores.includes('summaries'));
check('stores v2/v3 préservés (resources + skills)',
  schema.stores.includes('resources') && schema.stores.includes('skills'));
check('index by_space sur conversations', schema.idx.includes('by_space'));

// ── 2-3. Écriture réelle en IDB, plus rien en localStorage ──────────────────
const LONG_A = 'question assez longue pour compter';
const LONG_B = 'réponse assez longue pour compter';

await page.evaluate(async ({ a, b }) => {
  saveConversation({
    id: 'v-cold', title: 'Froide', timestamp: 1000, updatedAt: 1000,
    spaceId: 'default',
    messages: [{ role: 'user', content: a }, { role: 'assistant', content: b }],
  });
  // Laisser la transaction committer (l'écriture est fire-and-forget).
  await new Promise((r) => setTimeout(r, 250));
}, { a: LONG_A, b: LONG_B });

const inDb = await page.evaluate(() => readConversationFromDB('v-cold'));
check('la conversation est réellement écrite dans IDB', !!inDb && inDb.id === 'v-cold');
check('ses messages sont dans le record IDB',
  !!inDb && Array.isArray(inDb.messages) && inDb.messages.length === 2);

const lsKeys = await page.evaluate(() => ({
  conv: localStorage.getItem('miaou-conversations'),
  summ: localStorage.getItem('miaou-summaries'),
}));
check('localStorage ne porte plus les conversations (U-1 n\'écrit plus là)',
  lsKeys.conv === null);
check('localStorage ne porte plus les résumés', lsKeys.summ === null);

// ── 4. Hydratation au boot ──────────────────────────────────────────────────
await boot();
const afterReload = await page.evaluate(() => {
  const all = listAllConversations();
  return { count: all.length, has: all.some((c) => c.id === 'v-cold'),
           title: (all.find((c) => c.id === 'v-cold') || {}).title };
});
check('après reload, la conversation est hydratée (étage 1)', afterReload.has);
check('son titre est restitué', afterReload.title === 'Froide');

const sidebarCount = await page.locator('#conv-list .conv-title').count();
check('la sidebar affiche la conversation hydratée', sidebarCount >= 1);
await page.screenshot({ path: path.join(outDir, '01-hydrated-sidebar.png'),
                        clip: { x: 0, y: 0, width: 320, height: 400 } });
console.log('  shot  01-hydrated-sidebar.png');

// ── 5. Réchauffage des messages ─────────────────────────────────────────────
// Après boot, l'étage 2 ne contient que la conversation AFFICHÉE (réchauffée par
// openConversation) : toute autre est froide et sort avec `messages: []`.
const coldRead = await page.evaluate(async () => {
  // Une seconde conversation, jamais ouverte : froide par construction.
  saveConversation({ id: 'v-never-opened', title: 'Jamais ouverte', timestamp: 900, updatedAt: 900,
    spaceId: 'default', messages: [{ role: 'user', content: 'x'.repeat(20) }] });
  await new Promise((r) => setTimeout(r, 250));
  _convMessagesCache.delete('v-never-opened');   // simule l'éviction LRU
  return {
    cold: (loadConversation('v-never-opened').messages || []).length,
    listed: listAllConversations().some((c) => c.id === 'v-never-opened'),
  };
});
check('à froid, loadConversation rend `messages: []` (contrat étage 2)', coldRead.cold === 0);
check('...mais la conversation reste listée (étage 1 intact)', coldRead.listed);

const warmed = await page.evaluate(async () => {
  await warmConversation('v-never-opened');
  return (loadConversation('v-never-opened').messages || []).length;
});
check('après warmConversation, les messages sont là', warmed === 1);

// ── 6-7. Non-régression d'écrasement sur conversation FROIDE ────────────────
// Le piège du lot : `loadConversation` d'une conversation froide rend
// messages: [] ; persister le record reconstruit la viderait EN BASE.
await boot();   // repart avec l'étage 2 vide → v-cold est froide

const pinned = await page.evaluate(async () => {
  const before = (await readConversationFromDB('v-cold')).messages.length;
  toggleConversationPin('v-cold');
  await new Promise((r) => setTimeout(r, 250));
  const rec = await readConversationFromDB('v-cold');
  return { before, after: rec.messages.length, pinned: !!rec.pinned };
});
check('épingler une conversation FROIDE ne vide pas ses messages en base',
  pinned.before === 2 && pinned.after === 2);
check('l\'épinglage est bien persisté', pinned.pinned === true);

const renamed = await page.evaluate(async () => {
  persistConversationField('v-cold', { title: 'Renommée à froid' });
  await new Promise((r) => setTimeout(r, 250));
  const rec = await readConversationFromDB('v-cold');
  return { msgs: rec.messages.length, title: rec.title };
});
check('renommer une conversation FROIDE ne vide pas ses messages',
  renamed.msgs === 2);
check('le nouveau titre est persisté', renamed.title === 'Renommée à froid');

// ── 8. Éviction LRU : étage 1 permanent, étage 2 borné ──────────────────────
const lru = await page.evaluate(async ({ a, b }) => {
  for (let i = 0; i < 20; i++) {
    saveConversation({
      id: 'v-bulk-' + i, title: 'Bulk ' + i, timestamp: 2000 + i, updatedAt: 2000 + i,
      spaceId: 'default',
      messages: [{ role: 'user', content: a }, { role: 'assistant', content: b }],
    });
  }
  await new Promise((r) => setTimeout(r, 500));
  return {
    metaCount: listAllConversations().length,
    hotCount: _convMessagesCache.size,
    firstStillListed: listAllConversations().some((c) => c.id === 'v-bulk-0'),
    firstInDb: ((await readConversationFromDB('v-bulk-0')) || {}).messages.length,
  };
}, { a: LONG_A, b: LONG_B });
check('étage 1 garde TOUTES les conversations', lru.metaCount === 22);
check('étage 2 reste borné sous le plafond LRU', lru.hotCount <= 12);
check('une conversation évincée reste listée (métadonnées permanentes)',
  lru.firstStillListed);
check('une conversation évincée garde ses messages EN BASE',
  lru.firstInDb === 2);

// ── 9. Résumés ──────────────────────────────────────────────────────────────
await page.evaluate(async () => {
  saveSummary('v-cold', { title: 'Froide', timestamp: 1000, summary: 'un résumé', keywords: ['k'], messageCount: 2 });
  await new Promise((r) => setTimeout(r, 250));
});
await boot();
const summ = await page.evaluate(() => {
  const e = getSummaryEntry('v-cold');
  return { has: !!e, text: e && e.summary };
});
check('le résumé survit au reload (hydraté depuis IDB)', summ.has);
check('son contenu est intact', summ.text === 'un résumé');

const tomb = await page.evaluate(async () => {
  suppressSummary('v-cold');
  await new Promise((r) => setTimeout(r, 250));
  const e = getSummaryEntry('v-cold');
  return { suppressed: !!(e && e.suppressed), keepsData: !!(e && e.summary) };
});
check('tombstone posée (piège 6)', tomb.suppressed);
check('les données du résumé sont conservées sous la tombstone', tomb.keepsData);

// ─────────────────────────────────────────────────────────────────────────
console.log('');
// Les fontes Google ne résolvent pas en file:// sans réseau : artefact
// d'environnement, sans rapport avec la persistance.
const realErrors = errors.filter((e) => !/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|fonts\.googleapis/.test(e));
if (realErrors.length) {
  console.log('Erreurs console :');
  for (const e of realErrors.slice(0, 10)) console.log('  ! ' + e);
}
check('aucune erreur console (hors chargement de fontes en file://)', realErrors.length === 0);

await browser.close();
console.log('\n' + (failures.length ? 'ÉCHEC — ' + failures.length + ' : ' + failures.join(' | ')
                                    : 'OK — tous les contrôles passent'));
process.exit(failures.length ? 1 : 0);
