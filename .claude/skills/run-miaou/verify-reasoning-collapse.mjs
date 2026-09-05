// Prouve que le repli du raisonnement dans l'export marche SANS JS : clic sur
// le CORPS du raisonnement (pas l'en-tête) doit le replier, via l'imbrication
// <details><summary>…contenu…</summary></details> (même motif que les outils).
// Export non interactif (scriptTag vide) → aucun JS dans le fichier.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const thread = [
  { role: 'user', content: 'Explique.', ts: Date.now() },
  { role: 'assistant', model: 'm', ts: Date.now(),
    reasoning: 'Une ligne de raisonnement assez longue pour cliquer dedans sans viser le titre.',
    content: 'Réponse.' },
];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(appUrl);
await page.waitForFunction(() => typeof buildExportHtml === 'function');
const html = await page.evaluate(async (t) => {
  const styleCss = serializeThemeTokens() + EXPORT_CSS + PRISM_THEME_CSS;
  // `renderExportBody` est ASYNC depuis l'embarquement des SVG Mermaid
  // (`3c034d2`) : sans await, bodyHtml recevait « [object Promise] » et le
  // <details> du raisonnement n'était jamais rendu — le test échouait sur
  // l'absence de `.reasoning-label` en laissant croire à une régression du repli.
  const body = await renderExportBody(t, null);
  // scriptTag VIDE : export strictement zéro-JS.
  return buildExportHtml({ title: 'R', dateDisplay: 'x', theme: 'dark', styleCss, bodyHtml: body, scriptTag: '' });
}, thread);

const results = [];
const check = (n, ok) => results.push({ n, ok });
check('export sans aucun <script>', !html.includes('<script>'));
check('contenu imbriqué dans le summary', /<summary>[\s\S]*reasoning-content[\s\S]*<\/summary>/.test(html));

const p2 = await browser.newPage();
await p2.goto('data:text/html;charset=utf-8,' + encodeURIComponent(html));
// Ouvrir le details en cliquant l'en-tête.
await p2.click('.reasoning-label');
check('ouvert après clic sur l\'en-tête', await p2.evaluate(() => document.querySelector('details.reasoning').open));
// Cliquer DANS le corps (pas l'en-tête) → doit replier.
await p2.click('.reasoning-content');
check('replié après clic dans le corps (no-JS)', await p2.evaluate(() => !document.querySelector('details.reasoning').open));
// Rouvrir en cliquant le corps encore (il est masqué quand fermé → on reclique l'en-tête).
await p2.click('.reasoning-label');
check('rouvert après clic en-tête', await p2.evaluate(() => document.querySelector('details.reasoning').open));

await browser.close();
let ok = true;
for (const r of results) { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n); if (!r.ok) ok = false; }
console.log(ok ? '\nOK' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
