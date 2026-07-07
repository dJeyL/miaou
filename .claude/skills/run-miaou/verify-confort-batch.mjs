#!/usr/bin/env node
// Vérification du lot « confort conversation » (un seul lancement) :
//   A. boutons copier (bulle user empilé sous éditer, bulle assistant dans les
//      actions méta) + feedback check + littéral displayText d'une slash-skill,
//   B. bouton régénérer visible sur la SEULE dernière bulle assistant,
//   C. bandeau « Réponse incomplète » + bouton Continuer (seed-21, actif car
//      dernière bulle) — la continuation streamée elle-même reste manuelle,
//   D. recherche plein texte (« ornithorynque » dans un message seed-08),
//      seuil 3 caractères, restauration de la liste,
//   E. export JSON complet (format, 7 clés, IDB) + rejet d'un fichier invalide
//      + récapitulatif d'import avec bouton arm-then-confirm (non confirmé).
// Le presse-papier est stubbé (file:// + headless : l'API clipboard réelle est
// capricieuse) : on vérifie NOTRE chemin copyMsg → writeText → feedback.
// Usage : node verify-confort-batch.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const seedPath = path.join(repoRoot, 'tests/dev-seed.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-confort');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};
// Stub presse-papier : capture le dernier texte écrit dans window.__copied.
await page.addInitScript(() => {
  window.__copied = null;
  const stub = { writeText: (t) => { window.__copied = t; return Promise.resolve(); } };
  try { Object.defineProperty(navigator, 'clipboard', { value: stub, configurable: true }); }
  catch (e) { navigator.clipboard.writeText = stub.writeText; }
});

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
await page.waitForTimeout(400);   // loadSkillsCache + rendus initiaux

// 23 conversations seedées au total (seed-01..seed-21, dont seed-10b/seed-10c) ;
// seed-01..05 portent spaceId=space-seed-pro (lot C, herméticité Spaces) et
// sont donc absentes de la sidebar/liste par défaut (Space "default" actif) —
// deux compteurs distincts : la vue filtrée (sidebar) vs le brut (export/import,
// non filtré par Space, cf. validateImportPayload/storage.js).
const CONV_COUNT_SIDEBAR = 18;
const CONV_COUNT_TOTAL = 23;

// ── A. Boutons copier ────────────────────────────────────────────────────────
await page.click('.conv-title:text("Cron — syntaxe et debugging")');
await page.waitForTimeout(300);

// bulle user : boutons côte à côte dans .msg-user-actions (même top, éditer
// à gauche puis copier — cf. commentaire chat.css "édition à gauche du
// groupe, copie ensuite, horodatage en dernier")
const sideBySide = await page.evaluate(() => {
  const edit = document.querySelector('#thread .msg.user .msg-edit');
  const copy = document.querySelector('#thread .msg.user .msg-copy-user');
  if (!edit || !copy) return null;
  const e = edit.getBoundingClientRect(), c = copy.getBoundingClientRect();
  return { sameRow: Math.abs(e.top - c.top) < 2, copyAfterEdit: c.left > e.left };
});
check('A : bouton copier user présent, à côté d\'éditer (même ligne)', !!sideBySide && sideBySide.sameRow && sideBySide.copyAfterEdit);

// copie user : texte du thread, feedback check
await page.locator('#thread .msg.user').first().hover();
await page.locator('#thread .msg.user .msg-copy-user').first().click();
await page.waitForTimeout(100);
const userCopy = await page.evaluate(() => ({
  copied: window.__copied,
  checked: !!document.querySelector('#thread .msg-copy-user.msg-copy--checked'),
}));
check('A : copie user = contenu du message', (userCopy.copied || '').startsWith('Mon cron job'));
check('A : feedback check posé (user)', userCopy.checked);
await shot('01-copy-user-checked.png');
await page.waitForTimeout(1500);
check('A : feedback check retiré après ~1,4 s', await page.evaluate(() =>
  !document.querySelector('#thread .msg-copy--checked')));

// copie assistant : dataset.raw, pas d'en-tête ni de trace d'acks
await page.locator('#thread .msg.assistant .msg-copy').last().click();
await page.waitForTimeout(100);
const asstCopy = await page.evaluate(() => {
  const body = Array.from(document.querySelectorAll('#thread .msg.assistant .body')).pop();
  return { copied: window.__copied, raw: body ? body.dataset.raw : null };
});
check('A : copie assistant = body.dataset.raw', !!asstCopy.raw && asstCopy.copied === asstCopy.raw);
check('A : la copie contient le mot distinctif du seed', (asstCopy.copied || '').includes('ornithorynque'));

// slash-skill : la copie du message user rend le LITTÉRAL, pas le corps baké
await page.click('.conv-title:text("Slash-skill : revue de code")');
await page.waitForTimeout(300);
await page.locator('#thread .msg.user').first().hover();
await page.locator('#thread .msg.user .msg-copy-user').first().click();
await page.waitForTimeout(100);
const skillCopy = await page.evaluate(() => window.__copied || '');
check('A : copie slash-skill = littéral /revue…', skillCopy.startsWith('/revue'));
check('A : corps de skill absent de la copie', !skillCopy.includes('--- skill:'));

// ── B. Régénérer : visible sur la SEULE dernière bulle assistant ────────────
await page.click('.conv-title:text("Cron — syntaxe et debugging")');
await page.waitForTimeout(300);
const regen = await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('#thread .msg.assistant .msg-regen'));
  return {
    total: btns.length,
    visible: btns.filter(b => !b.hidden).length,
    lastVisible: btns.length > 0 && !btns[btns.length - 1].hidden,
  };
});
check('B : conversation à ≥2 bulles assistant', regen.total >= 2);
check('B : bouton régénérer visible UNIQUEMENT sur la dernière', regen.visible === 1 && regen.lastVisible);
await shot('02-regen-last-only.png');

// ── C. Bandeau « Réponse incomplète » (seed-21) ──────────────────────────────
await page.click('.conv-title:text("Migration Kubernetes — troncature")');
await page.waitForTimeout(300);
const trunc = await page.evaluate(() => {
  const banner = document.querySelector('#thread .msg.assistant .msg-truncated');
  const btn = banner && banner.querySelector('.msg-continue');
  const body = document.querySelector('#thread .msg.assistant .body');
  return {
    present: !!banner,
    text: banner ? banner.querySelector('.msg-truncated-text').textContent : '',
    btnEnabled: !!btn && !btn.disabled,
    afterBody: !!banner && !!body && !!(body.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING),
  };
});
check('C : bandeau présent après .body', trunc.present && trunc.afterBody);
check('C : texte « Réponse incomplète »', trunc.text === 'Réponse incomplète');
check('C : bouton Continuer actif (dernière bulle)', trunc.btnEnabled);
await shot('03-truncated-banner.png');

// ── D. Recherche plein texte ─────────────────────────────────────────────────
const searchResults = async (q) => {
  await page.fill('#conv-search', q);
  await page.evaluate(() => onConvSearch());
  await page.waitForTimeout(150);
  return page.evaluate(() => Array.from(document.querySelectorAll('#conv-list .conv-title')).map(t => t.textContent));
};
const r1 = await searchResults('ornithorynque');
check('D : « ornithorynque » (contenu seul) → 1 résultat, la conv Cron', r1.length === 1 && r1[0].includes('Cron'));
const r2 = await searchResults('orn');
check('D : 3 caractères suffisent (scan contenu actif)', r2.some(t => t.includes('Cron')));
const r3 = await searchResults('or');
check('D : 2 caractères → pas de scan contenu (Cron absente)', !r3.some(t => t.includes('Cron')));
await shot('04-search-fulltext.png');
await page.evaluate(() => clearConvSearch());
await page.waitForTimeout(150);
check('D : liste restaurée après effacement', await page.evaluate(() =>
  document.querySelectorAll('#conv-list .conv').length) === CONV_COUNT_SIDEBAR);

// ── E. Export / import ───────────────────────────────────────────────────────
await page.evaluate(() => openSettings());
await page.waitForSelector('#drawer.show');
// ouvre la catégorie « Données »
await page.locator('.set-cat-head:has-text("Données")').click();
await page.waitForTimeout(350);
await shot('05-donnees-category.png');

// export : capture du téléchargement, validation du payload
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.locator('button:text("Exporter les données")').click(),
]);
const exportPath = path.join(outDir, download.suggestedFilename());
await download.saveAs(exportPath);
let payload = null;
try { payload = JSON.parse(fs.readFileSync(exportPath, 'utf8')); } catch (e) { /* payload reste null */ }
const EXPORT_KEYS = ['miaou-settings', 'miaou-conversations', 'miaou-summaries', 'miaou-memories',
  'miaou-api-servers', 'miaou-active-api-server', 'miaou-mcp-servers'];
check('E : nom de fichier miaou-export-….json', /^miaou-export-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(download.suggestedFilename()));
check('E : payload JSON valide, format/version', !!payload && payload.format === 'miaou-export' && payload.version === 1);
check('E : les 7 clés localStorage présentes', !!payload && EXPORT_KEYS.every(k => k in payload.localStorage));
check('E : conversations exportées au complet', !!payload && payload.localStorage['miaou-conversations'].length === CONV_COUNT_TOTAL);
check('E : skills IDB embarquées (2 seedées)', !!payload && payload.idb.skills.length === 2);

// import invalide : erreur inline, pas de récapitulatif
await page.setInputFiles('#import-data-input', {
  name: 'invalide.json', mimeType: 'application/json',
  buffer: Buffer.from('{"format":"autre-chose"}'),
});
await page.waitForTimeout(200);
const bad = await page.evaluate(() => ({
  err: !document.getElementById('import-data-err').hidden,
  errText: document.getElementById('import-data-err').textContent,
  sum: document.getElementById('import-data-summary').hidden,
}));
check('E : fichier invalide → erreur inline, pas de récapitulatif', bad.err && bad.errText.includes('Format inconnu') && bad.sum);
await shot('06-import-invalid.png');

// import valide (le fichier exporté) : récapitulatif + bouton armé au 1er clic,
// PAS de confirmation (le remplacement + reload reste un test manuel)
await page.setInputFiles('#import-data-input', exportPath);
await page.waitForTimeout(200);
const good = await page.evaluate(() => ({
  errHidden: document.getElementById('import-data-err').hidden,
  sumVisible: !document.getElementById('import-data-summary').hidden,
  sumText: document.getElementById('import-data-summary').textContent,
}));
check('E : fichier valide → récapitulatif affiché, erreur levée', good.errHidden && good.sumVisible);
check('E : compteurs cohérents dans le récapitulatif', good.sumText.includes(CONV_COUNT_TOTAL + ' conversation'));
await page.locator('#import-data-summary button').click();
await page.waitForTimeout(150);
check('E : bouton d\'application armé au 1er clic (« Confirmer le remplacement »)', await page.evaluate(() => {
  const b = document.querySelector('#import-data-summary button');
  return b && b.classList.contains('armed') && b.textContent === 'Confirmer le remplacement';
}));
await shot('07-import-armed.png');
await page.waitForTimeout(3000);   // désarmement — on ne confirme PAS
check('E : désarmé après timeout, rien appliqué (pas de reload)', await page.evaluate(() => {
  const b = document.querySelector('#import-data-summary button');
  return b && !b.classList.contains('armed') &&
    document.querySelectorAll('#conv-list .conv').length > 0;
}));

await browser.close();

console.log('');
if (consoleErrors.length) {
  console.log('Console errors:', JSON.stringify(consoleErrors, null, 2));
  failures.push('console errors');
} else {
  console.log('No console errors.');
}
console.log(failures.length ? `ÉCHEC — ${failures.length} vérification(s) : ${failures.join(' | ')}` : 'OK — toutes les vérifications passent');
process.exitCode = failures.length ? 1 : 0;
