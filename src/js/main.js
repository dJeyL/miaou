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
let activeSpaceId = DEFAULT_SPACE_ID;   // Space actif (feature Spaces, lot C) — init() le réhydrate depuis miaou-active-space
let currentThread = [];   // [{ role, content }] — fil visible courant
let needTitle = false;    // titrage auto en attente (conversation neuve)
let titleBefore = '';
let currentConvModel = '';  // override de modèle de la conversation courante ('' = modèle par défaut)
let currentConvReasoningEffort = '';  // override de reasoning_effort de la conversation courante ('' = défaut, pas de paramètre)
let pendingAttachments = [];   // pièces jointes du composer, en attente d'envoi (cf. §Pièces jointes)
let attachIngestInFlight = 0;  // ingestions en cours (garde anti-course : envoi refusé tant que ≠ 0)
let _lastContextManifest = null;   // manifeste du dernier envoi RÉEL (brief B, B4) — null si aucun envoi cette session
let _lastContextManifestMidTurn = false;   // true si _lastContextManifest a été recalculé PENDANT une boucle d'outils (tour non terminé), cf. recomputeLastContextManifest

// ── Résumé sur inactivité ────────────────────────────────────────────────────
// Durée d'inactivité utilisateur avant déclenchement d'un résumé de la
// conversation courante (si substance). Réarmée à chaque activité (frappe
// composer, envoi, changement de conversation, fin de réponse assistant).
const IDLE_SUMMARY_MS = 60000;
let _idleSummaryTimer = null;

function armIdleSummaryTimer() {
  if (_idleSummaryTimer) clearTimeout(_idleSummaryTimer);
  _idleSummaryTimer = setTimeout(() => {
    _idleSummaryTimer = null;
    if (sending) return;   // pas de résumé pendant un stream en cours
    summarizeIfNeeded(currentConvId);
  }, IDLE_SUMMARY_MS);
}

// Modèle effectif pour l'échange courant : override de conversation s'il existe,
// sinon le modèle par défaut des réglages. Ne JAMAIS mélanger les deux dans une
// même variable d'état (override conv vs défaut global).
function activeModel() {
  // activeApiConfig() (storage.js) résout : modèle du serveur actif, sinon
  // settings.model legacy — même chaîne que silentCompletion/streamCompletion.
  return (currentConvModel && currentConvModel.trim()) || activeApiConfig().model;
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

// Niveau de reasoning_effort effectif pour l'échange courant : override de
// conversation s'il existe, sinon le défaut des réglages. '' = défaut = pas de
// paramètre envoyé à l'API (comportement natif du modèle).
function activeReasoningEffort() {
  return (currentConvReasoningEffort && currentConvReasoningEffort.trim()) || (loadSettings().reasoningEffort || '');
}

// Fixe l'override de reasoning_effort de la conversation courante (choix dans
// le composer). Persiste sur l'objet conversation si elle existe déjà.
function setConvReasoningEffort(v) {
  currentConvReasoningEffort = v || '';
  if (currentConvId) {
    const conv = loadConversation(currentConvId);
    if (conv) {
      if (currentConvReasoningEffort) conv.reasoningEffort = currentConvReasoningEffort; else delete conv.reasoningEffort;
      saveConversation(conv);
    }
  }
  syncReasoningUI();
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
// filtrage/ranking : volume faible attendu pour un usage personnel). Scope
// profile (global) + Space actif uniquement (brief D3) — jamais les souvenirs
// d'un autre Space.
function buildMemoryEntriesBlock() {
  const entries = listMemoryEntries(['profile', activeSpaceId]);
  if (!entries.length) return '';
  const lines = entries.map(e => `- [id: ${e.id}] ${e.content}`);
  return "Souvenirs de l'utilisateur (persistants, à respecter et prendre en compte) :\n" +
         lines.join('\n');
}

// Sous-blocs du contexte dynamique, AVANT concaténation (brief B, D1) — même
// principe que systemMessageParts() : source unique pour buildContextBlock()
// ET pour le manifeste de contexte.
function contextBlockParts(matches) {
  const now = new Date();
  const dateStr = now.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const model = activeModel().trim();
  const lines = ['Date et heure : ' + dateStr + ' (' + tz + ')'];
  if (model) lines.push('Modèle : ' + model);
  const space = getSpace(activeSpaceId);
  if (space && space.name) lines.push('Espace : ' + space.name);
  return {
    contextDateModel: lines.join('\n'),
    summaries: buildSummaryBlock(matches || []),
    memories: buildMemoryEntriesBlock(),
    skillsContext: buildSkillsContextBlock(),
    library: buildLibraryManifestBlock(getCachedLibraryEntriesBySpace(activeSpaceId), space && space.name),
  };
}

// Contenu dynamique par tour : date/heure, modèle actif, résumés injectés, souvenirs,
// manifeste de la bibliothèque de fichiers d'espace (D4, lot Cbis).
// Injecté en préfixe du dernier message utilisateur, pas dans le system message,
// pour préserver le préfixe stable et permettre le KV cache prefix matching.
function buildContextBlock(matches) {
  const dp = contextBlockParts(matches);
  const parts = [dp.contextDateModel];
  if (dp.summaries) parts.push(dp.summaries);
  if (dp.memories) parts.push(dp.memories);
  if (dp.library) parts.push(dp.library);
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

// Résolution pure (testable QuickJS) : la description du Space actif est
// AJOUTÉE après le prompt système utilisateur global (brief D4, corrigé — la
// version d'origine proposait un remplacement, inversée par décision
// explicite : un Space porte une description, pas un system prompt de
// substitution). `space` peut être null (Space introuvable/default sans
// description) → seul le prompt global s'applique alors.
function resolveUserSystemPrompt(globalSystemPrompt, space) {
  const parts = [];
  const global = (globalSystemPrompt || '').trim();
  if (global) parts.push(global);
  const spaceDescription = (space && space.description || '').trim();
  if (spaceDescription) {
    const spaceName = (space && space.name || '').trim();
    const intro = spaceName
      ? 'Description de l\'espace ' + spaceName + ' :'
      : 'Description de cet espace :';
    parts.push(intro + '\n' + spaceDescription);
  }
  return parts.join('\n\n---\n\n');
}

// Sous-blocs du system message, AVANT concaténation (brief B, D1) : source
// unique pour buildSystemMessage() ET pour le manifeste de contexte — jamais
// de re-split du séparateur '\n\n---\n\n' (fragile, audit §6). '' pour un
// sous-bloc absent/désactivé.
function systemMessageParts() {
  const settings = loadSettings();
  const out = { root: '', toolsSystem: '', intent: '', skills: '', docs: '', user: '' };
  if (TOOLS.length) {
    out.root = ROOT_SYSTEM_PROMPT;
    if (settings.includeToolsInSystemPrompt) out.toolsSystem = toolsSystemPrompt();
    out.intent = intentDoctrinePrompt();
    out.skills = skillDoctrinePrompt();
    out.docs = docsDoctrinePrompt();
  }
  out.user = resolveUserSystemPrompt(settings.systemPrompt, getSpace(activeSpaceId));
  return out;
}

// Ordre : racine → énumération outils (si ON) → doctrine intent (si ON) → doctrine
// skills (si skills autotrigger) → utilisateur → description du Space actif
// (concaténée, jamais substituée — D4 corrigé). Piège 18 (CLAUDE.md) : cette
// dernière part varie d'un Space à l'autre — changer de Space change donc le
// system message (assumé, documenté), mais il reste statique tant qu'on reste
// dans le même Space (KV cache, piège 16).
function buildSystemMessage() {
  const sp = systemMessageParts();
  const parts = [sp.root, sp.toolsSystem, sp.intent, sp.skills, sp.docs, sp.user].filter(Boolean);
  return { role: 'system', content: parts.join('\n\n---\n\n') };
}

// Simulation « prochain envoi » au repos (brief B, B4) : mêmes fonctions pures
// que dispatchSend (systemMessageParts, contextBlockParts, expandThread,
// toolDefinitions), jamais rejouée avec des résumés (matches=[] — non
// simulables hors déclenchement d'envoi réel, audit §9). Purement lecture :
// ne modifie ni currentThread ni localStorage. Compteur compact et ouverture
// du drawer l'appellent tant qu'aucun `_lastContextManifest` n'existe encore.
function computeContextManifestNow() {
  const sysParts = systemMessageParts();
  const dynParts = contextBlockParts([]);
  const threadMsgs = expandThread(resolveRecallImages(resolveResourceRefs(currentThread)));
  return buildContextManifest(sysParts, dynParts, threadMsgs, JSON.stringify(toolDefinitions()), null);
}

// Rejoue le manifeste du DERNIER ENVOI RÉEL, à la fin du tour (onFinal/onHalt,
// midTurn=false) ou PENDANT une boucle d'outils encore ouverte (onToolAcks,
// midTurn=true — cf. dispatchSend) : la capture faite avant `runConversation`
// (dispatchSend) ne voit ni les tool-acks ni la réponse assistant produits
// pendant la boucle d'outils, ce qui sous-évaluait durablement le compteur —
// potentiellement plusieurs tours d'affilée si un outil renvoie beaucoup de
// volume — jusqu'à la fin de l'échange complet (bug payé : écart ~50% vs un
// reload qui recalcule sur le thread complet). Rejouer aussi à CHAQUE tour
// d'outils (pas seulement en fin d'échange) rend la pilule/le drawer
// représentatifs en continu, y compris à mi-échange. `matches` = les résumés
// effectivement injectés à CE tour (reçus en paramètre de dispatchSend, non
// simulables après coup — audit §9). expandThread tolère un thread se
// terminant par un groupe de tool-acks sans réponse assistant qui le clôt
// (tour en cours) : pas de lookahead exigeant une suite.
function recomputeLastContextManifest(matches, midTurn) {
  const sysParts = systemMessageParts();
  const dynParts = contextBlockParts(matches);
  const threadMsgs = expandThread(resolveRecallImages(resolveResourceRefs(currentThread)));
  _lastContextManifest = buildContextManifest(sysParts, dynParts, threadMsgs, JSON.stringify(toolDefinitions()), null);
  _lastContextManifestMidTurn = !!midTurn;
}

// Calibre `_lastContextManifest` sur l'usage réel du tour qui vient de
// terminer (Bbis) — appelée APRÈS recomputeLastContextManifest (estimé pur),
// jamais avant : la séparation reste nette entre « rejeu du thread » (estimé)
// et « calibrage sur l'API » (passe optionnelle). `usage` null (backend sans
// stream_options, ex. beaucoup de configs Ollama) → no-op, scaleManifestToUsage
// renvoie déjà le manifeste inchangé dans ce cas. Dernier tour reçu (A6) :
// chaque appel écrase, jamais de somme entre tours.
function applyUsageToLastManifest(usage) {
  if (!usage || !_lastContextManifest) return;
  _lastContextManifest = scaleManifestToUsage(_lastContextManifest, usage);
}

// ── Navigation entre conversations ──────────────────────────────────────────
async function openConversation(id) {
  const conv = loadConversation(id);
  if (!conv) return;
  currentConvId = id;
  currentThread = (conv.messages || []).map(m => {
    if (isAckRole(m.role)) {
      // Whitelist unique ACK_COPY_FIELDS (utils.js) — ne plus jamais énumérer
      // les champs à la main ici.
      return copyAckFields(m, { role: m.role });
    }
    const o = { role: m.role, content: m.content, model: m.model };
    if (m.server) o.server = m.server;   // provenance (serveur API), assistant uniquement
    if (m.ts) o.ts = m.ts;
    if (m.reasoning) o.reasoning = m.reasoning;
    if (m.truncated) o.truncated = true;   // réponse incomplète (feature C)
    // littéral (slash-commande skill). Normalise l'ancien champ `display` (données
    // de test antérieures au renommage) vers `displayText` à la lecture.
    if (m.displayText != null) o.displayText = m.displayText;
    else if (m.display != null) o.displayText = m.display;
    if (m.attachments) o.attachments = m.attachments;   // pièces jointes (user uniquement, brief A)
    return o;
  });
  currentConvModel = conv.model || '';
  currentConvReasoningEffort = conv.reasoningEffort || '';
  needTitle = !conv.title;   // conversation rouverte sans titre (streaming arrêté, etc.) : retitrer à la reprise
  setTitle(conv.title || '');
  await loadConversationResources(id);   // peuple le session cache avant renderThread
  renderThread(currentThread);
  renderConvList();
  syncModelUI();
  syncReasoningUI();
  _lastContextManifest = null;   // switch de conv : le dernier envoi réel ne s'applique plus, retombe sur simulation
  syncContextCounter();
}

function resetToEmpty() {
  currentConvId = null;
  currentThread = [];
  currentConvModel = '';   // nouvelle conversation → modèle par défaut
  currentConvReasoningEffort = '';   // nouvelle conversation → reasoning_effort par défaut
  needTitle = false;
  $('thread').innerHTML = '';
  clearMemoryProposals();   // cartes de proposition détruites avec le thread
  showWelcome();
  setTitle('');
  syncConvDownloadBtn();
  renderConvList();
  syncModelUI();
  syncReasoningUI();
  _lastContextManifest = null;
  syncContextCounter();
}

function selectConv(id) {
  if (id === currentConvId) return;
  const leaving = currentConvId;
  openConversation(id);
  summarizeIfNeeded(leaving);   // résumé de la conversation quittée (arrière-plan)
  armIdleSummaryTimer();
  if (isMobileLayout()) closeSidebarMobile();
}

// Déplacement effectif du lot sélectionné (D4/D7, brief Cter). Mutation UNIQUE
// de conv.spaceId via le helper pur (storage.js) + un seul persistConversations
// pour tout le lot (pas N saveConversation successifs, cf. audit §5). Résumés,
// souvenirs et pièces jointes suivent automatiquement : ils scopent par convId,
// jamais par une copie côté Space.
function moveSelectedConversations(targetSpaceId) {
  if (!targetSpaceId || !_moveSelection.size) return;
  const ids = Array.from(_moveSelection);
  const moved = moveConversationsToSpace(loadConversations(), ids, targetSpaceId);
  persistConversations(moved);

  // Follow (D6) : seulement si la conversation ouverte fait partie du lot
  // déplacé — sinon rien ne bouge pour elle (audit §3, décision Julien
  // 2026-07-07 : pas de cas ambigu, le follow est borné à son propre cas).
  const shouldFollow = currentConvId && ids.includes(currentConvId);
  exitMoveMode();
  if (shouldFollow) followSpace(targetSpaceId);
  else renderConvList();
}

function newConversation() {
  const leaving = currentConvId;
  resetToEmpty();
  const ta = $('composer-text');
  if (ta && !ta.disabled) ta.focus();
  summarizeIfNeeded(leaving);   // résumé de la conversation quittée (arrière-plan)
  armIdleSummaryTimer();
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
    const modelStr = (m.role === 'assistant' && m.model) ? ' (' + m.model + ')' : '';
    const label = (m.role === 'user' ? '### Vous' : '### MIAOU' + modelStr) + timeStr;
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

// Crée la conversation à la volée au premier envoi (pas avant). Stampée dans
// le Space actif (seul point de création — brief D5, lot C).
function ensureConversation() {
  if (currentConvId) return;
  const id = 'c' + Date.now().toString(36);
  const manualTitle = $('conv-title').textContent.trim();
  saveConversation({ id, title: manualTitle, timestamp: Date.now(), messages: [], spaceId: activeSpaceId });
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
      // Whitelist unique ACK_COPY_FIELDS (utils.js) — ne plus jamais énumérer
      // les champs à la main ici.
      return copyAckFields(m, { role: m.role });
    }
    const o = { role: m.role, content: m.content };
    if (m.model) o.model = m.model;
    if (m.server) o.server = m.server;   // provenance (serveur API), assistant uniquement
    if (m.ts) o.ts = m.ts;
    if (m.reasoning) o.reasoning = m.reasoning;
    if (m.truncated) o.truncated = true;   // réponse incomplète (feature C)
    if (m.displayText != null) o.displayText = m.displayText;   // littéral (slash-commande skill)
    if (m.attachments) o.attachments = m.attachments;   // pièces jointes (user uniquement, brief A)
    return o;
  });
  if (!conv.timestamp) conv.timestamp = Date.now();
  conv.updatedAt = Date.now();
  if (currentConvModel) conv.model = currentConvModel; else delete conv.model;
  if (currentConvReasoningEffort) conv.reasoningEffort = currentConvReasoningEffort; else delete conv.reasoningEffort;
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
    systemPrompt: $('set-system').value,
    highlight: $('set-highlight').checked,
    summaryInjectionMode: pendingSummaryInjectionMode,
    theme: pendingTheme,
    showModelSelector: $('set-modelselector').checked,
    reasoningEffort: $('set-reasoning-effort').value,
    showReasoningSelector: $('set-reasoningselector').checked,
    includeToolsInSystemPrompt: $('set-tools-in-prompt').checked,
    intentTracing: $('set-intent-tracing').checked,
    saveJsonResponses: $('set-save-json').checked,
    confirmSkillAutoUse: $('set-confirm-skill-autouse').checked,
    describeFiles: $('set-describe-files').checked,
    contextWindow: $('set-contextwindow').value,
  };
  saveSettings(obj);
  updateSettingsDirty();   // formulaire = persisté → bouton redésactivé
  highlightEnabled = obj.highlight;
  syncConfigured();
  syncModelUI();        // labels + visibilité du sélecteur (selon cache déjà chargé)
  syncReasoningUI();     // visibilité + valeur du sélecteur de raisonnement
  prefetchModels();     // (re)charge la liste si besoin, puis re-sync
  renderThread(currentThread);   // ré-applique/retire la coloration
  syncContextCounter();   // fenêtre de contexte modifiée : recalcule occupation/jauge
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
  if (nameErr) { showCardError(cardEl, nameErr); return; }
  const url = get('.mcp-url').trim();
  if (!url) { showCardError(cardEl, 'URL requise.'); return; }
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

// ── Serveurs API : persistance + activation (orchestration depuis le drawer) ─
// Même pattern que les cartes MCP (onSaveMcpCard/onDeleteMcpCard), mais `id`
// fait clé d'identité (cf. storage.js) et il y a une notion supplémentaire de
// "serveur actif" (bouton Utiliser ce serveur, pas de toggle enabled).
function onSaveApiCard(cardEl, originalId) {
  const get = (sel) => { const el = cardEl.querySelector(sel); return el ? el.value : ''; };
  const name = get('.api-name').trim();
  if (!name) { showCardError(cardEl, 'Nom requis.'); return; }
  const url = get('.api-url').trim();
  if (!url) { showCardError(cardEl, 'URL requise.'); return; }
  const wasEmpty = !loadApiServers().length;
  const model = get('.api-model').trim();
  // Flag vision manuel (D5) : on préserve la map `vision` du serveur existant
  // (autres modèles déjà réglés) et on met à jour la seule entrée du modèle
  // courant. 'off' → `false` explicite (dégradation proactive) ; 'on' → on
  // RETIRE l'entrée (retour au défaut « inconnu = envoyer »), pas de `true`
  // persisté (normalizeApiServer ne garde que les `false`).
  const prior = originalId ? getApiServer(originalId) : null;
  const vision = Object.assign({}, (prior && prior.vision) || {});
  if (get('.api-vision') === 'off') vision[model] = false;
  else delete vision[model];
  const server = {
    id: originalId || undefined,
    name, url,
    key: get('.api-key'),
    model,
    vision,
  };
  const arr = upsertApiServer(server);
  if (wasEmpty) {
    const saved = arr.find(s => s.name === name && s.url === url);
    if (saved) setActiveApiServerId(saved.id);
  }
  renderApiServers();
  syncActiveApiServerUI();
  syncConfigured();
  syncModelUI();
  prefetchModels();
}

function onDeleteApiCard(cardEl, id) {
  const arr = loadApiServers();
  if (arr.length <= 1) { showCardError(cardEl, 'Impossible de supprimer le dernier serveur.'); return; }
  const wasActive = (activeApiServer() || {}).id === id;
  deleteApiServer(id);
  if (wasActive) {
    const remaining = loadApiServers();
    if (remaining.length) setActiveApiServerId(remaining[0].id);
  }
  renderApiServers();
  syncActiveApiServerUI();
  syncConfigured();
  syncModelUI();
  prefetchModels();
}

function onUseApiServer(id) {
  setActiveApiServerId(id);
  // L'override de modèle de la conversation courante pointait sur un modèle de
  // l'ANCIEN serveur : on le lève, sinon tout l'échange suivant (y compris les
  // tours tool_calls) partirait avec un modèle inconnu du nouvel endpoint.
  setConvModel('');
  renderApiServers();
  syncActiveApiServerUI();
  syncConfigured();
  syncModelUI();
  prefetchModels();   // loadModelsCached() re-fetch si l'URL a changé (comparaison _modelsCacheUrl)
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
  if (slugErr) { showCardError(cardEl, slugErr); return; }
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

// ── Export / import complet des données (feature E) ──────────────────────────
// Assurance-vie : snapshot des 9 clés localStorage + IDB (skills, resources),
// remplacement intégral à l'import (pas de fusion, décision actée). Format et
// posture (clefs API en clair) documentés dans docs/storage.md.

// Lit les 9 clés localStorage désérialisées (miaou-active-api-server et
// miaou-active-space sont des strings brutes, seules exceptions du schéma)
// pour buildExportPayload (storage.js).
function snapshotLocalStorageForExport() {
  const snap = {};
  for (const key of EXPORT_KEYS) {
    if (key === 'miaou-active-api-server' || key === 'miaou-active-space') { snap[key] = localStorage.getItem(key) || ''; continue; }
    try { snap[key] = JSON.parse(localStorage.getItem(key)); }
    catch (e) { snap[key] = null; }
  }
  return snap;
}

// Handler global (bouton « Exporter les données »). Snapshot localStorage +
// lecture IDB (skills, resources), encodage base64 des données binaires des
// ressources, puis téléchargement du fichier JSON.
async function exportAllData() {
  const lsSnapshot = snapshotLocalStorageForExport();
  const skills = await getAllSkillRecords();
  const rawResources = await getAllResources();
  const resources = rawResources.map(r => Object.assign({}, r, { data: arrayBufferToBase64(r.data) }));
  const payload = buildExportPayload(lsSnapshot, skills, resources);
  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}`;
  downloadFile('miaou-export-' + stamp + '.json', JSON.stringify(payload), 'application/json');
}

// Handler global (bouton « Importer les données ») : déclenche l'input file caché.
function onImportDataClick() {
  const input = $('import-data-input');
  if (input) { input.value = ''; input.click(); }
}

// Handler global (onchange de l'input file) : lit + parse + valide. Une erreur
// s'affiche inline (registre showCardError/hint, jamais d'alert) ; un payload
// valide affiche un récapitulatif dont le bouton d'application est arm-then-run
// (remplacement intégral = destructif).
function onImportFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let obj;
    try { obj = JSON.parse(reader.result); }
    catch (e) { showImportDataError('Fichier illisible : JSON invalide.'); return; }
    const res = validateImportPayload(obj);
    if (!res.ok) { showImportDataError(res.error); return; }
    renderImportSummary(res.counts, () => applyImportedData(obj));
  };
  reader.onerror = () => showImportDataError('Échec de lecture du fichier.');
  reader.readAsText(file);
}

// Applique un payload d'import validé : écrit les 9 clés localStorage (clé
// absente du fichier → removeItem, pour ne pas laisser d'état résiduel
// incohérent), vide puis réinsère les stores IDB skills/resources, puis
// recharge la page — l'état de session (caches, thread courant, statut MCP) se
// reconstruit proprement au boot, aucune resynchronisation manuelle à écrire.
async function applyImportedData(payload) {
  const ls = payload.localStorage || {};
  for (const key of EXPORT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(ls, key)) { localStorage.removeItem(key); continue; }
    const val = ls[key];
    if (key === 'miaou-active-api-server' || key === 'miaou-active-space') localStorage.setItem(key, typeof val === 'string' ? val : '');
    else localStorage.setItem(key, JSON.stringify(val));
  }
  const idb = payload.idb || {};
  const skills = Array.isArray(idb.skills) ? idb.skills : [];
  const resources = Array.isArray(idb.resources) ? idb.resources : [];
  await clearIdbStore('skills');
  for (const rec of skills) await putSkill(rec);
  await clearIdbStore('resources');
  for (const rec of resources) {
    await putResource(Object.assign({}, rec, { data: base64ToArrayBuffer(rec.data) }));
  }
  location.reload();
}

// ── Pièces jointes (composer) ────────────────────────────────────────────────
// Attache de fichiers au message en cours de saisie : trombone + drag&drop,
// downscale image côté client, lecture texte plafonnée, stockage IDB (store
// `resources` existant, cf. resources.js). LOT 1 (brief A, D1) : ingestion,
// downscale, stockage IDB, chips. LOT 2 (D2/D3/D5, ici) : construction du
// contenu envoyé au modèle au tour d'attache (content parts image + injection
// texte) et politique de persistance (réécriture unique parts→descripteur
// après le tour, cf. rewriteAttachedUserMessage/onFinal de dispatchSend).
//
// Constantes ajustables, regroupées ici :
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;        // 10 Mo, rejet pré-resize
const ATTACHMENT_IMAGE_MAX_EDGE = 1536;                // plus grand côté après downscale
const ATTACHMENT_IMAGE_JPEG_QUALITY = 0.85;            // ré-encodage JPEG
const ATTACHMENT_TEXT_MAX_BYTES = 200 * 1024;          // 200 kB, au-delà → binary
const ATTACHMENT_MAX_IMAGES = 4;                       // cap images par message

// Downscale une image (File/Blob) via canvas : plus grand côté ≤
// ATTACHMENT_IMAGE_MAX_EDGE, ré-encodage JPEG qualité ATTACHMENT_IMAGE_JPEG_QUALITY,
// PNG conservé si son encodage est plus petit que le JPEG après downscale.
// Dimensions finales calculées ICI et retournées : FIGÉES pour tout le cycle
// de vie de l'attachment (nécessaire au lot 2 pour le descripteur byte-stable
// — ne jamais recalculer plus tard). Retourne { blob, mime, w, h }.
async function downscaleImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const srcW = bitmap.width, srcH = bitmap.height;
  const scale = Math.min(1, ATTACHMENT_IMAGE_MAX_EDGE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (typeof bitmap.close === 'function') bitmap.close();

  const toBlob = (mime, quality) => new Promise(resolve => canvas.toBlob(resolve, mime, quality));
  const jpegBlob = await toBlob('image/jpeg', ATTACHMENT_IMAGE_JPEG_QUALITY);

  const isPng = /png/i.test(file.type);
  if (isPng) {
    const pngBlob = await toBlob('image/png');
    if (pngBlob && (!jpegBlob || pngBlob.size <= jpegBlob.size)) {
      return { blob: pngBlob, mime: 'image/png', w, h };
    }
  }
  return { blob: jpegBlob, mime: 'image/jpeg', w, h };
}

// Lit un fichier texte via FileReader, en Promise. Retourne la string décodée.
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Échec de lecture du fichier'));
    reader.readAsText(file);
  });
}

// Lit un fichier binaire (image, ou tout fichier) en ArrayBuffer, en Promise.
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Échec de lecture du fichier'));
    reader.readAsArrayBuffer(file);
  });
}

// Affiche un message d'erreur d'attache visible (jamais silencieux, cf. brief
// D2/cap images). Zone dédiée du composer, distincte de composer-skill-error
// (préoccupation différente).
function showComposerAttachError(msg) {
  const el = $('composer-attach-error');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}
function clearComposerAttachError() {
  const el = $('composer-attach-error');
  if (el) { el.setAttribute('hidden', ''); el.textContent = ''; }
}

// Ingestion d'un seul fichier : classification, downscale/lecture selon le
// kind, allocation attId, stockage IDB. Retourne le descripteur attachment
// (poussé dans pendingAttachments par l'appelant) ou null si rejeté (message
// d'erreur déjà affiché). Appelle ensureConversation() inconditionnellement :
// la conversation est créée dès la PREMIÈRE attache (pas seulement au premier
// envoi), pour disposer d'un currentConvId stable — clef de rattachement IDB
// (conversationId toujours renseigné, GC couvert par
// deleteResourcesByConversation) et support du compteur attSeq persisté.
async function ingestAttachmentFile(file) {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    showComposerAttachError('« ' + file.name + ' » dépasse 10 Mo — fichier ignoré.');
    return null;
  }
  const kind0 = classifyAttachmentKind(file.name, file.type);
  if (kind0 === 'image') {
    const imgCount = pendingAttachments.filter(a => a.kind === 'image').length;
    if (imgCount >= ATTACHMENT_MAX_IMAGES) {
      showComposerAttachError('Maximum ' + ATTACHMENT_MAX_IMAGES + ' images par message.');
      return null;
    }
  }

  ensureConversation();   // conversationId stable pour le rattachement IDB
  const conv = loadConversation(currentConvId);
  const alloc = allocateAttId(conv && conv.attSeq);
  const now = Date.now();

  try {
    if (kind0 === 'image') {
      const { blob, mime, w, h } = await downscaleImageFile(file);
      const buf = await blob.arrayBuffer();
      const rec = await storeAttachment(alloc.id, mime, file.name, buf, 'binary', currentConvId, now, Math.random, { w, h });
      if (!rec) { showComposerAttachError('Échec du stockage de « ' + file.name + ' ».'); return null; }
      persistAttSeq(alloc.counter);
      return { attId: alloc.id, name: file.name, mime, size: buf.byteLength, kind: 'image', w, h };
    }

    if (kind0 === 'text') {
      const text = await readFileAsText(file);
      const buf = utf8Encode(text);
      if (buf.byteLength > ATTACHMENT_TEXT_MAX_BYTES) {
        // Rétrogradé à binary : trop volumineux pour une injection texte (D3).
        const rec = await storeAttachment(alloc.id, file.type || 'application/octet-stream', file.name, buf, 'binary', currentConvId, now, Math.random);
        if (!rec) { showComposerAttachError('Échec du stockage de « ' + file.name + ' ».'); return null; }
        persistAttSeq(alloc.counter);
        return { attId: alloc.id, name: file.name, mime: file.type || 'application/octet-stream', size: buf.byteLength, kind: 'binary' };
      }
      const rec = await storeAttachment(alloc.id, file.type || 'text/plain', file.name, buf, 'inline', currentConvId, now, Math.random);
      if (!rec) { showComposerAttachError('Échec du stockage de « ' + file.name + ' ».'); return null; }
      persistAttSeq(alloc.counter);
      return { attId: alloc.id, name: file.name, mime: file.type || 'text/plain', size: buf.byteLength, kind: 'text' };
    }

    // binary
    const buf = await readFileAsArrayBuffer(file);
    const rec = await storeAttachment(alloc.id, file.type || 'application/octet-stream', file.name, buf, 'binary', currentConvId, now, Math.random);
    if (!rec) { showComposerAttachError('Échec du stockage de « ' + file.name + ' ».'); return null; }
    persistAttSeq(alloc.counter);
    return { attId: alloc.id, name: file.name, mime: file.type || 'application/octet-stream', size: buf.byteLength, kind: 'binary' };
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] ingestAttachmentFile:', e && e.message);
    showComposerAttachError('Échec du traitement de « ' + file.name + ' ».');
    return null;
  }
}

// Erreur d'upload direct dans la bibliothèque d'espace (D2 path 1, lot Cbis) —
// zone dédiée du drawer Space, distincte de composer-attach-error (préoccupation
// différente, cf. showComposerAttachError).
function showSpaceFilesError(msg) {
  const el = $('space-files-error');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}
function clearSpaceFilesError() {
  const el = $('space-files-error');
  if (el) { el.setAttribute('hidden', ''); el.textContent = ''; }
}

// Ingestion d'un fichier de bibliothèque d'espace (D2 path 1, lot Cbis) :
// mêmes caps/downscale que ingestAttachmentFile (image 1536px q0.85, texte
// ≤200kB inline-able), mais stocke via storeLibraryFile (kind:'library',
// spaceId) au lieu de storeAttachment (attId, conversationId) — pas d'attId,
// pas de conversation, pas de pendingAttachments : chemins distincts,
// mêmes helpers de traitement bas niveau réutilisés. Pas de résumé à
// l'ingestion (D7, séparé). Retourne le record stocké ou null (message
// d'erreur déjà affiché).
async function ingestLibraryFile(spaceId, file) {
  if (file.size > ATTACHMENT_MAX_BYTES) {
    showSpaceFilesError('« ' + file.name + ' » dépasse 10 Mo — fichier ignoré.');
    return null;
  }
  const kind0 = classifyAttachmentKind(file.name, file.type);
  const now = Date.now();
  try {
    if (kind0 === 'image') {
      const { blob, mime, w, h } = await downscaleImageFile(file);
      const buf = await blob.arrayBuffer();
      const rec = await storeLibraryFile(spaceId, mime, file.name, buf, 'binary', undefined, undefined, now, Math.random);
      if (rec && w && h) { rec.w = w; rec.h = h; await putResource(rec); }
      if (!rec) showSpaceFilesError('Échec du stockage de « ' + file.name + ' ».');
      return rec;
    }
    if (kind0 === 'text') {
      const text = await readFileAsText(file);
      const buf = utf8Encode(text);
      const cls = buf.byteLength > ATTACHMENT_TEXT_MAX_BYTES ? 'binary' : 'inline';
      const rec = await storeLibraryFile(spaceId, file.type || 'text/plain', file.name, buf, cls, undefined, undefined, now, Math.random);
      if (!rec) showSpaceFilesError('Échec du stockage de « ' + file.name + ' ».');
      return rec;
    }
    const buf = await readFileAsArrayBuffer(file);
    const rec = await storeLibraryFile(spaceId, file.type || 'application/octet-stream', file.name, buf, 'binary', undefined, undefined, now, Math.random);
    if (!rec) showSpaceFilesError('Échec du stockage de « ' + file.name + ' ».');
    return rec;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] ingestLibraryFile:', e && e.message);
    showSpaceFilesError('Échec du traitement de « ' + file.name + ' ».');
    return null;
  }
}

// Persiste le compteur d'attId de la conversation courante (monotone, jamais
// décrémenté — cf. allocateAttId). Écriture immédiate, indépendante de
// persistCurrent (peut survenir avant tout envoi de message).
function persistAttSeq(counter) {
  if (!currentConvId) return;
  const conv = loadConversation(currentConvId);
  if (!conv) return;
  conv.attSeq = counter;
  saveConversation(conv);
}

// Traite une FileList (picker ou drop) : ingère chaque fichier séquentiellement
// (le compteur attId doit avancer dans l'ordre d'attache), pousse les
// descripteurs obtenus dans pendingAttachments, puis rafraîchit les chips.
// Garde anti-course : attachIngestInFlight compte les ingestions en vol
// (try/finally) — sendMessage refuse l'envoi tant qu'il est non nul, sinon un
// drop suivi d'un Entrée immédiat verrait pendingAttachments vidé pendant
// l'ingestion, et l'attachment en retard accroché au message SUIVANT.
async function handleAttachFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  clearComposerAttachError();
  attachIngestInFlight++;
  try {
    for (const file of files) {
      const att = await ingestAttachmentFile(file);
      if (att) pendingAttachments.push(att);
    }
  } finally {
    attachIngestInFlight--;
  }
  renderComposerAttachments();
}

// Handler global (bouton trombone) : déclenche l'input file caché. Pattern
// identique à onImportDataClick (main.js).
function onAttachClick() {
  const input = $('attach-file-input');
  if (input) { input.value = ''; input.click(); }
}

// Handler global (onchange de l'input file caché).
function onAttachFilesSelected(input) {
  handleAttachFiles(input.files);
}

// Retrait d'une pièce jointe EN ATTENTE (avant envoi) — pas de suppression
// après envoi (non-goal du brief, cf. editUserMessage pour ce cas). L'entrée
// IDB déjà stockée devient orpheline (collectée à la suppression de la
// conversation, comportement assumé identique à une troncature par édition).
function removeComposerAttachment(attId) {
  pendingAttachments = pendingAttachments.filter(a => a.attId !== attId);
  renderComposerAttachments();
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
  // Aucun skill activé : rien à reconnaître — un `/mot` (même en position 0)
  // est du texte comme un autre, jamais un blocage « skill inconnue ».
  if (!listEnabledSkills().length) return { ok: true, literal, content: literal, isSkill: false };
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
  // Garde anti-course : une ingestion de pièce jointe encore en vol (drop puis
  // Entrée immédiat) — refuser l'envoi avec un message visible, sinon le
  // message partirait incomplet et l'attachment en retard s'accrocherait au
  // message suivant. Chemin unique : onComposerKey (Entrée) et onSendBtn
  // passent tous deux par ici, le garde couvre les deux.
  if (attachIngestInFlight > 0) {
    showComposerAttachError('Pièce jointe en cours de traitement… réessaie dans un instant.');
    return;
  }
  const ta = $('composer-text');
  const text = ta.value.trim();
  // Texte vide toléré SI des pièces jointes sont en attente (message
  // « image seule », cas naturel avec le trombone/drag&drop).
  if (!text && !pendingAttachments.length) return;

  // On résout AVANT de vider le composer : un slug invalide ne perd pas la saisie
  // ni ne consomme un tour modèle.
  const r = await resolveSend(text);
  if (!r.ok) { showComposerSkillError(r.error); return; }

  ta.value = ''; ta.style.height = 'auto';
  clearComposerSkillError();
  clearComposerAttachError();   // l'envoi effectif lève le message « en cours de traitement » d'un essai précédent
  hideSkillAutocomplete();

  // Confirmation en attente + saisie libre : la frappe vaut réponse/correction
  // (brief §4.5). On lève le widget avant d'envoyer comme un message normal.
  if (_confirmPending) dismissConfirmation();

  const attachments = pendingAttachments;
  pendingAttachments = [];
  renderComposerAttachments();
  await sendUserText(r.literal, r.isSkill ? r.content : undefined, attachments);
}

// Construit le `content` d'un message porteur d'attachments au tour d'attache
// (D2/D3) : lit chaque attachment depuis le cache session (déjà peuplé par
// storeAttachment à l'ingestion — cf. ingestAttachmentFile) et délègue à
// buildAttachedMessageContent (resources.js, fonction pure) la construction
// finale (string si aucune image, sinon tableau de content parts OpenAI).
// `baseText` : littéral ou contenu baké (slash-skill) déjà résolu par
// l'appelant — les DEUX doctrines (attachments + skill) composent : le texte
// baké (skill) reste la partie 'text' de base, les blocs texte-attachment (D3)
// et les parts image (D2) s'y ajoutent, sans interférence entre les deux
// mécanismes (bakeSkillMessage ignore tout ce qui concerne les attachments).
// Attachment introuvable en cache (rare : cache vidé sans reload) → dégradé
// silencieusement en descripteur direct plutôt que de bloquer l'envoi.
async function buildOutgoingContentForAttachments(baseText, attachments) {
  const textAttachments = [];
  const imageAttachments = [];
  const binaryAttachments = [];
  for (const att of attachments) {
    if (att.kind === 'text') {
      const rec = getCachedRecordByAttId(att.attId, currentConvId);
      const text = rec ? utf8Decode(rec.data) : '';
      textAttachments.push({ att, text });
    } else if (att.kind === 'image') {
      const rec = getCachedRecordByAttId(att.attId, currentConvId);
      const dataUrl = rec ? ('data:' + att.mime + ';base64,' + arrayBufferToBase64(rec.data)) : null;
      if (dataUrl) imageAttachments.push({ att, dataUrl });
    } else if (att.kind === 'binary') {
      // Brief H : aucun octet à envoyer, seulement son descripteur générique
      // (formatBinaryAttachmentDescriptor, resources.js) — le modèle l'ouvre
      // ensuite via un outil déclarant le contrat ref+content_b64 (docsDoctrinePrompt).
      binaryAttachments.push(att);
    }
  }
  return buildAttachedMessageContent(baseText, textAttachments, imageAttachments, binaryAttachments);
}

// Cœur d'un envoi utilisateur : crée la conv au besoin, pousse le message,
// persiste, relance la génération. Partagé par la saisie composer (sendMessage)
// et la reprise « fork B » d'ask_confirmation (Accepter → « Oui » / Rejeter → « Non »).
// `bakedContent` (optionnel) : contenu réellement envoyé/stocké pour le modèle
// (slash-commande skill = littéral + corps du skill). `text` reste le littéral
// affiché dans la bulle et conservé en `displayText`. `attachments` (optionnel,
// brief A) : tableau de descripteurs {attId,name,mime,size,kind,w?,h?} déjà
// stockés en IDB par ingestAttachmentFile. LOT 2 : si des attachments
// image/text sont présents, `content` devient les content parts OpenAI (image)
// et/ou les blocs texte injectés (D3) — SEULEMENT au tour d'attache ; la
// réécriture parts→descripteur a lieu une fois le tour terminé (onFinal de
// dispatchSend, cf. rewriteAttachedUserMessage).
async function sendUserText(text, bakedContent, attachments) {
  clearComposerSkillError();   // tout envoi effectif lève l'erreur skill du composer
  ensureConversation();
  const ts = Date.now();
  appendUserMessage(text, ts, attachments);
  const baseText = bakedContent != null ? bakedContent : text;
  let content = baseText;
  if (attachments && attachments.length) {
    content = await buildOutgoingContentForAttachments(baseText, attachments);
  }
  const msg = { role: 'user', content, ts };
  // Doctrine displayText (invariant n°1, META) : displayText = source UNIQUE
  // de la bulle dès que `content` diverge du littéral tapé. Deux causes,
  // cumulables : slash-skill bakée (bakedContent), et attachments (content
  // parts au tour d'attache, puis texte + descripteurs après réécriture, ou
  // bloc fencé persistant pour un fichier texte) — sans displayText, la bulle
  // et la textarea d'édition fuiteraient descripteurs/fence après reload.
  if (bakedContent != null || (attachments && attachments.length && content !== text)) {
    msg.displayText = text;
  }
  if (attachments && attachments.length) msg.attachments = attachments;
  currentThread.push(msg);
  persistCurrent();
  armIdleSummaryTimer();

  runGenerationFromCurrentThread();
}

// Cœur de l'envoi : recherche mémoire (sur le dernier message utilisateur),
// bannière éventuelle, puis dispatch. Partagé par l'envoi normal et la relance
// après édition d'un message — pour ne pas dupliquer la logique mémoire+outils.
// Pré-requis : le dernier message utilisateur est déjà dans currentThread.
function runGenerationFromCurrentThread() {
  // Sortie du mode sélection (D5, brief Cter) : point de convergence réel de
  // sendMessage/editUserMessage/regenerateResponse (piège 12) — un seul call
  // site plutôt que dispersé dans les 3 points d'entrée (décision Cter §2).
  exitMoveModeIfActive();
  const lastUser = currentThread.slice().reverse().find(m => m.role === 'user');
  // displayText = littéral tapé (slash-commande skill) ; à défaut, content. La
  // recherche mémoire porte sur le littéral, pas sur le corps du skill injecté.
  const text = lastUser ? (lastUser.displayText != null ? lastUser.displayText : lastUser.content) : '';

  const settings = loadSettings();
  let matches = [];
  if (settings.summaryInjectionMode !== 'never') matches = searchSummaries(text, currentConvId, activeSpaceId);

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

// Régénère la dernière réponse assistant : tronque après le dernier message
// user (élimine la réponse, ses acks d'outils et les bulles de tours
// intermédiaires), puis relance par le cœur commun — même chemin que l'envoi
// et l'édition (piège n°12), pas de duplication de la logique mémoire/outils.
// Un seul clic, pas de confirmation (cohérent avec editUserMessage) : le
// bouton n'est de toute façon visible que sur la dernière bulle assistant
// (cf. syncLastAssistantActions, ui.js), donc le geste est déjà borné.
function regenerateResponse(btn) {
  if (!configured || sending) return;
  if (_confirmPending) dismissConfirmation();   // même geste que sendMessage
  const lastUserIdx = currentThread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
  if (lastUserIdx < 0) return;
  currentThread = currentThread.slice(0, lastUserIdx + 1);
  persistCurrent();                             // troncature écrite avant relance
  renderThread(currentThread);
  runGenerationFromCurrentThread();
}

// Reprend la génération d'une réponse assistant tronquée (finish_reason:
// 'length', feature C) : appelle dispatchSend en mode continuation, SANS
// passer par runGenerationFromCurrentThread — pas de recherche mémoire ni de
// bannière résumés pour un simple raccord de texte coupé (le dernier message
// user, lui, a déjà été traité lors du tour qui a produit la troncature).
function continueTruncated(btn) {
  if (!configured || sending) return;
  const wrap = btn.closest('.msg');
  if (!wrap) return;
  const idx = msgIndex(wrap);
  if (idx < 0) return;
  const msg = currentThread[idx];
  // Garde : le message doit être le DERNIER assistant du fil (cohérent avec le
  // bouton, déjà désactivé ailleurs par syncLastAssistantActions — double
  // vérification ici car le DOM peut être périmé si l'utilisateur a été rapide)
  // et porter encore le flag truncated.
  if (!msg || msg.role !== 'assistant' || !msg.truncated) return;
  const lastAssistantIdx = currentThread.reduce((acc, m, i) => (m.role === 'assistant' ? i : acc), -1);
  if (idx !== lastAssistantIdx) return;
  dispatchSend([], { continueIndex: idx, wrap });
}

// Réécriture UNIQUE parts→descripteur (D2, politique de persistance) : mute en
// place le message user à `idx` de currentThread si son `content` est encore
// un tableau de content parts (collapseAttachedMessageContent, resources.js,
// IDEMPOTENTE — no-op si déjà une string). Appelée depuis onFinal de
// dispatchSend (couvre à la fois une fin normale ET un tour avorté : les deux
// chemins de runConversation appellent onFinal, cf. api.js) : après un tour
// avorté, le message NE DOIT PAS rester en parts indéfiniment, sinon le
// prochain envoi repousserait le même base64 (violation de « images envoyées
// SEULEMENT au tour d'attache »). Filet supplémentaire au tout début de
// dispatchSend (voir plus bas) pour le cas plus rare d'une exception réseau
// qui court-circuite onFinal.
function rewriteAttachedUserMessage(idx) {
  if (idx < 0 || idx >= currentThread.length) return;
  const m = currentThread[idx];
  if (m.role !== 'user' || !Array.isArray(m.content)) return;
  m.content = collapseAttachedMessageContent(m.content, m.attachments);
}

async function dispatchSend(matches, continuation) {
  hideSummaryBanner();
  // Filet : toute ANCIENNE pièce jointe encore en content-parts (message
  // user antérieur au dernier, dont le tour précédent n'a pas pu réécrire —
  // ex. exception réseau qui a court-circuité onFinal) est collapsée avant de
  // reconstruire le payload, pour ne jamais repousser deux fois le même
  // base64. Le dernier message user (tour courant) n'est jamais concerné ici :
  // s'il porte des attachments fraîchement attachés, c'est lui qui doit partir
  // en parts CE tour-ci.
  {
    const lastUserAt = currentThread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
    for (let i = 0; i < currentThread.length; i++) {
      if (i !== lastUserAt) rewriteAttachedUserMessage(i);
    }
  }
  const model = activeModel();   // modèle qui va produire cette réponse (override conv ou défaut)
  const serverName = (activeApiServer() || {}).name || '';   // provenance, persistée sur chaque message assistant
  const reasoningEffort = activeReasoningEffort();
  const sysParts = systemMessageParts();
  const sys = { role: 'system', content: [sysParts.root, sysParts.toolsSystem, sysParts.intent, sysParts.skills, sysParts.docs, sysParts.user].filter(Boolean).join('\n\n---\n\n') };
  // Résout les références de ressources ([resource_ref:…]) dans les entry.result
  // des tool-acks avant d'appeler expandThread. Inline → contenu UTF-8 décodé
  // (byte-identique d'un tour à l'autre via session cache) ; binary → descripteur.
  const threadMsgs = expandThread(resolveRecallImages(resolveResourceRefs(currentThread)));

  // Injection éphémère du contexte dynamique (date/heure, modèle, mémoire) +,
  // en sibling, le listing skills autotrigger — en préfixe du dernier message
  // utilisateur, pour préserver le préfixe stable (system + historique[0..N-1])
  // et permettre le KV cache prefix matching. Deux blocs distincts, concaténés
  // côte à côte (skills puis contexte), pas fusionnés en un seul appel.
  // Exclut les messages user SYNTHÉTIQUES (recall image, expandThread — flag
  // _synthetic) : l'injection <miaou_context> doit viser le dernier message user
  // AUTHENTIQUE, pas une ré-injection d'image (suspect S1, brief A2).
  const lastUserIdx = threadMsgs.reduce((acc, m, i) => (m.role === 'user' && !m._synthetic) ? i : acc, -1);
  const dynParts = contextBlockParts(matches);
  if (lastUserIdx >= 0) {
    const skillsCtx = dynParts.skillsContext;
    const ctx = buildContextBlock(matches);
    const prefix = skillsCtx + ctx + '\n\n---\n\n';
    const lastContent = threadMsgs[lastUserIdx].content;
    // Tour d'attache (D2, brief A lot 2) : `content` peut être un tableau de
    // content parts OpenAI (image jointe) — le préfixe dynamique s'insère alors
    // DANS la première part texte (créée si absente), jamais par concaténation
    // de chaîne sur le tableau (produirait "[object Object]…").
    threadMsgs[lastUserIdx] = {
      role: 'user',
      content: Array.isArray(lastContent)
        ? prefixTextInContentParts(lastContent, prefix)
        : prefix + lastContent,
    };
  }

  // `_synthetic` est un marqueur interne (suspect S1) : on le retire du payload
  // réseau — chaque message ne porte que {role, content} comme le reste.
  const apiMessages = [sys].concat(threadMsgs.map(m =>
    m && m._synthetic ? { role: m.role, content: m.content } : m
  )).filter(Boolean);

  // Manifeste du DERNIER ENVOI RÉEL (brief B, B4) : dérivé des mêmes sous-parts
  // que le payload qui part sur le fil, jamais re-parsé depuis les strings déjà
  // concaténées (audit §6). threadMsgs a déjà reçu le préfixe dynamique sur le
  // dernier message user (ci-dessus) : le manifeste le reflète tel qu'envoyé.
  // Recalculé à nouveau en fin de tour (recomputeLastContextManifest) une fois
  // les tool-acks/la réponse assistant ajoutés ; ici il doit déjà être posé
  // AVANT l'appel réseau pour que la pilule (syncContextCounter ci-dessous) et
  // le drawer, ouvert pendant le streaming, montrent la même chose — bug payé :
  // sans ce syncContextCounter(), la pilule restait au total du tour précédent
  // tant que le tour en cours n'était pas terminé, alors que le drawer (ouvert
  // au clic, recalculé à l'instant) affichait déjà le nouveau total.
  _lastContextManifest = buildContextManifest(sysParts, dynParts, threadMsgs, JSON.stringify(toolDefinitions()), null);
  syncContextCounter();

  // Descripteurs byte-stables des images du TOUR COURANT (D5, brief A lot 2) :
  // si le dernier message user part en content parts (tour d'attache), on
  // pré-calcule les mêmes lignes de descripteur que la réécriture définitive
  // post-tour (formatAttachmentDescriptor, depuis les champs FIGÉS de
  // message.attachments). streamCompletion (api.js) les utilise UNIQUEMENT si
  // la dégradation vision-less remplace les parts image — le brief exige
  // « texte + descripteur à la place », jamais un strip sans équivalent
  // textuel. Seul le dernier message user peut porter des parts (le filet en
  // tête de cette fonction a collapsé les messages antérieurs).
  let imageDescriptors;
  {
    const lastUserMsg = currentThread.reduce((acc, m) => (m.role === 'user' ? m : acc), null);
    if (lastUserMsg && Array.isArray(lastUserMsg.content) && lastUserMsg.attachments) {
      imageDescriptors = lastUserMsg.attachments
        .filter(a => a && a.kind === 'image')
        .map(formatAttachmentDescriptor);
    }
  }

  // Flag vision manuel (D5, brief A2) : le modèle qui va produire cette réponse
  // (`model` = activeModel(), override conv inclus) est-il marqué « sans vision »
  // sur le serveur actif ? Si oui, streamCompletion dégrade proactivement les
  // parts image en descripteur, sans attendre un 400 qu'Ollama ne renvoie pas.
  const visionDisabled = !serverModelVisionEnabled(activeApiServer(), model);

  // Mode continuation (feature C) : reprise d'une réponse assistant tronquée
  // (finish_reason: 'length'). Le thread ci-dessus se termine déjà par ce
  // message assistant — le payload API est construit EXACTEMENT comme pour un
  // envoi normal (system + historique + injection de contexte sur le dernier
  // message user), le modèle voit sa propre réponse coupée en dernier tour et
  // la continue. `prefix` = contenu déjà persisté de ce message ; la bulle
  // existante (`continuation.wrap`) est réutilisée, pas de nouvelle bulle.
  const isContinuation = !!continuation;
  const prefix = isContinuation ? currentThread[continuation.continueIndex].content : '';

  let wrap;
  if (isContinuation) {
    wrap = continuation.wrap;
    // Retire le bandeau de troncature au démarrage : la génération reprend,
    // le message n'est plus dans un état "en attente de continuation".
    const banner = wrap.querySelector('.msg-truncated');
    if (banner) banner.remove();
    startWaiter(wrap.querySelector('.body'));   // état WAITING, comme startAssistantMessage
    scrollBottom(true);   // clic "continuer" explicite : toujours suivre
  } else {
    wrap = startAssistantMessage(model, serverName);
  }
  // Acks MCP pré-rendus (avant await réseau) : { ack: descripteur brut, entry:
  // entrée currentThread, node: nœud DOM }. Stockés ici pour que onToolAcks
  // puisse rétro-appliquer la classe d'erreur si ack.error a été posé après l'await.
  let earlyRendered = [];
  setSending(true);
  try {
    await runConversation(apiMessages, {
      model,
      reasoningEffort,
      imageDescriptors,   // D5 : descripteurs du tour courant pour la dégradation vision-less
      visionDisabled,     // D5 (A2) : modèle marqué sans vision → dégradation proactive
      // Une continuation ne relance JAMAIS d'outils : autoriser des tool_calls
      // ici ouvrirait des cas de raccord ingérables (tours intermédiaires qui
      // pousseraient de nouvelles bulles alors qu'on veut concaténer le texte
      // dans la bulle existante). Cf. h.noTools, api.js/runConversation.
      noTools: isContinuation,
      onDelta: (full) => streamInto(wrap, isContinuation ? prefix + full : full),
      onReasoning: (full) => setReasoning(wrap, full),
      onToolTour: (content) => {
        if (content && content.trim()) {
          // Le tour tool_calls a produit du texte visible : on le finalise dans
          // sa propre bulle et on en ouvre une nouvelle pour la suite.
          const tourTs = Date.now();
          const tourMsg = { role: 'assistant', content, model, ts: tourTs };
          if (serverName) tourMsg.server = serverName;
          currentThread.push(tourMsg);   // avant finalizeAssistant, cf. onFinal
          finalizeAssistant(wrap, content);
          revealMsgTimestamp(wrap, tourTs);
          persistCurrent();
          wrap = startAssistantMessage(model, serverName);
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
        // Lu avant les insertions DOM ci-dessous : cf. streamInto/finalizeAssistant,
        // sinon isAtBottom() verrait déjà le nouveau contenu et répondrait "faux"
        // même quand l'utilisateur suivait le fil.
        const follow = isAtBottom();
        const pending = getPendingToolAcks();
        clearPendingToolAcks();
        for (const ack of pending) {
          // Whitelist unique ACK_COPY_FIELDS (utils.js) : couvre aussi les
          // champs d'enrichissement cross-turn, déjà posés si un outil interne
          // précédent a été drainé ici en même temps qu'un MCP.
          const entry = copyAckFields(ack, { role: 'tool-ack' });
          currentThread.push(entry);
          const node = placeToolAck(wrap, entry);
          earlyRendered.push({ ack, entry, node });
        }
        if (follow) scrollBottom(true);
      },
      // Vidange des acks d'outils APRÈS l'exécution des outils d'un tour, donc
      // AVANT la réponse finale : ils sont la provenance de la réponse et doivent
      // la précéder. Placés DANS la bulle assistant (`wrap`), entre l'en-tête
      // (icône + nom du modèle) et le corps (patienteur puis réponse), via
      // placeToolAck. Pas de persistCurrent ici (mutation mémoire + DOM seulement) :
      // l'unique écriture de l'échange a lieu dans onFinal.
      onToolAcks: ({ usage } = {}) => {
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

        // Lu avant les insertions DOM ci-dessous, même raison que onEarlyAcks.
        const follow = isAtBottom();
        const pending = getPendingToolAcks();
        clearPendingToolAcks();
        for (const ack of pending) {
          // Whitelist unique ACK_COPY_FIELDS (utils.js) : couvre aussi les
          // champs d'enrichissement cross-turn (posés par updateLastPendingToolAck
          // via le hook onEnrichLastAck, après exécution de chaque outil interne).
          const entry = copyAckFields(ack, { role: 'tool-ack' });
          currentThread.push(entry);
          placeToolAck(wrap, entry);
        }
        // Blocs NON-text renvoyés par un outil distant (image/resource/binaire) :
        // rendus DANS la bulle courante via la cascade D8, purement éphémères —
        // jamais poussés dans currentThread ni persistés (cf. D8).
        const blocks = getPendingToolBlocks();
        clearPendingToolBlocks();
        if (blocks.length) placeToolBlocks(wrap, blocks);
        if (follow) scrollBottom(true);

        // Recalcul MI-ÉCHANGE (pas seulement en fin de tour) : un tour d'outils
        // vient de se clore (tool-acks poussés dans currentThread ci-dessus),
        // potentiellement pas le dernier de la boucle (api.js relance tant que
        // finish_reason === 'tool_calls', jusqu'à MAX_TOURS). Sans ce recalcul,
        // un outil qui renvoie beaucoup de volume (ex. lecture de fichier
        // volumineuse) restait invisible dans la pilule/le drawer tant que
        // l'échange entier (potentiellement plusieurs tours) n'était pas
        // terminé — l'utilisateur ne pouvait pas réagir avant d'avoir déjà
        // saturé le contexte. midTurn=true : le drawer distingue ce total
        // encore provisoire d'un total de fin d'échange stable.
        recomputeLastContextManifest(matches, true);
        applyUsageToLastManifest(usage);
        syncContextCounter();
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
      onFinal: (content, reasoning, finishReason, { usage } = {}) => {
        if (isContinuation) {
          // Mute le message existant au lieu d'en pousser un nouveau : même
          // horodatage, même identité de message, juste plus de contenu.
          // finishReason === 'length' : re-troncature possible (chaîne de
          // continuations). 'aborted' (stop manuel pendant la continuation) :
          // le raccord est resté partiel, le flag reste — le bandeau reste et
          // « Continuer » peut reprendre. Seule une fin normale le retire.
          const m = currentThread[continuation.continueIndex];
          m.content = prefix + content;
          if (finishReason === 'length' || finishReason === 'aborted') m.truncated = true;
          else delete m.truncated;
          if (reasoning && reasoning.trim()) m.reasoning = joinReasoning(m.reasoning, reasoning);
          const body = wrap.querySelector('.body');
          if (body) body.dataset.raw = m.content;
          finalizeAssistant(wrap, m.content, m.truncated);
          if (m.reasoning) flushReasoning(wrap, m.reasoning);
          persistCurrent();
          recomputeLastContextManifest(matches);
          applyUsageToLastManifest(usage);
          syncContextCounter();
          setConnDot('ok');
          // Ni maybeTitle() ni nouveau ts : le message garde son horodatage
          // d'origine, la conversation a déjà été titrée (ou pas) à sa création.
          return;
        }
        const ts = Date.now();
        const msg = { role: 'assistant', content, model, ts };
        if (serverName) msg.server = serverName;
        if (reasoning && reasoning.trim()) msg.reasoning = reasoning;   // champ séparé, persisté
        // Réponse incomplète : champ optionnel, absent sinon. Deux causes —
        // coupe backend ('length', limite de tokens) ou stop manuel ('aborted',
        // seulement si du contenu a été reçu : stopper avant le premier token
        // laisse une bulle vide, « Régénérer » suffit). Permet « Continuer ».
        if (finishReason === 'length' || (finishReason === 'aborted' && content && content.trim())) {
          msg.truncated = true;
        }
        // Réécriture UNIQUE parts→descripteur (D2) : le tour vient de se
        // terminer (normalement OU avorté, cf. commentaire de
        // rewriteAttachedUserMessage) — le message user qui portait les
        // attachments de CE tour ne doit plus repartir en content parts au
        // tour suivant. AVANT de pousser le message assistant : l'index du
        // dernier user est stable tant qu'on n'a rien ajouté après lui.
        {
          const lastUserIdx = currentThread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
          rewriteAttachedUserMessage(lastUserIdx);
        }
        // Poussé AVANT finalizeAssistant : ce dernier appelle syncConvDownloadBtn(),
        // qui teste currentThread.some(role==='assistant') — sur une conversation
        // fraîche (premier tour), un ordre inversé laisserait le bouton caché
        // malgré la réponse déjà affichée (bug payé : visible seulement après reload).
        currentThread.push(msg);
        finalizeAssistant(wrap, content, msg.truncated);
        revealMsgTimestamp(wrap, ts);
        if (reasoning && reasoning.trim()) flushReasoning(wrap, reasoning);   // écrit la valeur finale au live (le throttle a pu sauter les derniers tokens)
        persistCurrent();
        recomputeLastContextManifest(matches);
        applyUsageToLastManifest(usage);
        syncContextCounter();
        setConnDot('ok');
        maybeTitle();
      },
      onHalt: (leadIn, question, { usage } = {}) => {
        // Fork B (brief §4) : la question (+ lead-in éventuel) devient un message
        // assistant en TEXTE CLAIR, persisté — aucun tool_call/tool_result natif ne
        // subsiste. Au tour suivant le modèle relit l'échange en clair et agit
        // (« Oui » → create_memory + narration ; « Non » → rien).
        // Réécriture parts→descripteur (D2) : la halte termine aussi le tour
        // pour le message user qui a pu porter des attachments.
        {
          const lastUserIdx = currentThread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
          rewriteAttachedUserMessage(lastUserIdx);
        }
        const text = [leadIn, question].map(s => (s || '').trim()).filter(Boolean).join('\n\n');
        const haltTs = Date.now();
        const haltMsg = { role: 'assistant', content: text, model, ts: haltTs };
        if (serverName) haltMsg.server = serverName;
        currentThread.push(haltMsg);   // avant finalizeAssistant, cf. onFinal
        finalizeAssistant(wrap, text);
        revealMsgTimestamp(wrap, haltTs);
        persistCurrent();
        recomputeLastContextManifest(matches);
        applyUsageToLastManifest(usage);
        syncContextCounter();
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
    syncReasoningUI();       // masque le sélecteur si reasoning_effort a été rejeté pendant le tour (cf. api.js), y compris quand le retry sans paramètre a réussi
    armIdleSummaryTimer();   // réarme quelle que soit l'issue du tour (réponse, halte, erreur)
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
  setTitleEditable(convId, false);
  const title = await runBackgroundTask('titrage…', () => generateTitle(thread));
  if (title) applyGeneratedTitle(convId, title);    // sinon on garde le titre provisoire
  setTitleEditable(convId, true);
}

// Bouton topbar (onclick="regenerateTitle()") : force un nouveau titrage même
// si un titre manuel a déjà été fixé (contrairement à maybeTitle, qui ne
// tourne qu'une fois via needTitle). Mêmes garde-fous que maybeTitle sinon :
// convId/thread figés avant l'appel async, pas de titre provisoire.
async function regenerateTitle() {
  if (!currentConvId || !currentThread.length) return;
  const convId = currentConvId;
  const thread = currentThread.slice();
  setTitleEditable(convId, false);
  const title = await runBackgroundTask('titrage…', () => generateTitle(thread));
  if (title) applyGeneratedTitle(convId, title);
  setTitleEditable(convId, true);
}

// Verrouille/déverrouille l'édition du titre pendant un (re)titrage async ;
// no-op si l'utilisateur a navigué ailleurs entre-temps (convId figé vs
// currentConvId courant), pour ne pas rendre éditable le titre d'une autre conv.
function setTitleEditable(convId, editable) {
  if (convId !== currentConvId) return;
  const titleEl = $('conv-title');
  if (titleEl) titleEl.contentEditable = editable ? 'true' : 'false';
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
  if (!s) return;
  if (!loadConversation(id)) return;   // supprimée pendant la génération (async) : ne pas ressusciter l'entrée
  saveSummary(id, {
    title: conv.title,
    timestamp: conv.updatedAt || conv.timestamp,
    summary: s.summary,
    keywords: s.keywords,
    messageCount: conv.messages.length,
  });
}

// ── Description de fichier de bibliothèque d'espace (D7, lot Cbis) ─────────
// Nommée « description », PAS « résumé » : le texte ne condense pas le
// contenu, il décrit ce que le fichier EST (nature, sujets, structure) pour
// que le modèle juge s'il doit l'ouvrir (files__read) — cf. FILE_DESCRIPTION_PROMPT.
// Budget d'extraction pour un binaire routé via mcp_docs (proposition A5,
// confirmée) : suffisant pour une description ≤2 phrases via NOTHINK, sans
// solliciter excessivement le modèle actif sur un document volumineux.
const FILE_DESCRIPTION_EXTRACT_MAX_CHARS = 8 * 1024;

// Trigger à l'INGESTION (upload direct D2 path 1, promotion utilisateur D2
// path 2), jamais un daemon — pas de queue/retry (D7 : dégradé, jamais
// bloquant). PAS appelé pour la promotion modèle (D2 path 3, files__promote) :
// la description y est déjà fournie par le modèle et stockée telle quelle (A3
// confirmé), cette fonction ne s'applique qu'aux deux chemins SANS
// description d'origine. Gouverné par le toggle describeFiles (défaut ON) —
// no-op silencieux si OFF (pas de statut "désactivé" par carte, juste
// l'absence de description, comme un échec ordinaire). Image : skip v1 (pas
// de modèle vision dédié, décision D7). `force` (action manuelle
// "(re)générer" d'une carte, cf. renderSpaceFilesList) : ignore le toggle ET
// une description déjà présente — sinon (trigger d'ingestion), les deux
// court-circuitent silencieusement (pas un échec, juste un no-op).
async function describeFileIfNeeded(fileId, onStatus, force) {
  if (!force && !loadSettings().describeFiles) return;
  const record = await getResource(fileId);
  if (!record || record.kind !== 'library') return;
  if (!force && record.description) return;
  if (record.mime && record.mime.startsWith('image/')) return;   // skip v1, pas d'erreur

  if (onStatus) onStatus('loading');
  let text = null;
  if (record.class === 'inline') {
    text = utf8Decode(record.data).slice(0, FILE_DESCRIPTION_EXTRACT_MAX_CHARS);
  } else {
    text = await extractBinaryFileTextForDescription(record, FILE_DESCRIPTION_EXTRACT_MAX_CHARS);
  }
  if (!text) { if (onStatus) onStatus('failed'); return; }   // pas d'outil qualifiant, ou extraction vide

  const description = await runBackgroundTask('description de fichier…', () => silentCompletion([
    { role: 'system', content: FILE_DESCRIPTION_PROMPT },
    { role: 'user', content: text },
  ], { temperature: 0.2, timeout: 60000 }));
  if (!description) { if (onStatus) onStatus('failed'); return; }

  record.description = capFileDescription(description);
  try {
    await putResource(record);
    if (onStatus) onStatus('done');
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] describeFileIfNeeded:', e && e.message);
    if (onStatus) onStatus('failed');
  }
}

// ── Nettoyage des résumés orphelins (démarrage) ──────────────────────────────
// Résidus d'une suppression concurrente à une génération de résumé (race
// corrigée à la source dans summarizeIfNeeded/restoreSummaryItem/runBackfill,
// ceci couvre l'état déjà écrit par une race passée, ou une interruption avant
// deleteSummaryEntry dans deleteConv). pruneOrphanSummaries (storage.js) est pure.
function pruneOrphanSummariesOnInit() {
  const pruned = pruneOrphanSummaries(loadSummaries(), listAllConversations());
  persistSummaries(pruned);
}

// ── Backfill modèle : attribue le modèle courant aux réponses sans modèle ───
function backfillMessageModels() {
  // Modèle du serveur actif (activeApiConfig, filet legacy inclus) : sur une
  // install configurée uniquement via les cartes serveurs, loadSettings().model
  // est vide et le backfill serait inerte.
  const model = activeApiConfig().model;
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
        if (s && loadConversation(c.id)) saveSummary(c.id, {
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

  migrateSpacesIfNeeded();   // backfill idempotent spaceId/scope + registre miaou-spaces, avant tout rendu
  activeSpaceId = getActiveSpaceId();   // persistance miaou-active-space (A3) ; défaut DEFAULT_SPACE_ID
  // Fire-and-forget (résolution après le premier rendu) : la pilule/l'inspecteur
  // calculés avant résolution ignorent la bibliothèque du Space, sous-évaluant le
  // total tant que ce .then() n'a pas rafraîchi le compteur (cf. commentaire de
  // loadSpaceLibrary, resources.js — écart pilule/inspecteur/nouvelle conv payé
  // en prod, brief bugfix contexte).
  loadSpaceLibrary(activeSpaceId).then(() => {
    _lastContextManifest = null;   // le manifeste calculé avant résolution est périmé (biblio absente)
    syncContextCounter();
  });
  syncSpaceUI();
  loadApiServers();   // déclenche la migration silencieuse url/key/model → serveur "Par défaut"
  const s = loadSettings();
  $('set-system').value = s.systemPrompt || '';
  $('set-highlight').checked = s.highlight !== false;
  highlightEnabled = s.highlight !== false;
  $('set-modelselector').checked = !!s.showModelSelector;
  $('set-reasoning-effort').value = s.reasoningEffort || '';
  syncSettingsReasoningLabel();
  $('set-reasoningselector').checked = !!s.showReasoningSelector;
  $('set-contextwindow').value = s.contextWindow || '';
  setSummaryInjectionModeUI(s.summaryInjectionMode);
  setThemeUI(s.theme || 'system');
  applyTheme(s.theme || 'system');
  syncActiveApiServerUI();
  syncModelUI();
  syncReasoningUI();

  // Dirty-tracking du bouton « Enregistrer » : délégation input/change sur le
  // drawer (couvre champs texte et toggles) ; les chemins programmatiques sans
  // événement appellent updateSettingsDirty() directement (cf. ui.js).
  $('drawer').addEventListener('input', updateSettingsDirty);
  $('drawer').addEventListener('change', updateSettingsDirty);
  updateSettingsDirty();

  // Catégories du drawer réglages : overflow visible (.settled) seulement une
  // fois la transition d'ouverture terminée, pour que les .model-menu absolus
  // ne soient pas clippés sans montrer le contenu déborder pendant l'animation.
  document.querySelectorAll('#drawer .set-cat-body').forEach((b) => {
    b.addEventListener('transitionend', (e) => {
      if (e.target !== b || e.propertyName !== 'grid-template-rows') return;
      b.classList.toggle('settled', b.classList.contains('open'));
    });
  });

  backfillMessageModels();
  renderConvList();
  resetToEmpty();
  syncConfigured();
  const ta = $('composer-text');
  if (ta && !ta.disabled) ta.focus();
  if (!isMobileLayout() && listAllConversations().length > 0) $('app').classList.add('sidebar-open');
  // Posée APRÈS la décision sidebar-open : le brand topbar et le « + » sont
  // masqués en dur tant que .booted est absente (pas de flash au chargement
  // quand l'historique non vide va ouvrir la sidebar).
  $('app').classList.add('booted');
  initSidebarResize();
  initVisualViewport();
  wireTitleEditing();

  // Résumé sur inactivité : toute frappe/clic n'importe où dans l'app (composer,
  // édition d'un message passé, titre de conversation, réglages, cartes MCP/skills…)
  // réarme le timer. Délégation globale plutôt qu'un handler par point de saisie
  // (plusieurs zones éditables sont créées dynamiquement, sans oninput= dédié).
  document.addEventListener('input', armIdleSummaryTimer);
  document.addEventListener('keydown', armIdleSummaryTimer);
  document.addEventListener('click', armIdleSummaryTimer);

  // Délégation unique pour les liens [conv_ref:ID] résolus par resolveConvRefs
  // (ui.js) en <a href="#miaou-conv:ID">. Un seul listener, posé une fois, plutôt
  // qu'un onclick par lien reconstruit à chaque rendu.
  $('messages').addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#miaou-conv:"]');
    if (!a) return;
    e.preventDefault();
    if (sending) return;   // pas de navigation pendant un stream en cours
    const id = decodeURIComponent(a.getAttribute('href').slice('#miaou-conv:'.length));
    selectConv(id);
  });

  prefetchModels();      // liste des modèles (cache session) → sélecteur composer
  // handshake + tools/list des serveurs MCP activés ; rafraîchit aussi la pilule de
  // contexte, sous-évaluée tant que toolDefinitions() ignore les outils MCP distants.
  reconnectMcpServers().then(() => {
    _lastContextManifest = null;
    syncContextCounter();
  });
  // méta des skills en mémoire → autocomplétion + outils + légende « / » ; rafraîchit
  // aussi la pilule de contexte, sous-évaluée tant que le bloc skills autotrigger
  // (buildSkillsContextBlock) n'a pas ces données (même écart que loadSpaceLibrary).
  loadSkillsCache().then(() => {
    syncSkillHintUI();
    _lastContextManifest = null;
    syncContextCounter();
  });
  pruneOrphanSummariesOnInit();   // résidus d'une suppression concurrente à une génération (avant le backfill, sinon liste faussée)
  runBackfill();         // auto-gardé sur la présence d'URL
  armIdleSummaryTimer(); // résumé sur inactivité, réarmé à chaque activité
}

if (typeof __TEST_ENV__ === 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
