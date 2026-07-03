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

function showWelcome() {
  const w = WELCOME_SCREENS[Math.floor(Math.random() * WELCOME_SCREENS.length)];
  const el = document.createElement('div');
  el.className = 'welcome-screen';
  el.innerHTML =
    '<div class="welcome-emoji">' + w.emoji + '</div>' +
    '<div class="welcome-title">' + escHtml(w.title) + '</div>' +
    '<div class="welcome-sub">'   + escHtml(w.sub)   + '</div>';
  $('thread').appendChild(el);
}

// Path des composants Prism pour l'autoloader (langages chargés à la volée).
if (window.Prism && Prism.plugins && Prism.plugins.autoloader) {
  Prism.plugins.autoloader.languages_path =
    'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/';
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
function resolveConvRefs(text) {
  return String(text).replace(CONV_REF_RE, function(match, id, title) {
    const entry = getSummaryEntry(id);
    const label = title || (entry && entry.title) || id;
    const safeLabel = label.replace(/\]/g, ')');
    if (!loadConversation(id)) {
      return '~~' + safeLabel + ' (supprimée)~~';
    }
    return '[' + safeLabel + '](#miaou-conv:' + encodeURIComponent(id) + ')';
  });
}

function renderMd(text) {
  const resolved = resolveConvRefs(text);
  if (!window.marked) return escHtml(resolved).replace(/\n/g, '<br>');
  return marked.parse(resolved, { breaks: true });
}
// Variante pour les messages utilisateur : empêche les balises HTML de traverser
// vers le DOM (angle-brackets échappés) tout en conservant le markdown.
// Le `>` est laissé intact pour que les blockquotes fonctionnent.
function renderUserMd(text) {
  if (!window.marked) return escHtml(text).replace(/\n/g, '<br>');
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return marked.parse(safe, { breaks: true });
}
function highlightUnder(el) { if (highlightEnabled && window.Prism) Prism.highlightAllUnder(el); }
function scrollBottom() { const m = $('messages'); if (m) m.scrollTop = m.scrollHeight; }

function modelName() {
  const s = loadSettings();
  return s.model || 'modèle';
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
  const srcHtml = (showSrv ? `<span>${escHtml(server)}</span><span class="tool-name-sep">›</span>` : '') +
    `<span>${escHtml(model || modelName())}</span>`;
  return (
    `<div class="meta"><img class="glyph" src="${LOGO_SRC}" alt="">${srcHtml}` +
    `<span class="msg-ts-sep tool-name-sep"${tsText ? '' : ' hidden'}>·</span>` +
    `<span class="msg-ts"${tsText ? '' : ' hidden'}>${escHtml(tsText)}</span>` +
    `<div class="meta-actions">` +
      `<button class="reasoning-toggle"${has ? '' : ' hidden'} onclick="toggleReasoning(this)" title="Raisonnement" aria-label="Raisonnement">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M11 2.5l1.5 3.8 3.8 1.5-3.8 1.5L11 13.1 9.5 9.3 5.7 7.8l3.8-1.5z"/><path d="M17.5 13l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/></svg>` +
      `</button>` +
      `<button class="msg-dl" hidden title="Télécharger en .md" onclick="downloadMsgMd(this)">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>` +
      `</button>` +
    `</div>` +
    `</div>` +
    `<div class="reasoning" hidden><div class="reasoning-content">${has ? escHtml(String(reasoning)) : ''}</div></div>`
  );
}

function buildMsg(role, content, model, reasoning, ts, server) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  if (role === 'user') {
    if (ts) wrap.dataset.ts = ts;
    wrap.innerHTML =
      `<div class="bubble">` +
      `<button class="msg-edit" title="Éditer" onclick="onEditMsg(this)">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
      `</button>` +
      `<div class="body">${renderUserMd(content)}</div>` +
      `</div>` +
      (ts ? `<div class="msg-ts">${escHtml(formatMessageTime(ts, Date.now()))}</div>` : '');
  } else {
    wrap.innerHTML =
      assistantHead(model, reasoning, ts, server) +
      `<div class="body">${renderMd(content)}</div>`;
    const bodyEl = wrap.querySelector('.body');
    if (bodyEl) bodyEl.dataset.raw = content;
    // Message déjà finalisé (reload) : le bouton download est opérationnel immédiatement.
    const dlBtn = wrap.querySelector('.msg-dl');
    if (dlBtn) dlBtn.removeAttribute('hidden');
  }
  decoratePre(wrap);
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
  content.textContent = text;
  if (!panel.hasAttribute('hidden')) content.scrollTop = content.scrollHeight;  // suivre si déplié
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
      `<button class="code-copy" title="Copier">${svgCopy}</button>` +
      `<button class="code-dl" title="Télécharger">${svgDl}</button>` +
      `</div>`;
    head.querySelector('.code-copy').onclick = () => {
      navigator.clipboard.writeText(code ? code.textContent : '').then(() => {
        const btn = head.querySelector('.code-copy');
        btn.innerHTML = svgCheck;
        btn.classList.add('code-copy--checked');
        setTimeout(() => { btn.innerHTML = svgCopy; btn.classList.remove('code-copy--checked'); }, 1400);
      });
    };
    head.querySelector('.code-dl').onclick = () => {
      downloadFile('miaou-snippet.' + langExt(lang), code ? code.textContent : '', 'text/plain');
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
  // Lecture d'un skill par le modèle (miaou__skills__read) : informatif, pas d'undo
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
function placeToolAck(wrap, entry) {
  if (ackKindOf(entry) === 'mcp_call' && entry.server) {
    const srv = getMcpServer(entry.server);
    if (srv && srv.showCalls === false) return null;
  }
  const node = buildToolAck(entry);
  const body = wrap && wrap.querySelector('.body');
  if (body) wrap.insertBefore(node, body);
  else if (wrap) wrap.appendChild(node);
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
  return node;
}

function renderThread(msgs) {
  const thread = $('thread');
  thread.innerHTML = '';
  clearMemoryProposals();   // les cartes de proposition viennent d'être détruites
  if (!msgs || msgs.length === 0) { showWelcome(); return; }
  // Les acks précèdent dans currentThread l'assistant qu'ils ont nourri ; on les
  // tamponne pour les replacer DANS sa bulle (en-tête, acks, réponse), cohérent
  // avec le rendu live. Repli en blocs autonomes s'ils ne précèdent pas un
  // assistant (cas limite : acks orphelins ou suivis d'un message user).
  let pendingAcks = [];
  for (const m of msgs) {
    if (isAckRole(m.role)) { pendingAcks.push(m); continue; }
    // Bulle user : afficher le littéral tapé (displayText) si présent — slash-
    // commande skill, où content embarque le corps du skill injecté (invisible à l'UI).
    const shown = (m.role === 'user' && m.displayText != null) ? m.displayText : m.content;
    const wrap = buildMsg(m.role, shown, m.model, m.reasoning, m.ts, m.server);
    if (m.role === 'assistant') {
      for (const a of pendingAcks) placeToolAck(wrap, a);
    } else {
      for (const a of pendingAcks) thread.appendChild(buildToolAck(a));
    }
    pendingAcks = [];
    thread.appendChild(wrap);
  }
  for (const a of pendingAcks) thread.appendChild(buildToolAck(a));
  if (highlightEnabled && window.Prism) Prism.highlightAll();
  scrollBottom();
  syncConvDownloadBtn();
}

function syncConvDownloadBtn() {
  const btn = document.querySelector('.conv-dl-btn');
  if (btn) btn.hidden = !currentThread.some(m => m.role === 'assistant');
  const retitleBtn = document.querySelector('.conv-retitle-btn');
  if (retitleBtn) retitleBtn.hidden = !currentThread.some(m => m.role === 'assistant');
}

// ── Streaming d'une réponse assistant ───────────────────────────────────────
function appendUserMessage(text, ts) {
  const welcome = $('thread').querySelector('.welcome-screen');
  if (welcome) welcome.remove();
  const el = buildMsg('user', text, undefined, undefined, ts);
  $('thread').appendChild(el);
  highlightUnder(el);
  scrollBottom();
  return el;
}

function startAssistantMessage(model, server) {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.innerHTML = assistantHead(model, '', undefined, server) + `<div class="body"></div>`;
  $('thread').appendChild(wrap);
  startWaiter(wrap.querySelector('.body'));     // état WAITING
  scrollBottom();
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
    const body = p.wrap.querySelector('.body');
    body.innerHTML = renderMd(p.full) + '<span class="cursor-blink"></span>';
    decoratePre(p.wrap);
    highlightUnder(p.wrap);   // coloration pendant le streaming
    scrollBottom();
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

function finalizeAssistant(wrap, full) {
  cancelStreamRender();
  cancelReasoningRender();
  stopWaiter();
  const body = wrap.querySelector('.body');
  body.innerHTML = renderMd(full);
  body.dataset.raw = full;
  decoratePre(wrap);
  highlightUnder(wrap);
  const dlBtn = wrap.querySelector('.msg-dl');
  if (dlBtn) dlBtn.removeAttribute('hidden');
  syncConvDownloadBtn();
  scrollBottom();
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
      if (e.key === 'Escape')    { e.preventDefault(); hideSkillAutocomplete(ac); return; }
      if (e.key === 'Tab')       { e.preventDefault(); acceptSkillAcSelection(ac); return; }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acceptSkillAcSelection(ac); return; }
    }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(wrap, original); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(wrap, ta.value); }
  });
  bubble.querySelector('[data-act="cancel"]').onclick = () => cancelEdit(wrap, original);
  bubble.querySelector('[data-act="save"]').onclick = () => commitEdit(wrap, ta.value);
}

// Annulation : restaure le contenu de la bulle. Le .msg-ts est un sibling du
// .bubble (hors de sa portée), il n'est pas touché.
function cancelEdit(wrap, original) {
  wrap.classList.remove('editing');
  const bubble = wrap.querySelector('.bubble');
  bubble.innerHTML =
    `<button class="msg-edit" title="Éditer" onclick="onEditMsg(this)">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
    `</button>` +
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
function sectionFor(ts) {
  if (!ts) return 'Plus ancien';
  const now = new Date();
  const d = new Date(ts);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86400000;
  if (d.getTime() >= startOfToday) return "Aujourd'hui";
  if (d.getTime() >= startOfToday - day) return 'Hier';
  if (d.getTime() >= startOfToday - 7 * day) return '7 derniers jours';
  if (d.getTime() >= startOfToday - 30 * day) return '30 derniers jours';
  return 'Plus ancien';
}

function relativeWhen(ts) {
  if (!ts) return '';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Le jour même : afficher l'heure (HH:MM) plutôt que « aujourd'hui »,
  // redondant avec l'en-tête de section « Aujourd'hui ». Calé sur le même
  // découpage calendaire que sectionFor (pas une fenêtre glissante de 24 h).
  if (ts >= startOfToday) return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const day = 86400000;
  if (ts >= startOfToday - day) return 'hier à ' + new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const days = Math.floor((startOfToday - ts) / day) + 1;
  if (days < 7) return 'il y a ' + days + ' j';
  if (days < 30) return 'il y a ' + Math.floor(days / 7) + ' sem';
  return new Date(ts).toLocaleDateString('fr-FR', { month: 'long' });
}

// Filtre de recherche courant (prédicat sur une conversation), ou null pour
// « tout afficher ». Persistant : conservé à travers les re-rendus (maj en
// arrière-plan, sélection, etc.) tant que le champ de recherche n'est pas vidé.
let convSearchFilter = null;

// Prédicat de recherche : match direct (sous-chaîne) sur le titre, ou
// recouvrement de mots-clés sur le résumé via le scoring existant (seuil bas,
// plus permissif que l'injection automatique). null si requête vide.
function searchConversations(query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  const qTokens = tokenize(q);
  // Un seul parse des résumés, capturé par la closure : le prédicat est appelé
  // une fois par conversation, sans re-désérialiser tout le blob à chaque appel.
  // Instantané pris à la frappe (rafraîchi à la frappe suivante) — cf. perf.
  const summaries = loadSummaries();
  return c => {
    if ((c.title || '').toLowerCase().includes(q)) return true;
    const entry = summaries[c.id];
    return !!(entry && !entry.suppressed && entry.summary && scoreSummary(qTokens, entry) >= 1);
  };
}

function onConvSearch() {
  const input = $('conv-search');
  $('search-clear').classList.toggle('show', !!input.value);
  convSearchFilter = searchConversations(input.value);
  renderConvList();
}

function clearConvSearch() {
  const input = $('conv-search');
  input.value = '';
  $('search-clear').classList.remove('show');
  convSearchFilter = null;
  renderConvList();
  // La sélection courante (potentiellement très ancienne) peut être hors écran
  // une fois la liste complète restaurée : on la ramène dans le champ visible.
  const active = $('conv-list').querySelector('.conv.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
  input.focus();
}

// Icônes d'épingle (pleine = épinglé, contour = à épingler).
const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 10.76V4h6v6.76a2 2 0 0 0 .59 1.42L18 14.5H6l2.41-2.32A2 2 0 0 0 9 10.76z"/></svg>';

function convItemEl(c) {
  const el = document.createElement('div');
  el.className = 'conv' + (c.id === currentConvId ? ' active' : '') + (c.pinned ? ' pinned' : '');
  el.onclick = () => selectConv(c.id);
  el.innerHTML =
    `<div class="conv-body">
       <div class="conv-title">${escHtml(c.title || 'Nouvelle conversation')}</div>
       <div class="conv-date" title="${escHtml(formatFullDateFr(c.updatedAt || c.timestamp))}">${escHtml(relativeWhen(c.updatedAt || c.timestamp))}</div>
     </div>
     <div class="conv-actions">
       <button class="conv-pin" title="${c.pinned ? 'Désépingler' : 'Épingler'}" onclick="event.stopPropagation();togglePin('${c.id}')">${PIN_SVG}</button>
       <button class="conv-del" title="Supprimer" onclick="event.stopPropagation();deleteConv('${c.id}')">
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
  const all = listAllConversations();
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

function isMobileLayout() { return window.innerWidth < 768; }

function closeSidebarMobile() {
  $('app').classList.remove('sidebar-open');
  $('sidebar-backdrop').classList.remove('show');
  document.body.style.overflow = '';
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
  const retitleBtn = document.querySelector('.conv-retitle-btn');
  if (retitleBtn) retitleBtn.disabled = on;
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
    if (e.key === 'Escape')    { e.preventDefault(); hideSkillAutocomplete(_composerAc); return; }
    if (e.key === 'Tab')       { e.preventDefault(); acceptSkillAcSelection(_composerAc); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); acceptSkillAcSelection(_composerAc); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending) sendMessage(); }
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
    document.querySelectorAll('#api-list .model-menu.show').forEach(m => m.classList.remove('show'));
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
});

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
  const rejected = isReasoningEffortRejected(settings.url, activeModel());
  if (rejected && currentConvReasoningEffort) { setConvReasoningEffort(''); return; }   // ré-entre via syncReasoningUI
  const cur = activeReasoningEffort();
  const opt = REASONING_EFFORT_OPTIONS.find(o => o.value === cur);
  const label = $('composer-reasoning-label');
  if (label) label.textContent = opt ? opt.label : cur;
  const btn = $('composer-reasoning-btn');
  if (btn) btn.classList.toggle('effort-default', !cur);
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
  $('set-reasoning-btn').classList.toggle('effort-default', !v);
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
    || $('set-confirm-skill-autouse').checked !== !!s.confirmSkillAutoUse;
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
  $('set-tools-in-prompt').checked = !!s.includeToolsInSystemPrompt;
  $('set-intent-tracing').checked = !!s.intentTracing;
  $('set-save-json').checked = !!s.saveJsonResponses;
  $('set-confirm-skill-autouse').checked = !!s.confirmSkillAutoUse;
  const pre = $('root-prompt-pre');
  if (pre && !pre.textContent) pre.textContent = ROOT_SYSTEM_PROMPT;
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
  $('model-menu').classList.remove('show');
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
function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'light')  html.setAttribute('data-theme', 'light');
  else if (theme === 'dark') html.setAttribute('data-theme', 'dark');
  else html.removeAttribute('data-theme');   // 'system' : laisse le media query décider
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
  for (const id of ids) {
    const e = all[id];
    const item = document.createElement('div');
    item.dataset.id = id;
    const date = e.timestamp ? new Date(e.timestamp).toLocaleDateString('fr-FR') : '';
    if (e.suppressed) {
      item.className = 'mem-item suppressed';
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-title">${escHtml(e.title || 'Souvenir supprimé')}</div>` +
        `<div class="mem-sub">supprimé${date ? ' · ' + escHtml(date) : ''}</div></div>` +
        `<button class="drawer-btn" onclick="restoreSummaryItem('${id}')">Rétablir</button></div>`;
    } else {
      const full = e.summary || '';
      const extrait = full.slice(0, 150);
      const kws = Array.isArray(e.keywords) && e.keywords.length
        ? `<div class="mem-keywords"><strong>Mots-clefs</strong> — ${escHtml(e.keywords.join(', '))}</div>`
        : '';
      item.className = 'mem-item';
      item.onclick = () => toggleSummaryExpand(id);
      item.innerHTML =
        `<div class="mem-header">` +
        `<div class="mem-meta"><div class="mem-title">${escHtml(e.title || 'Nouvelle conversation')}</div>` +
        `<div class="mem-sub">${escHtml(date)}</div></div>` +
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
  if (s) {
    saveSummary(id, {
      title: conv.title, timestamp: conv.timestamp,
      summary: s.summary, keywords: s.keywords, messageCount: conv.messages.length,
    });
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
    .map(escHtml).join('<span class="tool-name-sep">›</span>');
  item.innerHTML =
    '<div class="tool-name">' + nameHtml + '</div>' +
    '<div class="tool-desc">' + escHtml(def.description || '') + '</div>' +
    paramsHtml;
  return item;
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

function showMcpCardError(cardEl, msg) {
  const el = cardEl.querySelector('.mcp-err');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}

function mcpField(labelText, inputEl, hintText) {
  const field = document.createElement('div');
  field.className = 'mcp-field';
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

function buildMcpCard(server, isNew) {
  const card = document.createElement('div');
  card.className = 'mcp-card' + (isNew ? ' is-editing' : '');
  const originalName = server.name || '';

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'mcp-view';

  const viewName = document.createElement('div');
  viewName.className = 'mcp-view-name';
  viewName.textContent = server.name || '';
  viewSection.appendChild(viewName);

  const viewUrl = document.createElement('div');
  viewUrl.className = 'mcp-view-url';
  viewUrl.textContent = server.url || '';
  viewSection.appendChild(viewUrl);

  const viewRow = document.createElement('div');
  viewRow.className = 'mcp-view-row';

  // Toggle en mode vue (class distincte — onSaveMcpCard lit .mcp-enabled dans la section édition)
  const viewToggleLabel = document.createElement('label');
  viewToggleLabel.className = 'mcp-view-toggle-label';
  const viewToggleWrap = document.createElement('label');
  viewToggleWrap.className = 'toggle';
  const viewEnabledI = document.createElement('input');
  viewEnabledI.type = 'checkbox'; viewEnabledI.className = 'mcp-enabled-view';
  viewEnabledI.checked = server.enabled !== false;
  const viewTrack = document.createElement('span'); viewTrack.className = 'track';
  const viewThumb = document.createElement('span'); viewThumb.className = 'thumb';
  viewToggleWrap.append(viewEnabledI, viewTrack, viewThumb);
  const viewEnabledTxt = document.createElement('span');
  viewEnabledTxt.textContent = 'Activé';
  viewToggleLabel.append(viewToggleWrap, viewEnabledTxt);
  viewRow.appendChild(viewToggleLabel);

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
  editSection.className = 'mcp-edit';

  const mkInput = (cls, type, value, placeholder) => {
    const i = document.createElement('input');
    i.className = cls; i.type = type; i.value = value != null ? value : '';
    if (placeholder) i.placeholder = placeholder;
    i.spellcheck = false;
    return i;
  };

  const nameI = mkInput('mcp-name', 'text', server.name, 'jira');
  const urlI  = mkInput('mcp-url', 'text', server.url, 'https://host/mcp');
  const transportSel = document.createElement('select');
  transportSel.className = 'mcp-transport';
  for (const opt of ['streamable-http', 'sse']) {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt + (opt === 'sse' ? ' (différé)' : '');
    transportSel.appendChild(o);
  }
  transportSel.value = server.transport || 'streamable-http';
  // Transport explicite (serveur existant) → marqué « touché » pour que la
  // devinette d'URL ne l'écrase jamais (D4). Vierge → devinette active.
  if (server.transport) transportSel.dataset.touched = '1';
  transportSel.addEventListener('change', () => { transportSel.dataset.touched = '1'; });
  urlI.addEventListener('input', () => {
    if (!transportSel.dataset.touched) transportSel.value = guessMcpTransport(urlI.value);
  });

  const tokenI = mkInput('mcp-token', 'password', server.authorization_token, 'Bearer (optionnel)');
  const tmoI = mkInput('mcp-timeout', 'number', server.timeout || 30000, '30000');
  const allowI = mkInput('mcp-allow', 'text', (server.toolAllowlist || []).join(', '), 'outil1, outil2 (vide = tous)');
  const denyI  = mkInput('mcp-deny', 'text', (server.toolDenylist || []).join(', '), 'outils à masquer');

  editSection.appendChild(mcpField('Nom (préfixe)', nameI, 'Unique, sans espace ni « __ ». « miaou » réservé.'));
  editSection.appendChild(mcpField('URL', urlI));
  editSection.appendChild(mcpField('Transport', transportSel));
  editSection.appendChild(mcpField('Jeton d\'autorisation', tokenI, 'Stocké en clair (localStorage) — usage non-prod encouragé.'));
  editSection.appendChild(mcpField('Timeout (ms)', tmoI));
  editSection.appendChild(mcpField('Outils autorisés', allowI));
  editSection.appendChild(mcpField('Outils masqués', denyI));

  // Toggle en mode édition — composant .toggle réutilisé verbatim
  const editEnabledWrap = document.createElement('label');
  editEnabledWrap.className = 'mcp-enabled-row';
  const editToggleWrap = document.createElement('label');
  editToggleWrap.className = 'toggle';
  const editEnabledI = document.createElement('input');
  editEnabledI.type = 'checkbox'; editEnabledI.className = 'mcp-enabled'; editEnabledI.checked = server.enabled !== false;
  const editTrack = document.createElement('span'); editTrack.className = 'track';
  const editThumb = document.createElement('span'); editThumb.className = 'thumb';
  editToggleWrap.append(editEnabledI, editTrack, editThumb);
  const editEnabledTxt = document.createElement('span');
  editEnabledTxt.textContent = 'Activé';
  editEnabledWrap.append(editToggleWrap, editEnabledTxt);
  editSection.appendChild(editEnabledWrap);

  // Toggle showCalls — affiche les lignes d'appel MCP dans le thread
  const showCallsWrap = document.createElement('label');
  showCallsWrap.className = 'mcp-enabled-row';
  const showCallsToggleWrap = document.createElement('label');
  showCallsToggleWrap.className = 'toggle';
  const showCallsI = document.createElement('input');
  showCallsI.type = 'checkbox'; showCallsI.className = 'mcp-show-calls'; showCallsI.checked = server.showCalls !== false;
  const showCallsTrack = document.createElement('span'); showCallsTrack.className = 'track';
  const showCallsThumb = document.createElement('span'); showCallsThumb.className = 'thumb';
  showCallsToggleWrap.append(showCallsI, showCallsTrack, showCallsThumb);
  const showCallsTxt = document.createElement('span');
  showCallsTxt.textContent = 'Afficher les appels dans le thread';
  showCallsWrap.append(showCallsToggleWrap, showCallsTxt);
  editSection.appendChild(showCallsWrap);

  const err = document.createElement('div');
  err.className = 'mcp-err'; err.setAttribute('hidden', '');
  editSection.appendChild(err);

  const actions = document.createElement('div');
  actions.className = 'mcp-actions';
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
    delBtn.addEventListener('click', () => onDeleteMcpCard(card, originalName));
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
function renderApiServersIfOpen() {
  if ($('api-drawer') && $('api-drawer').classList.contains('show')) renderApiServers();
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
        sep.className = 'tool-name-sep';
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

function showApiCardError(cardEl, msg) {
  const el = cardEl.querySelector('.api-err');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}

function apiField(labelText, inputEl, hintText) {
  const field = document.createElement('div');
  field.className = 'api-field';
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

function buildApiCard(server, isNew, isActive) {
  const card = document.createElement('div');
  card.className = 'api-card' + (isNew ? ' is-editing' : '');
  const originalId = server.id || '';

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'api-view';

  const viewName = document.createElement('div');
  viewName.className = 'api-view-name';
  viewName.textContent = server.name || '';
  viewSection.appendChild(viewName);

  const viewUrl = document.createElement('div');
  viewUrl.className = 'api-view-url';
  viewUrl.textContent = server.url || '';
  viewSection.appendChild(viewUrl);

  const viewRow = document.createElement('div');
  viewRow.className = 'api-view-row';

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
  editSection.className = 'api-edit';

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

  editSection.appendChild(apiField('Nom', nameI));
  editSection.appendChild(apiField('URL de l\'API', urlI, 'Endpoint compatible OpenAI, terminant par /v1.'));
  editSection.appendChild(apiField('Clef API', keyI, keyHintInfo.hint));

  const modelAnchor = document.createElement('div');
  modelAnchor.className = 'select-anchor api-model-anchor';
  const modelMenu = document.createElement('div');
  modelMenu.className = 'model-menu';
  modelI.addEventListener('focus', () => openApiModelMenu(modelI, modelMenu, urlI, keyI));
  modelI.addEventListener('input', () => onApiModelInput(modelI, modelMenu));
  modelAnchor.append(modelI, modelMenu);
  const modelField = document.createElement('div');
  modelField.className = 'api-field';
  const modelLabel = document.createElement('label');
  modelLabel.textContent = 'Modèle par défaut';
  modelField.append(modelLabel, modelAnchor);
  const modelHint = document.createElement('span');
  modelHint.className = 'hint';
  modelHint.textContent = 'Choisissez parmi les modèles exposés par l\'API.';
  modelField.appendChild(modelHint);
  editSection.appendChild(modelField);

  const err = document.createElement('div');
  err.className = 'api-err'; err.setAttribute('hidden', '');
  editSection.appendChild(err);

  const actions = document.createElement('div');
  actions.className = 'api-actions';
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
    delBtn.addEventListener('click', () => onDeleteApiCard(card, originalId));
    actions.appendChild(delBtn);
  }
  editSection.appendChild(actions);

  card.appendChild(editSection);
  return card;
}

// ── Skills : drawer de gestion ───────────────────────────────────────────────
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
// moins un skill activé (sinon le slash n'a aucun sens pour l'utilisateur).
function syncSkillHintUI() {
  const el = $('composer-hint-skill');
  if (el) el.hidden = !listEnabledSkills().length;
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
  for (const s of skills) wrap.appendChild(buildSkillCard(s, false));
}

function addSkillCard() {
  const wrap = $('skill-list');
  if (!wrap) return;
  const empty = wrap.querySelector('.mem-empty');
  if (empty) empty.remove();
  wrap.insertBefore(buildSkillCard({ slug: '', name: '', description: '', enabled: true }, true), wrap.firstChild);
}

function showSkillCardError(cardEl, msg) {
  const el = cardEl.querySelector('.skill-err');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}

function skillField(labelText, inputEl, hintText) {
  const field = document.createElement('div');
  field.className = 'skill-field';
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

function buildSkillCard(skill, isNew) {
  const card = document.createElement('div');
  card.className = 'skill-card' + (isNew ? ' is-editing' : '');
  const originalSlug = skill.slug || '';

  // ── SECTION VUE ───────────────────────────────────────────────────────────
  const viewSection = document.createElement('div');
  viewSection.className = 'skill-view';

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
  viewRow.className = 'skill-view-row';

  // Toggle enabled en vue (persistance immédiate via onToggleSkill, main.js)
  const viewToggleLabel = document.createElement('label');
  viewToggleLabel.className = 'toggle';
  const viewEnabledI = document.createElement('input');
  viewEnabledI.type = 'checkbox'; viewEnabledI.className = 'skill-enabled-view';
  viewEnabledI.checked = skill.enabled !== false;
  const viewTrack = document.createElement('span'); viewTrack.className = 'track';
  const viewThumb = document.createElement('span'); viewThumb.className = 'thumb';
  viewToggleLabel.append(viewEnabledI, viewTrack, viewThumb);
  viewRow.appendChild(viewToggleLabel);
  if (!isNew) {
    viewEnabledI.addEventListener('change', () => onToggleSkill(originalSlug));
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
  editSection.className = 'skill-edit';

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

  editSection.appendChild(skillField('Slug', slugI, 'Clé d\'invocation /slug. Sans espace ni « / ».'));
  editSection.appendChild(skillField('Nom', nameI, 'Libellé d\'affichage.'));
  editSection.appendChild(skillField('Description', descI, 'Surface lexicale décrite au modèle.'));
  editSection.appendChild(skillField('Contenu', contentT));

  // Toggle enabled en édition (.skill-enabled lu par onSaveSkillCard)
  const editEnabledWrap = document.createElement('label');
  editEnabledWrap.className = 'skill-enabled-row';
  const editToggleWrap = document.createElement('label');
  editToggleWrap.className = 'toggle';
  const editEnabledI = document.createElement('input');
  editEnabledI.type = 'checkbox'; editEnabledI.className = 'skill-enabled'; editEnabledI.checked = skill.enabled !== false;
  const editTrack = document.createElement('span'); editTrack.className = 'track';
  const editThumb = document.createElement('span'); editThumb.className = 'thumb';
  editToggleWrap.append(editEnabledI, editTrack, editThumb);
  const editEnabledTxt = document.createElement('span');
  editEnabledTxt.textContent = 'Activée';
  editEnabledWrap.append(editToggleWrap, editEnabledTxt);
  editSection.appendChild(editEnabledWrap);

  // Toggle autotrigger en édition (.skill-autotrigger lu par onSaveSkillCard) —
  // stage 2 : liste cette skill dans le contexte dynamique <miaou_skills_context>
  // à chaque tour, pour découverte proactive par le modèle.
  const editAutotriggerWrap = document.createElement('label');
  editAutotriggerWrap.className = 'skill-enabled-row';
  const editAutotriggerToggleWrap = document.createElement('label');
  editAutotriggerToggleWrap.className = 'toggle';
  const editAutotriggerI = document.createElement('input');
  editAutotriggerI.type = 'checkbox'; editAutotriggerI.className = 'skill-autotrigger'; editAutotriggerI.checked = skill.autotrigger === true;
  const editAutotriggerTrack = document.createElement('span'); editAutotriggerTrack.className = 'track';
  const editAutotriggerThumb = document.createElement('span'); editAutotriggerThumb.className = 'thumb';
  editAutotriggerToggleWrap.append(editAutotriggerI, editAutotriggerTrack, editAutotriggerThumb);
  const editAutotriggerTxt = document.createElement('span');
  editAutotriggerTxt.textContent = 'Proposée proactivement au modèle';
  editAutotriggerWrap.append(editAutotriggerToggleWrap, editAutotriggerTxt);
  editSection.appendChild(editAutotriggerWrap);

  const err = document.createElement('div');
  err.className = 'skill-err'; err.setAttribute('hidden', '');
  editSection.appendChild(err);

  const actions = document.createElement('div');
  actions.className = 'skill-actions';
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
    delBtn.addEventListener('click', () => {
      if (window.confirm('Supprimer la skill « ' + (skill.name || skill.slug) + ' » ? Action définitive.')) {
        onDeleteSkillCard(card, originalSlug);
      }
    });
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
  scrollBottom();
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

// ── Souvenirs utilisateur (onglet Souvenirs du drawer combiné) ───────────────

function renderMemoryList() {
  const wrap = $('memory-list');
  wrap.innerHTML = '';

  const addArea = document.createElement('div');
  addArea.className = 'mem-add';
  addArea.innerHTML =
    '<textarea class="mem-add-input" id="mem-add-input" rows="2" placeholder="Nouveau souvenir…"></textarea>' +
    '<button class="drawer-btn mem-add-btn" onclick="addMemoryEntry()">Ajouter</button>';
  wrap.appendChild(addArea);

  const all = loadMemories().sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  if (!all.length) {
    const empty = document.createElement('div');
    empty.className = 'mem-empty';
    empty.textContent = 'Aucun souvenir pour l\'instant.';
    wrap.appendChild(empty);
    return;
  }

  for (const e of all) {
    const item = document.createElement('div');
    item.className = 'mem-item' + (e.suppressed ? ' suppressed' : '');
    item.dataset.id = e.id;
    const date = new Date(e.updated_at || e.created_at || 0).toLocaleDateString('fr-FR');

    if (e.suppressed) {
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-sub">supprimé · ${escHtml(date)}</div></div>` +
        `<div class="drawer-btns">` +
        `<button class="drawer-btn" onclick="restoreMemoryEntry('${e.id}')">Rétablir</button>` +
        `<button class="drawer-btn danger" onclick="forgetMemoryEntry('${e.id}')">Oublier</button>` +
        `</div></div>` +
        `<div class="mem-excerpt">${escHtml((e.content || '').slice(0, 120))}${(e.content || '').length > 120 ? '…' : ''}</div>`;
    } else {
      item.innerHTML =
        `<div class="mem-header"><div class="mem-meta"><div class="mem-sub">${escHtml(date)}</div></div>` +
        `<div class="drawer-btns" id="drawer-btns-${e.id}">` +
        `<button class="drawer-btn" onclick="startEditMemoryEntry('${e.id}')">Modifier</button>` +
        `<button class="drawer-btn danger" onclick="deleteMemoryEntry('${e.id}')">Supprimer</button>` +
        `</div></div>` +
        `<div class="mem-content" id="mem-content-${e.id}">${escHtml(e.content || '')}</div>` +
        `<div class="mem-edit-wrap hidden" id="mem-edit-${e.id}">` +
        `<textarea class="mem-edit-input" id="mem-edit-input-${e.id}">${escHtml(e.content || '')}</textarea>` +
        `<div class="mem-edit-actions">` +
        `<button class="drawer-btn primary" onclick="saveMemoryEntryEdit('${e.id}')">Enregistrer</button>` +
        `<button class="drawer-btn" onclick="cancelMemoryEntryEdit('${e.id}')">Annuler</button>` +
        `</div></div>`;
    }
    wrap.appendChild(item);
  }
}

function addMemoryEntry() {
  const input = $('mem-add-input');
  const content = input ? input.value.trim() : '';
  if (!content) return;
  const now = Date.now();
  saveMemory({ id: genMemoryId(), content, created_at: now, updated_at: now, suppressed: false });
  renderMemoryList();
}

function deleteMemoryEntry(id) { suppressMemory(id); renderMemoryList(); }
function restoreMemoryEntry(id) { restoreMemory(id); renderMemoryList(); }
function forgetMemoryEntry(id) { forgetMemory(id); renderMemoryList(); }

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

function saveMemoryEntryEdit(id) {
  const area = $('mem-edit-input-' + id);
  if (!area) return;
  const content = area.value.trim();
  if (!content) return;
  editMemory(id, content);
  renderMemoryList();
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
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
