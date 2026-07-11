#!/usr/bin/env node
// Vérification lot A3 (récupération de pièces jointes depuis les bulles, un
// seul lancement) :
//   A3-1 : chip non-image (bulle envoyée, seed-10b/att-2) → clic = téléchargement
//          direct ; chip du composer (pré-envoi) reste inerte au clic.
//   A3-1 : chip image (att-1) + Cmd/Ctrl+clic → nouvel onglet (Blob+objectURL).
//   A3-2 : chip image sans modificateur → lightbox (généralisation E3) ; bouton
//          Télécharger de la lightbox = SEUL chemin de download d'une image
//          (le clic simple sur l'image dans la lightbox ne télécharge jamais) ;
//          boutons SVG/PNG (mode mermaid) masqués en mode image.
//   A3-2 : image modèle inline (.tool-block-img, résultat d'outil éphémère,
//          injectée ici via placeToolBlocks) → même comportement lightbox.
// Usage : node verify-a3-attachment-retrieval.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-a3-attachment-retrieval');
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

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Seed : script de dev-seed.html évalué dans la page dist (même origine) ──
const seedHtml = fs.readFileSync(seedPath, 'utf8');
const seedScript = seedHtml.match(/<script>\n([\s\S]*?)<\/script>/)[1];
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'log'; d.hidden = true;
  document.body.appendChild(d);
});
await page.evaluate(seedScript);
await page.waitForFunction(() => document.getElementById('log').textContent.includes('skill(s)'), { timeout: 5000 });
await page.waitForFunction(() => document.getElementById('log').textContent.includes('pièce(s) jointe(s)'), { timeout: 5000 });
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);

// ── 0. Ouvrir seed-10b (chips image att-1 + texte att-2, blobs réels en IDB) ─
await page.click('.conv-title:text("Debug capture réseau")');
await page.waitForTimeout(300);   // openConversation → loadConversationResources (async)
await shot('00-conversation-open.png');

// ── 1. Affordance : chips de bulle "live", composer inerte ──────────────────
const chipMeta = await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('#thread .msg.user .att-chip'));
  return chips.map(c => ({
    name: c.querySelector('.att-name').textContent,
    live: c.classList.contains('att-chip-live'),
    hasOnclick: typeof c.getAttribute('onclick') === 'string' && c.getAttribute('onclick').indexOf('onAttachmentChipClick') >= 0,
  }));
});
check('affordance : 2 chips de bulle, toutes deux "live"', chipMeta.length === 2 && chipMeta.every(c => c.live));
check('affordance : onclick=onAttachmentChipClick posé sur chaque chip', chipMeta.every(c => c.hasOnclick));

// ── 2. Chip non-image (att-2, texte) : clic → téléchargement direct ─────────
const dlText = page.waitForEvent('download', { timeout: 5000 });
await page.click('#thread .msg.user .att-chip[data-att-id="att-2"]');
const textDl = await dlText;
check('A3-1 : clic chip texte → download déclenché', textDl.suggestedFilename() === 'nginx-access.log');
const textPath = path.join(outDir, 'nginx-access.log');
await textDl.saveAs(textPath);
check('A3-1 : contenu téléchargé non vide', fs.statSync(textPath).size > 0);

// ── 3. Chip image (att-1), Cmd+clic → nouvel onglet ─────────────────────────
// `modifiers: ['Meta']` (Cmd) — noté en aparté : `['Control']` seul ne pose
// PAS ctrlKey=true dans ce build Playwright/Chromium (vérifié isolément avant
// d'écrire ce script) ; 'Meta' fonctionne et couvre le code applicatif
// (event.metaKey || event.ctrlKey) aussi bien sur macOS que le clic réel.
const pagesBefore = page.context().pages().length;
await page.click('#thread .msg.user .att-chip[data-att-id="att-1"]', { modifiers: ['Meta'] });
await page.waitForTimeout(400);
const pagesAfterCtrl = page.context().pages();
check('A3-1 : Cmd+clic image → nouvel onglet ouvert', pagesAfterCtrl.length === pagesBefore + 1);
const newTab = pagesAfterCtrl[pagesAfterCtrl.length - 1];
const newTabUrl = newTab.url();
check('A3-1 : nouvel onglet pointe vers un blob: (jamais data:)', newTabUrl.startsWith('blob:'));
await newTab.close();
check('A3-2 (garde) : lightbox PAS ouverte suite au Cmd+clic', await page.evaluate(() => !document.querySelector('.mermaid-lightbox') || !document.querySelector('.mermaid-lightbox').classList.contains('show')));

// ── 4. Chip image sans modificateur → lightbox ──────────────────────────────
await page.click('#thread .msg.user .att-chip[data-att-id="att-1"]');
await page.waitForSelector('.mermaid-lightbox.show', { timeout: 5000 });
const lbImg = await page.evaluate(() => {
  const el = document.querySelector('.mermaid-lightbox');
  const canvas = el.querySelector('.mermaid-lightbox-canvas');
  const img = canvas.querySelector('img');
  const svgBtn = el._svgBtnRef || Array.from(el.querySelectorAll('.mermaid-lb-btn')).find(b => b.title === 'Télécharger en SVG');
  const pngBtn = Array.from(el.querySelectorAll('.mermaid-lb-btn')).find(b => b.title === 'Télécharger en PNG');
  const dlBtn = Array.from(el.querySelectorAll('.mermaid-lb-btn')).find(b => b.title === 'Télécharger');
  return {
    hasImg: !!img,
    imgSrc: img && img.src.slice(0, 20),
    svgHidden: svgBtn ? svgBtn.hidden : null,
    pngHidden: pngBtn ? pngBtn.hidden : null,
    dlHidden: dlBtn ? dlBtn.hidden : null,
    canvasW: canvas.getBoundingClientRect().width,
  };
});
check('A3-2 : lightbox affiche un <img> (mode image)', lbImg.hasImg && lbImg.imgSrc.startsWith('data:image'));
check('A3-2 : boutons SVG/PNG masqués en mode image', lbImg.svgHidden === true && lbImg.pngHidden === true);
check('A3-2 : bouton Télécharger visible en mode image', lbImg.dlHidden === false);
check('A3-2 : canvas dimensionné (fit initial)', lbImg.canvasW > 10);
await shot('01-lightbox-image-attachment.png');

// ── 5. Clic simple sur l'image dans la lightbox ne télécharge PAS ───────────
let strayDownload = false;
const strayHandler = () => { strayDownload = true; };
page.on('download', strayHandler);
await page.click('.mermaid-lightbox-canvas img');
await page.waitForTimeout(300);
check('A3-2 : clic sur l\'image (lightbox) ne déclenche AUCUN download', !strayDownload);
page.off('download', strayHandler);

// ── 6. Bouton Télécharger de la lightbox → download de l'image ─────────────
const dlImg = page.waitForEvent('download', { timeout: 5000 });
await page.click('.mermaid-lightbox-actions .mermaid-lb-btn[title="Télécharger"]');
const imgDl = await dlImg;
check('A3-2 : bouton Télécharger → download avec le nom d\'origine', imgDl.suggestedFilename() === 'erreur-503.png');
const imgPath = path.join(outDir, 'erreur-503.png');
await imgDl.saveAs(imgPath);
check('A3-2 : PNG téléchargé non vide', fs.statSync(imgPath).size > 0);

// Escape ferme (cascade D-Esc, réutilisée telle quelle par la généralisation)
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
check('A3-2 : Escape ferme la lightbox (mode image)',
  await page.evaluate(() => !document.querySelector('.mermaid-lightbox').classList.contains('show')));

// ── 7. Chip du composer (pré-envoi) : reste inerte au clic ──────────────────
// Attache un fichier via l'input caché (#attach-input) pour peupler le composer.
const buf = Buffer.from('contenu de test pour affordance composer', 'utf8');
await page.setInputFiles('#attach-file-input', { name: 'note.txt', mimeType: 'text/plain', buffer: buf });
await page.waitForSelector('#attach-chips .att-chip', { timeout: 5000 });
const composerChip = await page.evaluate(() => {
  const c = document.querySelector('#attach-chips .att-chip');
  return {
    live: c.classList.contains('att-chip-live'),
    hasOnclick: c.hasAttribute('onclick'),
  };
});
check('A3-1 : chip composer PAS "live" (statu quo inerte)', !composerChip.live);
check('A3-1 : chip composer sans onclick de récupération', !composerChip.hasOnclick);
let composerDownload = false;
const composerDlHandler = () => { composerDownload = true; };
page.on('download', composerDlHandler);
await page.click('#attach-chips .att-chip .att-name');
await page.waitForTimeout(300);
check('A3-1 : clic sur le chip composer ne déclenche rien', !composerDownload);
page.off('download', composerDlHandler);
await shot('02-composer-chip-inert.png');
await page.click('#attach-chips .att-remove');   // nettoie avant la suite

// ── 8. Image modèle inline (.tool-block-img) → même comportement lightbox ──
await page.evaluate(() => {
  const wrap = buildMsg('assistant', 'Voici une image renvoyée par un outil.', null, null, Date.now());
  document.getElementById('thread').appendChild(wrap);
  const block = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
  placeToolBlocks(wrap, [block]);
  wrap.scrollIntoView();
});
await page.waitForSelector('.tool-block-img', { timeout: 5000 });
const toolImgCursor = await page.evaluate(() => getComputedStyle(document.querySelector('.tool-block-img')).cursor);
check('A3-2 : .tool-block-img a cursor:pointer (affordance)', toolImgCursor === 'pointer');
await page.click('.tool-block-img');
await page.waitForSelector('.mermaid-lightbox.show', { timeout: 5000 });
const lbTool = await page.evaluate(() => {
  const el = document.querySelector('.mermaid-lightbox');
  const dlBtn = Array.from(el.querySelectorAll('.mermaid-lb-btn')).find(b => b.title === 'Télécharger');
  return { hasImg: !!el.querySelector('.mermaid-lightbox-canvas img'), dlHidden: dlBtn.hidden };
});
check('A3-2 : lightbox depuis .tool-block-img → <img> affiché, bouton Télécharger visible', lbTool.hasImg && lbTool.dlHidden === false);
await shot('03-lightbox-tool-image.png');
const dlToolImg = page.waitForEvent('download', { timeout: 5000 });
await page.click('.mermaid-lightbox-actions .mermaid-lb-btn[title="Télécharger"]');
const toolImgDl = await dlToolImg;
check('A3-2 : download depuis .tool-block-img fonctionne (nom dérivé du mime)', /\.png$/.test(toolImgDl.suggestedFilename()));
await page.keyboard.press('Escape');

await browser.close();

console.log('');
if (consoleErrors.length) {
  console.log('Erreurs console :');
  consoleErrors.forEach(e => console.log('  ' + e));
  failures.push('console errors');
}
console.log(failures.length ? `ÉCHEC — ${failures.length} vérification(s) : ${failures.join(' | ')}` : 'OK — toutes les vérifications passent');
process.exitCode = failures.length ? 1 : 0;
