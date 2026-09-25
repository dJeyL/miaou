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
//   - finalizeAssistant ne force pas le scroll d'un lecteur remonté.
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
