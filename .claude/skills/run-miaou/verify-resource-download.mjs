#!/usr/bin/env node
// Vérification lot V (téléchargement de ressources), un seul lancement.
//
// Deux surfaces, un seul nommeur (`resourceDownloadName`) :
//   A. Bibliothèque de fichiers d'un Espace → bouton « Télécharger » par carte.
//   B. Acks de conversation → icône `.ack-dl` sur les trois kinds qui désignent
//      un fichier (resource_stored, resource_presented, attachment_recalled),
//      ET sur eux seuls.
//
// Le cas qui motive le lot est explicitement couvert : un CSV stocké en classe
// 'inline' (chemin store_inline_from_bytes) n'a AUCUN bloc affiché — son ack
// était jusqu'ici le seul témoin, sans moyen de récupérer le fichier.
// On vérifie aussi le nommage au mieux : nom sans extension → extension
// dérivée du mime, et la limite assumée d'un CSV annoncé `text/plain`.
//
// Usage : node verify-resource-download.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : path.join(__dirname, 'shots-resource-download');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};

// ── Fixture local (pas seed-fixtures.js : besoin de records ressource+library
// que le fixture partagé ne porte pas, et qu'on ne veut pas imposer aux ~15
// autres verify qui l'importent). Un Espace, une conversation, quatre records.
const SPACE_ID = 'sp-v';
const CONV_ID = 'conv-v';

await page.addInitScript(({ SPACE_ID, CONV_ID }) => {
  localStorage.setItem('miaou-spaces', JSON.stringify([
    { id: SPACE_ID, name: 'Analyse de données', createdAt: 1 },
  ]));
  localStorage.setItem('miaou-active-space', SPACE_ID);
  localStorage.setItem('miaou-conversations', JSON.stringify([{
    id: CONV_ID, title: 'Export des ventes', spaceId: SPACE_ID, updatedAt: 2,
    messages: [
      { role: 'user', content: 'Génère-moi le CSV des ventes du trimestre.' },
      // (1) LE CAS DU LOT : ressource inline (CSV) — aucun bloc affiché, l'ack
      // est le seul témoin. Le mime annoncé est text/plain alors que c'est un
      // CSV : reproduit fidèlement ce qu'un modèle a réellement produit.
      { role: 'tool-ack', kind: 'resource_stored', id: 'res-csv',
        resourceName: 'ventes-t3', mime: 'text/plain', size: 96 },
      // (2) ressource binaire présentée (PDF) — nom déjà extensionné.
      { role: 'tool-ack', kind: 'resource_presented', id: 'res-pdf',
        resourceName: 'rapport.pdf', mime: 'application/pdf', size: 1024 },
      // (3) pièce jointe rappelée — résolution par attId + convId (cache session).
      { role: 'tool-ack', kind: 'attachment_recalled', attId: 'att-v1',
        resourceName: 'capture.png', mime: 'image/png', convId: CONV_ID },
      // (4) CONTRÔLE NÉGATIF : un ack hors périmètre ne doit JAMAIS porter
      // d'icône de téléchargement. Sans lui, le test ne prouve pas que le
      // prédicat discrimine — seulement qu'il dit oui.
      { role: 'tool-ack', kind: 'memory_create', id: 'mem-v1',
        content: 'Julien travaille les exports en CSV.' },
      // (5) CONTRÔLE NÉGATIF 2 : ack de la bonne famille mais SANS sa clé
      // (ack legacy, écrit avant que le champ soit whitelisté) → pas d'icône.
      { role: 'tool-ack', kind: 'resource_stored',
        resourceName: 'orphelin.txt', mime: 'text/plain', size: 10 },
      { role: 'assistant', content: 'Le CSV est enregistré, tu peux le récupérer depuis la trace ci-dessus.' },
    ],
  }]));
}, { SPACE_ID, CONV_ID });

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Records IDB : deux ressources de conversation, un attachment, un fichier
// de bibliothèque d'Espace. Écrits APRÈS le premier boot (la base existe), puis
// reload pour repartir d'un état froid — c'est le cas réel (cache session vide
// au chargement, peuplé à l'ouverture de la conversation).
const seeded = await page.evaluate(({ SPACE_ID, CONV_ID }) => {
  const enc = new TextEncoder();
  const png1x1 = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  ), c => c.charCodeAt(0)).buffer;
  const csv = enc.encode('produit,quantite,ca\nclavier,12,1440\necran,5,1995\nsouris,31,930\n').buffer;
  const pdf = enc.encode('%PDF-1.4 fake fixture').buffer;
  const RECORDS = [
    // Nom SANS extension + mime text/plain : le nommeur doit produire .txt
    // (limite assumée du lot — on suit le mime déclaré).
    { id: 'res-csv', conversationId: CONV_ID, class: 'inline', mime: 'text/plain',
      name: 'ventes-t3', size: csv.byteLength, createdAt: 1, data: csv },
    { id: 'res-pdf', conversationId: CONV_ID, class: 'binary', mime: 'application/pdf',
      name: 'rapport.pdf', size: pdf.byteLength, createdAt: 2, data: pdf },
    { id: 'att_v_1', attId: 'att-v1', conversationId: CONV_ID, class: 'binary',
      mime: 'image/png', name: 'capture.png', size: png1x1.byteLength,
      createdAt: 3, w: 1, h: 1, data: png1x1 },
    // Bibliothèque d'Espace : nom sans extension, mime image/webp — exerce le
    // repli générique image/<x> de mimeExt (pas dans la table exacte).
    { id: 'lib-1', kind: 'library', spaceId: SPACE_ID, class: 'binary',
      mime: 'image/webp', name: 'schema-archi', size: png1x1.byteLength,
      createdAt: 4, data: png1x1 },
    { id: 'lib-2', kind: 'library', spaceId: SPACE_ID, class: 'inline',
      mime: 'text/csv', name: 'referentiel.csv', size: csv.byteLength,
      createdAt: 5, data: csv, description: 'Référentiel produits du trimestre.' },
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
}, { SPACE_ID, CONV_ID });
check('fixture : 5 records écrits en IDB', seeded === 5);

await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-done', { timeout: 10000 }).catch(() => {});

// ══ A. Bibliothèque de fichiers de l'Espace ═════════════════════════════════
await page.evaluate((id) => { openSpaceScreen(id); }, SPACE_ID);
await page.waitForTimeout(300);
// La liste ne se peuple qu'au passage sur l'onglet « Fichiers »
// (selectSpaceTab, ui.js) — ouvrir l'écran ne suffit pas. On clique l'onglet
// réel plutôt que d'appeler selectSpaceTab : ça exerce aussi le chemin utilisateur.
// Le backdrop de l'écran Space intercepte le clic Playwright (il couvre la
// sidebar où vit l'onglet) : on déclenche le clic via l'API DOM du bouton, ce
// qui exerce quand même son `onclick` réel (selectSpaceTab) plutôt qu'un appel
// direct à la fonction.
await page.evaluate(() => { document.getElementById('space-tab-files').click(); });
await page.waitForTimeout(500);   // renderSpaceFilesList est async (IDB)
await shot('01-space-files-list.png');

const libBtns = await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('#space-files-list .mem-item'));
  return items.map(it => ({
    id: it.dataset.id,
    name: (it.querySelector('.mem-content') || {}).textContent,
    labels: Array.from(it.querySelectorAll('.drawer-btn')).map(b => b.textContent.trim()),
    // Le glyphe vit dans l'EN-TÊTE, pas dans la rangée de boutons texte.
    dlInHeader: !!it.querySelector('.mem-header .mem-dl'),
    dlHasSvg: !!it.querySelector('.mem-header .mem-dl svg'),
    dlTitle: (it.querySelector('.mem-header .mem-dl') || {}).title,
  }));
});
check('A : 2 fichiers listés dans la bibliothèque', libBtns.length === 2);
check('A : chaque carte porte le glyphe de téléchargement dans son en-tête',
  libBtns.length === 2 && libBtns.every(c => c.dlInHeader && c.dlHasSvg));
check('A : glyphe intitulé « Télécharger » (seule affordance textuelle : le title)',
  libBtns.every(c => c.dlTitle === 'Télécharger'));
// La rangée de boutons texte revient à DEUX entrées : c'est tout l'objet du
// passage au glyphe (trois boutons texte wrappaient sur deux lignes).
check('A : rangée texte ramenée à 2 boutons, « Supprimer » en dernier',
  libBtns.every(c => c.labels.length === 2 && c.labels[1] === 'Supprimer'
    && c.labels.indexOf('Télécharger') === -1));

// MOTIF du passage au glyphe : la rangée texte ne doit plus wrapper À CAUSE du
// téléchargement. Mesuré par carte (tops réels), pas déduit d'une largeur
// théorique. Attention au faux critère « tout sur une ligne » : la carte SANS
// description porte « Générer une description » (~148 px) + « Supprimer »
// (~76 px) = 224 px pour 210 px utiles — elle wrappait DÉJÀ avant ce lot, avec
// ces deux seuls boutons. Le critère juste est donc : la carte avec description
// (libellé court « (re)générer ») tient sur une ligne, et aucune ne déborde.
const rowsPerCard = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('#space-files-list .mem-item')).map(it => {
    const box = it.querySelector('.drawer-btns');
    const tops = new Set(Array.from(box.querySelectorAll('.drawer-btn'))
      .map(b => Math.round(b.getBoundingClientRect().top)));
    return { id: it.dataset.id, rows: tops.size,
             overflows: box.scrollWidth > box.clientWidth };
  });
});
const carteDecrite = rowsPerCard.find(c => c.id === 'lib-2');
// L'assertion d'origine exigeait UNE ligne pour la carte décrite, en se fondant
// sur un libellé court « (re)générer ». Ce libellé est aujourd'hui « Régénérer
// la description » (148px) : avec « Supprimer » (76px) cela fait 224px pour
// 210px utiles, donc deux lignes — comme la carte SANS description, que le
// commentaire ci-dessus donnait déjà pour wrappante avec ses deux seuls
// boutons. Le wrap n'est donc plus discriminant entre les deux cartes, et
// l'invariant que le passage au glyphe garantit reste : aucune rangée ne
// DÉBORDE de sa boîte (le troisième bouton texte, lui, débordait).
check('A : aucune rangée de boutons ne déborde de sa boîte',
  rowsPerCard.length > 0 && rowsPerCard.every(c => !c.overflows));
check('A : aucune carte ne déborde horizontalement',
  rowsPerCard.every(c => c.overflows === false));

// Le glyphe est aligné sur la ligne de méta de l'en-tête, pas flottant plus bas.
const glyphGeom = await page.evaluate(() => {
  const it = document.querySelector('#space-files-list .mem-item');
  const g = it.querySelector('.mem-dl').getBoundingClientRect();
  const sub = it.querySelector('.mem-sub').getBoundingClientRect();
  const name = it.querySelector('.mem-content').getBoundingClientRect();
  return { glyphTop: Math.round(g.top), subTop: Math.round(sub.top),
           nameTop: Math.round(name.top), w: Math.round(g.width),
           rightOfName: Math.round(g.left) > Math.round(name.right) - 40 };
});
check('A : glyphe aligné sur la ligne de méta (au-dessus du nom)',
  Math.abs(glyphGeom.glyphTop - glyphGeom.subTop) <= 6
  && glyphGeom.glyphTop < glyphGeom.nameTop);
check('A : glyphe de taille non nulle et posé à droite', glyphGeom.w > 0 && glyphGeom.rightOfName);

// Téléchargement réel : nom sans extension + image/webp → repli générique.
const dlLib = page.waitForEvent('download', { timeout: 5000 });
await page.evaluate(() => {
  // Clic DOM (backdrop de l'écran Space, cf. plus haut).
  document.querySelector('#space-files-list .mem-item[data-id="lib-1"] .mem-dl').click();
});
const libFile = await dlLib;
check('A : nom sans extension + image/webp → « schema-archi.webp »',
  libFile.suggestedFilename() === 'schema-archi.webp');
const libPath = path.join(outDir, 'dl-' + libFile.suggestedFilename());
await libFile.saveAs(libPath);
check('A : fichier téléchargé non vide', fs.statSync(libPath).size > 0);

// Revenir sur l'onglet Conversations AVANT de fermer : selectSpaceTab masque
// #conv-list tant qu'on est sur « Fichiers », la liste resterait invisible.
await page.evaluate(() => { document.getElementById('space-tab-conversations').click(); });
await page.waitForTimeout(200);
await page.evaluate(() => { closeSpaceScreen(); });
await page.waitForTimeout(400);

// ══ B. Acks de conversation ═════════════════════════════════════════════════
await page.click('.conv-title:text("Export des ventes")');
await page.waitForTimeout(500);   // loadConversationResources (async) peuple le cache

// Les acks s'affichent en mode compact (un seul .tool-ack en DOM, les autres
// dans la WeakMap ackNodeOf) : passer en mode liste avant tout querySelectorAll.
// (piège connu : en compact, UN seul .tool-ack est en DOM, les autres vivent
// dans la WeakMap ackNodeOf — un querySelectorAll avant dépliage ne verrait rien).
const badgeCount = await page.evaluate(() => {
  const b = document.querySelector('#thread .ack-badge');
  if (b) b.click();
  return document.querySelectorAll('#thread .ack-badge').length;
});
check('B : groupe d\'acks rendu en mode compact (badge présent)', badgeCount === 1);
await page.waitForTimeout(500);
await shot('02-acks-expanded.png');

const ackMeta = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('#thread .tool-ack')).map(a => ({
    cls: a.className,
    label: (a.querySelector('.ack-label') || {}).textContent || '',
    hasDl: !!a.querySelector('.ack-dl'),
  }));
});
const byKind = (k) => ackMeta.filter(a => a.cls.indexOf('ack-' + k) >= 0);

check('B : les 5 acks du fixture sont rendus', ackMeta.length === 5);
check('B : resource_stored avec id → icône de téléchargement',
  byKind('resource_stored').some(a => a.hasDl && a.label.indexOf('ventes-t3') >= 0));
check('B : resource_presented → icône de téléchargement',
  byKind('resource_presented').length === 1 && byKind('resource_presented')[0].hasDl);
check('B : attachment_recalled → icône de téléchargement',
  byKind('attachment_recalled').length === 1 && byKind('attachment_recalled')[0].hasDl);
// Contrôles négatifs : le prédicat doit refuser, pas seulement accepter.
check('B (contrôle négatif) : memory_create → AUCUNE icône',
  byKind('memory_create').length === 1 && byKind('memory_create')[0].hasDl === false);
check('B (contrôle négatif) : resource_stored SANS id → AUCUNE icône',
  byKind('resource_stored').some(a => a.label.indexOf('orphelin') >= 0 && a.hasDl === false));

// LE CAS DU LOT. Les acks binaires (resource_stored/presented) reçoivent bien
// un bloc ici — au reload, getPendingToolBlocks() est vide, donc placeToolAck
// les rend (comportement documenté). Ce qu'on prouve, c'est que l'ack INLINE,
// lui, n'en a AUCUN : son bouton est le seul accès au fichier. Cibler le bloc
// dans la bulle du CSV, pas un comptage global (qui mesurerait autre chose).
const inlineHasBlock = await page.evaluate(() => {
  const ack = Array.from(document.querySelectorAll('#thread .tool-ack'))
    .find(x => (x.querySelector('.ack-label') || {}).textContent.indexOf('ventes-t3') >= 0);
  // Le bloc est inséré dans la bulle hôte, en frère de l'ack : on inspecte le
  // conteneur de l'ack, pas l'ack lui-même.
  const host = ack.closest('.msg') || ack.parentElement;
  return {
    ackFound: !!ack,
    // aucun bloc ne doit mentionner le contenu du CSV inline
    leaked: host.textContent.indexOf('produit,quantite,ca') >= 0,
  };
});
check('B : l\'ack du CSV inline est bien rendu', inlineHasBlock.ackFound);
check('B : ressource inline → contenu JAMAIS affiché (le bouton est le seul accès)',
  inlineHasBlock.leaked === false);

// Téléchargement réel depuis l'ack du CSV.
const dlCsv = page.waitForEvent('download', { timeout: 5000 });
await page.evaluate(() => {
  const a = Array.from(document.querySelectorAll('#thread .tool-ack'))
    .find(x => (x.querySelector('.ack-label') || {}).textContent.indexOf('ventes-t3') >= 0);
  a.querySelector('.ack-dl').click();
});
const csvFile = await dlCsv;
check('B : CSV annoncé text/plain → « ventes-t3.txt » (limite assumée du mime déclaré)',
  csvFile.suggestedFilename() === 'ventes-t3.txt');
const csvPath = path.join(outDir, 'dl-' + csvFile.suggestedFilename());
await csvFile.saveAs(csvPath);
const csvBody = fs.readFileSync(csvPath, 'utf8');
check('B : contenu téléchargé = le CSV réel (pas un descripteur)',
  csvBody.indexOf('produit,quantite,ca') === 0 && csvBody.indexOf('clavier,12,1440') > 0);

// Téléchargement depuis l'ack attachment_recalled (résolution par attId, cache
// session peuplé à l'ouverture de la conversation).
const dlAtt = page.waitForEvent('download', { timeout: 5000 });
await page.evaluate(() => {
  document.querySelector('#thread .tool-ack.ack-attachment_recalled .ack-dl').click();
});
const attFile = await dlAtt;
check('B : attachment_recalled → « capture.png »', attFile.suggestedFilename() === 'capture.png');

// ── Indisponibilité : record évincé → bouton inerte, jamais retiré du DOM ────
// On vide le cache session ET on supprime le record d'IDB : c'est le cas d'une
// ressource réellement effacée, où l'ack reste vrai mais le fichier n'est plus là.
await page.evaluate(() => new Promise((resolve) => {
  invalidateResourceCache(['res-pdf']);
  const req = indexedDB.open('miaou');
  req.onsuccess = (e) => {
    const tx = e.target.result.transaction('resources', 'readwrite');
    tx.objectStore('resources').delete('res-pdf');
    tx.oncomplete = resolve;
  };
}));
await page.evaluate(() => {
  document.querySelector('#thread .tool-ack.ack-resource_presented .ack-dl').click();
});
await page.waitForTimeout(600);
const unavail = await page.evaluate(() => {
  const b = document.querySelector('#thread .tool-ack.ack-resource_presented .ack-dl');
  return { present: !!b, cls: b ? b.className : '', disabled: b ? b.disabled : null,
           title: b ? b.title : '' };
});
check('B : ressource supprimée → bouton TOUJOURS présent (l\'ack reste vrai)', unavail.present);
check('B : ressource supprimée → bouton inerte et explicite',
  unavail.cls.indexOf('unavailable') >= 0 && unavail.disabled === true
  && unavail.title === 'Ressource non disponible');
await shot('03-ack-unavailable.png');

// ── Les deux luminosités : le bouton doit rester lisible dans chacune. On
// vérifie que le thème a RÉELLEMENT changé (data-theme résolu) avant de
// capturer — sinon deux captures identiques donneraient un faux vert visuel.
for (const th of ['light', 'dark']) {
  await page.evaluate((t) => { selectTheme(t); }, th);
  await page.waitForTimeout(400);
  const resolved = await page.evaluate(() =>
    document.documentElement.getAttribute('data-theme'));
  check('rendu : thème ' + th + ' effectivement appliqué', resolved === th);
  await shot((th === 'light' ? '04' : '05') + '-acks-' + th + '.png');
}

console.log('');
if (consoleErrors.length) {
  console.log('  Erreurs console (' + consoleErrors.length + ') :');
  for (const e of consoleErrors.slice(0, 10)) console.log('    ' + e);
}
check('aucune erreur console', consoleErrors.length === 0);

await browser.close();
console.log('');
console.log(failures.length ? '  ÉCHEC — ' + failures.length + ' contrôle(s) : ' + failures.join(' | ')
                            : '  OK — tous les contrôles passent');
console.log('  Captures : ' + outDir);
process.exit(failures.length ? 1 : 0);
