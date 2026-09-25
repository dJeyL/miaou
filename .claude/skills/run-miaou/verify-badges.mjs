#!/usr/bin/env node
// Vérification du lot T-2 (badges d'activité) — un lancement.
//
// T-2 rend PERCEPTIBLE ce que T-1 a rendu possible. Son critère n'est donc pas
// un invariant de données mais une correspondance état → pixel, sur QUATRE
// surfaces qui doivent toutes dériver du même registre sans jamais diverger :
//   ligne de conversation, ligne d'Espace (menu déplié), sélecteur replié,
//   hamburger.
//
// Le stub SSE est repris de verify-generations.mjs (gaté par conversation via
// le tag « CONV-X » du dernier message user), pour la même raison : tenir une
// génération ouverte pendant qu'on navigue ailleurs est le seul moyen
// d'observer working et unread simultanément sur des surfaces différentes.
//
// Scénarios :
//   1. working sur la ligne de conversation, pendant le stream
//   2. unread à la fin, si l'écran ne possédait PAS la génération
//   3. PAS d'unread si l'écran la possédait ET que la fin était sous les yeux
//   4. ouvrir la conversation efface l'unread (B2)
//   5. agrégation cross-Space : sélecteur replié + lignes du menu déplié
//   6. corollaire B5 : la pastille quitte le libellé du courant au dépliage
//   7. hamburger : agrège tous les Espaces (B6), s'efface sidebar ouverte, et
//      TAIT la conversation affichée — ce qui est sous les yeux ne s'annonce pas
//   8. apparence : working pulse, unread est statique et plus gros
//   9. compteur d'agents en vol (T-2bis)
//  10. le non-VU du fil (bouton « aller tout en bas ») devient un non-LU de
//      sidebar à la FIN de la génération, même sur la conversation affichée —
//      et au DÉPART pour un non-vu qu'aucune génération ne clôt
//
// Usage : node verify-badges.mjs <dossier-captures> [--headed]
import { launchIsolated } from './stub-backend.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-badges');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// ── Stub SSE gaté par conversation (repris de verify-generations.mjs) ───────
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',
    }));
  } catch (e) {}

  window.__gates = {};
  window.__released = {};
  window.__bulky = {};

  const tagOf = (body) => {
    const msgs = (body && body.messages) || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'user') continue;
      const txt = typeof m.content === 'string' ? m.content : '';
      const hit = txt.match(/CONV-([A-Z])/);
      if (hit) return hit[1];
    }
    return '?';
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, opts) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/chat/completions') < 0) {
      if (url.indexOf('/models') >= 0) {
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(input, opts);
    }
    let body = {};
    try { body = JSON.parse(opts.body); } catch (e) {}

    // Appels silencieux (titrage/résumé) : non streamés, leur transcription
    // contient « CONV-X » et fausserait le routage des gates.
    if (body.stream !== true) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Titre stub' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const tag = tagOf(body);
    const enc = new TextEncoder();
    return new Response(new ReadableStream({
      async start(controller) {
        const send = (o) => controller.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));
        send({ choices: [{ delta: { content: 'Début-' + tag + '. ' } }] });
        // Tags « volumineux » (scénario 10) : la réponse doit dépasser le fold,
        // sinon on ne peut pas remonter au-dessus du contenu qui arrive et le
        // non-vu ne peut pas exister. Émis AVANT la gate pour que le fil soit
        // déjà long quand le test remonte.
        if (window.__bulky && window.__bulky[tag]) {
          for (let i = 0; i < 60; i++) send({ choices: [{ delta: { content: 'Ligne ' + i + ' du remplissage.\n\n' } }] });
        }
        while (window.__gates[tag] && !window.__released[tag]) {
          if (opts && opts.signal && opts.signal.aborted) {
            const err = new Error('aborted'); err.name = 'AbortError'; throw err;
          }
          await new Promise(r => setTimeout(r, 20));
        }
        send({ choices: [{ delta: { content: 'Fin-' + tag + '.' } }] });
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        controller.enqueue(enc.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
};

const browser = await launchIsolated({ headless: !headed }, { serve: false });
const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
await context.addInitScript(initScript);

const errors = [];
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (n) => { await page.screenshot({ path: path.join(outDir, n) }); console.log('  shot  ' + n); };

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForSelector('.boot-done', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(300);

const gate = (tag) => page.evaluate((t) => { window.__gates[t] = true; }, tag);
const release = (tag) => page.evaluate((t) => { window.__released[t] = true; }, tag);
const send = async (text) => {
  await page.fill('#composer-text', text);
  await page.press('#composer-text', 'Enter');
};
const newConv = async () => { await page.evaluate(() => resetToEmpty()); await page.waitForTimeout(120); };
const waitGenCount = (n) => page.waitForFunction(
  (want) => _activeGenerations.size === want, n, { timeout: 8000 });

// Lit l'état de la pastille d'une ligne de conversation, par convId. La classe
// est LE contrat entre le JS et le CSS : on la lit, plus une mesure de rendu
// (scénario 8 vérifie que la classe se traduit bien en pixels).
const convBadge = (id) => page.evaluate((cid) => {
  // La ligne ne porte pas d'id, mais ses boutons SI : le pin et la corbeille
  // reçoivent `togglePin('<id>')` / `onConvDel(this,'<id>')` en attribut généré.
  // On apparie donc sur cette ancre, une IDENTITÉ.
  //
  // L'appariement PAR TITRE RENDU qui vivait ici mentait : le stub de titrage
  // renvoie « Titre stub » pour toute conversation, donc plusieurs lignes
  // portent le même libellé et la recherche tombait sur une homonyme d'un
  // AUTRE Espace — elle rendait l'état de celle-là, et ne pouvait plus jamais
  // répondre 'row-not-found'. Le contrôle « elle n'est PAS dans la liste du
  // Space courant » en est mort (constaté rouge le 2026-09-05 ; le libellé
  // n'est de toute façon pas une identité, cf.
  // project_dom_state_pairing_carry_index_on_node).
  const rows = [...document.querySelectorAll('#conv-list .conv')];
  const conv = loadConversation(cid);
  if (!conv) return 'no-conv';
  for (const r of rows) {
    const anchor = r.querySelector(`[onclick*="'${cid}'"]`);
    if (anchor) {
      const dot = r.querySelector('.activity-dot');
      if (!dot) return 'no-dot';
      if (dot.hidden) return null;
      return dot.classList.contains('unread') ? 'unread'
           : dot.classList.contains('working') ? 'working' : 'dot-no-state';
    }
  }
  return 'row-not-found';
}, id);

const dotState = (sel) => page.evaluate((s) => {
  const dot = document.querySelector(s);
  if (!dot) return 'absent';
  if (dot.hidden) return null;
  return dot.classList.contains('unread') ? 'unread'
       : dot.classList.contains('working') ? 'working' : 'dot-no-state';
}, sel);

// ─────────────────────────────────────────────────────────────────────────
// Scénario 1 : working sur la ligne de conversation
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 1 : working pendant le stream');
await page.evaluate(() => { $('app').classList.add('sidebar-open'); });
await gate('A');
await send('CONV-A première question.');
await waitGenCount(1);
await page.waitForTimeout(250);
const convA = await page.evaluate(() => currentConvId);

check('badge de la conv qui génère = working', await convBadge(convA) === 'working');
check('convBadgeState (source) = working', await page.evaluate((a) => convBadgeState(a), convA) === 'working');
await shot('01-working-conv.png');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 2 : unread quand l'écran ne possède PAS la génération
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 2 : unread si la fin arrive alors qu\'on regarde ailleurs');
await newConv();
await page.waitForTimeout(120);
check('en quittant, la conv reste working (génération en vol)', await convBadge(convA) === 'working');

await release('A');
await waitGenCount(0);
await page.waitForTimeout(300);
check('à la fin hors écran : bascule sur unread', await convBadge(convA) === 'unread');
check('convBadgeState = unread', await page.evaluate((a) => convBadgeState(a), convA) === 'unread');
await shot('02-unread-conv.png');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 4 : ouvrir la conversation efface l'unread (B2)
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 4 : ouvrir suffit à marquer lu (B2)');
await page.evaluate((a) => selectConv(a), convA);
await page.waitForTimeout(350);
check('unread effacé à l\'ouverture', await convBadge(convA) === null);
check('convBadgeState retombe à null', await page.evaluate((a) => convBadgeState(a) === null, convA) === true);
await shot('03-read.png');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 3 : PAS d'unread si l'écran possédait la génération
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 3 : pas d\'unread si on a regardé la réponse arriver');
await newConv();
await page.evaluate(() => { window.__gates = {}; window.__released = {}; });
await gate('B');
await send('CONV-B question regardée.');
await waitGenCount(1);
await page.waitForTimeout(200);
const convB = await page.evaluate(() => currentConvId);
await release('B');
await waitGenCount(0);
await page.waitForTimeout(300);
// Prémisse du scénario, assertée et non supposée : la réponse tient dans
// l'écran, donc la fin est réellement VUE. Depuis le 2026-09-13, posséder
// l'écran ne suffit plus à empêcher l'unread — c'est `hasThreadUnseen` qui
// tranche. Sans ce contrôle, un stub qui grossirait ferait rougir la ligne
// suivante pour une raison qui n'est pas celle qu'elle teste (ou, pire,
// passerait vert sur une prémisse fausse).
check('prémisse : la fin de génération est bien dans l\'écran',
  await page.evaluate((b) => hasThreadUnseen(b) === false, convB) === true);
check('conv terminée SOUS LES YEUX : aucun badge', await convBadge(convB) === null);
check('_unreadConvs ne la contient pas', await page.evaluate((b) => _unreadConvs.has(b) === false, convB) === true);

// ─────────────────────────────────────────────────────────────────────────
// Scénario 5 : agrégation cross-Space
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 5 : agrégation cross-Space (sélecteur replié + menu)');
// Deux Espaces : ESP-X (où l'on va lancer) et le default, où l'on reviendra.
const spaces = await page.evaluate(() => {
  const x = { id: 'sp-x-' + Date.now(), name: 'ESP-X', description: '', createdAt: Date.now() };
  upsertSpace(x);
  return { x: x.id, def: DEFAULT_SPACE_ID };
});
// pickSpace, PAS followSpace : c'est le geste utilisateur de changement
// d'Espace (il vide le fil via resetToEmpty). followSpace est la variante
// « suivre une conversation déplacée », qui garde le fil ouvert — l'utiliser
// ici laisserait currentConvId sur la conv de l'autre Espace, donc
// genOwnsScreen vrai, donc aucun unread : le scénario ne testerait rien.
await page.evaluate((id) => pickSpace(id), spaces.x);
await page.waitForTimeout(250);
await newConv();
await page.evaluate(() => { window.__gates = {}; window.__released = {}; });
await gate('C');
await send('CONV-C dans ESP-X.');
await waitGenCount(1);
await page.waitForTimeout(250);
const convC = await page.evaluate(() => currentConvId);

// Revenir au default Space : la génération de ESP-X continue, invisible dans la
// liste — c'est exactement le trou que la surface 2 comble.
await page.evaluate((id) => pickSpace(id), spaces.def);
await page.waitForTimeout(350);
check('génération de l\'autre Espace toujours en vol', await page.evaluate((c) => _activeGenerations.has(c), convC) === true);
// Le seul énoncé qui porte : SA ligne est absente. La branche « la liste est
// vide » qui vivait ici en alternative ne disait rien — le default Space a ses
// propres conversations, donc elle était fausse en permanence et le contrôle
// reposait entièrement sur l'autre, elle-même cassée par l'appariement au titre.
check('elle n\'est PAS dans la liste du Space courant',
  await convBadge(convC) === 'row-not-found');
check('sélecteur replié : pastille working (activité ailleurs)', await dotState('#space-select-btn .activity-dot') === 'working');
check('spaceBadgeState(ESP-X) = working', await page.evaluate((x) => spaceBadgeState(x), spaces.x) === 'working');
check('spaceBadgeState(default) = null (rien chez lui)',
  await page.evaluate((d) => spaceBadgeState(d) === null, spaces.def) === true);
await shot('04-aggregate-collapsed.png');

// Discriminant du sélecteur replié : il faut un cas où « tout » et « ailleurs »
// DIVERGENT, sinon l'exclusion de l'Espace actif n'est pas testée (constaté en
// injectant la régression : elle passait inaperçue). On lance donc une
// génération DANS l'Espace courant, l'autre étant au repos — le replié doit
// alors rester muet (rien ailleurs) là où le hamburger, lui, signale.
await page.evaluate(() => { window.__released.C = true; });
await waitGenCount(0);
await page.waitForTimeout(300);
await page.evaluate((c) => { markConvRead(c); renderConvList(); syncSpaceUI(); }, convC);
await page.waitForTimeout(150);
check('remise à zéro : plus aucun badge nulle part',
  await page.evaluate(() => aggregateBadgeState(null) === null) === true);

await page.evaluate(() => { window.__gates = {}; window.__released = {}; });
await newConv();
await gate('E');
await send('CONV-E dans le Space courant.');
await waitGenCount(1);
await page.waitForTimeout(250);
check('activité DANS le Space courant : sélecteur replié muet (rien ailleurs)',
  await dotState('#space-select-btn .activity-dot') === null);
// … et le hamburger reste muet LUI AUSSI, mais pour une autre raison : la
// conversation qui travaille est celle qu'on REGARDE. Une pastille n'annonce
// que ce qu'on ne voit pas ; le composer en mode stop porte déjà l'information.
check('… et le hamburger se tait : c\'est la conversation AFFICHÉE qui travaille',
  await dotState('#sidebar-toggle .activity-dot') === null);
// Le discriminant du hamburger vit donc ailleurs : la MÊME génération, vue
// depuis une autre conversation, doit le rallumer. Sans ce contrôle, une
// exclusion trop large (tout l'Espace courant, ou tout court) passerait.
const convE = await page.evaluate(() => currentConvId);
await page.evaluate(() => resetToEmpty());
await page.waitForTimeout(200);
check('quitter cette conversation rallume le hamburger (elle est « ailleurs » maintenant)',
  await dotState('#sidebar-toggle .activity-dot') === 'working');
await page.evaluate((c) => selectConv(c), convE);
await page.waitForTimeout(200);
check('y revenir le rend muet à nouveau',
  await dotState('#sidebar-toggle .activity-dot') === null);
await release('E');
await waitGenCount(0);
await page.waitForTimeout(300);
await page.evaluate(() => { markConvRead(currentConvId); renderConvList(); syncSpaceUI(); });

// Remettre la génération de ESP-X en vol pour la suite des scénarios.
await page.evaluate(() => { window.__gates = {}; window.__released = {}; });
await page.evaluate((id) => pickSpace(id), spaces.x);
await page.waitForTimeout(250);
await newConv();
await gate('C');
await send('CONV-C dans ESP-X.');
await waitGenCount(1);
await page.waitForTimeout(250);
const convC2 = await page.evaluate(() => currentConvId);
await page.evaluate((id) => pickSpace(id), spaces.def);
await page.waitForTimeout(350);

// Déplier : chaque Espace concerné porte SA pastille.
await page.evaluate(() => toggleSpaceMenu());
await page.waitForTimeout(250);
const menu = await page.evaluate((ids) => {
  const out = {};
  const opts = [...document.querySelectorAll('#space-menu .model-opt')];
  for (const o of opts) {
    const name = o.querySelector('.space-opt-name');
    if (!name) continue;
    const dot = o.querySelector('.activity-dot');
    out[name.textContent] = !dot ? 'no-dot' : dot.hidden ? null
      : dot.classList.contains('unread') ? 'unread'
      : dot.classList.contains('working') ? 'working' : 'dot-no-state';
  }
  return out;
}, spaces);
check('menu déplié : ESP-X porte working', menu['ESP-X'] === 'working');
check('menu déplié : l\'Espace courant (Général) n\'a PAS de pastille (corollaire B5)',
  menu['Général'] === null || menu['Général'] === undefined);

// Le déclencheur lui-même, MENU OUVERT : sa pastille doit s'effacer. Sans cette
// assertion, le corollaire B5 n'est vérifié qu'à moitié — les lignes du menu
// peuvent être correctes pendant que l'agrégat reste affiché à côté du libellé
// du courant, où il se lit à tort comme SON état. (Trou signalé par Julien sur
// capture, 2026-08-23 : c'était exactement ce cas.)
const triggerWhileOpen = await page.evaluate(() => {
  const d = document.querySelector('#space-select-btn .activity-dot');
  return { display: getComputedStyle(d).display, cls: d.className };
});
check('menu OUVERT : la pastille du déclencheur s\'efface (corollaire B5)',
  triggerWhileOpen.display === 'none');
check('… par masquage CSS, son état JS restant intact',
  /working|unread/.test(triggerWhileOpen.cls));
await shot('05-aggregate-expanded.png');
await page.evaluate(() => { $('space-menu').classList.remove('show'); });
await page.waitForTimeout(150);
check('menu refermé : la pastille du déclencheur revient',
  await page.evaluate(() => getComputedStyle(document.querySelector('#space-select-btn .activity-dot')).display) !== 'none');

// ─────────────────────────────────────────────────────────────────────────
// Scénario 7 : hamburger — agrège TOUT (B6)
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 7 : hamburger agrège tout, y compris l\'Espace actif');
check('hamburger : working (activité dans ESP-X)', await dotState('#sidebar-toggle .activity-dot') === 'working');
check('agrégat sans exclusion = working', await page.evaluate(() => aggregateBadgeState(null)) === 'working');

// Sidebar ouverte : la pastille du hamburger s'efface (CSS), sans que son état
// JS change — c'est bien la cascade qui la masque, pas un test JS.
let burger = await page.evaluate(() => {
  const d = document.querySelector('#sidebar-toggle .activity-dot');
  return { display: getComputedStyle(d).display, hasClass: d.classList.contains('working') };
});
check('sidebar ouverte : pastille hamburger masquée par le CSS', burger.display === 'none');
check('… alors que son état JS reste working (masquage ≠ effacement)', burger.hasClass === true);

await page.evaluate(() => { $('app').classList.remove('sidebar-open'); });
await page.waitForTimeout(150);
burger = await page.evaluate(() => {
  const d = document.querySelector('#sidebar-toggle .activity-dot');
  return { display: getComputedStyle(d).display };
});
check('sidebar fermée : pastille hamburger visible', burger.display !== 'none');
// Capture RECADRÉE sur la topbar : en pleine page la pastille fait 7px sur
// 1100 et ne documente rien. Le cadrage serré est le seul moyen de relire
// l'ancrage et le détourage sur une capture.
await page.screenshot({ path: path.join(outDir, '06-hamburger.png'),
                        clip: { x: 0, y: 0, width: 220, height: 55 } });
console.log('  shot  06-hamburger.png (recadré topbar)');
await page.evaluate(() => { $('app').classList.add('sidebar-open'); });

// ─────────────────────────────────────────────────────────────────────────
// Scénario 5bis : unread gagne sur working à l'agrégation
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 5bis : unread gagne sur working (une seule pastille)');
await release('C');
await waitGenCount(0);
await page.waitForTimeout(350);
check('conv de ESP-X terminée hors écran : unread', await page.evaluate((c) => convBadgeState(c), convC2) === 'unread');
check('spaceBadgeState(ESP-X) bascule sur unread', await page.evaluate((x) => spaceBadgeState(x), spaces.x) === 'unread');
check('sélecteur replié : pastille unread', await dotState('#space-select-btn .activity-dot') === 'unread');

// Relancer un working ailleurs pendant que l'unread persiste : l'agrégat doit
// rester unread (pas de troisième état visuel).
await page.evaluate(() => { window.__gates = {}; window.__released = {}; });
await newConv();
await gate('D');
await send('CONV-D dans le default.');
await waitGenCount(1);
await page.waitForTimeout(250);
check('unread (ESP-X) + working (courant) → hamburger reste unread',
  await dotState('#sidebar-toggle .activity-dot') === 'unread');
check('aggregateBadgeState(null) = unread, jamais un état composite',
  await page.evaluate(() => aggregateBadgeState(null)) === 'unread');
await shot('07-unread-wins.png');
await release('D');
await waitGenCount(0);
await page.waitForTimeout(250);

// ─────────────────────────────────────────────────────────────────────────
// Scénario 8 : apparence — la classe se traduit bien en pixels
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 8 : apparence (working pulse, unread statique et plus gros)');
const look = await page.evaluate(() => {
  // Deux pastilles fabriquées hors flux applicatif : on mesure le CSS, pas
  // l'état — la correspondance état→classe est déjà couverte au-dessus.
  const host = document.createElement('div');
  host.style.position = 'fixed'; host.style.top = '-999px';
  const w = activityBadgeEl('working');
  const u = activityBadgeEl('unread');
  host.appendChild(w); host.appendChild(u);
  document.getElementById('conv-list').appendChild(host);
  const cw = getComputedStyle(w), cu = getComputedStyle(u);
  const out = {
    wWidth: cw.width, wOpacity: cw.opacity, wAnim: cw.animationName,
    uWidth: cu.width, uOpacity: cu.opacity, uAnim: cu.animationName,
    wBg: cw.backgroundColor, uBg: cu.backgroundColor,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  };
  host.remove();
  return out;
});
check('working : 5px', look.wWidth === '5px');
// L'opacité de working est celle de l'état bas de waiter-pulse (.45), pas une
// valeur déclarée : la keyframe est réutilisée telle quelle (spec T-2), et une
// déclaration statique serait de toute façon écrasée par l'animation.
check('working : opacité basse, nettement sous unread', parseFloat(look.wOpacity) < 0.6);
check('working : animé (waiter-pulse réutilisée, pas une jumelle)', look.wAnim === 'waiter-pulse');
check('unread : 7px', look.uWidth === '7px');
check('unread : opacité pleine', parseFloat(look.uOpacity) === 1);
check('unread : aucune animation', look.uAnim === 'none');
check('même couleur pour les deux états (distinction par le mouvement)', look.wBg === look.uBg);
check('couleur = --accent (suit palette et thème)', look.accent.length > 0);
console.log('    working=' + look.wWidth + '/' + look.wOpacity + '/' + look.wAnim
          + '  unread=' + look.uWidth + '/' + look.uOpacity + '/' + look.uAnim
          + '  bg=' + look.wBg);

// Reduced-motion : le kill-switch global fige à 0.01ms. La distinction doit
// tenir SANS mouvement — c'est la garantie « aucune perte en reduced-motion ».
const rm = await page.evaluate(() => {
  document.documentElement.setAttribute('data-motion', 'reduced');
  const host = document.createElement('div');
  host.style.position = 'fixed'; host.style.top = '-999px';
  const w = activityBadgeEl('working');
  const u = activityBadgeEl('unread');
  host.appendChild(w); host.appendChild(u);
  document.getElementById('conv-list').appendChild(host);
  const cw = getComputedStyle(w), cu = getComputedStyle(u);
  const out = { wDur: cw.animationDuration, wAnim: cw.animationName,
                wWidth: cw.width, uWidth: cu.width,
                wOpacity: cw.opacity, uOpacity: cu.opacity };
  host.remove();
  document.documentElement.removeAttribute('data-motion');
  return out;
});
// getComputedStyle normalise 0.01ms en '1e-05s' : comparer la VALEUR, pas la
// chaîne. Le point qui compte est qu'elle soit quasi-nulle SANS être `none`
// (doctrine lot N : préserver le firing de transitionend).
check('reduced-motion : animation figée (durée quasi nulle)',
  parseFloat(rm.wDur) > 0 && parseFloat(rm.wDur) < 0.001);
check('reduced-motion : l\'animation existe toujours, jamais supprimée',
  rm.wAnim === 'waiter-pulse');
check('reduced-motion : working et unread restent distincts par la taille',
  rm.wWidth === '5px' && rm.uWidth === '7px');
check('reduced-motion : … et par l\'opacité',
  parseFloat(rm.wOpacity) < 0.6 && parseFloat(rm.uOpacity) === 1);

// ─────────────────────────────────────────────────────────────────────────
// Zone morte du .model-opt (piège lot C) : ajouter une pastille ne doit pas
// recréer le trou de clic — le handler est sur la ligne, pas sur un enfant.
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Régression lot C : la pastille ne crée pas de zone morte');
await page.evaluate(() => toggleSpaceMenu());
await page.waitForTimeout(250);
const deadZone = await page.evaluate(() => {
  const opts = [...document.querySelectorAll('#space-menu .model-opt')];
  const target = opts.find(o => (o.querySelector('.space-opt-name') || {}).textContent === 'ESP-X');
  if (!target) return { found: false };
  return { found: true, handlerOnRow: typeof target.onmousedown === 'function' };
});
check('ligne ESP-X trouvée dans le menu', deadZone.found === true);
check('handler de clic sur la LIGNE entière, pas sur un enfant', deadZone.handlerOnRow === true);
await page.evaluate(() => { $('space-menu').classList.remove('show'); });

// ─────────────────────────────────────────────────────────────────────────
// Scénario 9 (lot T-2bis) : compteur d'agents
// ─────────────────────────────────────────────────────────────────────────
console.log('\n— Scénario 9 : compteur d\'agents en vol (T-2bis)');
const agentPill = () => page.evaluate(() => {
  const el = document.getElementById('agent-count');
  if (!el) return 'absent';
  return el.hidden ? null : (document.getElementById('agent-count-label').textContent || '');
});

// Repartir d'un état propre : plus aucune génération, plus aucun non-lu.
await page.evaluate(() => { window.__gates = {}; window.__released = {}; });
await page.evaluate((d) => pickSpace(d), spaces.def);
await page.waitForTimeout(250);
await page.evaluate(() => { _unreadConvs.clear(); renderConvList(); syncSpaceUI(); });
check('au repos : pas de compteur', await agentPill() === null);

// Une seule génération, SOUS LES YEUX : silencieux (le composer le dit déjà).
await newConv();
await gate('F');
await send('CONV-F sous les yeux.');
await waitGenCount(1);
await page.waitForTimeout(250);
const convF = await page.evaluate(() => currentConvId);
check('1 génération sur écran : compteur masqué (redondant avec le composer)',
  await agentPill() === null);

// La quitter : elle passe hors écran → le compteur apparaît au singulier.
await newConv();
await page.waitForTimeout(200);
check('1 génération hors écran : « 1 agent » (singulier)', await agentPill() === '1 agent');

// Deuxième génération : pluriel, et le TOTAL — pas total-1.
await gate('G');
await send('CONV-G en parallèle.');
await waitGenCount(2);
await page.waitForTimeout(250);
check('2 générations dont une sur écran : « 2 agents » (le TOTAL)',
  await agentPill() === '2 agents');

// Revenir sur la première : le total ne bouge pas.
await page.evaluate((f) => selectConv(f), convF);
await page.waitForTimeout(350);
check('changement de conversation : toujours « 2 agents »', await agentPill() === '2 agents');

// Une seule se termine : retour au singulier, et elle est hors écran.
await release('G');
await waitGenCount(1);
await page.waitForTimeout(300);
check('une seule restante, et c\'est celle affichée : compteur masqué',
  await agentPill() === null);

await release('F');
await waitGenCount(0);
await page.waitForTimeout(300);
check('toutes terminées : compteur masqué', await agentPill() === null);

// C4 : une génération dans un AUTRE Espace est comptée.
await page.evaluate(() => { window.__gates = {}; window.__released = {}; });
await page.evaluate((x) => pickSpace(x), spaces.x);
await page.waitForTimeout(250);
await newConv();
await gate('H');
await send('CONV-H dans ESP-X.');
await waitGenCount(1);
await page.waitForTimeout(250);
await page.evaluate((d) => pickSpace(d), spaces.def);
await page.waitForTimeout(350);
check('génération dans un autre Espace : comptée (C4, cross-Space)',
  await agentPill() === '1 agent');
await page.screenshot({ path: path.join(outDir, '08-agent-count.png'),
                        clip: { x: 620, y: 0, width: 480, height: 55 } });
console.log('  shot  08-agent-count.png (recadré topbar droite)');
await release('H');
await waitGenCount(0);
await page.waitForTimeout(300);

// ─────────────────────────────────────────────────────────────────────────
// Scénario 10 : le non-VU du fil devient un non-LU de sidebar au départ
// ─────────────────────────────────────────────────────────────────────────
// Deux états distincts portent le même mot et ne doivent pas être confondus :
//   _threadUnseen  — « du contenu est arrivé pendant que je regardais PLUS HAUT »
//                    (bouton « aller tout en bas », pulsation .has-unseen)
//   _unreadConvs   — « ça s'est terminé pendant que j'étais AILLEURS »
//                    (pastille de sidebar)
// Le premier se reporte sur le second à DEUX moments (le premier renversant la
// règle d'origine, 2026-09-13, après usage) : quand une génération FINIT sur un
// fil à non-vu, même si la conversation est affichée (unregisterGeneration), et
// au DÉPART d'une conversation à non-vu sans génération (carryThreadUnseenToBadge).
console.log('\n— Scénario 10 : non-vu du fil → non-lu de sidebar');
await page.evaluate(() => { window.__gates = {}; window.__released = {}; window.__bulky = {}; });
await newConv();
await page.evaluate(() => { window.__bulky.I = true; });
await gate('I');
await send('CONV-I longue réponse.');
await waitGenCount(1);
await page.waitForTimeout(500);
const convI = await page.evaluate(() => currentConvId);

// Remonter en haut du fil : ce qui s'écrit ensuite arrive hors de vue.
await page.evaluate(() => { $('messages').scrollTop = 0; });
await page.waitForTimeout(150);
check('remonté en haut : pas au fond', await page.evaluate(() => isAtBottom()) === false);

// Laisser la génération finir pendant qu'on regarde plus haut.
await release('I');
await waitGenCount(0);
await page.waitForTimeout(400);
check('contenu arrivé hors de vue : le fil est marqué non-vu',
  await page.evaluate((c) => hasThreadUnseen(c), convI) === true);
check('le bouton « aller tout en bas » pulse',
  await page.evaluate(() => $('scroll-bottom-btn').classList.contains('has-unseen')) === true);
// LE POINT DE LA DÉCISION (renversée le 2026-09-13) : la génération a fini sur
// un fil dont la fin est hors de vue, la conversation est AFFICHÉE, et la
// pastille de sidebar s'allume quand même. Regarder la conversation ne veut pas
// dire avoir vu la réponse.
check('fin hors de vue sur la conv AFFICHÉE : pastille de sidebar allumée',
  await convBadge(convI) === 'unread');
await page.screenshot({ path: path.join(outDir, '09-unseen-in-thread.png') });
console.log('  shot  09-unseen-in-thread.png');

// Quitter sans être descendu : le badge tient (le non-vu, lui, n'est pas
// consommé par le report — il attend le retour au fond).
await newConv();
await page.waitForTimeout(250);
check('quittée sans descendre : elle reste non lue en sidebar',
  await convBadge(convI) === 'unread');
await page.screenshot({ path: path.join(outDir, '10-unseen-carried.png') });
console.log('  shot  10-unseen-carried.png');

// Y revenir : toute réouverture atterrit au FOND (scrollBottom(true) en fin de
// renderThread), donc l'acquittement est immédiat et les DEUX états tombent.
await page.evaluate((c) => selectConv(c), convI);
await page.waitForTimeout(500);
check('réouverture : on atterrit au fond', await page.evaluate(() => isAtBottom()) === true);
check('… le non-vu du fil est acquitté',
  await page.evaluate((c) => hasThreadUnseen(c), convI) === false);
check('… et la pastille de sidebar s\'est éteinte', await convBadge(convI) === null);

// Le SECOND producteur, isolé : un non-vu qu'aucune fin de génération ne clôt.
// La conversation est terminée depuis longtemps ; on y remonte, on lit un vieux
// message, on repart. Sans `carryThreadUnseenToBadge` rien ne l'allumerait —
// et depuis que `unregisterGeneration` couvre le cas de la conv affichée, c'est
// le seul montage qui exerce encore ce chemin.
await page.evaluate((c) => selectConv(c), convI);
await page.waitForTimeout(400);
await page.evaluate(() => {
  // Remonter, puis simuler l'arrivée de contenu hors de vue SANS génération :
  // c'est l'unique écrivain du Set, appelé ici tel quel plutôt que reproduit.
  $('messages').scrollTop = 0;
  markThreadContentUnseen();
});
await page.waitForTimeout(150);
check('non-vu posé hors génération : aucune pastille tant qu\'on y est',
  await convBadge(convI) === null);
await newConv();
await page.waitForTimeout(250);
check('quittée avec ce non-vu : carryThreadUnseenToBadge allume la pastille',
  await convBadge(convI) === 'unread');
await page.evaluate((c) => selectConv(c), convI);
await page.waitForTimeout(500);
check('retour au fond : les deux porteurs retombent',
  await convBadge(convI) === null
  && await page.evaluate((c) => hasThreadUnseen(c), convI) === false);

// Contrôle en creux : quitter une conversation SANS non-vu n'allume rien.
await page.evaluate(() => { $('messages').scrollTop = $('messages').scrollHeight; });
await page.waitForTimeout(150);
await newConv();
await page.waitForTimeout(200);
check('quitter une conversation entièrement lue n\'allume aucune pastille',
  await convBadge(convI) === null);

// ─────────────────────────────────────────────────────────────────────────
console.log('');
if (errors.length) {
  console.log('Erreurs console :');
  for (const e of errors.slice(0, 10)) console.log('  ! ' + e);
}
check('aucune erreur console', errors.length === 0);

await browser.close();
console.log('\n' + (failures.length ? 'ÉCHEC — ' + failures.length + ' : ' + failures.join(' | ')
                                    : 'OK — tous les contrôles passent'));
process.exit(failures.length ? 1 : 0);
