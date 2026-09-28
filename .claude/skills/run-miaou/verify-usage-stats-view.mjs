#!/usr/bin/env node
// Consultation des statistiques d'usage (lot AJ, étape 3) : drawer, filtres,
// échelles, totaux. Les purs (fenêtres, échelles proposées, totaux, état du
// cache) sont couverts par tests/test-usage-stats.js ; ce script vérifie ce que
// QuickJS ne voit pas : le câblage des TROIS entrées, l'empilement sur les
// drawers existants, et ce que le tableau AFFICHE à partir d'un store seedé.
//
// Scénario, sur des statistiques seedées relatives à « aujourd'hui » :
//   1. État vide : aucune statistique → une phrase, pas de tableau.
//   2. Palette, touche `u` → drawer ouvert, tous serveurs ; échelles proposées
//      selon la donnée la plus ancienne (40 jours → semaine, mois, 3 mois) ;
//      défaut « 1 mois ».
//   3. Tableau « tous modèles » : une ligne par modèle + Total ; « n/d » sur un
//      modèle sans cache renseigné, astérisque sur le total partiel.
//   4. Serveur supprimé listé sous son DERNIER nom, marqué « supprimé ».
//   5. Glyphe « barres » d'une fiche serveur → drawer filtré sur CE serveur,
//      ouvert par-dessus réglages et serveurs ; Échap ne ferme que lui.
//      Ce serveur n'a que des données récentes : seule « 1 semaine » est
//      proposée, et devient l'échelle affichée.
//   6. Bouton de Réglages › Connexion → drawer, filtre remis à « tous ».
//   7. Modèles homonymes (même nom servi par plusieurs serveurs, dont un
//      supprimé) : une ligne par couple sous « Tous les serveurs », serveur en
//      suffixe sur les seuls homonymes ; filtre modèle par nom (homonyme listé
//      une fois), qui montre une ligne par serveur et le Total ; sous un filtre
//      serveur, plus de suffixe. Rejoué contre le code d'avant (regroupement par
//      nom) : rouge.
//
// Usage : node verify-usage-stats-view.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(path.resolve(__dirname, '../../..'), 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (detail !== undefined ? '  → ' + JSON.stringify(detail) : ''));
  if (!cond) failures.push(label);
};

const initScript = () => {
  if (localStorage.getItem('__aj_view_seeded') !== null) return;
  localStorage.setItem('__aj_view_seeded', '1');
  localStorage.setItem('miaou-api-servers', JSON.stringify([
    { id: 'srv-a', name: 'Maison', url: 'http://stub.local/v1', key: 'k', model: 'stub-model' },
    { id: 'srv-b', name: 'Bureau', url: 'http://stub.local/v1', key: 'k', model: 'stub-model' },
  ]));
  localStorage.setItem('miaou-active-api-server', 'srv-a');
  // Pas d'astuce d'accueil ni de titrage pendant le script : aucun appel
  // silencieux ne viendrait modifier le store entre le seed et la lecture.
  localStorage.setItem('miaou-settings', JSON.stringify({ summaryInjectionMode: 'never', didYouKnow: false }));
};

const browser = await launchIsolated({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await context.addInitScript(initScript);
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 10000 });

const drawerOpen = (id) => page.evaluate((i) => document.getElementById(i).classList.contains('show'), id);
const waitRendered = () => page.waitForFunction(() => {
  const b = document.getElementById('usage-body');
  return b && !/^Lecture/.test(b.textContent) && b.textContent.length > 0;
}, null, { timeout: 8000 });
const pillLabels = () => page.evaluate(() =>
  [...document.querySelectorAll('#usage-filters .pill-select-btn span')].map(s => s.textContent));
const menuOptions = async (index) => {
  const btn = page.locator('#usage-filters .pill-select-btn').nth(index);
  await btn.click();
  const opts = await page.evaluate((i) =>
    [...document.querySelectorAll('#usage-filters .pill-select')[i].querySelectorAll('.model-opt span:first-child')]
      .map(s => s.textContent), index);
  await btn.click();   // referme
  return opts;
};
const tableRows = () => page.evaluate(() =>
  [...document.querySelectorAll('#usage-body .usage-table tbody tr')].map(tr =>
    [...tr.children].map(td => td.textContent)));
const cellTip = (row, col) => page.evaluate(({ r, c }) => {
  const td = document.querySelectorAll('#usage-body .usage-table tbody tr')[r].children[c];
  return getTip(td) ? (getTip(td).text || getTip(td)) : null;
}, { r: row, c: col });

// ── 1. État vide ────────────────────────────────────────────────────────────
console.log('\n— 1. Aucune statistique');
await page.evaluate(() => openUsageStats());
await waitRendered();
check('phrase d\'état vide, pas de tableau', await page.evaluate(() =>
  !!document.querySelector('#usage-body .usage-empty') && !document.querySelector('#usage-body .usage-table')));
await page.evaluate(() => closeUsageStats());

// ── Seed : jours relatifs à aujourd'hui ─────────────────────────────────────
const today = await page.evaluate(() => localDayKey(Date.now()));
const seeded = await page.evaluate((t) => {
  const r = (daysAgo, serverId, model, o) => Object.assign({
    day: usageAddDays(t, -daysAgo), serverId, model, purpose: 'chat', serverName: 'N-' + serverId,
    calls: 0, unmeasured: 0, inTokens: 0, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 0 }, o);
  const recs = [
    // srv-a : 40 jours d'ancienneté → semaine, mois, 3 mois proposés.
    r(0, 'srv-a', 'qwen', { calls: 4, inTokens: 4000, cachedTokens: 3000, cachedKnownCalls: 4, outTokens: 400 }),
    r(10, 'srv-a', 'qwen', { calls: 2, inTokens: 2000, cachedTokens: 1000, cachedKnownCalls: 2, outTokens: 200 }),
    r(3, 'srv-a', 'mistral', { calls: 3, unmeasured: 1, inTokens: 1500, outTokens: 90 }),   // cache jamais renseigné
    r(40, 'srv-a', 'qwen', { calls: 1, inTokens: 999, cachedTokens: 0, cachedKnownCalls: 1, outTokens: 9 }),
    // srv-b : données récentes seulement.
    r(1, 'srv-b', 'gpt', { calls: 5, inTokens: 500, cachedTokens: 100, cachedKnownCalls: 5, outTokens: 50 }),
    // Serveur supprimé : le nom le plus récent doit gagner.
    r(20, 'srv-gone', 'old', { calls: 1, inTokens: 10, outTokens: 1, serverName: 'Ancien nom' }),
    r(5, 'srv-gone', 'old', { calls: 1, inTokens: 10, outTokens: 1, serverName: 'Dernier nom' }),
  ];
  return replaceUsageStatsFromImport(recs);
}, today);
check('prémisse : statistiques seedées', seeded === 7, seeded);

// ── 2. Palette, touche u ────────────────────────────────────────────────────
console.log('\n— 2. Palette (touche u), échelles proposées, défaut');
await page.evaluate(() => openCommandPalette());
await page.waitForSelector('#cmdk-overlay:not([hidden])');
await page.keyboard.press('u');
await page.waitForFunction(() => document.getElementById('usage-drawer').classList.contains('show'), null, { timeout: 5000 });
await waitRendered();
check('la touche u ouvre le drawer', await drawerOpen('usage-drawer'));
let labels = await pillLabels();
check('filtres : tous serveurs, tous modèles, échelle « 1 mois » par défaut',
  labels[0] === 'Tous les serveurs' && labels[1] === 'Tous les modèles' && labels[2] === '1 mois', labels);
check('échelles proposées : semaine, mois, 3 mois (donnée la plus ancienne à 40 jours)',
  JSON.stringify(await menuOptions(2)) === JSON.stringify(['1 semaine', '1 mois', '3 mois']));
const periodText = await page.textContent('#usage-body .usage-period');
const win = await page.evaluate((t) => usageScaleWindow('month', t), today);
const expectedStart = await page.evaluate((k) => formatUsageDay(k), win.start);
check('période affichée : du début du mois glissant à aujourd\'hui', periodText.indexOf('Du ' + expectedStart) === 0, periodText);

// ── 3. Tableau ──────────────────────────────────────────────────────────────
console.log('\n— 3. Totaux par modèle, « n/d », astérisque');
let rows = await tableRows();
const nb = (s) => Number(String(s).replace(/[^\d]/g, ''));
const byModel = Object.fromEntries(rows.map(r => [r[0], r]));
check('une ligne par modèle de la période + Total (le record à 40 jours est hors fenêtre)',
  JSON.stringify(rows.map(r => r[0])) === JSON.stringify(['qwen', 'mistral', 'gpt', 'old', 'Total']), rows.map(r => r[0]));
check('qwen : 6 requêtes, 6 000 en entrée, 4 000 en cache', byModel.qwen && nb(byModel.qwen[1]) === 6
  && nb(byModel.qwen[2]) === 6000 && nb(byModel.qwen[3]) === 4000, byModel.qwen);
check('mistral : cache « n/d », 1 appel non mesuré', byModel.mistral && byModel.mistral[3] === 'n/d'
  && nb(byModel.mistral[5]) === 1, byModel.mistral);
check('« n/d » porte son explication en infobulle', /Aucun appel/.test(String(await cellTip(1, 3))));
const total = byModel.Total || [];
check('Total : 16 requêtes, 8 020 en entrée', nb(total[1]) === 16 && nb(total[2]) === 8020, total);
check('Total : cache partiel marqué d\'une astérisque', /\*$/.test(total[3] || ''), total[3]);
check('l\'astérisque dit combien d\'appels ont renseigné le cache',
  /11 appels sur 15 mesurés/.test(String(await cellTip(rows.length - 1, 3))), await cellTip(rows.length - 1, 3));

// ── 4. Serveur supprimé ─────────────────────────────────────────────────────
console.log('\n— 4. Serveur supprimé dans le filtre');
const serverOpts = await menuOptions(0);
check('serveurs : tous, vivants, puis supprimé sous son dernier nom',
  JSON.stringify(serverOpts) === JSON.stringify(['Tous les serveurs', 'Maison', 'Bureau', 'Dernier nom (supprimé)']), serverOpts);
await page.evaluate(() => closeUsageStats());

// ── 5. Glyphe de fiche serveur, empilement, Échap ───────────────────────────
console.log('\n— 5. Glyphe « barres » d\'une fiche : filtré, empilé, Échap');
await page.evaluate(() => { openSettings(); openApiServers(); });
await page.waitForSelector('#api-drawer.show .api-usage');
const glyphs = await page.evaluate(() =>
  [...document.querySelectorAll('#api-list .api-usage')].filter(b => b.offsetParent !== null).length);
check('un glyphe visible par fiche serveur', glyphs === 2, glyphs);
check('le glyphe a un nom accessible', await page.evaluate(() =>
  document.querySelector('#api-list .api-usage').getAttribute('aria-label')) === 'Statistiques d’usage de ce serveur');
// Fiche « Bureau » = deuxième carte.
await page.locator('#api-list .api-card').nth(1).locator('.api-usage').click();
await waitRendered();
labels = await pillLabels();
check('drawer filtré sur le serveur de la fiche', labels[0] === 'Bureau', labels);
check('données récentes seulement : « 1 semaine », seule proposée, est affichée', labels[2] === '1 semaine'
  && JSON.stringify(await menuOptions(2)) === JSON.stringify(['1 semaine']), labels);
rows = await tableRows();
check('une seule ligne (un seul modèle, pas de Total redondant)', rows.length === 1 && rows[0][0] === 'gpt', rows);
check('ouvert PAR-DESSUS : réglages et serveurs restent ouverts',
  await drawerOpen('drawer') && await drawerOpen('api-drawer') && await drawerOpen('usage-drawer'));
// Attendre la FIN de la glissière (transform → none) : mesurée pendant la
// transition, la boîte est encore hors écran et le contrôle échoue au hasard du
// temps écoulé depuis l'ouverture (vu sous régression injectée, 2026-09-29).
await page.waitForFunction(() => getComputedStyle(document.getElementById('usage-drawer')).transform === 'none',
  null, { timeout: 3000 }).catch(() => {});
const onTop = await page.evaluate(() => {
  const r = document.getElementById('usage-drawer').getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + 30);
  return !!(el && el.closest('#usage-drawer'));
});
check('le drawer des statistiques est bien celui qu\'on voit (au-dessus des serveurs)', onTop);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Échap ne ferme que les statistiques', !(await drawerOpen('usage-drawer')) && await drawerOpen('api-drawer') && await drawerOpen('drawer'));
const modifierAtRight = await page.evaluate(() => {
  const row = document.querySelector('#api-list .api-card .api-view-row');
  const btns = [...row.children];
  const last = btns[btns.length - 1];
  return { last: last.textContent, gap: Math.round(row.getBoundingClientRect().right - last.getBoundingClientRect().right) };
});
check('« Modifier » reste le dernier bouton, collé à droite de la rangée', modifierAtRight.last === 'Modifier' && modifierAtRight.gap <= 2, modifierAtRight);
await page.evaluate(() => closeApiServers());

// ── 6. Entrée des réglages ──────────────────────────────────────────────────
console.log('\n— 6. Réglages › Connexion');
await page.locator('#drawer .btn-row button:has-text("Statistiques d\'usage")').click();
await waitRendered();
labels = await pillLabels();
check('le bouton de Connexion ouvre le drawer, tous serveurs', await drawerOpen('usage-drawer') && labels[0] === 'Tous les serveurs', labels);

// ── 7. Modèles homonymes ────────────────────────────────────────────────────
console.log('\n— 7. Modèles homonymes entre serveurs');
await page.evaluate(() => closeUsageStats());
// replaceUsageStatsFromImport ne fait que des `put` : c'est l'import qui vide
// le store avant (clearIdbStore). Sans ce vidage, le jeu précédent reste.
const reseeded = await page.evaluate(async (t) => {
  await clearIdbStore('usage_stats');
  const r = (daysAgo, serverId, model, o) => Object.assign({
    day: usageAddDays(t, -daysAgo), serverId, model, purpose: 'chat', serverName: 'N-' + serverId,
    calls: 0, unmeasured: 0, inTokens: 0, cachedTokens: 0, cachedKnownCalls: 0, outTokens: 0 }, o);
  return replaceUsageStatsFromImport([
    r(0, 'srv-a', 'qwen', { calls: 4, inTokens: 4000, outTokens: 400 }),
    r(1, 'srv-b', 'qwen', { calls: 2, inTokens: 2000, outTokens: 200 }),
    r(2, 'srv-gone', 'qwen', { calls: 1, inTokens: 700, outTokens: 70, serverName: 'Dernier nom' }),
    r(3, 'srv-a', 'mistral', { calls: 3, inTokens: 1500, outTokens: 90 }),
  ]);
}, today);
check('prémisse : homonymes seedés', reseeded === 4, reseeded);
await page.evaluate(() => openUsageStats());
await waitRendered();
const NB = '\u00a0· ';
rows = await tableRows();
check('tous serveurs : une ligne par couple, serveur en suffixe sur les seuls homonymes (supprimé compris)',
  JSON.stringify(rows.map(r => r[0])) === JSON.stringify(
    ['qwen' + NB + 'Maison', 'qwen' + NB + 'Bureau', 'mistral', 'qwen' + NB + 'Dernier nom (supprimé)', 'Total']),
  rows.map(r => r[0]));
check('chaque ligne homonyme porte les chiffres de SON serveur',
  nb(rows[0][2]) === 4000 && nb(rows[1][2]) === 2000 && nb(rows[3][2]) === 700, rows.map(r => r[2]));
const muted = await page.evaluate(() => {
  const td = document.querySelector('#usage-body .usage-table tbody tr td.usage-model');
  const sv = td.querySelector('.usage-server');
  return !!sv && getComputedStyle(sv).color !== getComputedStyle(td).color;
});
check('le suffixe serveur est atténué (couleur distincte du nom)', muted);
const modelOpts = await menuOptions(1);
check('filtre modèle : homonyme listé une fois, par nom',
  JSON.stringify(modelOpts) === JSON.stringify(['Tous les modèles', 'mistral', 'qwen']), modelOpts);
await page.locator('#usage-filters .pill-select-btn').nth(1).click();
await page.locator('#usage-filters .pill-select').nth(1).locator('.model-opt', { hasText: 'qwen' }).click();
await waitRendered();
rows = await tableRows();
check('filtre « qwen » sous tous serveurs : une ligne par serveur et le Total',
  JSON.stringify(rows.map(r => r[0])) === JSON.stringify(
    ['qwen' + NB + 'Maison', 'qwen' + NB + 'Bureau', 'qwen' + NB + 'Dernier nom (supprimé)', 'Total'])
  && nb(rows[3][2]) === 6700, rows.map(r => [r[0], r[2]]));
await page.evaluate(() => closeUsageStats());
await page.evaluate(() => openUsageStats({ serverId: 'srv-b' }));
await waitRendered();
rows = await tableRows();
check('filtre serveur : plus de suffixe, une seule ligne', rows.length === 1 && rows[0][0] === 'qwen', rows);

const unexpected = errors.filter(e => !/Failed to load resource/.test(e));
check('aucune erreur console', unexpected.length === 0, unexpected);

await browser.close();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nTout est vert');
process.exit(failures.length ? 1 : 0);
