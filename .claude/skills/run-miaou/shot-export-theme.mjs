// Capture un export interactif dans ses deux thèmes (avant/après bascule).
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const outDir = path.resolve(dir, 'shots-export-theme');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(appUrl);
await page.waitForFunction(() => typeof serializeThemeTokens === 'function');

const body = `
<div class="msg user"><div class="bubble"><div class="body"><p>Peux-tu me résumer le principe ?</p></div></div><div class="msg-ts">14:02</div></div>
<div class="msg assistant"><div class="body">
<p>Voici l'essentiel, avec un exemple de code :</p>
<pre class="language-python"><div class="code-head"><span class="code-lang">python</span></div><code class="language-python">def greet(name):
    return f"Bonjour {name}"</code></pre>
<p>Et un tableau récapitulatif :</p>
<table><thead><tr><th>Option</th><th>Effet</th></tr></thead>
<tbody><tr><td><code>strict</code></td><td>Refuse le markup brut</td></tr>
<tr><td><code>loose</code></td><td>Tolère le HTML inline</td></tr></tbody></table>
<blockquote><p>Une citation pour vérifier le rendu des bordures.</p></blockquote>
</div><div class="msg-ts">14:03</div></div>`;

const html = await page.evaluate((bodyHtml) => {
  const styleCss = serializeThemeTokens() + EXPORT_CSS + PRISM_THEME_CSS;
  const scriptTag = '<script>' + EXPORT_SCRIPT.replace(/<\//g, '<\\/') + '</' + 'script>\n';
  return buildExportHtml({
    title: 'Conversation de démonstration', dateDisplay: '18 juillet 2026',
    theme: 'dark', styleCss, bodyHtml, scriptTag,
  });
}, body);

const file = path.join(outDir, 'export.html');
fs.writeFileSync(file, html);

const ex = await browser.newPage();
await ex.setViewportSize({ width: 1100, height: 900 });
await ex.goto('file://' + file);
await ex.waitForSelector('.theme-switch-label');
await ex.screenshot({ path: path.join(outDir, '1-sombre.png'), fullPage: true });
await ex.click('.theme-switch-label');
await ex.waitForTimeout(200);
await ex.screenshot({ path: path.join(outDir, '2-clair.png'), fullPage: true });
await browser.close();
console.log('shots → ' + outDir);
