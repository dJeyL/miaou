// Vérifie qu'un onglet MIAOU LIBÈRE la base quand un autre la monte de version
// (releaseSupersededDb, storage.js). Motif : sans handler `versionchange`, une
// connexion restée ouverte dans un onglet ancien BLOQUE l'ouverture du nouvel
// onglet — sans erreur ni délai : son init() attend l'hydratation et l'écran de
// démarrage ne se lève jamais. Le défaut n'est visible qu'au bump de
// MIAOU_DB_VERSION, d'où ce verify qui le simule sans rien bumper.
//
// Montage : deux pages du MÊME contexte (même origine file://, même base).
// L'onglet A démarre normalement et ouvre ses deux connexions (openConvDB,
// openResourceDB — la seconde forcée par un appel, elle est paresseuse). L'onglet
// B ouvre ensuite la base à MIAOU_DB_VERSION + 1, lu depuis la constante vivante.
//
// Checklist :
//   1. l'ouverture à version+1 ABOUTIT (onsuccess), sans rester bloquée ;
//   2. A affiche le bandeau « version plus récente » ;
//   3. le bandeau tient contre un recalcul du peering (refreshTabBanner) ;
//   4. témoin : A avait bien ses deux connexions ouvertes avant la montée.
//
// Rejoué sur le code d'avant : le check 1 tombe (blocked, jamais success).
// Usage : node verify-db-versionchange.mjs
import { launchIsolated } from './stub-backend.js';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');

const results = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok, extra }); }

const browser = await launchIsolated({});
const context = await browser.newContext();
const pageErrors = [];

async function boot(page) {
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(appUrl);
  await page.waitForSelector('#composer-text');
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null);
}

const a = await context.newPage();
await boot(a);
const opened = await a.evaluate(async () => {
  const c = await openConvDB();
  const r = await openResourceDB();
  return { conv: !!c, res: !!r, version: MIAOU_DB_VERSION };
});
check('4. témoin : A tient ses deux connexions (conv + ressources)', opened.conv && opened.res, opened);

// B : une page vierge de la même origine suffit (pas besoin d'un second boot,
// qui ouvrirait lui aussi des connexions à la version courante).
const b = await context.newPage();
await b.goto(appUrl.replace(/miaou\.html$/, 'miaou.html#blank'));
const outcome = await b.evaluate((v) => new Promise((resolve) => {
  const events = [];
  const req = indexedDB.open('miaou', v + 1);
  req.onblocked = () => events.push('blocked');
  req.onupgradeneeded = () => events.push('upgrade');
  req.onsuccess = (e) => { events.push('success'); e.target.result.close(); resolve(events); };
  req.onerror = () => { events.push('error'); resolve(events); };
  setTimeout(() => resolve(events.concat('timeout')), 4000);
}), opened.version);
check('1. l\'ouverture à version+1 aboutit sans rester bloquée', outcome.includes('success') && !outcome.includes('timeout'), outcome);

const bannerA = await a.evaluate(() => {
  const el = document.getElementById('tab-banner');
  return { shown: el.classList.contains('show'), text: document.getElementById('tab-banner-text').textContent };
});
check('2. A affiche le bandeau « version plus récente »', bannerA.shown && /version plus récente/.test(bannerA.text), bannerA);

const bannerA2 = await a.evaluate(() => {
  refreshTabBanner();
  return document.getElementById('tab-banner-text').textContent;
});
check('3. le bandeau tient contre un recalcul du peering', /version plus récente/.test(bannerA2), bannerA2);

// Une ligne de console.warn est attendue (le handler la pose) : seules les
// exceptions de page comptent ici.
check('aucune exception de page', pageErrors.length === 0, pageErrors);

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.ok ? '' : '  → ' + JSON.stringify(r.extra)));
}
await browser.close();
console.log(failed ? `\n${failed} échec(s)` : '\nOK');
process.exit(failed ? 1 : 0);
