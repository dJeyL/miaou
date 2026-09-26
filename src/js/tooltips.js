// ── tooltips.js ───────────────────────────────────────────────────────────────
// Infobulles MIAOU (lot AH) : remplacent le `title` natif, qui ne se montre
// jamais au clavier, ne se rafraîchit pas quand on le réécrit sous le pointeur
// et dont l'apparence dépend du système.
//
// Porteur = tout élément à `data-tip` non vide (+ `data-tip-detail` pour un
// second étage). Trois voies d'entrée, une seule règle (`tipAriaRule`, utils.js) :
//   - `setTip(el, tip)` / `getTip(el)` pour tout porteur écrit en JS ;
//   - `tipAttrs(tip, opts)` (utils.js) dans les gabarits ;
//   - `data-tip="…"` dans index.html, repris par `initTooltips`.
//
// Ce fichier ne décide de rien : délais, placement et attributs ARIA sont les
// purs de utils.js. Il tient une bulle unique montée sur `body` (la topbar
// isole les z-index, et un `contain: paint` couperait une bulle montée dans
// son porteur), des listeners délégués sur `document`, et les minuteurs.
// ─────────────────────────────────────────────────────────────────────────────

// Période de la vérification du porteur pendant qu'une bulle est affichée :
// retiré du DOM (re-rendu de la sidebar par la synchro), masqué, ou vidé.
const TIP_WATCH_MS = 150;

let _tipEl = null;          // la bulle, créée à la demande
let _tipOwner = null;       // porteur de la bulle affichée
let _tipHover = null;       // porteur sous le pointeur (distinct : réaffichage)
let _tipShowTimer = null;
let _tipPending = null;     // porteur dont l'affichage attend son délai
let _tipWatchTimer = null;
let _tipLastHideAt = null;
let _tipWired = false;

// ── Point d'écriture unique ───────────────────────────────────────────────────

// Lit l'infobulle d'un porteur sous la forme que `setTip` accepte : chaîne
// pour un étage, { label, detail } pour deux, '' si aucune. C'est ce qu'un
// code qui mémorise puis restaure une infobulle doit lire.
function getTip(el) {
  if (!el || typeof el.getAttribute !== 'function') return '';
  const label = el.getAttribute('data-tip') || '';
  const detail = el.getAttribute('data-tip-detail') || '';
  if (!label) return '';
  return detail ? { label: label, detail: detail } : label;
}

// Pose (ou retire, texte vide) l'infobulle d'un porteur, ARIA compris. Si la
// bulle est affichée sur `el`, son texte suit en place ; si elle a été masquée
// (clic) alors que le pointeur est toujours sur `el`, elle se réaffiche avec le
// nouveau texte — c'est ce qui rend visible l'armement d'une suppression.
function setTip(el, tip) {
  if (!el || typeof el.setAttribute !== 'function') return;
  applyTipAttributes(el, tip);
  if (!normalizeTip(tip)) {
    if (el === _tipOwner) hideTip();
    return;
  }
  if (el === _tipOwner && tipIsVisible()) { renderTip(); return; }
  if (el === _tipHover && el.isConnected) {
    cancelTipTimer();
    showTipNow(el);
  }
}

// Re-applique la règle ARIA à un porteur dont le TEXTE VISIBLE a changé après
// la pose de son infobulle, sans toucher à la bulle (contrairement à setTip, qui
// réafficherait sous le pointeur). Cas d'un libellé rempli plus tard :
// `#agent-count` est vide au démarrage, et l'aria-label posé alors masquerait
// le compte pour toujours.
function refreshTipAria(el) {
  if (!el || typeof el.getAttribute !== 'function') return;
  const tip = getTip(el);
  if (tip) applyTipAttributes(el, tip);
}

// Texte visible d'un porteur, pour la règle ARIA : ce que son contenu lui
// donne déjà comme nom. Une image se nomme par son `alt` : sans lui, la règle
// y poserait un aria-label (« Agrandir ») qui remplacerait la description de
// l'image — le natif, lui, gardait l'alt pour nom et le title en description.
// La règle lit ce texte AU MOMENT de l'appel : poser l'infobulle APRÈS le
// contenu et l'aria-label d'auteur, jamais avant.
function tipCarrierText(el) {
  if (el.tagName === 'IMG') return String(el.getAttribute('alt') || '').trim();
  return String(el.textContent || '').replace(/\s+/g, ' ').trim();
}

// Écrit les attributs d'un porteur. N'efface que ce que la règle avait posé
// (marqué par `data-tip-aria`) : un aria-label d'auteur n'est jamais touché.
function applyTipAttributes(el, tip) {
  const t = normalizeTip(tip);
  const mark = el.getAttribute('data-tip-aria');
  if (mark === 'label') el.removeAttribute('aria-label');
  else if (mark === 'description') el.removeAttribute('aria-description');
  el.removeAttribute('data-tip-aria');
  if (!t) {
    el.removeAttribute('data-tip');
    el.removeAttribute('data-tip-detail');
    return;
  }
  el.setAttribute('data-tip', t.label);
  if (t.detail) el.setAttribute('data-tip-detail', t.detail);
  else el.removeAttribute('data-tip-detail');
  const aria = tipAriaRule(t, { text: tipCarrierText(el), ariaLabel: el.getAttribute('aria-label') || '' });
  if (aria.kind === 'label') el.setAttribute('aria-label', aria.text);
  else if (aria.kind === 'description') el.setAttribute('aria-description', aria.text);
  if (aria.kind) el.setAttribute('data-tip-aria', aria.kind);
}

// ── Bulle ─────────────────────────────────────────────────────────────────────

function tipIsVisible() {
  return !!(_tipEl && _tipEl.classList.contains('tip-shown'));
}

// La bulle est-elle affichée, et sur ce porteur ? Pour un code qui n'ajuste
// une infobulle que si on la lit (bouton d'export sous Shift).
function tipShownOn(el) {
  return !!el && el === _tipOwner && tipIsVisible();
}

function tipOwnerOf(target) {
  const el = target && target.closest ? target.closest('[data-tip]') : null;
  return el && el.getAttribute('data-tip') ? el : null;
}

function ensureTipEl() {
  if (_tipEl) return _tipEl;
  _tipEl = document.createElement('div');
  _tipEl.className = 'tip';
  _tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(_tipEl);
  return _tipEl;
}

// Texte (en textContent, jamais de HTML) puis placement, mesuré à chaque
// affichage. La bulle est mesurable même masquée (visibility), donc elle est
// placée avant de devenir visible.
function renderTip() {
  const owner = _tipOwner;
  const t = normalizeTip(getTip(owner));
  if (!owner || !t) { hideTip(); return; }
  const el = ensureTipEl();
  el.textContent = '';
  if (t.detail) {
    const label = document.createElement('span');
    label.className = 'tip-label';
    label.textContent = t.label;
    const detail = document.createElement('span');
    detail.className = 'tip-detail';
    detail.textContent = t.detail;
    el.appendChild(label);
    el.appendChild(detail);
  } else {
    el.textContent = t.label;
  }
  el.style.left = '0px';
  el.style.top = '0px';
  const r = owner.getBoundingClientRect();
  const offset = parseFloat(getComputedStyle(el).getPropertyValue('--tip-offset')) || 8;
  const p = tipPlacement({
    anchor: { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
    tipW: el.offsetWidth,
    tipH: el.offsetHeight,
    vw: document.documentElement.clientWidth,
    margin: TIP_VIEWPORT_MARGIN,
    offset: offset,
    arrowInset: TIP_ARROW_INSET,
  });
  el.dataset.side = p.side;
  el.style.left = Math.round(p.left) + 'px';
  el.style.top = Math.round(p.top) + 'px';
  el.style.setProperty('--arrow-x', Math.round(p.arrowX) + 'px');
  el.classList.add('tip-shown');
  armTipWatch();
}

function showTipNow(owner) {
  _tipOwner = owner;
  renderTip();
}

// Affiche après le délai rendu par le pur (froid, ou immédiat si une bulle est
// visible ou vient d'être masquée). Passer d'un enfant à l'autre du même
// porteur ne relance rien.
function scheduleTip(owner) {
  if (owner === _tipOwner && tipIsVisible()) return;
  if (owner === _tipPending) return;
  cancelTipTimer();
  const delay = tipShowDelay({ visible: tipIsVisible(), lastHideAt: _tipLastHideAt }, Date.now());
  if (delay <= 0) { showTipNow(owner); return; }
  _tipPending = owner;
  _tipShowTimer = setTimeout(function() {
    _tipShowTimer = null;
    _tipPending = null;
    if (owner.isConnected) showTipNow(owner);
  }, delay);
}

function cancelTipTimer() {
  clearTimeout(_tipShowTimer);
  _tipShowTimer = null;
  _tipPending = null;
}

// Masque tout de suite. Ne dépend d'aucun `transitionend` : la visibilité
// bascule par classe, le fondu n'est qu'un habillage.
function hideTip() {
  cancelTipTimer();
  clearInterval(_tipWatchTimer);
  _tipWatchTimer = null;
  if (tipIsVisible()) {
    _tipEl.classList.remove('tip-shown');
    _tipLastHideAt = Date.now();
  }
  _tipOwner = null;
}

// Masquage : porteur retiré du DOM (un renderConvList déclenché par la synchro peut
// détruire la cible sous le curseur), masqué (lui ou un ancêtre), ou vidé.
// Aucun événement ne signale ces cas : vérification périodique, qui ne tourne
// que tant qu'une bulle est affichée.
function armTipWatch() {
  if (_tipWatchTimer) return;
  _tipWatchTimer = setInterval(function() {
    if (_tipHover && !_tipHover.isConnected) _tipHover = null;
    const o = _tipOwner;
    if (!o || !o.isConnected || !o.getAttribute('data-tip') || !o.getClientRects().length) hideTip();
  }, TIP_WATCH_MS);
}

// ── Listeners délégués ────────────────────────────────────────────────────────

function onTipPointerOver(e) {
  if (e.pointerType === 'touch') return;   // tactile hors champ, comme le natif
  const owner = tipOwnerOf(e.target);
  if (!owner) return;
  _tipHover = owner;
  scheduleTip(owner);
}

function onTipPointerOut(e) {
  const owner = tipOwnerOf(e.target);
  if (!owner) return;
  if (e.relatedTarget && owner.contains(e.relatedTarget)) return;
  if (_tipHover === owner) _tipHover = null;
  if (owner === _tipPending) cancelTipTimer();
  if (owner !== _tipOwner) return;
  // Porteur ayant aussi le focus clavier : la bulle reste, le focus la porte.
  if (document.activeElement === owner && owner.matches(':focus-visible')) return;
  hideTip();
}

// Focus CLAVIER seulement : un clic ne doit pas laisser une bulle. Un
// champ de saisie est exclu : `:focus-visible` y est vrai même au clic (le nom
// d'un fichier de bibliothèque, contenteditable, afficherait sa bulle dès qu'on
// clique dedans pour le renommer, et la garderait jusqu'à la première frappe).
function onTipFocusIn(e) {
  const owner = tipOwnerOf(e.target);
  if (!owner || owner !== e.target || !owner.matches(':focus-visible')) return;
  if (owner.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(owner.tagName)) return;
  scheduleTip(owner);
}

function onTipFocusOut(e) {
  if (e.target !== _tipOwner || e.target === _tipHover) return;
  hideTip();
}

// Frappe, en CAPTURE sur document : avant l'autocomplétion, les éditions et toute
// la cascade Échap (ui.js). Toute frappe masque, hors touche de modification
// seule (`tipKeyHides`) ; Échap sur une bulle visible est consommé et rien
// d'autre ne se ferme. Sans bulle visible, tout passe.
function onTipKeyDown(e) {
  if (!tipKeyHides(e.key)) return;
  if (!tipIsVisible()) { cancelTipTimer(); return; }
  hideTip();
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
  }
}

// Masquage : un défilement ne masque que s'il déplace le porteur, c'est-à-dire si le
// conteneur défilé le contient (le document contient tout). Le fil défile par
// le code à chaque chunk d'une génération : un masquage sur tout défilement
// éteindrait la bulle du bouton d'envoi dès le premier chunk.
function onTipScroll(e) {
  const owner = _tipOwner || _tipPending;
  if (!owner) return;
  const target = e.target;
  if (target === document || target === document.documentElement || (target.contains && target.contains(owner))) hideTip();
}

// Installe les listeners (une fois) et applique la règle ARIA aux porteurs du
// HTML statique : `data-tip` y est écrit à la main, jamais son aria-label.
function initTooltips() {
  if (_tipWired || typeof document.querySelectorAll !== 'function') return;
  _tipWired = true;
  document.querySelectorAll('[data-tip]').forEach(function(el) { applyTipAttributes(el, getTip(el)); });
  document.addEventListener('pointerover', onTipPointerOver);
  document.addEventListener('pointerout', onTipPointerOut);
  document.addEventListener('focusin', onTipFocusIn);
  document.addEventListener('focusout', onTipFocusOut);
  document.addEventListener('keydown', onTipKeyDown, true);
  document.addEventListener('pointerdown', function() { hideTip(); }, true);
  document.addEventListener('scroll', onTipScroll, { capture: true, passive: true });
}
