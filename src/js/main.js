/* ── main.js ───────────────────────────────────────────────────────────────
   Orchestration : init, câblage des événements, construction du contexte
   d'appel (message système unique), flux d'envoi, titrage, résumé en sortie,
   backfill au démarrage. Charge en dernier dans le build.
   ────────────────────────────────────────────────────────────────────────── */

// MAX_SUMMARIES (plafond de résumés injectés) est déclaré dans storage.js,
// dérivé de BUILD_CONFIG — n'est référencé ici/ailleurs qu'en corps de fonction.

// ── Overlay de préchargement (boot) ─────────────────────────────────────────
// Le déclenchement du fade-in + blink (_bootReady/_bootReadyAt, classe
// .boot-ready) est posé par un <script> inline dans index.html, PLACÉ AVANT
// les <script src> CDN (marked/dompurify/prism) : ces derniers sont bloquants
// et retardaient sinon visiblement l'apparition du logo le temps de leur
// fetch. _bootReady/_bootReadyAt sont donc des globals déjà posés quand ce
// fichier s'exécute — ne pas les redéclarer ici.
// Le délai minimum d'affichage est mesuré depuis l'instant où fade-in + blink
// DÉMARRENT réellement (_bootReadyAt), PAS depuis le chargement du script :
// sur Chrome .boot-ready peut arriver sensiblement après le parse (paint
// retardé), et mesurer depuis le parse faisait disparaître l'overlay PENDANT
// le clignement (retour Julien). En calant sur _bootReadyAt, le double-clin
// (fin ~1.7s après ready) a toujours le temps de jouer. finishBoot() est
// appelée depuis init() sur DOMContentLoaded, qui peut tirer avant que le rAF
// du script inline n'ait posé .boot-ready : sans garde, _bootReadyAt à 0
// serait lu comme « ready depuis toujours » et le setTimeout(1800) expirerait
// parfois avant même le démarrage du fade-in — _bootReady fait attendre le
// vrai rAF avant de planifier.
const BOOT_MIN_AFTER_READY_MS = 1800;
function finishBoot() {
  const el = document.getElementById('boot-overlay');
  if (!el) return;
  // typeof (pas de référence directe) : le test runner QuickJS évalue ce
  // fichier seul, jamais index.html — _bootReady/_bootReadyAt n'y sont posés
  // par aucun script.
  if (typeof _bootReady === 'undefined' || !_bootReady) { requestAnimationFrame(() => finishBoot()); return; }
  const since = Date.now() - _bootReadyAt;
  const wait = Math.max(0, BOOT_MIN_AFTER_READY_MS - since);
  setTimeout(() => {
    el.classList.add('boot-done');
    // Animation d'entrée de la liste jouée PENDANT l'estompage de l'overlay
    // (320ms), pas après : accrochée à la fin du fade, la sidebar resterait
    // figée le temps qu'il se termine, puis s'animerait — décalage visible.
    // Ici la liste se met en place au moment même où l'app se découvre. Le
    // re-render est le seul du démarrage à ce titre (celui d'init() a déjà eu
    // lieu, sous l'overlay opaque, donc invisible).
    animateNextConvList();
    renderConvList();
  }, wait);
}

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
let _sendResolving = false;    // verrou anti double-envoi pendant l'await resolveSend (B7) — cf. sendMessage
let _lastContextManifest = null;   // manifeste du dernier envoi RÉEL (brief B, B4) — null si aucun envoi cette session
let _lastContextManifestMidTurn = false;   // true si _lastContextManifest a été recalculé PENDANT une boucle d'outils (tour non terminé), cf. recomputeLastContextManifest

// ── Registre des générations actives (lot T-1) ──────────────────────────────
// Une « génération » = un échange en vol (stream SSE + boucle d'outils) qui
// APPARTIENT à une conversation, pas à l'écran. Elle continue de recevoir, de
// muter SON thread et de persister dans SA conversation même si l'utilisateur
// navigue ailleurs — voire change d'Espace.
//
// Portée de survie : l'onglet ouvert seulement. Aucun état de stream partiel
// n'est persisté ; un reload perd les générations en vol (décision de lot).
//
// Clé par convId, PAS par gen.id : tous les consommateurs (rebranchement ici,
// badge T-2, drawer T-3) posent la même question — « cette conversation
// génère-t-elle ? ». Corollaire voulu : deux générations concurrentes sur la
// MÊME conversation sont impossibles par construction (un second envoi reste
// refusé/mis en file par les interjections, lot Q).
const _activeGenerations = new Map();   // Map<convId, gen>

// Objet génération. `thread` est SON tableau de travail : les hooks le mutent
// au lieu de currentThread, et persistGeneration l'écrit dans gen.convId.
// `spaceId` est figé au démarrage : une génération lancée dans l'Espace X reste
// dans le référentiel de X même si l'utilisateur bascule sur Y (herméticité,
// piège 18 — exploité par T-1c pour le contexte d'exécution des outils).
function createGeneration(convId, thread, opts) {
  const o = opts || {};
  return {
    id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    convId,
    spaceId: activeSpaceId,
    thread,
    model: o.model || '',
    serverName: o.serverName || '',
    reasoningEffort: o.reasoningEffort || '',
    convModel: currentConvModel,                    // override de conv, figé (persistGeneration ne lit pas l'écran)
    convReasoningEffort: currentConvReasoningEffort,
    needTitle: needTitle,                           // besoin de titrage figé au démarrage (piège 9 : ne pas lire l'écran à la fin)
    abort: null,                                    // AbortController du stream courant (posé par streamCompletion)
    status: 'waiting',                              // waiting | streaming | tools | done | error | aborted
    startedAt: Date.now(),
    // ── Présentation (lot T-1b) ──────────────────────────────────────────
    // `wrap` : bulle assistant en cours DANS LE DOM, ou null si la génération
    // ne possède pas l'écran. Jamais lu pour construire une entrée de thread —
    // les données ne dépendent jamais de l'affichage (invariant du lot).
    wrap: null,
    // Texte partiel du tour COURANT. Sans lui, il ne vivrait que dans le DOM
    // (body.dataset.raw) : c'est la seule donnée réellement perdue par un
    // détachement, et donc la seule chose que le rebranchement ne pourrait pas
    // restituer. Remis à zéro à chaque frontière de tour.
    partialContent: '',
    partialReasoning: '',
  };
}

// LE prédicat de possession d'écran (lot T-1b). Un seul, jamais réécrit
// localement — même discipline que spaceConvIds (piège 18) et generationFor.
// TOUS les effets d'écran des hooks passent par lui.
//
// Invariant du lot : les hooks se scindent en deux temps, dans cet ordre —
//   (a) muter gen.thread            → TOUJOURS
//   (b) refléter dans le DOM        → seulement si genOwnsScreen(gen)
// et (a) ne doit JAMAIS dépendre de (b).
function genOwnsScreen(gen) {
  return !!gen && gen.convId === currentConvId;
}

function registerGeneration(gen) {
  _activeGenerations.set(gen.convId, gen);
  startGenerationRelay(gen.convId);
  // Les deux surfaces à rafraîchir (lot T-2) : la liste de gauche (badge de
  // conversation) et le sélecteur d'espaces + hamburger (agrégats).
  renderConvList();
  syncSpaceUI();
}

function unregisterGeneration(gen) {
  // Ne retirer que SI c'est bien cette génération : une conversation supprimée
  // puis recréée, ou un enchaînement rapide, ne doit pas faire sauter la
  // génération d'une autre.
  if (_activeGenerations.get(gen.convId) === gen) _activeGenerations.delete(gen.convId);
  stopGenerationRelay(gen.convId);
  // « Non lu » (lot T-2) : la génération se termine alors que l'utilisateur
  // regarde AILLEURS. Le prédicat d'écran est genOwnsScreen, jamais un test
  // réécrit ici — et il est évalué APRÈS le retrait du registre, pour que
  // convBadgeState bascule bien sur 'unread' et pas sur un 'working' résiduel.
  if (!genOwnsScreen(gen)) markConvUnread(gen.convId);
  renderConvList();
  syncSpaceUI();
  // Actions de synchro multi-onglets différées (lot J, J3) : rejouées quand
  // PLUS AUCUNE génération ne tourne. Le drain vivait dans setSending(false)
  // avant T-1a ; il ne pouvait plus y rester, `sending` ne parlant que de
  // l'écran (un simple changement de conversation le fait basculer alors qu'une
  // génération mute encore son thread). La condition est bien « aucune
  // génération », pas « pas celle-ci » : une action différée relit le storage.
  if (!_activeGenerations.size) drainPendingSync();
}

// LE prédicat de génération en vol. Un seul, jamais réécrit localement (même
// discipline que spaceConvIds, piège 18) : tous les call-sites qui demandent
// « cette conv est-elle occupée ? » passent par ici.
function generationFor(convId) {
  return convId == null ? null : (_activeGenerations.get(convId) || null);
}

function isGenerating(convId) {
  return !!generationFor(convId);
}

// ── Badges d'activité (lot T-2) ─────────────────────────────────────────────
// « Non lu » = une génération s'est terminée pendant que l'utilisateur
// regardait AILLEURS, et il n'est pas revenu depuis. VOLATILE par décision
// (B1) : un Set en mémoire, vidé au reload — exactement la portée de survie des
// générations elles-mêmes (T-1 décision 1). Aucune persistance, aucune clé
// localStorage, aucun champ sur la conversation : une génération ne survit pas
// au reload, son « non lu » non plus.
const _unreadConvs = new Set();

// Marquage à la FIN d'une génération, et seulement si l'écran ne la possédait
// pas : une réponse qu'on a regardée arriver n'est pas « non lue ». Le prédicat
// d'écran reste genOwnsScreen (T-1), jamais un test réécrit ici.
function markConvUnread(convId) {
  if (convId == null) return;
  _unreadConvs.add(convId);
}

// B2 : l'ouverture de la conversation SUFFIT à marquer comme lu. Pas de
// sémantique par message ni de « bas du fil atteint » — MIAOU n'en a nulle part
// ailleurs, en introduire une ici serait disproportionné.
function markConvRead(convId) {
  if (convId == null) return false;
  return _unreadConvs.delete(convId);
}

// LE prédicat d'état de badge d'une conversation. Un seul, jamais réécrit
// localement (même discipline que spaceConvIds, piège 18) : liste de gauche,
// agrégation par Espace et agrégation hamburger en dérivent toutes.
// L'ordre compte : une conversation qui a du non-lu ET qui regénère affiche
// 'working' — l'activité en cours est l'information la plus fraîche.
function convBadgeState(convId) {
  if (isGenerating(convId)) return 'working';
  return _unreadConvs.has(convId) ? 'unread' : null;
}

// Agrégation par Espace — LECTURE CROSS-SPACE ASSUMÉE (deuxième exception
// sanctionnée au piège 18, cf. CLAUDE.md et docs/spaces.md). Portée strictement
// bornée : on expose l'EXISTENCE d'une activité et le NOM de l'Espace, jamais
// un titre de conversation ni un contenu. Un Espace reste hermétique quant à ce
// qu'il contient ; on ne divulgue que le fait qu'il travaille.
//
// La source de l'appartenance est `gen.spaceId` (figé au démarrage de la
// génération, T-1) pour le working, et le spaceId de la conversation pour
// l'unread — jamais un filtre `c.spaceId === x` réécrit localement.
function spaceBadgeState(spaceId) {
  const states = [];
  for (const gen of _activeGenerations.values()) {
    if (gen.spaceId === spaceId) states.push('working');
  }
  if (_unreadConvs.size) {
    const convs = listAllConversations();
    for (const c of convs) {
      if (c.spaceId === spaceId && _unreadConvs.has(c.id)) states.push('unread');
    }
  }
  return resolveActivityBadge(states);
}

// Agrégat de TOUS les Espaces sauf ceux exclus. Deux appelants, deux portées :
//  - sélecteur d'espaces REPLIÉ → exclut l'Espace actif : il répond « y a-t-il
//    de l'activité AILLEURS ? » (le détail par Espace se lit au dépliage).
//  - hamburger → n'exclut RIEN (B6) : sidebar repliée, l'utilisateur ne voit ni
//    la liste des conversations ni le sélecteur, c'est le SEUL indicateur
//    disponible. Le restreindre à l'ailleurs laisserait muette une conversation
//    active de l'Espace courant, précisément celle qu'il ne peut pas voir.
function aggregateBadgeState(excludeSpaceId) {
  const states = [];
  for (const gen of _activeGenerations.values()) {
    if (excludeSpaceId != null && gen.spaceId === excludeSpaceId) continue;
    states.push('working');
  }
  if (_unreadConvs.size) {
    for (const c of listAllConversations()) {
      if (excludeSpaceId != null && c.spaceId === excludeSpaceId) continue;
      if (_unreadConvs.has(c.id)) states.push('unread');
    }
  }
  return resolveActivityBadge(states);
}

// ── Rebranchement / débranchement de l'écran (lot T-1b) ─────────────────────
// Le fil d'une génération en vol se termine par les acks du tour courant SANS
// l'assistant qui les clôt (il n'existe qu'à onFinal). renderThread les rendrait
// donc en blocs autonomes (sa branche « acks orphelins »), c'est-à-dire nus,
// hors bulle — divergence live/reload. On sépare donc le fil en deux :
// tout ce qui précède la queue d'acks part au rendu normal, la queue est
// replacée dans la bulle vive. Pur, testable QuickJS.
function splitTrailingAcks(thread) {
  const t = thread || [];
  let i = t.length;
  while (i > 0 && isAckRole(t[i - 1].role)) i--;
  return { body: t.slice(0, i), trailingAcks: t.slice(i) };
}

// Re-rendu du fil AFFICHÉ, conscient d'une génération en vol (lot T-1b). Tout
// appelant qui reconstruit `#thread` de fond en comble (bascule de coloration,
// réglages, édition/troncature de message) DOIT passer par ici : un
// renderThread(currentThread) nu détruirait la bulle vive et laisserait
// gen.wrap pointer sur un nœud orphelin — le stream continuerait d'écrire dans
// le vide jusqu'à la fin du tour, sans erreur visible.
function rerenderCurrentThread() {
  const gen = generationFor(currentConvId);
  if (gen) attachGenerationToScreen(gen);
  else renderThread(currentThread);
}

// Rebranche l'affichage sur une génération en vol. Appelé par openConversation
// quand la conversation ouverte génère.
//
// Le rendu de l'historique déjà produit passe par renderThread — LE MÊME CHEMIN
// QUE LE RELOAD, jamais une reconstruction dédiée : c'est l'invariant live=reload
// du lot Q qui paie ici (la piste « chemin de rendu spécial » avait produit le
// .ack-shell et une divergence à rustiner).
function attachGenerationToScreen(gen) {
  if (!gen) return;
  const split = splitTrailingAcks(gen.thread);
  renderThread(split.body);
  // Bulle vive pour la suite : elle héberge les acks du tour courant puis
  // recevra le stream. Même geste qu'au démarrage d'un échange.
  const wrap = startAssistantMessage(gen.model, gen.serverName);
  gen.wrap = wrap;
  for (const a of split.trailingAcks) placeToolAck(wrap, a, false);
  // Restitution de l'état courant du tour. Le patienteur (posé par
  // startAssistantMessage) tient déjà l'état WAITING/TOOLS ; s'il y a du texte
  // partiel, streamInto le remplace (il coupe le patienteur lui-même).
  if (gen.partialReasoning) flushReasoning(wrap, gen.partialReasoning);
  if (gen.partialContent) streamInto(wrap, gen.partialContent);
  scrollBottom(true);
}

// Débranche une génération de l'écran (l'utilisateur la quitte). Ne coupe RIEN
// de la génération elle-même : surtout pas d'abort. Le patienteur appartient à
// l'écran (piège 13) et suit la bulle qui disparaît.
function detachGenerationFromScreen(gen) {
  if (!gen) return;
  gen.wrap = null;
  stopWaiter();
  cancelStreamRender();
  cancelReasoningRender();
}

// Persistance d'une génération : même corps que persistCurrent, mais lit
// gen.thread et écrit dans gen.convId — jamais l'état d'écran. C'est LE point
// qui rend une génération détachée inoffensive : sans lui, une génération sur A
// écrirait le thread de A dans la conversation affichée B (corruption franche).
function persistGeneration(gen) {
  if (!gen || !gen.convId) return;
  const conv = loadConversation(gen.convId);
  if (!conv) return;   // conversation supprimée pendant la génération : ne pas la ressusciter
  conv.messages = projectThreadToMessages(gen.thread);
  if (!conv.timestamp) conv.timestamp = Date.now();
  conv.updatedAt = Date.now();
  if (gen.convModel) conv.model = gen.convModel; else delete conv.model;
  if (gen.convReasoningEffort) conv.reasoningEffort = gen.convReasoningEffort; else delete conv.reasoningEffort;
  saveConversation(conv);
  renderConvList();
}

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
    // Ne jamais résumer une conversation qui génère — y compris une génération
    // DÉTACHÉE (`sending` ne parle plus que de l'écran depuis T-1a, il ne
    // suffirait plus). summarizeIfNeeded re-vérifie de son côté.
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
    // Métadonnée seule → écriture ciblée (ne jamais réécrire `messages` depuis
    // le cache : une conversation froide les a vides).
    if (loadConversation(currentConvId)) {
      persistConversationField(currentConvId, { model: currentConvModel || undefined });
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
    if (loadConversation(currentConvId)) {
      persistConversationField(currentConvId, { reasoningEffort: currentConvReasoningEffort || undefined });
    }
  }
  syncReasoningUI();
}

// ── Construction du message système (un seul, concaténé) ────────────────────
function buildSummaryBlock(matches) {
  if (!matches.length) return '';
  const lines = matches.map(m => `- [id: ${m.id}] « ${m.title} » — ${m.summary}`);
  return "Conversations passées potentiellement pertinentes (résumés). " +
         "Si l'une mérite un examen détaillé, appelle conv__get avec son id " +
         "et with_contents=true. Tu peux aussi appeler conv__list pour " +
         "parcourir l'historique — sans date pour tout lister, ou avec une date " +
         "pour te limiter à une période.\n" +
         lines.join('\n');
}

// Souvenirs utilisateur actifs injectés en contexte (injection complète, pas de
// filtrage/ranking : volume faible attendu pour un usage personnel). Scope
// profile (global) + Space actif uniquement (brief D3) — jamais les souvenirs
// d'un autre Space.
function buildMemoryEntriesBlock() {
  // Portée = `memoryScopesForSpace` (storage.js), la MÊME que celle qu'appliquent
  // memory__update/memory__delete : ce qu'on montre au modèle et ce qu'il peut
  // toucher doivent rester le même ensemble, jamais deux listes réécrites côte
  // à côte (cf. le bug du profil inéditable).
  const entries = listMemoryEntries(memoryScopesForSpace(activeSpaceId));
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
//
// L'EXCEPTION « une doctrine te le demande nommément » N'EST PAS COSMÉTIQUE.
// Deux textes parlaient de la même skill au modèle : DOCS_DOCTRINE (prompt
// système) « avant ton PREMIER appel à un outil miaou__docs__*, appelle
// skills__read avec le slug docs », et ce bloc-ci « aucune n'est obligatoire,
// n'en lis pas au cas où ». Contradiction pure — et ce bloc gagne, parce qu'il
// est recalculé à chaque tour donc plus proche du dernier message user que le
// prompt système. Payé en test réel (gemma-4-e4b, 2026-08-29) : le modèle a
// listé la skill `docs` dans son raisonnement, a explicitement statué « the
// available skills context includes docs », ne l'a pas lue, et a inventé le
// selector `'scanned2'` (le titre du document) là où la skill dit en toutes
// lettres « un numéro, jamais un mot ». Un tour perdu sur exactement ce que la
// lecture aurait évité.
// La formulation dissuasive reste — elle corrige un vrai défaut (mémoire
// project_weak_model_discovery_tool_oversweep : Devstral balayait toutes les
// skills). C'est une EXCEPTION NOMMÉE, pas un assouplissement : ne pas la
// généraliser en « lis ce qui te semble utile », le balayage reviendrait.
// Couvre aussi FILES_PROMOTE_DOCTRINE, qui pose la même obligation.
function buildSkillsContextBlock() {
  const skills = getAutotriggerSkillsMeta();
  if (!skills.length) return '';
  const lines = skills.map(s => '- [slug: ' + s.slug + '] ' + (s.name || s.slug) +
    (s.description ? ' — ' + s.description : ''));
  return '<miaou_skills_context>\nSkills que l\'utilisateur a rendues disponibles pour un usage ' +
    'proactif : tu PEUX en lire une (miaou__skills__read) si la situation courante y correspond ' +
    'vraiment, mais aucune n\'est obligatoire de ce seul fait. N\'en lis pas par curiosité ni ' +
    '« au cas où » — une skill hors sujet consomme un tour pour rien. EXCEPTION : quand une ' +
    'doctrine de tes instructions te demande NOMMÉMENT de lire une skill avant un geste précis ' +
    '(« avant ton premier appel à … »), cette lecture-là est obligatoire — ce « tu peux » ne la ' +
    'lève pas. D\'autres skills existent que l\'utilisateur ' +
    'invoque lui-même à sa discrétion ; elles ne sont pas listées ici et tu n\'as pas à les ' +
    'chercher.\n\n' + lines.join('\n') + '\n</miaou_skills_context>\n\n';
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
  const out = { identity: '', root: '', intent: '', skills: '', codeblock: '', user: '' };
  // identity, root, codeblock : INCONDITIONNELLES (TOOLS est une const build-time
  // non vide — l'ancien gate `if (TOOLS.length)` était une branche morte, retirée).
  // Les gardes RÉELLES restent internes à chaque helper : intentTracing (intent),
  // skills autotrigger (skills). Zéro changement de comportement (gate toujours
  // vrai). La part `docs` a disparu au lot V-1 : DOCS_DOCTRINE est désormais
  // statique et intégrée à ROOT_SYSTEM_PROMPT (piège 16 — elle ne dépend plus de
  // l'état de branchement MCP).
  out.identity = IDENTITY_BLURB;
  out.root = ROOT_SYSTEM_PROMPT;
  out.intent = intentDoctrinePrompt();
  out.skills = skillDoctrinePrompt();
  out.codeblock = CODEBLOCK_DOCTRINE;
  out.user = resolveUserSystemPrompt(settings.systemPrompt, getSpace(activeSpaceId));
  return out;
}

// Ordre : identité (toujours, EN TÊTE) → racine (DOCS_DOCTRINE y est incluse
// depuis V-1) → doctrine intent (si ON) →
// doctrine skills (si skills autotrigger) → doctrine codeblock (toujours) →
// utilisateur → description du Space actif (concaténée, jamais substituée —
// D4 corrigé). Piège 18 (CLAUDE.md) : cette dernière part varie d'un Space à
// l'autre — changer de Space change donc le system message (assumé, documenté),
// mais il reste statique tant qu'on reste dans le même Space (KV cache, piège 16).
// `sp` optionnel : réutilise des parts déjà calculées (dispatchSend en a déjà
// besoin pour buildContextManifest) plutôt que de rappeler systemMessageParts()
// une deuxième fois — un seul point de concaténation malgré tout (audit §6).
function buildSystemMessage(sp) {
  sp = sp || systemMessageParts();
  const parts = [sp.identity, sp.root, sp.intent, sp.skills, sp.codeblock, sp.user].filter(Boolean);
  return { role: 'system', content: parts.join('\n\n---\n\n') };
}

// Texte affiché sous « Prompt système racine (non modifiable) » dans les réglages
// (openSettings, ui.js). Reconstitue les SEULES parts INCONDITIONNELLES du message
// système — identity, root, codeblock — dans l'ordre exact du join de
// buildSystemMessage() (identity EN TÊTE, codeblock juste avant la part user).
// PAS les parts conditionnelles (intent/skills) : elles dépendent de
// réglages runtime, donc ni « racine » ni « non modifiable ». Même séparateur
// que le message réel : ce que voit l'utilisateur est byte-identique au préfixe
// statique effectivement envoyé au modèle. Constante build-time, jamais mutée.
function rootSystemPromptDisplay() {
  return [IDENTITY_BLURB, ROOT_SYSTEM_PROMPT, CODEBLOCK_DOCTRINE].join('\n\n---\n\n');
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
// Pur : projette les messages persistés (conv.messages) vers currentThread
// (whitelist ACK_COPY_FIELDS pour les acks, champs affichables sinon). Extrait
// pour être appelé APRÈS l'await de openConversation (cf. ci-dessous).
function projectConvMessages(conv) {
  return ((conv && conv.messages) || []).filter(Boolean).map(m => {
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
}

// Jeton de séquence. openConversation contient un `await`
// (loadConversationResources) ; un second appel (ex. deux conv-updated
// multi-onglets rapprochés) peut démarrer pendant cet await. DEUX invariants :
//  1. On (re)lit conv.messages APRÈS l'await, jamais avant : sinon un
//     saveConversation d'un pair survenu PENDANT l'await (typiquement la réponse
//     assistant persistée juste après conv-generation-ended) serait ignoré — le
//     thread resterait figé sur l'état d'avant, et la dernière réponse
//     n'apparaîtrait jamais en live (visible seulement après navigation). C'était
//     LE bug multi-onglets « toujours en retard d'un tour ».
//  2. Un appel devenu obsolète pendant son await (un openConversation plus
//     récent a démarré) abandonne avant de toucher currentThread/DOM : le plus
//     récent, qui relira le storage le plus frais, gagne.
let _openConvSeq = 0;
async function openConversation(id, reveal) {
  if (!loadConversation(id)) return;   // existence seulement ; le contenu est relu après l'await
  const mySeq = ++_openConvSeq;
  // Soft-lock (J4) : signaler le changement de conv affichée aux autres onglets,
  // SEULEMENT sur un vrai switch. Une re-hydratation (récepteur `rehydrate`
  // rappelle openConversation sur la MÊME conv) ne doit pas émettre closed/opened
  // ni vider le peer state — d'où le garde `id !== currentConvId`.
  const switching = id !== currentConvId;
  if (switching) {
    announceConvClosed(currentConvId);   // quitte l'ancienne (no-op si null)
    resetPeerState();                    // repart d'un set vide pour la nouvelle
    // On quitte une conversation qui génère (lot T-1b) : la génération perd
    // l'écran mais CONTINUE. Débranchement AVANT l'await : les hooks doivent
    // cesser d'écrire dans un DOM qui va être vidé dès maintenant, pas
    // seulement après le chargement des ressources de la conv d'arrivée.
    detachGenerationFromScreen(generationFor(currentConvId));
  }
  currentConvId = id;
  // Réchauffe les messages en étage 2 (lot U-1) AVANT la relecture post-await :
  // une conversation froide sort de loadConversation avec `messages: []`. Même
  // bloc await que les ressources — le jeton _openConvSeq couvre les deux.
  await Promise.all([
    loadConversationResources(id),   // peuple le session cache avant renderThread
    warmConversation(id),
  ]);
  // Un openConversation plus récent a pris la main pendant l'await : abandonner
  // avant toute écriture d'état/DOM (invariant 2).
  if (mySeq !== _openConvSeq) return;
  // (Re)lecture APRÈS l'await (invariant 1) : capte un saveConversation survenu
  // entre-temps (réponse d'un pair persistée après -ended).
  const conv = loadConversation(id);
  if (!conv) return;   // supprimée pendant l'await
  // Rebranchement sur une génération en vol (lot T-1a) — lu APRÈS l'await, comme
  // le reste (invariant read-after-await, piège 24) : une génération peut avoir
  // démarré ou fini pendant loadConversationResources.
  //
  // Si cette conversation génère, son thread de travail (gen.thread) est en
  // AVANCE sur le storage : l'unique écriture d'un échange a lieu dans
  // onFinal/onHalt, donc les acks et bulles du tour courant n'y sont pas encore.
  // Relire le storage effacerait visuellement le tour en cours. On adopte donc
  // la MÊME référence de tableau, pas une copie : les mutations des hooks
  // restent directement visibles par renderThread, exactement comme si la
  // génération n'avait jamais quitté l'écran.
  const gen = generationFor(id);
  currentThread = gen ? gen.thread : projectConvMessages(conv);
  currentConvModel = conv.model || '';
  currentConvReasoningEffort = conv.reasoningEffort || '';
  needTitle = !conv.title;   // conversation rouverte sans titre (streaming arrêté, etc.) : retitrer à la reprise
  setTitle(conv.title || '');
  // Rebranchement de l'AFFICHAGE (lot T-1b) : attachGenerationToScreen rend
  // l'historique par renderThread — le même chemin que le reload — puis rouvre
  // une bulle vive pour la suite du tour en cours. Sans génération, rendu normal.
  // B2 (lot T-2) : ouvrir la conversation SUFFIT à la marquer lue. Avant
  // renderConvList, pour que la liste soit rendue une seule fois, déjà à jour.
  markConvRead(id);
  rerenderCurrentThread();
  renderConvList();
  syncSpaceUI();
  // L'écran passe d'une conv qui génère à une qui ne génère pas (ou l'inverse) :
  // composer, bouton stop et mode file des interjections suivent la conv
  // AFFICHÉE, pas « une génération tourne quelque part ». Sans cet appel, le
  // composer resterait en mode « stop » sur une conversation inerte.
  setSending(!!gen);
  // Ouverture depuis la palette (recherche de conversation) : ramener la conv
  // fraîchement chargée dans la liste visible, même sidebar masquée (reveal),
  // centrée pour ne pas la coller au bord.
  if (reveal) revealActiveConv('center');
  syncModelUI();
  syncReasoningUI();
  _lastContextManifest = null;   // switch de conv : le dernier envoi réel ne s'applique plus, retombe sur simulation
  syncContextCounter();
  // Soft-lock (J4) : annoncer la conv nouvellement affichée (déclenche le
  // handshake côté pairs qui l'affichent déjà). Seulement sur un vrai switch.
  if (switching) announceConvOpened(id);
}

function resetToEmpty() {
  // Soft-lock (J4) : on quitte la conv affichée (le cas échéant) vers l'accueil.
  if (currentConvId) { announceConvClosed(currentConvId); resetPeerState(); }
  // L'écran part à l'accueil : une génération en vol sur la conv quittée perd
  // sa bulle (vidée juste en dessous) mais continue (lot T-1b).
  detachGenerationFromScreen(generationFor(currentConvId));
  currentConvId = null;
  // L'accueil ne génère jamais : le composer doit sortir du mode « stop » même
  // si la conversation qu'on quitte, elle, génère encore (symétrique du
  // setSending d'openConversation — sans lui le bouton reste un stop inerte).
  setSending(false);
  currentThread = [];
  currentConvModel = '';   // nouvelle conversation → modèle par défaut
  currentConvReasoningEffort = '';   // nouvelle conversation → reasoning_effort par défaut
  needTitle = false;
  // Titre du welcome courant AVANT vidage : Nouvelle conversation répétée depuis
  // l'écran d'accueil re-tire un accueil DIFFÉRENT (changement visible).
  const prevWelcome = ($('thread').querySelector('.welcome-screen .welcome-title') || {}).textContent || '';
  $('thread').innerHTML = '';
  clearMemoryProposals();   // cartes de proposition détruites avec le thread
  showWelcome(prevWelcome || undefined);
  setTitle('');
  syncConvDownloadBtn();
  renderConvList();
  // Le compteur d'agents dépend de « la conv affichée génère-t-elle ? »
  // (lot T-2bis) : partir à l'accueil fait passer une génération unique hors
  // écran, donc de masquée à affichée. syncSpaceUI n'est pas appelé ici (le
  // Space ne change pas), d'où l'appel direct.
  syncAgentCount();
  syncModelUI();
  syncReasoningUI();
  _lastContextManifest = null;
  syncContextCounter();
}

function selectConv(id, reveal) {
  if (id === currentConvId) {
    // Déjà ouverte : rien à charger, mais un appel « reveal » (palette) doit
    // quand même ramener la conv en vue (centrée, comme à l'ouverture).
    if (reveal) revealActiveConv('center');
    return;
  }
  const leaving = currentConvId;
  openConversation(id, reveal);
  summarizeIfNeeded(leaving);   // résumé de la conversation quittée (arrière-plan)
  armIdleSummaryTimer();
  if (isMobileLayout()) closeSidebarMobile();
}

// Déplacement effectif du lot sélectionné (D4/D7, brief Cter). Mutation UNIQUE
// de conv.spaceId via une écriture ciblée par id (persistConversationField :
// jamais `messages`, absents en RAM pour une conversation froide). Résumés,
// souvenirs et pièces jointes suivent automatiquement : ils scopent par convId,
// jamais par une copie côté Space.
function moveSelectedConversations(targetSpaceId) {
  if (!targetSpaceId || !_moveSelection.size) return;
  const ids = Array.from(_moveSelection);
  // Écriture ciblée par id déplacé : seule la métadonnée `spaceId` bouge, et
  // persistConversationField ne touche jamais `messages` (une conversation
  // froide n'a pas les siens en RAM — les écraser la viderait).
  for (const id of ids) persistConversationField(id, { spaceId: targetSpaceId });
  // Post-commit (piège 24) : un conv-updated par id déplacé (nouveau spaceId).
  // Le récepteur coalesce le re-render de liste via sa file (J3) ; l'herméticité
  // de Space est tranchée à la réception (spaceConvIds, piège 18).
  for (const id of ids) syncPost('conv-updated', { convId: id, spaceId: targetSpaceId });

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

// Bouton d'export unique de la topbar (onclick="onExportConv(event)").
// Un seul bouton pour deux formats : HTML par défaut (autonome, embarque les
// traces d'outils), Markdown avec Shift. L'affordance vit dans le `title`
// STATIQUE du bouton — pas de mise à jour au keydown : une tooltip native déjà
// affichée ne se rafraîchit pas tant que le curseur n'a pas quitté l'élément,
// le feedback serait donc trompeur une fois sur deux. Corollaire assumé : sans
// clavier (tactile), seul l'export HTML est atteignable depuis la topbar, le
// Markdown restant accessible par la palette de commandes.
function onExportConv(ev) {
  if (ev && ev.shiftKey) downloadConvMd();
  else exportConvHtml();
}

// Exporte la conversation courante en Markdown. Messages visibles (user +
// assistant) ; les acks d'outils ENRICHIS (args+result présents) précédant un
// message assistant sont rendus en trace (formatToolAcksMd) juste avant le
// texte de ce tour — acks legacy (sans args) silencieusement omis, comme avant.
// Appelé depuis la palette de commandes, et depuis le bouton topbar via
// onExportConv() quand Shift est enfoncé.
function downloadConvMd() {
  if (!currentThread || !currentThread.length) return;
  const conv = currentConvId ? loadConversation(currentConvId) : null;
  const title = (conv && conv.title) || 'miaou-conversation';

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
  downloadFile(exportConvFilename(title, Date.now(), 'md'),
    lines.join('\n').trimEnd() + '\n', 'text/markdown');
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
  clearAttachmentPushState(id);   // libère l'état de push MCP scopé à la conversation
  clearResourcePushState(id);     // idem pour les res_… (lot K, même scope conversation)
  if (id === currentConvId) resetToEmpty();
  else renderConvList();
}

// ── Réception synchro multi-onglets (lot J, J3) ──────────────────────────────
// Câblé via syncOnMessage(handleSyncMessage) dans init(). L'enveloppe est déjà
// VALIDÉE (validateEnvelope, sync.js) ; on décide l'effet via routeMessage (pur)
// puis on l'applique ici (couche impure : DOM, caches, re-render).
//
// Herméticité de Space (piège 18) : routeMessage présélectionne « conv affichée ? »
// mais l'appartenance au Space actif est tranchée ICI, via spaceConvIds — un
// re-render de liste sur une conv d'un autre Space que l'actif ne doit rien
// changer de visible (renderConvList est déjà scopé Space, mais on évite le
// travail inutile). La conv AFFICHÉE, elle, est par construction dans le Space
// actif (on ne peut afficher qu'une conv du Space courant).
//
// Queue pendant génération locale (brief §4.3, piège documenté) : re-hydrater la
// conv affichée pendant qu'une génération locale mute currentThread l'écraserait.
// On diffère alors l'action ; drainPendingSync() la rejoue à la fin de la
// DERNIÈRE génération en vol (unregisterGeneration, T-1a — plus setSending).

let _pendingSyncActions = [];   // actions différées (re-hydratation) pendant une génération locale

// ── Soft-lock (J4) : awareness « même conv ouverte ailleurs » ────────────────
// _peersOnConv = tabIds des AUTRES onglets tenant la conv actuellement affichée.
// _peersGenerating = sous-ensemble en train de générer (readonly, J5). Le bandeau
// soft-lock est visible tant que _peersOnConv est non vide ; le readonly (J5)
// prime sur le soft-lock quand _peersGenerating est non vide. Les deux sets sont
// vidés à chaque changement de conv affichée (openConversation/resetToEmpty).
let _peersOnConv = new Set();
let _peersGenerating = new Set();   // tabIds générant sur la conv affichée (readonly, J5)
let _peerHeartbeatAt = {};          // tabId → epoch ms du dernier heartbeat reçu (TTL, J5)
let _peerTtlSweeper = null;         // timer de balayage TTL (auto-release si crash émetteur)

// Émet conv-opened pour la conv que cet onglet vient d'afficher. Les pairs qui
// affichent la même conv se signalent en retour (handshake borné, cf. récepteur).
function announceConvOpened(convId) {
  if (convId != null) syncPost('conv-opened', { convId: convId, tabId: syncTabId() });
}
// Émet conv-closed pour la conv que cet onglet quitte (best-effort).
function announceConvClosed(convId) {
  if (convId != null) syncPost('conv-closed', { convId: convId, tabId: syncTabId() });
}
// Réinitialise l'état de peering au changement de conv affichée : on ne tient
// plus l'ancienne, on repart d'un set vide pour la nouvelle (les pairs se
// re-signaleront via le handshake déclenché par notre conv-opened).
function resetPeerState() {
  _peersOnConv = new Set();
  _peersGenerating = new Set();
  _peerHeartbeatAt = {};
  if (_peerTtlSweeper) { clearInterval(_peerTtlSweeper); _peerTtlSweeper = null; }
  refreshTabBanner();
  applyReadonlyState();
}
// Recalcule le bandeau à partir des deux sets. Readonly (J5) prime sur soft-lock.
function refreshTabBanner() {
  if (_peersGenerating.size > 0) {
    setTabBanner('Réponse en cours dans un autre onglet — lecture seule.');
  } else if (_peersOnConv.size > 0) {
    setTabBanner('Cette conversation est aussi ouverte dans un autre onglet.');
  } else {
    clearTabBanner();
  }
}

// Active/désactive le readonly de l'UI selon _peersGenerating. Readonly = un pair
// génère sur la conv qu'on affiche : on désactive les entrées et mutations
// locales (composer, édition/suppression/régénération) pour éviter une seconde
// génération concurrente silencieuse. Lecture/scroll restent permis (A6). Le
// résultat persisté revient via le conv-updated qui suit la fin (J3, re-hydrate).
function applyReadonlyState() {
  setConvReadonly(_peersGenerating.size > 0);   // ui.js
}

// Balayage TTL : auto-release des pairs générateurs dont le heartbeat a expiré
// (crash de l'émetteur sans -ended). Armé tant qu'au moins un pair génère.
function armTtlSweeper() {
  if (_peerTtlSweeper) return;
  _peerTtlSweeper = setInterval(function () {
    const now = Date.now();
    let changed = false;
    for (const tabId of Array.from(_peersGenerating)) {
      const last = _peerHeartbeatAt[tabId] || 0;
      if (now - last > SYNC_HEARTBEAT_TTL_MS) {
        _peersGenerating.delete(tabId);
        delete _peerHeartbeatAt[tabId];
        changed = true;
      }
    }
    if (_peersGenerating.size === 0 && _peerTtlSweeper) {
      clearInterval(_peerTtlSweeper); _peerTtlSweeper = null;
    }
    if (changed) { refreshTabBanner(); applyReadonlyState(); }
  }, SYNC_HEARTBEAT_MS);
}

function handleSyncMessage(env) {
  const decision = routeMessage(env, {
    tabId: syncTabId(),
    currentConvId: currentConvId,
    activeSpaceId: activeSpaceId,
  });
  applySyncDecision(decision);
}

function applySyncDecision(d) {
  // Index des résumés : cache RAM PAR ONGLET depuis U-1, sans point
  // d'invalidation (les résumés n'émettent aucun broadcast — arbitrage du lot J,
  // « ne pas broadcaster l'invisible », pris quand `loadSummaries` relisait
  // localStorage et était donc forcément frais). Ce n'est plus le cas : sans
  // relecture, un onglet injecte au modèle un jeu de résumés périmé — manquant
  // celui qu'un pair vient d'écrire, ou ressuscitant une tombstone posée
  // ailleurs. Ce n'est plus « de l'invisible », c'est du contexte modèle.
  //
  // On ne crée pas de type de message pour autant : un résumé suit toujours une
  // conversation qui vient d'être persistée, donc `conv-updated` (dont
  // `rehydrate` et `render-list` sont les deux issues) est un porteur suffisant.
  // Relecture en ARRIÈRE-PLAN, jamais dans le chemin d'envoi : `searchSummaries`
  // est synchrone et appelé depuis `runGenerationFromCurrentThread`, que la
  // décision structurante du lot U interdit de rendre async. Un résumé d'un pair
  // arrive donc avec un léger différé — acceptable, il ne bloque aucun envoi.
  if (d.action === 'rehydrate' || d.action === 'render-list') {
    refreshSummariesFromDB()
      .catch(function(e) { console.error('[miaou] refresh résumés:', e && e.message); });
  }
  switch (d.action) {
    case 'ignore':
    case 'ignore-self':
      return;

    case 'rehydrate':
      // Conv affichée modifiée ailleurs. Si une génération locale est en vol,
      // différer (ne jamais écraser currentThread en pleine mutation). Sinon
      // re-hydrater par le chemin byte-stable (openConversation, piège 17). Le
      // draft du composer n'est pas touché (renderThread ne lit que #thread).
      // Depuis T-1a : « une génération quelconque », pas `sending` (qui ne parle
      // que de l'écran) — une génération détachée mute son propre thread, qui
      // peut être celui de la conv affichée.
      if (_activeGenerations.size) { _queueSyncAction(d); return; }
      if (currentConvId) openConversation(currentConvId);
      return;

    case 'render-list':
      // Conv non affichée modifiée/supprimée ailleurs : rafraîchir la liste
      // (scopée au Space actif par renderConvList). Pas de re-hydratation du
      // fil, mais les MÉTADONNÉES (titre, updatedAt, épinglage) alimentent la
      // liste et vivent dans le cache d'étage 1 : sans relecture, la sidebar
      // afficherait un titre périmé jusqu'au prochain reload.
      if (d.convId == null) { renderConvList(); return; }
      refreshConversationFromDB(d.convId)
        .then(function() { renderConvList(); })
        .catch(function(e) { console.error('[miaou] render-list:', e && e.message); });
      return;

    case 'conv-gone':
      // Conv AFFICHÉE supprimée dans un autre onglet. L'émetteur a déjà persisté
      // la suppression (J2) : ne rien re-supprimer, juste réagir côté UI, comme
      // le fait deleteConv local sur la conv courante. (Notice riche : reléguée
      // à l'infra bandeau de J4 ; ici retour à l'accueil, non destructif.)
      // Même prédicat que 'rehydrate' depuis T-1a (cf. ci-dessus).
      if (_activeGenerations.size) { _queueSyncAction(d); return; }
      resetToEmpty();
      return;

    case 'space-list':
      // Registre des Espaces modifié ailleurs (création/renommage/suppression).
      // Recharger le sélecteur + la liste (le Space actif de CET onglet ne change
      // pas — miaou-active-space n'est jamais diffusé). Si le Space actif a été
      // supprimé ailleurs, il reste sélectionné ici jusqu'à action locale : cas
      // limite assumé V1 (pas de réconciliation forcée du Space actif).
      syncSpaceUI();
      renderConvList();
      return;

    case 'apply-settings':
      applySyncedSettings(d.keys);
      return;

    case 'invalidate-resources':
      // Évincer les copies RAM périmées ; si la conv affichée est concernée,
      // recharger ses ressources et re-render (vignettes d'attachments à jour).
      invalidateResourceCache(d.ids);
      if (!sending && d.convId != null && d.convId === currentConvId) {
        loadConversationResources(currentConvId).then(function() { rerenderCurrentThread(); });
      }
      return;

    case 'reload-skills':
      // Cache skills périmé (CRUD dans un autre onglet). Recharger le miroir RAM ;
      // re-render le drawer seulement s'il est ouvert (sinon renderSkills au
      // prochain openSkills suffit). syncSkillHintUI (légende composer) suit via
      // renderSkills ; on le rappelle explicitement si le drawer est fermé.
      loadSkillsCache().then(function() {
        if (isSkillsDrawerOpen()) renderSkills();
        else syncSkillHintUI();
      });
      return;

    case 'full-reload':
      // Import/reset dans un autre onglet : l'état localStorage+IDB a été
      // intégralement remplacé. Rechargement franc, comme l'onglet émetteur.
      location.reload();
      return;

    case 'soft-lock': {
      // Un pair (d.tabId) affiche la même conv que nous. L'ajouter au set. Si
      // c'est un pair INCONNU, se re-signaler une fois (handshake) pour que le
      // pair récemment ouvert nous connaisse à son tour. Le garde « nouveau »
      // borne l'échange : une fois chacun dans le set de l'autre, plus de
      // re-signalement → pas de boucle. (routeMessage n'émet 'soft-lock' que si
      // la conv est affichée localement ; l'appartenance au Space actif est
      // garantie : on n'affiche qu'une conv du Space courant.)
      if (d.tabId && !_peersOnConv.has(d.tabId)) {
        _peersOnConv.add(d.tabId);
        refreshTabBanner();
        announceConvOpened(currentConvId);   // réponse au handshake
      }
      return;
    }
    case 'soft-unlock': {
      // Le pair a fermé la conv (ou quitté) : le retirer des deux sets. Le
      // bandeau ne disparaît que si plus aucun pair ne tient la conv.
      if (d.tabId) {
        _peersOnConv.delete(d.tabId);
        _peersGenerating.delete(d.tabId);
        refreshTabBanner();
      }
      return;
    }

    case 'readonly-on': {
      // Un pair génère sur la conv qu'on affiche (message initial OU heartbeat).
      // Enregistrer le tabId + l'horodatage (pour le TTL), armer le balayage,
      // activer le readonly. Idempotent : un heartbeat répété rafraîchit juste
      // l'horodatage. Un onglet ouvert PENDANT la génération se verrouille ici,
      // au premier heartbeat reçu (pas besoin d'avoir vu le -started initial).
      if (d.tabId) {
        const wasGenerating = _peersGenerating.has(d.tabId);
        _peersGenerating.add(d.tabId);
        _peerHeartbeatAt[d.tabId] = Date.now();
        armTtlSweeper();
        if (!wasGenerating) { refreshTabBanner(); applyReadonlyState(); }
      }
      return;
    }
    case 'readonly-off': {
      // Le pair a fini de générer : retirer du set. Le readonly ne se lève que si
      // plus aucun pair ne génère.
      if (d.tabId && _peersGenerating.has(d.tabId)) {
        _peersGenerating.delete(d.tabId);
        delete _peerHeartbeatAt[d.tabId];
        refreshTabBanner();
        applyReadonlyState();
        // Re-hydratation à la fin de génération d'un pair. On NE se repose PAS
        // sur le seul conv-updated de la persistance finale (J2) : lorsqu'il est
        // émis juste avant conv-generation-ended, il peut arriver pendant l'await
        // interne d'un openConversation() déclenché par un conv-updated ANTÉRIEUR
        // (message user du même tour), et le rendu final retombe alors sur l'état
        // « user sans réponse » — la réponse du pair n'apparaît jamais en live
        // (visible seulement après navigation/reload). Relire le storage frais
        // ici est idempotent (openConversation est byte-stable, piège 17) et ferme
        // le trou quel que soit l'ordre d'arrivée des messages. Différé si une
        // génération LOCALE est en vol (drainé par setSending(false), J3).
        if (currentConvId && d.convId === currentConvId) {
          // Différer tant qu'une génération LOCALE quelconque est en vol : la
          // rehydratation réassigne currentThread, ce qui débrancherait une
          // génération détachée de son thread de travail si elle porte sur cette
          // même conversation, et rejouerait un rendu obsolète sinon.
          if (_activeGenerations.size) { _queueSyncAction({ action: 'rehydrate', convId: currentConvId }); }
          else openConversation(currentConvId);
        }
      }
      return;
    }

    default:
      return;
  }
}

// Ré-application des réglages modifiés dans un autre onglet. `keys` = clés de
// settings modifiées, ou sentinelles de sous-domaine ('api-servers',
// 'active-api-server', 'mcp-servers'). On ré-applique de façon ciblée pour ne
// pas perturber inutilement l'UI (A1 : ne jamais vider un draft ni interrompre
// une génération — on ne touche qu'aux surfaces de réglage/serveur).
function applySyncedSettings(keys) {
  const set = new Set(keys || []);
  // Serveurs API / serveur actif : re-render cartes + sélecteur composer + pilule.
  if (set.has('api-servers') || set.has('active-api-server')) {
    loadApiServers();
    syncActiveApiServerUI();
    if (typeof renderApiServers === 'function') renderApiServers();
    syncModelUI();
  }
  // Bascule de serveur actif : reproduire le nettoyage d'`onUseApiServer` que le
  // simple re-render ci-dessus ne couvre pas. L'override de modèle de la conv
  // affichée (`currentConvModel`) pointait sur un modèle de l'ANCIEN serveur ;
  // sans le lever, `activeModel()` resterait collé dessus (piège 15) et le label
  // ne bougerait pas malgré le changement de serveur. On le lève EN MÉMOIRE
  // seulement : l'onglet émetteur a déjà fait `setConvModel('')` → saveConversation
  // → broadcast `conv-updated`, donc pas de re-persistance ni de rebroadcast ici
  // (évite l'écho). `prefetchModels()` refetch le cache modèles du nouveau serveur
  // (cache `_modelsById` indexé par id de serveur) et rappelle `syncModelUI()`.
  if (set.has('active-api-server')) {
    currentConvModel = '';
    prefetchModels();
  }
  // Serveurs MCP : re-render cartes (les outils distants se rebranchent à la
  // prochaine reconnexion manuelle ; pas de reconnexion auto imposée ici).
  if (set.has('mcp-servers') && typeof renderMcpServers === 'function') renderMcpServers();
  // Réglages généraux : ré-appliquer thème + surlignage + sélecteurs, sans
  // toucher au draft ni au thread. On relit l'état persisté à la source.
  const s = loadSettings();
  // Réglages d'apparence auto-persistés (pas de bouton « Enregistrer ») : il
  // faut ré-appliquer le RENDU *et* rafraîchir les boutons du drawer. Oublier
  // le second laisse un drawer qui affiche l'ancien choix alors que l'écran a
  // changé — désaccord entre ce que l'utilisateur voit et ce que les segments
  // prétendent, et un clic sur le segment déjà « actif » qui semble sans effet.
  // Les setXxxUI sont sans risque drawer fermé : ils ne font que toggler des
  // classes sur des nœuds statiques et écrire un hint (no-op si absent).
  if (set.has('theme')) { applyTheme(s.theme || 'system'); setThemeUI(s.theme || 'system'); }
  if (set.has('palette')) { applyPalette(s.palette || 'ambre'); setPaletteUI(s.palette || 'ambre'); }
  if (set.has('fonts')) { applyFonts(s.fonts || 'graphite'); setFontsUI(s.fonts || 'graphite'); }
  if (set.has('motion')) { applyMotion(s.motion || 'system'); setMotionUI(s.motion || 'system'); }
  if (set.has('highlight')) highlightEnabled = s.highlight !== false;
  // Autres clés (systemPrompt, contextWindow, sélecteurs…) : effet au prochain
  // envoi/rendu, rien à ré-appliquer en direct. La pilule de contexte se
  // recalcule au prochain syncContextCounter.
  syncContextCounter();
}

// File d'attente des actions de synchro différées pendant une génération locale.
function _queueSyncAction(d) {
  // Coalescing : une seule re-hydratation/conv-gone en attente suffit (la
  // dernière gagne, l'état persisté est de toute façon relu au drain).
  _pendingSyncActions = _pendingSyncActions.filter(function(a) {
    return a.action !== 'rehydrate' && a.action !== 'conv-gone';
  });
  _pendingSyncActions.push(d);
}

// Drain appelé quand la dernière génération locale se termine
// (unregisterGeneration, T-1a). Rejoue les actions différées maintenant qu'aucun
// thread n'est plus muté.
function drainPendingSync() {
  if (!_pendingSyncActions.length) return;
  const actions = _pendingSyncActions;
  _pendingSyncActions = [];
  for (const d of actions) applySyncDecision(d);
}

// ── Readonly relay + heartbeat (J5) ──────────────────────────────────────────
// Un onglet qui génère sur la conv X émet conv-generation-started(X) au début et
// conv-generation-ended(X) à la fin (tous chemins : succès/erreur/abort, via
// register/unregisterGeneration — depuis T-1a un onglet peut générer sur
// PLUSIEURS convs à la fois, chacune avec son propre cycle et son heartbeat). Un heartbeat ré-émet -started toutes les
// SYNC_HEARTBEAT_MS ; les récepteurs auto-libèrent le readonly s'ils ne
// reçoivent pas de heartbeat en SYNC_HEARTBEAT_TTL_MS (crash de l'émetteur).
// Un onglet ouvert PENDANT une génération se verrouille au prochain heartbeat.
const SYNC_HEARTBEAT_MS = 5000;        // ré-émission de -started (A5 : N = 5 s)
const SYNC_HEARTBEAT_TTL_MS = 10000;   // auto-release récepteur sans heartbeat (2×N)

// Un heartbeat PAR CONVERSATION en génération (lot T-1a, arbitrage A3). Avant
// T-1, un scalaire suffisait : un onglet ne générait que sur la conv affichée.
// Avec N générations concurrentes, un scalaire ferait émettre le -ended de la
// première sur la conv de la seconde — les pairs déverrouilleraient une conv
// encore en génération. Une Map préserve le format d'enveloppe du lot J
// inchangé (liste fermée de types de docs/multitab-sync.md non touchée), ce qui
// est l'avantage décisif sur un heartbeat unique portant la liste des convs.
const _genRelayTimers = new Map();   // Map<convId, timerId>

// Démarre le relais pour UNE conversation : émet -started + arme son heartbeat.
// Appelé depuis le cycle de vie de la génération (registerGeneration), plus
// depuis setSending — qui n'est plus qu'un reflet d'écran.
function startGenerationRelay(convId) {
  if (convId == null) return;
  if (_genRelayTimers.has(convId)) return;   // déjà relayée : ne pas doubler le ticker
  syncPost('conv-generation-started', { convId: convId, tabId: syncTabId() });
  const timer = setInterval(function () {
    if (!_genRelayTimers.has(convId)) return;   // course : arrêt entre deux ticks
    syncPost('conv-generation-started', { convId: convId, tabId: syncTabId() });
  }, SYNC_HEARTBEAT_MS);
  _genRelayTimers.set(convId, timer);
}

// Arrête le relais d'UNE conversation : coupe son heartbeat + émet -ended.
// Idempotent (second appel sans effet : la clé a disparu du registre, aucun
// -ended n'est ré-émis). Discipline deux-timers (piège 13) : ne touche QUE les
// timers de relais, jamais ceux du patienteur (startWaiter/stopWaiter).
function stopGenerationRelay(convId) {
  if (convId == null) return;
  const timer = _genRelayTimers.get(convId);
  if (timer === undefined) return;   // pas (ou plus) relayée : rien à émettre
  clearInterval(timer);
  _genRelayTimers.delete(convId);
  syncPost('conv-generation-ended', { convId: convId, tabId: syncTabId() });
}

// Libère TOUS les pairs (lot T-1a, arbitrage A5) — appelé au départ de l'onglet
// (pagehide/beforeunload), où les générations meurent de toute façon avec la
// page (portée de survie). Idempotence EXPLICITE, pas supposée : le handler est
// branché sur les deux événements et peut tirer deux fois ; on itère sur une
// copie des clés et stopGenerationRelay vide le registre au passage, donc un
// second appel trouve un registre vide et ne ré-émet aucun -ended.
function stopAllGenerationRelays() {
  for (const convId of Array.from(_genRelayTimers.keys())) stopGenerationRelay(convId);
}

// Crée la conversation à la volée au premier envoi (pas avant). Stampée dans
// le Space actif (seul point de création — brief D5, lot C).
function ensureConversation() {
  if (currentConvId) return;
  const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const manualTitle = $('conv-title').textContent.trim();
  saveConversation({ id, title: manualTitle, timestamp: Date.now(), messages: [], spaceId: activeSpaceId });
  currentConvId = id;
  currentThread = [];
  needTitle = !manualTitle;   // titre déjà saisi → pas d'auto-titrage
  renderConvList();
}

// Pur : projette un thread de travail (currentThread ou gen.thread) vers la
// forme persistée (conv.messages). Réciproque de projectConvMessages. Extrait
// du corps de persistCurrent (lot T-1a) pour être partagé avec
// persistGeneration : les deux chemins d'écriture — écran et génération
// détachée — doivent produire des messages STRICTEMENT identiques, sinon une
// conversation persistée par une génération de fond divergerait de la même
// conversation persistée depuis l'écran. Une seule formule, testable QuickJS.
function projectThreadToMessages(thread) {
  return (thread || []).map(m => {
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
}

function persistCurrent() {
  if (!currentConvId) return;
  const conv = loadConversation(currentConvId) || { id: currentConvId, timestamp: Date.now() };
  conv.messages = projectThreadToMessages(currentThread);
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
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); e.target.textContent = titleBefore; e.target.blur(); }
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
    if (conv) { persistConversationField(currentConvId, { title: t }); renderConvList(); }
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
    intentTracing: $('set-intent-tracing').checked,
    describeFiles: $('set-describe-files').checked,
    exportInteractive: $('set-export-interactive').checked,
    contextWindow: $('set-contextwindow').value,
  };
  saveSettings(obj);
  updateSettingsDirty();   // formulaire = persisté → bouton redésactivé
  highlightEnabled = obj.highlight;
  syncConfigured();
  syncModelUI();        // labels + visibilité du sélecteur (selon cache déjà chargé)
  syncReasoningUI();     // visibilité + valeur du sélecteur de raisonnement
  prefetchModels();     // (re)charge la liste si besoin, puis re-sync
  rerenderCurrentThread();   // ré-applique/retire la coloration
  syncContextCounter();   // fenêtre de contexte modifiée : recalcule occupation/jauge
  closeSettings();
}

// Charge la liste des modèles du serveur ACTIF (cache de session) puis met à
// jour l'UI. Échec silencieux : le sélecteur reste masqué, le modèle par défaut
// reste utilisé. Les AUTRES serveurs ne sont pas interrogés ici : leur liste est
// chargée à l'ouverture du sélecteur (loadAllServerModels), pour ne pas payer N
// requêtes au démarrage si le menu n'est jamais ouvert.
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
  const server = {
    name, url,
    transport: get('.mcp-transport') || 'streamable-http',
    enabled: enabledEl ? enabledEl.checked : true,
    authorization_token: get('.mcp-token'),
    timeout: (Number.isFinite(tmoRaw) && tmoRaw > 0) ? tmoRaw : 30000,
    toolAllowlist: parseToolFilterList(get('.mcp-allow')),
    toolDenylist: parseToolFilterList(get('.mcp-deny')),
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
    disabled: get('.api-disabled') === 'off',
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
  prefetchModels();   // cache par id (_modelsById) : re-fetch seulement si ce serveur est inconnu
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

// Import d'un fichier .md dans le drawer skills (drag&drop sur le drawer, ou
// copier-coller Finder/Explorateur hors d'une card déjà en édition — cf.
// docs/skills.md). Décide création vs édition via resolveSkillDropTarget (pur,
// skills.js) : cartouche avec `name` dont le slug matche une skill EXISTANTE →
// bascule sur sa card ; sinon nouvelle card. Remplit les champs comme le paste
// texte dans la textarea (même parseSkillFrontmatter), contenu intégral posé
// dans .skill-content quel que soit le mode.
function ingestSkillMarkdownFile(text) {
  const fm = parseSkillFrontmatter(text);
  const existing = listAllSkillsCache().map(s => s.slug);
  const target = resolveSkillDropTarget(fm, existing);
  renderSkills();   // ferme toute card restée en édition, repart d'un état propre
  const wrap = $('skill-list');
  if (!wrap) return;
  // Ne PAS passer par enterSkillEdit (charge l'ancien contenu depuis IDB, async) :
  // le texte importé est posé plus bas et ne doit pas être écrasé par cette lecture
  // qui résoudrait après coup.
  let card;
  if (target.mode === 'edit') {
    card = wrap.querySelector('.skill-card[data-slug="' + target.slug + '"]');
  }
  if (!card) {
    const empty = wrap.querySelector('.mem-empty');
    if (empty) empty.remove();
    card = buildSkillCard({ slug: target.slug, name: '', description: '', enabled: true }, true);
    wrap.insertBefore(card, wrap.firstChild);
  }
  card.classList.add('is-editing');
  const contentT = card.querySelector('.skill-content');
  if (contentT) contentT.value = text;
  applySkillFrontmatterToCard(card, text);
  card.scrollIntoView({ block: 'nearest' });
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

// Lit les 7 clés localStorage désérialisées (miaou-active-api-server et
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
// lecture IDB (skills, resources, conversations, résumés), puis téléchargement
// d'une archive zip : `manifest.json` porte tout l'état SAUF les octets
// binaires, qui vivent chacun dans un membre `resources/<id>`.
//
// Les conversations sont lues par `readAllConversationsFromDB()`, JAMAIS par
// `loadConversations()` : ce dernier sert le cache, où une conversation froide
// sort avec `messages: []` (contrat de l'étage 2, U-1). L'export y aurait perdu
// tout le contenu sauf celui des quelques conversations chaudes — le même
// silence que celui qu'U-4 corrige, sous une autre forme.
//
// POURQUOI le zip multi-membres et pas simplement un .json compressé (lot V-3) :
// le base64 n'était pas qu'un surcoût de 33 %. À l'instant du JSON.stringify
// coexistaient en RAM les ArrayBuffer d'origine, TOUTES les strings base64, et
// la string JSON finale qui les recontient — sur 40 Mo de binaires, ~148 Mo. Et
// `JSON.stringify` produisait une string UNIQUE, dont l'échec est brutal et
// survient au pire moment : quand l'utilisateur essaie de sauvegarder.
// Le format v3 supprime le base64 des deux chemins (export ET import) et fait
// disparaître la string géante.
//
// Le pic n'est pas éliminé, il est DIVISÉ : `zipSync` construit sa sortie en
// mémoire, donc les ArrayBuffer d'origine et le buffer de sortie coexistent
// (~78 Mo contre ~148). fflate expose bien une API streaming (`Zip`,
// `ZipDeflate`), qui descendrait à ~40 Mo — écartée en V-3 : une API à
// callbacks et une agrégation manuelle de chunks sur un chemin
// destructif-adjacent, pour un gain marginal face à celui déjà acquis.
// Le format s'y prête déjà si un profil réel le demande, sans nouvelle version.
async function exportAllData() {
  showExportDataError('');
  const lsSnapshot = snapshotLocalStorageForExport();
  const skills = await getAllSkillRecords();
  const rawResources = await getAllResources();
  const conversations = await readAllConversationsFromDB();
  const summaries = await readAllSummariesFromDB();

  // Séparation métadonnées / octets : `entries` va dans le manifeste (sans
  // `data`, avec un `member`), `members` devient les membres du zip.
  const index = buildResourceMemberIndex(rawResources);
  const manifest = buildExportPayload(lsSnapshot, skills, index.entries, conversations, summaries);

  let ff;
  try { ff = await ensureFflate(); }
  catch (e) {
    showExportDataError('Moteur de compression indisponible (' +
      (e && e.message ? e.message : 'erreur inconnue') +
      '). Réessaie une fois en ligne.');
    return;
  }

  const files = { 'manifest.json': ff.strToU8(JSON.stringify(manifest)) };
  for (const it of index.members) {
    files[it.member] = it.data instanceof Uint8Array ? it.data : new Uint8Array(it.data);
  }

  let data;
  try { data = ff.zipSync(files, { level: 6 }); }
  catch (e) {
    showExportDataError('Échec de la compression : ' + (e && e.message ? e.message : 'erreur inconnue') + '.');
    return;
  }

  const stamp = exportDateTimeStamp(Date.now());
  downloadFile('miaou-export-' + stamp + '.zip', data, 'application/zip');
}

// Handler global (bouton « Importer les données ») : déclenche l'input file caché.
function onImportDataClick() {
  const input = $('import-data-input');
  if (input) { input.value = ''; input.click(); }
}

// Lit une sauvegarde v3 (conteneur zip) et rend un payload de la MÊME FORME
// qu'un v2 — à ceci près que `resources[].data` porte des octets bruts et non
// une string base64. C'est `resourceDataShape` (storage.js) qui absorbe cette
// différence à l'application ; tout le reste de l'import ignore le conteneur.
//
// Lève une Error au message actionnable : l'appelant l'affiche inline.
async function readBackupFromZip(u8) {
  // Le sniff a dit « ça ressemble à un zip » ; le central directory tranche.
  // Un fichier tronqué passe le sniff et doit produire ce message-là, pas une
  // exception fflate ni un « JSON invalide » qui enverrait chercher ailleurs.
  const entries = parseZipCentralDirectory(u8);
  if (!entries || !entries.length) throw new Error('Archive illisible ou tronquée.');

  // Garde du lot V-1, qui vaut ici aussi : fflate extrait un membre chiffré SANS
  // lever d'erreur, en rendant des octets bruts. Un JSON.parse sur ce bruit
  // dirait « JSON invalide » — un message qui envoie l'utilisateur au mauvais
  // endroit. Le prédicat est unique (decideZipMemberExtraction), jamais un
  // second test d'`entry.encrypted` écrit à la main.
  const manifestPick = decideZipMemberExtraction(entries, 'manifest.json', 0);
  if (!manifestPick.ok) {
    if (manifestPick.reason === 'encrypted') {
      throw new Error('Archive protégée par mot de passe : MIAOU ne peut pas la déchiffrer.');
    }
    throw new Error('Ce zip n\'est pas une sauvegarde MIAOU : aucun manifest.json à la racine.');
  }

  const ff = await ensureFflate();
  let files;
  try { files = ff.unzipSync(u8); }
  catch (e) { throw new Error('Archive illisible : ' + (e && e.message ? e.message : 'décompression impossible')); }

  const raw = files['manifest.json'];
  if (!raw) throw new Error('Ce zip n\'est pas une sauvegarde MIAOU : aucun manifest.json à la racine.');
  let obj;
  try { obj = JSON.parse(new TextDecoder('utf-8').decode(raw)); }
  catch (e) { throw new Error('Manifeste illisible : JSON invalide.'); }

  // Réassemblage AVANT validation : `validateImportPayload` compte
  // `idb.resources.length` pour le récapitulatif affiché avant confirmation.
  // Valider d'abord ferait mentir ce décompte.
  //
  // Un membre manquant (transfert interrompu, zip retouché à la main) importe la
  // ressource avec des octets VIDES — jamais un refus global : un binaire perdu
  // ne doit pas coûter conversations, souvenirs et réglages (décision Julien,
  // 2026-08-28). Mais il est SIGNALÉ, et signalé AVANT le clic d'application :
  // le récapitulatif de confirmation est l'endroit naturel, `renderImportSummary`
  // porte la ligne. Le compte voyage dans le payload sous `_missingResourceData`,
  // clé transitoire lue par `validateImportPayload` — préfixée d'un souligné
  // parce qu'elle ne fait PAS partie du format v3 (elle naît du réassemblage,
  // pas du fichier) et qu'elle ne doit jamais être confondue avec une section
  // de manifeste.
  const idb = (obj && obj.idb && typeof obj.idb === 'object') ? obj.idb : null;
  let missing = 0;
  if (idb && Array.isArray(idb.resources)) {
    idb.resources = idb.resources.map(rec => {
      if (!rec || typeof rec.member !== 'string' || !rec.member) return rec;
      const bytes = files[rec.member];
      if (!bytes) missing++;
      const out = Object.assign({}, rec, { data: bytes || new Uint8Array(0) });
      delete out.member;
      return out;
    });
  }
  if (missing) obj._missingResourceData = missing;
  return obj;
}

// Jeton de séquence de l'import (motif `_openConvSeq`, piège 24b). Le chemin
// d'import est devenu ASYNCHRONE en V-3 (ensureFflate + décompression) : entre
// la sélection du fichier et le rendu du récapitulatif, l'utilisateur peut en
// sélectionner un second. Deux récapitulatifs se disputeraient
// `#import-data-summary`, et le bouton armé pourrait appliquer le PREMIER
// payload alors que l'écran affiche le second — sur un chemin destructif.
let _importSeq = 0;

// Handler global (onchange de l'input file) : lit + détecte le conteneur +
// parse + valide. Une erreur s'affiche inline (registre showCardError/hint,
// jamais d'alert) ; un payload valide affiche un récapitulatif dont le bouton
// d'application est arm-then-run (remplacement intégral = destructif).
//
// Le conteneur est reconnu aux OCTETS (`sniffBackupFormat`, utils.js), pas à
// l'extension : d'où `readAsArrayBuffer` là où V-2 lisait encore du texte. Le
// chemin JSON reste STRICTEMENT inchangé dans son comportement — les
// sauvegardes v1 et v2 non compressées doivent continuer de passer.
function onImportFileSelected(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const seq = ++_importSeq;
  const reader = new FileReader();
  // `onload` est async depuis V-3 : un throw non capturé y partirait en rejet
  // silencieux et l'interface resterait muette — l'utilisateur verrait un import
  // qui ne fait rien. D'où le try/catch, obligatoire.
  reader.onload = async () => {
    const u8 = new Uint8Array(reader.result);
    let obj;
    if (sniffBackupFormat(u8) === 'zip') {
      try { obj = await readBackupFromZip(u8); }
      catch (e) {
        if (seq !== _importSeq) return;
        showImportDataError(e && e.message ? e.message : 'Archive illisible.');
        return;
      }
      if (seq !== _importSeq) return;   // relu APRÈS l'await, jamais avant
    } else {
      // TextDecoder est légitime ici (chemin navigateur, pas QuickJS) — ne pas
      // réutiliser `_zipDecodeName`, qui décode des NOMS de membres.
      let text;
      try { text = new TextDecoder('utf-8').decode(u8); }
      catch (e) { showImportDataError('Fichier illisible : encodage invalide.'); return; }
      try { obj = JSON.parse(text); }
      catch (e) { showImportDataError('Fichier illisible : JSON invalide.'); return; }
    }
    const res = validateImportPayload(obj);
    if (!res.ok) { showImportDataError(res.error); return; }
    renderImportSummary(res.counts, () => applyImportedData(obj));
  };
  reader.onerror = () => showImportDataError('Échec de lecture du fichier.');
  reader.readAsArrayBuffer(file);
}

// Applique un payload d'import validé : écrit les 7 clés localStorage (clé
// absente du fichier → removeItem, pour ne pas laisser d'état résiduel
// incohérent), vide puis réinsère les quatre stores IDB (skills, resources,
// conversations, summaries), puis recharge la page — l'état de session (caches,
// thread courant, statut MCP) se reconstruit proprement au boot, aucune
// resynchronisation manuelle à écrire. C'est aussi ce reload qui rend le cache
// RAM des conversations (U-1) cohérent : il est réhydraté depuis les stores
// fraîchement réécrits, sans qu'aucune invalidation ait à être posée à la main.
//
// Le CONTENEUR (zip v3 ou JSON nu v1/v2) a déjà été absorbé par
// `onImportFileSelected`/`readBackupFromZip` : ce qui arrive ici est un payload
// de forme uniforme, à ceci près que `resources[].data` porte du base64 (v1/v2)
// ou des octets bruts (v3). `resourceDataShape` tranche, en un point unique.
//
// Un fichier `version: 1` porte ses conversations sous `localStorage` : elles
// sont routées vers IDB comme les autres, par `extractImportedConvRecords`.
// Elles ne sont JAMAIS réécrites dans localStorage — les deux clés ont été
// purgées par U-2 et les y remettre ré-armerait la migration de boot, qui les
// reprendrait au tour suivant. Ça marcherait par ricochet ; on ne s'appuie pas
// dessus, l'import fait lui-même le travail.
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
    // `resourceDataShape` (storage.js, pur) est LE point unique où la forme des
    // octets est traitée — base64 en v1/v2, octets bruts en v3 — exactement
    // comme `extractImportedConvRecords` l'est pour la version des
    // conversations. Ne pas réintroduire un second test de forme ailleurs.
    const shape = resourceDataShape(rec.data);
    const data = shape === 'base64' ? base64ToArrayBuffer(rec.data)
               : shape === 'bytes'  ? rec.data
               : new ArrayBuffer(0);
    const out = Object.assign({}, rec, { data: data });
    // `member` est un détail de TRANSPORT : il n'a rien à faire dans le store.
    // Un champ parasite ne casserait rien (IDB stocke des objets libres) mais il
    // se propagerait au prochain export et polluerait le schéma documenté.
    // `readBackupFromZip` le retire déjà ; la garde reste parce que les deux
    // fonctions composent, et une composition non gardée est précisément ce qui
    // a coûté le contrat zipMemberMime × _isTextualMime en V-1.
    delete out.member;
    await putResource(out);
  }
  const convRecords = extractImportedConvRecords(payload);
  await clearIdbStore('conversations');
  await clearIdbStore('summaries');
  await replaceConvRecordsFromImport(convRecords.conversations, convRecords.summaries);
  // Prévenir les autres onglets AVANT de recharger celui-ci : remplacement
  // intégral destructif → les pairs doivent repartir d'un état frais, pas
  // re-render par bribes sur les resources-updated émis pendant la réinsertion
  // (un seul full-reload, cf. PLAN-J J2 / doctrine post-commit). Cet onglet-ci
  // recharge juste après ; les pairs rechargent sur réception.
  syncPost('full-reload', {});
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
// Deux caps distincts, appliqués APRÈS classifyAttachmentKind (le seuil dépend
// du kind) : une image est plafonnée avant resize/base64 canvas ; un fichier
// texte/binary sert de blob source à js__eval et est borné par MAX_INLINE_BYTES
// (utils.js, 64 Mo — cf. tools.js : mémoire VM 256 Mo). Un log de 22 Mo doit
// passer côté texte/binary sans être bloqué par la borne image.
const ATTACHMENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;   // 10 Mo, rejet pré-resize (image)
const ATTACHMENT_IMAGE_MAX_EDGE = 1536;                // plus grand côté après downscale
const ATTACHMENT_IMAGE_JPEG_QUALITY = 0.85;            // ré-encodage JPEG
const ATTACHMENT_TEXT_MAX_BYTES = 200 * 1024;          // 200 kB, au-delà → binary
const ATTACHMENT_MAX_IMAGES = 4;                       // cap images par message

// Cap de taille selon le kind classifié (pure) : image → borne pré-resize,
// texte/binary → borne blob js__eval. Retourne { bytes, label } (label pour le
// message d'erreur, ex. « 10 Mo »). Une seule source pour les deux ingesteurs
// (message + bibliothèque de Space).
function attachmentCapForKind(kind) {
  return kind === 'image'
    ? { bytes: ATTACHMENT_IMAGE_MAX_BYTES, label: '10 Mo' }
    : { bytes: MAX_INLINE_BYTES, label: '64 Mo' };
}

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
  const kind0 = classifyAttachmentKind(file.name, file.type);
  const cap = attachmentCapForKind(kind0);
  if (file.size > cap.bytes) {
    showComposerAttachError('« ' + file.name + ' » dépasse ' + cap.label + ' — fichier ignoré.');
    return null;
  }
  if (kind0 === 'image') {
    const imgCount = pendingAttachments.filter(a => a.kind === 'image').length;
    if (imgCount >= ATTACHMENT_MAX_IMAGES) {
      showComposerAttachError('Maximum ' + ATTACHMENT_MAX_IMAGES + ' images par message.');
      return null;
    }
  }

  ensureConversation();   // conversationId stable pour le rattachement IDB
  // Le numéro est RÉSERVÉ ici — lecture, incrément et persistance dans la même
  // passe synchrone, AVANT tout await (reserveAttIdFor, resources.js). L'ordre
  // inverse (allouer, stocker, persister après l'await) a tenu tant que le
  // composer était le seul allocateur : sa fenêtre était fermée par la
  // sérialisation de l'ingestion d'une FileList (attachIngestInFlight). Depuis
  // V-8, docs__render_page alloue sur LE MÊME compteur depuis une génération —
  // que rien ne sérialise avec le composer. Persister après l'await écraserait
  // alors un numéro déjà réservé par un rendu, et deux records porteraient le
  // même att-N : getCachedRecordByAttId rend le PREMIER trouvé, donc la
  // ré-injection cross-turn et le bouton de téléchargement serviraient la
  // mauvaise image. Un seul allocateur, un seul ordre.
  const attId = reserveAttIdFor(currentConvId);   // resources.js
  if (!attId) { showComposerAttachError('Échec du traitement de « ' + file.name + ' ».'); return null; }
  const now = Date.now();

  try {
    if (kind0 === 'image') {
      const { blob, mime, w, h } = await downscaleImageFile(file);
      const buf = await blob.arrayBuffer();
      const rec = await storeAttachment(attId, mime, file.name, buf, 'binary', currentConvId, now, Math.random, { w, h });
      if (!rec) { showComposerAttachError('Échec du stockage de « ' + file.name + ' ».'); return null; }
      return { attId, name: file.name, mime, size: buf.byteLength, kind: 'image', w, h };
    }

    if (kind0 === 'text') {
      const text = await readFileAsText(file);
      const buf = utf8Encode(text);
      if (buf.byteLength > ATTACHMENT_TEXT_MAX_BYTES) {
        // Rétrogradé à binary : trop volumineux pour une injection texte (D3).
        const rec = await storeAttachment(attId, file.type || 'application/octet-stream', file.name, buf, 'binary', currentConvId, now, Math.random);
        if (!rec) { showComposerAttachError('Échec du stockage de « ' + file.name + ' ».'); return null; }
        return { attId, name: file.name, mime: file.type || 'application/octet-stream', size: buf.byteLength, kind: 'binary' };
      }
      const rec = await storeAttachment(attId, file.type || 'text/plain', file.name, buf, 'inline', currentConvId, now, Math.random);
      if (!rec) { showComposerAttachError('Échec du stockage de « ' + file.name + ' ».'); return null; }
      return { attId, name: file.name, mime: file.type || 'text/plain', size: buf.byteLength, kind: 'text' };
    }

    // binary
    const buf = await readFileAsArrayBuffer(file);
    const rec = await storeAttachment(attId, file.type || 'application/octet-stream', file.name, buf, 'binary', currentConvId, now, Math.random);
    if (!rec) { showComposerAttachError('Échec du stockage de « ' + file.name + ' ».'); return null; }
    return { attId, name: file.name, mime: file.type || 'application/octet-stream', size: buf.byteLength, kind: 'binary' };
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
  const kind0 = classifyAttachmentKind(file.name, file.type);
  const cap = attachmentCapForKind(kind0);
  if (file.size > cap.bytes) {
    showSpaceFilesError('« ' + file.name + ' » dépasse ' + cap.label + ' — fichier ignoré.');
    return null;
  }
  const now = Date.now();
  try {
    if (kind0 === 'image') {
      const { blob, mime, w, h } = await downscaleImageFile(file);
      const buf = await blob.arrayBuffer();
      const rec = await storeLibraryFile(spaceId, mime, file.name, buf, 'binary', undefined, undefined, now, Math.random, { w, h });
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
  // Abort CIBLÉ (lot T-1a) : le bouton stop du composer n'interrompt que la
  // génération de la conversation AFFICHÉE. Les générations détachées (autres
  // conversations, autres Espaces) continuent — c'est tout l'objet du lot.
  if (sending) abortStream(currentConvId);
  else sendMessage();
}

// Interrompt la génération d'UNE conversation (si elle en a une). Le contenu
// déjà reçu est conservé (pas de rollback) ; la boucle d'outils ne relance pas
// de tour (piège 10). Vit dans main.js et non api.js : c'est le registre de
// générations qui détient les controllers depuis T-1a.
function abortStream(convId) {
  const gen = generationFor(convId);
  if (gen && gen.abort) gen.abort.abort();
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
  // Aucune skill activée : rien à reconnaître — un `/mot` (même en position 0)
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

// ── Interjections mid-génération (lot Q) ────────────────────────────────────
// File des messages tapés PENDANT une génération (Entrée en mode file, cf.
// onComposerKey, ui.js). Mémoire seulement, locale à l'onglet : jamais
// persistée ni broadcastée (lot J non concerné — état jamais affiché ailleurs,
// meurt avec l'onglet). Chaque entrée : { id, literal } — LITTÉRAL uniquement,
// jamais de contenu baké : les slash-skills sont re-résolues au drain (contenu
// COURANT, même doctrine que editUserMessage). Deux points de vidange, une
// seule mécanique :
//   drain B (nominal)  — hook onInterjections (dispatchSend → runConversation) :
//     à la frontière de tour de la boucle d'outils, le modèle voit
//     l'interjection AVANT son prochain geste (réaiguillage mid-boucle) ;
//   drain A (résiduel) — settleInterjectionQueue : fin d'échange nominale
//     (finish 'stop'), la file part comme NOUVEL échange par le chemin d'envoi
//     normal ; toute fin NON-nominale (stop manuel, halte ask_confirmation,
//     erreur, MAX_TOURS) REFOULE les littéraux dans le composer — jamais
//     d'envoi auto après un arrêt (arbitrages lot Q).
let _pendingInterjections = [];
let _ijResolving = false;   // garde B7 : double-Entrée pendant l'await resolveSend de l'enqueue

// Splice SYNCHRONE du snapshot (invariant réentrance, mémoire projet) : les
// éléments sortent du registre AVANT tout await du drain — un clic éditer/
// annuler pendant la résolution ne peut plus saisir un élément en vol. Les
// puces correspondantes passent en état « draining » (non interactif).
function takePendingInterjections() {
  const batch = _pendingInterjections.splice(0, _pendingInterjections.length);
  if (batch.length) markInterjectionChipsDraining(batch.map(b => b.id));
  return batch;
}

// Entrée en mode file (Entrée pendant `sending`). Validation du slug À LA MISE
// EN FILE (arbitrage lot Q) : même chemin que sendMessage — resolveSend sur le
// littéral, un /slug inconnu/désactivé en position 0 bloque ici avec l'erreur
// composer habituelle, saisie préservée. Le contenu baké est JETÉ : la file ne
// garde que le littéral, re-résolu à frais au drain.
async function enqueueInterjection() {
  if (!sending || _ijResolving) return;
  // Texte seul (arbitrage lot Q) : une pièce jointe en attente ne rejoint pas
  // la file — refus visible, jamais de détachement silencieux.
  if (pendingAttachments.length) {
    showComposerAttachError('Pièce jointe impossible pendant la génération — attends la fin de la réponse.');
    return;
  }
  const ta = $('composer-text');
  const text = ta.value.trim();
  if (!text) return;
  let r;
  _ijResolving = true;
  try {
    r = await resolveSend(text);
  } finally {
    _ijResolving = false;
  }
  if (!r.ok) { showComposerSkillError(r.error); return; }
  // La génération s'est terminée PENDANT l'await : plus de mode file — la
  // saisie (intacte dans la textarea) part en envoi normal, jamais en file morte.
  if (!sending) { sendMessage(); return; }
  ta.value = ''; ta.style.height = 'auto';
  clearComposerSkillError();
  hideSkillAutocomplete();
  // Id : jamais Date.now() seul (mémoire projet B1) — suffixe aléatoire.
  _pendingInterjections.push({
    id: 'ij-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    literal: text,
  });
  renderInterjectionRail();
}

// Annulation (croix d'une puce) : retire du registre, la puce plonge.
// Introuvable = déjà drainée pendant la fenêtre de clic : no-op.
function cancelInterjection(id) {
  const idx = _pendingInterjections.findIndex(q => q.id === id);
  if (idx < 0) return;
  _pendingInterjections.splice(idx, 1);
  dismissInterjectionChip(id, 'down');
}

// Édition (clic sur le corps d'une puce) : retire du registre et re-remplit le
// composer, préfixé à un brouillon éventuel. Ré-appuyer Entrée RE-MET EN FILE
// (le mode file reste actif tant que `sending`) — jamais d'envoi direct.
function editInterjection(id) {
  const idx = _pendingInterjections.findIndex(q => q.id === id);
  if (idx < 0) return;
  const item = _pendingInterjections.splice(idx, 1)[0];
  dismissInterjectionChip(id, 'down');
  const ta = $('composer-text');
  ta.value = item.literal + (ta.value.trim() ? '\n\n' + ta.value : '');
  autoGrow(ta);
  ta.focus();
}

// Fin d'échange (finally de dispatchSend, APRÈS setSending(false) — appel
// fire-and-forget). nominal (finish 'stop') → drain A : la file part comme
// nouvel échange par le chemin d'envoi normal. Non-nominal → reflux : les
// littéraux reviennent au composer, préfixés au brouillon (« stop veut dire
// stop » : rien ne part tout seul après un arrêt, rien n'est perdu).
async function settleInterjectionQueue(nominal) {
  const batch = takePendingInterjections();
  if (!batch.length) return;
  const literal = joinInterjectionLiterals(batch.map(b => b.literal));
  batch.forEach(b => dismissInterjectionChip(b.id, nominal ? 'up' : 'down'));
  if (!literal) return;
  if (!nominal) {
    const ta = $('composer-text');
    ta.value = literal + (ta.value.trim() ? '\n\n' + ta.value : '');
    autoGrow(ta);
    ta.focus();
    return;
  }
  // Drain A. Échec résiduel de résolution (skill désactivée/supprimée PENDANT
  // la génération — chaque littéral a déjà passé la garde à l'enqueue) : envoi
  // du littéral tel quel, sans erreur bloquante (arbitrage lot Q).
  let r = null;
  _sendResolving = true;
  try {
    r = await resolveSend(literal);
  } catch (e) {
    r = null;
  } finally {
    _sendResolving = false;
  }
  if (r && r.ok) await sendUserText(r.literal, r.isSkill ? r.content : undefined);
  else await sendUserText(literal);
}

async function sendMessage() {
  // `sending` ne passe à true que dans dispatchSend, APRÈS l'await resolveSend
  // ci-dessous ; ce dernier peut attendre IDB (getSkillContent d'une slash-skill),
  // laissant une fenêtre où deux Entrée rapides franchiraient toutes deux la garde
  // et pousseraient deux messages. `_sendResolving` ferme cette fenêtre (B7).
  if (!configured || sending || _sendResolving) return;
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
  // ni ne consomme un tour modèle. Le verrou couvre exactement cet await.
  let r;
  _sendResolving = true;
  try {
    r = await resolveSend(text);
  } finally {
    _sendResolving = false;
  }
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
      // ensuite via un outil d'ouverture de documents, natif ou serveur (DOCS_DOCTRINE).
      binaryAttachments.push(att);
    }
  }
  return buildAttachedMessageContent(baseText, textAttachments, imageAttachments, binaryAttachments);
}

// Cœur d'un envoi utilisateur : crée la conv au besoin, pousse le message,
// persiste, relance la génération. Partagé par la saisie composer (sendMessage)
// et la reprise « fork B » d'ask_confirmation (Accepter → « Oui » / Rejeter → « Non »).
// `bakedContent` (optionnel) : contenu réellement envoyé/stocké pour le modèle
// (slash-commande skill = littéral + corps de la skill). `text` reste le littéral
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
  // recherche mémoire porte sur le littéral, pas sur le corps de la skill injecté.
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
  if (sending || _sendResolving) return null;   // pas d'édition pendant un stream ni une résolution en vol (B7)
  const t = (newText || '').trim();
  if (!t) return null;
  if (index < 0 || index >= currentThread.length) return null;
  if (currentThread[index].role !== 'user') return null;

  // Pièces jointes du message édité (c20) : figées AVANT tout await. Éditer le
  // texte ne touche jamais à la liste (ni ajout ni retrait) — elle est reportée
  // telle quelle sur le message réécrit, et l'édition re-déclenche un tour
  // d'attache (piège 17) : le content repart en content parts (image) / blocs
  // fencés (texte) / descripteurs (binaire) par le MÊME chemin que l'envoi
  // initial, puis onFinal/onHalt de dispatchSend re-collapsent en descripteur
  // (ils reciblent le dernier index user, donc le message édité après troncature).
  // Sans ça, l'édition détachait silencieusement l'image : le modèle régénérait
  // sa réponse sans la voir.
  const old = currentThread[index];
  const oldAttachments = old.attachments;

  // Résoudre AVANT toute mutation : un slug invalide laisse le thread intact et la
  // bulle en mode édition (l'utilisateur corrige), erreur remontée à l'appelant.
  // Même verrou que sendMessage : l'await resolveSend peut attendre IDB.
  // buildOutgoingContentForAttachments est async lui aussi : il rentre dans le
  // MÊME bloc _sendResolving/finally (garde B7) — sinon ce second await rouvre
  // une fenêtre de double-tir entre la résolution et la mutation du thread. Il
  // ne touche pas au thread, il peut donc précéder la troncature.
  let r, content;
  _sendResolving = true;
  try {
    r = await resolveSend(t);
    if (r.ok && oldAttachments && oldAttachments.length) {
      content = await buildOutgoingContentForAttachments(r.content, oldAttachments);
    }
  } finally {
    _sendResolving = false;
  }
  if (!r.ok) return r.error;
  if (content === undefined) content = r.content;

  currentThread = currentThread.slice(0, index + 1);
  const msg = { role: 'user', content, ts: Date.now() };
  // Doctrine displayText alignée sur sendUserText : source UNIQUE de la bulle
  // dès que `content` diverge du littéral tapé. Deux causes cumulables — skill
  // bakée, et attachments (parts/blocs fencés/descripteurs). Sans l'élargir aux
  // attachments, la textarea d'une future ré-édition fuiterait fences/descripteurs.
  if (r.isSkill || content !== r.literal) msg.displayText = r.literal;
  if (oldAttachments) msg.attachments = oldAttachments;
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
function regenerateResponse() {
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
// `thread` explicite depuis T-1a : cette réécriture appartient à la génération
// qui vient de terminer son tour, pas à l'écran. Lire currentThread ici ferait
// collapser le message d'une AUTRE conversation dès que l'utilisateur navigue
// pendant la génération.
function rewriteAttachedUserMessage(thread, idx) {
  if (idx < 0 || idx >= thread.length) return;
  const m = thread[idx];
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
  const model = activeModel();   // modèle qui va produire cette réponse (override conv ou défaut)
  const serverName = (activeApiServer() || {}).name || '';   // provenance, persistée sur chaque message assistant
  const reasoningEffort = activeReasoningEffort();

  // Génération de cet échange (lot T-1a). À partir d'ici, TOUS les hooks mutent
  // `gen.thread` et persistent via persistGeneration(gen) — jamais currentThread
  // / persistCurrent, qui suivent l'ÉCRAN et pointeraient sur une autre
  // conversation dès que l'utilisateur navigue. Le thread de la génération EST
  // celui de l'écran (même référence, pas une copie) tant que la conversation
  // reste affichée : les mutations des hooks restent donc directement visibles
  // par renderThread, exactement comme avant le lot.
  //
  // Déclarée AVANT le filet de collapse ci-dessous, qui opère déjà sur
  // `gen.thread` : l'ordre inverse touchait une TDZ (« Cannot access 'gen'
  // before initialization ») qui avortait tout envoi.
  const gen = createGeneration(currentConvId, currentThread, { model, serverName, reasoningEffort });
  registerGeneration(gen);
  {
    const lastUserAt = gen.thread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
    for (let i = 0; i < gen.thread.length; i++) {
      if (i !== lastUserAt) rewriteAttachedUserMessage(gen.thread, i);
    }
  }
  const sysParts = systemMessageParts();
  const sys = buildSystemMessage(sysParts);
  // Résout les références de ressources ([resource_ref:…]) dans les entry.result
  // des tool-acks avant d'appeler expandThread. Inline → contenu UTF-8 décodé
  // (byte-identique d'un tour à l'autre via session cache) ; binary → descripteur.
  const threadMsgs = expandThread(resolveRecallImages(resolveResourceRefs(gen.thread)));

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
  // Photo du thread AVANT injection du préfixe dynamique, pour le manifeste de
  // contexte (plus bas) : buildContextManifest compte déjà `dynParts` en entrées
  // séparées — lui passer le thread préfixé recompterait les blocs dynamiques
  // une deuxième fois dans l'agrégat thread (bug payé : pilule gonflée de
  // ~600 tokens entre l'envoi et le calibrage sur l'usage réel). Les deux
  // autres call-sites (computeContextManifestNow, recomputeLastContextManifest)
  // passent naturellement un thread sans préfixe : même convention ici.
  const manifestThreadMsgs = threadMsgs.slice();
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
  // concaténées (audit §6). Thread SANS le préfixe dynamique (photo
  // manifestThreadMsgs prise avant l'injection ci-dessus) : les blocs
  // dynamiques sont déjà ventilés en entrées séparées via `dynParts`.
  // Recalculé à nouveau en fin de tour (recomputeLastContextManifest) une fois
  // les tool-acks/la réponse assistant ajoutés ; ici il doit déjà être posé
  // AVANT l'appel réseau pour que la pilule (syncContextCounter ci-dessous) et
  // le drawer, ouvert pendant le streaming, montrent la même chose — bug payé :
  // sans ce syncContextCounter(), la pilule restait au total du tour précédent
  // tant que le tour en cours n'était pas terminé, alors que le drawer (ouvert
  // au clic, recalculé à l'instant) affichait déjà le nouveau total.
  _lastContextManifest = buildContextManifest(sysParts, dynParts, manifestThreadMsgs, JSON.stringify(toolDefinitions()), null);
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
    const lastUserMsg = gen.thread.reduce((acc, m) => (m.role === 'user' ? m : acc), null);
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
  const prefix = isContinuation ? gen.thread[continuation.continueIndex].content : '';

  // La bulle vive vit sur `gen` depuis T-1b (plus une variable en closure) :
  // c'est ce qui permet à un détachement de la mettre à null et aux hooks de
  // tester genOwnsScreen(gen) avant tout effet DOM. Un envoi part toujours de la
  // conversation affichée, donc on possède l'écran ici.
  if (isContinuation) {
    gen.wrap = continuation.wrap;
    // Retire le bandeau de troncature au démarrage : la génération reprend,
    // le message n'est plus dans un état "en attente de continuation".
    const banner = gen.wrap.querySelector('.msg-truncated');
    if (banner) banner.remove();
    startWaiter(gen.wrap.querySelector('.body'));   // état WAITING, comme startAssistantMessage
    scrollBottom(true);   // clic "continuer" explicite : toujours suivre
  } else {
    gen.wrap = startAssistantMessage(model, serverName);
  }
  // Acks MCP pré-rendus (avant await réseau) : { ack: descripteur brut, entry:
  // entrée currentThread, node: nœud DOM }. Stockés ici pour que onToolAcks
  // puisse rétro-appliquer la classe d'erreur si ack.error a été posé après l'await.
  let earlyRendered = [];
  // Fin nominale (finish 'stop') : seul cas où la file d'interjections
  // résiduelle part en drain A (settleInterjectionQueue, finally ci-dessous).
  // 'aborted'/'length'/halte/erreur → reflux composer (arbitrages lot Q).
  let endedNominal = false;
  setSending(true);
  try {
    await runConversation(apiMessages, {
      gen,   // porteur de l'AbortController du tour (abort ciblé, lot T-1a)
      model,
      reasoningEffort,
      imageDescriptors,   // D5 : descripteurs du tour courant pour la dégradation vision-less
      visionDisabled,     // D5 (A2) : modèle marqué sans vision → dégradation proactive
      // Une continuation ne relance JAMAIS d'outils : autoriser des tool_calls
      // ici ouvrirait des cas de raccord ingérables (tours intermédiaires qui
      // pousseraient de nouvelles bulles alors qu'on veut concaténer le texte
      // dans la bulle existante). Cf. h.noTools, api.js/runConversation.
      noTools: isContinuation,
      // (a) mémoriser le partiel du tour sur la génération — TOUJOURS : c'est
      // la seule donnée qui ne vit nulle part ailleurs (le DOM ne survit pas au
      // détachement), et sans elle le rebranchement mid-stream perdrait le texte
      // déjà reçu. (b) peindre — seulement si on possède l'écran : sinon
      // streamInto/setReasoning enfileraient un `wrap` détaché dans leur slot de
      // throttle partagé, et le timer repeindrait un sous-arbre orphelin (voire
      // écraserait le rendu de la génération qui, elle, possède l'écran).
      onDelta: (full) => {
        gen.partialContent = isContinuation ? prefix + full : full;
        if (genOwnsScreen(gen)) streamInto(gen.wrap, gen.partialContent);
      },
      onReasoning: (full) => {
        gen.partialReasoning = full;
        if (genOwnsScreen(gen)) setReasoning(gen.wrap, full);
      },
      onToolTour: (content) => {
        // Frontière de tour : le partiel accumulé est consommé (soit finalisé
        // en message, soit abandonné) — le remettre à zéro, sinon un
        // rebranchement ultérieur ré-afficherait le texte du tour précédent.
        gen.partialContent = '';
        gen.partialReasoning = '';
        if (content && content.trim()) {
          // Le tour tool_calls a produit du texte visible : on le finalise dans
          // sa propre bulle et on en ouvre une nouvelle pour la suite.
          const tourTs = Date.now();
          const tourMsg = { role: 'assistant', content, model, ts: tourTs };
          if (serverName) tourMsg.server = serverName;
          gen.thread.push(tourMsg);   // avant finalizeAssistant, cf. onFinal
          if (genOwnsScreen(gen)) {
            finalizeAssistant(gen.wrap, content);
            revealMsgTimestamp(gen.wrap, tourTs);
            gen.wrap = startAssistantMessage(model, serverName);
          }
          persistGeneration(gen);
        } else if (genOwnsScreen(gen)) {
          resetAssistant(gen.wrap);
        }
      },
      // Vidange ANTICIPÉE des acks MCP poussés de manière synchrone par
      // callRemoteTool AVANT son premier await. Appelé par api.js juste après le
      // démarrage de callTool() et AVANT l'await, pour que la ligne s'affiche
      // pendant le round-trip réseau (pas seulement après). Les acks des outils
      // internes (synchrones) ne sont jamais ici — ils arrivent dans onToolAcks.
      onEarlyAcks: () => {
        const owns = genOwnsScreen(gen);
        // Lu avant les insertions DOM ci-dessous : cf. streamInto/finalizeAssistant,
        // sinon isAtBottom() verrait déjà le nouveau contenu et répondrait "faux"
        // même quand l'utilisateur suivait le fil.
        const follow = owns && isAtBottom();
        const pending = getPendingToolAcks();
        clearPendingToolAcks();
        for (const ack of pending) {
          // Whitelist unique ACK_COPY_FIELDS (utils.js) : couvre aussi les
          // champs d'enrichissement cross-turn, déjà posés si un outil interne
          // précédent a été drainé ici en même temps qu'un MCP.
          const entry = copyAckFields(ack, { role: 'tool-ack' });
          gen.thread.push(entry);
          // node null si détachée : earlyRendered garde l'entrée (la rétro-
          // application d'erreur en onToolAcks porte sur la DONNÉE, elle doit
          // avoir lieu dans les deux cas), seul le nœud DOM manque.
          const node = owns ? placeToolAck(gen.wrap, entry) : null;
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
        // La mutation de `entry` (donnée) a lieu dans TOUS les cas — c'est elle
        // qui est persistée et rendue au reload. Le nœud DOM est null si la
        // génération était détachée au moment de l'ack : rien à rétro-appliquer.
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

        const owns = genOwnsScreen(gen);
        // Lu avant les insertions DOM ci-dessous, même raison que onEarlyAcks.
        const follow = owns && isAtBottom();
        const pending = getPendingToolAcks();
        clearPendingToolAcks();
        for (const ack of pending) {
          // Whitelist unique ACK_COPY_FIELDS (utils.js) : couvre aussi les
          // champs d'enrichissement cross-turn (posés par updateLastPendingToolAck
          // via le hook onEnrichLastAck, après exécution de chaque outil interne).
          const entry = copyAckFields(ack, { role: 'tool-ack' });
          gen.thread.push(entry);
          if (owns) placeToolAck(gen.wrap, entry);
        }
        // Blocs NON-text renvoyés par un outil distant (image/resource/binaire) :
        // rendus DANS la bulle courante via la cascade D8, purement éphémères —
        // jamais poussés dans currentThread ni persistés (cf. D8). Une génération
        // détachée les PERD (ils ne sont ni persistés ni reconstructibles) : c'est
        // la contrepartie assumée de leur nature éphémère, cohérente avec D8.
        const blocks = getPendingToolBlocks();
        clearPendingToolBlocks();
        if (owns && blocks.length) placeToolBlocks(gen.wrap, blocks);
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
        // Effets d'ÉCRAN : le manifeste de contexte affiché décrit l'envoi de la
        // conversation AFFICHÉE. Une génération détachée qui les déclencherait
        // ferait afficher le contexte d'une autre conversation dans la pilule et
        // le drawer.
        if (owns) {
          recomputeLastContextManifest(matches, true);
          applyUsageToLastManifest(usage);
          syncContextCounter();
        }
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
      // Interjections (lot Q, drain B) : appelé par runConversation à la
      // frontière de tour, APRÈS onToolAcks — les acks du tour sont déjà dans
      // currentThread, l'entrée user s'insère donc TOUJOURS entre deux groupes
      // (enrichedAckGroups/[call:…] intacts par construction). Splice synchrone
      // (réentrance) puis résolution ; content = ce qui part réellement sur le
      // fil (skill bakée au contenu COURANT), displayText = littéral. Pas de
      // persistCurrent ici (même doctrine que onToolAcks) : l'unique écriture
      // de l'échange a lieu dans onFinal. Côté DOM : la bulle en cours est
      // close en « shell » d'acks (revue maquette 2026-07-17 : la suite du
      // travail se matérialise SOUS l'interjection), la bulle user apparaît,
      // et un wrap NEUF s'ouvre — l'ancien ne reçoit plus jamais rien.
      onInterjections: async () => {
        // La file d'interjections est un état d'ÉCRAN (le composer y écrit ce
        // que l'utilisateur tape en REGARDANT une conversation). Une génération
        // détachée ne doit donc jamais la drainer : elle injecterait dans SA
        // conversation des messages destinés à celle qui est affichée — et les
        // volerait au passage à la génération qui, elle, les attend.
        if (!genOwnsScreen(gen)) return null;
        const batch = takePendingInterjections();
        if (!batch.length) return null;
        const literal = joinInterjectionLiterals(batch.map(b => b.literal));
        if (!literal) return null;
        // Échec résiduel (skill désactivée pendant la génération) : littéral
        // tel quel — chaque élément a déjà passé la garde à l'enqueue.
        let r = null;
        try { r = await resolveSend(literal); } catch (e) { r = null; }
        const content = (r && r.ok) ? r.content : literal;

        // Clôture du tour interrompu en une VRAIE bulle assistant (revue
        // maquette 2026-07-17 : la suite du travail se matérialise SOUS
        // l'interjection). État de `wrap` à ce point : onToolTour a DÉJÀ tourné
        // (api.js l'appelle avant les acks) — si le tour a produit du texte, il
        // l'a finalisé dans SA propre bulle et ouvert ce `wrap` neuf ; sinon il
        // a reposé le patienteur. Le texte du tour n'est donc JAMAIS dans `wrap`
        // ici : cette bulle ne porte que les acks du tour. On matérialise un
        // message assistant à content VIDE (surtout pas re-lire un texte déjà
        // consommé — double bulle), pour donner aux acks un hôte dans
        // currentThread. Sans lui, renderThread les rendrait nus au reload
        // (branche orpheline). Live ET reload passent alors par le MÊME chemin
        // (placeToolAck dans cette bulle), sans classe spéciale. finalizeAssistant
        // clôt la bulle avec son chrome, horodatage inclus (exigence du brief).
        const tourTs = Date.now();
        // `_acksOnly` : marque cette bulle comme hôte d'acks sans texte, pour
        // que expandThread l'élague du payload (assistant vide = bruit KV) sans
        // toucher à un éventuel assistant final réellement vide venu d'ailleurs.
        const tourMsg = { role: 'assistant', content: '', model, ts: tourTs, _acksOnly: true };
        if (serverName) tourMsg.server = serverName;
        gen.thread.push(tourMsg);
        if (genOwnsScreen(gen)) {
          finalizeAssistant(gen.wrap, '');
          revealMsgTimestamp(gen.wrap, tourTs);
        }

        // Message user de l'interjection : authentique (jamais _synthetic —
        // l'injection <miaou_context> doit pouvoir le viser), content = ce qui
        // part sur le fil, displayText = littéral. Bulle rendue comme n'importe
        // quel message user envoyé, horodatage compris (exigence du brief).
        const userTs = Date.now();
        gen.thread.push(buildInterjectionEntry(literal, content, userTs));
        batch.forEach(b => dismissInterjectionChip(b.id, 'up'));
        // Wrap neuf : la suite (acks du tour suivant, réponse finale) s'y place ;
        // l'ancien ne reçoit plus jamais rien (invariant lot N préservé : un seul
        // groupe d'acks contigu par bulle assistant).
        if (genOwnsScreen(gen)) {
          appendUserMessage(literal, userTs);
          gen.wrap = startAssistantMessage(model, serverName);
        }
        return [{ role: 'user', content }];
      },
      onFinal: (content, reasoning, finishReason, { usage } = {}) => {
        if (finishReason === 'stop') endedNominal = true;
        if (isContinuation) {
          // Mute le message existant au lieu d'en pousser un nouveau : même
          // horodatage, même identité de message, juste plus de contenu.
          // finishReason === 'length' : re-troncature possible (chaîne de
          // continuations). 'aborted' (stop manuel pendant la continuation) :
          // le raccord est resté partiel, le flag reste — le bandeau reste et
          // « Continuer » peut reprendre. Seule une fin normale le retire.
          const m = gen.thread[continuation.continueIndex];
          m.content = prefix + content;
          if (finishReason === 'length' || finishReason === 'aborted') m.truncated = true;
          else delete m.truncated;
          if (reasoning && reasoning.trim()) m.reasoning = joinReasoning(m.reasoning, reasoning);
          if (genOwnsScreen(gen)) {
            const body = gen.wrap.querySelector('.body');
            if (body) body.dataset.raw = m.content;
            finalizeAssistant(gen.wrap, m.content, m.truncated);
            if (m.reasoning) flushReasoning(gen.wrap, m.reasoning);
          }
          persistGeneration(gen);
          if (genOwnsScreen(gen)) {
            recomputeLastContextManifest(matches);
            applyUsageToLastManifest(usage);
            syncContextCounter();
          }
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
          const lastUserIdx = gen.thread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
          rewriteAttachedUserMessage(gen.thread, lastUserIdx);
        }
        // Poussé AVANT finalizeAssistant : ce dernier appelle syncConvDownloadBtn(),
        // qui teste currentThread.some(role==='assistant') — sur une conversation
        // fraîche (premier tour), un ordre inversé laisserait le bouton caché
        // malgré la réponse déjà affichée (bug payé : visible seulement après reload).
        gen.thread.push(msg);
        if (genOwnsScreen(gen)) {
          finalizeAssistant(gen.wrap, content, msg.truncated);
          revealMsgTimestamp(gen.wrap, ts);
          if (reasoning && reasoning.trim()) flushReasoning(gen.wrap, reasoning);   // écrit la valeur finale au live (le throttle a pu sauter les derniers tokens)
        }
        persistGeneration(gen);
        if (genOwnsScreen(gen)) {
          recomputeLastContextManifest(matches);
          applyUsageToLastManifest(usage);
          syncContextCounter();
        }
        setConnDot('ok');
        maybeTitle(gen);
      },
      onHalt: (leadIn, question, { usage } = {}) => {
        // Fork B (brief §4) : la question (+ lead-in éventuel) devient un message
        // assistant en TEXTE CLAIR, persisté — aucun tool_call/tool_result natif ne
        // subsiste. Au tour suivant le modèle relit l'échange en clair et agit
        // (« Oui » → memory__create + narration ; « Non » → rien).
        // Réécriture parts→descripteur (D2) : la halte termine aussi le tour
        // pour le message user qui a pu porter des attachments.
        {
          const lastUserIdx = gen.thread.reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1);
          rewriteAttachedUserMessage(gen.thread, lastUserIdx);
        }
        const text = [leadIn, question].map(s => (s || '').trim()).filter(Boolean).join('\n\n');
        const haltTs = Date.now();
        const haltMsg = { role: 'assistant', content: text, model, ts: haltTs };
        if (serverName) haltMsg.server = serverName;
        gen.thread.push(haltMsg);   // avant finalizeAssistant, cf. onFinal
        if (genOwnsScreen(gen)) {
          finalizeAssistant(gen.wrap, text);
          revealMsgTimestamp(gen.wrap, haltTs);
        }
        persistGeneration(gen);
        if (genOwnsScreen(gen)) {
          recomputeLastContextManifest(matches);
          applyUsageToLastManifest(usage);
          syncContextCounter();
          // Widget inline : la question est déjà dans la bulle ci-dessus, la carte
          // ne porte que les actions. Accepter/Rejeter envoient « Oui »/« Non » par
          // le même chemin qu'une saisie ; l'overlay se lève à la résolution.
          // Réservé à l'écran : la confirmation est un overlay MODAL, et
          // sendUserText part sur la conversation AFFICHÉE — l'ouvrir depuis une
          // génération détachée demanderait à l'utilisateur de répondre pour une
          // conversation qu'il ne regarde pas, et sa réponse partirait ailleurs.
          // La question reste dans le fil (message assistant persisté ci-dessus) :
          // revenir sur la conversation la montre, et y répondre reprend le fil.
          showConfirmation('',
            () => sendUserText('Oui'),
            () => sendUserText('Non'));
        }
        setConnDot('ok');
      },
      onError: (msg) => { if (genOwnsScreen(gen)) finalizeAssistantError(gen.wrap, msg); },
    });
  } catch (e) {
    // Message brut confié à finalizeAssistantError, qui l'échappe (textContent) —
    // le message d'un backend peut porter un JSON multi-ligne. Cohérent avec
    // onError ci-dessus (non-convergence) : même rendu .msg-error. Une réponse
    // HTTP d'erreur (streamCompletion throw « HTTP <code> : … », détail extrait
    // par formatErrorDetail) porte déjà son préfixe et n'est PAS une erreur
    // réseau au sens strict — on ne re-préfixe « Erreur réseau » que le vrai
    // échec de transport (fetch rejeté : DNS, CORS, connexion refusée).
    const detail = (e && e.message) || String(e);
    if (genOwnsScreen(gen)) finalizeAssistantError(gen.wrap, /^HTTP \d/.test(detail) ? detail : 'Erreur réseau : ' + detail);
    setConnDot('err');
  } finally {
    // Désenregistrement AVANT setSending : ce dernier dérive `sending` du
    // registre (« la conv AFFICHÉE génère-t-elle ? »), il doit donc voir un
    // registre déjà à jour.
    const screenAtEnd = genOwnsScreen(gen);
    unregisterGeneration(gen);
    setSending(isGenerating(currentConvId));
    syncReasoningUI();       // masque le sélecteur si reasoning_effort a été rejeté pendant le tour (cf. api.js), y compris quand le retry sans paramètre a réussi
    armIdleSummaryTimer();   // réarme quelle que soit l'issue du tour (réponse, halte, erreur)
    // Interjections restantes (lot Q) : drain A si fin nominale, reflux
    // composer sinon. APRÈS setSending(false) — le drain A repart par le
    // chemin d'envoi normal (sendUserText → dispatchSend). Fire-and-forget.
    // Réservé à la génération qui possède l'écran (même raison qu'onInterjections) :
    // le reflux vise le composer, et le drain A repart sur la conv AFFICHÉE.
    // Une génération détachée qui se termine laisse donc la file intacte pour
    // celle qui la regarde.
    if (screenAtEnd) settleInterjectionQueue(endedNominal);
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
  // Écriture ciblée : le titrage arrive APRÈS onFinal, donc potentiellement
  // après le désenregistrement de la génération — la conversation peut être
  // froide (messages évincés de l'étage 2), et un saveConversation la viderait.
  if (loadConversation(convId)) persistConversationField(convId, { title: title });
  if (convId === currentConvId) setTitle(title);   // barre du haut + <title> de la page
  renderConvList();                                 // liste de gauche
}

// `gen` (lot T-1a) : le besoin de titrage et le thread appartiennent à la
// GÉNÉRATION, pas à l'écran — une génération détachée qui se termine doit
// pouvoir titrer SA conversation. `needTitle` reste figé au démarrage de la
// génération (createGeneration), ce qui préserve le piège 9 : la globale
// d'écran ne gouverne plus rien ici, et un titrage ne peut plus atterrir sur la
// conversation affichée par erreur.
async function maybeTitle(gen) {
  if (!gen || !gen.needTitle || !gen.convId) return;
  if (!gen.thread.some(m => m.role === 'assistant' && m.content && m.content.trim().length >= 8)) return;
  gen.needTitle = false;
  // L'écran ne doit plus réclamer ce titrage s'il affiche la même conversation.
  if (gen.convId === currentConvId) needTitle = false;
  const convId = gen.convId;                        // figé : l'utilisateur peut naviguer
  const thread = gen.thread.slice();
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
  // Génération en vol sur cette conversation (lot T-1a) : son thread n'est pas
  // stabilisé et la persistance n'a pas encore eu lieu pour le tour courant —
  // résumer maintenant produirait un résumé d'un état intermédiaire, et le
  // messageCount enregistré empêcherait le vrai résumé plus tard. Vaut aussi
  // pour la conversation qu'on QUITTE (selectConv → summarizeIfNeeded(leaving)),
  // qui est précisément le cas nouveau que ce lot rend possible.
  if (isGenerating(id)) return;
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
  const all = loadSummaries();
  const pruned = pruneOrphanSummaries(all, listAllConversations());
  // pruneOrphanSummaries est pure : elle rend l'index nettoyé. On en déduit les
  // ids réellement retirés pour les supprimer un à un du store.
  for (const id of Object.keys(all)) {
    if (!Object.prototype.hasOwnProperty.call(pruned, id)) removeSummaryRecord(id);
  }
}

// ── Backfill modèle : attribue le modèle courant aux réponses sans modèle ───
// Cœur décisionnel, PUR et QuickJS-testable : mute les réponses assistant sans
// modèle et rend true si quelque chose a bougé (donc s'il faut réécrire). La
// coquille async ne fait que l'alimenter depuis IDB.
function applyMessageModelBackfill(conv, model) {
  if (!conv || !Array.isArray(conv.messages) || !model) return false;
  let dirty = false;
  for (const m of conv.messages) {
    if (m && m.role === 'assistant' && !m.model) { m.model = model; dirty = true; }
  }
  return dirty;
}

async function backfillMessageModels() {
  // Modèle du serveur actif (activeApiConfig, filet legacy inclus) : sur une
  // install configurée uniquement via les cartes serveurs, loadSettings().model
  // est vide et le backfill serait inerte.
  const model = activeApiConfig().model;
  if (!model) return;
  // Lecture FROIDE en masse : les `messages` de toutes les conversations, dont
  // la plupart ne sont pas en RAM (étage 2 borné). Passe par IDB, jamais par
  // loadConversation qui rendrait `messages: []` sur une conversation froide et
  // rendrait la migration silencieusement inopérante.
  for (const conv of await readAllConversationsFromDB()) {
    if (applyMessageModelBackfill(conv, model)) {
      // Écriture FROIDE : le record complet relu d'IDB porte bien ses messages,
      // mais les remettre au chaud remplirait l'étage 2 (borné à 12) de
      // conversations que personne n'a ouvertes — cf. persistConversationCold.
      persistConversationCold(conv);
    }
  }
}

// ── Backfill au démarrage (séquentiel, indicateur continu) ──────────────────
async function runBackfill() {
  // Le résumé n'a besoin que de l'URL (clef optionnelle) : ne pas dépendre de
  // `configured`, qui exige aussi une clef (utile pour un endpoint sans auth).
  if (!loadSettings().url) return;
  const cands = await backfillCandidates();
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
async function init() {
  applyLogo();
  syncPaletteHintUI();   // libellé Cmd+K / Ctrl+K selon la plateforme (statique, une fois)

  // Hydratation du cache conversations/résumés (lot U-1) AVANT tout rendu et
  // avant migrateSpacesIfNeeded (qui lit loadConversations) : les lecteurs sont
  // synchrones et serviraient un cache vide. L'attente est masquée par
  // l'overlay de boot, qui ne s'estompe qu'à finishBoot().
  // Migration localStorage → IDB (lot U-2) AVANT l'hydratation : le cache se
  // remplit depuis les stores IDB, qui doivent donc déjà porter l'historique.
  // Échec → on n'a rien purgé, localStorage reste intact, le prochain boot
  // retentera ; on hydrate quand même (le cache servira ce qui est en base).
  try {
    await migrateConversationsToIdbIfNeeded();
  } catch (e) {
    console.error('[miaou] migration des conversations vers IndexedDB impossible (localStorage laissé intact)', e);
  }
  try {
    await hydrateConvCache();
  } catch (e) {
    console.error('[miaou] hydratation du cache conversations impossible', e);
  }

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
  await backfillMessageModels();   // migration : idem, doit tourner avant le branchement du canal (désormais async : ses écritures émettraient sinon des conv-updated après branchement)
  // Synchro multi-onglets : branche le récepteur ET construit le canal, APRÈS
  // les migrations de boot (Spaces + serveurs API + backfill modèles). Tant
  // que _syncChannel était null, syncPost restait no-op — les migrations
  // n'ont émis aucun broadcast parasite. À partir d'ici, cet onglet émet
  // (post-commit) ET écoute (handleSyncMessage → routeMessage →
  // applySyncDecision).
  syncOnMessage(handleSyncMessage);
  // Soft-lock (J4) : à la fermeture/masquage de l'onglet, signaler best-effort
  // qu'on lâche la conv affichée (les pairs retirent le bandeau). pagehide couvre
  // le cas mobile/bfcache où beforeunload ne tire pas ; les deux sont tolérés en
  // double (le pair déduplique par tabId dans son set). Le TTL de J5 est le vrai
  // filet contre un crash sans événement ; ceci est l'accélérateur du cas propre.
  const onTabLeaving = function () {
    // Best-effort : libérer le readonly des pairs si on générait (J5) AVANT de
    // lâcher la conv (J4). stopGenerationRelay est idempotent et émet -ended ;
    // le TTL reste le filet si l'onglet meurt sans que ces events partent.
    stopAllGenerationRelays();
    if (currentConvId) announceConvClosed(currentConvId);
  };
  window.addEventListener('pagehide', onTabLeaving);
  window.addEventListener('beforeunload', onTabLeaving);
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
  setPaletteUI(s.palette || 'ambre');
  applyPalette(s.palette || 'ambre');
  setFontsUI(s.fonts || 'graphite');
  applyFonts(s.fonts || 'graphite');
  prefetchFontLots();   // lots inactifs, pendant que l'overlay de boot masque l'écran
  setMotionUI(s.motion || 'system');
  applyMotion(s.motion || 'system');
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
  initComposerModelLabelFit();
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
  // skills système (upsert inconditionnel depuis src/system-skills/*.md, cf.
  // skills.js) PUIS méta des skills en mémoire → autocomplétion + outils +
  // légende « / » ; rafraîchit aussi la pilule de contexte, sous-évaluée tant
  // que le bloc skills autotrigger (buildSkillsContextBlock) n'a pas ces
  // données (même écart que loadSpaceLibrary).
  ensureSystemSkills().then(loadSkillsCache).then(() => {
    syncSkillHintUI();
    _lastContextManifest = null;
    syncContextCounter();
  });
  pruneOrphanSummariesOnInit();   // résidus d'une suppression concurrente à une génération (avant le backfill, sinon liste faussée)
  runBackfill();         // auto-gardé sur la présence d'URL
  armIdleSummaryTimer(); // résumé sur inactivité, réarmé à chaque activité

  // L'UI est montée (.booted posée, sidebar décidée, thread rendu) : estompe
  // l'overlay de préchargement, en garantissant un temps d'affichage minimum
  // (finishBoot) pour laisser jouer le clignement même si tout est allé vite.
  // Les tâches async ci-dessus (prefetch/reconnect/skills) ne bloquent pas le
  // visuel — pas la peine de les attendre.
  finishBoot();
}

if (typeof __TEST_ENV__ === 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}
