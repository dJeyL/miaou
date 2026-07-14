/* ── ui.js ─────────────────────────────────────────────────────────────────
   Couche DOM : rendu des messages, sidebar, drawers, dropdown modèle, bannière
   mémoire, indicateur d'activité, gestion des souvenirs. Aucune logique
   d'orchestration (qui vit dans main.js) ni réseau (api.js).
   ────────────────────────────────────────────────────────────────────────── */

let highlightEnabled = true;
let configured = false;
let sending = false;
let _confirmPending = false;

function $(id) { return document.getElementById(id); }

// ── Écran d'accueil (nouvelle conversation) ─────────────────────────────────
const WELCOME_SCREENS = [
  { emoji: '🌙', title: 'À tes ordres.',          sub: 'Qu\'est-ce qu\'on démonte aujourd\'hui ?' },
  { emoji: '⚡', title: 'Prêt.',                  sub: 'Pose la question que tu n\'osais pas chercher sur Google.' },
  { emoji: '🧠', title: 'Connexion établie.',     sub: 'Ta prochaine bonne idée est à une question d\'ici.' },
  { emoji: '🎯', title: 'En ligne.',              sub: 'Allons droit au but.' },
  { emoji: '🔭', title: 'Je t\'écoute.',          sub: 'L\'inconnu n\'est qu\'un contexte manquant.' },
  { emoji: '🌊', title: 'Dans le flux.',          sub: 'Décris le problème, on trouvera la sortie.' },
  { emoji: '☕', title: 'Fraîchement infusé.',    sub: 'Le moment idéal pour poser cette question qui traîne.' },
  { emoji: '🏗️', title: 'Chantier ouvert.',      sub: 'Amène tes plans, tes blocs, ou juste l\'intention.' },
  { emoji: '🌿', title: 'Calme et disponible.',   sub: 'Prends ton temps.' },
  { emoji: '🗺️', title: 'Carte blanche.',        sub: 'Par où commence-t-on ?' },
  { emoji: '🔬', title: 'Sous la loupe.',         sub: 'Tout mérite d\'être examiné de plus près.' },
  { emoji: '🚀', title: 'Compte à rebours.',      sub: 'Dix secondes pour formuler, le reste suit.' },
  { emoji: '🎸', title: 'Accordé.',               sub: 'À toi de jouer.' },
  { emoji: '🎲', title: 'Prêt à tout.',           sub: 'Une question, une idée, un bug — on y va.' },
  { emoji: '🦾', title: 'Opérationnel.',          sub: 'Dis-moi ce qui coince.' },
];

// Tire un écran d'accueil au hasard, en évitant `exceptTitle` si fourni (pour
// garantir un changement VISIBLE au re-tirage — cf. refreshWelcomeIfPresent).
function pickWelcomeScreen(exceptTitle) {
  const pool = exceptTitle
    ? WELCOME_SCREENS.filter(w => w.title !== exceptTitle)
    : WELCOME_SCREENS;
  const src = pool.length ? pool : WELCOME_SCREENS;   // garde-fou (jamais vide en pratique)
  return src[Math.floor(Math.random() * src.length)];
}

function showWelcome(exceptTitle) {
  const w = pickWelcomeScreen(exceptTitle);
  const el = document.createElement('div');
  el.className = 'welcome-screen';
  el.innerHTML =
    '<div class="welcome-emoji">' + w.emoji + '</div>' +
    '<div class="welcome-title">' + escHtml(w.title) + '</div>' +
    '<div class="welcome-sub">'   + escHtml(w.sub)   + '</div>';
  $('thread').appendChild(el);
}

// Coquetterie : si l'écran d'accueil est affiché (conversation vierge), un
// changement de thème re-tire un message d'accueil au hasard, DIFFÉRENT de
// l'actuel (changement toujours visible). Retire l'ancien avant de rappeler
// showWelcome (qui append). No-op hors écran d'accueil ou avant tout rendu.
function refreshWelcomeIfPresent() {
  const thread = $('thread');
  if (!thread) return;
  const w = thread.querySelector('.welcome-screen');
  if (!w) return;
  const curTitle = (w.querySelector('.welcome-title') || {}).textContent || '';
  w.remove();
  showWelcome(curTitle);
}

// Path des composants Prism pour l'autoloader (langages chargés à la volée).
if (window.Prism && Prism.plugins && Prism.plugins.autoloader) {
  Prism.plugins.autoloader.languages_path =
    'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';
}

// Renderer custom pour les fences de code : marked 12.0.0 (désassemblage vérifié,
// cf. untracked/brief-codeblock-filename.md) conserve l'info string COMPLÈTE dans
// `lang` (ex. "python filename=foo.py") et son renderer par défaut prend juste
// `^\S*` pour la classe language-xxx — un filename séparé par un ESPACE ne casse
// donc déjà rien côté Prism, mais est perdu (jamais lu). On réutilise le même corps
// que le renderer d'origine (signature vérifiée : code(text, lang, escaped)) en y
// ajoutant l'extraction du filename (parseCodeFenceInfo, utils.js) posé en attribut
// data- sur le <code>, jamais dans la classe. Pur/déterministe (même entrée → même
// HTML), s'applique aussi à renderUserMd (même instance marked globale — souhaité :
// un user peut coller un codeblock nommé).
if (window.marked) {
  marked.use({
    renderer: {
      code(text, infoString, escaped) {
        const { lang, filename } = parseCodeFenceInfo(infoString);
        const body = String(text).replace(/\n$/, '') + '\n';
        const content = escaped ? body : escHtml(body);
        const cls = lang ? ' class="language-' + escHtml(lang) + '"' : '';
        const attr = filename ? ' data-filename="' + escHtml(filename) + '"' : '';
        return '<pre><code' + cls + attr + '>' + content + '</code></pre>\n';
      },
    },
  });
}

// ── Rendu markdown / coloration ─────────────────────────────────────────────
// Résout les [conv_ref:ID] / [conv_ref:ID|Titre] (CONV_REF_DOCTRINE, tools.js)
// en lien Markdown standard AVANT marked.parse — jamais après : une fois passés
// par le parseur, les crochets bruts seraient déjà interprétés (syntaxe de lien
// incomplète) et donc invisibles/imprévisibles à ce stade. Le href pointe vers un
// pseudo-schéma `#miaou-conv:ID` intercepté par délégation de clic (openConvRefLink),
// jamais une vraie navigation. Titre : celui fourni par le modèle, sinon lookup
// dans l'index des résumés (storage.js) — y compris une entrée tombstone
// (suppressed:true ne concerne QUE le résumé/mémoire, cf. §6 CLAUDE.md ; la
// conversation elle-même reste intacte et ouvrable, son titre reste affichable).
// Conversation réellement supprimée (deleteConv → deleteSummaryEntry, hard
// delete des DEUX, ≠ tombstone) : la source de vérité pour « ouvrable » est
// loadConversation(id), pas la présence d'un résumé (cas limite existant où le
// résumé peut survivre sans la conversation, cf. get_conversation). Dans ce cas,
// rendu en texte barré NON cliquable plutôt qu'un lien mort — pas de
// post-traitement DOM, juste du Markdown ~~...~~.
// `opts.asPlainText` (défaut false, écran inchangé) : pour l'export standalone
// (brief G, D3) où le lien `#miaou-conv:` ne résout jamais hors MIAOU — rend
// le label nu au lieu d'un lien mort. Le tombstone `~~…~~` reste inchangé
// (c'est du texte, pas un lien).
function resolveConvRefs(text, opts) {
  const asPlainText = !!(opts && opts.asPlainText);
  return String(text).replace(CONV_REF_RE, function(match, id, title) {
    const entry = getSummaryEntry(id);
    const label = title || (entry && entry.title) || id;
    const safeLabel = label.replace(/\]/g, ')');
    if (!loadConversation(id)) {
      return '~~' + safeLabel + ' (supprimée)~~';
    }
    if (asPlainText) return safeLabel;
    return '[' + safeLabel + '](#miaou-conv:' + encodeURIComponent(id) + ')';
  });
}

// Sanitisation du HTML issu de marked (campagne relecture 2026-07, A1) : le
// markdown du MODÈLE peut contenir du HTML inline (marked le laisse passer tel
// quel) — sans sanitisation, un payload reproduit par le modèle depuis une
// source hostile (page web lue par outil) s'exécuterait dans le DOM, avec
// accès aux clefs API du localStorage. DOMPurify (CDN, comme marked/Prism) ;
// s'il n'est pas chargé (offline), marked ne l'est probablement pas non plus
// (même CDN) et le fallback escHtml des renderers prend le relais — le cas
// marked-sans-DOMPurify laisse passer comme avant, dégradation assumée.
function sanitizeHtml(html) {
  return window.DOMPurify ? DOMPurify.sanitize(html) : html;
}
function renderMd(text, opts) {
  const resolved = resolveConvRefs(text, opts);
  if (!window.marked) return escHtml(resolved).replace(/\n/g, '<br>');
  return sanitizeHtml(marked.parse(resolved, { breaks: true }));
}
// Variante pour les messages utilisateur : empêche les balises HTML de traverser
// vers le DOM (angle-brackets échappés) tout en conservant le markdown.
// Le `>` est laissé intact pour que les blockquotes fonctionnent.
function renderUserMd(text) {
  if (!window.marked) return escHtml(text).replace(/\n/g, '<br>');
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return sanitizeHtml(marked.parse(safe, { breaks: true }));
}
function highlightUnder(el) { if (highlightEnabled && window.Prism) Prism.highlightAllUnder(el); }

// ── Rendu Mermaid (lot E, D1) ────────────────────────────────────────────────
// Lazy-load réel : Mermaid (~2,5 Mo minifié) n'est chargé qu'au premier bloc
// ```mermaid rencontré, par injection dynamique de <script> — pattern DIFFÉRENT
// de Prism (dont le cœur est un <script src> statique dans index.html), assumé :
// le poids ne doit être payé que si la feature sert. Promesse mémoïsée avec
// reset sur rejet (hygiène des caches async) : un échec CDN n'empoisonne pas la
// session, le prochain bloc retente.
// Config (mermaidInit) : securityLevel 'strict' posé EXPLICITEMENT (c'est le
// défaut Mermaid, mais un upgrade de version ne doit pas pouvoir l'assouplir en
// silence) — Mermaid sanitise lui-même labels/liens (DOMPurify interne) ; on ne
// re-passe PAS son SVG dans sanitizeHtml : DOMPurify généraliste ampute les
// <style> internes du SVG (rendu cassé) et la sanitisation amont couvre déjà le
// vecteur. htmlLabels:false : labels en <text> SVG pur, pas de <foreignObject>
// — prérequis de l'export PNG canvas (lot E3, canvas tainted sur Safari sinon) ;
// rendu des labels légèrement différent du défaut Mermaid, assumé.
// Cf. docs/rendering.md.
const MERMAID_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/11.12.0/mermaid.min.js';
let _mermaidPromise = null;
let _mermaidTheme = null;   // thème du dernier initialize (détection de changement)
let _mermaidUid = 0;

function mermaidInit(themeName) {
  _mermaidTheme = themeName;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    theme: themeName,
  });
}

function ensureMermaid() {
  if (_mermaidPromise) return _mermaidPromise;
  _mermaidPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MERMAID_CDN;
    s.onload = () => {
      if (!window.mermaid) { reject(new Error('mermaid absent après chargement')); return; }
      mermaidInit(mermaidThemeFor(document.documentElement.getAttribute('data-theme')));
      resolve(window.mermaid);
    };
    s.onerror = () => reject(new Error('échec de chargement Mermaid (CDN)'));
    document.head.appendChild(s);
  });
  _mermaidPromise.catch(() => { _mermaidPromise = null; });   // reset sur rejet → retry possible
  return _mermaidPromise;
}

// ── Moteur QuickJS-WASM pour js__eval (lot L) ────────────────────────────────
// Artefact tranché par le spike L0 : build IIFE `index.global.min.js` exposant
// le global `window.QJS`, WASM RELEASE_SYNC (synchrone, Model 2) INLINÉ dans ce
// fichier unique → un seul <script src>, 2 requêtes réseau totales, aucun fetch
// .wasm séparé, aucun module ES au niveau source (contrainte dure MIAOU). Version
// épinglée @0.32.0 comme Mermaid @11.12.0. Détail : AUDIT-L §Spike L0.
const QUICKJS_CDN = 'https://cdn.jsdelivr.net/npm/quickjs-emscripten@0.32.0/dist/index.global.min.js';
let _quickjsPromise = null;

// Lazy-load calqué sur ensureMermaid (précédent exact) : promesse mémoïsée,
// reset-on-reject (hygiène des caches async, cf. CLAUDE.md). Différence avec
// Mermaid : l'échec ici NE se dégrade PAS silencieusement — il se propage en
// rejet, capté par le handler js__eval qui le remonte en erreur d'outil propre
// (un compute demandé qui ne peut pas tourner doit le dire, pas échouer en
// silence comme un diagramme non rendu). La promesse résout le MODULE QuickJS
// prêt (post getQuickJS = WASM compilé), pas juste le script chargé.
function ensureQuickJs() {
  if (_quickjsPromise) return _quickjsPromise;
  _quickjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QUICKJS_CDN;
    s.onload = () => {
      if (!window.QJS || typeof window.QJS.getQuickJS !== 'function') {
        reject(new Error('QuickJS absent après chargement')); return;
      }
      // getQuickJS() compile/instancie le WASM (async) et résout le module.
      window.QJS.getQuickJS().then(resolve, reject);
    };
    s.onerror = () => reject(new Error('échec de chargement QuickJS (CDN)'));
    document.head.appendChild(s);
  });
  _quickjsPromise.catch(() => { _quickjsPromise = null; });   // reset sur rejet → retry possible
  return _quickjsPromise;
}

// Passe de rendu : transforme chaque bloc ```mermaid de `scope` en diagramme.
// Appelée à la FINALISATION uniquement — finalizeAssistant et buildMsg, JAMAIS
// streamInto (source partielle = flicker + erreurs de parse en cascade, D1).
// Fire-and-forget : les appelants n'attendent pas.
// Architecture : le <pre> n'est JAMAIS détruit ; la vue rendue (.mermaid-view)
// vit DANS le <pre> (précédent .code-head, div déjà insérée là par decoratePre)
// pour que l'en-tête — et donc le bouton toggle — reste visible dans les deux
// états. La classe .mermaid-rendered sur le <pre> inverse code ↔ vue (CSS).
// code.textContent reste l'unique source de vérité (re-render thème, exports,
// lightbox relisent là).
// Échec de parse → <pre> intact + notice .mermaid-error, jamais de rendu cassé ;
// l'échec est mémorisé par source (pre._mermaidErrSrc) pour ne pas retenter la
// même source invalide à chaque passe (le re-render d'un message édité change
// la source → retente). CDN indisponible → silencieux, la source surlignée
// reste (même dégradation que marked/DOMPurify offline).
async function renderMermaidUnder(scope) {
  const codes = scope.querySelectorAll('code.language-mermaid');
  if (!codes.length) return;
  let mm;
  try { mm = await ensureMermaid(); }
  catch (e) { return; }
  for (const code of codes) {
    const pre = code.closest('pre');
    if (!pre) continue;
    const src = sanitizeMermaidSource(code.textContent);   // strippe <b>/<i>… inertes ; textContent intact
    const existing = pre.querySelector('.mermaid-view');
    if (existing && existing._mermaidSrc === src) continue;   // déjà rendu pour cette source
    if (pre._mermaidErrSrc === src) continue;                 // déjà en échec pour cette source
    // Id unique exigé par mermaid.render : compteur + suffixe aléatoire
    // (jamais un timestamp seul — deux rendus dans la même ms collisionnent).
    const uid = 'mmd' + (++_mermaidUid) + Math.random().toString(36).slice(2, 8);
    try {
      const out = await mm.render(uid, src);
      // Garde anti-obsolescence : le DOM a pu changer pendant l'await
      // (re-render du fil, édition). isConnected est vrai au retour de
      // microtâche pour un wrap construit par buildMsg puis appendé.
      if (!pre.isConnected || sanitizeMermaidSource(code.textContent) !== src) continue;
      const stale = pre.querySelector('.mermaid-view');
      if (stale) stale.remove();
      const oldNote = pre.querySelector('.mermaid-error');
      if (oldNote) oldNote.remove();
      pre._mermaidErrSrc = null;
      const view = document.createElement('div');
      view.className = 'mermaid-view';
      view.innerHTML = out.svg;   // markup produit par Mermaid strict — pas de re-sanitisation (cf. en-tête)
      view._mermaidSrc = src;
      attachDiagramActions(view, code);   // agrandir + exports SVG/PNG (lot E3)
      pre.appendChild(view);
      pre.classList.add('mermaid-rendered');
      const toggle = pre.querySelector('.code-mmd-toggle');
      if (toggle) toggle.removeAttribute('hidden');
    } catch (e) {
      // Mermaid v11 peut laisser un nœud d'erreur orphelin dans document.body.
      ['d' + uid, uid].forEach(id => {
        const orphan = document.getElementById(id);
        if (orphan) orphan.remove();
      });
      if (!pre.isConnected || sanitizeMermaidSource(code.textContent) !== src) continue;
      pre._mermaidErrSrc = src;
      pre.classList.remove('mermaid-rendered');
      if (!pre.querySelector('.mermaid-error')) {
        const note = document.createElement('div');
        note.className = 'mermaid-error';
        note.textContent = 'Diagramme invalide — source affichée';
        pre.appendChild(note);
      }
    }
  }
}

// Re-render au changement de thème résolu. Hook UNIQUE, appelé par applyTheme —
// couvre donc selectTheme ET le suivi matchMedia OS. mermaid.initialize ne
// ré-applique pas le thème aux SVG déjà rendus : purge des vues puis re-render
// explicite. La classe .mermaid-rendered est conservée pendant le re-render
// (pas de flash de source) ; un échec inattendu la retire (chemin d'erreur de
// renderMermaidUnder).
function refreshMermaidTheme(resolved) {
  if (typeof window === 'undefined' || !window.mermaid || !_mermaidPromise) return;
  const t = mermaidThemeFor(resolved);
  if (t === _mermaidTheme) return;
  mermaidInit(t);
  const thread = $('thread');
  if (!thread) return;
  thread.querySelectorAll('.mermaid-view').forEach(v => v.remove());
  renderMermaidUnder(thread);   // fire-and-forget
}
// ── Exports d'image & lightbox Mermaid (lot E3) ──────────────────────────────
// Sérialise le SVG rendu avec des dimensions EXPLICITES tirées du viewBox :
// Mermaid pose width="100%" + style max-width, dont la taille intrinsèque
// retombe à 300×150 quand le XML est rasterisé via <img> (export PNG). Clone
// normalisé — le SVG affiché n'est jamais touché.
function serializeDiagramSvg(svgEl) {
  const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  const rect = svgEl.getBoundingClientRect();
  const w = (vb && vb.width) || rect.width || 800;
  const h = (vb && vb.height) || rect.height || 600;
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.style.maxWidth = '';
  return { xml: new XMLSerializer().serializeToString(clone), w, h };
}

function downloadDiagramSvg(svgEl, rawName) {
  const s = serializeDiagramSvg(svgEl);
  downloadFile(diagramImageName(rawName, 'svg'), s.xml, 'image/svg+xml');
}

// PNG : SVG sérialisé → Blob → <img> → canvas 2x (dimensions viewBox) →
// toBlob → downloadFile (seul point d'entrée download du projet ; Blob accepte
// un Blob comme part, pas de chemin parallèle). Fond OPAQUE rempli avec le
// --code-bg résolu du thème actif avant drawImage : un PNG transparent issu du
// thème sombre est illisible collé dans un document clair. htmlLabels:false
// (mermaidInit) garantit l'absence de <foreignObject> → canvas jamais tainted.
function downloadDiagramPng(svgEl, rawName) {
  const s = serializeDiagramSvg(svgEl);
  const url = URL.createObjectURL(new Blob([s.xml], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(s.w * 2);
    canvas.height = Math.round(s.h * 2);
    const ctx = canvas.getContext('2d');
    const cs = getComputedStyle(document.documentElement);
    const bg = (cs.getPropertyValue('--code-bg') || cs.getPropertyValue('--bg')).trim() || '#fff';
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (blob) downloadFile(diagramImageName(rawName, 'png'), blob, 'image/png');
    }, 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

// Barre d'actions posée par renderMermaidUnder sur chaque .mermaid-view :
// agrandir (lightbox) + exports SVG/PNG. Câblage en CLOSURES comme decoratePre
// — pas de nouveaux handlers globaux, la liste CLAUDE.md est inchangée. La
// source des exports est TOUJOURS le SVG courant de la vue (relu au clic),
// jamais une référence figée : le re-render thème remplace la vue entière
// (actions recréées avec), mais inutile de parier sur l'ordre.
function attachDiagramActions(view, code) {
  const svgExpand = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  const bar = document.createElement('div');
  bar.className = 'mermaid-actions';
  const rawName = () => (code ? code.getAttribute('data-filename') : '');
  const svg = () => view.querySelector('svg');
  const mk = (cls, title, html, fn) => {
    const b = document.createElement('button');
    b.className = cls;
    b.title = title;
    b.innerHTML = html;
    b.onclick = fn;
    bar.appendChild(b);
  };
  mk('mermaid-btn mermaid-btn-expand', 'Agrandir', svgExpand,
     () => { const el = svg(); if (el) openMermaidLightbox(el, rawName()); });
  mk('mermaid-btn', 'Télécharger en SVG', 'SVG',
     () => { const el = svg(); if (el) downloadDiagramSvg(el, rawName()); });
  mk('mermaid-btn', 'Télécharger en PNG', 'PNG',
     () => { const el = svg(); if (el) downloadDiagramPng(el, rawName()); });
  view.appendChild(bar);
}

// Lightbox pan/zoom : singleton DOM créé au premier usage, affiche un CLONE du
// SVG rendu (l'original reste dans le fil). Transform CSS translate+scale sur
// un wrapper interne (transform-origin 0 0 → maths de zoom centré curseur
// triviales). Molette = zoom autour du curseur, drag = pan, double-clic =
// reset (re-fit), Esc (cascade D-Esc, niveau prioritaire) + clic hors diagramme
// + bouton × = fermer. Vanilla, pas de lib.
let _lbEl = null;        // overlay singleton
let _lbCanvas = null;    // wrapper transformé
let _lbName = '';        // data-filename du diagramme affiché (exports)
let _lbScale = 1, _lbTx = 0, _lbTy = 0;
let _lbW = 0, _lbH = 0;  // dimensions viewBox du clone courant

function lbApply() {
  _lbCanvas.style.transform = `translate(${_lbTx}px, ${_lbTy}px) scale(${_lbScale})`;
}

// Reset / état initial : fit dans la scène avec marge, sans jamais agrandir
// (un petit diagramme reste net à l'échelle 1), centré.
function lbFit() {
  const stage = _lbEl.querySelector('.mermaid-lightbox-stage');
  const sw = stage.clientWidth, sh = stage.clientHeight;
  if (!sw || !sh) return;   // lightbox cachée (display:none) : dimensions nulles, ne rien calculer
  _lbScale = Math.min(1, (sw - 48) / _lbW, (sh - 48) / _lbH);
  if (!(_lbScale > 0)) _lbScale = 1;
  _lbTx = (sw - _lbW * _lbScale) / 2;
  _lbTy = (sh - _lbH * _lbScale) / 2;
  lbApply();
}

// A3-2 : boutons taggés par mode ('mermaid' | 'image'), togglés via `hidden`
// plutôt que reconstruits — la barre ne bouge plus après création, mais les
// closures SVG/PNG ne s'exécutent jamais en mode image (elles restent
// cachées, jamais retirées du DOM).
let _lbDlBtn = null;   // bouton Télécharger, mode image — closure reciblée à chaque open

function ensureLightbox() {
  if (_lbEl) return _lbEl;
  _lbEl = document.createElement('div');
  _lbEl.className = 'mermaid-lightbox';
  const stage = document.createElement('div');
  stage.className = 'mermaid-lightbox-stage';
  _lbCanvas = document.createElement('div');
  _lbCanvas.className = 'mermaid-lightbox-canvas';
  stage.appendChild(_lbCanvas);
  const bar = document.createElement('div');
  bar.className = 'mermaid-lightbox-actions';
  const svg = () => _lbCanvas.querySelector('svg');
  const mk = (title, html, fn) => {
    const b = document.createElement('button');
    b.className = 'mermaid-lb-btn';
    b.title = title;
    b.innerHTML = html;
    b.onclick = fn;
    bar.appendChild(b);
    return b;
  };
  const svgBtn = mk('Télécharger en SVG', 'SVG', () => { const el = svg(); if (el) downloadDiagramSvg(el, _lbName); });
  const pngBtn = mk('Télécharger en PNG', 'PNG', () => { const el = svg(); if (el) downloadDiagramPng(el, _lbName); });
  _lbDlBtn = mk('Télécharger', ICON_DOWNLOAD, () => {});
  mk('Fermer', '×', closeMermaidLightbox);
  _lbEl._svgBtn = svgBtn;
  _lbEl._pngBtn = pngBtn;
  _lbEl.appendChild(stage);
  _lbEl.appendChild(bar);

  // Zoom centré curseur : le point sous le curseur reste fixe. Avec
  // transform-origin 0 0 : p_écran = t + p_monde·s, donc t' = p − (p − t)·f.
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const next = _lbScale * f;
    if (next < 0.1 || next > 24) return;
    const rect = stage.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    _lbTx = px - (px - _lbTx) * f;
    _lbTy = py - (py - _lbTy) * f;
    _lbScale = next;
    lbApply();
  }, { passive: false });

  // Pan au drag (pointer capture : le drag survit à la sortie de la scène).
  // Un pointerup sans mouvement sur le FOND de la scène — pas sur le diagramme
  // — vaut « clic hors » et ferme ; un vrai drag ne ferme jamais. ATTENTION :
  // setPointerCapture RECIBLE les pointerup vers la scène (e.target === stage
  // même en cliquant le diagramme) — la cible réelle du clic doit être figée
  // AU pointerdown, avant la capture, sinon tout clic ferme la lightbox.
  let dragging = false, moved = false, lx = 0, ly = 0, downTarget = null;
  stage.addEventListener('pointerdown', (e) => {
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    downTarget = e.target;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lx, dy = e.clientY - ly;
    if (!dx && !dy) return;
    _lbTx += dx; _lbTy += dy; lx = e.clientX; ly = e.clientY;
    if (Math.abs(dx) + Math.abs(dy) >= 1) moved = true;
    lbApply();
  });
  stage.addEventListener('pointerup', () => {
    dragging = false;
    stage.classList.remove('dragging');
    if (!moved && downTarget === stage) closeMermaidLightbox();
  });
  stage.addEventListener('dblclick', lbFit);

  document.body.appendChild(_lbEl);
  return _lbEl;
}

// A3-2 : cœur commun mermaid/image — dimensionne `_lbCanvas`, affiche, fit.
// `contentEl` est déjà le nœud à insérer (clone SVG ou <img>), construit par
// l'appelant : `openLightboxWith` ne connaît pas son origine.
function openLightboxWith(contentEl, w, h, rawName, mode) {
  ensureLightbox();
  _lbName = rawName || '';
  _lbW = w || 800;
  _lbH = h || 600;
  _lbCanvas.textContent = '';
  _lbCanvas.appendChild(contentEl);
  _lbCanvas.style.width = _lbW + 'px';
  _lbCanvas.style.height = _lbH + 'px';
  const isImage = mode === 'image';
  _lbEl._svgBtn.hidden = isImage;
  _lbEl._pngBtn.hidden = isImage;
  _lbDlBtn.hidden = !isImage;
  _lbEl.classList.add('show');
  lbFit();
}

function openMermaidLightbox(svgEl, rawName) {
  const vb = svgEl.viewBox && svgEl.viewBox.baseVal;
  const rect = svgEl.getBoundingClientRect();
  const w = (vb && vb.width) || rect.width || 800;
  const h = (vb && vb.height) || rect.height || 600;
  // Le clone GARDE son id : le <style> interne de Mermaid scope toutes ses
  // règles par #<id> — le retirer rend le diagramme totalement dé-stylé. L'id
  // dupliqué dans le document est assumé : les règles CSS (identiques) matchent
  // les deux occurrences, et rien ne fait de getElementById dessus.
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.style.maxWidth = '';
  openLightboxWith(clone, w, h, rawName, 'mermaid');
}

// A3-2 : mode image — pièce jointe de bulle envoyée (record du cache session,
// mêmes bytes que resolveAttachmentThumb, déjà downscalés ≤1536px à
// l'ingestion — pas de "pleine taille" distincte à résoudre). `<img>` créé par
// `createElement` + `src` en propriété JS, jamais en template string (piège 23).
function openAttachmentLightbox(record) {
  const img = document.createElement('img');
  img.src = 'data:' + record.mime + ';base64,' + arrayBufferToBase64(record.data);
  img.alt = '';
  // openLightboxWith → ensureLightbox() en premier : _lbDlBtn n'existe qu'après
  // (créé au premier usage du singleton), d'où l'ordre (jamais l'inverse).
  openLightboxWith(img, record.w || 800, record.h || 600, record.name, 'image');
  _lbDlBtn.onclick = () => downloadFile(record.name, record.data, record.mime);
}

// A3-2 : mode image — image modèle inline (`.tool-block-img`, résultat
// d'outil). Éphémère (jamais persistée, cf. placeToolBlocks) : pas de
// name/w/h figés au schéma, dimensions lues sur l'<img> déjà rendu
// (naturalWidth/Height, disponibles une fois l'image chargée dans le DOM).
// Téléchargement dérivé du `src` data-URI existant (pas de record IDB ici).
function openToolImageLightbox(imgEl) {
  const w = imgEl.naturalWidth || imgEl.width || 800;
  const h = imgEl.naturalHeight || imgEl.height || 600;
  const clone = document.createElement('img');
  clone.src = imgEl.src;
  clone.alt = '';
  openLightboxWith(clone, w, h, '', 'image');
  _lbDlBtn.onclick = () => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(imgEl.src);
    if (m) downloadFile('image.' + (m[1].split('/')[1] || 'png'), b64ToBytes(m[2]), m[1]);
  };
}

function closeMermaidLightbox() {
  if (!_lbEl) return;
  _lbEl.classList.remove('show');
  _lbCanvas.textContent = '';   // libère le clone (un gros SVG n'a pas à survivre fermé)
}

// Niveau prioritaire de la cascade Escape (D-Esc) : la lightbox est l'overlay
// le plus « au-dessus » de l'application (z-index > drawers).
function closeMermaidLightboxViaEscape() {
  if (!_lbEl || !_lbEl.classList.contains('show')) return false;
  closeMermaidLightbox();
  return true;
}

// Autoscroll pendant le streaming : ne suit le bas du fil que si l'utilisateur
// s'y trouvait déjà avant le rendu (isAtBottom), pour ne pas arracher la vue
// d'un lecteur remonté consulter une réponse précédente ou un raisonnement en
// cours. Tolérance en pixels car un scrollHeight recalculé après rendu markdown
// peut différer de quelques px de la position "pile en bas" mesurée avant.
const AUTOSCROLL_TOLERANCE_PX = 24;

function isAtBottom() {
  const m = $('messages');
  if (!m) return true;
  return m.scrollHeight - m.scrollTop - m.clientHeight <= AUTOSCROLL_TOLERANCE_PX;
}

// scrollBottom(force) : force=true ramène toujours en bas (nouveau message
// user, nouvelle bulle assistant, ouverture de conversation). Sans argument,
// ne scrolle que si l'utilisateur était déjà en bas — cf. isAtBottom.
function scrollBottom(force) {
  const m = $('messages');
  if (!m) return;
  if (!force && !isAtBottom()) return;
  m.scrollTop = m.scrollHeight;
}

function modelName() {
  // activeApiConfig (storage.js) : modèle du serveur actif, filet legacy inclus —
  // jamais loadSettings().model directement (périmé depuis le multi-serveurs).
  return activeApiConfig().model || 'modèle';
}

// ── Construction d'un message ───────────────────────────────────────────────
// En-tête d'un message assistant : la barre méta (modèle + icône raisonnement,
// masquée tant qu'aucun raisonnement) et le bloc collapsible du raisonnement
// (replié par défaut, donc `hidden`). Sert au rendu live ET au reload depuis le
// stockage — un seul mécanisme de pliage/dépliage, persistant sans recalcul.
function assistantHead(model, reasoning, ts, server) {
  const has = reasoning && String(reasoning).trim();
  const tsText = ts ? formatMessageTime(ts, Date.now()) : '';
  // Provenance : « serveur › modèle » seulement si plusieurs serveurs API sont
  // configurés (sur une config mono-serveur l'info est du bruit). Les anciens
  // messages sans champ server n'affichent que le modèle. Le « · » devant
  // l'heure est un span séparé (même coloration accent que le « › »), masqué
  // et révélé avec .msg-ts (cf. les deux mises à jour dynamiques, main.js).
  const showSrv = server && loadApiServers().length > 1;
  const srcHtml = (showSrv ? `<span>${escHtml(server)}</span><span class="inline-sep">›</span>` : '') +
    `<span>${escHtml(model || modelName())}</span>`;
  return (
    `<div class="meta"><img class="glyph" src="${LOGO_SRC}" alt="">${srcHtml}` +
    `<span class="msg-ts-sep inline-sep"${tsText ? '' : ' hidden'}>·</span>` +
    `<span class="msg-ts"${tsText ? '' : ' hidden'}>${escHtml(tsText)}</span>` +
    `<div class="meta-actions">` +
      `<button class="reasoning-toggle"${has ? '' : ' hidden'} onclick="toggleReasoning(this)" title="Raisonnement" aria-label="Raisonnement">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M11 2.5l1.5 3.8 3.8 1.5-3.8 1.5L11 13.1 9.5 9.3 5.7 7.8l3.8-1.5z"/><path d="M17.5 13l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/></svg>` +
      `</button>` +
      `<button class="msg-copy" hidden title="Copier" onclick="copyMsg(this)">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
      `</button>` +
      `<button class="msg-dl" hidden title="Télécharger en .md" onclick="downloadMsgMd(this)">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>` +
      `</button>` +
      `<button class="msg-regen" hidden title="Régénérer la réponse" onclick="regenerateResponse(this)">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>` +
      `</button>` +
    `</div>` +
    `</div>` +
    `<div class="reasoning" hidden><div class="reasoning-content">${has ? escHtml(String(reasoning)) : ''}</div></div>`
  );
}

// Bandeau de réponse incomplète (feature C) : texte persistant + bouton
// « Continuer ». Deux causes possibles, même bandeau : coupe backend (limite
// de tokens) ou stop manuel avec contenu déjà reçu — d'où le libellé générique.
// Inséré APRÈS .body dans la bulle assistant, aussi bien au rendu live
// (finalizeAssistant) qu'au reload (buildMsg) — un seul balisage pour les deux
// chemins. Le bouton est masqué/désactivé par syncLastAssistantActions selon
// la position (dernier message du fil) et l'état sending ; le texte, lui,
// reste affiché sur les messages anciens (spec brief §C).
function truncatedBannerHtml() {
  return (
    `<div class="msg-truncated">` +
    `<span class="msg-truncated-text">Réponse incomplète</span>` +
    `<button class="msg-continue" onclick="continueTruncated(this)">Continuer</button>` +
    `</div>`
  );
}

function buildMsg(role, content, model, reasoning, ts, server, truncated, attachments) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  if (role === 'user') {
    if (ts) wrap.dataset.ts = ts;
    wrap.innerHTML =
      `<div class="bubble">` +
      renderMsgAttachments(attachments, currentConvId) +
      `<div class="body">${renderUserMd(content)}</div>` +
      `</div>` +
      `<div class="msg-user-footer">` +
      `<div class="msg-user-actions">` +
      `<button class="msg-edit" title="Éditer" onclick="onEditMsg(this)">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
      `</button>` +
      `<button class="msg-copy-user" title="Copier" onclick="copyMsg(this)">` +
      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>` +
      `</button>` +
      `</div>` +
      (ts ? `<span class="msg-ts">${escHtml(formatMessageTime(ts, Date.now()))}</span>` : '') +
      `</div>`;
  } else {
    wrap.innerHTML =
      assistantHead(model, reasoning, ts, server) +
      `<div class="body">${renderMd(content)}</div>` +
      (truncated ? truncatedBannerHtml() : '');
    const bodyEl = wrap.querySelector('.body');
    if (bodyEl) bodyEl.dataset.raw = content;
    // Message déjà finalisé (reload) : les boutons copier/download sont opérationnels immédiatement.
    const copyBtn = wrap.querySelector('.msg-copy');
    if (copyBtn) copyBtn.removeAttribute('hidden');
    const dlBtn = wrap.querySelector('.msg-dl');
    if (dlBtn) dlBtn.removeAttribute('hidden');
  }
  decoratePre(wrap);
  // Rendu mermaid des messages historiques (reload/renderThread). Fire-and-
  // forget : la continuation async ne s'exécute qu'en microtâche, une fois le
  // wrap appendé au DOM par l'appelant (garde isConnected dans la passe).
  renderMermaidUnder(wrap);
  return wrap;
}

// ── Bloc de raisonnement (thinking) ─────────────────────────────────────────
// Texte brut en police mono (pas de markdown). Révèle l'icône à la première
// substance reçue ; un raisonnement vide ('') ne révèle rien (cf. distinction
// absence / chaîne vide du brief).
let _reasonTimer = null;
let _reasonPending = null;

// Écriture effective dans le DOM (O(n) : tout le nœud est réécrit). À ne PAS
// appeler par delta sans throttle — d'où setReasoning ci-dessous.
function renderReasoningNow(wrap, text) {
  if (!text) return;
  const toggle = wrap.querySelector('.reasoning-toggle');
  const panel = wrap.querySelector('.reasoning');
  const content = wrap.querySelector('.reasoning-content');
  if (!toggle || !panel || !content) return;
  toggle.removeAttribute('hidden');          // capacité détectée → icône visible
  // Autoscroll du raisonnement : même doctrine que le fil (isAtBottom) — ne
  // suivre le bas que si l'utilisateur y était déjà AVANT la réécriture, pour
  // ne pas arracher la vue d'un lecteur remonté dans un raisonnement en cours.
  // Mesuré avant textContent (qui réécrit tout et modifie scrollHeight).
  const stick = !panel.hasAttribute('hidden') &&
    content.scrollHeight - content.scrollTop - content.clientHeight <= AUTOSCROLL_TOLERANCE_PX;
  content.textContent = text;
  if (stick) content.scrollTop = content.scrollHeight;  // suivre si déplié ET déjà en bas
}

// Alimenté en live par les deltas accumulés, throttlé par fenêtres de ~90 ms
// (même motif que streamInto pour le contenu) : un textContent complet par delta
// serait O(n²) en écritures DOM sur un long raisonnement. La dernière mise à
// jour en attente est écrasée ; le flush final passe par flushReasoning.
function setReasoning(wrap, text) {
  if (!text) return;
  _reasonPending = { wrap, text };
  if (_reasonTimer) return;
  _reasonTimer = setTimeout(() => {
    _reasonTimer = null;
    const p = _reasonPending;
    _reasonPending = null;
    if (p) renderReasoningNow(p.wrap, p.text);
  }, 90);
}

// Annule un rendu de raisonnement en attente (avant un finalize/reset, pour
// qu'un timer en vol ne réécrive pas un état périmé). Symétrique de
// cancelStreamRender pour le contenu.
function cancelReasoningRender() {
  if (_reasonTimer) { clearTimeout(_reasonTimer); _reasonTimer = null; }
  _reasonPending = null;
}

// Flush synchrone du raisonnement définitif : annule le throttle en vol et écrit
// la valeur finale d'un coup. Sans lui, les derniers tokens manqueraient au live
// (la valeur persistée, issue de onFinal, reste complète quoi qu'il arrive).
function flushReasoning(wrap, text) {
  cancelReasoningRender();
  renderReasoningNow(wrap, text);
}

// Toggle global (référencé en onclick= inline). Déplie/replie le bloc.
function toggleReasoning(btn) {
  const wrap = btn.closest('.msg');
  const panel = wrap && wrap.querySelector('.reasoning');
  if (!panel) return;
  const opening = panel.hasAttribute('hidden');
  if (opening) {
    panel.removeAttribute('hidden');
    btn.classList.add('open');
    const content = panel.querySelector('.reasoning-content');
    if (content) content.scrollTop = content.scrollHeight;
  } else {
    panel.setAttribute('hidden', '');
    btn.classList.remove('open');
  }
  // Pas de scrollBottom() ici : consulter le raisonnement d'un message ancien
  // ne doit pas ramener la vue en bas du fil.
}

// En-tête (langage + boutons copier/télécharger) sur chaque <pre>.
function decoratePre(scope) {
  const svgCopy = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const svgCheck = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const svgDl = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  // Pictogramme « diagramme » (3 nœuds reliés) — toggle rendu ↔ source des
  // blocs mermaid. Métaphore réservée à cet usage (vocabulaire d'icônes).
  const svgDiagram = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="12" cy="18" r="3"/><path d="M7.5 8.7 10.5 15.4"/><path d="M16.5 8.7 13.5 15.4"/><path d="M9 6h6"/></svg>`;
  // Pictogramme « œil » — aperçu sandboxé des blocs html/svg (lot E, D2).
  // Métaphore réservée à cet usage (vocabulaire d'icônes).
  const svgEye = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;

  scope.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-head')) return;
    const code = pre.querySelector('code');
    let lang = 'text';
    if (code) {
      const m = (code.className || '').match(/language-([\w-]+)/);
      if (m) lang = m[1];
    }
    const head = document.createElement('div');
    head.className = 'code-head';
    head.innerHTML =
      `<span class="code-lang">${escHtml(lang)}</span>` +
      `<div class="code-actions">` +
      // Toggle mermaid : présent dès le décor (y compris pendant le streaming)
      // mais caché — révélé par renderMermaidUnder au premier rendu réussi.
      (isMermaidLang(lang) ? `<button class="code-mmd-toggle" title="Diagramme / source" hidden>${svgDiagram}</button>` : '') +
      // Aperçu sandboxé (D2) : clic EXPLICITE uniquement, jamais automatique.
      (isPreviewableLang(lang) ? `<button class="code-preview-btn" title="Aperçu">${svgEye}</button>` : '') +
      `<button class="code-copy" title="Copier">${svgCopy}</button>` +
      `<button class="code-dl" title="Télécharger">${svgDl}</button>` +
      `</div>`;
    const mmdToggle = head.querySelector('.code-mmd-toggle');
    if (mmdToggle) mmdToggle.onclick = () => {
      // Ne bascule que si une vue rendue existe (le bouton est caché sinon,
      // ceinture-bretelles) ; l'inversion visuelle est portée par le CSS.
      if (pre.querySelector('.mermaid-view')) pre.classList.toggle('mermaid-rendered');
    };
    const pvBtn = head.querySelector('.code-preview-btn');
    if (pvBtn) pvBtn.onclick = () => {
      // Frontière de sécurité (piège 23) : le markup d'origine modèle n'atteint
      // une surface de rendu QUE via cette iframe sandbox="allow-scripts",
      // JAMAIS avec allow-same-origin (origine opaque : pas de localStorage/
      // IndexedDB/DOM parent). srcdoc posé par PROPRIÉTÉ sur un élément créé
      // par createElement — jamais interpolé dans un template string HTML.
      let box = pre.querySelector('.code-preview');
      if (!box) {
        box = document.createElement('div');
        box.className = 'code-preview';
        const close = document.createElement('button');
        close.className = 'code-preview-close';
        close.title = "Fermer l'aperçu";
        close.textContent = '×';
        close.onclick = () => { box.remove(); pre.classList.remove('preview-open'); };
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-scripts');
        box.appendChild(close);
        box.appendChild(frame);
        pre.appendChild(box);
      }
      // Re-clic = re-render depuis la source COURANTE (source de vérité unique).
      box.querySelector('iframe').srcdoc = buildPreviewSrcdoc(lang, code ? code.textContent : '');
      pre.classList.add('preview-open');
    };
    head.querySelector('.code-copy').onclick = () => {
      navigator.clipboard.writeText(code ? code.textContent : '').then(() => {
        const btn = head.querySelector('.code-copy');
        btn.innerHTML = svgCheck;
        btn.classList.add('code-copy--checked');
        setTimeout(() => { btn.innerHTML = svgCopy; btn.classList.remove('code-copy--checked'); }, 1400);
      });
    };
    head.querySelector('.code-dl').onclick = () => {
      const rawName = code ? code.getAttribute('data-filename') : '';
      const dlName = sanitizeDownloadName(rawName, lang) || ('miaou-snippet.' + langExt(lang));
      downloadFile(dlName, code ? code.textContent : '', 'text/plain');
    };
    pre.insertBefore(head, pre.firstChild);
  });
}

// Télécharge le contenu brut (markdown source) d'un message assistant, précédé
// de la trace des acks enrichis (args+result) de son tour — mêmes acks que
// placeToolAck affiche dans la bulle, retrouvés via msgIndex en remontant
// currentThread (cf. downloadConvMd pour le même motif sur l'export complet).
// Le contenu est stocké dans body.dataset.raw au moment du finalize/buildMsg.
function downloadMsgMd(btn) {
  const wrap = btn.closest('.msg');
  const body = wrap && wrap.querySelector('.body');
  const raw = body && body.dataset.raw;
  if (!raw) return;
  const idx = msgIndex(wrap);
  const acks = [];
  if (idx > 0) {
    for (let i = idx - 1; i >= 0 && isAckRole(currentThread[i].role); i--) {
      if (currentThread[i].args != null) acks.unshift(currentThread[i]);
    }
  }
  const trace = acks.length ? formatToolAcksMd(acks) + '\n\n' : '';
  const msg = idx >= 0 ? currentThread[idx] : null;
  const modelStr = (msg && msg.model) ? ' (' + msg.model + ')' : '';
  const header = '### MIAOU' + modelStr + '\n\n';
  downloadFile('miaou-message.md', header + trace + raw, 'text/markdown');
}

// Copie le markdown source d'un message (bulle assistant ou user) dans le
// presse-papier. Assistant : body.dataset.raw (même source que downloadMsgMd,
// pas d'en-tête ni de trace d'outils). User : le littéral tapé (displayText
// si présent — slash-commande skill —, sinon content), jamais le corps baké.
// Feedback visuel identique à code-copy (decoratePre) : swap SVG check ~1400 ms.
function copyMsg(btn) {
  const wrap = btn.closest('.msg');
  if (!wrap) return;
  let text;
  if (wrap.classList.contains('assistant')) {
    const body = wrap.querySelector('.body');
    text = body && body.dataset.raw;
  } else {
    const idx = msgIndex(wrap);
    const m = idx >= 0 ? currentThread[idx] : null;
    text = m ? (m.displayText ?? m.content) : null;
  }
  if (!text) return;
  // width/height inline obligatoires : les boutons méta assistant n'ont pas de
  // règle CSS de dimensionnement svg (contrairement à .msg-copy-user), un svg nu
  // s'y rendrait à taille dégénérée.
  const svgCheck = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  const svgCopy = btn.innerHTML;
  navigator.clipboard.writeText(text).then(() => {
    btn.innerHTML = svgCheck;
    btn.classList.add('msg-copy--checked');
    setTimeout(() => { btn.innerHTML = svgCopy; btn.classList.remove('msg-copy--checked'); }, 1400);
  });
}

// ── Acks d'outils : table pilote (label + capacité d'annulation + icône) ──────
// Source unique de vérité : ajouter un outil traçable = ajouter une ligne, pas
// toucher au renderer. `undo: null` = variante informative sans bouton (lectures).
// `undo` est une fonction (id) => void. Les icônes sont des SVG statiques
// author-controlled (jamais de donnée modèle dedans).
const ICON_MEMORY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const ICON_EYE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_LIST = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
const ICON_WRENCH = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
const ICON_CHEVRON_DOWN = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const ICON_PACKAGE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>';
const ICON_BOOK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>';
// Métaphore code (chevrons < >) — réservée au compute js__eval (lot L), une
// métaphore = un usage (cf. CLAUDE.md, vocabulaire d'icônes).
const ICON_CODE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
// Même tracé que `.code-dl` (decoratePre) — vocabulaire d'icônes, flèche vers
// le bas = télécharger, réservée à cet usage (A3-2, bouton lightbox mode image).
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

// Rendu à deux niveaux partagé par les acks avec intent : intention (niveau 1,
// visible) + détail technique (niveau 2, replié par défaut derrière un chevron).
// `detailText` est le texte simple du niveau 2 ; `detailBuilder(detail)` (optionnel)
// permet un contenu DOM riche (breadcrumb MCP avec <code>/séparateurs) — appelé à la
// place de detailText si fourni.
function renderIntentTwoLevel(el, intent, detailText, detailBuilder) {
  const row = document.createElement('span');
  row.className = 'mcp-intent-row';
  const intentSpan = document.createElement('span');
  intentSpan.className = 'mcp-intent';
  intentSpan.textContent = intent;
  row.appendChild(intentSpan);
  const chevron = document.createElement('button');
  chevron.className = 'mcp-chevron';
  chevron.type = 'button';
  chevron.title = 'Détail technique';
  chevron.innerHTML = ICON_CHEVRON_DOWN;
  const detail = document.createElement('span');
  detail.className = 'mcp-breadcrumb-detail';
  detail.setAttribute('hidden', '');
  if (detailBuilder) {
    detailBuilder(detail);
  } else {
    detail.textContent = detailText;
  }
  row.addEventListener('click', function() {
    if (detail.hasAttribute('hidden')) {
      detail.removeAttribute('hidden');
      chevron.classList.add('open');
    } else {
      detail.setAttribute('hidden', '');
      chevron.classList.remove('open');
    }
  });
  row.appendChild(chevron);
  el.appendChild(row);
  el.appendChild(detail);
}

const ACK_KINDS = {
  memory_create: { destination: 'both', undo: forgetMemory,  icon: ICON_MEMORY, label: m => 'Mémorisé : « ' + (m.content || '') + ' »' },
  memory_update: { destination: 'both', undo: (id, entry) => { if (entry && entry.prevContent != null) editMemory(id, entry.prevContent); }, icon: ICON_EDIT, label: m => 'Souvenir mis à jour : « ' + (m.content || '') + ' »' },
  memory_delete: { destination: 'both', undo: restoreMemory, icon: ICON_TRASH,  label: m => 'Souvenir supprimé' + (m.content ? ' : « ' + m.content + ' »' : '') },
  conversation_read: { destination: 'user', undo: null, icon: ICON_EYE,
    label: m => 'Conversation consultée : « ' + (m.title || 'sans titre') + ' »',
    renderLabel: (m, el) => {
      // Titre cliquable si convId connu (mène à la conversation) — sans changer
      // sa couleur hors survol, cf. .ack-conv-link.
      const titleNode = m.convId
        ? Object.assign(document.createElement('a'), {
            className: 'ack-conv-link',
            href: 'javascript:void(0)',
            textContent: m.title || 'sans titre',
            onclick: () => openConversation(m.convId),
          })
        : document.createTextNode(m.title || 'sans titre');
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Conversation consultée '));
          const sep = document.createElement('span');
          sep.className = 'mcp-call-sep';
          sep.textContent = '›';
          detail.appendChild(sep);
          detail.appendChild(document.createTextNode(' '));
          detail.appendChild(titleNode);
        });
      } else {
        el.appendChild(document.createTextNode('Conversation consultée : « '));
        el.appendChild(titleNode);
        el.appendChild(document.createTextNode(' »'));
      }
    },
  },
  // Énumération des conversations par le modèle : si m.intent est présent, rendu
  // en deux niveaux (intention visible + décompte replié) — même pattern que
  // mcp_call. `label` reste la version texte brut (ackLabel, tests).
  conversation_list: { destination: 'user', undo: null, icon: ICON_LIST,
    label: m =>
      (m.intent ? m.intent + ' : ' : '') + (
        m.count === 0 ? 'Aucune conversation trouvée'
      : m.count === 1 ? '1 conversation listée'
      : (m.count != null ? m.count : '?') + ' conversations listées'),
    renderLabel: (m, el) => {
      const countText =
          m.count === 0 ? 'Aucune conversation trouvée'
        : m.count === 1 ? '1 conversation listée'
        : (m.count != null ? m.count : '?') + ' conversations listées';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, countText);
      } else {
        el.textContent = countText;
      }
    },
  },
  // Appel d'outil MCP distant : breadcrumb `seg1` › `seg2` › … sur chaque `__`.
  // Si m.intent est présent, rendu en deux niveaux : intention (niveau 1, visible)
  // + breadcrumb technique (niveau 2, repliée par défaut via chevron).
  // `label` reste la version texte brut (ackLabel, tests) — breadcrumb uniquement.
  mcp_call: { destination: 'user', undo: null, icon: ICON_WRENCH,
    label: m => 'Appel : ' + (m.name || '').split('__').filter(Boolean).join(' › '),
    renderLabel: (m, el) => {
      const segs = (m.name || '').split('__').filter(Boolean);
      const buildBreadcrumb = detail => {
        detail.appendChild(document.createTextNode('Appel : '));
        segs.forEach((seg, i) => {
          if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'mcp-call-sep';
            sep.textContent = '›';
            detail.appendChild(sep);
          }
          const code = document.createElement('code');
          code.textContent = seg;
          detail.appendChild(code);
        });
      };
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, buildBreadcrumb);
      } else {
        // Fallback : breadcrumb seule (inchangée)
        buildBreadcrumb(el);
      }
    },
  },
  // ── Ressources IDB ──────────────────────────────────────────────────────────
  resource_stored: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Ressource enregistrée : ' + (m.resourceName || m.id || '?'),
  },
  resource_presented: {
    destination: 'user',
    undo: null,
    icon: ICON_EYE,
    label: m => 'Ressource présentée : ' + (m.resourceName || m.id || '?'),
  },
  resource_deleted: {
    destination: 'user',
    undo: null,
    icon: ICON_TRASH,
    label: m => 'Ressource(s) supprimée(s)' + (m.count != null ? ' (' + m.count + ')' : ''),
  },
  // Rappel d'une pièce jointe de message (miaou__recall_attachment, D4 brief A).
  // Même posture que resource_presented (lecture, pas d'undo) mais lookup par
  // attId (conversation-scoped), pas id de ressource — cf. placeToolAck.
  attachment_recalled: {
    destination: 'user',
    undo: null,
    icon: ICON_EYE,
    label: m => 'Pièce jointe rappelée : ' + (m.resourceName || m.attId || '?'),
  },
  // Énumération des skills par le modèle (miaou__skills__list) : informatif, pas
  // d'undo (lecture — même posture que conversation_list, dont on réutilise l'icône).
  skill_list: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m =>
      (m.intent ? m.intent + ' : ' : '') + (
        m.count === 0 ? 'Aucune skill disponible'
      : m.count === 1 ? '1 skill listée'
      : (m.count != null ? m.count : '?') + ' skills listées'),
    renderLabel: (m, el) => {
      const countText =
          m.count === 0 ? 'Aucune skill disponible'
        : m.count === 1 ? '1 skill listée'
        : (m.count != null ? m.count : '?') + ' skills listées';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, countText);
      } else {
        el.textContent = countText;
      }
    },
  },
  // Lecture d'une skill par le modèle (miaou__skills__read) : informatif, pas d'undo
  // (lecture, pas une mutation d'état — même posture que conversation_read).
  skill_read: {
    destination: 'user',
    undo: null,
    icon: ICON_BOOK,
    label: m => 'Skill consultée : ' + (m.title || m.slug || '?'),
    renderLabel: (m, el) => {
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Skill consultée '));
          const sep = document.createElement('span');
          sep.className = 'mcp-call-sep';
          sep.textContent = '›';
          detail.appendChild(sep);
          detail.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
        });
      } else {
        el.textContent = 'Skill consultée : ' + (m.title || m.slug || '?');
      }
    },
  },
  // Création/modification d'une skill par le modèle (miaou__skills__write) :
  // informatif, pas d'undo (cohérent avec l'absence de tombstone sur la
  // suppression de skill — action explicite, pas de undo async IDB introduit ici).
  skill_write: {
    destination: 'user',
    undo: null,
    icon: ICON_EDIT,
    label: m => (m.created ? 'Skill créée : ' : 'Skill modifiée : ') + (m.title || m.slug || '?'),
    renderLabel: (m, el) => {
      const verb = m.created ? 'Skill créée' : 'Skill modifiée';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode(verb + ' '));
          const sep = document.createElement('span');
          sep.className = 'mcp-call-sep';
          sep.textContent = '›';
          detail.appendChild(sep);
          detail.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
        });
      } else {
        el.textContent = verb + ' : ' + (m.title || m.slug || '?');
      }
    },
  },
  // Consultation de l'aide MIAOU par le modèle (miaou__about) : informatif, pas
  // d'undo (lecture — même posture que skill_read).
  about_read: {
    destination: 'user',
    undo: null,
    icon: ICON_BOOK,
    label: m => 'Aide consultée : ' + (m.topic || 'overview'),
    renderLabel: (m, el) => {
      const topic = m.topic || 'overview';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Aide consultée '));
          const sep = document.createElement('span');
          sep.className = 'mcp-call-sep';
          sep.textContent = '›';
          detail.appendChild(sep);
          detail.appendChild(document.createTextNode(' ' + topic));
        });
      } else {
        el.textContent = 'Aide consultée : ' + topic;
      }
    },
  },
  // ── Bibliothèque de fichiers d'espace (lot Cbis) ────────────────────────────
  // Énumération des fichiers de l'espace actif (miaou__files__list) : même
  // posture que skill_list/conversation_list (lecture, pas d'undo).
  files_list: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m =>
      (m.intent ? m.intent + ' : ' : '') + (
        m.count === 0 ? 'Aucun fichier dans la bibliothèque'
      : m.count === 1 ? '1 fichier listé'
      : (m.count != null ? m.count : '?') + ' fichiers listés'),
    renderLabel: (m, el) => {
      const countText =
          m.count === 0 ? 'Aucun fichier dans la bibliothèque'
        : m.count === 1 ? '1 fichier listé'
        : (m.count != null ? m.count : '?') + ' fichiers listés';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, countText);
      } else {
        el.textContent = countText;
      }
    },
  },
  // Lecture d'un fichier de bibliothèque (miaou__files__read) : même posture
  // que skill_read/attachment_recalled (lecture, pas d'undo).
  files_read: {
    destination: 'user',
    undo: null,
    icon: ICON_BOOK,
    label: m => 'Fichier consulté : ' + (m.resourceName || m.id || '?'),
    renderLabel: (m, el) => {
      const name = m.resourceName || m.id || '?';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Fichier consulté '));
          const sep = document.createElement('span');
          sep.className = 'mcp-call-sep';
          sep.textContent = '›';
          detail.appendChild(sep);
          detail.appendChild(document.createTextNode(' ' + name));
        });
      } else {
        el.textContent = 'Fichier consulté : ' + name;
      }
    },
  },
  // Promotion d'une pièce jointe vers la bibliothèque (miaou__files__promote) :
  // informatif seulement, PAS d'undo — la promotion est déjà consent-gated en
  // amont (ask_confirmation, voie B), un undo ici confondrait consentement et
  // réversibilité (brief D2 : « undo n'est pas consentement »).
  file_promote: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Fichier ajouté à la bibliothèque : ' + (m.resourceName || m.id || '?'),
  },
  // Compute sandboxé sur un blob client (miaou__js__eval, lot L) : informatif,
  // pas d'undo (pur compute, aucune écriture d'état). Le code exécuté N'est PAS
  // rendu dans le thread (brief §3 : la doctrine no-silent-action vise les
  // écritures d'état inférées, pas le compute pur) — il n'est capté que dans
  // l'ack pour l'export (champ `code`, cf. formatToolAcksHtml). La ligne de
  // thread annonce seulement le handle et l'issue.
  js_eval: {
    destination: 'user',
    undo: null,
    icon: ICON_CODE,
    label: m => 'Code exécuté sur ' + (m.handle || '?') +
      (m.ok === false ? ' (refusé)' : (m.outLen != null ? ' → ' + m.outLen + ' car.' : '')),
    renderLabel: (m, el) => {
      const tail = m.ok === false ? ' (refusé)' : (m.outLen != null ? ' → ' + m.outLen + ' car.' : '');
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Code exécuté sur '));
          const sep = document.createElement('span');
          sep.className = 'mcp-call-sep';
          sep.textContent = '›';
          detail.appendChild(sep);
          detail.appendChild(document.createTextNode(' ' + (m.handle || '?') + tail));
        });
      } else {
        el.textContent = 'Code exécuté sur ' + (m.handle || '?') + tail;
      }
    },
  },
};

// Wrapper global (testable QuickJS) : résout le label depuis ACK_KINDS.
function ackLabel(kind, m) {
  const spec = ACK_KINDS[kind];
  return spec ? spec.label(m) : 'Action effectuée';
}

function buildToolAck(m) {
  const kind = ackKindOf(m);
  const spec = ACK_KINDS[kind] || { undo: null, icon: '', label: () => 'Action effectuée' };

  const wrap = document.createElement('div');
  wrap.className = 'tool-ack ack-' + (kind || 'unknown') +
    (m.resolved ? ' resolved' : '') +
    (m.error ? ' ack-error' : '') +
    (m.intent ? ' has-intent' : '');
  if (m.id) wrap.dataset.ackId = m.id;

  if (spec.icon) {
    const iconEl = document.createElement('span');
    iconEl.className = 'ack-icon';
    iconEl.innerHTML = spec.icon;   // SVG statique author-controlled uniquement
    wrap.appendChild(iconEl);
  }

  const label = document.createElement('span');
  label.className = 'ack-label';
  // renderLabel : construction DOM riche (breadcrumb avec <code> et séparateur) —
  // réservé aux kinds qui en ont besoin. Sinon textContent (frontière XSS standard).
  if (spec.renderLabel) {
    spec.renderLabel(m, label);
  } else {
    label.textContent = spec.label(m);
  }
  wrap.appendChild(label);

  if (spec.undo) {
    if (m.resolved) {
      const s = document.createElement('span');
      s.className = 'ack-resolved';
      s.textContent = 'annulé';
      wrap.appendChild(s);
    } else {
      const btn = document.createElement('button');
      btn.className = 'ack-undo';
      btn.textContent = 'annuler';
      // On passe l'ENTRÉE et le NŒUD exacts : un create et un delete du même
      // souvenir partagent le même m.id, une recherche par id viserait le mauvais.
      btn.addEventListener('click', () => undoToolAck(m, wrap));
      wrap.appendChild(btn);
    }
  }
  // expand : bouton toggle « voir/masquer » pour les ressources stockées. Le
  // contenu est rendu une seule fois (lazy) dans un conteneur inline.
  // ⚠️ DORMANT / NON BRANCHÉ (audit F, 2026-07-10) : aucun ACK_SPEC ne définit
  // `expand:` aujourd'hui, donc ce bloc ne s'exécute JAMAIS. Les classes
  // `.ack-expand`/`.ack-expand-content` n'ont d'ailleurs aucun style CSS, et
  // `presentResourceFromChip` (le `spec.expand` attendu) n'est câblé nulle part.
  // Conservé sciemment comme jalon d'une feature « déplier une ressource stockée
  // depuis son ack » à finir. Pour l'activer : poser `expand: presentResourceFromChip`
  // sur le spec `resource_stored` (ACK_SPECS) ET styler `.ack-expand*`.
  if (spec.expand && !m.resolved) {
    const expandBtn = document.createElement('button');
    expandBtn.className = 'ack-expand';
    expandBtn.textContent = 'voir';
    const content = document.createElement('div');
    content.className = 'ack-expand-content';
    content.hidden = true;
    let rendered = false;
    expandBtn.addEventListener('click', function() {
      content.hidden = !content.hidden;
      expandBtn.textContent = content.hidden ? 'voir' : 'masquer';
      if (!content.hidden && !rendered) {
        rendered = true;
        spec.expand(m, content);   // presentResourceFromChip (défini dans ui.js)
      }
    });
    wrap.appendChild(expandBtn);
    wrap.appendChild(content);
  }
  return wrap;
}

// Place un ack DANS la bulle assistant, entre l'en-tête (.meta / raisonnement) et
// le corps (.body) : la provenance s'affiche après l'icône+nom du modèle et avant
// le patienteur/la réponse. Si la bulle n'a pas de .body, on append en dernier
// recours. Partagé par le rendu live (onToolAcks/onEarlyAcks) et le reload (renderThread).
// Pour mcp_call : si le serveur a showCalls === false, n'insère pas dans le DOM mais
// retourne null (l'entrée reste dans currentThread — le toggle est render-only).
// ── Groupe d'acks (ticker) : réducteur d'état pur ──────────────────────────
// Pont entrée d'ack → nœud DOM. WeakMap et NON une propriété `entry.__node` :
// l'objet `entry` est le MÊME que celui poussé dans `currentThread` (main.js,
// onEarlyAcks/onToolAcks) puis persisté par saveConversation — y greffer une
// référence DOM la ferait partir en JSON.stringify (clé parasite au store) et
// surtout retiendrait le nœud en mémoire tant que la conversation vit (fuite).
// La WeakMap garde le lien hors de l'objet persisté et laisse le nœud être GC.
const ackNodeOf = new WeakMap();
// État d'un groupe d'acks contigu dans UNE bulle assistant : { acks, mode,
// slotExpanded }. `acks` = descripteurs d'entrée (mêmes objets que placeToolAck
// reçoit), ordre d'arrivée. `mode` = 'compact'|'list'. `slotExpanded` = détail
// visible dans le slot compact, hérité d'un ack à l'autre (brief §3). Aucune
// mutation en place : chaque action renvoie un nouvel état.
function ackGroupInitState() {
  return { acks: [], mode: 'compact', slotExpanded: false };
}
function ackGroupReduce(state, action) {
  const s = state || ackGroupInitState();
  if (action.type === 'arrive') {
    return { acks: s.acks.concat([action.ack]), mode: s.mode, slotExpanded: s.slotExpanded };
  }
  if (action.type === 'toggleMode') {
    return { acks: s.acks, mode: s.mode === 'compact' ? 'list' : 'compact', slotExpanded: s.slotExpanded };
  }
  if (action.type === 'toggleSlot') {
    return { acks: s.acks, mode: s.mode, slotExpanded: !s.slotExpanded };
  }
  return s;
}
// Seuil de bascule visuelle : compact tant que < 2 acks, le mode ne suffit pas
// (un groupe à 1 ack reste transparent même en mode 'compact').
function ackGroupIsCompact(state) {
  return state.mode === 'compact' && state.acks.length >= 2;
}
function ackGroupCount(state) {
  return state.acks.length;
}
function ackGroupVisibleAck(state) {
  return state.acks.length ? state.acks[state.acks.length - 1] : null;
}

// Résolution pure du booléen reduced-motion effectif : préférence système
// injectée en paramètre (jamais de matchMedia interne — testable QuickJS).
function resolveMotionReduced(setting, systemPrefersReduced) {
  if (setting === 'reduced') return true;
  if (setting === 'normal') return false;
  return !!systemPrefersReduced;
}

// Bascule compact/liste animée SIMULTANÉMENT (retour Julien : un flash de
// groupe vide apparaissait avec un enchaînement séquentiel repli-puis-
// agrandissement). Appelé APRÈS renderAckGroup (contenu déjà correct des DEUX
// côtés — `outgoing` est masqué par `hidden` mais son contenu DOM reste
// intact, cf. renderAckGroup : le mode compact ne vide jamais .ack-list, il
// ne fait que le cacher). `outgoingStart` = hauteur mesurée AVANT le
// re-render (le sortant avait encore son ancien contenu visible à ce moment).
// `height` n'anime pas vers/depuis `auto` : on fixe une valeur px de départ
// des deux côtés, un seul rAF pour poser les cibles, cleanup sur
// transitionend de chaque panneau (indépendants, jamais orphelins).
function animateGroupPanelSwap(outgoing, incoming, outgoingStart) {
  const incomingTarget = incoming.scrollHeight;
  outgoing.hidden = false;   // ré-affiché le temps de l'anim (contenu intact)
  outgoing.style.height = outgoingStart + 'px';
  outgoing.style.overflow = 'hidden';
  outgoing.style.opacity = '1';
  outgoing.classList.add('ack-panel-animating');
  incoming.style.height = '0px';
  incoming.style.overflow = 'hidden';
  incoming.classList.add('ack-panel-animating');
  requestAnimationFrame(() => {
    outgoing.style.height = '0px';
    // Fondu du sortant EN PLUS du rétrécissement (les deux panneaux partagent
    // la même cellule de grille — cf. .ack-panels — donc le sortant restait
    // visible par-dessus le texte entrant jusqu'à la toute fin, superposition
    // signalée par Julien) : à hauteur quasi nulle son contenu ne devrait de
    // toute façon plus être lisible, l'opacité masque le résidu avant ça.
    outgoing.style.opacity = '0';
    incoming.style.height = incomingTarget + 'px';
  });
  const onOutEnd = function(ev) {
    if (ev.target !== outgoing || ev.propertyName !== 'height') return;
    outgoing.removeEventListener('transitionend', onOutEnd);
    outgoing.classList.remove('ack-panel-animating');
    outgoing.style.height = '';
    outgoing.style.overflow = '';
    outgoing.style.opacity = '';
    outgoing.hidden = true;   // reconforme à l'état voulu par renderAckGroup
  };
  const onInEnd = function(ev) {
    if (ev.target !== incoming || ev.propertyName !== 'height') return;
    incoming.removeEventListener('transitionend', onInEnd);
    incoming.classList.remove('ack-panel-animating');
    incoming.style.height = '';
    incoming.style.overflow = '';
  };
  outgoing.addEventListener('transitionend', onOutEnd);
  incoming.addEventListener('transitionend', onInEnd);
}

// ── Groupe d'acks (ticker) : partie DOM ─────────────────────────────────────
// Un groupe par bulle assistant (`wrap._ackGroup`), créé paresseusement au 1er
// ack. Porte l'état pur (ackGroupReduce) + les nœuds DOM. Le wrapper est posé
// dès le 1er ack et reste visuellement transparent tant que count < 2 (PLAN
// étape 4, ambiguïté 4 tranchée : pas de re-parent au franchissement du seuil).
function ensureAckGroup(wrap) {
  if (wrap._ackGroup) return wrap._ackGroup;
  const el = document.createElement('div');
  el.className = 'ack-group';
  const slot = document.createElement('div');
  slot.className = 'ack-slot';
  const track = document.createElement('div');
  track.className = 'ticker-track';
  slot.appendChild(track);
  const list = document.createElement('div');
  list.className = 'ack-list';
  list.hidden = true;
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'ack-badge';
  badge.setAttribute('aria-expanded', 'false');
  badge.hidden = true;   // masqué tant que count < 2 (transparence sous le seuil)
  badge.addEventListener('click', () => {
    // Bascule compact/liste (retour Julien : agrandissement/repli vertical
    // SIMULTANÉS, pas séquentiels — sinon un flash de groupe vide entre le
    // repli du panneau sortant et la réécriture du panneau entrant). On
    // mesure le sortant AVANT toute mutation, on ré-affiche (contenu correct
    // tout de suite, renderAckGroup), on mesure l'entrant maintenant peuplé,
    // puis on anime les deux `height` en parallèle dans le même rAF.
    const outgoing = group.state.mode === 'list' ? group.list : group.slot;
    const animate = !motionReduced() && !outgoing.hidden;
    const outgoingStart = animate ? outgoing.scrollHeight : 0;
    group.state = ackGroupReduce(group.state, { type: 'toggleMode' });
    renderAckGroup(group);
    if (!animate) return;
    const incoming = group.state.mode === 'list' ? group.list : group.slot;
    animateGroupPanelSwap(outgoing, incoming, outgoingStart);
  });
  const panels = document.createElement('div');
  panels.className = 'ack-panels';
  panels.appendChild(slot);
  panels.appendChild(list);
  el.appendChild(panels);
  el.appendChild(badge);
  const body = wrap.querySelector('.body');
  if (body) wrap.insertBefore(el, body);
  else wrap.appendChild(el);
  const group = { state: ackGroupInitState(), el, slot, track, list, badge };
  // Slot-expanded (brief §3) : la ligne intent gère déjà son propre toggle
  // DOM (renderIntentTwoLevel, self-contained) ; on écoute en bulle sur .ack-slot
  // pour resynchroniser l'état de GROUPE — donc l'héritage à l'ack suivant —
  // sans toucher à la signature de renderIntentTwoLevel/buildToolAck.
  slot.addEventListener('click', (ev) => {
    if (!ev.target.closest('.mcp-intent-row')) return;
    const visible = ackGroupVisibleAck(group.state);
    const visibleNode = visible && ackNodeOf.get(visible);
    if (!visibleNode) return;
    const detail = visibleNode.querySelector('.mcp-breadcrumb-detail');
    if (!detail) return;
    const nowExpanded = !detail.hasAttribute('hidden');
    if (nowExpanded !== group.state.slotExpanded) {
      group.state = ackGroupReduce(group.state, { type: 'toggleSlot' });
    }
  });
  wrap._ackGroup = group;
  return group;
}

// Ré-affiche l'intégralité du groupe depuis son état (source unique de vérité
// pour le compteur — brief §No silent action). Pas d'animation ici : c'est un
// resync, pas une arrivée (le ticker anime dans addAckAnimated, à part).
function renderAckGroup(group) {
  const count = ackGroupCount(group.state);
  group.el.dataset.count = String(count);
  group.el.dataset.mode = (group.state.mode === 'list' && count >= 2) ? 'list' : 'compact';
  group.badge.hidden = count < 2;
  group.badge.textContent = (group.state.mode === 'list' ? '▴ ' : '') + count + ' étape' + (count > 1 ? 's' : '');
  group.badge.setAttribute('aria-expanded', String(group.state.mode === 'list'));
  const showList = count >= 2 && group.state.mode === 'list';
  group.list.hidden = !showList;
  group.slot.hidden = showList;
  if (showList) {
    // Rebuild depuis l'état (source unique) : un ack a pu arriver pendant que
    // le groupe était en mode compact (donc jamais append à .ack-list), ou le
    // nœud visible a été déplacé dans le track par un précédent rendu compact.
    for (const a of group.state.acks) {
      const n = ackNodeOf.get(a);
      if (n && n.parentNode !== group.list) group.list.appendChild(n);
    }
  } else {
    // Slot compact (ou transparent sous le seuil) : ne montre que le dernier ack.
    const visible = ackGroupVisibleAck(group.state);
    const visibleNode = visible && ackNodeOf.get(visible);
    group.track.querySelectorAll('.tool-ack').forEach(n => { if (n !== visibleNode) n.remove(); });
    if (visibleNode && !group.track.contains(visibleNode)) {
      group.track.appendChild(visibleNode);
    }
    if (visibleNode) applySlotExpanded(visibleNode, group.state.slotExpanded);
    group.track.style.transform = '';
    group.track.classList.remove('animating');
  }
}

// Pré-ouvre/replie le détail d'un nœud .tool-ack déjà construit (héritage
// slot-expanded, brief §3) : ne touche pas à buildToolAck/renderIntentTwoLevel,
// juste l'attribut hidden + la classe .open du chevron.
function applySlotExpanded(node, expanded) {
  const detail = node.querySelector('.mcp-breadcrumb-detail');
  const chevron = node.querySelector('.mcp-chevron');
  if (!detail) return;
  if (expanded) {
    detail.removeAttribute('hidden');
    if (chevron) chevron.classList.add('open');
  } else {
    detail.setAttribute('hidden', '');
    if (chevron) chevron.classList.remove('open');
  }
}

// Ajoute un ack au groupe. `animate` = true en live (arrivée réelle pendant le
// streaming), false au reload (renderThread) — reconstruction, pas arrivée.
function ackGroupAddAck(group, entry, node, animate) {
  ackNodeOf.set(entry, node);   // pont état pur → nœud DOM, hors objet persisté
  const prevVisible = ackGroupVisibleAck(group.state);
  const wasCompact = ackGroupIsCompact(group.state);
  group.state = ackGroupReduce(group.state, { type: 'arrive', ack: entry });
  const nowCompact = ackGroupIsCompact(group.state);
  applySlotExpanded(node, group.state.slotExpanded);

  if (group.state.mode === 'list') {
    group.list.appendChild(node);   // append en bas, sans animation (brief §4)
    renderAckGroup(group);
    return;
  }
  const prevNode = prevVisible && ackNodeOf.get(prevVisible);
  if (!wasCompact || !nowCompact || !animate || !prevNode || motionReduced()) {
    // Pas encore de transition à animer (1er/2e ack, reduced-motion, reload) :
    // dry swap direct.
    renderAckGroup(group);
    return;
  }
  // Arrivée animée en compact : le nœud entrant est déjà en place (empilé sous
  // le sortant dans le track), on measure/translate/cleanup sur transitionend.
  group.track.appendChild(node);
  const outgoing = prevNode;
  const h = outgoing.offsetHeight;
  group.track.classList.add('animating');
  group.track.style.transform = 'translateY(-' + h + 'px)';
  const onEnd = function() {
    group.track.removeEventListener('transitionend', onEnd);
    if (outgoing.parentNode === group.track) outgoing.remove();
    group.track.classList.remove('animating');
    group.track.style.transform = '';
    renderAckGroup(group);   // resync badge/attrs, ne touche plus au track (déjà propre)
  };
  group.track.addEventListener('transitionend', onEnd, { once: true });
}

function placeToolAck(wrap, entry, animate) {
  if (ackKindOf(entry) === 'mcp_call' && entry.server) {
    const srv = getMcpServer(entry.server);
    if (srv && srv.showCalls === false) return null;
  }
  const node = buildToolAck(entry);
  if (wrap) {
    const group = ensureAckGroup(wrap);
    ackGroupAddAck(group, entry, node, animate !== false);
  }
  const body = wrap && wrap.querySelector('.body');
  // resource_presented : rend le bloc ressource (toute classe).
  // resource_stored : rend le bloc pour les binaires uniquement (les inline sont
  // stockés en IDB mais non affichés automatiquement) ; en live, _pendingToolBlocks
  // est non vide (binaires) → on laisse placeToolBlocks les rendre, pas de double.
  const kindNow = ackKindOf(entry);
  const needsBlock = kindNow === 'resource_presented' ||
    (kindNow === 'resource_stored' && typeof getPendingToolBlocks === 'function' && getPendingToolBlocks().length === 0);
  if (needsBlock && entry.id && wrap) {
    const record = typeof getCachedRecord === 'function' ? getCachedRecord(entry.id) : null;
    if (record && (kindNow !== 'resource_stored' || record.class !== 'inline')) {
      const block = makeResourcePresentBlock(record);
      const blockNode = block ? renderToolBlock(block) : null;
      if (blockNode) {
        if (body) wrap.insertBefore(blockNode, body);
        else wrap.appendChild(blockNode);
        if (highlightEnabled && window.Prism) Prism.highlightAll();
      }
    }
  }
  // attachment_recalled : idem resource_presented mais lookup par attId
  // (conversation-scoped) — seules les images ont un bloc visuel à rendre ;
  // texte/binaire sont déjà retournés en clair/descripteur au modèle (rien à afficher ici).
  if (kindNow === 'attachment_recalled' && entry.attId && wrap) {
    const record = typeof getCachedRecordByAttId === 'function' ? getCachedRecordByAttId(entry.attId, entry.convId) : null;
    if (record && record.mime && record.mime.startsWith('image/')) {
      const block = makeResourcePresentBlock(record);
      const blockNode = block ? renderToolBlock(block) : null;
      if (blockNode) {
        if (body) wrap.insertBefore(blockNode, body);
        else wrap.appendChild(blockNode);
      }
    }
  }
  return node;
}

function renderThread(msgs) {
  const thread = $('thread');
  // Titre du welcome courant AVANT vidage : si on re-rend un thread vide alors
  // qu'un accueil était déjà affiché (Nouvelle conversation répétée, bouton ou
  // palette), on garantit un accueil DIFFÉRENT (changement toujours visible).
  const prevWelcome = (thread.querySelector('.welcome-screen .welcome-title') || {}).textContent || '';
  thread.innerHTML = '';
  clearMemoryProposals();   // les cartes de proposition viennent d'être détruites
  if (!msgs || msgs.length === 0) { showWelcome(prevWelcome || undefined); return; }
  // Les acks précèdent dans currentThread l'assistant qu'ils ont nourri ; on les
  // tamponne pour les replacer DANS sa bulle (en-tête, acks, réponse), cohérent
  // avec le rendu live. Repli en blocs autonomes s'ils ne précèdent pas un
  // assistant (cas limite : acks orphelins ou suivis d'un message user).
  let pendingAcks = [];
  for (const m of msgs) {
    if (isAckRole(m.role)) { pendingAcks.push(m); continue; }
    // Bulle user : afficher le littéral tapé (displayText) si présent — slash-
    // commande skill, où content embarque le corps de la skill injectée (invisible à l'UI).
    const shown = (m.role === 'user' && m.displayText != null) ? m.displayText : m.content;
    const wrap = buildMsg(m.role, shown, m.model, m.reasoning, m.ts, m.server, m.truncated, m.attachments);
    if (m.role === 'assistant') {
      for (const a of pendingAcks) placeToolAck(wrap, a, false);
    } else {
      for (const a of pendingAcks) thread.appendChild(buildToolAck(a));
    }
    pendingAcks = [];
    thread.appendChild(wrap);
  }
  for (const a of pendingAcks) thread.appendChild(buildToolAck(a));
  if (highlightEnabled && window.Prism) Prism.highlightAll();
  scrollBottom(true);   // ouverture/rechargement de conversation : toujours au fond
  syncConvDownloadBtn();
  syncLastAssistantActions();
}

// Synchronise les actions réservées à la DERNIÈRE bulle assistant du fil :
// régénérer (feature B) et continuer une troncature (feature C). Masque
// .msg-regen et désactive .msg-continue sur toutes les bulles sauf la
// dernière assistant, et jamais pendant un stream (sending). Le TEXTE du
// bandeau .msg-truncated, lui, reste affiché sur les messages anciens — seul
// le bouton est borné à la dernière bulle (spec brief §C) : on ne le masque
// donc pas (`hidden`), on le désactive (`disabled`) pour ne pas faire
// disparaître le texte qui l'accompagne dans la même bulle. Appelé en fin de
// renderThread, dans finalizeAssistant et dans setSending : trois points où
// l'ensemble des bulles ou l'état sending peuvent changer.
function syncLastAssistantActions() {
  const bubbles = Array.from($('thread').querySelectorAll('.msg.assistant'));
  const last = bubbles[bubbles.length - 1];
  for (const b of bubbles) {
    const regenBtn = b.querySelector('.msg-regen');
    if (regenBtn) regenBtn.hidden = sending || b !== last;
    const continueBtn = b.querySelector('.msg-continue');
    if (continueBtn) continueBtn.disabled = sending || b !== last;
  }
}

function syncConvDownloadBtn() {
  const hasAssistant = currentThread.some(m => m.role === 'assistant');
  const btn = document.querySelector('.conv-dl-btn');
  if (btn) btn.hidden = !hasAssistant;
  const htmlBtn = document.querySelector('.conv-dl-html-btn');
  if (htmlBtn) htmlBtn.hidden = !hasAssistant;
  const retitleBtn = document.querySelector('.conv-retitle-btn');
  if (retitleBtn) retitleBtn.hidden = !hasAssistant;
}

// ── Streaming d'une réponse assistant ───────────────────────────────────────
function appendUserMessage(text, ts, attachments) {
  const welcome = $('thread').querySelector('.welcome-screen');
  if (welcome) welcome.remove();
  const el = buildMsg('user', text, undefined, undefined, ts, undefined, undefined, attachments);
  $('thread').appendChild(el);
  highlightUnder(el);
  scrollBottom(true);   // l'utilisateur vient d'envoyer : toujours suivre
  return el;
}

function startAssistantMessage(model, server) {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.innerHTML = assistantHead(model, '', undefined, server) + `<div class="body"></div>`;
  $('thread').appendChild(wrap);
  startWaiter(wrap.querySelector('.body'));     // état WAITING
  scrollBottom(true);   // nouvelle bulle en réponse à un envoi : toujours suivre
  return wrap;
}

// ── Patienteur animé ────────────────────────────────────────────────────────
// Remplace le caret pendant l'attente (WAITING) et la reprise après un tour
// tool_calls : un mot court qui change par fondu CSS toutes les ~1.8 s, tiré
// au hasard (pas de cycle fixe). Discret, couleur texte secondaire. Jamais
// affiché en même temps que du contenu en streaming (streamInto coupe avant
// de peindre). Deux timers à nettoyer : la rotation et le fondu intermédiaire.
const WAITER_WORDS = [
  'Cogite', 'Médite', 'Triture', 'Décortique', 'Mijote', 'Tisse', 'Rumine',
  'Ausculte', 'Démêle', 'Échafaude', 'Macère', 'Ourdit', 'Tergiverse',
  'Élucubre', 'Pondère', 'Fomente',
];
let _waiterRotate = null;   // setInterval : changement de mot
let _waiterFade = null;     // setTimeout : bascule du texte à mi-fondu

function pickWaiterWord(prev) {
  let w;
  do { w = WAITER_WORDS[Math.floor(Math.random() * WAITER_WORDS.length)]; }
  while (WAITER_WORDS.length > 1 && w === prev);
  return w;
}

function startWaiter(body) {
  stopWaiter();
  body.innerHTML = `<span class="waiter"><span class="waiter-dot"></span><span class="waiter-word">${pickWaiterWord()}</span></span>`;
  const word = body.querySelector('.waiter-word');   // le point animé, lui, demeure
  _waiterRotate = setInterval(() => {
    word.classList.add('fade');                 // opacity → 0 (mot + « … » via transition CSS)
    _waiterFade = setTimeout(() => {
      word.textContent = pickWaiterWord(word.textContent);
      word.classList.add('dots-reset');
      void word.offsetWidth;                    // force reflow → reset animation ::after
      word.classList.remove('dots-reset');
      word.classList.remove('fade');            // opacity → 1
    }, 280);                                     // doit matcher .waiter-word transition
  }, 5400);
}

function stopWaiter() {
  if (_waiterRotate) { clearInterval(_waiterRotate); _waiterRotate = null; }
  if (_waiterFade) { clearTimeout(_waiterFade); _waiterFade = null; }
}

// Rendu en cours de streaming, throttlé : on n'applique le markdown + la
// coloration que par fenêtres de ~90 ms. Chaque frame peinte est complète
// (parsée, décorée, colorée) — jamais d'état intermédiaire non coloré, donc
// pas de scintillement. La dernière mise à jour en attente est écrasée.
let _streamTimer = null;
let _streamPending = null;

function streamInto(wrap, full) {
  stopWaiter();                 // transition WAITING/REASONING → STREAMING
  _streamPending = { wrap, full };
  if (_streamTimer) return;
  _streamTimer = setTimeout(() => {
    _streamTimer = null;
    const p = _streamPending;
    _streamPending = null;
    if (!p) return;
    // isAtBottom() DOIT être lu avant la mutation du DOM ci-dessous : le
    // nouveau contenu fait grandir scrollHeight, donc évalué après il donnerait
    // presque toujours "pas en bas" même quand l'utilisateur suivait le fil.
    const follow = isAtBottom();
    const body = p.wrap.querySelector('.body');
    body.innerHTML = renderMd(p.full) + '<span class="cursor-blink"></span>';
    decoratePre(p.wrap);
    highlightUnder(p.wrap);   // coloration pendant le streaming
    if (follow) scrollBottom(true);
  }, 90);
}

// Annule un rendu de streaming en attente (avant un finalize/reset, pour qu'un
// timer en vol ne réécrive pas un contenu périmé avec le caret par-dessus).
function cancelStreamRender() {
  if (_streamTimer) { clearTimeout(_streamTimer); _streamTimer = null; }
  _streamPending = null;
}

function resetAssistant(wrap) {
  cancelStreamRender();
  cancelReasoningRender();
  startWaiter(wrap.querySelector('.body'));     // reprise d'attente après un tour tool_calls
}

// Révèle l'horodatage inline d'une bulle assistant (heure + séparateur « · »),
// masqués tant que le message n'est pas finalisé. Partagé par les trois chemins
// de finalisation de dispatchSend (onToolTour, onFinal, onHalt — main.js).
function revealMsgTimestamp(wrap, ts) {
  const tsEl = wrap.querySelector('.msg-ts');
  if (tsEl) { tsEl.textContent = formatMessageTime(ts, Date.now()); tsEl.removeAttribute('hidden'); }
  const sepEl = wrap.querySelector('.msg-ts-sep');
  if (sepEl) sepEl.removeAttribute('hidden');
}

// truncated (optionnel, feature C) : pose/retire le bandeau .msg-truncated
// après .body. Les appelants qui ne tronquent jamais (onToolTour, onHalt,
// onError) omettent l'argument — équivaut à false, pas de bandeau.
function finalizeAssistant(wrap, full, truncated) {
  cancelStreamRender();
  cancelReasoningRender();
  stopWaiter();
  const follow = isAtBottom();   // lu avant mutation DOM, cf. streamInto
  const body = wrap.querySelector('.body');
  body.innerHTML = renderMd(full);
  body.dataset.raw = full;
  decoratePre(wrap);
  highlightUnder(wrap);
  renderMermaidUnder(wrap);   // rendu mermaid à la finalisation SEULEMENT (jamais streamInto)
  const copyBtn = wrap.querySelector('.msg-copy');
  if (copyBtn) copyBtn.removeAttribute('hidden');
  const dlBtn = wrap.querySelector('.msg-dl');
  if (dlBtn) dlBtn.removeAttribute('hidden');
  const existingBanner = wrap.querySelector('.msg-truncated');
  if (truncated && !existingBanner) {
    body.insertAdjacentHTML('afterend', truncatedBannerHtml());
  } else if (!truncated && existingBanner) {
    existingBanner.remove();
  }
  syncConvDownloadBtn();
  syncLastAssistantActions();
  if (follow) scrollBottom(true);
}

// ── Édition d'un message utilisateur ────────────────────────────────────────
// Index recalculé au moment du clic (jamais figé au rendu) : position DOM du
// .msg traduite en index currentThread en sautant les entrées tool-ack.
function msgIndex(wrap) {
  const msgs = Array.from($('thread').querySelectorAll('.msg'));
  const domIdx = msgs.indexOf(wrap);
  if (domIdx < 0) return -1;
  // Les tool-ack ne génèrent pas de .msg autonome : l'index DOM ≠ index currentThread.
  // On remonte en comptant uniquement les entrées non-ack.
  let count = 0;
  for (let i = 0; i < currentThread.length; i++) {
    if (isAckRole(currentThread[i].role)) continue;
    if (count === domIdx) return i;
    count++;
  }
  return -1;
}

function onEditMsg(btn) {
  if (sending) return;                          // pas d'édition pendant un stream
  const wrap = btn.closest('.msg');
  if (wrap) enterEditMode(wrap);
}

function enterEditMode(wrap) {
  if (sending) return;
  const index = msgIndex(wrap);
  if (index < 0) return;
  // Source UNIQUE du texte éditable et de la bulle restaurée : displayText (littéral
  // tapé) si présent, sinon content. Jamais le content baké d'une slash-commande
  // skill — sinon la textarea et la bulle (après annulation) fuiteraient le corps injecté.
  const m = currentThread[index];
  const original = m ? (m.displayText != null ? m.displayText : m.content) : '';

  wrap.classList.add('editing');
  const bubble = wrap.querySelector('.bubble');
  // Dropdown sous la textarea (seule différence positionnelle avec le composer,
  // où il est au-dessus) : placé juste APRÈS dans le DOM, AVANT les actions.
  bubble.innerHTML =
    `<textarea class="msg-edit-area" spellcheck="false"></textarea>` +
    `<div class="skill-ac" hidden></div>` +
    `<div class="msg-edit-actions">` +
    `<button class="mb-btn" data-act="cancel">Annuler</button>` +
    `<button class="mb-btn primary" data-act="save">Valider</button>` +
    `</div>` +
    `<div class="msg-edit-error" hidden></div>`;

  const ta = bubble.querySelector('.msg-edit-area');
  const box = bubble.querySelector('.skill-ac');
  const ac = { ta, box, index: -1, trigger: null };
  ta.value = original;
  autoGrow(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  ta.addEventListener('input', () => { autoGrow(ta); clearEditError(wrap); updateSkillAutocomplete(ac); });
  ta.addEventListener('keydown', (e) => {
    if (skillAutocompleteOpen(ac)) {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSkillAcSelection(ac, 1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); moveSkillAcSelection(ac, -1); return; }
      if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); hideSkillAutocomplete(ac); return; }
      if (e.key === 'Tab')       { e.preventDefault(); acceptSkillAcSelection(ac); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acceptSkillAcSelection(ac); return; }
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(wrap, original); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(wrap, ta.value); }
  });
  bubble.querySelector('[data-act="cancel"]').onclick = () => cancelEdit(wrap, original);
  bubble.querySelector('[data-act="save"]').onclick = () => commitEdit(wrap, ta.value);
}

// Annulation : restaure le contenu de la bulle. Le footer (.msg-user-footer :
// boutons + .msg-ts) est un sibling du .bubble (hors de sa portée), il n'est
// pas touché. Les chips d'attachments (brief A) sont réinsérées au même
// emplacement que dans buildMsg (avant le body) — sans quoi elles
// disparaîtraient jusqu'au prochain reload (le message, lui, les porte toujours).
function cancelEdit(wrap, original) {
  wrap.classList.remove('editing');
  const index = msgIndex(wrap);
  const m = index >= 0 ? currentThread[index] : null;
  const bubble = wrap.querySelector('.bubble');
  bubble.innerHTML =
    renderMsgAttachments(m && m.attachments, currentConvId) +
    `<div class="body">${renderUserMd(original)}</div>`;
  decoratePre(wrap);
  highlightUnder(wrap);
}

// Validation : recalcule l'index (le thread n'a pas bougé, mais on ne fige rien)
// puis délègue la troncature + relance à editUserMessage (main.js). Un slug skill
// invalide remonte une erreur affichée SOUS LA ZONE D'ÉDITION (pas le composer) ;
// le thread reste intact et la bulle en mode édition pour correction. En cas de
// succès, editUserMessage re-rend le thread → la bulle d'édition (et son erreur)
// disparaissent.
async function commitEdit(wrap, value) {
  const t = (value || '').trim();
  if (!t) return;
  const index = msgIndex(wrap);
  if (index < 0) return;
  const err = await editUserMessage(index, t);
  if (err) showEditError(wrap, err);
}

function showEditError(wrap, msg) {
  const el = wrap && wrap.querySelector('.msg-edit-error');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}
function clearEditError(wrap) {
  const el = wrap && wrap.querySelector('.msg-edit-error');
  if (el) { el.setAttribute('hidden', ''); el.textContent = ''; }
}

// ── Indicateur d'activité en arrière-plan ───────────────────────────────────
// Point d'entrée unique avec compteur, pour gérer les chevauchements.
let _bgCount = 0;
function bgActivityStart(label) {
  _bgCount++;
  $('bg-label').textContent = label;
  $('bg-activity').classList.add('active');
}
function bgActivityEnd() {
  _bgCount = Math.max(0, _bgCount - 1);
  if (_bgCount === 0) $('bg-activity').classList.remove('active');
}
function bgActivityLabel(label) {
  $('bg-label').textContent = label;
}

// ── Sidebar / sections temporelles ──────────────────────────────────────────
// En-tête de section de la sidebar. Bornes calendaires via calendarBucket
// (utils.js) — partagées avec relativeWhen.
function sectionFor(ts) {
  if (!ts) return 'Plus ancien';
  switch (calendarBucket(ts, Date.now()).bucket) {
    case 'today':     return "Aujourd'hui";
    case 'yesterday': return 'Hier';
    case 'week':      return '7 derniers jours';
    case 'month':     return '30 derniers jours';
    default:          return 'Plus ancien';
  }
}

// Libellé de date d'une conversation dans la sidebar. Même découpage calendaire
// que sectionFor (calendarBucket), formatage distinct : le jour même affiche
// l'heure (HH:MM) plutôt que « aujourd'hui », redondant avec l'en-tête de section.
function relativeWhen(ts) {
  if (!ts) return '';
  const b = calendarBucket(ts, Date.now());
  const hhmm = () => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (b.bucket === 'today') return hhmm();
  if (b.bucket === 'yesterday') return 'hier à ' + hhmm();
  if (b.daysAgo < 7) return 'il y a ' + b.daysAgo + ' j';
  if (b.daysAgo < 30) return 'il y a ' + Math.floor(b.daysAgo / 7) + ' sem';
  return new Date(ts).toLocaleDateString('fr-FR', { month: 'long' });
}

// Filtre de recherche courant (prédicat sur une conversation), ou null pour
// « tout afficher ». Persistant : conservé à travers les re-rendus (maj en
// arrière-plan, sélection, etc.) tant que le champ de recherche n'est pas vidé.
let convSearchFilter = null;

// Prédicat de recherche : match direct (sous-chaîne) sur le titre, ou
// recouvrement de mots-clés sur le résumé via le scoring existant (seuil bas,
// plus permissif que l'injection automatique), ou enfin scan du contenu des
// messages (à partir de 3 caractères, cf. plus bas). null si requête vide.
function searchConversations(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  const qTokens = tokenize(q);
  // Un seul parse des résumés, capturé par la closure : le prédicat est appelé
  // une fois par conversation, sans re-désérialiser tout le blob à chaque appel.
  // Instantané pris à la frappe (rafraîchi à la frappe suivante) — cf. perf.
  const summaries = loadSummaries();
  // Idem pour les conversations complètes (avec messages) : `listAllConversations`
  // ne renvoie que des métadonnées, il faut l'instantané brut pour scanner le
  // contenu. Un seul parse par frappe, comme pour les résumés ci-dessus — pas
  // de re-parse par conversation candidate. Map id → conversation pour un accès
  // direct (évite un .find() linéaire répété).
  const convById = q.length >= 3 ? new Map(loadConversations().map(c => [c.id, c])) : null;
  return c => {
    if ((c.title || '').toLowerCase().includes(q)) return true;
    const entry = summaries[c.id];
    if (entry && !entry.suppressed && entry.summary && scoreSummary(qTokens, entry) >= 1) return true;
    // Sous 3 caractères, le bruit d'un scan substring domine : pas de scan contenu.
    if (!convById) return false;
    const full = convById.get(c.id);
    if (!full || !Array.isArray(full.messages)) return false;
    for (const m of full.messages) {
      // Les acks (tool-ack/memory-ack) portent des `result` potentiellement
      // énormes et hors-sujet : ignorés. Le champ `reasoning` aussi (pas du
      // contenu adressé à l'utilisateur).
      if (isAckRole(m.role)) continue;
      // Côté user : le littéral tapé (displayText), jamais le corps baké d'une
      // slash-skill (content contient aussi le corps de la skill injectée).
      const text = m.role === 'user' ? (m.displayText ?? m.content) : m.content;
      if (typeof text === 'string' && text.toLowerCase().includes(q)) return true;
    }
    return false;
  };
}

function onConvSearch() {
  const input = $('conv-search');
  $('search-clear').classList.toggle('show', !!input.value);
  convSearchFilter = searchConversations(input.value);
  renderConvList();
}

// Ramène l'élément de conversation actif dans la partie visible de la liste.
// Sans effet si aucune conversation active. Fonctionne même sidebar masquée
// (scrollIntoView agit sur le conteneur overflow hors écran) : on la retrouve
// déjà en vue à sa réouverture. `block` = 'nearest' par défaut (scroll minimal,
// pas de mouvement si déjà visible) ; 'center' pour dégager la conv du bord.
function revealActiveConv(block) {
  const active = $('conv-list').querySelector('.conv.active');
  if (active) active.scrollIntoView({ block: block || 'nearest' });
}

function clearConvSearch() {
  const input = $('conv-search');
  input.value = '';
  $('search-clear').classList.remove('show');
  convSearchFilter = null;
  renderConvList();
  // La sélection courante (potentiellement très ancienne) peut être hors écran
  // une fois la liste complète restaurée : on la ramène dans le champ visible.
  revealActiveConv();
  input.focus();
}

// ── Suppression en deux temps (« armer puis confirmer ») ────────────────────
// Premier clic : le bouton passe en état armé (.armed, mis en évidence) pendant
// ARM_DELETE_MS ; second clic dans la fenêtre : exécution. Timeout → désarmé.
// Évite un dialog natif (cohérence UI) tout en protégeant d'un clic raté au
// survol. Générique : poubelle de la sidebar (conversations) et boutons
// « Supprimer » des cartes MCP/API/skills. `armedLabel` (optionnel) remplace le
// texte du bouton pendant l'armement (boutons textuels) ; les boutons icône
// s'appuient sur la classe .armed + le title.
const ARM_DELETE_MS = 2600;

function armThenRun(btn, onConfirm, armedLabel) {
  if (btn.classList.contains('armed')) {
    clearTimeout(btn._disarmTimer);
    btn.classList.remove('armed');
    onConfirm();
    return;
  }
  btn.classList.add('armed');
  btn._origTitle = btn.title;
  btn.title = 'Cliquer à nouveau pour confirmer';
  if (armedLabel != null) { btn._origLabel = btn.textContent; btn.textContent = armedLabel; }
  btn._disarmTimer = setTimeout(() => {
    btn.classList.remove('armed');
    btn.title = btn._origTitle || '';
    if (armedLabel != null && btn._origLabel != null) btn.textContent = btn._origLabel;
  }, ARM_DELETE_MS);
}

// Handler global de la poubelle sidebar (référencé en onclick= inline).
function onConvDel(btn, id) {
  armThenRun(btn, () => deleteConv(id));
}

// Icônes d'épingle (pleine = épinglé, contour = à épingler).
const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 10.76V4h6v6.76a2 2 0 0 0 .59 1.42L18 14.5H6l2.41-2.32A2 2 0 0 0 9 10.76z"/></svg>';

// ── Mode sélection / déplacement de conversations entre Spaces (brief Cter) ──
// Rien de visible au repos (contrainte UX dure du brief) : `_moveMode` gouverne
// la classe `.select-mode` sur #conv-list (affiche les checkboxes) et la
// présence de la barre contextuelle (#move-bar). `_moveSelection` (Set d'ids)
// est l'état source, relu par convItemEl à chaque reconstruction de la liste
// (renderConvList ne préserve aucun état DOM, cf. audit §1).
let _moveMode = false;
let _moveSelection = new Set();

// Déclenché par l'item du menu Space (D1). Pas de vérification ici sur le
// nombre de Spaces disponibles : renderSpaceMenu masque déjà l'item si
// loadSpaces().length < 2 (aucune destination possible).
// Préselectionne la conversation actuellement affichée (si présente dans le
// Space actif) : geste le plus probable en entrant en mode déplacement.
function enterMoveMode() {
  _moveMode = true;
  _moveSelection = currentConvId ? new Set([currentConvId]) : new Set();
  renderConvList();
  renderMoveBar();
}

// Sortie du mode, quelle qu'en soit la cause (Cancel, move effectué, envoi
// d'un message — D5). Un seul point de sortie, ré-utilisé partout : évite
// la logique éparpillée que le brief proscrit explicitement.
function exitMoveMode() {
  if (!_moveMode) return;
  _moveMode = false;
  _moveSelection = new Set();
  renderConvList();
  renderMoveBar();
}

// Appelée uniquement si le mode est actif — évite tout re-render superflu sur
// le chemin d'envoi normal (hors mode sélection, l'appel est un no-op immédiat).
function exitMoveModeIfActive() {
  if (_moveMode) exitMoveMode();
}

function toggleConvSelection(id, checked) {
  if (checked) _moveSelection.add(id); else _moveSelection.delete(id);
  renderMoveBar();
}

function convItemEl(c) {
  const el = document.createElement('div');
  el.className = 'conv' + (c.id === currentConvId ? ' active' : '') + (c.pinned ? ' pinned' : '');
  el.onclick = () => selectConv(c.id);
  const checked = _moveSelection.has(c.id) ? ' checked' : '';
  el.innerHTML =
    `<input type="checkbox" class="conv-select" onclick="event.stopPropagation();toggleConvSelection('${c.id}',this.checked)"${checked}>
     <div class="conv-body">
       <div class="conv-title">${escHtml(c.title || 'Nouvelle conversation')}</div>
       <div class="conv-date" title="${escHtml(formatFullDateFr(c.updatedAt || c.timestamp))}">${escHtml(relativeWhen(c.updatedAt || c.timestamp))}</div>
     </div>
     <div class="conv-actions">
       <button class="conv-pin" title="${c.pinned ? 'Désépingler' : 'Épingler'}" onclick="event.stopPropagation();togglePin('${c.id}')">${PIN_SVG}</button>
       <button class="conv-del" title="Supprimer" onclick="event.stopPropagation();onConvDel(this,'${c.id}')">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
       </button>
     </div>`;
  return el;
}

function sectionEl(label) {
  const s = document.createElement('div');
  s.className = 'conv-section';
  s.textContent = label;
  return s;
}

function renderConvList() {
  const list = $('conv-list');
  list.innerHTML = '';
  list.classList.toggle('select-mode', _moveMode);
  const all = listAllConversations().filter(c => c.spaceId === activeSpaceId);
  $('conv-search').disabled = all.length === 0;
  let convs = all;
  if (convSearchFilter) convs = convs.filter(convSearchFilter);

  // Section « Épinglé » en tête (au singulier, choix assumé), si au moins une.
  const pinned = convs.filter(c => c.pinned);
  if (pinned.length) {
    list.appendChild(sectionEl('Épinglé'));
    for (const c of pinned) list.appendChild(convItemEl(c));
  }

  // Le reste, regroupé par tranches temporelles.
  let lastSection = null;
  for (const c of convs) {
    if (c.pinned) continue;
    const section = sectionFor(c.updatedAt || c.timestamp);
    if (section !== lastSection) {
      list.appendChild(sectionEl(section));
      lastSection = section;
    }
    list.appendChild(convItemEl(c));
  }
}

// Barre contextuelle (D4) : n'apparaît qu'à ≥1 conversation cochée, en mode
// sélection. Reconstruite à chaque changement de sélection (toggleConvSelection)
// ou de mode (enterMoveMode/exitMoveMode) — coût négligeable, pas d'état DOM
// à préserver entre deux renders (cfgPillSelect est reconstruit avec la même
// value à chaque fois, cohérent avec le pattern conv-list).
function renderMoveBar() {
  const bar = $('move-bar');
  if (!bar) return;
  if (!_moveMode) {
    bar.innerHTML = '';
    bar.classList.remove('show');
    return;
  }
  bar.classList.add('show');
  bar.innerHTML = '';

  const count = document.createElement('div');
  count.className = 'move-bar-count';
  const n = _moveSelection.size;
  count.textContent = n > 0
    ? `Déplacer ${n} conversation${n > 1 ? 's' : ''} vers…`
    : 'Sélectionner des conversations à déplacer…';
  bar.appendChild(count);

  const row = document.createElement('div');
  row.className = 'move-bar-row';
  const destinations = loadSpaces().filter(s => s.id !== activeSpaceId).map(s => ({ value: s.id, label: s.name || '' }));
  let pill = null;
  if (destinations.length) {
    pill = cfgPillSelect('move-bar-dest', destinations, destinations[0].value, null);
    row.appendChild(pill.root);
  }

  // Groupés pour que le retour à la ligne (manque de place) déplace les deux
  // boutons ensemble plutôt que de les séparer l'un de l'autre.
  const actions = document.createElement('div');
  actions.className = 'move-bar-actions';

  const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'move-bar-go';
  moveBtn.title = 'Déplacer';
  moveBtn.disabled = n === 0 || !pill;
  moveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  if (pill) moveBtn.onclick = () => moveSelectedConversations(pill.input.value);
  actions.appendChild(moveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'move-bar-cancel';
  cancelBtn.title = 'Annuler';
  cancelBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  cancelBtn.onclick = () => exitMoveMode();
  actions.appendChild(cancelBtn);

  row.appendChild(actions);
  bar.appendChild(row);
}

function isMobileLayout() { return window.innerWidth < 768; }

function closeSidebarMobile() {
  $('app').classList.remove('sidebar-open');
  $('sidebar-backdrop').classList.remove('show');
  document.body.style.overflow = '';
}

// Fermeture de la sidebar via Escape (dernier recours de la cascade, cf. plus
// bas) : même effet que closeSidebarMobile en layout mobile (backdrop +
// overflow), simple retrait de la classe sur desktop (pas de backdrop).
function closeSidebarViaEscape() {
  if (!$('app').classList.contains('sidebar-open')) return false;
  if (isMobileLayout()) closeSidebarMobile();
  else $('app').classList.remove('sidebar-open');
  return true;
}

function toggleSidebar() {
  const app = $('app');
  if (isMobileLayout()) {
    const opening = !app.classList.contains('sidebar-open');
    app.classList.toggle('sidebar-open');
    $('sidebar-backdrop').classList.toggle('show', opening);
    document.body.style.overflow = opening ? 'hidden' : '';
  } else {
    app.classList.toggle('sidebar-open');
  }
}

function initVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    document.documentElement.style.setProperty('--vvh', vv.height + 'px');
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

// ── Redimensionnement de la sidebar (drag du bord droit) ────────────────────
// Largeur bornée [min = largeur d'origine, max = ×2], persistée dans les
// réglages. On pilote la variable CSS --sidebar-w ; pendant le drag la classe
// .resizing coupe la transition pour un suivi 1:1 du curseur.
const SIDEBAR_MIN = 264;
const SIDEBAR_MAX = SIDEBAR_MIN * 2;
let _sidebarW = SIDEBAR_MIN;

function applySidebarWidth(w) {
  _sidebarW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(w)));
  $('app').style.setProperty('--sidebar-w', _sidebarW + 'px');
  return _sidebarW;
}

function initSidebarResize() {
  applySidebarWidth(loadSettings().sidebarWidth || SIDEBAR_MIN);

  const handle = $('sidebar-resizer');
  const sidebar = document.querySelector('.sidebar');
  if (!handle || !sidebar) return;

  let dragging = false, startX = 0, startW = 0;

  const onMove = (e) => {
    if (!dragging) return;
    applySidebarWidth(startW + (e.clientX - startX));
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sidebar.classList.remove('resizing');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    saveSettings({ sidebarWidth: _sidebarW });   // persiste la largeur finale
  };

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = _sidebarW;
    sidebar.classList.add('resizing');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function setTitle(t) {
  $('conv-title').textContent = t || '';
  document.title = (t || 'Nouvelle conversation') + ' — MIAOU';
}

// Placeholder + hint du champ clef d'une carte serveur API, selon
// REQUIRE_API_KEY (figé au build). Appelé à la construction de chaque carte
// (buildApiCard) plutôt qu'une fois à l'init : la cible n'est plus un champ
// settings global mais un input par carte.
function apiKeyFieldHint() {
  return REQUIRE_API_KEY
    ? { placeholder: 'Clef API', hint: 'Authentification requise.' }
    : { placeholder: '(vide si non requise)', hint: "Laissez vide si l'endpoint n'exige pas d'authentification." };
}

// ── État configuré / non configuré ──────────────────────────────────────────
function syncConfigured() {
  const cfg = activeApiConfig();
  configured = !!(cfg.url && (cfg.key || !REQUIRE_API_KEY));

  const wrap = $('input-wrap');
  const ta = $('composer-text');
  const send = $('send-btn');
  const dot = $('conn-dot');

  if (configured) {
    wrap.classList.remove('disabled');
    ta.placeholder = 'Message…';
    ta.disabled = false;
    send.disabled = false;   // pendant un stream le bouton sert de « stop » : jamais désactivé
    dot.className = 'dot ok';
  } else {
    wrap.classList.add('disabled');
    ta.placeholder = 'API non configurée — ouvrir les paramètres';
    ta.disabled = true;
    send.disabled = true;
    dot.className = 'dot err';
  }
}

function setSending(on) {
  sending = on;
  setComposerStreaming(on);
  const send = $('send-btn');
  // Pendant l'envoi le bouton devient « stop » (cliquable) ; sinon il dépend du
  // seul état configuré. Une confirmation en attente NE bloque pas l'envoi : la
  // saisie libre vaut réponse/correction et lève le widget (dismiss-on-send).
  if (send) send.disabled = on ? false : !configured;
  // Export de conversation masqué pendant le streaming (contenu incomplet).
  const convDl = document.querySelector('.conv-dl-btn');
  if (convDl) convDl.disabled = on;
  const convDlHtml = document.querySelector('.conv-dl-html-btn');
  if (convDlHtml) convDlHtml.disabled = on;
  const retitleBtn = document.querySelector('.conv-retitle-btn');
  if (retitleBtn) retitleBtn.disabled = on;
  syncLastAssistantActions();   // le bouton régénérer disparaît pendant un stream
  // Readonly relay (lot J, J5) : signaler aux autres onglets le début/fin de
  // génération sur la conv affichée. Point de fin UNIQUE (couvre succès/erreur/
  // abort) → appariement -started/-ended garanti. convId capturé = currentConvId
  // au démarrage (on génère toujours sur la conv affichée).
  if (on) { if (typeof startGenerationRelay === 'function') startGenerationRelay(currentConvId); }
  else    { if (typeof stopGenerationRelay === 'function') stopGenerationRelay(); }
  // Fin de génération locale : rejouer les actions de synchro multi-onglets
  // différées pendant qu'une génération mutait currentThread (lot J, J3). Point
  // de fin UNIQUE (couvre succès/erreur/abort), d'où le drain ici et pas ailleurs.
  if (!on && typeof drainPendingSync === 'function') drainPendingSync();
}

// Readonly cross-onglets (lot J, J5) : un pair génère sur la conv affichée →
// verrouiller les entrées et mutations LOCALES (composer, édition, suppression,
// régénération) pour empêcher une seconde génération concurrente silencieuse.
// Lecture + scroll restent permis (A6). Piloté par une classe sur <body>
// (.conv-readonly, CSS dans composer.css) + désactivation directe du composer.
// Indépendant de `sending` (état local de génération) : ne PAS s'appuyer sur lui.
// À la levée, on restaure l'état du composer via son seul déterminant hors
// streaming, `configured` (mêmes règles que setSending(false)).
let _convReadonly = false;
function setConvReadonly(on) {
  _convReadonly = !!on;
  document.body.classList.toggle('conv-readonly', _convReadonly);
  const ta = $('composer-text');
  const send = $('send-btn');
  if (on) {
    if (ta) ta.disabled = true;
    if (send) send.disabled = true;
  } else {
    // Ne pas ré-activer si une génération LOCALE est en cours (le composer sert
    // alors de « stop ») ni si l'app n'est pas configurée.
    if (ta) ta.disabled = sending ? false : !configured;
    if (send) send.disabled = sending ? false : !configured;
  }
}

// Bascule l'apparence du bouton du composer entre « envoyer » et « stop ».
function setComposerStreaming(on) {
  const send = $('send-btn');
  if (!send) return;
  send.classList.toggle('streaming', on);
  send.title = on ? 'Arrêter' : 'Envoyer';
}
function setConnDot(state) {
  const dot = $('conn-dot');
  if (dot) dot.className = 'dot ' + (state || '');
}

// Active ou désactive l'état « confirmation en attente ». Le composer reste
// ÉDITABLE (brief §4.5 : la saisie libre vaut réponse/correction) : on se borne
// à poser l'overlay qui dim l'arrière-plan et la classe .confirming qui élève
// composer + carte au-dessus du dim (effet spotlight, clic possible). Partagé
// entre renderMemoryProposals (ancien chemin) et showConfirmation (primitif).
function setConfirmPending(on) {
  _confirmPending = on;
  const backdrop = $('confirm-backdrop');
  const app = $('app');
  if (on) {
    if (backdrop) backdrop.classList.add('show');
    if (app) app.classList.add('confirming');
  } else {
    if (backdrop) backdrop.classList.remove('show');
    if (app) app.classList.remove('confirming');
  }
}

// Lève une confirmation en attente SANS la résoudre (l'utilisateur a tapé une
// réponse libre plutôt que cliquer) : retire toutes les cartes du DOM et désarme
// l'overlay. Distinct de clearMemoryProposals (qui suppose le thread déjà rasé).
function dismissConfirmation() {
  for (const k in _proposalMap) delete _proposalMap[k];
  const containers = document.querySelectorAll('.memory-proposals');
  containers.forEach(c => c.remove());
  setConfirmPending(false);
}

// ── Composer ────────────────────────────────────────────────────────────────
function onComposerKey(e) {
  // Autocomplétion skill ouverte : flèches naviguent, Tab/Entrée complètent,
  // Échap ferme — sans envoyer ni insérer de saut de ligne.
  if (skillAutocompleteOpen(_composerAc)) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSkillAcSelection(_composerAc, 1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveSkillAcSelection(_composerAc, -1); return; }
    if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); hideSkillAutocomplete(_composerAc); return; }
    if (e.key === 'Tab')       { e.preventDefault(); acceptSkillAcSelection(_composerAc); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acceptSkillAcSelection(_composerAc); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending) sendMessage(); }
}

// ── Pièces jointes (composer) : drag & drop + chips ─────────────────────────
// État visuel .dragover sur .input-wrap (pattern .disabled existant, composer.css).
function onComposerDragOver(e) {
  e.preventDefault();
  const wrap = $('input-wrap');
  if (wrap) wrap.classList.add('dragover');
}
function onComposerDragLeave(e) {
  // relatedTarget peut être un enfant de .input-wrap (dragenter/leave imbriqués) —
  // ne retire l'état que si on quitte vraiment le conteneur.
  const wrap = $('input-wrap');
  if (wrap && (!e.relatedTarget || !wrap.contains(e.relatedTarget))) wrap.classList.remove('dragover');
}
function onComposerDrop(e) {
  e.preventDefault();
  const wrap = $('input-wrap');
  if (wrap) wrap.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) handleAttachFiles(files);
}

// Zone de drop étendue à toute la colonne chat (#main-col : topbar + messages
// + composer, hors sidebar/drawers, siblings de .main sous #app) — même
// pipeline handleAttachFiles que .input-wrap, juste une cible plus large pour
// éviter de viser précisément la barre de saisie. .stopPropagation() n'est pas
// nécessaire : .input-wrap n'a pas de handler de bulle distinct à court-circuiter
// (ondragover/drop y sont posés directement, pas de listener sur #main-col
// qui remonterait en double).
function onMainDragOver(e) {
  e.preventDefault();
  const main = $('main-col');
  if (main) main.classList.add('dragover');
}
function onMainDragLeave(e) {
  const main = $('main-col');
  if (main && (!e.relatedTarget || !main.contains(e.relatedTarget))) main.classList.remove('dragover');
}
function onMainDrop(e) {
  e.preventDefault();
  const main = $('main-col');
  if (main) main.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) handleAttachFiles(files);
}

// Collage presse-papier : tout item de type 'file' (image copiée depuis un
// navigateur, OU fichier copié depuis le Finder/Explorateur) est intercepté et
// détourné vers le pipeline d'attachment — le texte collé (cas immensément
// majoritaire) suit son cours natif dans le textarea, non empêché.
// `clipboardData.items` (pas `.files`, absent sur une image collée sans
// fichier réel derrière) donne accès aux Blob via `getAsFile()`.
function onComposerPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (!files.length) return;
  e.preventDefault();
  handleAttachFiles(files);
}

// Icône générique pour un chip sans vignette (texte/binaire, ou image dont le
// blob est absent du cache — fallback gracieux, cf. brief §4).
function attIconSvg() {
  return '<span class="att-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>';
}

// Construit le markup d'un chip d'attachment. `removable` (composer, pré-envoi)
// ajoute le bouton de retrait ; sinon (bulle envoyée) chip en lecture seule
// SAUF pour l'action de promotion (D2 path 2, lot Cbis), qui n'est pertinente
// que pour un attachment déjà envoyé (a un conversationId stable) — d'où
// `conversationId` optionnel en dernier paramètre, absent pour le composer.
// `thumbSrc` (optionnel) : data URL de vignette déjà résolue par l'appelant
// (cf. resolveAttachmentThumb) — fallback gracieux vers l'icône si absente.
function attChipHtml(att, thumbSrc, removable, conversationId) {
  const thumb = thumbSrc
    ? `<img class="att-thumb" src="${thumbSrc}" alt="">`
    : attIconSvg();
  const removeBtn = removable
    ? `<button class="att-remove" title="Retirer" onclick="removeComposerAttachment('${att.attId}')">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`
    : '';
  const promoteBtn = (!removable && conversationId)
    ? `<button class="att-promote" title="Ajouter à la bibliothèque de l'espace" ` +
      `onclick="promoteAttachmentToLibrary(this, '${att.attId}', '${conversationId}')">${ICON_PACKAGE}</button>`
    : '';
  // A3-1 : chip cliquable UNIQUEMENT en bulle envoyée (conversationId truthy) —
  // exclut naturellement composer (inerte, statu quo acté) et export (Gbis,
  // chemin distinct, ne doit jamais porter d'onclick référençant des globals
  // MIAOU absents du fichier exporté).
  const liveAttrs = (!removable && conversationId)
    ? ` onclick="onAttachmentChipClick(event, '${att.attId}', '${conversationId}')" ` +
      `title="${att.kind === 'image' ? 'Agrandir (Cmd/Ctrl+clic : nouvel onglet)' : 'Télécharger'}"`
    : '';
  const chipClass = (!removable && conversationId) ? 'att-chip att-chip-live' : 'att-chip';
  return (
    `<span class="${chipClass}" data-att-id="${att.attId}"${liveAttrs}>` +
    thumb +
    `<span class="att-name" title="${escHtml(att.name)}">${escHtml(att.name)}</span>` +
    `<span class="att-size">${humanSize(att.size)}</span>` +
    removeBtn +
    promoteBtn +
    `</span>`
  );
}

// A3-1 : prédicat pur — quelle action déclenche un clic sur un chip
// d'attachment de bulle envoyée. Séparé du handler DOM pour rester testable
// (QuickJS) sans DOM/cache. `record` peut être null (bytes plus en cache,
// dégradation gracieuse) ; `hasModifier` = event.metaKey || event.ctrlKey.
// Discriminant image : `record.w`/`record.h` (posés uniquement pour une image,
// storeAttachment/resources.js) — `record.class` vaut 'binary' pour une image
// ET un fichier binaire non-image (cf. ingestAttachmentFile, main.js), donc
// inutilisable seul comme discriminant.
function attachmentClickAction(record, hasModifier) {
  if (!record) return null;
  if (record.w && record.h) {
    return hasModifier ? 'tab' : 'lightbox';
  }
  return 'download';
}

// A3-1 : handler global câblé en onclick inline généré (contrainte CLAUDE.md,
// liste des handlers globaux). Ignore les clics issus des boutons existants
// du chip (retrait/promotion, qui portent leur propre onclick) pour ne pas
// déclencher un download/lightbox accidentel.
function onAttachmentChipClick(event, attId, conversationId) {
  if (event.target.closest('.att-promote, .att-remove')) return;
  const record = getCachedRecordByAttId(attId, conversationId);
  const hasModifier = !!(event.metaKey || event.ctrlKey);
  const action = attachmentClickAction(record, hasModifier);
  if (action === 'download') {
    downloadFile(record.name, record.data, record.mime);
  } else if (action === 'tab') {
    openAttachmentInTab(record);
  } else if (action === 'lightbox') {
    openAttachmentLightbox(record);
  }
  // action === null (record absent du cache) : no-op silencieux, même
  // posture que resolveAttachmentThumb.
}

// A3-1 : ouverture nouvel onglet (Cmd/Ctrl+clic sur une image). `data:` est
// bloqué en navigation top-level par les navigateurs — Blob + objectURL,
// révocation différée (une révocation immédiate casse le chargement sur
// certains navigateurs).
function openAttachmentInTab(record) {
  const url = URL.createObjectURL(new Blob([record.data], { type: record.mime }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Promotion utilisateur d'un attachment de message vers la bibliothèque de
// l'espace actif (D2 path 2, lot Cbis) : action explicite en un clic, PAS de
// gate (contrairement à la promotion modèle — c'est déjà un consentement).
// Copie bytes+méta ; l'attachment d'origine reste intact (mêmes sémantiques
// que la promotion modèle, storeLibraryFile). Description absente (D7 la
// génère séparément si le toggle est actif) ; `source` = conversationId
// d'origine.
async function promoteAttachmentToLibrary(btn, attId, conversationId) {
  if (btn.disabled) return;
  btn.disabled = true;
  const record = getCachedRecordByAttId(attId, conversationId);
  if (!record) { btn.disabled = false; return; }
  const stored = await storeLibraryFile(
    activeSpaceId, record.mime, record.name, record.data, record.class,
    conversationId, undefined, Date.now(), Math.random
  );
  if (stored) {
    btn.classList.add('done');
    btn.title = 'Ajouté à la bibliothèque de l\'espace';
    // Trigger D7 fire-and-forget : aucun écran Space ouvert ici pour afficher un
    // statut par carte (l'utilisateur est dans une conversation) — la
    // description, si elle aboutit, sera visible à la prochaine ouverture de
    // l'écran Space.
    describeFileIfNeeded(stored.id);
  } else {
    btn.disabled = false;
  }
}

// Résout une vignette d'image depuis le cache session (peuplé par
// storeAttachment à l'attache, ou loadConversationResources à la réouverture).
// Fallback gracieux (null) si le blob n'est pas/plus disponible.
function resolveAttachmentThumb(att, conversationId) {
  if (att.kind !== 'image') return null;
  const rec = getCachedRecordByAttId(att.attId, conversationId);
  if (!rec || !rec.data) return null;
  return 'data:' + rec.mime + ';base64,' + arrayBufferToBase64(rec.data);
}

// Rafraîchit les chips du composer depuis pendingAttachments (état module-level,
// main.js). Vignettes résolues depuis le cache session (image tout juste attachée,
// donc déjà en cache — cf. storeAttachment/_cacheRecord).
function renderComposerAttachments() {
  const el = $('attach-chips');
  if (!el) return;
  if (!pendingAttachments.length) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = pendingAttachments.map(att =>
    attChipHtml(att, resolveAttachmentThumb(att, currentConvId), true)
  ).join('');
}

// Construit les chips d'une bulle utilisateur ENVOYÉE, depuis message.attachments
// (jamais depuis content — cf. brief A §4). Retourne '' si aucun attachment.
function renderMsgAttachments(attachments, conversationId) {
  if (!attachments || !attachments.length) return '';
  return `<div class="msg-attachments">` +
    attachments.map(att => attChipHtml(att, resolveAttachmentThumb(att, conversationId), false, conversationId)).join('') +
    `</div>`;
}

// ── Dropdown modèle (liste via l'API) ───────────────────────────────────────
// Réutilisé par carte serveur API (buildApiCard) : opère sur les éléments
// input/menu de LA carte plutôt que sur des ids fixes, une carte MCP-like
// pouvant en principe être éditée en même temps qu'une autre.
let _models = [];

async function openApiModelMenu(inputEl, menuEl, urlEl, keyEl) {
  menuEl.classList.add('show');
  menuEl.innerHTML = `<div class="model-loading"><span class="spin"></span>Interrogation de l'API…</div>`;
  const url = urlEl.value.trim();
  const key = keyEl.value.trim();
  if (!url) {
    menuEl.innerHTML = `<div class="model-error">URL non renseignée — saisie manuelle</div>`;
    return;
  }
  try {
    const models = await fetchModels({ url, key });
    _models = models;
    if (!models.length) {
      menuEl.innerHTML = `<div class="model-error">Aucun modèle exposé — saisie manuelle</div>`;
      return;
    }
    renderApiModelOptions(models, inputEl, menuEl, true);
  } catch (e) {
    menuEl.innerHTML = `<div class="model-error">API injoignable — saisie manuelle</div>`;
  }
}

function renderApiModelOptions(models, inputEl, menuEl, scrollToSelected) {
  const cur = inputEl.value.trim();
  menuEl.innerHTML = '';
  models.forEach(m => {
    const o = document.createElement('div');
    o.className = 'model-opt' + (m === cur ? ' selected' : '');
    o.innerHTML = `<span>${escHtml(m)}</span><span class="check">✓</span>`;
    o.onmousedown = (ev) => { ev.preventDefault(); inputEl.value = m; menuEl.classList.remove('show'); };
    menuEl.appendChild(o);
  });
  if (scrollToSelected) {
    const sel = menuEl.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
}

function onApiModelInput(inputEl, menuEl) {
  const q = inputEl.value.trim().toLowerCase();
  renderApiModelOptions(_models.filter(m => m.toLowerCase().includes(q)), inputEl, menuEl);
}

// Ferme tout menu modèle de carte API ouvert au clic ailleurs.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.api-model-anchor')) {
    document.querySelectorAll('#api-list .api-model-anchor .model-menu.show').forEach(m => m.classList.remove('show'));
  }
  if (!e.target.closest('#composer-model')) {
    const cm = $('composer-model-menu');
    if (cm) cm.classList.remove('show');
  }
  if (!e.target.closest('#composer-reasoning')) {
    const cr = $('composer-reasoning-menu');
    if (cr) cr.classList.remove('show');
  }
  if (!e.target.closest('#set-reasoning-select')) {
    const sr = $('set-reasoning-menu');
    if (sr) sr.classList.remove('show');
  }
  // Dropdowns pilule des formulaires (cfgPillSelect — ex. transport MCP).
  if (!e.target.closest('.cfg-pill-select')) {
    document.querySelectorAll('.cfg-pill-select .model-menu.show').forEach(m => m.classList.remove('show'));
  }
  if (!e.target.closest('#space-select')) {
    const sm = $('space-menu');
    if (sm) sm.classList.remove('show');
  }
});

// Cascade Escape (D-Esc) : un seul niveau fermé par pression, priorité au plus
// « au-dessus ». 0) la lightbox Mermaid (overlay plein écran au-dessus de tout,
// lot E3) — 1) une dropdown ouverte (mêmes cibles que le clic extérieur
// ci-dessus) — 2) le mode déplacement de conversations (_moveMode), s'il est
// actif — 3) le drawer/écran le plus récemment ouvert (pile explicite :
// certains écrans s'empilent volontairement sur un autre déjà ouvert, ex.
// openApiServers depuis le drawer Settings — sans pile, Escape fermait
// toujours le premier de la liste au lieu du sommet réellement affiché) —
// 4) en dernier recours, la sidebar (la referme si ouverte, sinon la réaffiche
// — spec Julien, 2026-07-09 : rien d'autre à faire, Esc redonne l'accès au
// slider plutôt que d'être un no-op). Aucun de ces niveaux n'avait de gestion
// clavier avant ce correctif (à l'exception de la sidebar, mobile uniquement
// — étendue ici au desktop).
let _drawerStack = [];
// Enveloppe chaque paire open*/close* de drawer : l'ouverture pousse sur la
// pile (dédoublonnée — rouvrir un écran déjà au sommet ne l'empile pas deux
// fois), la fermeture — quelle qu'en soit la cause (bouton, backdrop, Escape)
// — la retire où qu'elle se trouve dans la pile (fermeture hors-ordre possible
// via un bouton "Annuler" direct, pas seulement Escape).
function trackDrawer(openFn, closeFn) {
  return {
    open: (...args) => {
      _drawerStack = _drawerStack.filter(fn => fn !== closeFn);
      _drawerStack.push(closeFn);
      return openFn(...args);
    },
    close: (...args) => {
      _drawerStack = _drawerStack.filter(fn => fn !== closeFn);
      return closeFn(...args);
    },
  };
}
const _tSettings = trackDrawer(openSettings, closeSettings);
openSettings = _tSettings.open; closeSettings = _tSettings.close;
const _tSummary = trackDrawer(openSummaryDrawer, closeSummaryDrawer);
openSummaryDrawer = _tSummary.open; closeSummaryDrawer = _tSummary.close;
const _tCtx = trackDrawer(openContextInspector, closeContextInspector);
openContextInspector = _tCtx.open; closeContextInspector = _tCtx.close;
const _tTools = trackDrawer(openTools, closeTools);
openTools = _tTools.open; closeTools = _tTools.close;
const _tSpace = trackDrawer(openSpaceScreen, closeSpaceScreen);
openSpaceScreen = _tSpace.open; closeSpaceScreen = _tSpace.close;
const _tMcp = trackDrawer(openMcpServers, closeMcpServers);
openMcpServers = _tMcp.open; closeMcpServers = _tMcp.close;
const _tApi = trackDrawer(openApiServers, closeApiServers);
openApiServers = _tApi.open; closeApiServers = _tApi.close;
const _tSkills = trackDrawer(openSkills, closeSkills);
openSkills = _tSkills.open; closeSkills = _tSkills.close;

// ── Command palette (Ctrl/Cmd+K, lot F) ─────────────────────────────────────
// Overlay type Spotlight : input de filtrage + liste navigable au clavier. Le
// registre est déclaratif (COMMANDS) — ajouter une commande = ajouter une
// entrée, aucun code de palette touché. Chaque `run()` appelle une fonction
// globale existante (contrainte inline-handler du projet). Scoring/tri PURS dans
// utils.js (scoreCommand/filterCommands/rankConvResults), testés QuickJS ; ici
// vit tout l'impur (DOM, état, effets de bord).
//
// Submodes : la palette peut basculer d'un mode « racine » vers un mode
// secondaire (choix de modèle, skill, conversation, espace) où l'input filtre
// une liste dédiée. Escape recule d'un mode avant de fermer.

let _cmdkOpen = false;
let _cmdkMode = 'root';        // 'root' | 'model' | 'skill' | 'conv' | 'space'
let _cmdkItems = [];           // items rendus (mode courant, après filtrage)
let _cmdkSel = 0;              // index sélectionné dans _cmdkItems
let _cmdkFocusBefore = null;   // élément à re-focus à la fermeture (composer)
// Mode filtre armé (racine) : champ vide, une lettre = RACCOURCI par défaut ;
// taper Espace (avalé) bascule en filtrage, où une lettre = texte de recherche.
// Se réarme (retour aux raccourcis) dès que le champ redevient vide (décision
// Julien 2026-07-11). Ambigu sinon : « r » lancerait « Résumés » au lieu de
// filtrer « réglages ». En mode filtre armé, les touches à gauche sont teintées.
let _cmdkFilterArmed = false;

// Placeholders par mode. En racine, deux variantes selon _cmdkFilterArmed.
const CMDK_PLACEHOLDERS = {
  root:  'Taper un raccourci, ou Espace pour filtrer…',
  rootFilter: 'Filtrer les commandes…',
  model: 'Choisir un modèle…',
  skill: 'Invoquer une skill…',
  conv:  'Rechercher une conversation…',
  space: 'Changer d’espace…',
};
function cmdkRootPlaceholder() {
  return _cmdkFilterArmed ? CMDK_PLACEHOLDERS.rootFilter : CMDK_PLACEHOLDERS.root;
}

// Registre déclaratif des commandes racine. `run()` : action ou entrée de
// submode. `enabled()` (optionnel) : masque la commande hors contexte (liste
// courte). `hint` (optionnel) : annotation à droite. `keywords` : matchés par
// scoreCommand en plus du label.
const COMMANDS = [
  { id: 'new', key: 'n', label: 'Nouvelle conversation', keywords: ['new', 'conversation', 'nouveau'],
    run: () => { closeCommandPalette(); newConversation(); } },
  { id: 'search-conv', key: 'f', label: 'Rechercher une conversation', keywords: ['search', 'historique', 'find', 'chercher'],
    run: () => enterCmdkSubmode('conv') },
  { id: 'switch-model', key: 'm', label: 'Changer de modèle', keywords: ['model', 'modèle', 'switch'],
    enabled: () => !!(_modelsCache && _modelsCache.length),
    run: () => enterCmdkSubmode('model') },
  { id: 'invoke-skill', key: 'k', label: 'Invoquer une skill', keywords: ['skill', 'slash', 'commande'],
    enabled: () => listEnabledSkills().length > 0,
    run: () => enterCmdkSubmode('skill') },
  { id: 'switch-space', key: 'e', label: 'Changer d’espace', keywords: ['space', 'espace', 'workspace'],
    enabled: () => loadSpaces().length > 1,
    run: () => enterCmdkSubmode('space') },
  { id: 'settings', key: ',', label: 'Ouvrir les réglages', keywords: ['settings', 'réglages', 'préférences', 'config'],
    run: () => { closeCommandPalette(); openSettings(); } },
  { id: 'memory', key: 'p', label: 'Ouvrir les souvenirs (profil)', keywords: ['memory', 'souvenirs', 'mémoire', 'profil'],
    run: () => { closeCommandPalette(); openMemoryDrawer(); } },
  { id: 'summaries', key: 'r', label: 'Ouvrir les résumés', keywords: ['summaries', 'résumés', 'historique'],
    run: () => { closeCommandPalette(); openSummaryDrawer('summaries'); } },
  { id: 'skills-drawer', key: 'g', label: 'Gérer les skills', keywords: ['skills', 'gestion'],
    run: () => { closeCommandPalette(); openSkills(); } },
  { id: 'mcp', key: 's', label: 'Serveurs MCP', keywords: ['mcp', 'serveurs', 'outils distants'],
    run: () => { closeCommandPalette(); openMcpServers(); } },
  { id: 'context', key: 'c', label: 'Inspecteur de contexte', keywords: ['context', 'contexte', 'tokens'],
    run: () => { closeCommandPalette(); openContextInspector(); } },
  { id: 'theme', key: 't', label: 'Basculer clair / sombre', keywords: ['theme', 'thème', 'dark', 'light', 'sombre', 'clair'],
    run: () => { toggleThemeLightDark(); closeCommandPalette(); } },
  { id: 'highlight', key: 'h', label: 'Basculer la coloration syntaxique', keywords: ['highlight', 'coloration', 'syntaxe', 'prism'],
    run: () => { toggleHighlightFromPalette(); closeCommandPalette(); } },
  { id: 'export-md', key: 'd', label: 'Exporter la conversation (Markdown)', keywords: ['export', 'markdown', 'md', 'télécharger'],
    enabled: () => !!currentConvId,
    run: () => { closeCommandPalette(); downloadConvMd(); } },
  { id: 'export-html', key: 'w', label: 'Exporter la conversation (HTML)', keywords: ['export', 'html', 'page', 'télécharger'],
    enabled: () => !!currentConvId,
    run: () => { closeCommandPalette(); exportConvHtml(); } },
];

// Table touche → commande (mode racine, champ vide). Construite à la volée pour
// ne pas dupliquer la source ; `enabled()` réévalué au moment de la frappe.
function cmdkKeyCommand(key) {
  const k = String(key || '').toLowerCase();
  return COMMANDS.find(c => c.key === k && (!c.enabled || c.enabled())) || null;
}

// Bascule de thème vers l'apparence NON-active : on lit le thème EFFECTIF à
// l'écran (si le réglage est « system », on résout via matchMedia comme
// applyTheme le fait) et on force l'opposé — garantit toujours un changement
// visible, y compris depuis « system » quand l'OS impose déjà clair/sombre
// (décision Julien 2026-07-11). Réutilise selectTheme (persistance immédiate).
function effectiveTheme() {
  const t = loadSettings().theme;
  if (t === 'light' || t === 'dark') return t;
  return (typeof window !== 'undefined' && window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
}
function toggleThemeLightDark() {
  selectTheme(effectiveTheme() === 'dark' ? 'light' : 'dark');
}

// Bascule la coloration syntaxique depuis la palette. onToggleHighlight() LIT la
// checkbox DOM (no-op si on ne l'inverse pas d'abord) : on bascule l'état,
// reflète la checkbox, puis délègue le re-render à onToggleHighlight.
function toggleHighlightFromPalette() {
  const cb = $('set-highlight');
  if (cb) cb.checked = !cb.checked;
  onToggleHighlight();
}

// Source d'items du mode courant, déjà rendus en objets {label, note?, hint?,
// keyLabel?, run}. `note` = annotation secondaire (nom d'espace) ; `hint` =
// annotation à droite (✓) ; `keyLabel` = touche de raccourci affichée à GAUCHE
// (mode racine seulement — la touche lance la commande, champ vide).
function cmdkModeItems(query) {
  if (_cmdkMode === 'root') {
    const avail = COMMANDS.filter(c => !c.enabled || c.enabled());
    return filterCommands(avail, query).map(c => ({
      label: c.label, hint: c.hint || '', keyLabel: c.key ? c.key.toUpperCase() : '', run: c.run,
    }));
  }
  if (_cmdkMode === 'model') {
    const cur = activeModel();
    const models = (_modelsCache || []).filter(m => !query || m.toLowerCase().indexOf(query.toLowerCase()) >= 0);
    return models.map(m => ({
      label: m, hint: m === cur ? '✓' : '',
      run: () => { closeCommandPalette(); pickComposerModel(m); },
    }));
  }
  if (_cmdkMode === 'skill') {
    return matchSkillCompletions(query).map(s => ({
      label: s.name || s.slug, note: s.name ? ('/' + s.slug) : '',
      run: () => { closeCommandPalette(); insertSkillIntoComposer(s.slug); },
    }));
  }
  if (_cmdkMode === 'space') {
    const spaces = loadSpaces().filter(s => !query || (s.name || '').toLowerCase().indexOf(query.toLowerCase()) >= 0);
    const active = getActiveSpaceId();
    return spaces.map(s => ({
      label: s.name || '(sans nom)', hint: s.id === active ? '✓' : '',
      run: () => { closeCommandPalette(); pickSpace(s.id); },
    }));
  }
  if (_cmdkMode === 'conv') {
    return cmdkConvItems(query);
  }
  return [];
}

// Submode « recherche conversation » : CROSS-Space (décision Julien D2), mais
// les conversations du Space actif passent en tête même à score inférieur
// (rankConvResults). Réutilise le prédicat de la sidebar (searchConversations)
// pour la logique de match (titre/résumé/contenu) ; score léger local (titre =
// 3, autre = 1) suffisant pour départager dans un groupe de Space. Chaque ligne
// annotée du nom de son Space. Ouvrir une conv d'un autre Space suit le Space
// (followSpace) avant selectConv, pour ne pas afficher un fil hors du Space actif.
function cmdkConvItems(query) {
  const q = (query || '').trim();
  if (!q) return [];
  const pred = searchConversations(q);
  if (!pred) return [];
  const ql = q.toLowerCase();
  const spaceNames = new Map(loadSpaces().map(s => [s.id, s.name || '']));
  const active = getActiveSpaceId();
  const scored = listAllConversations()
    .filter(pred)
    .map(c => ({
      id: c.id, spaceId: c.spaceId,
      title: c.title || 'Sans titre',
      score: (c.title || '').toLowerCase().includes(ql) ? 3 : 1,
    }));
  return rankConvResults(scored, active).map(c => ({
    label: c.title,
    note: c.spaceId === active ? '' : (spaceNames.get(c.spaceId) || 'Autre espace'),
    run: () => {
      closeCommandPalette();
      if (c.spaceId !== getActiveSpaceId()) followSpace(c.spaceId);
      // reveal : après l'éventuel changement d'espace, scroller la liste vers la
      // conv ouverte (même sidebar masquée) pour la retrouver en place.
      selectConv(c.id, true);
    },
  }));
}

// Insère `/slug ` dans le composer et le focus (l'invocation reste au composer :
// chemin slash-skill unique, docs/skills.md). Ne PAS invoquer directement.
function insertSkillIntoComposer(slug) {
  const ta = $('composer-text');
  if (!ta || ta.disabled) return;
  ta.value = '/' + slug + ' ';
  ta.focus();
  const caret = ta.value.length;
  ta.setSelectionRange(caret, caret);
  autoGrow(ta);
  if (typeof onComposerInput === 'function') onComposerInput();
}

function enterCmdkSubmode(mode) {
  _cmdkMode = mode;
  _cmdkFilterArmed = false;   // les sous-modes filtrent nativement (pas de raccourcis)
  const input = $('cmdk-input');
  if (input) {
    input.value = '';
    input.placeholder = mode === 'root' ? cmdkRootPlaceholder() : (CMDK_PLACEHOLDERS[mode] || '');
  }
  renderCommandList('');
}

function renderCommandList(query) {
  const list = $('cmdk-list');
  const empty = $('cmdk-empty');
  if (!list) return;
  _cmdkItems = cmdkModeItems(query);
  if (_cmdkSel >= _cmdkItems.length) _cmdkSel = 0;
  // Teinte les touches quand le mode RACCOURCI est actif (racine, filtrage non
  // armé) : signal qu'une lettre lance directement la commande. Dès que le
  // filtrage est armé (Espace tapé), les touches redeviennent neutres (inertes).
  list.classList.toggle('cmdk-shortcuts', _cmdkMode === 'root' && !_cmdkFilterArmed);
  list.textContent = '';
  // Rendu par createElement + textContent (labels = données utilisateur :
  // titres de conversation, noms d'espace — jamais innerHTML, doctrine projet).
  _cmdkItems.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'cmdk-item' + (i === _cmdkSel ? ' selected' : '');
    // Touche de raccourci à GAUCHE (mode racine). Emplacement réservé (span
    // vide) même sans touche, pour aligner les labels verticalement.
    const keyEl = document.createElement('span');
    keyEl.className = 'cmdk-item-key';
    if (it.keyLabel) keyEl.textContent = it.keyLabel;
    else keyEl.classList.add('cmdk-item-key-empty');
    li.appendChild(keyEl);
    const label = document.createElement('span');
    label.className = 'cmdk-item-label';
    label.textContent = it.label;
    li.appendChild(label);
    if (it.note) {
      const note = document.createElement('span');
      note.className = 'cmdk-item-note';
      note.textContent = it.note;
      li.appendChild(note);
    }
    if (it.hint) {
      const hint = document.createElement('span');
      hint.className = 'cmdk-item-hint';
      hint.textContent = it.hint;
      li.appendChild(hint);
    }
    li.addEventListener('mousedown', (ev) => { ev.preventDefault(); runCmdkItem(i); });
    list.appendChild(li);
  });
  if (empty) empty.hidden = _cmdkItems.length > 0;
}

function runCmdkItem(i) {
  const it = _cmdkItems[i];
  if (it && typeof it.run === 'function') it.run();
}

function moveCmdkSelection(delta) {
  if (!_cmdkItems.length) return;
  _cmdkSel = (_cmdkSel + delta + _cmdkItems.length) % _cmdkItems.length;
  const list = $('cmdk-list');
  if (!list) return;
  Array.from(list.children).forEach((li, i) => li.classList.toggle('selected', i === _cmdkSel));
  const sel = list.children[_cmdkSel];
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function openCommandPalette() {
  if (_cmdkOpen) return;
  _cmdkOpen = true;
  _cmdkMode = 'root';
  _cmdkSel = 0;
  _cmdkFilterArmed = false;   // à l'ouverture, mode raccourci (touches en orange)
  _cmdkFocusBefore = document.activeElement;
  const overlay = $('cmdk-overlay');
  const input = $('cmdk-input');
  if (overlay) overlay.hidden = false;
  if (input) { input.value = ''; input.placeholder = cmdkRootPlaceholder(); }
  renderCommandList('');
  if (input) input.focus();
}

function closeCommandPalette() {
  if (!_cmdkOpen) return;
  _cmdkOpen = false;
  _cmdkMode = 'root';
  _cmdkItems = [];
  const overlay = $('cmdk-overlay');
  if (overlay) overlay.hidden = true;
  // Restaure le focus au composer (brief D3). Fallback : élément focus avant.
  const ta = $('composer-text');
  if (ta && !ta.disabled) ta.focus();
  else if (_cmdkFocusBefore && typeof _cmdkFocusBefore.focus === 'function') _cmdkFocusBefore.focus();
  _cmdkFocusBefore = null;
}

// Escape sur la palette : recule d'un submode (retour racine) avant de fermer.
// Renvoie true si l'événement est consommé (cascade Escape, ui.js).
function closeCommandPaletteViaEscape() {
  if (!_cmdkOpen) return false;
  // Sous-mode → retour racine (enterCmdkSubmode réarme le placeholder). Racine
  // avec filtrage armé → un Escape désarme d'abord (retour aux raccourcis) ;
  // racine mode raccourci → ferme.
  if (_cmdkMode !== 'root') { enterCmdkSubmode('root'); return true; }
  if (_cmdkFilterArmed) { enterCmdkSubmode('root'); return true; }
  closeCommandPalette();
  return true;
}

function toggleCommandPalette() {
  if (_cmdkOpen) closeCommandPalette();
  else openCommandPalette();
}

function closeTopDropdownViaEscape() {
  const open = document.querySelectorAll('.model-menu.show');
  if (!open.length) return false;
  open.forEach(m => m.classList.remove('show'));
  return true;
}
function closeTopDrawerViaEscape() {
  if (!_drawerStack.length) return false;
  const top = _drawerStack[_drawerStack.length - 1];
  _drawerStack = _drawerStack.slice(0, -1);
  top();
  return true;
}
function exitMoveModeViaEscape() {
  if (!_moveMode) return false;
  exitMoveMode();
  return true;
}
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd+K : ouvre/ferme la palette de commandes (lot F). preventDefault
  // pour couvrir la barre de recherche du navigateur (Firefox). Ignore si un
  // autre modificateur est enfoncé (évite les collisions accidentelles).
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    toggleCommandPalette();
    return;
  }
  if (e.key !== 'Escape') return;
  if (closeCommandPaletteViaEscape()) return;
  if (closeMermaidLightboxViaEscape()) return;
  if (closeTopDropdownViaEscape()) return;
  if (exitMoveModeViaEscape()) return;
  if (closeTopDrawerViaEscape()) return;
  if (closeSidebarViaEscape()) return;
  toggleSidebar();
});

// Câblage de la palette : frappe (filtrage), navigation ↑/↓/Enter, clic backdrop.
// Fait au chargement du module (globals, hors init) — les éléments existent dans
// le HTML statique.
(function wireCommandPalette() {
  const input = $('cmdk-input');
  const backdrop = $('cmdk-backdrop');
  if (input) {
    input.addEventListener('input', () => {
      _cmdkSel = 0;
      // Réarme le mode raccourci dès que le champ redevient vide (retour aux
      // touches orange) ; l'input reste en filtrage tant qu'il y a du texte.
      if (_cmdkMode === 'root' && !input.value && _cmdkFilterArmed) {
        _cmdkFilterArmed = false;
        input.placeholder = cmdkRootPlaceholder();
      }
      renderCommandList(input.value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveCmdkSelection(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveCmdkSelection(-1); return; }
      if (e.key === 'Enter') { e.preventDefault(); runCmdkItem(_cmdkSel); return; }
      // Raccourci par commande (lot F, suite) : en mode racine, champ vide et
      // filtrage NON armé, une lettre lance directement la commande. Comme « r »
      // pourrait aussi vouloir dire « filtrer réglages », l'utilisateur DÉSAMBIGUÏSE
      // en tapant Espace d'abord (avalé) → bascule en filtrage (décision Julien
      // 2026-07-11). Pas de modificateur (le raccourci EST la séquence Ctrl/Cmd+K
      // → lettre, K ayant déjà ouvert la palette).
      if (_cmdkMode === 'root' && !input.value && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === ' ') {
          // Espace en tête : bascule en filtrage sans l'insérer dans le champ.
          e.preventDefault();
          if (!_cmdkFilterArmed) {
            _cmdkFilterArmed = true;
            input.placeholder = cmdkRootPlaceholder();
            renderCommandList('');
          }
          return;
        }
        if (!_cmdkFilterArmed) {
          const cmd = cmdkKeyCommand(e.key);
          if (cmd) { e.preventDefault(); cmd.run(); }
        }
      }
    });
  }
  if (backdrop) backdrop.addEventListener('mousedown', closeCommandPalette);
})();

// ── Sélecteur de modèle du composer ─────────────────────────────────────────
// Liste mise en cache pour la session (pas de persistance), invalidée si l'URL
// du backend change. Un seul fetch /models par session/backend.
let _modelsCache = null;
let _modelsCacheUrl = '';

async function loadModelsCached() {
  const cfg = activeApiConfig();
  const url = (cfg.url || '').trim();
  if (!url) return [];
  if (_modelsCache && _modelsCacheUrl === url) return _modelsCache;
  const models = await fetchModels({ url, key: cfg.key });
  _modelsCache = models;
  _modelsCacheUrl = url;
  return models;
}

// Met à jour les libellés de modèle (pastille topbar + bouton composer) sur le
// modèle effectif, et la visibilité du sélecteur composer (réglage activé ET
// liste disponible — sinon fallback silencieux, le sélecteur n'apparaît pas).
function syncModelUI() {
  const m = activeModel() || 'modèle';
  const top = $('model-label');           if (top) top.textContent = m;
  const compLabel = $('composer-model-label'); if (compLabel) compLabel.textContent = m;
  const box = $('composer-model');
  if (box) {
    const show = !!(loadSettings().showModelSelector && _modelsCache && _modelsCache.length);
    box.hidden = !show;
  }
}

function toggleComposerModelMenu() {
  const menu = $('composer-model-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  renderComposerModelOptions();
  menu.classList.add('show');
  const sel = menu.querySelector('.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}

function renderComposerModelOptions() {
  const menu = $('composer-model-menu');
  const cur = activeModel();
  menu.innerHTML = '';
  (_modelsCache || []).forEach(m => {
    const o = document.createElement('div');
    o.className = 'model-opt' + (m === cur ? ' selected' : '');
    o.innerHTML = `<span>${escHtml(m)}</span><span class="check">✓</span>`;
    o.onmousedown = (ev) => { ev.preventDefault(); pickComposerModel(m); };
    menu.appendChild(o);
  });
}

function pickComposerModel(m) {
  setConvModel(m);   // override conv + persistance + syncModelUI
  $('composer-model-menu').classList.remove('show');
}

// ── Sélecteur de niveau de raisonnement du composer ─────────────────────────
// Même mécanique que le sélecteur de modèle (bouton pilule + .model-menu
// générique), mais liste STATIQUE (pas de fetch, pas de cache session) : les 5
// valeurs possibles sont fixes. Masqué si le réglage est désactivé OU si l'API a
// déjà rejeté reasoning_effort pour l'endpoint+modèle actifs cette session
// (isReasoningEffortRejected, api.js) — dans ce cas on force aussi l'effort actif
// à '' (défaut), pour ne pas reposer un paramètre déjà rejeté au tour suivant.
const REASONING_EFFORT_OPTIONS = [
  { value: '', label: 'défaut' },
  { value: 'none', label: 'none' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
];

function syncReasoningUI() {
  const box = $('composer-reasoning');
  if (!box) return;
  const settings = loadSettings();
  // La clé du cache de rejet est l'URL du serveur ACTIF (posée par
  // streamCompletion via activeApiConfig) — pas settings.url, legacy depuis le
  // multi-serveurs : sur un serveur actif ≠ serveur migré, la lecture raterait.
  const rejected = isReasoningEffortRejected(activeApiConfig().url, activeModel());
  if (rejected && currentConvReasoningEffort) { setConvReasoningEffort(''); return; }   // ré-entre via syncReasoningUI
  const cur = activeReasoningEffort();
  const opt = REASONING_EFFORT_OPTIONS.find(o => o.value === cur);
  const label = $('composer-reasoning-label');
  if (label) label.textContent = opt ? opt.label : cur;
  const btn = $('composer-reasoning-btn');
  if (btn) btn.classList.toggle('is-default', !cur);
  box.hidden = !settings.showReasoningSelector || rejected;
}

function toggleComposerReasoningMenu() {
  const menu = $('composer-reasoning-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  renderComposerReasoningOptions();
  menu.classList.add('show');
}

function renderComposerReasoningOptions() {
  const menu = $('composer-reasoning-menu');
  const cur = activeReasoningEffort();
  menu.innerHTML = '';
  REASONING_EFFORT_OPTIONS.forEach(o => {
    const el = document.createElement('div');
    el.className = 'model-opt' + (o.value === cur ? ' selected' : '');
    el.innerHTML = `<span>${escHtml(o.label)}</span><span class="check">✓</span>`;
    el.onmousedown = (ev) => { ev.preventDefault(); pickComposerReasoningEffort(o.value); };
    menu.appendChild(el);
  });
}

function pickComposerReasoningEffort(v) {
  setConvReasoningEffort(v);   // override conv + persistance + syncReasoningUI
  $('composer-reasoning-menu').classList.remove('show');
}

// Même composant (bouton pilule + .model-menu), pour le choix du DÉFAUT GLOBAL
// dans les settings — pas d'override de conversation ici. La valeur vit dans le
// hidden input #set-reasoning-effort, lu tel quel par onSaveSettings() comme les
// autres champs du formulaire ; rien n'est persisté avant l'enregistrement.
function toggleSettingsReasoningMenu() {
  const menu = $('set-reasoning-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  renderSettingsReasoningOptions();
  menu.classList.add('show');
}

function renderSettingsReasoningOptions() {
  const menu = $('set-reasoning-menu');
  const cur = $('set-reasoning-effort').value;
  menu.innerHTML = '';
  REASONING_EFFORT_OPTIONS.forEach(o => {
    const el = document.createElement('div');
    el.className = 'model-opt' + (o.value === cur ? ' selected' : '');
    el.innerHTML = `<span>${escHtml(o.label)}</span><span class="check">✓</span>`;
    el.onmousedown = (ev) => { ev.preventDefault(); pickSettingsReasoningEffort(o.value); };
    menu.appendChild(el);
  });
}

function pickSettingsReasoningEffort(v) {
  $('set-reasoning-effort').value = v;
  syncSettingsReasoningLabel();
  $('set-reasoning-menu').classList.remove('show');
  updateSettingsDirty();
}

// Ré-affiche le label du bouton depuis la valeur courante du hidden input —
// nécessaire après un chargement programmatique (init) qui ne passe pas par
// pickSettingsReasoningEffort.
function syncSettingsReasoningLabel() {
  const v = $('set-reasoning-effort').value;
  const opt = REASONING_EFFORT_OPTIONS.find(o => o.value === v);
  $('set-reasoning-label').textContent = opt ? opt.label : v;
  $('set-reasoning-btn').classList.toggle('is-default', !v);
}

// ── Settings drawer ─────────────────────────────────────────────────────────
// Accordéon des catégories (référencé en onclick= inline) : même mécanique que
// les namespaces du drawer outils. `.settled` (overflow visible, nécessaire aux
// .model-menu absolus) est posée par le transitionend câblé dans init() — jamais
// ici, pour que le clip tienne pendant toute la transition d'ouverture.
function toggleSettingsCat(head) {
  const body = head.nextElementSibling;
  const opening = !head.classList.contains('open');
  document.querySelectorAll('#drawer .set-cat-head.open').forEach(function(h) {
    if (h === head) return;
    h.classList.remove('open');
    h.nextElementSibling.classList.remove('open', 'settled');
  });
  head.classList.toggle('open', opening);
  body.classList.toggle('open', opening);
  if (!opening) body.classList.remove('settled');
}

// Vrai si le formulaire diverge des réglages persistés, sur les seuls champs
// enregistrés par onSaveSettings() ET pas déjà auto-persistés ailleurs. Le thème
// est exclu (selectTheme sauve immédiatement). summaryInjectionMode est comparé
// en live à loadSettings() : la bannière peut le persister pendant que le drawer
// est ouvert, la comparaison reste juste.
function settingsFormDirty() {
  const s = loadSettings();
  return $('set-system').value !== (s.systemPrompt || '')
    || $('set-highlight').checked !== (s.highlight !== false)
    || pendingSummaryInjectionMode !== (s.summaryInjectionMode || 'propose')
    || $('set-modelselector').checked !== !!s.showModelSelector
    || $('set-reasoning-effort').value !== (s.reasoningEffort || '')
    || $('set-reasoningselector').checked !== !!s.showReasoningSelector
    || $('set-tools-in-prompt').checked !== !!s.includeToolsInSystemPrompt
    || $('set-intent-tracing').checked !== !!s.intentTracing
    || $('set-save-json').checked !== !!s.saveJsonResponses
    || $('set-describe-files').checked !== (s.describeFiles !== false)
    || $('set-export-interactive').checked !== (s.exportInteractive !== false)
    || $('set-contextwindow').value !== (s.contextWindow || '');
}

// Active « Enregistrer » seulement si quelque chose est à enregistrer. Appelé
// par délégation input/change sur le drawer (câblée dans init) et explicitement
// par les chemins programmatiques qui n'émettent pas d'événement
// (pickSettingsReasoningEffort, selectSummaryInjectionMode, onSaveSettings).
function updateSettingsDirty() {
  const btn = $('save-settings-btn');
  if (btn) btn.disabled = !settingsFormDirty();
}

function openSettings() {
  const s = loadSettings();
  setSummaryInjectionModeUI(s.summaryInjectionMode);   // valeur courante (peut changer via la bannière)
  setThemeUI(s.theme || 'system');
  setMotionUI(s.motion || 'system');
  $('set-tools-in-prompt').checked = !!s.includeToolsInSystemPrompt;
  $('set-intent-tracing').checked = !!s.intentTracing;
  $('set-save-json').checked = !!s.saveJsonResponses;
  $('set-describe-files').checked = s.describeFiles !== false;
  $('set-export-interactive').checked = s.exportInteractive !== false;
  const pre = $('root-prompt-pre');
  if (pre && !pre.dataset.loaded) {
    pre.innerHTML = renderMd(rootSystemPromptDisplay());
    pre.dataset.loaded = '1';
  }
  const lbl = $('build-ts-label');
  if (lbl) {
    lbl.textContent = BUILD_TS
      ? 'Build : ' + new Date(BUILD_TS * 1000).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' })
      : '';
  }
  updateSettingsDirty();   // des saisies non enregistrées peuvent survivre à une fermeture
  $('drawer').classList.add('show');
  $('backdrop').classList.add('show');
}
function closeSettings() {
  $('drawer').classList.remove('show');
  $('backdrop').classList.remove('show');
  // Referme le menu du sélecteur de raisonnement des réglages s'il est resté
  // ouvert. (L'ancien $('model-menu') — champ modèle global supprimé au passage
  // aux cartes serveurs — levait une TypeError à chaque fermeture du drawer.)
  const rm = $('set-reasoning-menu');
  if (rm) rm.classList.remove('show');
}

// ── Catégorie « Données » : export / import complet (feature E) ─────────────
// Ces boutons agissent immédiatement (pas branchés sur settingsFormDirty/
// onSaveSettings, cf. brief). Le récapitulatif d'import affiche les compteurs
// et un bouton d'application arm-then-confirm (remplacement intégral =
// destructif) ; l'orchestration (lecture fichier, application) vit dans main.js.

// Réinitialise la zone d'import (masque erreur + récapitulatif). Appelé avant
// chaque nouvelle sélection de fichier.
function resetImportDataUI() {
  const err = $('import-data-err');
  if (err) { err.setAttribute('hidden', ''); err.textContent = ''; }
  const sum = $('import-data-summary');
  if (sum) { sum.setAttribute('hidden', ''); sum.innerHTML = ''; }
}

function showImportDataError(msg) {
  resetImportDataUI();
  const err = $('import-data-err');
  if (err) { err.textContent = msg; err.removeAttribute('hidden'); }
}

// Affiche le récapitulatif d'un import valide (counts de validateImportPayload)
// et câble le bouton d'application sur armThenRun. `onApply` est appelé au
// second clic (confirmation) — l'appelant (main.js) porte l'effet de bord.
function renderImportSummary(counts, onApply) {
  resetImportDataUI();
  const sum = $('import-data-summary');
  if (!sum) return;
  sum.innerHTML =
    `<div>${counts.conversations} conversation(s), ${counts.memories} souvenir(s), ` +
    `${counts.skills} skill(s), ${counts.resources} ressource(s), ${counts.servers} serveur(s), ` +
    `${counts.spaces} espace(s).</div>`;
  const btn = document.createElement('button');
  btn.className = 'drawer-btn danger';
  btn.textContent = 'Appliquer (remplace tout)';
  btn.onclick = () => armThenRun(btn, onApply, 'Confirmer le remplacement');
  sum.appendChild(btn);
  sum.removeAttribute('hidden');
}

// Légende décrivant le comportement induit par l'option sélectionnée (une seule
// à la fois), plutôt que l'énumération des trois modes.
const SUMMARY_INJECTION_HINTS = {
  auto:    "Recherche les conversations passées liées et les injecte dans le contexte, sans rien demander.",
  propose: "Détecte les conversations passées liées et propose de les injecter via une bannière, avant l'envoi.",
  never:   "Aucune recherche ni injection automatique des conversations passées.",
};

let pendingSummaryInjectionMode = 'propose';
function setSummaryInjectionModeUI(mode) {
  pendingSummaryInjectionMode = mode || 'propose';
  document.querySelectorAll('#summary-injection-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingSummaryInjectionMode);
  });
  const hint = $('summary-injection-hint');
  if (hint) hint.textContent = SUMMARY_INJECTION_HINTS[pendingSummaryInjectionMode] || '';
}
function selectSummaryInjectionMode(mode) { setSummaryInjectionModeUI(mode); updateSettingsDirty(); }

// ── Thème ────────────────────────────────────────────────────────────────────
const THEME_HINTS = {
  light:  "Interface toujours en clair, indépendamment du système.",
  dark:   "Interface toujours en sombre, indépendamment du système.",
  system: "Suit la préférence clair/sombre du système d'exploitation.",
};

let pendingTheme = 'system';
// Pose TOUJOURS un data-theme résolu (light|dark) : « system » est tranché ici
// via matchMedia (comme le script de boot du <head>), jamais délégué à un bloc
// @media CSS — le thème clair n'existe qu'en une seule variante
// html[data-theme="light"]. Suivi live du changement de préférence OS ci-dessous.
function applyTheme(theme) {
  let resolved = theme;
  if (resolved !== 'light' && resolved !== 'dark') {
    resolved = (typeof window !== 'undefined' && window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.setAttribute('data-theme', resolved);
  refreshMermaidTheme(resolved);   // hook unique : couvre selectTheme ET le suivi OS
  refreshWelcomeIfPresent();       // coquetterie : re-tire l'accueil si affiché (vierge)
}

// Réglage « system » : un changement de préférence OS en cours de session
// ré-applique le thème résolu. Guard matchMedia : absent des stubs QuickJS.
if (typeof window !== 'undefined' && window.matchMedia) {
  const _themeMq = window.matchMedia('(prefers-color-scheme: light)');
  const _onSystemThemeChange = () => {
    const t = loadSettings().theme || 'system';
    if (t !== 'light' && t !== 'dark') applyTheme(t);
  };
  if (_themeMq.addEventListener) _themeMq.addEventListener('change', _onSystemThemeChange);
  else if (_themeMq.addListener) _themeMq.addListener(_onSystemThemeChange);   // Safari < 14
}
function setThemeUI(theme) {
  pendingTheme = theme || 'system';
  document.querySelectorAll('#theme-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingTheme);
  });
  const hint = $('theme-hint');
  if (hint) hint.textContent = THEME_HINTS[pendingTheme] || '';
}
function selectTheme(theme) {
  setThemeUI(theme);
  applyTheme(theme);
  saveSettings({ theme });   // persisté immédiatement : préférence visuelle à effet direct
}

// ── Animations (reduced-motion) ─────────────────────────────────────────────
const MOTION_HINTS = {
  normal:  "Animations toujours actives, indépendamment du système.",
  reduced: "Animations désactivées, indépendamment du système.",
  system:  "Suit la préférence de réduction des animations du système.",
};

let pendingMotion = 'system';
// Cache du booléen reduced-motion effectif, alimenté par applyMotion (seul point
// de passage à chaque changement : init, selectMotion, sync multi-onglets,
// changement de préférence OS). motionReduced() n'a donc PAS à re-parser le
// localStorage à chaque appel — il est sollicité par ack animé et clic badge,
// fréquence trop lourde pour un loadSettings() à chaque fois (retour Julien).
// null = jamais initialisé → calcul complet une fois (défensif, avant init).
let _motionReducedCache = null;
function systemPrefersReducedMotion() {
  return !!(typeof window !== 'undefined' && window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
// Booléen effectif consommé par les animations (ticker d'acks pour l'instant,
// brief N §8) : accessor global, jamais de matchMedia câblé en dur ailleurs.
function motionReduced() {
  if (_motionReducedCache === null) {
    _motionReducedCache = resolveMotionReduced(loadSettings().motion || 'system',
                                               systemPrefersReducedMotion());
  }
  return _motionReducedCache;
}
// Pose/retire l'attribut sur <html>, même doctrine que data-theme (piège N/A
// ici, pas de KV-cache concerné) : jamais délégué à un bloc @media CSS seul,
// pour que le réglage explicite prime toujours sur la préférence système.
// Rafraîchit aussi le cache lu par motionReduced() (seul point de passage).
function applyMotion(setting) {
  const reduced = resolveMotionReduced(setting, systemPrefersReducedMotion());
  _motionReducedCache = reduced;
  if (reduced) document.documentElement.setAttribute('data-motion', 'reduced');
  else document.documentElement.removeAttribute('data-motion');
}
// Réglage « system » : un changement de préférence OS en cours de session
// ré-applique le gate. Guard matchMedia : absent des stubs QuickJS.
if (typeof window !== 'undefined' && window.matchMedia) {
  const _motionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const _onSystemMotionChange = () => {
    const m = loadSettings().motion || 'system';
    if (m === 'system') applyMotion(m);
  };
  if (_motionMq.addEventListener) _motionMq.addEventListener('change', _onSystemMotionChange);
  else if (_motionMq.addListener) _motionMq.addListener(_onSystemMotionChange);   // Safari < 14
}
function setMotionUI(motion) {
  pendingMotion = motion || 'system';
  document.querySelectorAll('#motion-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingMotion);
  });
  const hint = $('motion-hint');
  if (hint) hint.textContent = MOTION_HINTS[pendingMotion] || '';
}
function selectMotion(motion) {
  setMotionUI(motion);
  applyMotion(motion);
  saveSettings({ motion });   // persisté immédiatement, modèle selectTheme
}

function onToggleHighlight() {
  highlightEnabled = $('set-highlight').checked;
  renderThread(currentThread);
}

// ── Bannière résumés (mode « proposer ») ────────────────────────────────────
let _bannerHandlers = null;
function showSummaryBanner(matches, handlers) {
  _bannerHandlers = handlers;
  const n = matches.length;
  $('summary-banner-text').textContent = n > 1
    ? n + ' conversations passées semblent liées.'
    : 'Une conversation passée semble liée.';
  const list = $('summary-banner-list');
  list.innerHTML = '';
  const now = Date.now();
  matches.forEach(function(m) {
    const li = document.createElement('li');
    li.className = 'summary-banner-item';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'sbi-title';
    titleSpan.textContent = m.title || '(sans titre)';
    li.appendChild(titleSpan);
    const dateStr = formatDateRelative(m.updatedAt || m.timestamp, now);
    if (dateStr) {
      const dateSpan = document.createElement('span');
      dateSpan.className = 'sbi-date';
      dateSpan.textContent = dateStr;
      li.appendChild(dateSpan);
    }
    list.appendChild(li);
  });
  $('summary-banner').classList.add('show');
  scrollBottom();
}
function hideSummaryBanner() {
  const b = $('summary-banner');
  if (b) b.classList.remove('show');
  _bannerHandlers = null;
}
function summaryBanner(action) {
  const h = _bannerHandlers;
  hideSummaryBanner();
  if (h && h[action]) h[action]();
}

// ── Bandeau multi-onglets (lot J : soft-lock / readonly) ────────────────────
// Informatif, non-bloquant. Le texte est piloté par l'appelant (main.js, selon
// l'état soft-lock/readonly) ; ici on ne fait qu'afficher/masquer + poser le
// libellé. Réutilise l'anatomie .banner (composer.css).
function setTabBanner(text) {
  const el = $('tab-banner');
  if (!el) return;
  const t = $('tab-banner-text');
  if (t) t.textContent = text || '';
  // Le bandeau est dans .composer-inner (en flux) : son apparition agrandit le
  // composer et rogne la hauteur de .messages par le bas. Si le lecteur suivait
  // le fil (au fond), le re-coller au fond pour que le dernier message ne passe
  // pas sous le composer agrandi. isAtBottom() est mesuré AVANT le reflow.
  const wasAtBottom = isAtBottom();
  const wasShown = el.classList.contains('show');
  el.classList.add('show');
  if (!wasShown && wasAtBottom) scrollBottom(true);
}
function clearTabBanner() {
  const el = $('tab-banner');
  if (el) el.classList.remove('show');
}

// ── Drawer combiné Résumés / Souvenirs ─────────────────────────────────────
function openSummaryDrawer(tab) {
  switchMemoryTab(tab || 'summaries');
  $('summary-drawer').classList.add('show');
  $('summary-backdrop').classList.add('show');
}
function openMemoryDrawer() { openSummaryDrawer('memories'); }
function closeSummaryDrawer() {
  $('summary-drawer').classList.remove('show');
  $('summary-backdrop').classList.remove('show');
}

// ── Inspecteur de contexte (brief B) ────────────────────────────────────────
// Palette fixe par source (ordre d'apparition dans buildContextManifest),
// cohérente barre/table. 'thread'/'attachment_images' en dernier (volumes les
// plus variables).
const CTX_PALETTE = {
  identity_blurb: '#e0d45a', root_prompt: '#7c8cf8', tools_system: '#5fb3d9', tool_definitions: '#4fc3a1',
  intent_doctrine: '#f2a65a', skills_doctrine: '#f2c85a', docs_doctrine: '#c98bf2',
  codeblock_doctrine: '#e05ac9', user_prompt: '#e07a9e', context_date_model: '#9aa5b1', memories: '#e0605a',
  summaries: '#e0955a', skills_context: '#8bc98b', space_library: '#3ea8d9',
  thread: '#4a90d9', attachment_images: '#d9974a',
};

// Manifeste effectif (B4) : dernier envoi réel s'il existe, sinon simulation
// à froid. Ne recalcule PAS depuis zéro à chaque appel du compteur : la
// simulation est bon marché (fonctions pures déjà utilisées à l'envoi), mais
// PAS de polling — appelée seulement aux points de l'audit (send, switch conv,
// save settings, switch Space).
function effectiveContextManifest() {
  return _lastContextManifest || computeContextManifestNow();
}

// Compteur compact du composer (D4). Câblé aux points send-relevant (audit
// §5b), jamais à l'oninput du textarea (brief B3, draft exclu v1).
function syncContextCounter() {
  const el = $('ctx-counter-label');
  if (!el) return;
  const m = effectiveContextManifest();
  const win = contextWindowFor(activeModel());
  // Pilule = photo du dernier envoi réel (Bbis, décision A5) : sans `≈` quand
  // l'usage API a calibré le manifeste (m.real), avec `≈` sinon (estimé
  // chars/4 — simulation à froid TOUJOURS estimée, apiUsage y est null).
  let label = (m.real ? '' : '≈ ') + m.totalTokens + ' tok';
  const counter = $('ctx-counter');
  if (win) {
    const pct = Math.round((m.totalTokens / win) * 100);
    label += ' (' + pct + '%)';
    if (counter) {
      const ratio = m.totalTokens / win;
      counter.classList.toggle('ctx-counter-warn', ratio >= CONTEXT_WINDOW_WARN_RATIO && ratio < 1);
      counter.classList.toggle('ctx-counter-over', ratio >= 1);
    }
  } else if (counter) {
    counter.classList.remove('ctx-counter-warn', 'ctx-counter-over');
  }
  // Total provisoire (recalculé en cours de boucle d'outils, pas encore la
  // réponse finale) : marqueur visuel léger sur la pilule elle-même, pas
  // seulement dans le drawer — l'utilisateur doit voir que ça évolue sans
  // avoir à ouvrir l'inspecteur.
  if (counter) counter.classList.toggle('ctx-counter-midturn', !!_lastContextManifestMidTurn);
  el.textContent = label;

  // Drawer déjà ouvert (ex. laissé ouvert pendant une boucle d'outils ou un
  // streaming) : le rafraîchir en même temps que la pilule, sinon son contenu
  // reste figé sur l'état au moment de l'ouverture jusqu'à une fermeture/
  // réouverture manuelle.
  const drawer = $('ctx-drawer');
  if (drawer && drawer.classList.contains('show')) renderContextInspector();
}

function openContextInspector() {
  renderContextInspector();
  $('ctx-drawer').classList.add('show');
  $('ctx-backdrop').classList.add('show');
}
function closeContextInspector() {
  $('ctx-drawer').classList.remove('show');
  $('ctx-backdrop').classList.remove('show');
}

function renderContextInspector() {
  const m = effectiveContextManifest();
  const win = contextWindowFor(activeModel());
  const scale = win || m.totalTokens || 1;

  const ud = usageDerived(m.apiUsage);

  const hint = $('ctx-source-hint');
  if (hint) {
    if (_lastContextManifest && _lastContextManifestMidTurn) {
      hint.textContent = 'Échange en cours (outils) — total provisoire, va encore évoluer.';
    } else if (_lastContextManifest && m.real) {
      hint.textContent = 'Dernier envoi réel — tokens rapportés par l\'API.';
    } else if (_lastContextManifest) {
      hint.textContent = 'Dernier envoi réel — estimation (pas d\'info backend).';
    } else if (currentThread.length) {
      hint.textContent = 'Simulation du prochain envoi (aucun envoi depuis le rechargement de cette conversation).';
    } else {
      hint.textContent = 'Simulation du prochain envoi (aucun message dans cette conversation).';
    }
  }

  const bar = $('ctx-bar');
  if (bar) {
    bar.innerHTML = m.entries.map(e => {
      const pct = Math.max(0, Math.min(100, (e.tokens / scale) * 100));
      const color = CTX_PALETTE[e.source] || '#888';
      return `<span class="ctx-bar-seg" style="width:${pct}%;background:${color}" title="${escHtml(e.label)}"></span>`;
    }).join('');
  }

  // 2e barre, accolée : part de l'ENTRÉE servie par le cache (Bbis). Échelle
  // interne (cached/prompt), indépendante de la fenêtre — affichée dès que
  // cached_tokens est connu, quel que soit le mode de la barre 1. Absente sur
  // les backends qui ne le renvoient pas (ex. Ollama).
  const barCache = $('ctx-bar-cache');
  if (barCache) {
    if (ud.cachedTokens != null && ud.cachedRatio != null) {
      const pct = Math.max(0, Math.min(100, ud.cachedRatio * 100));
      barCache.innerHTML = `<span class="ctx-bar-seg" style="width:${pct}%" title="${ud.cachedTokens} tok servis par le cache (${Math.round(pct)}%)"></span>`;
      barCache.hidden = false;
    } else {
      barCache.innerHTML = '';
      barCache.hidden = true;
    }
  }

  const body = $('ctx-table-body');
  if (body) {
    // Lignes toujours `≈` (ventilation par bloc jamais mesurée par l'API,
    // même proratisée) ; seul le TOTAL perd le `≈` quand m.real (Bbis A2).
    const rows = m.entries.map(e => {
      const pct = m.totalTokens ? Math.round((e.tokens / m.totalTokens) * 100) : 0;
      const color = CTX_PALETTE[e.source] || '#888';
      const note = e.source === 'attachment_images' ? ' <span class="hint">(très approximatif)</span>' : '';
      return `<tr><td><span class="ctx-swatch" style="background:${color}"></span>${escHtml(e.label)}${note}</td>` +
        `<td>${e.chars}</td><td>≈${e.tokens}</td><td>${pct}%</td></tr>`;
    });
    const totalTokLabel = (m.real ? '' : '≈') + m.totalTokens;
    rows.push(`<tr class="ctx-total"><td>Total</td><td>${m.totalChars}</td><td>${totalTokLabel}</td><td>100%</td></tr>`);
    // Sortie : ligne à part, HORS barres (l'entrée seule occupe le contexte).
    if (ud.outTokens != null) {
      rows.push(`<tr class="ctx-output"><td>Réponse (sortie)</td><td></td><td>${ud.outTokens}</td><td></td></tr>`);
    }
    body.innerHTML = rows.join('');
  }
}

function switchMemoryTab(tab) {
  document.querySelectorAll('#summary-drawer .drawer-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  const sp = $('summary-tab-panel');
  const mp = $('memory-tab-panel');
  if (sp) sp.classList.toggle('hidden', tab !== 'summaries');
  if (mp) mp.classList.toggle('hidden', tab !== 'memories');
  if (tab === 'summaries') renderSummaryList();
  else renderMemoryList();
}

function renderSummaryList() {
  const wrap = $('summary-list');
  wrap.innerHTML = '';
  const all = loadSummaries();
  const ids = Object.keys(all);
  if (!ids.length) {
    wrap.innerHTML = '<div class="mem-empty">Aucun résumé pour l\'instant.</div>';
    return;
  }
  ids.sort((a, b) => (all[b].timestamp || 0) - (all[a].timestamp || 0));
  const convs = loadConversations();
  for (const id of ids) {
    const e = all[id];
    const item = document.createElement('div');
    item.dataset.id = id;
    const date = e.timestamp ? new Date(e.timestamp).toLocaleDateString('fr-FR') : '';
    const conv = convs.find(c => c.id === id);
    const space = getSpace(conv ? (conv.spaceId || DEFAULT_SPACE_ID) : DEFAULT_SPACE_ID);
    const spaceLabel = space ? space.name : '';
    if (e.suppressed) {
      item.className = 'mem-item suppressed';
      const sub = ['supprimé', date, spaceLabel].filter(Boolean).join(' · ');
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-title">${escHtml(e.title || 'Souvenir supprimé')}</div>` +
        `<div class="mem-sub">${escHtml(sub)}</div></div>` +
        `<button class="drawer-btn" onclick="restoreSummaryItem('${id}')">Rétablir</button></div>`;
    } else {
      const full = e.summary || '';
      const extrait = full.slice(0, 150);
      const kws = Array.isArray(e.keywords) && e.keywords.length
        ? `<div class="mem-keywords"><strong>Mots-clefs</strong> — ${escHtml(e.keywords.join(', '))}</div>`
        : '';
      const sub = [date, spaceLabel].filter(Boolean).join(' · ');
      item.className = 'mem-item';
      item.onclick = () => toggleSummaryExpand(id);
      item.innerHTML =
        `<div class="mem-header">` +
        `<div class="mem-meta"><div class="mem-title">${escHtml(e.title || 'Nouvelle conversation')}</div>` +
        `<div class="mem-sub">${escHtml(sub)}</div></div>` +
        `<button class="drawer-btn danger" onclick="event.stopPropagation();deleteSummaryItem('${id}')">Supprimer</button>` +
        `</div>` +
        `<div class="mem-excerpt">${escHtml(extrait)}${full.length > 150 ? '…' : ''}</div>` +
        `<div class="mem-full">${escHtml(full)}${kws}</div>`;
    }
    wrap.appendChild(item);
  }
}

function deleteSummaryItem(id) { suppressSummary(id); renderSummaryList(); }

function toggleSummaryExpand(id) {
  const list = $('summary-list');
  const clicked = list.querySelector('.mem-item[data-id="' + id + '"]');
  if (!clicked) return;
  const wasExpanded = clicked.classList.contains('expanded');
  list.querySelectorAll('.mem-item.expanded').forEach(el => el.classList.remove('expanded'));
  if (!wasExpanded) clicked.classList.add('expanded');
}

// Ré-autorisation. Si le résumé est conservé sous la tombstone → retour
// instantané. Sinon, régénération avec loader inline sur l'item concerné.
async function restoreSummaryItem(id) {
  const entry = getSummaryEntry(id);
  if (entry && entry.summary) {        // état d'avant préservé : instantané
    restoreSummary(id);
    renderSummaryList();
    return;
  }

  const conv = loadConversation(id);
  if (!conv || !hasSubstance(conv.messages)) {   // rien à régénérer
    restoreSummary(id);
    renderSummaryList();
    return;
  }

  const item = $('summary-list').querySelector('.mem-item[data-id="' + id + '"]');
  if (item) setMemItemLoading(item, 'régénération…');

  const s = await runBackgroundTask('résumé…', () => generateSummary(conv.messages));
  if (s && loadConversation(id)) {   // supprimée pendant la génération : ne pas ressusciter l'entrée
    saveSummary(id, {
      title: conv.title, timestamp: conv.timestamp,
      summary: s.summary, keywords: s.keywords, messageCount: conv.messages.length,
    });
  } else if (s) {
    return;   // conversation disparue entre-temps : rien à afficher ni à sauvegarder
  } else {
    restoreSummary(id);   // échec : on lève la tombstone (candidate au backfill)
  }
  renderSummaryList();
}

// ── Panneau des outils ──────────────────────────────────────────────────────
function openTools() {
  renderToolsList();
  $('tools-drawer').classList.add('show');
  $('tools-backdrop').classList.add('show');
}
function closeTools() {
  $('tools-drawer').classList.remove('show');
  $('tools-backdrop').classList.remove('show');
}

// Sous-drawer « Voir les outils exposés » : groupé par namespace (cf. D2), nom NU
// affiché sous l'en-tête du préfixe. Projection pure du nom canonique — rien n'est
// stocké : groupByNamespace splitte sur le 1er `__`. ask_confirmation (hors
// registre mais déclaré au modèle) est ajouté sous le namespace miaou pour info.
function renderToolsList() {
  const wrap = $('tools-list');
  const list = exposedTools().concat([{
    name: ASK_CONFIRMATION_DEF.function.name,
    description: ASK_CONFIRMATION_DEF.function.description,
    inputSchema: ASK_CONFIRMATION_DEF.function.parameters,
  }]);
  const groups = groupByNamespace(list);
  if (!groups.length) {
    wrap.innerHTML = '<div class="mem-empty">Aucun outil enregistré.</div>';
    return;
  }
  wrap.innerHTML = '';
  const ICON_NS_CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  groups.forEach(function(g, i) {
    const group = document.createElement('div');
    group.className = 'tool-ns-group';

    const header = document.createElement('div');
    header.className = i === 0 ? 'tool-ns open' : 'tool-ns';

    const label = document.createElement('span');
    label.textContent = g.namespace.split('__').join(' › ');

    const chev = document.createElement('span');
    chev.className = i === 0 ? 'tool-ns-chevron open' : 'tool-ns-chevron';
    chev.innerHTML = ICON_NS_CHEVRON;

    header.appendChild(label);
    header.appendChild(chev);

    const body = document.createElement('div');
    body.className = i === 0 ? 'tool-ns-body open' : 'tool-ns-body';
    const bodyInner = document.createElement('div');
    bodyInner.className = 'tool-ns-body-inner';
    for (const t of g.tools) bodyInner.appendChild(buildToolItem(t.bareName, t.def));
    body.appendChild(bodyInner);

    header.addEventListener('click', function() {
      wrap.querySelectorAll('.tool-ns.open').forEach(function(h) {
        if (h === header) return;
        h.classList.remove('open');
        h.querySelector('.tool-ns-chevron').classList.remove('open');
        h.nextElementSibling.classList.remove('open');
      });
      const opening = !header.classList.contains('open');
      header.classList.toggle('open', opening);
      chev.classList.toggle('open', opening);
      body.classList.toggle('open', opening);
    });

    group.appendChild(header);
    group.appendChild(body);
    wrap.appendChild(group);
  });
}

function buildToolItem(bareName, def) {
  const props = (def.inputSchema && def.inputSchema.properties) || {};
  const req = (def.inputSchema && def.inputSchema.required) || [];
  const paramNames = Object.keys(props);

  const item = document.createElement('div');
  item.className = 'tool-item';

  let paramsHtml = '';
  if (paramNames.length) {
    paramsHtml = '<div class="tool-params">' +
      paramNames.map(p => {
        const prop = props[p];
        const optional = !req.includes(p);
        return '<div class="tool-param">' +
          '<span class="tool-param-name">' + escHtml(p) + '</span>' +
          '<span class="tool-param-type">' + escHtml((prop.type || '') + (optional ? '?' : '')) + '</span>' +
          (prop.description ? '<span class="tool-param-desc">— ' + escHtml(prop.description) + '</span>' : '') +
          '</div>';
      }).join('') +
      '</div>';
  }

  const nameHtml = bareName.split('__').filter(Boolean)
    .map(escHtml).join('<span class="inline-sep">›</span>');
  item.innerHTML =
    '<div class="tool-name">' + nameHtml + '</div>' +
    '<div class="tool-desc">' + escHtml(def.description || '') + '</div>' +
    paramsHtml;
  return item;
}

// ── Spaces / « Espaces » (sélecteur sidebar + écran, lot C, brief D5) ────────
// Sélecteur pilule + .model-menu générique (règle projet : jamais de <select>
// natif), pattern le plus proche du sélecteur de modèle composer. Chaque ligne
// bascule le Space actif au clic ; un petit bouton crayon ouvre l'écran Space
// (renommage, description, souvenirs, suppression) sans changer de Space.

// Libellé pilule + badge topbar (masqué en default Space, brief D5) — à
// appeler après tout changement de Space actif ou de nom de Space.
function syncSpaceUI() {
  const space = getSpace(activeSpaceId) || { name: 'Général' };
  const label = $('space-select-label');
  if (label) label.textContent = space.name || 'Général';
  const badge = $('topbar-space-badge');
  if (badge) {
    badge.textContent = space.name || '';
    badge.hidden = activeSpaceId === DEFAULT_SPACE_ID;
  }
}

// ── Onglets sidebar « Conversations / Fichiers / Souvenirs » (remplace le
//    drawer Space pour la gestion fichiers/souvenirs) ────────────────────────
// Une seule zone visible à la fois (swap complet, pas 3 zones scroll
// indépendantes). Conversations reste seul à porter la recherche et le
// mode déplacement — changer d'onglet en sort proprement (symétrique au
// changement de Space, cf. pickSpace).
let _spaceTab = 'conversations';

function selectSpaceTab(tab) {
  if (tab !== 'conversations') exitMoveModeIfActive();
  _spaceTab = tab;
  $('space-tab-conversations').classList.toggle('active', tab === 'conversations');
  $('space-tab-files').classList.toggle('active', tab === 'files');
  $('space-tab-memories').classList.toggle('active', tab === 'memories');
  $('sidebar-search').hidden = tab !== 'conversations';
  $('conv-list').hidden = tab !== 'conversations';
  $('space-files-panel').hidden = tab !== 'files';
  $('space-memories-panel').hidden = tab !== 'memories';
  if (tab === 'files') { clearSpaceFilesError(); renderSpaceFilesList(activeSpaceId); }
  else if (tab === 'memories') renderMemoryList('space-memory-list', activeSpaceId);
}

// Force le retour sur Conversations : appelé au switch/reset de Space, pour
// ne pas laisser l'utilisateur face à la bibliothèque d'un Space qu'il vient
// de quitter (spec Julien, 2026-07-08).
function resetSpaceTab() {
  selectSpaceTab('conversations');
}

function toggleSpaceMenu() {
  const menu = $('space-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  renderSpaceMenu();
  menu.classList.add('show');
}

function renderSpaceMenu() {
  const menu = $('space-menu');
  if (!menu) return;
  menu.innerHTML = '';
  const spaces = loadSpaces();
  for (const s of spaces) {
    const opt = document.createElement('div');
    opt.className = 'model-opt' + (s.id === activeSpaceId ? ' selected' : '');
    opt.innerHTML =
      `<span class="space-opt-name">${escHtml(s.name || '')}</span>` +
      `<button type="button" class="space-opt-edit" title="Modifier l'espace">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
      `</button>` +
      `<span class="check">✓</span>`;
    // Toute la ligne cliquable (pas seulement le texte/check) : le padding de
    // .model-opt n'est couvert par aucun enfant, un clic dessus ne déclenchait
    // rien avant ce correctif (Julien, 2026-07-08 — « il faut cliquer 2 fois »).
    opt.onmousedown = (ev) => {
      if (ev.target.closest('.space-opt-edit')) return;
      ev.preventDefault();
      pickSpace(s.id);
    };
    opt.querySelector('.space-opt-edit').onmousedown = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      menu.classList.remove('show');
      openSpaceScreen(s.id);
    };
    menu.appendChild(opt);
  }
  const newOpt = document.createElement('div');
  newOpt.className = 'model-opt space-new';
  newOpt.innerHTML =
    '<svg class="space-move-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>' +
    '<span>Nouvel espace</span>';
  newOpt.onmousedown = (ev) => { ev.preventDefault(); menu.classList.remove('show'); createSpaceAndOpen(); };
  menu.appendChild(newOpt);

  // Déclencheur du mode déplacement (D1, brief Cter) : masqué sans destination
  // possible (un seul Space = rien à déplacer vers) ou sans rien à déplacer
  // (Space actif vide — spec Julien, 2026-07-09). Après « + Nouvel espace »
  // (décision Julien, 2026-07-07), pour ne pas perturber le geste de création.
  if (spaces.length >= 2 && spaceConvIds(activeSpaceId, loadConversations()).size > 0) {
    const moveOpt = document.createElement('div');
    moveOpt.className = 'model-opt space-move-trigger';
    moveOpt.innerHTML =
      '<svg class="space-move-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 7l5 5-5 5"/></svg>' +
      '<span>Déplacer des conversations…</span>';
    moveOpt.onmousedown = (ev) => { ev.preventDefault(); menu.classList.remove('show'); enterMoveMode(); };
    menu.appendChild(moveOpt);
  }
}

// Bascule le Space actif : la conversation ouverte appartient à l'ancien Space
// (structurellement obligatoire, cf. docs/spaces.md) — résumé de sortie avant
// de vider le fil, comme newConversation/selectConv.
function pickSpace(id) {
  if (id === activeSpaceId) { $('space-menu').classList.remove('show'); return; }
  // Changer de Space actif pendant une sélection en cours vide la sélection
  // (décision Cter, 2026-07-07) : sortir du mode est le geste le plus sûr,
  // symétrique à D5 (changer d'intention met fin au mode sélection).
  exitMoveModeIfActive();
  const leaving = currentConvId;
  activeSpaceId = id;
  setActiveSpaceId(id);
  // Fire-and-forget (résolution après resetToEmpty) : rafraîchit la pilule une fois
  // la bibliothèque du nouveau Space chargée, même écart que dans init() (main.js).
  loadSpaceLibrary(id).then(() => {
    _lastContextManifest = null;
    syncContextCounter();
  });
  resetToEmpty();
  syncSpaceUI();
  resetSpaceTab();
  $('space-menu').classList.remove('show');
  summarizeIfNeeded(leaving);
  armIdleSummaryTimer();
  if (isMobileLayout()) closeSidebarMobile();
}

// Variante de pickSpace pour le « follow » post-déplacement (D6, brief Cter) :
// bascule la vue vers le Space destination SANS vider le fil affiché — utilisée
// uniquement quand la conversation ouverte fait partie du lot déplacé (sinon
// aucun follow n'a lieu, cf. audit §3). Pas de summarizeIfNeeded(leaving) : on
// ne quitte aucune conversation, on la suit dans son nouveau Space.
function followSpace(id) {
  activeSpaceId = id;
  setActiveSpaceId(id);
  loadSpaceLibrary(id).then(() => {
    _lastContextManifest = null;
    syncContextCounter();
  });
  syncSpaceUI();
  resetSpaceTab();
  renderConvList();
  _lastContextManifest = null;   // la conv suivie change de Space : contexte affiché périmé (piège 16/18)
  syncContextCounter();
  armIdleSummaryTimer();
}

// Crée le Space, bascule dessus immédiatement (sinon l'utilisateur reste dans
// l'ancien Space en éditant à l'aveugle celui qu'il vient de créer), puis
// ouvre son écran avec le nom pré-sélectionné (focus + select) pour que la
// première frappe remplace directement le nom générique.
function createSpaceAndOpen() {
  const id = genSpaceId();
  upsertSpace({ id, name: 'Nouvel espace' });
  pickSpace(id);
  openSpaceScreen(id);
  const nameInput = $('space-name-input');
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}

// ── Écran Space (sous-drawer, pattern MCP) ───────────────────────────────────
let _spaceScreenId = null;

function openSpaceScreen(id) {
  const space = getSpace(id);
  if (!space) return;
  _spaceScreenId = id;
  $('space-drawer-title').textContent = space.name || 'Espace';
  $('space-name-input').value = space.name || '';
  $('space-description-input').value = space.description || '';
  $('space-save-btn').disabled = true;
  $('space-err').setAttribute('hidden', '');
  const isDefault = id === DEFAULT_SPACE_ID;
  $('space-name-input').disabled = isDefault;
  $('space-delete-btn').hidden = isDefault;
  $('space-delete-title').hidden = isDefault;
  if (!isDefault) syncSpaceDeleteLabel(id);
  $('space-drawer').classList.add('show');
  $('space-backdrop').classList.add('show');
}

function closeSpaceScreen() {
  $('space-drawer').classList.remove('show');
  $('space-backdrop').classList.remove('show');
  _spaceScreenId = null;
}

function onSpaceFormInput() {
  $('space-save-btn').disabled = false;
  $('space-err').setAttribute('hidden', '');
}

function onSaveSpaceScreen() {
  if (!_spaceScreenId) return;
  const space = getSpace(_spaceScreenId);
  if (!space) return;
  const name = $('space-name-input').value.trim();
  if (_spaceScreenId !== DEFAULT_SPACE_ID && !name) {
    $('space-err').textContent = 'Le nom ne peut pas être vide.';
    $('space-err').removeAttribute('hidden');
    return;
  }
  upsertSpace(Object.assign({}, space, {
    name: _spaceScreenId === DEFAULT_SPACE_ID ? (space.name || 'Général') : name,
    description: $('space-description-input').value,
  }));
  renderSpaceMenu();
  syncSpaceUI();
  closeSpaceScreen();
}

// Libellé du bouton de suppression AVEC comptes, posé dès l'ouverture de
// l'écran (pas seulement recalculé au clic) : l'utilisateur doit voir l'impact
// avant même d'armer le bouton, pas seulement lire « Supprimer cet espace ».
// Async (lot Cbis) : le compte fichiers vient d'IDB (getResourcesBySpace) —
// la première peinture peut donc afficher un compte fichiers en retard d'un
// tick, comme le reste du cache session library (cf. piège 18/CLAUDE.md).
async function syncSpaceDeleteLabel(id) {
  const btn = $('space-delete-btn');
  if (!btn) return;
  const convCount = loadConversations().filter(c => (c.spaceId || DEFAULT_SPACE_ID) === id).length;
  const memCount = loadMemories().filter(m => (m.scope || DEFAULT_SPACE_ID) === id && !m.suppressed).length;
  const fileCount = (await getResourcesBySpace(id)).length;
  btn.textContent = `Supprimer (${convCount} conv., ${memCount} souvenir${memCount > 1 ? 's' : ''}, ${fileCount} fichier${fileCount > 1 ? 's' : ''})`;
}

// Suppression D6 : arm-then-run (même pattern que la poubelle sidebar),
// cascade = boucle deleteConv sur les conversations du Space + purge des
// souvenirs scopés + purge des fichiers de bibliothèque (lot Cbis, D5) ; les
// souvenirs profile restent intacts. Le default Space n'a pas de bouton
// (masqué dans openSpaceScreen) — rien à protéger ici.
async function onDeleteSpaceScreen() {
  const btn = $('space-delete-btn');
  if (!_spaceScreenId || _spaceScreenId === DEFAULT_SPACE_ID) return;
  const id = _spaceScreenId;
  const convCount = loadConversations().filter(c => (c.spaceId || DEFAULT_SPACE_ID) === id).length;
  const memCount = loadMemories().filter(m => (m.scope || DEFAULT_SPACE_ID) === id && !m.suppressed).length;
  const fileEntries = await getResourcesBySpace(id);
  const label = `Supprimer (${convCount} conv., ${memCount} souvenir${memCount > 1 ? 's' : ''}, ${fileEntries.length} fichier${fileEntries.length > 1 ? 's' : ''})`;
  armThenRun(btn, async () => {
    const wasActive = id === activeSpaceId;
    for (const c of loadConversations().filter(c => (c.spaceId || DEFAULT_SPACE_ID) === id)) {
      deleteConv(c.id);
    }
    for (const m of loadMemories().filter(m => (m.scope || DEFAULT_SPACE_ID) === id)) {
      forgetMemory(m.id);
    }
    for (const f of await getResourcesBySpace(id)) {
      await deleteResource(f.id);
    }
    deleteSpaceEntry(id);
    closeSpaceScreen();
    if (wasActive) {
      activeSpaceId = DEFAULT_SPACE_ID;
      setActiveSpaceId(DEFAULT_SPACE_ID);
      resetToEmpty();
      syncSpaceUI();
    }
    renderSpaceMenu();
  }, label);
}

// ── Sous-drawer « Serveurs MCP » (cartes éditables, cf. D3) ───────────────────
function openMcpServers() {
  renderMcpServers();
  $('mcp-drawer').classList.add('show');
  $('mcp-backdrop').classList.add('show');
}
function closeMcpServers() {
  $('mcp-drawer').classList.remove('show');
  $('mcp-backdrop').classList.remove('show');
}
function renderMcpServersIfOpen() {
  if ($('mcp-drawer') && $('mcp-drawer').classList.contains('show')) renderMcpServers();
}

// Drawer skills ouvert ? (synchro multi-onglets, lot J : re-render du drawer sur
// réception `skills-updated` seulement s'il est visible.)
function isSkillsDrawerOpen() {
  const el = $('skills-drawer');
  return !!(el && el.classList.contains('show'));
}

function renderMcpServers() {
  const wrap = $('mcp-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const servers = loadMcpServers();
  if (!servers.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun serveur MCP. Ajouter un backend pour déléguer des appels d\'outils.';
    wrap.appendChild(empty);
  } else {
    for (const s of servers) wrap.appendChild(buildMcpCard(s, false));
  }
}

// Ajoute une carte vierge (nouveau serveur) en tête de liste, transport deviné
// au fil de la saisie d'URL (pré-remplissage, jamais override — cf. D4).
function addMcpServerCard() {
  const wrap = $('mcp-list');
  if (!wrap) return;
  const empty = wrap.querySelector('.mem-empty');
  if (empty) empty.remove();
  wrap.insertBefore(buildMcpCard({
    name: '', url: '', transport: '', enabled: true,
    authorization_token: '', timeout: 30000, toolAllowlist: [], toolDenylist: [],
  }, true), wrap.firstChild);
}

// ── Helpers partagés des cartes de configuration (MCP / API / skills) ────────
// Les trois familles de cartes partagent la même anatomie : champs labellisés
// (.cfg-field), zone d'erreur (.cfg-err), toggles (.toggle dans une .cfg-toggle-row).
// Un seul jeu de constructeurs — les classes DIFFÉRENCIANTES (inputs lus par les
// handlers de sauvegarde : .mcp-name, .api-url, .skill-slug…) restent par carte.

function showCardError(cardEl, msg) {
  const el = cardEl.querySelector('.cfg-err');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}

function cfgField(labelText, inputEl, hintText) {
  const field = document.createElement('div');
  field.className = 'cfg-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  field.appendChild(label);
  field.appendChild(inputEl);
  if (hintText) {
    const hint = document.createElement('span');
    hint.className = 'hint';
    hint.textContent = hintText;
    field.appendChild(hint);
  }
  return field;
}

// Composant .toggle (input caché + track + thumb). Retourne { root, input }.
function cfgToggle(inputClass, checked) {
  const root = document.createElement('label');
  root.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = inputClass;
  input.checked = checked;
  const track = document.createElement('span'); track.className = 'track';
  const thumb = document.createElement('span'); thumb.className = 'thumb';
  root.append(input, track, thumb);
  return { root, input };
}

// Rangée « toggle + libellé » (.cfg-toggle-row). Retourne { row, input }.
function cfgToggleRow(inputClass, checked, labelText) {
  const row = document.createElement('label');
  row.className = 'cfg-toggle-row';
  const t = cfgToggle(inputClass, checked);
  row.appendChild(t.root);
  const txt = document.createElement('span');
  txt.textContent = labelText;
  row.appendChild(txt);
  return { row, input: t.input };
}

// Zone d'erreur d'une carte, masquée par défaut (révélée par showCardError).
function cfgErrEl() {
  const err = document.createElement('div');
  err.className = 'cfg-err';
  err.setAttribute('hidden', '');
  return err;
}

// Dropdown pilule pour les formulaires (règle projet : JAMAIS de <select>
// natif — réutiliser le composant .model-menu). Même anatomie que le sélecteur
// de raisonnement des réglages : bouton pilule + menu absolu + valeur portée
// par un input hidden de classe `inputClass`, lu par les handlers de
// sauvegarde comme n'importe quel champ. `options` = [{ value, label }].
// Retourne { root, input, setValue } — setValue(v) met à jour hidden + libellé
// SANS déclencher onChange (réservé aux choix explicites de l'utilisateur).
function cfgPillSelect(inputClass, options, value, onChange) {
  const root = document.createElement('div');
  root.className = 'pill-select is-compact cfg-pill-select';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pill-select-btn';
  const label = document.createElement('span');
  btn.appendChild(label);
  btn.insertAdjacentHTML('beforeend',
    '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>');
  const menu = document.createElement('div');
  menu.className = 'model-menu';
  const input = document.createElement('input');
  input.type = 'hidden';
  input.className = inputClass;

  function setValue(v) {
    input.value = v;
    const opt = options.find(o => o.value === v);
    label.textContent = opt ? opt.label : v;
  }
  function renderOptions() {
    menu.innerHTML = '';
    options.forEach(o => {
      const el = document.createElement('div');
      el.className = 'model-opt' + (o.value === input.value ? ' selected' : '');
      el.innerHTML = `<span>${escHtml(o.label)}</span><span class="check">✓</span>`;
      el.onmousedown = (ev) => {
        ev.preventDefault();
        setValue(o.value);
        menu.classList.remove('show');
        if (onChange) onChange(o.value);
      };
      menu.appendChild(el);
    });
  }
  btn.addEventListener('click', () => {
    if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
    renderOptions();
    menu.classList.add('show');
  });

  root.append(btn, menu, input);
  setValue(value);
  return { root, input, setValue };
}

function buildMcpCard(server, isNew) {
  const card = document.createElement('div');
  card.className = 'cfg-card mcp-card' + (isNew ? ' is-editing' : '');
  const originalName = server.name || '';

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'cfg-view';

  const viewName = document.createElement('div');
  viewName.className = 'cfg-view-name';
  viewName.textContent = server.name || '';
  viewSection.appendChild(viewName);

  const viewUrl = document.createElement('div');
  viewUrl.className = 'cfg-view-url';
  viewUrl.textContent = server.url || '';
  viewSection.appendChild(viewUrl);

  const viewRow = document.createElement('div');
  viewRow.className = 'cfg-view-row mcp-view-row';

  // Toggle en mode vue (class d'input distincte — onSaveMcpCard lit .mcp-enabled
  // dans la section édition)
  const viewToggle = cfgToggleRow('mcp-enabled-view', server.enabled !== false, 'Activé');
  const viewEnabledI = viewToggle.input;
  viewRow.appendChild(viewToggle.row);

  // Pill de statut — masquée si désactivé
  const viewStatus = document.createElement('div');
  viewStatus.className = 'mcp-status';
  if (!isNew && server.enabled !== false) {
    const st = getMcpStatus(originalName);
    if (st) {
      if (st.state === 'ok') { viewStatus.classList.add('ok'); viewStatus.textContent = '● Connecté — ' + st.count + ' outil' + (st.count > 1 ? 's' : ''); }
      else if (st.state === 'connecting') { viewStatus.textContent = '● connexion…'; }
      else { viewStatus.classList.add('err'); viewStatus.textContent = '● injoignable' + (st.error ? ' : ' + st.error : ''); }
    }
  }
  viewRow.appendChild(viewStatus);

  // Bouton Modifier — pattern .drawer-btn de la gestion des souvenirs
  const modBtn = document.createElement('button');
  modBtn.className = 'drawer-btn';
  modBtn.textContent = 'Modifier';
  modBtn.addEventListener('click', () => card.classList.add('is-editing'));
  viewRow.appendChild(modBtn);

  viewSection.appendChild(viewRow);
  card.appendChild(viewSection);

  // Toggle vue : persistance immédiate + reconnexion
  viewEnabledI.addEventListener('change', async () => {
    const s = getMcpServer(originalName);
    if (!s) return;
    s.enabled = viewEnabledI.checked;
    upsertMcpServer(s);
    disconnectMcpServer(originalName);
    if (s.enabled) {
      await runBackgroundTask('connexion MCP…', () => connectMcpServer(getMcpServer(originalName)));
    }
    renderMcpServers();
  });

  // ── SECTION ÉDITION ───────────────────────────────────────────────────────
  const editSection = document.createElement('div');
  editSection.className = 'cfg-edit';

  const mkInput = (cls, type, value, placeholder) => {
    const i = document.createElement('input');
    i.className = cls; i.type = type; i.value = value != null ? value : '';
    if (placeholder) i.placeholder = placeholder;
    i.spellcheck = false;
    return i;
  };

  const nameI = mkInput('mcp-name', 'text', server.name, 'jira');
  const urlI  = mkInput('mcp-url', 'text', server.url, 'https://host/mcp');
  // Transport : dropdown pilule custom (cfgPillSelect — pas de <select> natif).
  // La valeur vit dans l'input hidden .mcp-transport, lu tel quel par
  // onSaveMcpCard. Choix explicite → marqué « touché » : la devinette d'URL
  // ne l'écrase jamais (D4) ; serveur existant → touché d'office.
  const transport = cfgPillSelect('mcp-transport', [
    { value: 'streamable-http', label: 'streamable-http' },
    { value: 'sse', label: 'sse (différé)' },
  ], server.transport || 'streamable-http',
    () => { transport.input.dataset.touched = '1'; });
  if (server.transport) transport.input.dataset.touched = '1';
  urlI.addEventListener('input', () => {
    if (!transport.input.dataset.touched) transport.setValue(guessMcpTransport(urlI.value));
  });

  const tokenI = mkInput('mcp-token', 'password', server.authorization_token, 'Bearer (optionnel)');
  const tmoI = mkInput('mcp-timeout', 'number', server.timeout || 30000, '30000');
  const allowI = mkInput('mcp-allow', 'text', (server.toolAllowlist || []).join(', '), 'outil1, outil2 (vide = tous)');
  const denyI  = mkInput('mcp-deny', 'text', (server.toolDenylist || []).join(', '), 'outils à masquer');

  editSection.appendChild(cfgField('Nom (préfixe)', nameI, 'Unique, sans espace ni « __ ». « miaou » réservé.'));
  editSection.appendChild(cfgField('URL', urlI));
  editSection.appendChild(cfgField('Transport', transport.root));
  editSection.appendChild(cfgField('Jeton d\'autorisation', tokenI, 'Stocké en clair (localStorage) — usage non-prod encouragé.'));
  editSection.appendChild(cfgField('Timeout (ms)', tmoI));
  editSection.appendChild(cfgField('Outils autorisés', allowI));
  editSection.appendChild(cfgField('Outils masqués', denyI));

  // Toggle en mode édition (.mcp-enabled lu par onSaveMcpCard)
  editSection.appendChild(cfgToggleRow('mcp-enabled', server.enabled !== false, 'Activé').row);

  // Toggle showCalls — affiche les lignes d'appel MCP dans le thread
  editSection.appendChild(cfgToggleRow('mcp-show-calls', server.showCalls !== false,
    'Afficher les appels dans le thread').row);

  editSection.appendChild(cfgErrEl());

  const actions = document.createElement('div');
  actions.className = 'cfg-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'drawer-btn primary mcp-save'; saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSaveMcpCard(card, originalName));
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'drawer-btn mcp-cancel'; cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => { if (isNew) card.remove(); else card.classList.remove('is-editing'); });
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  if (!isNew) {
    const delBtn = document.createElement('button');
    delBtn.className = 'drawer-btn danger mcp-del'; delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', () =>
      armThenRun(delBtn, () => onDeleteMcpCard(card, originalName), 'Confirmer ?'));
    actions.appendChild(delBtn);
  }
  editSection.appendChild(actions);

  card.appendChild(editSection);
  return card;
}

// ── Sous-drawer « Serveurs API » (cartes éditables, même pattern que MCP) ─────
// Remplace les champs plats url/key/model de la catégorie Connexion. `id` fait
// clé d'identité (pas `name`, cf. storage.js) : le renommage ne casse rien.
function openApiServers() {
  renderApiServers();
  $('api-drawer').classList.add('show');
  $('api-backdrop').classList.add('show');
}
function closeApiServers() {
  $('api-drawer').classList.remove('show');
  $('api-backdrop').classList.remove('show');
}
// Affichage lecture seule (catégorie Connexion) du serveur actif : nom en gras,
// « › modèle par défaut » à la suite (même séparateur coloré que le thread),
// URL en hint dessous — évite d'ouvrir le drawer juste pour vérifier le modèle.
function syncActiveApiServerUI() {
  const s = activeApiServer();
  const nameEl = $('active-api-server-name');
  const urlEl = $('active-api-server-url');
  if (nameEl) {
    nameEl.innerHTML = '';
    if (!s) {
      nameEl.textContent = 'Aucun serveur configuré';
    } else {
      const n = document.createElement('span');
      n.textContent = s.name;
      nameEl.appendChild(n);
      if (s.model) {
        const sep = document.createElement('span');
        sep.className = 'inline-sep';
        sep.textContent = '›';
        const m = document.createElement('span');
        m.className = 'active-api-server-model';
        m.textContent = s.model;
        nameEl.append(sep, m);
      }
    }
  }
  if (urlEl) urlEl.textContent = s ? s.url : '';
}

function renderApiServers() {
  const wrap = $('api-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const servers = loadApiServers();
  if (!servers.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun serveur API. Ajouter un backend pour activer MIAOU.';
    wrap.appendChild(empty);
  } else {
    const activeId = (activeApiServer() || {}).id;
    for (const s of servers) wrap.appendChild(buildApiCard(s, false, s.id === activeId));
  }
}

function addApiServerCard() {
  const wrap = $('api-list');
  if (!wrap) return;
  const empty = wrap.querySelector('.mem-empty');
  if (empty) empty.remove();
  wrap.insertBefore(buildApiCard({ id: '', name: '', url: '', key: '', model: '' }, true, false), wrap.firstChild);
}

function buildApiCard(server, isNew, isActive) {
  const card = document.createElement('div');
  card.className = 'cfg-card api-card' + (isNew ? ' is-editing' : '');
  const originalId = server.id || '';

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'cfg-view';

  const viewName = document.createElement('div');
  viewName.className = 'cfg-view-name';
  viewName.textContent = server.name || '';
  viewSection.appendChild(viewName);

  const viewUrl = document.createElement('div');
  viewUrl.className = 'cfg-view-url';
  viewUrl.textContent = server.url || '';
  viewSection.appendChild(viewUrl);

  const viewRow = document.createElement('div');
  viewRow.className = 'cfg-view-row api-view-row';

  // Pill « Actif » OU bouton « Utiliser ce serveur » — jamais les deux : le
  // pill dit l'état, le bouton propose la transition, redondants sur une même carte.
  if (isActive) {
    const viewStatus = document.createElement('div');
    viewStatus.className = 'api-status active';
    viewStatus.textContent = '● Actif';
    viewRow.appendChild(viewStatus);
  } else {
    const useBtn = document.createElement('button');
    useBtn.className = 'drawer-btn';
    useBtn.textContent = 'Utiliser ce serveur';
    useBtn.addEventListener('click', () => onUseApiServer(originalId));
    viewRow.appendChild(useBtn);
  }

  const modBtn = document.createElement('button');
  modBtn.className = 'drawer-btn';
  modBtn.textContent = 'Modifier';
  modBtn.addEventListener('click', () => card.classList.add('is-editing'));
  viewRow.appendChild(modBtn);

  viewSection.appendChild(viewRow);
  card.appendChild(viewSection);

  // ── SECTION ÉDITION ───────────────────────────────────────────────────────
  const editSection = document.createElement('div');
  editSection.className = 'cfg-edit';

  const mkInput = (cls, type, value, placeholder) => {
    const i = document.createElement('input');
    i.className = cls; i.type = type; i.value = value != null ? value : '';
    if (placeholder) i.placeholder = placeholder;
    i.spellcheck = false;
    return i;
  };

  const nameI = mkInput('api-name', 'text', server.name, 'Par défaut');
  const urlI  = mkInput('api-url', 'text', server.url, 'http://host-interne/v1');
  const keyHintInfo = apiKeyFieldHint();
  const keyI  = mkInput('api-key', 'password', server.key, keyHintInfo.placeholder);
  const modelI = mkInput('api-model', 'text', server.model, 'gemma4:26b-nvfp4');

  editSection.appendChild(cfgField('Nom', nameI));
  editSection.appendChild(cfgField('URL de l\'API', urlI, 'Endpoint compatible OpenAI, terminant par /v1.'));
  editSection.appendChild(cfgField('Clef API', keyI, keyHintInfo.hint));

  // Le champ modèle enrobe l'input dans une ancre de dropdown (.model-menu) :
  // on construit l'ancre puis on la confie à cfgField comme « input ».
  const modelAnchor = document.createElement('div');
  modelAnchor.className = 'select-anchor api-model-anchor';
  const modelMenu = document.createElement('div');
  modelMenu.className = 'model-menu';
  modelI.addEventListener('focus', () => openApiModelMenu(modelI, modelMenu, urlI, keyI));
  modelI.addEventListener('input', () => onApiModelInput(modelI, modelMenu));
  modelAnchor.append(modelI, modelMenu);
  editSection.appendChild(cfgField('Modèle par défaut', modelAnchor,
    'Choisissez parmi les modèles exposés par l\'API.'));

  // Flag vision manuel (D5, brief A2) : mitigation du silent-failure Ollama
  // (un modèle sans projecteur vision accepte l'image sans erreur puis lit le
  // placeholder [img-0] comme du texte). Réglé par (serveur, modèle courant) ;
  // « Sans vision » remplace proactivement les parts image par un descripteur.
  // Valeur initiale sur le modèle actuellement saisi. `.api-vision` (hidden)
  // porte 'on'/'off', lu par onSaveApiCard. Pas de select natif (cfgPillSelect).
  const visionPill = cfgPillSelect('api-vision', [
    { value: 'on', label: 'Images activées' },
    { value: 'off', label: 'Sans vision (descripteur seul)' },
  ], serverModelVisionEnabled(server, server.model) ? 'on' : 'off');
  // Le flag suit le modèle : changer de modèle réévalue l'état affiché depuis la
  // map `vision` du serveur (un modèle non encore réglé retombe sur « activées »).
  modelI.addEventListener('change', () => {
    visionPill.setValue(serverModelVisionEnabled(server, modelI.value.trim()) ? 'on' : 'off');
  });
  editSection.appendChild(cfgField('Vision (images)', visionPill.root,
    'Si ce modèle ne sait pas lire les images, choisir « Sans vision » : MIAOU enverra un descripteur textuel à la place.'));

  editSection.appendChild(cfgErrEl());

  const actions = document.createElement('div');
  actions.className = 'cfg-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'drawer-btn primary api-save'; saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSaveApiCard(card, originalId));
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'drawer-btn api-cancel'; cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => { if (isNew) card.remove(); else card.classList.remove('is-editing'); });
  actions.appendChild(saveBtn);
  actions.appendChild(cancelBtn);
  if (!isNew && loadApiServers().length > 1) {
    const delBtn = document.createElement('button');
    delBtn.className = 'drawer-btn danger api-del'; delBtn.textContent = 'Supprimer';
    delBtn.addEventListener('click', () =>
      armThenRun(delBtn, () => onDeleteApiCard(card, originalId), 'Confirmer ?'));
    actions.appendChild(delBtn);
  }
  editSection.appendChild(actions);

  card.appendChild(editSection);
  return card;
}

// ── Skills : drawer de gestion ───────────────────────────────────────────────
// ── Import de fichier .md dans le drawer skills : drag&drop + paste Finder ────
// Cible = tout le drawer (#skills-drawer), pas seulement la liste : zone de drop
// large et prévisible, pattern .dragover identique au composer (composer.css).
// Seul un fichier .md/text est retenu (filtre nom/type — un .png ou autre glissé
// par erreur est ignoré silencieusement, pas d'erreur bruyante pour un mauvais drop).
function isMarkdownFile(file) {
  if (!file) return false;
  if (file.type === 'text/markdown' || file.type === 'text/plain') return true;
  return /\.(md|markdown|txt)$/i.test(file.name || '');
}
function onSkillsDragOver(e) {
  e.preventDefault();
  const dz = $('skills-drawer');
  if (dz) dz.classList.add('dragover');
}
function onSkillsDragLeave(e) {
  const dz = $('skills-drawer');
  if (dz && (!e.relatedTarget || !dz.contains(e.relatedTarget))) dz.classList.remove('dragover');
}
function onSkillsDrop(e) {
  e.preventDefault();
  const dz = $('skills-drawer');
  if (dz) dz.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  const file = Array.from(files).find(isMarkdownFile);
  if (!file) return;
  file.text().then(text => ingestSkillMarkdownFile(text)).catch(() => {});
}
// Copier-coller Finder/Explorateur sur le drawer (hors focus d'une textarea déjà
// en édition — ce cas est intercepté par le listener .skill-content lui-même,
// stopPropagation, avant de remonter ici). Même filtre/lecture que le drop.
function onSkillsDrawerPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  let file = null;
  for (const item of items) {
    if (item.kind === 'file') { const f = item.getAsFile(); if (f && isMarkdownFile(f)) { file = f; break; } }
  }
  if (!file) return;
  e.preventDefault();
  file.text().then(text => ingestSkillMarkdownFile(text)).catch(() => {});
}

// Liste les skills depuis le cache mémoire (méta) ; le contenu Markdown est lu en
// IDB à l'entrée en édition (getSkillRecord), jamais conservé en cache.
function openSkills() {
  renderSkills();
  $('skills-drawer').classList.add('show');
  $('skills-backdrop').classList.add('show');
}
function closeSkills() {
  $('skills-drawer').classList.remove('show');
  $('skills-backdrop').classList.remove('show');
}

// Légende « / pour une skill » du composer : visible seulement s'il existe au
// moins une skill activée (sinon le slash n'a aucun sens pour l'utilisateur).
function syncSkillHintUI() {
  const el = $('composer-hint-skill');
  if (el) el.hidden = !listEnabledSkills().length;
}

// Légende de la palette : le raccourci écoute metaKey||ctrlKey partout (cf.
// handler cmdk), mais le libellé suit la plateforme (Cmd sur Mac, Ctrl ailleurs).
function syncPaletteHintUI() {
  const el = $('composer-hint-cmdk-key');
  if (!el) return;
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  el.textContent = isMac ? 'Cmd+K' : 'Ctrl+K';
}

function renderSkills() {
  syncSkillHintUI();   // tout CRUD skill (save/delete/toggle) repasse ici
  const wrap = $('skill-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  const skills = listAllSkillsCache();   // skills.js — méta, ordre d'insertion
  if (!skills.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucune skill. Créer un fragment d\'instructions réutilisable.';
    wrap.appendChild(empty);
    return;
  }
  // Skills utilisateur en tête (ce qu'on modifie le plus souvent), skills
  // système ensuite dans un groupe distinct précédé d'un texte d'intro —
  // non éditables (cf. buildSystemSkillCard), pour ne pas les noyer dans la
  // liste modifiable.
  const system = skills.filter(s => s.system === true);
  const user = skills.filter(s => s.system !== true);
  for (const s of user) wrap.appendChild(buildSkillCard(s, false));
  if (system.length) {
    const intro = document.createElement('div');
    intro.className = 'hint skill-system-intro';
    intro.textContent = 'Skills système : fournies par l\'application, toujours actives, non modifiables ni supprimables.';
    wrap.appendChild(intro);
    for (const s of system) wrap.appendChild(buildSystemSkillCard(s));
  }
}

// Carte d'une skill SYSTÈME (non éditable/supprimable, cf. docs/skills.md) :
// toggle enabled (seul réglage utilisateur légitime) + bouton « Consulter »
// qui bascule un panneau readonly rendu via renderMd (marked.js), jamais de
// section édition. Contenu chargé en IDB à l'ouverture, comme enterSkillEdit.
function buildSystemSkillCard(skill) {
  const card = document.createElement('div');
  card.className = 'cfg-card skill-card skill-card--system';
  const slug = skill.slug || '';
  if (slug) card.dataset.slug = slug;

  const viewSection = document.createElement('div');
  viewSection.className = 'cfg-view skill-view';

  const viewMain = document.createElement('div');
  viewMain.className = 'skill-view-main';
  const viewName = document.createElement('div');
  viewName.className = 'skill-view-name';
  viewName.textContent = skill.name || skill.slug || '(sans nom)';
  const viewBadge = document.createElement('span');
  viewBadge.className = 'skill-system-badge';
  viewBadge.textContent = 'Système';
  viewName.appendChild(viewBadge);
  const viewSlug = document.createElement('div');
  viewSlug.className = 'skill-view-slug';
  viewSlug.textContent = '/' + slug;
  viewMain.append(viewName, viewSlug);
  viewSection.appendChild(viewMain);

  const viewRow = document.createElement('div');
  viewRow.className = 'cfg-view-row skill-view-row';

  // Pas de toggle enabled : une skill système est TOUJOURS activée (cf.
  // ensureSystemSkills, skills.js — enabled figé à true à chaque démarrage).

  const viewBtn = document.createElement('button');
  viewBtn.className = 'drawer-btn';
  viewBtn.textContent = 'Consulter';
  viewBtn.addEventListener('click', () => toggleSystemSkillContent(card, slug, viewBtn));
  viewRow.appendChild(viewBtn);

  viewSection.appendChild(viewRow);
  card.appendChild(viewSection);

  const panel = document.createElement('div');
  panel.className = 'skill-system-panel';
  panel.hidden = true;
  if (skill.description) {
    const descView = document.createElement('div');
    descView.className = 'skill-system-desc';
    descView.textContent = skill.description;
    panel.appendChild(descView);
  }
  const contentView = document.createElement('div');
  contentView.className = 'skill-system-content';
  panel.appendChild(contentView);
  card.appendChild(panel);

  return card;
}

// Bascule le panneau de consultation d'une skill système : ouvre + charge le
// contenu (IDB, rendu renderMd) au premier clic, referme ensuite sans
// recharger (re-clic sur Consulter rouvre direct, contenu déjà posé). Le
// libellé du bouton suit l'état (Consulter ↔ Fermer).
function toggleSystemSkillContent(card, slug, btn) {
  const panel = card.querySelector('.skill-system-panel');
  const el = card.querySelector('.skill-system-content');
  if (!panel || !el) return;
  if (!panel.hidden) { panel.hidden = true; if (btn) btn.textContent = 'Consulter'; return; }
  panel.hidden = false;
  if (btn) btn.textContent = 'Fermer';
  if (el.dataset.loaded === '1') return;
  getSkillRecord(slug).then(rec => {
    el.innerHTML = renderMd(rec ? (rec.content || '') : '');
    el.dataset.loaded = '1';
  }).catch(() => {});
}

function addSkillCard() {
  const wrap = $('skill-list');
  if (!wrap) return;
  const empty = wrap.querySelector('.mem-empty');
  if (empty) empty.remove();
  wrap.insertBefore(buildSkillCard({ slug: '', name: '', description: '', enabled: true }, true), wrap.firstChild);
}

// Pré-remplit slug/nom/description/autotrigger d'une card skill (vue édition)
// depuis le cartouche d'un texte donné, sans jamais toucher un champ dont la
// clé correspondante est absente du cartouche. `scope` est la card ou sa section
// édition (querySelector cherche par classe, marche dans les deux cas). Partagé
// par le paste dans .skill-content ET l'import fichier (drag&drop / paste Finder
// hors édition, cf. ingestSkillMarkdownFile, main.js).
function applySkillFrontmatterToCard(scope, text) {
  const fm = parseSkillFrontmatter(text);
  if (!fm) return;
  const slugI = scope.querySelector('.skill-slug');
  const nameI = scope.querySelector('.skill-name');
  const descI = scope.querySelector('.skill-desc');
  if (fm.name != null) {
    if (slugI) slugI.value = slugifySkillName(fm.name);
    if (nameI) nameI.value = fm.name;
  }
  if (fm.description != null && descI) descI.value = fm.description;
  if (fm.disableModelInvocation != null) {
    const autotriggerEl = scope.querySelector('.skill-autotrigger');
    if (autotriggerEl) autotriggerEl.checked = !fm.disableModelInvocation;
  }
}

function buildSkillCard(skill, isNew) {
  const card = document.createElement('div');
  card.className = 'cfg-card skill-card' + (isNew ? ' is-editing' : '');
  const originalSlug = skill.slug || '';
  if (originalSlug) card.dataset.slug = originalSlug;

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'cfg-view skill-view';

  const viewMain = document.createElement('div');
  viewMain.className = 'skill-view-main';
  const viewName = document.createElement('div');
  viewName.className = 'skill-view-name';
  viewName.textContent = skill.name || skill.slug || '(sans nom)';
  const viewSlug = document.createElement('div');
  viewSlug.className = 'skill-view-slug';
  viewSlug.textContent = '/' + (skill.slug || '');
  viewMain.append(viewName, viewSlug);
  viewSection.appendChild(viewMain);

  const viewRow = document.createElement('div');
  viewRow.className = 'cfg-view-row skill-view-row';

  // Toggle enabled en vue, sans libellé (persistance immédiate via onToggleSkill, main.js)
  const viewToggle = cfgToggle('skill-enabled-view', skill.enabled !== false);
  viewRow.appendChild(viewToggle.root);
  if (!isNew) {
    viewToggle.input.addEventListener('change', () => onToggleSkill(originalSlug));
  }

  const modBtn = document.createElement('button');
  modBtn.className = 'drawer-btn';
  modBtn.textContent = 'Modifier';
  modBtn.addEventListener('click', () => enterSkillEdit(card, originalSlug));
  viewRow.appendChild(modBtn);

  viewSection.appendChild(viewRow);
  card.appendChild(viewSection);

  // ── SECTION ÉDITION ───────────────────────────────────────────────────────
  const editSection = document.createElement('div');
  editSection.className = 'cfg-edit';

  const slugI = document.createElement('input');
  slugI.className = 'skill-slug'; slugI.type = 'text'; slugI.value = skill.slug || '';
  slugI.placeholder = 'revue-code'; slugI.spellcheck = false;
  const nameI = document.createElement('input');
  nameI.className = 'skill-name'; nameI.type = 'text'; nameI.value = skill.name || '';
  nameI.placeholder = 'Revue de code'; nameI.spellcheck = false;
  const descI = document.createElement('input');
  descI.className = 'skill-desc'; descI.type = 'text'; descI.value = skill.description || '';
  descI.placeholder = 'Brève description (visible du modèle)'; descI.spellcheck = false;
  const contentT = document.createElement('textarea');
  contentT.className = 'skill-content'; contentT.rows = 10; contentT.spellcheck = false;
  contentT.placeholder = 'Corps de la skill en Markdown…';

  editSection.appendChild(cfgField('Slug', slugI, 'Clé d\'invocation /slug. Sans espace ni « / ».'));
  editSection.appendChild(cfgField('Nom', nameI, 'Libellé d\'affichage.'));
  editSection.appendChild(cfgField('Description', descI, 'Surface lexicale décrite au modèle.'));
  editSection.appendChild(cfgField('Contenu', contentT));

  // Toggle enabled en édition (.skill-enabled lu par onSaveSkillCard)
  editSection.appendChild(cfgToggleRow('skill-enabled', skill.enabled !== false, 'Activée').row);

  // Toggle autotrigger en édition (.skill-autotrigger lu par onSaveSkillCard) —
  // stage 2 : liste cette skill dans le contexte dynamique <miaou_skills_context>
  // à chaque tour, pour découverte proactive par le modèle.
  editSection.appendChild(cfgToggleRow('skill-autotrigger', skill.autotrigger === true,
    'Proposée proactivement au modèle').row);

  editSection.appendChild(cfgErrEl());

  // Collage d'un contenu à cartouche (format Claude Code, ex. untracked/example-skill.md),
  // OU d'un vrai fichier .md copié depuis le Finder/Explorateur (clipboardData porte un
  // File, pas garanti d'être posé en texte nativement par le navigateur — on le lit
  // nous-mêmes via getAsFile() plutôt que de compter sur le comportement natif) :
  // pré-remplit slug/nom/description/autotrigger depuis le frontmatter, sans jamais
  // le retirer du contenu posé dans la textarea (skills.js, parseSkillFrontmatter — pur).
  contentT.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    let file = null;
    if (items) {
      for (const item of items) {
        if (item.kind === 'file') { const f = item.getAsFile(); if (f) { file = f; break; } }
      }
    }
    if (file) {
      e.preventDefault();
      e.stopPropagation();   // évite un double-traitement par le listener du drawer (paste sur #skills-drawer)
      file.text().then(text => { contentT.value = text; applySkillFrontmatterToCard(editSection, text); }).catch(() => {});
      return;
    }
    setTimeout(() => { applySkillFrontmatterToCard(editSection, contentT.value); }, 0);
  });

  const actions = document.createElement('div');
  actions.className = 'cfg-actions';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'drawer-btn primary skill-save'; saveBtn.textContent = 'Enregistrer';
  saveBtn.addEventListener('click', () => onSaveSkillCard(card, originalSlug));
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'drawer-btn skill-cancel'; cancelBtn.textContent = 'Annuler';
  cancelBtn.addEventListener('click', () => { if (isNew) card.remove(); else card.classList.remove('is-editing'); });
  actions.append(saveBtn, cancelBtn);
  if (!isNew) {
    const delBtn = document.createElement('button');
    delBtn.className = 'drawer-btn danger skill-del'; delBtn.textContent = 'Supprimer';
    // Hard delete définitif : armement deux temps (pas de window.confirm natif).
    delBtn.addEventListener('click', () =>
      armThenRun(delBtn, () => onDeleteSkillCard(card, originalSlug), 'Confirmer ?'));
    actions.appendChild(delBtn);
  }
  editSection.appendChild(actions);

  card.appendChild(editSection);
  return card;
}

// Entre en mode édition : récupère le contenu Markdown en IDB (jamais en cache) et
// le pose dans la textarea avant d'afficher la section édition.
function enterSkillEdit(card, slug) {
  const ta = card.querySelector('.skill-content');
  if (ta && slug) {
    getSkillRecord(slug).then(rec => { if (rec && ta) ta.value = rec.content || ''; }).catch(() => {});
  }
  card.classList.add('is-editing');
}

// ── Autocomplétion des skills (slash-commande) ─────────────────────────────────
// Filtre le cache mémoire (skills ACTIVÉS) sur le trigger `/slug` actif le plus
// proche du curseur (cf. findSlashTriggers, skills.js — trigger = position 0 OU
// précédé d'un espace/saut de ligne). Mécanique GÉNÉRIQUE partagée par le composer
// et la bulle d'édition in-place : chaque contexte fournit un état `{ ta, box,
// index }` (cf. _composerAc / état créé dans enterEditMode). `index` mémorise la
// sélection clavier ET le trigger actif courant (start/end/slug) pour l'insertion.

const _composerAc = { ta: null, box: null, index: -1, trigger: null };

function onComposerInput() {
  clearComposerSkillError();
  const ta = $('composer-text');
  const box = $('skill-ac');
  if (!ta || !box) return;
  _composerAc.ta = ta; _composerAc.box = box;
  updateSkillAutocomplete(_composerAc);
}

// Recalcule et (re)peint l'autocomplétion pour un état `{ ta, box }` donné, en
// fonction du trigger `/slug` actif sous le curseur. Position 0 avec slug VIDE
// ouvre immédiatement la liste complète (au pic du `/`, l'intention est déjà claire) ;
// toute autre position attend ≥1 caractère après le `/` avant d'ouvrir, pour ne pas
// être intrusif sur un `/` littéral en cours de frappe normale.
function updateSkillAutocomplete(state) {
  const ta = state.ta;
  const triggers = findSlashTriggers(ta.value);
  const caret = ta.selectionStart;
  // Trigger actif = celui qui contient le curseur (start <= caret <= end).
  const trig = triggers.find(t => caret >= t.start && caret <= t.end) || null;
  if (!trig) { hideSkillAutocomplete(state); return; }
  if (!trig.atStart && trig.slug === '') { hideSkillAutocomplete(state); return; }
  const matches = matchSkillCompletions(trig.slug);
  if (!matches.length) { hideSkillAutocomplete(state); return; }
  state.trigger = trig;
  renderSkillAutocomplete(state, matches);
}

function renderSkillAutocomplete(state, matches) {
  const box = state.box;
  if (!box) return;
  box.innerHTML = '';
  state.index = -1;
  matches.forEach((s, i) => {
    const opt = document.createElement('div');
    opt.className = 'skill-ac-opt';
    opt.dataset.slug = s.slug;
    const slugEl = document.createElement('span');
    slugEl.className = 'skill-ac-slug';
    slugEl.textContent = '/' + s.slug;
    opt.appendChild(slugEl);
    if (s.name) {
      const nameEl = document.createElement('span');
      nameEl.className = 'skill-ac-name';
      nameEl.textContent = s.name;
      opt.appendChild(nameEl);
    }
    opt.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickSkillCompletion(state, s.slug); });
    box.appendChild(opt);
  });
  box.removeAttribute('hidden');
}

function hideSkillAutocomplete(state) {
  const s = state || _composerAc;
  const box = s.box;
  if (box) { box.setAttribute('hidden', ''); box.innerHTML = ''; }
  s.index = -1;
  s.trigger = null;
}

function skillAutocompleteOpen(state) {
  const box = (state || _composerAc).box;
  return !!box && !box.hasAttribute('hidden');
}

function moveSkillAcSelection(state, delta) {
  const box = state.box;
  if (!box) return;
  const opts = box.querySelectorAll('.skill-ac-opt');
  if (!opts.length) return;
  // Entrée dans la liste par ↑ sans sélection : dernière option (l'arithmétique
  // modulaire depuis -1 donnerait l'avant-dernière). Vaut pour les deux contextes
  // (composer et bulle d'édition), quelle que soit la position de la liste.
  if (state.index < 0 && delta < 0) state.index = opts.length - 1;
  else state.index = (state.index + delta + opts.length) % opts.length;
  opts.forEach((o, i) => o.classList.toggle('active', i === state.index));
  const active = opts[state.index];
  if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
}

// Valide la sélection courante (ou la première option) : complète `/slug ` dans le
// champ ciblé sans envoyer (l'utilisateur déclenche l'injection en envoyant/validant).
function acceptSkillAcSelection(state) {
  const box = state.box;
  if (!box) return false;
  const opts = box.querySelectorAll('.skill-ac-opt');
  if (!opts.length) return false;
  const opt = opts[state.index >= 0 ? state.index : 0];
  if (!opt) return false;
  pickSkillCompletion(state, opt.dataset.slug);
  return true;
}

// Remplace UNIQUEMENT le segment `/slug` du trigger actif (pas tout le champ) —
// nécessaire pour le cas mid-message où du texte entoure le trigger.
function pickSkillCompletion(state, slug) {
  const ta = state.ta;
  const trig = state.trigger;
  if (!ta || !trig) return;
  const v = ta.value;
  const replacement = '/' + slug + ' ';
  ta.value = v.slice(0, trig.start) + replacement + v.slice(trig.end);
  const caret = trig.start + replacement.length;
  hideSkillAutocomplete(state);
  ta.focus();
  ta.setSelectionRange(caret, caret);
  autoGrow(ta);
}

function showComposerSkillError(msg) {
  const el = $('composer-skill-error');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}
function clearComposerSkillError() {
  const el = $('composer-skill-error');
  if (el) { el.setAttribute('hidden', ''); el.textContent = ''; }
}

// ── Cascade de rendu des blocs NON-text d'un résultat d'outil distant (D8) ────
// Placés DANS la bulle assistant, avant le corps (comme les acks). Éphémères :
// jamais persistés (cf. D8), disparaissent au reload. DOM-safe : textContent ou
// attributs (img src en data-URI) ; aucun markup modèle injecté en innerHTML.
function placeToolBlocks(wrap, blocks) {
  const body = wrap && wrap.querySelector('.body');
  for (const b of (blocks || [])) {
    const node = renderToolBlock(b);
    if (!node) continue;
    if (body) wrap.insertBefore(node, body);
    else if (wrap) wrap.appendChild(node);
  }
}

function renderToolBlock(block) {
  const box = document.createElement('div');
  box.className = 'tool-block';
  // 1. image base64 → <img> data-URI (DOM-safe, aucun markup injecté).
  if (block && block.type === 'image' && block.data) {
    const img = document.createElement('img');
    img.className = 'tool-block-img';
    img.src = 'data:' + (block.mimeType || 'image/png') + ';base64,' + block.data;
    img.alt = 'Image renvoyée par un outil';
    img.title = 'Agrandir';
    // A3-2 : closure directe (élément créé par createElement) — pas de
    // handler global nécessaire, contrairement aux chips (onclick inline).
    img.onclick = () => openToolImageLightbox(img);
    box.appendChild(img);
    return box;
  }
  // 2. resource avec blob image → <img> inline (miroir de makeResourcePresentBlock).
  const r = block && block.resource;
  if (block && block.type === 'resource' && r) {
    if (r.blob != null && r.mimeType && r.mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.className = 'tool-block-img';
      img.src = 'data:' + r.mimeType + ';base64,' + r.blob;
      img.alt = 'Image renvoyée par un outil';
      img.title = 'Agrandir';
      img.onclick = () => openToolImageLightbox(img);
      box.appendChild(img);
      return box;
    }
    // 3. resource text-like → bloc de code surligné (Prism lazy), via textContent.
    if (r.text != null) return renderResourceText(box, r);
  }
  // 4. binaire / inconnu → téléchargement éphémère (rien n'est persisté).
  return renderBinaryBlock(box, block);
}

function renderResourceText(box, resource) {
  box.classList.add('tool-block-code');   // conteneur pleine largeur → rendu identique au bloc assistant
  const lang = mimeToLang(resource.mimeType);
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  if (lang) code.className = 'language-' + lang;
  code.textContent = String(resource.text);   // frontière XSS : jamais innerHTML
  pre.appendChild(code);
  box.appendChild(pre);
  // Même chrome que les blocs de code des messages assistant : on construit le
  // <pre><code> à la main (pas de markdown ici), puis on le confie aux DEUX helpers
  // partagés — decoratePre (header + boutons copier/télécharger) et highlightUnder
  // (Prism, garde highlightEnabled incluse). Aucun wrapper réinventé, aucun 3e chemin.
  decoratePre(box);
  highlightUnder(box);
  return box;
}

function renderBinaryBlock(box, block) {
  const b64 = (block && (block.data || (block.resource && block.resource.blob))) || '';
  const mime = (block && (block.mimeType || (block.resource && block.resource.mimeType))) || 'application/octet-stream';
  const uri = (block && block.resource && block.resource.uri) || '';
  const fname = ((uri.split('/').pop() || '').split('?')[0]) || 'piece-jointe';
  box.classList.add('tool-block-binary');
  const label = document.createElement('span');
  label.className = 'tool-block-label';
  label.textContent = 'Pièce jointe : ' + fname + ' (' + mime + ')';
  const btn = document.createElement('button');
  btn.className = 'tool-block-dl';
  btn.textContent = 'Télécharger';
  btn.addEventListener('click', () => {
    try { downloadFile(fname, b64ToBytes(b64), mime); }   // Blob éphémère, rien persisté
    catch (e) { /* base64 invalide : rien à offrir */ }
  });
  box.appendChild(label);
  box.appendChild(btn);
  return box;
}

// Présente une ressource IDB inline dans un conteneur DOM (chip expand ou autre).
// getCachedRecord / makeResourcePresentBlock viennent de resources.js (chargé avant).
// ⚠️ DORMANT / NON APPELÉE (audit F, 2026-07-10) : destinée à être le `spec.expand`
// du bloc expand de renderAck (cf. commentaire là-bas), mais aucun ACK_SPEC ne
// pose `expand:` → jamais invoquée. Conservée comme jalon, pas du code actif.
function presentResourceFromChip(id, containerEl) {
  const record = getCachedRecord(id);
  if (!record) {
    const span = document.createElement('span');
    span.textContent = 'Ressource non disponible.';
    containerEl.appendChild(span);
    return;
  }
  const block = makeResourcePresentBlock(record);
  if (!block) return;
  const node = renderToolBlock(block);
  if (node) {
    containerEl.appendChild(node);
    if (highlightEnabled && window.Prism) Prism.highlightAll();
  }
}

function mimeToLang(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.indexOf('json') >= 0) return 'json';
  if (m.indexOf('javascript') >= 0) return 'javascript';
  if (m.indexOf('html') >= 0) return 'html';
  if (m.indexOf('css') >= 0) return 'css';
  if (m.indexOf('xml') >= 0) return 'xml';
  if (m.indexOf('yaml') >= 0 || m.indexOf('yml') >= 0) return 'yaml';
  if (m.indexOf('markdown') >= 0) return 'markdown';
  if (m.indexOf('python') >= 0) return 'python';
  return '';
}

function setMemItemLoading(item, label) {
  const btn = item.querySelector('.drawer-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spin"></span>' + escHtml(label);
}

// ── Souvenirs utilisateur (onglet Souvenirs du drawer combiné = profile ;
//    écran Space = scope de ce Space, brief D5 lot C) ────────────────────────
// Paramétrée conteneur + scope (au lieu de dupliquer, cf. audit §7) :
// `containerId` = id de l'élément conteneur ; `scope` = 'profile' (défaut,
// drawer réglages) ou un spaceId (écran Space, promotion disponible en plus).
// L'input d'ajout est namespacé par conteneur ('mem-add-input-' + containerId)
// pour coexister sans collision si les deux écrans étaient un jour montés
// simultanément ; les ids par ENTRÉE restent globaux (memory id unique).
function renderMemoryList(containerId, scope) {
  containerId = containerId || 'memory-list';
  scope = scope || 'profile';
  const wrap = $(containerId);
  if (!wrap) return;
  wrap.innerHTML = '';
  const addInputId = 'mem-add-input-' + containerId;

  const addArea = document.createElement('div');
  addArea.className = 'mem-add';
  addArea.innerHTML =
    `<textarea class="mem-add-input" id="${addInputId}" rows="2" placeholder="Nouveau souvenir…"></textarea>` +
    `<button class="drawer-btn mem-add-btn" onclick="addMemoryEntry('${containerId}','${scope}')">Ajouter</button>`;
  wrap.appendChild(addArea);

  const all = listMemoryEntries([scope]).concat(loadMemories().filter(e => e.suppressed && (e.scope || DEFAULT_SPACE_ID) === scope))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun souvenir pour l\'instant.';
    wrap.appendChild(empty);
    return;
  }

  const promoteBtn = scope !== 'profile'
    ? `<button class="drawer-btn" onclick="promoteMemoryEntry('${'{{ID}}'}','${containerId}','${scope}')">Promouvoir en profil</button>`
    : '';

  for (const e of all) {
    const item = document.createElement('div');
    item.className = 'mem-item' + (e.suppressed ? ' suppressed' : '');
    item.dataset.id = e.id;
    const date = new Date(e.updated_at || e.created_at || 0).toLocaleDateString('fr-FR');

    if (e.suppressed) {
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-sub">supprimé · ${escHtml(date)}</div></div></div>` +
        `<div class="mem-excerpt">${escHtml((e.content || '').slice(0, 120))}${(e.content || '').length > 120 ? '…' : ''}</div>` +
        `<div class="drawer-btns">` +
        `<button class="drawer-btn" onclick="restoreMemoryEntry('${e.id}','${containerId}','${scope}')">Rétablir</button>` +
        `<button class="drawer-btn danger" onclick="forgetMemoryEntry('${e.id}','${containerId}','${scope}')">Oublier</button>` +
        `</div>`;
    } else {
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-sub">${escHtml(date)}</div></div></div>` +
        `<div class="mem-content" id="mem-content-${e.id}">${escHtml(e.content || '')}</div>` +
        `<div class="drawer-btns" id="drawer-btns-${e.id}">` +
        `<button class="drawer-btn" onclick="startEditMemoryEntry('${e.id}')">Modifier</button>` +
        (promoteBtn ? promoteBtn.replace('{{ID}}', e.id) : '') +
        `<button class="drawer-btn danger" onclick="deleteMemoryEntry('${e.id}','${containerId}','${scope}')">Supprimer</button>` +
        `</div>` +
        `<div class="mem-edit-wrap hidden" id="mem-edit-${e.id}">` +
        `<textarea class="mem-edit-input" id="mem-edit-input-${e.id}">${escHtml(e.content || '')}</textarea>` +
        `<div class="mem-edit-actions">` +
        `<button class="drawer-btn primary" onclick="saveMemoryEntryEdit('${e.id}','${containerId}','${scope}')">Enregistrer</button>` +
        `<button class="drawer-btn" onclick="cancelMemoryEntryEdit('${e.id}')">Annuler</button>` +
        `</div></div>`;
    }
    wrap.appendChild(item);
  }
}

function addMemoryEntry(containerId, scope) {
  containerId = containerId || 'memory-list';
  scope = scope || 'profile';
  const input = $('mem-add-input-' + containerId);
  const content = input ? input.value.trim() : '';
  if (!content) return;
  const now = Date.now();
  saveMemory({ id: genMemoryId(), content, created_at: now, updated_at: now, suppressed: false, scope });
  renderMemoryList(containerId, scope);
  if (_spaceScreenId === scope) syncSpaceDeleteLabel(scope);
}

function deleteMemoryEntry(id, containerId, scope) { suppressMemory(id); renderMemoryList(containerId, scope); if (_spaceScreenId === scope) syncSpaceDeleteLabel(scope); }
function restoreMemoryEntry(id, containerId, scope) { restoreMemory(id); renderMemoryList(containerId, scope); if (_spaceScreenId === scope) syncSpaceDeleteLabel(scope); }
function forgetMemoryEntry(id, containerId, scope) { forgetMemory(id); renderMemoryList(containerId, scope); if (_spaceScreenId === scope) syncSpaceDeleteLabel(scope); }

// Promotion Space → profile (UI-only, brief D3/D5) : réécrit le scope en
// place, pas de nouvelle entrée. Démotion volontairement absente en v1 (cf.
// docs/spaces.md, non-goal) — décision à revalider avec Julien si demandée.
function promoteMemoryEntry(id, containerId, scope) {
  const arr = loadMemories();
  const e = arr.find(x => x.id === id);
  if (!e) return;
  e.scope = 'profile';
  persistMemories(arr);
  renderMemoryList(containerId, scope);
}

// ── Bibliothèque de fichiers d'espace (D6, lot Cbis) ─────────────────────────
// Frère de renderMemoryList : composants de carte réutilisés (mem-item/
// mem-header/mem-sub/mem-excerpt, drawers.css), pas de duplication de style.
// Async (getResourcesBySpace lit IDB) — appelée fire-and-forget par
// openSpaceScreen, comme loadSpaceLibrary. Tri createdAt→id, même ordre
// déterministe que le manifeste de contexte (Cbis-2).
async function renderSpaceFilesList(spaceId) {
  const wrap = $('space-files-list');
  if (!wrap) return;
  const entries = (await getResourcesBySpace(spaceId)).slice()
    .sort((a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : String(a.id).localeCompare(String(b.id))));
  wrap.innerHTML = '';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun fichier dans la bibliothèque de cet espace.';
    wrap.appendChild(empty);
    return;
  }
  for (const e of entries) {
    const item = document.createElement('div');
    item.className = 'mem-item';
    item.dataset.id = e.id;
    const provenanceBadge = e.source ? '<span class="mem-sub"> · promu depuis une conversation</span>' : '';
    const descriptionLine = `<div class="mem-excerpt file-description-line" id="file-description-${e.id}">${e.description ? escHtml(e.description) : ''}</div>`;
    item.innerHTML =
      `<div class="mem-header"><div class="mem-meta">` +
      `<div class="mem-sub">${escHtml(e.mime)} · ${escHtml(humanSize(e.size))}${provenanceBadge}</div>` +
      `</div></div>` +
      `<div class="mem-content">${escHtml(e.name)}</div>` +
      descriptionLine +
      `<div class="drawer-btns" id="file-btns-${e.id}">` +
      `<button class="drawer-btn" onclick="onRegenerateFileDescription(this,'${e.id}','${spaceId}')">${e.description ? '(re)générer' : 'Générer une description'}</button>` +
      `<button class="drawer-btn danger" onclick="onDeleteSpaceFile(this,'${e.id}','${spaceId}')">Supprimer</button>` +
      `</div>`;
    wrap.appendChild(item);
  }
}

// Statut de description par carte (D7) : « description en cours… » pendant le
// calcul, puis contenu (done) ou message d'échec discret (failed) — précédent
// setMemItemLoading, mais ciblé sur les deux zones (excerpt + bouton) plutôt
// qu'un seul bouton, pour afficher le résultat sans re-render complet.
function setFileDescriptionStatus(fileId, status, description) {
  const line = $('file-description-' + fileId);
  const btns = $('file-btns-' + fileId);
  const btn = btns ? btns.querySelector('.drawer-btn:not(.danger)') : null;
  if (status === 'loading') {
    if (line) line.textContent = 'description en cours…';
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
  } else if (status === 'done') {
    if (line) line.textContent = description || '';
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = '(re)générer'; }
  } else if (status === 'failed') {
    if (line) line.textContent = '';
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Générer une description'; }
  }
}

// Action manuelle "(re)générer" — force le calcul même si le toggle est OFF
// ou qu'une description existe déjà (contrairement au trigger d'ingestion).
async function onRegenerateFileDescription(btn, fileId, spaceId) {
  await describeFileIfNeeded(fileId, (status) => {
    if (status === 'done') {
      getResource(fileId).then(rec => setFileDescriptionStatus(fileId, 'done', rec && rec.description));
    } else {
      setFileDescriptionStatus(fileId, status);
    }
  }, true);
}

function onSpaceFilesUploadClick() {
  const input = $('space-file-input');
  if (input) { input.value = ''; input.click(); }
}

// Upload direct (D2 path 1) : mêmes caps que le composer (ingestLibraryFile,
// main.js), mais aucune notion d'attId/conversation ici — chaque fichier
// rejoint directement la bibliothèque du Space actif (onglet sidebar,
// indépendant de l'écran Space qui peut être fermé).
async function onSpaceFilesSelected(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  clearSpaceFilesError();
  const spaceId = activeSpaceId;
  const stored = [];
  for (const file of files) {
    const rec = await ingestLibraryFile(spaceId, file);
    if (rec) stored.push(rec);
  }
  await renderSpaceFilesList(spaceId);
  if (_spaceScreenId === spaceId) syncSpaceDeleteLabel(spaceId);
  // Trigger D7 après le re-render (statut par carte visible dès le premier tick) :
  // fire-and-forget, chaque fichier indépendant (pas de blocage séquentiel).
  for (const rec of stored) {
    describeFileIfNeeded(rec.id, (status) => {
      if (status === 'done') {
        getResource(rec.id).then(r => setFileDescriptionStatus(rec.id, 'done', r && r.description));
      } else {
        setFileDescriptionStatus(rec.id, status);
      }
    });
  }
}

// Suppression d'un fichier de bibliothèque : arm-then-run (même pattern que
// la poubelle sidebar/mémoire), pas de tombstone — le brief D6 ne prévoit pas
// de restauration (non-goal v1, mirror de C).
function onDeleteSpaceFile(btn, id, spaceId) {
  armThenRun(btn, async () => {
    await deleteResource(id);
    renderSpaceFilesList(spaceId);
    if (_spaceScreenId === spaceId) syncSpaceDeleteLabel(spaceId);
  });
}

function startEditMemoryEntry(id) {
  const btns = $('drawer-btns-' + id);
  const contentEl = $('mem-content-' + id);
  const editWrap = $('mem-edit-' + id);
  if (btns) btns.classList.add('hidden');
  if (contentEl) contentEl.hidden = true;
  if (editWrap) editWrap.classList.remove('hidden');
  const area = $('mem-edit-input-' + id);
  if (area) { area.focus(); area.selectionStart = area.selectionEnd = area.value.length; }
}

function cancelMemoryEntryEdit(id) {
  const btns = $('drawer-btns-' + id);
  const editWrap = $('mem-edit-' + id);
  const contentEl = $('mem-content-' + id);
  if (btns) btns.classList.remove('hidden');
  if (editWrap) editWrap.classList.add('hidden');
  if (contentEl) contentEl.hidden = false;
}

function saveMemoryEntryEdit(id, containerId, scope) {
  const area = $('mem-edit-input-' + id);
  if (!area) return;
  const content = area.value.trim();
  if (!content) return;
  editMemory(id, content);
  renderMemoryList(containerId, scope);
}

// ── Confirmation inline (cartes dans le thread) ───────────────────────────────

// _proposalMap[pid] = { onAccept, onReject } — callbacks, jamais les données brutes.
// const : on vide et peuple en place, on ne réassigne jamais la référence.
const _proposalMap = {};

// Purge la table et efface l'overlay. Appelée quand le DOM du thread est rasé
// (changement/réinitialisation de conversation).
function clearMemoryProposals() {
  for (const k in _proposalMap) delete _proposalMap[k];
  setConfirmPending(false);
}

// Primitif générique : une carte « question » + Accepter/Rejeter, avec overlay.
// bodyHtml : contenu libre (texte de la question, diff, etc.).
function showConfirmation(bodyHtml, onAccept, onReject) {
  const thread = $('thread');
  const pid = 'prop-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  _proposalMap[pid] = { onAccept: onAccept || function(){}, onReject: onReject || function(){} };

  const container = document.createElement('div');
  container.className = 'memory-proposals';
  const card = document.createElement('div');
  card.className = 'proposal-card';
  card.id = pid;
  card.innerHTML =
    bodyHtml +
    `<div class="proposal-actions">` +
    `<button class="mb-btn primary" onclick="acceptProposal('${pid}')">Accepter</button>` +
    `<button class="mb-btn" onclick="rejectProposal('${pid}')">Rejeter</button>` +
    `</div>`;
  container.appendChild(card);
  thread.appendChild(container);
  setConfirmPending(true);
  // behavior:'smooth' est une option JS, non couverte par le kill-switch CSS
  // (scroll-behavior:auto) : gate explicite via motionReduced() (ui.js).
  container.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'nearest' });
}

function acceptProposal(pid) {
  const e = _proposalMap[pid];
  if (!e) return;
  e.onAccept();
  delete _proposalMap[pid];
  _removeProposalCard(pid);
}

function rejectProposal(pid) {
  const e = _proposalMap[pid];
  if (!e) return;
  e.onReject();
  delete _proposalMap[pid];
  _removeProposalCard(pid);
}

function _removeProposalCard(pid) {
  const card = document.getElementById(pid);
  if (!card) return;
  const container = card.parentElement;
  card.remove();
  if (container && !container.children.length) container.remove();
  if (!Object.keys(_proposalMap).length) setConfirmPending(false);
}

// ── Export HTML standalone (brief `untracked/muscle/G-html-export.md`) ──────
// Fichier autonome zéro-JS, ouvrable hors MIAOU. Le corps est un RE-RENDU
// depuis currentThread (jamais un clone du DOM live #thread) : sûr par
// construction (mêmes renderers que l'écran), pas de nouveau chemin de
// concaténation de texte modèle hors formatToolAcksHtml (cf. utils.js).

// Liste des tokens de thème (:root, base.css) à sérialiser pour l'export.
// SEULE chose à tenir à jour si un token --… est ajouté au thème (dette
// assumée, cf. docs/exports.md) : --col/--sidebar-w exclus, spécifiques à la
// mise en page écran, sans usage dans un document statique.
const THEME_TOKENS = [
  '--bg', '--surface', '--surface-2', '--surface-3', '--surface-4',
  '--border', '--border-2',
  '--text', '--text-2', '--text-3',
  '--accent', '--accent-2', '--accent-ink', '--accent-dim', '--accent-bd',
  '--ok', '--err',
  '--r', '--r-sm', '--ease',
  '--sans', '--mono',
  '--topbar-bg', '--scrollbar-thumb-hover', '--table-stripe',
  '--code-bg', '--code-head-bg', '--code-inline-color',
];

// Lit les valeurs RÉSOLUES (thème effectif, data-theme déjà tranché light|dark)
// via getComputedStyle — voie runtime tranchée (audit §5) : zéro modif
// build.py, capture automatiquement toute évolution des valeurs de tokens
// (mais PAS l'ajout d'un nouveau nom : cf. THEME_TOKENS ci-dessus).
function serializeThemeTokens() {
  const cs = getComputedStyle(document.documentElement);
  const lines = THEME_TOKENS.map(name => name + ':' + cs.getPropertyValue(name).trim() + ';');
  return ':root{' + lines.join('') + '}';
}

// Copie figée de prism-tomorrow.min.css (thème Prism dark chargé depuis le
// CDN, cf. index.html) + les overrides Prism clair de theme-light.css.
// Dette assumée (docs/exports.md) : à resynchroniser si le thème Prism CDN
// change. Pas de <link> CDN dans l'export (D1, zéro-JS) : les <span> de
// tokens sont pré-générés par Prism.highlightAllUnder à l'export (voie B),
// ce CSS leur donne juste leurs couleurs.
const PRISM_THEME_CSS =
  'code[class*=language-],pre[class*=language-]{color:#ccc;background:0 0;font-family:Consolas,Monaco,\'Andale Mono\',\'Ubuntu Mono\',monospace;font-size:1em;text-align:left;white-space:pre;word-spacing:normal;word-break:normal;word-wrap:normal;line-height:1.5;-moz-tab-size:4;-o-tab-size:4;tab-size:4;-webkit-hyphens:none;-moz-hyphens:none;-ms-hyphens:none;hyphens:none}' +
  'pre[class*=language-]{padding:1em;margin:.5em 0;overflow:auto}' +
  ':not(pre)>code[class*=language-],pre[class*=language-]{background:#2d2d2d}' +
  ':not(pre)>code[class*=language-]{padding:.1em;border-radius:.3em;white-space:normal}' +
  '.token.block-comment,.token.cdata,.token.comment,.token.doctype,.token.prolog{color:#999}' +
  '.token.punctuation{color:#ccc}' +
  '.token.attr-name,.token.deleted,.token.namespace,.token.tag{color:#e2777a}' +
  '.token.function-name{color:#6196cc}' +
  '.token.boolean,.token.function,.token.number{color:#f08d49}' +
  '.token.class-name,.token.constant,.token.property,.token.symbol{color:#f8c555}' +
  '.token.atrule,.token.builtin,.token.important,.token.keyword,.token.selector{color:#cc99cd}' +
  '.token.attr-value,.token.char,.token.regex,.token.string,.token.variable{color:#7ec699}' +
  '.token.entity,.token.operator,.token.url{color:#67cdcc}' +
  '.token.bold,.token.important{font-weight:700}' +
  '.token.italic{font-style:italic}' +
  '.token.inserted{color:green}' +
  'html[data-theme="light"] code[class*="language-"],' +
  'html[data-theme="light"] pre[class*="language-"]{color:#2c2720}' +
  'html[data-theme="light"] .token.comment,' +
  'html[data-theme="light"] .token.prolog,' +
  'html[data-theme="light"] .token.doctype,' +
  'html[data-theme="light"] .token.cdata{color:#8a8272;font-style:italic}' +
  'html[data-theme="light"] .token.punctuation{color:#5a5248}' +
  'html[data-theme="light"] .token.namespace{opacity:.75}' +
  'html[data-theme="light"] .token.property,' +
  'html[data-theme="light"] .token.constant,' +
  'html[data-theme="light"] .token.symbol{color:#8a6800}' +
  'html[data-theme="light"] .token.boolean,' +
  'html[data-theme="light"] .token.number{color:#b5440e}' +
  'html[data-theme="light"] .token.string,' +
  'html[data-theme="light"] .token.char,' +
  'html[data-theme="light"] .token.attr-value,' +
  'html[data-theme="light"] .token.builtin,' +
  'html[data-theme="light"] .token.inserted{color:#276e38}' +
  'html[data-theme="light"] .token.selector,' +
  'html[data-theme="light"] .token.attr-name{color:#b53030}' +
  'html[data-theme="light"] .token.operator,' +
  'html[data-theme="light"] .token.entity,' +
  'html[data-theme="light"] .token.url{color:#1a6b6b}' +
  'html[data-theme="light"] .token.atrule,' +
  'html[data-theme="light"] .token.keyword{color:#7c3c99}' +
  'html[data-theme="light"] .token.function,' +
  'html[data-theme="light"] .token.class-name{color:#1a5fb8}' +
  'html[data-theme="light"] .token.regex,' +
  'html[data-theme="light"] .token.important,' +
  'html[data-theme="light"] .token.variable{color:#b5440e}' +
  'html[data-theme="light"] .token.tag,' +
  'html[data-theme="light"] .token.deleted{color:#b53030}';

// Feuille dédiée MINIMALE (audit §5, choix A) : le sectionnement chat/tools
// n'est pas assez propre pour une extraction programmatique par marqueurs
// (dette next.md), et la majorité des règles écran (:hover, boutons, drawers)
// n'ont aucun sens dans un document statique. Écrite à la main, PAS un miroir
// vivant de chat.css/tools.css/composer.css : dérive silencieusement si ces
// fichiers évoluent (dette assumée, cf. docs/exports.md et mémoire projet).
// Largeur de lecture (900px) EN DUR, pas via var(--col) (720px, gabarit
// composer écran plus étroit) : --col est un token de mise en page écran,
// volontairement absent de THEME_TOKENS (sans usage dans un document
// statique) — le référencer ici résoudrait à rien puisque
// serializeThemeTokens() ne l'émet jamais. 900px choisi pour l'export
// (lecture plus confortable qu'à l'écran, sans devenir "vertigineux" sur un
// grand écran). Si on veut la faire suivre `--col`, l'ajouter à THEME_TOKENS.
const EXPORT_CSS = `
html { zoom: 0.9; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.5; margin: 0; }
.export-topbar-wrap { border-bottom: 1px solid var(--border); }
.export-topbar { max-width: 900px; margin: 0 auto; padding: 14px 20px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; }
.export-logo { width: 44px; height: 44px; flex-shrink: 0; }
.export-title { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
.export-meta { font-size: 12px; color: var(--text-3); }
.export-body { max-width: 900px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
.export-footer-wrap { border-top: 1px solid var(--border); }
.export-footer { max-width: 900px; margin: 0 auto; padding: 20px; font-size: 11px; color: var(--text-3); box-sizing: border-box; }
.msg { display: flex; flex-direction: column; }
.msg.user { align-items: flex-end; margin: 24px 0 10px; }
.msg.user .bubble { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r); padding: 8px 13px; max-width: 80%; word-break: break-word; text-align: left; }
.msg.user .bubble .body { font-size: 13.5px; line-height: 1.6; }
.msg.assistant { align-items: stretch; margin: 4px 0 14px; }
.msg.assistant .meta { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--text-3); margin-bottom: 7px; }
.msg.assistant .body { font-size: 14px; line-height: 1.68; color: var(--text); }
.msg.assistant .tool-trace + .body { margin-top: 7px; }
.msg-ts { font-size: 11px; color: var(--text-3); }
.body > *:first-child { margin-top: 0; }
.body > *:last-child { margin-bottom: 0; }
.body p { margin: 0 0 11px; }
.body h1, .body h2, .body h3 { font-weight: 600; line-height: 1.3; margin: 18px 0 8px; }
.body h1 { font-size: 18px; }
.body h2 { font-size: 16px; }
.body h3 { font-size: 14.5px; }
.body ul, .body ol { margin: 8px 0 12px; padding-left: 22px; }
.body li { margin-bottom: 4px; }
.body li::marker { color: var(--text-3); }
.body a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-bd); }
.body strong { font-weight: 600; color: var(--text); }
.body em { color: var(--text-2); }
.body del { color: var(--text-3); }
.body blockquote { border-left: 2px solid var(--border-2); padding: 2px 0 2px 14px; margin: 10px 0; color: var(--text-2); }
.body hr { border: none; border-top: 1px solid var(--border-2); margin: 18px 0; }
.body code:not([class*="language-"]) { font-family: var(--mono); font-size: 12.5px; background: var(--surface-2); border: 1px solid var(--border); padding: 1px 5px; border-radius: 4px; color: var(--code-inline-color); }
.body table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
.body th, .body td { border: 1px solid var(--border); padding: 6px 11px; text-align: left; }
.body th { background: var(--surface); font-weight: 600; color: var(--text); }
.body td { color: var(--text-2); }
.body tr:nth-child(even) td { background: var(--table-stripe); }
.body pre { margin: 12px 0; border: 1px solid var(--border); border-radius: var(--r); overflow: hidden; background: var(--code-bg) !important; }
.body pre[class*="language-"] { padding: 0; margin: 12px 0; border-radius: var(--r); background: var(--code-bg) !important; }
.code-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: var(--code-head-bg); border-bottom: 1px solid var(--border); }
.code-lang { font-family: var(--mono); font-size: 10.5px; color: var(--text-3); text-transform: lowercase; }
.code-actions { display: flex; align-items: center; gap: 2px; }
.code-copy, .code-dl { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; background: none; border: none; border-radius: 5px; color: var(--text-3); cursor: pointer; padding: 0; }
.code-copy svg, .code-dl svg { width: 13px; height: 13px; }
.code-copy:hover, .code-dl:hover { color: var(--text); background: var(--surface-2); }
.code-copy--checked { color: var(--accent) !important; }
.body pre code { display: block; padding: 13px 14px !important; font-family: var(--mono) !important; font-size: 11.5px !important; line-height: 1.6 !important; overflow-x: auto; background: transparent !important; text-shadow: none !important; }
.reasoning { margin: 0 0 8px; padding: 8px 11px; border-left: 2px solid var(--border-2); background: var(--surface-2); border-radius: 0 6px 6px 0; }
/* Contenu imbriqué DANS le <summary> (pas en frère) : tout le bloc — en-tête
   ET texte du raisonnement — est une seule zone de clic pliable, nativement,
   sans JS (cf. piège <details>/<summary>). Marqueur natif retiré. */
.reasoning summary { cursor: pointer; list-style: none; display: block; }
.reasoning summary::-webkit-details-marker { display: none; }
.reasoning summary::marker { content: ''; }
.reasoning-label { font-size: 11px; color: var(--text-3); }
.reasoning:not([open]) .reasoning-content { display: none; }
.reasoning-content { font-family: var(--sans); font-size: 12px; line-height: 1.5; color: var(--text-2); opacity: .85; white-space: pre-wrap; word-break: break-word; margin-top: 6px; }
.tool-trace { margin: 3px 0 8px 2px; font-size: 12px; color: var(--text-2); }
.tool-trace summary { cursor: pointer; list-style: none; display: block; }
.tool-trace summary::-webkit-details-marker { display: none; }
.tool-trace summary::marker { content: ''; }
.tool-trace-summary-text { display: block; color: var(--accent); margin-bottom: 4px; }
.tool-trace ul { list-style: none; margin: 6px 0 0; padding: 4px 0 4px 10px; border-left: 2px solid var(--accent-bd); }
.tool-trace li { margin-bottom: 6px; }
.tool-trace code { font-family: var(--mono); font-size: 11.5px; }
/* Code exécuté par js__eval (lot L) : bloc <pre> COMPLET dans la trace d'outil,
   seule trace du code (absent du thread live). EXPORT_CSS est une feuille figée
   qui ne suit PAS chat/tools/composer.css (piège 22) — règle dédiée ici. */
.tool-ack-code { margin: 4px 0 2px; padding: 8px 10px; background: var(--code-bg); border: 1px solid var(--border); border-radius: 5px; overflow-x: auto; white-space: pre; }
.tool-ack-code code { font-family: var(--mono); font-size: 11px; line-height: 1.5; color: var(--text-2); }
/* Preview repliée : une ligne par ack façon .tool-ack du thread live (bordure
   gauche + icône + intent ou fallback nom d'outil). Disparaît à l'ouverture,
   remplacée par le détail (ul) — un seul <details>, deux vues exclusives. */
.tool-ack-preview-list { display: flex; flex-direction: column; gap: 3px; }
.tool-ack-preview { display: flex; align-items: baseline; gap: 8px; padding: 4px 0 4px 10px; border-left: 2px solid var(--accent-bd); }
.tool-ack-preview .ack-icon { flex-shrink: 0; display: inline-flex; align-items: center; align-self: center; color: var(--accent); }
.tool-ack-preview .ack-label { flex: 1; overflow-wrap: break-word; }
.tool-trace[open] .tool-ack-preview-list { display: none; }
.tool-trace:not([open]) ul { display: none; }
.msg-attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.att-chip { display: flex; align-items: center; gap: 6px; background: var(--surface-2); border: 1px solid var(--border-2); border-radius: var(--r-sm); padding: 4px 8px; font-size: 12px; color: var(--text-2); max-width: 220px; }
.att-thumb { width: 22px; height: 22px; border-radius: 4px; object-fit: cover; flex-shrink: 0; background: var(--surface-3); }
.att-icon { width: 22px; height: 22px; border-radius: 4px; display: grid; place-items: center; background: var(--surface-3); color: var(--text-3); flex-shrink: 0; }
.att-icon svg { width: 13px; height: 13px; }
.att-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; color: var(--text); }
.att-size { color: var(--text-3); flex-shrink: 0; font-family: var(--mono); font-size: 10.5px; }
/* Images modèle embarquées (lot Gbis) : parité reload — resource_presented /
   resource_stored non-inline / attachment_recalled images. Inspiré de
   .tool-block/.tool-block-img de tools.css (bordure, rayon, max-width) sans le
   copier (piège 22). Pas de cursor:pointer ici : en export statique l'image
   n'est pas cliquable (décision A.4) ; EXPORT_SCRIPT posera le lien + curseur
   en mode interactif (lot Gb2). */
.tool-block { margin: 6px 0; max-width: 100%; }
.tool-block-img { max-width: 100%; height: auto; display: block; border: 1px solid var(--border); border-radius: var(--r-sm); }
/* Diagrammes Mermaid embarqués (lot E4). Né synchronisé avec .mermaid-view de
   chat.css (padding, fond, centrage svg) — dérive ensuite comme le reste de
   cette feuille (piège 22). Pas de display:none/toggle ici : dans l'export le
   SVG est TOUJOURS visible, la source vit repliée dans .mermaid-src. */
.mermaid-view { margin: 12px 0; padding: 14px; background: var(--code-bg); border: 1px solid var(--border); border-radius: var(--r); overflow-x: auto; }
.mermaid-view svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.mermaid-src { margin: -6px 0 12px; }
.mermaid-src summary { cursor: pointer; list-style: none; font-size: 11px; color: var(--text-3); padding: 2px 0; }
.mermaid-src summary::-webkit-details-marker { display: none; }
.mermaid-src summary::marker { content: ''; }
.mermaid-src summary:hover { color: var(--text); }
.mermaid-src[open] summary { margin-bottom: 2px; }
`;

// Script inline OPTIONNEL de l'export (progressive enhancement, D1 révisé —
// brief G). Injecté seulement si settings.exportInteractive (défaut true) via
// scriptTag ; absent, l'export reste strictement statique. Autonome : l'export
// n'a AUCUN global MIAOU (downloadFile, sanitizeDownloadName, LANG_TO_EXT
// n'existent pas), tout est réimplémenté ici en minimal. Révèle sur chaque
// <pre> deux boutons (copier via navigator.clipboard, télécharger via Blob) à
// côté du .code-lang déjà présent statiquement. La barre de langage, elle,
// existe sans JS (decorateExportPre) : ce script n'ajoute QUE les actions.
const EXPORT_SCRIPT = `
(function () {
  var EXT = { python:'py', py:'py', javascript:'js', js:'js', typescript:'ts', ts:'ts', jsx:'jsx', tsx:'tsx', bash:'sh', sh:'sh', shell:'sh', zsh:'sh', json:'json', html:'html', css:'css', sql:'sql', yaml:'yml', yml:'yml', markdown:'md', md:'md' };
  var svgCopy = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var svgCheck = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  var svgDl = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  function dlName(raw, lang) {
    var n = String(raw || '').replace(/[\\/\\\\]/g, '_').replace(/[\\x00-\\x1f\\x7f]/g, '').replace(/^\\.+/, '').trim();
    if (n && !/\\.[^.\\/\\\\]+$/.test(n)) n += '.' + (EXT[(lang || '').toLowerCase()] || 'txt');
    return n || ('miaou-snippet.' + (EXT[(lang || '').toLowerCase()] || 'txt'));
  }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  var pres = document.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    (function (pre) {
      var head = pre.querySelector('.code-head');
      if (!head || head.querySelector('.code-actions')) return;
      var code = pre.querySelector('code');
      var langSpan = head.querySelector('.code-lang');
      var lang = langSpan ? langSpan.textContent : 'text';
      var actions = document.createElement('div');
      actions.className = 'code-actions';
      var copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy'; copyBtn.title = 'Copier'; copyBtn.innerHTML = svgCopy;
      var dlBtn = document.createElement('button');
      dlBtn.className = 'code-dl'; dlBtn.title = 'Télécharger'; dlBtn.innerHTML = svgDl;
      copyBtn.onclick = function () {
        navigator.clipboard.writeText(code ? code.textContent : '').then(function () {
          copyBtn.innerHTML = svgCheck; copyBtn.classList.add('code-copy--checked');
          setTimeout(function () { copyBtn.innerHTML = svgCopy; copyBtn.classList.remove('code-copy--checked'); }, 1400);
        });
      };
      dlBtn.onclick = function () {
        var raw = code ? code.getAttribute('data-filename') : '';
        download(dlName(raw, lang), code ? code.textContent : '');
      };
      actions.appendChild(copyBtn); actions.appendChild(dlBtn);
      head.appendChild(actions);
    })(pres[i]);
  }
  // Images cliquables (lot Gb2) : nouvel onglet. La navigation top-level vers un
  // data: est bloquée par les navigateurs → on convertit le data URL en Blob et
  // on window.open l'URL d'objet. AUCUNE donnée modèle/outil interpolée ici
  // (piège 21) : les data URL sont LUS depuis le DOM (img.src déjà posé par
  // renderExportBody), jamais injectés dans ce script. Cibles : images modèle
  // (.tool-block-img) et vignettes de chips user image (.att-chip > img.att-thumb,
  // clic sur le chip ENTIER). Échec de conversion → rien (pas de fallback data:
  // top-level, interdit) ; en export STATIQUE (ce script absent) les images
  // restent visibles mais non cliquables (décision A.4).
  function dataUrlToBlob(u) {
    var comma = u.indexOf(',');
    if (comma < 0 || u.slice(0, 5) !== 'data:') return null;
    var meta = u.slice(5, comma);
    var mime = meta.split(';')[0] || 'application/octet-stream';
    var isB64 = /;base64/i.test(meta);
    var body = u.slice(comma + 1);
    try {
      if (isB64) {
        var bin = atob(body);
        var bytes = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
        return new Blob([bytes], { type: mime });
      }
      return new Blob([decodeURIComponent(body)], { type: mime });
    } catch (e) { return null; }
  }
  function openImage(dataUrl) {
    var blob = dataUrlToBlob(dataUrl);
    if (!blob) return;
    var url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }
  function bindImageOpen(el, dataUrl) {
    if (!dataUrl || dataUrl.slice(0, 5) !== 'data:') return;
    el.style.cursor = 'zoom-in';
    el.addEventListener('click', function () { openImage(dataUrl); });
  }
  var modelImgs = document.querySelectorAll('img.tool-block-img');
  for (var mi = 0; mi < modelImgs.length; mi++) bindImageOpen(modelImgs[mi], modelImgs[mi].src);
  var chips = document.querySelectorAll('.att-chip');
  for (var ci = 0; ci < chips.length; ci++) {
    var thumb = chips[ci].querySelector('img.att-thumb');
    if (thumb) bindImageOpen(chips[ci], thumb.src);
  }
})();
`;

// Assemblage PUR du squelette HTML (testable QuickJS) : le styleCss est
// composé par l'appelant (tokens runtime non purs), buildExportHtml se
// contente de l'insérer. scriptTag est composé par l'appelant (vide si
// settings.exportInteractive est false → export strictement statique, ou
// <script>EXPORT_SCRIPT</script> sinon — progressive enhancement, D1 révisé
// brief G). Zéro <link> (Prism inliné, pas de CDN).
function buildExportHtml({ title, dateDisplay, theme, styleCss, bodyHtml, scriptTag }) {
  const ogDesc = title + ' — exporté depuis MIAOU le ' + dateDisplay;
  return '<!doctype html>\n' +
    '<html data-theme="' + escHtml(theme) + '">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<title>' + escHtml(title) + '</title>\n' +
    // Métadonnées Open Graph / Twitter Card : pilotent la preview de lien dans
    // Teams/Slack/Discord (sinon ils pêchent au hasard un texte de la page —
    // typiquement le footer « Généré par MIAOU »). L'image (logo data-URI) est
    // généralement ignorée par ces crawlers qui exigent une URL fetchable, mais
    // coût nul. Titre + description restent, eux, honorés même sur pièce jointe.
    '<meta name="description" content="' + escHtml(ogDesc) + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:site_name" content="MIAOU">\n' +
    '<meta property="og:title" content="' + escHtml(title) + '">\n' +
    '<meta property="og:description" content="' + escHtml(ogDesc) + '">\n' +
    '<meta property="og:image" content="' + escHtml(LOGO_SRC) + '">\n' +
    '<meta name="twitter:card" content="summary">\n' +
    '<meta name="twitter:title" content="' + escHtml(title) + '">\n' +
    '<meta name="twitter:description" content="' + escHtml(ogDesc) + '">\n' +
    '<meta name="twitter:image" content="' + escHtml(LOGO_SRC) + '">\n' +
    '<style>' + styleCss + '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<div class="export-topbar-wrap">' +
    '<div class="export-topbar">' +
    '<img class="export-logo" src="' + LOGO_SRC + '" alt="">' +
    '<div>' +
    '<p class="export-title">' + escHtml(title) + '</p>' +
    '<p class="export-meta">Exporté le ' + escHtml(dateDisplay) + '</p>' +
    '</div>' +
    '</div>\n' +
    '</div>\n' +
    '<div class="export-body">' + bodyHtml + '</div>\n' +
    '<div class="export-footer-wrap"><div class="export-footer">Généré par MIAOU</div></div>\n' +
    (scriptTag || '') +
    '</body>\n' +
    '</html>\n';
}

// Construit le corps HTML de l'export dans un fragment DÉTACHÉ (jamais de
// lecture/mutation de #thread live). Même motif de buffer d'acks que
// downloadConvMd/renderThread : seuls les acks enrichis précédant un message
// assistant sont émis (ceux devant un user sont silencieusement omis, comme
// dans downloadConvMd — pas un blocage, un choix déjà assumé côté export MD).
// Async depuis le lot E4 : la passe Mermaid (embedExportMermaid) attend le
// chargement CDN et les rendus — le reste de la construction est synchrone.
async function renderExportBody(thread, convId) {
  const container = document.createElement('div');
  let pendingAcks = [];
  for (const m of thread) {
    if (isAckRole(m.role)) {
      // Empiler TOUS les acks (comme renderThread live) : le filtre `args != null`
      // ne s'applique qu'à la TRACE textuelle (formatToolAcksHtml, ci-dessous), PAS
      // au rendu d'IMAGE. Un ack image secondaire — ex. `resource_stored` créé par
      // internResourcesFromResult en sous-produit d'un fetch_url — n'est jamais
      // enrichi (onEnrichLastAck vise le fetch_url, pas lui) donc n'a pas d'`args` ;
      // le filtrer ici masquait son image dans l'export alors qu'elle est en cache
      // et s'affiche en live (bug Gbis : image trouvée par le modèle absente de
      // l'export). Idem pour les acks legacy antérieurs à l'enrichissement cross-turn.
      pendingAcks.push(m);
      continue;
    }
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const msgEl = document.createElement('div');
    msgEl.className = 'msg ' + m.role;
    if (m.role === 'user') {
      const shown = m.displayText != null ? m.displayText : m.content;
      const attHtml = (m.attachments && m.attachments.length)
        ? '<div class="msg-attachments">' + m.attachments.map(att =>
            attChipHtml(att, resolveAttachmentThumb(att, convId), false, null)).join('') + '</div>'
        : '';
      const tsHtml = m.ts ? '<div class="msg-ts">' + escHtml(formatMessageTime(m.ts, Date.now())) + '</div>' : '';
      msgEl.innerHTML = '<div class="bubble">' + attHtml + '<div class="body">' + renderUserMd(shown || '') + '</div></div>' + tsHtml;
      pendingAcks = [];
    } else {
      // Trace textuelle : seuls les acks enrichis (`args != null`) — les acks
      // legacy/secondaires sans args restent omis de la trace (statu quo), mais
      // leur IMAGE est rendue par la boucle ci-dessous (pendingAcks entier).
      const traceAcks = pendingAcks.filter(a => a.args != null);
      const acksHtml = traceAcks.length ? formatToolAcksHtml(traceAcks) : '';
      // Images modèle (lot Gbis) : parité reload. On ré-émet, APRÈS le bloc
      // d'acks et AVANT le corps (miroir du DOM live, placeToolAck), les images
      // persistées en IDB portées par les acks du groupe. Sélection PURE
      // (exportableAckImageKey), lookup cache ICI seulement — record absent
      // (fenêtre de course théorique, cf. AUDIT-Gbis §3) → rien, pas d'await IDB.
      const ackImgHtml = pendingAcks.map(ack => {
        const key = exportableAckImageKey(ack);
        if (!key) return '';
        const record = key.by === 'attId'
          ? (typeof getCachedRecordByAttId === 'function' ? getCachedRecordByAttId(ack.attId, ack.convId) : null)
          : (typeof getCachedRecord === 'function' ? getCachedRecord(ack.id) : null);
        if (!record || !record.data || !record.mime || !record.mime.startsWith('image/')) return '';
        // resource_stored inline : stocké mais non affiché auto (comme en live).
        if (ackKindOf(ack) === 'resource_stored' && record.class === 'inline') return '';
        const dataUrl = 'data:' + record.mime + ';base64,' + arrayBufferToBase64(record.data);
        return '<div class="tool-block"><img class="tool-block-img" src="' +
          escHtml(dataUrl) + '" alt="' + escHtml(record.name || '') + '"></div>';
      }).join('');
      pendingAcks = [];
      const tsText = m.ts ? formatMessageTime(m.ts, Date.now()) : '';
      const metaHtml = '<div class="meta"><span>' + escHtml(m.model || modelName()) + '</span>' +
        (tsText ? '<span>· ' + escHtml(tsText) + '</span>' : '') + '</div>';
      const reasoningHtml = (m.reasoning && String(m.reasoning).trim())
        ? '<details class="reasoning"><summary><span class="reasoning-label">Raisonnement</span><div class="reasoning-content">' + escHtml(String(m.reasoning)) + '</div></summary></details>'
        : '';
      msgEl.innerHTML = metaHtml + reasoningHtml + acksHtml + ackImgHtml + '<div class="body">' + renderMd(m.content || '', { asPlainText: true }) + '</div>';
    }
    container.appendChild(msgEl);
  }
  if (highlightEnabled && window.Prism) Prism.highlightAllUnder(container);
  decorateExportPre(container);
  await embedExportMermaid(container);
  return container.innerHTML;
}

// Passe Mermaid de l'export (lot E4) : chaque bloc ```mermaid du fragment
// devient un SVG embarqué STATIQUEMENT (visible sans JS dans le fichier
// exporté), la source surlignée restant disponible repliée dans un
// <details class="mermaid-src"> — le <pre> y déménage intact (code-head
// compris : EXPORT_SCRIPT y greffera copier/télécharger si l'export est
// interactif). Le SVG conserve son id : le <style> interne de Mermaid scope
// chaque règle par #<id> (même raison que la lightbox, lot E3) ; ids uniques
// par rendu, pas de collision entre diagrammes du même export.
// view.innerHTML = markup produit par Mermaid strict, pas de re-sanitisation
// — même posture que renderMermaidUnder (cf. en-tête de la section Mermaid).
// Double fallback, zéro régression vs lot G : Mermaid non chargeable
// (offline) → passe entière ignorée, toutes les sources surlignées restent ;
// erreur de parse d'un bloc → CE bloc reste source surlignée, les autres
// sont rendus. Pas de barre d'actions ni de toggle dans l'export (boutons
// perdus à la sérialisation innerHTML, et aucun global MIAOU côté fichier).
async function embedExportMermaid(container) {
  const codes = container.querySelectorAll('code.language-mermaid');
  if (!codes.length) return;
  let mm;
  try { mm = await ensureMermaid(); }
  catch (e) { return; }
  for (const code of codes) {
    const pre = code.closest('pre');
    if (!pre) continue;
    const uid = 'xmmd' + (++_mermaidUid) + Math.random().toString(36).slice(2, 8);
    let svg;
    try {
      svg = (await mm.render(uid, sanitizeMermaidSource(code.textContent))).svg;   // même strip que l'écran (renderMermaidUnder)
    } catch (e) {
      // Même hygiène que renderMermaidUnder : Mermaid v11 peut laisser un
      // nœud d'erreur orphelin dans document.body.
      ['d' + uid, uid].forEach(id => {
        const orphan = document.getElementById(id);
        if (orphan) orphan.remove();
      });
      continue;
    }
    const view = document.createElement('div');
    view.className = 'mermaid-view';
    view.innerHTML = svg;
    const details = document.createElement('details');
    details.className = 'mermaid-src';
    const summary = document.createElement('summary');
    summary.textContent = 'Source mermaid';
    details.appendChild(summary);
    pre.before(view);
    view.after(details);
    details.appendChild(pre);
  }
}

// Insère l'en-tête STATIQUE (langage seul) sur chaque <pre> de l'export. Ne pas
// confondre avec decoratePre (live) : ici pas de boutons ni de onclick — ils
// seraient perdus par la sérialisation innerHTML, et l'export n'a pas les
// globals (navigator.clipboard wrapper, downloadFile). Les boutons copier/
// télécharger sont ajoutés au runtime dans le fichier exporté par EXPORT_SCRIPT
// (progressive enhancement : présents seulement si JS actif). Le libellé de
// langage, lui, est du HTML pur → visible même sans JS.
function decorateExportPre(scope) {
  scope.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-head')) return;
    const code = pre.querySelector('code');
    let lang = 'text';
    if (code) {
      const m = (code.className || '').match(/language-([\w-]+)/);
      if (m) lang = m[1];
    }
    const head = document.createElement('div');
    head.className = 'code-head';
    head.innerHTML = '<span class="code-lang">' + escHtml(lang) + '</span>';
    pre.insertBefore(head, pre.firstChild);
  });
}

const EXPORT_HTML_SIZE_WARN = 8 * 1024 * 1024;

// Point d'entrée bouton topbar (global, cf. CLAUDE.md liste des handlers
// inline). Assemble titre/slug/CSS/corps, avertit via confirm() natif au-delà
// du seuil de taille (pas de dialogue dédié en v1, YAGNI), télécharge.
// Async depuis le lot E4 (passe Mermaid) : verrou de réentrance _exportingHtml
// (l'await CDN ouvre une fenêtre de double-clic → double téléchargement), et
// indicateur d'activité via runBackgroundTask (qui avale un échec en null —
// renderExportBody ne rejette jamais en pratique, tous ses await sont gardés).
let _exportingHtml = false;
async function exportConvHtml() {
  if (!currentThread || !currentThread.length) return;
  if (_exportingHtml) return;
  _exportingHtml = true;
  try {
    const conv = currentConvId ? loadConversation(currentConvId) : null;
    const title = (conv && conv.title) || 'miaou-conversation';
    const slug = slugTitle(title);
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const now = Date.now();
    const dateStamp = exportDateStamp(now);
    const dateDisplay = exportDateDisplay(now);
    const styleCss = serializeThemeTokens() + EXPORT_CSS + PRISM_THEME_CSS;
    const bodyHtml = await runBackgroundTask('export HTML…',
      () => renderExportBody(currentThread, currentConvId));
    if (bodyHtml == null) return;
    // Script optionnel (progressive enhancement, D1 révisé). Échappement défensif
    // de </ pour ne pas clore prématurément le <script> porteur (même parade que
    // build.py sur __MIAOU_CONFIG__), même si EXPORT_SCRIPT n'en contient pas.
    const s = loadSettings();
    const scriptTag = (s.exportInteractive !== false)
      ? '<script>' + EXPORT_SCRIPT.replace(/<\//g, '<\\/') + '</' + 'script>\n'
      : '';
    const html = buildExportHtml({ title, dateDisplay, theme, styleCss, bodyHtml, scriptTag });
    const sizeBytes = new Blob([html]).size;
    if (sizeBytes > EXPORT_HTML_SIZE_WARN) {
      const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
      if (!confirm('Fichier volumineux (~' + mb + ' Mo), continuer ?')) return;
    }
    downloadFile('miaou-' + slug + '-' + dateStamp + '.html', html, 'text/html');
  } finally {
    _exportingHtml = false;
  }
}
