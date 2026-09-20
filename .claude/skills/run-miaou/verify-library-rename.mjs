#!/usr/bin/env node
// Vérification du renommage d'un fichier de bibliothèque d'Espace (2026-09-20).
//
// Ce que les tests QuickJS couvrent déjà : le pur `normalizeLibraryName`
// (blancs, fallback, cap). Ce qu'ils ne peuvent PAS voir, et qui motive ce
// script : le câblage `contenteditable` (wireLibraryNameEditing), la
// persistance IDB (renameLibraryFile), et surtout la SURVIE AU RELOAD — un
// renommage qui ne tient que dans le DOM est exactement le défaut qu'un test
// pur laisse passer.
//
// Les gestes couverts, dans l'ordre où le script les joue (E d'abord : c'est
// le premier contact avec le champ) — énumérés sans cardinal, un compte dans un
// en-tête de verify expire en silence au prochain ajout :
//   E. au focus, le RADICAL est présélectionné (tout sauf l'extension) — le
//      pur `libraryNameStemLength` dit où couper, seul le navigateur dit si la
//      Range a bien été posée, et surtout si elle survit au placement de caret
//      que le clic effectue derrière (d'où le requestAnimationFrame).
//   A. saisie d'un nom entier → Entrée → le store a le nouveau nom, et il
//      survit au reload.
//   B. Échap → le nom d'avant revient, le store n'a pas bougé.
//   C. saisie vidée → le nom d'avant revient (jamais de nom vide en base).
//   F. la ligne méta : type lisible + date de dépôt nue + provenance abrégée, et
//      les trois tiennent sur UNE ligne — la mesure est le point, le mime brut
//      en poussait quatre à lui seul.
//   D. la DESCRIPTION n'a pas bougé après renommage (décision : elle décrit le
//      contenu). Contrôle négatif : sans lui, le test ne prouve que la moitié
//      de la règle.
//
// Usage : node verify-library-rename.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-library-rename');
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

const SPACE_ID = 'sp-rn';

await page.addInitScript(({ SPACE_ID }) => {
  localStorage.setItem('miaou-spaces', JSON.stringify([
    { id: SPACE_ID, name: 'Refonte du site', createdAt: 1 },
  ]));
  localStorage.setItem('miaou-active-space', SPACE_ID);
}, { SPACE_ID });

const bootWait = async () => {
  await page.waitForSelector('#composer-text', { timeout: 10000 });
  // `.boot-done` est un ÉTAT, jamais un waitForSelector (il attend la
  // visibilité, et l'overlay est invisible quand il reçoit la classe — skill
  // run-miaou). L'overlay n'est jamais retiré du DOM : on attend la classe.
  await page.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 10000 });
};

await page.goto('file://' + distPath);
await bootWait();

// Deux fichiers : l'un avec description (le sujet du renommage, pour pouvoir
// vérifier qu'elle survit), l'autre sans (voisin — sert de témoin que le
// renommage ne déborde pas sur la carte d'à côté).
const seeded = await page.evaluate(({ SPACE_ID }) => {
  const enc = new TextEncoder();
  const csv = enc.encode('a,b\n1,2\n').buffer;
  const RECORDS = [
    { id: 'lib-r1', kind: 'library', spaceId: SPACE_ID, class: 'inline', mime: 'text/csv',
      name: 'export-final-v2-VRAIMENT-final.csv', size: csv.byteLength, createdAt: 1, data: csv,
      description: 'Référentiel produits, deux colonnes.' },
    { id: 'lib-r2', kind: 'library', spaceId: SPACE_ID, class: 'inline', mime: 'text/plain',
      name: 'notes.txt', size: csv.byteLength, createdAt: 2, data: csv },
  ];
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('miaou');
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('resources', 'readwrite');
      const store = tx.objectStore('resources');
      for (const r of RECORDS) store.put(r);
      tx.oncomplete = () => resolve(RECORDS.length);
      tx.onerror = (ev) => reject(ev.target.error);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}, { SPACE_ID });
check('fixture : 2 fichiers de bibliothèque écrits en IDB', seeded === 2);

await page.reload();
await bootWait();

// Lecture du store, jamais du DOM : c'est le seul témoin qui prouve une
// persistance (le DOM peut porter un nom que rien n'a écrit).
const readStore = (id) => page.evaluate((id) => new Promise((resolve, reject) => {
  const req = indexedDB.open('miaou');
  req.onsuccess = (e) => {
    const tx = e.target.result.transaction('resources', 'readonly');
    const g = tx.objectStore('resources').get(id);
    g.onsuccess = () => resolve(g.result ? { name: g.result.name, description: g.result.description || null } : null);
    g.onerror = (ev) => reject(ev.target.error);
  };
  req.onerror = (e) => reject(e.target.error);
}), id);

// La sidebar doit être OUVERTE : repliée, le panneau « Fichiers » est hors
// viewport et `page.click` sur une carte tourne en rond jusqu'au timeout
// (`#messages` intercepte le pointeur) — sans une seule assertion rouge pour
// le dire. L'onglet lui-même se déclenche par l'API DOM du bouton, ce qui
// exerce quand même son `onclick` réel (selectSpaceTab).
const openFilesTab = async () => {
  await page.evaluate(() => {
    if (!document.querySelector('.app').classList.contains('sidebar-open')) toggleSidebar();
    document.getElementById('space-tab-files').click();
  });
  await page.waitForTimeout(500);   // renderSpaceFilesList est async (IDB)
};
await openFilesTab();
await shot('01-library-before.png');

const nameSel = '#file-name-lib-r1';
const domName = () => page.evaluate((s) => document.querySelector(s).textContent, nameSel);

// Focus du champ SANS passer par un clic de pointeur. Le clic reste employé au
// bloc E, où il est le sujet (il faut la course avec le placement de caret du
// navigateur) ; partout ailleurs il n'apporte rien et rend le contrôle
// dépendant de la GÉOMÉTRIE de la carte — mesuré : une ligne méta qui passe à
// deux lignes décale le champ et fait atterrir le clic ailleurs, ce qui met
// huit assertions au rouge pour un changement qui ne les concerne pas.
// Focus + sélection de TOUT le contenu, en une seule étape déterministe.
//
// Deux raisons de ne pas enchaîner `focus()` puis `Meta+A` : le raccourci part
// avant que le requestAnimationFrame du handler ait posé sa Range (course
// perdue, mesurée — huit assertions rouges), et dans un contenteditable sans
// sélection établie il peut porter sur le document entier plutôt que sur le
// champ. Poser la Range ici règle les deux : l'état de départ des blocs A/B/C
// est « tout sélectionné », affirmé et non espéré.
// Frappe, puis attente de l'état TERMINAL du champ — jamais un délai fixe.
// Sans cette attente, les caractères perdus par une course de sélection
// (cf. selectAllInName) passaient inaperçus ici et faisaient rougir tous les
// blocs suivants, qui héritaient d'un nom tronqué et accusaient le code. Le
// `delay` reste par prudence sur un contenteditable re-rendu par son handler.
const typeName = async (sel, text) => {
  await page.keyboard.type(text, { delay: 30 });
  await page.waitForFunction(
    ({ s, t }) => document.querySelector(s).textContent === t, { s: sel, t: text },
    { timeout: 5000 });
};

const selectAllInName = async (sel) => {
  // Le focus D'ABORD, seul. Le handler de l'app répond au focus par un
  // requestAnimationFrame qui pose SA sélection (le radical) : poser la nôtre
  // dans le même tour la ferait écraser une frame plus tard, en pleine frappe —
  // c'est ce qui mangeait le premier caractère (mesuré : « éférentiel.tsv »).
  // On laisse donc le handler agir, PUIS on élargit à tout le contenu.
  await page.evaluate((s) => { document.querySelector(s).focus(); }, sel);
  await page.waitForFunction((s) =>
    document.activeElement === document.querySelector(s), sel, { timeout: 5000 });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())));
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = document.createRange();
    r.selectNodeContents(el);
    const g = window.getSelection();
    g.removeAllRanges();
    g.addRange(r);
    return g.toString();
  }, sel);
};

const isEditable = await page.evaluate((s) => {
  const el = document.querySelector(s);
  return el && el.getAttribute('contenteditable') === 'true';
}, nameSel);
check('le nom est éditable en place (contenteditable sur la carte)', isEditable);

// ══ E. Présélection du radical au focus ═════════════════════════════════════
// Lue sur l'objet Selection du document, pas sur une intention : c'est le seul
// témoin de ce que l'utilisateur voit surligné. Mesurée APRÈS un vrai clic (le
// navigateur pose son propre caret derrière, et c'est justement ce que le
// requestAnimationFrame du handler doit gagner).
await page.click(nameSel);
await page.waitForTimeout(150);
const selE = await page.evaluate(() => {
  const s = window.getSelection();
  return { text: s.toString(), start: s.anchorOffset, end: s.focusOffset };
});
check('E : au focus, le radical est présélectionné (extension exclue)',
  selE.text === 'export-final-v2-VRAIMENT-final');
check('E : la sélection part bien du début du nom', selE.start === 0);
await shot('02-focus-stem-selected.png');
// Contrôle : taper remplace le seul radical et l'extension survit sans qu'on
// la retape — c'est TOUT l'objet de la présélection, et la sélection mesurée
// ci-dessus ne le prouve pas à elle seule.
await page.keyboard.type('référentiel produits', { delay: 30 });
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('E : taper par-dessus garde l\'extension (.csv non retapée)',
  (await domName()) === 'référentiel produits.csv');
let recE = await readStore('lib-r1');
check('E : et c\'est bien ce nom-là qui est persisté',
  recE && recE.name === 'référentiel produits.csv');

// Le voisin : « notes.txt » a un radical « notes », valeur UNIQUE attendue
// (pas de disjonction — une sélection vide et une sélection totale sont deux
// défauts distincts, il faut que le check les distingue tous les deux).
await page.click('#file-name-lib-r2');
await page.waitForTimeout(150);
const selE2 = await page.evaluate(() => window.getSelection().toString());
check('E : sur la carte voisine aussi, le radical seul est sélectionné',
  selE2 === 'notes');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ══ A. Renommage nominal, extension COMPRISE ════════════════════════════════
// Distinct du bloc E, qui ne réécrivait que le radical : ici on sélectionne
// tout et on retape un nom entier, extension incluse — le geste de qui
// change aussi le format apparent. Le nom de DÉPART est celui que E a laissé,
// jamais celui de la fixture : chaîner des blocs sur un état partagé oblige à
// lire cet état, pas à le supposer (une première version de ce bloc retapait le
// nom que E venait d'écrire, donc n'observait aucun changement).
const selAllA = await selectAllInName(nameSel);
check('A : prémisse — tout le nom est sélectionné avant la frappe',
  selAllA === 'référentiel produits.csv');
await typeName(nameSel, 'référentiel.tsv');
await shot('02b-editing-full.png');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);        // renameLibraryFile est async (IDB)

check('A : le nom affiché est le nouveau', (await domName()) === 'référentiel.tsv');
let rec = await readStore('lib-r1');
check('A : le STORE porte le nouveau nom (pas seulement le DOM)',
  rec && rec.name === 'référentiel.tsv');
check('A : la description n\'a pas bougé (elle décrit le contenu)',
  rec && rec.description === 'Référentiel produits, deux colonnes.');
const voisin = await readStore('lib-r2');
check('A : la carte voisine est intacte (le renommage ne déborde pas)',
  voisin && voisin.name === 'notes.txt');
await shot('03-renamed.png');

// Survie au reload : le défaut qu'aucun test pur ne peut voir.
await page.reload();
await bootWait();
await openFilesTab();
check('A : le nouveau nom survit au rechargement',
  (await domName()) === 'référentiel.tsv');
await shot('04-after-reload.png');

// ══ B. Échap annule ═════════════════════════════════════════════════════════
await selectAllInName(nameSel);
await typeName(nameSel, 'nom jeté');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('B : Échap restaure le nom d\'avant à l\'écran',
  (await domName()) === 'référentiel.tsv');
rec = await readStore('lib-r1');
check('B : Échap n\'écrit rien dans le store',
  rec && rec.name === 'référentiel.tsv');

// ══ C. Saisie vidée → restauration ══════════════════════════════════════════
await selectAllInName(nameSel);
await page.keyboard.press('Backspace');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);
check('C : un nom vidé restaure l\'ancien à l\'écran',
  (await domName()) === 'référentiel.tsv');
rec = await readStore('lib-r1');
check('C : aucun nom vide n\'atteint le store',
  rec && rec.name === 'référentiel.tsv');
await shot('05-final.png');

// ══ D. Le nom renommé part bien au modèle ═══════════════════════════════════
// Le manifeste de bibliothèque est ce qui donne son sens au renommage : un nom
// qui ne change que dans la sidebar ne sert à rien. Lu depuis la fonction
// vivante, pas recomposé ici.
const manifest = await page.evaluate((sp) =>
  buildLibraryManifestBlock(getCachedLibraryEntriesBySpace(sp), 'Refonte du site'), SPACE_ID);
check('D : le manifeste destiné au modèle porte le nouveau nom',
  manifest.indexOf('référentiel.tsv') !== -1);
check('D : et plus l\'ancien', manifest.indexOf('export-final-v2') === -1);

// ══ F. Ligne méta : lisibilité et hauteur ═══════════════════════════════════
// Mesurée en LIGNES (hauteur / line-height), pas en caractères : ce qui compte
// est ce que la colonne peut afficher, et elle fait ~210 px utiles. Le fichier
// promu porte le cumul le plus défavorable (type + date + provenance).
const meta = await page.evaluate(() => {
  const one = parseFloat(getComputedStyle(document.querySelector('.mem-sub')).lineHeight);
  const it = document.querySelector('#space-files-list .mem-item[data-id="lib-r1"]');
  const sub = it.querySelector('.mem-sub');
  return {
    text: sub.textContent,
    lines: Math.round(sub.getBoundingClientRect().height / one),
    mimeTip: sub.querySelector('span[title]') ? sub.querySelector('span[title]').title : null,
    // Ce que le formateur rend pour le createdAt réel de la fixture (1) :
    // l'attendu est calculé depuis la MÊME source que l'affichage, sinon le
    // contrôle rejouerait la logique de formatage au lieu de la vérifier.
    expectedDate: formatDateRelative(1, Date.now()),
  };
});
check('F : le type est lisible, pas le mime brut', meta.text.indexOf('CSV') === 0);
check('F : le mime exact reste accessible en tooltip', meta.mimeTip === 'text/csv');
// La date est montrée NUE : aucun verbe ne l'introduit (il n'y a qu'une date,
// donc rien à distinguer). Les deux contrôles sont complémentaires — le
// premier prouve qu'une date est bien là, le second qu'elle n'est pas verbalisée.
// Comparée à ce que le formateur rend pour le createdAt RÉEL de la fixture,
// jamais à une regex permissive : `/\d/` sur la ligne serait déjà satisfaite
// par la taille (« 8 o »), donc verte sans aucune date.
check('F : la date affichée est bien celle du dépôt du fichier',
  meta.text.indexOf(meta.expectedDate) !== -1 && meta.expectedDate.length > 0);
check('F : la date est nue, sans verbe introducteur',
  meta.text.indexOf('ajouté') === -1 && meta.text.indexOf('modifié') === -1);
check('F : la ligne méta tient sur UNE ligne', meta.lines === 1);

check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) console.log(consoleErrors.join('\n'));

console.log(failures.length
  ? '\n  ' + failures.length + ' ÉCHEC(S)\n' + failures.map(f => '   - ' + f).join('\n')
  : '\n  Tout vert.');
await browser.close();
process.exit(failures.length ? 1 : 0);
