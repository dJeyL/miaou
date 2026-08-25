#!/usr/bin/env node
// Vérification manuelle groupée du flux "déplacer des conversations entre Spaces"
// (brief Cter). Checklist unique, exécutée une fois, sur dist/miaou.html.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = '/Users/julien/llm-playground/miaou';
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = __dirname;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => consoleErrors.push(String(err)));

let step = 0;
function ok(label) { step++; console.log(`  OK  ${step}. ${label}`); }
function fail(label, detail) { step++; console.log(`FAIL  ${step}. ${label}` + (detail ? ` — ${detail}` : '')); process.exitCode = 1; }

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// ── Seed minimal : 2 Spaces, conversations réparties ────────────────────────
await page.evaluate(() => {
  const now = Date.now();
  const convs = [
    { id: 'c-default-1', title: 'Conv default 1', timestamp: now - 1000, updatedAt: now - 1000, messages: [{ role: 'user', content: 'hello', ts: now - 1000 }] },
    { id: 'c-default-2', title: 'Conv default 2', timestamp: now - 2000, updatedAt: now - 2000, messages: [{ role: 'user', content: 'hello 2', ts: now - 2000 }] },
    { id: 'c-default-3', title: 'Conv default 3', timestamp: now - 2500, updatedAt: now - 2500, messages: [{ role: 'user', content: 'hello 3', ts: now - 2500 }] },
    { id: 'c-pro-1', title: 'Conv Pro 1', timestamp: now - 3000, updatedAt: now - 3000, spaceId: 'space-pro', messages: [{ role: 'user', content: 'hello pro', ts: now - 3000 }] },
  ];
  localStorage.setItem('miaou-conversations', JSON.stringify(convs));
  localStorage.setItem('miaou-spaces', JSON.stringify([
    { id: 'space-pro', name: 'Pro', createdAt: now - 10000 },
  ]));
});
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });

// 1. Rien de visible au repos : pas de checkbox, pas de barre.
const checkboxVisibleAtRest = await page.locator('.conv-select').first().isVisible().catch(() => false);
const barVisibleAtRest = await page.locator('#move-bar.show').count();
if (!checkboxVisibleAtRest && barVisibleAtRest === 0) ok('Rien de visible au repos (pas de checkbox, pas de barre)');
else fail('Rien de visible au repos', `checkbox visible=${checkboxVisibleAtRest}, move-bar.show count=${barVisibleAtRest}`);

// 2. Ouvrir le menu Space, vérifier l'item déclencheur présent (2 Spaces => visible).
await page.click('#space-select-btn');
await page.waitForSelector('#space-menu.show', { timeout: 3000 });
const triggerText = await page.locator('.space-move-trigger').count();
if (triggerText === 1) ok('Item "Déplacer des conversations…" présent dans le menu Space (2 Spaces dispo)');
else fail('Item déclencheur absent du menu Space', `count=${triggerText}`);

// 3. Cliquer le déclencheur → mode sélection actif (checkboxes visibles).
await page.click('.space-move-trigger');
await page.waitForTimeout(150);
const selectModeOn = await page.locator('#conv-list.select-mode').count();
if (selectModeOn === 1) ok('Mode sélection activé (#conv-list.select-mode)');
else fail('Mode sélection non activé après clic déclencheur');

const checkboxCountNow = await page.locator('.conv-select').count();
if (checkboxCountNow >= 2) ok(`Checkboxes visibles pour les conversations du Space courant (${checkboxCountNow})`);
else fail('Checkboxes non visibles en mode sélection', `count=${checkboxCountNow}`);

// 4. Cocher 2 conversations (default Space) → barre contextuelle apparaît avec compteur.
const checkboxes = page.locator('.conv-select');
await checkboxes.nth(0).click();
await checkboxes.nth(1).click();
await page.waitForTimeout(150);
const barShown = await page.locator('#move-bar.show').count();
const counterText = await page.locator('.move-bar-count').textContent().catch(() => null);
if (barShown === 1 && counterText && counterText.includes('2')) ok(`Barre contextuelle affichée avec le bon compteur ("${counterText}")`);
else fail('Barre contextuelle absente ou compteur incorrect', `shown=${barShown}, text=${counterText}`);

// 5. Décocher une conv → compteur redescend à 1, barre reste visible.
await checkboxes.nth(1).click();
await page.waitForTimeout(150);
const counterText2 = await page.locator('.move-bar-count').textContent().catch(() => null);
if (counterText2 && counterText2.includes('1')) ok(`Décocher met à jour le compteur ("${counterText2}")`);
else fail('Compteur non mis à jour après décochage', `text=${counterText2}`);

// Recoche pour la suite.
await checkboxes.nth(1).click();
await page.waitForTimeout(150);

// 6. Cliquer une ligne de conversation (pas la checkbox) : doit ouvrir la conv, PAS sortir du mode.
//    On ouvre explicitement "Conv default 3" — elle ne fera partie d'AUCUN des
//    deux lots déplacés ensuite (default-1 au scénario A, default-2 au scénario
//    B), donc son ouverture ne doit jamais déclencher de follow par accident.
await page.click('#conv-list .conv-title:has-text("Conv default 3")');
await page.waitForTimeout(200);
const stillSelectMode = await page.locator('#conv-list.select-mode').count();
if (stillSelectMode === 1) ok('Cliquer une ligne ouvre la conversation sans sortir du mode sélection');
else fail('Le mode sélection a été quitté par un simple clic de ligne (ne devrait pas)');
const openedConvId = await page.evaluate(() => currentConvId);
console.log(`  (info) conversation ouverte après le clic : ${openedConvId}`);

// 7. Cliquer Annuler → sortie du mode, sélection vidée, barre disparue.
await page.click('.move-bar-cancel');
await page.waitForTimeout(150);
const modeOffAfterCancel = await page.locator('#conv-list.select-mode').count();
const barGoneAfterCancel = await page.locator('#move-bar.show').count();
if (modeOffAfterCancel === 0 && barGoneAfterCancel === 0) ok('Annuler sort du mode sélection et masque la barre');
else fail('Annuler n\'a pas correctement réinitialisé l\'état', `select-mode=${modeOffAfterCancel}, bar.show=${barGoneAfterCancel}`);

// 8. Scénario A (PAS de follow) : la conversation ouverte est "Conv Pro 1" (Space
//    Pro, non affichée dans la vue default courante). On déplace c-default-1 (le
//    lot ne contient PAS la conv ouverte) → aucun follow ne doit se produire.
await page.click('#space-select-btn');
await page.waitForSelector('#space-menu.show', { timeout: 3000 });
await page.click('.space-move-trigger');
await page.waitForTimeout(150);
// `enterMoveMode` PRÉ-SÉLECTIONNE la conversation ouverte (ui.js) : entrer en
// mode déplacement met toujours dans le lot ce qu'on regarde. Pour tester
// l'ABSENCE de follow, il faut donc la décocher explicitement — sinon le lot la
// contient et le follow est correct (c'est le scénario B, pas A). Ce script
// datait d'avant cette affordance et supposait une sélection vide à l'entrée.
const preselected = await page.evaluate(() => Array.from(_moveSelection));
if (preselected.length === 1 && preselected[0] === 'c-default-3') {
  ok('enterMoveMode pré-sélectionne la conversation ouverte');
} else {
  fail('Pré-sélection inattendue à l\'entrée du mode', JSON.stringify(preselected));
}
await page.evaluate(() => toggleConvSelection('c-default-3', false));
await page.waitForTimeout(100);
const rowIdBeforeMove = await page.evaluate(() => {
  const ids = Array.from(document.querySelectorAll('#conv-list .conv')).map(el => el.querySelector('.conv-title').textContent);
  return ids;
});
console.log(`  (info) lignes visibles avant sélection : ${JSON.stringify(rowIdBeforeMove)}`);
await page.locator('.conv-select').nth(0).click();   // coche la 1ère ligne (Conv default 1, la plus récente)
await page.waitForTimeout(150);
const selBeforeMove = await page.evaluate(() => Array.from(_moveSelection));
if (selBeforeMove.length === 1 && selBeforeMove[0] === 'c-default-1') {
  ok('Lot du scénario A : uniquement c-default-1 (conv ouverte décochée)');
} else {
  fail('Lot du scénario A incorrect', JSON.stringify(selBeforeMove));
}
const destLabel = await page.locator('.move-bar-row .pill-select-btn span').first().textContent().catch(() => null);
if (destLabel && destLabel.trim() === 'Pro') ok(`Pilule destination pré-remplie avec l'unique autre Space ("${destLabel.trim()}")`);
else fail('Pilule destination incorrecte', `label="${destLabel}"`);

await page.click('.move-bar-go');
await page.waitForTimeout(300);

// 9. Après le move : mode sélection quitté, barre masquée.
const modeOffAfterMove = await page.locator('#conv-list.select-mode').count();
const barGoneAfterMove = await page.locator('#move-bar.show').count();
if (modeOffAfterMove === 0 && barGoneAfterMove === 0) ok('Le déplacement quitte le mode sélection et masque la barre');
else fail('État résiduel après déplacement', `select-mode=${modeOffAfterMove}, bar.show=${barGoneAfterMove}`);

// 10. Vérifier la persistance réelle : la conversation est bien dans space-pro.
// Lecture en IDB depuis le lot U — `miaou-conversations` n'existe plus (le seed
// ci-dessus l'écrit encore, mais la migration U-2 le déplace et purge la clé au
// boot, ce qui exerce au passage ce chemin).
const movedSpaceId = await page.evaluate(async () => {
  const c = await readConversationFromDB('c-default-1');
  return c ? (c.spaceId || null) : null;
});
if (movedSpaceId === 'space-pro') ok('conv.spaceId réécrit en IDB (persistance confirmée)');
else fail('conv.spaceId non réécrit', `spaceId=${movedSpaceId}`);

// 11. Pas de follow attendu (la conv ouverte, Conv Pro 1, n'était pas dans le lot) :
//     le filtre reste sur "Général", la conv déplacée disparaît de cette vue.
const labelAfterA = await page.locator('#space-select-label').textContent().catch(() => null);
const sidebarTitlesA = await page.locator('#conv-list .conv-title').allTextContents();
if (labelAfterA && labelAfterA.trim() === 'Général' && !sidebarTitlesA.includes('Conv default 1')) {
  ok(`Scénario A confirmé : pas de follow (filtre="${labelAfterA.trim()}", titres restants=${JSON.stringify(sidebarTitlesA)})`);
} else {
  fail('Scénario A (pas de follow) incorrect', `filtre="${labelAfterA}", titres=${JSON.stringify(sidebarTitlesA)}`);
}

// 12. Scénario B (follow, D6) : ouvrir "Conv default 2" (reste seule dans le
//     Space default), la sélectionner, la déplacer → la conv ouverte fait
//     partie du lot → la vue doit suivre vers "Pro".
await page.click('#conv-list .conv-title:has-text("Conv default 2")');
await page.waitForTimeout(200);
const openedConvId2 = await page.evaluate(() => currentConvId);
if (openedConvId2 === 'c-default-2') ok('Conversation "Conv default 2" bien ouverte avant le scénario follow');
else fail('Mauvaise conversation ouverte avant le scénario follow', `currentConvId=${openedConvId2}`);

await page.click('#space-select-btn');
await page.waitForSelector('#space-menu.show', { timeout: 3000 });
await page.click('.space-move-trigger');
await page.waitForTimeout(150);
// `enterMoveMode` a déjà pré-sélectionné la conversation ouverte (c-default-2),
// qui est justement le lot voulu ici : re-cliquer sa case la DÉCOCHERAIT, la
// barre disparaîtrait et le scénario ne pourrait pas s'exécuter. On vérifie la
// pré-sélection plutôt que de la refaire.
const selB = await page.evaluate(() => Array.from(_moveSelection));
if (selB.length === 1 && selB[0] === 'c-default-2') {
  ok('Lot du scénario B : la conv ouverte est pré-sélectionnée, rien à cocher');
} else {
  fail('Lot du scénario B incorrect', JSON.stringify(selB));
}
await page.click('.move-bar-go');
await page.waitForTimeout(300);

const followedLabel = await page.locator('#space-select-label').textContent().catch(() => null);
if (followedLabel && followedLabel.trim() === 'Pro') ok(`Follow (D6) confirmé : la vue bascule vers "Pro" car la conv ouverte était dans le lot déplacé`);
else fail('Follow D6 non déclenché', `space-select-label="${followedLabel}"`);

const threadStillVisible = await page.locator('#thread .msg').count();
const stillOpenAfterFollow = await page.evaluate(() => currentConvId);
if (stillOpenAfterFollow === 'c-default-2') ok(`Le fil reste affiché après follow (currentConvId=${stillOpenAfterFollow}, ${threadStillVisible} message(s) visibles)`);
else fail('Le fil a été vidé après follow alors qu\'il aurait dû rester affiché', `currentConvId=${stillOpenAfterFollow}`);

await page.screenshot({ path: path.join(outDir, 'move-conv-final.png') });
await browser.close();

console.log('\n────────────────────────────────────────────');
if (consoleErrors.length) {
  console.log('Erreurs console détectées:', JSON.stringify(consoleErrors, null, 2));
  process.exitCode = 1;
} else {
  console.log('Aucune erreur console.');
}
console.log(process.exitCode ? 'RÉSULTAT : ÉCHECS DÉTECTÉS' : 'RÉSULTAT : TOUT OK');
