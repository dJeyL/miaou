// ── nav-rail.js ─────────────────────────────────────────────────────────────
// Rail de navigation du fil : une marque par message de l'utilisateur, contre
// le bord droit de la zone du fil, centrée verticalement. Les marques des
// échanges visibles s'allument au défilement ; le survol du rail ouvre un
// panneau qui liste le début de chaque message ; un clic (marque ou entrée)
// amène le message en haut de l'écran.
//
// LECTEUR PUR du DOM du fil : le rail n'écrit rien de persisté, ne touche
// jamais `currentThread`, et ne part pas au modèle. Il se reconstruit sur un
// MutationObserver des enfants DIRECTS de #thread plutôt qu'à chaque point qui
// ajoute ou retire une bulle (renderThread, appendUserMessage, troncature
// d'édition…) : l'énumération des écrivains serait fausse au prochain ajout,
// l'observation ne l'est jamais.
//
// Ce qui compte comme « message de l'utilisateur » : `.msg.user` hors compte
// rendu d'agent (`.agent-result`, porté par un message user mais écrit par un
// agent). Les interjections sont de vraies bulles user et ont leur marque.
//
// Un échange = la bulle user et tout ce qui la suit jusqu'à la bulle user
// suivante. C'est l'échange, pas la bulle seule, qui s'allume : relire une
// longue réponse doit laisser allumée la question à laquelle elle répond.
//
// Purs testés par tests/test-nav-rail.js ; le comportement en page (survol
// croisé, saut au clic, fonds dans les deux thèmes, calage à un ratio de pixels
// fractionnaire) par .claude/skills/run-miaou/verify-nav-rail.mjs.
//
// Pointeur seulement (`aria-hidden`) : le rail double le défilement, qui reste
// la voie accessible au clavier ; des dizaines de marques focusables
// allongeraient le parcours au Tab sans rien offrir de plus.

// Pas (centre à centre) entre deux marques, au repos. Resserré quand la
// colonne dépasserait NAV_RAIL_MAX_FRACTION de la hauteur du fil.
const NAV_RAIL_PITCH_PX = 12;
const NAV_RAIL_MAX_FRACTION = 0.6;
// Épaisseur visée d'une marque, avant calage sur les pixels physiques.
const NAV_RAIL_THICK_PX = 2;
// Recouvrement minimal pour qu'un échange compte comme visible : un liseré de
// quelques pixels au bord de l'écran ne doit pas allumer sa marque.
const NAV_RAIL_MIN_OVERLAP_PX = 24;
// Longueur de l'aperçu d'un message dans le panneau (le CSS borne à deux
// lignes ; ce plafond évite seulement de copier un message entier dans le DOM).
const NAV_RAIL_PREVIEW_CHARS = 160;
// Délais d'ouverture et de fermeture du panneau : traverser le rail en allant
// vers la scrollbar ne doit pas l'ouvrir, et le quitter un instant pour
// rejoindre le panneau ne doit pas le fermer.
const NAV_RAIL_OPEN_MS = 140;
const NAV_RAIL_CLOSE_MS = 220;
// Marge entre le bord droit de la colonne du fil et le rail. Le rail ne
// s'affiche que si son emprise (CSS) plus cette marge tient dans la gouttière :
// en deçà, les marques mordraient sur les bulles.
const NAV_RAIL_GUTTER_MARGIN_PX = 8;

// ── Purs ────────────────────────────────────────────────────────────────────

// Aperçu d'un message : blancs repliés, coupé à `max` caractères avec une
// ellipse. Vide si le texte l'est (l'appelant choisit le repli).
function navRailPreview(text, max) {
  const flat = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max).trimEnd() + '…';
}

// Pas entre deux marques : NAV_RAIL_PITCH_PX tant que la colonne tient dans
// `maxHeight`, resserré au-delà (sans plancher : à très grand nombre, les
// marques se fondent en une bande, et le panneau reste la voie de lecture).
function navRailPitch(count, maxHeight, pitch) {
  if (count < 2) return pitch;
  return Math.min(pitch, Math.max(0, maxHeight) / (count - 1));
}

// Calage sur les pixels PHYSIQUES. Épaisseur, pas et retrait du trait dans
// sa bande sont arrondis à un nombre entier de pixels d'écran puis reconvertis
// en px CSS : sans ça, sous un zoom qui rend devicePixelRatio fractionnaire
// (90 % sur un écran 2x → 1,8), un trait de 2px en vaut 3,6, et chaque marque
// est arrondie selon sa position — des épaisseurs inégales d'une marque à
// l'autre. Le pas est arrondi par défaut (la colonne ne déborde jamais du
// plafond calculé), l'épaisseur au plus proche, jamais sous un pixel.
function navRailSnap(pitch, thick, dpr) {
  const d = dpr > 0 ? dpr : 1;
  const thickDev = Math.max(1, Math.round(thick * d));
  const pitchDev = Math.max(1, Math.floor(pitch * d));
  const insetDev = Math.max(0, Math.floor((pitchDev - thickDev) / 2));
  return { pitch: pitchDev / d, thick: thickDev / d, inset: insetDev / d };
}

// Indices des échanges visibles. `spans` : [{top, bottom}] en coordonnées du
// défilement, dans l'ordre du fil ; la vue est [viewTop, viewBottom]. Un
// échange plus court que `minOverlap` compte s'il est vu EN ENTIER — sinon une
// question brève suivie d'une réponse courte ne s'allumerait jamais.
function navRailLitIndices(spans, viewTop, viewBottom, minOverlap) {
  const lit = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    const overlap = Math.min(s.bottom, viewBottom) - Math.max(s.top, viewTop);
    if (overlap <= 0) continue;
    if (overlap >= minOverlap || overlap >= s.bottom - s.top) lit.push(i);
  }
  return lit;
}

// ── État et DOM ─────────────────────────────────────────────────────────────

const _navRail = {
  bubbles: [],          // bulles user marquées, dans l'ordre du fil
  lit: [],              // indices allumés au dernier calcul
  openTimer: null,
  closeTimer: null,
  syncPending: false,
  rebuildPending: false,
  layoutPending: false,
  hoverIdx: null,       // message désigné au survol (marque ou entrée)
};

function navRailBubbles() {
  const thread = $('thread');
  if (!thread) return [];
  return Array.from(thread.querySelectorAll(':scope > .msg.user:not(.agent-result)'));
}

// Texte affiché d'une bulle : le corps rendu (littéral tapé, slash-commandes
// comprises), à défaut le nom de la première pièce jointe.
function navRailBubbleText(bubble) {
  const body = bubble.querySelector('.bubble > .body');
  const text = navRailPreview(body ? body.textContent : '', NAV_RAIL_PREVIEW_CHARS);
  if (text) return text;
  const att = bubble.querySelector('.bubble [data-name], .bubble img[alt]');
  const name = att ? (att.getAttribute('data-name') || att.getAttribute('alt') || '') : '';
  return name ? '[' + name + ']' : '[pièce jointe]';
}

// Reconstruit les marques depuis le fil. Regroupé par frame : un renderThread
// retire puis rajoute toutes les bulles, l'observateur s'en fait l'écho en
// rafale.
function scheduleNavRailRebuild() {
  if (_navRail.rebuildPending) return;
  _navRail.rebuildPending = true;
  requestAnimationFrame(() => {
    _navRail.rebuildPending = false;
    rebuildNavRail();
  });
}

function rebuildNavRail() {
  const marks = $('nav-rail-marks');
  if (!marks) return;
  _navRail.bubbles = navRailBubbles();
  _navRail.lit = [];
  _navRail.hoverIdx = null;
  marks.textContent = '';
  for (let i = 0; i < _navRail.bubbles.length; i++) {
    const mark = document.createElement('div');
    mark.className = 'nav-rail-mark';
    mark.dataset.navIdx = String(i);
    marks.appendChild(mark);
  }
  closeNavRailPanel(true);
  syncNavRailLayout();
}

function scheduleNavRailLayout() {
  if (_navRail.layoutPending) return;
  _navRail.layoutPending = true;
  requestAnimationFrame(() => {
    _navRail.layoutPending = false;
    syncNavRailLayout();
  });
}

// Géométrie : position du rail sur la zone du fil, visibilité, pas des
// marques. Appelé à la reconstruction et au redimensionnement de la zone.
function syncNavRailLayout() {
  const rail = $('nav-rail');
  const m = $('messages');
  const thread = $('thread');
  if (!rail || !m || !thread) return;
  const n = _navRail.bubbles.length;
  const mRect = m.getBoundingClientRect();
  const tRect = thread.getBoundingClientRect();
  // Emprise du rail lue sur son style (valeurs absolues, lisibles même
  // masqué) plutôt que recopiée ici : marques au plus large comprises, elles
  // doivent tenir à droite du fil avec une marge.
  const rs = getComputedStyle(rail);
  const footprint = (parseFloat(rs.right) || 0) + (parseFloat(rs.width) || 0) + NAV_RAIL_GUTTER_MARGIN_PX;
  const gutter = mRect.right - tRect.right;
  const show = n >= 2 && gutter >= footprint && mRect.height > 0;
  rail.hidden = !show;
  if (!show) { closeNavRailPanel(true); return; }
  rail.style.top = m.offsetTop + 'px';
  rail.style.height = m.clientHeight + 'px';
  const dpr = window.devicePixelRatio || 1;
  const snap = navRailSnap(navRailPitch(n, m.clientHeight * NAV_RAIL_MAX_FRACTION, NAV_RAIL_PITCH_PX),
                           NAV_RAIL_THICK_PX, dpr);
  rail.style.setProperty('--nav-rail-pitch', snap.pitch + 'px');
  rail.style.setProperty('--nav-rail-thick', snap.thick + 'px');
  rail.style.setProperty('--nav-rail-inset', snap.inset + 'px');
  // Chaque marque est placée À SA POSITION, calculée en pixels d'écran depuis
  // le haut de la colonne — jamais empilée. Chrome arrondit les longueurs au
  // 1/64 de px CSS : un pas de 21/1,8 = 11,667px y devient 11,656, et en
  // empilant, l'écart s'additionne d'une marque à l'autre (0,15 pixel d'écran
  // à la huitième, mesuré) — de quoi faire basculer l'arrondi du trait et
  // rendre des épaisseurs inégales. Placée une à une, l'erreur reste celle
  // d'un seul arrondi. Le centrage est posé ici pour la même raison.
  const marks = $('nav-rail-marks');
  const railTop = rail.getBoundingClientRect().top;
  const pitchDev = Math.round(snap.pitch * dpr);
  const startDev = Math.round((railTop + (m.clientHeight - n * snap.pitch) / 2) * dpr);
  const rows = marks.children;
  marks.style.marginTop = (startDev / dpr - railTop) + 'px';
  marks.style.height = (n * pitchDev / dpr) + 'px';
  for (let i = 0; i < rows.length; i++) rows[i].style.top = (i * pitchDev / dpr) + 'px';
  syncNavRailLit();
}

// Spans des échanges en coordonnées du défilement. La fin du dernier échange
// est la fin du DERNIER enfant du fil, pas le bas de #thread (étiré à la
// hauteur de l'écran tant que le fil est court).
function navRailSpans(m) {
  const base = m.getBoundingClientRect().top - m.scrollTop;
  const bubbles = _navRail.bubbles;
  const thread = $('thread');
  const last = thread && thread.lastElementChild;
  const end = last ? last.getBoundingClientRect().bottom - base : 0;
  const spans = [];
  for (let i = 0; i < bubbles.length; i++) {
    const top = bubbles[i].getBoundingClientRect().top - base;
    const next = bubbles[i + 1];
    const bottom = next ? next.getBoundingClientRect().top - base : end;
    spans.push({ top, bottom: Math.max(top, bottom) });
  }
  return spans;
}

function scheduleNavRailLit() {
  if (_navRail.syncPending) return;
  _navRail.syncPending = true;
  requestAnimationFrame(() => {
    _navRail.syncPending = false;
    syncNavRailLit();
  });
}

function syncNavRailLit() {
  const rail = $('nav-rail');
  const m = $('messages');
  if (!rail || !m || rail.hidden) return;
  const lit = navRailLitIndices(navRailSpans(m), m.scrollTop, m.scrollTop + m.clientHeight,
                                NAV_RAIL_MIN_OVERLAP_PX);
  _navRail.lit = lit;
  const on = new Set(lit);
  // Marques ET entrées du panneau (ouvert ou non) : les deux portent l'index,
  // le panneau suit donc le défilement au même calcul.
  for (const el of rail.querySelectorAll('[data-nav-idx]')) {
    el.classList.toggle('lit', on.has(Number(el.dataset.navIdx)));
  }
}

// ── Panneau d'aperçus ───────────────────────────────────────────────────────

function fillNavRailPanel() {
  const panel = $('nav-rail-panel');
  if (!panel) return;
  panel.textContent = '';
  const on = new Set(_navRail.lit);
  for (let i = 0; i < _navRail.bubbles.length; i++) {
    const item = document.createElement('div');
    item.className = 'nav-rail-item' + (on.has(i) ? ' lit' : '') +
      (i === _navRail.hoverIdx ? ' hover' : '');
    item.dataset.navIdx = String(i);
    item.textContent = navRailBubbleText(_navRail.bubbles[i]);
    panel.appendChild(item);
  }
}

function openNavRailPanel() {
  const rail = $('nav-rail');
  const panel = $('nav-rail-panel');
  if (!rail || !panel || rail.hidden) return;
  fillNavRailPanel();
  rail.classList.add('open');
  // Première entrée allumée amenée dans le panneau : sur un long fil, la
  // position courante doit se voir sans chercher.
  const first = panel.querySelector('.nav-rail-item.lit');
  if (first) panel.scrollTop = first.offsetTop - (panel.clientHeight - first.offsetHeight) / 2;
}

function closeNavRailPanel(now) {
  clearTimeout(_navRail.openTimer);
  clearTimeout(_navRail.closeTimer);
  _navRail.openTimer = _navRail.closeTimer = null;
  const rail = $('nav-rail');
  if (rail && now) rail.classList.remove('open');
}

function onNavRailEnter() {
  clearTimeout(_navRail.closeTimer);
  _navRail.closeTimer = null;
  const rail = $('nav-rail');
  if (!rail || rail.classList.contains('open') || _navRail.openTimer) return;
  _navRail.openTimer = setTimeout(() => {
    _navRail.openTimer = null;
    openNavRailPanel();
  }, NAV_RAIL_OPEN_MS);
}

function onNavRailLeave() {
  setNavRailHover(null);
  clearTimeout(_navRail.openTimer);
  _navRail.openTimer = null;
  clearTimeout(_navRail.closeTimer);
  _navRail.closeTimer = setTimeout(() => {
    _navRail.closeTimer = null;
    const rail = $('nav-rail');
    if (rail) rail.classList.remove('open');
  }, NAV_RAIL_CLOSE_MS);
}

// Clic sur une marque ou une entrée : la bulle est amenée en haut de la zone
// du fil, par la même descente animée que le bouton « aller tout en bas »
// (durée, réglage Animations, abandon sur geste). La cible est relue à chaque
// frame : le fil peut grandir pendant le trajet.
function onNavRailClick(e) {
  const hit = e.target.closest('[data-nav-idx]');
  if (!hit) return;
  const bubble = _navRail.bubbles[Number(hit.dataset.navIdx)];
  const m = $('messages');
  if (!bubble || !bubble.isConnected || !m) return;
  stopStickToBottom();
  scrollToBottomAnimated(m, () => {
    const padTop = parseFloat(getComputedStyle(m).paddingTop) || 0;
    const top = bubble.getBoundingClientRect().top - m.getBoundingClientRect().top + m.scrollTop - padTop;
    return Math.max(0, Math.min(top, m.scrollHeight - m.clientHeight));
  });
}

// Survol croisé : pointer une marque OU l'entrée correspondante du panneau
// désigne le même message. La marque s'élargit (ses voisines directes à
// moitié) et l'entrée s'éclaircit, quel que soit le côté pointé — d'où des
// classes posées en JS plutôt que des `:hover`, qui ne verraient que
// l'élément sous le pointeur.
function setNavRailHover(idx) {
  const rail = $('nav-rail');
  if (!rail) return;
  _navRail.hoverIdx = idx;
  for (const el of rail.querySelectorAll('.nav-rail-mark')) {
    const d = idx == null ? Infinity : Math.abs(Number(el.dataset.navIdx) - idx);
    el.classList.toggle('hover', d === 0);
    el.classList.toggle('near', d === 1);
  }
  const panel = $('nav-rail-panel');
  let item = null;
  for (const el of rail.querySelectorAll('.nav-rail-item')) {
    const on = idx != null && Number(el.dataset.navIdx) === idx;
    el.classList.toggle('hover', on);
    if (on) item = el;
  }
  // Survol d'une marque, panneau ouvert : l'entrée désignée est ramenée dans
  // le panneau si elle en est sortie (jamais scrollIntoView, qui ferait aussi
  // défiler le fil).
  if (item && panel && rail.classList.contains('open')) {
    if (item.offsetTop < panel.scrollTop) panel.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > panel.scrollTop + panel.clientHeight) {
      panel.scrollTop = item.offsetTop + item.offsetHeight - panel.clientHeight;
    }
  }
}

function onNavRailOver(e) {
  const hit = e.target.closest('[data-nav-idx]');
  setNavRailHover(hit ? Number(hit.dataset.navIdx) : null);
}

function initNavRail() {
  const rail = $('nav-rail');
  const m = $('messages');
  const thread = $('thread');
  if (!rail || !m || !thread) return;
  rail.addEventListener('mouseenter', onNavRailEnter);
  rail.addEventListener('mouseleave', onNavRailLeave);
  rail.addEventListener('click', onNavRailClick);
  rail.addEventListener('mouseover', onNavRailOver);
  m.addEventListener('scroll', () => { scheduleNavRailLit(); }, { passive: true });
  new MutationObserver(scheduleNavRailRebuild).observe(thread, { childList: true });
  // Taille de la zone (fenêtre, sidebar, composer qui grandit) ET hauteur du
  // fil (streaming, dépliage, images) : l'une déplace le rail, l'autre ce qui
  // est visible sans émettre de `scroll`.
  // Le fil compte aussi pour la largeur : la place libre à sa droite décide
  // de l'affichage, et la largeur de colonne se règle sans toucher la zone.
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(scheduleNavRailLayout);
    ro.observe(m);
    ro.observe(thread);
  }
  rebuildNavRail();
}
