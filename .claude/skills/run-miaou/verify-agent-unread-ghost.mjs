#!/usr/bin/env node
// Pastille fantôme après des agents terminés — reproduction du cas signalé en
// usage réel (Julien, 2026-09-05) puis contrôle du correctif.
//
// SYMPTÔME : trois agents lancés depuis une même conversation, tous terminés
// depuis plusieurs minutes, plus aucune génération en vol, toutes les
// conversations lues. La pastille reste néanmoins allumée sur le hamburger
// (sidebar repliée) et, en dépliant le menu d'Espaces, sur la ligne de l'Espace
// courant — alors que la liste des conversations, elle, est vierge.
//
// MÉCANISME : `unregisterGeneration` (main.js) marque `unread` dès que
// `genOwnsScreen(gen)` est faux. Une génération d'AGENT n'est jamais à l'écran
// (les agents sont exclus de la sidebar, on n'y bascule pas au spawn) : chaque
// agent qui finit se marque donc `unread`. Symétriquement `markConvRead` n'a
// qu'un point d'appel, `openConversation` — ouvrir le PARENT ne nettoie rien
// pour ses enfants. Le marqueur survit à toute la session.
//
// Il ne se voit que sur les AGRÉGATS parce qu'eux seuls balaient
// `listAllConversations()` sans filtrer `isRootConversation`, là où
// `renderConvList` l'applique. D'où la signature exacte du rapport : agrégats
// allumés, liste de détail vide — un état qu'aucun dépliage ne peut expliquer,
// ce qui contredit frontalement le corollaire du dépliage (docs/badges.md :
// replié demande « y a-t-il de l'activité ailleurs ? », déplié « où
// exactement ? » — et le déplié doit pouvoir répondre).
//
// CE QUE CE SCRIPT ASSERTE : l'état ATTENDU APRÈS correctif. Il échoue donc sur
// le bundle actuel (c'est le point : la reproduction est l'échec) et passe une
// fois le correctif en place, SANS retouche.
//
// Il exerce aussi les deux non-régressions que le correctif pourrait casser :
//   - `working` reste porté par le parent pendant que ses agents tournent
//     (docs/badges.md, extension X-1) — la correction ne doit pas rendre les
//     agents invisibles PENDANT leur travail, seulement après ;
//   - une conversation RACINE qui finit hors écran donne toujours `unread`
//     (le comportement nominal T-2), et s'éteint à son ouverture.
//
// NON-VACUITÉ — mesurée le 2026-09-05, régression par régression, en
// réinjectant dans `src/`, rebuildant, relançant, puis restaurant. Ce qui suit
// est le RÉSULTAT observé, pas l'intention :
//
//   les DEUX gardes retirées (état d'avant correctif) .......... 9 contrôles
//   filtre de racine retiré de unregisterGeneration seul ....... 2 contrôles
//   filtre de racine retiré des deux agrégats seul ............. 0 — VERT
//
// RÉSULTAT NÉGATIF, gardé parce qu'il vaut plus que les positifs : la garde des
// agrégats (`isRootConversation` sur la boucle des conversations) est
// INVÉRIFIABLE par ce script tant que la garde de source tient. C'est logique —
// si aucun agent ne porte de non-lu, filtrer les agents ne change rien — mais il
// fallait le constater plutôt que de le supposer, et surtout ne pas croire que
// les neuf contrôles verts « couvrent » les deux gardes. Ils en couvrent une.
//
// La garde des agrégats reste néanmoins au code, en défense : elle porte
// l'invariant « un agrégat ne remonte rien qu'aucune surface de détail ne puisse
// expliquer », qui doit tenir même si un futur chemin réintroduisait un non-lu
// d'agent (une réouverture d'agent depuis un lien, un statut porté autrement).
// Un test qui la mesurerait devrait fabriquer cet état à la main
// (`_unreadConvs.add(agentId)`) — ce serait tester le filtre contre lui-même
// plutôt que contre un scénario, donc de peu de valeur ; le choix assumé est de
// la documenter comme non couverte.
//
// Montage : stub SSE gaté par conversation, repris de verify-agents.mjs (lui-même
// de verify-generations.mjs) — étiquetage MARK-<T> pour un fil racine, AGENT-<T>
// pour un fil d'agent, priorité au second (le message de réveil du parent
// contient le texte de l'agent, donc son marqueur).
//
// Usage : node verify-agent-unread-ghost.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-agent-unread-ghost');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// ── Stub SSE gaté par conversation ──────────────────────────────────────────
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',   // pas de bannière : elle bloquerait dispatchSend
    }));
  } catch (e) {}

  window.__sent = [];
  window.__gates = {};
  window.__released = {};
  window.__spawns = {};     // tag → { prompt, intent, tools } (un seul agent par tour)
  window.__multi = {};      // tag → [ { prompt, intent }, … ] (plusieurs d'un coup)

  const tagOf = (body) => {
    const msgs = (body && body.messages) || [];
    const txtOf = (m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) return m.content.map(p => (p && p.text) || '').join(' ');
      return '';
    };
    for (const m of msgs) {
      if (m.role !== 'user') continue;
      const t = txtOf(m);
      const hit = t.match(/AGENT-([A-Z0-9]+)/);
      return hit ? 'A:' + hit[1] : (() => {
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role !== 'user') continue;
          const h2 = txtOf(msgs[i]).match(/MARK-([A-Z0-9]+)/);
          if (h2) return 'P:' + h2[1];
        }
        return '?';
      })();
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

    // Appels SILENCIEUX (titrage, résumé) : leur payload est une transcription
    // qui porte nos marqueurs et fausserait tous les comptages.
    if (body.stream !== true) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Titre stub' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const tag = tagOf(body);
    window.__sent.push({ tag, body });

    const enc = new TextEncoder();
    const hasToolResult = (body.messages || []).some(m => m.role === 'tool');
    const spawn = !hasToolResult ? window.__spawns[tag] : null;
    const multi = !hasToolResult ? window.__multi[tag] : null;

    const holdOn = async () => {
      while (window.__gates[tag] && !window.__released[tag]) {
        if (opts && opts.signal && opts.signal.aborted) {
          const err = new Error('aborted'); err.name = 'AbortError'; throw err;
        }
        await new Promise(r => setTimeout(r, 20));
      }
    };

    return new Response(new ReadableStream({
      async start(controller) {
        const send = (o) => controller.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'));
        const toolCall = (idx, name, args) => {
          send({ choices: [{ delta: { tool_calls: [{ index: idx, id: 'call_' + tag + '_' + idx,
            type: 'function', function: { name: name, arguments: JSON.stringify(args) } }] } }] });
        };
        const closeWith = (finish) => {
          send({ choices: [{ delta: {}, finish_reason: finish }] });
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        };

        try {
          // Plusieurs spawns dans le MÊME tour : c'est le cas réel signalé
          // (trois agents en parallèle), et il compte — un seul agent laisserait
          // croire que le fantôme est lié à l'unicité.
          if (multi) {
            multi.forEach((sp, i) => toolCall(i, 'miaou__agent__spawn', {
              prompt: sp.prompt, intent: sp.intent, tools: [],
            }));
            await holdOn();
            closeWith('tool_calls');
            return;
          }
          if (spawn) {
            toolCall(0, 'miaou__agent__spawn', {
              prompt: spawn.prompt, intent: spawn.intent, tools: [],
            });
            await holdOn();
            closeWith('tool_calls');
            return;
          }
          send({ choices: [{ delta: { content: 'Début-' + tag + '. ' } }] });
          await holdOn();
          send({ choices: [{ delta: { content: 'Fin-' + tag + '.' } }] });
          closeWith('stop');
        } catch (e) {
          controller.error(e);
        }
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
};

const browser = await chromium.launch({ headless: !headed });
const context = await browser.newContext({ viewport: { width: 1100, height: 820 } });
await context.addInitScript(initScript);

const errors = [];
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
const shot = async (n) => { await page.screenshot({ path: path.join(outDir, n) }); console.log('  shot  ' + n); };

// Les porteurs de pastille EXISTENT toujours en DOM : applyActivityBadge pose
// `hidden`, il ne retire pas le noeud (activityBadgeEl en crée un pour chaque
// ligne, y compris à l'état null ; hamburger et sélecteur vivent en permanence
// dans le markup). Compter les `.activity-dot` présents mesurerait donc le
// markup, pas ce que l'utilisateur voit — on interroge la VISIBILITÉ.
// Erreur payée à la première exécution de ce script : trois assertions vertes
// par construction, dont une qui prétendait compter les pastilles de la liste.
const visibleDots = (sel) => page.evaluate(
  (s) => Array.from(document.querySelectorAll(s))
    .filter(el => !el.hidden && el.offsetParent !== null).length, sel);
const oneVisibleDot = async (sel) => (await visibleDots(sel)) > 0;

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => !!document.querySelector('.boot-done'), null, { timeout: 15000 });
await page.waitForTimeout(300);

const gate = (tag) => page.evaluate((t) => { window.__gates[t] = true; }, tag);
const release = (tag) => page.evaluate((t) => { window.__released[t] = true; }, tag);
const resetStub = () => page.evaluate(() => {
  window.__gates = {}; window.__released = {}; window.__spawns = {};
  window.__multi = {}; window.__sent = [];
});
const send = async (text) => {
  await page.fill('#composer-text', text);
  await page.press('#composer-text', 'Enter');
};
const newConv = async () => {
  await page.evaluate(() => resetToEmpty());
  await page.waitForTimeout(120);
};
const waitSent = (tag) => page.waitForFunction(
  (t) => window.__sent.some(x => x.tag === t), tag, { timeout: 10000 });
const waitIdle = () => page.waitForFunction(
  () => _activeGenerations.size === 0, null, { timeout: 15000 });

// ── Fixtures : deux Espaces nommés en plus du défaut ─────────────────────────
// Sans un second Espace, « agrégat de l'Espace courant » et « agrégat de tout »
// ne peuvent pas diverger, et le scénario ne distinguerait pas les surfaces
// (docs/badges.md, méthode 3 du verify-badges : il FAUT un cas où « tout » et
// « ailleurs » divergent).
console.log('\n— Fixtures');
const fx = await page.evaluate(() => {
  const mk = (name) => { const all = upsertSpace({ name }); return all[all.length - 1].id; };
  return { spA: mk('Espace Alpha'), spB: mk('Espace Beta') };
});
check('fixtures : deux Espaces nommés en plus du défaut',
  await page.evaluate(() => loadSpaces().length >= 3));

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 1 : TROIS agents en parallèle, tous terminés, conversation lue
// ═════════════════════════════════════════════════════════════════════════════
// La reproduction fidèle du cas signalé. On reste dans l'Espace Alpha du début
// à la fin — l'utilisateur ne quitte jamais l'Espace où il travaille.
console.log('\n— Scénario 1 : trois agents terminés, tout lu, plus rien en vol');
await page.evaluate((id) => followSpace(id), fx.spA);
await page.waitForTimeout(150);
await resetStub();
await newConv();

await page.evaluate(() => {
  window.__multi['P:P1'] = [
    { prompt: 'AGENT-A1 premier travail.', intent: 'Relever les limites de js__eval' },
    { prompt: 'AGENT-A2 deuxième travail.', intent: 'Compter les tours max' },
    { prompt: 'AGENT-A3 troisième travail.', intent: 'Rédiger la synthèse' },
  ];
});
await gate('A:A1'); await gate('A:A2'); await gate('A:A3');
await send('MARK-P1 lance trois agents.');
await waitSent('P:P1');
await release('P:P1');
await page.waitForTimeout(600);

const parentId = await page.evaluate(() => currentConvId);
const agentIds = await page.evaluate(
  (p) => agentChildrenOf(p, listAllConversations()).map(c => c.id), parentId);
check('1. trois agents ont été créés', agentIds.length === 3);
check('1. les trois tournent', await page.evaluate(
  (ids) => ids.every(id => isGenerating(id)), agentIds));

// PENDANT le travail : le parent porte `working` et les agrégats aussi.
// Non-régression du correctif — il ne doit éteindre QUE l'après.
let s = await page.evaluate(([p, spA, spB]) => ({
  parent: convBadgeState(p, listAllConversations()),
  spaceA: spaceBadgeState(spA),
  spaceB: spaceBadgeState(spB),
  aggAll: aggregateBadgeState(null),
  domDot: !!document.querySelector('.conv .activity-dot.working'),
}), [parentId, fx.spA, fx.spB]);
check('1. PENDANT : le parent porte working (extension X-1)', s.parent === 'working');
check('1. PENDANT : l\'agrégat de son Espace aussi', s.spaceA === 'working');
check('1. PENDANT : l\'agrégat hamburger aussi', s.aggAll === 'working');
check('1. PENDANT : l\'autre Espace reste muet', s.spaceB === null);
check('1. PENDANT : la pastille est peinte sur la ligne du parent', s.domDot === true);
await shot('01-pendant-trois-agents.png');

// Les trois finissent. Le parent est réveillé trois fois et répond ; on attend
// le retour complet au repos (plus AUCUNE génération, ni agent ni parent) —
// c'est l'état décrit par le rapport (« ils avaient tous fini depuis plusieurs
// minutes »).
await release('A:A1'); await release('A:A2'); await release('A:A3');
await page.waitForTimeout(300);
await release('P:P1');
await waitIdle();
await page.waitForTimeout(800);
await waitIdle();

check('2. plus AUCUNE génération en vol',
  await page.evaluate(() => _activeGenerations.size === 0));
check('2. les trois agents sont en statut terminal',
  await page.evaluate((ids) => ids.every(id => {
    const c = loadConversation(id);
    return c && c.agentStatus && c.agentStatus !== 'running';
  }), agentIds));

// L'utilisateur a « tout lu » : il est resté sur la conversation parente, qui
// est donc affichée. On la rouvre explicitement pour matérialiser le geste de
// lecture, comme il l'aurait fait au retour.
await page.evaluate((p) => selectConv(p), parentId);
await page.waitForTimeout(400);
check('2. la conversation parente est bien celle affichée',
  await page.evaluate((p) => currentConvId === p, parentId));
check('2. elle n\'est plus marquée non lue',
  await page.evaluate((p) => convBadgeState(p, listAllConversations()) === null, parentId));

// ── LE CŒUR : aucune surface ne doit plus rien porter ────────────────────────
// L'assertion est écrite sur l'état ATTENDU (rien nulle part), pas sur le
// symptôme. C'est ce qui la rend utilisable telle quelle des deux côtés du
// correctif.
s = await page.evaluate(([p, spA, spB, ids]) => {
 const vis = (sel) => Array.from(document.querySelectorAll(sel))
   .filter(el => !el.hidden && el.offsetParent !== null).length;
 return ({
  parent: convBadgeState(p, listAllConversations()),
  spaceA: spaceBadgeState(spA),
  spaceB: spaceBadgeState(spB),
  aggAll: aggregateBadgeState(null),
  aggElsewhere: aggregateBadgeState(spA),
  agentStates: ids.map(id => convBadgeState(id, listAllConversations())),
  // Les deux porteurs permanents du DOM, lus tels que l'utilisateur les voit —
  // donc sur la VISIBILITÉ, jamais la présence du noeud (cf. visibleDots).
  hamburgerDot: vis('#sidebar-toggle .activity-dot') > 0,
  selectDot: vis('#space-select-btn .activity-dot') > 0,
  // La liste de gauche, la surface de DÉTAIL : c'est son silence qui rend le
  // fantôme inexplicable (rien à déplier pour justifier l'agrégat).
  listDots: vis('#conv-list .activity-dot'),
 });
}, [parentId, fx.spA, fx.spB, agentIds]);

check('3. la liste de conversations ne porte aucune pastille', s.listDots === 0);
check('3. le parent ne porte plus rien', s.parent === null);
check('3. AUCUN agent terminé ne porte de non-lu résiduel',
  s.agentStates.every(x => x === null));
check('3. l\'agrégat de l\'Espace courant est muet (rien à expliquer au dépliage)',
  s.spaceA === null);
check('3. l\'agrégat de l\'autre Espace est muet', s.spaceB === null);
check('3. l\'agrégat hamburger (rien d\'exclu) est muet', s.aggAll === null);
check('3. l\'agrégat « ailleurs » est muet', s.aggElsewhere === null);
check('3. le hamburger ne peint aucune pastille', s.hamburgerDot === false);
check('3. le sélecteur d\'Espaces replié non plus', s.selectDot === false);
await shot('02-apres-tout-termine.png');

// Le geste exact du rapport : replier la sidebar, regarder le hamburger.
// La surface est alors la SEULE visible — et un agrégat qui ment n'y est
// contredit par rien.
await page.evaluate(() => { if (document.querySelector('.app.sidebar-open')) toggleSidebar(); });
await page.waitForTimeout(300);
check('4. sidebar repliée : le hamburger reste muet',
  (await visibleDots('#sidebar-toggle .activity-dot')) === 0);
await shot('03-sidebar-repliee-hamburger.png');

// Et le second geste : déplier le menu d'Espaces, où le fantôme se posait sur
// la ligne de l'Espace courant.
await page.evaluate(() => { if (!document.querySelector('.app.sidebar-open')) toggleSidebar(); });
await page.waitForTimeout(200);
await page.evaluate(() => toggleSpaceMenu());
await page.waitForTimeout(300);
check('4. menu d\'Espaces déplié : aucune ligne ne porte de pastille',
  (await visibleDots('.space-menu .activity-dot')) === 0);
await shot('04-menu-espaces-deplie.png');
await page.evaluate(() => { const m = document.querySelector('.space-menu.show'); if (m) toggleSpaceMenu(); });
await page.waitForTimeout(200);

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 5 : NON-RÉGRESSION — le non-lu d'une conversation RACINE survit
// ═════════════════════════════════════════════════════════════════════════════
// Le correctif restreint le marquage aux racines : il faut donc prouver que le
// comportement nominal T-2 est intact, sans quoi « plus de pastille nulle part »
// serait vert pour la pire des raisons (le non-lu entièrement neutralisé).
console.log('\n— Scénario 5 : non-régression du non-lu sur une conversation racine');
await resetStub();
await newConv();
await gate('P:P5');
await send('MARK-P5 question longue.');
await waitSent('P:P5');
const rootId = await page.evaluate(() => currentConvId);

// On part regarder AILLEURS pendant qu'elle génère : c'est la définition même
// du non-lu (la génération finit hors écran).
await newConv();
await page.waitForTimeout(200);
check('5. l\'écran a quitté la conversation qui génère',
  await page.evaluate((r) => currentConvId !== r, rootId));
await release('P:P5');
await waitIdle();
await page.waitForTimeout(400);

s = await page.evaluate(([r, spA]) => ({
  root: convBadgeState(r, listAllConversations()),
  spaceA: spaceBadgeState(spA),
  aggAll: aggregateBadgeState(null),
  listUnread: Array.from(document.querySelectorAll('#conv-list .activity-dot.unread'))
    .filter(el => !el.hidden && el.offsetParent !== null).length,
}), [rootId, fx.spA]);
check('5. une RACINE finie hors écran porte bien unread', s.root === 'unread');
check('5. l\'agrégat de son Espace le reflète', s.spaceA === 'unread');
check('5. l\'agrégat hamburger aussi', s.aggAll === 'unread');
check('5. et la liste de gauche l\'affiche — le déplié EXPLIQUE l\'agrégat',
  s.listUnread === 1);
await shot('05-racine-non-lue.png');

// L'ouvrir l'éteint partout : le cycle complet, pas seulement le marquage.
await page.evaluate((r) => selectConv(r), rootId);
await page.waitForTimeout(400);
s = await page.evaluate(([r, spA]) => ({
  root: convBadgeState(r, listAllConversations()),
  spaceA: spaceBadgeState(spA),
  aggAll: aggregateBadgeState(null),
  hamburgerDot: Array.from(document.querySelectorAll('#sidebar-toggle .activity-dot'))
    .filter(el => !el.hidden && el.offsetParent !== null).length > 0,
}), [rootId, fx.spA]);
check('5. l\'ouvrir l\'éteint sur la conversation', s.root === null);
check('5. …et sur l\'agrégat de son Espace', s.spaceA === null);
check('5. …et sur le hamburger', s.aggAll === null && s.hamburgerDot === false);
await shot('06-racine-lue.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 6 : un agent OUVERT explicitement puis quitté en cours de travail
// ═════════════════════════════════════════════════════════════════════════════
// Cas limite nommé en analyse : l'utilisateur ouvre un agent (lien d'ack), le
// quitte pendant qu'il travaille, l'agent finit hors écran. Sous le correctif il
// ne pose PAS de non-lu — et c'est acceptable parce que le parent, réveillé par
// cette fin, reprend un tour et porte donc son propre working/unread. On vérifie
// que l'information n'est pas perdue : c'est le parent qui la porte.
console.log('\n— Scénario 6 : agent ouvert puis quitté pendant son travail');
await resetStub();
await newConv();
await page.evaluate(() => { window.__spawns['P:P6'] = {
  prompt: 'AGENT-A6 travail observé.', intent: 'Travail observé' }; });
await gate('A:A6');
await send('MARK-P6 lance un agent.');
await waitSent('P:P6');
await release('P:P6');
await page.waitForTimeout(500);
const parent6 = await page.evaluate(() => currentConvId);
const agent6 = await page.evaluate(
  (p) => (agentChildrenOf(p, listAllConversations())[0] || {}).id || '', parent6);

// On ouvre l'agent, puis on part ailleurs — l'écran ne le possède plus.
await page.evaluate((a) => selectConv(a), agent6);
await page.waitForTimeout(300);
check('6. l\'agent est ouvert à l\'écran',
  await page.evaluate((a) => currentConvId === a, agent6));
await page.evaluate((p) => selectConv(p), parent6);
await page.waitForTimeout(250);

// Le parent est gaté sur son tour de réveil : il reste occupé après la fin de
// l'agent, ce qui rend le contrôle observable sans course.
await gate('P:P6');
await page.evaluate(() => { window.__released['P:P6'] = false; });
await release('A:A6');
await page.waitForFunction((a) => !isGenerating(a), agent6, { timeout: 10000 });
await page.waitForTimeout(300);

s = await page.evaluate(([p, a]) => ({
  agent: convBadgeState(a, listAllConversations()),
  parentWorking: isGenerating(p),
}), [parent6, agent6]);
check('6. l\'agent terminé ne porte pas de non-lu', s.agent === null);
check('6. l\'information n\'est pas perdue : le parent a repris un tour',
  s.parentWorking === true);
await release('P:P6');
await waitIdle();
await page.waitForTimeout(400);
await shot('07-agent-ouvert-puis-quitte.png');

// ═════════════════════════════════════════════════════════════════════════════
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
