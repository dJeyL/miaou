// Vérifie la conversion Markdown → HTML (lot R, point 3) de bout en bout :
//  - avec titre h1 : cartouche + titre retiré du corps
//  - sans titre h1 : aucun cartouche, date reportée dans le footer, bouton
//    de thème en repli flottant
//  - footer systématique, thème double, respect de exportInteractive
//  - sanitisation : un <script> présent dans le .md ne survit pas
//  - blocs de code décorés (langage) et colorés
//  - le fichier téléchargé porte bien le nom du .md source
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const outDir = path.resolve(dir, 'tmp-md-convert');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
const results = [];
const check = (n, ok) => results.push({ n, ok });

// Capture les téléchargements pour vérifier le nom de fichier produit.
// L'événement 'download' arrive de façon asynchrone APRÈS le retour de la
// conversion : asserter juste après l'await donne un test à bascule (vu une
// fois). waitForDownload() attend explicitement le n-ième téléchargement.
const downloads = [];
page.on('download', d => downloads.push(d.suggestedFilename()));
async function waitForDownload(n, timeoutMs = 5000) {
  const t0 = Date.now();
  while (downloads.length < n && Date.now() - t0 < timeoutMs) {
    await new Promise(r => setTimeout(r, 50));
  }
}

await page.goto(appUrl);
await page.waitForFunction(() => typeof convertMarkdownToHtmlFile === 'function');

const MD_WITH_TITLE = [
  '# Guide de démarrage',
  '',
  'Un paragraphe **en gras** avec du `code inline`.',
  '',
  '## Section',
  '',
  '```python',
  'def hello():',
  '    return "monde"',
  '```',
  '',
  '| Option | Effet |',
  '| --- | --- |',
  '| `a` | fait A |',
  '',
  '> Une citation.',
  '',
  '<script>window.__pwned = true;</script>',
  '',
  '<img src=x onerror="window.__pwned2=true">',
  '',
].join('\n');

const MD_NO_TITLE = [
  'Directement du texte, sans titre de niveau 1.',
  '',
  '## Un h2 quand même',
  '',
  '- item un',
  '- item deux',
  '',
].join('\n');

async function convert(md, name, interactive) {
  return page.evaluate(async ({ md, name, interactive }) => {
    const s = loadSettings();
    saveSettings({ ...s, exportInteractive: interactive });
    return await convertMarkdownToHtmlFile(md, name);
  }, { md, name, interactive });
}

// ── 1. Avec titre ───────────────────────────────────────────────────────────
const htmlTitled = await convert(MD_WITH_TITLE, 'guide de démarrage.md', true);
fs.writeFileSync(path.join(outDir, 'avec-titre.html'), htmlTitled);
check('titre du h1 dans le cartouche', htmlTitled.includes('Guide de démarrage'));
check('date dans le footer, PAS dans le cartouche', /Converti par MIAOU le /.test(htmlTitled));
check('footer « Converti par MIAOU »', htmlTitled.includes('Converti par MIAOU'));
// La date est désormais TOUJOURS dans le footer (décision Julien), avec ou
// sans cartouche : un seul endroit, pas de branche conditionnelle.
check('footer daté même avec cartouche', /Converti par MIAOU le [^<]+<\/div>/.test(htmlTitled));
check('les deux jeux de tokens sont embarqués',
      htmlTitled.includes('body{') && htmlTitled.includes('body:has(#theme-switch:checked){'));
await waitForDownload(1);
check('nom de fichier téléchargé = nom du .md', downloads.includes('guide de démarrage.html'));

// ── 2. Rendu réel du document produit ───────────────────────────────────────
const ex = await browser.newPage();
await ex.goto('file://' + path.join(outDir, 'avec-titre.html'));
const rendered = await ex.evaluate(() => ({
  pwned: !!window.__pwned,
  pwned2: !!window.__pwned2,
  hasScriptInBody: !!document.querySelector('.export-body script'),
  codeLang: (document.querySelector('.code-lang') || {}).textContent || '',
  hasPrismTokens: !!document.querySelector('.export-body .token'),
  tableCells: document.querySelectorAll('.export-body table td').length,
  blockquotes: document.querySelectorAll('.export-body blockquote').length,
  bodyClass: (document.querySelector('.export-body > div') || {}).className || '',
  themeBtnInTopbar: !!document.querySelector('.export-topbar ~ * .theme-switch-label, .theme-switch-label'),
  // Assertions de STRUCTURE : interrogées sur le DOM rendu, pas par recherche
  // de sous-chaîne dans le fichier (le CSS et le script contiennent les mêmes
  // noms de classes — trois faux échecs au premier jet).
  hasTopbar: !!document.querySelector('.export-topbar'),
  h1InBody: document.querySelectorAll('.export-body h1').length,
  titleInBodyText: (document.querySelector('.export-body') || {}).textContent.includes('Guide de démarrage'),
}));
check('cartouche présent quand le .md a un h1', rendered.hasTopbar);
check('titre h1 RETIRÉ du corps (pas de doublon)', !rendered.titleInBodyText);
check('aucun h1 résiduel dans le corps', rendered.h1InBody === 0);
check('aucun <script> du .md exécuté (sanitisation)', !rendered.pwned);
check('aucun onerror du .md exécuté (sanitisation)', !rendered.pwned2);
check('aucun <script> résiduel dans le corps', !rendered.hasScriptInBody);
check('bloc de code décoré du langage', rendered.codeLang === 'python');
check('coloration syntaxique appliquée', rendered.hasPrismTokens);
check('tableau markdown rendu', rendered.tableCells >= 2);
check('blockquote rendu', rendered.blockquotes === 1);
check('conteneur réutilise la classe .body', /\bbody\b/.test(rendered.bodyClass) && /md-doc/.test(rendered.bodyClass));
check('bouton de thème dans le cartouche', rendered.themeBtnInTopbar);

// Bascule de thème sur le document converti.
const before = await ex.evaluate(() => getComputedStyle(document.body).backgroundColor);
await ex.click('.theme-switch-label');
const after = await ex.evaluate(() => getComputedStyle(document.body).backgroundColor);
check('bascule de thème opérante sur un .md converti', before !== after);
await ex.close();

// ── 3. Sans titre ───────────────────────────────────────────────────────────
const htmlPlain = await convert(MD_NO_TITLE, 'notes.md', true);
fs.writeFileSync(path.join(outDir, 'sans-titre.html'), htmlPlain);
check('footer présent quand même', htmlPlain.includes('Converti par MIAOU'));
check('date reportée dans le footer sans cartouche', /Converti par MIAOU le /.test(htmlPlain));
await waitForDownload(2);
check('nom de fichier sans titre = nom du .md', downloads.includes('notes.html'));

const ex2 = await browser.newPage();
await ex2.goto('file://' + path.join(outDir, 'sans-titre.html'));
const plain = await ex2.evaluate(() => ({
  floating: !!document.querySelector('.theme-switch-label'),
  hasTopbar: !!document.querySelector('.export-topbar'),
  h2: document.querySelectorAll('.export-body h2').length,
  items: document.querySelectorAll('.export-body li').length,
}));
check('AUCUN cartouche quand le .md n\'a pas de h1', !plain.hasTopbar);
check('bouton de thème en repli flottant sans cartouche', plain.floating);
check('contenu rendu normalement (h2 + liste)', plain.h2 === 1 && plain.items === 2);
await ex2.close();

// ── 4. Export non interactif ────────────────────────────────────────────────
const htmlStatic = await convert(MD_WITH_TITLE, 'statique.md', false);
fs.writeFileSync(path.join(outDir, 'statique.html'), htmlStatic);
check('aucun <script> quand exportInteractive est off', !htmlStatic.includes('<script>'));
const ex3 = await browser.newPage();
await ex3.goto('file://' + path.join(outDir, 'statique.html'));
const stat = await ex3.evaluate(() => ({
  btn: !!document.querySelector('.theme-switch-label'),
  topbar: !!document.querySelector('.export-topbar'),
}));
// Lot R révisé : la bascule est du markup statique, elle DOIT survivre sans JS.
check('bouton de thème présent même en statique', stat.btn);
check('cartouche toujours présent en statique', stat.topbar);
await ex3.close();

await browser.close();

let ok = true;
for (const r of results) { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n); if (!r.ok) ok = false; }
console.log(ok ? '\nOK' : '\nÉCHEC');
console.log('documents de test : ' + outDir);
process.exit(ok ? 0 : 1);
