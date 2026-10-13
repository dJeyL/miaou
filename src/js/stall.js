/* ── stall.js ──────────────────────────────────────────────────────────────
   Modale de silence : quand le flux d'une conversation RACINE se tait plus
   de STREAM_IDLE_TIMEOUT_MS, le chien de garde de streamCompletion (api.js)
   ne coupe plus d'office — il demande ici à l'utilisateur d'attendre ou
   d'abandonner. Trois parties :

   1. Purs (QuickJS-testables) : temps restant, formats, libellé de ligne,
      pairs en attente.
   2. La modale : un `<dialog>` natif ouvert par showModal() — le reste de la
      page devient inerte, le focus y est piégé, et le top layer échappe aux
      contextes d'empilement (.topbar). Une LIGNE par conversation bloquée,
      chacune avec son compte à rebours ; la modale se re-rend quand une ligne
      arrive ou part, et se ferme quand il n'en reste plus.
   3. L'attention entre fenêtres : une modale ouverte dans une fenêtre sans
      focus allume le point de l'icône d'application (syncAppBadge, pwa.js).
      La pastille est unique pour l'appli mais recalculée par CHAQUE fenêtre :
      l'état est donc diffusé (`stall-attention`, avec heartbeat et TTL), sans
      quoi une fenêtre sans modale l'éteindrait à sa prochaine repeinture.

   Le plafond (STALL_CEILING_PERIODS, storage.js) est la borne dure : une
   ligne sans réponse abandonne d'elle-même. Tant que l'utilisateur répond,
   « Attendre » n'est limité en rien. Cf. docs/pitfalls-detail.md (piège 10).
   ────────────────────────────────────────────────────────────────────────── */

// ── Purs ────────────────────────────────────────────────────────────────────

// Temps restant avant l'abandon automatique d'une ligne apparue à `shownAt`.
function stallRowRemainingMs(shownAt, now, periodMs, ceiling) {
  return Math.max(0, shownAt + periodMs * ceiling - now);
}

// Compte à rebours en m:ss (arrondi au-dessus : « 0:00 » ne s'affiche qu'à
// l'échéance même).
function formatStallCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// Durée de silence lisible : « 45 s », « 1 min 30 s », « 2 min ».
function formatStallDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (!m) return s + '\u00a0s';
  return s ? m + '\u00a0min ' + s + '\u00a0s' : m + '\u00a0min';
}

// Libellé d'une ligne : le titre de la conversation (prédicat convLabel,
// jamais `conv.title` nu) et, si elle vit dans un AUTRE Espace que l'actif, le
// nom de celui-ci. Exception sanctionnée à l'herméticité des Spaces (piège 18),
// au même titre que les toasts menant à une conversation : la modale bloque
// toute l'interface, elle doit dire QUELLE conversation attend, où qu'elle soit.
function stallRowLabel(conv, activeSpace, spaces) {
  const title = (conv && convLabel(conv).text) || 'Nouvelle conversation';
  const spaceId = (conv && conv.spaceId) || DEFAULT_SPACE_ID;
  if (spaceId === activeSpace) return { title: title, space: '' };
  const sp = (spaces || []).find(function (x) { return x && x.id === spaceId; });
  return { title: title, space: (sp && sp.name) || 'Autre espace' };
}

// Un pair au moins signale-t-il une modale en attente, heartbeat encore frais ?
function stallPeersWaiting(peers, now, ttlMs) {
  for (const tabId in peers) {
    if (now - peers[tabId] <= ttlMs) return true;
  }
  return false;
}

// ── La modale ───────────────────────────────────────────────────────────────

// convId → { convId, shownAt, silentMs, resolve, timer }. Une génération par
// conversation (registre clé par convId), un stream en vol par génération :
// une ligne au plus par conversation.
const _stallRows = new Map();
let _stallTicker = null;

// Hooks de la question pour une génération, ou null si elle ne doit jamais la
// poser. Seules les conversations RACINES : un agent n'a pas d'utilisateur
// devant lui, il attend en silence jusqu'au plafond (api.js). Le prédicat est
// isRootConversation, jamais un test de champ réécrit ici.
function stallHooksFor(gen) {
  const conv = gen && loadConversation(gen.convId);
  if (!conv || !isRootConversation(conv)) return null;
  const convId = gen.convId;
  return {
    onStall: function (info) { return openStallRow(convId, info); },
    onStallEnd: function () { dropStallRow(convId); },
  };
}

function openStallRow(convId, info) {
  return new Promise(function (resolve) {
    // Une ligne restée là (ne devrait pas arriver : la question précédente est
    // close avant d'en poser une autre) est remplacée, sa promesse soldée.
    const prev = _stallRows.get(convId);
    if (prev) { clearTimeout(prev.timer); prev.resolve('wait'); }
    // Plafond : un minuteur, pas le tick d'affichage — l'échéance ne dépend
    // pas d'un rendu, et les verify la raccourcissent comme le chien de garde
    // (interception de setTimeout sur la durée vivante).
    const timer = setTimeout(function () { answerStallRow(convId, 'abort'); },
      STREAM_IDLE_TIMEOUT_MS * STALL_CEILING_PERIODS);
    _stallRows.set(convId, {
      convId: convId,
      shownAt: Date.now(),
      silentMs: (info && info.silentMs) || STREAM_IDLE_TIMEOUT_MS,
      resolve: resolve,
      timer: timer,
    });
    renderStallDialog();
  });
}

// Réponse de l'utilisateur (ou du plafond) pour une ligne.
function answerStallRow(convId, choice) {
  const row = _stallRows.get(convId);
  if (!row) return;
  _stallRows.delete(convId);
  clearTimeout(row.timer);
  row.resolve(choice);
  renderStallDialog();
}

// Ligne devenue sans objet (flux reparti, stream terminé) : retirée sans
// réponse. La promesse est soldée pour ne rien laisser pendre ; api.js ignore
// toute réponse qui arrive après la fin de la question.
function dropStallRow(convId) {
  const row = _stallRows.get(convId);
  if (!row) return;
  _stallRows.delete(convId);
  clearTimeout(row.timer);
  row.resolve('wait');
  renderStallDialog();
}

function onStallWaitAll() {
  Array.from(_stallRows.keys()).forEach(function (id) { answerStallRow(id, 'wait'); });
}

function stallDialogEl() {
  return typeof document !== 'undefined' ? document.getElementById('stall-dialog') : null;
}

// Re-rend la liste des lignes (arrivée ou départ d'une ligne), ouvre ou ferme
// la modale. Le compte à rebours est mis à jour à part (tickStallDialog), sans
// reconstruire : un re-rendu par seconde volerait le focus.
function renderStallDialog() {
  const dlg = stallDialogEl();
  if (dlg) {
    const list = dlg.querySelector('.stall-rows');
    // Focus à reposer sur le même bouton après reconstruction, s'il existe encore.
    const focused = document.activeElement && dlg.contains(document.activeElement)
      ? { conv: document.activeElement.dataset.conv, act: document.activeElement.dataset.act }
      : null;
    list.textContent = '';
    const spaces = loadSpaces();
    for (const row of _stallRows.values()) {
      const lbl = stallRowLabel(loadConversation(row.convId), activeSpaceId, spaces);
      const li = document.createElement('li');
      li.className = 'stall-row';
      li.dataset.conv = row.convId;
      const head = document.createElement('div');
      head.className = 'stall-row-head';
      const title = document.createElement('span');
      title.className = 'stall-row-title';
      title.textContent = lbl.title;   // titre d'origine modèle : jamais en innerHTML
      head.appendChild(title);
      if (lbl.space) {
        const sp = document.createElement('span');
        sp.className = 'stall-row-space';
        sp.textContent = 'Espace «\u00a0' + lbl.space + '\u00a0»';
        head.appendChild(sp);
      }
      const status = document.createElement('div');
      status.className = 'stall-row-status';
      const actions = document.createElement('div');
      actions.className = 'stall-row-actions';
      [['wait', 'Attendre', 'mb-btn primary'], ['abort', 'Abandonner', 'mb-btn']].forEach(function (b) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = b[2];
        btn.textContent = b[1];
        btn.dataset.conv = row.convId;
        btn.dataset.act = b[0];
        btn.addEventListener('click', function () { answerStallRow(row.convId, b[0]); });
        actions.appendChild(btn);
      });
      li.appendChild(head);
      li.appendChild(status);
      li.appendChild(actions);
      list.appendChild(li);
    }
    tickStallDialog();
    if (_stallRows.size) {
      if (!dlg.open) dlg.showModal();
      const again = focused && list.querySelector('button[data-conv="' + cssEscapeAttr(focused.conv) + '"][data-act="' + focused.act + '"]');
      const target = again || list.querySelector('button[data-act="wait"]');
      if (target) target.focus();
    } else if (dlg.open) {
      dlg.close();
    }
  }
  if (_stallRows.size && !_stallTicker) _stallTicker = setInterval(tickStallDialog, 1000);
  if (!_stallRows.size && _stallTicker) { clearInterval(_stallTicker); _stallTicker = null; }
  syncStallAttention();
}

// Valeur d'attribut sûre dans un sélecteur (les ids de conversation sont nos
// propres ids, mais on ne parie pas dessus).
function cssEscapeAttr(v) {
  return String(v == null ? '' : v).replace(/["\\]/g, '\\$&');
}

// Chaque seconde : silence et compte à rebours de chaque ligne. Affichage
// seulement — l'échéance elle-même est le minuteur posé par openStallRow.
function tickStallDialog() {
  const now = Date.now();
  const dlg = stallDialogEl();
  for (const row of _stallRows.values()) {
    const left = stallRowRemainingMs(row.shownAt, now, STREAM_IDLE_TIMEOUT_MS, STALL_CEILING_PERIODS);
    const li = dlg && dlg.querySelector('.stall-row[data-conv="' + cssEscapeAttr(row.convId) + '"] .stall-row-status');
    if (li) {
      li.textContent = 'Rien reçu depuis ' + formatStallDuration(row.silentMs + now - row.shownAt)
        + ' · abandon automatique dans ' + formatStallCountdown(left);
    }
  }
}

// Câblage de la modale (init, main.js). Escape vaut « Attendre » pour toutes
// les lignes. Les touches ne sortent pas de la modale : sans ce barrage, les
// raccourcis globaux (Cmd/Ctrl+K, Ctrl+N, l'Escape des drawers) agiraient
// sous la modale, en contradiction avec « rien d'autre que répondre ».
function initStallDialog() {
  const dlg = stallDialogEl();
  if (!dlg) return;
  dlg.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onStallWaitAll(); }
  });
  // Filet : un `cancel` qui passerait quand même (geste système de fermeture).
  dlg.addEventListener('cancel', function (e) { e.preventDefault(); onStallWaitAll(); });
  window.addEventListener('focus', syncStallAttention);
  window.addEventListener('blur', syncStallAttention);
  window.addEventListener('pagehide', function () {
    if (_stallAttentionPosted) syncPost('stall-attention', { on: false });
  });
}

// ── Attention entre fenêtres ────────────────────────────────────────────────

let _stallAttentionPosted = false;   // dernier état diffusé par CETTE fenêtre
let _stallAttentionBeat = null;      // heartbeat tant qu'il est vrai
const _stallPeers = {};              // tabId → epoch ms du dernier signal « en attente »
let _stallPeerSweep = null;

// Cette fenêtre a-t-elle une modale ouverte que personne ne regarde ?
function localStallNeedsAttention() {
  return _stallRows.size > 0 && !windowHasFocus();
}

// Une modale en attente quelque part (ici ou chez un pair) : lu par
// syncAppBadge (pwa.js), qui allume le même point que pour le non-lu.
function stallAttentionLit() {
  return localStallNeedsAttention() || stallPeersWaiting(_stallPeers, Date.now(), SYNC_HEARTBEAT_TTL_MS);
}

function syncStallAttention() {
  const on = localStallNeedsAttention();
  if (on !== _stallAttentionPosted) {
    _stallAttentionPosted = on;
    syncPost('stall-attention', { on: on });
    if (on && !_stallAttentionBeat) {
      _stallAttentionBeat = setInterval(function () { syncPost('stall-attention', { on: true }); }, SYNC_HEARTBEAT_MS);
    } else if (!on && _stallAttentionBeat) {
      clearInterval(_stallAttentionBeat); _stallAttentionBeat = null;
    }
  }
  if (typeof syncAppBadge === 'function') syncAppBadge();
}

// Réception (applySyncDecision, multitab.js). Le TTL couvre l'onglet qui meurt
// sans dire au revoir : sans lui, la pastille resterait allumée à jamais.
function applyPeerStallAttention(tabId, on) {
  if (!tabId) return;
  if (on) _stallPeers[tabId] = Date.now();
  else delete _stallPeers[tabId];
  if (Object.keys(_stallPeers).length && !_stallPeerSweep) {
    _stallPeerSweep = setInterval(function () {
      const now = Date.now();
      for (const id in _stallPeers) {
        if (now - _stallPeers[id] > SYNC_HEARTBEAT_TTL_MS) delete _stallPeers[id];
      }
      if (!Object.keys(_stallPeers).length) { clearInterval(_stallPeerSweep); _stallPeerSweep = null; }
      if (typeof syncAppBadge === 'function') syncAppBadge();
    }, SYNC_HEARTBEAT_MS);
  }
  if (typeof syncAppBadge === 'function') syncAppBadge();
}
