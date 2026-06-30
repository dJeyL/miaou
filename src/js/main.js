/* ── main.js ───────────────────────────────────────────────────────────────
   Orchestration : init, câblage des événements, construction du contexte
   d'appel (message système unique), flux d'envoi, titrage, résumé en sortie,
   backfill au démarrage. Charge en dernier dans le build.
   ────────────────────────────────────────────────────────────────────────── */

// MAX_SUMMARIES (plafond de résumés injectés) est déclaré dans storage.js,
// dérivé de BUILD_CONFIG — n'est référencé ici/ailleurs qu'en corps de fonction.

// ── Logo : source unique (favicon + sidebar) ────────────────────────────────
// Logo MIAOU (chat), encodé en base64 et inliné ici : le SVG d'origine n'est pas
// versionné, le build n'en dépend donc pas. Factorisée via applyLogo().
const LOGO_SRC =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMC' +
  'A2NCA2NCI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnQiIgeDE9IjMyIiB5MT0iMiIgeDI9IjMyIiB5Mj0iNjIiIGdyYW' +
  'RpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiNGRkM5M0MiLz48c3RvcC' +
  'BvZmZzZXQ9Ii41NSIgc3RvcC1jb2xvcj0iI0ZGN0ExQSIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0YyNDMxQS' +
  'IvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxzdHlsZT4uZXlle3RyYW5zZm9ybS1ib3g6ZmlsbC1ib3g7dHJhbnNmb3JtLW' +
  '9yaWdpbjpjZW50ZXI7YW5pbWF0aW9uOm1pYW91LWJsaW5rIDZzIGVhc2UtaW4tb3V0IGluZmluaXRlfUBrZXlmcmFtZXMgbW' +
  'lhb3UtYmxpbmt7MCUsODYlLDEwMCV7dHJhbnNmb3JtOnNjYWxlWSgxKX04OCUsODkle3RyYW5zZm9ybTpzY2FsZVkoLjA4KX' +
  '05MSV7dHJhbnNmb3JtOnNjYWxlWSgxKX05MyUsOTQle3RyYW5zZm9ybTpzY2FsZVkoLjA4KX05NiV7dHJhbnNmb3JtOnNjYW' +
  'xlWSgxKX19QG1lZGlhKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246cmVkdWNlKXsuZXlle2FuaW1hdGlvbjpub25lfX08L3N0eW' +
  'xlPjxnIGZpbGw9InVybCgjZ0IpIj48cGF0aCBkPSJNMTQgMTggTDE4IDUgTDI4IDE4IFoiLz48cGF0aCBkPSJNNTAgMTggTD' +
  'Q2IDUgTDM2IDE4IFoiLz48cmVjdCB4PSI2IiB5PSIxNiIgd2lkdGg9IjUyIiBoZWlnaHQ9IjMwIiByeD0iMTEiLz48cGF0aC' +
  'BkPSJNMTYgNDMgTDE1IDU3IEwyOSA0NCBaIi8+PC9nPjxjaXJjbGUgY2xhc3M9ImV5ZSIgY3g9IjI2IiBjeT0iMzAiIHI9Ij' +
  'MuMyIgZmlsbD0iIzE2MGQwNyIvPjxjaXJjbGUgY2xhc3M9ImV5ZSIgY3g9IjM4IiBjeT0iMzAiIHI9IjMuMyIgZmlsbD0iIz' +
  'E2MGQwNyIvPjxwYXRoIGQ9Ik0yOSAzNyBRMzIgNDAgMzUgMzciIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzE2MGQwNyIgc3Ryb2' +
  'tlLXdpZHRoPSIyLjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvc3ZnPg==';

function applyLogo() {
  $('favicon').href = LOGO_SRC;
  $('brand-logo').src = LOGO_SRC;
  $('topbar-logo').src = LOGO_SRC;
}

// ── État de session ─────────────────────────────────────────────────────────
let currentConvId = null;
let currentThread = [];   // [{ role, content }] — fil visible courant
let needTitle = false;    // titrage auto en attente (conversation neuve)
let titleBefore = '';
let currentConvModel = '';  // override de modèle de la conversation courante ('' = modèle par défaut)

// Modèle effectif pour l'échange courant : override de conversation s'il existe,
// sinon le modèle par défaut des réglages. Ne JAMAIS mélanger les deux dans une
// même variable d'état (override conv vs défaut global).
function activeModel() {
  return (currentConvModel && currentConvModel.trim()) || (loadSettings().model || '');
}

// Fixe l'override de modèle de la conversation courante (choix dans le composer).
// Persiste sur l'objet conversation si elle existe déjà ; n'efface ni ne tronque
// jamais l'historique.
function setConvModel(m) {
  currentConvModel = m || '';
  if (currentConvId) {
    const conv = loadConversation(currentConvId);
    if (conv) {
      if (currentConvModel) conv.model = currentConvModel; else delete conv.model;
      saveConversation(conv);
    }
  }
  syncModelUI();
}

// ── Construction du message système (un seul, concaténé) ────────────────────
function buildSummaryBlock(matches) {
  if (!matches.length) return '';
  const lines = matches.map(m => `- [id: ${m.id}] « ${m.title} » — ${m.summary}`);
  return "Conversations passées potentiellement pertinentes (résumés). " +
         "Si l'une mérite un examen détaillé, appelle get_conversation avec son id " +
         "et with_contents=true. Tu peux aussi appeler list_conversations pour " +
         "parcourir l'historique — sans date pour tout lister, ou avec une date " +
         "pour te limiter à une période.\n" +
         lines.join('\n');
}

// Souvenirs utilisateur actifs injectés en contexte (injection complète, pas de
// filtrage/ranking : volume faible attendu pour un usage personnel).
function buildMemoryEntriesBlock() {
  const entries = listMemoryEntries();
  if (!entries.length) return '';
  const lines = entries.map(e => `- [id: ${e.id}] ${e.content}`);
  return "Souvenirs de l'utilisateur (persistants, à respecter et prendre en compte) :\n" +
         lines.join('\n');
}

// Contenu dynamique par tour : date/heure, modèle actif, résumés injectés, souvenirs.
// Injecté en préfixe du dernier message utilisateur, pas dans le system message,
// pour préserver le préfixe stable et permettre le KV cache prefix matching.
function buildContextBlock(matches) {
  const now = new Date();
  const dateStr = now.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const model = activeModel().trim();
  const lines = ['Date et heure : ' + dateStr + ' (' + tz + ')'];
  if (model) lines.push('Modèle : ' + model);
  const parts = [lines.join('\n')];
  const summaries = buildSummaryBlock(matches || []);
  if (summaries) parts.push(summaries);
  const memories = buildMemoryEntriesBlock();
  if (memories) parts.push(memories);
  const inner = parts.join('\n\n');
  return '<miaou_context>\nCe bloc est injecté automatiquement par l\'application.' +
    ' Utilise ces informations si elles sont pertinentes,' +
    ' mais ne les mentionne pas spontanément ni ne les acquitte.\n\n' +
    inner + '\n</miaou_context>\n\n';
}

// Listing dynamique des skills autotrigger (stage 2) : SIBLING de buildContextBlock/
// <miaou_context>, PAS une section dedans — mécanisme structurellement distinct
// (cf. brief stage 2). Recalculé à chaque tour depuis le cache courant, comme
// <miaou_context> ; reflète tout changement enabled/autotrigger entre deux tours
// sans cas particulier. '' si aucune skill éligible (pas de tokens pour une liste
// vide). JAMAIS construit via resolveSend/bakeSkillMessage (chemin slash, stage 1,
// figé au moment de l'envoi) — ce bloc-ci est éphémère et n'entre jamais dans
// currentThread/localStorage.
function buildSkillsContextBlock() {
  const skills = getAutotriggerSkillsMeta();
  if (!skills.length) return '';
  const lines = skills.map(s => '- [slug: ' + s.slug + '] ' + (s.name || s.slug) +
    (s.description ? ' — ' + s.description : ''));
  return '<miaou_skills_context>\nSkills disponibles pour usage proactif (voir doctrine skills ' +
    'pour la procédure d\'utilisation) :\n\n' + lines.join('\n') + '\n</miaou_skills_context>\n\n';
}

// Ordre : racine → énumération outils (si ON) → doctrine intent (si ON) → doctrine
// skills (si skills autotrigger) → utilisateur.
function buildSystemMessage() {
  const parts = [];
  const settings = loadSettings();
  if (TOOLS.length) {
    parts.push(ROOT_SYSTEM_PROMPT);
    if (settings.includeToolsInSystemPrompt) parts.push(toolsSystemPrompt());
    const intentPart = intentDoctrinePrompt();
    if (intentPart) parts.push(intentPart);
    const skillPart = skillDoctrinePrompt();
    if (skillPart) parts.push(skillPart);
  }
  const sysUser = (settings.systemPrompt || '').trim();
  if (sysUser) parts.push(sysUser);
  return { role: 'system', content: parts.join('\n\n---\n\n') };
}

// ── Navigation entre conversations ──────────────────────────────────────────
async function openConversation(id) {
  const conv = loadConversation(id);
  if (!conv) return;
  currentConvId = id;
  currentThread = (conv.messages || []).map(m => {
    if (isAckRole(m.role)) {
      const a = { role: m.role, id: m.id };
      if (m.kind != null)        a.kind = m.kind;
      if (m.ackType != null)     a.ackType = m.ackType;   // legacy, préservé tel quel
      if (m.content != null)     a.content = m.content;
      if (m.prevContent != null) a.prevContent = m.prevContent;
      if (m.title != null)       a.title = m.title;
      if (m.count != null)       a.count = m.count;
      if (m.server != null)           a.server = m.server;
      if (m.name != null)             a.name = m.name;
      if (m.resourceName != null)     a.resourceName = m.resourceName;
      if (m.mime != null)             a.mime = m.mime;
      if (m.size != null)             a.size = m.size;
      if (m.error)                    a.error = true;
      if (m.resolved)                 a.resolved = true;
      if (m.args != null)             a.args = m.args;
      if (m.result != null)           a.result = m.result;
      if (m.ts != null)               a.ts = m.ts;
      if (m.group != null)            a.group = m.group;
      if (m.assistantText != null)    a.assistantText = m.assistantText;
      if (m.intent != null)           a.intent = m.intent;
      if (m.slug != null)             a.slug = m.slug;
      return a;
    }
    const o = { role: m.role, content: m.content, model: m.model };
    if (m.ts) o.ts = m.ts;
    if (m.reasoning) o.reasoning = m.reasoning;
    // littéral (slash-commande skill). Normalise l'ancien champ `display` (données
    // de test antérieures au renommage) vers `displayText` à la lecture.
    if (m.displayText != null) o.displayText = m.displayText;
    else if (m.display != null) o.displayText = m.display;
    return o;
  });
  currentConvModel = conv.model || '';
  needTitle = false;
  setTitle(conv.title || '');
  await loadConversationResources(id);   // peuple le session cache avant renderThread
  renderThread(currentThread);
  renderConvList();
  syncModelUI();
}

function resetToEmpty() {
  currentConvId = null;
  currentThread = [];
  currentConvModel = '';   // nouvelle conversation → modèle par défaut
  needTitle = false;
  $('thread').innerHTML = '';
  clearMemoryProposals();   // cartes de proposition détruites avec le thread
  showWelcome();
  setTitle('');
  syncConvDownloadBtn();
  renderConvList();
  syncModelUI();
}

function selectConv(id) {
  if (id === currentConvId) return;
  const leaving = currentConvId;
  openConversation(id);
  summarizeIfNeeded(leaving);   // résumé de la conversation quittée (arrière-plan)
  if (isMobileLayout()) closeSidebarMobile();
}

function newConversation() {
  const leaving = currentConvId;
  resetToEmpty();
  const ta = $('composer-text');
  if (ta && !ta.disabled) ta.focus();
  summarizeIfNeeded(leaving);   // résumé de la conversation quittée (arrière-plan)
}

function togglePin(id) {
  toggleConversationPin(id);
  renderConvList();
}

// Exporte la conversation courante en Markdown. Messages visibles (user +
// assistant) ; les acks d'outils ENRICHIS (args+result présents) précédant un
// message assistant sont rendus en trace (formatToolAcksMd) juste avant le
// texte de ce tour — acks legacy (sans args) silencieusement omis, comme avant.
// Appelé depuis le bouton topbar (onclick="downloadConvMd()").
function downloadConvMd() {
  if (!currentThread || !currentThread.length) return;
  const conv = currentConvId ? loadConversation(currentConvId) : null;
  const title = (conv && conv.title) || 'miaou-conversation';
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'miaou-conversation';

  const lines = [];
  let pendingAcks = [];
  for (const m of currentThread) {
    if (isAckRole(m.role)) {
      if (m.args != null) pendingAcks.push(m);   // legacy (sans args) : omis de l'export
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const timeStr = m.ts ? ' — ' + formatMessageTime(m.ts, Date.now()) : '';
    const label = (m.role === 'user' ? '### Vous' : '### MIAOU') + timeStr;
    lines.push(label);
    lines.push('');
    if (m.role === 'assistant' && pendingAcks.length) {
      lines.push(formatToolAcksMd(pendingAcks));
      lines.push('');
    }
    pendingAcks = [];
    // Export = littéral affiché (displayText) si présent (slash-commande skill),
    // pas le corps de skill injecté dans content.
    lines.push((m.role === 'user' && m.displayText != null ? m.displayText : m.content) || '');
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  downloadFile(slug + '.md', lines.join('\n').trimEnd() + '\n', 'text/markdown');
}

// Annulation d'un ack : dispatch via ACK_KINDS[kind].undo (forgetMemory pour
// create/update, restoreMemory pour delete). Les lectures (undo: null) n'ont pas
// de bouton, donc n'arrivent jamais ici. Reçoit l'ENTRÉE et le NŒUD exacts (closure
// de buildToolAck) : un create et un delete du même souvenir partagent le même
// `entry.id`, donc on ne peut PAS retrouver l'ack par id sans ambiguïté. L'id du
// souvenir (entry.id) ne sert qu'à l'opération mémoire (forget/restore).
function undoToolAck(entry, wrap) {
  if (!entry || entry.resolved) return;
  const spec = ACK_KINDS[ackKindOf(entry)];
  if (!spec || !spec.undo) return;
  spec.undo(entry.id, entry);   // entry pour memory_update (restaure prevContent) ; create/delete l'ignorent
  entry.resolved = true;
  if (wrap) {
    wrap.classList.add('resolved');
    const btn = wrap.querySelector('.ack-undo');
    if (btn) btn.replaceWith(Object.assign(document.createElement('span'), { className: 'ack-resolved', textContent: 'annulé' }));
  }
  persistCurrent();
}

function deleteConv(id) {
  deleteConversation(id);
  deleteSummaryEntry(id);   // l'index de résumé devient orphelin sinon
  deleteResourcesByConversation(id).catch(function() {});   // cascade IDB (hard-delete)
  if (id === currentConvId) resetToEmpty();
  else renderConvList();
}

// Crée la conversation à la volée au premier envoi (pas avant).
function ensureConversation() {
  if (currentConvId) return;
  const id = 'c' + Date.now().toString(36);
  const manualTitle = $('conv-title').textContent.trim();
  saveConversation({ id, title: manualTitle, timestamp: Date.now(), messages: [] });
  currentConvId = id;
  currentThread = [];
  needTitle = !manualTitle;   // titre déjà saisi → pas d'auto-titrage
  renderConvList();
}

function persistCurrent() {
  if (!currentConvId) return;
  const conv = loadConversation(currentConvId) || { id: currentConvId, timestamp: Date.now() };
  conv.messages = currentThread.map(m => {
    if (isAckRole(m.role)) {
      const o = { role: m.role, id: m.id };
      if (m.kind != null)        o.kind = m.kind;
      if (m.ackType != null)     o.ackType = m.ackType;   // legacy passthrough, jamais réécrit
      if (m.content != null)     o.content = m.content;
      if (m.prevContent != null) o.prevContent = m.prevContent;
      if (m.title != null)       o.title = m.title;
      if (m.count != null)       o.count = m.count;
      if (m.server != null)           o.server = m.server;
      if (m.name != null)             o.name = m.name;
      if (m.resourceName != null)     o.resourceName = m.resourceName;
      if (m.mime != null)             o.mime = m.mime;
      if (m.size != null)             o.size = m.size;
      if (m.error)                 o.error = true;
      if (m.resolved)              o.resolved = true;
      if (m.args != null)          o.args = m.args;
      if (m.result != null)        o.result = m.result;
      if (m.ts != null)            o.ts = m.ts;
      if (m.group != null)         o.group = m.group;
      if (m.assistantText != null) o.assistantText = m.assistantText;
      if (m.intent != null)        o.intent = m.intent;
      if (m.slug != null)          o.slug = m.slug;
      return o;
    }
    const o = { role: m.role, content: m.content };
    if (m.model) o.model = m.model;
    if (m.ts) o.ts = m.ts;
    if (m.reasoning) o.reasoning = m.reasoning;
    if (m.displayText != null) o.displayText = m.displayText;   // littéral (slash-commande skill)
    return o;
  });
  if (!conv.timestamp) conv.timestamp = Date.now();
  conv.updatedAt = Date.now();
  if (currentConvModel) conv.model = currentConvModel; else delete conv.model;
  // Pas de titre provisoire : « Nouvelle conversation » (placeholder topbar +
  // fallback liste) jusqu'au titrage en arrière-plan.
  saveConversation(conv);
  renderConvList();
}

// ── Titre éditable ──────────────────────────────────────────────────────────
function wireTitleEditing() {
  const titleEl = $('conv-title');
  titleEl.addEventListener('focus', () => {
    titleBefore = titleEl.textContent;
    requestAnimationFrame(() => placeCaretEnd(titleEl));
  });
  titleEl.addEventListener('keydown', onTitleKey);
  titleEl.addEventListener('blur', onTitleBlur);
}
function onTitleKey(e) {
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.target.textContent = titleBefore; e.target.blur(); }
}
function onTitleBlur(e) {
  const el = e.target;
  const t = el.textContent.trim();
  if (!t) {
    el.textContent = titleBefore;
    document.title = (titleBefore || 'Nouvelle conversation') + ' — MIAOU';
    return;
  }
  document.title = t + ' — MIAOU';
  if (currentConvId) {
    needTitle = false;   // titre fixé manuellement : on ne le régénère plus
    const conv = loadConversation(currentConvId);
    if (conv) { conv.title = t; saveConversation(conv); renderConvList(); }
    const entry = getSummaryEntry(currentConvId);
    if (entry) { entry.title = t; saveSummary(currentConvId, entry); }
  }
}

// ── Réglages ────────────────────────────────────────────────────────────────
function onSaveSettings() {
  const obj = {
    url: $('set-url').value.trim(),
    key: $('set-key').value.trim(),
    model: $('set-model').value.trim(),
    systemPrompt: $('set-system').value,
    highlight: $('set-highlight').checked,
    summaryInjectionMode: pendingSummaryInjectionMode,
    theme: pendingTheme,
    showModelSelector: $('set-modelselector').checked,
    includeToolsInSystemPrompt: $('set-tools-in-prompt').checked,
    intentTracing: $('set-intent-tracing').checked,
    saveJsonResponses: $('set-save-json').checked,
    confirmSkillAutoUse: $('set-confirm-skill-autouse').checked,
  };
  saveSettings(obj);
  highlightEnabled = obj.highlight;
  syncConfigured();
  syncModelUI();        // labels + visibilité du sélecteur (selon cache déjà chargé)
  prefetchModels();     // (re)charge la liste si besoin, puis re-sync
  renderThread(currentThread);   // ré-applique/retire la coloration
  closeSettings();
}

// Charge la liste des modèles (cache de session) puis met à jour l'UI. Échec
// silencieux : le sélecteur reste masqué, le modèle par défaut reste utilisé.
async function prefetchModels() {
  try { await loadModelsCached(); } catch (e) { /* sélecteur masqué */ }
  syncModelUI();
}

// ── Serveurs MCP distants : orchestration ────────────────────────────────────
// Connecte (handshake + tools/list) tous les serveurs activés. Fire-and-forget,
// encadré par l'indicateur d'activité. Échec d'un serveur = dégradation gracieuse
// (ses outils n'apparaissent pas), les autres tiennent (cf. D10).
async function reconnectMcpServers() {
  const servers = listEnabledMcpServers();   // storage.js
  if (!servers.length) return;
  await runBackgroundTask('connexion MCP…', () => Promise.all(servers.map(s => connectMcpServer(s))));
  renderMcpServersIfOpen();
}

// Persiste une carte serveur (valide → upsert → (re)connecte → re-rend). Lié par
// addEventListener dans buildMcpCard (closure : carte + nom d'origine).
async function onSaveMcpCard(cardEl, originalName) {
  const get = (sel) => { const el = cardEl.querySelector(sel); return el ? el.value : ''; };
  const name = get('.mcp-name').trim();
  const others = loadMcpServers().map(s => s.name).filter(n => n !== originalName);
  const nameErr = validateMcpServerName(name, others);
  if (nameErr) { showMcpCardError(cardEl, nameErr); return; }
  const url = get('.mcp-url').trim();
  if (!url) { showMcpCardError(cardEl, 'URL requise.'); return; }
  const enabledEl = cardEl.querySelector('.mcp-enabled');
  const tmoRaw = parseInt(get('.mcp-timeout'), 10);
  const showCallsEl = cardEl.querySelector('.mcp-show-calls');
  const server = {
    name, url,
    transport: get('.mcp-transport') || 'streamable-http',
    enabled: enabledEl ? enabledEl.checked : true,
    authorization_token: get('.mcp-token'),
    timeout: (Number.isFinite(tmoRaw) && tmoRaw > 0) ? tmoRaw : 30000,
    toolAllowlist: parseToolFilterList(get('.mcp-allow')),
    toolDenylist: parseToolFilterList(get('.mcp-deny')),
    showCalls: showCallsEl ? showCallsEl.checked : true,
  };
  // Renommage : l'identité est le `name`, on retire l'ancienne entrée + cache.
  if (originalName && originalName !== name) { deleteMcpServer(originalName); disconnectMcpServer(originalName); }
  upsertMcpServer(server);
  disconnectMcpServer(name);
  renderMcpServers();
  if (server.enabled) {
    await runBackgroundTask('connexion MCP…', () => connectMcpServer(getMcpServer(name)));
    renderMcpServers();
  }
}

async function onDeleteMcpCard(cardEl, originalName) {
  if (originalName) { deleteMcpServer(originalName); disconnectMcpServer(originalName); }
  renderMcpServers();
}

// ── Skills : persistance (orchestration depuis le drawer de gestion) ──────────
// Valide → écrit IDB (putSkill synchronise le cache mémoire) → re-rend la liste.
// Le rendu/édition des cartes vit dans ui.js (buildSkillCard) ; ici la logique de
// validation + persistance, comme onSaveMcpCard.
async function onSaveSkillCard(cardEl, originalSlug) {
  const get = (sel) => { const el = cardEl.querySelector(sel); return el ? el.value : ''; };
  const slug = get('.skill-slug').trim();
  const others = listAllSkillsCache().map(s => s.slug).filter(sl => sl !== originalSlug);
  const slugErr = validateSkillSlug(slug, others);
  if (slugErr) { showSkillCardError(cardEl, slugErr); return; }
  const enabledEl = cardEl.querySelector('.skill-enabled');
  const autotriggerEl = cardEl.querySelector('.skill-autotrigger');
  const record = {
    slug,
    name: get('.skill-name').trim(),
    description: get('.skill-desc').trim(),
    enabled: enabledEl ? enabledEl.checked : true,
    autotrigger: autotriggerEl ? autotriggerEl.checked : false,
    content: get('.skill-content'),
  };
  // Renommage de slug : la clé IDB change → retirer l'ancien enregistrement.
  if (originalSlug && originalSlug !== slug) { await deleteSkillDb(originalSlug); }
  await putSkill(record);
  renderSkills();
}

async function onDeleteSkillCard(cardEl, originalSlug) {
  if (originalSlug) await deleteSkillDb(originalSlug);
  renderSkills();
}

// Toggle enabled depuis la vue liste : bascule IDB + cache, puis re-rend.
async function onToggleSkill(slug) {
  await toggleSkillEnabled(slug);
  renderSkills();
}

// ── Flux d'envoi ────────────────────────────────────────────────────────────
// Bouton unique du composer : envoie, ou interrompt si un stream est en cours.
function onSendBtn() {
  if (sending) abortStream();
  else sendMessage();
}

// Résout une saisie utilisateur (littéral) en payload d'envoi. CHEMIN UNIQUE de
// détection/injection de slash-commande skill, partagé par la saisie composer
// (sendMessage) ET la réédition d'un message (editUserMessage) — pas de duplication.
// Le contenu de chaque skill est re-résolu à CHAQUE appel (contenu COURANT, jamais
// figé d'un envoi antérieur) : éditer un message au tour N rebake avec le contenu
// actuel. Injection DÉTERMINISTE côté client (≠ buildContextBlock/miaou_context,
// recalculé par tour). Multi-skill : toutes les occurrences `/slug` détectées par
// findSlashTriggers (position 0 OU précédées d'un espace, cf. skills.js) sont
// résolues et bakées en fin de message, dans l'ordre d'apparition. SEULE
// l'occurrence en position 0 bloque l'envoi si non reconnue — ailleurs un `/slug`
// non matché reste du texte littéral, sans bake ni blocage (brief §2). Retours :
//   { ok:true,  literal, content }            — texte normal (content === literal)
//   { ok:true,  literal, content, isSkill }   — au moins un slash résolu (content = bakové)
//   { ok:false, error }                        — slug en position 0 inconnu / désactivé / indisponible
async function resolveSend(literal) {
  const triggers = findSlashTriggers(literal);
  if (!triggers.length) return { ok: true, literal, content: literal, isSkill: false };

  const resolved = [];
  for (const t of triggers) {
    const meta = getSkillMeta(t.slug);   // cache mémoire (skills.js)
    const known = meta && meta.enabled !== false;
    if (!known) {
      if (t.atStart) return { ok: false, error: 'Skill inconnue ou désactivée : /' + t.slug };
      continue;   // mid-message non reconnu : reste texte littéral, pas de blocage
    }
    let content = null;
    try { content = await getSkillContent(t.slug); } catch (e) { content = null; }
    if (content == null) {
      if (t.atStart) return { ok: false, error: 'Contenu de la skill indisponible : /' + t.slug };
      continue;
    }
    resolved.push({ slug: t.slug, content });
  }
  if (!resolved.length) return { ok: true, literal, content: literal, isSkill: false };
  return { ok: true, literal, content: bakeSkillMessage(literal, resolved), isSkill: true };
}

async function sendMessage() {
  if (!configured || sending) return;
  const ta = $('composer-text');
  const text = ta.value.trim();
  if (!text) return;

  // On résout AVANT de vider le composer : un slug invalide ne perd pas la saisie
  // ni ne consomme un tour modèle.
  const r = await resolveSend(text);
  if (!r.ok) { showComposerSkillError(r.error); return; }

  ta.value = ''; ta.style.height = 'auto';
  clearComposerSkillError();
  hideSkillAutocomplete();

  // Confirmation en attente + saisie libre : la frappe vaut réponse/correction
  // (brief §4.5). On lève le widget avant d'envoyer comme un message normal.
  if (_confirmPending) dismissConfirmation();

  sendUserText(r.literal, r.isSkill ? r.content : undefined);
}

// Cœur d'un envoi utilisateur : crée la conv au besoin, pousse le message,
// persiste, relance la génération. Partagé par la saisie composer (sendMessage)
// et la reprise « fork B » d'ask_confirmation (Accepter → « Oui » / Rejeter → « Non »).
// `bakedContent` (optionnel) : contenu réellement envoyé/stocké pour le modèle
// (slash-commande skill = littéral + corps du skill). `text` reste le littéral
// affiché dans la bulle et conservé en `displayText`.
function sendUserText(text, bakedContent) {
  clearComposerSkillError();   // tout envoi effectif lève l'erreur skill du composer
  ensureConversation();
  const ts = Date.now();
  appendUserMessage(text, ts);
  const msg = { role: 'user', content: bakedContent != null ? bakedContent : text, ts };
  if (bakedContent != null) msg.displayText = text;
  currentThread.push(msg);
  persistCurrent();

  runGenerationFromCurrentThread();
}

// Cœur de l'envoi : recherche mémoire (sur le dernier message utilisateur),
// bannière éventuelle, puis dispatch. Partagé par l'envoi normal et la relance
// après édition d'un message — pour ne pas dupliquer la logique mémoire+outils.
// Pré-requis : le dernier message utilisateur est déjà dans currentThread.
function runGenerationFromCurrentThread() {
  const lastUser = currentThread.slice().reverse().find(m => m.role === 'user');
  // displayText = littéral tapé (slash-commande skill) ; à défaut, content. La
  // recherche mémoire porte sur le littéral, pas sur le corps du skill injecté.
  const text = lastUser ? (lastUser.displayText != null ? lastUser.displayText : lastUser.content) : '';

  const settings = loadSettings();
  let matches = [];
  if (settings.summaryInjectionMode !== 'never') matches = searchSummaries(text, currentConvId);

  if (settings.summaryInjectionMode === 'propose' && matches.length) {
    showSummaryBanner(matches, {
      inject: () => dispatchSend(matches),
      ignore: () => dispatchSend([]),
      always: () => { saveSettings({ summaryInjectionMode: 'auto' });  setSummaryInjectionModeUI('auto');  dispatchSend(matches); },
      never:  () => { saveSettings({ summaryInjectionMode: 'never' }); setSummaryInjectionModeUI('never'); dispatchSend([]); },
    });
    return;
  }

  dispatchSend(settings.summaryInjectionMode === 'auto' ? matches : []);
}

// Édition d'un message utilisateur passé (par index dans currentThread) :
// tronque tout ce qui suit, remplace le contenu, persiste, puis relance la
// génération par le même chemin que l'envoi normal. Passe par resolveSend (même
// détection/injection slash que l'envoi composer) : éditer en `/slug …` réinjecte
// le contenu COURANT de la skill, et un slug invalide n'altère PAS le thread.
// Retourne le message d'erreur (slug invalide) pour que l'appelant l'affiche SOUS
// LA ZONE D'ÉDITION (pas le composer) ; null en cas de succès.
async function editUserMessage(index, newText) {
  if (sending) return null;                     // pas d'édition pendant un stream
  const t = (newText || '').trim();
  if (!t) return null;
  if (index < 0 || index >= currentThread.length) return null;
  if (currentThread[index].role !== 'user') return null;

  // Résoudre AVANT toute mutation : un slug invalide laisse le thread intact et la
  // bulle en mode édition (l'utilisateur corrige), erreur remontée à l'appelant.
  const r = await resolveSend(t);
  if (!r.ok) return r.error;

  currentThread = currentThread.slice(0, index + 1);
  const msg = { role: 'user', content: r.content, ts: Date.now() };
  if (r.isSkill) msg.displayText = r.literal;
  currentThread[index] = msg;
  persistCurrent();                             // troncature écrite avant relance
  renderThread(currentThread);                  // détruit la bulle d'édition (+ son erreur)
  runGenerationFromCurrentThread();
  return null;
}

async function dispatchSend(matches) {
  hideSummaryBanner();
  const model = activeModel();   // modèle qui va produire cette réponse (override conv ou défaut)
  const sys = buildSystemMessage();
  // Résout les références de ressources ([resource_ref:…]) dans les entry.result
  // des tool-acks avant d'appeler expandThread. Inline → contenu UTF-8 décodé
  // (byte-identique d'un tour à l'autre via session cache) ; binary → descripteur.
  const threadMsgs = expandThread(resolveResourceRefs(currentThread));

  // Injection éphémère du contexte dynamique (date/heure, modèle, mémoire) +,
  // en sibling, le listing skills autotrigger — en préfixe du dernier message
  // utilisateur, pour préserver le préfixe stable (system + historique[0..N-1])
  // et permettre le KV cache prefix matching. Deux blocs distincts, concaténés
  // côte à côte (skills puis contexte), pas fusionnés en un seul appel.
  const lastUserIdx = threadMsgs.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);
  if (lastUserIdx >= 0) {
    const skillsCtx = buildSkillsContextBlock();
    const ctx = buildContextBlock(matches);
    threadMsgs[lastUserIdx] = {
      role: 'user',
      content: skillsCtx + ctx + '\n\n---\n\n' + threadMsgs[lastUserIdx].content,
    };
  }

  const apiMessages = [sys].concat(threadMsgs).filter(Boolean);

  let wrap = startAssistantMessage(model);
  // Acks MCP pré-rendus (avant await réseau) : { ack: descripteur brut, entry:
  // entrée currentThread, node: nœud DOM }. Stockés ici pour que onToolAcks
  // puisse rétro-appliquer la classe d'erreur si ack.error a été posé après l'await.
  let earlyRendered = [];
  setSending(true);
  try {
    await runConversation(apiMessages, {
      model,
      onDelta: (full) => streamInto(wrap, full),
      onReasoning: (full) => setReasoning(wrap, full),
      onToolTour: (content) => {
        if (content && content.trim()) {
          // Le tour tool_calls a produit du texte visible : on le finalise dans
          // sa propre bulle et on en ouvre une nouvelle pour la suite.
          const tourTs = Date.now();
          currentThread.push({ role: 'assistant', content, model, ts: tourTs });   // avant finalizeAssistant, cf. onFinal
          finalizeAssistant(wrap, content);
          const tsEl = wrap.querySelector('.msg-ts');
          if (tsEl) { tsEl.textContent = '· ' + formatMessageTime(tourTs, Date.now()); tsEl.removeAttribute('hidden'); }
          persistCurrent();
          wrap = startAssistantMessage(model);
        } else {
          resetAssistant(wrap);
        }
      },
      // Vidange ANTICIPÉE des acks MCP poussés de manière synchrone par
      // callRemoteTool AVANT son premier await. Appelé par api.js juste après le
      // démarrage de callTool() et AVANT l'await, pour que la ligne s'affiche
      // pendant le round-trip réseau (pas seulement après). Les acks des outils
      // internes (synchrones) ne sont jamais ici — ils arrivent dans onToolAcks.
      onEarlyAcks: () => {
        const pending = getPendingToolAcks();
        clearPendingToolAcks();
        for (const ack of pending) {
          const entry = { role: 'tool-ack', kind: ack.kind };
          if (ack.server != null)        entry.server = ack.server;
          if (ack.name != null)          entry.name = ack.name;
          if (ack.intent != null)        entry.intent = ack.intent;
          // Champs d'enrichissement cross-turn (peuvent déjà être posés si un
          // outil interne précédent a été drainé ici en même temps qu'un MCP).
          if (ack.args != null)          entry.args = ack.args;
          if (ack.result != null)        entry.result = ack.result;
          if (ack.ts != null)            entry.ts = ack.ts;
          if (ack.group != null)         entry.group = ack.group;
          if (ack.assistantText != null) entry.assistantText = ack.assistantText;
          currentThread.push(entry);
          const node = placeToolAck(wrap, entry);
          earlyRendered.push({ ack, entry, node });
        }
        scrollBottom();
      },
      // Vidange des acks d'outils APRÈS l'exécution des outils d'un tour, donc
      // AVANT la réponse finale : ils sont la provenance de la réponse et doivent
      // la précéder. Placés DANS la bulle assistant (`wrap`), entre l'en-tête
      // (icône + nom du modèle) et le corps (patienteur puis réponse), via
      // placeToolAck. Pas de persistCurrent ici (mutation mémoire + DOM seulement) :
      // l'unique écriture de l'échange a lieu dans onFinal.
      onToolAcks: () => {
        // Rétro-application de l'état d'erreur sur les acks MCP déjà rendus : après
        // l'await réseau, callRemoteTool a pu poser ack.error = true sur le descripteur
        // brut. On met à jour l'entrée currentThread et le nœud DOM si présent.
        for (const { ack, entry, node } of earlyRendered) {
          if (ack.error && !entry.error) {
            entry.error = true;
            if (node) {
              node.classList.add('ack-error');
              const lbl = node.querySelector('.ack-label');
              if (lbl) {
                lbl.textContent = '';
                ACK_KINDS.mcp_call.renderLabel(entry, lbl);
              }
            }
          }
        }
        earlyRendered = [];

        const pending = getPendingToolAcks();
        clearPendingToolAcks();
        for (const ack of pending) {
          const entry = { role: 'tool-ack', kind: ack.kind };
          if (ack.id != null)            entry.id = ack.id;
          if (ack.content != null)       entry.content = ack.content;
          if (ack.prevContent != null)   entry.prevContent = ack.prevContent;
          if (ack.title != null)         entry.title = ack.title;
          if (ack.count != null)         entry.count = ack.count;
          // Champs d'enrichissement cross-turn (posés par updateLastPendingToolAck
          // via le hook onEnrichLastAck, après exécution de chaque outil interne).
          if (ack.name != null)           entry.name = ack.name;
          if (ack.resourceName != null)  entry.resourceName = ack.resourceName;
          if (ack.mime != null)          entry.mime = ack.mime;
          if (ack.size != null)          entry.size = ack.size;
          if (ack.args != null)          entry.args = ack.args;
          if (ack.result != null)        entry.result = ack.result;
          if (ack.ts != null)            entry.ts = ack.ts;
          if (ack.group != null)         entry.group = ack.group;
          if (ack.assistantText != null) entry.assistantText = ack.assistantText;
          currentThread.push(entry);
          placeToolAck(wrap, entry);
        }
        // Blocs NON-text renvoyés par un outil distant (image/resource/binaire) :
        // rendus DANS la bulle courante via la cascade D8, purement éphémères —
        // jamais poussés dans currentThread ni persistés (cf. D8).
        const blocks = getPendingToolBlocks();
        clearPendingToolBlocks();
        if (blocks.length) placeToolBlocks(wrap, blocks);
        scrollBottom();
      },
      // Enrichit l'ack du tool_call qui vient de s'exécuter avec les champs
      // nécessaires à la réinjection cross-turn. Appelé par api.js après chaque
      // outil, AVANT onToolAcks. Pour les outils distants (isMcp) l'ack est
      // déjà dans earlyRendered ; pour les internes il est dans _pendingToolAcks.
      onEnrichLastAck: ({ isMcp, name, args, result, ts, group, assistantText }) => {
        const fields = {};
        if (name != null)          fields.name = name;
        if (args != null)          fields.args = args;
        if (result != null)        fields.result = result;
        if (ts != null)            fields.ts = ts;
        if (group != null)         fields.group = group;
        if (assistantText != null) fields.assistantText = assistantText;
        if (isMcp) {
          const last = earlyRendered[earlyRendered.length - 1];
          if (last) Object.assign(last.entry, fields);
        } else {
          updateLastPendingToolAck(fields);
        }
      },
      onFinal: (content, reasoning) => {
        const ts = Date.now();
        const msg = { role: 'assistant', content, model, ts };
        if (reasoning && reasoning.trim()) msg.reasoning = reasoning;   // champ séparé, persisté
        // Poussé AVANT finalizeAssistant : ce dernier appelle syncConvDownloadBtn(),
        // qui teste currentThread.some(role==='assistant') — sur une conversation
        // fraîche (premier tour), un ordre inversé laisserait le bouton caché
        // malgré la réponse déjà affichée (bug payé : visible seulement après reload).
        currentThread.push(msg);
        finalizeAssistant(wrap, content);
        const tsEl = wrap.querySelector('.msg-ts');
        if (tsEl) { tsEl.textContent = '· ' + formatMessageTime(ts, Date.now()); tsEl.removeAttribute('hidden'); }
        if (reasoning && reasoning.trim()) flushReasoning(wrap, reasoning);   // écrit la valeur finale au live (le throttle a pu sauter les derniers tokens)
        persistCurrent();
        setConnDot('ok');
        maybeTitle();
      },
      onHalt: (leadIn, question) => {
        // Fork B (brief §4) : la question (+ lead-in éventuel) devient un message
        // assistant en TEXTE CLAIR, persisté — aucun tool_call/tool_result natif ne
        // subsiste. Au tour suivant le modèle relit l'échange en clair et agit
        // (« Oui » → create_memory + narration ; « Non » → rien).
        const text = [leadIn, question].map(s => (s || '').trim()).filter(Boolean).join('\n\n');
        currentThread.push({ role: 'assistant', content: text, model });   // avant finalizeAssistant, cf. onFinal
        finalizeAssistant(wrap, text);
        persistCurrent();
        setConnDot('ok');
        // Widget inline : la question est déjà dans la bulle ci-dessus, la carte
        // ne porte que les actions. Accepter/Rejeter envoient « Oui »/« Non » par
        // le même chemin qu'une saisie ; l'overlay se lève à la résolution.
        showConfirmation('',
          () => sendUserText('Oui'),
          () => sendUserText('Non'));
      },
      onError: (msg) => { finalizeAssistant(wrap, '_' + msg + '_'); },
    });
  } catch (e) {
    finalizeAssistant(wrap, '_Erreur réseau : ' + escHtml(e.message || String(e)) + '_');
    setConnDot('err');
  } finally {
    setSending(false);
  }
}

// ── Mécanique réutilisable : tâche LLM « en arrière-plan » ───────────────────
// Encadre une tâche asynchrone (appel LLM silencieux) par l'indicateur
// d'activité, avec garde try/finally et échec silencieux (retourne null).
// Sert au titrage comme à la génération de résumés.
async function runBackgroundTask(label, taskFn) {
  bgActivityStart(label);
  try {
    return await taskFn();
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] tâche « ' + label + ' » échouée :', (e && e.message) || e);
    return null;   // abandon silencieux côté UI
  } finally {
    bgActivityEnd();
  }
}

// ── Titrage automatique (après la première réponse) ─────────────────────────
function applyGeneratedTitle(convId, title) {
  const conv = loadConversation(convId);
  if (conv) { conv.title = title; saveConversation(conv); }
  if (convId === currentConvId) setTitle(title);   // barre du haut + <title> de la page
  renderConvList();                                 // liste de gauche
}

async function maybeTitle() {
  if (!needTitle || !currentConvId) return;
  if (!currentThread.some(m => m.role === 'assistant' && m.content && m.content.trim().length >= 8)) return;
  needTitle = false;
  const convId = currentConvId;                     // figé : l'utilisateur peut naviguer
  const thread = currentThread.slice();
  const title = await runBackgroundTask('titrage…', () => generateTitle(thread));
  if (title) applyGeneratedTitle(convId, title);    // sinon on garde le titre provisoire
}

// ── Résumé / mots-clés à la sortie d'une conversation ───────────────────────
async function summarizeIfNeeded(id) {
  if (!id) return;
  const conv = loadConversation(id);
  if (!conv || !hasSubstance(conv.messages)) return;     // pas de conversation fraîche
  const entry = getSummaryEntry(id);
  if (entry && entry.suppressed) return;                  // tombstone : exclu
  if (entry && entry.messageCount === conv.messages.length) return;  // inchangé

  const s = await runBackgroundTask('résumé…', () => generateSummary(conv.messages));
  if (s) saveSummary(id, {
    title: conv.title,
    timestamp: conv.updatedAt || conv.timestamp,
    summary: s.summary,
    keywords: s.keywords,
    messageCount: conv.messages.length,
  });
}

// ── Backfill modèle : attribue le modèle courant aux réponses sans modèle ───
function backfillMessageModels() {
  const model = loadSettings().model;
  if (!model) return;
  for (const c of listAllConversations()) {
    const conv = loadConversation(c.id);
    if (!conv || !conv.messages) continue;
    let dirty = false;
    for (const m of conv.messages) {
      if (m.role === 'assistant' && !m.model) { m.model = model; dirty = true; }
    }
    if (dirty) saveConversation(conv);
  }
}

// ── Backfill au démarrage (séquentiel, indicateur continu) ──────────────────
async function runBackfill() {
  // Le résumé n'a besoin que de l'URL (clef optionnelle) : ne pas dépendre de
  // `configured`, qui exige aussi une clef (utile pour un endpoint sans auth).
  if (!loadSettings().url) return;
  const cands = backfillCandidates();
  if (!cands.length) return;
  const N = cands.length;
  await runBackgroundTask('résumés 0/' + N, async () => {
    let n = 0;
    for (const c of cands) {
      n++;
      bgActivityLabel('résumés ' + n + '/' + N);     // maj du libellé sans toucher au compteur
      if (!isSummaryCandidate(c.id)) continue;        // re-vérif (suppression entre-temps)
      try {
        const s = await generateSummary(c.messages);
        if (s) saveSummary(c.id, {
          title: c.title,
          timestamp: c.updatedAt || c.timestamp,
          summary: s.summary,
          keywords: s.keywords,
          messageCount: c.messages.length,
        });
      } catch (e) { /* on saute cette conversation */ }
    }
  });
}

// ── Init ────────────────────────────────────────────────────────────────────
function init() {
  applyLogo();

  const s = loadSettings();
  $('set-url').value = s.url || '';
  $('set-key').value = s.key || '';
  $('set-model').value = s.model || '';
  $('set-system').value = s.systemPrompt || '';
  $('set-highlight').checked = s.highlight !== false;
  highlightEnabled = s.highlight !== false;
  $('set-modelselector').checked = !!s.showModelSelector;
  setSummaryInjectionModeUI(s.summaryInjectionMode);
  setThemeUI(s.theme || 'system');
  applyTheme(s.theme || 'system');
  syncKeyFieldHint();
  syncModelUI();

  backfillMessageModels();
  renderConvList();
  resetToEmpty();
  syncConfigured();
  const ta = $('composer-text');
  if (ta && !ta.disabled) ta.focus();
  if (!isMobileLayout() && listAllConversations().length > 0) $('app').classList.add('sidebar-open');
  initSidebarResize();
  initVisualViewport();
  wireTitleEditing();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('app').classList.contains('sidebar-open') && isMobileLayout()) {
      closeSidebarMobile();
    }
  });

  prefetchModels();      // liste des modèles (cache session) → sélecteur composer
  reconnectMcpServers(); // handshake + tools/list des serveurs MCP activés
  loadSkillsCache();     // méta des skills en mémoire → autocomplétion + outils
  runBackfill();         // auto-gardé sur la présence d'URL
}

if (typeof __TEST_ENV__ === 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
