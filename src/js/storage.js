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
  showModelSelector: false, // sélecteur de modèle dans le composer
  sidebarWidth: 264,       // largeur de la sidebar (px), redimensionnable 264 → 528
  includeToolsInSystemPrompt: false, // injecter toolsSystemPrompt() dans le message système
  saveJsonResponses: false, // créer des ressources pour les réponses JSON/texte des outils (debug)
  intentTracing: true,      // demander au modèle de décrire ses appels d'outils en langage naturel
  confirmSkillAutoUse: true, // ask_confirmation avant d'agir sur une skill lue (stage 2 autotrigger)
  contextWindow: '', // taille de fenêtre de contexte (tokens), global, '' = inconnu (brief B, D5/B1-a)
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
    vision,
  };
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
}

// Serveur actif effectif : l'id persisté s'il pointe encore sur un serveur
// existant, sinon le premier du tableau (jamais d'état "configuré=true sans
// serveur" tant qu'au moins une carte existe), sinon null.
function activeApiServer() {
  const servers = loadApiServers();
  if (!servers.length) return null;
  const byId = getApiServer(getActiveApiServerId());
  return byId || servers[0];
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
    showCalls: o.showCalls !== false,
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

// ── Conversations ───────────────────────────────────────────────────────────
// Stockage simple : un tableau d'objets { id, title, timestamp, messages }.

function loadConversations() {
  try { return JSON.parse(localStorage.getItem(CONV_KEY)) || []; }
  catch (e) { return []; }
}

function persistConversations(arr) {
  localStorage.setItem(CONV_KEY, JSON.stringify(arr));
}

function listAllConversations() {
  return loadConversations()
    .map(c => ({ id: c.id, title: c.title, timestamp: c.timestamp, updatedAt: c.updatedAt, pinned: !!c.pinned, spaceId: c.spaceId || DEFAULT_SPACE_ID }))
    .sort((a, b) => (b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0));
}

function loadConversation(id) {
  return loadConversations().find(c => c.id === id) || null;
}

function saveConversation(conv) {
  const arr = loadConversations();
  const i = arr.findIndex(c => c.id === conv.id);
  if (i >= 0) arr[i] = conv; else arr.push(conv);
  persistConversations(arr);
  return conv;
}

function deleteConversation(id) {
  persistConversations(loadConversations().filter(c => c.id !== id));
}

// Épingle/désépingle une conversation. Retourne le nouvel état (bool) ou null
// si la conversation n'existe pas (création à la volée pas encore matérialisée).
function toggleConversationPin(id) {
  const arr = loadConversations();
  const c = arr.find(x => x.id === id);
  if (!c) return null;
  c.pinned = !c.pinned;
  persistConversations(arr);
  return c.pinned;
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

function loadSummaries() {
  try { return JSON.parse(localStorage.getItem(SUMMARIES_KEY)) || {}; }
  catch (e) { return {}; }
}

function persistSummaries(obj) {
  localStorage.setItem(SUMMARIES_KEY, JSON.stringify(obj));
}

function getSummaryEntry(id) {
  const all = loadSummaries();
  return Object.prototype.hasOwnProperty.call(all, id) ? all[id] : null;
}

// Toutes les entrées de l'index NON tombstonées, sous forme de tableau.
function listSummaryEntries() {
  return Object.values(loadSummaries()).filter(e => e && !e.suppressed);
}

function saveSummary(id, data) {
  const all = loadSummaries();
  all[id] = Object.assign({ id }, data);
  persistSummaries(all);
}

// Suppression volontaire : pose une tombstone (réversible). On CONSERVE les
// données du résumé (titre, texte, mots-clés, messageCount) sous le flag, pour
// une ré-autorisation instantanée sans régénérer. Le flag suspend l'usage :
// recherche et outils ignorent les entrées `suppressed`.
function suppressSummary(id) {
  const all = loadSummaries();
  const prev = all[id] || { id };
  all[id] = Object.assign({}, prev, { id, suppressed: true });
  persistSummaries(all);
}

// Ré-autorisation : si le résumé a été conservé sous la tombstone, on retire
// simplement le flag (retour instantané à l'état d'avant). Sinon (tombstone
// sans données), on retire l'entrée → la conversation redevient candidate.
function restoreSummary(id) {
  const all = loadSummaries();
  const e = all[id];
  if (!e) return;
  if (e.summary) { delete e.suppressed; all[id] = e; }
  else { delete all[id]; }
  persistSummaries(all);
}

// Effacement dur (utilisé quand la conversation elle-même disparaît).
function deleteSummaryEntry(id) {
  const all = loadSummaries();
  delete all[id];
  persistSummaries(all);
}

// Candidate = absente de l'index (ni résumé, ni tombstone).
function isSummaryCandidate(id) {
  return getSummaryEntry(id) === null;
}

// Conversations à résumer au démarrage : absentes de l'index et substantielles.
function backfillCandidates() {
  return loadConversations().filter(c =>
    isSummaryCandidate(c.id) && hasSubstance(c.messages));
}

// ── Souvenirs utilisateur (miaou-memories) ───────────────────────────────────
// Schéma : { id, content, created_at, updated_at, suppressed }
// Tombstone : { ..., suppressed: true }  ← conserve content pour affichage

const MEMORIES_KEY = 'miaou-memories';

function genMemoryId() { return 'm' + Date.now().toString(36); }

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
  const convs = loadConversations();
  let convsChanged = false;
  for (const c of convs) {
    if (!c.spaceId) { c.spaceId = DEFAULT_SPACE_ID; convsChanged = true; }
  }
  if (convsChanged) persistConversations(convs);
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
// Les 9 clés localStorage du schéma (miaou-spaces + miaou-active-space
// ajoutées par la feature Spaces, lot C). Référencée uniquement en corps de
// fonction depuis les autres fichiers (contrainte test runner, cf. CLAUDE.md)
// — jamais au top-level d'un fichier tiers.
const EXPORT_KEYS = [
  'miaou-settings',
  'miaou-conversations',
  'miaou-summaries',
  'miaou-memories',
  'miaou-api-servers',
  'miaou-active-api-server',
  'miaou-mcp-servers',
  'miaou-spaces',
  'miaou-active-space',
];

// Construit le payload d'export complet. `lsSnapshot` : objet { clé: valeur
// DÉSÉRIALISÉE } pour les 9 clés (l'appelant lit localStorage + JSON.parse, ou
// fournit la string brute pour miaou-active-api-server / miaou-active-space —
// seules clés non-JSON du schéma). `skills`/`resources` : tableaux bruts issus
// de getAllSkillRecords()/getAllResources() ; `resources[].data` (ArrayBuffer)
// doit déjà avoir été converti en base64 par l'appelant (arrayBufferToBase64,
// resources.js) — cette fonction reste pure, sans dépendance IDB.
function buildExportPayload(lsSnapshot, skills, resources) {
  const ls = lsSnapshot || {};
  return {
    format: 'miaou-export',
    version: 1,
    exportedAt: Date.now(),
    localStorage: {
      'miaou-settings': ls['miaou-settings'] || {},
      'miaou-conversations': Array.isArray(ls['miaou-conversations']) ? ls['miaou-conversations'] : [],
      'miaou-summaries': ls['miaou-summaries'] || {},
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
    },
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
  if (typeof obj.version !== 'number' || obj.version > 1) {
    return { ok: false, error: 'Version d\'export non supportée (' + obj.version + ').' };
  }
  const ls = (obj.localStorage && typeof obj.localStorage === 'object') ? obj.localStorage : {};
  const idb = (obj.idb && typeof obj.idb === 'object') ? obj.idb : {};
  const conversations = Array.isArray(ls['miaou-conversations']) ? ls['miaou-conversations'] : [];
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
      memories: memories.length,
      skills: skills.length,
      resources: resources.length,
      servers: apiServers.length + mcpServers.length,
      spaces: spaces.length,
    },
  };
}
