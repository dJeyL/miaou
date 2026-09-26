// ── toasts.js ─────────────────────────────────────────────────────────────────
// Composant toast (lot AG) : annonce ponctuelle d'un FRONT survenu là où
// l'utilisateur ne regarde pas — pose d'un état (stockage plein), panne ou
// retour d'un service, échec d'une action lancée plus tôt. L'état durable reste
// sur sa surface passive (chat, pastilles) : un toast n'en porte jamais
// (décision D1). Spécification : docs/toasts.md.
//
// Ce fichier ne décide de rien : la file, les durées et le placement sont les
// purs de utils.js (`toastQueueUpsert`, `toastDurationMs`, `toastPlacement`).
// Il les applique au DOM, tient les minuteurs et observe la mise en page.
// ─────────────────────────────────────────────────────────────────────────────

// Table FERMÉE thème → glyphe, déclarée une fois : un site d'appel choisit un
// thème, jamais un dessin. Aucun glyphe n'est nouveau — chacun reprend celui
// qui dit déjà la même chose dans l'interface (une métaphore = un usage) :
//   storage   — cylindre de la catégorie « Données » des réglages (index.html)
//   services  — prise de la catégorie « Connexion » des réglages (index.html)
//   agents    — ICON_AGENT (acks.js), le robot du bandeau d'agent
//   clipboard — le glyphe des boutons « Copier » (ui.js)
//   export    — le glyphe du bouton d'export de conversation (index.html)
//   files     — l'onglet « Fichiers » de la sidebar (index.html)
//   summary   — la bulle du bandeau de résumés liés (index.html)
// Les tracés sont recopiés : ceux d'index.html sont du markup statique, non
// adressables depuis ici. Retoucher l'un sans l'autre les ferait diverger.
const TOAST_GLYPHS = {
  storage:   '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C7 2 3 3.34 3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5c0-1.66-4-3-9-3zm0 2c4.42 0 7 1.07 7 1.5S16.42 7 12 7 5 5.93 5 5.5 7.58 4 12 4zM5 8.02C6.4 8.63 9 9 12 9s5.6-.37 7-.98v3.46c0 .43-2.58 1.5-7 1.5s-7-1.07-7-1.5V8.02zm0 5.48c1.4.61 4 .98 7 .98s5.6-.37 7-.98v3.46c0 .43-2.58 1.5-7 1.5s-7-1.07-7-1.5v-3.46zm0 5.48c1.4.61 4 .98 7 .98s5.6-.37 7-.98V19c0 .43-2.58 1.5-7 1.5S5 19.43 5 19v-.02z"/></svg>',
  services:  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 3a1 1 0 0 1 2 0v6H7V3zm8 0a1 1 0 0 1 2 0v6h-2V3zM6 8h12a1 1 0 0 1 1 1v2a7 7 0 0 1-6 6.93V21a1 1 0 1 1-2 0v-3.07A7 7 0 0 1 5 11V9a1 1 0 0 1 1-1z"/></svg>',
  agents:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 13h.01M15 13h.01M9 17h6"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  export:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  files:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7"/></svg>',
  summary:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
};

const TOAST_CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const TOAST_CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

// Durée de la transition de sortie (toasts.css). Le retrait du DOM est armé sur
// un minuteur de cette durée, JAMAIS sur `transitionend` : sous le kill-switch
// de mouvement la transition dure 0.01ms, mais un élément retiré ou masqué
// avant qu'elle parte n'émet rien, et le toast resterait dans le DOM.
const TOAST_LEAVE_MS = 180;

// File courante (objets purs { key, level }) et état vivant par clé.
let _toastList = [];
const _toastLive = new Map();   // key → { el, timer, remaining, startedAt, paused }
let _toastLayoutWired = false;

// Affiche (ou remplace, par sa clé) un toast.
//   opts = { key, level: 'info'|'warn'|'error', theme, text, action?, persistent? }
//   action = { label, run } : le clic sur le corps appelle `run()`, puis ferme.
// `text` et `action.label` sont posés en textContent, jamais en HTML : ils
// citent des noms de conversation ou des messages d'erreur venus d'ailleurs.
// Ne vole JAMAIS le focus (D10) : la frappe dans le composer continue.
function showToast(opts) {
  // Hors d'un vrai navigateur (tests QuickJS : DOM factice, pas de
  // requestAnimationFrame), un émetteur appelé par du code testé ne fait rien.
  if (typeof requestAnimationFrame !== 'function') return;
  const host = document.getElementById('toasts');
  if (!host || !opts || !opts.key) return;
  wireToastLayout();
  const item = { key: String(opts.key), level: opts.level === 'error' || opts.level === 'warn' ? opts.level : 'info' };
  const res = toastQueueUpsert(_toastList, item, TOAST_MAX_VISIBLE);
  _toastList = res.list;
  const old = _toastLive.get(item.key);
  if (old) removeToastNode(item.key, false);
  res.removed.forEach(function(k) { removeToastNode(k, true); });
  if (!_toastList.some(function(t) { return t.key === item.key; })) return;   // arrivant évincé (S6)

  const el = buildToastEl(item, opts);
  host.appendChild(el);   // le plus récent en bas, contre l'ancre (option B)
  const live = { el: el, timer: null, remaining: toastDurationMs(item.level, opts.persistent === true), startedAt: 0, paused: false };
  _toastLive.set(item.key, live);
  host.hidden = false;
  layoutToasts();
  // Entrée au frame suivant : la classe posée dans le même frame que l'insertion
  // ne déclencherait aucune transition.
  requestAnimationFrame(function() { el.classList.add('toast-in'); });
  armToastTimer(item.key);
}

function dismissToast(key) {
  const k = String(key);
  if (!_toastLive.has(k)) return;
  _toastList = toastQueueRemove(_toastList, k);
  removeToastNode(k, true);
}

function buildToastEl(item, opts) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.level = item.level;
  el.dataset.key = item.key;
  // Rôle par niveau (D10) : une erreur interrompt le lecteur d'écran, le reste
  // attend son tour.
  el.setAttribute('role', item.level === 'error' ? 'alert' : 'status');
  const action = opts.action && typeof opts.action.run === 'function' ? opts.action : null;
  const body = document.createElement(action ? 'button' : 'div');
  body.className = 'toast-body';
  if (action) {
    body.type = 'button';
    el.classList.add('has-action');
    body.addEventListener('click', function() {
      dismissToast(item.key);
      try { action.run(); } catch (e) { console.error('[miaou] action de toast', e); }
    });
  }
  const glyph = document.createElement('span');
  glyph.className = 'toast-glyph';
  glyph.innerHTML = TOAST_GLYPHS[opts.theme] || TOAST_GLYPHS.services;
  const main = document.createElement('span');
  main.className = 'toast-main';
  const text = document.createElement('span');
  text.className = 'toast-text';
  text.textContent = String(opts.text || '');
  main.appendChild(text);
  if (action && action.label) {
    const line = document.createElement('span');
    line.className = 'toast-action';
    const lbl = document.createElement('span');
    lbl.textContent = String(action.label);
    line.appendChild(lbl);
    line.insertAdjacentHTML('beforeend', TOAST_CHEVRON_SVG);
    main.appendChild(line);
  }
  body.appendChild(glyph);
  body.appendChild(main);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-x';
  close.setAttribute('aria-label', 'Fermer la notification');   // d'auteur, AVANT setTip
  close.innerHTML = TOAST_CLOSE_SVG;
  setTip(close, 'Fermer');
  close.addEventListener('click', function() { dismissToast(item.key); });
  el.appendChild(body);
  el.appendChild(close);
  // Minuteur en pause au survol ET au focus (D9, WCAG 2.2.1) : lire un toast au
  // clavier ne doit pas être une course.
  el.addEventListener('mouseenter', function() { pauseToastTimer(item.key); });
  el.addEventListener('mouseleave', function() { if (!el.contains(document.activeElement)) resumeToastTimer(item.key); });
  el.addEventListener('focusin', function() { pauseToastTimer(item.key); });
  el.addEventListener('focusout', function(e) {
    if (!el.contains(e.relatedTarget) && !el.matches(':hover')) resumeToastTimer(item.key);
  });
  return el;
}

function armToastTimer(key) {
  const live = _toastLive.get(key);
  if (!live || live.remaining == null || live.paused) return;
  live.startedAt = Date.now();
  live.timer = setTimeout(function() { dismissToast(key); }, live.remaining);
}

function pauseToastTimer(key) {
  const live = _toastLive.get(key);
  if (!live || live.paused) return;
  live.paused = true;
  if (live.timer) {
    clearTimeout(live.timer);
    live.timer = null;
    live.remaining = Math.max(0, live.remaining - (Date.now() - live.startedAt));
  }
}

function resumeToastTimer(key) {
  const live = _toastLive.get(key);
  if (!live || !live.paused) return;
  live.paused = false;
  // Un reliquat trop court se lirait comme une disparition sous le curseur qui
  // vient de partir : on laisse au moins une seconde et demie.
  if (live.remaining != null) live.remaining = Math.max(live.remaining, 1500);
  armToastTimer(key);
}

// Retire le nœud d'un toast. `animate` faux pour un remplacement par clé :
// l'ancien s'efface d'un coup, le nouveau fait l'entrée.
function removeToastNode(key, animate) {
  const live = _toastLive.get(key);
  if (!live) return;
  _toastLive.delete(key);
  if (live.timer) clearTimeout(live.timer);
  const el = live.el;
  const done = function() {
    if (el.parentNode) el.parentNode.removeChild(el);
    const host = document.getElementById('toasts');
    if (host && !_toastLive.size) host.hidden = true;
  };
  if (!animate) { done(); return; }
  el.classList.remove('toast-in');
  el.classList.add('toast-leaving');
  setTimeout(done, TOAST_LEAVE_MS);
}

// ── Placement (D7, S7) ────────────────────────────────────────────────────────
// Mesuré à chaque changement de mise en page qui peut le déplacer : fenêtre
// redimensionnée, zone composer qui change de taille (sidebar ouverte ou
// fermée, cran de colonne), drawer ouvert ou fermé. Rien n'est déduit d'un
// breakpoint : la place à droite du composer dépend de la sidebar et de --col.
function layoutToasts() {
  const host = document.getElementById('toasts');
  if (!host || host.hidden) return;
  const inset = 16;
  const toastW = host.offsetWidth || 300;
  const input = document.querySelector('.composer .input-wrap');
  const composer = document.querySelector('.composer');
  const inputRect = input && input.offsetParent !== null ? input.getBoundingClientRect() : null;
  const composerRect = composer ? composer.getBoundingClientRect() : null;
  // Drawer ouvert : `.drawer.show`. offsetWidth ignore la translation d'entrée,
  // donc la largeur est juste dès l'ouverture, transition en cours comprise.
  let drawerW = 0;
  document.querySelectorAll('.drawer.show').forEach(function(d) { drawerW = Math.max(drawerW, d.offsetWidth); });
  const p = toastPlacement({
    vw: window.innerWidth,
    vh: window.innerHeight,
    inputRight: inputRect ? inputRect.right : null,
    inputBottom: inputRect ? inputRect.bottom : null,
    composerTop: composerRect ? composerRect.top : null,
    drawerW: drawerW,
    toastW: toastW,
    inset: inset,
  });
  host.style.right = p.right + 'px';
  host.style.bottom = p.bottom + 'px';
  host.dataset.placement = p.mode;
}

function wireToastLayout() {
  if (_toastLayoutWired) return;
  _toastLayoutWired = true;
  window.addEventListener('resize', layoutToasts);
  const composer = document.querySelector('.composer');
  if (composer && typeof ResizeObserver === 'function') {
    new ResizeObserver(function() { layoutToasts(); }).observe(composer);
  }
  // Ouverture/fermeture d'un drawer : la classe `show` bascule sur l'élément.
  // Un observateur d'attribut plutôt qu'un appel dans chaque open*/close* : ils
  // sont une dizaine, et un drawer ajouté plus tard serait oublié.
  if (typeof MutationObserver === 'function') {
    const mo = new MutationObserver(function() { layoutToasts(); });
    document.querySelectorAll('.drawer').forEach(function(d) {
      mo.observe(d, { attributes: true, attributeFilter: ['class'] });
    });
  }
}

// ── Branchements (lot AG, étape 4) ────────────────────────────────────────────
// Les textes des toasts vivent ici, un émetteur par événement : les sites
// d'appel disent QUOI s'est passé, jamais comment l'annoncer. Espaces
// insécables après « et avant », et avant « : » (typographie française : la
// ponctuation ne doit jamais ouvrir une ligne).
const NBSP = ' ';
function quoted(s) { return '«' + NBSP + String(s || '') + NBSP + '»'; }

// Réglages → catégorie « Données » : cible des deux toasts de quota.
function goToDataSettings() { openSettingsCategory('donnees'); }

// Front de l'état « stockage plein » (setStorageFull, storage.js) — dans CHAQUE
// onglet, y compris le pair qui reçoit `storage-state` (décision S3) : le quota
// concerne tout le monde. Émis au front seulement ; un onglet déjà plein ne le
// réaffiche pas. La levée retire le toast : l'état qu'il annonçait n'est plus.
function toastStorageFront(front) {
  if (front === 'set') {
    showToast({ key: 'storage-quota', level: 'error', theme: 'storage', persistent: true,
      text: 'Stockage plein' + NBSP + ': les dernières modifications ne sont pas enregistrées. Supprimer des conversations ou des fichiers libère de la place.',
      action: { label: 'Réglages › Données', run: goToDataSettings } });
  } else if (front === 'cleared') {
    dismissToast('storage-quota');
  }
}

// Quota localStorage (décision S2) : toast seul, sans état ni levée — son quota
// est distinct de celui d'IndexedDB, supprimer une conversation ne le soulage
// pas. Réaffiché à chaque écriture refusée (remplacé par sa clé).
function toastLocalQuota() {
  showToast({ key: 'local-quota', level: 'error', theme: 'storage', persistent: true,
    text: 'Stockage des réglages plein' + NBSP + ': la dernière modification (réglages, souvenirs, espaces ou serveurs) n\'a pas été enregistrée.',
    action: { label: 'Réglages › Données', run: goToDataSettings } });
}

function toastTitleOf(convId) {
  const conv = typeof loadConversation === 'function' ? loadConversation(convId) : null;
  const label = conv ? convLabel(conv).text : '';
  return label ? quoted(label) : 'une conversation';
}

// `persistGeneration` refusé par la garde anti-troncature (main.js) : le tour
// qui vient d'être généré n'est PAS enregistré. Pas de clic : il n'y a rien à
// aller voir, la conversation en base est intacte.
function toastTruncateRefused(convId) {
  showToast({ key: 'truncate:' + convId, level: 'error', theme: 'storage', persistent: true,
    text: 'La dernière réponse de ' + toastTitleOf(convId) + ' n\'a pas été enregistrée, pour ne pas écraser son historique.' });
}

// Réveil du parent échoué (main.js, agents.js) : le résultat d'un agent attend
// dans une conversation qui ne repartira pas seule. Le clic y mène, Espace
// compris (troisième exception sanctionnée au piège 18, décision S5).
function toastWakeFailed(parentId, err) {
  console.warn('[miaou] réveil du parent échoué :', (err && err.message) || err);
  const parent = typeof loadConversation === 'function' ? loadConversation(parentId) : null;
  showToast({ key: 'wake:' + parentId, level: 'error', theme: 'agents', persistent: true,
    text: 'Le résultat d\'un agent n\'a pas pu être remis à ' + toastTitleOf(parentId) + '.',
    action: parent ? { label: 'Ouvrir la conversation', run: function() { gotoAgentInventoryRow(parent); } } : null });
}

function toastExportFailed(convId) {
  showToast({ key: 'export:' + (convId || ''), level: 'warn', theme: 'export',
    text: 'L\'export HTML de cette conversation a échoué.' });
}

function toastRenameFailed(name) {
  showToast({ key: 'rename:' + name, level: 'warn', theme: 'files',
    text: 'Renommage de ' + quoted(name) + ' impossible' + NBSP + ': le stockage l\'a refusé.' });
}

// Presse-papier refusé (permission, page sans focus) : les trois boutons
// « Copier » passent ici plutôt que de laisser leur promesse rejeter en silence.
function toastCopyFailed() {
  showToast({ key: 'clipboard', level: 'warn', theme: 'clipboard',
    text: 'Copie refusée par le navigateur.' });
}

// Résumé automatique raté (main.js) : à CHAQUE échec (décision S4), clé par
// conversation. À réévaluer si ça se révèle bruyant.
function toastSummaryFailed(convId) {
  showToast({ key: 'summary:' + convId, level: 'warn', theme: 'summary',
    text: 'Le résumé automatique de ' + toastTitleOf(convId) + ' a échoué' + NBSP + '; il sera retenté.' });
}

// ── Fronts de santé des services ─────────────────────────────────────────────
// Appelé aux DEUX synchros de santé (syncConnDot, syncAuthorizationPending) ;
// le pur `healthFronts` décide, ceci n'applique que ses événements. Le premier
// appel (instantané nul) vaut démarrage : un backend déjà mort est un front.
let _healthSnapshot = null;

function currentHealthSnapshot() {
  const server = activeApiServer();
  const backend = server ? {
    id: server.id,
    name: server.name || server.url || '',
    health: resolveBackendHealth(activeApiConfig(), REQUIRE_API_KEY, _backendProbe),
  } : null;
  const mcp = {};
  const statuses = mcpStatusSnapshot() || {};
  Object.keys(statuses).forEach(function(name) {
    const st = statuses[name] || {};
    if (st.state === 'error') mcp[name] = 'error';
    else if (st.state === 'ok') mcp[name] = (st.unauthorizedUpstreams && st.unauthorizedUpstreams.length) ? 'pending' : 'ok';
    else mcp[name] = 'connecting';
  });
  return { backend: backend, mcp: mcp };
}

function syncHealthToasts() {
  const res = healthFronts(_healthSnapshot, currentHealthSnapshot());
  _healthSnapshot = res.snapshot;
  res.events.forEach(function(ev) {
    if (ev.op === 'dismiss') { dismissToast(ev.key); return; }
    const isBackend = ev.kind === 'backend';
    const what = (isBackend ? 'serveur API ' : 'serveur MCP ') + quoted(ev.name);
    if (ev.level === 'error') {
      showToast({ key: ev.key, level: 'error', theme: 'services',
        text: 'Le ' + what + ' ne répond plus.',
        action: { label: isBackend ? 'Serveurs API' : 'Serveurs MCP', run: isBackend ? openApiServers : openMcpServers } });
    } else {
      showToast({ key: ev.key, level: 'info', theme: 'services',
        text: what.charAt(0).toUpperCase() + what.slice(1) + ' rétabli.' });
    }
  });
}
