/* ── storage.js ────────────────────────────────────────────────────────────
   Persistance localStorage : réglages, historique des conversations, index
   des résumés (avec tombstones réversibles). Trois clés distinctes.
   ────────────────────────────────────────────────────────────────────────── */

const SETTINGS_KEY  = 'miaou-settings';
const CONV_KEY      = 'miaou-conversations';
const SUMMARIES_KEY = 'miaou-summaries';

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
    .map(c => ({ id: c.id, title: c.title, timestamp: c.timestamp, updatedAt: c.updatedAt, pinned: !!c.pinned }))
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

// Entrées actives : non-supprimées.
function listMemoryEntries() {
  return loadMemories().filter(e => e && !e.suppressed);
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
