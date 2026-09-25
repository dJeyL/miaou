#!/usr/bin/env node
// Vérification du scroll conditionnel pendant le streaming (un seul lancement),
// sur le contrat du PLAFOND D'ANCRAGE (2026-09-07, cf. shouldFollowStream) :
//   - en suivant, la vue descend jusqu'au plafond — l'énoncé (dernière bulle
//     user) reste en haut de l'écran — et pas au-delà ;
//   - un lecteur remonté AU-DESSUS de l'énoncé n'est jamais ramené dessus
//     (régression du plafond corrigée le 2026-09-25 : « plafond armé → on
//     suit » sans condition le ramenait à chaque delta) ;
//   - redescendre au fond par un geste lève le plafond : le streaming suit à
//     nouveau le bas (ancrage doux) ;
//   - finalizeAssistant ne force pas le scroll d'un lecteur remonté ;
//   - la redescente à la molette lève le plafond même si une frame de
//     streaming éloigne le fond entre l'événement et son traitement, et un
//     cran vers le bas au fond suffit à lui seul (2026-09-25, cas d'usage réel) ;
//   - un raisonnement déplié qui grandit fait suivre le fil, pas seulement le
//     contenu de la réponse (2026-09-25).
// Ce script assertait avant le plafond « en restant en bas, la vue est au
// fond » : le plafond l'a rendu faux par construction (la vue s'arrête sur
// l'énoncé), d'où l'assertion de confinement qui l'a remplacé.
// Les gestes passent par la MOLETTE (page.mouse.wheel), jamais par une
// affectation de scrollTop : la levée du plafond écoute le geste d'entrée
// (onUserScrollGesture), qu'un scrollTop programmatique n'émet pas. Et
// `currentConvId` est posé : le plafond est clefé par conversation, et une
// levée sur `null` est sans effet.
// Usage : node verify-autoscroll.mjs [--headed]
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await launchIsolated({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });

// Fabrique assez de bulles pour que #messages ait un vrai overflow, puis
// démarre une bulle assistant "en streaming" via l'API interne (startAssistantMessage).
await page.evaluate(() => {
  currentConvId = 'conv-verify-autoscroll';
  for (let i = 0; i < 30; i++) {
    appendUserMessage('Message de remplissage numéro ' + i, Date.now());
  }
  window.__wrap = startAssistantMessage('test-model', undefined);
});

const scrollState = () => page.evaluate(() => {
  const m = document.getElementById('messages');
  const a = autoscrollAnchorEl();
  const anchorTop = a.getBoundingClientRect().top - m.getBoundingClientRect().top;
  return { scrollTop: m.scrollTop, scrollHeight: m.scrollHeight, clientHeight: m.clientHeight,
    atBottom: isAtBottom(), anchorTop };
});
const stream = async (n, label) => {
  for (let i = 0; i < n; i++) {
    text += label + ' ' + i + '.\n\n';
    await page.evaluate((t) => { streamInto(window.__wrap, t); }, text);
    await page.waitForTimeout(110);   // laisse passer le throttle de 90ms
  }
};
const box = await page.evaluate(() => {
  const r = document.getElementById('messages').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
const wheel = async (dy, times) => {
  for (let k = 0; k < times; k++) await page.mouse.wheel(0, dy);
  await page.waitForTimeout(150);   // rAF de onMessagesScroll
};
let text = '';

// ── 1. En bas au démarrage (startAssistantMessage force le scroll) ──────────
let s = await scrollState();
check('après startAssistantMessage : vue en bas', s.atBottom);
const startAnchor = s.anchorTop;

// ── 2. Deltas alors qu'on suit → la vue descend jusqu'au plafond ────────────
await stream(30, 'Ligne de texte générée en streaming numéro');
s = await scrollState();
// Mesuré sur la position de l'ÉNONCÉ et non sur scrollTop : les bulles hors
// écran ne sont pas mises en page (content-visibility), donc scrollTop bouge
// avec les estimations de hauteur sans rien dire du suivi (mesuré : 5753 →
// 5536 sur un suivi correct). Sans suivi, l'énoncé resterait en bas de l'écran.
const padTop = await page.evaluate(() =>
  parseFloat(getComputedStyle(document.getElementById('messages')).paddingTop) || 0);
console.log('    phase 2 : énoncé ' + Math.round(startAnchor) + 'px → ' + Math.round(s.anchorTop)
  + 'px (plafond ' + padTop + 'px), dans [0, ' + s.clientHeight + ')');
check('prémisse : au départ l\'énoncé est loin du plafond', startAnchor > padTop + 50);
check('streaming en suivant : la vue a suivi jusqu\'au plafond (énoncé en haut)',
  Math.abs(s.anchorTop - padTop) <= 24);
check('streaming en suivant : l\'énoncé reste à l\'écran (plafond)',
  s.anchorTop >= 0 && s.anchorTop < s.clientHeight);
check('prémisse : la réponse dépasse l\'écran (le plafond a mordu, vue pas au fond)', !s.atBottom);

// ── 3. L'utilisateur remonte (molette) au-dessus de l'énoncé ────────────────
await wheel(-400, 40);
let beforeTop = (await scrollState()).scrollTop;
check('scroll manuel vers le haut effectif', beforeTop === 0);

await stream(15, 'Nouvelle ligne pendant que l\'utilisateur lit plus haut');
s = await scrollState();
check('streaming pendant lecture en haut : vue NON ramenée sur l\'énoncé (scrollTop toujours ~0)', s.scrollTop < 5);
check('isAtBottom() reflète bien "pas en bas"', !s.atBottom);

// ── 4. L'utilisateur redescend au fond (molette) → plafond levé, on suit ────
// Remonter en bas RÉVÈLE des blocs jusque-là hors écran (content-visibility,
// décoration asynchrone) : scrollHeight grandit ~30ms plus tard sans aucun
// delta. On redescend jusqu'à stabilisation plutôt que d'un trait.
await page.waitForTimeout(150);
for (let k = 0; k < 5; k++) {
  await wheel(800, 20);
  if ((await scrollState()).atBottom) break;
}
s = await scrollState();
check('retour manuel en bas : isAtBottom() redevient true', s.atBottom);
check('le geste de redescente a levé le plafond',
  await page.evaluate(() => scrollCapReleased(currentConvId)));

await stream(10, 'Ligne après réembrayage');
s = await scrollState();
check('après réembrayage, le streaming suit à nouveau le bas', s.atBottom);

// ── 5. finalizeAssistant respecte aussi le comportement conditionnel ────────
await wheel(-400, 40);
await page.evaluate((t) => { finalizeAssistant(window.__wrap, t); }, text);
await page.waitForTimeout(50);
s = await scrollState();
check('finalizeAssistant : ne force pas le scroll si l\'utilisateur avait remonté', s.scrollTop < 5);

// ── 6. Réembrayage à la molette malgré une frame de streaming concurrente ───
// Le cas signalé en usage réel : on redescend au fond à la molette PENDANT que
// la réponse s'écrit, et le plafond ne se lève pas. Une frame rendue entre
// l'événement `scroll` et le rAF de onMessagesScroll éloigne le fond : testé
// dans le rAF, « au fond » est déjà faux. Montage déterministe : un écouteur
// `scroll` posé APRÈS onMessagesScroll (donc exécuté après sa lecture
// synchrone, avant son rAF) fait grandir le fil au moment où la vue touche le
// fond — c'est la frame concurrente. Grandir par un bloc hors bulle plutôt
// que par streamInto : son throttle ne rend pas forcément dans cette fenêtre.
const armAndPark = async (offsetFromBottom) => {
  await page.evaluate((off) => {
    armScrollCap(currentConvId);
    const m = document.getElementById('messages');
    m.scrollTop = m.scrollHeight - m.clientHeight - off;   // programmatique : aucune intention
  }, offsetFromBottom);
  await page.waitForTimeout(800);   // fenêtre d'intention des gestes précédents expirée
};
await armAndPark(120);
check('prémisse 6a : plafond réarmé, vue près du fond sans y être',
  await page.evaluate(() => !scrollCapReleased(currentConvId) && !isAtBottom()));
await page.evaluate(() => {
  const m = document.getElementById('messages');
  const grow = () => {
    if (!isAtBottom()) return;
    m.removeEventListener('scroll', grow);
    const pad = document.createElement('div');
    pad.id = 'verify-race-pad';
    pad.style.height = '400px';
    document.getElementById('thread').appendChild(pad);
    window.__raceGrown = true;
  };
  m.addEventListener('scroll', grow, { passive: true });
});
await page.mouse.wheel(0, 300);
await page.waitForTimeout(300);
check('prémisse 6a : la frame concurrente a bien eu lieu au fond',
  await page.evaluate(() => window.__raceGrown === true && !isAtBottom()));
check('6a : atteindre le fond à la molette lève le plafond malgré la frame concurrente',
  await page.evaluate(() => scrollCapReleased(currentConvId)));

// 6b. Insister : au fond, un cran de molette vers le bas n'émet aucun
// `scroll` (la position ne peut plus changer). Il doit lever le plafond à lui
// seul — c'est le geste qu'on fait quand la levée a manqué.
await page.evaluate(() => { document.getElementById('verify-race-pad').remove(); });
await armAndPark(0);
check('prémisse 6b : plafond réarmé, vue au fond',
  await page.evaluate(() => !scrollCapReleased(currentConvId) && isAtBottom()));
await page.evaluate(() => {
  window.__scrollEvents = 0;
  document.getElementById('messages').addEventListener('scroll', () => { window.__scrollEvents++; }, { passive: true });
});
await page.mouse.wheel(0, 300);
await page.waitForTimeout(300);
check('prémisse 6b : le cran au fond n\'a émis aucun scroll',
  await page.evaluate(() => window.__scrollEvents === 0));
check('6b : un cran de molette vers le bas au fond lève le plafond',
  await page.evaluate(() => scrollCapReleased(currentConvId)));

// ── 7. Le raisonnement qui grandit fait suivre le fil ──────────────────────
// Déplié, le bloc de raisonnement grandit jusqu'à sa hauteur max avant de
// défiler en interne ; cette croissance repousse le fond du FIL. Seuls les
// deltas de contenu faisaient défiler le fil : pendant toute la phase de
// raisonnement, une vue au fond y restait plantée. On reste SOUS la hauteur
// max (sinon le fil ne grandit plus et le cas disparaît), et on écrit par
// flushReasoning, synchrone, pour ne pas dépendre du throttle de setReasoning.
const reasoningState = () => page.evaluate(() => {
  const c = window.__wrap2.querySelector('.reasoning-content');
  return { atBottom: isAtBottom(), scrollHeight: document.getElementById('messages').scrollHeight,
    innerScrolls: c.scrollHeight > c.clientHeight + 1 };
});
await page.evaluate(() => {
  window.__wrap2 = startAssistantMessage('test-model', undefined);
  flushReasoning(window.__wrap2, 'Raisonnement ligne 0');
  toggleReasoning(window.__wrap2.querySelector('.reasoning-toggle'));
  releaseScrollCap(currentConvId);
  const m = document.getElementById('messages');
  m.scrollTop = m.scrollHeight;
});
await page.waitForTimeout(150);
const r0 = await reasoningState();
check('prémisse 7 : raisonnement déplié, vue au fond', r0.atBottom &&
  await page.evaluate(() => !window.__wrap2.querySelector('.reasoning').hasAttribute('hidden')));
let reasoning = 'Raisonnement ligne 0';
for (let i = 1; i <= 12; i++) {
  reasoning += '\nRaisonnement ligne ' + i;
  await page.evaluate((t) => { flushReasoning(window.__wrap2, t); }, reasoning);
  await page.waitForTimeout(40);
}
const r1 = await reasoningState();
console.log('    phase 7 : fil ' + r0.scrollHeight + 'px → ' + r1.scrollHeight + 'px');
check('prémisse 7 : le bloc a grandi sans atteindre sa hauteur max (le fil a grandi, pas de défilement interne)',
  r1.scrollHeight - r0.scrollHeight > 100 && !r1.innerScrolls);
check('7 : le raisonnement qui grandit fait suivre le fil', r1.atBottom);

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
