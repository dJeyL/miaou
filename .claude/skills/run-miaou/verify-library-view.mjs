#!/usr/bin/env node
// Vérification de la vue de la bibliothèque de fichiers d'Espace (2026-10-12) :
// tri, vue concise, et suivi de la carte cible (défilement + liseré).
//
// Ce que les tests QuickJS couvrent déjà : les purs `sortLibraryEntries`,
// `toggleLibrarySort`, `normalizeLibraryView`, `libraryRevealTargets`. Ce
// qu'ils ne voient pas, et qui motive ce script : le câblage des boutons, le
// collateur Intl réellement injecté par l'UI (ordre numérique), la persistance
// au reload, ce que la vue concise rend VISIBLE (pas la classe posée), et le
// diff avant/après rendu qui désigne la carte à montrer — un arrivant qui n'est
// plus en bas de liste, une carte que le renommage déplace.
//
// Blocs, dans l'ordre du script :
//   A. défaut : date croissante, barre visible, critère actif marqué.
//   B. tri par nom (ordre numérique fichier2 < fichier10, casse ignorée), second
//      clic = inverse ; tri par taille dans les deux sens.
//   C. le tri survit au reload.
//   D. vue concise : description et rangée d'actions invisibles, nom, méta et
//      téléchargement visibles ; survit au reload ; retour en vue détaillée.
//   E. arrivant sous date DÉCROISSANTE, panneau défilé en bas : la carte
//      arrive en TÊTE, la liste remonte jusqu'à elle et la signale — l'ancien
//      « scroll en bas » la laissait hors de vue.
//   F. renommage sous tri par nom : la carte passe en fin de liste, suivie et
//      signalée. Témoin : sous tri par date, un renommage ne signale rien.
//   G. bibliothèque vide : barre masquée.
//
// Usage : node verify-library-view.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label + (extra !== undefined && !cond ? '  → ' + JSON.stringify(extra) : ''));
  if (!cond) failures.push(label);
};

const browser = await launchIsolated({ headless: !headed });
// Viewport bas : il faut une liste plus haute que le panneau pour que
// « défilé en bas » et « amené en vue » diffèrent (bloc E).
const page = await browser.newPage({ viewport: { width: 1280, height: 560 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const SPACE_ID = 'sp-lv';

await page.addInitScript(({ SPACE_ID }) => {
  if (localStorage.getItem('miaou-spaces') !== null) return;   // premier chargement seulement
  localStorage.setItem('miaou-spaces', JSON.stringify([{ id: SPACE_ID, name: 'Vue biblio', createdAt: 1 }]));
  localStorage.setItem('miaou-active-space', SPACE_ID);
}, { SPACE_ID });

const bootWait = async () => {
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 10000 });
};

await page.goto('file://' + distPath);
await bootWait();

// Noms choisis pour que chaque critère donne un ordre DIFFÉRENT des deux autres
// (sinon un tri qui ignore le critère passerait) : date, nom et taille
// produisent trois permutations distinctes.
const seeded = await page.evaluate(({ SPACE_ID }) => {
  const buf = (n) => new Uint8Array(n).buffer;
  const R = (id, name, size, createdAt, description) => ({
    id, kind: 'library', spaceId: SPACE_ID, class: 'inline', mime: 'text/plain',
    name, size, createdAt, data: buf(size), description,
  });
  const RECORDS = [
    R('lib-a', 'beta.txt', 300, 10, 'Notes de réunion, version longue pour occuper de la hauteur dans la carte.'),
    R('lib-b', 'Alpha.md', 100, 30, 'Plan du projet.'),
    R('lib-c', 'fichier10.csv', 200, 20, 'Export dix.'),
    R('lib-d', 'fichier2.csv', 50, 40, 'Export deux.'),
  ];
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('miaou');
    req.onsuccess = (e) => {
      const tx = e.target.result.transaction('resources', 'readwrite');
      for (const r of RECORDS) tx.objectStore('resources').put(r);
      tx.oncomplete = () => resolve(RECORDS.length);
      tx.onerror = (ev) => reject(ev.target.error);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}, { SPACE_ID });
check('fixture : fichiers écrits en IDB', seeded === 4);

const openFilesTab = async () => {
  await page.evaluate(() => {
    if (!document.querySelector('.app').classList.contains('sidebar-open')) toggleSidebar();
    document.getElementById('space-tab-files').click();
  });
  await page.waitForFunction(() => document.querySelectorAll('#space-files-list .mem-item').length > 0, { timeout: 5000 });
};
const order = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#space-files-list .mem-item')).map(el => el.dataset.id));
const clickSort = async (key) => {
  const before = await order();
  await page.click('#library-sort-' + key);
  // Rendu async (IDB) : attendre que l'ordre ait bougé OU que le bouton soit
  // actif — un clic qui ne réordonne rien (même ordre) ne doit pas bloquer.
  await page.waitForFunction(({ key }) =>
    document.getElementById('library-sort-' + key).classList.contains('active'), { key });
  await page.waitForTimeout(150);
  return before;
};
const state = (key) => page.evaluate((key) => {
  const b = document.getElementById('library-sort-' + key);
  const dir = b.querySelector('.sort-dir');
  return { active: b.classList.contains('active'), pressed: b.getAttribute('aria-pressed'),
           arrow: !!dir.querySelector('svg'), desc: dir.classList.contains('desc') };
}, key);

await page.reload();
await bootWait();
await openFilesTab();

// ══ A. Défaut ════════════════════════════════════════════════════════════
const toolbarVisible = () => page.evaluate(() => document.getElementById('library-toolbar').getClientRects().length > 0);
check('A : barre de vue visible sur bibliothèque peuplée', await toolbarVisible());
check('A : défaut = date croissante', JSON.stringify(await order()) === JSON.stringify(['lib-a', 'lib-c', 'lib-b', 'lib-d']), await order());
const dA = await state('date');
check('A : Date actif, pressé, flèche montante', dA.active && dA.pressed === 'true' && dA.arrow && !dA.desc, dA);
const nA = await state('name');
check('A : Nom inactif, sans flèche', !nA.active && nA.pressed === 'false' && !nA.arrow, nA);

// ══ B. Tri ═══════════════════════════════════════════════════════════════
await clickSort('name');
check('B : nom croissant, ordre numérique et casse ignorée',
  JSON.stringify(await order()) === JSON.stringify(['lib-b', 'lib-a', 'lib-d', 'lib-c']), await order());
await page.click('#library-sort-name');
await page.waitForFunction(() => document.querySelector('#library-sort-name .sort-dir').classList.contains('desc'));
await page.waitForTimeout(150);
check('B : second clic sur Nom = décroissant',
  JSON.stringify(await order()) === JSON.stringify(['lib-c', 'lib-d', 'lib-a', 'lib-b']), await order());
const tipName = await page.evaluate(() => getTip(document.getElementById('library-sort-name')));
check('B : infobulle du critère actif dit le sens', tipName === 'Nom, de Z à A — cliquer pour inverser', tipName);
await clickSort('size');
check('B : taille croissante (autre critère → croissant)',
  JSON.stringify(await order()) === JSON.stringify(['lib-d', 'lib-b', 'lib-c', 'lib-a']), await order());
await page.click('#library-sort-size');
await page.waitForFunction(() => document.querySelector('#library-sort-size .sort-dir').classList.contains('desc'));
await page.waitForTimeout(150);
check('B : taille décroissante',
  JSON.stringify(await order()) === JSON.stringify(['lib-a', 'lib-c', 'lib-b', 'lib-d']), await order());

// ══ C. Persistance du tri ════════════════════════════════════════════════
await page.reload();
await bootWait();
await openFilesTab();
check('C : tri par taille décroissante retenu au reload',
  JSON.stringify(await order()) === JSON.stringify(['lib-a', 'lib-c', 'lib-b', 'lib-d']), await order());
const sC = await state('size');
check('C : barre resynchronisée (Taille actif, décroissant)', sC.active && sC.desc, sC);

// ══ D. Vue concise ═══════════════════════════════════════════════════════
const visibility = () => page.evaluate(() => {
  const it = document.querySelector('#space-files-list .mem-item[data-id="lib-a"]');
  const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none';
  return {
    name: vis(it.querySelector('.file-name-edit')),
    meta: vis(it.querySelector('.file-meta')),
    dl: vis(it.querySelector('.mem-dl')),
    desc: vis(it.querySelector('.file-description-line')),
    btns: vis(it.querySelector('.drawer-btns')),
    h: Math.round(it.getBoundingClientRect().height),
  };
});
const vDetail = await visibility();
check('D : témoin vue détaillée — description et actions visibles', vDetail.desc && vDetail.btns, vDetail);
await page.click('#library-concise-btn');
await page.waitForFunction(() => document.getElementById('library-concise-btn').getAttribute('aria-pressed') === 'true');
const vConcise = await visibility();
check('D : concise — description et actions invisibles', !vConcise.desc && !vConcise.btns, vConcise);
check('D : concise — nom, méta et téléchargement visibles', vConcise.name && vConcise.meta && vConcise.dl, vConcise);
check('D : la carte a réellement rapetissé', vConcise.h < vDetail.h, { detail: vDetail.h, concise: vConcise.h });
await page.reload();
await bootWait();
await openFilesTab();
const vReload = await visibility();
check('D : vue concise retenue au reload', !vReload.desc && !vReload.btns
  && await page.evaluate(() => document.getElementById('library-concise-btn').classList.contains('active')), vReload);
await page.click('#library-concise-btn');
await page.waitForFunction(() => document.getElementById('library-concise-btn').getAttribute('aria-pressed') === 'false');
const vBack = await visibility();
check('D : retour en vue détaillée', vBack.desc && vBack.btns, vBack);

// ══ E. Arrivant sous date décroissante ═══════════════════════════════════
await clickSort('date');                       // date croissante
await page.click('#library-sort-date');        // → décroissante
await page.waitForFunction(() => document.querySelector('#library-sort-date .sort-dir').classList.contains('desc'));
await page.waitForTimeout(150);
const geomPre = await page.evaluate(() => {
  const p = document.getElementById('space-files-panel');
  p.scrollTop = p.scrollHeight;
  return { scrollTop: p.scrollTop, scrollHeight: p.scrollHeight, clientHeight: p.clientHeight };
});
check('E : prémisse — la liste déborde du panneau et il est défilé en bas',
  geomPre.scrollHeight > geomPre.clientHeight + 100 && geomPre.scrollTop > 100, geomPre);
await page.evaluate(({ SPACE_ID }) => storeLibraryFile(SPACE_ID, 'text/plain', 'arrivant.txt',
  new Uint8Array(42).buffer, 'inline', null, null, Date.now(), Math.random), { SPACE_ID });
await page.waitForFunction(() => {
  const first = document.querySelector('#space-files-list .mem-item');
  return first && first.classList.contains('is-target');
}, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(700);   // défilement smooth
const geomE = await page.evaluate(() => {
  const p = document.getElementById('space-files-panel').getBoundingClientRect();
  const items = Array.from(document.querySelectorAll('#space-files-list .mem-item'));
  const first = items[0];
  const r = first.getBoundingClientRect();
  return {
    firstName: first.querySelector('.file-name-edit').textContent,
    targeted: items.filter(el => el.classList.contains('is-target')).map(el => el.querySelector('.file-name-edit').textContent),
    top: Math.round(r.top), bottom: Math.round(r.bottom), pTop: Math.round(p.top), pBottom: Math.round(p.bottom),
  };
});
check('E : l\'arrivant est en tête (date décroissante)', geomE.firstName === 'arrivant.txt', geomE);
check('E : seul l\'arrivant est signalé', JSON.stringify(geomE.targeted) === JSON.stringify(['arrivant.txt']), geomE);
check('E : l\'arrivant est entièrement dans le panneau',
  geomE.pTop <= geomE.top && geomE.bottom <= geomE.pBottom, geomE);
await page.waitForTimeout(1800);
check('E : le liseré se retire', await page.evaluate(() => !document.querySelector('#space-files-list .mem-item.is-target')));

// ══ F. Renommage sous tri par nom ════════════════════════════════════════
const rename = async (id, text) => {
  const sel = '#file-name-' + id;
  await page.evaluate((s) => { document.querySelector(s).focus(); }, sel);
  await page.waitForFunction((s) => document.activeElement === document.querySelector(s), sel);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const range = document.createRange(); range.selectNodeContents(el);
    const sl = window.getSelection(); sl.removeAllRanges(); sl.addRange(range);
  }, sel);
  await page.keyboard.type(text, { delay: 20 });
  await page.waitForFunction(({ s, t }) => document.querySelector(s).textContent === t, { s: sel, t: text });
  await page.keyboard.press('Enter');
};

// Témoin d'abord, sous date décroissante : un renommage ne déplace rien et ne
// signale rien.
const orderBeforeWitness = await order();
await rename('lib-c', 'fichier10-bis.csv');
await page.waitForTimeout(600);
check('F : témoin date — ordre inchangé après renommage', JSON.stringify(await order()) === JSON.stringify(orderBeforeWitness), await order());
check('F : témoin date — rien n\'est signalé', await page.evaluate(() => !document.querySelector('#space-files-list .mem-item.is-target')));

await clickSort('name');
await page.evaluate(() => { document.getElementById('space-files-panel').scrollTop = 0; });
const firstByName = (await order())[0];
check('F : prémisse — Alpha.md en tête sous tri par nom', firstByName === 'lib-b', await order());
await rename('lib-b', 'zzz.md');
await page.waitForFunction(() => {
  const items = document.querySelectorAll('#space-files-list .mem-item');
  return items.length && items[items.length - 1].dataset.id === 'lib-b';
}, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(700);
const geomF = await page.evaluate(() => {
  const p = document.getElementById('space-files-panel').getBoundingClientRect();
  const items = Array.from(document.querySelectorAll('#space-files-list .mem-item'));
  const card = document.querySelector('#space-files-list .mem-item[data-id="lib-b"]');
  const r = card.getBoundingClientRect();
  return {
    lastId: items[items.length - 1].dataset.id,
    targeted: items.filter(el => el.classList.contains('is-target')).map(el => el.dataset.id),
    top: Math.round(r.top), bottom: Math.round(r.bottom), pTop: Math.round(p.top), pBottom: Math.round(p.bottom),
  };
});
check('F : la carte renommée passe en fin de liste', geomF.lastId === 'lib-b', geomF);
check('F : elle seule est signalée', JSON.stringify(geomF.targeted) === JSON.stringify(['lib-b']), geomF);
check('F : elle est amenée dans le panneau', geomF.pTop <= geomF.top && geomF.bottom <= geomF.pBottom, geomF);

// ══ G. Bibliothèque vide ═════════════════════════════════════════════════
await page.evaluate(async ({ SPACE_ID }) => {
  for (const r of await getResourcesBySpace(SPACE_ID)) await deleteResource(r.id);
  await renderSpaceFilesList(SPACE_ID);
}, { SPACE_ID });
check('G : barre masquée sur bibliothèque vide', !(await toolbarVisible()));

check('aucune erreur console', consoleErrors.length === 0, consoleErrors);

await browser.close();
console.log(failures.length ? `\n  ${failures.length} échec(s)` : '\n  Tout vert.');
process.exit(failures.length ? 1 : 0);
