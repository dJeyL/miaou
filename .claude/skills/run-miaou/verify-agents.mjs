#!/usr/bin/env node
// Vérification du lot X-1 (agents — sous-conversations lancées par le modèle).
//
// X-1 n'a rien à montrer non plus : son critère est un CÂBLAGE — spawn →
// exécution → réveil → badge — que les tests QuickJS ne peuvent structurellement
// pas couvrir (project_quickjs_tests_dont_cover_orchestration_scope). Ce script
// exerce ce câblage bout en bout.
//
// Montage repris de verify-generations.mjs : stub SSE GATÉ PAR CONVERSATION.
// Chaque requête est étiquetée par un marqueur textuel de son payload, ce qui
// permet de tenir N générations ouvertes en même temps et de les libérer dans
// l'ordre voulu. Deux marqueurs coexistent ici :
//   - MARK-<T>  posé par nous dans les messages user d'une conversation racine ;
//   - AGENT-<T> posé par nous dans le `prompt` d'un agent, donc présent dans le
//     PREMIER message user de son fil (buildAgentFirstMessage).
// tagOf donne la priorité au marqueur d'AGENT quand les deux sont présents :
// le message de réveil poussé dans le fil du parent contient le texte final de
// l'agent, donc son marqueur — sans cette priorité inversée, un tour du parent
// réveillé serait étiqueté comme un tour de l'agent.
//
// Scénarios (numérotation du plan X-1 §11) :
//   1.    Spawn non bloquant     — le tour du parent continue, l'id est rendu
//   2.    Badges                 — parent inerte `working` + les DEUX agrégats
//   3.    Réveil, parent inerte  — l'enfant finit → le parent démarre un tour
//   4.    Réveil, parent occupé  — drain à la frontière de tour, rien de perdu
//   5.    HERMÉTICITÉ            — agent lancé depuis une génération détachée
//                                  dans l'Espace A, écran en B → naît dans A
//   6.    Suppression du parent  — enfant EFFECTIVEMENT arrêté
//   6bis. STOP UTILISATEUR       — parent réveillé, statut « stopped » distinct
//                                  d'« aborted » (fil de l'enfant consultable)
//   6quater. ERREUR BACKEND      — le parent est réveillé SANS onFinal : c'est
//                                  ce cas, pas le stop, qui prouve le `finally`
//   6ter. Déplacement bloqué     — case grisée ET décochée, présélection comprise
//   7.    Exclusions             — ni sidebar, ni recherche, ni conv__list ;
//                                  mais conv__get répond au parent
//   9.    Navigation parent ↔ agent — ack cliquable, bandeau, bouton de topbar
//   10.   DÉLÉGATION DE FICHIERS  — le parent confie un handle, l'agent le lit
//                                  dans SON référentiel (X-1b)
//   11.   IMAGE REGARDÉE          — l'agent rappelle une image déléguée et en
//                                  reçoit les PIXELS, tour courant ET reload (X-1d)
//
// Les deux scénarios sans lesquels le lot serait « vert et faux » sont le 5
// (herméticité) et le 6quater (erreur backend). Leur régression est INVISIBLE :
// pour le 6quater, tout paraît normal et le parent attend simplement pour
// toujours. Le brief attribuait ce rôle au 6bis (stop utilisateur) ; la mesure
// l'a démenti — un abort passe par onFinal, donc par le chemin nominal, et la
// régression réinjectée laissait le 6bis vert. Cf. le commentaire du 6bis.
//
// Deux pièges d'écriture déjà payés sur ce montage, hérités de
// verify-generations.mjs et re-payés ici :
//   - filtrer les APPELS SILENCIEUX (`stream !== true`) : titrage et résumé
//     portent le marqueur de la conversation et fausseraient les comptages ;
//   - GATER LE TOUR D'OUTILS AVANT `finish_reason`, sinon il part trop tôt et le
//     scénario passe même avec la régression réinjectée.
//
// NON-VACUITÉ — mesurée, régression par régression, le 2026-08-30. Chaque ligne
// a été réinjectée dans `src/`, le bundle reconstruit, ce script relancé, puis
// la source restaurée. Ce qui est noté ici est le RÉSULTAT observé, pas
// l'intention :
//
//   délivrance déplacée du `finally` vers onFinal ....... 6quater tombe (4)
//   spaceId de l'agent lu sur activeSpaceId ............. 5 tombe (4)
//   convBadgeState sans hasWorkingAgent ................. 2 tombe (2)
//   drain de _pendingAgentResults neutralisé ............ 4 tombe (4)
//   suppression du parent sans abort actif ............. 6 tombe (2)
//   grisé sans exclusion de présélection ............... 6ter tombe (3)
//   sidebar sans filtre isRootConversation ............. 7 tombe (1)
//   conv__get : agent étranger avec message distinct ... 7 tombe (2)
//   agent__spawn rendu bloquant ........................ 1 tombe (4, + 2 et 3)
//   topbar relit conv.title nu (sans convLabel) ........ 9 tombe (3)
//   pas de reset du bandeau dans resetToEmpty .......... 9 tombe (2)
//   retitrage laissé ouvert sur un agent ............... 9 tombe (1)
//   bouton de retour non masqué sur une racine ......... 9 tombe (1)
//   dérogation d'agent neutralisée (X-1b) .............. 10 tombe (1)
//   refus de handle introuvable avalé (X-1b) ........... 10 tombe (2)
//   recall_attachment limité au lookup att-N (X-1d) .... 11 tombe (6)
//   pas d'allocation d'attId à la volée (X-1d) ......... 11 tombe (4)
//
// QUATRIÈME RÉSULTAT (X-1d) — un BUG trouvé par le scénario, pas une régression
// réinjectée :
//
//   Les pixels arrivaient au tour courant mais PAS au rechargement.
//   `resolveRecallImages` résolvait par le couple (attId, convId), qui MENT dès
//   qu'un agent rappelle un fichier délégué : le record garde le convId du
//   PARENT (le réécrire volerait l'image au parent), l'ack est posé dans le fil
//   de l'AGENT. L'ack porte donc désormais `recordId` — une identité, pas un
//   couple — et le lookup le préfère. Sans le contrôle « au RECHARGEMENT », le
//   scénario était vert et l'image aurait disparu silencieusement du fil au
//   reload : la classe de bug qui ne se voit qu'en usage réel.
//
// TROISIÈME RÉSULTAT NÉGATIF (X-1b), même valeur que les deux autres :
//
//   La régression « dérogation neutralisée » ne fait tomber QU'UN contrôle du
//   scénario 10, pas les huit qui portent sur la délégation. Motif : l'alias
//   d'une ressource `res_…` résout de toute façon par le cache session global —
//   comportement antérieur à X-1b, que la délégation ne change pas. Seule la
//   PIÈCE JOINTE (att-N, conversation-scopée) discrimine réellement. C'est
//   pourquoi le scénario délègue les DEUX familles : sans l'attachment, il
//   serait intégralement vert avec la dérogation retirée.
//
// DEUX RÉSULTATS NÉGATIFS, gardés parce qu'ils valent plus que les positifs :
//
//   1. La régression « délivrance sur le chemin nominal » laisse le scénario
//      6bis (STOP UTILISATEUR) VERT. Le brief en faisait le scénario qui prouve
//      l'accroche au `finally` ; il ne le prouve pas. Un abort n'échappe pas à
//      la boucle de runConversation : il appelle onFinal(…, 'aborted') puis
//      retourne. D'où le scénario 6quater (erreur backend), écrit pour cela.
//   2. La régression « agrégats non alignés sur convBadgeState » (l'écart
//      d'avant X-1) laisse le scénario 2 VERT : la génération de l'enfant est
//      elle-même au registre, dans l'Espace de son parent (X-a), donc l'agrégat
//      retombe juste POUR LA MAUVAISE RAISON. C'est le « fortuitement correct »
//      que docs/agents.md donne comme deuxième motif de l'alignement — ce
//      script le CONSTATE plutôt que de le supposer, et ajoute pour cela le
//      sous-contrôle « (contrôle) sans l'entrée de l'enfant au registre ».
//
// Un bug réel a été trouvé au premier lancement : `agentResult` ne survivait pas
// à `projectThreadToMessages` (whitelist). Corrigé, avec deux tests purs.
//
// Usage : node verify-agents.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-agents');
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
// Overlay de boot : il n'est JAMAIS retiré du DOM (plancher 1,8 s côté appli),
// et une capture prise avant sa disparition montre le préchargement avec des
// assertions vertes dessous. On attend donc `.boot-done` SANS filet — un échec
// ici doit faire tomber le script, pas passer sous silence.
await page.waitForFunction(() => !!document.querySelector('.boot-done'), null, { timeout: 15000 });
await page.waitForTimeout(300);

// ── Helpers de pilotage ─────────────────────────────────────────────────────
const gate = (tag) => page.evaluate((t) => { window.__gates[t] = true; }, tag);
const release = (tag) => page.evaluate((t) => { window.__released[t] = true; }, tag);
const resetStub = () => page.evaluate(() => {
  window.__gates = {}; window.__released = {}; window.__spawns = {};
  window.__toolTags = {}; window.__errorTags = {}; window.__sent = [];
});
// Arme un tour agent__spawn sur le tag parent `pTag`, lançant l'agent `aTag`.
const armSpawn = (pTag, aTag, opts) => page.evaluate(([p, a, o]) => {
  window.__spawns['P:' + p] = {
    prompt: 'AGENT-' + a + ' fais le travail.', intent: (o && o.intent) || ('Travail ' + a),
    tools: (o && o.tools) || [],
    // `attachments` omis quand absent : le stub ne doit pas envoyer un tableau
    // vide là où le modèle n'aurait rien envoyé (le handler distingue null de []).
    attachments: (o && o.attachments) || null,
  };
}, [pTag, aTag, opts || null]);
const send = async (text) => {
  await page.fill('#composer-text', text);
  await page.press('#composer-text', 'Enter');
};
const newConv = async () => {
  await page.evaluate(() => resetToEmpty());
  await page.waitForTimeout(120);
};
const waitGenCount = (n) => page.waitForFunction(
  (want) => _activeGenerations.size === want, n, { timeout: 10000 });
const waitSent = (tag) => page.waitForFunction(
  (t) => window.__sent.some(x => x.tag === t), tag, { timeout: 10000 });
// Id de l'agent enfant d'un parent (le registre le connaît dès le spawn).
const childOf = (parentId) => page.evaluate(
  (p) => (agentChildrenOf(p, listAllConversations())[0] || {}).id || '', parentId);

// ── Fixtures représentatives (feedback_verify_needs_real_env_data) ──────────
// Un verify sur un environnement vide valide un cas qui n'existe pas chez
// Julien. On pose donc DEUX Espaces nommés en plus du défaut, chacun avec une
// conversation-témoin résumée (conv__list ne liste que des résumés, scopés par
// Espace), et une conversation d'HISTORIQUE de plusieurs tours dans l'Espace A —
// le parent des scénarios ne travaille donc jamais sur un fil vide.
console.log('\n— Fixtures');
const fx = await page.evaluate(() => {
  const mk = (name) => { const all = upsertSpace({ name }); return all[all.length - 1].id; };
  const spA = mk('Espace Alpha'), spB = mk('Espace Beta');
  const hist = [];
  for (let i = 1; i <= 4; i++) {
    hist.push({ role: 'user', content: 'Question d\'historique n°' + i + '.', ts: 1000 + i * 10 });
    hist.push({ role: 'assistant', content: 'Réponse d\'historique n°' + i + '.', model: 'stub-model', ts: 1005 + i * 10 });
  }
  saveConversation({ id: 'fx-hist-a', title: 'HISTORIQUE-A', timestamp: 1000, updatedAt: 2000,
    spaceId: spA, messages: hist });
  saveSummary('fx-hist-a', { title: 'HISTORIQUE-A', timestamp: 1000, summary: 'sha', keywords: ['alpha'] });
  saveConversation({ id: 'fx-witness-b', title: 'TEMOIN-B', timestamp: 1100, updatedAt: 2100,
    spaceId: spB, messages: [{ role: 'user', content: 'Bonjour Beta.', ts: 1100 }] });
  saveSummary('fx-witness-b', { title: 'TEMOIN-B', timestamp: 1100, summary: 'shb', keywords: ['beta'] });
  return { spA, spB };
});
check('fixtures : deux Espaces nommés en plus du défaut',
  await page.evaluate(() => loadSpaces().length >= 3));
check('fixtures : une conversation avec historique (8 messages)',
  await page.evaluate(() => (loadConversation('fx-hist-a').messages || []).length === 8));

// ═════════════════════════════════════════════════════════════════════════════
// Scénarios 1 + 2 + 3 : spawn non bloquant, badges, réveil du parent inerte
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n— Scénarios 1/2/3 : spawn non bloquant, badges, réveil du parent inerte');
await page.evaluate((id) => followSpace(id), fx.spA);
await page.waitForTimeout(150);
await resetStub();
await newConv();

// Le parent lance un agent, puis (tour suivant) répond. L'agent est gaté :
// il travaille pendant qu'on observe le parent.
await armSpawn('P1', 'A1', { intent: 'Rédiger la note de synthèse' });
await gate('A:A1');
await send('MARK-P1 lance un agent.');
await waitSent('P:P1');
await release('P:P1');           // laisse partir le tour d'outils du parent
await page.waitForFunction(() => _activeGenerations.size === 0, { timeout: 10000 })
  .catch(() => {});
await page.waitForTimeout(400);

const parentId = await page.evaluate(() => currentConvId);
const agentId = await childOf(parentId);

let s = await page.evaluate(([p, a]) => {
  const conv = loadConversation(p);
  const agent = loadConversation(a);
  const msgs = conv.messages || [];
  return {
    hasAgent: !!agent,
    agentRunning: isGenerating(a),
    parentIdle: !isGenerating(p),
    parentFinished: msgs.some(m => m.role === 'assistant' && /Fin-P:P1/.test(String(m.content || ''))),
    ackKinds: msgs.filter(m => m.role === 'tool-ack').map(m => m.kind).join(','),
    toolResultMentionsId: window.__sent.some(x => (x.body.messages || []).some(
      m => m.role === 'tool' && String(m.content || '').indexOf(a) >= 0)),
    agentParent: agent && agent.parentConvId,
    agentIntent: agent && agent.agentIntent,
    agentTitle: agent && agent.title,
    agentSpace: agent && agent.spaceId,
  };
}, [parentId, agentId]);
check('1. un agent a bien été créé', s.hasAgent === true);
check('1. l\'agent porte parentConvId = le parent', s.agentParent === parentId);
check('1. l\'intent est rendu tel quel (jamais normalisé)', s.agentIntent === 'Rédiger la note de synthèse');
check('1. l\'agent n\'est jamais titré', s.agentTitle === '');
check('1. l\'agent hérite de l\'Espace du parent', s.agentSpace === fx.spA);
check('1. le tool result rend l\'identifiant de l\'agent', s.toolResultMentionsId === true);
check('1. le tour du parent CONTINUE (réponse finale émise, spawn non bloquant)', s.parentFinished === true);
check('1. le parent est retombé inerte, l\'agent tourne encore', s.parentIdle === true && s.agentRunning === true);
check('1. un ack agent_spawn est posé dans le fil du parent', /agent_spawn/.test(s.ackKinds));

// ── Scénario 2 : badges — le parent inerte porte `working`, et les DEUX agrégats
// C'est l'assertion qui attrape le piège de l'étape 7 (agrégats qui itéraient
// _activeGenerations sans passer par convBadgeState).
s = await page.evaluate(([p, a, spA, spB]) => ({
  parent: convBadgeState(p, listAllConversations()),
  spaceA: spaceBadgeState(spA),
  spaceB: spaceBadgeState(spB),
  aggAll: aggregateBadgeState(null),
  aggElsewhere: aggregateBadgeState(spA),
  domDot: !!document.querySelector('.conv .activity-dot.working'),
  agentInSidebar: Array.from(document.querySelectorAll('.conv')).length,
  agentIsWorking: isGenerating(a),
}), [parentId, agentId, fx.spA, fx.spB]);
check('2. le parent INERTE porte la pastille working (son enfant travaille)', s.parent === 'working');
check('2. l\'agrégat de SON Espace la porte aussi', s.spaceA === 'working');
check('2. l\'agrégat hamburger (rien d\'exclu) la porte', s.aggAll === 'working');
check('2. l\'agrégat « ailleurs » (Espace du parent exclu) NE la porte PAS', s.aggElsewhere !== 'working');
check('2. la pastille est effectivement peinte en sidebar', s.domDot === true);
await shot('01-parent-badge-working.png');

// NON-VACUITÉ DE L'ASSERTION D'AGRÉGAT — mesurée, pas supposée.
// Réinjecter l'écart d'avant X-1 (agrégats qui itèrent `_activeGenerations`
// sans passer par `convBadgeState`) laisse les contrôles ci-dessus VERTS : la
// génération de l'enfant est elle-même une entrée du registre, dans l'Espace de
// son parent (X-a), donc l'agrégat retombe sur le bon résultat POUR LA MAUVAISE
// RAISON. C'est mot pour mot le « fortuitement correct » que docs/agents.md
// donne comme deuxième motif de l'alignement.
//
// On construit donc le cas où le fortuit ne sauve plus rien : on retire
// l'entrée de l'enfant du registre visible pour les agrégats — le parent n'a
// alors PLUS aucune génération à son nom ni au nom d'un enfant, et seul un
// agrégat qui dérive réellement de `convBadgeState` peut encore le voir
// travailler.
s = await page.evaluate(([p, a, spA]) => {
  const gen = _activeGenerations.get(a);
  _activeGenerations.delete(a);              // le registre ne le montre plus
  const out = {
    // hasWorkingAgent lit le registre : sans l'entrée, le parent n'est plus
    // « working » — c'est la preuve que le registre est BIEN la source, et donc
    // que ce sous-contrôle mesure la dérivation, pas un hasard.
    parentAfter: convBadgeState(p, listAllConversations()),
    spaceAfter: spaceBadgeState(spA),
  };
  _activeGenerations.set(a, gen);            // remise en état immédiate
  return out;
}, [parentId, agentId, fx.spA]);
check('2. (contrôle) sans l\'entrée de l\'enfant au registre, le parent n\'est plus working',
  s.parentAfter !== 'working');
check('2. (contrôle) …et l\'agrégat de son Espace non plus : les deux lisent la MÊME source',
  s.spaceAfter !== 'working');

// ── Scénario 3 : l'enfant finit → le parent démarre un tour avec le résultat
// Le tour de réveil du parent n'est PAS gaté : il peut démarrer et finir entre
// deux sondages. On n'observe donc pas `isGenerating` (fenêtre trop courte pour
// être fiable) mais la TRACE du tour — un envoi étiqueté du parent, postérieur
// à la fin de l'enfant. C'est ce qui prouve « le parent a démarré un tour ».
const sentBefore = await page.evaluate(() => window.__sent.length);
await release('A:A1');
await page.waitForFunction((n) => window.__sent.length > n, sentBefore, { timeout: 10000 });
check('3. le parent A DÉMARRÉ un tour à la fin de son enfant',
  await page.evaluate((n) => window.__sent.slice(n).some(x => x.tag === 'P:P1'), sentBefore));
await waitGenCount(0);
await page.waitForTimeout(400);

s = await page.evaluate(([p, a]) => {
  const msgs = loadConversation(p).messages || [];
  const wake = msgs.filter(m => m.role === 'user' && m.agentResult);
  return {
    wakeCount: wake.length,
    wakeId: wake[0] && wake[0].agentResult.id,
    wakeStatus: wake[0] && wake[0].agentResult.status,
    wakeText: wake[0] ? String(wake[0].content || '') : '',
    synthetic: wake[0] ? !!wake[0]._synthetic : null,
    agentStatus: loadConversation(a).agentStatus,
    parentAnswered: msgs.filter(m => m.role === 'assistant').length,
    domBubbles: document.querySelectorAll('#thread .msg.user').length,
  };
}, [parentId, agentId]);
check('3. un message de réveil UNIQUE est arrivé dans le fil du parent', s.wakeCount === 1);
check('3. il porte agentResult.id = l\'agent', s.wakeId === agentId);
check('3. statut « done »', s.wakeStatus === 'done');
check('3. son texte contient la réponse de l\'agent', /Fin-A:A1/.test(s.wakeText));
check('3. son texte nomme la tâche confiée', /Rédiger la note de synthèse/.test(s.wakeText));
check('3. message user AUTHENTIQUE (jamais _synthetic)', s.synthetic === false);
check('3. l\'agent est persisté en statut terminal « done »', s.agentStatus === 'done');
check('3. le parent a répondu au réveil (deux réponses au total)', s.parentAnswered === 2);
check('3. le message de réveil est VISIBLE à l\'écran', s.domBubbles === 2);
await shot('02-wake-idle-parent.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 4 : réveil d'un parent OCCUPÉ — drain à la frontière de tour
// ═════════════════════════════════════════════════════════════════════════════
// L'enfant finit pendant que le parent génère : le résultat ne doit pas être
// perdu. Il passe par la file dédiée `_pendingAgentResults` puis est drainé à la
// frontière de tour (hook onAgentResults, api.js).
console.log('\n— Scénario 4 : réveil d\'un parent OCCUPÉ (file dédiée + drain)');
await resetStub();
await newConv();

await armSpawn('P2', 'A2', { intent: 'Compiler les chiffres' });
await gate('A:A2');
await send('MARK-P2 lance un agent.');
await waitSent('P:P2');
await release('P:P2');
await page.waitForTimeout(400);
const parent2 = await page.evaluate(() => currentConvId);
const agent2 = await childOf(parent2);

// Le parent repart sur un tour d'OUTILS, gaté : il est occupé et il lui reste
// une frontière de tour à traverser — c'est là que le drain doit avoir lieu.
await page.evaluate(() => { window.__toolTags['P:P2X'] = true; window.__gates['P:P2X'] = true; });
await send('MARK-P2X deuxième question.');
await waitSent('P:P2X');
await page.waitForTimeout(200);
check('4. le parent est bien OCCUPÉ quand l\'enfant finit',
  await page.evaluate((p) => isGenerating(p), parent2));

// L'enfant termine pendant ce tour : le résultat part en file.
await release('A:A2');
await page.waitForFunction((a) => !isGenerating(a), agent2, { timeout: 10000 });
await page.waitForTimeout(250);
s = await page.evaluate(([p, a]) => ({
  queued: hasPendingAgentResults(p),
  parentStillBusy: isGenerating(p),
  alreadyInThread: (loadConversation(p).messages || []).some(m => m.agentResult),
}), [parent2, agent2]);
check('4. le résultat est MIS EN FILE (parent occupé)', s.queued === true);
check('4. le parent génère toujours', s.parentStillBusy === true);
check('4. rien n\'a encore été poussé dans son fil', s.alreadyInThread === false);

// Libérer le tour d'outils : la frontière de tour est franchie, le drain a lieu.
await release('P:P2X');
await waitGenCount(0);
await page.waitForTimeout(500);
s = await page.evaluate((p) => {
  const msgs = loadConversation(p).messages || [];
  const wake = msgs.filter(m => m.role === 'user' && m.agentResult);
  return {
    stillQueued: hasPendingAgentResults(p),
    wakeCount: wake.length,
    wakeText: wake[0] ? String(wake[0].content || '') : '',
    // Le résultat doit être PARTI SUR LE FIL vers le modèle, pas seulement
    // persisté : c'est ce qui distingue « drainé » de « rangé ».
    reachedModel: window.__sent.some(x => (x.body.messages || []).some(
      m => m.role === 'user' && /Résultat d'agent/.test(
        typeof m.content === 'string' ? m.content : ''))),
  };
}, parent2);
check('4. la file est vidée après la frontière de tour', s.stillQueued === false);
check('4. le résultat est arrivé dans le fil (rien de perdu)', s.wakeCount === 1);
check('4. il porte bien la réponse de l\'enfant', /Fin-A:A2/.test(s.wakeText));
check('4. il a effectivement été envoyé au modèle', s.reachedModel === true);
await shot('03-wake-busy-parent.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 5 : HERMÉTICITÉ — le scénario sans lequel le lot serait vert et faux
// ═════════════════════════════════════════════════════════════════════════════
// Un agent lancé depuis une génération DÉTACHÉE dans l'Espace Alpha, pendant que
// l'écran est passé dans l'Espace Beta, doit naître dans ALPHA. `spaceId` vient
// du ctx de la génération (piège 28), jamais d'activeSpaceId.
//
// La preuve ne s'arrête pas au champ `spaceId` du record : on fait exécuter un
// conv__list À L'AGENT, et son tool result doit voir le témoin d'ALPHA et jamais
// celui de BETA — c'est le référentiel EFFECTIF, pas seulement le champ.
console.log('\n— Scénario 5 : HERMÉTICITÉ (agent lancé depuis une génération détachée)');
await page.evaluate((id) => followSpace(id), fx.spA);
await page.waitForTimeout(150);
await resetStub();
await newConv();

// L'agent fera un conv__list, gaté lui aussi : il s'exécute PENDANT que l'écran
// est ailleurs.
await armSpawn('P3', 'A3', { intent: 'Inventorier Alpha', tools: ['miaou__conv__list'] });
await page.evaluate(() => {
  window.__toolTags['A:A3'] = true;   // l'agent fait un conv__list
  window.__gates['A:A3'] = true;      // et reste bloqué avant son finish_reason
  window.__gates['P:P3'] = true;      // le tour de spawn du parent est gaté aussi
});
await send('MARK-P3 lance un agent inventaire.');
await waitSent('P:P3');
await page.waitForTimeout(200);

// L'écran quitte l'Espace Alpha AVANT que le spawn ne s'exécute : la génération
// du parent devient détachée, et c'est SON ctx (Alpha) qui doit faire foi.
await page.evaluate((id) => followSpace(id), fx.spB);
await page.waitForTimeout(200);
await newConv();
const parent3 = await page.evaluate(() => Array.from(_activeGenerations.values())[0].convId);
s = await page.evaluate((sa) => ({
  screenSpace: activeSpaceId,
  genSpace: Array.from(_activeGenerations.values())[0].spaceId,
  detached: Array.from(_activeGenerations.values())[0].wrap === null,
}), fx.spA);
check('5. l\'écran est passé dans Beta', s.screenSpace === fx.spB);
check('5. la génération du parent garde Alpha et est détachée',
  s.genSpace === fx.spA && s.detached === true);

// Le spawn s'exécute maintenant, écran en Beta, génération en Alpha.
await release('P:P3');
await page.waitForFunction((p) => agentChildrenOf(p, listAllConversations()).length === 1,
  parent3, { timeout: 10000 });
await page.waitForTimeout(200);
const agent3 = await childOf(parent3);
s = await page.evaluate(([a, sa, sb]) => {
  const conv = loadConversation(a);
  const gen = _activeGenerations.get(a);
  return {
    recordSpace: conv && conv.spaceId,
    genSpace: gen && gen.spaceId,
    screenSpace: activeSpaceId,
  };
}, [agent3, fx.spA, fx.spB]);
check('5. l\'AGENT naît dans l\'Espace de sa génération parente (Alpha)', s.recordSpace === fx.spA);
check('5. sa génération porte le même Espace', s.genSpace === fx.spA);
check('5. …alors que l\'écran est toujours en Beta', s.screenSpace === fx.spB);

// Preuve EFFECTIVE : le conv__list de l'agent voit Alpha, jamais Beta.
await waitSent('A:A3');
await release('A:A3');
await page.waitForFunction((a) => !isGenerating(a), agent3, { timeout: 10000 });
await page.waitForTimeout(400);
s = await page.evaluate(() => {
  const tools = [];
  for (const p of window.__sent) {
    if (p.tag !== 'A:A3') continue;
    for (const m of (p.body.messages || [])) if (m.role === 'tool') tools.push(String(m.content || ''));
  }
  return { joined: tools.join('\n'), count: tools.length };
});
check('5. le conv__list de l\'agent a bien circulé', s.count >= 1);
check('5. il voit le témoin d\'ALPHA (référentiel de sa génération)', /HISTORIQUE-A/.test(s.joined));
check('5. il ne voit PAS le témoin de BETA (l\'écran)', !/TEMOIN-B/.test(s.joined));
await shot('04-hermeticity.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 6bis : STOP UTILISATEUR sur l'agent
// ═════════════════════════════════════════════════════════════════════════════
// Le stop utilisateur existe gratuitement : le fil de l'agent a un composer,
// donc un bouton stop qui appelle abortStream(currentConvId). On l'exerce PAR
// L'UI (clic sur #send-btn en mode stop), pas par un appel direct — c'est le
// chemin réel, celui que personne n'a décidé d'ouvrir.
//
// CE QU'IL PROUVE, ET CE QU'IL NE PROUVE PAS. Il prouve que le parent est
// réveillé, que le statut est `stopped` et non `aborted` (le parent ne réagit
// pas pareil à « j'ai arrêté cet agent » et « l'utilisateur l'a arrêté »), et
// que le fil de l'enfant est consultable pendant qu'il travaille.
//
// Il ne prouve PAS l'accroche au `finally`, contrairement à ce que le brief
// annonçait : MESURÉ en réinjectant la régression (délivrance déplacée dans
// onFinal), ce scénario reste VERT. La raison est dans api.js — un abort
// n'échappe pas à la boucle, il appelle `onFinal(content, …, 'aborted')` puis
// retourne. Le chemin nominal couvre donc le stop utilisateur.
//
// Le seul chemin de sortie qui ne voit jamais onFinal est l'EXCEPTION (erreur
// backend, HTTP non-ok qui remonte jusqu'au `catch`). C'est l'objet du scénario
// 6quater, écrit précisément parce que celui-ci ne suffisait pas.
console.log('\n— Scénario 6bis : STOP UTILISATEUR sur l\'agent (accroche au finally)');
await page.evaluate((id) => followSpace(id), fx.spA);
await page.waitForTimeout(150);
await resetStub();
await newConv();

await armSpawn('P4', 'A4', { intent: 'Explorer une piste' });
await gate('A:A4');
await send('MARK-P4 lance un agent à interrompre.');
await waitSent('P:P4');
await release('P:P4');
await page.waitForTimeout(400);
const parent4 = await page.evaluate(() => currentConvId);
const agent4 = await childOf(parent4);
check('6bis. l\'agent tourne avant le stop', await page.evaluate((a) => isGenerating(a), agent4));

// OUVRIR LE FIL DE L'ENFANT — c'est le geste réel de l'utilisateur.
await page.evaluate((a) => selectConv(a), agent4);
await page.waitForTimeout(300);
s = await page.evaluate((a) => ({
  onAgent: currentConvId === a,
  sending,                     // le composer doit être en mode stop
  btnStop: ($('send-btn') || {}).classList ? $('send-btn').classList.contains('stop') : null,
}), agent4);
check('6bis. le fil de l\'agent est ouvert et consultable', s.onAgent === true);
check('6bis. son composer est en mode stop (sending)', s.sending === true);
await shot('05-agent-thread-open.png');

// CLIC sur le bouton stop.
await page.click('#send-btn');
await page.waitForFunction((a) => !isGenerating(a), agent4, { timeout: 10000 });
await page.waitForTimeout(500);

s = await page.evaluate(([p, a]) => {
  const agent = loadConversation(a);
  const msgs = loadConversation(p).messages || [];
  const wake = msgs.filter(m => m.role === 'user' && m.agentResult);
  return {
    agentStatus: agent && agent.agentStatus,
    wakeCount: wake.length,
    wakeStatus: wake[0] && wake[0].agentResult.status,
    wakeText: wake[0] ? String(wake[0].content || '') : '',
    parentWoken: isGenerating(p) || msgs.filter(m => m.role === 'assistant').length >= 2,
  };
}, [parent4, agent4]);
check('6bis. l\'agent est persisté en statut « stopped »', s.agentStatus === 'stopped');
check('6bis. le parent a été réveillé par le stop', s.wakeCount === 1);
check('6bis. le résultat porte le statut « stopped »', s.wakeStatus === 'stopped');
// Le libellé exact vient de AGENT_STATUS_LABELS (table unique) : « interrompu
// par l'utilisateur ». On l'assert sur le wording RÉEL, pas sur la prose du
// brief (feedback_verify_dont_assume_test_vs_bug).
check('6bis. le libellé dit « interrompu par l\'utilisateur »',
  /interrompu par l'utilisateur/i.test(s.wakeText));
check('6bis. « stopped » ne se confond pas avec « interrompu par toi » (aborted)',
  !/interrompu par toi/i.test(s.wakeText));
check('6bis. le parent repart bien (il ne reste pas à attendre pour toujours)',
  s.parentWoken === true);
await waitGenCount(0);
await page.waitForTimeout(300);
// La capture doit montrer le PARENT réveillé, pas le fil de l'agent resté à
// l'écran : prise sans ce retour, elle est indiscernable de la précédente et
// laisse croire qu'on a photographié le réveil alors qu'on photographie l'agent.
await page.evaluate((p) => selectConv(p), parent4);
await page.waitForTimeout(400);
await shot('06-user-stop-wakes-parent.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 6quater : ERREUR BACKEND — LE scénario qui prouve le `finally`
// ═════════════════════════════════════════════════════════════════════════════
// Un HTTP non-ok fait lever streamCompletion ; runConversation propage, et
// driveAgentConversation atterrit dans son `catch` puis son `finally` SANS
// avoir jamais vu onFinal. C'est le seul chemin de sortie qui distingue les
// deux accroches — et donc le seul dont la régression est réellement invisible :
// avec la délivrance sur le chemin nominal, tout paraît normal (l'agent s'arrête,
// son fil porte la trace de l'erreur, aucune exception ne remonte à la console)
// et le parent attend simplement pour toujours.
console.log('\n— Scénario 6quater : erreur backend → le parent est QUAND MÊME réveillé (finally)');
await resetStub();
await newConv();

await armSpawn('P8', 'A8', { intent: 'Tâche qui échouera' });
await page.evaluate(() => { window.__errorTags['A:A8'] = true; });
await send('MARK-P8 lance un agent qui va planter.');
await waitSent('P:P8');
await release('P:P8');
await page.waitForTimeout(200);
const parent8 = await page.evaluate(() => currentConvId);
await page.waitForFunction((p) => agentChildrenOf(p, listAllConversations()).length === 1,
  parent8, { timeout: 10000 });
const agent8 = await childOf(parent8);
await page.waitForFunction((a) => !isGenerating(a), agent8, { timeout: 10000 });
await waitGenCount(0);
await page.waitForTimeout(500);

s = await page.evaluate(([p, a]) => {
  const agent = loadConversation(a);
  const msgs = loadConversation(p).messages || [];
  const wake = msgs.filter(m => m.role === 'user' && m.agentResult);
  const agentMsgs = (agent && agent.messages) || [];
  return {
    // L'agent n'a JAMAIS vu onFinal : aucun message assistant nominal, mais la
    // trace du plantage est dans son fil (sans elle, ouvrir l'agent montrerait
    // une conversation qui s'arrête sans rien dire).
    agentTrace: agentMsgs.map(m => String(m.content || '')).join('|'),
    agentStatus: agent && agent.agentStatus,
    wakeCount: wake.length,
    wakeStatus: wake[0] && wake[0].agentResult.status,
    wakeText: wake[0] ? String(wake[0].content || '') : '',
    parentReplied: msgs.filter(m => m.role === 'assistant').length,
  };
}, [parent8, agent8]);
check('6quater. le fil de l\'agent porte la trace du plantage', /Erreur/.test(s.agentTrace));
check('6quater. l\'agent est persisté en statut « error »', s.agentStatus === 'error');
check('6quater. LE PARENT EST QUAND MÊME RÉVEILLÉ (accroche au finally)', s.wakeCount === 1);
check('6quater. le résultat porte le statut « error »', s.wakeStatus === 'error');
check('6quater. le libellé le dit au parent', /terminé en erreur/i.test(s.wakeText));
check('6quater. le parent a repris la main (il n\'attend pas pour toujours)',
  s.parentReplied >= 2);
await shot('09-error-still-wakes-parent.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 6 : suppression du parent → enfant EFFECTIVEMENT arrêté
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n— Scénario 6 : suppression du parent (cascade + abort actif)');
await resetStub();
await newConv();

await armSpawn('P5', 'A5', { intent: 'Travail interrompu par suppression' });
await gate('A:A5');
await send('MARK-P5 lance un agent puis je supprime.');
await waitSent('P:P5');
await release('P:P5');
await page.waitForTimeout(400);
const parent5 = await page.evaluate(() => currentConvId);
const agent5 = await childOf(parent5);
check('6. l\'agent tourne avant la suppression',
  await page.evaluate((a) => isGenerating(a), agent5));

await page.evaluate((p) => deleteConv(p), parent5);
await page.waitForTimeout(600);
s = await page.evaluate(([p, a]) => ({
  agentStopped: !isGenerating(a),          // ARRÊT effectif, pas seulement non-corruption
  agentGone: !loadConversation(a),
  parentGone: !loadConversation(p),
  registryClean: !_activeGenerations.has(a),
  listed: listAllConversations().some(c => c.id === a || c.id === p),
}), [parent5, agent5]);
check('6. l\'enfant est EFFECTIVEMENT arrêté (pas seulement non corrompu)', s.agentStopped === true);
check('6. il a quitté le registre des générations', s.registryClean === true);
check('6. l\'enfant est supprimé en cascade', s.agentGone === true);
check('6. le parent est supprimé', s.parentGone === true);
check('6. ni l\'un ni l\'autre ne subsistent dans l\'index', s.listed === false);

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 6ter : déplacement bloqué — case grisée ET décochée
// ═════════════════════════════════════════════════════════════════════════════
// Y COMPRIS quand c'est la conversation AFFICHÉE à l'entrée dans le mode : c'est
// le cas de la présélection (ui.js, enterMoveMode). Griser sans exclure
// produirait une case cochée-grisée, irrétractable.
console.log('\n— Scénario 6ter : déplacement bloqué (grisé ET décoché)');
await resetStub();
await newConv();

await armSpawn('P6', 'A6', { intent: 'Travail bloquant le déplacement' });
await gate('A:A6');
await send('MARK-P6 lance un agent.');
await waitSent('P:P6');
await release('P:P6');
await page.waitForTimeout(400);
const parent6 = await page.evaluate(() => currentConvId);
const agent6 = await childOf(parent6);
check('6ter. l\'agent tourne', await page.evaluate((a) => isGenerating(a), agent6));

// Le parent est la conversation AFFICHÉE : c'est le cas de la présélection.
await page.evaluate(() => enterMoveMode());
await page.waitForTimeout(250);
s = await page.evaluate((p) => {
  const rows = Array.from(document.querySelectorAll('.conv'));
  let box = null;
  for (const r of rows) {
    if (r.querySelector('.conv-select') && r.onclick && r.classList.contains('active')) { box = r.querySelector('.conv-select'); break; }
  }
  return {
    selectionSize: _moveSelection.size,
    preselected: _moveSelection.has(p),
    disabled: box ? box.disabled : null,
    checked: box ? box.checked : null,
    title: box ? (box.getAttribute('title') || '') : '',
    barLabel: ($('move-bar') && $('move-bar').textContent) || '',
  };
}, parent6);
check('6ter. le parent est EXCLU de la présélection', s.preselected === false);
check('6ter. la sélection est vide (barre en cas ordinaire)', s.selectionSize === 0);
check('6ter. sa case est grisée', s.disabled === true);
check('6ter. sa case est DÉCOCHÉE (pas cochée-grisée)', s.checked === false);
check('6ter. la case porte la raison en title', /agent/i.test(s.title));
// À 1100px la sidebar est repliée : la capture ne montrerait pas la case
// grisée, c'est-à-dire pas son propre scénario. On l'ouvre explicitement pour
// le shot — les assertions, elles, lisent le DOM, qui existe dans les deux cas.
await page.evaluate(() => { $('app').classList.add('sidebar-open'); syncSpaceUI(); });
await page.waitForTimeout(250);
await shot('07-move-blocked.png');
await page.evaluate(() => { $('app').classList.remove('sidebar-open'); });
await page.evaluate(() => exitMoveMode());
await page.waitForTimeout(150);

// La garde est RE-LUE AU COMMIT, pas héritée du rendu : un agent peut démarrer
// pendant que le mode est ouvert. On force la sélection puis on tente le move.
const targetSpace = fx.spB;
s = await page.evaluate(([p, sp]) => {
  enterMoveMode();
  _moveSelection.add(p);          // simule la fenêtre de réentrance
  moveSelectedConversations(sp);
  const conv = loadConversation(p);
  exitMoveModeIfActive();
  return { space: conv && conv.spaceId };
}, [parent6, targetSpace]);
check('6ter. le commit REFUSE de déplacer un parent à enfant actif (garde re-lue)',
  s.space === fx.spA);

// Libération, puis vérification de l'EMPORT : agent inerte → l'enfant suit.
await release('A:A6');
await page.waitForFunction((a) => !isGenerating(a), agent6, { timeout: 10000 });
await waitGenCount(0);
await page.waitForTimeout(500);
s = await page.evaluate(([p, a, sp]) => {
  enterMoveMode();
  _moveSelection.add(p);
  moveSelectedConversations(sp);
  exitMoveModeIfActive();
  return { parentSpace: loadConversation(p).spaceId, agentSpace: loadConversation(a).spaceId };
}, [parent6, agent6, targetSpace]);
check('6ter. agent inerte : le parent est déplaçable', s.parentSpace === fx.spB);
check('6ter. …et son enfant est EMPORTÉ avec lui', s.agentSpace === fx.spB);

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 7 : exclusions — invisible partout, mais atteignable par son parent
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n— Scénario 7 : exclusions (sidebar, recherche, conv__list) + conv__get');
await page.evaluate((id) => followSpace(id), fx.spA);
await page.waitForTimeout(150);
await resetStub();
await newConv();

await armSpawn('P7', 'A7', { intent: 'Agent consultable par son parent' });
await gate('A:A7');
await send('MARK-P7 lance un agent consultable.');
await waitSent('P:P7');
await release('P:P7');
await page.waitForTimeout(400);
const parent7 = await page.evaluate(() => currentConvId);
const agent7 = await childOf(parent7);
await release('A:A7');
await page.waitForFunction((a) => !isGenerating(a), agent7, { timeout: 10000 });
await waitGenCount(0);
await page.waitForTimeout(500);

// L'agent a maintenant du contenu, et son parent aussi. Sidebar & recherche.
s = await page.evaluate(([p, a]) => {
  renderConvList();
  return {
    listAllHasAgent: listAllConversations().some(c => c.id === a),
    isRoot: isRootConversation(loadConversation(a)),
    parentIsRoot: isRootConversation(loadConversation(p)),
    // Prédicat de recherche plein-texte tel que la sidebar le consomme : c'est
    // `convSearchFilter` qui est branché dans renderConvList, en aval du filtre
    // racines — on vérifie ici que le terme SERAIT trouvé (le filtre matche),
    // et plus bas que la liste ne le ramène pourtant pas.
    agentBodyHasTerm: (loadConversation(a).messages || [])
      .some(m => String(m.content || '').indexOf('Fin-A:A7') >= 0),
  };
}, [parent7, agent7]);
check('7. l\'agent EXISTE bien dans l\'index (il n\'est pas caché du storage)', s.listAllHasAgent === true);
check('7. …mais isRootConversation le rejette', s.isRoot === false);
check('7. le parent, lui, est une racine', s.parentIsRoot === true);
check('7. le terme cherché est BIEN dans le fil de l\'agent (test non vide)',
  s.agentBodyHasTerm === true);

// Recherche plein-texte : DÉBOUNCÉE puis ASYNCHRONE (lecture IDB). L'évaluer
// dans la foulée compterait la liste non filtrée — un test qui passe pour la
// mauvaise raison. On attend donc que le filtre soit réellement posé.
await page.evaluate(() => { $('conv-search').value = 'Fin-A:A7'; onConvSearch(); });
await page.waitForFunction(() => typeof convSearchFilter === 'function', null, { timeout: 8000 });
await page.waitForTimeout(600);
s = await page.evaluate(([a, p]) => {
  const all = listAllConversations();
  // Ce que le filtre SEUL retiendrait (agent compris), et ce que la sidebar
  // affiche réellement (racines du Space actif, filtre appliqué ensuite).
  const matched = all.filter(c => convSearchFilter && convSearchFilter(c)).map(c => c.id);
  return {
    rows: Array.from(document.querySelectorAll('.conv')).length,
    matchedIds: matched,
    filterWouldTakeAgent: matched.indexOf(a) >= 0,
    filterAlsoTakesParent: matched.indexOf(p) >= 0,
  };
}, [agent7, parent7]);
// LE point du contrôle : le filtre plein-texte RETIENT l'agent (son fil porte
// le terme), et la sidebar ne l'affiche pourtant pas — parce que l'exclusion
// des racines est appliquée EN AMONT, jamais laissée au filtre. Un test qui se
// contenterait de compter les lignes passerait pour la mauvaise raison : le
// parent matche lui aussi, son fil contenant le message de réveil.
check('7. le filtre plein-texte retiendrait bien l\'agent (l\'exclusion n\'est pas fortuite)',
  s.filterWouldTakeAgent === true);
check('7. …et pourtant la sidebar ne l\'affiche pas (une seule ligne : le parent)',
  s.rows === 1 && s.filterAlsoTakesParent === true);
await page.evaluate(() => { $('conv-search').value = ''; onConvSearch(); });
await page.waitForTimeout(500);

// Palette (submode conversations) : cross-Space assumé, mais jamais un agent.
s = await page.evaluate((a) => {
  const items = cmdkConvItems('');
  return {
    hasAgent: items.some(i => (i.id || '').indexOf(a) >= 0 || (i.convId || '') === a),
    count: items.length,
  };
}, agent7);
check('7. la palette (cross-Space) ne propose jamais un agent', s.hasAgent === false);

// conv__list (outil modèle) : jamais l'agent. conv__get : répond au PARENT.
s = await page.evaluate(([p, a]) => {
  const list = callTool('miaou__conv__list', {}, { convId: p, spaceId: activeSpaceId });
  // `with_contents` est ce qui distingue « où en es-tu ? » de « montre-moi
  // comment tu fais tes devoirs » (docs/agents.md) : sans lui, conv__get ne rend
  // que la tête, par conception.
  const getHead = callTool('miaou__conv__get', { id: a }, { convId: p, spaceId: activeSpaceId });
  const getOwn = callTool('miaou__conv__get', { id: a, with_contents: true }, { convId: p, spaceId: activeSpaceId });
  // Depuis une AUTRE conversation, le même id doit répondre « introuvable » —
  // exactement comme un id qui n'existe pas (pas d'oracle).
  const getForeign = callTool('miaou__conv__get', { id: a }, { convId: 'fx-hist-a', spaceId: activeSpaceId });
  const getGhost = callTool('miaou__conv__get', { id: 'c-inexistant-zzz' }, { convId: 'fx-hist-a', spaceId: activeSpaceId });
  // Les handlers rendent soit une string, soit une enveloppe MCP
  // { content: [{ type:'text', text }] }. On extrait le TEXTE : stringifier
  // l'enveloppe échapperait les guillemets et ferait échouer les regex sur le
  // JSON qu'elle transporte.
  const txt = mcpText;
  return { list: txt(list), head: txt(getHead), own: txt(getOwn),
           foreign: txt(getForeign), ghost: txt(getGhost) };
}, [parent7, agent7]);
check('7. conv__list ne liste pas l\'agent', s.list.indexOf(agent7) === -1);
check('7. conv__get (tête) répond à SON parent avec statut et libellé',
  /"status":"done"/.test(s.head) && /Agent consultable par son parent/.test(s.head));
check('7. conv__get with_contents rend le FIL de l\'agent',
  /Fin-A:A7/.test(s.own));
check('7. conv__get depuis une autre conversation → introuvable', /introuvable/i.test(s.foreign));
check('7. …avec EXACTEMENT le même message qu\'un id inexistant (pas d\'oracle)',
  s.foreign === s.ghost);

// agent__status / agent__result : garde de parenté identique.
s = await page.evaluate(([p, a]) => {
  const txt = mcpText;
  return {
    statusOwn: txt(callTool('miaou__agent__status', { id: a }, { convId: p, spaceId: activeSpaceId })),
    statusForeign: txt(callTool('miaou__agent__status', { id: a }, { convId: 'fx-hist-a', spaceId: activeSpaceId })),
    statusGhost: txt(callTool('miaou__agent__status', { id: 'c-zzz' }, { convId: 'fx-hist-a', spaceId: activeSpaceId })),
    resultOwn: txt(callTool('miaou__agent__result', { id: a }, { convId: p, spaceId: activeSpaceId })),
  };
}, [parent7, agent7]);
check('7. agent__status répond à son parent', /"status":"done"/.test(s.statusOwn));
check('7. agent__status : agent étranger et id inexistant → même message',
  s.statusForeign === s.statusGhost && /introuvable/i.test(s.statusForeign));
check('7. agent__result rend le résultat de l\'agent', /Fin-A:A7/.test(s.resultOwn));
await shot('08-exclusions.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 9 : navigation parent ↔ agent (élargissement X-1)
// ═════════════════════════════════════════════════════════════════════════════
// L'ALLER existait (libellé d'ack cliquable) mais n'était pas vérifié ; le
// RETOUR et le libellé de topbar sont neufs. Le scénario tient sur la boucle
// COMPLÈTE — cliquer l'ack, revenir par le bandeau — parce que c'est le seul
// contrôle qui prouve que les deux extrémités se rejoignent : deux moitiés
// vérifiées séparément peuvent viser des conversations différentes.
//
// X-1c ajoute le BOUTON de topbar, seconde surface de retour. Le retour est
// désormais exercé par les DEUX (bouton puis bandeau) : ils partagent leur
// cible via syncAgentBanner, et une divergence donnerait deux destinations pour
// une même question. Les mesures du bouton portent sur la BOÎTE calculée, pas
// sur .hidden seul — « toujours visible » est une propriété d'opacité, et ses
// deux voisins de .topbar-mid sont justement révélés au survol. D'où le
// contrôle négatif apparié : le retitrage voisin doit mesurer opacity 0 au même
// instant, sinon un « opacity 1 » ne prouverait rien.
console.log('\n— Scénario 9 : navigation parent ↔ agent, et libellé de topbar');
await resetStub();
await newConv();

await armSpawn('P9', 'A9', { intent: 'Explorer la piste des exports' });
await gate('A:A9');
await send('MARK-P9 lance un agent que je vais aller voir.');
await waitSent('P:P9');
await release('P:P9');
await page.waitForTimeout(400);
const parent9 = await page.evaluate(() => currentConvId);
const agent9 = await childOf(parent9);
await page.evaluate(() => { const t = $('conv-title'); if (t) t.textContent = 'Conversation mère'; onTitleBlur({ target: t }); });
await page.waitForTimeout(200);

// L'agent doit avoir FINI avant qu'on mesure le bouton de retitrage : tant
// qu'il est en vol son fil n'a pas de bulle assistant, et le contrôle « le
// bouton est fermé » passerait sans que la garde y soit pour rien.
await release('A:A9');
await page.waitForTimeout(700);

// L'ALLER : cliquer le libellé de l'ack agent_spawn, pas selectConv en direct.
const linkFound = await page.evaluate(() => {
  const a = document.querySelector('.tool-ack .ack-conv-link');
  if (!a) return false;
  a.click();
  return true;
});
check('9. le libellé de l\'ack agent_spawn est cliquable', linkFound === true);
await page.waitForTimeout(600);
s = await page.evaluate(([p, a]) => ({
  onAgent: currentConvId === a,
  topbar: $('conv-title').textContent,
  docTitle: document.title,
  editable: $('conv-title').contentEditable,
  retitleHidden: document.querySelector('.conv-retitle-btn').hidden,
  hasAssistant: currentThread.some(m => m.role === 'assistant'),
  bannerShown: $('agent-banner').classList.contains('show'),
  bannerLink: $('agent-banner-link').textContent,
  // Bouton de retour en topbar (X-1c) : mesuré en BOÎTE, pas seulement sur
  // .hidden — une affordance « toujours visible » qui serait masquée par
  // l'opacité ou par la règle de survol de ses voisins passerait un contrôle
  // sur .hidden seul.
  parentBtnHidden: document.querySelector('.conv-parent-btn').hidden,
  parentBtnOpacity: getComputedStyle(document.querySelector('.conv-parent-btn')).opacity,
  parentBtnTitle: document.querySelector('.conv-parent-btn').title,
  parentBtnWired: typeof document.querySelector('.conv-parent-btn').onclick === 'function',
  // Contrôle de NON-VACUITÉ de la persistance : le bouton de retitrage voisin,
  // lui, est bien à opacité 0 hors survol. Sans cette mesure, un « opacity 1 »
  // ne prouverait pas que la règle de survol a été contournée — elle pourrait
  // ne pas s'appliquer du tout dans ce contexte de test.
  retitleOpacity: getComputedStyle(document.querySelector('.conv-retitle-btn')).opacity,
  parentId: p,
}), [parent9, agent9]);
check('9. le clic ouvre bien le fil de l\'agent', s.onAgent === true);
check('9. la topbar affiche l\'intent, PAS « Nouvelle conversation »',
  s.topbar === 'Explorer la piste des exports');
check('9. le titre de page suit le même libellé', /Explorer la piste des exports/.test(s.docTitle));
check('9. le titre d\'un agent n\'est pas éditable à la main', s.editable === 'false');
// Contrôle NON VACUEUX : l'agent porte bien une bulle assistant, donc le bouton
// s'afficherait sans la garde. Sans cette vérification, le contrôle passerait
// simplement parce que le bouton était déjà caché — vert pour la mauvaise
// raison (motif déjà payé sur les agrégats de badges).
check('9. l\'agent a bien une réponse assistant (le bouton s\'afficherait sans garde)',
  s.hasAssistant === true);
check('9. « Régénérer le titre » est fermé sur un agent', s.retitleHidden === true);
check('9. le bandeau de parenté est affiché', s.bannerShown === true);
check('9. il nomme le PARENT, avec son titre réel', s.bannerLink === 'Conversation mère');
check('9. le bouton de retour est présent en topbar', s.parentBtnHidden === false);
check('9. il est TOUJOURS visible, sans survol', s.parentBtnOpacity === '1');
check('9. et son voisin de retitrage, lui, est bien masqué hors survol (contrôle négatif)',
  s.retitleOpacity === '0');
check('9. son title nomme le parent, le bouton étant une icône seule',
  /Conversation mère/.test(s.parentBtnTitle));
check('9. il porte un handler de clic', s.parentBtnWired === true);
await shot('10-agent-navigation.png');

// Le RETOUR par le BOUTON de topbar (X-1c) — la seule affordance qui survit au
// défilement, le bandeau sortant de vue dès qu'on descend dans le fil.
await page.evaluate(() => document.querySelector('.conv-parent-btn').click());
await page.waitForTimeout(600);
s = await page.evaluate(([p]) => ({
  backOnParent: currentConvId === p,
  parentBtnHidden: document.querySelector('.conv-parent-btn').hidden,
}), [parent9]);
check('9. le BOUTON de topbar ramène à la conversation mère', s.backOnParent === true);
check('9. et il disparaît sur une racine', s.parentBtnHidden === true);

// Le RETOUR par le bandeau (les deux surfaces mènent au même endroit).
await page.evaluate((a) => selectConv(a), agent9);
await page.waitForTimeout(500);
await page.evaluate(() => $('agent-banner-link').click());
await page.waitForTimeout(600);
s = await page.evaluate(([p]) => ({
  backOnParent: currentConvId === p,
  topbar: $('conv-title').textContent,
  editable: $('conv-title').contentEditable,
  bannerShown: $('agent-banner').classList.contains('show'),
}), [parent9]);
check('9. le bandeau ramène à la conversation mère', s.backOnParent === true);
check('9. la topbar y reprend son titre', s.topbar === 'Conversation mère');
check('9. le titre y redevient éditable', s.editable === 'true');
check('9. le bandeau disparaît sur une racine', s.bannerShown === false);

// Le bandeau ne survit pas à un écran d'accueil (chemin qui ne passe PAS par
// openConversation : sans reset explicite, il resterait affiché sur du vide).
await page.evaluate((a) => selectConv(a), agent9);
await page.waitForTimeout(500);
await page.evaluate(() => newConversation());
await page.waitForTimeout(400);
s = await page.evaluate(() => ({
  bannerShown: $('agent-banner').classList.contains('show'),
  editable: $('conv-title').contentEditable,
  parentBtnHidden: document.querySelector('.conv-parent-btn').hidden,
}));
check('9. « Nouvelle conversation » depuis un agent masque le bandeau', s.bannerShown === false);
check('9. et masque aussi le bouton de retour (chemin hors openConversation)',
  s.parentBtnHidden === true);
check('9. et rouvre le titre à l\'édition', s.editable === 'true');

// Parent supprimé : le bandeau reste, sans lien mort.
await page.evaluate((p) => deleteConv(p), parent9);
await page.waitForTimeout(500);
const orphan = await page.evaluate(async (a) => {
  const conv = { id: 'orphan-agent', parentConvId: 'disparu-xyz', title: '',
    agentIntent: 'Agent devenu orphelin', spaceId: activeSpaceId, messages: [], timestamp: Date.now() };
  saveConversation(conv);
  await openConversation('orphan-agent');
  return { shown: $('agent-banner').classList.contains('show'),
           text: $('agent-banner-link').textContent,
           topbar: $('conv-title').textContent,
           parentBtnHidden: document.querySelector('.conv-parent-btn').hidden };
});
check('9. parent disparu : le bandeau reste affiché', orphan.shown === true);
check('9. il le dit, plutôt que d\'offrir un lien mort', /supprimée/.test(orphan.text));
check('9. la topbar affiche quand même l\'intent de l\'orphelin',
  orphan.topbar === 'Agent devenu orphelin');
// Le bouton, lui, DISPARAÎT : une affordance permanente et inerte au clic est
// pire qu'absente. Le bandeau reste pour EXPLIQUER (il porte le texte).
check('9. parent disparu : le bouton de retour disparaît, plutôt que rester inerte',
  orphan.parentBtnHidden === true);

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 10 : délégation de fichiers à l'agent (X-1b)
// ═════════════════════════════════════════════════════════════════════════════
// Ce que les tests QuickJS NE peuvent pas couvrir ici : ils appellent
// `callInternalTool` avec un ctx fabriqué et un cache session peuplé à la main.
// Le câblage réel — le parent résout SES handles, l'agent démarre avec la table
// figée, et son PAYLOAD porte le handle atteignable — n'est exercé que par un
// vrai spawn suivi d'une vraie requête.
//
// Le TÉMOIN est le payload de l'agent (`window.__sent`), pas un retour de
// fonction : c'est ce que le modèle lit vraiment
// (project_verify_stubbed_model_real_mcp). Une régression qui casserait la
// résolution sans casser le cadrage passerait un contrôle sur le seul retour de
// `agent__spawn`.
//
// La ressource est créée par `_storeBlock`, le chemin RÉEL (IDB + cache
// session), pas par une injection directe dans `_resourceCache` : c'est
// justement l'aller-retour par le store qui est en jeu dans le filet de
// réhydratation.
console.log('\n— Scénario 10 : délégation de fichiers à l\'agent (X-1b)');
await page.evaluate((id) => followSpace(id), fx.spA);
await page.waitForTimeout(150);
await resetStub();
await newConv();

// PRÉMISSE (contrôle négatif) : sans délégation, l'agent ne résout PAS le
// handle du parent. Sans cette mesure, le contrôle nominal passerait pour la
// mauvaise raison — c'est exactement le trou que X-1b ferme.
await armSpawn('P10A', 'A10A', { intent: 'Agent sans fichier' });
await gate('A:A10A');
await send('MARK-P10A lance un agent sans fichier');
await waitSent('P:P10A');
await release('P:P10A');
await page.waitForTimeout(500);
const parent10 = await page.evaluate(() => currentConvId);

// DEUX fichiers dans la conversation parente, par les chemins de stockage RÉELS
// (IDB + cache session) — c'est l'aller-retour par le store qui est en jeu, pas
// une injection directe dans _resourceCache :
//   - une PIÈCE JOINTE (att-N), conversation-scopée : le cas réellement bloqué
//     avant X-1b, et donc le seul contrôle négatif honnête ;
//   - une ressource de session (res_…), qui passait déjà — mais par EFFET DE
//     BORD du cache global, sans être annoncée nulle part. C'est elle qu'on
//     délègue, pour vérifier que le chemin devient explicite et nommé.
const res10 = await page.evaluate(async (pid) => {
  const attId = reserveAttIdFor(pid);
  const att = await storeAttachment(attId, 'text/plain', 'notes-jointes.txt',
    utf8Encode('pièce jointe du parent'), 'inline', pid, Date.now(), Math.random, null);
  const id = await _storeBlock('text/csv', 'donnees.csv',
    utf8Encode('client,requetes\nalpha,42\nbeta,17\n'), 'inline', pid, Date.now(), Math.random);
  return { id: id, cached: !!getCachedRecord(id), attRef: attId, attStored: !!att };
}, parent10);
check('10. la ressource du parent est bien stockée et en cache', res10.cached === true);
check('10. la pièce jointe du parent est bien stockée', res10.attStored === true);

const agent10A = await childOf(parent10);
const bare10 = await page.evaluate(([rid, aref, kidId, pid]) => ({
  files: (loadConversation(kidId).agentFiles || []).length,
  // La pièce jointe résout chez le PARENT (prémisse : elle existe vraiment)…
  attOnParent: !!resolveHandleRecord(aref, { convId: pid, spaceId: activeSpaceId }),
  // …et PAS chez l'agent : c'est le trou que X-1b ferme.
  attInAgent: !!resolveHandleRecord(aref, { convId: kidId, spaceId: activeSpaceId }),
}), [res10.id, res10.attRef, agent10A, parent10]);
check("10. un agent SANS délégation ne porte aucun fichier", bare10.files === 0);
check('10. la pièce jointe résout bien chez le parent (prémisse du contrôle)',
  bare10.attOnParent === true);
check("10. …et PAS chez l'agent : le trou que X-1b ferme", bare10.attInAgent === false);
await release('A:A10A');
await page.waitForFunction((a) => !isGenerating(a), agent10A, { timeout: 10000 });
await waitGenCount(0);

// Le cas nominal se joue dans une conversation parente NEUVE, et non dans celle
// du contrôle négatif : le fil de celle-ci porte déjà un `role:'tool'` du
// premier spawn, or le stub n'émet un tour d'outils qu'au premier passage
// (sans quoi la boucle ne se terminerait jamais). Limite du montage, pas du
// code testé — et les fichiers sont donc recréés dans le nouveau référentiel,
// ce qui est de toute façon la seule chose qui ait un sens : un handle ne vaut
// que dans SA conversation.
// La conversation parente est matérialisée AVANT d'y déposer les fichiers et
// AVANT d'armer le spawn : le stub lit `__spawns[tag]` à l'entrée de la
// requête, donc armer pendant qu'un tour est déjà en vol arriverait trop tard.
await resetStub();
await newConv();
const parent10B = await page.evaluate(() => {
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  saveConversation({ id: id, title: 'Parent porteur de fichiers', spaceId: activeSpaceId,
    messages: [], timestamp: Date.now(), updatedAt: Date.now() });
  return id;
});
await page.evaluate((id) => openConversation(id), parent10B);
await page.waitForTimeout(300);
const res10B = await page.evaluate(async (pid) => {
  const attId = reserveAttIdFor(pid);
  await storeAttachment(attId, 'text/plain', 'notes-jointes.txt',
    utf8Encode('pièce jointe du parent'), 'inline', pid, Date.now(), Math.random, null);
  const id = await _storeBlock('text/csv', 'donnees.csv',
    utf8Encode('client,requetes\nalpha,42\nbeta,17\n'), 'inline', pid, Date.now(), Math.random);
  return { id: id, attRef: attId };
}, parent10B);
await armSpawn('P10B', 'A10B', { intent: 'Analyser le CSV', tools: ['miaou__js__eval'],
  attachments: [res10B.attRef, res10B.id] });
await gate('A:A10B');
await send('MARK-P10B délègue ses fichiers');
await waitSent('P:P10B');
await page.waitForFunction((p) => agentChildrenOf(p, listAllConversations()).length >= 1,
  parent10B, { timeout: 10000 });
// Le spawn est traité au TOUR D'OUTILS, donc après la libération du gate parent.

const deleg = await page.evaluate(([rid, aref, pid]) => {
  const kid = listAllConversations().filter(c => c.parentConvId === pid)[0];
  const conv = loadConversation(kid.id);
  const files = conv.agentFiles || [];
  // Le payload de l'AGENT : ce qu'il lit vraiment.
  const sent = window.__sent.filter(x => x.tag === 'A:A10B');
  const firstUser = sent.length
    ? (sent[0].body.messages || []).filter(m => m.role === 'user').pop()
    : null;
  const ackEntry = (loadConversation(pid).messages || [])
    .find(m => m.role === 'tool-ack' && m.kind === 'agent_spawn');
  const csv = files.find(f => f.name === 'donnees.csv') || {};
  const att = files.find(f => f.name === 'notes-jointes.txt') || {};
  return {
    agentId: kid.id,
    fileCount: files.length,
    alias: csv.alias,
    attAlias: att.alias,
    recordId: csv.recordId,
    name: csv.name,
    aliasFamilies: files.map(f => f.alias),
    // La PIÈCE JOINTE déléguée — la famille qui ne passait par AUCUN canal
    // avant X-1b — doit résoudre chez l'agent sous son alias réécrit.
    attResolvesInAgent: !!resolveHandleRecord(att.alias, { convId: kid.id, spaceId: activeSpaceId }),
    // Résolution DANS le référentiel de l'agent.
    resolvesInAgent: !!resolveHandleRecord(csv.alias, { convId: kid.id, spaceId: activeSpaceId }),
    resolvedIsSameRecord:
      (resolveHandleRecord(csv.alias, { convId: kid.id, spaceId: activeSpaceId }) || {}).id === rid,
    // Le handle de PIÈCE JOINTE du parent (att-N) reste inerte chez l'agent :
    // c'est la famille conversation-scopée, celle qui ne passait par AUCUN
    // canal. Un `res_<id>` du parent, lui, résout de toute façon par le cache
    // session global — comportement antérieur à X-1b, documenté comme tel, et
    // que la délégation ne change pas : l'asserter comme « introuvable » serait
    // tester un invariant qui n'existe pas.
    parentAttInAgent: !!resolveHandleRecord(aref, { convId: kid.id, spaceId: activeSpaceId }),
    // Une racine ne bénéficie JAMAIS de la dérogation.
    aliasOnParent: !!resolveHandleRecord(att.alias, { convId: pid, spaceId: activeSpaceId }),
    firstUserText: firstUser ? (typeof firstUser.content === 'string' ? firstUser.content : '') : '',
    toolNames: sent.length ? sent[0].tools : [],
    ackPresent: !!ackEntry,
  };
}, [res10B.id, res10B.attRef, parent10B]);

check("10. l'agent porte exactement les deux fichiers délégués", deleg.fileCount === 2);
check("10. les deux alias sont de la famille res_ (aucune quatrième famille)",
  deleg.aliasFamilies.length === 2 && deleg.aliasFamilies.every(a => /^res_[a-z0-9]+$/.test(a)));
check("10. la PIÈCE JOINTE, bloquée par tout canal avant X-1b, résout chez l'agent",
  deleg.attResolvesInAgent === true);
check('10. il pointe sur le record RÉEL du parent', deleg.recordId === res10B.id);
check('10. le nom du fichier est conservé', deleg.name === 'donnees.csv');
// NOTE de non-vacuité : ces deux contrôles portent sur l'alias du `res_…`, qui
// résoudrait DE TOUTE FAÇON par le cache session global — ils ne tombent donc
// pas si l'on désactive la dérogation. Ce sont des contrôles de cohérence (le
// bon record derrière le bon alias), pas la preuve du mécanisme. La preuve,
// c'est la ligne « PIÈCE JOINTE » ci-dessus : elle seule tombe quand la
// dérogation est neutralisée (régression réinjectée, mesurée).
check("10. l'alias résout DANS la conversation de l'agent", deleg.resolvesInAgent === true);
check('10. …et rend bien le même record que celui du parent',
  deleg.resolvedIsSameRecord === true);
check("10. le handle att-N du parent reste inerte chez l'agent (seul l'alias vaut)",
  deleg.parentAttInAgent === false);
check("10. la dérogation ne s'ouvre pas pour la conversation racine (alias inerte chez le parent)",
  deleg.aliasOnParent === false);
// Le cadrage : l'agent doit LIRE le handle, sinon la capacité est muette.
check("10. le payload de l'agent annonce le fichier par son NOM",
  /donnees\.csv/.test(deleg.firstUserText));
check("10. …et lui donne le handle ATTEIGNABLE (pas une capacité sans prise)",
  deleg.firstUserText.indexOf(deleg.alias) >= 0);
check("10. le handle de PIÈCE JOINTE du parent n'apparaît PAS dans son cadrage",
  deleg.firstUserText.indexOf(res10B.attRef) < 0);
// La trousse reste indépendante des fichiers : deux axes, pas un.
check("10. l'outil délégué est bien dans SON payload", deleg.toolNames.includes('miaou__js__eval'));
check('10. et le payload reste restreint (pas tout le registre)', deleg.toolNames.length < 5);
check('10. un ack agent_spawn a été poussé dans le fil du parent', deleg.ackPresent === true);
await release('A:A10B');
await page.waitForTimeout(500);

// REFUS : un handle que le parent ne peut pas adresser. Le refus doit NOMMER le
// handle, et AUCUN agent ne doit être lancé (le refus porte sur tout le lot).
// Conversation NEUVE ici aussi : le stub n'émet un tour d'outils qu'au premier
// passage, et les deux parents précédents portent déjà un tool result.
await resetStub();
await newConv();
await armSpawn('P10C', 'A10C', { intent: 'Fichier fantôme', attachments: ['res_nexistepas'] });
await send('MARK-P10C délègue un handle mort');
await waitSent('P:P10C');
await page.waitForTimeout(1200);
const parent10C = await page.evaluate(() => currentConvId);
const before10 = 0;
const refused = await page.evaluate(([n, pid]) => {
  const acks = (loadConversation(pid).messages || []).filter(m => m.role === 'tool-ack');
  const last = acks[acks.length - 1];
  return {
    spawned: listAllConversations().filter(c => c.parentConvId === pid).length - n,
    ackError: !!(last && ackIsError(last)),
    msg: (last && last.message) || '',
  };
}, [before10, parent10C]);
check("10. handle introuvable : AUCUN agent n'est lancé", refused.spawned === 0);
check("10. l'échec est tracé sur l'ack", refused.ackError === true);
check('10. et le refus NOMME le handle fautif', /res_nexistepas/.test(refused.msg));
await shot('11-agent-delegated-files.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 11 : un agent REGARDE une image déléguée (X-1d)
// ═════════════════════════════════════════════════════════════════════════════
// Le cas rapporté par Julien : le modèle télécharge une image, la confie à un
// agent pour l'analyser, et l'agent patine — il finit par tenter de lire le PNG
// avec js__eval. Deux trous, pas un :
//   (a) recall_attachment résolvait par getCachedRecordByAttId, HORS de la
//       dérogation X-1b : un att-N délégué restait inatteignable ;
//   (b) une image stockée par _storeBlock (fetch_url) n'a AUCUN attId — or
//       l'attId est la clef du seul chemin qui met des pixels dans un contexte
//       (piège 19). Personne, pas même le parent, ne pouvait la regarder.
//
// Le TÉMOIN est la présence d'une part `image_url` dans le payload SUIVANT de
// l'agent : c'est la seule preuve que les pixels sont arrivés. Un contrôle sur
// le tool result ne prouverait rien — il est textuel par conception (un contenu
// image dans un role:'tool' confabule, probe A2/D3).
console.log('\n— Scénario 11 : un agent regarde une image déléguée (X-1d)');
await resetStub();
await newConv();
const parent11 = await page.evaluate(() => {
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  saveConversation({ id: id, title: 'Parent avec image', spaceId: activeSpaceId,
    messages: [], timestamp: Date.now(), updatedAt: Date.now() });
  return id;
});
await page.evaluate((id) => openConversation(id), parent11);
await page.waitForTimeout(300);

// Une image stockée comme le fait fetch_url : _storeBlock, classe 'binary',
// AUCUN attId. C'est la configuration exacte du cas rapporté.
const img11 = await page.evaluate(async (pid) => {
  // PNG 1x1 valide (le contenu importe peu, la présence des octets si).
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const id = await _storeBlock('image/png', 'photo.png', base64ToArrayBuffer(b64),
    'binary', pid, Date.now(), Math.random, 'https://exemple.test/photo.png');
  const rec = getCachedRecord(id);
  return { id: id, hasAttId: !!(rec && rec.attId) };
}, parent11);
check('11. l\'image stockée par le chemin fetch_url n\'a AUCUN attId (prémisse)',
  img11.hasAttId === false);

// Le parent la délègue ; l'agent reçoit recall_attachment et l'appelle sur
// l'alias reçu.
await page.evaluate(([p, a, handle]) => {
  window.__spawns['P:' + p] = { prompt: 'AGENT-' + a + ' regarde l\'image.',
    intent: 'Analyser la photo', tools: ['miaou__recall_attachment'],
    attachments: [handle] };
}, ['P11', 'A11', img11.id]);
// L'alias est DÉTERMINISTE (agentDelegatedAlias, substitution de préfixe) : on
// peut donc armer le tour d'outils de l'agent AVANT son lancement. C'est
// nécessaire — le stub lit `__toolTags[tag]` à l'entrée de la requête, et armer
// après le départ du premier payload arriverait trop tard.
const alias11 = await page.evaluate((rid) => agentDelegatedAlias(rid), img11.id);
await page.evaluate((alias) => {
  window.__toolTags['A:A11'] = { name: 'miaou__recall_attachment', args: { ref: alias } };
}, alias11);
await gate('A:A11');
await send('MARK-P11 confie l\'image à un agent');
await waitSent('P:P11');
await page.waitForFunction((p) => agentChildrenOf(p, listAllConversations()).length >= 1,
  parent11, { timeout: 10000 });
const agent11 = await childOf(parent11);
const alias11Real = await page.evaluate((a) => ((loadConversation(a).agentFiles || [])[0] || {}).alias, agent11);
check('11. l\'agent a bien reçu l\'image en délégation', /^res_/.test(alias11Real || ''));
check('11. l\'alias dérivé est bien celui que porte la table (prémisse de l\'armement)',
  alias11Real === alias11);
await release('A:A11');
// Deux payloads pour l'agent : celui qui porte le tool call, puis celui qui
// suit — c'est dans ce SECOND que les pixels doivent apparaître.
await page.waitForFunction(() => window.__sent.filter(x => x.tag === 'A:A11').length >= 2,
  null, { timeout: 15000 });

const seen11 = await page.evaluate((aid) => {
  const sent = window.__sent.filter(x => x.tag === 'A:A11');
  const last = sent[sent.length - 1];
  const msgs = last.body.messages || [];
  // Une part image dans un message user : le chemin du piège 19.
  let imageParts = 0, dataUrlOk = false;
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part && part.type === 'image_url') {
        imageParts++;
        const u = (part.image_url || {}).url || '';
        if (u.indexOf('data:image/png;base64,') === 0) dataUrlOk = true;
      }
    }
  }
  const toolMsg = msgs.filter(m => m.role === 'tool').pop();
  const conv = loadConversation(aid);
  const ack = (conv.messages || []).find(m => m.role === 'tool-ack' && m.kind === 'attachment_recalled');
  const rec = getCachedRecord(((conv.agentFiles || [])[0] || {}).recordId);
  return {
    imageParts: imageParts,
    dataUrlOk: dataUrlOk,
    toolText: toolMsg ? String(toolMsg.content || '') : '',
    ackPresent: !!ack,
    ackAttId: ack ? ack.attId : '',
    recordGotAttId: !!(rec && rec.attId),
  };
}, agent11);

check('11. l\'outil a répondu sans échouer', /suit dans le message suivant/.test(seen11.toolText));
check('11. un attId a été alloué à la volée sur le record', seen11.recordGotAttId === true);
check('11. un ack attachment_recalled est posé dans le fil de l\'agent',
  seen11.ackPresent === true);
check('11. il porte l\'attId alloué (clef du chemin de ré-injection)',
  /^att-\d+$/.test(seen11.ackAttId || ''));
check('11. LES PIXELS arrivent dans le payload suivant de l\'agent',
  seen11.imageParts >= 1);
check('11. …sous forme de dataUrl PNG exploitable', seen11.dataUrlOk === true);

// L'attId ne sert PAS au tour courant (l'injection y porte la dataUrl, il n'y
// est qu'une étiquette) : il sert aux envois ULTÉRIEURS, où resolveRecallImages
// reconstruit l'image depuis l'ack PERSISTÉ. Sans ce contrôle, la régression
// « pas d'allocation » ne ferait tomber que deux assertions de forme, et
// l'image disparaîtrait silencieusement du fil au rechargement — exactement la
// classe de bug qui ne se voit qu'en usage réel.
const persisted11 = await page.evaluate((aid) => {
  const conv = loadConversation(aid);
  const resolved = resolveRecallImages(conv.messages || []);
  const withImg = resolved.filter(m => m && m.recallImage);
  const expanded = expandThread(resolved);
  let parts = 0;
  for (const m of expanded) {
    if (!Array.isArray(m.content)) continue;
    for (const p of m.content) if (p && p.type === 'image_url') parts++;
  }
  return { recalled: withImg.length, parts: parts };
}, agent11);
check('11. au RECHARGEMENT, l\'ack persisté reconstruit l\'image depuis l\'attId',
  persisted11.recalled >= 1);
check('11. …et expandThread la remet en part image dans le fil de l\'agent',
  persisted11.parts >= 1);
await shot('12-agent-recalls-image.png');

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
