// Vérifie le rollback d'un Space créé puis abandonné sans enregistrement
// (createSpaceAndOpen → closeSpaceScreen), et les cas où il ne doit PAS jouer.
// Zone non couverte par QuickJS : globals UI + DOM + localStorage.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const appUrl = 'file://' + path.resolve(dir, '../../../dist/miaou.html');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(appUrl);
await page.waitForFunction(() => typeof createSpaceAndOpen === 'function');

const results = [];
const check = (n, ok) => results.push({ n, ok });

// Base de départ : nombre de Spaces et Space actif.
const before = await page.evaluate(() => ({ n: loadSpaces().length, active: activeSpaceId }));

// ── 1. Création puis abandon (Escape) → le Space disparaît ────────────────────
const cancelled = await page.evaluate(() => {
  createSpaceAndOpen();
  const created = activeSpaceId;
  const openCount = loadSpaces().length;
  closeSpaceScreen();                       // = Escape / backdrop / croix
  return { created, openCount, after: loadSpaces().length, active: activeSpaceId,
           stillThere: !!getSpace(created) };
});
check('création → Space persisté et actif pendant l\'édition', cancelled.openCount === before.n + 1);
check('abandon → Space supprimé du store', cancelled.after === before.n);
check('abandon → getSpace(id) ne le trouve plus', !cancelled.stillThere);
check('abandon → retour au Space précédent (pas au défaut en dur)', cancelled.active === before.active);

// ── 2. Création puis enregistrement → le Space reste ──────────────────────────
const saved = await page.evaluate(() => {
  createSpaceAndOpen();
  const created = activeSpaceId;
  document.getElementById('space-name-input').value = 'Espace réel';
  onSaveSpaceScreen();                      // consomme le brouillon + ferme
  return { created, after: loadSpaces().length, stillThere: !!getSpace(created),
           name: (getSpace(created) || {}).name };
});
check('enregistrement → Space conservé', saved.stillThere);
check('enregistrement → nom saisi persisté', saved.name === 'Espace réel');
check('enregistrement → pas de rollback au close', saved.after === before.n + 1);

// ── 3. Réouverture d'un Space DÉJÀ enregistré puis Escape → rien ne disparaît ─
// (le cas qui casserait si le drapeau n'était pas consommé au save)
const reopened = await page.evaluate((id) => {
  openSpaceScreen(id);
  closeSpaceScreen();
  return { stillThere: !!getSpace(id), n: loadSpaces().length };
}, saved.created);
check('réouverture + Escape → Space enregistré INTACT', reopened.stillThere);
check('réouverture + Escape → aucun autre Space supprimé', reopened.n === before.n + 1);

// ── 4. Deux brouillons successifs abandonnés → aucun résidu ───────────────────
const twice = await page.evaluate(() => {
  createSpaceAndOpen(); closeSpaceScreen();
  createSpaceAndOpen(); closeSpaceScreen();
  return { n: loadSpaces().length, ghosts: loadSpaces().filter(s => s.name === 'Nouvel espace').length };
});
check('deux abandons → aucun Space résiduel', twice.n === before.n + 1);
check('aucun « Nouvel espace » fantôme dans le store', twice.ghosts === 0);

await browser.close();
let ok = true;
for (const r of results) { console.log((r.ok ? 'PASS  ' : 'FAIL  ') + r.n); if (!r.ok) ok = false; }
console.log(ok ? '\nOK' : '\nÉCHEC');
process.exit(ok ? 0 : 1);
