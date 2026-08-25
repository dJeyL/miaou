#!/usr/bin/env node
// Vérification du lot U-2 (migration localStorage → IndexedDB) — un lancement.
//
// U-2 est la moitié du lot U qui a un effet DESTRUCTIF : elle supprime les
// deux clés localStorage. Les tests QuickJS couvrent les helpers purs
// (parseLegacy*, selectRecordsToMigrate) mais ni l'IDB, ni le câblage, ni
// l'ordre écriture→purge — c'est-à-dire exactement ce qui peut perdre des
// données. D'où ce script.
//
// Scénarios :
//   1. migration nominale : un historique localStorage atterrit en IDB et les
//      deux clés sont purgées
//   2. l'historique migré est VISIBLE (sidebar hydratée depuis IDB)
//   3. les messages migrés sont intègres (contenu, pas seulement le compte)
//   4. les résumés changent de forme (objet indexé → records) sans perte
//   5. idempotence : un second boot ne rejoue rien et ne casse rien
//   6. court-circuit : réécrire la clé après migration ne ressuscite PAS
//      l'ancien état par-dessus une conversation IDB de même id
//   7. tolérance : un JSON illisible ne bloque pas le boot et purge quand même
//   8. interruption (onglet fermé en cours de migration) : tout ou rien, la
//      migration est ravoyable au boot suivant et ne crée aucun doublon
//   9. boot vierge (aucune clé) : aucun effet, aucune erreur
//
// Usage : node verify-conv-migration.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-conv-migration');
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
// Google Fonts est injoignable sur file:// : artefact d'environnement, filtré.
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

const MSG_A = 'question historique migrée depuis localStorage';
const MSG_B = 'réponse historique migrée depuis localStorage';

// Pose un état localStorage legacy puis recharge. La pose doit avoir lieu dans
// la page (même origine file://), et le rechargement APRÈS, pour que le boot
// suivant voie les clés.
const seedLegacyAndBoot = async (convsJson, summariesJson) => {
  await page.evaluate(({ c, s }) => {
    if (c === null) localStorage.removeItem('miaou-conversations');
    else localStorage.setItem('miaou-conversations', c);
    if (s === null) localStorage.removeItem('miaou-summaries');
    else localStorage.setItem('miaou-summaries', s);
  }, { c: convsJson, s: summariesJson });
  await boot();
};

// Repart d'une base vierge : IDB vidée, clés retirées.
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

await boot();
await wipe();

// ── 1-4. Migration nominale ─────────────────────────────────────────────────
const legacyConvs = JSON.stringify([
  { id: 'm-1', title: 'Migrée un', timestamp: 1000, updatedAt: 1000, spaceId: 'default',
    messages: [{ role: 'user', content: MSG_A }, { role: 'assistant', content: MSG_B }] },
  { id: 'm-2', title: 'Migrée deux', timestamp: 2000, updatedAt: 2000, spaceId: 'default',
    messages: [{ role: 'user', content: 'autre question historique' }] },
]);
// Forme HISTORIQUE des résumés : un objet indexé par id, pas un tableau.
const legacySummaries = JSON.stringify({
  'm-1': { summary: 'résumé historique', keywords: ['migration'], messageCount: 2 },
});

await seedLegacyAndBoot(legacyConvs, legacySummaries);

const afterMigration = await page.evaluate(async () => ({
  ls: {
    conv: localStorage.getItem('miaou-conversations'),
    summ: localStorage.getItem('miaou-summaries'),
  },
  idbConvs: (await readAllConversationsFromDB()).map((c) => c.id).sort(),
  m1: await readConversationFromDB('m-1'),
  summaries: loadSummaries(),
  listed: listAllConversations().map((c) => c.id).sort(),
}));

check('les deux conversations sont en IDB après migration',
  afterMigration.idbConvs.join(',') === 'm-1,m-2');
check('localStorage[miaou-conversations] est purgé', afterMigration.ls.conv === null);
check('localStorage[miaou-summaries] est purgé', afterMigration.ls.summ === null);
check('l\'historique migré est visible (cache hydraté depuis IDB)',
  afterMigration.listed.join(',') === 'm-1,m-2');
check('les messages migrés sont intègres (contenu, pas juste le compte)',
  !!afterMigration.m1 && afterMigration.m1.messages.length === 2
  && afterMigration.m1.messages[0].content === MSG_A
  && afterMigration.m1.messages[1].content === MSG_B);
check('le résumé historique est migré et relu',
  !!afterMigration.summaries['m-1']
  && afterMigration.summaries['m-1'].summary === 'résumé historique');
check('le résumé porte un `id` (keyPath du store)',
  !!afterMigration.summaries['m-1'] && afterMigration.summaries['m-1'].id === 'm-1');

const sidebarTitles = await page.$$eval('.conv-title', (els) => els.map((e) => e.textContent.trim()));
check('la sidebar affiche les conversations migrées',
  sidebarTitles.includes('Migrée un') && sidebarTitles.includes('Migrée deux'));

await page.screenshot({ path: path.join(outDir, '01-apres-migration.png') });

// ── 5. Idempotence : un second boot ne rejoue rien ──────────────────────────
await boot();
const secondBoot = await page.evaluate(async () => ({
  idbConvs: (await readAllConversationsFromDB()).map((c) => c.id).sort(),
  m1msgs: (await readConversationFromDB('m-1')).messages.length,
  listed: listAllConversations().length,
}));
check('second boot : rien n\'est dupliqué ni perdu',
  secondBoot.idbConvs.join(',') === 'm-1,m-2' && secondBoot.listed === 2);
check('second boot : les messages sont intacts', secondBoot.m1msgs === 2);

// ── 6. Court-circuit : une clé réapparue n'écrase pas l'état IDB ────────────
// Scénario réel : une migration a écrit puis échoué à purger, ou un vieil
// onglet réécrit la clé. IDB est le support courant, il doit primer.
await page.evaluate(async () => {
  // Faire diverger la version IDB de la version localStorage.
  saveConversation({
    id: 'm-1', title: 'Version IDB à jour', timestamp: 1000, updatedAt: 9999,
    spaceId: 'default',
    messages: [{ role: 'user', content: 'contenu récent écrit en IDB' }],
  });
  await new Promise((r) => setTimeout(r, 250));
});
await seedLegacyAndBoot(legacyConvs, null);

const afterStale = await page.evaluate(async () => ({
  m1: await readConversationFromDB('m-1'),
  ls: localStorage.getItem('miaou-conversations'),
}));
check('la version IDB prime sur la clé localStorage réapparue',
  !!afterStale.m1 && afterStale.m1.title === 'Version IDB à jour'
  && afterStale.m1.messages.length === 1);
check('la clé réapparue est tout de même purgée', afterStale.ls === null);

// ── 7. Contenu illisible : NE PAS PURGER ────────────────────────────────────
// La purge est irréversible. Une clé présente mais impossible à parser garde
// des octets récupérables à la main : le brief dit « échec → ne rien purger ».
// Contrepartie assumée : la migration est retentée à chaque boot.
await wipe();
await seedLegacyAndBoot('{ ceci n est pas du json', 'non plus');
const afterGarbage = await page.evaluate(() => ({
  conv: localStorage.getItem('miaou-conversations'),
  summ: localStorage.getItem('miaou-summaries'),
  listed: listAllConversations().length,
  booted: !!document.querySelector('#composer-text'),
}));
check('un contenu illisible ne bloque pas le boot', afterGarbage.booted === true);
check('un contenu illisible n\'invente aucune conversation', afterGarbage.listed === 0);
check('une clé conversations illisible est CONSERVÉE (récupérable à la main)',
  afterGarbage.conv === '{ ceci n est pas du json');
check('une clé résumés illisible est CONSERVÉE', afterGarbage.summ === 'non plus');

// Une clé saine migre même si l'AUTRE est abîmée (les deux sont indépendantes).
await wipe();
await seedLegacyAndBoot(legacyConvs, 'résumés corrompus');
const mixed = await page.evaluate(async () => ({
  idb: (await readAllConversationsFromDB()).length,
  conv: localStorage.getItem('miaou-conversations'),
  summ: localStorage.getItem('miaou-summaries'),
}));
check('une clé saine migre malgré l\'autre abîmée', mixed.idb === 2 && mixed.conv === null);
check('la clé abîmée voisine reste intacte', mixed.summ === 'résumés corrompus');
await page.evaluate(() => localStorage.removeItem('miaou-summaries'));

// ── 8. Interruption : onglet fermé avant la fin de la migration ─────────────
// Question Julien : la migration est-elle ravoyable, et sans doublon ?
// Trois issues possibles, toutes vérifiées ici. Fondement : la migration émet
// tous ses `put` dans UNE transaction, et la purge est post-commit — donc
// « tout ou rien », jamais un état partiel. Si quelqu'un découpe un jour la
// migration en lots (pour ménager la mémoire), ces trois contrôles sont ce qui
// détectera la régression.
await wipe();

// 8a. Transaction avortée = fermeture PENDANT l'écriture. Rien n'est écrit,
// pas même les `put` déjà émis (atomicité IDB), et la clé reste intacte.
const aborted = await page.evaluate(async (legacy) => {
  localStorage.setItem('miaou-conversations', legacy);
  const db = await openConvDB();
  const outcome = await new Promise((resolve) => {
    const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
    const store = tx.objectStore('conversations');
    for (const c of JSON.parse(legacy)) store.put(c);
    tx.onabort = () => resolve('aborted');
    tx.oncomplete = () => resolve('completed');
    tx.abort();   // l'onglet disparaît ici
  });
  return {
    outcome,
    inDb: (await readAllConversationsFromDB()).length,
    lsIntact: localStorage.getItem('miaou-conversations') !== null,
  };
}, legacyConvs);
check('interruption : la transaction avorte sans rien écrire',
  aborted.outcome === 'aborted' && aborted.inDb === 0);
check('interruption : localStorage reste intact (rien n\'est perdu)',
  aborted.lsIntact === true);

await boot();
const recovered = await page.evaluate(async () => {
  const all = await readAllConversationsFromDB();
  return {
    ids: all.map((c) => c.id).sort().join(','),
    msgs: (await readConversationFromDB('m-1')).messages.length,
    ls: localStorage.getItem('miaou-conversations'),
  };
});
check('interruption : le boot suivant rejoue la migration en entier',
  recovered.ids === 'm-1,m-2' && recovered.msgs === 2);
check('interruption : la purge a lieu à la reprise réussie', recovered.ls === null);

// 8b. Migration PARTIELLE : une partie déjà en base, la clé complète encore là.
// Inatteignable par interruption (transaction unique), mais possible par import
// ou palier de version — et c'est le cas où un doublon apparaîtrait.
await page.evaluate(async (legacy) => {
  const db = await openConvDB();
  await new Promise((r) => {
    const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
    tx.objectStore('conversations').clear();
    tx.oncomplete = r;
  });
  await new Promise((r) => {
    const tx = db.transaction('conversations', 'readwrite');
    tx.objectStore('conversations').put(JSON.parse(legacy)[0]);   // une seule des deux
    tx.oncomplete = r;
  });
  localStorage.setItem('miaou-conversations', legacy);
}, legacyConvs);
await boot();
const partial = await page.evaluate(async () => {
  const all = await readAllConversationsFromDB();
  return {
    count: all.length,
    uniques: new Set(all.map((c) => c.id)).size,
    msgs: all.map((c) => c.messages.length).sort().join(','),
    visible: listAllConversations().length,
  };
});
check('reprise partielle : le reste est migré, sans doublon',
  partial.count === 2 && partial.uniques === 2);
check('reprise partielle : aucun message perdu au passage', partial.msgs === '1,2');
check('reprise partielle : tout est visible', partial.visible === 2);

// ── 9. Boot vierge ──────────────────────────────────────────────────────────
await wipe();
await boot();
const virgin = await page.evaluate(async () => ({
  listed: listAllConversations().length,
  idb: (await readAllConversationsFromDB()).length,
}));
check('boot vierge : aucune conversation inventée',
  virgin.listed === 0 && virgin.idb === 0);

await page.screenshot({ path: path.join(outDir, '02-boot-vierge.png') });

// Les diagnostics « présent mais illisible » sont PROVOQUÉS par le scénario 7 :
// ce sont des attendus, pas des erreurs. Tout le reste doit être vide.
const expected = /est présent mais illisible/;
const unexpected = errors.filter((e) => !expected.test(e));
check('les clés illisibles sont diagnostiquées en console',
  errors.some((e) => expected.test(e)));
check('aucune erreur console INATTENDUE sur l\'ensemble du parcours',
  unexpected.length === 0 || (console.log('    → ' + unexpected.join(' | ')), false));

await browser.close();
console.log('\n' + (failures.length === 0
  ? `  OK — ${'tous les contrôles passent'}`
  : `  ÉCHEC — ${failures.length} contrôle(s) : ${failures.join(' ; ')}`));
process.exit(failures.length === 0 ? 0 : 1);
