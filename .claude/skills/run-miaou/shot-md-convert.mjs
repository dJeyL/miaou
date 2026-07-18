// Capture : un .md converti (avec titre → cartouche) et un autre sans titre,
// plus la zone de dépôt dans les réglages.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const outDir = path.resolve(dir, 'shots-md-convert');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const MD = `# Notes d'architecture

Ce document décrit le **pipeline de build** et ses points d'injection.

## Points d'injection

Le build substitue quatre marqueurs dans \`index.html\` :

\`\`\`python
MARKERS = {
    "__MIAOU_CONFIG__": load_config(),
    "__MIAOU_HELP__": parse_help(),
}
\`\`\`

| Marqueur | Source | Destination |
| --- | --- | --- |
| \`__CSS__\` | \`src/css/*.css\` | \`<style>\` |
| \`__JS__\` | \`src/js/*.js\` | \`<script>\` |

> L'ordre de concaténation **est** la cascade CSS.

### Points d'attention

- Les commentaires sont retirés au passage
- \`src/\` reste la référence commentée
- \`dist/\` est compact
`;

const MD_PLAIN = `Un mémo sans titre de niveau 1.

Il ne produit donc **aucun cartouche** : la date part dans le pied de page.

- premier point
- second point
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(appUrl);
await page.waitForFunction(() => typeof convertMarkdownToHtmlFile === 'function');

// Zone de dépôt dans les réglages (catégorie Outils & extensions).
await page.evaluate(() => { openSettings(); });
await page.waitForTimeout(300);
await page.evaluate(() => {
  const zone = document.getElementById('md-convert-zone');
  if (!zone) return;
  let cat = zone.closest('.set-cat');
  if (cat && !cat.classList.contains('open')) {
    const head = cat.querySelector('.set-cat-head');
    if (head) head.click();
  }
});
await page.waitForTimeout(500);
await page.evaluate(() => {
  const z = document.getElementById('md-convert-zone');
  if (z) z.scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(300);
const drawer = await page.$('#settings-drawer');
if (drawer) await drawer.screenshot({ path: path.join(outDir, '0-zone-reglages.png') });

const htmls = await page.evaluate(async ({ md, mdPlain }) => {
  const s = loadSettings();
  saveSettings({ ...s, exportInteractive: true });
  const a = await convertMarkdownToHtmlFile(md, 'notes-architecture.md');
  const b = await convertMarkdownToHtmlFile(mdPlain, 'memo.md');
  return { a, b };
}, { md: MD, mdPlain: MD_PLAIN });

const fileA = path.join(outDir, 'avec-titre.html');
const fileB = path.join(outDir, 'sans-titre.html');
fs.writeFileSync(fileA, htmls.a);
fs.writeFileSync(fileB, htmls.b);

const ex = await browser.newPage();
await ex.setViewportSize({ width: 1100, height: 1000 });
await ex.goto('file://' + fileA);
await ex.screenshot({ path: path.join(outDir, '1-converti-sombre.png'), fullPage: true });
await ex.click('.theme-switch-label');
await ex.waitForTimeout(200);
await ex.screenshot({ path: path.join(outDir, '2-converti-clair.png'), fullPage: true });
await ex.goto('file://' + fileB);
await ex.screenshot({ path: path.join(outDir, '3-sans-cartouche.png'), fullPage: true });
await browser.close();
console.log('shots → ' + outDir);
