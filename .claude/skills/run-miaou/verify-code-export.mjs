// Vérifie l'export HTML des blocs de code : barre de langage statique (no-JS),
// script copier/télécharger optionnel (settings.exportInteractive), et que le
// fichier exporté s'ouvre et révèle bien les deux boutons quand le JS tourne.
// Checklist unique, batché (cf. mémoire feedback_no_manual_verification).
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');

const thread = [
  { role: 'user', content: 'Montre-moi un exemple.', ts: Date.now() },
  { role: 'assistant', model: 'test-model', ts: Date.now(),
    content: 'Voici :\n\n```python filename=hello.py\nprint("hi")\n```\n' },
];

const results = [];
function check(name, ok, extra) { results.push({ name, ok, extra }); }

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(appUrl);
await page.waitForFunction(() => typeof buildExportHtml === 'function' && typeof renderExportBody === 'function');

// 1. Export interactif (défaut) : barre + script présents.
const withJs = await page.evaluate(async (t) => {
  saveSettings({ exportInteractive: true });
  window.currentThread = t; window.currentConvId = null;
  const styleCss = serializeThemeTokens() + EXPORT_CSS + PRISM_THEME_CSS;
  const body = await renderExportBody(t, null);
  const s = loadSettings();
  const scriptTag = (s.exportInteractive !== false)
    ? '<script>' + EXPORT_SCRIPT.replace(/<\//g, '<\\/') + '</' + 'script>'
    : '';
  return buildExportHtml({ title: 'T', dateDisplay: 'x', theme: 'dark', styleCss, bodyHtml: body, scriptTag, kind: 'export' });
}, thread);

check('barre .code-head présente', withJs.includes('class="code-head"'));
check('libellé langage = python', withJs.includes('class="code-lang">python<'));
check('data-filename préservé', withJs.includes('data-filename="hello.py"'));
check('script inclus quand interactif', withJs.includes('<script>') && withJs.includes('navigator.clipboard'));
check('pas de </script> non échappé dans le corps du script',
  !/<\/script>[\s\S]*navigator\.clipboard/.test(withJs));

// 2. Export non interactif : barre présente, script absent.
const noJs = await page.evaluate(async (t) => {
  saveSettings({ exportInteractive: false });
  const styleCss = serializeThemeTokens() + EXPORT_CSS + PRISM_THEME_CSS;
  const body = await renderExportBody(t, null);
  const s = loadSettings();
  const scriptTag = (s.exportInteractive !== false)
    ? '<script>' + EXPORT_SCRIPT + '</' + 'script>'
    : '';
  return buildExportHtml({ title: 'T', dateDisplay: 'x', theme: 'dark', styleCss, bodyHtml: body, scriptTag, kind: 'export' });
}, thread);

check('barre présente même sans JS', noJs.includes('class="code-lang">python<'));
check('aucun <script> quand non interactif', !noJs.includes('<script>'));

// 3. Ouvrir le fichier interactif : le script doit révéler les 2 boutons.
const page2 = await browser.newPage();
const errors2 = [];
page2.on('console', m => { if (m.type() === 'error') errors2.push(m.text()); });
await page2.goto('data:text/html;charset=utf-8,' + encodeURIComponent(withJs));
await page2.waitForTimeout(200);
const btns = await page2.evaluate(() => ({
  copy: !!document.querySelector('.code-copy'),
  dl: !!document.querySelector('.code-dl'),
  lang: (document.querySelector('.code-lang') || {}).textContent,
}));
check('bouton copier révélé par le script', btns.copy);
check('bouton télécharger révélé par le script', btns.dl);
check('langage lisible dans le fichier ouvert', btns.lang === 'python');

// 4. Ouvrir le fichier non interactif : barre oui, boutons non.
const page3 = await browser.newPage();
await page3.goto('data:text/html;charset=utf-8,' + encodeURIComponent(noJs));
await page3.waitForTimeout(150);
const btns3 = await page3.evaluate(() => ({
  copy: !!document.querySelector('.code-copy'),
  lang: (document.querySelector('.code-lang') || {}).textContent,
}));
check('pas de bouton copier sans script', !btns3.copy);
check('barre langage présente sans script', btns3.lang === 'python');

await browser.close();

let ok = true;
for (const r of results) {
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '  — ' + r.extra : ''));
  if (!r.ok) ok = false;
}
if (errors.length) console.log('Console errors (export interactif build):', errors);
if (errors2.length) console.log('Console errors (fichier ouvert):', errors2);
console.log(ok ? '\nOK' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
