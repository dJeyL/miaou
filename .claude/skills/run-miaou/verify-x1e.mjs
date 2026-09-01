#!/usr/bin/env node
// Vérification du complément X-1e — trois ajustements d'interface issus des
// retours de test de X-1 (sans rapport avec le lot X-2 planifié, liste d'agents) :
//
//   A. File d'interjections CLEFÉE PAR CONVERSATION. Le lot Q en avait fait un
//      état d'écran (un tableau unique, drainé par la génération qui possédait
//      l'écran). Avec le multitâche du lot T, cette forme ne pouvait plus
//      répondre à « qui va recevoir ce message ? » : les puces restaient
//      affichées en changeant de conversation, sur un fil qui ne générait pas.
//   B. LECTURE SEULE d'un agent dont le travail est terminé.
//   C. Réponses d'agent NON ÉDITABLES et REPLIÉES par défaut dans le parent.
//
// Étendu au complément X-1f (section F), qui rouvre ce que X-1e avait fermé
// sans le décider :
//
//   F. INTERJECTIONS DANS LE FIL D'UN AGENT. X-1e refusait la mise en file
//      (« Cette conversation est celle d'un agent… ») parce qu'un agent câblait
//      `onInterjections: () => null` — justification déjà périmée dans le lot
//      qui l'écrivait, puisque X-1e venait de clefer la file par conversation.
//      Un agent draine désormais la sienne à la frontière de tour. Restent
//      couverts ici : la fenêtre NON drainable (l'agent finit sa rédaction
//      avant le drain — la file « échoue » et le rail survit au verrou), et le
//      blocage des sélecteurs de modèle/raisonnement en lecture seule.
//
// Montage repris de verify-agents.mjs : stub SSE gaté par conversation, mêmes
// marqueurs MARK-/AGENT-, mêmes deux pièges (filtrer les appels silencieux,
// gater AVANT finish_reason).
//
// NON-VACUITÉ — mesurée, régression par régression, le 2026-08-30. Chaque ligne
// a été réinjectée dans `src/`, le bundle reconstruit, ce script relancé, puis
// la source restaurée. Résultats OBSERVÉS :
//
//   drain d'interjections vidant TOUTE la Map ............ A6 tombe (1)
//   isFinishedAgentConv toujours vrai .................... 3 tests purs tombent
//   setSending retiré du finally d'un agent ............. B2ter, B2quater (2)
//   escHtml retiré de l'intent .......................... 1 test pur tombe
//   résolution dynamique retirée d'exposedTools .......... E1,E2,E3,E5,E6 (5)
//   applyReadonlyState retiré de resetToEmpty ........... B7 tombe (1)
//
// UN RÉSULTAT NÉGATIF, gardé parce qu'il vaut plus que les positifs : le test
// pur « le payload modèle en dérive : UNE source » reste VERT quand on casse
// agentSpawnToolDef — les deux chemins restent cohérents, puisqu'ils lisent la
// même source cassée. Il pin la NON-DIVERGENCE, pas la présence du contenu ;
// c'est E1/E2 (et les deux autres tests purs) qui attrapent la disparition.
//
// DEUX bugs de X-1e ont été trouvés par le RUN CROISÉ de verify-agents.mjs, pas
// par ce script — motif à retenir : un verify neuf valide ce qu'il vise, le
// verify du lot précédent mesure ce qu'on a cassé.
//   1. `resetToEmpty` appelait `applyReadonlyState` (via `resetPeerState`) AVANT
//      `currentConvId = null` : quitter un agent terminé vers l'accueil y
//      laissait le verrou, et plus rien ne le levait. Le scénario 10 de X-1 s'y
//      est bloqué net. Contrôle B7 ajouté ici après coup.
//   2. La règle CSS `.conv-readonly .conv-retitle-btn { opacity: .4 }` (lot J)
//      rendait ce bouton PLUS visible en lecture seule qu'en état normal (il est
//      à `opacity: 0` en permanence, contrairement aux boutons de bulle qu'elle
//      grise correctement). Défaut préexistant, jamais observable avant : aucune
//      conversation affichant ce bouton n'était readonly assez longtemps.
//
// Un bug PRÉEXISTANT a été trouvé par le scénario B, pas par une régression
// réinjectée : driveAgentConversation n'appelait pas setSending dans son
// `finally`, contrairement à driveDetachedConversation. Le fil d'un agent
// terminé gardait le placeholder « Le modèle travaille — Entrée ajoute à la
// file… » et son bouton stop. Invisible avant X-1e ; la lecture seule le rend
// criant (composer verrouillé ET annonçant un travail en cours).
//
// Usage : node verify-x1e.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-x1e');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

// ── Stub SSE gaté par conversation (repris de verify-agents.mjs) ────────────
const initScript = () => {
  try {
    localStorage.setItem('miaou-settings', JSON.stringify({
      url: 'http://stub.local/v1', key: 'stub-key', model: 'stub-model',
      summaryInjectionMode: 'never',   // pas de bannière : elle bloquerait dispatchSend
    }));
  } catch (e) {}

  window.__sent = [];        // payloads envoyés, étiquetés par tag
  window.__gates = {};       // tag → true : cette requête est retenue
  window.__released = {};    // tag → true : libérée
  window.__spawns = {};      // tag → { prompt, intent, tools } : ce tag lance un agent
  window.__toolTags = {};    // tag → true : ce tag fait un tour d'outils conv__list
  window.__errorTags = {};   // tag → true : le backend répond en erreur HTTP

  // Un handler d'outil rend soit une string, soit une enveloppe MCP
  // { content: [{ type:'text', text }] }. Stringifier l'enveloppe échapperait
  // les guillemets du JSON qu'elle transporte et ferait échouer les regex.
  window.mcpText = (r) => {
    if (typeof r === 'string') return r;
    if (r && Array.isArray(r.content)) return r.content.map(c => (c && c.text) || '').join('\n');
    return JSON.stringify(r);
  };

  // Étiquette d'une requête. AGENT- prime sur MARK- : le message de réveil
  // poussé dans le fil du parent contient le texte final de l'agent (donc son
  // marqueur AGENT-), et sans cette priorité le tour du parent réveillé serait
  // compté comme un tour de l'agent. On cherche donc d'abord un AGENT- dans le
  // PREMIER message user (le seul endroit où le cadrage d'agent se trouve),
  // puis on retombe sur le dernier MARK- rencontré.
  const tagOf = (body) => {
    const msgs = (body && body.messages) || [];
    const txtOf = (m) => {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) return m.content.map(p => (p && p.text) || '').join(' ');
      return '';
    };
    // Premier message user : si c'est un fil d'agent, il porte le cadrage.
    for (const m of msgs) {
      if (m.role !== 'user') continue;
      const t = txtOf(m);
      const hit = t.match(/AGENT-([A-Z0-9]+)/);
      return hit ? 'A:' + hit[1] : (() => {
        // Pas un fil d'agent : on cherche le dernier MARK- du payload.
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

    // Appels SILENCIEUX (titrage, résumé — silentCompletion) : non streamés, et
    // leur payload est une TRANSCRIPTION qui contient nos marqueurs. Sans ce
    // filtre, ils seraient étiquetés comme une génération et fausseraient tous
    // les comptages (piège déjà payé sur verify-generations.mjs).
    if (body.stream !== true) {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Titre stub' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const tag = tagOf(body);
    window.__sent.push({ tag, body, tools: (body.tools || []).map(t => (t.function || {}).name) });

    // Erreur BACKEND (HTTP non-ok) : streamCompletion lève, runConversation
    // propage, et driveAgentConversation ne voit JAMAIS onFinal. C'est le seul
    // chemin de sortie qui distingue réellement le `finally` du chemin nominal
    // — l'abort utilisateur, lui, passe par onFinal('aborted').
    if (window.__errorTags[tag]) {
      return new Response(JSON.stringify({ error: { message: 'backend en panne (stub)' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    const enc = new TextEncoder();
    const hasToolResult = (body.messages || []).some(m => m.role === 'tool');

    // Un tour d'outils n'est émis qu'au PREMIER passage (pas de tool result
    // encore dans le payload) : sinon la boucle d'outils ne se termine jamais.
    const spawn = !hasToolResult ? window.__spawns[tag] : null;
    const wantTool = !hasToolResult && !!window.__toolTags[tag];

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
        const toolCall = (name, args) => {
          send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + tag + '_' + name,
            type: 'function', function: { name: name, arguments: JSON.stringify(args) } }] } }] });
        };
        const closeWith = (finish) => {
          send({ choices: [{ delta: {}, finish_reason: finish }] });
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
          controller.close();
        };

        try {
          if (spawn) {
            toolCall('miaou__agent__spawn', Object.assign({
              prompt: spawn.prompt, intent: spawn.intent, tools: spawn.tools || [],
            }, spawn.attachments ? { attachments: spawn.attachments } : {}));
            // GATE AVANT finish_reason (piège 2) : sans cela le tour d'outils
            // part immédiatement et l'état d'écran qu'on veut faire diverger
            // (Espace, conversation affichée) n'a pas encore bougé — le
            // scénario passerait même avec la régression réinjectée.
            await holdOn();
            closeWith('tool_calls');
            return;
          }
          if (wantTool) {
            // `__toolTags[tag]` vaut `true` (conv__list, historique) ou un objet
            // { name, args } pour cibler un autre outil — X-1d en a besoin pour
            // faire appeler recall_attachment avec un handle d'image.
            const spec = window.__toolTags[tag];
            if (spec && spec !== true && spec.name) {
              toolCall(spec.name, spec.args || {});
              await holdOn();
              closeWith('tool_calls');
              return;
            }
            toolCall('miaou__conv__list', {});
            await holdOn();
            closeWith('tool_calls');
            return;
          }

          // Premier fragment : rend le stream OBSERVABLE avant le gate.
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
// Overlay de boot : jamais retiré du DOM (plancher 1,8 s), une capture prise
// avant sa disparition montrerait le préchargement.
await page.waitForFunction(() => !!document.querySelector('.boot-done'), null, { timeout: 15000 });
await page.waitForTimeout(300);

const gate = (tag) => page.evaluate((t) => { window.__gates[t] = true; }, tag);
const release = (tag) => page.evaluate((t) => { window.__released[t] = true; }, tag);
const armSpawn = (pTag, aTag, opts) => page.evaluate(([p, a, o]) => {
  window.__spawns['P:' + p] = {
    prompt: 'AGENT-' + a + ' fais le travail.', intent: (o && o.intent) || ('Travail ' + a),
    tools: (o && o.tools) || [], attachments: null,
  };
}, [pTag, aTag, opts || null]);
const send = async (text) => {
  await page.fill('#composer-text', text);
  await page.press('#composer-text', 'Enter');
};
const newConv = async () => { await page.evaluate(() => resetToEmpty()); await page.waitForTimeout(120); };
const waitSent = (tag) => page.waitForFunction(
  (t) => window.__sent.some(x => x.tag === t), tag, { timeout: 10000 });
const childOf = (parentId) => page.evaluate(
  (p) => (agentChildrenOf(p, listAllConversations())[0] || {}).id || '', parentId);
const railIds = () => page.evaluate(() =>
  Array.from(document.querySelectorAll('#ij-chips .ij-chip')).map(c => c.dataset.ijId));
const railVisible = () => page.evaluate(() => {
  const r = document.getElementById('ij-rail');
  return !!r && !r.hidden;
});

// ═══ A. File d'interjections clefée par conversation ════════════════════════
console.log('\n— A. File d\'interjections par conversation');

// Deux conversations racines, chacune en génération, chacune avec sa propre
// interjection en attente. C'est le scénario exact du retour de test.
await newConv();
await gate('P:AAA');
await send('MARK-AAA premier fil');
await waitSent('P:AAA');
await page.waitForTimeout(200);
const convA = await page.evaluate(() => currentConvId);

// Interjection tapée dans A, PENDANT sa génération.
await page.fill('#composer-text', 'pour le fil A');
await page.press('#composer-text', 'Enter');
await page.waitForTimeout(200);
const railA = await railIds();
check('A1. l\'interjection tapée dans A apparaît au rail', railA.length === 1);

// On part sur une DEUXIÈME conversation, A générant toujours.
await newConv();
await gate('P:BBB');
await send('MARK-BBB second fil');
await waitSent('P:BBB');
await page.waitForTimeout(200);
const convB = await page.evaluate(() => currentConvId);

const railOnB = await railIds();
check('A2. LE BUG DU RETOUR : le rail de B ne montre PAS la puce de A',
  railOnB.length === 0);
check('A2bis. et le rail est masqué, pas juste vidé', (await railVisible()) === false);
await shot('01-rail-vide-sur-autre-conv.png');

// Interjection propre à B.
await page.fill('#composer-text', 'pour le fil B');
await page.press('#composer-text', 'Enter');
await page.waitForTimeout(200);
const railB = await railIds();
check('A3. B a sa propre file, indépendante', railB.length === 1);
check('A3bis. et ce n\'est pas la puce de A', railB[0] !== railA[0]);

// Retour sur A : sa puce est toujours là, celle de B a disparu.
await page.evaluate((id) => openConversation(id), convA);
await page.waitForTimeout(250);
const railBackOnA = await railIds();
check('A4. revenir sur A y retrouve SA puce, intacte',
  railBackOnA.length === 1 && railBackOnA[0] === railA[0]);
await shot('02-rail-retrouve-sur-sa-conv.png');

// Contenu : la puce de A porte bien le littéral de A.
const chipTextA = await page.evaluate(() =>
  (document.querySelector('#ij-chips .ij-chip .ij-text') || {}).textContent || '');
check('A5. et c\'est bien le littéral tapé dans A', chipTextA === 'pour le fil A');

// Drain : libérer A envoie SA file, celle de B reste.
await release('P:AAA');
await page.waitForTimeout(600);
const bStillQueued = await page.evaluate((id) => interjectionsFor(id).length, convB);
check('A6. drainer A ne touche PAS la file de B', bStillQueued === 1);

// Le drain de A a bien produit un tour : le littéral de A part sur le fil.
const aDrained = await page.evaluate((id) => interjectionsFor(id).length, convA);
check('A6bis. la file de A, elle, est vidée', aDrained === 0);

// ── Drain A DÉTACHÉ : la file part sur SA conversation, hors écran ─────────
// Le cas que la forme « état d'écran » ne pouvait pas servir.
await release('P:BBB');
await page.waitForTimeout(800);
const bMsgs = await page.evaluate((id) => {
  const c = loadConversation(id);
  return (c.messages || []).filter(m => m.role === 'user').map(m => m.displayText || m.content);
}, convB);
check('A7. DRAIN DÉTACHÉ : l\'interjection de B est partie dans B, écran sur A',
  bMsgs.some(t => String(t).indexOf('pour le fil B') >= 0));
check('A7bis. et elle n\'a PAS atterri dans A', !(await page.evaluate((id) => {
  const c = loadConversation(id);
  return (c.messages || []).some(m => String(m.content || '').indexOf('pour le fil B') >= 0);
}, convA)));

// ═══ B. Lecture seule d'un agent terminé ════════════════════════════════════
console.log('\n— B. Lecture seule d\'un agent terminé');

await newConv();
await page.evaluate(() => { window.__gates = {}; window.__released = {}; window.__sent = []; });
await armSpawn('CCC', 'DDD', { intent: 'Relire le brief' });
await gate('A:DDD');   // l'agent est retenu : il travaille
await send('MARK-CCC lance un agent');
await page.waitForTimeout(600);
const parentC = await page.evaluate(() => currentConvId);
const agentD = await childOf(parentC);
check('B0. l\'agent a bien été créé', !!agentD);

// On ouvre le fil de l'agent PENDANT son travail : composer ouvert.
await page.evaluate((id) => openConversation(id), agentD);
await page.waitForTimeout(300);
const openWhileWorking = await page.evaluate(() => !document.getElementById('composer-text').disabled);
check('B1. agent AU TRAVAIL : le composer reste ouvert', openWhileWorking);
await shot('03-agent-au-travail.png');

// L'agent finit, on le REGARDE finir.
await release('A:DDD');
await page.waitForTimeout(900);
const lockedAfter = await page.evaluate(() => document.getElementById('composer-text').disabled);
check('B2. agent TERMINÉ sous les yeux : le composer se ferme', lockedAfter === true);
const roClass = await page.evaluate(() => document.body.classList.contains('conv-readonly'));
check('B2bis. et la classe de lecture seule est posée', roClass === true);
// Bug trouvé PAR ce scénario : driveAgentConversation n'appelait pas
// setSending, contrairement au chemin détaché. Le composer restait verrouillé
// ET affichait « Le modèle travaille — Entrée ajoute à la file… », bouton stop
// à l'appui, sur un agent qui avait fini. Défaut préexistant à X-1e, que la
// lecture seule rend seulement plus visible.
const composerState = await page.evaluate(() => ({
  placeholder: document.getElementById('composer-text').placeholder,
  streaming: document.getElementById('send-btn').classList.contains('streaming'),
  sending: sending,
}));
check('B2ter. le composer cesse d\'annoncer un travail en cours',
  composerState.sending === false && composerState.streaming === false);
check('B2quater. et son placeholder n\'invite plus à la mise en file',
  composerState.placeholder.indexOf('travaille') < 0);
await shot('04-agent-termine-lecture-seule.png');

// Le bandeau explique POURQUOI (sans lui, un composer grisé est une panne).
const bannerTxt = await page.evaluate(() =>
  (document.getElementById('agent-banner-status') || {}).textContent || '');
check('B3. le bandeau porte le statut, le verrou est expliqué', bannerTxt.trim().length > 0);

// Le retour au parent reste possible : le readonly neutralise les MUTATIONS,
// pas la navigation.
const backBtnUsable = await page.evaluate(() => {
  const b = document.querySelector('.conv-parent-btn');
  if (!b || b.hidden) return false;
  return getComputedStyle(b).pointerEvents !== 'none';
});
check('B4. le retour au parent reste ACTIF (navigation, pas mutation)', backBtnUsable);

// Ré-ouverture après navigation : le verrou tient (il ne dépend pas d'un état
// vivant, mais du statut persisté).
await page.evaluate((id) => openConversation(id), parentC);
await page.waitForTimeout(250);
const parentOpen = await page.evaluate(() => !document.getElementById('composer-text').disabled);
check('B5. de retour sur le PARENT, le composer est rouvert', parentOpen);
await page.evaluate((id) => openConversation(id), agentD);
await page.waitForTimeout(250);
const stillLocked = await page.evaluate(() => document.getElementById('composer-text').disabled);
check('B6. rouvrir l\'agent le retrouve verrouillé (statut persisté)', stillLocked === true);

// Quitter un agent verrouillé vers l'ACCUEIL doit lever le verrou. Bug trouvé
// par le run croisé de verify-agents.mjs, pas par ce script : `resetToEmpty`
// appelle `applyReadonlyState` via `resetPeerState` AVANT `currentConvId = null`,
// donc le prédicat voyait encore l'agent et laissait l'accueil mort. Le
// scénario 10 de X-1 s'y est bloqué net (composer disabled, fill en timeout).
await page.evaluate((id) => openConversation(id), agentD);
await page.waitForTimeout(200);
await page.evaluate(() => resetToEmpty());
await page.waitForTimeout(250);
const homeUnlocked = await page.evaluate(() => ({
  disabled: document.getElementById('composer-text').disabled,
  ro: document.body.classList.contains('conv-readonly'),
}));
check('B7. quitter un agent verrouillé vers l\'accueil LÈVE le verrou',
  homeUnlocked.disabled === false && homeUnlocked.ro === false);

// ═══ C. Réponse d'agent : non éditable, repliée ═════════════════════════════
console.log('\n— C. Réponse d\'agent dans le parent');

await page.evaluate((id) => openConversation(id), parentC);
await page.waitForTimeout(400);

const agentBubble = await page.evaluate(() => {
  const el = document.querySelector('.msg.user.agent-result');
  if (!el) return null;
  return {
    hasEdit: !!el.querySelector('.msg-edit'),
    hasCopy: !!el.querySelector('.msg-copy-user'),
    hasDetails: !!el.querySelector('details.agent-result-box'),
    open: !!(el.querySelector('details.agent-result-box') || {}).open,
    intent: (el.querySelector('.agent-result-intent') || {}).textContent || '',
    status: (el.querySelector('.agent-result-status') || {}).textContent || '',
  };
});
check('C0. la réponse d\'agent est rendue comme telle dans le parent', !!agentBubble);
check('C1. NON ÉDITABLE : pas de bouton d\'édition', agentBubble && agentBubble.hasEdit === false);
check('C1bis. mais la copie reste offerte (lecture, pas mutation)', agentBubble && agentBubble.hasCopy === true);
check('C2. REPLIÉE par défaut', agentBubble && agentBubble.hasDetails && agentBubble.open === false);
check('C3. le bandeau porte l\'intent, seule chose lisible repliée',
  agentBubble && agentBubble.intent.indexOf('Relire le brief') >= 0);
check('C4. et le statut, visible sans déplier', agentBubble && agentBubble.status.trim().length > 0);
// Footer aligné à droite comme sur tout message user. MESURÉ, pas déduit :
// le bloc passe en `align-items: stretch` pour s'élargir, ce qui neutralise le
// `flex-end` du parent qui poussait le footer à droite.
const footerAlign = await page.evaluate(() => {
  const el = document.querySelector('.msg.user.agent-result');
  const foot = el && el.querySelector('.msg-user-footer');
  const box = el && el.querySelector('details.agent-result-box');
  if (!foot || !box) return null;
  const f = foot.getBoundingClientRect(), b = box.getBoundingClientRect();
  const ts = foot.querySelector('.msg-ts');
  const t = ts ? ts.getBoundingClientRect() : null;
  return { footRight: Math.round(f.right), boxRight: Math.round(b.right),
           tsRight: t ? Math.round(t.right) : null, boxLeft: Math.round(b.left) };
});
check('C4bis. copie et horodatage sont alignés à DROITE du bloc',
  footerAlign && footerAlign.tsRight !== null &&
  Math.abs(footerAlign.tsRight - footerAlign.boxRight) < 40 &&
  (footerAlign.tsRight - footerAlign.boxLeft) > 200);
await shot('05-reponse-agent-repliee.png');

// Dépli au clic sur le bandeau (zone de clic complète, sans JS).
await page.click('.msg.user.agent-result .agent-result-head');
await page.waitForTimeout(250);
const opened = await page.evaluate(() =>
  !!(document.querySelector('.msg.user.agent-result details') || {}).open);
check('C5. un clic sur le BANDEAU déplie (zone de clic complète)', opened);
const bodyVisible = await page.evaluate(() => {
  const b = document.querySelector('.msg.user.agent-result details .body');
  return !!b && b.getBoundingClientRect().height > 0;
});
check('C5bis. et le corps du compte rendu devient visible', bodyVisible);
await shot('06-reponse-agent-depliee.png');

// Thème sombre : les couleurs posées (surface, bordure, texte secondaire) sont
// des TOKENS, donc elles suivent — mais une capture le prouve, une déduction
// non. Le repli est rouvert pour montrer le corps dans les deux thèmes.
await page.evaluate(() => selectTheme('dark'));
await page.waitForTimeout(300);
await shot('07-reponse-agent-theme-sombre.png');
const darkOk = await page.evaluate(() => {
  const head = document.querySelector('.agent-result-head');
  const box = document.querySelector('.agent-result-box');
  if (!head || !box) return null;
  const cs = getComputedStyle(box);
  // Un fond transparent signalerait un token absent : le bloc se fondrait
  // dans la page et le bandeau perdrait sa lecture de conteneur.
  return cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.borderTopWidth !== '0px';
});
check('C6bis. le bloc garde fond et bordure en thème sombre', darkOk === true);
await page.evaluate(() => selectTheme('light'));
await page.waitForTimeout(250);

// Repli au re-clic (le <details> natif referme).
await page.click('.msg.user.agent-result .agent-result-head');
await page.waitForTimeout(250);
const reclosed = await page.evaluate(() =>
  !(document.querySelector('.msg.user.agent-result details') || {}).open);
check('C6. re-cliquer replie', reclosed);

// La garde d'édition tient aussi côté DONNÉES, pas seulement en UI : c'est
// elle qui protège le thread (le bouton absent ne protège que le clic).
const editRefused = await page.evaluate(async () => {
  const idx = currentThread.findIndex(m => m.role === 'user' && m.agentResult);
  if (idx < 0) return 'pas de message agentResult';
  const before = currentThread[idx].content;
  await editUserMessage(idx, 'RÉÉCRIT PAR FORCE');
  return currentThread[idx].content === before ? 'intact' : 'MUTÉ';
});
check('C7. editUserMessage REFUSE de muter un résultat d\'agent', editRefused === 'intact');

// Un message user ORDINAIRE reste éditable : la garde ne déborde pas.
const normalEditable = await page.evaluate(() => {
  const els = Array.from(document.querySelectorAll('.msg.user:not(.agent-result)'));
  return els.length > 0 && els.every(e => !!e.querySelector('.msg-edit'));
});
check('C8. (contrôle) un message user ORDINAIRE reste éditable', normalEditable);

// ── Reload : parité live / rechargement ────────────────────────────────────
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 10000 });
await page.waitForFunction(() => !!document.querySelector('.boot-done'), null, { timeout: 15000 });
await page.evaluate((id) => openConversation(id), parentC);
await page.waitForTimeout(400);
const afterReload = await page.evaluate(() => {
  const el = document.querySelector('.msg.user.agent-result');
  if (!el) return null;
  return { hasEdit: !!el.querySelector('.msg-edit'),
           open: !!(el.querySelector('details.agent-result-box') || {}).open };
});
check('C9. RELOAD : la réponse d\'agent est toujours repliée et non éditable',
  afterReload && afterReload.hasEdit === false && afterReload.open === false);

// ═══ D. Export HTML : le repli survit, sans JS ═════════════════════════════
console.log('\n— D. Export HTML');

// L'export a SA feuille (EXPORT_CSS ne suit pas chat.css, piège 22) mais
// partage le MARKUP (agentResultBodyHtml). On vérifie que les deux y sont.
// `exportConvHtml` télécharge le fichier ; on exerce les deux moitiés qu'elle
// assemble — le corps rendu (renderExportBody, chemin partagé avec l'écran) et
// la feuille dédiée (EXPORT_CSS, figée, piège 22).
// `renderExportBody` rend une CHAÎNE (container.innerHTML), pas un noeud.
const exportHtml = await page.evaluate(async () => {
  const body = await renderExportBody(currentThread, currentConvId);
  return body + '\n/*CSS*/\n' + EXPORT_CSS;
});
check('D1. l\'export porte le bloc repliable de la réponse d\'agent',
  exportHtml.indexOf('agent-result-box') >= 0);
// FERMÉ par défaut : mesuré sur l'ÉLÉMENT, pas par recherche de chaîne — le
// sérialiseur HTML n'écrit `open` que s'il est posé, mais chercher son absence
// dans du texte confondrait « pas d'attribut » et « pas de balise ».
const exportClosed = await page.evaluate(async () => {
  const body = await renderExportBody(currentThread, currentConvId);
  const host = document.createElement('div');
  host.innerHTML = body;
  const d = host.querySelector('details.agent-result-box');
  return d ? d.open : null;
});
check('D2. FERMÉ par défaut, comme à l\'écran', exportClosed === false);
check('D3. et son CSS dédié voyage avec lui (feuille distincte, piège 22)',
  exportHtml.indexOf('.agent-result-box[open]') >= 0);
// Sans JS : <details> est natif, l'export non interactif doit se replier.
check('D4. le repli ne dépend d\'aucun script (details natif)',
  exportHtml.indexOf('agent-result-head') >= 0);

// ═══ E. Drawer « Voir les outils exposés » : agent__spawn décrit ═══════════
console.log('\n— E. Drawer des outils exposés');

// `agent__spawn` porte une description et un schéma construits DYNAMIQUEMENT
// (agentSpawnToolDef). Tant que cette résolution vivait dans toolDefinitions,
// le drawer — qui lit exposedTools() — l'affichait vide.
const spawnDef = await page.evaluate(() => {
  const t = exposedTools().find(x => x.name === 'miaou__agent__spawn');
  if (!t) return null;
  return {
    descLen: (t.description || '').length,
    props: Object.keys((t.inputSchema && t.inputSchema.properties) || {}),
    required: (t.inputSchema && t.inputSchema.required) || [],
  };
});
check('E1. exposedTools rend une DESCRIPTION pour agent__spawn',
  spawnDef && spawnDef.descLen > 50);
check('E2. et la liste de ses PARAMÈTRES', spawnDef && spawnDef.props.length >= 3);
check('E3. dont prompt et intent, requis',
  spawnDef && spawnDef.props.indexOf('prompt') >= 0 && spawnDef.props.indexOf('intent') >= 0 &&
  spawnDef.required.indexOf('prompt') >= 0);

// Le payload modèle doit rester identique : c'est la MÊME source.
const payloadDef = await page.evaluate(() => {
  const d = toolDefinitions().find(x => x.function.name === 'miaou__agent__spawn');
  return d ? { descLen: d.function.description.length,
               props: Object.keys(d.function.parameters.properties || {}) } : null;
});
check('E4. le payload modèle porte la MÊME description (une seule source)',
  payloadDef && payloadDef.descLen === spawnDef.descLen);

// Rendu réel dans le drawer. Les namespaces sont des accordéons — seul le
// premier est ouvert — donc on déplie « miaou › agent » avant de mesurer.
await page.evaluate(() => openTools());
await page.waitForTimeout(400);
await page.evaluate(() => {
  const h = Array.from(document.querySelectorAll('#tools-list .tool-ns'))
    .find(e => (e.textContent || '').indexOf('agent') >= 0);
  if (h) h.click();
});
await page.waitForTimeout(400);
const drawerItem = await page.evaluate(() => {
  const card = Array.from(document.querySelectorAll('#tools-list .tool-item'))
    .find(e => ((e.querySelector('.tool-name') || {}).textContent || '').indexOf('spawn') >= 0);
  if (!card) return null;
  return {
    desc: (card.querySelector('.tool-desc') || {}).textContent || '',
    params: Array.from(card.querySelectorAll('.tool-param-name')).map(e => e.textContent),
  };
});
check('E5. le drawer affiche la DESCRIPTION de agent__spawn',
  drawerItem && drawerItem.desc.indexOf('sous-conversation autonome') >= 0);
check('E6. et la liste de ses PARAMÈTRES',
  drawerItem && drawerItem.params.indexOf('prompt') >= 0 &&
  drawerItem.params.indexOf('intent') >= 0);
await shot('08-drawer-agent-spawn.png');

// ═══ F. Interjection DANS le fil d'un agent (X-1f) ═════════════════════════
console.log('\n— F. Interjection dans le fil d\'un agent');

// X-1e refusait la mise en file dans une conversation d'agent (« Cette
// conversation est celle d'un agent… »), au motif qu'un agent câblait
// `onInterjections: () => null`. Cette justification était périmée dans le lot
// même qui l'écrivait : X-1e venait de clefer la file par conversation. On
// vérifie ici les deux moitiés — la mise en file est acceptée, ET le drain tire
// pour de bon à la frontière de tour de l'agent.

// La section E laisse le drawer des outils OUVERT : il recouvre le composer,
// et `send()` (fill + Enter) taperait dans le vide.
await page.evaluate(() => { if (typeof closeTools === 'function') closeTools(); });
await page.waitForTimeout(250);
await newConv();
await page.evaluate(() => { window.__gates = {}; window.__released = {}; window.__sent = []; });
// Nom QUALIFIÉ obligatoire : agent__spawn valide `tools` contre les noms
// exposés (« miaou__conv__list »), et un nom nu est refusé avec la liste des
// valides — l'agent n'est alors jamais créé.
await armSpawn('EEE', 'FFF', { intent: 'Compiler le rapport', tools: ['miaou__conv__list'] });
// L'agent fait un TOUR D'OUTILS : c'est ce qui lui donne une frontière de tour,
// donc un point de drain. Sans lui, il rédigerait sa réponse d'un trait et
// l'interjection arriverait après coup (le cas F5, plus bas).
await page.evaluate(() => { window.__toolTags['A:FFF'] = true; });
await gate('A:FFF');
await send('MARK-EEE lance un agent qui outille');
await page.waitForTimeout(700);
const parentE = await page.evaluate(() => currentConvId);
const agentF = await childOf(parentE);
check('F0. l\'agent est créé et retenu sur son tour d\'outils', !!agentF);

// On ouvre son fil pendant qu'il travaille, et on tape.
await page.evaluate((id) => openConversation(id), agentF);
await page.waitForTimeout(300);
const composerOpenOnAgent = await page.evaluate(() => !document.getElementById('composer-text').disabled);
check('F1. le composer d\'un agent AU TRAVAIL est ouvert', composerOpenOnAgent);

await page.fill('#composer-text', 'désobéis un peu : donne aussi l\'identifiant');
await page.press('#composer-text', 'Enter');
await page.waitForTimeout(300);

// LA RÉGRESSION DU LOT : sous X-1e, ce chemin affichait une erreur composer et
// la file restait vide.
const railOnAgent = await railIds();
check('F2. LE POINT DU LOT : la mise en file est ACCEPTÉE dans un fil d\'agent',
  railOnAgent.length === 1);
const errShown = await page.evaluate(() => {
  const el = document.getElementById('composer-error');
  return !!el && !el.hidden;
});
check('F2bis. et aucune erreur composer n\'est affichée', errShown === false);
const queuedOnAgent = await page.evaluate((id) => interjectionsFor(id).length, agentF);
check('F2ter. la file est bien celle de l\'AGENT, pas de son parent', queuedOnAgent === 1);
check('F2quater. et le parent n\'a rien reçu',
  (await page.evaluate((id) => interjectionsFor(id).length, parentE)) === 0);
await shot('09-interjection-dans-fil-agent.png');

// Drain : on libère le tour d'outils. L'interjection doit partir DANS le
// payload de l'agent, à la frontière de tour, avant sa relance.
await page.evaluate(() => { window.__sent = []; });
await release('A:FFF');
await page.waitForTimeout(1200);

const agentPayloads = await page.evaluate(() =>
  window.__sent.filter(x => x.tag === 'A:FFF').map(x => (x.body.messages || [])
    .filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '')));
const sawInterjection = agentPayloads.some(msgs =>
  msgs.some(t => t.indexOf('désobéis un peu') >= 0));
check('F3. DRAIN B : l\'interjection part dans le payload DE L\'AGENT', sawInterjection);

const agentThreadTexts = await page.evaluate((id) => {
  const c = loadConversation(id);
  return (c.messages || []).filter(m => m.role === 'user').map(m => m.displayText || m.content);
}, agentF);
check('F3bis. et elle est PERSISTÉE dans le fil de l\'agent',
  agentThreadTexts.some(t => String(t).indexOf('désobéis un peu') >= 0));
check('F3ter. la file de l\'agent est vidée après le drain',
  (await page.evaluate((id) => interjectionsFor(id).length, agentF)) === 0);

// Elle n'a PAS fui dans le parent : c'est la garde du piège 28 (une génération
// écrit dans SA conversation).
const parentTexts = await page.evaluate((id) => {
  const c = loadConversation(id);
  return (c.messages || []).map(m => String(m.content || ''));
}, parentE);
check('F4. et elle n\'a pas fui dans le fil du PARENT',
  !parentTexts.some(t => t.indexOf('désobéis un peu') >= 0));
await shot('10-agent-a-recu-interjection.png');

// ── F5. File ÉCHOUÉE : l'agent finit avant que le drain ne passe ───────────
// La fenêtre que le drain B ne couvre pas : l'agent a fini ses outils et rédige
// sa réponse de clôture. `runConversation` ne rappelle plus onInterjections sur
// un `stop`, et le fil passe en lecture seule — le reflux composer du lot Q est
// donc fermé. Le rail SURVIT au verrou : rien ne disparaît en silence.
await newConv();
await page.evaluate(() => { window.__gates = {}; window.__released = {}; window.__sent = []; });
await armSpawn('GGG', 'HHH', { intent: 'Rédiger la synthèse' });
await gate('A:HHH');   // retenu pendant sa RÉDACTION (pas de tour d'outils)
await send('MARK-GGG lance un agent qui rédige');
await page.waitForTimeout(700);
const parentG = await page.evaluate(() => currentConvId);
const agentH = await childOf(parentG);
await page.evaluate((id) => openConversation(id), agentH);
await page.waitForTimeout(300);
await page.fill('#composer-text', 'trop tard mais quand même');
await page.press('#composer-text', 'Enter');
await page.waitForTimeout(250);
check('F5. l\'interjection est en file pendant la rédaction',
  (await railIds()).length === 1);

await release('A:HHH');
await page.waitForTimeout(1000);

const stranded = await page.evaluate(() => ({
  locked: document.getElementById('composer-text').disabled,
  railShown: !!document.getElementById('ij-rail') && !document.getElementById('ij-rail').hidden,
  chips: document.querySelectorAll('#ij-chips .ij-chip').length,
  caption: (document.getElementById('ij-caption-text') || {}).textContent || '',
  strandedClass: document.getElementById('ij-rail').classList.contains('ij-rail-stranded'),
}));
check('F6. l\'agent fini verrouille le composer', stranded.locked === true);
check('F6bis. mais le rail SURVIT : le texte tapé ne disparaît pas en silence',
  stranded.railShown === true && stranded.chips === 1);
check('F6ter. et la légende cesse de promettre un envoi',
  stranded.caption.indexOf('jamais transmise') >= 0 && stranded.strandedClass === true);
await shot('11-file-echouee-lecture-seule.png');

// Édition REFUSÉE : elle refluerait vers une textarea disabled, détruisant la
// puce en échange d'un texte non modifiable. Mesuré sur les DONNÉES.
const editRefusedRo = await page.evaluate(() => {
  const before = interjectionsFor(currentConvId).length;
  const id = (interjectionsFor(currentConvId)[0] || {}).id;
  editInterjection(id);
  return { before, after: interjectionsFor(currentConvId).length,
           ta: document.getElementById('composer-text').value };
});
check('F7. éditer est REFUSÉ en lecture seule : la puce reste, le composer reste vide',
  editRefusedRo.before === 1 && editRefusedRo.after === 1 && editRefusedRo.ta === '');

// Annuler reste possible : c'est la sortie offerte à l'utilisateur.
const cancelWorks = await page.evaluate(() => {
  const id = (interjectionsFor(currentConvId)[0] || {}).id;
  cancelInterjection(id);
  return interjectionsFor(currentConvId).length;
});
check('F8. annuler reste possible (la sortie offerte)', cancelWorks === 0);

// ── F9. Sélecteurs de modèle/raisonnement en lecture seule ────────────────
// Défaut constaté en usage : sur un fil d'agent terminé, les dropdowns
// s'ouvraient et se rendaient TRANSLUCIDES (l'`opacity` de .composer-inner crée
// un contexte d'empilement dont aucun descendant ne sort). La cause traitée est
// l'ouverture : ces pilules choisissent le modèle du prochain envoi, or il n'y
// en aura plus.
await page.evaluate((id) => openConversation(id), agentH);
await page.waitForTimeout(300);
const menusRo = await page.evaluate(() => {
  toggleComposerModelMenu();
  toggleComposerReasoningMenu();
  return {
    model: document.getElementById('composer-model-menu').classList.contains('show'),
    reasoning: document.getElementById('composer-reasoning-menu').classList.contains('show'),
  };
});
check('F9. les sélecteurs n\'ouvrent PLUS de menu en lecture seule',
  menusRo.model === false && menusRo.reasoning === false);

// Menu DÉJÀ ouvert quand le verrou tombe : il doit se fermer.
const menuClosedOnLock = await page.evaluate((pid) => {
  openConversation(pid);
  return new Promise(r => setTimeout(() => {
    toggleComposerModelMenu();
    const openedOnParent = document.getElementById('composer-model-menu').classList.contains('show');
    setConvReadonly(true);
    const afterLock = document.getElementById('composer-model-menu').classList.contains('show');
    setConvReadonly(false);
    r({ openedOnParent, afterLock });
  }, 300));
}, parentG);
check('F9bis. (contrôle) sur le PARENT, le menu s\'ouvre normalement',
  menuClosedOnLock.openedOnParent === true);
check('F9ter. et un menu ouvert se FERME quand le verrou tombe',
  menuClosedOnLock.afterLock === false);

// L'inspecteur de contexte, lui, reste cliquable : c'est de la LECTURE.
await page.evaluate((id) => openConversation(id), agentH);
await page.waitForTimeout(300);
const ctxUsable = await page.evaluate(() => {
  const b = document.getElementById('ctx-counter');
  return !!b && getComputedStyle(b).pointerEvents !== 'none';
});
check('F10. l\'inspecteur de contexte reste ACTIF (lecture, pas mutation)', ctxUsable);
await shot('12-selecteurs-lecture-seule.png');

console.log('\n────────────────────────────────');
if (errors.length) {
  console.log('Erreurs console :');
  for (const e of errors) console.log('  ' + e);
}
console.log(failures.length ? ('ÉCHEC — ' + failures.length + ' contrôle(s)') : 'OK — tous les contrôles passent');
await browser.close();
process.exit(failures.length ? 1 : 0);
