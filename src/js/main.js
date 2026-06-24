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
  const model = activeModel().trim();
  const lines = ['Date et heure : ' + dateStr];
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

// Contenu statique uniquement : identique d'un tour à l'autre tant que tools
// et systemPrompt configuré ne changent pas — permet le KV cache prefix matching.
function buildSystemMessage() {
  const parts = [];
  const sysUser = (loadSettings().systemPrompt || '').trim();
  if (sysUser) parts.push(sysUser);
  if (TOOLS.length) {
    if (loadSettings().includeToolsInSystemPrompt) parts.push(toolsSystemPrompt());
    parts.push(memoryDoctrinePrompt());
  }
  return { role: 'system', content: parts.join('\n\n---\n\n') };
}

// ── Navigation entre conversations ──────────────────────────────────────────
function openConversation(id) {
  const conv = loadConversation(id);
  if (!conv) return;
  currentConvId = id;
  currentThread = (conv.messages || []).map(m => {
    if (m.role === 'memory-ack') {
      const a = { role: 'memory-ack', ackType: m.ackType, id: m.id };
      if (m.content != null) a.content = m.content;
      if (m.resolved) a.resolved = true;
      return a;
    }
    const o = { role: m.role, content: m.content, model: m.model };
    if (m.ts) o.ts = m.ts;
    if (m.reasoning) o.reasoning = m.reasoning;
    return o;
  });
  currentConvModel = conv.model || '';
  needTitle = false;
  setTitle(conv.title || '');
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

// Exporte la conversation courante en Markdown. N'inclut que les messages
// visibles (user + assistant) — les memory-ack et éventuels internaux sont exclus.
// Appelé depuis le bouton topbar (onclick="downloadConvMd()").
function downloadConvMd() {
  if (!currentThread || !currentThread.length) return;
  const conv = currentConvId ? loadConversation(currentConvId) : null;
  const title = (conv && conv.title) || 'miaou-conversation';
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'miaou-conversation';

  const lines = [];
  for (const m of currentThread) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const timeStr = m.ts ? ' — ' + formatMessageTime(m.ts, Date.now()) : '';
    const label = (m.role === 'user' ? '### Vous' : '### MIAOU') + timeStr;
    lines.push(label);
    lines.push('');
    lines.push(m.content || '');
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  downloadFile(slug + '.md', lines.join('\n').trimEnd() + '\n', 'text/markdown');
}

function undoMemoryAck(btn, id) {
  forgetMemory(id);
  btn.outerHTML = '<span class="ack-resolved">annulé</span>';
  const entry = currentThread.find(m => m.role === 'memory-ack' && m.id === id && !m.resolved);
  if (entry) entry.resolved = true;
  const wrap = document.querySelector('.memory-ack[data-mem-id="' + id + '"]');
  if (wrap) wrap.classList.add('resolved');
  persistCurrent();
}

function deleteConv(id) {
  deleteConversation(id);
  deleteSummaryEntry(id);   // l'index de résumé devient orphelin sinon
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
    if (m.role === 'memory-ack') {
      const o = { role: 'memory-ack', ackType: m.ackType, id: m.id };
      if (m.content != null) o.content = m.content;
      if (m.resolved) o.resolved = true;
      return o;
    }
    const o = { role: m.role, content: m.content };
    if (m.model) o.model = m.model;
    if (m.ts) o.ts = m.ts;
    if (m.reasoning) o.reasoning = m.reasoning;
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
  const t = e.target.textContent.trim();
  document.title = (t || 'Nouvelle conversation') + ' — MIAOU';
  if (currentConvId && t) {
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

// ── Flux d'envoi ────────────────────────────────────────────────────────────
// Bouton unique du composer : envoie, ou interrompt si un stream est en cours.
function onSendBtn() {
  if (sending) abortStream();
  else sendMessage();
}

function sendMessage() {
  if (!configured || sending) return;
  const ta = $('composer-text');
  const text = ta.value.trim();
  if (!text) return;
  ta.value = ''; ta.style.height = 'auto';

  // Confirmation en attente + saisie libre : la frappe vaut réponse/correction
  // (brief §4.5). On lève le widget avant d'envoyer comme un message normal.
  if (_confirmPending) dismissConfirmation();

  sendUserText(text);
}

// Cœur d'un envoi utilisateur : crée la conv au besoin, pousse le message,
// persiste, relance la génération. Partagé par la saisie composer (sendMessage)
// et la reprise « fork B » d'ask_confirmation (Accepter → « Oui » / Rejeter → « Non »).
function sendUserText(text) {
  ensureConversation();
  const ts = Date.now();
  appendUserMessage(text, ts);
  currentThread.push({ role: 'user', content: text, ts });
  persistCurrent();

  runGenerationFromCurrentThread();
}

// Cœur de l'envoi : recherche mémoire (sur le dernier message utilisateur),
// bannière éventuelle, puis dispatch. Partagé par l'envoi normal et la relance
// après édition d'un message — pour ne pas dupliquer la logique mémoire+outils.
// Pré-requis : le dernier message utilisateur est déjà dans currentThread.
function runGenerationFromCurrentThread() {
  const lastUser = currentThread.slice().reverse().find(m => m.role === 'user');
  const text = lastUser ? lastUser.content : '';

  const settings = loadSettings();
  let matches = [];
  if (settings.summaryInjectionMode !== 'never') matches = searchSummaries(text);

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
// génération par le même chemin que l'envoi normal.
function editUserMessage(index, newText) {
  if (sending) return;                          // pas d'édition pendant un stream
  const t = (newText || '').trim();
  if (!t) return;
  if (index < 0 || index >= currentThread.length) return;
  if (currentThread[index].role !== 'user') return;

  currentThread = currentThread.slice(0, index + 1);
  currentThread[index] = { role: 'user', content: t, ts: Date.now() };
  persistCurrent();                             // troncature écrite avant relance
  renderThread(currentThread);
  runGenerationFromCurrentThread();
}

async function dispatchSend(matches) {
  hideSummaryBanner();
  const model = activeModel();   // modèle qui va produire cette réponse (override conv ou défaut)
  const sys = buildSystemMessage();
  const threadMsgs = currentThread.filter(m => m.role !== 'memory-ack').map(m => ({ role: m.role, content: m.content }));

  // Injection éphémère du contexte dynamique (date/heure, modèle, mémoire) en
  // préfixe du dernier message utilisateur, pour préserver le préfixe stable
  // (system + historique[0..N-1]) et permettre le KV cache prefix matching.
  const lastUserIdx = threadMsgs.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);
  if (lastUserIdx >= 0) {
    const ctx = buildContextBlock(matches);
    threadMsgs[lastUserIdx] = {
      role: 'user',
      content: ctx + '\n\n---\n\n' + threadMsgs[lastUserIdx].content,
    };
  }

  const apiMessages = [sys].concat(threadMsgs).filter(Boolean);

  let wrap = startAssistantMessage(model);
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
          finalizeAssistant(wrap, content);
          const tsEl = wrap.querySelector('.msg-ts');
          if (tsEl) { tsEl.textContent = '· ' + formatMessageTime(tourTs, Date.now()); tsEl.removeAttribute('hidden'); }
          currentThread.push({ role: 'assistant', content, model, ts: tourTs });
          persistCurrent();
          wrap = startAssistantMessage(model);
        } else {
          resetAssistant(wrap);
        }
      },
      onFinal: (content, reasoning) => {
        const ts = Date.now();
        finalizeAssistant(wrap, content);
        const tsEl = wrap.querySelector('.msg-ts');
        if (tsEl) { tsEl.textContent = '· ' + formatMessageTime(ts, Date.now()); tsEl.removeAttribute('hidden'); }
        const msg = { role: 'assistant', content, model, ts };
        if (reasoning && reasoning.trim()) {
          flushReasoning(wrap, reasoning);   // écrit la valeur finale au live (le throttle a pu sauter les derniers tokens)
          msg.reasoning = reasoning;          // champ séparé, persisté
        }
        currentThread.push(msg);
        // Acks côté client : émis par les handlers d'outils à écriture directe,
        // jamais envoyés au modèle — journal visible persisté dans le thread.
        const pending = getPendingMemoryAcks();
        clearPendingMemoryAcks();
        for (const ack of pending) {
          const entry = { role: 'memory-ack', ackType: ack.ackType, id: ack.id };
          if (ack.content != null) entry.content = ack.content;
          currentThread.push(entry);
          $('thread').appendChild(buildMemoryAck(entry));
        }
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
        finalizeAssistant(wrap, text);
        currentThread.push({ role: 'assistant', content: text, model });
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
  if (!currentThread.some(m => m.role === 'assistant')) return;
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
  if (!isMobileLayout()) $('app').classList.add('sidebar-open');
  initSidebarResize();
  initVisualViewport();
  wireTitleEditing();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('app').classList.contains('sidebar-open') && isMobileLayout()) {
      closeSidebarMobile();
    }
  });

  prefetchModels();   // liste des modèles (cache session) → sélecteur composer
  runBackfill();      // auto-gardé sur la présence d'URL
}

if (typeof __TEST_ENV__ === 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
