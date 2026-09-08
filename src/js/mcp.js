/* ── mcp.js ────────────────────────────────────────────────────────────────
   Agrégation MCP distante : MIAOU est un client/agrégateur qui fusionne ses
   outils internes et ceux de N serveurs distants en UN seul registre, invisible
   au modèle.

   Ce fichier porte le côté DISTANT et lui seul : protocole, état de session,
   client JSON-RPC sur transport streamable-http, handshake, marqueurs de refus
   d'autorisation (campagne AB) et routage d'un appel vers un serveur.

   Ce qui est resté dans tools.js, et pourquoi :
   - `exposedTools` COMPOSE interne + distant (elle lit TOOLS et résout
     `agentSpawnToolDef`) — c'est le registre exposé au modèle, pas du MCP
     distant ; seul `remoteToolDefs`, sa moitié distante, vit ici.
   - `callTool` / `callInternalTool` (dispatcher) et le hook d'inflation
     (`callDocsInflatedRemoteTool`) restent chez leurs voisins de domaine.
   - `toolCtx` (lot T-1c) était enclavé dans ce bloc par voisinage seulement :
     il gouverne le référentiel d'exécution de TOUT outil, interne compris.

   Chargé AVANT tools.js dans JS_ORDER. Les `let` d'état de ce fichier
   (`_remoteTools`, `_remoteStatus`) sont lus par leurs consommateurs via des
   fonctions (`getMcpStatus`, `mcpStatusSnapshot`, `mcpInstructionSources`) et
   jamais directement : cf. le commentaire de `mcpStatusSnapshot`.

   Cf. docs/mcp.md.
   ────────────────────────────────────────────────────────────────────────── */

// MIAOU est un client/agrégateur MCP (cf. brief V2) : il fusionne ses outils
// internes et ceux de N serveurs distants en UN seul registre, invisible au
// modèle. État en mémoire UNIQUEMENT (jamais persisté), reconstruit au démarrage
// par connectMcpServer pour chaque serveur activé (cf. main.js init).
const MCP_PROTOCOL_VERSION = '2025-06-18';

// Code d'erreur machine partagé avec le serveur mcp_docs (brief D) : un
// `ref` inconnu sans `content_b64` fourni. Porté dans `error.data.code` (slot
// applicatif standard JSON-RPC 2.0, cf. mcpRpcAttempt) — UNE seule constante,
// ne pas la dupliquer en dur ailleurs.
const REF_UNKNOWN_ERROR_CODE = 'REF_UNKNOWN';

let _remoteTools = {};   // { servername: [ { name:'servername__x', description, inputSchema }, … ] }
let _remoteStatus = {};  // { servername: { state:'connecting'|'ok'|'error', count, error?, sessionId?, unauthorizedUpstreams?, instructions? } }

function getMcpStatus(name) { return _remoteStatus[name] || null; }

// La table entière, pour les consommateurs qui raisonnent sur TOUS les serveurs
// (pastille d'autorisation, revérification au retour de focus) plutôt que sur
// un seul. Fonction et non lecture directe de `_remoteStatus` : un `let` de
// portée fichier ne franchit pas la frontière dans le test runner, qui évalue
// chaque fichier séparément.
function mcpStatusSnapshot() { return _remoteStatus; }

// Serveurs CONNECTÉS publiant des consignes de portée serveur, dans l'ordre
// d'affichage des cartes. Alimente `buildMcpInstructionsBlock` (utils, pur) via
// `contextBlockParts` (main.js).
//
// Lit `_remoteStatus` et non la config : une consigne n'existe que pour un
// serveur dont le handshake a abouti. Un serveur en erreur n'expose AUCUN de
// ses outils (dégradation gracieuse) — injecter ses consignes décrirait au
// modèle l'usage d'outils qu'il n'a pas, ce qui est pire que le silence. Même
// raison pour un serveur désactivé, qui n'a pas d'entrée du tout.
//
// Le `slug` rendu est le nom de la carte, celui-là même qui préfixe les outils
// exposés dans `connectMcpServer` — jamais une valeur venue du serveur.
function mcpInstructionSources() {
  const out = [];
  for (const name of Object.keys(_remoteStatus)) {
    const st = _remoteStatus[name];
    if (!st || st.state !== 'ok' || !st.instructions) continue;
    out.push({ slug: name, instructions: st.instructions });
  }
  out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return out;
}

// Outils distants exposables : déjà préfixés `servername__` et filtrés (allowlist/denylist).
function remoteToolDefs() {
  const out = [];
  for (const name of Object.keys(_remoteTools)) {
    for (const t of _remoteTools[name]) out.push(t);
  }
  return out;
}

// ── Client JSON-RPC 2.0 sur transport streamable-http ───────────
let _mcpRpcId = 0;

// UNE tentative d'appel JSON-RPC (un seul POST ; réponse JSON OU flux SSE). Timeout
// via AbortController. Lève sur erreur ; sur HTTP 404 ALORS qu'on détenait
// un Mcp-Session-Id, tague l'erreur `staleSession = true` (le serveur a redémarré
// et ne reconnaît plus la session → déclenche le ré-handshake dans mcpRpc). Un 404
// SANS session détenue est un vrai 404 (mauvais endpoint), non tagué.
async function mcpRpcAttempt(server, method, params, opts) {
  const o = opts || {};
  const ctrl = new AbortController();
  const tmo = server.timeout || 30000;
  const timer = setTimeout(() => ctrl.abort(), tmo);
  const id = o.notify ? undefined : (++_mcpRpcId);
  const body = { jsonrpc: '2.0', method };
  if (!o.notify) body.id = id;
  if (params !== undefined) body.params = params;
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (server.authorization_token) headers['Authorization'] = 'Bearer ' + server.authorization_token;
  const st = _remoteStatus[server.name];
  const hadSession = !!(st && st.sessionId);
  if (hadSession) headers['Mcp-Session-Id'] = st.sessionId;
  try {
    const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const newSid = res.headers && res.headers.get && res.headers.get('Mcp-Session-Id');
    if (newSid && _remoteStatus[server.name]) _remoteStatus[server.name].sessionId = newSid;
    if (o.notify) return null;
    if (!res.ok) {
      const err = new Error('HTTP ' + res.status);
      if (res.status === 404 && hadSession) err.staleSession = true;   // session invalidée, pas un vrai 404 d'URL
      throw err;
    }
    const ctype = (res.headers && res.headers.get && res.headers.get('Content-Type')) || '';
    const msg = ctype.indexOf('text/event-stream') >= 0 ? await readSseJsonRpc(res, id) : await res.json();
    if (!msg) throw new Error('Réponse vide.');
    if (msg.error) {
      const err = new Error((msg.error && msg.error.message) || 'Erreur JSON-RPC.');
      if (hadSession && /session/i.test(err.message)) err.staleSession = true;   // signalée par erreur JSON-RPC
      // Code machine applicatif (brief D, contrat REF_UNKNOWN) : slot standard
      // JSON-RPC 2.0 pour les données d'erreur applicatives, `code` restant
      // réservé à l'entier protocolaire. err.data.code, jamais err.code.
      if (msg.error && msg.error.data) err.data = msg.error.data;
      throw err;
    }
    return msg.result;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('Délai dépassé (' + tmo + ' ms).');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Refait le handshake initialize (+ notification initialized) pour récupérer un
// nouveau Mcp-Session-Id après invalidation (serveur redémarré). NE re-liste PAS
// les outils — le cache reste valide. Passe par mcpRpcAttempt (pas mcpRpc) pour
// éviter toute récursion de ré-handshake.
async function mcpReinitialize(server) {
  if (_remoteStatus[server.name]) _remoteStatus[server.name].sessionId = null;   // ne plus renvoyer l'id mort
  await mcpRpcAttempt(server, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'miaou', version: '2' },
  }, {});
  try { await mcpRpcAttempt(server, 'notifications/initialized', undefined, { notify: true }); } catch (_) {}
}

// Émet une requête JSON-RPC, avec RÉ-HANDSHAKE PARESSEUX (cf. brief Correction B) :
// si l'appel échoue par session invalidée (404 avec session détenue, ou erreur
// JSON-RPC « session »), refait initialize pour capturer un nouvel id et REJOUE
// l'appel UNE seule fois. Un nouvel échec (ré-handshake ou rejeu) est propagé → la
// dégradation gracieuse prend le relais côté appelant. On ne re-sonde JAMAIS la
// session préventivement — on ne réagit qu'à sa mort avérée, et au plus une fois.
async function mcpRpc(server, method, params, opts) {
  const o = opts || {};
  if (server.transport === 'sse') throw new Error('Transport sse non implémenté (différé en V2).');
  try {
    return await mcpRpcAttempt(server, method, params, o);
  } catch (e) {
    if (!e || !e.staleSession || method === 'initialize' || o.notify) throw e;
    await mcpReinitialize(server);                          // peut lever → propagé
    return await mcpRpcAttempt(server, method, params, o);  // rejeu unique
  }
}

// Lit un flux SSE de réponse streamable-http, renvoie le 1er message JSON-RPC
// dont l'id correspond (repli : 1er message porteur de result/error si id absent).
// Normalise CRLF→LF AVANT découpage : le SDK MCP encadre ses événements en
// `\r\n\r\n`, un découpage sur `\n\n` seul échouerait (→ « Réponse vide »). Les
// octets sont du texte (data: = JSON, CR/LF y sont échappés), normaliser est sûr.
async function readSseJsonRpc(res, wantId) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', found = null;
  for (;;) {
    const r = await reader.read();
    if (r.value) buf += dec.decode(r.value, { stream: true }).replace(/\r\n/g, '\n');
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const evt = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of evt.split('\n')) {
        if (line.indexOf('data:') !== 0) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j && j.id === wantId) { try { reader.cancel(); } catch (_) {} return j; }
          if (found == null && j && (j.result !== undefined || j.error)) found = j;
        } catch (_) { /* fragment non JSON, ignoré */ }
      }
    }
    if (r.done) break;
  }
  return found;
}

// Handshake d'activation : initialize → notification initialized →
// tools/list ; préfixe, filtre (allowlist/denylist), met en cache. DÉGRADE GRACIEUSEMENT : tout
// échec marque le serveur en erreur et n'expose AUCUN de ses outils, sans jamais
// lever vers l'appelant — un mauvais backend ne gèle jamais MIAOU.
async function connectMcpServer(server) {
  const s = server;
  _remoteStatus[s.name] = { state: 'connecting', count: 0, sessionId: null };
  delete _remoteTools[s.name];
  try {
    const init = await mcpRpc(s, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'miaou', version: '2' },
    });
    // Champ STANDARD MCP (InitializeResult.instructions), destiné aux
    // instructions du modèle : une consigne de portée SERVEUR, que rien d'autre
    // dans le protocole ne peut porter (name/description/inputSchema sont
    // par-outil). Jusqu'ici ce résultat était intégralement jeté — seul
    // l'en-tête Mcp-Session-Id de la même réponse était lu.
    //
    // OPTIONNEL par contrat, et absent chez la majorité des serveurs : lecture
    // défensive, aucun log, aucune branche d'erreur. Même posture que
    // `unauthorizedUpstreams` juste dessous, et même durée de vie — porté par
    // `_remoteStatus`, donc reconstruit à chaque connexion et effacé avec la
    // carte à la déconnexion.
    const instructions = (init && typeof init.instructions === 'string' && init.instructions.trim())
      ? init.instructions
      : null;
    try { await mcpRpc(s, 'notifications/initialized', undefined, { notify: true }); } catch (_) {}
    const listed = await mcpRpc(s, 'tools/list', {});
    const tools = (listed && Array.isArray(listed.tools)) ? listed.tools : [];
    const filtered = filterMcpTools(tools, s.toolAllowlist, s.toolDenylist);
    _remoteTools[s.name] = filtered.map(t => ({
      name: s.name + '__' + t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    // Surface FACULTATIVE (lot AB-5) : `listed._meta` arrive dans le même objet
    // que `listed.tools`, donc sans requête ni changement de transport. Son
    // extraction est défensive par contrat — cette fonction dégrade
    // gracieusement, et une surface optionnelle ne doit jamais y déclencher la
    // branche d'erreur, qui masquerait TOUS les outils du serveur.
    //
    // Posée sur `_remoteStatus`, dont elle partage exactement la durée de vie et
    // l'origine : état de session, reconstruit à chaque connexion. La branche
    // d'erreur ci-dessous réécrit l'objet en entier, donc l'information
    // disparaît à la déconnexion — c'est le comportement voulu.
    _remoteStatus[s.name] = Object.assign(_remoteStatus[s.name] || {}, {
      state: 'ok', count: _remoteTools[s.name].length, error: null,
      unauthorizedUpstreams: unauthorizedUpstreamsFromList(listed),
      instructions: instructions,
    });
    return true;
  } catch (e) {
    delete _remoteTools[s.name];
    _remoteStatus[s.name] = { state: 'error', count: 0, error: (e && e.message) || 'échec', sessionId: null };
    return false;
  }
}

function disconnectMcpServer(name) {
  delete _remoteTools[name];
  delete _remoteStatus[name];
}

// Pose / retire les marqueurs de refus d'autorisation sur un ack (campagne AB).
// Extraits de callRemoteTool — qui est async et réseau, donc intestable en
// QuickJS — pour que l'invariant qui les lie soit vérifié plutôt que commenté :
// ces champs sont posés ENSEMBLE et retirés ENSEMBLE. En laisser un derrière au
// rejeu afficherait un lien « Autoriser » périmé sous un appel qui a réussi ;
// en oublier un à la pose donnerait un ack qu'`ackAuthorizationTarget` refuse
// sans rien dire.
//
// `data` est l'objet applicatif d'`error.data` (cf. mcpRpcAttempt), en
// snake_case comme tout ce qui vient du fil ; les champs d'ack sont en
// camelCase. Le renommage a lieu ICI, à la frontière, et nulle part ailleurs.
// Pures, testables en QuickJS.
function applyAuthorizationRefusal(ackEntry, errorCode, data, mcpServerName) {
  if (!ackEntry) return ackEntry;
  if (errorCode !== AUTHORIZATION_REQUIRED_ERROR_CODE) return ackEntry;
  ackEntry.errorCode = errorCode;
  if (data && data.authorization_url != null) ackEntry.authorizationUrl = data.authorization_url;
  if (data && data.upstream != null) ackEntry.upstream = data.upstream;
  // Le nom du serveur MCP configuré, pas son URL : celle-ci est résolue à
  // l'AFFICHAGE depuis la config (cf. _ackMcpServerUrl, ui.js). Figer l'URL ici
  // ferait pointer un ack relu vers l'adresse d'hier.
  if (mcpServerName) ackEntry.mcpServer = mcpServerName;
  return ackEntry;
}

// Texte du tool result quand un serveur MCP refuse faute d'autorisation.
//
// Le message serveur dit déjà l'essentiel (« exige une autorisation OAuth qui
// n'a pas encore été accordée »), mais il est rédigé à l'impératif sans nommer
// son destinataire : « Ouvrir ce lien pour l'accorder » se lit comme une
// consigne AU MODÈLE, qui n'a aucun moyen d'ouvrir quoi que ce soit — il n'y a
// aucun outil d'autorisation, et il n'y en aura pas (ce serait une initiative
// modèle là où seul l'utilisateur peut consentir). Un modèle qui prend cette
// phrase pour lui cherche l'outil, ne le trouve pas, et conclut de travers.
//
// D'où trois choses dites explicitement, qu'aucune ne soit à déduire :
// qui agit (l'utilisateur, pas le modèle), que le lien est DÉJÀ affiché (donc
// rien à transmettre ni à recopier), et que l'échec est temporaire (sinon le
// modèle raye la capacité de ses options et n'y revient plus).
//
// L'URL n'est PAS reprise ici : elle est dans le message serveur, qui suit, et
// la répéter la ferait apparaître deux fois dans le contexte — dont une dans
// une phrase que le modèle pourrait recopier dans sa réponse, remettant un lien
// d'origine réseau sur un chemin de rendu qui, lui, n'a pas la garde de
// `ackAuthorizationTarget`.
// Pure, testable en QuickJS.
function formatAuthorizationRefusalForModel(fullName, serverMessage) {
  return 'Erreur outil distant ' + fullName + ' : ' + (serverMessage || '') +
    '\n\nCet appel est en attente d\'une autorisation que seul l\'utilisateur peut ' +
    'accorder ; tu n\'as pas d\'outil pour le faire toi-même. Le lien nécessaire lui ' +
    'est déjà affiché dans la conversation — inutile de le lui transmettre. Signale-lui ' +
    'simplement que cette action requiert son autorisation, et poursuis avec ce que tu ' +
    'peux faire sans elle. Une fois l\'autorisation accordée, le même appel fonctionnera.';
}

function clearAuthorizationRefusal(ackEntry) {
  if (!ackEntry) return ackEntry;
  delete ackEntry.errorCode;
  delete ackEntry.authorizationUrl;
  delete ackEntry.upstream;
  delete ackEntry.mcpServer;
  return ackEntry;
}

// Route un appel vers un serveur distant : tools/call → { content, isError }.
// Pousse les blocs NON-text dans _pendingToolBlocks (rendu UI éphémère). Le
// retour conserve TOUS les blocs ; flattenToolResult ne gardera que le text pour
// le modèle. Échec/timeout → résultat isError textuel, jamais de throw.
// L'ack mcp_call est poussé dans _pendingToolAcks de manière SYNCHRONE, avant le
// premier await, pour permettre le rendu pendant le round-trip (cf. onEarlyAcks).
// `intent` : description en langage naturel extraite de miaou_intent par callTool
// (déjà strippée des args envoyés au serveur). Stockée dans l'ack pour l'UI.
// `reuseAckEntry` (rejeu REF_UNKNOWN) : réutilise la ligne d'ack du premier
// essai au lieu d'en pousser une seconde — même rendu qu'un rejeu staleSession
// (dont le rejeu vit SOUS un seul callRemoteTool) : UNE ligne d'appel pour
// l'échange complet, l'erreur transitoire est effacée si le rejeu réussit.
async function callRemoteTool(server, toolName, args, intent, reuseAckEntry) {
  const fullName = server.name + '__' + toolName;
  const ackEntry = reuseAckEntry || { kind: 'mcp_call', server: server.name, name: fullName };
  if (intent != null) ackEntry.intent = intent;
  if (!reuseAckEntry) _pendingToolAcks.push(ackEntry);   // synchrone — avant tout await

  try {
    const result = await mcpRpc(server, 'tools/call', { name: toolName, arguments: args || {} });
    const content = (result && Array.isArray(result.content)) ? result.content : [];
    const nonText = content.filter(b => b && b.type !== 'text');
    if (nonText.length) _pendingToolBlocks.push.apply(_pendingToolBlocks, nonText);
    if (result && result.isError) ackEntry.error = true;
    else if (reuseAckEntry) {
      delete ackEntry.error;              // rejeu réussi : échec transitoire effacé
      clearAuthorizationRefusal(ackEntry);   // les marqueurs d'autorisation suivent `error`
    }
    return { content, isError: !!(result && result.isError), ackEntry };
  } catch (e) {
    ackEntry.error = true;
    // errorCode porte le code machine brut (ex. REF_UNKNOWN) depuis err.data.code
    // (mcpRpcAttempt) — évite de dépendre du texte libre du message pour une
    // décision de rejeu ; ackEntry permet au rejeu de réutiliser la même ligne.
    // Ce champ du RÉSULTAT reste hors ACK_COPY_FIELDS : lu en synchrone par
    // l'appelant immédiat callDocsInflatedRemoteTool (hook d'inflation, brief A).
    const errorCode = e && e.data && e.data.code;
    // Refus d'autorisation (campagne AB) : le seul code qui doive SURVIVRE au
    // tour, parce qu'il n'appelle pas une décision de rejeu mais une action de
    // l'utilisateur — qui peut fort bien quitter la conversation et y revenir.
    // Il passe donc par l'ACK (persisté via ACK_COPY_FIELDS), là où le chemin
    // `result.errorCode` ci-dessus est éphémère par construction.
    //
    // `err.data` porte l'objet applicatif COMPLET (cf. mcpRpcAttempt), pas
    // seulement `code` : `authorization_url` et `upstream` sont déjà là, rien à
    // ajouter au transport.
    applyAuthorizationRefusal(ackEntry, errorCode, e && e.data, server && server.name);
    const serverMessage = (e && e.message) || e;
    // Le refus d'autorisation reçoit un texte propre (cf. sa fonction) : le
    // message serveur seul s'adresse mal au modèle. Tout autre échec garde la
    // forme historique.
    const text = errorCode === AUTHORIZATION_REQUIRED_ERROR_CODE
      ? formatAuthorizationRefusalForModel(fullName, serverMessage)
      : 'Erreur outil distant ' + fullName + ' : ' + serverMessage;
    return {
      content: [{ type: 'text', text }],
      isError: true,
      errorCode,
      ackEntry,
    };
  }
}
