/* ── tools.js ──────────────────────────────────────────────────────────────
   Registre interne d'outils en forme MCP : { name, description, inputSchema,
   annotations, handler }. La conversion vers le format OpenAI envoyé au modèle
   est produite à l'envoi par toolDefinitions() — un seul sens de traduction.
   ask_confirmation est un primitif halting hors registre MCP (voir ci-dessous).
   ────────────────────────────────────────────────────────────────────────── */

// Entrée « légère » : ce qui est déjà stocké dans l'index miaou-summaries.
function summaryLight(e) {
  return { id: e.id, title: e.title, timestamp: e.timestamp,
           summary: e.summary, keywords: e.keywords };
}

// Doctrine comportementale : ressources binaires. Toujours injectée quand des outils
// existent — indépendamment de includeToolsInSystemPrompt (qui ne gouverne que
// l'énumération textuelle). Partie de ROOT_SYSTEM_PROMPT.
const BINARY_DOCTRINE =
  "Quand un outil renvoie des données binaires (image, fichier, base64…), l'application " +
  "les enregistre sous forme de ressource et t'en communique l'ID. Les images sont " +
  "affichées directement dans l'interface : tu peux les introduire par UNE phrase courte au plus " +
  "(« Voici l'image demandée. »), mais ne reproduis jamais, n'encode pas, ne simule pas " +
  "et ne décris pas le contenu binaire — pas de base64, pas d'image Markdown, pas de " +
  "placeholder inventé. N'appelle pas present_resource pour une image sans demande explicite : " +
  "l'application l'a déjà présentée à l'utilisateur.";

// Doctrine de déclenchement des outils mémoire. Partie de ROOT_SYSTEM_PROMPT.
const MEMORY_DOCTRINE =
  "Doctrine de déclenchement pour les outils mémoire :\n\n" +
  "CHEMIN DIRECT — appelle miaou__create_memory immédiatement (sans demander) quand l'utilisateur :\n" +
  "  - donne une instruction durable explicite : \"souviens-toi que\", \"retiens\", \"dorénavant\", " +
  "\"désormais\", \"à partir de maintenant\", \"appelle-moi X\", \"ne fais plus jamais Y\"\n" +
  "  - communique un fait stable sur lui-même (métier, projet, contrainte personnelle)\n" +
  "  - exprime une préférence de fond sur le format ou le ton de tes réponses\n" +
  "Sur le chemin direct : tu PEUX narrer « c'est noté » car l'écriture a déjà eu lieu.\n\n" +
  "CHEMIN INFÉRÉ — appelle ask_confirmation quand tu DÉDUIS (sans demande explicite) " +
  "qu'un fait durable mérite d'être retenu. Élargis le périmètre des faits durables pour " +
  "inclure systématiquement la localisation géographique et l'environnement quotidien : " +
  "si un tel détail apparaît, même s'il sert de contexte à une question technique, utilise " +
  "ce chemin pour proposer de le retenir. La question doit contenir LITTÉRALEMENT le " +
  "contenu envisagé : « Tu veux que je retienne : « … » ? ». " +
  "Ne JAMAIS écrire en mémoire sans confirmation préalable sur ce chemin. " +
  "Ne JAMAIS affirmer avoir enregistré quelque chose si tu n'as pas appelé miaou__create_memory dans ce même tour.\n\n" +
  "CHEMIN CORRECTION — quand l'utilisateur répond en texte libre à une question ask_confirmation " +
  "(au lieu de cliquer Accepter/Rejeter) et que sa réponse contient une valeur corrigée " +
  "(ex. « non, plutôt un modèle Y »), appelle miaou__create_memory avec la valeur corrigée. " +
  "Ne pas se contenter d'acquitter en texte.\n\n" +
  "MISE À JOUR / SUPPRESSION : si un souvenir existant devient obsolète ou inexact, " +
  "appelle miaou__update_memory (correction in-place) ou miaou__delete_memory (tombstone réversible).\n\n" +
  "Le contenu stocké est toujours à la 3e personne, factuel, sans interprétation.\n" +
  "Ne déclenche PAS pour une instruction valable seulement pour la réponse en cours.";

// Prompt racine — constante build-time, non modifiable depuis les paramètres.
// Compose les deux doctrines ; référencé par buildSystemMessage() (main.js).
// v1 — une modification ici invalide le préfixe KV cache sur toutes les conversations.
const ROOT_SYSTEM_PROMPT = BINARY_DOCTRINE + "\n\n---\n\n" + MEMORY_DOCTRINE;

// Doctrine de traçage des intentions (traces en langage naturel). Injectée
// conditionnellement dans buildSystemMessage() selon le toggle intentTracing.
const INTENT_DOCTRINE =
  "Pour chaque appel d'outil, inclus miaou_intent dans les ARGUMENTS de l'appel (jamais dans le nom de l'outil). " +
  "Sa valeur est une courte phrase décrivant le but de l'action à l'utilisateur — " +
  "pas une paraphrase du nom technique, mais l'intention concrète. " +
  "Exemples : « Récupération de la météo à Paris », « Enregistrement de la préférence de langue », " +
  "« Liste des conversations de la semaine passée ». Nom d'action sans point final, sans guillemets supplémentaires.";

// File d'attente des acks côté client : chaque handler d'outil (écriture mémoire
// OU lecture d'historique) y pousse un descripteur portant son `kind` ; main.js la
// consomme dans onFinal pour injecter les messages 'tool-ack' dans le thread
// (jamais envoyés au modèle). Les returns model-facing restent inchangés.
let _pendingToolAcks = [];
function getPendingToolAcks() { return _pendingToolAcks.slice(); }
function clearPendingToolAcks() { _pendingToolAcks = []; }
// Enrichit le dernier ack en attente (outils internes synchrones). Les outils
// distants (asynchrones) voient leur ack déjà drainé dans earlyRendered ; leur
// enrichissement est fait directement par le hook onEnrichLastAck dans main.js.
function updateLastPendingToolAck(fields) {
  if (_pendingToolAcks.length) Object.assign(_pendingToolAcks[_pendingToolAcks.length - 1], fields);
}

// File des blocs NON-text renvoyés par un outil distant (image / resource /
// binaire). Vidée par le hook UI au même moment que les acks (après l'exécution
// des outils d'un tour) et rendue dans la bulle assistant courante via la cascade
// D8 — purement éphémère, RIEN n'est persisté (cf. brief D8, persistance des
// pièces jointes explicitement reportée). Les blocs `text` ne passent JAMAIS par
// ici : ils sont aplatis pour le modèle (flattenToolResult), pas affichés.
let _pendingToolBlocks = [];
function getPendingToolBlocks() { return _pendingToolBlocks.slice(); }
function clearPendingToolBlocks() { _pendingToolBlocks = []; }
// Filtre in-place _pendingToolBlocks (appelé par internResourcesFromResult pour
// retirer les blocs D8 dont le stockage IDB prend le relais).
function retainPendingToolBlocks(keepFn) { _pendingToolBlocks = _pendingToolBlocks.filter(keepFn); }

// ── Registre MCP interne ─────────────────────────────────────────────────────
// Forme canonique : { name, description, inputSchema (JSON Schema), annotations,
// handler }. ask_confirmation est exclu (primitif halting, voir ASK_CONFIRMATION_DEF).
const TOOLS = [
  {
    name: 'get_conversation',
    description:
      "Récupère une conversation passée par son identifiant. Par défaut " +
      "(with_contents=false), retourne seulement son résumé et ses mots-clés ; " +
      "passer with_contents=true pour obtenir le contenu complet des messages.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant de la conversation' },
        with_contents: { type: 'boolean', description: 'Inclure le contenu complet (défaut false)' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const entry = getSummaryEntry(args.id);   // storage.js
      if (!entry || entry.suppressed) return 'Conversation introuvable ou souvenir supprimé.';
      const light = summaryLight(entry);
      _pendingToolAcks.push({ kind: 'conversation_read', title: light.title });
      if (!args.with_contents) return JSON.stringify(light);
      const conv = loadConversation(args.id);   // storage.js
      if (!conv) return JSON.stringify(light);   // résumé présent mais conversation absente : cas limite
      return JSON.stringify(Object.assign({}, light, { messages: conv.messages ?? conv }));
    },
  },
  {
    name: 'list_conversations',
    description:
      "Liste les conversations passées (résumé + mots-clés par défaut). " +
      "Le paramètre since est OPTIONNEL : l'omettre liste TOUTES les " +
      "conversations — appelle l'outil sans hésiter même sans date en tête ; " +
      "le préciser (date ISO 8601) limite aux conversations actives depuis " +
      "cette date. Passer with_contents=true pour inclure aussi le contenu " +
      "complet de chacune (potentiellement volumineux).",
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'Optionnel — date ISO 8601. Omettre pour tout lister.' },
        with_contents: { type: 'boolean', description: 'Inclure le contenu complet (défaut false)' },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      let entries = listSummaryEntries();        // storage.js — entrées non-tombstone
      if (args.since != null && args.since !== '') {
        const sinceMs = Date.parse(args.since);
        if (Number.isNaN(sinceMs)) return 'Date "since" invalide (attendu ISO 8601).';
        entries = entries.filter(e => (e.timestamp || 0) >= sinceMs);
      }
      const light = entries.map(summaryLight);
      _pendingToolAcks.push({ kind: 'conversation_list', count: light.length });
      if (!args.with_contents) return JSON.stringify(light);
      return JSON.stringify(light.map(e => {
        const conv = loadConversation(e.id);
        return conv ? Object.assign({}, e, { messages: conv.messages ?? conv }) : e;
      }));
    },
  },
  {
    name: 'create_memory',
    description:
      "Enregistre immédiatement un nouveau souvenir persistant. Utiliser sur le " +
      "CHEMIN DIRECT uniquement (instruction explicite de l'utilisateur). Voir doctrine mémoire.",
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Contenu du souvenir (3e personne, factuel)' },
      },
      required: ['content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    handler: (args) => {
      if (!args.content || !args.content.trim()) return 'Contenu vide — souvenir ignoré.';
      const id = genMemoryId();
      const now = Date.now();
      const content = args.content.trim();
      saveMemory({ id, content, created_at: now, updated_at: now, suppressed: false });
      _pendingToolAcks.push({ kind: 'memory_create', id, content });
      return 'Souvenir enregistré. Identifiant : ' + id;
    },
  },
  {
    name: 'update_memory',
    description:
      "Corrige un souvenir existant en place (pas de tombstone). Utiliser quand " +
      "un fait enregistré est devenu inexact ou doit être précisé. Voir doctrine mémoire.",
    inputSchema: {
      type: 'object',
      properties: {
        id:      { type: 'string', description: 'Identifiant du souvenir à corriger' },
        content: { type: 'string', description: 'Nouveau contenu (3e personne, factuel)' },
      },
      required: ['id', 'content'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    handler: (args) => {
      if (!args.id || !args.content || !args.content.trim()) return 'Paramètres invalides.';
      const content = args.content.trim();
      const existing = loadMemories().find(e => e.id === args.id);   // avant écrasement
      editMemory(args.id, content);
      _pendingToolAcks.push({
        kind: 'memory_update',
        id: args.id,
        content,
        prevContent: existing ? existing.content : null,
      });
      return 'Souvenir mis à jour.';
    },
  },
  {
    name: 'present_resource',
    description:
      "Présente une ressource stockée (image, texte, fichier binaire) à l'utilisateur " +
      "en l'affichant dans le thread. Utiliser l'identifiant renvoyé lors du stockage de " +
      "la ressource (commence par res_). Pour une image, elle s'affiche inline ; pour un " +
      "texte/JSON, un bloc de code surligné ; pour un binaire, un bouton de téléchargement.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant de la ressource (res_…)' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false },
    handler: (args) => {
      const id = String(args.id || '');
      if (!id) return 'Identifiant manquant.';
      // getCachedRecord et makeResourcePresentBlock sont dans resources.js (chargé avant).
      const record = getCachedRecord(id);
      if (!record) return 'Ressource introuvable (identifiant inconnu ou non disponible en session).';
      // Le rendu du bloc est délégué à placeToolAck (live et reload via même chemin).
      _pendingToolAcks.push({ kind: 'resource_presented', id, resourceName: record.name, mime: record.mime });
      return 'Ressource présentée à l\'utilisateur.';
    },
  },
  {
    name: 'delete_memory',
    description:
      "Supprime un souvenir (tombstone réversible depuis l'interface). Utiliser " +
      "quand un fait enregistré n'est plus pertinent. Voir doctrine mémoire.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant du souvenir à supprimer' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
    handler: (args) => {
      if (!args.id) return 'Identifiant manquant.';
      const existing = loadMemories().find(e => e.id === args.id);
      suppressMemory(args.id);
      _pendingToolAcks.push({ kind: 'memory_delete', id: args.id, content: existing ? existing.content : null });
      return 'Souvenir supprimé (réversible depuis les paramètres).';
    },
  },
];

// ── ask_confirmation : primitif halting hors registre MCP ────────────────────
// Outil HALTING : runConversation (api.js) l'intercepte AVANT le dispatch et
// arrête l'échange — il ne pousse aucun message tool_calls/tool natif, ne
// relance pas. La reprise se fait au tour suivant via la réponse de l'utilisateur
// (« Oui »/« Non » ou correction libre) réécrite en texte clair (fork B).
// Il n'est PAS dans le registre TOOLS (pas de callTool) mais est inclus dans
// toolDefinitions() pour que le modèle puisse l'appeler.
const ASK_CONFIRMATION_DEF = {
  type: 'function',
  function: {
    name: 'ask_confirmation',
    description:
      "Demande confirmation à l'utilisateur avant d'agir, lorsque tu as INFÉRÉ " +
      "une intention durable qu'il n'a PAS explicitement demandé d'enregistrer. " +
      "La question doit inclure littéralement le contenu concerné, formulée ainsi : " +
      "« Tu veux que je retienne : « … » ? ». Outil bloquant : la génération " +
      "s'arrête après l'appel et la question est posée à l'utilisateur ; tu " +
      "reprendras au tour suivant selon sa réponse. N'enregistre jamais sans cette " +
      "confirmation, et n'affirme jamais avoir enregistré quoi que ce soit ici.",
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question fermée à poser, contenu inclus littéralement' },
      },
      required: ['question'],
    },
  },
};

// ── Agrégation distante : cache de session + client MCP ──────────────────────
// MIAOU est un client/agrégateur MCP (cf. brief V2) : il fusionne ses outils
// internes et ceux de N serveurs distants en UN seul registre, invisible au
// modèle. État en mémoire UNIQUEMENT (jamais persisté), reconstruit au démarrage
// par connectMcpServer pour chaque serveur activé (cf. main.js init).
const MCP_PROTOCOL_VERSION = '2025-06-18';

let _remoteTools = {};   // { servername: [ { name:'servername__x', description, inputSchema }, … ] }
let _remoteStatus = {};  // { servername: { state:'connecting'|'ok'|'error', count, error?, sessionId? } }

function getMcpStatus(name) { return _remoteStatus[name] || null; }

// Outils distants exposables : déjà préfixés `servername__` et filtrés (D7).
function remoteToolDefs() {
  const out = [];
  for (const name of Object.keys(_remoteTools)) {
    for (const t of _remoteTools[name]) out.push(t);
  }
  return out;
}

// Registre EXPOSÉ au modèle (forme canonique MCP) : outils internes préfixés
// `miaou__` + outils distants (déjà préfixés). Le préfixe interne est ajouté ICI,
// à l'exposition seulement — TOOLS reste stocké en noms NUS (le préfixe est une
// vue, pas un stockage). ask_confirmation reste HORS de ce registre (halting).
function exposedTools() {
  const internal = TOOLS.map(t => ({
    name: 'miaou__' + t.name, description: t.description, inputSchema: t.inputSchema,
  }));
  return internal.concat(remoteToolDefs());
}

// ── Client JSON-RPC 2.0 sur transport streamable-http (cf. D4/D10) ───────────
let _mcpRpcId = 0;

// UNE tentative d'appel JSON-RPC (un seul POST ; réponse JSON OU flux SSE). Timeout
// via AbortController (cf. D5). Lève sur erreur ; sur HTTP 404 ALORS qu'on détenait
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
// dégradation gracieuse D10 prend le relais côté appelant. On ne re-sonde JAMAIS la
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

// Handshake d'activation (cf. D10) : initialize → notification initialized →
// tools/list ; préfixe, filtre (D7), met en cache. DÉGRADE GRACIEUSEMENT : tout
// échec marque le serveur en erreur et n'expose AUCUN de ses outils, sans jamais
// lever vers l'appelant — un mauvais backend ne gèle jamais MIAOU.
async function connectMcpServer(server) {
  const s = server;
  _remoteStatus[s.name] = { state: 'connecting', count: 0, sessionId: null };
  delete _remoteTools[s.name];
  try {
    await mcpRpc(s, 'initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'miaou', version: '2' },
    });
    try { await mcpRpc(s, 'notifications/initialized', undefined, { notify: true }); } catch (_) {}
    const listed = await mcpRpc(s, 'tools/list', {});
    const tools = (listed && Array.isArray(listed.tools)) ? listed.tools : [];
    const filtered = filterMcpTools(tools, s.toolAllowlist, s.toolDenylist);
    _remoteTools[s.name] = filtered.map(t => ({
      name: s.name + '__' + t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
    _remoteStatus[s.name] = Object.assign(_remoteStatus[s.name] || {}, {
      state: 'ok', count: _remoteTools[s.name].length, error: null,
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

// Route un appel vers un serveur distant : tools/call → { content, isError }.
// Pousse les blocs NON-text dans _pendingToolBlocks (rendu UI éphémère D8). Le
// retour conserve TOUS les blocs ; flattenToolResult ne gardera que le text pour
// le modèle (D9). Échec/timeout → résultat isError textuel, jamais de throw.
// L'ack mcp_call est poussé dans _pendingToolAcks de manière SYNCHRONE, avant le
// premier await, pour permettre le rendu pendant le round-trip (cf. onEarlyAcks).
// `intent` : description en langage naturel extraite de miaou_intent par callTool
// (déjà strippée des args envoyés au serveur). Stockée dans l'ack pour l'UI.
async function callRemoteTool(server, toolName, args, intent) {
  const fullName = server.name + '__' + toolName;
  const ackEntry = { kind: 'mcp_call', server: server.name, name: fullName };
  if (intent != null) ackEntry.intent = intent;
  _pendingToolAcks.push(ackEntry);   // synchrone — avant tout await

  try {
    const result = await mcpRpc(server, 'tools/call', { name: toolName, arguments: args || {} });
    const content = (result && Array.isArray(result.content)) ? result.content : [];
    const nonText = content.filter(b => b && b.type !== 'text');
    if (nonText.length) _pendingToolBlocks.push.apply(_pendingToolBlocks, nonText);
    if (result && result.isError) ackEntry.error = true;
    return { content, isError: !!(result && result.isError) };
  } catch (e) {
    ackEntry.error = true;
    return { content: [{ type: 'text', text: 'Erreur outil distant ' + fullName + ' : ' + ((e && e.message) || e) }], isError: true };
  }
}

// ── Dispatcher MCP ───────────────────────────────────────────────────────────
// Dispatch interne synchrone (outils miaou, noms NUS). Cœur unit-testé.
function callInternalTool(toolName, args) {
  const tool = TOOLS.find(t => t.name === toolName);
  if (!tool) return { content: [{ type: 'text', text: 'Outil inconnu : ' + toolName }], isError: true };
  try {
    const text = tool.handler(args || {});
    return { content: [{ type: 'text', text: String(text) }], isError: false };
  } catch (e) {
    return { content: [{ type: 'text', text: 'Erreur outil ' + toolName + ' : ' + e.message }], isError: true };
  }
}

// Point d'entrée unique de dispatch (cf. brief D1). Splitte le nom canonique sur
// le PREMIER `__` : préfixe `miaou` (ou absent) → dispatch interne SYNCHRONE ;
// sinon → serveur distant activé portant ce nom → appel ASYNCHRONE (fetch).
// Préfixe inconnu / serveur désactivé → erreur propre. Résultat :
// { content:[...blocks], isError }. ask_confirmation n'atteint jamais ici
// (interception halting en amont dans api.js).
// Type de retour MIXTE assumé : objet (interne/erreur) OU Promise (distant) — les
// appelants font `await callTool(...)`, et `await` sur un objet le renvoie tel
// quel. Cela garde les branches interne/erreur synchrones, donc testables sans
// async (le runner QuickJS n'attend pas les promesses).
// miaou_intent est strippé des args avant tout dispatch : les handlers internes
// et serveurs MCP ne doivent jamais le recevoir. Pour les outils distants, l'intent
// est passé à callRemoteTool pour être stocké dans l'ack. Les args originaux
// (avec miaou_intent) restent dans l'objet référencé par api.js → stockés dans
// entry.args via onEnrichLastAck → réinjectés tels quels aux tours suivants.
function callTool(name, args) {
  const parsed = parseToolName(name);
  if (parsed.serverPrefix === 'miaou' || parsed.serverPrefix === '') {
    const cleanArgs = args ? Object.assign({}, args) : {};
    delete cleanArgs.miaou_intent;
    return callInternalTool(parsed.toolName, cleanArgs);
  }
  const server = getMcpServer(parsed.serverPrefix);   // storage.js
  if (!server || server.enabled === false) {
    return { content: [{ type: 'text', text: 'Serveur MCP inconnu ou désactivé : ' + parsed.serverPrefix }], isError: true };
  }
  const intent = args && typeof args.miaou_intent === 'string' ? args.miaou_intent : undefined;
  const serverArgs = args ? Object.assign({}, args) : {};
  delete serverArgs.miaou_intent;
  return callRemoteTool(server, parsed.toolName, serverArgs, intent);
}

// Aplatit un résultat MCP en string pour le message role:'tool' renvoyé au modèle.
// Blocs `text` → passés tels quels. Blocs `resource` avec `resource.text` → passés
// tels quels (JSON ou texte structuré renvoyé par le serveur, utile au LLM).
// Blocs non-text sans contenu textuel (image, audio, resource binaire) → MARQUEUR
// NEUTRE (jamais le base64). Cf. D8 : ces blocs sont rendus par l'UI ; le marqueur
// évite qu'un résultat image/resource-only laisse un message `tool` vide, ce qui
// pousserait le modèle à simuler/encoder le contenu. Fonction pure, unit-testable.
function flattenToolResult(result) {
  if (!result || !Array.isArray(result.content)) return '';
  return result.content.map(b => {
    if (b.type === 'text') return b.text;
    if (b.type === 'image')    return '[image rendue dans l\'interface]';
    if (b.type === 'resource') return b.resource && b.resource.text != null ? b.resource.text : '[ressource rendue dans l\'interface]';
    if (b.type === 'audio')    return '[audio rendu dans l\'interface]';
    return '[contenu rendu dans l\'interface]';
  }).filter(s => s != null && s !== '').join('\n');
}

// Indique si un outil est « halting » (seul ask_confirmation l'est, et il reste
// NU — hors registre, donc non préfixé).
function toolIsHalting(name) { return name === 'ask_confirmation'; }

// Dérive le tableau OpenAI tools depuis le registre EXPOSÉ (interne préfixé +
// distant) + ASK_CONFIRMATION_DEF. Les noms d'outils internes y sont désormais
// `miaou__*` : V2 rompt délibérément le byte-identical de V1 (le préfixe sert à
// router interne vs distant sans cas particulier).
// Si intentTracing est activé, `miaou_intent` est ajouté au schema de chaque
// outil (hors ask_confirmation) pour que le modèle décrive son intention.
// Nom sans underscore initial : évite les traitements spéciaux des parsers de
// grammar (Ollama/llama.cpp) qui peuvent interpréter `_xxx` comme un champ privé.
function toolDefinitions() {
  const intentEnabled = !!loadSettings().intentTracing;
  const intentProp = { type: 'string', title: 'Intention', description: 'Phrase courte décrivant le but de l\'appel, pour l\'utilisateur.' };
  const mcpDefs = exposedTools().map(t => {
    const params = intentEnabled
      ? Object.assign({}, t.inputSchema, {
          properties: Object.assign({}, t.inputSchema.properties || {}, { miaou_intent: intentProp }),
        })
      : t.inputSchema;
    return { type: 'function', function: { name: t.name, description: t.description, parameters: params } };
  });
  return mcpDefs.concat([ASK_CONFIRMATION_DEF]);
}

// MEMORY_DOCTRINE n'est PAS redondante avec le schéma tools (qui ne décrit que
// les paramètres, jamais la doctrine de déclenchement). Elle doit donc être
// envoyée indépendamment du toggle includeToolsInSystemPrompt, qui ne contrôle
// que la description redondante schéma/texte des outils eux-mêmes.

function toolsSystemPrompt() {
  const all = exposedTools().map(t => ({ name: t.name, description: t.description }))
    .concat([{ name: ASK_CONFIRMATION_DEF.function.name, description: ASK_CONFIRMATION_DEF.function.description }]);
  if (!all.length) return '';
  const lines = all.map(t => '- ' + t.name + ' : ' + t.description);
  return "Tu disposes des outils suivants. Appelle-les quand ils peuvent t'aider à mieux répondre, " +
         "sinon réponds directement.\n" + lines.join('\n');
}

// Doctrine COMPORTEMENTALE des outils (transverse, courte, statique) — TOUJOURS
// injectée quand des outils existent, indépendamment de includeToolsInSystemPrompt.
// Distincte de toolsSystemPrompt() (l'énumération token-coûteuse, elle sous toggle) :
// « comment tu te comportes face à un résultat d'outil » est vrai que les outils
// soient ré-décrits dans le prompt ou non — coupler ça au toggle d'énumération
// serait un artefact (le toggle ne gouverne que la description redondante). En
// particulier en mode nothink/agentique (toggle off, outils passés via le champ API
// `tools`), c'est le seul rempart côté formulation contre la narration/simulation
// d'une image. Le marqueur neutre de flattenToolResult coupe l'autre vecteur (le
// base64 n'atteint jamais le modèle) ; les deux couvrent des échecs DIFFÉRENTS.
function toolsDoctrinePrompt() { return BINARY_DOCTRINE; }

function memoryDoctrinePrompt() {
  const hasMemoryTools = TOOLS.some(t => t.name === 'create_memory');
  return hasMemoryTools ? MEMORY_DOCTRINE : '';
}

function intentDoctrinePrompt() {
  return TOOLS.length && loadSettings().intentTracing ? INTENT_DOCTRINE : '';
}
