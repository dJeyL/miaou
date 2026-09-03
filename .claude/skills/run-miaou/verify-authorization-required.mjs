#!/usr/bin/env node
// Campagne AB-3 — refus « autorisation requise » d'un serveur MCP, de bout en
// bout côté MIAOU.
//
// Ce que QuickJS couvre déjà (et que ce script ne refait donc pas) : les
// prédicats purs `authorizationUrlOrigin` / `ackAuthorizationTarget`, testés par
// mutation dans les deux sens. Ce qu'il ne peut PAS couvrir, et qui est l'objet
// d'ici : le round-trip réel jusqu'à `err.data`, le lien effectivement rendu, sa
// survie au rechargement, son absence des exports, et le nettoyage au rejeu.
//
// MONTAGE : entièrement stubé, aucun proxy lancé, aucun port ouvert.
// `mcpRpcAttempt` traduit `msg.error.data` en `err.data` AVANT que le moindre
// code AB-3 n'intervienne (tools.js) : tout ce que les vrais proxys ajouteraient
// au-dessus de ce point relève d'AB-1/AB-2, clos et couverts dans leur dépôt.
// Sur les deux cas qui comptent (URL irrecevable, URL absente), le stub fait
// même mieux qu'une config tordue : il pose l'`authorization_url` voulue en une
// ligne, donc la matrice complète de la garde est jouable en réel.
//
// Le stub sert le handshake (`initialize` / `tools/list`) et ne gate QUE
// `tools/call` : le remplacer en bloc suspendrait la connexion elle-même,
// l'outil ne serait jamais enregistré, et rien de ce qu'on mesure ne pourrait
// se produire (piège documenté dans SKILL.md).
//
// Usage : node verify-authorization-required.mjs [dossier-captures] [--headed]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const distPath = path.join(repoRoot, 'dist/miaou.html');
const outDir = process.argv[2] || path.join(__dirname, 'shots-authorization-required');
const headed = process.argv.includes('--headed');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (label, cond) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + label);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const failedRequests = [];
page.on('requestfailed', (r) => {
  failedRequests.push(r.url() + ' | ' + (r.failure() ? r.failure().errorText : '?'));
});

// ── Backend modèle ──────────────────────────────────────────────────────────
// Le premier tour d'une conversation émet le tool_call, le second conclut.
// Le compteur est PAR CONVERSATION : une conversation portant déjà un
// `role:'tool'` ne redéclenche pas d'appel (limite du montage, pas de l'appli —
// MIAOU enchaîne très bien les appels d'outils). D'où une conversation neuve
// par scénario, et le tour déduit du corps reçu plutôt que d'un compteur global.
let chatCalls = 0;
await page.route('**/chat/completions', async (route) => {
  chatCalls++;
  const req = route.request();
  let body = {};
  try { body = JSON.parse(req.postData() || '{}'); } catch { /* corps illisible */ }
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const hasToolResult = msgs.some((m) => m && m.role === 'tool');
  const sse = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';

  // Titrage / résumé passent par silentCompletion : pas de `stream`, et ils
  // attendent du JSON, pas du SSE. Servir du SSE ici viderait le `content` de
  // l'assistant et ferait abstenir tout ce qui le lit ensuite (piège SKILL.md).
  if (!body.stream) {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'Titre' } }] }),
    });
    return;
  }

  let out;
  if (!hasToolResult) {
    out = sse({ choices: [{ delta: { role: 'assistant', content: 'Je regarde.' } }] })
      + sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function',
          function: { name: 'proxy__bench_ping', arguments: '' } }] } }] })
      + sse({ choices: [{ delta: { tool_calls: [{ index: 0,
          function: { arguments: '{"payload":"ping"}' } }] } }] })
      + sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      + 'data: [DONE]\n\n';
  } else {
    out = sse({ choices: [{ delta: { role: 'assistant',
        content: 'Cette action attend ton autorisation ; je ne peux pas l\'accorder moi-meme.' } }] })
      + sse({ choices: [{ delta: {}, finish_reason: 'stop' }] })
      + 'data: [DONE]\n\n';
  }
  await route.fulfill({ status: 200, contentType: 'text/event-stream', body: out });
});
await page.route('**/models', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: [{ id: 'stub-model' }] }),
}));

await page.goto('file://' + distPath);
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null,
  { timeout: 15000 });

// ── Stub MCP ────────────────────────────────────────────────────────────────
// `__authFailure` décrit ce que `tools/call` doit renvoyer. `null` = succès,
// ce qui sert au rejeu du cas 3. Le compteur `__mcpCalls` fait PROUVER au stub
// qu'il a été sollicité : un stub froid rend toute la checklist creuse.
await page.evaluate(() => {
  window.__authFailure = null;
  window.__mcpCalls = 0;
  // Thème sombre EXPLICITE, pas « system » : le défaut suit la préférence de
  // l'OS, donc les captures varieraient d'une machine à l'autre. Elles servent
  // aussi d'illustration, ce qui exige qu'elles soient reproductibles.
  selectTheme('dark');
  // Un serveur d'API enregistré l'emporte sur miaou-settings : le laisser
  // ferait appeler le vrai backend et le stub resterait froid.
  localStorage.removeItem('miaou-api-servers');
  localStorage.removeItem('miaou-active-api-server');
  mcpRpc = async function (server, method) {
    if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: {} };
    if (method === 'notifications/initialized') return {};
    if (method === 'tools/list') {
      return { tools: [{ name: 'bench_ping', description: 'Renvoie sa charge utile',
        inputSchema: { type: 'object', properties: { payload: { type: 'string' } } } }] };
    }
    if (method !== 'tools/call') return {};
    window.__mcpCalls++;
    const f = window.__authFailure;
    if (!f) return { content: [{ type: 'text', text: '{"pong":true}' }] };
    // Forme EXACTE d'une erreur JSON-RPC telle que mcpRpcAttempt la construit :
    // une Error dont le message est la prose serveur, et dont `.data` porte
    // l'objet applicatif complet. C'est le seul point de contact entre le proxy
    // et AB-3 — le reproduire ici, c'est reproduire le contrat.
    const err = new Error(f.message);
    err.data = f.data;
    throw err;
  };
  saveMcpServers([{ name: 'proxy', url: 'http://stub.local/mcp', enabled: true }]);
});

const connected = await page.evaluate(async () => {
  await connectMcpServer(loadMcpServers()[0]);
  return remoteToolDefs().map((t) => t.name);
});
// Prémisse : sans l'outil au registre, le tool_call du modèle n'a pas de cible
// et tout ce qui suit passerait en ne mesurant rien.
check('prémisse : l\'outil MCP est enregistré au registre',
  connected.indexOf('proxy__bench_ping') >= 0);

// Prose serveur réelle d'AB-2 (mcp_proxy.py) : impérative et sans destinataire,
// ce qui est précisément la raison d'être du texte modèle complémentaire.
const SERVER_MSG = "[MIAOU_AUTH] Le serveur 'bench' exige une autorisation OAuth "
  + 'qui n\'a pas encore été accordée. Ouvrir ce lien pour l\'accorder : ';

// Arme le stub PUIS envoie : il lit son état à l'entrée de la requête, donc
// armer après `send()` serait trop tard.
async function runScenario(prompt, failure) {
  await page.evaluate((f) => {
    window.__authFailure = f;
    // Conversation neuve : une conversation portant déjà un role:'tool'
    // ne redéclenche pas d'appel (garde du stub modèle ci-dessus).
    newConversation();
  }, failure);
  await page.waitForTimeout(300);
  await page.fill('#composer-text', prompt);
  await page.click('#send-btn');
  await page.waitForFunction(() => document.querySelector('#thread .tool-ack') !== null,
    { timeout: 10000 });
  await page.waitForFunction(() => typeof sending !== 'undefined' && sending === false,
    { timeout: 15000 });
  await page.waitForTimeout(400);
}

const readAck = () => page.evaluate(() => {
  const acks = Array.from(document.querySelectorAll('#thread .tool-ack'));
  const node = acks.find((a) => a.className.includes('ack-mcp_call')) || acks[0];
  if (!node) return null;
  const link = node.querySelector('.ack-authorize-link');
  const origin = node.querySelector('.ack-authorize-origin');
  return {
    isError: node.classList.contains('ack-error'),
    text: node.textContent || '',
    hasLink: !!link,
    linkCount: node.querySelectorAll('.ack-authorize').length,
    // getAttribute et non `.href` : celui-ci résout en absolu contre file://,
    // ce qui masquerait une URL relative acceptée à tort.
    href: link ? link.getAttribute('href') : null,
    target: link ? link.getAttribute('target') : null,
    rel: link ? link.getAttribute('rel') : null,
    label: link ? link.textContent : null,
    origin: origin ? origin.textContent : null,
  };
});

// L'entrée persistée, lue depuis le thread : c'est elle que les exports et le
// rechargement relisent, et elle seule prouve que les champs ont traversé
// ACK_COPY_FIELDS plutôt que d'être restés sur un objet volatile.
//
// Un ack est une ENTRÉE DU THREAD à part entière (`isAckRole(m.role)`), pas un
// champ niché sous un message. Une première version cherchait `m.toolAcks` :
// elle renvoyait toujours null, donc les assertions de persistance passaient
// pour vertes ou rouges sans rien mesurer.
const readAckEntry = () => page.evaluate(() => {
  for (let i = currentThread.length - 1; i >= 0; i--) {
    const m = currentThread[i];
    if (m && isAckRole(m.role) && m.kind === 'mcp_call') return m;
  }
  return null;
});

// ── Cas 1 — refus nominal ───────────────────────────────────────────────────
console.log('\n── Cas 1 : refus nominal ──');
await runScenario('Appelle bench_ping', {
  message: SERVER_MSG + 'https://auth.example.org/oauth/authorize?client_id=miaou',
  data: { code: 'AUTHORIZATION_REQUIRED', upstream: 'bench',
    authorization_url: 'https://auth.example.org/oauth/authorize?client_id=miaou' },
});
check('le stub MCP a bien été sollicité',
  (await page.evaluate(() => window.__mcpCalls)) === 1);
const c1 = await readAck();
check('cas 1 : la ligne d\'appel est en erreur', c1.isError === true);
check('cas 1 : un lien d\'autorisation est présent', c1.hasLink === true);
check('cas 1 : un seul lien (pas de doublon)', c1.linkCount === 1);
check('cas 1 : le lien porte le libellé Autoriser', (c1.label || '').includes('Autoriser'));
check('cas 1 : href exactement l\'URL du serveur',
  c1.href === 'https://auth.example.org/oauth/authorize?client_id=miaou');
check('cas 1 : ouverture dans un nouvel onglet', c1.target === '_blank');
check('cas 1 : rel="noopener noreferrer"', c1.rel === 'noopener noreferrer');
check('cas 1 : l\'origine est affichée en clair', c1.origin === 'auth.example.org');

const entry1 = await readAckEntry();
check('cas 1 : errorCode a traversé ACK_COPY_FIELDS',
  entry1 && entry1.errorCode === 'AUTHORIZATION_REQUIRED');
check('cas 1 : authorizationUrl a traversé ACK_COPY_FIELDS',
  entry1 && entry1.authorizationUrl === 'https://auth.example.org/oauth/authorize?client_id=miaou');
check('cas 1 : upstream a traversé ACK_COPY_FIELDS', entry1 && entry1.upstream === 'bench');

// Le texte servi au MODÈLE, tel que le tour suivant l'a reçu — pas ce que
// l'écran montre. C'est là que se joue « qui peut autoriser ».
const toolText = await page.evaluate(() => {
  const msgs = projectThreadToMessages(expandThread(currentThread));
  const t = msgs.filter((m) => m && m.role === 'tool').pop();
  return t ? String(t.content || '') : '';
});
check('cas 1 : le texte modèle dit que seul l\'utilisateur peut accorder',
  toolText.includes('seul l\'utilisateur peut'));
check('cas 1 : il dit que le modèle n\'a pas d\'outil pour le faire',
  toolText.includes('tu n\'as pas d\'outil'));
check('cas 1 : il dit que le lien est déjà affiché',
  toolText.includes('déjà affiché'));
check('cas 1 : il dit que l\'échec est temporaire',
  toolText.includes('le même appel fonctionnera'));
// L'URL ne doit PAS être répétée par le complément : elle serait deux fois dans
// le contexte, dont une dans une phrase recopiable en réponse — donc sur un
// chemin de rendu sans la garde. Elle n'est présente qu'une fois, via la prose
// serveur qui précède.
const urlOccurrences = toolText.split('https://auth.example.org').length - 1;
check('cas 1 : l\'URL n\'apparaît qu\'une fois (prose serveur), pas répétée',
  urlOccurrences === 1);
check('cas 1 : le modèle a conclu sans réessayer (un seul appel outil)',
  (await page.evaluate(() => window.__mcpCalls)) === 1);
await page.screenshot({ path: path.join(outDir, '01-refus-nominal.png') });

// ── Cas 4 — absence des deux exports ────────────────────────────────────────
// Placé ici : il consomme la conversation du cas 1, encore à l'écran.
console.log('\n── Cas 4 : absence des exports ──');
// Même collecte que le vrai export (main.js) : les acks sont des entrées du
// thread, et celles sans `args` en sont exclues — le témoin ci-dessous porte
// donc sur un ack qui en porte, sinon il mesurerait une absence attendue.
const exports = await page.evaluate(() => {
  const acks = currentThread.filter((m) => isAckRole(m.role) && m.args != null);
  return {
    count: acks.length,
    md: formatToolAcksMd(acks),
    html: formatToolAcksHtml(acks),
  };
});
check('cas 4 : prémisse — au moins un ack exportable a été collecté',
  exports.count > 0);
// Témoin : sans lui, les trois absences ci-dessous passeraient sur un export
// vide — le cas d'école du « vert qui ne prouve rien ».
check('cas 4 : témoin — l\'appel échoué EST présent dans l\'export Markdown',
  exports.md.includes('bench_ping'));
check('cas 4 : témoin — il EST présent dans l\'export HTML',
  exports.html.includes('bench_ping'));
// Ce qui doit être absent est l'AFFORDANCE, pas l'URL en tant que chaîne.
// L'export recopie `m.result`, c'est-à-dire le texte d'erreur de l'outil, et
// la prose du serveur cite l'URL : l'y trouver est normal — c'est l'erreur
// telle qu'elle s'est produite, et le cas 4 demande justement que l'appel
// échoué figure dans l'export. Une première version assertait l'absence de la
// chaîne et échouait donc sur une prémisse fausse.
check('cas 4 : Markdown — pas du mot Autoriser',
  exports.md.includes('Autoriser') === false);
check('cas 4 : HTML — pas du mot Autoriser',
  exports.html.includes('Autoriser') === false);
check('cas 4 : HTML — aucune classe issue de l\'affordance',
  exports.html.includes('ack-authorize') === false);
// Le vrai invariant : rien de cliquable. L'URL peut figurer dans le texte de
// l'erreur, elle ne doit jamais être une ancre.
check('cas 4 : HTML — aucune ancre vers l\'URL d\'autorisation',
  /<a[^>]+auth\.example\.org/.test(exports.html) === false);
check('cas 4 : Markdown — aucun lien Markdown vers l\'URL d\'autorisation',
  /\]\(\s*https:\/\/auth\.example\.org/.test(exports.md) === false);

// ── Cas 2 — survie au rechargement ──────────────────────────────────────────
console.log('\n── Cas 2 : survie au rechargement ──');
const convId = await page.evaluate(() => currentConvId);
await page.reload();
await page.waitForSelector('#composer-text', { timeout: 15000 });
await page.waitForFunction(() => document.querySelector('.boot-done') !== null,
  { timeout: 15000 });
// L'overlay reste dans le DOM après la classe : laisser le fondu s'achever,
// sinon la capture montre le splash alors que le DOM est déjà juste.
await page.waitForTimeout(600);
await page.evaluate((id) => openConversation(id), convId);
await page.waitForTimeout(600);
const c2 = await readAck();
check('cas 2 : après rechargement, la ligne est toujours en erreur', c2.isError === true);
check('cas 2 : le lien est toujours là', c2.hasLink === true);
check('cas 2 : href intact', c2.href === 'https://auth.example.org/oauth/authorize?client_id=miaou');
check('cas 2 : origine toujours affichée', c2.origin === 'auth.example.org');
await page.screenshot({ path: path.join(outDir, '02-apres-reload.png') });

// Le stub MCP ne survit pas au reload (c'est du JS de page) : le réarmer.
await page.evaluate(() => {
  window.__authFailure = null;
  window.__mcpCalls = 0;
  localStorage.removeItem('miaou-api-servers');
  localStorage.removeItem('miaou-active-api-server');
  mcpRpc = async function (server, method) {
    if (method === 'initialize') return { protocolVersion: '2024-11-05', capabilities: {} };
    if (method === 'notifications/initialized') return {};
    if (method === 'tools/list') {
      return { tools: [{ name: 'bench_ping', description: 'Renvoie sa charge utile',
        inputSchema: { type: 'object', properties: { payload: { type: 'string' } } } }] };
    }
    if (method !== 'tools/call') return {};
    window.__mcpCalls++;
    const f = window.__authFailure;
    if (!f) return { content: [{ type: 'text', text: '{"pong":true}' }] };
    const err = new Error(f.message);
    err.data = f.data;
    throw err;
  };
});
await page.evaluate(async () => { await connectMcpServer(loadMcpServers()[0]); });

// ── Cas 5 — URL irrecevable (http vers hôte non-loopback) ───────────────────
// Aucune manipulation nominale ne produit ce cas : c'est celui où la garde
// tient ou ne tient pas.
console.log('\n── Cas 5 : URL irrecevable ──');
await runScenario('Appelle bench_ping (url http distante)', {
  message: SERVER_MSG + 'http://evil.example.net/authorize',
  data: { code: 'AUTHORIZATION_REQUIRED', upstream: 'bench',
    authorization_url: 'http://evil.example.net/authorize' },
});
const c5 = await readAck();
check('cas 5 : la ligne est bien en erreur', c5.isError === true);
check('cas 5 : AUCUN lien n\'est rendu', c5.hasLink === false);
check('cas 5 : l\'URL refusée n\'apparaît nulle part dans la ligne',
  c5.text.includes('evil.example.net') === false);
await page.screenshot({ path: path.join(outDir, '05-url-irrecevable.png') });

// Matrice de la garde, en RÉEL et non en pur : chaque forme passe par le même
// chemin complet (round-trip, ack, rendu). Le pur les couvre déjà — ce qui est
// mesuré ici est que le chemin réel les fait bien transiter par la garde.
const guardCases = [
  { label: 'https quelconque', url: 'https://as.example.com/a', link: true, origin: 'as.example.com' },
  { label: 'http loopback littéral 127.0.0.1', url: 'http://127.0.0.1:8799/authorize', link: true, origin: '127.0.0.1:8799' },
  { label: 'http localhost', url: 'http://localhost:8799/authorize', link: true, origin: 'localhost:8799' },
  { label: 'http hôte distant', url: 'http://evil.example.net/a', link: false, origin: null },
  { label: 'userinfo dans l\'autorité', url: 'https://as.example.com@evil.net/a', link: false, origin: null },
  { label: 'port non numérique', url: 'https://as.example.com:80x/a', link: false, origin: null },
  { label: 'schéma javascript', url: 'javascript:alert(1)', link: false, origin: null },
  { label: 'URL relative', url: '/authorize', link: false, origin: null },
];
console.log('\n── Matrice de la garde d\'URL (chemin réel) ──');
for (const g of guardCases) {
  await runScenario('Appelle bench_ping — ' + g.label, {
    message: SERVER_MSG + g.url,
    data: { code: 'AUTHORIZATION_REQUIRED', upstream: 'bench', authorization_url: g.url },
  });
  const r = await readAck();
  check('garde (' + g.label + ') : lien ' + (g.link ? 'rendu' : 'refusé'),
    r.hasLink === g.link);
  if (g.link) check('garde (' + g.label + ') : origine ' + g.origin, r.origin === g.origin);
  check('garde (' + g.label + ') : la ligne reste en erreur', r.isError === true);
}

// ── Cas 6 — refus sans URL ──────────────────────────────────────────────────
console.log('\n── Cas 6 : authorization_url à null ──');
await runScenario('Appelle bench_ping (sans parcours)', {
  message: "[MIAOU_AUTH] Le serveur 'bench' exige une autorisation OAuth qui n'a pas encore été accordée.",
  data: { code: 'AUTHORIZATION_REQUIRED', upstream: 'bench', authorization_url: null },
});
const c6 = await readAck();
check('cas 6 : la ligne est en erreur', c6.isError === true);
check('cas 6 : aucun lien (le proxy n\'a rien à proposer)', c6.hasLink === false);
check('cas 6 : le message du serveur reste affiché',
  c6.text.includes('autorisation') || c6.text.includes('bench_ping'));
const entry6 = await readAckEntry();
check('cas 6 : errorCode est bien posé malgré l\'absence d\'URL',
  entry6 && entry6.errorCode === 'AUTHORIZATION_REQUIRED');
await page.screenshot({ path: path.join(outDir, '06-sans-url.png') });

// ── Cas 8 — un autre code ne déclenche PAS le refus ─────────────────────────
// L'égalité de constante contre la sous-chaîne : un message qui PARLE
// d'autorisation, avec un code différent, ne doit produire aucun lien.
// C'est ce qui garantit qu'un 403 de scope rapporté par `status` ne se
// travestit pas en autorisation manquante.
console.log('\n── Cas 8 : autre code d\'erreur (403 de scope) ──');
// Le code est VOISIN du bon, pas éloigné : `AUTHORIZATION_INSUFFICIENT` partage
// son préfixe et son vocabulaire. Un premier jet utilisait `FORBIDDEN_SCOPE`,
// que même une détection laxiste par sous-chaîne (« contient AUTH ») rejetait —
// le contrôle passait donc sans discriminer quoi que ce soit. Vérifié par
// mutation : avec ce code-ci, une détection par sous-chaîne vire au rouge.
await runScenario('Appelle bench_ping (403 de scope)', {
  message: "Refus 403 : le jeton n'a pas le scope requis. Autorisation insuffisante. "
    + 'https://auth.example.org/oauth/authorize',
  data: { code: 'AUTHORIZATION_INSUFFICIENT', upstream: 'bench',
    authorization_url: 'https://auth.example.org/oauth/authorize' },
});
const c8 = await readAck();
check('cas 8 : la ligne est en erreur', c8.isError === true);
check('cas 8 : AUCUN lien — le code diffère, malgré un message qui parle d\'autorisation',
  c8.hasLink === false);
const entry8 = await readAckEntry();
check('cas 8 : errorCode d\'un autre code n\'est pas persisté sur l\'ack',
  !entry8 || entry8.errorCode == null);
const toolText8 = await page.evaluate(() => {
  const msgs = projectThreadToMessages(expandThread(currentThread));
  const t = msgs.filter((m) => m && m.role === 'tool').pop();
  return t ? String(t.content || '') : '';
});
check('cas 8 : le texte modèle garde la forme historique (pas le complément AB-3)',
  toolText8.includes('tu n\'as pas d\'outil') === false);
await page.screenshot({ path: path.join(outDir, '08-autre-code.png') });

// ── Cas 7 — génération détachée ─────────────────────────────────────────────
// « Muter la donnée TOUJOURS, peindre si le nœud existe » (piège 28) : le refus
// arrive alors que l'écran est ailleurs. Le nœud n'existe pas, donc rien n'est
// peint — et le lien doit néanmoins être là au retour.
console.log('\n── Cas 7 : génération détachée ──');
await page.evaluate((msg) => {
  window.__authFailure = {
    message: msg,
    data: { code: 'AUTHORIZATION_REQUIRED', upstream: 'bench',
      authorization_url: 'https://detached.example.org/authorize' },
  };
  newConversation();
}, SERVER_MSG + 'https://detached.example.org/authorize');
await page.waitForTimeout(300);
await page.fill('#composer-text', 'Appelle bench_ping (détaché)');
await page.click('#send-btn');
const detachedId = await page.evaluate(() => currentConvId);
// Basculer AILLEURS pendant le round-trip : la génération continue dans sa
// conversation, l'écran ne lui appartient plus.
await page.evaluate(() => newConversation());
await page.waitForTimeout(2500);
const stillHome = await page.evaluate((id) => currentConvId !== id, detachedId);
check('cas 7 : prémisse — l\'écran a bien quitté la conversation génératrice',
  stillHome === true);
await page.evaluate((id) => openConversation(id), detachedId);
await page.waitForTimeout(700);
const c7 = await readAck();
check('cas 7 : au retour, la ligne est en erreur', c7.isError === true);
check('cas 7 : le lien est là bien qu\'aucun nœud n\'ait été peint pendant le refus',
  c7.hasLink === true);
check('cas 7 : un seul lien (pas de double pose à l\'attache)', c7.linkCount === 1);
check('cas 7 : href intact', c7.href === 'https://detached.example.org/authorize');
await page.screenshot({ path: path.join(outDir, '07-detachee.png') });

// ── Cas 3 — le rejeu réussi efface les marqueurs ────────────────────────────
// Le segment « ouvrir l'onglet, recevoir le callback » appartient au proxy et
// n'est pas observable depuis MIAOU. Ce qui l'est, et qui est le vrai risque :
// un lien périmé subsistant sous un appel redevenu vert.
console.log('\n── Cas 3 : après autorisation, le rejeu efface le lien ──');
await page.evaluate(() => { window.__authFailure = null; newConversation(); });
await page.waitForTimeout(300);
await page.fill('#composer-text', 'Rappelle bench_ping maintenant autorisé');
await page.click('#send-btn');
await page.waitForFunction(() => typeof sending !== 'undefined' && sending === false,
  { timeout: 15000 });
await page.waitForTimeout(500);
const c3 = await readAck();
check('cas 3 : l\'appel réussi n\'est pas en erreur', c3.isError === false);
check('cas 3 : aucun lien d\'autorisation sous un appel vert', c3.hasLink === false);
const entry3 = await readAckEntry();
check('cas 3 : errorCode effacé', !entry3 || entry3.errorCode == null);
check('cas 3 : authorizationUrl effacée', !entry3 || entry3.authorizationUrl == null);
await page.screenshot({ path: path.join(outDir, '03-rejeu-reussi.png') });

// Un appel NEUF qui réussit ne teste pas le nettoyage : il n'y a rien à
// nettoyer, donc les deux branches du prédicat ne peuvent pas diverger (vérifié
// par mutation — retirer `clearAuthorizationRefusal` laissait tout vert).
// Le vrai scénario est le REJEU : la MÊME entrée d'ack, refusée puis réessayée
// avec succès via `reuseAckEntry`. Sans le nettoyage, un lien périmé subsiste
// sous un appel redevenu vert — le défaut que le cas 3 vise réellement.
console.log('\n── Cas 3bis : rejeu sur la MÊME entrée d\'ack ──');
const replay = await page.evaluate(async () => {
  const server = loadMcpServers()[0];
  // 1er appel : refus d'autorisation, sur une entrée neuve.
  window.__authFailure = {
    message: 'refus',
    data: { code: 'AUTHORIZATION_REQUIRED', upstream: 'bench',
      authorization_url: 'https://stale.example.org/authorize' },
  };
  const first = await callRemoteTool(server, 'bench_ping', { payload: 'x' }, null);
  const afterRefusal = {
    errorCode: first.ackEntry.errorCode,
    authorizationUrl: first.ackEntry.authorizationUrl,
    upstream: first.ackEntry.upstream,
    error: first.ackEntry.error,
  };
  // 2e appel : succès, en RÉUTILISANT la même entrée (chemin reuseAckEntry).
  window.__authFailure = null;
  await callRemoteTool(server, 'bench_ping', { payload: 'x' }, null, first.ackEntry);
  return {
    afterRefusal,
    after: {
      errorCode: first.ackEntry.errorCode,
      authorizationUrl: first.ackEntry.authorizationUrl,
      upstream: first.ackEntry.upstream,
      error: first.ackEntry.error,
    },
  };
});
// Prémisse : sans elle, les quatre absences ci-dessous porteraient sur des
// champs qui n'ont jamais été posés.
check('cas 3bis : prémisse — le refus a bien marqué l\'entrée',
  replay.afterRefusal.errorCode === 'AUTHORIZATION_REQUIRED'
  && replay.afterRefusal.authorizationUrl === 'https://stale.example.org/authorize');
check('cas 3bis : le rejeu réussi efface errorCode',
  replay.after.errorCode == null);
check('cas 3bis : le rejeu réussi efface authorizationUrl',
  replay.after.authorizationUrl == null);
check('cas 3bis : le rejeu réussi efface upstream',
  replay.after.upstream == null);
check('cas 3bis : le rejeu réussi efface aussi le marqueur d\'erreur',
  !replay.after.error);

// `stub.local` est bien résolu en réseau par UN chemin : `reopenMcpSession`
// appelle `mcpRpcAttempt` DIRECTEMENT (tools.js), donc sans passer par le
// `mcpRpc` stubé ici. C'est une limite du montage, pas un défaut d'AB-3 : la
// réouverture de session est un chemin de reconnexion, hors du contrat
// d'autorisation. On l'attend donc explicitement plutôt que de la taire — et on
// vérifie qu'AUCUNE autre requête n'a échoué, sinon le silence couvrirait un
// vrai problème.
const unexpectedFailures = failedRequests.filter(
  (u) => u.indexOf('stub.local') < 0 && u.indexOf('/chat/completions') < 0);
check('aucune requête échouée hors reconnexion MCP stubée',
  unexpectedFailures.length === 0);
if (unexpectedFailures.length) console.log('  ', unexpectedFailures.join('\n   '));

// Les erreurs console attendues sont le miroir de ces requêtes-là. Toute autre
// est un vrai défaut.
const unexpectedConsole = consoleErrors.filter(
  (t) => t.indexOf('Failed to load resource') < 0);
check('aucune erreur console inattendue', unexpectedConsole.length === 0);
if (unexpectedConsole.length) console.log('  ', unexpectedConsole.slice(0, 5).join('\n   '));
check('le backend modèle a bien été sollicité', chatCalls > 0);

console.log('\n' + (failures.length
  ? `ÉCHEC — ${failures.length} contrôle(s) : ${failures.join(' | ')}`
  : 'OK — tous les contrôles passent'));
console.log('Captures : ' + outDir);
await browser.close();
process.exit(failures.length ? 1 : 0);
