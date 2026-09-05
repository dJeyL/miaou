#!/usr/bin/env node
// Filet de sécurité : pas de réécriture d'historique tant qu'un agent travaille.
//
// CE QUI EST GARDÉ. Deux gestes réécrivent le fil d'une conversation :
// l'édition d'un message utilisateur passé (`editUserMessage`) et la
// régénération de la dernière réponse (`regenerateResponse`). Les deux
// TRONQUENT le thread puis relancent une génération. Interdits tant qu'un agent
// de cette conversation est en vol.
//
// POURQUOI. Le motif n'est pas la concurrence d'écriture — un agent écrit dans
// SON thread, jamais dans celui de son parent (piège 28). C'est la cohérence de
// ce que l'agent finira par réveiller : le parent reprend un tour à la fin de
// son enfant, avec un compte rendu qui répond au fil TEL QU'IL ÉTAIT au spawn.
// Tronquer entre-temps fait atterrir ce compte rendu derrière un historique qui
// ne pose plus la question à laquelle il répond.
//
// POURQUOI `sending` NE SUFFISAIT PAS. Les deux gestes gardaient déjà sur
// `sending`, mais `sending` est un reflet d'ÉCRAN depuis T-1 (piège 28) : il
// dit « la conversation AFFICHÉE génère », pas « une génération tourne ». Un
// parent inerte dont trois agents travaillent a `sending === false` — les deux
// boutons étaient donc pleinement actifs, et c'est exactement l'état d'un
// utilisateur qui vient de lancer des agents et attend.
//
// PRÉDICAT. `hasWorkingAgent` (agents.js), le même que les gardes de
// suppression, de déplacement et de badge — jamais un balayage réécrit
// localement (piège 18).
//
// TROIS NIVEAUX, et le script les exerce séparément parce qu'ils tombent
// séparément :
//   1. la MUTATION (main.js) — la seule qui protège vraiment le thread ;
//   2. les AFFORDANCES — les deux glyphes (crayon, régénération) GRISÉS avec
//      `cursor: not-allowed` et un `title` qui donne la raison, via la classe
//      `body.agent-busy` posée par `syncAgentBusyAffordances` ; avec ses deux
//      rappels au cycle de vie de la génération (sans eux la garde serait
//      juste et l'affichage périmé) ;
//   3. le REFUS AU CLIC — `enterEditMode` et `regenerateResponse` refusent même
//      si le geste part quand même (DOM périmé, appel direct).
//
// Grisé et non masqué : un bouton qui disparaît puis revient se lit comme un
// bug d'affichage, alors qu'un bouton grisé au curseur « interdit » dit à la
// fois l'état et sa raison. Même vocabulaire que la case de déplacement d'une
// conversation dont un agent tourne.
//
// ET LE RETOUR. Une garde qui ne se lève pas est une fonctionnalité perdue : le
// scénario 4 vérifie que les deux gestes redeviennent possibles quand le
// dernier agent a fini. C'est le contrôle qui attrape un rappel manquant dans
// `unregisterGeneration`.
//
// NON-VACUITÉ — mesurée le 2026-09-05 par réinjection dans `src/`, rebuild,
// relance, restauration. Résultats observés :
//
//   les deux gardes de mutation retirées ................. 4 contrôles
//   classe body.agent-busy jamais posée .................. 7 contrôles
//   garde de refus d'édition (enterEditMode) retirée ..... 2 contrôles
//   rappel de syncLastAssistantActions au spawn retiré ... 1 contrôle
//   rappel de syncLastAssistantActions à la fin retiré ... 2 contrôles
//   `cursor: not-allowed` retiré du CSS .................. 3 contrôles
//
// DEUX RÉSULTATS NÉGATIFS, gardés parce qu'ils ont changé le script :
//
//   1. Les deux rappels de `syncLastAssistantActions` (spawn / fin) ne
//      faisaient tomber AUCUN contrôle dans la première version. Motif : dans
//      le cas courant, le spawn comme la fin passent par un tour du parent,
//      donc par `setSending`, qui repeint déjà. Les rappels paraissaient
//      redondants — ils ne le sont que dans ce cas-là. Le scénario 5 construit
//      l'autre : un agent lancé par une génération DÉTACHÉE, et un agent qui
//      finit sans réveiller le parent. C'est là, et seulement là, que les deux
//      rappels sont la seule chose qui repeigne.
//   2. Le contrôle « la fin du second agent a repeint » ne discriminait rien
//      tant que le PREMIER agent tournait encore : la classe devait rester
//      posée, ce qui est vrai avec ou sans rappel. Il fallait libérer le
//      premier agent d'abord — sans quoi le contrôle mesurait une tautologie.
//
// Montage : stub SSE gaté par conversation, repris de verify-agents.mjs.
//
// Usage : node verify-agent-busy-rewrite.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-agent-busy-rewrite');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',
    }));
  } catch (e) {}

  window.__sent = [];
  window.__gates = {};
  window.__released = {};
  window.__spawns = {};

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

    if (body.stream !== true) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Titre stub' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const tag = tagOf(body);
    window.__sent.push({ tag, body });

    const enc = new TextEncoder();
    const hasToolResult = (body.messages || []).some(m => m.role === 'tool');
    const spawn = !hasToolResult ? window.__spawns[tag] : null;

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
        const closeWith = (finish) => {
          send({ choices: [{ delta: {}, finish_reason: finish }] });
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        };
        try {
          if (spawn) {
            send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + tag,
              type: 'function', function: { name: 'miaou__agent__spawn',
                arguments: JSON.stringify({ prompt: spawn.prompt, intent: spawn.intent, tools: [] }) } }] } }] });
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

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => !!document.querySelector('.boot-done'), null, { timeout: 15000 });
await page.waitForTimeout(300);

const gate = (tag) => page.evaluate((t) => { window.__gates[t] = true; }, tag);
const release = (tag) => page.evaluate((t) => { window.__released[t] = true; }, tag);
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
// Visibilité RÉELLE : `hidden` sur un bouton d'action ne retire pas le noeud
// (leçon du verify des pastilles fantômes — compter les noeuds mesure le
// markup, pas ce que l'utilisateur peut cliquer).
const regenVisible = () => page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('#thread .msg.assistant')];
  const last = bubbles[bubbles.length - 1];
  if (!last) return 'no-bubble';
  const btn = last.querySelector('.msg-regen');
  if (!btn) return 'no-btn';
  return !btn.hidden && btn.offsetParent !== null;
});

// État GRISÉ d'un glyphe, mesuré sur le style CALCULÉ — jamais sur la présence
// de la classe, qui dirait seulement que le JS a fait son travail et non que la
// cascade a suivi (une règle plus spécifique ailleurs suffirait à l'annuler).
// Le `title` est lu au passage : il porte la raison, et c'est lui qui distingue
// « désactivé » de « cassé ».
const glyphState = (sel) => page.evaluate((s) => {
  const btn = document.querySelector(s);
  if (!btn) return { missing: true };
  const cs = getComputedStyle(btn);
  return {
    opacity: parseFloat(cs.opacity),
    cursor: cs.cursor,
    title: btn.title || '',
    visible: !btn.hidden && btn.offsetParent !== null,
  };
}, sel);

// ═════════════════════════════════════════════════════════════════════════════
// Mise en place : un parent avec un ÉCHANGE COMPLET, puis un agent en vol
// ═════════════════════════════════════════════════════════════════════════════
// L'échange préalable compte : sans un message user ET une réponse assistant
// ANTÉRIEURS au spawn, il n'y aurait rien à éditer ni à régénérer, et le
// scénario testerait le vide.
console.log('\n— Mise en place : échange complet, puis agent lancé');
await newConv();
await send('MARK-P0 première question.');
await page.waitForFunction(() => _activeGenerations.size === 0, null, { timeout: 10000 });
await page.waitForTimeout(400);
const convId = await page.evaluate(() => currentConvId);

check('un échange complet est en place (user + assistant)',
  await page.evaluate((c) => {
    const m = loadConversation(c).messages || [];
    return m.some(x => x.role === 'user') && m.some(x => x.role === 'assistant');
  }, convId));
check('AVANT le spawn : le bouton régénérer est offert', await regenVisible() === true);
const restRegen = await glyphState('#thread .msg.assistant:last-of-type .msg-regen');
const restEdit = await glyphState('#thread .msg.user .msg-edit');
check('AVANT le spawn : le glyphe régénérer n\'est pas grisé',
  restRegen.opacity === 1 && restRegen.cursor !== 'not-allowed');
check('AVANT le spawn : le crayon non plus',
  restEdit.opacity === 1 && restEdit.cursor !== 'not-allowed');
// Les libellés de repos, capturés AVANT la garde : le scénario 4 vérifiera
// qu'ils reviennent à l'identique. Les recopier en dur ici les figerait dans
// deux endroits (project_duplicated_doc_content_drifts_both_ways) — on relit
// ce que l'appli affiche réellement.
check('AVANT le spawn : les deux glyphes portent leur libellé normal',
  restRegen.title.length > 0 && restEdit.title.length > 0);
const threadBefore = await page.evaluate((c) => (loadConversation(c).messages || []).length, convId);

// L'agent est gaté : il travaille pendant tout le scénario.
await page.evaluate(() => { window.__spawns['P:P1'] = {
  prompt: 'AGENT-A1 travail long.', intent: 'Analyser le corpus' }; });
await gate('A:A1');
await send('MARK-P1 lance un agent.');
await waitSent('P:P1');
await release('P:P1');
await page.waitForTimeout(600);

const agentId = await page.evaluate(
  (p) => (agentChildrenOf(p, listAllConversations())[0] || {}).id || '', convId);
check('un agent tourne sur cette conversation',
  await page.evaluate((a) => isGenerating(a), agentId) === true);
check('le parent, lui, est INERTE (c\'est tout le sujet)',
  await page.evaluate((p) => !isGenerating(p), convId) === true);
// LA prémisse du lot : sans elle, `sending` aurait suffi et la garde serait
// sans objet. On la mesure au lieu de la supposer.
check('…et `sending` est donc FAUX : la garde sur sending ne pouvait rien voir',
  await page.evaluate(() => sending === false) === true);
check('hasWorkingAgent, lui, répond vrai',
  await page.evaluate((p) => hasWorkingAgent(p), convId) === true);
await shot('01-agent-en-vol.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 1 : la MUTATION est refusée — édition
// ═════════════════════════════════════════════════════════════════════════════
// Le contrôle qui compte : on appelle editUserMessage DIRECTEMENT, en
// court-circuitant toute affordance. C'est le seul niveau qui protège le
// thread ; les deux autres ne protègent qu'un clic.
console.log('\n— Scénario 1 : editUserMessage refuse et ne mute rien');
const editIdx = await page.evaluate(
  () => currentThread.reduce((acc, m, i) => (m.role === 'user' ? Math.min(acc, i) : acc), 1e9));
const editOut = await page.evaluate(
  ([i]) => editUserMessage(i, 'TEXTE RÉÉCRIT QUI NE DOIT JAMAIS ATTERRIR'), [editIdx]);
check('1. editUserMessage rend un message de refus (pas un null silencieux)',
  typeof editOut === 'string' && editOut.length > 0);
check('1. le refus NOMME l\'agent comme cause',
  typeof editOut === 'string' && /agent/i.test(editOut));
check('1. le thread n\'a pas été tronqué',
  await page.evaluate((c) => (loadConversation(c).messages || []).length, convId) >= threadBefore);
check('1. le texte de remplacement n\'est nulle part dans le fil',
  await page.evaluate((c) => !(loadConversation(c).messages || []).some(
    m => String(m.content || '').indexOf('NE DOIT JAMAIS ATTERRIR') >= 0), convId) === true);
check('1. aucune génération n\'a été relancée sur le parent',
  await page.evaluate((p) => !isGenerating(p), convId) === true);

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 2 : la MUTATION est refusée — régénération
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n— Scénario 2 : regenerateResponse ne tronque pas');
// INDÉPENDANT du scénario 1, à dessein. Mesurer « la longueur n'a pas bougé »
// enchaînerait les deux : si le scénario 1 avait tronqué (garde absente), il
// aurait relancé une génération, `sending` serait vrai, et regenerateResponse
// sortirait sur SA garde `sending` — le scénario 2 passerait au vert en
// mesurant l'effet du bug précédent. Le repère est donc la PRÉSENCE de la
// dernière réponse assistant, invariante, et l'état du thread est réaffirmé
// avant de tirer.
check('2. (préalable) le parent ne génère pas — sinon on mesurerait `sending`',
  await page.evaluate((p) => !isGenerating(p), convId) === true);
// Le fil est REMIS dans un état où la régénération a réellement quelque chose à
// tronquer : une réponse assistant APRÈS le dernier message user. Sans ce
// préalable, un scénario 1 non gardé aurait déjà tronqué jusqu'au dernier user,
// et `regenerateResponse` couperait à un point déjà atteint — le contrôle
// serait vert sans rien prouver (une des sept formes du contrôle vert qui ne
// prouve rien : la prémisse fausse).
await page.evaluate(() => {
  const lastUser = currentThread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
  const after = currentThread.slice(lastUser + 1).filter(m => m.role === 'assistant').length;
  if (!after) {
    currentThread.push({ role: 'assistant', content: 'TÉMOIN-REGEN', model: 'stub-model', ts: Date.now() });
    persistCurrent();
    rerenderCurrentThread();
  }
});
await page.waitForTimeout(200);
check('2. (préalable) une réponse assistant suit le dernier message user',
  await page.evaluate(() => {
    const lastUser = currentThread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
    return currentThread.slice(lastUser + 1).some(m => m.role === 'assistant');
  }) === true);
// Le témoin est le CONTENU de la dernière réponse, pas un compte ni
// `isGenerating`. Les deux sont aveugles ici : le stub répond instantanément, si
// bien qu'une régénération non gardée tronque PUIS repeuple — 400 ms plus tard
// le fil a le même nombre de messages, les mêmes rôles, et plus rien en vol.
// Seul le texte distingue « on n'a pas touché » de « on a refait ». Marqueur
// posé juste avant, donc impossible à reproduire par une régénération.
const witness = 'TÉMOIN-REGEN-' + Date.now().toString(36);
await page.evaluate((w) => {
  const lastAssistant = currentThread.reduce((acc, m, i) => (m.role === 'assistant' ? i : acc), -1);
  currentThread[lastAssistant].content = w;
  persistCurrent();
  rerenderCurrentThread();
}, witness);
await page.waitForTimeout(200);
await page.evaluate(() => regenerateResponse());
await page.waitForTimeout(600);
check('2. la dernière réponse assistant est INTACTE (ni tronquée ni refaite)',
  await page.evaluate((args) => {
    const msgs = loadConversation(args[0]).messages || [];
    const lastAssistant = msgs.reduce((acc, m, i) => (m.role === 'assistant' ? i : acc), -1);
    return lastAssistant >= 0 && String(msgs[lastAssistant].content || '') === args[1];
  }, [convId, witness]) === true);
check('2. aucune génération n\'a démarré sur le parent',
  await page.evaluate((p) => !isGenerating(p), convId) === true);

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 3 : les AFFORDANCES sont fermées
// ═════════════════════════════════════════════════════════════════════════════
// Elles ne remplacent pas la garde de mutation, mais leur absence ferait
// promettre à l'interface un geste qui sera refusé — le pire des deux mondes.
console.log('\n— Scénario 3 : les affordances sont grisées pendant le travail');
check('3. la classe body.agent-busy est posée',
  await page.evaluate(() => document.body.classList.contains('agent-busy')) === true);

// GRISÉ, pas masqué : le bouton reste là, donc découvrable, mais dit non.
const busyRegen = await glyphState('#thread .msg.assistant:last-of-type .msg-regen');
const busyEdit = await glyphState('#thread .msg.user .msg-edit');
check('3. le glyphe « régénérer » est toujours PRÉSENT (grisé, pas masqué)',
  busyRegen.visible === true);
check('3. …grisé (opacité mesurée sur le style calculé)',
  busyRegen.opacity > 0 && busyRegen.opacity < 1);
check('3. …et refuse le geste au survol (cursor: not-allowed)',
  busyRegen.cursor === 'not-allowed');
check('3. …avec un title qui DONNE LA RAISON, pas juste un refus',
  /agent/i.test(busyRegen.title));
check('3. le crayon d\'édition est grisé de la même façon',
  busyEdit.opacity > 0 && busyEdit.opacity < 1 && busyEdit.cursor === 'not-allowed');
check('3. …et porte la même explication', /agent/i.test(busyEdit.title));

// Le survol ne doit pas rallumer un bouton grisé : sans l'annulation des règles
// :hover de chat.css, il réagirait comme un bouton vivant et contredirait le
// curseur. Mesuré en survolant réellement, pas en lisant la feuille.
await page.hover('#thread .msg.assistant:last-of-type .msg-regen').catch(() => {});
await page.waitForTimeout(120);
const hovered = await glyphState('#thread .msg.assistant:last-of-type .msg-regen');
check('3. survolé, le glyphe grisé ne se rallume pas',
  hovered.cursor === 'not-allowed' && hovered.opacity < 1);

// Édition : le crayon reste affiché (rendu une fois à la construction de la
// bulle, sans passe de synchro), mais la zone d'édition ne doit PAS s'ouvrir.
const opened = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('#thread .msg.user')];
  const first = bubbles[0];
  if (!first) return 'no-bubble';
  enterEditMode(first);
  return first.classList.contains('editing');
});
check('3. enterEditMode n\'ouvre pas la zone d\'édition', opened === false);
check('3. aucune textarea d\'édition n\'est apparue',
  await page.evaluate(() => document.querySelectorAll('.msg-edit-area').length) === 0);
await shot('02-affordances-fermees.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 4 : LE RETOUR — la garde se lève quand l'agent a fini
// ═════════════════════════════════════════════════════════════════════════════
// Une garde qui ne se lève pas est une fonctionnalité perdue. C'est ce contrôle
// qui attrape un rappel manquant de syncLastAssistantActions dans
// unregisterGeneration : le prédicat serait juste, et le bouton resté masqué
// pour toute la session.
console.log('\n— Scénario 4 : la garde se lève à la fin du dernier agent');
await release('A:A1');
await page.waitForFunction((a) => !isGenerating(a), agentId, { timeout: 10000 });
// Le parent est réveillé et repart : on attend le retour complet au repos,
// sinon on mesurerait `sending` plutôt que la levée de la garde.
await page.waitForFunction(() => _activeGenerations.size === 0, null, { timeout: 15000 });
await page.waitForTimeout(600);

check('4. plus aucun agent en vol',
  await page.evaluate((p) => hasWorkingAgent(p), convId) === false);
check('4. la classe body.agent-busy est retirée',
  await page.evaluate(() => document.body.classList.contains('agent-busy')) === false);
const backRegen = await glyphState('#thread .msg.assistant:last-of-type .msg-regen');
const backEdit = await glyphState('#thread .msg.user .msg-edit');
check('4. le glyphe « régénérer » est DÉGRISÉ, sans re-rendu manuel du fil',
  backRegen.opacity === 1 && backRegen.cursor !== 'not-allowed');
check('4. le crayon aussi',
  backEdit.opacity === 1 && backEdit.cursor !== 'not-allowed');
// Les libellés doivent revenir à ce qu'ils étaient, pas à une approximation
// réécrite de mémoire dans la passe de synchro.
check('4. les libellés de repos sont restaurés à l\'identique',
  backRegen.title === restRegen.title && backEdit.title === restEdit.title);
// Sortie par re-rendu du fil plutôt que par `cancelEdit(wrap, original)` : ce
// dernier veut le texte d'origine en argument, qu'il faudrait reconstruire ici
// depuis displayText/content — soit rejouer la doctrine de l'appli dans le
// script, et la figer une deuxième fois. `rerenderCurrentThread` est le chemin
// que l'appli utilise elle-même (piège 28).
check('4. enterEditMode rouvre la zone d\'édition',
  await page.evaluate(() => {
    const first = [...document.querySelectorAll('#thread .msg.user')][0];
    if (!first) return 'no-bubble';
    enterEditMode(first);
    return first.classList.contains('editing');
  }) === true);
await page.evaluate(() => rerenderCurrentThread());
await page.waitForTimeout(200);
check('4. …et le fil se re-rend proprement après annulation',
  await page.evaluate(() => document.querySelectorAll('.msg-edit-area').length) === 0);
check('4. editUserMessage ne refuse plus (plus de message d\'agent)',
  await page.evaluate((p) => agentBusyRewriteRefusal(p), convId) === null);
await shot('03-garde-levee.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 5 : agent lancé depuis une génération HORS ÉCRAN
// ═════════════════════════════════════════════════════════════════════════════
// C'est le cas qui justifie le rappel de syncLastAssistantActions dans
// registerGeneration, et le SEUL. Ailleurs, le spawn passe par un tour du
// parent, donc par setSending, qui repeint déjà les affordances (mesuré : sans
// ce scénario, retirer le rappel ne fait tomber aucun contrôle — le rappel
// paraissait redondant).
//
// Ici l'utilisateur REVIENT sur la conversation pendant que sa génération
// détachée lance un agent : `setSending` ne bascule pas pour l'écran, et sans
// le rappel les glyphes resteraient actifs alors que la garde est en vigueur.
console.log('\n— Scénario 5 : agent lancé par une génération hors écran');
await newConv();
await send('MARK-P5 première question.');
await page.waitForFunction(() => _activeGenerations.size === 0, null, { timeout: 10000 });
await page.waitForTimeout(400);
const conv5 = await page.evaluate(() => currentConvId);

// Le parent repart sur un tour GATÉ qui lancera un agent, puis on quitte
// l'écran : la génération continue détachée (T-1).
await page.evaluate(() => { window.__spawns['P:P5B'] = {
  prompt: 'AGENT-A5 travail détaché.', intent: 'Travail détaché' }; });
await gate('A:A5');
await gate('P:P5B');
await send('MARK-P5B lance un agent.');
await waitSent('P:P5B');
await newConv();                       // on part ailleurs : la génération se détache
await page.waitForTimeout(250);
await release('P:P5B');                // le spawn a lieu PENDANT qu'on est ailleurs
await page.waitForTimeout(500);

const agent5 = await page.evaluate(
  (p) => (agentChildrenOf(p, listAllConversations())[0] || {}).id || '', conv5);
check('5. un agent tourne sur la conversation quittée',
  await page.evaluate((a) => isGenerating(a), agent5) === true);

// Retour sur la conversation : openConversation re-rend le fil, donc les
// affordances sont justes à l'arrivée. La fenêtre visée est APRÈS ce retour.
await page.evaluate((c) => selectConv(c), conv5);
await page.waitForTimeout(400);
check('5. de retour sur elle, les glyphes sont grisés',
  await page.evaluate(() => document.body.classList.contains('agent-busy')) === true);

// LE cas : un SECOND agent est lancé par la génération détachée pendant qu'on
// regarde le fil. `sending` ne bouge pas (l'écran ne génère pas), donc seul le
// rappel de registerGeneration peut repeindre.
// État de départ ACTIF, sinon le contrôle ne mesure rien : on force les glyphes
// dans l'état non gardé juste avant le spawn. Sans ça, la garde était déjà
// posée et « toujours posée après » serait vrai même si plus personne ne
// repeignait (prémisse fausse — la forme la plus fréquente du contrôle vert
// qui ne prouve rien).
// La génération doit porter le convId d'un VRAI enfant : `hasWorkingAgent`
// remonte les enfants par `parentConvId`, donc un id inventé ne rend pas le
// parent occupé et le contrôle mesurerait un repeint qui n'a pas lieu d'être.
// On crée donc un second agent en base, puis on enregistre sa génération.
const agent5b = await page.evaluate(([c]) => {
  const id = 'agent5b-' + Math.random().toString(36).slice(2, 8);
  saveConversation({ id, title: '', parentConvId: c, agentIntent: 'Second agent',
    spaceId: loadConversation(c).spaceId, timestamp: Date.now(), updatedAt: Date.now(),
    messages: [] });
  return id;
}, [conv5]);
// L'enregistrement est SÉPARÉ de la création : `hasWorkingAgent` remonte les
// enfants par le cache de métadonnées, et enregistrer dans la même évaluation
// que `saveConversation` ferait courir le repeint contre l'arrivée du record
// dans ce cache. On mesure la garde, pas une course de montage.
await page.waitForFunction((a) => !!loadConversation(a), agent5b, { timeout: 5000 });
await page.evaluate(() => document.body.classList.remove('agent-busy'));
await page.evaluate((a) => registerGeneration(createGeneration(a, [], {})), agent5b);
await page.waitForTimeout(250);
check('5. (contrôle) le second agent rend bien le parent occupé',
  await page.evaluate((c) => hasWorkingAgent(c), conv5) === true);
check('5. (contrôle) `sending` est resté faux : setSending n\'a pas pu repeindre',
  await page.evaluate(() => sending === false) === true);
// LE contrôle du rappel de registerGeneration. Le fil n'est pas re-rendu et
// setSending n'a pas bougé : si le rappel manque, les glyphes restent dans
// l'état où le dernier rendu les a laissés. Le spawn ci-dessus a été fait sur
// une conversation qui portait DÉJÀ la garde, donc on lève d'abord la garde
// réelle pour que l'état de départ soit « actif » et que le repeint soit
// observable — sinon on mesurerait un grisé qui n'a jamais eu besoin d'être
// mis à jour (prémisse fausse).
check('5. le spawn hors écran a bien repeint les affordances',
  await page.evaluate(() => document.body.classList.contains('agent-busy')) === true);
// La fin de CE second agent ne réveille pas le parent (aucun résultat à
// délivrer) et ne touche pas à `sending` : c'est le seul point du script où le
// rappel de unregisterGeneration est la SEULE chose qui puisse repeindre.
// Ailleurs, la fin d'un agent réveille le parent, qui regénère, donc setSending
// s'en charge — mesuré : sans ce contrôle, retirer ce rappel ne fait rien
// tomber. On repose la classe à la main d'abord, pour partir d'un état gardé
// même si l'autre agent a déjà fini.
// Le premier agent est libéré D'ABORD, et on attend le retour complet au repos :
// sinon le parent reste occupé, la classe doit rester posée, et le contrôle
// serait vrai avec ou sans rappel (mesuré — il ne discriminait rien).
await release('A:A5');
await page.waitForFunction((a) => !isGenerating(a), agent5, { timeout: 10000 });
await page.waitForTimeout(600);
check('5. (contrôle) seul le second agent factice reste en vol',
  await page.evaluate((a) => _activeGenerations.has(a), agent5b) === true);

// Sa fin ne réveille pas le parent (aucun résultat à délivrer) et ne touche pas
// à `sending` : c'est le seul point du script où le rappel de
// unregisterGeneration est la SEULE chose qui puisse repeindre. Ailleurs, la
// fin d'un agent réveille le parent, qui regénère, donc setSending s'en charge.
await page.evaluate((a) => {
  document.body.classList.add('agent-busy');
  const gen = _activeGenerations.get(a);
  if (gen) unregisterGeneration(gen);
}, agent5b);
await page.waitForTimeout(250);
check('5. (contrôle) le parent n\'a plus aucun agent en vol',
  await page.evaluate((c) => hasWorkingAgent(c), conv5) === false);
check('5. la fin du dernier agent a repeint les affordances',
  await page.evaluate(() => document.body.classList.contains('agent-busy')) === false);

// Retour complet au repos (le parent a pu être réveillé par le premier agent).
await page.waitForFunction(() => _activeGenerations.size === 0, null, { timeout: 15000 });
await page.waitForTimeout(600);
check('5. au repos complet, la garde est levée',
  await page.evaluate(() => document.body.classList.contains('agent-busy')) === false);
await shot('04-agent-hors-ecran.png');

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
