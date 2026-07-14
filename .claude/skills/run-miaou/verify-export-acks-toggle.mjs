// Vérifie le nouveau toggle à 3 paliers des acks dans l'export HTML (lot N) :
// replié → compteur seul, 1er clic → liste d'intents, clic sur la liste →
// détail JSON, clic sur le détail JSON → RETOUR aux intents (cycle, pas de
// cul-de-sac). Checklist unique batchée (cf. mémoire feedback_no_manual_verification).
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');

const results = [];
function check(name, ok, extra) { results.push({ name, ok, extra }); }

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(appUrl);
await page.waitForFunction(() => typeof formatToolAcksHtml === 'function' && typeof buildExportHtml === 'function');

// Groupe de 3 acks pour valider le libellé pluriel.
const html3 = await page.evaluate(() => formatToolAcksHtml([
  { name: 'get_time', intent: 'Donner l\'heure', args: {}, result: '14:32' },
  { name: 'fetch_url', intent: 'Récupérer une page', args: { url: 'https://x' }, result: 'ok' },
  { name: 'miaou__create_memory', intent: 'Mémoriser', args: { content: 'x' }, result: 'ok' },
]));
check('libellé pluriel "3 outils appelés" (pas de parenthèses)', html3.includes('3 outils appelés') && !html3.includes('('));

const html1 = await page.evaluate(() => formatToolAcksHtml([{ name: 'get_time', args: {}, result: '14:32' }]));
check('libellé singulier "1 outil appelé"', html1.includes('1 outil appelé'));

// Ouvre un fichier réel (le styleCss doit être présent pour driver les display:none/block).
const full = await page.evaluate((body) => {
  const styleCss = serializeThemeTokens() + EXPORT_CSS + PRISM_THEME_CSS;
  return buildExportHtml({ title: 'T', dateDisplay: 'x', theme: 'dark', styleCss, bodyHtml: '<div class="msg assistant">' + body + '<div class="body">ok</div></div>', scriptTag: '' });
}, html3);

const page2 = await browser.newPage();
const errors2 = [];
page2.on('console', m => { if (m.type() === 'error') errors2.push(m.text()); });
await page2.goto('data:text/html;charset=utf-8,' + encodeURIComponent(full));
await page2.waitForTimeout(150);

async function visible(selector) {
  const el = page2.locator(selector).first();
  if (await el.count() === 0) return false;
  return el.isVisible();
}

// Palier 1 : <details> fermé → toggle entier invisible (rien que le compteur).
check('palier 1 (replié) : .tool-trace-toggle invisible', !(await visible('.tool-trace-toggle')));
check('palier 1 (replié) : compteur visible', await visible('.tool-trace-summary-text'));
await page2.screenshot({ path: path.resolve(dir, 'export-acks-1-collapsed.png'), clip: { x: 0, y: 0, width: 700, height: 150 } });

// Palier 2 : clic sur le summary externe → ouvre, intents visibles, JSON caché.
await page2.click('.tool-trace summary');
await page2.waitForTimeout(80);
check('palier 2 : intents visibles après ouverture', await visible('.tool-ack-preview-list'));
check('palier 2 : détail JSON caché', !(await visible('.tool-trace-toggle ul')));
await page2.screenshot({ path: path.resolve(dir, 'export-acks-2-intents.png'), clip: { x: 0, y: 0, width: 700, height: 250 } });

// Palier 3 : clic sur la liste d'intents (label) → bascule vers le JSON.
await page2.click('.tt-view-intents');
await page2.waitForTimeout(80);
check('palier 3 : détail JSON visible après clic', await visible('.tool-trace-toggle ul'));
check('palier 3 : intents cachés', !(await visible('.tool-ack-preview-list')));
await page2.screenshot({ path: path.resolve(dir, 'export-acks-3-json.png'), clip: { x: 0, y: 0, width: 700, height: 400 } });

// Palier 4 : clic sur le détail JSON (label) → REVIENT aux intents (pas de cul-de-sac).
await page2.click('.tt-view-json');
await page2.waitForTimeout(80);
check('palier 4 : retour aux intents après clic sur le JSON', await visible('.tool-ack-preview-list'));
check('palier 4 : détail JSON re-caché', !(await visible('.tool-trace-toggle ul')));

// Le compteur externe (<details>) referme sans réinitialiser le choix radio :
// re-fermer puis rouvrir doit garder l'état "intents" (comportement voulu ici,
// puisqu'on vient de re-basculer sur intents au palier 4).
await page2.click('.tool-trace summary'); // referme le <details>
await page2.waitForTimeout(80);
check('fermeture du <details> externe : toggle redevient invisible', !(await visible('.tool-trace-toggle')));
await page2.click('.tool-trace summary'); // rouvre
await page2.waitForTimeout(80);
check('réouverture : état radio conservé (intents, pas JSON)', await visible('.tool-ack-preview-list'));

await browser.close();

let ok = true;
for (const r of results) {
  console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.name + (r.extra ? '  — ' + r.extra : ''));
  if (!r.ok) ok = false;
}
if (errors.length) console.log('Console errors (build):', errors);
if (errors2.length) console.log('Console errors (fichier ouvert):', errors2);
console.log(ok ? '\nOK' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
