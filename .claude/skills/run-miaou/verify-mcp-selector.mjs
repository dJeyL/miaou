#!/usr/bin/env node
// Sélecteur de serveurs MCP du composer (cf. docs/mcp.md, point 25).
// Vérifie ce que les tests QuickJS n'atteignent pas : la pilule et son menu
// réellement cliqués, l'enregistrement vierge / non vierge, et le corps
// réellement envoyé au modèle (outils, consignes, refus d'un appel coupé).
//
// Montage : aucun serveur MCP réel. Après le démarrage, `connectMcpServer` est
// neutralisé (un retour de focus ne doit pas tenter le réseau), puis trois
// cartes sont posées à la main dans `_remoteTools` / `_remoteStatus` :
//   proxy — agrégateur : outils `proxy__bench__echo`, `proxy__web__search`,
//           upstream `jira` à autoriser (aucun outil), consignes en sections
//           `## bench` / `## web` ;
//   solo  — serveur unitaire, outil `solo__x`, consigne entière ;
//   down  — carte activée mais en erreur, sans outil.
// `mcpRpc` est remplacé pour `tools/call` seulement : il compte les appels qui
// atteignent le réseau (témoin : l'appel autorisé y arrive, l'appel coupé non).
//
// Checklist :
//   1. prémisse : pilule visible, « 6 MCP » (proxy + 3 enfants + solo + down)
//   2. menu : ordre, retrait des enfants, « à autoriser », « hors ligne »
//   3. vierge : décocher proxy → « 2 MCP », défauts globaux ["proxy"], menu ouvert
//   4. enfants figés : grisés (opacité, curseur), toujours cochés, clic sans effet
//   5. « 0 MCP » : même fond que le raisonnement sur « défaut »
//   6. recocher proxy : enfants rendus avec leur état ; défauts ["proxy__bench"]
//   7. envoi depuis une conversation vierge : outils et consignes de bench absents,
//      web et solo présents ; la sélection est copiée sur la conversation
//   8. non vierge : décocher solo → conversation ["proxy__bench","solo"],
//      défauts inchangés ; envoi suivant sans solo__x ; inspecteur plus léger
//   9. nouvelle conversation : suit les défauts (« 5 MCP ») ; rouvrir l'ancienne
//      rend la sienne (« 4 MCP »)
//  10. appel du modèle à un outil coupé : refusé, rien ne part au réseau ;
//      témoin : un outil autorisé, lui, part
//  11. sélecteur masqué par le formulaire des réglages : pilule absente,
//      manifeste du dernier envoi invalidé (l'inspecteur regagne solo et bench),
//      la conversation qui les coupe les envoie, sa sélection et les défauts
//      sont intacts, un appel à bench part au réseau ; réaffiché, la
//      conversation retrouve « 4 MCP » et recoupe solo__x
//  12. aucune erreur console
//
// VERIFY_DIST=<chemin> rejoue sur un autre build (rouge attendu sur le code
// d'avant : la pilule n'existe pas).
import { launchIsolated } from './stub-backend.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = process.env.VERIFY_DIST || path.join(repoRoot, 'dist/miaou.html');
const headed = process.argv.includes('--headed');

const browser = await launchIsolated({ headless: !headed }, { serve: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const realErrors = () => consoleErrors.filter(e => !/Failed to load resource.*404/.test(e));

await page.route('**/models', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'stub-model' }] }),
}));

// Corps STREAMÉS (chat). Le tour d'appel d'outil est décidé par le CONTENU :
// dernier message utilisateur qui commence par « APPEL <outil> » et aucun
// résultat d'outil encore dans le corps.
const streamed = [];
await page.route('**/chat/completions', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  if (!body.stream) {
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' }, finish_reason: 'stop' }] }) });
    return;
  }
  streamed.push(body);
  const msgs = body.messages || [];
  const lastUser = [...msgs].reverse().find(m => m.role === 'user');
  const text = lastUser && typeof lastUser.content === 'string' ? lastUser.content : '';
  const m = /APPEL (\S+)/.exec(text);
  const chunks = (m && !msgs.some(x => x.role === 'tool'))
    ? [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function',
        function: { name: m[1], arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]
    : [
      { choices: [{ delta: { content: 'Réponse de test suffisamment longue.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ];
  await route.fulfill({ status: 200, contentType: 'text/event-stream',
    body: chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n' });
});

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null, null, { timeout: 15000 });
// `.boot-done` est posé AU DÉBUT du fondu : l'overlay reste au-dessus de tout
// (et capte les clics réels) jusqu'à la fin de sa transition d'opacité.
await page.waitForFunction(() => {
  const o = document.getElementById('boot-overlay');
  return !o || getComputedStyle(o).opacity === '0' || getComputedStyle(o).visibility === 'hidden';
}, null, { timeout: 10000 });
await page.evaluate(() => saveSettings({ earlyTitle: false }));

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); };

// Cartes posées à la main (cf. en-tête), puis rendu de la pilule.
await page.evaluate(() => {
  connectMcpServer = async () => true;
  window.__remoteCalls = [];
  mcpRpc = async (server, method, params) => {
    if (method === 'tools/call') {
      window.__remoteCalls.push(server.name + '__' + params.name);
      return { content: [{ type: 'text', text: 'résultat distant' }] };
    }
    return {};
  };
  saveMcpServers([
    { id: 'm1', name: 'proxy', url: 'http://stub.local/mcp-proxy', enabled: true },
    { id: 'm2', name: 'solo', url: 'http://stub.local/mcp-solo', enabled: true },
    { id: 'm3', name: 'down', url: 'http://stub.local/mcp-down', enabled: true },
  ]);
  const schema = { type: 'object', properties: {} };
  _remoteTools.proxy = [
    { name: 'proxy__bench__echo', description: 'Écho.', inputSchema: schema },
    { name: 'proxy__web__search', description: 'Recherche.', inputSchema: schema },
  ];
  _remoteTools.solo = [{ name: 'solo__x', description: 'Outil solo.', inputSchema: schema }];
  _remoteStatus.proxy = { state: 'ok', count: 2, sessionId: null,
    instructions: '## bench\n\nConsigne BENCHX.\n\n## web\n\nConsigne WEBX.',
    unauthorizedUpstreams: [{ name: 'jira', authorizePath: '/authorize/jira' }] };
  _remoteStatus.solo = { state: 'ok', count: 1, sessionId: null, instructions: 'Consigne SOLOX.' };
  _remoteStatus.down = { state: 'error', count: 0, error: 'injoignable', sessionId: null };
  syncMcpSelectorUI();
});

const pill = () => page.evaluate(() => $('composer-mcp-label').textContent);
// Le menu transitionne `visibility` et `transform` à l'ouverture (drawers.css) :
// un clic parti avant traverse le menu encore masqué, tombe dessous, et le
// clic extérieur le referme. Attendre l'état terminal, jamais un délai.
const openMenu = async () => {
  await page.evaluate(() => {
    const menu = $('composer-mcp-menu');
    if (!menu.classList.contains('show')) toggleComposerMcpMenu();
  });
  await page.waitForFunction(() => {
    const cs = getComputedStyle($('composer-mcp-menu'));
    return cs.visibility === 'visible' && cs.opacity === '1' && cs.transform === 'none';
  }, null, { timeout: 3000 });
};
const closeMenu = () => page.evaluate(() => $('composer-mcp-menu').classList.remove('show'));
// Lignes telles que rendues : nom (premier nœud texte), état visible.
const rows = () => page.evaluate(() => [...document.querySelectorAll('#composer-mcp-menu .model-opt')].map((el) => {
  const cs = getComputedStyle(el);
  const status = el.querySelector('.mcp-node-status');
  return {
    name: el.firstElementChild.firstChild.textContent.trim(),
    child: el.classList.contains('mcp-child'),
    checked: getComputedStyle(el.querySelector('.check')).opacity !== '0' && el.classList.contains('selected'),
    opacity: parseFloat(cs.opacity),
    cursor: cs.cursor,
    padLeft: parseFloat(cs.paddingLeft),
    status: status ? status.textContent : '',
  };
}));
// Clic RÉEL au centre de la ligne : c'est le handler de la ligne qu'on teste.
const clickRow = async (name) => {
  const box = await page.evaluate((n) => {
    const el = [...document.querySelectorAll('#composer-mcp-menu .model-opt')]
      .find(r => r.firstElementChild.firstChild.textContent.trim() === n);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, name);
  if (!box) throw new Error('ligne introuvable : ' + name);
  await page.mouse.click(box.x, box.y);
};
const defaults = () => page.evaluate(() => localStorage.getItem('miaou-mcp-disabled'));
const convSel = () => page.evaluate(() => {
  const c = currentConvId ? loadConversation(currentConvId) : null;
  return c ? JSON.stringify(c.mcpDisabled === undefined ? '(absent)' : c.mcpDisabled) : '(pas de record)';
});
const send = async (text) => {
  const n = streamed.length;
  await page.evaluate((t) => sendUserText(t), text);
  for (let i = 0; i < 200 && streamed.length <= n; i++) await page.waitForTimeout(50);
  await page.waitForFunction(() => !sending, null, { timeout: 10000 });
};
const toolNames = (body) => (body.tools || []).map(t => t.function.name);
const systemOf = (body) => ((body.messages || []).find(m => m.role === 'system') || {}).content || '';

// ── 1 ────────────────────────────────────────────────────────────────────────
const shown1 = await page.evaluate(() => {
  const el = $('composer-mcp');
  return !!el && !el.hidden && el.getClientRects().length > 0;
});
const order1 = await page.evaluate(() => {
  const a = $('composer-mcp'), b = $('composer-reasoning');
  return !!(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
});
check('1. prémisse : pilule visible avant le raisonnement, « 6 MCP »',
  shown1 && order1 && (await pill()) === '6 MCP', JSON.stringify({ shown1, order1, pill: await pill() }));

// ── 2 ────────────────────────────────────────────────────────────────────────
await openMenu();
const r2 = await rows();
const names2 = r2.map(r => (r.child ? '  ' : '') + r.name);
const parentPad = r2.find(r => r.name === 'proxy');
const childPad = r2.find(r => r.name === 'bench');
check('2. menu : ordre, retrait des enfants, mentions',
  JSON.stringify(names2) === JSON.stringify(['proxy', '  bench', '  jira', '  web', 'solo', 'down'])
    && childPad && parentPad && childPad.padLeft > parentPad.padLeft
    && r2.find(r => r.name === 'jira').status === 'à autoriser'
    && r2.find(r => r.name === 'down').status === 'hors ligne'
    && r2.every(r => r.checked),
  JSON.stringify(r2));

// ── 3 ────────────────────────────────────────────────────────────────────────
await clickRow('proxy');
const open3 = await page.evaluate(() => $('composer-mcp-menu').classList.contains('show'));
check('3. vierge : décocher proxy → « 2 MCP », défauts ["proxy"], menu resté ouvert',
  (await pill()) === '2 MCP' && (await defaults()) === '["proxy"]' && open3,
  JSON.stringify({ pill: await pill(), defaults: await defaults(), open3 }));

// ── 4 ────────────────────────────────────────────────────────────────────────
const r4 = await rows();
const kids4 = r4.filter(r => r.child);
await clickRow('bench');
check('4. enfants figés : grisés, toujours cochés, clic sans effet',
  kids4.length === 3 && kids4.every(k => k.opacity < 1 && k.cursor === 'default' && k.checked)
    && r4.find(r => r.name === 'proxy').opacity === 1
    && (await defaults()) === '["proxy"]' && (await pill()) === '2 MCP',
  JSON.stringify({ kids4, defaults: await defaults() }));

// ── 5 ────────────────────────────────────────────────────────────────────────
await clickRow('solo');
await clickRow('down');
// `background` transitionne (140 ms) : lu juste après une bascule de classe, il
// rend la valeur de DÉPART. Transition coupée le temps des deux mesures.
await page.evaluate(() => { $('composer-mcp-btn').style.transition = 'none'; $('composer-reasoning-btn').style.transition = 'none'; });
const bg5 = await page.evaluate(() => {
  const btn = $('composer-mcp-btn');
  const ref = $('composer-reasoning-btn');
  const wasDefault = ref.classList.contains('is-default');
  ref.classList.add('is-default');
  const out = { mcp: getComputedStyle(btn).backgroundColor, ref: getComputedStyle(ref).backgroundColor,
    cls: btn.classList.contains('is-default') };
  if (!wasDefault) ref.classList.remove('is-default');
  return out;
});
const bgActive = await page.evaluate(() => {
  const btn = $('composer-mcp-btn');
  btn.classList.remove('is-default');
  const c = getComputedStyle(btn).backgroundColor;
  btn.classList.add('is-default');
  return c;
});
await page.evaluate(() => { $('composer-mcp-btn').style.transition = ''; $('composer-reasoning-btn').style.transition = ''; });
check('5. « 0 MCP » : même fond que le raisonnement sur « défaut », distinct de l\'actif',
  (await pill()) === '0 MCP' && bg5.cls && bg5.mcp === bg5.ref && bg5.mcp !== bgActive,
  JSON.stringify({ pill: await pill(), bg5, bgActive }));

// ── 6 ────────────────────────────────────────────────────────────────────────
await clickRow('solo');
await clickRow('down');
await clickRow('proxy');
await clickRow('bench');
const r6 = await rows();
check('6. recocher proxy : enfants modifiables, bench décochable ; défauts ["proxy__bench"]',
  (await defaults()) === '["proxy__bench"]' && (await pill()) === '5 MCP'
    && r6.filter(r => r.child).every(k => k.opacity === 1)
    && !r6.find(r => r.name === 'bench').checked && r6.find(r => r.name === 'web').checked,
  JSON.stringify({ defaults: await defaults(), pill: await pill(), r6 }));
await closeMenu();

// ── 7 ────────────────────────────────────────────────────────────────────────
await send('Bonjour, premier message');
const b7 = streamed[streamed.length - 1];
const t7 = toolNames(b7);
const s7 = systemOf(b7);
const conv7 = await convSel();
check('7. envoi vierge : bench absent (outil et consigne), web et solo présents ; sélection copiée',
  !t7.includes('proxy__bench__echo') && t7.includes('proxy__web__search') && t7.includes('solo__x')
    && !s7.includes('BENCHX') && s7.includes('WEBX') && s7.includes('SOLOX')
    && conv7 === '["proxy__bench"]',
  JSON.stringify({ tools: t7.filter(n => !n.startsWith('miaou__')), bench: s7.includes('BENCHX'),
    web: s7.includes('WEBX'), solo: s7.includes('SOLOX'), conv7 }));

// ── 8 ────────────────────────────────────────────────────────────────────────
const conv8Id = await page.evaluate(() => currentConvId);
const toolsChars = () => page.evaluate(() => {
  _lastContextManifest = null;
  const m = computeContextManifestNow();
  const e = (m.entries || []).find(x => x.source === 'tool_definitions');
  return e ? e.chars : -1;
});
const chars8a = await toolsChars();
await openMenu();
await clickRow('solo');
await closeMenu();
const chars8b = await toolsChars();
await send('Deuxième message');
const t8 = toolNames(streamed[streamed.length - 1]);
check('8. non vierge : conversation ["proxy__bench","solo"], défauts inchangés, solo__x absent, inspecteur plus léger',
  (await convSel()) === '["proxy__bench","solo"]' && (await defaults()) === '["proxy__bench"]'
    && !t8.includes('solo__x') && t8.includes('proxy__web__search')
    && chars8a > 0 && chars8b > 0 && chars8b < chars8a && (await pill()) === '4 MCP',
  JSON.stringify({ conv: await convSel(), defaults: await defaults(), chars8a, chars8b, pill: await pill() }));

// ── 9 ────────────────────────────────────────────────────────────────────────
await page.evaluate(() => resetToEmpty());
const pill9a = await pill();
await page.evaluate((id) => openConversation(id, true), conv8Id);
await page.waitForFunction((id) => currentConvId === id, conv8Id);
const pill9b = await pill();
check('9. nouvelle conversation : « 5 MCP » (défauts) ; l\'ancienne rouverte : « 4 MCP »',
  pill9a === '5 MCP' && pill9b === '4 MCP', JSON.stringify({ pill9a, pill9b }));

// ── 10 ───────────────────────────────────────────────────────────────────────
// Conversation fraîche par scénario d'appel (le stub n'émet pas de second appel
// quand un résultat d'outil est déjà dans le corps). solo est décoché dans
// celle-ci par le geste, bench l'est par les défauts.
const lastToolText = (body) => {
  const t = [...(body.messages || [])].reverse().find(m => m.role === 'tool');
  return t ? String(t.content) : '';
};
await page.evaluate(() => resetToEmpty());
await send('APPEL proxy__bench__echo');
const b10 = streamed[streamed.length - 1];
const calls10 = await page.evaluate(() => window.__remoteCalls.slice());
await page.evaluate(() => resetToEmpty());
await send('APPEL proxy__web__search');
const b10w = streamed[streamed.length - 1];
const calls10w = await page.evaluate(() => window.__remoteCalls.slice());
check('10. appel à un outil coupé refusé sans réseau ; témoin : l\'outil autorisé part',
  lastToolText(b10).includes('Serveur MCP inconnu ou désactivé') && calls10.length === 0
    && lastToolText(b10w).includes('résultat distant') && JSON.stringify(calls10w) === '["proxy__web__search"]',
  JSON.stringify({ refus: lastToolText(b10).slice(0, 80), calls10, temoin: lastToolText(b10w).slice(0, 80), calls10w }));

// ── 11 ───────────────────────────────────────────────────────────────────────
// Sélection en sommeil quand le sélecteur est masqué. Prémisse : conv8 coupe
// bench ET solo, les défauts coupent bench — sinon « tout est envoyé » ne
// prouverait rien. Bascule par le VRAI formulaire (`onSaveSettings`, drawer
// ouvert pour qu'il soit peuplé) : c'est lui qui doit invalider le manifeste.
const setSelector = async (on) => {
  await page.evaluate((v) => { openSettings(); $('set-mcpselector').checked = v; onSaveSettings(); }, on);
};
const toolDefChars = () => page.evaluate(() => {
  const e = (effectiveContextManifest().entries || []).find(x => x.source === 'tool_definitions');
  return e ? e.chars : -1;
});
await page.evaluate((id) => openConversation(id, true), conv8Id);
await page.waitForFunction((id) => currentConvId === id, conv8Id);
await send('Troisième message');
const t11pre = toolNames(streamed[streamed.length - 1]);
const chars11a = await toolDefChars();
await setSelector(false);
const chars11b = await toolDefChars();
const hidden11 = await page.evaluate(() => {
  const el = $('composer-mcp');
  return !el || el.hidden || el.getClientRects().length === 0;
});
await send('Quatrième message');
const b11 = streamed[streamed.length - 1];
const t11 = toolNames(b11);
const s11 = systemOf(b11);
const conv11 = await convSel();
const def11 = await defaults();
await page.evaluate(() => resetToEmpty());
const callsBefore11 = await page.evaluate(() => window.__remoteCalls.length);
await send('APPEL proxy__bench__echo');
const calls11 = await page.evaluate((n) => window.__remoteCalls.slice(n), callsBefore11);
const fresh11 = await convSel();
check('11a. prémisse : conv8 coupe bench et solo avant masquage',
  !t11pre.includes('solo__x') && !t11pre.includes('proxy__bench__echo') && t11pre.includes('proxy__web__search'),
  JSON.stringify(t11pre.filter(n => !n.startsWith('miaou__'))));
check('11b. masqué : pilule absente, inspecteur recalculé (plus lourd)',
  hidden11 && chars11a > 0 && chars11b > chars11a, JSON.stringify({ hidden11, chars11a, chars11b }));
check('11c. masqué : bench et solo envoyés (outils et consignes), sélection et défauts intacts',
  t11.includes('solo__x') && t11.includes('proxy__bench__echo') && t11.includes('proxy__web__search')
    && s11.includes('BENCHX') && s11.includes('SOLOX')
    && conv11 === '["proxy__bench","solo"]' && def11 === '["proxy__bench"]',
  JSON.stringify({ tools: t11.filter(n => !n.startsWith('miaou__')), bench: s11.includes('BENCHX'),
    solo: s11.includes('SOLOX'), conv11, def11 }));
check('11d. masqué : un appel à bench (coupé par les défauts) part au réseau ; la conversation fige []',
  JSON.stringify(calls11) === '["proxy__bench__echo"]' && fresh11 === '[]',
  JSON.stringify({ calls11, fresh11 }));
await setSelector(true);
await page.evaluate((id) => openConversation(id, true), conv8Id);
await page.waitForFunction((id) => currentConvId === id, conv8Id);
const pill11 = await pill();
await send('Cinquième message');
const t11e = toolNames(streamed[streamed.length - 1]);
check('11e. réaffiché : conv8 retrouve « 4 MCP » et recoupe solo__x',
  pill11 === '4 MCP' && !t11e.includes('solo__x') && !t11e.includes('proxy__bench__echo'),
  JSON.stringify({ pill11, tools: t11e.filter(n => !n.startsWith('miaou__')) }));

// ── 12 ───────────────────────────────────────────────────────────────────────
check('12. aucune erreur console', realErrors().length === 0, realErrors().join(' | '));

await browser.close();
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '\n     ' + r.detail));
}
console.log(failed ? `\n${failed} échec(s)` : '\nTout est vert.');
process.exit(failed ? 1 : 0);
