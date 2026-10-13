#!/usr/bin/env node
// Modale de silence (stall.js) : quand le flux d'une conversation RACINE se
// tait plus d'une période du chien de garde, MIAOU demande « Attendre » ou
// « Abandonner » au lieu de couper d'office. Cf. docs/pitfalls-detail.md
// (piège 10).
//
// Montage. Le chat est stubé dans la page (window.fetch) : chaque requête est
// aiguillée sur le TAG en majuscules du dernier message user (`[TAGA]`…), et
// retenue jusqu'à `window.__go[tag]`. Un tag commençant par `TAGH` retient la
// CONNEXION (le fetch ne rend rien) ; les autres rendent les en-têtes puis se
// taisent dans le flux ; un tag contenant `P` envoie d'abord un fragment
// partiel. Les deux durées sont raccourcies en interceptant setTimeout sur les
// constantes VIVANTES (jamais un littéral, cf. SKILL.md) : la période du chien
// de garde (STREAM_IDLE_TIMEOUT_MS → 800 ms) et le plafond de la modale
// (× STALL_CEILING_PERIODS → 2,5 s).
//
// Checklist :
//   0. pastille : une modale dans une fenêtre sans focus allume l'icône, et
//      une AUTRE fenêtre qui repeint ses pastilles ne l'éteint pas
//   1. modale ouverte, page inerte, raccourcis bloqués ; le flux qui reprend
//      la ferme seul et la réponse arrive entière
//   2. Escape = Attendre ; la question revient ; « Attendre » à nouveau ;
//      puis la réponse arrive entière
//   3. Abandonner : partiel gardé, tronqué, erreur affichée
//   4. plafond : une modale sans réponse abandonne d'elle-même (connexion
//      retenue avant tout octet)
//   5. deux conversations, l'une dans un autre Espace : deux lignes, nom de
//      l'Espace sur la seconde ; la modale suit les départs de lignes
//   6. agent : jamais de modale, coupé au plafond
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../dist/miaou.html');
const browser = await launchIsolated({ headless: !process.argv.includes('--headed') }, { serve: false });
const context = await browser.newContext({ viewport: { width: 1200, height: 820 } });
const consoleErrors = [];

await context.addInitScript(() => {
  const realFetch = window.fetch.bind(window);
  window.__go = {};
  window.__chatHits = {};
  // Pastille d'icône : l'API n'existe pas en file:// headless, on la pose pour
  // observer ce que l'appli lui demande.
  window.__badge = null;
  navigator.setAppBadge = () => { window.__badge = 'set'; return Promise.resolve(); };
  navigator.clearAppBadge = () => { window.__badge = 'clear'; return Promise.resolve(); };
  // Focus de fenêtre piloté par le script (document.hasFocus en headless ne
  // dit rien d'utile).
  window.__focus = true;
  document.hasFocus = () => window.__focus;
  const waitGo = (tag, signal) => new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (signal && signal.aborted) { clearInterval(t); reject(new DOMException('aborted', 'AbortError')); }
      else if (window.__go[tag]) { clearInterval(t); resolve(); }
    }, 50);
  });
  window.fetch = async (input, opts) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('/models') >= 0) {
      return new Response(JSON.stringify({ data: [{ id: 'stub-model' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.indexOf('/chat/completions') < 0) return realFetch(input, opts);
    const body = JSON.parse((opts && opts.body) || '{}');
    if (!body.stream) {
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant',
        content: JSON.stringify({ summary: 'S', keywords: ['k'] }) }, finish_reason: 'stop' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const users = (body.messages || []).filter(m => m.role === 'user');
    const last = users.length ? users[users.length - 1] : null;
    const text = last ? (typeof last.content === 'string' ? last.content : JSON.stringify(last.content)) : '';
    const m = text.match(/\[(TAG[A-Z0-9]+)\]/);
    const tag = m ? m[1] : 'NONE';
    window.__chatHits[tag] = (window.__chatHits[tag] || 0) + 1;
    const signal = opts && opts.signal;
    const enc = new TextEncoder();
    const sse = (o) => enc.encode('data: ' + JSON.stringify(o) + '\n\n');
    if (tag.indexOf('TAGH') === 0) await waitGo(tag, signal);   // connexion retenue
    const stream = new ReadableStream({
      async start(ctrl) {
        try {
          if (tag.slice(3).indexOf('P') >= 0) ctrl.enqueue(sse({ choices: [{ delta: { content: 'Début' } }] }));
          await waitGo(tag, signal);
          // Tag à `R` : le flux reprend par un fragment puis se tait de nouveau
          // jusqu'à `__go[tag + 'END']` — ce qui permet d'observer la modale
          // PENDANT que le flux revit, avant que la fin du stream ne la ferme
          // de toute façon.
          if (tag.slice(3).indexOf('R') >= 0) {
            ctrl.enqueue(sse({ choices: [{ delta: { content: 'Réponse ' } }] }));
            await waitGo(tag + 'END', signal);
            ctrl.enqueue(sse({ choices: [{ delta: { content: tag } }] }));
          } else ctrl.enqueue(sse({ choices: [{ delta: { content: 'Réponse ' + tag } }] }));
          ctrl.enqueue(sse({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
          ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
          ctrl.close();
        } catch (e) { ctrl.error(e); }
      },
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
});

async function openPage() {
  const p = await context.newPage();
  p.on('pageerror', (e) => consoleErrors.push(String(e)));
  await p.goto('file://' + distPath);
  await p.waitForSelector('#composer-text', { timeout: 15000 });
  await p.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });
  await p.evaluate(() => {
    const realST = window.setTimeout;
    const W = STREAM_IDLE_TIMEOUT_MS, CEIL = STREAM_IDLE_TIMEOUT_MS * STALL_CEILING_PERIODS;
    window.__shortW = 0; window.__shortCeil = 0;
    window.setTimeout = function (fn, ms, ...rest) {
      if (ms === W) { window.__shortW++; ms = 800; }
      else if (ms === CEIL) { window.__shortCeil++; ms = 2500; }
      return realST(fn, ms, ...rest);
    };
  });
  return p;
}

const results = [];
const check = (name, ok, detail) => results.push([name, !!ok, detail === undefined ? '' : String(detail)]);

const page = await openPage();
const dialogOpen = (p) => p.evaluate(() => document.getElementById('stall-dialog').open);
const rowsOf = (p) => p.evaluate(() => Array.from(document.querySelectorAll('#stall-dialog .stall-row')).map(li => ({
  conv: li.dataset.conv,
  title: li.querySelector('.stall-row-title').textContent,
  space: (li.querySelector('.stall-row-space') || {}).textContent || '',
  status: li.querySelector('.stall-row-status').textContent,
})));
const waitOpen = (p, t = 4000) => p.waitForFunction(() => document.getElementById('stall-dialog').open, null, { timeout: t });
const waitClosed = (p, t = 4000) => p.waitForFunction(() => !document.getElementById('stall-dialog').open, null, { timeout: t });

// Ouvre une conversation racine neuve (Espace par défaut) et envoie un message tagué.
async function sendIn(convId, tag) {
  await page.evaluate(({ id }) => {
    saveConversation({ id, title: 'Conv ' + id, timestamp: Date.now(), updatedAt: Date.now(), spaceId: DEFAULT_SPACE_ID,
      messages: [{ role: 'user', content: 'Une question assez longue ici.' }, { role: 'assistant', content: 'Une reponse assez longue ici.' }] });
    selectConv(id);
  }, { id: convId });
  await page.waitForTimeout(200);
  await page.evaluate(() => clearComposerError());
  await page.click('#composer-text');
  await page.type('#composer-text', '[' + tag + '] message de test', { delay: 2 });
  await page.evaluate(() => onSendBtn());
}
const lastAssistant = (convId) => page.evaluate((id) => {
  const c = loadConversation(id);
  const a = (c && c.messages || []).filter(m => m.role === 'assistant').pop();
  return a ? { content: a.content, truncated: !!a.truncated } : null;
}, convId);
const composerError = () => page.evaluate(() => document.getElementById('composer-error').textContent);

// ── 0. Pastille d'icône, deux fenêtres ──────────────────────────────────────
const page2 = await openPage();
await page2.evaluate(() => syncActivityBadges());
const badge2Before = await page2.evaluate(() => window.__badge);
check('0. prémisse : la seconde fenêtre n\'a rien qui allume la pastille au départ', badge2Before !== 'set', badge2Before);
await page.evaluate(() => { window.__focus = false; window.dispatchEvent(new Event('blur')); });
await sendIn('c0', 'TAG0');
await waitOpen(page);
check('0. une modale dans une fenêtre sans focus allume la pastille', await page.evaluate(() => window.__badge) === 'set');
await page2.waitForFunction(() => window.__badge === 'set', null, { timeout: 3000 }).catch(() => {});
check('0. l\'autre fenêtre, prévenue, l\'allume aussi', await page2.evaluate(() => window.__badge) === 'set');
// Raison d'être de la diffusion : une fenêtre sans modale qui repeint ses pastilles
// ne doit pas éteindre celle que la modale d'à côté a allumée.
await page2.evaluate(() => syncActivityBadges());
check('0. une repeinture de l\'autre fenêtre ne l\'éteint pas', await page2.evaluate(() => window.__badge) === 'set');
await page.evaluate(() => { window.__focus = true; window.dispatchEvent(new Event('focus')); });
check('0. retour du focus sur la fenêtre de la modale : pastille éteinte ici', await page.evaluate(() => window.__badge) === 'clear');
await page2.waitForFunction(() => window.__badge === 'clear', null, { timeout: 3000 }).catch(() => {});
check('0. … et dans l\'autre fenêtre', await page2.evaluate(() => window.__badge) === 'clear');
await page.evaluate(() => { window.__go.TAG0 = true; });
await waitClosed(page);
await page2.close();

// ── 1. Modale bloquante, fermée par la reprise du flux ──────────────────────
await sendIn('c1', 'TAGRA');
await waitOpen(page).catch(() => {});
check('1. prémisse : le chat a été sollicité', (await page.evaluate(() => window.__chatHits.TAGRA || 0)) >= 1);
check('1. prémisse : la période du chien de garde a été raccourcie', (await page.evaluate(() => window.__shortW)) > 0);
check('1. la modale s\'ouvre quand le flux se tait', await dialogOpen(page));
// Centrage : il vient du `margin: auto` du navigateur, qu'un reset global
// écrase sans bruit (modale collée en haut à gauche, vue le 2026-10-13).
// Containment des DEUX côtés, sur les deux axes : écart entre la marge gauche
// et la droite, entre la haute et la basse.
const geo = await page.evaluate(() => {
  const r = document.getElementById('stall-dialog').getBoundingClientRect();
  return { l: r.left, r: innerWidth - r.right, t: r.top, b: innerHeight - r.bottom, w: r.width, h: r.height };
});
check('1. la modale est centrée dans la fenêtre', geo.w > 0 && geo.h > 0
  && Math.abs(geo.l - geo.r) <= 2 && Math.abs(geo.t - geo.b) <= 2 && geo.l > 0 && geo.t > 0, JSON.stringify(geo));
let rows = await rowsOf(page);
check('1. une ligne, au titre de la conversation, sans mention d\'Espace', rows.length === 1 && rows[0].title === 'Conv c1' && !rows[0].space, JSON.stringify(rows));
check('1. compte à rebours affiché', rows[0] && /abandon automatique dans \d+:\d\d/.test(rows[0].status), rows[0] && rows[0].status);
const inert = await page.evaluate(() => { const c = document.getElementById('composer-text'); c.focus(); return document.activeElement !== c; });
check('1. la page sous la modale est inerte (le composer refuse le focus)', inert);
// UNE seule combinaison : le gestionnaire accepte Meta ET Control, deux
// appuis s'annuleraient (ouvrir puis refermer) et le contrôle passerait à vide.
await page.keyboard.press('Control+k');
check('1. les raccourcis globaux ne passent pas (palette restée fermée)', await page.evaluate(() => document.getElementById('cmdk-overlay').hidden));
// Si elle s'est ouverte (régression), la refermer : sinon elle intercepte les
// clics suivants et le script plante avant de rendre son rapport.
await page.evaluate(() => { if (_cmdkOpen) closeCommandPalette(); });
check('1. la génération est toujours en vol', await page.evaluate(() => isGenerating('c1')));
await page.evaluate(() => { window.__go.TAGRA = true; });
await page.waitForFunction(() => { const g = _activeGenerations.get('c1'); return g && g.partialContent; }, null, { timeout: 3000 }).catch(() => {});
// Avant la fin du stream (qui la fermerait de toute façon) : c'est la reprise
// elle-même qui doit la fermer.
const revived = await page.evaluate(() => ({ open: document.getElementById('stall-dialog').open, gen: isGenerating('c1') }));
check('1. le flux qui reprend ferme la modale tout seul, stream encore en vol', !revived.open && revived.gen, JSON.stringify(revived));
await page.evaluate(() => { window.__go.TAGRAEND = true; });
await page.waitForFunction(() => !isGenerating('c1'), null, { timeout: 4000 }).catch(() => {});
let a = await lastAssistant('c1');
check('1. la réponse arrive entière, non tronquée', a && a.content === 'Réponse TAGRA' && !a.truncated, JSON.stringify(a));
check('1. aucune erreur de connexion affichée', !(await composerError()), await composerError());

// ── 2. Escape = Attendre, la question revient, Attendre encore ──────────────
await sendIn('c2', 'TAGB');
await waitOpen(page);
await page.keyboard.press('Escape');
check('2. Escape ferme la modale', !(await dialogOpen(page)));
check('2. … sans couper la génération', await page.evaluate(() => isGenerating('c2')));
await waitOpen(page).catch(() => {});
check('2. la question revient à la période suivante', await dialogOpen(page));
await page.click('#stall-dialog button[data-act="wait"]');
check('2. « Attendre » ferme la modale', !(await dialogOpen(page)));
await waitOpen(page).catch(() => {});
check('2. et elle revient encore (pas de limite au nombre d\'attentes)', await dialogOpen(page));
await page.click('#stall-dialog button[data-act="wait"]');
await page.evaluate(() => { window.__go.TAGB = true; });
await page.waitForFunction(() => !isGenerating('c2'), null, { timeout: 4000 }).catch(() => {});
a = await lastAssistant('c2');
check('2. la réponse arrive entière après les attentes', a && a.content === 'Réponse TAGB' && !a.truncated, JSON.stringify(a));
check('2. aucune erreur de connexion affichée', !(await composerError()), await composerError());

// ── 3. Abandonner ───────────────────────────────────────────────────────────
await sendIn('c3', 'TAGPC');
await waitOpen(page);
await page.click('#stall-dialog button[data-act="abort"]');
await page.waitForFunction(() => !isGenerating('c3'), null, { timeout: 3000 }).catch(() => {});
check('3. « Abandonner » ferme la modale et arrête la génération', !(await dialogOpen(page)) && !(await page.evaluate(() => isGenerating('c3'))));
a = await lastAssistant('c3');
check('3. le partiel reçu est gardé, marqué tronqué', a && a.content === 'Début' && a.truncated, JSON.stringify(a));
check('3. l\'interruption est dite', /Connexion interrompue/.test(await composerError()), await composerError());

// ── 4. Plafond : modale sans réponse, connexion retenue ─────────────────────
await sendIn('c4', 'TAGH4');
await waitOpen(page);
const ceilBefore = await page.evaluate(() => window.__shortCeil);
check('4. prémisse : le plafond de la modale a été raccourci', ceilBefore > 0, ceilBefore);
await page.waitForFunction(() => !isGenerating('c4'), null, { timeout: 5000 }).catch(() => {});
check('4. sans réponse, la modale abandonne d\'elle-même au plafond', !(await page.evaluate(() => isGenerating('c4'))) && !(await dialogOpen(page)));
check('4. l\'interruption est dite', /Connexion interrompue/.test(await composerError()), await composerError());

// ── 5. Deux conversations, dont une dans un autre Espace ────────────────────
await page.evaluate(() => {
  saveSpaces(loadSpaces().concat([{ id: 'sp-autre', name: 'Boulot' }]));
  saveConversation({ id: 'c5b', title: 'Conv c5b', timestamp: Date.now(), updatedAt: Date.now(), spaceId: 'sp-autre',
    messages: [{ role: 'user', content: '[TAGF] message en arrière-plan' }] });
});
await sendIn('c5', 'TAGE');
await page.evaluate(() => runDetachedGeneration('c5b', loadConversation('c5b').messages.slice()));
await page.waitForFunction(() => document.querySelectorAll('#stall-dialog .stall-row').length === 2, null, { timeout: 4000 }).catch(() => {});
rows = await rowsOf(page);
const rE = rows.find(r => r.conv === 'c5'), rF = rows.find(r => r.conv === 'c5b');
check('5. deux lignes dans la même modale', rows.length === 2, JSON.stringify(rows));
check('5. la conversation de l\'Espace actif n\'en mentionne aucun', rE && !rE.space, JSON.stringify(rE));
check('5. l\'autre porte le nom de son Espace', rF && rF.space === 'Espace « Boulot »', JSON.stringify(rF));
await page.click('#stall-dialog .stall-row[data-conv="c5b"] button[data-act="abort"]');
await page.waitForFunction(() => !isGenerating('c5b'), null, { timeout: 3000 }).catch(() => {});
rows = await rowsOf(page);
check('5. abandonner une ligne la retire, la modale reste pour l\'autre', (await dialogOpen(page)) && rows.length === 1 && rows[0].conv === 'c5', JSON.stringify(rows));
check('5. … et n\'arrête que sa conversation', !(await page.evaluate(() => isGenerating('c5b'))) && (await page.evaluate(() => isGenerating('c5'))));
await page.evaluate(() => { window.__go.TAGE = true; });
await waitClosed(page).catch(() => {});
check('5. la dernière ligne qui revit ferme la modale', !(await dialogOpen(page)));

// ── 6. Agent : jamais de modale, coupé au plafond ───────────────────────────
await page.evaluate(() => {
  saveConversation({ id: 'c6a', parentConvId: 'c5', timestamp: Date.now(), updatedAt: Date.now(), spaceId: DEFAULT_SPACE_ID,
    agentIntent: 'agent de test', messages: [{ role: 'user', content: '[TAGG] tâche d\'agent' }] });
  window.__sawAgentRow = false;
  window.__dialogOpened = 0;
  const watch = setInterval(() => {
    if (document.getElementById('stall-dialog').open) window.__dialogOpened++;
    if (_stallRows.has('c6a')) window.__sawAgentRow = true;
  }, 50);
  window.__stopWatch = () => clearInterval(watch);
  // Même corps que le réveil d'un parent ; le prédicat de racine est lu sur le
  // record, donc ce record d'agent doit être traité en agent.
  runDetachedGeneration('c6a', loadConversation('c6a').messages.slice());
});
check('6. prémisse : l\'agent génère', await page.evaluate(() => isGenerating('c6a')));
await page.waitForFunction(() => !isGenerating('c6a'), null, { timeout: 6000 }).catch(() => {});
const agentState = await page.evaluate(() => { window.__stopWatch(); return { gen: isGenerating('c6a'), saw: window.__sawAgentRow, opened: window.__dialogOpened, hits: window.__chatHits.TAGG || 0 }; });
check('6. prémisse : le chat de l\'agent a été sollicité', agentState.hits >= 1, agentState.hits);
check('6. aucune modale pour un agent', !agentState.saw && agentState.opened === 0, JSON.stringify(agentState));
check('6. l\'agent est coupé au plafond', !agentState.gen, JSON.stringify(agentState));

await browser.close();

let failed = 0;
for (const [n, ok, d] of results) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (d ? '  — ' + d : '')); if (!ok) failed++; }
if (consoleErrors.length) { console.log('Console errors:\n' + JSON.stringify(consoleErrors, null, 2)); failed++; }
console.log(failed ? failed + ' échec(s)' : 'tout vert');
process.exitCode = failed ? 1 : 0;
