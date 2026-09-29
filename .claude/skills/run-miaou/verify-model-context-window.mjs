#!/usr/bin/env node
// Lot AF, étape 3 — fenêtre de contexte par (serveur, modèle). Vérifie ce
// qu'aucun test QuickJS n'atteint : le câblage DOM (fiche serveur, inspecteur,
// pilule) et l'absence d'erreur au démarrage depuis que syncModelUI recalcule
// le compteur.
//
// Checklist :
//   1. aucune erreur console au chargement
//   2. la lecture de /models persiste le maximum déclaré (miaou-model-props)
//   3. la pilule rapporte l'occupation au maximum déclaré (262144), sans saisie
//   4. l'inspecteur nomme la valeur ET la source « maximum déclaré »
//   5. le champ global a disparu des réglages
//   6. panneau de la ligne mA (tableau des modèles de la fiche) : hint
//      « Déclarée par le serveur », champ prérempli de la saisie
//   7. panneau de la ligne mB : hint « ne déclare pas », champ vide
//      (prémisse : celui de mA porte une saisie, sinon « vide » ne prouve rien)
//   7b. un brouillon quitté sans valider (blur, puis re-rendu complet de la
//      liste) n'écrit rien — la fenêtre ne s'applique qu'au bouton ou à Entrée
//   8. saisie validée par Entrée → contextWindows du serveur, source « saisie »
//      à l'inspecteur une fois mB choisi comme défaut
// Depuis le catalogue de modèles, la fenêtre se règle par ligne du tableau de la
// fiche, et non plus dans le formulaire pour le modèle saisi dans `.api-model`.
//   9. une saisie passe devant un maximum déclaré
//  10. une mesure persistée passe devant une saisie
//  11. aucune erreur console sur l'ensemble
//
// Backend stubé au schéma Mistral (max_context_length + objet capabilities) :
// `mA` déclare 262144, `mB` ne déclare rien.
//
// VERIFY_DIST=<chemin> fait tourner le script sur un autre build : c'est ainsi
// qu'on vérifie qu'il passe au ROUGE sur le code d'avant l'étape.
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const browser = await launchIsolated({ headless: !headed }, { serve: false, native: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Racine native d'Ollama (étape 5) : tout serveur en `/v1` reçoit un
// GET /api/tags à chaque chargement de liste. Ce stub n'est pas un Ollama, il
// répond comme la passerelle du boulot — un 404, que le navigateur journalise
// en console : les bilans console l'écartent, et lui seul.
await page.route('**/api/tags', (r) => r.fulfill({
  status: 404, contentType: 'application/json',
  body: JSON.stringify({ error: { message: '404: {"detail":"Not Found"}' } }),
}));
const realErrors = () => consoleErrors.filter(e => !/Failed to load resource.*404/.test(e));

await page.route('**/models', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ object: 'list', data: [
    { id: 'mA', object: 'model', max_context_length: 262144,
      capabilities: { completion_chat: true, function_calling: true, vision: true, reasoning: false } },
    { id: 'mB', object: 'model' },
  ] }),
}));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem('miaou-api-servers', JSON.stringify([
    { id: 'srvA', name: 'Stub', url: 'http://stub.local/v1', key: 'x', model: 'mA' },
  ]));
  localStorage.setItem('miaou-active-api-server', 'srvA');
});
consoleErrors.length = 0;
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
// Fin d'init() : `.boot-done` attendu comme un ÉTAT (cf. SKILL.md) — le
// composer existe bien avant, sous l'overlay.
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail: detail || '' }); };
// Lectures tolérantes à l'absence : sur un build d'avant l'étape, chaque
// contrôle doit rapporter SON échec, pas faire planter le script au premier
// élément manquant (rejeu sur l'ancien code, cf. VERIFY_DIST).
const winLine = () => page.evaluate(() => { const el = $('ctx-window-hint'); return el ? el.textContent : '(absent)'; });
const textOr = (loc) => loc.textContent({ timeout: 2000 }).catch(() => '(absent)');
const valueOr = (loc) => loc.inputValue({ timeout: 2000 }).catch(() => '(absent)');
const NB = ' ';

// ── 1. démarrage propre ──────────────────────────────────────────────────────
check('1. aucune erreur console au chargement', realErrors().length === 0, realErrors().join(' | '));

// ── 2. persistance du maximum déclaré ────────────────────────────────────────
await page.waitForFunction(() => {
  const m = JSON.parse(localStorage.getItem('miaou-model-props') || '{}');
  return m.srvA && m.srvA.models && m.srvA.models.mA;
}, null, { timeout: 5000 }).catch(() => {});
const props = await page.evaluate(() => JSON.parse(localStorage.getItem('miaou-model-props') || '{}'));
const recA = props.srvA && props.srvA.models && props.srvA.models.mA;
check('2. /models persiste contextMax 262144 et la vision de mA',
  !!recA && recA.contextMax === 262144 && recA.caps.vision === true && recA.caps.thinking === false,
  JSON.stringify(recA));

// ── 3. pilule ────────────────────────────────────────────────────────────────
// Le % seul ne prouve rien : un `default_context_window` de config.json en
// afficherait un aussi. On exige celui calculé sur 262144.
const pill = await page.evaluate(() => ({
  label: $('ctx-counter-label').textContent,
  expected: Math.round(effectiveContextManifest().totalTokens / 262144 * 100),
}));
check('3. la pilule rapporte l\'occupation à 262144 sans saisie',
  pill.label.endsWith('(' + pill.expected + '%)'), JSON.stringify(pill));

// ── 4. inspecteur ────────────────────────────────────────────────────────────
await page.evaluate(() => openContextInspector());
const line4 = await winLine();
check('4. inspecteur : valeur et source déclarée',
  line4.includes('262' + NB + '144 tokens') && line4.includes('maximum déclaré par le serveur'), line4);
await page.evaluate(() => closeContextInspector());

// ── 5. champ global retiré ───────────────────────────────────────────────────
const hasGlobal = await page.evaluate(() => !!document.getElementById('set-contextwindow'));
check('5. plus de champ global dans les réglages', !hasGlobal);

// ── 6-8. fiche serveur ───────────────────────────────────────────────────────
// Saisie préalable sur mA : le champ doit la montrer à l'ouverture, et le
// contrôle 7 a alors quelque chose à vider.
await page.evaluate(() => {
  upsertApiServer(Object.assign({}, getApiServer('srvA'), { contextWindows: { mA: 70000 } }));
  openApiServers();
});
const card = page.locator('#api-list .api-card').first();
await card.locator('.api-catalogue-toggle').click();
await card.locator('tr.api-model-row[data-model="mA"]').waitFor();
const panelOf = (m) => card.locator('tr.api-model-detail[data-model="' + m + '"]');
await card.locator('tr.api-model-row[data-model="mA"] .api-model-expand').click();
const h6 = await textOr(panelOf('mA').locator('.api-model-field', { hasText: 'Fenêtre' }).locator('.api-model-hint'));
const v6 = await valueOr(panelOf('mA').locator('.api-model-ctx-input'));
check('6. mA : hint « Déclarée par le serveur », champ prérempli de sa saisie',
  // Insécable devant « : » depuis la reprise typographique des textes affichés :
  // l'attendu à espace simple était rouge depuis, sur le code d'avant aussi.
  h6.includes('Déclarée par le serveur\u00a0: 262' + NB + '144') && v6 === '70000', h6 + ' / valeur=' + v6);

await card.locator('tr.api-model-row[data-model="mB"] .api-model-expand').click();
const h7 = await textOr(panelOf('mB').locator('.api-model-field', { hasText: 'Fenêtre' }).locator('.api-model-hint'));
const v7 = await valueOr(panelOf('mB').locator('.api-model-ctx-input'));
check('7. mB : hint « ne déclare pas », champ vide (celui de mA porte 70000)',
  h7.includes('ne déclare pas') && v7 === '' && v6 === '70000', h7 + ' / valeur=' + v7);

// 7b : brouillon abandonné. Le blur puis un re-rendu complet (celui d'une
// lecture native ou d'un autre onglet) ne doivent rien écrire.
await panelOf('mB').locator('.api-model-ctx-input').fill('1234');
await page.evaluate(() => { document.activeElement.blur(); renderApiServers(); });
const draft7b = await page.evaluate(() => ({
  saved: getApiServer('srvA').contextWindows,
  shown: (document.querySelector('#api-list tr.api-model-detail[data-model="mB"] .api-model-ctx-input') || {}).value,
}));
check('7b. brouillon quitté sans valider : rien d\'écrit, brouillon gardé à l\'écran',
  JSON.stringify(draft7b.saved) === '{"mA":70000}' && draft7b.shown === '1234', JSON.stringify(draft7b));

await panelOf('mB').locator('.api-model-ctx-input').fill('50000');
await panelOf('mB').locator('.api-model-ctx-input').press('Enter');
await card.locator('tr.api-model-row[data-model="mB"] .api-model-default').click();
await page.waitForTimeout(200);
const srv8 = await page.evaluate(() => getApiServer('srvA'));
await page.evaluate(() => { closeApiServers(); openContextInspector(); });
const line8 = await winLine();
check('8. saisie enregistrée pour mB (celle de mA conservée), source « saisie » à l\'inspecteur',
  JSON.stringify(srv8.contextWindows) === '{"mA":70000,"mB":50000}' && srv8.model === 'mB'
    && line8.includes('50' + NB + '000 tokens') && line8.includes('saisie pour ce modèle'),
  JSON.stringify(srv8.contextWindows) + ' / ' + line8);

// ── 9. saisie > maximum déclaré ──────────────────────────────────────────────
const info9 = await page.evaluate(() => {
  const s = getApiServer('srvA');
  upsertApiServer(Object.assign({}, s, { contextWindows: { mA: 100000 } }));
  return typeof contextWindowInfo === 'function' ? contextWindowInfo('mA') : { value: contextWindowFor('mA'), source: '(absent)' };
});
check('9. saisie 100000 devant le maximum déclaré 262144',
  info9.value === 100000 && info9.source === 'user', JSON.stringify(info9));

// ── 10. mesure persistée > saisie ────────────────────────────────────────────
const res10 = await page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem('miaou-model-props'));
  map.srvA.models.mA.served = { value: 32768, at: Date.now() - 2 * 86400000 };
  localStorage.setItem('miaou-model-props', JSON.stringify(map));
  const s = getApiServer('srvA');
  upsertApiServer(Object.assign({}, s, { model: 'mA' }));
  syncModelUI();   // repasse par syncContextCounter, qui re-rend l'inspecteur ouvert
  const el = $('ctx-window-hint');
  const info = typeof contextWindowInfo === 'function' ? contextWindowInfo('mA') : { value: contextWindowFor('mA'), source: '(absent)' };
  return { info, line: el ? el.textContent : '(absent)' };
});
check('10. dernière mesure persistée devant la saisie, et libellée comme telle',
  res10.info.value === 32768 && res10.info.source === 'served-last'
    && res10.line.includes('32' + NB + '768 tokens') && res10.line.includes('dernière mesure'),
  JSON.stringify(res10));

// ── 11. bilan console ────────────────────────────────────────────────────────
check('11. aucune erreur console sur l\'ensemble', realErrors().length === 0, realErrors().join(' | '));

await browser.close();
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail));
}
console.log(fail ? `\n${fail} échec(s)` : '\nTout est vert.');
process.exit(fail ? 1 : 0);
