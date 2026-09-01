/* ── storage.js ────────────────────────────────────────────────────────────
   Persistance localStorage : réglages, serveurs API (+ serveur actif),
   serveurs MCP, historique des conversations, index des résumés (tombstones
   réversibles), souvenirs utilisateur. Schéma détaillé : docs/storage.md.
   ────────────────────────────────────────────────────────────────────────── */

const SETTINGS_KEY  = 'miaou-settings';
const CONV_KEY      = 'miaou-conversations';
const SUMMARIES_KEY = 'miaou-summaries';
const SPACES_KEY        = 'miaou-spaces';
const ACTIVE_SPACE_KEY  = 'miaou-active-space';
const DEFAULT_SPACE_ID  = 'default';

// Config injectée au build : un seul marqueur (le jeton en position de valeur
// ligne suivante), l'objet config.json entier (build.py le sérialise en JSON,
// qui est un littéral objet JS valide). Forme tolérante via try : si le marqueur
// n'a pas été remplacé (sources non buildées, ex. tests QuickJS), c'est un
// identifiant nu → ReferenceError attrapée → {} → les défauts ci-dessous.
// Marqueur à occurrence unique, en position de valeur, pour ne pas être
// substitué deux fois (ne jamais réécrire son nom littéral en commentaire : le
// .replace de build.py est global). Toutes les valeurs
// dérivées sont déclarées ici (même fichier) : un `const` ne franchit pas les
// frontières de fichier dans le test runner, on ne les référence ailleurs qu'en
// corps de fonction. cf. CLAUDE.md « Pipeline de build ».
const BUILD_CONFIG = (function () { try { return __MIAOU_CONFIG__; } catch (e) { return {}; } })();

const REQUIRE_API_KEY = BUILD_CONFIG.require_api_key !== false;   // défaut true (sécurisé)
const MAX_SUMMARIES   = (typeof BUILD_CONFIG.max_summaries === 'number') ? BUILD_CONFIG.max_summaries : 3;
const BUILD_API_URL   = BUILD_CONFIG.api_url   || '';
const BUILD_API_MODEL = BUILD_CONFIG.api_model || '';
const BUILD_TS        = BUILD_CONFIG.build_ts  || 0;   // epoch Unix (s), 0 si sources non buildées
// Bornes d'agents (lot X-1, Q3). Deux bornes, pas une — un refus doit pouvoir
// NOMMER laquelle est atteinte : « 3 agents déjà sur cette conversation » et
// « 5 agents au total » appellent des gestes différents du parent (attendre l'un
// des siens, ou constater que la machine est saturée). Motif exact de
// MAX_SUMMARIES ci-dessus : valeur en l'absence de clé de config, surchargeable
// par config.json (les clés sont documentées dans config.sample.json et au
// README). BUILD_CONFIG étant injecté DANS ce fichier, elles y vivent — et
// agents.js/tools.js ne les référencent qu'en corps de fonction (contrainte
// structurelle dure : un const ne franchit pas la frontière dans le test runner).
const MAX_AGENTS_PER_CONV = (typeof BUILD_CONFIG.max_agents_per_conv === 'number') ? BUILD_CONFIG.max_agents_per_conv : 3;
const MAX_AGENTS_TOTAL    = (typeof BUILD_CONFIG.max_agents_total    === 'number') ? BUILD_CONFIG.max_agents_total    : 5;
// Borne de TOURS d'un agent (décision 9) : une borne sur les échanges enchaînés,
// pas un budget de tokens — le problème est le temps et l'agent zombie qui tient
// un slot, pas le coût. Atteinte → arrêt d'office, statut `exhausted`, et le
// résultat PARTIEL est quand même délivré au parent (avec la mention explicite).
const MAX_AGENT_TURNS     = (typeof BUILD_CONFIG.max_agent_turns     === 'number') ? BUILD_CONFIG.max_agent_turns     : 12;
// URL du dépôt, liée sur le mot « MIAOU » du footer des exports HTML. Trois
// états DISTINCTS, d'où le typeof plutôt qu'un `||` : clé absente ou null →
// dépôt public par défaut ; chaîne vide → pas de lien du tout (le mot reste du
// texte, cas d'un fork interne qu'on ne veut pas exposer) ; chaîne non vide →
// lien vers cette URL. Lue en corps de fonction seulement (portée inter-fichier,
// cf. CLAUDE.md).
const DEFAULT_REPO_URL = 'https://github.com/dJeyL/miaou';
const BUILD_REPO_URL   = (typeof BUILD_CONFIG.repo_url === 'string') ? BUILD_CONFIG.repo_url : DEFAULT_REPO_URL;
// Température des envois de chat (streamCompletion uniquement — les appels
// silencieux gardent la valeur explicite de leur site d'appel). Le typeof
// rejette une clé absente, une chaîne ou null : tous retombent sur 0.7 plutôt
// que d'envoyer une valeur invalide à l'endpoint.
const BUILD_CHAT_TEMPERATURE = (typeof BUILD_CONFIG.chat_temperature === 'number') ? BUILD_CONFIG.chat_temperature : 0.7;
// Fenêtre de contexte par défaut (tokens) si l'utilisateur n'a rien saisi dans
// les réglages (`contextWindow` reste '' — cf. DEFAULT_SETTINGS ci-dessous) :
// permet de fournir une valeur d'installation sans forcer chaque utilisateur à
// la ressaisir (brief B, D5 complété). 0 = pas de défaut de build (comportement
// v1 inchangé, `contextWindowFor` renvoie null).
const BUILD_DEFAULT_CONTEXT_WINDOW =
  (typeof BUILD_CONFIG.default_context_window === 'number') ? BUILD_CONFIG.default_context_window : 0;

const DEFAULT_SETTINGS = {
  url: '',
  key: '',
  model: '',
  systemPrompt: '',
  highlight: true,
  summaryInjectionMode: 'propose',   // 'auto' | 'propose' | 'never'
  theme: 'system',         // 'light' | 'dark' | 'system'
  palette: 'ambre',        // 'ambre' | 'encre' | 'foret' (axe orthogonal au thème, lot S-a)
  fonts: 'graphite',      // 'graphite' | 'atelier' | 'chaleur' (lot de fontes, lot S-b)
  showModelSelector: false, // sélecteur serveur/modèle dans le composer
  sidebarWidth: 264,       // largeur de la sidebar (px), redimensionnable 264 → 528
  intentTracing: true,      // demander au modèle de décrire ses appels d'outils en langage naturel
  contextWindow: '', // taille de fenêtre de contexte (tokens), global, '' = inconnu (brief B, D5/B1-a)
  describeFiles: true, // description auto des fichiers de bibliothèque d'espace à l'ingestion (D7, lot Cbis)
  exportInteractive: true, // export HTML : inclure le <script> copier/télécharger sur les blocs de code (D1 révisé, brief G)
  motion: 'system', // animations UI : 'normal' | 'reduced' | 'system' (brief N, ticker d'acks)
};

// ── Réglages ────────────────────────────────────────────────────────────────

function loadSettingsRaw() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
  catch (e) { return {}; }
}

function loadSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS, loadSettingsRaw());
  // Défauts de build seulement si l'utilisateur n'a rien saisi.
  if (!s.url   && BUILD_API_URL)   s.url   = BUILD_API_URL;
  if (!s.model && BUILD_API_MODEL) s.model = BUILD_API_MODEL;
  return s;
}

function saveSettings(obj) {
  const next = Object.assign({}, loadSettingsRaw(), obj || {});
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  // Broadcast post-commit (piège 24 ; setItem synchrone donc déjà durable) : les
  // pairs relisent+ré-appliquent les clés modifiées (thème, modèle, sélecteurs…).
  syncPost('settings-updated', { keys: Object.keys(obj || {}) });
  return next;
}

// Accesseur isolé (brief B, D5) : champ global unique en v1 (`model` ignoré),
// signature prête pour une future map (serveur, modèle) sans toucher les
// call-sites. `null`/vide = inconnu.
function contextWindowFor(model) {
  const v = loadSettings().contextWindow;
  const n = parseInt(v, 10);
  if (Number.isFinite(n) && n > 0) return n;
  return BUILD_DEFAULT_CONTEXT_WINDOW > 0 ? BUILD_DEFAULT_CONTEXT_WINDOW : null;
}

// ── Serveurs API (multi-backends) ────────────────────────────────────────────
// Remplace les champs plats url/key/model de miaou-settings. Tableau d'objets :
//   { id, name, url, key, model }
// `id` (pas `name`) est la clé d'identité : contrairement aux serveurs MCP, on
// veut pouvoir renommer une carte sans perdre la référence "actif" persistée
// séparément. Le token est stocké EN CLAIR, même posture assumée qu'en D6 (MCP).
const API_SERVERS_KEY = 'miaou-api-servers';
const ACTIVE_API_SERVER_KEY = 'miaou-active-api-server';

function genApiServerId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Transformation silencieuse : si aucun tableau de serveurs n'a jamais été
// écrit et qu'une config url/key/model plate existe (localStorage ou défauts
// de build via loadSettings()), crée un unique serveur "Par défaut" et
// l'active. Ne s'exécute qu'une fois : la simple présence de la clé
// miaou-api-servers (même tableau vide, si tout a été supprimé depuis) la
// court-circuite pour toujours.
function migrateApiServersIfNeeded() {
  if (localStorage.getItem(API_SERVERS_KEY) !== null) return;
  const s = loadSettings();
  if (!s.url) { saveApiServersRaw([]); return; }
  const server = normalizeApiServer({ name: 'Par défaut', url: s.url, key: s.key, model: s.model });
  saveApiServersRaw([server]);
  localStorage.setItem(ACTIVE_API_SERVER_KEY, server.id);
}

function saveApiServersRaw(arr) {
  localStorage.setItem(API_SERVERS_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
  syncPost('settings-updated', { keys: ['api-servers'] });   // post-commit (piège 24)
  return arr;
}

function loadApiServers() {
  migrateApiServersIfNeeded();
  try {
    const arr = JSON.parse(localStorage.getItem(API_SERVERS_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveApiServers(arr) {
  return saveApiServersRaw(arr);
}

function normalizeApiServer(s) {
  const o = s || {};
  // `vision` : map { [nomModèle]: false } — flag MANUEL D5 (brief A2). Seule la
  // valeur `false` est signifiante (« ce modèle sur ce serveur n'a pas la
  // vision » — mitigation du silent-failure Ollama F1, aucun 400 renvoyé).
  // Absence d'entrée = inconnu = on envoie les parts image (comportement par
  // défaut). Distinct du cache SESSION _visionRejected (api.js, réactif sur 400,
  // non persisté) : ici c'est un réglage utilisateur persisté. On ne conserve
  // que les entrées explicitement `false` (une entrée `true` équivaut à absente).
  const vision = {};
  if (o.vision && typeof o.vision === 'object') {
    for (const k in o.vision) { if (o.vision[k] === false) vision[k] = false; }
  }
  return {
    id: o.id || genApiServerId(),
    name: String(o.name || '').trim(),
    url: String(o.url || '').trim(),
    key: o.key ? String(o.key) : '',
    model: String(o.model || '').trim(),
    // `disabled` (défaut false) : serveur mis de côté. Il n'est plus interrogé
    // pour peupler le sélecteur serveur/modèle du composer, et n'est plus
    // éligible comme repli d'`activeApiServer()`. Il reste sélectionnable
    // explicitement depuis sa carte (« Utiliser ce serveur ») — sinon on ne
    // pourrait plus le réactiver.
    disabled: o.disabled === true,
    vision,
  };
}

// Serveurs candidats à la découverte de modèles (sélecteur composer) : tous les
// serveurs non désactivés ayant une URL. Prédicat unique, à réutiliser partout
// plutôt que de réécrire un filtre `!s.disabled` local.
function listSelectableApiServers() {
  return loadApiServers().filter(s => !s.disabled && (s.url || '').trim());
}

// Flag vision manuel (D5) pour un couple (serveur, modèle). Pur, testable.
// Retourne `false` SEULEMENT si l'utilisateur a explicitement marqué ce modèle
// sans vision sur ce serveur ; sinon `true` (défaut : on envoie les images).
// N.B. « true » ici = « envoyer les parts », pas « vision confirmée » : l'état
// inconnu et l'état vision-capable sont traités pareil (le brief : unknown =
// send anyway). Seul `false` déclenche la dégradation proactive.
function serverModelVisionEnabled(server, model) {
  if (!server || !server.vision) return true;
  return server.vision[String(model || '')] !== false;
}

// Insère ou remplace un serveur par `id` (clé d'identité). Retourne le tableau.
function upsertApiServer(server) {
  const next = normalizeApiServer(server);
  const arr = loadApiServers();
  const i = arr.findIndex(s => s.id === next.id);
  if (i >= 0) arr[i] = next; else arr.push(next);
  saveApiServers(arr);
  return arr;
}

function deleteApiServer(id) {
  const arr = loadApiServers().filter(s => s.id !== id);
  saveApiServers(arr);
  return arr;
}

function getApiServer(id) {
  return loadApiServers().find(s => s.id === id) || null;
}

function getActiveApiServerId() {
  return localStorage.getItem(ACTIVE_API_SERVER_KEY) || '';
}

function setActiveApiServerId(id) {
  localStorage.setItem(ACTIVE_API_SERVER_KEY, id || '');
  syncPost('settings-updated', { keys: ['active-api-server'] });   // post-commit (piège 24)
}

// Serveur actif effectif : l'id persisté s'il pointe encore sur un serveur
// existant, sinon le premier du tableau (jamais d'état "configuré=true sans
// serveur" tant qu'au moins une carte existe), sinon null.
function activeApiServer() {
  const servers = loadApiServers();
  if (!servers.length) return null;
  const byId = getApiServer(getActiveApiServerId());
  // Le repli ignore les serveurs désactivés ; un serveur désactivé EXPLICITEMENT
  // actif (via sa carte) reste actif — le flag exclut de la découverte et du
  // repli automatique, jamais d'un choix délibéré de l'utilisateur.
  return byId || servers.find(s => !s.disabled) || servers[0];
}

// Config url/key/model résolue pour les appels API (api.js). Seule source
// légitime depuis la migration — loadSettings().url/.key/.model restent en
// lecture pour la migration elle-même et comme filet historique (serveur sans
// modèle par défaut), jamais réécrits ailleurs. Le modèle DOIT venir d'ici et
// non de loadSettings() : sinon titrage/résumé (silentCompletion) enverraient
// le modèle legacy du serveur migré à l'endpoint du serveur actif.
function activeApiConfig() {
  const s = activeApiServer();
  return {
    url: (s && s.url) || '',
    key: (s && s.key) || '',
    model: (s && s.model) || loadSettings().model || '',
  };
}

// ── Serveurs MCP distants ─────────────────────────────────────────────────────
// Configuration des backends MCP délégués (cf. brief D3). Tableau d'objets :
//   { name, url, transport, enabled, authorization_token?, timeout,
//     toolAllowlist?, toolDenylist? }
// `name` est le préfixe d'outil (unique, charset contraint, `miaou` interdit).
// Le token est stocké EN CLAIR (posture assumée non-prod, cf. D6) : tout ce que
// JS peut lire, un XSS le peut ; un chiffrement client a besoin d'une clef
// client, donc ne protège pas le secret. Le correctif prod est un proxy
// (token côté serveur), hors périmètre V2.
const MCP_SERVERS_KEY = 'miaou-mcp-servers';

const MCP_DEFAULT_TIMEOUT = 30000;   // ms (cf. D3/D5) ; éditable par serveur

function loadMcpServers() {
  try {
    const arr = JSON.parse(localStorage.getItem(MCP_SERVERS_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveMcpServers(arr) {
  localStorage.setItem(MCP_SERVERS_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
  syncPost('settings-updated', { keys: ['mcp-servers'] });   // post-commit (piège 24)
  return arr;
}

// Normalise un serveur saisi : défauts de transport/timeout/enabled, filtres en
// tableaux de noms nus. Ne valide PAS le nom (cf. validateMcpServerName, utils).
function normalizeMcpServer(s) {
  const o = s || {};
  return {
    name: String(o.name || '').trim(),
    url: String(o.url || '').trim(),
    transport: o.transport === 'sse' ? 'sse' : 'streamable-http',
    enabled: o.enabled !== false,
    authorization_token: o.authorization_token ? String(o.authorization_token) : '',
    timeout: (typeof o.timeout === 'number' && o.timeout > 0) ? o.timeout : MCP_DEFAULT_TIMEOUT,
    toolAllowlist: Array.isArray(o.toolAllowlist) ? o.toolAllowlist : [],
    toolDenylist: Array.isArray(o.toolDenylist) ? o.toolDenylist : [],
  };
}

// Insère ou remplace un serveur par `name` (clé d'identité). Retourne le tableau.
function upsertMcpServer(server) {
  const next = normalizeMcpServer(server);
  const arr = loadMcpServers();
  const i = arr.findIndex(s => s.name === next.name);
  if (i >= 0) arr[i] = next; else arr.push(next);
  saveMcpServers(arr);
  return arr;
}

function deleteMcpServer(name) {
  const arr = loadMcpServers().filter(s => s.name !== name);
  saveMcpServers(arr);
  return arr;
}

function getMcpServer(name) {
  return loadMcpServers().find(s => s.name === name) || null;
}

function listEnabledMcpServers() {
  return loadMcpServers().filter(s => s.enabled !== false && s.url);
}

// ── Couche IDB conversations/résumés + cache RAM (lot U-1) ──────────────────
// localStorage saturait (~5-10 Mo) : `miaou-conversations` et `miaou-summaries`
// sont les deux seules clés qui grossissent sans borne. Elles vivent désormais
// dans la base IDB `miaou` (v4), aux côtés de `resources`/`skills`.
//
// L'API publique reste SYNCHRONE (~100 call-sites, dont le rendu, le chemin
// chaud du streaming et des handlers d'outils synchrones : propager `await`
// rouvrirait des fenêtres de réentrance dans du code qui n'en a pas). Elle est
// adossée à un cache RAM à deux étages ; seules les ÉCRITURES sont async.
//
// Étage 1 — métadonnées de TOUTES les conversations, permanent. Alimente tout
//   le rendu (renderConvList, palette, tri, spaceConvIds) : ces call-sites
//   restent synchrones et inchangés. Jamais `messages`.
// Étage 2 — `messages`, borné en LRU. Seules restent chaudes la conversation
//   affichée, les dernières ouvertes, et OBLIGATOIREMENT toute conversation
//   portant une génération en vol (piège 28 : `_activeGenerations` épingle ses
//   entrées, jamais évincées — sinon la génération perd ses messages sous les
//   pieds).
//
// Fenêtre assumée : entre la mutation du cache et `tx.oncomplete`, la RAM est
// en avance sur le disque ; un reload dans cet intervalle (quelques ms) perd la
// dernière écriture. C'est déjà le cas de facto pour les resources.

// Version du schéma de la base `miaou` — PARTAGÉE par les deux points
// d'ouverture (`openConvDB` ici, `openResourceDB` dans resources.js), puisque
// l'un ou l'autre peut ouvrir la base en premier. Une seule constante, jamais
// deux littéraux : `openResourceDB` était resté en `3` après le bump v4 du lot
// U-1, et demander une version INFÉRIEURE à celle de la base la fait rejeter
// (`VersionError`) — tout ce qui passe par lui (bibliothèque d'espace, skills
// système, pièces jointes) tombait en silence sur un historique déjà migré.
// Bumper le schéma = changer CE nombre, et ajouter le palier aux DEUX
// `onupgradeneeded`, qui doivent rester identiques.
const MIAOU_DB_VERSION = 4;
const CONV_MESSAGES_LRU_MAX = 12;

let _convDbPromise = null;

// Étage 1 : Map<id, meta> — meta = conversation SANS `messages`.
let _convMetaCache = new Map();
// Étage 2 : Map<id, messages> — ordre d'insertion = ordre LRU (Map le garantit).
let _convMessagesCache = new Map();
// Index des résumés, intégralement en RAM (taille bornée : une entrée courte
// par conversation, pas de contenu de messages).
let _summariesCache = {};
let _convCacheHydrated = false;

function openConvDB() {
  if (_convDbPromise) return _convDbPromise;
  _convDbPromise = new Promise(function(resolve, reject) {
    // v4 (lot U) : ajout des stores `conversations` et `summaries`. Comme les
    // paliers précédents, `onupgradeneeded` est idempotent (contains-check par
    // store/index) → chaque palier ne touche que ce qui manque.
    const req = indexedDB.open('miaou', MIAOU_DB_VERSION);
    req.onupgradeneeded = function(e) {
      const db = e.target.result;
      const tx = e.target.transaction;
      if (!db.objectStoreNames.contains('resources')) {
        const store = db.createObjectStore('resources', { keyPath: 'id' });
        store.createIndex('by_conversation', 'conversationId', { unique: false });
        store.createIndex('by_space', 'spaceId', { unique: false });
      } else if (e.oldVersion < 3) {
        const store = tx.objectStore('resources');
        if (!store.indexNames.contains('by_space')) {
          store.createIndex('by_space', 'spaceId', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains('skills')) {
        db.createObjectStore('skills', { keyPath: 'slug' });
      }
      if (!db.objectStoreNames.contains('conversations')) {
        const store = db.createObjectStore('conversations', { keyPath: 'id' });
        store.createIndex('by_space', 'spaceId', { unique: false });
      }
      if (!db.objectStoreNames.contains('summaries')) {
        db.createObjectStore('summaries', { keyPath: 'id' });
      }
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) {
      // Ne pas figer la promesse mémoïsée sur un échec (transitoire) : la
      // remettre à null pour qu'un appel ultérieur retente l'ouverture.
      _convDbPromise = null;
      reject(e.target.error);
    };
  });
  return _convDbPromise;
}

// Sépare une conversation en (métadonnées, messages). Pure, QuickJS-testable :
// c'est la forme de l'étage 1 qui porte l'invariant « jamais de messages en
// étage 1 ». Les champs listés sont exactement ceux que consomment
// listAllConversations, renderConvList, la palette, le tri et spaceConvIds.
function splitConvRecord(conv) {
  const meta = {};
  for (const k of Object.keys(conv)) {
    if (k === 'messages') continue;
    meta[k] = conv[k];
  }
  return { meta: meta, messages: Array.isArray(conv.messages) ? conv.messages : [] };
}

// Recompose une conversation complète depuis les deux étages. `messages` est
// toujours un tableau (jamais undefined) : les consommateurs le supposent.
function joinConvRecord(meta, messages) {
  return Object.assign({}, meta, { messages: Array.isArray(messages) ? messages : [] });
}

// Éviction LRU de l'étage 2. Une conversation portant une génération en vol est
// épinglée (piège 28) : `isConvPinnedInCache` est le SEUL prédicat d'épinglage.
function isConvPinnedInCache(id) {
  // _activeGenerations vit dans main.js (Map<convId, gen>) ; référencé ici en
  // corps de fonction uniquement (un const ne franchit pas les frontières de
  // fichier dans le test runner).
  try { return _activeGenerations.has(id); }
  catch (e) { return false; }
}

function touchConvMessages(id, messages) {
  // Ré-insertion = passage en queue de Map → position LRU la plus récente.
  _convMessagesCache.delete(id);
  _convMessagesCache.set(id, messages);
  evictConvMessages();
}

function evictConvMessages() {
  if (_convMessagesCache.size <= CONV_MESSAGES_LRU_MAX) return;
  for (const id of Array.from(_convMessagesCache.keys())) {
    if (_convMessagesCache.size <= CONV_MESSAGES_LRU_MAX) break;
    if (id === currentConvIdSafe()) continue;   // conversation affichée : jamais évincée
    if (isConvPinnedInCache(id)) continue;      // génération en vol (piège 28)
    _convMessagesCache.delete(id);
  }
}

// `currentConvId` vit dans main.js ; lecture défensive (tests QuickJS, boot).
function currentConvIdSafe() {
  try { return currentConvId; } catch (e) { return null; }
}

// Réinitialise les deux étages et l'index des résumés. Point d'entrée unique
// pour les tests (QuickJS n'a pas IndexedDB : le cache EST la source de vérité
// observable, cf. project_extract_pure_helper_over_idb_stub — on ne stube pas
// IDB, on repart d'un cache vide). Marque le cache comme hydraté : en test, il
// n'y a rien à charger.
function resetConvCacheForTests() {
  _convMetaCache = new Map();
  _convMessagesCache = new Map();
  _summariesCache = {};
  _summariesInFlight = new Map();   // sinon une écriture en vol fuit d'un cas de test au suivant
  _convCacheHydrated = true;
}

// Hydratation au boot : étage 1 (métadonnées de TOUTES les conversations) +
// index des résumés. `init()` l'attend avant le premier rendu, sinon la sidebar
// s'affiche vide puis se remplit. Les `messages` ne sont PAS chargés ici.
async function hydrateConvCache() {
  const db = await openConvDB();
  const [convs, summaries] = await Promise.all([
    new Promise(function(resolve, reject) {
      const tx = db.transaction('conversations', 'readonly');
      const req = tx.objectStore('conversations').getAll();
      req.onsuccess = function(e) { resolve(e.target.result || []); };
      tx.onerror = function(e) { reject(e.target.error); };
    }),
    new Promise(function(resolve, reject) {
      const tx = db.transaction('summaries', 'readonly');
      const req = tx.objectStore('summaries').getAll();
      req.onsuccess = function(e) { resolve(e.target.result || []); };
      tx.onerror = function(e) { reject(e.target.error); };
    })
  ]);
  _convMetaCache = new Map();
  for (const rec of convs) {
    const split = splitConvRecord(rec);
    _convMetaCache.set(rec.id, split.meta);
  }
  _summariesCache = {};
  for (const e of summaries) _summariesCache[e.id] = e;
  _convCacheHydrated = true;
}

// Charge les `messages` d'une conversation en étage 2 (appelé par
// openConversation avant de projeter le thread).
//
// **Relit IDB même si la conversation est déjà chaude.** La version U-1 sortait
// immédiatement dans ce cas — « en RAM » y valait « à jour », ce qui n'est vrai
// que dans un onglet seul. Avec deux onglets sur la même conversation, le cache
// du second ne se rafraîchissait JAMAIS : ni au broadcast, ni en sortant et
// revenant sur la conversation (le seul chemin de relecture, `warmConversation`,
// court-circuitait). L'onglet restait sur son instantané jusqu'au reload. Avant
// U-1 le problème n'existait pas : `loadConversation` lisait localStorage,
// partagé entre onglets.
//
// Coût : un `get` IDB par ouverture de conversation, sur un chemin déjà async et
// déjà en attente des ressources (`Promise.all` dans `openConversation`).
//
// **Exception, impérative** : une conversation portant une génération en vol
// n'est jamais relue (piège 28). Son thread de travail est en AVANCE sur le
// storage — l'unique écriture d'un échange a lieu dans `onFinal`/`onHalt` —, et
// écraser l'étage 2 avec les octets du disque lui retirerait le tour en cours
// sous les pieds. On rafraîchit seulement sa position LRU.
async function warmConversation(id) {
  if (isConvPinnedInCache(id)) {
    if (_convMessagesCache.has(id)) touchConvMessages(id, _convMessagesCache.get(id));
    return;
  }
  const db = await openConvDB();
  const rec = await new Promise(function(resolve, reject) {
    const tx = db.transaction('conversations', 'readonly');
    const req = tx.objectStore('conversations').get(id);
    req.onsuccess = function(e) { resolve(e.target.result || null); };
    tx.onerror = function(e) { reject(e.target.error); };
  });
  if (!rec) return;
  const split = splitConvRecord(rec);
  _convMetaCache.set(id, split.meta);
  touchConvMessages(id, split.messages);
}

// Lecture complète d'UNE conversation depuis IDB, hors cache. Utilisé par les
// consommateurs froids en masse (recherche U-3, backfill) qui ne doivent pas
// polluer l'étage 2 ni en dépendre.
async function readConversationFromDB(id) {
  const db = await openConvDB();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction('conversations', 'readonly');
    const req = tx.objectStore('conversations').get(id);
    req.onsuccess = function(e) { resolve(e.target.result || null); };
    tx.onerror = function(e) { reject(e.target.error); };
  });
}

// Toutes les conversations COMPLÈTES depuis IDB (messages inclus), hors cache.
// Réservé aux consommateurs froids en masse : recherche plein-texte (U-3) et
// backfill de résumés. Ne jamais l'appeler dans un chemin de rendu.
async function readAllConversationsFromDB() {
  const db = await openConvDB();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction('conversations', 'readonly');
    const req = tx.objectStore('conversations').getAll();
    req.onsuccess = function(e) { resolve(e.target.result || []); };
    tx.onerror = function(e) { reject(e.target.error); };
  });
}

// Ensemble des ids dont le CONTENU matche `query` (recherche plein-texte, U-3).
// Le prédicat de recherche (`searchConversations`, ui.js) reste synchrone pour
// le titre et le résumé ; le scan de contenu, lui, a perdu sa source synchrone
// avec le passage à IDB (une conversation froide n'a pas ses `messages` en RAM).
// Il est donc PRÉCALCULÉ ici, en async, et le résultat — un simple `Set` d'ids —
// est passé au prédicat qui redevient une consultation O(1).
//
// Option (a) du brief U : relecture IDB complète par frappe débouncée, pas
// d'index RAM entretenu. Mesuré avant de trancher : ~14 ms pour 100
// conversations / 3,8 Mo, ~70 ms pour 500 / 20 Mo en régime chaud, derrière un
// debounce de 150 ms. Un index RAM garderait tout le texte en mémoire en
// permanence — exactement ce que l'étage 2 du cache évite — pour gagner des
// millisecondes invisibles. Ne pas le construire par anticipation.
//
// Sous le seuil de longueur (CONTENT_SCAN_MIN_CHARS), aucune lecture n'est faite
// du tout : on rend un Set vide sans toucher à la base.
async function collectContentSearchHits(query) {
  const q = (query || '').trim().toLowerCase();
  const hits = new Set();
  if (q.length < CONTENT_SCAN_MIN_CHARS) return hits;
  for (const conv of await readAllConversationsFromDB()) {
    if (convContentMatches(conv, q)) hits.add(conv.id);
  }
  return hits;
}

// Écriture d'UNE conversation. Le cache est muté SYNCHRONEMENT (source de
// vérité pour les lecteurs synchrones) puis le `put` est planifié. Le broadcast
// part sur `tx.oncomplete` — POST-COMMIT, jamais `req.onsuccess` (piège 24) :
// un pair qui relit le store sur onsuccess verrait l'ancien état.
function persistConversation(conv) {
  const split = splitConvRecord(conv);
  _convMetaCache.set(conv.id, split.meta);
  touchConvMessages(conv.id, split.messages);
  const spaceId = conv.spaceId || DEFAULT_SPACE_ID;
  openConvDB().then(function(db) {
    const tx = db.transaction('conversations', 'readwrite');
    tx.objectStore('conversations').put(conv);
    tx.oncomplete = function() {
      syncPost('conv-updated', { convId: conv.id, spaceId: spaceId });
    };
    tx.onerror = function(e) { reportStorageWriteError('conversation', conv.id, e.target.error); };
  }).catch(function(err) { reportStorageWriteError('conversation', conv.id, err); });
}

// Écriture d'un record complet SANS le mettre au chaud. Même transaction et
// même broadcast post-commit que `persistConversation`, mais le cache d'étage 2
// n'est pas touché : la conversation reste froide si elle l'était.
//
// Réservé aux écritures en masse d'un consommateur froid — aujourd'hui le seul
// est `backfillMessageModels`, qui relit TOUTES les conversations en IDB et
// réécrit celles dont les réponses assistant n'ont pas de `model` (il y en a de
// vieilles dans un historique réel). Passer par `persistConversation` y laissait
// l'étage 2 rempli de 12 conversations arbitraires — les dernières backfillées,
// que personne n'a demandées — au lieu de le laisser disponible pour ce que
// l'utilisateur ouvre vraiment. Borné et sans corruption, mais sans objet.
//
// Les métadonnées, elles, sont bien rafraîchies : elles alimentent le rendu, et
// l'étage 1 porte TOUTES les conversations de toute façon.
function persistConversationCold(conv) {
  const split = splitConvRecord(conv);
  _convMetaCache.set(conv.id, split.meta);
  const spaceId = conv.spaceId || DEFAULT_SPACE_ID;
  openConvDB().then(function(db) {
    const tx = db.transaction('conversations', 'readwrite');
    tx.objectStore('conversations').put(conv);
    tx.oncomplete = function() {
      syncPost('conv-updated', { convId: conv.id, spaceId: spaceId });
    };
    tx.onerror = function(e) { reportStorageWriteError('conversation', conv.id, e.target.error); };
  }).catch(function(err) { reportStorageWriteError('conversation', conv.id, err); });
}

function removeConversationRecord(id, spaceId) {
  _convMetaCache.delete(id);
  _convMessagesCache.delete(id);
  openConvDB().then(function(db) {
    const tx = db.transaction('conversations', 'readwrite');
    tx.objectStore('conversations').delete(id);
    tx.oncomplete = function() {
      syncPost('conv-deleted', { convId: id, spaceId: spaceId });
    };
    tx.onerror = function(e) { reportStorageWriteError('conversation', id, e.target.error); };
  }).catch(function(err) { reportStorageWriteError('conversation', id, err); });
}

// Recharge depuis IDB ce qu'un AUTRE onglet vient d'écrire.
//
// Le piège 24 dit « relire APRÈS l'await ». Depuis U-1, ça ne suffit plus : la
// relecture passe par un cache RAM **par onglet**, que le broadcast n'invalide
// pas. Utilisé par le récepteur de synchro pour les conversations NON affichées
// (branche `render-list`) : leurs métadonnées — titre, updatedAt, épinglage —
// alimentent la sidebar et vivent dans le cache d'étage 1. La conversation
// affichée, elle, passe par `openConversation`/`warmConversation`.
//
// Il **relit**, il ne se contente pas de vider : un simple `delete` rendrait
// `messages: []` sur une conversation chaude (contrat U-1). Une conversation
// absente d'IDB (supprimée par le pair) est retirée des deux étages.
async function refreshConversationFromDB(id) {
  const rec = await readConversationFromDB(id);
  if (!rec) {
    _convMetaCache.delete(id);
    _convMessagesCache.delete(id);
    return null;
  }
  const split = splitConvRecord(rec);
  _convMetaCache.set(id, split.meta);
  // Étage 2 seulement si la conversation y était déjà : re-hydrater une
  // conversation froide la réchaufferait sans que personne l'ait demandé.
  if (_convMessagesCache.has(id)) touchConvMessages(id, split.messages);
  return rec;
}

// Recharge l'index des résumés depuis IDB. Même raison que
// `refreshConversationFromDB` : le cache est par onglet, et les résumés
// n'émettent aucun broadcast propre (lot J). L'index est petit et intégralement
// en RAM, donc on le relit en entier — pas de granularité par entrée à gérer.
// Appelé en arrière-plan par le récepteur de synchro, jamais dans un chemin
// d'envoi (cf. applySyncDecision, main.js).
async function refreshSummariesFromDB() {
  // Attendre les écritures locales en vol AVANT de lire, puis FUSIONNER plutôt
  // qu'écraser (cf. _summariesInFlight / mergeSummaryIndex) : les deux
  // ensemble ferment la fenêtre où un résumé fraîchement calculé disparaissait
  // du cache parce qu'un `conv-updated` d'un pair avait déclenché la relecture
  // entre la mutation du cache et le commit IDB.
  await awaitPendingSummaryWrites();
  const entries = await readAllSummariesFromDB();
  _summariesCache = mergeSummaryIndex(_summariesCache, entries);
}

// Tous les records du store `summaries`, hors cache. Deux appelants : la
// relecture de synchro ci-dessus et l'export complet (U-4), qui doit écrire ce
// qui est EN BASE et non l'index RAM de cet onglet.
async function readAllSummariesFromDB() {
  const db = await openConvDB();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction('summaries', 'readonly');
    const req = tx.objectStore('summaries').getAll();
    req.onsuccess = function(e) { resolve(e.target.result || []); };
    tx.onerror = function(e) { reject(e.target.error); };
  });
}

// Réinsertion en masse des conversations et résumés d'un import (U-4). Les deux
// stores sont écrits dans UNE SEULE transaction, comme la migration U-2 et pour
// la même raison : c'est ce qui rend un état partiellement importé inatteignable
// par interruption (onglet fermé pendant → transaction avortée, rien d'écrit).
// L'appelant a vidé les stores juste avant ; il recharge la page juste après, ce
// qui réhydrate le cache RAM — aucune mutation de cache ici, elle serait
// aussitôt jetée. Pas de broadcast non plus : `applyImportedData` émet un
// `full-reload` unique pour les pairs, plutôt qu'une grêle de `conv-updated`.
// La promesse est ATTENDUE par l'appelant (au contraire des écritures
// fire-and-forget du reste du fichier) : un échec doit empêcher le reload de
// masquer un import à moitié fait.
async function replaceConvRecordsFromImport(conversations, summaries) {
  const db = await openConvDB();
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
    const convStore = tx.objectStore('conversations');
    const sumStore = tx.objectStore('summaries');
    for (const rec of (conversations || [])) convStore.put(rec);
    for (const rec of (summaries || [])) sumStore.put(rec);
    tx.oncomplete = function() { resolve({ conversations: (conversations || []).length, summaries: (summaries || []).length }); };
    tx.onerror = function(e) { reject(e.target.error); };
    tx.onabort = function(e) { reject(tx.error || (e.target && e.target.error)); };
  });
}

// Écritures de résumé dont la transaction IDB n'a pas encore commité. Le cache
// RAM est muté immédiatement (synchrone) mais le `put` part dans un `.then()` :
// entre les deux, `refreshSummariesFromDB` pouvait lire un IDB qui ne portait
// pas encore l'entrée, puis écraser le cache avec ce snapshot — le résumé
// fraîchement calculé disparaissait, et la conversation redevenait candidate au
// backfill (« pas enregistré, refait au reload »).
//
// C'est le piège 24 pris par l'autre bout : la doctrine y couvre « broadcast
// APRÈS commit », le trou ici était une RELECTURE sans commit. Les résumés
// n'émettant aucun broadcast propre (choix du lot J : état invisible), rien ne
// recollait après coup. Ce registre rend la fenêtre observable ; la fusion de
// `mergeSummaryIndex` la referme même si une écriture arrive pendant la lecture.
let _summariesInFlight = new Map();

function trackSummaryWrite(id, promise) {
  const done = promise.catch(function() {}).then(function() {
    if (_summariesInFlight.get(id) === done) _summariesInFlight.delete(id);
  });
  _summariesInFlight.set(id, done);
  return done;
}

// Rend la promesse du COMMIT (`tx.oncomplete`), pas celle du `put`. Les
// appelants restent libres de l'ignorer — l'écriture demeure fire-and-forget du
// point de vue de l'UI (décision U-1 : pas de surface d'erreur dédiée) ; seul
// `refreshSummariesFromDB` l'attend, pour ne pas lire par-dessus.
function persistSummaryRecord(entry) {
  _summariesCache[entry.id] = entry;
  return trackSummaryWrite(entry.id, openConvDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('summaries', 'readwrite');
      tx.objectStore('summaries').put(entry);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reportStorageWriteError('résumé', entry.id, e.target.error); reject(e.target.error); };
    });
  }).catch(function(err) { reportStorageWriteError('résumé', entry.id, err); }));
}

// Symétrique : une suppression en vol doit être attendue elle aussi, sinon la
// fusion ressusciterait l'entrée depuis le snapshot IDB pré-suppression.
function removeSummaryRecord(id) {
  delete _summariesCache[id];
  return trackSummaryWrite(id, openConvDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('summaries', 'readwrite');
      tx.objectStore('summaries').delete(id);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reportStorageWriteError('résumé', id, e.target.error); reject(e.target.error); };
    });
  }).catch(function(err) { reportStorageWriteError('résumé', id, err); }));
}

// Attend les écritures de résumé en vol. Le set est relu APRÈS l'attente et
// l'attente rejouée tant qu'il en reste : une écriture peut en déclencher une
// autre, et se contenter d'un instantané laisserait la dernière hors du filet.
// Borné par `rounds` — un flux d'écritures continu ne doit pas retarder
// indéfiniment la relecture, qui n'est de toute façon qu'un rafraîchissement.
async function awaitPendingSummaryWrites(rounds) {
  let left = rounds == null ? 3 : rounds;
  while (_summariesInFlight.size && left-- > 0) {
    await Promise.all(Array.from(_summariesInFlight.values()));
  }
}

// Fusion d'un snapshot IDB dans l'index en mémoire. PURE et QuickJS-testable :
// c'est elle qui porte l'invariant, la coquille async ne fait que lui fournir
// les entrées lues (cf. project_extract_pure_helper_over_idb_stub).
//
// Le snapshot fait autorité sur ce qu'il contient — c'est le point de la
// relecture : capter ce qu'un pair a écrit. Mais il ne fait PAS autorité sur ce
// qu'il ne contient pas : une entrée locale absente du snapshot est une écriture
// plus récente que la lecture, pas une suppression par un pair. La version
// précédente repartait d'un objet vide et perdait donc exactement ces entrées-là.
//
// Corollaire assumé : une suppression faite par un PAIR n'est plus propagée par
// cette relecture (l'entrée locale survit). C'est le bon compromis — la
// suppression d'une conversation émet `conv-deleted`, qui passe par
// `deleteSummaryEntry` chez le récepteur, et `pruneOrphanSummariesOnInit`
// rattrape au démarrage. Perdre un résumé fraîchement calculé, à l'inverse,
// n'avait aucun filet.
function mergeSummaryIndex(local, snapshot) {
  const out = Object.assign({}, local || {});
  for (const e of (snapshot || [])) {
    if (e && e.id != null) out[e.id] = e;
  }
  return out;
}

// Les écritures sont fire-and-forget : plus personne n'attend la promesse. Un
// échec est tracé en console et rien de plus — même posture que `putResource`
// (dont le rejet n'a jamais eu d'auditeur). Décision Julien (lot U-1) : pas de
// surface d'erreur dédiée, le brief exclut toute affordance visuelle nouvelle
// et le quota IDB est de plusieurs ordres de grandeur au-dessus de celui de
// localStorage — l'échec d'écriture qui motivait ce lot n'a plus la même
// probabilité. À rouvrir si l'usage réel dément.
function reportStorageWriteError(kind, id, err) {
  console.error('[miaou] échec d\'écriture ' + kind + ' ' + id, err);
}

// Écriture CIBLÉE de quelques champs d'une conversation, sans jamais toucher
// `messages`. Indispensable : `loadConversation` d'une conversation FROIDE rend
// `messages: []` (contrat de l'étage 2), donc persister le record reconstruit
// depuis le cache écraserait en base les messages d'une conversation ancienne —
// épingler une vieille conversation depuis la sidebar suffirait à la vider.
// Le read-modify-write a lieu DANS la transaction, seul endroit où le record
// complet est disponible à coup sûr.
// Une valeur `undefined` SUPPRIME le champ (Object.assign copierait la clé à
// undefined) : c'est la sémantique attendue par les appelants qui faisaient
// `delete conv.model` quand l'override repasse au défaut global.
function applyConvFields(target, fields) {
  for (const k of Object.keys(fields)) {
    if (fields[k] === undefined) delete target[k];
    else target[k] = fields[k];
  }
  return target;
}

function persistConversationField(id, fields) {
  const meta = _convMetaCache.get(id);
  if (!meta) return;
  applyConvFields(meta, fields);
  const spaceId = meta.spaceId || DEFAULT_SPACE_ID;
  openConvDB().then(function(db) {
    const tx = db.transaction('conversations', 'readwrite');
    const store = tx.objectStore('conversations');
    const req = store.get(id);
    req.onsuccess = function(e) {
      const rec = e.target.result;
      if (!rec) return;   // supprimée entre-temps : ne pas ressusciter
      store.put(applyConvFields(Object.assign({}, rec), fields));
    };
    tx.oncomplete = function() {
      syncPost('conv-updated', { convId: id, spaceId: spaceId });
    };
    tx.onerror = function(e) { reportStorageWriteError('conversation', id, e.target.error); };
  }).catch(function(err) { reportStorageWriteError('conversation', id, err); });
}

// ── Migration localStorage → IDB (lot U-2) ──────────────────────────────────
// Motif du lot : le quota localStorage (~5-10 Mo) est atteint en usage réel et
// l'échec de `setItem` est silencieux. La purge des deux clés est donc le BUT,
// pas un nettoyage cosmétique — mais elle n'a lieu qu'après `tx.oncomplete`.

// Parse le contenu historique de `miaou-conversations` : un tableau de
// conversations complètes. Pure, QuickJS-testable — c'est elle qui porte
// l'invariant « ne migrer que ce qui a une identité exploitable ».
// Tolérante : une clé absente, un JSON illisible ou une entrée sans `id` ne
// font pas échouer la migration, ils sont ignorés (le reste passe).
function parseLegacyConversations(raw) {
  if (raw === null || raw === undefined) return [];   // clé absente : rien à faire
  let arr;
  // `null` = contenu PRÉSENT mais inexploitable. Distinct de `[]` (rien à
  // migrer) : l'appelant doit alors s'abstenir de purger, sous peine de
  // détruire des octets encore récupérables à la main.
  try { arr = JSON.parse(raw); } catch (e) { return null; }
  if (!Array.isArray(arr)) return null;
  return arr.filter(c => c && typeof c.id === 'string' && c.id);
}

// Parse le contenu historique de `miaou-summaries` : un OBJET { id: entry },
// là où le store IDB veut un tableau de records à keyPath 'id'. La conversion
// de forme est ici. `id` est réaffirmé depuis la clé : les entrées récentes le
// portent déjà (saveSummary le force), les anciennes pas forcément, et c'est le
// keyPath — sans lui le `put` jette.
function parseLegacySummaries(raw) {
  if (raw === null || raw === undefined) return [];   // clé absente : rien à faire
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { return null; }   // présent mais illisible (cf. parseLegacyConversations)
  return normalizeLegacySummaryMap(obj);
}

// Conversion de forme SEULE, à partir d'un objet DÉJÀ parsé : objet indexé
// { id: entry } → tableau de records portant leur `id`. Pure, QuickJS-testable.
// Deux appelants, délibérément : la migration localStorage (U-2, via
// `parseLegacySummaries`) et l'import d'un fichier `version: 1` (U-4), qui porte
// les résumés dans la MÊME forme héritée. Une seule formule pour les deux — un
// second convertisseur écrit sur place divergerait en silence.
// Rend `null` sur une entrée qui n'est pas un objet indexé exploitable ; les
// appelants traitent `null` comme « présent mais illisible », jamais comme vide.
function normalizeLegacySummaryMap(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const out = [];
  for (const id of Object.keys(obj)) {
    const e = obj[id];
    if (!e || typeof e !== 'object') continue;
    out.push(Object.assign({}, e, { id: id }));
  }
  return out;
}

// Décide ce qu'il reste à écrire, connaissant les ids DÉJÀ présents en IDB.
// Pure. Une entrée déjà en base gagne toujours sur celle de localStorage : IDB
// est le support courant, localStorage un résidu. Ce cas n'arrive que si une
// migration précédente a écrit puis échoué à purger.
// `legacy` à `null` (contenu illisible) donne un tableau vide : rien n'est
// écrit pour cette clé, et l'appelant s'abstient par ailleurs de la purger.
function selectRecordsToMigrate(legacy, existingIds) {
  const set = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  return (legacy || []).filter(r => r && !set.has(r.id));
}

// Migration one-shot au boot. Court-circuit sur l'ABSENCE des clés localStorage,
// pas sur « le store IDB est peuplé » : après une migration réussie les clés
// sont purgées, donc `getItem === null` court-circuite pour toujours — alors
// qu'un critère « store peuplé » ressusciterait l'historique si l'utilisateur
// supprimait toutes ses conversations après une purge ratée.
// Appelée AVANT hydrateConvCache() : sans quoi le cache s'hydraterait depuis
// des stores encore vides et la sidebar s'afficherait sans historique.
// Contrat d'échec : on ne purge rien, localStorage reste intact, on trace. Le
// prochain boot retentera.
async function migrateConversationsToIdbIfNeeded() {
  const rawConvs = localStorage.getItem(CONV_KEY);
  const rawSummaries = localStorage.getItem(SUMMARIES_KEY);
  if (rawConvs === null && rawSummaries === null) return null;

  const legacyConvs = parseLegacyConversations(rawConvs);
  const legacySummaries = parseLegacySummaries(rawSummaries);
  // `null` = contenu présent mais inexploitable. On migre l'autre clé si elle
  // est saine, mais on ne purge JAMAIS celle qu'on n'a pas su lire : ses octets
  // restent récupérables à la main. Conséquence assumée : la migration sera
  // retentée à chaque boot tant que la clé abîmée est là (trace en console).
  if (legacyConvs === null) console.error('[miaou] ' + CONV_KEY + ' est présent mais illisible : conservé tel quel, non migré');
  if (legacySummaries === null) console.error('[miaou] ' + SUMMARIES_KEY + ' est présent mais illisible : conservé tel quel, non migré');
  const db = await openConvDB();

  // Une seule transaction pour les deux stores : l'atomicité est gratuite et
  // le `oncomplete` — donc le feu vert à la purge — est unique.
  const written = await new Promise(function(resolve, reject) {
    const tx = db.transaction(['conversations', 'summaries'], 'readwrite');
    const convStore = tx.objectStore('conversations');
    const sumStore = tx.objectStore('summaries');
    const counts = { conversations: 0, summaries: 0 };

    // getAllKeys plutôt que getAll : on ne veut que les ids, pas rapatrier
    // tout le volume déjà en base pour décider de ne pas l'écraser.
    convStore.getAllKeys().onsuccess = function(e) {
      const todo = selectRecordsToMigrate(legacyConvs, new Set(e.target.result || []));
      counts.conversations = todo.length;
      for (const rec of todo) convStore.put(rec);
    };
    sumStore.getAllKeys().onsuccess = function(e) {
      const todo = selectRecordsToMigrate(legacySummaries, new Set(e.target.result || []));
      counts.summaries = todo.length;
      for (const rec of todo) sumStore.put(rec);
    };


    tx.oncomplete = function() { resolve(counts); };
    tx.onerror = function(e) { reject(e.target.error); };
    tx.onabort = function(e) { reject(tx.error || (e.target && e.target.error)); };
  });

  // POST-COMMIT uniquement (piège 24 dans sa forme la plus littérale : ici
  // « commit » gouverne une SUPPRESSION de la source, pas un simple broadcast).
  if (legacyConvs !== null) localStorage.removeItem(CONV_KEY);
  if (legacySummaries !== null) localStorage.removeItem(SUMMARIES_KEY);
  console.info('[miaou] migration localStorage → IndexedDB : '
    + written.conversations + ' conversation(s), '
    + written.summaries + ' résumé(s)');
  return written;
}

// ── Conversations ───────────────────────────────────────────────────────────
// Stockage : un record par conversation dans le store IDB `conversations`
// ({ id, title, timestamp, messages, … }), servi par le cache RAM ci-dessus.
// Les signatures restent SYNCHRONES (cf. la note de la couche IDB).

// Toutes les conversations, messages inclus POUR CELLES QUI SONT CHAUDES
// (étage 2). Une conversation froide sort avec `messages: []` — c'est le
// contrat : ce lecteur sert le rendu, le tri et l'herméticité (spaceConvIds),
// qui ne lisent que des métadonnées. Les DEUX consommateurs qui ont besoin du
// contenu à froid en masse (recherche plein-texte, backfill de résumés) passent
// par `readAllConversationsFromDB()` et vivent en async.
function loadConversations() {
  const out = [];
  for (const [id, meta] of _convMetaCache) {
    out.push(joinConvRecord(meta, _convMessagesCache.get(id)));
  }
  return out;
}

function listAllConversations() {
  const out = [];
  for (const [id, c] of _convMetaCache) {
    // `parentConvId` / `agentIntent` (lot X-1) : cette projection est la SEULE
    // source de agentChildrenOf/isRootConversation (agents.js), qui balaient
    // l'étage 1 permanent. Les omettre ici rendrait tout agent invisible comme
    // agent — donc jamais exclu de la sidebar, du backfill ni de la recherche,
    // sans qu'aucun test ne le voie. `agentIntent` tient lieu de titre : un agent
    // n'est jamais titré (exclusion 3ter), le libellé doit voyager avec la méta.
    out.push({ id: id, title: c.title, timestamp: c.timestamp, updatedAt: c.updatedAt, pinned: !!c.pinned, spaceId: c.spaceId || DEFAULT_SPACE_ID,
      parentConvId: c.parentConvId, agentIntent: c.agentIntent });
  }
  return out.sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));
}

// Une conversation par id. `messages` est peuplé si la conversation est chaude
// (affichée, récemment ouverte, ou portant une génération en vol) ; sinon vide.
// Les appelants qui ont besoin du contenu appellent `warmConversation(id)`
// avant (openConversation le fait, à côté de loadConversationResources).
function loadConversation(id) {
  const meta = _convMetaCache.get(id);
  if (!meta) return null;
  return joinConvRecord(meta, _convMessagesCache.get(id));
}

function saveConversation(conv) {
  // Mute le cache puis planifie le put ; broadcast post-commit côté primitive
  // (piège 24). Les pairs re-hydratent si affichée, sinon rafraîchissent la
  // liste (herméticité de Space tranchée côté récepteur via spaceConvIds,
  // piège 18).
  persistConversation(conv);
  return conv;
}

function deleteConversation(id) {
  // Résoudre le spaceId AVANT suppression (le payload en a besoin ; après, la
  // conv a disparu). Émettre seulement si la conv existait réellement.
  const existing = loadConversation(id);
  if (!existing) return;
  removeConversationRecord(id, existing.spaceId || DEFAULT_SPACE_ID);
}

// Épingle/désépingle une conversation. Retourne le nouvel état (bool) ou null
// si la conversation n'existe pas (création à la volée pas encore matérialisée).
function toggleConversationPin(id) {
  const meta = _convMetaCache.get(id);
  if (!meta) return null;
  const pinned = !meta.pinned;
  // Écriture ciblée : on repart du record complet (métadonnées + messages
  // chauds s'il y en a) pour ne pas écraser en base les messages d'une
  // conversation froide par un tableau vide.
  persistConversationField(id, { pinned: pinned });
  return pinned;
}

// Substance réelle : au moins un échange complet (≥1 user ET ≥1 assistant) au
// contenu non trivial. Le but est d'écarter une conversation à peine née ou
// avortée (pas de vraie réponse), pas d'exiger plusieurs allers-retours — sans
// quoi les conversations courantes en 1 Q/R ne seraient jamais résumées.
function hasSubstance(messages) {
  if (!Array.isArray(messages)) return false;
  let u = 0, a = 0;
  for (const m of messages) {
    const len = (m && typeof m.content === 'string') ? m.content.trim().length : 0;
    if (len < 8) continue;
    if (m.role === 'user') u++;
    else if (m.role === 'assistant') a++;
  }
  return u >= 1 && a >= 1;
}

// ── Index des résumés (miaou-summaries) ─────────────────────────────────────
// Entrée présente : { id, title, timestamp, summary, keywords, messageCount }
// Tombstone        : { id, suppressed: true }   ← compte comme « présente »
// Absente          : candidate au backfill / à la génération en sortie.

// Index des résumés : servi par le cache RAM `_summariesCache`, hydraté au
// boot avec les métadonnées. Taille bornée (une entrée courte par conversation,
// jamais de contenu de messages) → intégralement en mémoire, contrairement aux
// messages qui sont en LRU.
function loadSummaries() {
  return _summariesCache;
}

function getSummaryEntry(id) {
  return Object.prototype.hasOwnProperty.call(_summariesCache, id) ? _summariesCache[id] : null;
}

// Toutes les entrées de l'index NON tombstonées, sous forme de tableau.
function listSummaryEntries() {
  return Object.values(_summariesCache).filter(e => e && !e.suppressed);
}

function saveSummary(id, data) {
  persistSummaryRecord(Object.assign({ id }, data, { id }));
}

// Suppression volontaire : pose une tombstone (réversible). On CONSERVE les
// données du résumé (titre, texte, mots-clés, messageCount) sous le flag, pour
// une ré-autorisation instantanée sans régénérer. Le flag suspend l'usage :
// recherche et outils ignorent les entrées `suppressed`.
function suppressSummary(id) {
  const prev = _summariesCache[id] || { id };
  persistSummaryRecord(Object.assign({}, prev, { id, suppressed: true }));
}

// Ré-autorisation : si le résumé a été conservé sous la tombstone, on retire
// simplement le flag (retour instantané à l'état d'avant). Sinon (tombstone
// sans données), on retire l'entrée → la conversation redevient candidate.
function restoreSummary(id) {
  const e = _summariesCache[id];
  if (!e) return;
  if (e.summary) {
    const next = Object.assign({}, e);
    delete next.suppressed;
    persistSummaryRecord(next);
  } else {
    removeSummaryRecord(id);
  }
}

// Effacement dur (utilisé quand la conversation elle-même disparaît).
function deleteSummaryEntry(id) {
  removeSummaryRecord(id);
}

// Candidate = absente de l'index (ni résumé, ni tombstone).
function isSummaryCandidate(id) {
  return getSummaryEntry(id) === null;
}

// Retire de l'index les entrées dont la conversation n'existe plus (fonction
// pure, QuickJS-testable). Cas normal : `deleteConv` appelle déjà
// `deleteSummaryEntry` — ceci couvre les résidus (interruption avant ce point,
// résumé généré/sauvegardé après une suppression concurrente, ancien état
// pré-fix). Renvoie l'objet résumés nettoyé ; ne touche pas à `localStorage`.
// Exclusion des agents (lot X-1, étape 2, exclusion 5 de 3ter) : une
// conversation d'agent n'est jamais résumée, donc l'index ne doit JAMAIS porter
// d'entrée pour elle. Sans cette ligne, un résumé créé avant que l'exclusion
// n'existe (ou par un chemin qu'on aurait manqué) survivrait indéfiniment.
// `isRootConversation` vit dans agents.js et n'est référencé qu'ici, en corps de
// fonction (contrainte de portée inter-fichier, CLAUDE.md).
function pruneOrphanSummaries(summaries, convs) {
  const ids = new Set((convs || []).filter(isRootConversation).map(c => c.id));
  const out = {};
  for (const id of Object.keys(summaries)) {
    if (ids.has(id)) out[id] = summaries[id];
  }
  return out;
}

// Conversations à résumer au démarrage : absentes de l'index et substantielles.
// `hasSubstance` porte sur les MESSAGES : lecture froide en masse (la plupart
// des conversations ne sont pas en RAM), donc IDB et non loadConversations —
// qui rendrait `messages: []` et ne trouverait jamais aucun candidat. Appelé une
// seule fois, depuis runBackfill (déjà async).
// Cœur décisionnel, PUR et QuickJS-testable : c'est lui qui porte l'invariant
// (absente de l'index ET substantielle). La coquille async ne fait que lui
// fournir les conversations lues d'IDB — on teste le prédicat, pas l'E/S
// (cf. project_extract_pure_helper_over_idb_stub).
// Exclusion des agents (lot X-1, étape 2) : c'est LA ligne qui empêche
// l'exclusion de « tenir tant que la page est ouverte et sauter au reload ».
// Un agent n'est jamais résumé en vol (summarizeIfNeeded le refuse) ; sans ce
// filtre, il redeviendrait candidat au prochain démarrage, et le lot serait vert
// et faux (project_second_writer_must_realign_the_first).
function selectBackfillCandidates(convs, summaries) {
  return (convs || []).filter(c =>
    c && isRootConversation(c) &&
    !Object.prototype.hasOwnProperty.call(summaries || {}, c.id) && hasSubstance(c.messages));
}

async function backfillCandidates() {
  return selectBackfillCandidates(await readAllConversationsFromDB(), loadSummaries());
}

// ── Souvenirs utilisateur (miaou-memories) ───────────────────────────────────
// Schéma : { id, content, created_at, updated_at, suppressed }
// Tombstone : { ..., suppressed: true }  ← conserve content pour affichage

const MEMORIES_KEY = 'miaou-memories';

// Suffixe aléatoire (même gabarit que genSpaceId/genApiServerId) : deux
// memory__create dans le même tour d'outils s'exécutent en séquence
// sub-milliseconde — un id purement horodaté ferait écraser le premier
// souvenir par le second (saveMemory upsert par id).
function genMemoryId() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function loadMemories() {
  try { return JSON.parse(localStorage.getItem(MEMORIES_KEY)) || []; }
  catch (e) { return []; }
}

function persistMemories(arr) {
  localStorage.setItem(MEMORIES_KEY, JSON.stringify(arr));
}

// Entrées actives : non-supprimées. `scopes` optionnel (tableau de scopes
// autorisés, ex. ['profile', activeSpaceId] — cf. D3) ; omis = toutes (usage
// historique, ex. export/import). Migration garantit `scope` toujours posé
// (default Space) donc pas de filet 'pas de scope = visible partout' ici.
// Scopes de souvenirs visibles ET modifiables depuis le Space actif : le scope
// transverse 'profile' PLUS le Space courant. Source unique partagée par
// `buildMemoryEntriesBlock()` (ce qui est injecté au modèle) et par
// `memory__update`/`memory__delete` (ce que le modèle peut toucher) — les deux
// doivent coïncider, sinon on montre au modèle une entrée avec son id puis on
// lui répond « introuvable » quand il la vise (bug payé au lot C : le prédicat
// d'herméticité inter-Spaces avait été recopié tel quel dans les handlers, où
// il excluait 'profile' — qui n'est pas « un autre Space » mais un scope
// AU-DESSUS de la frontière que l'herméticité protège).
// `create` reste volontairement asymétrique : il stampe toujours le Space actif,
// la promotion vers 'profile' restant une action UI (décision lot C, maintenue).
function memoryScopesForSpace(spaceId) {
  return ['profile', spaceId || DEFAULT_SPACE_ID];
}

// Un souvenir est-il atteignable depuis `spaceId` ? Prédicat pur, partagé par
// les handlers d'outils. Une entrée sans scope (pré-migration) vaut default Space.
function isMemoryInScope(entry, spaceId) {
  if (!entry) return false;
  return memoryScopesForSpace(spaceId).indexOf(entry.scope || DEFAULT_SPACE_ID) !== -1;
}

function listMemoryEntries(scopes) {
  const all = loadMemories().filter(e => e && !e.suppressed);
  if (!Array.isArray(scopes)) return all;
  return all.filter(e => scopes.indexOf(e.scope) !== -1);
}

function saveMemory(entry) {
  const arr = loadMemories();
  const i = arr.findIndex(e => e.id === entry.id);
  if (i >= 0) arr[i] = entry; else arr.push(entry);
  persistMemories(arr);
}

// Édition directe (utilisateur) : in-place.
function editMemory(id, newContent) {
  const arr = loadMemories();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  e.content = newContent;
  e.updated_at = Date.now();
  persistMemories(arr);
}

function suppressMemory(id) {
  const arr = loadMemories();
  const e = arr.find(x => x.id === id);
  if (e) { e.suppressed = true; persistMemories(arr); }
}

function restoreMemory(id) {
  const arr = loadMemories();
  const e = arr.find(x => x.id === id);
  if (e) { delete e.suppressed; persistMemories(arr); }
}

function forgetMemory(id) {
  persistMemories(loadMemories().filter(x => x.id !== id));
}

// ── Espaces (miaou-spaces) — feature Spaces (lot C) ──────────────────────────
// Registre : { id, name, description?, createdAt }. `description` (texte
// libre du Space) est CONCATÉNÉE après le prompt système utilisateur global
// dans buildSystemMessage() — ce n'est PAS un system prompt de substitution
// (correction actée : le brief D4 d'origine, qui proposait un remplacement,
// est inversé). Le default Space (id fixe
// DEFAULT_SPACE_ID) est l'espace hors-Space historique : non supprimable,
// renommable, toujours présent en tête après migration (cf.
// migrateSpacesIfNeeded). Calqué sur le pattern serveurs API (id = clé
// d'identité, tableau brut en localStorage).

function genSpaceId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'sp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function loadSpaces() {
  try {
    const arr = JSON.parse(localStorage.getItem(SPACES_KEY));
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveSpaces(arr) {
  localStorage.setItem(SPACES_KEY, JSON.stringify(Array.isArray(arr) ? arr : []));
  // Post-commit (piège 24) : le registre des Espaces a changé (création/renommage/
  // suppression) → les pairs re-render leur sélecteur/liste de Spaces. Pas de
  // spaceId précis (saveSpaces reçoit le tableau entier) : le récepteur recharge
  // la liste complète. `miaou-active-space` n'est JAMAIS diffusé (état par onglet).
  syncPost('space-changed', {});
  return arr;
}

function normalizeSpace(s) {
  const o = s || {};
  return {
    id: o.id || genSpaceId(),
    name: String(o.name || '').trim(),
    description: o.description ? String(o.description) : '',
    createdAt: o.createdAt || Date.now(),
  };
}

// Insère ou remplace un Space par `id`. Retourne le tableau.
function upsertSpace(space) {
  const next = normalizeSpace(space);
  const arr = loadSpaces();
  const i = arr.findIndex(s => s.id === next.id);
  if (i >= 0) arr[i] = next; else arr.push(next);
  saveSpaces(arr);
  return arr;
}

// Le default Space n'est jamais supprimable par ce chemin (l'appelant doit de
// toute façon garder l'UI de suppression désactivée dessus, cf. brief D1).
function deleteSpaceEntry(id) {
  if (id === DEFAULT_SPACE_ID) return loadSpaces();
  const arr = loadSpaces().filter(s => s.id !== id);
  saveSpaces(arr);
  return arr;
}

function getSpace(id) {
  return loadSpaces().find(s => s.id === id) || null;
}

function getActiveSpaceId() {
  return localStorage.getItem(ACTIVE_SPACE_KEY) || DEFAULT_SPACE_ID;
}

function setActiveSpaceId(id) {
  localStorage.setItem(ACTIVE_SPACE_KEY, id || DEFAULT_SPACE_ID);
}

// Migration idempotente (PAS un one-shot façon migrateApiServersIfNeeded) :
// backfill à chaque chargement, cf. audit §3. Garantit le registre + le
// default Space + spaceId sur chaque conv + scope sur chaque souvenir. Rejoué
// sans effet une fois l'état déjà cohérent (double passe = même état).
function migrateSpacesIfNeeded() {
  const spaces = loadSpaces();
  if (!spaces.some(s => s.id === DEFAULT_SPACE_ID)) {
    spaces.unshift(normalizeSpace({ id: DEFAULT_SPACE_ID, name: 'Général', createdAt: Date.now() }));
    saveSpaces(spaces);
  }
  // Backfill spaceId : écriture CIBLÉE par conversation touchée
  // (persistConversationField ne touche jamais `messages` — une conversation
  // froide n'a pas les siens en RAM, cf. couche IDB).
  for (const c of loadConversations()) {
    if (!c.spaceId) persistConversationField(c.id, { spaceId: DEFAULT_SPACE_ID });
  }
  const memories = loadMemories();
  let memoriesChanged = false;
  for (const m of memories) {
    if (!m.scope) { m.scope = DEFAULT_SPACE_ID; memoriesChanged = true; }
  }
  if (memoriesChanged) persistMemories(memories);
}

// Prédicat d'herméticité UNIQUE (audit §4, brief D2) : ids des conversations
// appartenant à `spaceId` parmi `convs` (déjà chargées par l'appelant — pas de
// rechargement caché). Pure, testable QuickJS ; tous les sites listés dans
// l'audit (sidebar, recherche, outils, injection résumés) doivent passer par
// elle, jamais par un filtre `c.spaceId === x` réécrit localement.
function spaceConvIds(spaceId, convs) {
  const set = new Set();
  for (const c of (convs || [])) {
    if (c && (c.spaceId || DEFAULT_SPACE_ID) === spaceId) set.add(c.id);
  }
  return set;
}

// ── Export / import complet des données (feature E) ─────────────────────────
// Assurance-vie : tout l'état de MIAOU (localStorage + IndexedDB) tient dans un
// unique fichier JSON, réimportable par REMPLACEMENT INTÉGRAL (pas de fusion,
// décision actée). Format détaillé : docs/storage.md.
//
// Version du format de fichier d'export. v1 : conversations et résumés sous
// `localStorage`. v2 (lot U-4) : sous `idb`, comme skills et resources, puisque
// c'est là qu'ils vivent depuis U-2. v3 (lot V-3) : le conteneur devient un
// `.zip` — `manifest.json` porte tout l'état SAUF les octets binaires, qui
// vivent dans un membre `resources/<id>` par ressource. Plus de base64 nulle
// part : ni à l'export, ni à l'import. L'écriture est toujours à la version
// courante ; la lecture accepte toutes les versions ≤ celle-ci.
const EXPORT_FORMAT_VERSION = 3;

// Les 7 clés localStorage du schéma. Référencée uniquement en corps de
// fonction depuis les autres fichiers (contrainte test runner, cf. CLAUDE.md)
// — jamais au top-level d'un fichier tiers.
//
// `miaou-conversations` et `miaou-summaries` en sont SORTIES au lot U-4 : elles
// n'existent plus en localStorage depuis la migration U-2. Les y laisser ne
// cassait rien de visible — `JSON.parse(null)` donne `null`, normalisé en vide —
// donc l'export continuait de se produire, silencieusement amputé de tout
// l'historique. Elles vivent désormais sous la section `idb` du payload, aux
// côtés de `skills`/`resources`.
const EXPORT_KEYS = [
  'miaou-settings',
  'miaou-memories',
  'miaou-api-servers',
  'miaou-active-api-server',
  'miaou-mcp-servers',
  'miaou-spaces',
  'miaou-active-space',
];

// Construit le payload d'export complet. `lsSnapshot` : objet { clé: valeur
// DÉSÉRIALISÉE } pour les 7 clés (l'appelant lit localStorage + JSON.parse, ou
// fournit la string brute pour miaou-active-api-server / miaou-active-space —
// seules clés non-JSON du schéma). `skills` : tableau brut issu de
// getAllSkillRecords().
//
// `resources` : depuis v3 (lot V-3), les MÉTADONNÉES des ressources, sans
// octets — `buildResourceMemberIndex` les a séparées, `data` est remplacé par
// `member` (le nom du membre du zip qui porte les octets bruts). C'est ce qui
// supprime le base64 du chemin d'export. Cette fonction reste pure et ne
// connaît pas le conteneur : elle reçoit ce qu'on lui donne.
function buildExportPayload(lsSnapshot, skills, resources, conversations, summaries) {
  const ls = lsSnapshot || {};
  return {
    format: 'miaou-export',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: Date.now(),
    localStorage: {
      'miaou-settings': ls['miaou-settings'] || {},
      'miaou-memories': Array.isArray(ls['miaou-memories']) ? ls['miaou-memories'] : [],
      'miaou-api-servers': Array.isArray(ls['miaou-api-servers']) ? ls['miaou-api-servers'] : [],
      'miaou-active-api-server': typeof ls['miaou-active-api-server'] === 'string' ? ls['miaou-active-api-server'] : '',
      'miaou-mcp-servers': Array.isArray(ls['miaou-mcp-servers']) ? ls['miaou-mcp-servers'] : [],
      'miaou-spaces': Array.isArray(ls['miaou-spaces']) ? ls['miaou-spaces'] : [],
      'miaou-active-space': typeof ls['miaou-active-space'] === 'string' ? ls['miaou-active-space'] : '',
    },
    idb: {
      skills: Array.isArray(skills) ? skills : [],
      resources: Array.isArray(resources) ? resources : [],
      conversations: Array.isArray(conversations) ? conversations : [],
      summaries: Array.isArray(summaries) ? summaries : [],
    },
  };
}

// Extrait conversations et résumés d'un payload importé, QUELLE QUE SOIT sa
// version, sous la forme des records IDB attendus par l'import. Pure,
// QuickJS-testable. C'est LE point unique où la différence v1/v2 est traitée :
// tout le reste de l'import ignore la version du fichier.
//
// v2 : section `idb`, déjà des tableaux de records → passés tels quels (filtrés
//      sur la présence d'un `id`, seul champ dont dépend le `put` : keyPath).
// v1 : section `localStorage`, sous les deux clés purgées depuis U-2 — les
//      conversations y sont déjà un tableau, les résumés un OBJET indexé
//      { id: entry } converti par `normalizeLegacySummaryMap`, la même fonction
//      que la migration U-2. Importer un fichier v1 EST une migration : ne pas
//      en écrire une seconde formule.
//
// Un fichier v2 dont la section `idb` est vide n'est PAS complété depuis
// `localStorage` : la section a autorité pour sa version, et un export v2
// légitime peut n'avoir aucune conversation.
function extractImportedConvRecords(payload) {
  const obj = payload || {};
  const idb = (obj.idb && typeof obj.idb === 'object') ? obj.idb : {};
  const ls = (obj.localStorage && typeof obj.localStorage === 'object') ? obj.localStorage : {};
  const withId = arr => (Array.isArray(arr) ? arr : []).filter(r => r && typeof r.id === 'string' && r.id);

  if (obj.version >= 2) {
    return { conversations: withId(idb.conversations), summaries: withId(idb.summaries) };
  }
  return {
    conversations: withId(ls['miaou-conversations']),
    summaries: withId(normalizeLegacySummaryMap(ls['miaou-summaries'])),
  };
}

// Valide un objet importé (déjà JSON.parse). Ne vérifie PAS le contenu détaillé
// des entrées (conversations, résumés, …) — seulement la forme d'ensemble et les
// types des sections, pour rester tolérant à un schéma qui a évolué depuis
// l'export. Sections manquantes → défauts vides (pas une erreur, cf. brief) ;
// seuls le format et la version sont bloquants. Retourne { ok: true, counts }
// (nombre de conversations/souvenirs/skills/ressources/serveurs) ou
// { ok: false, error }.
function validateImportPayload(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Fichier illisible : contenu invalide.' };
  if (obj.format !== 'miaou-export') return { ok: false, error: 'Format inconnu : ce n\'est pas un export MIAOU.' };
  if (typeof obj.version !== 'number' || obj.version > EXPORT_FORMAT_VERSION) {
    return { ok: false, error: 'Version d\'export non supportée (' + obj.version + ').' };
  }
  const ls = (obj.localStorage && typeof obj.localStorage === 'object') ? obj.localStorage : {};
  const idb = (obj.idb && typeof obj.idb === 'object') ? obj.idb : {};
  // Conversations et résumés sont comptés via le MÊME extracteur que l'import
  // applique ensuite : un décompte qui divergerait de ce qui est réellement
  // écrit ferait mentir le récapitulatif de confirmation.
  const extracted = extractImportedConvRecords(obj);
  const conversations = extracted.conversations;
  const memories = Array.isArray(ls['miaou-memories']) ? ls['miaou-memories'] : [];
  const apiServers = Array.isArray(ls['miaou-api-servers']) ? ls['miaou-api-servers'] : [];
  const mcpServers = Array.isArray(ls['miaou-mcp-servers']) ? ls['miaou-mcp-servers'] : [];
  const spaces = Array.isArray(ls['miaou-spaces']) ? ls['miaou-spaces'] : [];
  const skills = Array.isArray(idb.skills) ? idb.skills : [];
  const resources = Array.isArray(idb.resources) ? idb.resources : [];
  return {
    ok: true,
    counts: {
      conversations: conversations.length,
      summaries: extracted.summaries.length,
      memories: memories.length,
      skills: skills.length,
      resources: resources.length,
      servers: apiServers.length + mcpServers.length,
      spaces: spaces.length,
      // Ressources dont les octets manquaient à la lecture d'une archive v3
      // (membre absent : transfert interrompu, zip retouché à la main). Elles
      // sont importées VIDES plutôt que de faire échouer tout l'import — un
      // binaire perdu ne doit pas coûter conversations, souvenirs et réglages.
      // Le compteur remonte jusqu'au récapitulatif de confirmation, pour que
      // ce soit dit AVANT le clic d'application, pas découvert après.
      // Clé transitoire posée par `readBackupFromZip` : elle naît du
      // réassemblage, jamais du fichier, d'où le souligné.
      missingResourceData: typeof obj._missingResourceData === 'number' ? obj._missingResourceData : 0,
    },
  };
}

// ── Sauvegarde v3 : forme des données binaires et index de membres (lot V-3) ─

// Forme du champ `data` d'un record de ressource importé. Retourne
// 'base64' | 'bytes' | 'absent'.
//
// C'est le JUMEAU d'`extractImportedConvRecords` : là où celui-ci est LE point
// unique où la différence de version est traitée pour les conversations,
// celui-ci est LE point unique où la différence de FORME des octets est traitée
// (base64 en v1/v2, octets bruts en v3). Tout le reste de l'import ignore la
// compression — ne pas réintroduire un second test de forme ailleurs.
//
// Une string vide rend 'base64' et non 'absent' : un binaire de zéro octet est
// légitime, et `base64ToArrayBuffer('')` rend un buffer vide. Le distinguer de
// l'absence évite d'écrire un cas particulier chez l'appelant.
function resourceDataShape(data) {
  if (typeof data === 'string') return 'base64';
  if (data == null) return 'absent';
  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) return 'bytes';
  // Uint8Array et vues typées : `buffer` + `byteLength` suffisent à les
  // reconnaître sans dépendre d'`ArrayBuffer.isView` (absent de QuickJS).
  if (typeof data === 'object' && data.buffer && typeof data.byteLength === 'number') return 'bytes';
  return 'absent';
}

// Sépare les records de ressources en MÉTADONNÉES (pour le manifeste) et OCTETS
// (pour les membres du zip). Retourne { entries, members, skipped } :
//   - `entries` : les records sans `data`, avec un champ `member` en plus →
//     ce qui va dans `manifest.idb.resources` ;
//   - `members` : [{ member, data }] → ce qui va dans le zip ;
//   - `skipped` : nombre de records écartés faute d'`id`.
//
// Le nom de membre est `'resources/' + rec.id`, et rien d'autre. C'est un
// IDENTIFIANT : lui seul rattache les octets à leur entrée de manifeste, et
// s'il ne fait pas l'aller-retour à travers zipSync/parseZipCentralDirectory la
// ressource devient INATTEIGNABLE à l'import — le mode de défaillance des noms
// non-UTF-8 payé en clôture V-1. L'`id` est unique par construction (suffixe
// aléatoire) et en ASCII imprimable : structurellement sûr, contrairement à
// `rec.name`, rédigé par l'utilisateur ou le modèle, unicode arbitraire et
// collisionnant régulièrement. NE JAMAIS dériver le nom de membre de `rec.name` :
// le `member` est un détail de transport, le nom lisible continue de vivre dans
// `rec.name`, à l'intérieur du manifeste.
//
// Aucune déduplication n'est nécessaire ici, contrairement à `buildZipMemberName`
// (lot V-2) où les noms viennent du record : deux `id` ne collisionnent pas.
//
// Un record SANS `id` est écarté et compté, jamais passé sans membre : `id` est
// le keyPath du store, un tel record ne pourrait pas être réimporté (`put`
// jetterait), et l'import v1/v2 les filtre déjà.
// Un record sans octets (`data` absent) n'a PAS de `member` : cas licite.
function buildResourceMemberIndex(resources) {
  const list = Array.isArray(resources) ? resources : [];
  const entries = [];
  const members = [];
  let skipped = 0;
  for (const rec of list) {
    if (!rec || typeof rec.id !== 'string' || !rec.id) { skipped++; continue; }
    const meta = Object.assign({}, rec);
    delete meta.data;
    if (resourceDataShape(rec.data) === 'absent') {
      entries.push(meta);
      continue;
    }
    const member = 'resources/' + rec.id;
    meta.member = member;
    entries.push(meta);
    members.push({ member: member, data: rec.data });
  }
  return { entries: entries, members: members, skipped: skipped };
}

// ── État des lieux du stockage (drawer Paramètres › Données) ─────────────────
// L'occupation affichée est MESURÉE par MIAOU (somme exacte, ventilable par
// catégorie), pas lue dans `navigator.storage.estimate()`. De cette API on ne
// garde QUE `quota`.
//
// 🚨 Ne pas « rétablir » estimate().usage comme chiffre principal : c'est une
// régression déjà payée (2026-08-26). Cette valeur est délibérément quantifiée
// par le navigateur (anti-fingerprinting) et, sur un stockage best-effort, elle
// plafonne : mesuré sur une base réelle de 44,2 Mo, `usage` annonçait 30,4 Mo,
// et l'écriture d'une sonde d'1 Mo ne la faisait pas bouger (delta 0,0 Mo).
// Affichée comme total au-dessus d'un détail exact, elle produisait un rapport
// visiblement incohérent (détail > total). Le sens de l'écart avait d'ailleurs
// été supposé à l'envers : c'est le chiffre du navigateur qui est approximatif,
// la somme interne qui est exacte.
//
// Corollaire : le pourcentage se calcule sur la mesure interne rapportée au
// quota. Il minore légèrement l'occupation réelle de l'origine (index, overhead
// de sérialisation, caches hors MIAOU ne sont pas comptés) — assumé, et sans
// commune mesure avec l'erreur d'estimate().
//
// Coût : la mesure interne relit conversations, résumés et ressources. Le
// parcours des ressources se fait au CURSEUR (un record à la fois, GC-able)
// et non via `getAll()` qui matérialiserait tous les binaires en RAM d'un coup.
// Elle n'est déclenchée qu'à l'ouverture du drawer, jamais en fond.

// Poids d'une valeur localStorage. Pur : les chaînes JS sont UTF-16, mais ce
// qui est persisté est de l'UTF-8 — on mesure donc en octets UTF-8, cohérent
// avec la façon dont IDB et l'estimation du navigateur comptent.
function utf8ByteLength(str) {
  const s = String(str == null ? '' : str);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { n += 4; i++; continue; }
      n += 3;
    } else n += 3;
  }
  return n;
}

// Poids d'un enregistrement structuré (conversation, résumé, skill). La
// sérialisation JSON est une approximation du format interne d'IDB (structured
// clone), pas une mesure exacte — assumé, cf. l'écart documenté ci-dessus.
function recordByteLength(rec) {
  try { return utf8ByteLength(JSON.stringify(rec)); } catch (e) { return 0; }
}

// Somme des poids d'un lot d'enregistrements. Pure, testable.
function sumRecordBytes(records) {
  let n = 0;
  for (const r of (records || [])) n += recordByteLength(r);
  return n;
}

// Assemble le rapport final à partir des mesures brutes. Pure : toute
// l'arithmétique à risque est ici, donc testable. `estimate` n'est consulté que
// pour son `quota` — cf. la note en tête de section sur le rejet de son `usage`.
function buildStorageReport(parts, estimate) {
  const detail = {
    settings: parts.settings || 0,
    conversations: parts.conversations || 0,
    summaries: parts.summaries || 0,
    resources: parts.resources || 0,
    skills: parts.skills || 0,
  };
  let total = 0;
  for (const k of Object.keys(detail)) total += detail[k];
  const quota = (estimate && typeof estimate.quota === 'number') ? estimate.quota : null;
  return {
    detail: detail,
    measured: total,
    quota: quota,
    // Part du quota occupée par les données MIAOU, arrondie à l'entier. Assise
    // sur `measured` (exact), jamais sur estimate().usage. null si le
    // navigateur ne fournit pas de quota (Safari ancien, contexte non sécurisé)
    // ou s'il est nul — pas de division par zéro.
    percent: quota ? Math.round((total / quota) * 100) : null,
  };
}

// Poids cumulé des clefs `miaou-*` de localStorage HORS conversations et
// résumés (migrés en IDB au lot U ; d'éventuels reliquats non purgés ne sont
// pas comptés deux fois). Clef ET valeur pèsent dans le quota.
function measureLocalStorageBytes() {
  if (typeof localStorage === 'undefined') return 0;
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || k.indexOf('miaou-') !== 0) continue;
    if (k === CONV_KEY || k === SUMMARIES_KEY) continue;
    n += utf8ByteLength(k) + utf8ByteLength(localStorage.getItem(k) || '');
  }
  return n;
}

// Poids du store `resources`, mesuré au curseur : `size` porte déjà les octets
// utiles du blob (champ figé à l'écriture), on n'ajoute que la métadonnée.
// Aucun `getAll()` ici — cf. la note de coût en tête de section.
function measureResourcesBytes() {
  return openConvDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('resources', 'readonly');
      const req = tx.objectStore('resources').openCursor();
      let n = 0;
      req.onsuccess = function(e) {
        const cursor = e.target.result;
        if (!cursor) return;
        const rec = cursor.value;
        n += Number(rec && rec.size) || 0;
        n += utf8ByteLength(rec && rec.name || '') + utf8ByteLength(rec && rec.id || '');
        cursor.continue();
      };
      tx.oncomplete = function() { resolve(n); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

function measureSkillsBytes() {
  return openConvDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('skills', 'readonly');
      const req = tx.objectStore('skills').getAll();
      let n = 0;
      req.onsuccess = function(e) { n = sumRecordBytes(e.target.result || []); };
      tx.oncomplete = function() { resolve(n); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// Point d'entrée unique de l'état des lieux. Jamais de rejet : une mesure
// partiellement indisponible (IDB inaccessible, estimate() absent) doit
// dégrader l'affichage, pas le casser.
async function collectStorageReport() {
  const settings = measureLocalStorageBytes();
  let conversations = 0, summaries = 0, resources = 0, skills = 0;
  try { conversations = sumRecordBytes(await readAllConversationsFromDB()); } catch (e) {}
  try { summaries = sumRecordBytes(await readAllSummariesFromDB()); } catch (e) {}
  try { resources = await measureResourcesBytes(); } catch (e) {}
  try { skills = await measureSkillsBytes(); } catch (e) {}
  // Appelé pour son `quota` UNIQUEMENT (son `usage` est écarté, cf. la note en
  // tête de section) : l'appel n'est donc pas superflu, ne pas le retirer.
  let estimate = null;
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    try { estimate = await navigator.storage.estimate(); } catch (e) {}
  }
  return buildStorageReport(
    { settings, conversations, summaries, resources, skills },
    estimate
  );
}
