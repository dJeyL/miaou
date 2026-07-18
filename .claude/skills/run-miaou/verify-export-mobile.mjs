// Vérifie le rendu mobile des pages exportées (lot R) :
//  - <meta viewport> présent (sans lui, aucune media query mobile ne se
//    déclenche et le texte paraît minuscule)
//  - zoom neutralisé sous 767px, conservé au-dessus
//  - taille de texte effectivement plus grande sur mobile qu'avant le correctif
//  - pas de scroll horizontal du body
import { chromium, devices } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const outDir = path.resolve(dir, 'tmp-export-mobile');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const MD = `# Document de test

Un paragraphe de texte courant pour mesurer la taille de rendu effective sur
mobile, avec suffisamment de mots pour occuper plusieurs lignes.

| Colonne A | Colonne B | Colonne C |
| --- | --- | --- |
| valeur assez longue | autre valeur | troisième |

\`\`\`python
def une_fonction_au_nom_plutot_long(parametre):
    return parametre * 2
\`\`\`
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(appUrl);
await page.waitForFunction(() => typeof convertMarkdownToHtmlFile === 'function');
const html = await page.evaluate(async (md) => {
  const s = loadSettings();
  saveSettings({ ...s, exportInteractive: true });
  return await convertMarkdownToHtmlFile(md, 'test-mobile.md');
}, MD);
await page.close();

const file = path.join(outDir, 'export.html');
fs.writeFileSync(file, html);

const results = [];
const check = (n, ok) => results.push({ n, ok });

check('<meta viewport> présent', /<meta name="viewport"[^>]*width=device-width/.test(html));
check('media query mobile présente', /@media \(max-width: 767px\)/.test(html));

async function measure(contextOpts, label) {
  const ctx = await browser.newContext(contextOpts);
  const p = await ctx.newPage();
  await p.goto('file://' + file);
  const m = await p.evaluate(() => {
    // Le bouton de thème est en position:fixed (hors flux) : sans réserve de
    // place dans la topbar, un titre long passe DESSOUS et se fait amputer
    // (constaté sur iPhone). On mesure le chevauchement réel.
    const t = document.querySelector('.export-title');
    const b = document.querySelector('.theme-switch-label');
    const bar = document.querySelector('.export-topbar');
    return {
    zoom: getComputedStyle(document.documentElement).zoom,
    fontPx: parseFloat(getComputedStyle(document.querySelector('.export-body p')).fontSize),
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    overlap: t && b ? Math.round(t.getBoundingClientRect().right - b.getBoundingClientRect().left) : null,
    // Le bouton doit rester solidaire de la colonne de lecture, pas du bord
    // du viewport (sinon il flotte très loin du cartouche sur grand écran).
    gapToColumn: b && bar ? Math.round(b.getBoundingClientRect().left - bar.getBoundingClientRect().right) : null,
    };
  });
  await p.screenshot({ path: path.join(outDir, label + '.png'), fullPage: true });
  await ctx.close();
  return m;
}

const mobile = await measure(devices['iPhone 13'], 'mobile');
const desktop = await measure({ viewport: { width: 1280, height: 900 } }, 'desktop');

console.log('mobile  :', JSON.stringify(mobile));
console.log('desktop :', JSON.stringify(desktop));
console.log('');

// zoom lu en calculé : '1' sur mobile, '0.9' sur desktop.
check('zoom neutralisé sur mobile', String(mobile.zoom) === '1');
check('zoom 0.9 conservé sur desktop', String(desktop.zoom).startsWith('0.9'));
// Taille de texte effective : le zoom desktop réduit le rendu, donc à font-size
// CSS égale le texte mobile est effectivement plus grand.
check('texte au moins aussi grand sur mobile qu\'en CSS nominal', mobile.fontPx >= 14);
check('pas de scroll horizontal sur mobile', mobile.scrollW <= mobile.clientW + 1);
// Régression « titre amputé » (retour Julien, capture iPhone).
check('titre non chevauché par le bouton (mobile)', mobile.overlap < 0);
check('titre non chevauché par le bouton (desktop)', desktop.overlap < 0);
// Le bouton reste calé sur la colonne de lecture, pas sur le bord de l'écran.
check('bouton solidaire de la colonne sur grand écran', Math.abs(desktop.gapToColumn) <= 8);

await browser.close();

let ok = true;
for (const r of results) { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n); if (!r.ok) ok = false; }
console.log(ok ? '\nOK' : '\nÉCHEC');
console.log('captures : ' + outDir);
process.exit(ok ? 0 : 1);
