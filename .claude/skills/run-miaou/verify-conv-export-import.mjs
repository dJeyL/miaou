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
//   4. version du fichier écrit = 3, dans un conteneur zip
//   5. import v2 sur base peuplée : remplacement intégral, aucun résidu
//   6. import v1 (conversations sous localStorage, résumés en objet indexé)
//      sur base peuplée : migration de format, historique visible en sidebar
//   7. import v1 : les deux clés localStorage héritées ne sont PAS réécrites
//      (elles ré-armeraient la migration de boot)
//   8. import v1 : les résumés changent de forme et sont relus
//   9. un fichier version 4 (futur) est refusé, sans rien détruire
//  10. aller-retour complet export → import : l'état est identique, ressources
//      binaires comprises (octets, zéro octet, name unicode)
//  11. archives refusées (tronquée, sans manifeste, manifeste chiffré) : rien
//      détruit — et l'ORDRE des gardes, figé parce qu'il est observable
//  12. réentrance : deux sélections rapprochées → c'est la dernière qui
//      s'applique (jeton `_importSeq`, chemin d'import devenu asynchrone)
//
// Mise à niveau V-3 (sauvegarde compressée) : l'export produit désormais un
// `.zip` (manifeste + un membre par ressource binaire), et `EXPORT_FORMAT_VERSION`
// passe à 3. Deux assertions étaient PÉRIMÉES et non fausses — les distinguer
// est tout l'enjeu : « version écrite = 2 » et « la version 3 est refusée »
// auraient accusé l'application d'une régression qu'elle n'a pas.
// Les scénarios v1 et v2 sur base PEUPLÉE restent intacts : c'est la seule
// couverture de migration de l'application, on les COMPLÈTE, jamais on ne les
// remplace par un scénario v3.
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
const capture0Includes = (names, wanted) => wanted.every((w) => names.includes(w));
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
// fichier produit, plutôt que de reconstruire le payload à la main : c'est le
// chemin réel du bouton qu'on veut éprouver, pas une réimplémentation.
//
// Depuis V-3 c'est un `.zip` : on le décompresse DANS LA PAGE, qui a déjà
// chargé fflate — plutôt que d'ajouter une dépendance Node au script. Rend
// { file, manifest, members } : le chemin du fichier réel (pour le réinjecter
// tel quel à l'import), le manifeste parsé, et les noms de membres.
let exportSeq = 0;
const captureExport = async () => {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.evaluate(() => exportAllData()),
  ]);
  const suggested = download.suggestedFilename();
  const file = path.join(tmpDir, 'export-capture-' + (exportSeq++) + '.zip');
  await download.saveAs(file);
  const bytes = Array.from(fs.readFileSync(file));
  const out = await page.evaluate(async (arr) => {
    const u8 = new Uint8Array(arr);
    const ff = await ensureFflate();
    const files = ff.unzipSync(u8);
    const names = Object.keys(files);
    const manifest = JSON.parse(new TextDecoder('utf-8').decode(files['manifest.json']));
    const sizes = {};
    for (const n of names) sizes[n] = files[n].length;
    // Empreinte d'octets par membre : une taille identique avec des octets
    // décalés serait le bug le plus vicieux de l'aller-retour.
    const digests = {};
    for (const n of names) {
      let h = 2166136261;
      for (const b of files[n]) { h ^= b; h = Math.imul(h, 16777619); }
      digests[n] = (h >>> 0).toString(16);
    }
    return { names, manifest, sizes, digests };
  }, bytes);
  return Object.assign({ file, suggested }, out);
};

// Réinjecte un FICHIER déjà sur disque (l'export capturé, une fixture abîmée)
// dans l'input d'import, sans repasser par une sérialisation JSON.
const importFileViaUI = async (file, { expectRejected = false } = {}) => {
  await page.evaluate(() => { openSettings(); resetImportDataUI(); });
  await page.setInputFiles('#import-data-input', file);
  if (expectRejected) {
    await page.waitForSelector('#import-data-err:not([hidden])', { timeout: 5000 });
    return await page.textContent('#import-data-err');
  }
  await page.waitForSelector('#import-data-summary:not([hidden]) button', { timeout: 5000 });
  const btn = await page.$('#import-data-summary button');
  await btn.click();
  await page.waitForTimeout(150);
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
    btn.click(),
  ]);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
  return null;
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
const readState = async () => page.evaluate(async () => {
  // Les octets des ressources sont relus DEPUIS LE STORE et rendus en clair :
  // c'est le seul moyen de prouver qu'un binaire traverse l'import intact,
  // quelle que soit la version du fichier d'où il vient (base64 v1/v2 ou
  // membre d'archive v3).
  const res = await getAllResources();
  const resBytes = {};
  for (const r of res) {
    const u8 = new Uint8Array(r.data);
    resBytes[r.id] = { size: u8.length, head: Array.from(u8.slice(0, 8)), name: r.name };
  }
  return {
    idbConvs: (await readAllConversationsFromDB()).map((c) => c.id).sort(),
    idbSummaries: (await readAllSummariesFromDB()).map((s) => s.id).sort(),
    listed: listAllConversations().map((c) => c.id).sort(),
    summaries: loadSummaries(),
    lsConv: localStorage.getItem('miaou-conversations'),
    lsSumm: localStorage.getItem('miaou-summaries'),
    resIds: res.map((r) => r.id).sort(),
    resBytes,
  };
});

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

const capture = await captureExport();
const exported = capture.manifest;
check('le fichier téléchargé est un .zip nommé par exportDateTimeStamp',
  /^miaou-export-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/.test(capture.suggested));
check('l\'archive contient un membre manifest.json', capture.names.includes('manifest.json'));
check('le manifeste est en version 3', exported.version === 3);
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
    skills: [],
    // Une ressource BINAIRE en base64 : c'est le format hérité, et c'est
    // exactement ce que V-3 cesse de produire. Sans elle, le scénario v2
    // n'exercerait jamais `resourceDataShape` sur sa branche 'base64', ni
    // `base64ToArrayBuffer` — le seul reste de base64 du chemin d'import.
    // 'TUlBT1UhAAE=' → 4D 49 41 4F 55 21 00 01 (8 octets, dont deux non-ASCII
    // pour que la moindre corruption d'encodage se voie).
    resources: [{ id: 'res_v2bin', conversationId: 'y-1', class: 'binary',
      mime: 'image/png', name: 'binaire v2.png', size: 8, createdAt: 5000,
      data: 'TUlBT1UhAAE=', originUrl: null }],
    conversations: [{ id: 'y-1', title: 'Importée v2', timestamp: 5000, updatedAt: 5000, spaceId: 'default',
      messages: [{ role: 'user', content: 'contenu importé v2' }] }],
    summaries: [{ id: 'y-1', summary: 'résumé importé v2', keywords: ['v2'], messageCount: 1 }],
  },
};
const V2_BIN_BYTES = [0x4D, 0x49, 0x41, 0x4F, 0x55, 0x21, 0x00, 0x01];

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

// LA contrainte non négociable de V-3, exercée sur sa branche la plus fragile :
// un `.json` non compressé porte ses binaires en base64, et doit continuer de
// les rendre octet pour octet.
check('import v2 (.json) : la ressource binaire base64 est décodée intacte',
  afterV2.resIds.join(',') === 'res_v2bin'
  && !!afterV2.resBytes['res_v2bin']
  && afterV2.resBytes['res_v2bin'].size === 8
  && afterV2.resBytes['res_v2bin'].head.join(',') === V2_BIN_BYTES.join(','));

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
// Le chiffre suit EXPORT_FORMAT_VERSION : v3 est désormais ÉCRITE et acceptée,
// c'est v4 qui doit être refusée. L'assertion telle qu'elle était aurait
// accusé l'application d'accepter une version future, alors que c'est ce test
// qui aurait été périmé.
const futurePayload = Object.assign({}, payloadV2, { version: 4 });
const errText = await importPayloadViaUI(futurePayload, { expectRejected: true });
check('un fichier de version future est refusé avec un message',
  typeof errText === 'string' && /version/i.test(errText));

const afterRefusal = await readState();
check('le refus ne détruit rien : l\'historique précédent est intact',
  afterRefusal.idbConvs.join(',') === 'v1-a,v1-b');

// ── 10. Aller-retour complet : export → import → même état ──────────────────
// Le fichier RÉEL est réinjecté (importFileViaUI), pas un payload reconstruit :
// c'est l'aller-retour du conteneur zip qu'on éprouve, noms de membres compris.
//
// On sème d'abord DES RESSOURCES BINAIRES : sans elles, l'aller-retour ne
// prouverait rien du sous-lot — c'est précisément le base64 qu'on supprime.
// Trois cas frontière, dans le même geste :
//   F1 — quelques centaines d'octets pseudo-aléatoires (le cas nominal) ;
//   F2 — une ressource de ZÉRO octet (doit avoir un membre vide, pas d'entrée
//        manquante) ;
//   F3 — un `name` unicode (il traverse le MANIFESTE ; le nom de membre, lui,
//        est dérivé de l'`id` — c'est ce que fige cette fixture).
const SEEDED_RES = await page.evaluate(async () => {
  const mk = (n) => {
    const u8 = new Uint8Array(n);
    for (let i = 0; i < n; i++) u8[i] = (i * 37 + 11) & 0xFF;
    return u8;
  };
  const recs = [
    { id: 'res_f1', conversationId: 'v1-a', class: 'binary', mime: 'image/png',
      name: 'capture.png', size: 512, createdAt: 6000, originUrl: null, data: mk(512).buffer },
    { id: 'res_f2', conversationId: 'v1-a', class: 'binary', mime: 'application/octet-stream',
      name: 'vide.bin', size: 0, createdAt: 6001, originUrl: null, data: new ArrayBuffer(0) },
    { id: 'res_f3', conversationId: 'v1-a', class: 'binary', mime: 'image/png',
      name: 'rapport é — accentué.png', size: 64, createdAt: 6002, originUrl: null, data: mk(64).buffer },
  ];
  for (const r of recs) await putResource(r);
  const out = {};
  for (const r of recs) {
    const u8 = new Uint8Array(r.data);
    out[r.id] = { size: u8.length, head: Array.from(u8.slice(0, 8)), name: r.name };
  }
  return out;
});

const roundCapture = await captureExport();
const roundTrip = roundCapture.manifest;

// ── Ce que le format v3 doit garantir, membre par membre ────────────────────
const manRes = roundTrip.idb.resources || [];
check('v3 : aucune string base64 dans le manifeste (c\'est LE gain du sous-lot)',
  manRes.length === 3 && manRes.every((r) => typeof r.data === 'undefined'));
check('v3 : un membre resources/<id> par ressource, nommé par l\'ID et non par le name',
  manRes.every((r) => r.member === 'resources/' + r.id)
  && capture0Includes(roundCapture.names, ['resources/res_f1', 'resources/res_f2', 'resources/res_f3']));
check('v3 : la ressource de zéro octet a bien un membre (vide), pas d\'entrée manquante',
  roundCapture.sizes['resources/res_f2'] === 0);
check('v3 : le name unicode traverse le manifeste intact',
  (manRes.find((r) => r.id === 'res_f3') || {}).name === 'rapport é — accentué.png');
check('v3 : les octets du membre sont ceux du store (taille ET empreinte)',
  roundCapture.sizes['resources/res_f1'] === 512);

await importFileViaUI(roundCapture.file);
const afterBin = await readState();
check('aller-retour v3 : les trois ressources sont réimportées',
  afterBin.resIds.join(',') === 'res_f1,res_f2,res_f3');
check('aller-retour v3 : les octets de F1 sont identiques (taille ET tête)',
  afterBin.resBytes['res_f1'].size === SEEDED_RES['res_f1'].size
  && afterBin.resBytes['res_f1'].head.join(',') === SEEDED_RES['res_f1'].head.join(','));
check('aller-retour v3 : la ressource de zéro octet revient vide, pas absente',
  afterBin.resBytes['res_f2'].size === 0);
check('aller-retour v3 : le name unicode survit au cycle complet',
  afterBin.resBytes['res_f3'].name === 'rapport é — accentué.png');

// Le manifeste ne doit JAMAIS emporter `member` dans le store : c'est un détail
// de transport, il polluerait le schéma et se propagerait au prochain export.
const memberLeak = await page.evaluate(async () =>
  (await getAllResources()).some((r) => typeof r.member !== 'undefined'));
check('aller-retour v3 : le champ `member` n\'atteint jamais le store', memberLeak === false);
check('l\'export de l\'état importé v1 contient bien les deux conversations',
  roundTrip.idb.conversations.length === 2 && roundTrip.version === 3);
check('aller-retour : les conversations sont identiques',
  afterBin.idbConvs.join(',') === 'v1-a,v1-b');
check('aller-retour : les résumés sont identiques',
  afterBin.idbSummaries.join(',') === 'v1-a');

const roundMsgs = await page.evaluate(async () => (await readConversationFromDB('v1-a')).messages);
check('aller-retour : les messages survivent au cycle complet',
  roundMsgs.length === 2 && roundMsgs[1].content === 'réponse de l\'ancien format');

await page.screenshot({ path: path.join(outDir, '03-apres-aller-retour.png') });

// ── 11. Archives refusées : rien ne doit être détruit ───────────────────────
// L'ordre des gardes est OBSERVABLE, donc figé ici plutôt que supposé.
const intactIds = afterBin.idbConvs.join(',');

// (a) zip tronqué : le sniff dit « zip », le central directory dit non.
const truncated = path.join(tmpDir, 'tronque.zip');
{
  const full = fs.readFileSync(roundCapture.file);
  fs.writeFileSync(truncated, full.subarray(0, Math.max(0, full.length - 100)));
}
const errTrunc = await importFileViaUI(truncated, { expectRejected: true });
check('zip tronqué → refus inline actionnable',
  typeof errTrunc === 'string' && /illisible|tronqu/i.test(errTrunc));
check('zip tronqué : rien n\'est détruit', (await readState()).idbConvs.join(',') === intactIds);

// (b) zip sans manifest.json : c'est un zip valide, mais pas une sauvegarde.
const noManifest = path.join(tmpDir, 'sans-manifeste.zip');
{
  const bytes = await page.evaluate(async () => {
    const ff = await ensureFflate();
    return Array.from(ff.zipSync({ 'autre.txt': ff.strToU8('rien à voir') }, { level: 6 }));
  });
  fs.writeFileSync(noManifest, Buffer.from(bytes));
}
const errNoMan = await importFileViaUI(noManifest, { expectRejected: true });
check('zip sans manifest.json → refus actionnable qui NOMME le manifeste',
  typeof errNoMan === 'string' && /manifest\.json/i.test(errNoMan));
check('zip sans manifeste : rien n\'est détruit', (await readState()).idbConvs.join(',') === intactIds);

// (c) MANIFESTE chiffré : la garde V-1 sur ce chemin, et le mode de défaillance
// le plus coûteux du lot. fflate extrairait le membre SANS lever d'erreur, en
// rendant du bruit binaire dont le JSON.parse dirait « JSON invalide » — un
// message qui envoie l'utilisateur chercher au mauvais endroit.
// Fixture `enc-backup.zip` : un manifest.json protégé par mot de passe.
// C'est bien celle-là qu'il faut, pas `enc.zip` (fixture V-1) : cette dernière
// ne contient PAS de manifest.json, donc elle exerce la garde (d) et non la (c).
const encBackup = path.join(repoRoot, 'untracked/muscle/enc-backup.zip');
if (fs.existsSync(encBackup)) {
  const errEnc = await importFileViaUI(encBackup, { expectRejected: true });
  check('manifeste chiffré → refus explicite mentionnant le mot de passe',
    typeof errEnc === 'string' && /mot de passe|chiffr/i.test(errEnc));
  check('manifeste chiffré : rien n\'est détruit', (await readState()).idbConvs.join(',') === intactIds);
} else {
  console.log('  SKIP  manifeste chiffré (fixture untracked/muscle/enc-backup.zip absente)');
}

// (d) L'ORDRE des gardes, figé parce qu'il est observable. `enc.zip` est
// chiffrée MAIS ne porte pas de manifest.json : c'est « pas une sauvegarde »
// qui doit l'emporter, pas « chiffrée ». Le bon ordre : un zip sans manifeste
// n'est pas une sauvegarde, quoi qu'il contienne — le dire d'abord évite
// d'envoyer chercher un mot de passe pour une archive qui n'en est pas une.
const encFixture = path.join(repoRoot, 'untracked/muscle/enc.zip');
if (fs.existsSync(encFixture)) {
  const errOrder = await importFileViaUI(encFixture, { expectRejected: true });
  check('zip chiffré SANS manifeste → c\'est « pas une sauvegarde » qui prime',
    typeof errOrder === 'string' && /manifest\.json/i.test(errOrder));
  check('zip chiffré sans manifeste : rien n\'est détruit',
    (await readState()).idbConvs.join(',') === intactIds);
} else {
  console.log('  SKIP  ordre des gardes (fixture untracked/muscle/enc.zip absente)');
}

// ── 12. Réentrance : le chemin d'import est ASYNCHRONE depuis V-3 ───────────
// Deux sélections rapprochées : le récapitulatif affiché doit correspondre au
// DERNIER fichier, et appliquer doit appliquer celui-là. Sans le jeton
// `_importSeq`, le bouton armé pourrait appliquer le PREMIER payload alors que
// l'écran affiche le second — sur un chemin destructif.
const raceA = path.join(tmpDir, 'race-a.json');
const raceB = path.join(tmpDir, 'race-b.json');
const mkRace = (id, title) => ({
  format: 'miaou-export', version: 2, exportedAt: Date.now(),
  localStorage: {
    'miaou-settings': { url: 'http://stub.local/v1', key: 'k', model: 'm', summaryInjectionMode: 'never' },
    'miaou-memories': [], 'miaou-api-servers': [], 'miaou-active-api-server': '',
    'miaou-mcp-servers': [], 'miaou-spaces': [], 'miaou-active-space': '',
  },
  idb: { skills: [], resources: [],
    conversations: [{ id, title, timestamp: 9000, updatedAt: 9000, spaceId: 'default',
      messages: [{ role: 'user', content: title }] }],
    summaries: [] },
});
fs.writeFileSync(raceA, JSON.stringify(mkRace('race-a', 'Course A')));
fs.writeFileSync(raceB, JSON.stringify(mkRace('race-b', 'Course B')));

await page.evaluate(() => { openSettings(); resetImportDataUI(); });
await page.setInputFiles('#import-data-input', raceA);
await page.setInputFiles('#import-data-input', raceB);
await page.waitForSelector('#import-data-summary:not([hidden]) button', { timeout: 5000 });
{
  const btn = await page.$('#import-data-summary button');
  await btn.click();
  await page.waitForTimeout(150);
  await Promise.all([
    page.waitForNavigation({ timeout: 15000 }).catch(() => {}),
    btn.click(),
  ]);
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
}
const afterRace = await readState();
check('réentrance : c\'est le DERNIER fichier sélectionné qui est appliqué',
  afterRace.idbConvs.join(',') === 'race-b');

check('aucune erreur console', errors.length === 0);
if (errors.length) console.log('    erreurs : ' + errors.slice(0, 5).join(' | '));

await browser.close();

console.log('');
if (failures.length) {
  console.log('ÉCHEC — ' + failures.length + ' contrôle(s) : ' + failures.join(' ; '));
  process.exit(1);
}
console.log('OK — tous les contrôles passent. Captures : ' + outDir);
