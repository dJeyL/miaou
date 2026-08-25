#!/usr/bin/env node
// Vérification du lot U-4 (export/import v2) — un lancement.
//
// Pourquoi ce script existe, au-delà du réflexe « un lot = un verify » :
//
// 1. L'export était CASSÉ EN SILENCE depuis U-2. `EXPORT_KEYS` contenait encore
//    les deux clés localStorage purgées ; `JSON.parse(null)` rend `null`, que
//    `buildExportPayload` normalisait en `[]`. Aucune exception, aucun log : un
//    fichier d'export valide, bien formé, et vide de tout l'historique. Un test
//    unitaire sur la forme du payload passait au vert pendant ce temps. Il faut
//    donc vérifier ce que l'export CONTIENT, sur une base réellement peuplée.
//
// 2. **Importer un fichier `version: 1` EST une migration** — et c'est la leçon
//    de la session U-3, où trois bugs U-1 ont été trouvés en conditions réelles
//    parce que tous les verify partaient d'une base vierge. Une base vierge
//    n'exerce aucune migration. Les scénarios v1 ci-dessous partent donc d'une
//    base DÉJÀ PEUPLÉE, différente du contenu importé, pour que le remplacement
//    intégral ait quelque chose à remplacer et que l'absence de résidu soit
//    observable.
//
// Scénarios :
//   1. export d'une base peuplée : les conversations sont sous `idb`, avec
//      leurs messages, et plus du tout sous `localStorage`
//   2. les conversations FROIDES sont exportées avec leurs messages (le cache
//      les rendrait à `messages: []` — c'est le piège de contrat d'U-1)
//   3. les résumés sont exportés depuis la base, en records
//   4. version du fichier écrit = 2
//   5. import v2 sur base peuplée : remplacement intégral, aucun résidu
//   6. import v1 (conversations sous localStorage, résumés en objet indexé)
//      sur base peuplée : migration de format, historique visible en sidebar
//   7. import v1 : les deux clés localStorage héritées ne sont PAS réécrites
//      (elles ré-armeraient la migration de boot)
//   8. import v1 : les résumés changent de forme et sont relus
//   9. un fichier version 3 (futur) est refusé, sans rien détruire
//  10. aller-retour complet export → import : l'état est identique
//
// Usage : node verify-conv-export-import.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-conv-export-import');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });
// Fichiers de travail (payloads d'import, export capturé) : sous `tmp/`, qui est
// ignoré par git. Le .gitignore du dossier n'exclut que node_modules/ et *.png —
// ce script est le premier verify à produire des JSON, et ce sont des artefacts
// de run, pas des fixtures : ils n'ont rien à faire dans l'historique.
const tmpDir = path.join(outDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
const isNoise = (t) => /ERR_NAME_NOT_RESOLVED|fonts\.(googleapis|gstatic)/.test(t);
page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => { if (!isNoise(String(e))) errors.push(String(e)); });

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
  await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
};

const MSG_COLD = 'contenu d\'une conversation froide, jamais ouverte dans cet onglet';

// Vide IDB et les deux clés héritées : point de départ neutre entre scénarios.
const wipe = async () => {
  await page.evaluate(async () => {
    const db = await openConvDB();
    await new Promise((r) => {
      const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
      tx.objectStore('conversations').clear();
      tx.objectStore('summaries').clear();
      tx.oncomplete = r;
    });
    localStorage.removeItem('miaou-conversations');
    localStorage.removeItem('miaou-summaries');
  });
};

// Peuple IDB directement (sans passer par le cache) puis recharge : au boot
// suivant, les conversations sont en base et FROIDES — leurs messages ne sont
// pas en étage 2. C'est l'état qui distingue un export correct d'un export qui
// lirait le cache.
const seedIdbAndBoot = async (convs, summaries) => {
  await page.evaluate(async ({ c, s }) => {
    const db = await openConvDB();
    await new Promise((r, j) => {
      const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
      for (const rec of c) tx.objectStore('conversations').put(rec);
      for (const rec of s) tx.objectStore('summaries').put(rec);
      tx.oncomplete = r;
      tx.onerror = (e) => j(e.target.error);
    });
  }, { c: convs, s: summaries });
  await boot();
};

// Déclenche exportAllData() en interceptant le téléchargement pour récupérer le
// JSON produit, plutôt que de reconstruire le payload à la main : c'est le
// chemin réel du bouton qu'on veut éprouver, pas une réimplémentation.
const captureExport = async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.evaluate(() => exportAllData()),
  ]);
  const tmp = path.join(tmpDir, 'export-capture.json');
  await download.saveAs(tmp);
  return JSON.parse(fs.readFileSync(tmp, 'utf8'));
};

// Joue un import de bout en bout par l'UI : écriture du fichier, sélection via
// l'input caché, puis les DEUX clics du bouton arm-then-run. `applyImportedData`
// termine par location.reload() — on attend donc le boot suivant.
let importSeq = 0;
const importPayloadViaUI = async (payload, { expectRejected = false } = {}) => {
  // Un chemin de fichier NEUF par appel : réécrire le même chemin ne redéclenche
  // pas `onchange` quand l'input porte déjà cette sélection (c'est le rôle du
  // `input.value = ''` d'onImportDataClick, que setInputFiles court-circuite).
  const file = path.join(tmpDir, 'import-payload-' + (importSeq++) + '.json');
  fs.writeFileSync(file, JSON.stringify(payload));
  await page.evaluate(() => { openSettings(); resetImportDataUI(); });
  await page.setInputFiles('#import-data-input', file);
  if (expectRejected) {
    await page.waitForSelector('#import-data-err:not([hidden])', { timeout: 5000 });
    return await page.textContent('#import-data-err');
  }
  await page.waitForSelector('#import-data-summary:not([hidden]) button', { timeout: 5000 });
  const btn = await page.$('#import-data-summary button');
  await btn.click();               // 1er clic : arme
  await page.waitForTimeout(150);
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
    btn.click(),                   // 2e clic : applique + location.reload()
  ]);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
  return null;
};

// État observable après un import : ce qui est EN BASE, ce que voit la sidebar,
// et ce qui traîne éventuellement en localStorage.
const readState = async () => page.evaluate(async () => ({
  idbConvs: (await readAllConversationsFromDB()).map((c) => c.id).sort(),
  idbSummaries: (await readAllSummariesFromDB()).map((s) => s.id).sort(),
  listed: listAllConversations().map((c) => c.id).sort(),
  summaries: loadSummaries(),
  lsConv: localStorage.getItem('miaou-conversations'),
  lsSumm: localStorage.getItem('miaou-summaries'),
}));

await boot();
await wipe();

// ── 1-4. Export d'une base peuplée, conversations FROIDES ───────────────────
const BASE_CONVS = [
  { id: 'x-1', title: 'Export un', timestamp: 1000, updatedAt: 1000, spaceId: 'default',
    messages: [{ role: 'user', content: MSG_COLD }, { role: 'assistant', content: 'réponse froide' }] },
  { id: 'x-2', title: 'Export deux', timestamp: 2000, updatedAt: 2000, spaceId: 'default',
    messages: [{ role: 'user', content: 'seconde question' }] },
];
const BASE_SUMMARIES = [
  { id: 'x-1', summary: 'résumé exporté', keywords: ['export'], messageCount: 2 },
];

await seedIdbAndBoot(BASE_CONVS, BASE_SUMMARIES);

// Contrôle préalable : les conversations sont bien FROIDES, sinon le scénario
// ne prouve rien (un export qui lit le cache passerait par chance).
const coldness = await page.evaluate(() => ({
  viaCache: loadConversation('x-1').messages.length,
}));
check('préalable : x-1 est froide (le cache rend messages: [])', coldness.viaCache === 0);

const exported = await captureExport();
check('le fichier exporté est en version 2', exported.version === 2);
check('les conversations sont sous idb, pas sous localStorage',
  Array.isArray(exported.idb.conversations) && exported.idb.conversations.length === 2
  && exported.localStorage['miaou-conversations'] === undefined);
check('les résumés sont sous idb, en records portant leur id',
  Array.isArray(exported.idb.summaries) && exported.idb.summaries.length === 1
  && exported.idb.summaries[0].id === 'x-1'
  && exported.localStorage['miaou-summaries'] === undefined);

const expX1 = exported.idb.conversations.find((c) => c.id === 'x-1');
check('une conversation FROIDE est exportée avec ses messages (pas messages: [])',
  !!expX1 && expX1.messages.length === 2 && expX1.messages[0].content === MSG_COLD);
check('les 7 clés localStorage restantes sont bien là',
  exported.localStorage['miaou-settings'] !== undefined
  && exported.localStorage['miaou-memories'] !== undefined
  && exported.localStorage['miaou-spaces'] !== undefined);

await page.screenshot({ path: path.join(outDir, '01-base-exportee.png') });

// ── 5. Import v2 sur base PEUPLÉE : remplacement intégral ───────────────────
// La base contient x-1/x-2 ; on importe y-1 seul. Un import qui fusionnerait,
// ou qui oublierait de vider les stores, laisserait x-1 derrière lui.
const payloadV2 = {
  format: 'miaou-export', version: 2, exportedAt: Date.now(),
  localStorage: {
    'miaou-settings': { url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model', summaryInjectionMode: 'never' },
    'miaou-memories': [], 'miaou-api-servers': [], 'miaou-active-api-server': '',
    'miaou-mcp-servers': [], 'miaou-spaces': [], 'miaou-active-space': '',
  },
  idb: {
    skills: [], resources: [],
    conversations: [{ id: 'y-1', title: 'Importée v2', timestamp: 5000, updatedAt: 5000, spaceId: 'default',
      messages: [{ role: 'user', content: 'contenu importé v2' }] }],
    summaries: [{ id: 'y-1', summary: 'résumé importé v2', keywords: ['v2'], messageCount: 1 }],
  },
};

await importPayloadViaUI(payloadV2);
const afterV2 = await readState();
check('import v2 : seule la conversation importée subsiste (remplacement intégral)',
  afterV2.idbConvs.join(',') === 'y-1');
check('import v2 : l\'historique remplacé n\'est plus visible en sidebar',
  afterV2.listed.join(',') === 'y-1');
check('import v2 : le résumé importé est en base et relu',
  afterV2.idbSummaries.join(',') === 'y-1'
  && !!afterV2.summaries['y-1'] && afterV2.summaries['y-1'].summary === 'résumé importé v2');

const v2Msgs = await page.evaluate(async () => (await readConversationFromDB('y-1')).messages);
check('import v2 : les messages traversent intacts',
  v2Msgs.length === 1 && v2Msgs[0].content === 'contenu importé v2');

// ── 6-8. Import v1 sur base PEUPLÉE : c'est une MIGRATION ───────────────────
// Forme héritée : conversations sous `localStorage`, résumés en OBJET INDEXÉ.
// La base porte y-1 (issue du scénario 5) : le remplacement a donc quelque
// chose à remplacer, et un résidu serait visible.
const payloadV1 = {
  format: 'miaou-export', version: 1, exportedAt: Date.now(),
  localStorage: {
    'miaou-settings': { url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model', summaryInjectionMode: 'never' },
    'miaou-conversations': [
      { id: 'v1-a', title: 'Ancienne A', timestamp: 3000, updatedAt: 3000, spaceId: 'default',
        messages: [{ role: 'user', content: 'question de l\'ancien format' },
                   { role: 'assistant', content: 'réponse de l\'ancien format' }] },
      { id: 'v1-b', title: 'Ancienne B', timestamp: 4000, updatedAt: 4000, spaceId: 'default',
        messages: [{ role: 'user', content: 'seconde ancienne' }] },
    ],
    'miaou-summaries': { 'v1-a': { summary: 'résumé ancien format', keywords: ['v1'], messageCount: 2 } },
    'miaou-memories': [], 'miaou-api-servers': [], 'miaou-active-api-server': '',
    'miaou-mcp-servers': [], 'miaou-spaces': [], 'miaou-active-space': '',
  },
  idb: { skills: [], resources: [] },
};

await importPayloadViaUI(payloadV1);
const afterV1 = await readState();

check('import v1 : les conversations héritées atterrissent en IDB',
  afterV1.idbConvs.join(',') === 'v1-a,v1-b');
check('import v1 : l\'état précédent (y-1) a bien été remplacé',
  afterV1.idbConvs.indexOf('y-1') === -1);
check('import v1 : l\'historique importé est VISIBLE (cache hydraté depuis IDB)',
  afterV1.listed.join(',') === 'v1-a,v1-b');

const v1Msgs = await page.evaluate(async () => (await readConversationFromDB('v1-a')).messages);
check('import v1 : les messages traversent intacts',
  v1Msgs.length === 2 && v1Msgs[0].content === 'question de l\'ancien format');

check('import v1 : les résumés changent de forme (objet indexé → records)',
  afterV1.idbSummaries.join(',') === 'v1-a');
check('import v1 : le résumé converti porte son id (keyPath du store)',
  !!afterV1.summaries['v1-a'] && afterV1.summaries['v1-a'].id === 'v1-a'
  && afterV1.summaries['v1-a'].summary === 'résumé ancien format');

// Le point le plus facile à rater : réécrire les deux clés héritées « comme les
// autres EXPORT_KEYS ». Elles ré-armeraient la migration de boot, qui les
// reprendrait au tour suivant — ça marcherait par ricochet, sur un chemin que
// personne n'a voulu.
check('import v1 : miaou-conversations n\'est PAS réécrit en localStorage',
  afterV1.lsConv === null);
check('import v1 : miaou-summaries n\'est PAS réécrit en localStorage',
  afterV1.lsSumm === null);

const sidebarTitles = await page.$$eval('.conv-title', (els) => els.map((e) => e.textContent.trim()));
check('import v1 : la sidebar affiche les conversations importées',
  sidebarTitles.includes('Ancienne A') && sidebarTitles.includes('Ancienne B'));

await page.screenshot({ path: path.join(outDir, '02-apres-import-v1.png') });

// ── 9. Version future refusée, sans rien détruire ───────────────────────────
const futurePayload = Object.assign({}, payloadV2, { version: 3 });
const errText = await importPayloadViaUI(futurePayload, { expectRejected: true });
check('un fichier de version future est refusé avec un message',
  typeof errText === 'string' && /version/i.test(errText));

const afterRefusal = await readState();
check('le refus ne détruit rien : l\'historique précédent est intact',
  afterRefusal.idbConvs.join(',') === 'v1-a,v1-b');

// ── 10. Aller-retour complet : export → import → même état ──────────────────
const roundTrip = await captureExport();
check('l\'export de l\'état importé v1 contient bien les deux conversations',
  roundTrip.idb.conversations.length === 2 && roundTrip.version === 2);

await importPayloadViaUI(roundTrip);
const afterRound = await readState();
check('aller-retour : les conversations sont identiques',
  afterRound.idbConvs.join(',') === 'v1-a,v1-b');
check('aller-retour : les résumés sont identiques',
  afterRound.idbSummaries.join(',') === 'v1-a');

const roundMsgs = await page.evaluate(async () => (await readConversationFromDB('v1-a')).messages);
check('aller-retour : les messages survivent au cycle complet',
  roundMsgs.length === 2 && roundMsgs[1].content === 'réponse de l\'ancien format');

await page.screenshot({ path: path.join(outDir, '03-apres-aller-retour.png') });

check('aucune erreur console', errors.length === 0);
if (errors.length) console.log('    erreurs : ' + errors.slice(0, 5).join(' | '));

await browser.close();

console.log('');
if (failures.length) {
  console.log('ÉCHEC — ' + failures.length + ' contrôle(s) : ' + failures.join(' ; '));
  process.exit(1);
}
console.log('OK — tous les contrôles passent. Captures : ' + outDir);
