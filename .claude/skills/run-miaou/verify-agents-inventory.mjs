#!/usr/bin/env node
// Inventaire des agents (lot T-3) — palette de commandes et popover de topbar.
//
// CE QUE LE LOT LIVRE : une même question (« qu'est-ce qui travaille, où que ce
// soit ? ») exposée sur DEUX surfaces, depuis UN prédicat pur partagé
// (`agentInventory`, agents.js). Le contrôle qui compte n'est donc pas qu'une
// surface soit correcte, mais que les deux répondent la MÊME chose : c'est le
// motif « prédicat unique vérifié par ses consommateurs ».
//
// Trois choses ne se voient QU'ICI, jamais dans les tests QuickJS (qui portent
// sur le prédicat pur, avec un registre et des conversations en arguments) :
//
//   1. le BRANCHEMENT du pur sur ses sources vivantes (`liveAgentInventory`) —
//      un prédicat juste appliqué aux mauvaises données reste faux ;
//   2. la COHÉRENCE pilule / popover : le compte affiché doit valoir exactement
//      le nombre de lignes listées. Compte ET visibilité dérivent de
//      l'inventaire — la visibilité lisait le registre `_activeGenerations`
//      jusqu'au 2026-09-12, et cet écart de grandeur faisait disparaître la
//      pilule dès qu'on ouvrait le fil d'un agent dont le parent attendait
//      (une entrée au registre, deux lignes à l'inventaire) ;
//   3. le cas du PARENT INERTE en attente de ses agents : il n'a aucune entrée
//      dans `_activeGenerations`, donc tout comptage fondé sur ce seul registre
//      le manque. C'est le cas qui a motivé de changer la source du compte.
//
// NON-VACUITÉ : le scénario 1 fabrique un parent inerte à trois agents. Avant le
// lot, la pilule affichait « 3 agents » (le registre) là où l'inventaire en
// liste 4 (le parent plus ses trois enfants) — l'écart est le point de mesure.
//
// Montage : stub SSE gaté par conversation, repris tel quel de
// verify-agent-unread-ghost.mjs (lui-même de verify-agents.mjs) — étiquetage
// MARK-<T> pour un fil racine, AGENT-<T> pour un fil d'agent.
//
// Usage : node verify-agents-inventory.mjs <dossier-captures> [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-agents-inventory');
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

// Lignes du popover telles qu'AFFICHÉES, jamais l'inventaire relu par la vitre :
// c'est le rendu qu'on vérifie, pas le prédicat (déjà couvert en QuickJS).
const popoverRows = () => page.evaluate(() => Array.from(
  document.querySelectorAll('#agent-menu .agent-row')).map(el => ({
    depth: el.classList.contains('depth-1') ? 1 : 0,
    label: (el.querySelector('.agent-row-label') || {}).textContent || '',
    meta: (el.querySelector('.agent-row-meta') || {}).textContent || '',
    provisional: !!el.querySelector('.agent-row-label.provisional'),
  })));

// Items de la palette en sous-mode `agent`, lus au DOM pour la même raison.
const paletteRows = () => page.evaluate(() => Array.from(
  document.querySelectorAll('#cmdk-list .cmdk-item')).map(el => ({
    label: (el.querySelector('.cmdk-item-label') || {}).textContent || '',
    note: (el.querySelector('.cmdk-item-note') || {}).textContent || '',
    hint: (el.querySelector('.cmdk-item-hint') || {}).textContent || '',
  })));

const pill = () => page.evaluate(() => {
  const el = document.getElementById('agent-count');
  const lbl = document.getElementById('agent-count-label');
  return { hidden: !!el.hidden, label: (lbl || {}).textContent || '',
           expanded: el.getAttribute('aria-expanded') };
});

// ── Fixtures : deux Espaces nommés en plus du défaut ─────────────────────────
// Il FAUT un second Espace : l'inventaire est cross-Space, et sans divergence
// entre « ici » et « ailleurs » l'annotation d'Espace serait verte par
// construction (le motif du verify-badges).
console.log('\n— Fixtures');
const fx = await page.evaluate(() => {
  const mk = (name) => { const all = upsertSpace({ name }); return all[all.length - 1].id; };
  return { spA: mk('Espace Alpha'), spB: mk('Espace Beta') };
});
check('fixtures : deux Espaces nommés en plus du défaut',
  await page.evaluate(() => loadSpaces().length >= 3));

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 1 — parent INERTE à trois agents : le cas que le registre seul manque
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n— Scénario 1 : parent inerte, trois agents au travail');
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
await page.waitForTimeout(700);

const parentId = await page.evaluate(() => currentConvId);
const agentIds = await page.evaluate(
  (p) => agentChildrenOf(p, listAllConversations()).map(c => c.id), parentId);
check('1. trois agents créés et en vol',
  agentIds.length === 3 && await page.evaluate((ids) => ids.every(id => isGenerating(id)), agentIds));

// LE point du scénario : le parent n'est PAS au registre, mais il est à
// l'inventaire. Si ces deux assertions tombaient ensemble, le reste ne
// signifierait rien.
check('1. le parent inerte n\'a AUCUNE entrée au registre de générations',
  await page.evaluate((p) => !isGenerating(p), parentId));
check('1. il est pourtant à l\'inventaire, comme racine de ses trois agents',
  await page.evaluate((p) => {
    const inv = liveAgentInventory();
    const g = inv.find(x => x.conv.id === p);
    return !!g && g.working === false && g.agents.length === 3;
  }, parentId));

// Cohérence pilule ↔ popover : 1 racine + 3 agents = 4 lignes. C'est l'écart
// mesuré contre l'avant-lot, où le registre en aurait annoncé 3.
const p1 = await pill();
check('1. la pilule est visible', p1.hidden === false);
check('1. elle annonce 4 agents (le parent compte pour une ligne), pas 3',
  p1.label === '4 agents');

await page.click('#agent-count');
await page.waitForTimeout(250);
const rows1 = await popoverRows();
check('1. le popover liste exactement 4 lignes — le compte de la pilule',
  rows1.length === 4);
check('1. la racine est au niveau 0, les trois agents indentés au niveau 1',
  rows1[0].depth === 0 && rows1.slice(1).every(r => r.depth === 1));
check('1. le parent inerte est libellé « en attente de ses agents », pas « génère »',
  rows1[0].meta.indexOf('en attente de ses agents') >= 0);
// Comparaison d'ENSEMBLE, jamais de tableaux triés : l'ordre de `.sort()` sur
// des libellés accentués dépend de la locale du runtime (« Rédiger » avant
// « Relever »), ce qui rendrait le contrôle rouge sans qu'aucun code n'ait
// bougé.
const expectedIntents = ['Compter les tours max', 'Rédiger la synthèse', 'Relever les limites de js__eval'];
const gotIntents = rows1.slice(1).map(r => r.label);
check('1. les agents portent leur agentIntent, jamais un placeholder de titre',
  gotIntents.length === expectedIntents.length &&
  expectedIntents.every(x => gotIntents.indexOf(x) >= 0));
check('1. et le libellé utilisateur du statut running (« au travail »)',
  rows1.slice(1).every(r => r.meta.indexOf('au travail') >= 0));
check('1. aucune annotation d\'Espace : tout est dans l\'Espace actif',
  rows1.every(r => r.meta.indexOf('Espace') < 0));
check('1. aria-expanded suit l\'ouverture', (await pill()).expanded === 'true');
await shot('01-popover-parent-inerte.png');

// ── Escape ferme le popover, gratuitement (closeTopDropdownViaEscape) ────────
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('1. Escape ferme le popover',
  await page.evaluate(() => !document.getElementById('agent-menu').classList.contains('show')));
check('1. et repose aria-expanded', (await pill()).expanded === 'false');

// ── La MÊME question dans la palette : mêmes lignes, même ordre ─────────────
await page.keyboard.press('Meta+k');
await page.waitForTimeout(200);
await page.keyboard.press('a');
await page.waitForTimeout(250);
const pal1 = await paletteRows();
check('1. palette : le sous-mode liste D\'EMBLÉE, query vide (inventaire, pas recherche)',
  pal1.length === 4);
check('1. palette et popover listent les mêmes libellés, dans le même ordre',
  pal1.map(r => r.label.replace(/^↳ /, '')).join('|') === rows1.map(r => r.label).join('|'));
check('1. palette : les agents portent le préfixe d\'indentation',
  pal1.slice(1).every(r => r.label.indexOf('↳ ') === 0) && pal1[0].label.indexOf('↳') < 0);
await shot('02-palette-inventaire.png');

// Filtrage : la query restreint une liste déjà présente.
await page.fill('#cmdk-input', 'synthèse');
await page.waitForTimeout(250);
const pal2 = await paletteRows();
check('1. palette : la query filtre l\'inventaire',
  pal2.length === 1 && pal2[0].label.indexOf('Rédiger la synthèse') >= 0);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 2 — cross-Space : une racine qui génère dans l'AUTRE Espace
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n— Scénario 2 : cross-Space et navigation');
await page.evaluate((id) => followSpace(id), fx.spB);
await page.waitForTimeout(200);
await newConv();
await gate('P:P2');
await send('MARK-P2 travail dans Beta.');
await waitSent('P:P2');
await page.waitForTimeout(400);
const betaId = await page.evaluate(() => currentConvId);

// On revient dans Alpha : la conversation Beta génère alors HORS écran.
await page.evaluate((id) => followSpace(id), fx.spA);
await page.waitForTimeout(250);

await page.click('#agent-count');
await page.waitForTimeout(250);
const rows2 = await popoverRows();
check('2. l\'inventaire agrège les DEUX Espaces (4 lignes d\'Alpha + 1 de Beta)',
  rows2.length === 5);
const betaRow = rows2.find(r => r.meta.indexOf('Espace Beta') >= 0);
check('2. la ligne hors-Espace-actif est annotée de son Espace', !!betaRow);
check('2. celles de l\'Espace actif ne le sont pas',
  rows2.filter(r => r.meta.indexOf('Espace Beta') >= 0).length === 1);
check('2. la pilule suit : 5 lignes annoncées', (await pill()).label === '5 agents');
await shot('03-popover-cross-space.png');

// Navigation : le clic suit le Space AVANT d'ouvrir (herméticité, piège 18).
const betaIdx = rows2.indexOf(betaRow);
await page.evaluate((i) => document.querySelectorAll('#agent-menu .agent-row')[i].click(), betaIdx);
await page.waitForTimeout(600);
check('2. le clic a suivi l\'Espace de la conversation',
  await page.evaluate((s) => getActiveSpaceId() === s, fx.spB));
check('2. et ouvert la conversation visée',
  await page.evaluate((id) => currentConvId === id, betaId));
check('2. le popover s\'est fermé au clic (décision Julien)',
  await page.evaluate(() => !document.getElementById('agent-menu').classList.contains('show')));
await shot('04-apres-navigation.png');

// ═════════════════════════════════════════════════════════════════════════════
// Scénario 3 — extinction : plus rien ne travaille, plus rien ne s'affiche
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n— Scénario 3 : extinction');
await release('P:P2');
await release('A:A1'); await release('A:A2'); await release('A:A3');
await page.waitForFunction(() => _activeGenerations.size === 0, null, { timeout: 20000 });
await page.waitForTimeout(600);

check('3. l\'inventaire est vide', await page.evaluate(() => liveAgentInventory().length === 0));
check('3. la pilule est masquée', (await pill()).hidden === true);
check('3. les agents TERMINÉS ne laissent aucune ligne (pas d\'état « non lu » côté agent)',
  await page.evaluate(() => agentInventoryRows(liveAgentInventory()).length === 0));

// La commande disparaît de la palette : `enabled()` la masque nativement.
await page.keyboard.press('Meta+k');
await page.waitForTimeout(250);
const labels = await page.evaluate(() => Array.from(
  document.querySelectorAll('#cmdk-list .cmdk-item-label')).map(e => e.textContent));
check('3. la commande « Agents » a disparu de la palette',
  labels.indexOf('Agents') < 0);
check('3. (contrôle) les autres commandes sont bien là — la palette n\'est pas vide',
  labels.length > 5);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ════════════════════════════════════════════════════════════════════════════
// Scénario 4 — UN SEUL agent : la pilule ne doit pas disparaître sur son fil
// ════════════════════════════════════════════════════════════════════════════
// Bug observé en usage réel le 2026-09-12 : avec un parent qui attend son
// UNIQUE agent, aller consulter le fil de l'agent faisait disparaître la
// pilule, qui revenait en retournant sur le parent.
//
// POURQUOI LES TROIS SCÉNARIOS CI-DESSUS NE POUVAIENT PAS L'ATTRAPER — c'est
// le point de ce scénario, pas seulement le fait qu'il soit rouge avant le
// correctif. La visibilité dérivait de `_activeGenerations.size`, et la garde
// de `resolveAgentCount` ne s'arme qu'à `total === 1 && screenOwned`. Le
// scénario 1 monte un parent à TROIS agents : le registre y vaut 3, la garde
// ne s'applique jamais, et aucune quantité d'assertions sur ce montage ne
// peut faire tomber le cas. La fenêtre du défaut est exactement « une seule
// génération au registre », ce qui la rend invisible à qui lance toujours
// plusieurs agents — raison pour laquelle l'utilisateur ne l'avait vu qu'en
// test à un agent. Un montage pluriel est ici un contrôle VIDE, pas un
// contrôle faible.
//
// L'écart de grandeur est aussi ce que le scénario mesure : UNE entrée au
// registre, DEUX lignes à l'inventaire (le parent qui attend + son agent).
console.log('\n— Scénario 4 : un seul agent, bascule parent ↔ agent');
await resetStub();
await newConv();

await page.evaluate(() => {
  window.__spawns['P:P4'] = { prompt: 'AGENT-A4 travail solitaire.', intent: 'Vérifier la pilule à un agent', tools: [] };
});
await gate('A:A4');
await send('MARK-P4 lance un seul agent.');
await waitSent('P:P4');
await release('P:P4');
await page.waitForTimeout(700);

const soloParent = await page.evaluate(() => currentConvId);
const soloAgents = await page.evaluate(
  (p) => agentChildrenOf(p, listAllConversations()).map(c => c.id), soloParent);
check('4. un unique agent, en vol',
  soloAgents.length === 1 && await page.evaluate((id) => isGenerating(id), soloAgents[0]));

// La fenêtre du défaut, mesurée : si l'une de ces deux assertions tombait, le
// reste du scénario ne prouverait plus rien de ce qu'il annonce.
check('4. le registre ne contient QU\'UNE génération (la fenêtre du bug)',
  await page.evaluate(() => _activeGenerations.size === 1));
check('4. le parent inerte n\'y est pas, mais l\'inventaire compte DEUX lignes',
  await page.evaluate((p) => !_activeGenerations.has(p) &&
    agentInventoryCount(liveAgentInventory()) === 2, soloParent));

// ── Depuis le parent : état de référence (déjà correct avant le correctif) ───
const pill4parent = await pill();
check('4. depuis le parent : pilule visible, 2 agents',
  pill4parent.hidden === false && pill4parent.label === '2 agents');

// ── Depuis le fil de l'agent : LE contrôle ─────────────────────────
// On ouvre par le chemin utilisateur réel (le popover), pas par un appel direct
// à selectConv : c'est la bascule d'écran qui arme `screenOwned`.
await page.click('#agent-count');
await page.waitForTimeout(250);
const rows4 = await popoverRows();
check('4. le popover liste le parent et son agent', rows4.length === 2);
await page.evaluate(() => document.querySelectorAll('#agent-menu .agent-row')[1].click());
await page.waitForTimeout(600);
check('4. on est bien sur le fil de l\'agent',
  await page.evaluate((id) => currentConvId === id, soloAgents[0]));
check('4. cet écran GÉNÈRE — sans quoi le contrôle suivant serait vide',
  await page.evaluate(() => isGenerating(currentConvId) === true));

const pill4agent = await pill();
check('4. la pilule reste VISIBLE sur le fil de l\'agent (bug du 2026-09-12)',
  pill4agent.hidden === false);
check('4. et annonce toujours 2 agents, le parent en attente compris',
  pill4agent.label === '2 agents');
await shot('05-pilule-sur-fil-agent.png');

// ── Retour au parent : la pilule ne doit pas « revenir », elle n'est pas partie
await page.evaluate((id) => selectConv(id), soloParent);
await page.waitForTimeout(500);
const pill4back = await pill();
check('4. retour au parent : toujours visible, même libellé (aucune bascule)',
  pill4back.hidden === false && pill4back.label === '2 agents');

// ── Non-régression de la règle que la garde protège ───────────────────
// L'agent termine : il ne reste que le parent, réveillé par la délivrance du
// résultat — UNE ligne, sous les yeux. C'est le cas pour lequel T-2bis a posé
// la garde : le composer en mode stop le dit déjà, la pilule se tait. Sans ce
// contrôle, « rendre la pilule plus visible » pourrait se faire en supprimant
// la garde, et ce verify resterait vert.
// Le tour de RÉVEIL du parent se re-taggue `P:P4` — le stub dérive le tag du
// dernier message user portant MARK-, et le réveil n'en crée pas de nouveau.
// Il faut donc REFERMER cette porte (relachée plus haut pour le tour de spawn)
// avant de libérer l'agent, sinon le parent traverse son réveil d'un trait et
// les assertions ci-dessous ne trouvent plus rien qui génère.
await page.evaluate(() => { window.__released['P:P4'] = false; window.__gates['P:P4'] = true; });
await release('A:A4');
await page.waitForFunction(() => liveAgentInventory().length === 1 &&
  agentInventoryCount(liveAgentInventory()) === 1, null, { timeout: 20000 });
check('4. l\'agent terminé ne laisse qu\'une ligne : le parent réveillé',
  await page.evaluate((p) => {
    const inv = liveAgentInventory();
    return inv.length === 1 && inv[0].conv.id === p && inv[0].agents.length === 0;
  }, soloParent));
check('4. ce parent réveillé est bien sous les yeux et génère',
  await page.evaluate((p) => currentConvId === p && isGenerating(p) === true, soloParent));
check('4. une ligne unique sous les yeux → pilule MUETTE (garde de T-2bis)',
  (await pill()).hidden === true);

await release('P:P4');
await page.waitForFunction(() => _activeGenerations.size === 0, null, { timeout: 20000 });
await page.waitForTimeout(400);

// ── Bilan ───────────────────────────────────────────────────────────────────
check('aucune erreur console sur tout le parcours',
  errors.filter(e => e.indexOf('favicon') < 0).length === 0);
if (errors.length) console.log('  errors: ' + errors.join(' | '));

console.log('\n' + (failures.length ? 'ÉCHEC — ' + failures.length + ' contrôle(s)' : 'OK — tous les contrôles passent'));
await browser.close();
process.exit(failures.length ? 1 : 0);
