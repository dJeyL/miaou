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

// Révision 2026-07-28 (lot AM) : plus de handshake ni de session. Chaque requête
// porte sa version en en-tête et dans `params._meta`, et le serveur se découvre
// par `server/discover`. Deux ères coexistent donc : `'modern'` (cette révision)
// et `'legacy'` (le handshake `initialize` ci-dessus), tranchées à la connexion
// par `mcpProbeVerdict` et portées par `_remoteStatus[name].era`.
const MCP_MODERN_PROTOCOL_VERSION = '2026-07-28';

// Versions joignables par `initialize`, recopiées de `HANDSHAKE_PROTOCOL_VERSIONS`
// du SDK Python. Servent à UNE décision : un refus `-32022` dont `data.supported`
// n'en contient aucune vient d'un serveur moderne seulement, avec qui se replier
// sur `initialize` ne mènerait à rien (cf. `mcpProbeVerdict`).
const MCP_HANDSHAKE_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'];

// Code JSON-RPC « version de protocole non prise en charge » (`data.supported`
// liste celles du serveur).
const MCP_UNSUPPORTED_VERSION_CODE = -32022;

// Identité annoncée par MIAOU, dans `initialize` comme dans l'enveloppe moderne.
const MCP_CLIENT_INFO = { name: 'miaou', version: '2' };

// Code d'erreur machine partagé avec le serveur mcp_docs (brief D) : un
// `ref` inconnu sans `content_b64` fourni. Porté dans `error.data.code` (slot
// applicatif standard JSON-RPC 2.0, cf. mcpRpcAttempt) — UNE seule constante,
// ne pas la dupliquer en dur ailleurs.
const REF_UNKNOWN_ERROR_CODE = 'REF_UNKNOWN';

let _remoteTools = {};   // { servername: [ { name:'servername__x', description, inputSchema }, … ] }
let _remoteStatus = {};  // { servername: { state:'connecting'|'ok'|'error', count, error?, sessionId?, era?, protocolVersion?, unauthorizedUpstreams?, instructions?, skillsDeclared?, skillCatalogue? } }

// Dernière tentative de handshake, par serveur : { servername: timestamp }.
// Registre SÉPARÉ de `_remoteStatus` et non un champ de plus, parce que la
// branche d'erreur de `connectMcpServer` réécrit cet objet EN ENTIER — un
// horodatage posé dessus survivrait au succès (Object.assign) mais serait perdu
// à chaque échec, c'est-à-dire exactement dans le cas où l'on veut savoir quand
// on a essayé pour la dernière fois. Alimenté par `connectMcpServer` seule, donc
// par tous les chemins qui connectent (boot, save de carte, glyphe, retour de
// focus), sans avoir à les câbler un par un.
let _mcpLastAttempt = {};
function mcpLastAttempt(name) { return _mcpLastAttempt[name] || 0; }

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

// Catalogues de skills des serveurs CONNECTÉS qui déclarent l'extension :
// `{ <carte>: catalogue|null }` (null = `skills/list` illisible). Clé = libellé
// de carte, l'identité de serveur que la spec impose (jamais `serverInfo.name`).
function mcpSkillCatalogues() {
  const out = {};
  for (const name of Object.keys(_remoteStatus)) {
    const st = _remoteStatus[name];
    if (st && st.state === 'ok' && st.skillsDeclared) out[name] = Array.isArray(st.skillCatalogue) ? st.skillCatalogue : null;
  }
  return out;
}

// Skill MCP exigée par un outil distant exposé (nom complet `<carte>__…`), ou
// null : l'URI lue dans le `_meta` de `tools/list` à la connexion.
function remoteToolRequiresSkill(fullName) {
  const card = String(fullName || '').split('__')[0];
  const def = (_remoteTools[card] || []).find(t => t.name === fullName);
  return (def && def.requiresSkill) || null;
}

// Outils distants exposables : déjà préfixés `servername__` et filtrés (allowlist/denylist).
function remoteToolDefs() {
  const out = [];
  for (const name of Object.keys(_remoteTools)) {
    for (const t of _remoteTools[name]) out.push(t);
  }
  return out;
}

// ── Révision 2026-07-28 : enveloppe, sonde, lecture des erreurs ───
//
// Purs, testés en QuickJS. Le chemin async qui les emploie (`mcpRpcAttempt`,
// `probeMcpEra`, `connectMcpServer`) ne l'est pas, cf. docs/mcp.md point 3.

// Méthodes dont la cible part aussi en en-tête `Mcp-Name`, et le paramètre qui
// la porte (table `NAME_BEARING_METHODS` du SDK). MIAOU émet `tools/call` et,
// pour lire une skill servie par le serveur, `resources/read` (mesuré : le
// proxy refuse en 400 un `Mcp-Name` absent ou différent de l'URI).
const MCP_NAME_BEARING_METHODS = { 'tools/call': 'name', 'prompts/get': 'name', 'resources/read': 'uri' };

// Valeur d'en-tête qui survit à HTTP : verbatim si ASCII imprimable sans espace
// en bordure, sinon enveloppée en `=?base64?<utf-8 en base64>?=` (port de
// `encode_header_value` du SDK). Sans ça, `fetch` LÈVE sur un caractère hors
// ISO-8859-1 : un nom d'outil accentué ferait échouer l'appel avant le réseau.
// Une valeur qui ressemble déjà à l'enveloppe est enveloppée à son tour, sans
// quoi le serveur la décoderait.
function encodeMcpHeaderValue(value) {
  const s = String(value == null ? '' : value);
  if (/^[\x20-\x7E]*$/.test(s) && s === s.trim() && !/^=\?base64\?.*\?=$/.test(s)) return s;
  return '=?base64?' + arrayBufferToBase64(utf8Encode(s)) + '?=';
}

// En-têtes propres à l'ère et `params` à envoyer, pour UNE requête. Point de
// construction unique, appelé par `mcpRpcAttempt` seul : tout appel, y compris
// l'appel direct de tools.js (description d'un fichier de bibliothèque), en
// hérite sans le savoir.
//
// Legacy : rien à ajouter, `params` rendu tel quel. Pas d'en-tête de version
// non plus, bien que 2025-06-18 l'exige (décision du lot AM) : un serveur
// dont le CORS a fait échouer la sonde refuserait le même en-tête ici, et le
// repli casserait exactement là où il sert.
//
// Moderne : la version, la méthode et la cible en en-têtes, et l'enveloppe
// `_meta` réservée dans `params`. `params` est COPIÉ, jamais muté : l'appelant
// garde ses arguments (le hook d'inflation les réutilise pour un rejeu), et un
// `_meta` qu'il aurait posé est conservé, nos trois clés réservées en plus.
function mcpRequestShape(era, method, params) {
  if (era !== 'modern') return { headers: {}, params: params };
  const p = Object.assign({}, params || {});
  p._meta = Object.assign({}, p._meta || {}, {
    'io.modelcontextprotocol/protocolVersion': MCP_MODERN_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientCapabilities': {},
    'io.modelcontextprotocol/clientInfo': Object.assign({}, MCP_CLIENT_INFO),
  });
  const headers = { 'MCP-Protocol-Version': MCP_MODERN_PROTOCOL_VERSION, 'Mcp-Method': method };
  const key = MCP_NAME_BEARING_METHODS[method];
  if (key && typeof p[key] === 'string') headers['Mcp-Name'] = encodeMcpHeaderValue(p[key]);
  return { headers: headers, params: p };
}

// Verdict de la sonde `server/discover` : 'modern', 'legacy' (se replier sur
// `initialize`) ou 'fail' (échec franc, l'erreur est propagée). Calé sur
// `client/_probe.py` du SDK, donc en LISTE D'EXCLUSION : tout ce qui n'est pas
// une preuve positive de serveur moderne se replie, sauf trois cas.
//
// - Réponse sans erreur : moderne seulement si `supportedVersions` contient
//   notre révision. `{}`, une réponse illisible ou une liste d'anciennes
//   versions (le go-sdk annonce ainsi un legacy) se replient.
// - Délai dépassé (`err.timeout`) : échec. Un serveur qui ne répond pas
//   ne répondra pas mieux à `initialize`, et le repli doublerait l'attente.
// - 401/403 : échec. L'authentification ne dépend pas de l'ère, se replier
//   doublerait la requête pour le même refus.
// - `-32022` dont `data.supported` ne contient aucune version de handshake :
//   échec, vrai serveur moderne qui ne parle pas notre révision.
// - Tout le reste se replie : erreur JSON-RPC quel que soit le statut, statut
//   non 2xx sans corps, ET échec réseau (`err.network`). Ce dernier est un
//   écart délibéré avec le SDK : dans un navigateur, un CORS qui refuse les
//   nouveaux en-têtes lève le même `TypeError` qu'un serveur éteint. Un serveur
//   réellement éteint échoue alors deux fois, vite.
//
// `err` est lu par ses champs (`timeout`, `status`, `rpcCode`, `data`), posés
// par `mcpRpcAttempt` / `mcpJsonRpcError`, jamais par son message.
function mcpProbeVerdict(result, err) {
  if (!err) {
    const versions = (result && Array.isArray(result.supportedVersions)) ? result.supportedVersions : [];
    return versions.indexOf(MCP_MODERN_PROTOCOL_VERSION) >= 0 ? 'modern' : 'legacy';
  }
  if (err.timeout) return 'fail';
  if (err.status === 401 || err.status === 403) return 'fail';
  if (err.rpcCode === MCP_UNSUPPORTED_VERSION_CODE) {
    const supported = (err.data && Array.isArray(err.data.supported)) ? err.data.supported : null;
    if (supported && !supported.some(v => MCP_HANDSHAKE_PROTOCOL_VERSIONS.indexOf(v) >= 0)) return 'fail';
  }
  return 'legacy';
}

// Un 404 alors qu'on détenait une session = session morte (serveur redémarré),
// pas un vrai 404 d'URL. Tranché sur le statut SEUL, avant toute lecture du
// corps : c'est ce qui garde le ré-handshake de `mcpRpc` indépendant de ce que
// le serveur écrit dans sa réponse. Inatteignable en moderne, faute de session.
function isMcpStaleSessionResponse(status, hadSession) {
  return status === 404 && !!hadSession;
}

// Erreur levée pour un objet `error` JSON-RPC, qu'il arrive sur un 200 ou dans
// le corps d'une réponse non 2xx : la même dans les deux cas.
//
// `applicative` dit que le serveur a RÉPONDU : quoi que dise l'erreur, il est
// joignable, et `noteMcpCallFailure` ne doit pas le déclarer injoignable pour
// un appel qu'il refuse. `data` porte l'objet applicatif complet (contrats
// REF_UNKNOWN et AUTHORIZATION_REQUIRED, lus sur `err.data.code`, jamais sur
// `err.code`) ; `rpcCode` l'entier protocolaire, lu par `mcpProbeVerdict`.
// `status` n'est posé que pour une réponse non 2xx.
function mcpJsonRpcError(rpcError, status, hadSession) {
  const e = rpcError || {};
  const err = new Error(e.message || 'Erreur JSON-RPC.');
  err.applicative = true;
  if (typeof e.code === 'number') err.rpcCode = e.code;
  if (e.data) err.data = e.data;
  if (status) err.status = status;
  if (hadSession && /session/i.test(err.message)) err.staleSession = true;   // signalée par erreur JSON-RPC
  return err;
}

// Erreur levée pour une réponse non 2xx. `msg` est son corps lu en JSON, ou
// null. Avant cette lecture, le corps était ignoré : un 400 ou un 404 portant
// une erreur JSON-RPC devenait un « HTTP 400 » nu, au message perdu et sans
// `applicative`, donc un serveur qui venait de répondre était déclaré
// injoignable. Le chemin moderne répond ainsi à TOUTE erreur de dispatch.
//
// La session morte garde la priorité, quel que soit le corps (cf.
// `isMcpStaleSessionResponse`).
function mcpHttpFailure(status, msg, hadSession) {
  if (isMcpStaleSessionResponse(status, hadSession)) {
    const stale = new Error('HTTP ' + status);
    stale.status = status;
    stale.staleSession = true;
    return stale;
  }
  if (msg && msg.error) return mcpJsonRpcError(msg.error, status, hadSession);
  const err = new Error('HTTP ' + status);
  err.status = status;
  return err;
}

// Consignes de portée serveur : `instructions` de l'InitializeResult en legacy,
// du DiscoverResult en moderne (même contenu, mesuré sur le proxy). Champ
// standard OPTIONNEL : absent ou vide est le cas majoritaire, rendu null sans
// bruit.
function mcpInstructionsFrom(result) {
  return (result && typeof result.instructions === 'string' && result.instructions.trim())
    ? result.instructions
    : null;
}

// ── Client JSON-RPC 2.0 sur transport streamable-http ───────────
let _mcpRpcId = 0;

// UNE tentative d'appel JSON-RPC (un seul POST ; réponse JSON OU flux SSE). Timeout
// via AbortController. Lève sur erreur ; sur HTTP 404 ALORS qu'on détenait
// un Mcp-Session-Id, tague l'erreur `staleSession = true` (le serveur a redémarré
// et ne reconnaît plus la session → déclenche le ré-handshake dans mcpRpc). Un 404
// SANS session détenue est un vrai 404 (mauvais endpoint), non tagué.
//
// L'ère de la requête est celle du serveur (`_remoteStatus[name].era`), sauf
// `opts.era` qui la force : c'est ainsi que la sonde part en moderne avant que
// l'ère soit connue. Inconnue, elle vaut legacy, le comportement d'avant le lot
// AM. En moderne, ni `Mcp-Session-Id` envoyé ni capturé : cette révision n'a
// pas de session.
//
// Les erreurs portent des champs que lit `mcpProbeVerdict` : `timeout` (délai
// dépassé), `network` (`fetch` a levé : serveur éteint OU préflight CORS
// refusé, indiscernables dans un navigateur), `status` (réponse non 2xx) et
// `rpcCode` (erreur JSON-RPC).
async function mcpRpcAttempt(server, method, params, opts) {
  const o = opts || {};
  const ctrl = new AbortController();
  // SEUL point de conversion secondes → millisecondes du domaine MCP : la carte,
  // la config et le défaut sont tous en secondes, `setTimeout` est la seule
  // frontière qui exige des ms. Passe par `mcpTimeoutSeconds` plutôt que de lire
  // `server.timeout_s` nu, pour qu'une carte non normalisée (objet forgé par un
  // test, carte d'avant la migration lue directement) reste correctement bornée.
  const tmo = (mcpTimeoutSeconds(server) || MCP_DEFAULT_TIMEOUT_S) * 1000;
  const timer = setTimeout(() => ctrl.abort(), tmo);
  const st = _remoteStatus[server.name];
  const era = o.era || (st && st.era) || 'legacy';
  const shape = mcpRequestShape(era, method, params);
  const id = o.notify ? undefined : (++_mcpRpcId);
  const body = { jsonrpc: '2.0', method };
  if (!o.notify) body.id = id;
  if (shape.params !== undefined) body.params = shape.params;
  const headers = Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }, shape.headers);
  if (server.authorization_token) headers['Authorization'] = 'Bearer ' + server.authorization_token;
  const hadSession = era !== 'modern' && !!(st && st.sessionId);
  if (hadSession) headers['Mcp-Session-Id'] = st.sessionId;
  try {
    let res;
    try {
      res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      if (e && e.name !== 'AbortError') e.network = true;
      throw e;
    }
    if (era !== 'modern') {
      const newSid = res.headers && res.headers.get && res.headers.get('Mcp-Session-Id');
      if (newSid && _remoteStatus[server.name]) _remoteStatus[server.name].sessionId = newSid;
    }
    if (o.notify) return null;
    if (!res.ok) {
      // Ordre voulu : la session morte se tranche sur le statut, AVANT de lire
      // le corps (cf. isMcpStaleSessionResponse).
      if (isMcpStaleSessionResponse(res.status, hadSession)) throw mcpHttpFailure(res.status, null, hadSession);
      throw mcpHttpFailure(res.status, await readMcpErrorBody(res), hadSession);
    }
    const ctype = (res.headers && res.headers.get && res.headers.get('Content-Type')) || '';
    const msg = ctype.indexOf('text/event-stream') >= 0 ? await readSseJsonRpc(res, id) : await res.json();
    if (!msg) throw new Error('Réponse vide.');
    if (msg.error) throw mcpJsonRpcError(msg.error, null, hadSession);
    return msg.result;
  } catch (e) {
    if (e && e.name === 'AbortError') {
      const err = new Error('Délai dépassé (' + tmo + ' ms).');
      err.timeout = true;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Corps d'une réponse non 2xx, lu en JSON si le serveur l'annonce, sinon null.
// Ne lève jamais : un corps illisible laisse l'appelant au « HTTP <statut> » nu.
async function readMcpErrorBody(res) {
  try {
    const ctype = (res.headers && res.headers.get && res.headers.get('Content-Type')) || '';
    if (ctype.indexOf('json') < 0) return null;
    return await res.json();
  } catch (_) {
    return null;
  }
}

// Refait le handshake initialize (+ notification initialized) pour récupérer un
// nouveau Mcp-Session-Id après invalidation (serveur redémarré). NE re-liste PAS
// les outils — le cache reste valide. Passe par mcpRpcAttempt (pas mcpRpc) pour
// éviter toute récursion de ré-handshake.
async function mcpReinitialize(server) {
  if (_remoteStatus[server.name]) _remoteStatus[server.name].sessionId = null;   // ne plus renvoyer l'id mort
  await mcpRpcAttempt(server, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: Object.assign({}, MCP_CLIENT_INFO),
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

// Sonde d'ère : `server/discover` envoyé en moderne, verdict par
// `mcpProbeVerdict`. Rend `{ era, discover }` (le DiscoverResult en moderne,
// null en legacy) ou lève l'erreur de la sonde sur un échec franc.
//
// Passe par `mcpRpc` comme toute méthode : les verify qui stubent `mcpRpc` par
// nom de méthode rendent `{}` à celle-ci, ce qui vaut repli, et couvrent donc
// le chemin legacy sans retouche.
async function probeMcpEra(server) {
  let result = null, failure = null;
  try {
    result = await mcpRpc(server, 'server/discover', undefined, { era: 'modern' });
  } catch (e) {
    failure = e;
  }
  const era = mcpProbeVerdict(result, failure);
  if (era === 'fail') throw failure;
  return { era: era, discover: era === 'modern' ? result : null };
}

// Activation : sonde d'ère, puis en legacy initialize → notification
// initialized, puis tools/list ; préfixe, filtre (allowlist/denylist), met en
// cache. DÉGRADE GRACIEUSEMENT : tout échec marque le serveur en erreur et
// n'expose AUCUN de ses outils, sans jamais lever vers l'appelant — un mauvais
// backend ne gèle jamais MIAOU.
//
// L'ère vit dans `_remoteStatus`, en mémoire seulement, avec la même durée de
// vie que `sessionId` (décision du lot AM) : chaque connexion refait la
// sonde, et un serveur mis à jour change d'ère à sa prochaine reconnexion. Un
// serveur qui change d'ère SOUS nous n'est pas rattrapé automatiquement :
// l'erreur s'affiche, et la reconnexion (glyphe, retour de focus) re-sonde.
async function connectMcpServer(server) {
  const s = server;
  // Horodaté à l'ENTRÉE, pas à la sortie : deux retours de focus rapprochés
  // pendant un handshake lent doivent voir la tentative en cours, sinon le
  // throttle ne protège de rien précisément quand le serveur est lent.
  _mcpLastAttempt[s.name] = Date.now();
  _remoteStatus[s.name] = { state: 'connecting', count: 0, sessionId: null, era: null };
  delete _remoteTools[s.name];
  try {
    const probe = await probeMcpEra(s);
    if (_remoteStatus[s.name]) _remoteStatus[s.name].era = probe.era;
    let negotiated = null;
    let source = probe.discover;
    if (probe.era === 'legacy') {
      source = await mcpRpc(s, 'initialize', {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: Object.assign({}, MCP_CLIENT_INFO),
      });
      negotiated = (source && typeof source.protocolVersion === 'string') ? source.protocolVersion : MCP_PROTOCOL_VERSION;
      try { await mcpRpc(s, 'notifications/initialized', undefined, { notify: true }); } catch (_) {}
    } else {
      negotiated = MCP_MODERN_PROTOCOL_VERSION;
    }
    // Champ STANDARD MCP, destiné aux instructions du modèle : une consigne de
    // portée SERVEUR, que rien d'autre dans le protocole ne peut porter
    // (name/description/inputSchema sont par-outil). Lu dans l'InitializeResult
    // en legacy, dans le DiscoverResult en moderne.
    //
    // OPTIONNEL par contrat, et absent chez la majorité des serveurs : lecture
    // défensive, aucun log, aucune branche d'erreur. Même posture que
    // `unauthorizedUpstreams` juste dessous, et même durée de vie — porté par
    // `_remoteStatus`, donc reconstruit à chaque connexion et effacé avec la
    // carte à la déconnexion.
    const instructions = mcpInstructionsFrom(source);
    // Extension Skills : déclarée dans le DiscoverResult seulement (jamais en
    // legacy). Elle décide du masquage du repli de lecture et de l'appel à
    // `skills/list`.
    const skillsDeclared = probe.era === 'modern' && mcpDeclaresSkillsExtension(probe.discover);
    const listed = await mcpRpc(s, 'tools/list', {});
    const tools = (listed && Array.isArray(listed.tools)) ? listed.tools : [];
    // Le repli est retiré ICI, une fois, et pas à la composition des
    // définitions : il disparaît aussi du drawer des outils — ce que le modèle
    // ne voit pas, l'écran ne le montre pas comme disponible.
    const visible = tools.filter(t => !shouldHideMcpTool(t, skillsDeclared));
    const filtered = filterMcpTools(visible, s.toolAllowlist, s.toolDenylist);
    _remoteTools[s.name] = filtered.map(t => {
      const def = {
        name: s.name + '__' + t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || { type: 'object', properties: {} },
      };
      // Seule clé du `_meta` d'outil retenue : la skill exigée avant l'appel,
      // lue par la garde distante de `callTool` et la trousse d'un agent.
      const requiresSkill = mcpToolRequiresSkill(t);
      if (requiresSkill) def.requiresSkill = requiresSkill;
      return def;
    });
    // Catalogue : métadonnées seulement, aucun contenu. `null` quand la liste
    // n'a pas pu être lue — la garde reste alors ouverte, faute de pouvoir
    // dire au modèle quoi lire. Jamais une cause d'échec de la connexion.
    const skillCatalogue = skillsDeclared ? await listMcpSkills(s) : [];
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
      era: probe.era,
      protocolVersion: negotiated,
      skillsDeclared: skillsDeclared,
      skillCatalogue: skillCatalogue,
    });
    return true;
  } catch (e) {
    delete _remoteTools[s.name];
    _remoteStatus[s.name] = { state: 'error', count: 0, error: (e && e.message) || 'échec', sessionId: null };
    return false;
  }
}

// Catalogue de skills d'un serveur qui déclare l'extension : `skills/list`,
// curseur suivi au plus `MCP_SKILLS_LIST_MAX_PAGES` fois, entrées normalisées
// par `mcpSkillCatalogueFrom`. Rend `null` sur tout échec, sans lever : la
// connexion dégrade gracieusement, et une surface facultative ne doit pas y
// déclencher la branche d'erreur, qui masquerait TOUS les outils du serveur.
async function listMcpSkills(server) {
  try {
    const items = [];
    let cursor = null;
    for (let page = 0; page < MCP_SKILLS_LIST_MAX_PAGES; page++) {
      const res = await mcpRpc(server, 'skills/list', cursor ? { cursor: cursor } : {});
      if (res && Array.isArray(res.skills)) for (const it of res.skills) items.push(it);
      cursor = (res && typeof res.nextCursor === 'string' && res.nextCursor) ? res.nextCursor : null;
      if (!cursor) break;
    }
    return mcpSkillCatalogueFrom(items);
  } catch (_) {
    return null;
  }
}

// Entrée FRAÎCHE d'une skill (`skills/get`), normalisée : jamais gardée en
// mémoire entre deux lectures. La spec fait tenir l'« entrée détenue » pendant
// la fenêtre d'action ; ici, c'est l'approbation, liée au manifeste, qui la
// tient — une entrée fraîche différente de l'approuvée est refusée en amont.
// Rien à invalider, et un rechargement de page ne casse pas la lecture d'une
// annexe. Rend `{ entry }` ou `{ problem }`, sans lever.
async function fetchMcpSkillEntry(server, skillUri) {
  try {
    const res = await mcpRpc(server, 'skills/get', { uri: skillUri });
    const n = normalizeMcpSkillEntry(mcpSkillEntryFromResult(res));
    return n.entry ? { entry: n.entry } : { problem: 'entrée invalide : ' + n.problem };
  } catch (e) {
    return { problem: 'entrée illisible (' + ((e && e.message) || 'échec') + ')' };
  }
}

// Lit UN fichier d'une skill dont l'entrée fraîche est `entry`, et le vérifie :
// fichier listé au manifeste (liste blanche), taille puis empreinte, et, pour
// le SKILL.md, frontmatter comparé à l'entrée. Une skill dynamique n'a ni
// manifeste ni empreinte : seuls le répertoire et la borne de taille de la
// spec s'appliquent. Rend `{ text, bytes, isSkillMd }` (`text` null pour un
// binaire) ou `{ problem }` ; aucun contenu n'est rendu sur un échec.
//
// N'APPROUVE RIEN : l'appelant décide s'il a le droit de lire (lecture par le
// modèle, approbation exigée) ou s'il inspecte (geste de l'utilisateur dans la
// fiche, lecture sans chargement).
async function readVerifiedMcpSkillFile(server, entry, fileUri) {
  const isSkillMd = fileUri === entry.uri;
  let listed = null;
  if (!entry.dynamic) {
    listed = entry.resources.find(r => r.uri === fileUri) || null;
    if (!listed) return { problem: 'fichier absent du manifeste de la skill' };
  } else if (!isSkillMd && fileUri.indexOf(entry.dir) !== 0) {
    return { problem: 'fichier hors du répertoire de la skill' };
  }
  let content = null;
  try {
    const res = await mcpRpc(server, 'resources/read', { uri: fileUri });
    const contents = (res && Array.isArray(res.contents)) ? res.contents : [];
    content = contents.find(c => c && c.uri === fileUri) || contents[0] || null;
  } catch (e) {
    return { problem: 'lecture impossible (' + ((e && e.message) || 'échec') + ')' };
  }
  const bytes = mcpResourceContentBytes(content);
  if (!bytes) return { problem: 'contenu illisible' };
  if (listed) {
    const v = verifyMcpSkillFile(bytes, listed);
    if (v) return { problem: formatMcpSkillFileProblem(v) };
  } else if (bytes.length > MCP_SKILL_MAX_TOTAL_BYTES) {
    return { problem: 'plus de 16 Mio' };
  }
  const text = mcpSkillFileText(content, bytes);
  if (isSkillMd) {
    if (text == null) return { problem: 'SKILL.md illisible comme texte' };
    const fm = verifyMcpSkillFrontmatter(text, entry.frontmatter);
    if (fm) return { problem: 'frontmatter : ' + (fm.field ? fm.field + ', ' : '') + fm.reason };
  }
  return { text: text, bytes: bytes, isSkillMd: isSkillMd };
}

function disconnectMcpServer(name) {
  delete _remoteTools[name];
  delete _remoteStatus[name];
  // L'horodatage part avec le reste : un serveur supprimé puis recréé sous le
  // même nom hériterait sinon du throttle de son prédécesseur, et sa première
  // vérification serait muette sans raison lisible.
  delete _mcpLastAttempt[name];
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
  // l'AFFICHAGE depuis la config (cf. _ackMcpServerUrl, acks.js). Figer l'URL ici
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
// Un appel d'outil qui echoue au TRANSPORT retombe sur le statut du serveur.
//
// Sans ca l'information se perdait : `_remoteStatus` n'est ecrit qu'aux
// mutations de configuration (connexion, sauvegarde, reverification au focus),
// donc un serveur tombant EN COURS de conversation restait marque 'ok'. Le
// modele voyait « Failed to fetch » dans son tool result et l'utilisateur
// n'avait aucun signal : ni pastille de topbar, ni chat soucieux.
//
// La ligne de partage est transport / applicatif, et elle compte : une erreur
// JSON-RPC (outil inconnu, argument invalide, refus d'autorisation) prouve au
// contraire que le serveur repond. La declarer injoignable rendrait le chat
// soucieux pour un appel malformé, et le signal cesserait d'etre lu.
//
// Ne touche QUE `state`/`error` : le reste de l'entree (outils listes, session,
// consignes) reste valide, c'est la reconnexion qui la reecrit en entier.
function noteMcpCallFailure(serverName, err) {
  if (!serverName || (err && err.applicative)) return;
  const st = _remoteStatus[serverName];
  if (!st || st.state === 'error') return;
  st.state = 'error';
  st.error = (err && err.message) || 'injoignable';
  // Meme point de passage que les autres ecritures de statut : la pastille de
  // topbar ET le chat soucieux en derivent, aucun des deux n'est cable ici.
  if (typeof syncAuthorizationPending === 'function') syncAuthorizationPending();
}

// Reciproque de `noteMcpCallFailure` : un appel reussi releve le statut.
// Prudence deliberee — on ne repasse 'ok' que depuis 'error', et sans toucher
// au compte d'outils ni aux upstreams a autoriser : ce sont des faits etablis
// par `tools/list`, qu'un simple `tools/call` ne reobserve pas.
function noteMcpCallSuccess(serverName) {
  if (!serverName) return;
  const st = _remoteStatus[serverName];
  if (!st || st.state !== 'error') return;
  st.state = 'ok';
  st.error = null;
  if (typeof syncAuthorizationPending === 'function') syncAuthorizationPending();
}

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
    // Un appel qui PASSE prouve le serveur joignable, y compris quand l'outil
    // repond une erreur metier : c'est le transport qui est en cause dans un
    // 'error' pose par `noteMcpCallFailure`, et il vient de fonctionner.
    // Sans cette reciproque l'etat survivait jusqu'au prochain retour de focus
    // — le chat restait soucieux devant un serveur redevenu sain, exactement le
    // defaut corrige cote backend au lot precedent.
    noteMcpCallSuccess(server && server.name);
    if (result && result.isError) ackEntry.error = true;
    else if (reuseAckEntry) {
      delete ackEntry.error;              // rejeu réussi : échec transitoire effacé
      clearAuthorizationRefusal(ackEntry);   // les marqueurs d'autorisation suivent `error`
    }
    // `_meta` du résultat (lot AI) : canal HORS MODÈLE d'un outil vers
    // l'application — seul `fetch_url` l'emploie aujourd'hui, sous la clé
    // `miaou/web`. Relayé tel quel ; api.js en extrait ce qu'il sait lire
    // (webMetaFromResult, utils.js), l'ack le porte, `content` n'en voit rien.
    const out = { content, isError: !!(result && result.isError), ackEntry };
    if (result && result._meta && typeof result._meta === 'object') out._meta = result._meta;
    return out;
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
    noteMcpCallFailure(server && server.name, e);
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
