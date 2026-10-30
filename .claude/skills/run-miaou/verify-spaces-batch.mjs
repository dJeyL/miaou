#!/usr/bin/env node
// Vérification visuelle Spaces (lot C, un seul lancement) :
//   - sélecteur sidebar (Général + Pro seedés), badge topbar masqué en default,
//   - switch de Space (herméticité sidebar/recherche/outils bidirectionnelle),
//   - création d'un Space → bascule immédiate + écran ouvert (retour utilisateur),
//   - description ajoutée après le prompt système global (jamais substituée),
//   - mémoire scopée + promotion vers profil,
//   - suppression D6 avec cascade et comptes,
//   - inclusion du prompt système utilisateur par Espace : interrupteur figé
//     dans Général, exclusion effective au message système, ligne « exclu »
//     dans l'inspecteur (manifeste d'un envoi antérieur invalidé), mention des
//     Paramètres.
// Usage : node verify-spaces-batch.mjs <dossier-captures> [--headed]
import { launchIsolated } from './stub-backend.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedAll } from './seed-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-spaces');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await launchIsolated({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, name) });
  console.log('  shot  ' + name);
};

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Seed : fixtures du module seed-fixtures.js écrites dans la page dist ──
await seedAll(page);
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForTimeout(400);

// ── 1. Sélecteur sidebar : Général (actif) + Pro seedés ──────────────────────
check('sélecteur : label "Général" au boot (default Space)', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Général'));
await page.click('#space-select-btn');
await page.waitForTimeout(150);
const menuOpts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#space-menu .model-opt .space-opt-name')).map(e => e.textContent));
check('menu : Général + Pro listés', menuOpts.includes('Général') && menuOpts.includes('Pro'));
await shot('01-space-menu.png');

// ── 2. Badge topbar masqué en default Space, sidebar repliée ────────────────
await page.evaluate(() => { document.getElementById('space-menu').classList.remove('show'); toggleSidebar(); });
await page.waitForTimeout(300);
check('badge topbar masqué en default Space (sidebar repliée)', await page.evaluate(() =>
  document.getElementById('topbar-space-badge').hidden === true));
await shot('02-default-space-badge-hidden.png');
await page.evaluate(() => toggleSidebar());
await page.waitForTimeout(300);

// ── 3. Switch vers Pro : herméticité sidebar ─────────────────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .space-opt-name', { hasText: 'Pro' }).click();
await page.waitForTimeout(300);
check('switch : label devient "Pro"', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Pro'));
const proSidebar = await page.evaluate(() => document.querySelectorAll('#conv-list .conv').length);
check('sidebar Pro : seulement 5 conversations (seed-01..05)', proSidebar === 5);
await page.evaluate(() => toggleSidebar());
await page.waitForTimeout(300);
check('badge topbar visible en Space "Pro" (sidebar repliée)', await page.evaluate(() => {
  const b = document.getElementById('topbar-space-badge');
  return b.hidden === false && b.textContent === 'Pro';
}));
await shot('03-pro-space-badge-visible.png');
await page.evaluate(() => toggleSidebar());
await page.waitForTimeout(300);

// ── 4. Herméticité outils modèle (conv__list depuis "Pro") ───────────────────
// Nom canonique depuis le lot P (`list_conversations` → `conv__list`, sous-
// namespaces internes). L'appel sans `ctx` retombe sur les globales d'écran via
// `toolCtx` — c'est ce qu'on veut ici : on teste le Space AFFICHÉ.
const toolList = await page.evaluate(async () =>
  JSON.parse((await callTool('conv__list', {})).content[0].text));
check('conv__list (Pro) : 5 résultats, aucun seed-06+', toolList.length === 5 &&
  toolList.every(e => Number(e.id.replace('seed-', '')) <= 5));

// ── 5. Recherche sidebar hermétique ──────────────────────────────────────────
await page.fill('#conv-search', 'asyncio');   // titre présent seulement dans seed-02 (Pro) — devrait matcher ici
await page.waitForTimeout(150);
const foundInPro = await page.evaluate(() => document.querySelectorAll('#conv-list .conv').length);
check('recherche "asyncio" trouve un résultat dans Pro (seed-02 y appartient)', foundInPro >= 1);
await page.evaluate(() => clearConvSearch());

// ── 6. Retour à Général : conversations Pro invisibles ───────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .space-opt-name', { hasText: 'Général' }).click();
await page.waitForTimeout(300);
const generalSidebar = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#conv-list .conv .conv-title')).map(e => e.textContent));
// Titres EXACTS des 5 conversations Space Pro (seed-01..05) — pas un match flou
// sur un mot qui apparaîtrait aussi dans une conv hors-Space (ex. "Rappel —
// configuration Caddy" est une conv default Space distincte de seed-01).
const proTitles = ["Reverse proxy Caddy et Let's Encrypt", 'Asyncio — event loop bloqué dans FastAPI',
  'Git rebase interactif avant PR', 'Optimisation requête PostgreSQL lente', 'Docker Compose — communication inter-services'];
check('sidebar Général : ne contient aucun des 5 titres exacts du Space Pro',
  !generalSidebar.some(t => proTitles.includes(t)));

// ── 7. Mémoire scopée + promotion ─────────────────────────────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .space-opt-name', { hasText: 'Pro' }).click();
await page.waitForTimeout(300);
await page.click('#space-select-btn');
await page.waitForTimeout(150);
// Général reste toujours en tête du menu (unshift à la migration) : cibler par nom, pas par position.
await page.locator('#space-menu .model-opt', { hasText: 'Pro' }).locator('.space-opt-edit').click();
await page.waitForSelector('#space-drawer.show');
await page.waitForTimeout(350);
// Le drawer d'Espace s'ouvre sur l'onglet « Conversations » (resetSpaceTab) :
// depuis le lot Cbis, les souvenirs vivent derrière l'onglet dédié et ne sont
// rendus qu'à sa sélection (selectSpaceTab → renderMemoryList).
await page.evaluate(() => selectSpaceTab('memories'));
await page.waitForTimeout(250);
const proMemCount = await page.evaluate(() => document.querySelectorAll('#space-memory-list .mem-item').length);
check('écran Space Pro : souvenirs scopés listés (mem-seed-01/02/03)', proMemCount >= 2);
await shot('04-space-screen-pro.png');
const hasPromote = await page.evaluate(() =>
  !!document.querySelector('#space-memory-list .drawer-btn:not(.danger)'));
check('bouton "Promouvoir en profil" présent sur un souvenir Space', hasPromote);

// ── 8. Description ajoutée après le prompt global (jamais substituée) ───────
await page.fill('#space-description-input', 'Contexte de test Playwright pour la description.');
await page.evaluate(() => onSpaceFormInput());
await page.click('#space-save-btn');
await page.waitForTimeout(200);
check('drawer Space fermé après Enregistrer', await page.evaluate(() =>
  !document.getElementById('space-drawer').classList.contains('show')));
const sysMsg = await page.evaluate(() => buildSystemMessage().content);
check('system message contient le prompt global ET la description du Space (concaténés)',
  sysMsg.includes('Contexte de test Playwright pour la description.'));
await shot('05-space-saved-closed.png');

// ── 9. Création d'un Space : bascule immédiate + écran ouvert (retour Julien) ─
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .model-opt.space-new').click();
await page.waitForTimeout(300);
check('création : bascule immédiate (label ≠ Général/Pro)', await page.evaluate(() => {
  const l = document.getElementById('space-select-label').textContent;
  return l !== 'Général' && l !== 'Pro';
}));
check('création : écran Space ouvert directement (pas besoin de rouvrir)', await page.evaluate(() =>
  document.getElementById('space-drawer').classList.contains('show')));
check('création : champ nom focus + contenu sélectionné', await page.evaluate(() => {
  const input = document.getElementById('space-name-input');
  return document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length;
}));
await shot('06-new-space-created-and-open.png');
await page.fill('#space-name-input', 'Test Playwright');
await page.evaluate(() => onSpaceFormInput());
await page.click('#space-save-btn');
await page.waitForTimeout(200);
check('renommage : label sidebar suit le nouveau nom', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Test Playwright'));

// ── 10. Suppression D6 : cascade + comptes, arm-then-run ─────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .model-opt', { hasText: 'Test Playwright' }).locator('.space-opt-edit').click();
await page.waitForSelector('#space-drawer.show');
await page.waitForTimeout(300);
const delLabelBefore = await page.evaluate(() => document.getElementById('space-delete-btn').textContent);
check('bouton suppression affiche les comptes (0 conv., 0 souvenir — Space neuf)', /0 conv\.,\s*0 souvenir/.test(delLabelBefore));
await page.click('#space-delete-btn');
await page.waitForTimeout(100);
check('suppression : armée après 1er clic', await page.evaluate(() =>
  document.getElementById('space-delete-btn').classList.contains('armed')));
await shot('07-space-delete-armed.png');
await page.click('#space-delete-btn');
await page.waitForTimeout(300);
check('suppression : Space disparu, bascule vers Général', await page.evaluate(() =>
  document.getElementById('space-select-label').textContent === 'Général' &&
  !document.getElementById('space-drawer').classList.contains('show')));

// ── 11. Default Space : pas de bouton suppression ────────────────────────────
await page.click('#space-select-btn');
await page.waitForTimeout(150);
await page.locator('#space-menu .model-opt', { hasText: 'Général' }).locator('.space-opt-edit').click();
await page.waitForSelector('#space-drawer.show');
await page.waitForTimeout(300);
check('default Space : bouton suppression absent (hidden)', await page.evaluate(() =>
  document.getElementById('space-delete-btn').hidden === true));
check('default Space : champ nom désactivé', await page.evaluate(() =>
  document.getElementById('space-name-input').disabled === true));
await shot('08-default-space-no-delete.png');

// ── 12. Prompt système utilisateur : inclus par défaut, exclu par Espace ─────
// Général : interrupteur coché ET figé, ligne entière grisée (style calculé,
// pas la seule classe), raison dans le hint.
check('Général : interrupteur prompt utilisateur coché', await page.evaluate(() =>
  document.getElementById('space-user-prompt-input').checked === true));
check('Général : interrupteur figé (disabled)', await page.evaluate(() =>
  document.getElementById('space-user-prompt-input').disabled === true));
check('Général : libellé grisé (opacité calculée < 1)', await page.evaluate(() => {
  const col = document.getElementById('space-user-prompt-input').closest('.check-row').querySelector('.label-col');
  return parseFloat(getComputedStyle(col).opacity) < 1;
}));
check('Général : le hint explique le figement', await page.evaluate(() =>
  document.getElementById('space-user-prompt-hint').textContent.includes('Général')));
// Clic réel sur la colonne de texte : refusé sur une ligne figée.
await page.locator('#space-user-prompt-hint').click();
check('Général : cliquer le libellé ne décoche rien', await page.evaluate(() =>
  document.getElementById('space-user-prompt-input').checked === true));
await page.evaluate(() => closeSpaceScreen());
await page.waitForTimeout(250);

const proId = await page.evaluate(() => loadSpaces().find(s => s.name === 'Pro').id);
await page.evaluate(() => saveSettings(Object.assign({}, loadSettings(), { systemPrompt: 'PROMPT-VERIFY-ESPACE' })));
await page.evaluate((id) => pickSpace(id), proId);
await page.waitForTimeout(400);   // loadSpaceLibrary (async) remet le manifeste à null : le laisser passer
check('prémisse : Pro actif et prompt utilisateur envoyé', await page.evaluate(() =>
  buildSystemMessage().content.includes('PROMPT-VERIFY-ESPACE')));
// Manifeste d'un « envoi » antérieur figé, comme après un vrai envoi : la
// sauvegarde de l'Espace doit l'invalider, sinon l'inspecteur montrerait encore
// le prompt.
await page.evaluate(() => { _lastContextManifest = computeContextManifestNow(); });
check('prémisse : le manifeste figé porte le prompt utilisateur', await page.evaluate(() =>
  _lastContextManifest.entries.some(e => e.source === 'user_prompt' && e.chars > 0)));

await page.evaluate((id) => openSpaceScreen(id), proId);
await page.waitForSelector('#space-drawer.show');
await page.waitForTimeout(300);
check('Pro : interrupteur coché et actif par défaut', await page.evaluate(() => {
  const cb = document.getElementById('space-user-prompt-input');
  return cb.checked === true && cb.disabled === false;
}));
// Aller-retour sur l'interrupteur : revenir à l'état enregistré regrise
// Enregistrer, comme dans les Paramètres.
await page.locator('#space-user-prompt-hint').click();
await page.locator('#space-user-prompt-hint').click();
check('Pro : deux clics sur l\'interrupteur → Enregistrer regrisé', await page.evaluate(() =>
  document.getElementById('space-user-prompt-input').checked === true &&
  document.getElementById('space-save-btn').disabled === true));
await page.locator('#space-user-prompt-hint').click();
check('Pro : clic sur le libellé décoche, Enregistrer activé', await page.evaluate(() =>
  document.getElementById('space-user-prompt-input').checked === false &&
  document.getElementById('space-save-btn').disabled === false));
await page.click('#space-save-btn');
await page.waitForTimeout(200);
check('Pro : exclusion persistée', await page.evaluate((id) => getSpace(id).includeUserPrompt === false, proId));
check('Pro : prompt utilisateur absent du message système', await page.evaluate(() =>
  !buildSystemMessage().content.includes('PROMPT-VERIFY-ESPACE')));
check('Pro : description de l\'Espace toujours présente', await page.evaluate(() =>
  buildSystemMessage().content.includes('Contexte de test Playwright pour la description.')));
await page.evaluate(() => openContextInspector());
await page.waitForTimeout(300);
const ctxRow = await page.evaluate(() => {
  const tr = [...document.querySelectorAll('#ctx-table-body tr')].find(r => r.textContent.includes('Prompt utilisateur'));
  return tr ? { text: tr.textContent, tip: getTip(tr.querySelector('.ctx-label-explained')) || '' } : null;
});
check('inspecteur : ligne « Prompt utilisateur (exclu par l\'Espace) » à 0', !!ctxRow &&
  ctxRow.text.includes('exclu par l\'Espace') && /\)0≈0/.test(ctxRow.text));
check('inspecteur : la tooltip dit que le prompt n\'est pas envoyé', !!ctxRow && ctxRow.tip.includes('pas envoyées'));
await page.evaluate(() => closeContextInspector());
await page.waitForTimeout(250);

await page.evaluate(() => openSettings());
await page.waitForTimeout(300);
check('Paramètres : la mention nomme l\'Espace qui s\'en passe', await page.evaluate(() =>
  document.getElementById('set-system-spaces-hint').textContent.includes('«\u00a0Pro\u00a0»')));
await page.evaluate(() => closeSettings());
await page.waitForTimeout(250);

// Retour : réactiver rend la ligne pleine, la mention revient au cas général.
await page.evaluate((id) => openSpaceScreen(id), proId);
await page.waitForSelector('#space-drawer.show');
await page.waitForTimeout(300);
await page.locator('#space-user-prompt-hint').click();
await page.click('#space-save-btn');
await page.waitForTimeout(200);
check('Pro réactivé : prompt utilisateur de retour, inspecteur sans « exclu »', await page.evaluate(() => {
  const m = effectiveContextManifest();
  return buildSystemMessage().content.includes('PROMPT-VERIFY-ESPACE') &&
    m.entries.some(e => e.source === 'user_prompt' && e.chars > 0) &&
    !m.entries.some(e => e.label.includes('exclu'));
}));
await page.evaluate(() => openSettings());
await page.waitForTimeout(300);
check('Pro réactivé : la mention ne nomme plus d\'Espace', await page.evaluate(() =>
  !document.getElementById('set-system-spaces-hint').textContent.includes('Pro')));

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
