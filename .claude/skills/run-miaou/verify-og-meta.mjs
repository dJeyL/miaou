// Vérifie les balises Open Graph / Twitter dans le <head> de l'export, et
// l'échappement des attributs content quand le titre contient des guillemets.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(appUrl);
await page.waitForFunction(() => typeof buildExportHtml === 'function');
const html = await page.evaluate(() => buildExportHtml({
  title: 'Ma conv "spéciale" <x>',
  dateDisplay: '10 juillet 2026',
  theme: 'dark',
  styleCss: '',
  bodyHtml: '<p>x</p>',
  scriptTag: '',
}));
await browser.close();

const results = [];
const check = (n, ok) => results.push({ n, ok });
check('og:title présent', html.includes('property="og:title"'));
check('og:description présent', html.includes('property="og:description"'));
check('og:site_name = MIAOU', html.includes('content="MIAOU"'));
check('og:image = logo data-URI', /property="og:image" content="data:image\/svg\+xml;base64,/.test(html));
// Les balises twitter:* ont été retirées (les crawlers concernés retombent sur
// og:*) — assertion supprimée plutôt que réécrite.
check('meta description présent', html.includes('<meta name="description"'));
check('description = titre + exporté depuis MIAOU', html.includes('exporté depuis MIAOU le 10 juillet 2026'));
// Échappement : le titre avec guillemets ne doit PAS casser l'attribut content.
check('guillemets du titre échappés (&quot;)', html.includes('Ma conv &quot;spéciale&quot; &lt;x&gt;'));
check('pas de " brut cassant un attribut content', !/content="[^"]*"spéciale"/.test(html));
// Le footer visible reste (on n'a pas touché au corps).
check('footer "Généré par MIAOU" toujours dans le body', html.includes('Généré par MIAOU'));

let ok = true;
for (const r of results) { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n); if (!r.ok) ok = false; }
console.log(ok ? '\nOK' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
