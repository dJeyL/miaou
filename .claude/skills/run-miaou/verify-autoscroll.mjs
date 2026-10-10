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
//     contenu de la réponse (2026-09-25) ;
//   - section 8, réglage « Garder le message envoyé en haut » (2026-10-07) :
//     bulle menée en haut dès l'envoi par une descente animée, vue immobile
//     pendant le streaming, bouton au
//     dépassement, fond fabriqué par l'espace qui ne lève pas le plafond,
//     espace qui survit à une réponse courte, interjection sans saut,
//     réglage décoché = comportement d'avant. 8g (2026-10-11) : bouton et
//     pulsation suivent la fin du CONTENU à l'écran, pas le fond fabriqué.
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

// ── 8. Bulle envoyée gardée en haut (réglage pinSentMessage, défaut actif) ──
// Les sections 1-7 appellent appendUserMessage/startAssistantMessage
// directement : elles ne passent jamais par runGenerationFromCurrentThread,
// seul point où l'espace de la bulle envoyée est posé, et décrivent donc le
// comportement réglage DÉCOCHÉ. Celle-ci passe par le VRAI envoi (composer +
// onSendBtn) sur un flux SSE dont le script tient chaque chunk : le défilement
// se mesure pendant que la réponse grandit, pas sur une réponse livrée d'un
// bloc (le flux servi par stub-backend arrive en une fois, d'où `serve: false`).
// Comme en phase 2, la stabilité de la vue se lit sur la position de la BULLE,
// jamais sur scrollTop (content-visibility des bulles hors écran).
const browser2 = await launchIsolated({ headless: !headed }, { serve: false });
// Plus haut que la page 1 : en 8d, l'espace doit encore absorber l'interjection ET un chunk.
const page2 = await browser2.newPage({ viewport: { width: 900, height: 800 } });
page2.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page2.on('pageerror', (e) => consoleErrors.push(String(e)));
await page2.addInitScript(() => {
  const realFetch = window.fetch.bind(window);
  const enc = new TextEncoder();
  window.__streamsOpened = 0;
  window.__streamOpen = false;
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('http://stub.local/') !== 0) return realFetch(input, opts);
    const json = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (/\/v1\/models$/.test(url)) return json({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] });
    if (!/\/chat\/completions$/.test(url)) return realFetch(input, opts);
    let body = {};
    try { body = JSON.parse((opts && opts.body) || '{}'); } catch (e) { /* illisible */ }
    // Titrage et résumés : hors flux, réponse immédiate.
    if (!body.stream) return json({ choices: [{ message: { role: 'assistant', content: 'Titre' }, finish_reason: 'stop' }] });
    window.__streamsOpened++;
    const rs = new ReadableStream({ start(ctrl) {
      const send = (o) => ctrl.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));
      window.__push = (t) => send({ choices: [{ delta: { content: t } }] });
      window.__end = () => {
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
        ctrl.close();
        window.__streamOpen = false;
      };
      window.__streamOpen = true;
    } });
    return new Response(rs, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
});
await page2.goto('file://' + distPath);
await page2.waitForSelector('#composer-text', { timeout: 10000 });
await page2.waitForFunction(() => document.querySelector('.boot-done') !== null, { timeout: 10000 });

// Historique assez long pour que la bulle envoyée naisse loin sous le haut.
await page2.evaluate(async () => {
  const messages = [];
  for (let i = 0; i < 15; i++) {
    messages.push({ role: 'user', content: 'Question d\'historique ' + i, ts: Date.now() });
    messages.push({ role: 'assistant', content: 'Réponse d\'historique ' + i + '.\n\nDeuxième paragraphe.', ts: Date.now() });
  }
  await saveConversation({ id: 'conv-verify-pin', title: 'Pin', timestamp: Date.now(), messages, spaceId: activeSpaceId });
  await openConversation('conv-verify-pin', true);
});
await page2.waitForFunction(() => document.querySelectorAll('#thread .msg.user').length === 15);
await page2.waitForTimeout(1000);   // stabilisation du rendu initial (THREAD_SETTLE_MS)

const pin = () => page2.evaluate(() => {
  const m = document.getElementById('messages');
  const users = document.querySelectorAll('#thread .msg.user');
  const sent = users[window.__sentOrdinal != null ? window.__sentOrdinal : users.length - 1];
  const btn = document.getElementById('scroll-bottom-btn');
  return {
    bubbleTop: sent.getBoundingClientRect().top - m.getBoundingClientRect().top,
    padTop: parseFloat(getComputedStyle(m).paddingTop) || 0,
    clientHeight: m.clientHeight,
    spacer: parseFloat(document.getElementById('thread-tail-space').style.height) || 0,
    atBottom: isAtBottom(),
    btnShown: !btn.hidden && btn.getClientRects().length > 0,
    released: scrollCapReleased(currentConvId),
  };
});
const send2 = async (text) => {
  const opened = await page2.evaluate(() => window.__streamsOpened);
  await page2.fill('#composer-text', text);
  await page2.evaluate(() => onSendBtn());
  await page2.waitForFunction((n) => window.__streamsOpened > n && window.__streamOpen, opened);
  await page2.evaluate(() => { window.__sentOrdinal = document.querySelectorAll('#thread .msg.user').length - 1; });
  await page2.waitForTimeout(350);   // animation d'entrée des bulles (rise, translateY 6px, 260ms)
};
const push2 = async (t) => {
  await page2.evaluate((x) => window.__push(x), t);
  await page2.waitForTimeout(120);   // throttle de rendu du streaming (90ms)
};
const end2 = async () => {
  await page2.evaluate(() => window.__end());
  await page2.waitForFunction(() => !window.__streamOpen && !isGenerating(currentConvId));
  await page2.waitForTimeout(200);
};
const wheel2 = async (dy, times) => {
  const b = await page2.evaluate(() => {
    const r = document.getElementById('messages').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page2.mouse.move(b.x, b.y);
  for (let k = 0; k < times; k++) await page2.mouse.wheel(0, dy);
  await page2.waitForTimeout(200);   // rAF de onMessagesScroll
};
const atTop = (p) => Math.abs(p.bubbleTop - p.padTop) <= 24;
// Fait grandir la réponse jusqu'à ce qu'elle dépasse l'écran, en relevant à
// chaque chunk l'écart MAX de la bulle à sa position initiale et si le bouton
// s'est montré tant que l'espace n'était pas résorbé.
const growPastScreen = async (label) => {
  const p0 = await pin();
  let maxDrift = 0, btnWhileSpacer = false, i = 0, p = p0;
  for (; i < 60 && !(p.spacer === 0 && !p.atBottom); i++) {
    await push2(label + ' ' + i + ', une ligne de réponse qui s\'allonge.\n\n');
    p = await pin();
    maxDrift = Math.max(maxDrift, Math.abs(p.bubbleTop - p0.bubbleTop));
    if (p.spacer > 0 && p.btnShown) btnWhileSpacer = true;
  }
  for (let k = 0; k < 4; k++) await push2(label + ' suite ' + k + '.\n\n');   // nettement au-delà
  p = await pin();
  maxDrift = Math.max(maxDrift, Math.abs(p.bubbleTop - p0.bubbleTop));
  console.log('    ' + label + ' : ' + i + ' chunks, bulle ' + Math.round(p0.bubbleTop) + 'px → '
    + Math.round(p.bubbleTop) + 'px (écart max ' + Math.round(maxDrift) + 'px), espace ' + p0.spacer + 'px → ' + p.spacer + 'px');
  return { p0, p, maxDrift, btnWhileSpacer };
};

check('8 prémisse : réglage actif par défaut', await page2.evaluate(() =>
  loadSettings().pinSentMessage !== false && document.getElementById('set-pin-sent-message').checked));

// 8a. Envoi nominal : bulle menée en haut par une descente animée, vue
// immobile ensuite, bouton au dépassement. La descente se lit sur un
// échantillonnage par frame de la bulle envoyée (dernière .msg.user une fois
// le compte augmenté) : un saut sec ne laisse aucune position intermédiaire.
await page2.evaluate(() => {
  const m = document.getElementById('messages');
  const n0 = document.querySelectorAll('#thread .msg.user').length;
  window.__frames = [];
  const t0 = performance.now();
  const tick = () => {
    const users = document.querySelectorAll('#thread .msg.user');
    if (users.length > n0) window.__frames.push(users[users.length - 1].getBoundingClientRect().top - m.getBoundingClientRect().top);
    if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await send2('Question épinglée');
let p8 = await pin();
const frames = await page2.evaluate(() => window.__frames);
const between = frames.filter(y => y < frames[0] - 10 && y > p8.bubbleTop + 10).length;
console.log('    8a descente : ' + Math.round(frames[0]) + 'px → ' + Math.round(p8.bubbleTop) + 'px, ' + between + ' frame(s) intermédiaire(s)');
check('8a prémisse : la bulle est née loin sous le plafond', frames[0] > p8.padTop + 100);
check('8a : la bulle est menée en haut par une descente animée (positions intermédiaires)', between >= 3);
console.log('    8a à l\'envoi : bulle à ' + Math.round(p8.bubbleTop) + 'px (plafond ' + p8.padTop + 'px), espace ' + p8.spacer + 'px');
check('8a : la bulle envoyée est en haut de l\'écran dès l\'envoi', atTop(p8));
check('8a : un espace vide la porte (sans lui le navigateur bornerait le défilement)', p8.spacer > 0);
check('8a : pas de bouton « aller tout en bas » tant que la réponse tient', !p8.btnShown);
let g = await growPastScreen('8a');
check('8a prémisse : la réponse a dépassé l\'écran (espace résorbé, vue plus au fond)', g.p.spacer === 0 && !g.p.atBottom);
check('8a : la vue n\'a pas bougé pendant le streaming (bulle immobile à 4px près)', g.maxDrift <= 4);
check('8a : la bulle est toujours en haut, dans [0, clientHeight)', atTop(g.p) && g.p.bubbleTop >= 0 && g.p.bubbleTop < g.p.clientHeight);
check('8a : le bouton n\'est jamais apparu tant que l\'espace restait', !g.btnWhileSpacer);
check('8a : le bouton apparaît quand la réponse dépasse l\'écran', g.p.btnShown);
await end2();

// 8b. Le cas signalé : remonter puis redescendre au fond AVANT la réponse.
// Le fond étant fabriqué par l'espace, y revenir ne doit pas lever le plafond,
// sans quoi la réponse arrivée en bas d'écran pousse la bulle dehors.
await send2('Question où je remonte puis redescends');
await wheel2(-300, 6);
check('8b prémisse : la vue a bien été remontée', !atTop(await pin()));
for (let k = 0; k < 5 && !(await pin()).atBottom; k++) await wheel2(600, 6);
p8 = await pin();
check('8b prémisse : redescendue au fond, la vue est revenue sur la bulle, espace présent', p8.atBottom && atTop(p8) && p8.spacer > 0);
check('8b : redescendre sur un fond fabriqué ne lève pas le plafond', !p8.released);
await wheel2(300, 2);   // insister au fond : aucun scroll émis, levée par geste
check('8b : insister à la molette sur ce fond ne le lève pas non plus', !(await pin()).released);
g = await growPastScreen('8b');
check('8b prémisse : la réponse a dépassé l\'écran', g.p.spacer === 0 && !g.p.atBottom);
check('8b : la bulle reste en haut quand la réponse dépasse l\'écran', atTop(g.p));
// Une fois l'espace résorbé, le fond redevient réel : y descendre lève à
// nouveau le plafond (ancrage doux inchangé).
for (let k = 0; k < 5 && !(await pin()).atBottom; k++) await wheel2(600, 6);
check('8b : espace résorbé, redescendre au fond lève le plafond comme avant', (await pin()).released);
await end2();

// 8c. Réponse courte : l'espace SURVIT à la fin de la génération (le retirer
// ferait redescendre la vue d'un coup).
await send2('Question à réponse courte');
await push2('Réponse brève.');
await end2();
p8 = await pin();
console.log('    8c : après la fin, bulle à ' + Math.round(p8.bubbleTop) + 'px, espace ' + p8.spacer + 'px');
check('8c : après une réponse courte, l\'espace reste et la bulle avec lui en haut', p8.spacer > 0 && atTop(p8));

// 8d. Une interjection pendant la génération ne fait pas sauter la vue : l'ancre
// de l'espace est la bulle désignée à l'envoi, pas la dernière bulle user.
await send2('Question avant interjection');
await push2('Début de réponse.');
const before8d = await pin();
await page2.evaluate(() => appendUserMessage('Interjection', Date.now()));
await page2.waitForTimeout(200);
p8 = await pin();
console.log('    8d : bulle envoyée ' + Math.round(before8d.bubbleTop) + 'px → ' + Math.round(p8.bubbleTop) + 'px après interjection');
check('8d : une interjection ne déplace pas la bulle envoyée', Math.abs(p8.bubbleTop - before8d.bubbleTop) <= 4);
// L'ancre reste la bulle ENVOYÉE : recalculé sur l'interjection, l'espace
// s'agrandirait pour la mener en haut, la vue ne serait plus « au fond » et le
// bouton s'allumerait sur une réponse qui tient à l'écran.
await push2(' Suite après interjection.');
p8 = await pin();
check('8d prémisse : l\'espace n\'est pas résorbé', p8.spacer > 0);
check('8d : après l\'interjection, la vue reste au fond et le bouton éteint', p8.atBottom && !p8.btnShown);
// Interjection plus haute que l'espace RESTANT : c'est là qu'un aller au fond
// forcé emmènerait la vue au-delà du plafond, l'espace ne l'absorbant plus.
// Le reste est ramené à ~10px par un bloc de contenu de hauteur connue, plutôt
// que par une interjection très longue : la hauteur d'une bulle user se fixe
// après coup (repli des longs messages), APRÈS l'aller au fond — mesuré, elle
// était alors absorbée et la régression passait au vert.
await page2.evaluate(() => {
  const sp = parseFloat(document.getElementById('thread-tail-space').style.height) || 0;
  const pad = document.createElement('div');
  pad.style.height = Math.max(0, sp - 10) + 'px';
  document.getElementById('thread').appendChild(pad);
  isAtBottom();   // resynchronise l'espace
});
p8 = await pin();
check('8d prémisse : il reste un espace de quelques pixels', p8.spacer > 0 && p8.spacer <= 20 && atTop(p8));
await page2.evaluate(() => appendUserMessage('Interjection plus haute que le reste', Date.now()));
await page2.waitForTimeout(350);
p8 = await pin();
console.log('    8d : bulle envoyée à ' + Math.round(p8.bubbleTop) + 'px après une interjection qui dépasse l\'espace');
check('8d : une interjection plus haute que l\'espace restant ne déplace pas la bulle envoyée', Math.abs(p8.bubbleTop - before8d.bubbleTop) <= 4);
await end2();

// 8g. Sous l'espace, le fond est du VIDE : bouton et pulsation se décident sur
// la fin du CONTENU à l'écran, pas sur la vue au fond (2026-10-11). Cas signalé :
// un peu remonté (fin de la réponse précédente en vue), une réponse courte
// arrive sous les yeux — ni bouton, ni non-vu (« faire défiler vers du rien »).
// La fin du contenu est mesurée ici sur la dernière bulle assistant, pas par le
// prédicat de l'appli. Témoin sur le même montage : remonté assez pour que la
// réponse tombe sous le bord, bouton et pulsation doivent venir, puis
// s'éteindre dès que sa fin revient à l'écran — sans atteindre le fond.
const tail = () => page2.evaluate(() => {
  const m = document.getElementById('messages');
  const as = document.querySelectorAll('#thread .msg.assistant');
  const mr = m.getBoundingClientRect();
  return {
    replyBottom: as[as.length - 1].getBoundingClientRect().bottom - mr.top,
    viewBottom: mr.height - (parseFloat(getComputedStyle(m).paddingBottom) || 0),
    unseen: document.getElementById('scroll-bottom-btn').classList.contains('has-unseen'),
  };
});
await send2('Question où je remonte un peu');
await wheel2(-120, 1);
await push2('Réponse brève, écrite sous les yeux.');
await end2();
p8 = await pin();
let t8 = await tail();
console.log('    8g : espace ' + p8.spacer + 'px, fin de réponse à ' + Math.round(t8.replyBottom) + 'px / bas utile ' + Math.round(t8.viewBottom) + 'px');
check('8g prémisse : un peu remonté, la vue n\'est pas au fond, espace présent', !p8.atBottom && p8.spacer > 0);
check('8g prémisse : la fin de la réponse est à l\'écran', t8.replyBottom > 0 && t8.replyBottom <= t8.viewBottom);
check('8g : pas de bouton pour faire défiler vers le vide', !p8.btnShown);
check('8g : pas de pulsation de non-vu', !t8.unseen);

await send2('Question où je remonte franchement');
await wheel2(-150, 4);
await push2('Réponse brève, écrite hors de vue.');
await end2();
p8 = await pin();
t8 = await tail();
console.log('    8g témoin : fin de réponse à ' + Math.round(t8.replyBottom) + 'px / bas utile ' + Math.round(t8.viewBottom) + 'px');
check('8g témoin prémisse : la fin de la réponse est sous le bord', t8.replyBottom > t8.viewBottom);
check('8g témoin : bouton montré', p8.btnShown);
check('8g témoin : pulsation de non-vu', t8.unseen);
for (let k = 0; k < 20 && (await tail()).replyBottom > (await tail()).viewBottom; k++) await wheel2(40, 1);
p8 = await pin();
t8 = await tail();
check('8g témoin prémisse : fin de réponse revenue à l\'écran sans atteindre le fond', t8.replyBottom <= t8.viewBottom && !p8.atBottom);
check('8g témoin : voir la fin acquitte la pulsation', !t8.unseen);
check('8g témoin : et masque le bouton', !p8.btnShown);

// 8e. Changer de conversation retire l'espace. Rang de bulle oublié : les
// interjections de 8d passent par appendUserMessage, en DOM seul, et le fil
// relu de la base en compte deux de moins — le rang mémorisé n'y existe plus.
await page2.evaluate(async () => { window.__sentOrdinal = null; await openConversation('conv-verify-pin', true); });
await page2.waitForTimeout(300);
check('8e : rouvrir la conversation repart sans espace', (await pin()).spacer === 0);

// 8f. Réglage décoché : comportement d'avant, la bulle naît en bas de l'écran.
await page2.evaluate(() => { const cb = document.getElementById('set-pin-sent-message'); cb.checked = false; onTogglePinSentMessage(); });
check('8f prémisse : réglage décoché et persisté', await page2.evaluate(() => loadSettings().pinSentMessage === false));
await send2('Question sans épinglage');
p8 = await pin();
console.log('    8f : bulle à ' + Math.round(p8.bubbleTop) + 'px sur ' + p8.clientHeight + 'px');
// La bulle assistant (patienteur) naît sous elle : « en bas » se lit comme
// « nettement sous le plafond », pas comme une moitié d'écran.
check('8f : réglage décoché, pas d\'espace et la bulle naît loin sous le plafond', p8.spacer === 0 && p8.bubbleTop > p8.padTop + 60);
await end2();
await browser2.close();

console.log('');
if (consoleErrors.length) {
  console.log('Console errors:', JSON.stringify(consoleErrors, null, 2));
  failures.push('console errors');
} else {
  console.log('No console errors.');
}
console.log(failures.length ? `ÉCHEC — ${failures.length} vérification(s) : ${failures.join(' | ')}` : 'OK — toutes les vérifications passent');
process.exitCode = failures.length ? 1 : 0;
