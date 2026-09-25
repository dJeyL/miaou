#!/usr/bin/env node
// Non-régression de la montée Mermaid 11.12.0 → 11.13.0 et du message
// d'exception dans la notice .mermaid-error.
//   - Cinq diagrammes réels à labels multi-lignes à puces (`<br/>- a<br/>- b`),
//     que 11.12.0 refusait en htmlLabels:false (splitLineToFitWidth does not
//     support newlines in the line) : rendus par la VRAIE passe
//     renderMermaidUnder, donc avec la config de MIAOU, sans notice d'erreur.
//   - Export PNG du plus gros : téléchargé, décodable, non uniforme (le canvas
//     n'est ni blanc ni tainted — raison d'être de htmlLabels:false).
//   - seed-23 : le bloc volontairement cassé affiche la notice SUIVIE du
//     message de Mermaid.
// Nécessite le réseau (Mermaid CDN).
// Options :
//   --md <fichier.md>       ajoute les blocs ```mermaid de ce fichier aux cas
//                           embarqués (rejouer un lot de diagrammes réels) ;
//   --mermaid-file <js>     sert ce build Mermaid à la place du CDN épinglé
//                           (rejouer sur une autre version — la 11.12.0 doit
//                           faire ÉCHOUER les cas à puces, sinon le contrôle ne
//                           prouve rien).
// Usage : node verify-mermaid-bullets.mjs <dossier-captures> [--headed] [--md f] [--mermaid-file f]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedAll } from './seed-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const mdFile = opt('--md');
const mermaidFile = opt('--mermaid-file');
const outDir = (argv[0] && !argv[0].startsWith('--')) ? argv[0] : path.join(__dirname, 'shots-mermaid-bullets');
const headed = argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// Labels à puces multi-lignes, assez longs pour que Mermaid doive les couper.
const L = 'texte assez long pour dépasser la largeur de coupure du noeud';
const DIAGRAMS = [
  'flowchart TD\n    N1["Structure projet Python<br/>- Dépendances (uv ? ou pip)<br/>- Tests unitaires<br/>- Scripts qui ne font rien"]\n    N9["Réponses aux questions(échange avec POP ?)<br/>- Articulation des YAML<br/>- Gestion de versions ?<br/>- Packaging (où/comment ?), ou lien direct ?"]\n    N14["Réponses aux questions<br/>- Toolkit(s) IBM : sur DLU ?<br/>(alternative : download web, vu que stockage de binaires interdit sur GitLab)"]\n    N1 --> N9\n    N14 --> N9',
  'flowchart TD\n    subgraph N6["cicd_apim"]\n        N7["Structure projet Python<br>- Dépendances<br>- Tests unitaires<br>- Scripts (placeholders)"]\n        N9["[Développements]"]\n    end\n    N7 --> N9',
  `flowchart LR\n    A["Étapes<br/>1. ${L}<br/>2. ${L}"] --> B["Puces<br/>- ${L}<br/>- ${L}"]`,
  `flowchart TD\n    A["Titre<br/>* ${L}<br/>* ${L}"] --> B["Titre<br/>+ ${L}<br/>+ ${L}"]`,
  `graph TD\n    A{"Choix<br/>- ${L}<br/>- ${L}"} -->|oui| B["Fin"]`,
];
if (mdFile) {
  const md = fs.readFileSync(mdFile, 'utf8');
  const blocks = Array.from(md.matchAll(/```mermaid[^\n]*\n([\s\S]*?)```/g), m => m[1]);
  console.log(`  info  ${blocks.length} bloc(s) lus dans ${mdFile}`);
  DIAGRAMS.push(...blocks);
}

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

if (mermaidFile) {
  const body = fs.readFileSync(mermaidFile, 'utf8');
  await page.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/mermaid\//, r => r.fulfill({ contentType: 'application/javascript', body }));
  console.log(`  info  Mermaid servi depuis ${mermaidFile}`);
}

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await seedAll(page);
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);

// ── 1. seed-23 : notice d'erreur avec message ─────────────────────────────
await page.click('.conv-title:text("Diagrammes Mermaid")');
await page.waitForSelector('#thread .mermaid-error', { timeout: 20000 });
const notice = await page.evaluate(() => document.querySelector('#thread .mermaid-error').textContent);
console.log('  info  notice : ' + notice);
check('notice : libellé fixe suivi du message Mermaid',
  notice.startsWith('Diagramme invalide — source affichée (mermaid : ') && notice.length > 50);
check('version épinglée : 11.13.0', await page.evaluate(() => MERMAID_CDN.includes('/11.13.0/')));

// ── 2. Les diagrammes à puces, par la vraie passe ──────────────────────────
const results = await page.evaluate(async (diagrams) => {
  const host = document.createElement('div');
  host.id = 'mmd-bullets';
  host.className = 'msg assistant';
  const body = document.createElement('div');
  body.className = 'body';
  host.appendChild(body);
  document.getElementById('thread').prepend(host);
  for (const src of diagrams) {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.className = 'language-mermaid';
    code.textContent = src;
    pre.appendChild(code);
    body.appendChild(pre);
    decoratePre(pre);
  }
  await renderMermaidUnder(host);
  return Array.from(body.querySelectorAll(':scope > pre')).map(pre => ({
    rendered: !!pre.querySelector('.mermaid-view svg'),
    error: pre.querySelector('.mermaid-error')?.textContent || null,
    textNodes: pre.querySelectorAll('.mermaid-view svg text').length,
    foreignObjects: pre.querySelectorAll('.mermaid-view svg foreignObject').length,
  }));
}, DIAGRAMS);
results.forEach((r, i) => {
  check(`diagramme ${i + 1} : rendu en SVG sans notice` + (r.error ? ` — ${r.error}` : ''), r.rendered && !r.error);
  check(`diagramme ${i + 1} : labels en <text>, aucun <foreignObject>`, r.textNodes > 0 && r.foreignObjects === 0);
});
await page.evaluate(() => document.getElementById('mmd-bullets').scrollIntoView());
await page.screenshot({ path: path.join(outDir, '01-bullets.png'), fullPage: false });
const first = await page.$('#mmd-bullets pre .mermaid-view');
if (first) await first.screenshot({ path: path.join(outDir, '02-first-diagram.png') });

// ── 3. Export PNG du premier diagramme ─────────────────────────────────────
await page.hover('#mmd-bullets pre .mermaid-view');
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.click('#mmd-bullets pre .mermaid-view .mermaid-btn[title="Télécharger en PNG"]'),
]);
const pngPath = path.join(outDir, '03-export.png');
await dl.saveAs(pngPath);
const pngB64 = fs.readFileSync(pngPath).toString('base64');
const stats = await page.evaluate(async (b64) => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) seen.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
  return { w: c.width, h: c.height, colors: seen.size };
}, pngB64);
console.log(`  info  PNG ${stats.w}×${stats.h}, ${stats.colors} couleurs échantillonnées`);
check('export PNG : décodable et non uniforme', stats.w > 0 && stats.h > 0 && stats.colors > 2);

check('aucune erreur console', consoleErrors.length === 0);
if (consoleErrors.length) consoleErrors.forEach(e => console.log('    ' + e));

await browser.close();
console.log(failures.length ? `\n${failures.length} échec(s)` : '\nOK');
process.exit(failures.length ? 1 : 0);
