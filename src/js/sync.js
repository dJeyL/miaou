/* ── sync.js ─────────────────────────────────────────────────────────────────
   Synchronisation multi-onglets (lot J) via BroadcastChannel (API native,
   même origine + même navigateur, zéro dépendance). Deux sections :

   1. Noyau PUR (QuickJS-testable, dépendances injectées) : enveloppe de
      message, validation, routage déclaratif. Aucun effet de bord, aucune
      référence à `BroadcastChannel`/`window`.
   2. Adaptateur IMPUR (navigateur uniquement) : construction du canal,
      feature-detection, émission/réception. No-op silencieux si
      `BroadcastChannel` est absent (contexte `file://` de l'export G, ou
      navigateur ancien) — MIAOU se comporte exactement comme aujourd'hui.

   Contrat de placement dans le bundle : sync.js vient JUSTE APRÈS utils.js
   dans JS_ORDER (build.py ET tests/runner.py). Il n'utilise que des
   primitives ; storage.js/resources.js/main.js émettront en appelant
   `syncPost` (dépendance descendante, jamais l'inverse).

   Doctrine « broadcast post-commit » (candidat piège 24) : un émetteur ne
   diffuse JAMAIS avant que l'écriture soit durable — après `setItem` pour
   localStorage, sur `tx.oncomplete` pour une transaction IndexedDB (pas
   `req.onsuccess`). Câblé en J2, documenté ici pour mémoire.
   ──────────────────────────────────────────────────────────────────────────── */

// ── Noyau pur ────────────────────────────────────────────────────────────────

// Version de protocole. Un pair qui reçoit un `v` différent ignore le message
// (compatibilité ascendante : un onglet neuf ne casse pas un onglet ancien).
const SYNC_PROTOCOL_VERSION = 1;

// Nom du canal partagé. Une seule voie pour tous les signaux du lot J.
const SYNC_CHANNEL_NAME = 'miaou-sync';

// Liste FERMÉE des types de message (doctrine « closed lists over open-ended »).
// Tout type hors de cette liste est ignoré à la réception (forward-compat).
// L'ordre est indicatif ; la valeur est le type lui-même.
const SYNC_MESSAGE_TYPES = [
  'conv-updated',              // { convId, spaceId, reason? } — écriture conversation/résumé
  'conv-deleted',             // { convId, spaceId } — suppression conversation
  'space-changed',            // { spaceId } — création/renommage/suppression d'Espace
  'settings-updated',         // { keys } — réglages globaux modifiés
  'resources-updated',        // { ids, convId? } — écriture/suppression IndexedDB resources
  'skills-updated',           // { } — écriture/suppression IndexedDB skills (A4)
  'full-reload',              // { } — import/reset : rechargement franc
  'conv-opened',              // { convId, tabId } — soft-lock awareness
  'conv-closed',              // { convId, tabId } — fin de soft-lock / release
  'conv-generation-started',  // { convId, tabId } — readonly relay + heartbeat
  'conv-generation-ended',    // { convId, tabId } — fin de readonly relay
];

// Construit une enveloppe bien formée. `rand` injecté (déterminisme) n'est PAS
// utilisé ici (le tabId est déjà résolu par l'appelant) — l'enveloppe est un
// pur assemblage de champs. `payload` par défaut = objet vide (jamais
// `undefined`, pour un schéma stable à la réception).
function makeEnvelope(type, tabId, payload) {
  return {
    v: SYNC_PROTOCOL_VERSION,
    type: String(type),
    tabId: String(tabId),
    payload: (payload && typeof payload === 'object') ? payload : {},
  };
}

// Valide une enveloppe reçue. Renvoie l'enveloppe normalisée si conforme,
// sinon `null` (le récepteur ignore silencieusement). Critères :
//   - objet non nul,
//   - `v === SYNC_PROTOCOL_VERSION`,
//   - `type` dans la liste fermée,
//   - `tabId` chaîne non vide.
// `payload` manquant est toléré → objet vide (schéma stable).
function validateEnvelope(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.v !== SYNC_PROTOCOL_VERSION) return null;
  if (typeof obj.type !== 'string' || SYNC_MESSAGE_TYPES.indexOf(obj.type) === -1) return null;
  if (typeof obj.tabId !== 'string' || obj.tabId === '') return null;
  const payload = (obj.payload && typeof obj.payload === 'object') ? obj.payload : {};
  return { v: obj.v, type: obj.type, tabId: obj.tabId, payload: payload };
}

// Décide, sans effet de bord, ce que le récepteur doit faire d'une enveloppe
// VALIDE, étant donné un contexte `ctx` = { tabId, currentConvId, activeSpaceId }.
// Renvoie un objet-décision déclaratif `{ action, ... }` — l'exécution (re-render,
// invalidation, bandeau…) est faite par le câblage impur en J3+, à partir de
// cette décision. Cette séparation rend le routage testable sous QuickJS.
//
//   action:
//     'ignore-self'    — message émis par cet onglet (ne devrait pas arriver,
//                         BroadcastChannel ne boucle pas ; défense en profondeur).
//     'ignore'         — non pertinent pour l'état courant.
//     'rehydrate'      — la conv affichée a changé ailleurs → re-hydrater.
//     'render-list'    — une conv non affichée a changé → rafraîchir la liste.
//     'conv-gone'      — la conv affichée a été supprimée ailleurs.
//     'space-list'     — rafraîchir le sélecteur/liste d'Espaces.
//     'apply-settings' — relire+ré-appliquer les réglages listés.
//     'invalidate-resources' — purger le cache resources pour les ids donnés.
//     'reload-skills'  — recharger le cache skills.
//     'full-reload'    — rechargement franc de l'état applicatif.
//     'soft-lock'      — même conv ouverte ailleurs (awareness).
//     'soft-unlock'    — release soft-lock du tabId émetteur.
//     'readonly-on'    — génération démarrée ailleurs sur la conv affichée.
//     'readonly-off'   — génération terminée ailleurs.
//
// Le contexte porte aussi, pour les décisions liées à la conv, de quoi trancher
// « affichée ? » (convId === ctx.currentConvId) — l'herméticité de Space
// (piège 18) est laissée au câblage impur (il a accès à `spaceConvIds` et à la
// liste réelle des conversations), routeMessage ne fait que la présélection.
function routeMessage(env, ctx) {
  ctx = ctx || {};
  const p = env.payload || {};
  if (env.tabId && ctx.tabId && env.tabId === ctx.tabId) {
    return { action: 'ignore-self' };
  }
  const isDisplayed = p.convId != null && p.convId === ctx.currentConvId;
  switch (env.type) {
    case 'conv-updated':
      return isDisplayed
        ? { action: 'rehydrate', convId: p.convId, spaceId: p.spaceId, reason: p.reason || null }
        : { action: 'render-list', convId: p.convId, spaceId: p.spaceId };
    case 'conv-deleted':
      return isDisplayed
        ? { action: 'conv-gone', convId: p.convId }
        : { action: 'render-list', convId: p.convId, spaceId: p.spaceId };
    case 'space-changed':
      return { action: 'space-list', spaceId: p.spaceId };
    case 'settings-updated':
      return { action: 'apply-settings', keys: Array.isArray(p.keys) ? p.keys : [] };
    case 'resources-updated':
      return { action: 'invalidate-resources', ids: Array.isArray(p.ids) ? p.ids : [], convId: p.convId != null ? p.convId : null };
    case 'skills-updated':
      return { action: 'reload-skills' };
    case 'full-reload':
      return { action: 'full-reload' };
    case 'conv-opened':
      return isDisplayed
        ? { action: 'soft-lock', convId: p.convId, tabId: env.tabId }
        : { action: 'ignore' };
    case 'conv-closed':
      return { action: 'soft-unlock', convId: p.convId, tabId: env.tabId };
    case 'conv-generation-started':
      return isDisplayed
        ? { action: 'readonly-on', convId: p.convId, tabId: env.tabId }
        : { action: 'ignore' };
    case 'conv-generation-ended':
      return isDisplayed
        ? { action: 'readonly-off', convId: p.convId, tabId: env.tabId }
        : { action: 'ignore' };
    default:
      return { action: 'ignore' };
  }
}

// Génère un identifiant d'onglet depuis un `rand` injecté (testable, frère de
// generateResourceId/generateFileId). Jamais `Date.now()` seul (piège B1) :
// deux onglets ouverts dans la même milliseconde collisionneraient. Le préfixe
// distingue des ids de ressources.
function generateTabId(rand) {
  return 'tab_' + Math.floor((typeof rand === 'function' ? rand() : Math.random()) * 1e12).toString(36);
}

// ── Adaptateur impur (navigateur uniquement) ─────────────────────────────────
// Sous QuickJS, `BroadcastChannel` est absent : _syncChannel reste null, toutes
// les fonctions ci-dessous sont des no-op — le noyau pur ci-dessus reste seul
// testé. En navigateur sans BroadcastChannel (rare, ou `file://` à origine
// opaque selon le navigateur), même comportement : dégradation silencieuse.

let _syncChannel = null;      // instance BroadcastChannel, ou null (no-op)
let _syncTabId = null;        // id de cet onglet, résolu une fois à l'init
let _syncHandler = null;      // handler applicatif branché par syncOnMessage

// Id stable de cet onglet (résolu paresseusement à la première demande).
function syncTabId() {
  if (_syncTabId == null) _syncTabId = generateTabId(Math.random);
  return _syncTabId;
}

// Construit le canal si l'API est disponible. Idempotent. Enveloppé dans un
// try/catch : certains navigateurs lèvent à la construction en contexte
// d'origine opaque (`file://`) plutôt que d'exposer `undefined` — on retombe
// alors sur le no-op. Renvoie true si le canal est actif.
function initSyncChannel() {
  if (_syncChannel) return true;
  if (typeof BroadcastChannel === 'undefined') return false;
  try {
    _syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    _syncChannel.onmessage = _onSyncRawMessage;
    return true;
  } catch (e) {
    _syncChannel = null;
    return false;
  }
}

// Réception brute → validation pure → délégation au handler applicatif.
// BroadcastChannel ne renvoie jamais à l'émetteur ses propres messages ; on ne
// rajoute aucun self-loopback (checklist §7 du brief).
function _onSyncRawMessage(ev) {
  if (!_syncHandler) return;
  const env = validateEnvelope(ev && ev.data);
  if (!env) return;   // v/type inconnu → ignore silencieux
  try {
    _syncHandler(env);
  } catch (e) {
    // Un handler qui lève ne doit pas casser le canal des messages suivants.
    if (typeof console !== 'undefined' && console.error) console.error('[sync] handler error', e);
  }
}

// Émet un message sur le canal. No-op si le canal n'est pas actif. L'appelant
// est responsable de n'émettre qu'APRÈS que l'écriture soit durable (doctrine
// post-commit) — cette fonction ne connaît pas le store.
function syncPost(type, payload) {
  if (!_syncChannel) return;
  try {
    _syncChannel.postMessage(makeEnvelope(type, syncTabId(), payload));
  } catch (e) {
    if (typeof console !== 'undefined' && console.error) console.error('[sync] post error', e);
  }
}

// Branche le handler applicatif (un seul, remplacé si rappelé). Construit le
// canal au passage si besoin. Le handler reçoit une enveloppe VALIDÉE.
function syncOnMessage(handler) {
  _syncHandler = handler;
  initSyncChannel();
}
