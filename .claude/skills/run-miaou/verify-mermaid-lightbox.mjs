#!/usr/bin/env node
// Vérification visuelle lot E3 (un seul lancement) :
//   - seed-23 : rendu Mermaid + barre d'actions (agrandir/SVG/PNG),
//   - lightbox : ouverture, STYLES APPLIQUÉS au clone (régression id-scopé),
//     fit initial, zoom molette centré curseur, pan au drag, double-clic reset,
//     fermeture Esc / clic fond, cycle fermer-rouvrir,
//   - exports : noms de téléchargement flux-oauth.svg / flux-oauth.png
//     (filename= du fence via diagramImageName).
// Nécessite le réseau (Mermaid CDN).
// Usage : node verify-mermaid-lightbox.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-mermaid-lightbox');
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
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);

// ── 1. seed-23 : rendu Mermaid + barre d'actions ────────────────────────────
await page.click('.conv-title:text("Diagrammes Mermaid")');
// Rendu asynchrone : lazy-load CDN puis passe — attendre le SVG.
await page.waitForSelector('#thread .mermaid-view svg', { timeout: 20000 });
await page.waitForTimeout(300);
const view = await page.evaluate(() => {
  const v = document.querySelector('#thread .mermaid-view');
  const btns = Array.from(v.querySelectorAll('.mermaid-actions .mermaid-btn'));
  return {
    btnCount: btns.length,
    btnTitles: btns.map(b => b.title),
    svgId: v.querySelector('svg').id,
    hasStyle: !!v.querySelector('svg style'),
  };
});
check('vue : barre d\'actions à 3 boutons (agrandir, SVG, PNG)', view.btnCount === 3
  && view.btnTitles.join('|') === 'Agrandir|Télécharger en SVG|Télécharger en PNG');
await page.hover('#thread .mermaid-view');
await shot('01-view-actions.png');

// ── 2. Lightbox : ouverture, styles appliqués, fit initial ─────────────────
await page.click('#thread .mermaid-btn-expand');
await page.waitForSelector('.mermaid-lightbox.show', { timeout: 5000 });
const lb = await page.evaluate(() => {
  const el = document.querySelector('.mermaid-lightbox');
  const canvas = el.querySelector('.mermaid-lightbox-canvas');
  const svg = canvas.querySelector('svg');
  const orig = document.querySelector('#thread .mermaid-view svg');
  // Régression id-scopé : le <style> Mermaid cible #<id> — un élément stylé
  // du clone doit avoir la MÊME couleur calculée que son homologue du fil.
  const pick = (root) => root.querySelector('rect.actor, .actor rect, .node rect, rect');
  const co = pick(orig) ? getComputedStyle(pick(orig)).fill : null;
  const cc = pick(svg) ? getComputedStyle(pick(svg)).fill : null;
  const cr = canvas.getBoundingClientRect();
  return {
    sameId: svg.id === orig.id,
    styleKept: !!svg.querySelector('style'),
    fillOrig: co, fillClone: cc,
    transform: canvas.style.transform,
    inViewport: cr.left >= 0 && cr.top >= 0 && cr.right <= innerWidth && cr.bottom <= innerHeight,
    canvasW: cr.width,
  };
});
check('lightbox : clone avec id + <style> conservés', lb.sameId && lb.styleKept);
check('lightbox : styles Mermaid appliqués au clone (fill identique au fil)',
  !!lb.fillClone && lb.fillClone === lb.fillOrig && lb.fillClone !== 'rgb(0, 0, 0)');
check('lightbox : fit initial — diagramme entier dans le viewport', lb.inViewport && lb.canvasW > 100);
await shot('02-lightbox-open.png');

// ── 3. Zoom molette centré curseur ──────────────────────────────────────────
const stageBox = await page.locator('.mermaid-lightbox-stage').boundingBox();
const cx = stageBox.x + stageBox.width / 2, cy = stageBox.y + stageBox.height / 2;
const tf0 = await page.evaluate(() => document.querySelector('.mermaid-lightbox-canvas').style.transform);
await page.mouse.move(cx, cy);
await page.mouse.wheel(0, -120);
await page.mouse.wheel(0, -120);
await page.waitForTimeout(100);
const zoom = await page.evaluate(() => {
  const t = document.querySelector('.mermaid-lightbox-canvas').style.transform;
  return { t, scale: parseFloat(t.match(/scale\(([\d.]+)\)/)[1]) };
});
check('zoom : molette augmente l\'échelle (transform modifiée)', zoom.t !== tf0 && zoom.scale > 0);
await shot('03-lightbox-zoomed.png');

// ── 4. Pan au drag ──────────────────────────────────────────────────────────
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 150, cy + 80, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(100);
const pan = await page.evaluate(() => document.querySelector('.mermaid-lightbox-canvas').style.transform);
check('pan : drag déplace le canvas (translate modifiée)', pan !== zoom.t);
check('pan : un drag terminé sur le fond ne ferme PAS la lightbox',
  await page.evaluate(() => document.querySelector('.mermaid-lightbox').classList.contains('show')));

// ── 5. Double-clic = reset (re-fit) ─────────────────────────────────────────
await page.mouse.dblclick(cx, cy);
await page.waitForTimeout(100);
const reset = await page.evaluate(() => document.querySelector('.mermaid-lightbox-canvas').style.transform);
check('double-clic : retour au fit initial', reset === tf0);
await shot('04-lightbox-reset.png');

// ── 6. Exports : noms de fichier depuis le filename= du fence ──────────────
const dlSvg = page.waitForEvent('download', { timeout: 5000 });
await page.click('.mermaid-lightbox-actions .mermaid-lb-btn[title="Télécharger en SVG"]');
check('export SVG (lightbox) : flux-oauth.svg', (await dlSvg).suggestedFilename() === 'flux-oauth.svg');
const dlPng = page.waitForEvent('download', { timeout: 10000 });
await page.click('.mermaid-lightbox-actions .mermaid-lb-btn[title="Télécharger en PNG"]');
const pngDl = await dlPng;
check('export PNG (lightbox) : flux-oauth.png', pngDl.suggestedFilename() === 'flux-oauth.png');
const pngPath = path.join(outDir, 'export.png');
await pngDl.saveAs(pngPath);
const pngSize = fs.statSync(pngPath).size;
check('export PNG : fichier non vide (canvas non tainted)', pngSize > 5000);
console.log('        (PNG exporté : ' + pngSize + ' octets → ' + pngPath + ')');

// ── 7. Fermetures : Esc, clic fond, cycle rouvrir ───────────────────────────
await page.keyboard.press('Escape');
check('Esc ferme la lightbox',
  await page.evaluate(() => !document.querySelector('.mermaid-lightbox').classList.contains('show')));
await page.click('#thread .mermaid-btn-expand');
await page.waitForTimeout(200);
const reopened = await page.evaluate(() => {
  const el = document.querySelector('.mermaid-lightbox');
  return { show: el.classList.contains('show'),
           t: el.querySelector('.mermaid-lightbox-canvas').style.transform };
});
check('rouvrir : lightbox réaffichée, transform réinitialisée (fit)', reopened.show && reopened.t === tf0);
// Clic sans mouvement sur le fond (coin de la scène, hors diagramme) → ferme.
await page.mouse.click(stageBox.x + 20, stageBox.y + 20);
await page.waitForTimeout(100);
check('clic sur le fond hors diagramme ferme',
  await page.evaluate(() => !document.querySelector('.mermaid-lightbox').classList.contains('show')));
check('lightbox fermée : clone purgé',
  await page.evaluate(() => !document.querySelector('.mermaid-lightbox-canvas svg')));

// ── 8. Export SVG depuis la vue (hors lightbox) ─────────────────────────────
await page.hover('#thread .mermaid-view');
const dlSvg2 = page.waitForEvent('download', { timeout: 5000 });
await page.click('#thread .mermaid-actions .mermaid-btn[title="Télécharger en SVG"]');
check('export SVG (vue) : flux-oauth.svg', (await dlSvg2).suggestedFilename() === 'flux-oauth.svg');

await shot('05-final.png');
await browser.close();

console.log('');
if (consoleErrors.length) {
  console.log('Erreurs console :');
  consoleErrors.forEach(e => console.log('  ' + e));
}
console.log(failures.length ? `ÉCHEC — ${failures.length} vérification(s) en échec` : 'OK — toutes les vérifications passent');
process.exit(failures.length ? 1 : 0);
