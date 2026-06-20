/* ── ui.js ─────────────────────────────────────────────────────────────────
   Couche DOM : rendu des messages, sidebar, drawers, dropdown modèle, bannière
   mémoire, indicateur d'activité, gestion des souvenirs. Aucune logique
   d'orchestration (qui vit dans main.js) ni réseau (api.js).
   ────────────────────────────────────────────────────────────────────────── */

let highlightEnabled = true;
let configured = false;
let sending = false;

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
function renderMd(text) {
  if (!window.marked) return escHtml(text).replace(/\n/g, '<br>');
  return marked.parse(text, { breaks: true });
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
function assistantHead(model, reasoning) {
  const has = reasoning && String(reasoning).trim();
  return (
    `<div class="meta"><img class="glyph" src="${LOGO_SRC}" alt=""><span>${escHtml(model || modelName())}</span>` +
      `<button class="reasoning-toggle"${has ? '' : ' hidden'} onclick="toggleReasoning(this)" title="Raisonnement" aria-label="Raisonnement">` +
        `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M11 2.5l1.5 3.8 3.8 1.5-3.8 1.5L11 13.1 9.5 9.3 5.7 7.8l3.8-1.5z"/><path d="M17.5 13l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z"/></svg>` +
      `</button>` +
    `</div>` +
    `<div class="reasoning" hidden><div class="reasoning-content">${has ? escHtml(String(reasoning)) : ''}</div></div>`
  );
}

function buildMsg(role, content, model, reasoning) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  if (role === 'user') {
    wrap.innerHTML =
      `<div class="bubble">` +
      `<button class="msg-edit" title="Éditer" onclick="onEditMsg(this)">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
      `</button>` +
      `<div class="body">${renderMd(content)}</div></div>`;
  } else {
    wrap.innerHTML =
      assistantHead(model, reasoning) +
      `<div class="body">${renderMd(content)}</div>`;
  }
  decoratePre(wrap);
  return wrap;
}

// ── Bloc de raisonnement (thinking) ─────────────────────────────────────────
// Alimenté en live par les deltas accumulés. Texte brut en police mono (pas de
// markdown). Révèle l'icône à la première substance reçue ; un raisonnement
// vide ('') ne révèle rien (cf. distinction absence / chaîne vide du brief).
function setReasoning(wrap, text) {
  if (!text) return;
  const toggle = wrap.querySelector('.reasoning-toggle');
  const panel = wrap.querySelector('.reasoning');
  const content = wrap.querySelector('.reasoning-content');
  if (!toggle || !panel || !content) return;
  toggle.removeAttribute('hidden');          // capacité détectée → icône visible
  content.textContent = text;
  if (!panel.hasAttribute('hidden')) content.scrollTop = content.scrollHeight;  // suivre si déplié
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
  scrollBottom();
}

// En-tête (langage + bouton copier) sur chaque <pre>.
function decoratePre(scope) {
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
    head.innerHTML = `<span class="code-lang">${escHtml(lang)}</span><button class="code-copy">copier</button>`;
    head.querySelector('.code-copy').onclick = () => {
      navigator.clipboard.writeText(code ? code.textContent : '').then(() => {
        const btn = head.querySelector('.code-copy');
        btn.textContent = 'copié'; setTimeout(() => btn.textContent = 'copier', 1400);
      });
    };
    pre.insertBefore(head, pre.firstChild);
  });
}

function renderThread(msgs) {
  const thread = $('thread');
  thread.innerHTML = '';
  for (const m of (msgs || [])) thread.appendChild(buildMsg(m.role, m.content, m.model, m.reasoning));
  if (highlightEnabled && window.Prism) Prism.highlightAll();
  scrollBottom();
}

// ── Streaming d'une réponse assistant ───────────────────────────────────────
function appendUserMessage(text) {
  const welcome = $('thread').querySelector('.welcome-screen');
  if (welcome) welcome.remove();
  const el = buildMsg('user', text);
  $('thread').appendChild(el);
  highlightUnder(el);
  scrollBottom();
  return el;
}

function startAssistantMessage(model) {
  const wrap = document.createElement('div');
  wrap.className = 'msg assistant';
  wrap.innerHTML = assistantHead(model, '') + `<div class="body"></div>`;
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
  startWaiter(wrap.querySelector('.body'));     // reprise d'attente après un tour tool_calls
}

function finalizeAssistant(wrap, full) {
  cancelStreamRender();
  stopWaiter();
  const body = wrap.querySelector('.body');
  body.innerHTML = renderMd(full);
  decoratePre(wrap);
  highlightUnder(wrap);
  scrollBottom();
}

// ── Édition d'un message utilisateur ────────────────────────────────────────
// Index recalculé au moment du clic (jamais figé au rendu) : position du .msg
// parmi tous les .msg du thread, qui correspond 1:1 à currentThread.
function msgIndex(wrap) {
  return Array.prototype.indexOf.call($('thread').querySelectorAll('.msg'), wrap);
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
  const original = currentThread[index] ? currentThread[index].content : '';

  wrap.classList.add('editing');
  const bubble = wrap.querySelector('.bubble');
  bubble.innerHTML =
    `<textarea class="msg-edit-area" spellcheck="false"></textarea>` +
    `<div class="msg-edit-actions">` +
    `<button class="mb-btn" data-act="cancel">Annuler</button>` +
    `<button class="mb-btn primary" data-act="save">Valider</button>` +
    `</div>`;

  const ta = bubble.querySelector('.msg-edit-area');
  ta.value = original;
  autoGrow(ta);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  ta.addEventListener('input', () => autoGrow(ta));
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(wrap, original); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(wrap, ta.value); }
  });
  bubble.querySelector('[data-act="cancel"]').onclick = () => cancelEdit(wrap, original);
  bubble.querySelector('[data-act="save"]').onclick = () => commitEdit(wrap, ta.value);
}

// Annulation : restaure la bulle à son contenu d'origine, sans rien changer.
function cancelEdit(wrap, original) {
  wrap.classList.remove('editing');
  const bubble = wrap.querySelector('.bubble');
  bubble.innerHTML =
    `<button class="msg-edit" title="Éditer" onclick="onEditMsg(this)">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
    `</button>` +
    `<div class="body">${renderMd(original)}</div>`;
  decoratePre(wrap);
  highlightUnder(wrap);
}

// Validation : recalcule l'index (le thread n'a pas bougé, mais on ne fige rien)
// puis délègue la troncature + relance à editUserMessage (main.js).
function commitEdit(wrap, value) {
  const t = (value || '').trim();
  if (!t) return;
  const index = msgIndex(wrap);
  if (index < 0) return;
  editUserMessage(index, t);
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

function fullDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
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
  return c => {
    if ((c.title || '').toLowerCase().includes(q)) return true;
    const entry = getSummaryEntry(c.id);
    if (entry && !entry.suppressed && entry.summary && scoreSummary(qTokens, entry) >= 1) return true;
    return false;
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
       <div class="conv-date" title="${escHtml(fullDateTime(c.timestamp))}">${escHtml(relativeWhen(c.timestamp))}</div>
     </div>
     <button class="conv-pin" title="${c.pinned ? 'Désépingler' : 'Épingler'}" onclick="event.stopPropagation();togglePin('${c.id}')">${PIN_SVG}</button>
     <button class="conv-del" title="Supprimer" onclick="event.stopPropagation();deleteConv('${c.id}')">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
     </button>`;
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
  let convs = listAllConversations();
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
    const section = sectionFor(c.timestamp);
    if (section !== lastSection) {
      list.appendChild(sectionEl(section));
      lastSection = section;
    }
    list.appendChild(convItemEl(c));
  }
}

function toggleSidebar() { $('app').classList.toggle('sidebar-open'); }

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

// Légende + placeholder du champ clef, selon REQUIRE_API_KEY (figé au build).
// Posé une fois à l'init — la constante ne change pas au runtime.
function syncKeyFieldHint() {
  const input = $('set-key');
  const hint = $('set-key-hint');
  if (REQUIRE_API_KEY) {
    if (input) input.placeholder = 'Clef API';
    if (hint) hint.textContent = "Authentification requise.";
  } else {
    if (input) input.placeholder = '(vide si non requise)';
    if (hint) hint.textContent = "Laissez vide si l'endpoint n'exige pas d'authentification.";
  }
}

// ── État configuré / non configuré ──────────────────────────────────────────
function syncConfigured() {
  const url = $('set-url').value.trim();
  const key = $('set-key').value.trim();
  configured = !!(url && (key || !REQUIRE_API_KEY));

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
    ta.placeholder = 'API non configurée — ouvrez les paramètres';
    ta.disabled = true;
    send.disabled = true;
    dot.className = 'dot err';
  }
}

function setSending(on) {
  sending = on;
  setComposerStreaming(on);
  const send = $('send-btn');
  // Pendant l'envoi le bouton devient « stop » (cliquable) ; sinon il dépend
  // de l'état configuré.
  if (send) send.disabled = on ? false : !configured;
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

// ── Composer ────────────────────────────────────────────────────────────────
function onComposerKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending) sendMessage(); }
}

// ── Dropdown modèle (liste via l'API) ───────────────────────────────────────
let _models = [];

async function openModelMenu() {
  const menu = $('model-menu');
  menu.classList.add('show');
  menu.innerHTML = `<div class="model-loading"><span class="spin"></span>Interrogation de l'API…</div>`;
  const url = $('set-url').value.trim();
  const key = $('set-key').value.trim();
  if (!url) {
    menu.innerHTML = `<div class="model-error">URL non renseignée — saisie manuelle</div>`;
    return;
  }
  try {
    const models = await fetchModels({ url, key });
    _models = models;
    if (!models.length) {
      menu.innerHTML = `<div class="model-error">Aucun modèle exposé — saisie manuelle</div>`;
      return;
    }
    renderModelOptions(models, true);
  } catch (e) {
    menu.innerHTML = `<div class="model-error">API injoignable — saisie manuelle</div>`;
  }
}

function renderModelOptions(models, scrollToSelected) {
  const menu = $('model-menu');
  const cur = $('set-model').value.trim();
  menu.innerHTML = '';
  models.forEach(m => {
    const o = document.createElement('div');
    o.className = 'model-opt' + (m === cur ? ' selected' : '');
    o.innerHTML = `<span>${escHtml(m)}</span><span class="check">✓</span>`;
    o.onmousedown = (ev) => { ev.preventDefault(); pickModel(m); };
    menu.appendChild(o);
  });
  if (scrollToSelected) {
    const sel = menu.querySelector('.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
}

function onModelInput() {
  const q = $('set-model').value.trim().toLowerCase();
  renderModelOptions(_models.filter(m => m.toLowerCase().includes(q)));
}

function pickModel(m) {
  $('set-model').value = m;
  $('model-label').textContent = m;
  $('model-menu').classList.remove('show');
}

// Ferme le menu modèle au clic ailleurs.
document.addEventListener('click', (e) => {
  if (!e.target.closest('#set-model') && !e.target.closest('#model-menu')) {
    const menu = $('model-menu');
    if (menu) menu.classList.remove('show');
  }
  if (!e.target.closest('#composer-model')) {
    const cm = $('composer-model-menu');
    if (cm) cm.classList.remove('show');
  }
});

// ── Sélecteur de modèle du composer ─────────────────────────────────────────
// Liste mise en cache pour la session (pas de persistance), invalidée si l'URL
// du backend change. Un seul fetch /models par session/backend.
let _modelsCache = null;
let _modelsCacheUrl = '';

async function loadModelsCached() {
  const cfg = loadSettings();
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

// ── Settings drawer ─────────────────────────────────────────────────────────
function openSettings() {
  const s = loadSettings();
  setMemoryModeUI(s.memoryMode);   // valeur courante (peut changer via la bannière)
  setThemeUI(s.theme || 'system');
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
const MEMORY_HINTS = {
  auto:    "Recherche les conversations passées liées et les injecte dans le contexte, sans rien demander.",
  propose: "Détecte les conversations passées liées et propose de les injecter via une bannière, avant l'envoi.",
  never:   "Aucune recherche ni injection automatique des conversations passées.",
};

let pendingMemoryMode = 'propose';
function setMemoryModeUI(mode) {
  pendingMemoryMode = mode || 'propose';
  document.querySelectorAll('#memory-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingMemoryMode);
  });
  const hint = $('memory-hint');
  if (hint) hint.textContent = MEMORY_HINTS[pendingMemoryMode] || '';
}
function selectMemoryMode(mode) { setMemoryModeUI(mode); }

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

// ── Bannière mémoire (mode « proposer ») ────────────────────────────────────
let _bannerHandlers = null;
function showMemoryBanner(matches, handlers) {
  _bannerHandlers = handlers;
  const n = matches.length;
  $('memory-banner-text').textContent = n > 1
    ? n + ' conversations passées semblent liées.'
    : 'Une conversation passée semble liée.';
  $('memory-banner').classList.add('show');
}
function hideMemoryBanner() {
  const b = $('memory-banner');
  if (b) b.classList.remove('show');
  _bannerHandlers = null;
}
function memoryBanner(action) {
  const h = _bannerHandlers;
  hideMemoryBanner();
  if (h && h[action]) h[action]();
}

// ── Gestion des souvenirs ───────────────────────────────────────────────────
function openMemory() {
  renderMemoryList();
  $('memory-drawer').classList.add('show');
  $('memory-backdrop').classList.add('show');
}
function closeMemory() {
  $('memory-drawer').classList.remove('show');
  $('memory-backdrop').classList.remove('show');
}

function renderMemoryList() {
  const wrap = $('memory-list');
  wrap.innerHTML = '';
  const all = loadSummaries();
  const ids = Object.keys(all);
  if (!ids.length) {
    wrap.innerHTML = '<div class="mem-empty">Aucun souvenir pour l\'instant.</div>';
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
        `<div class="mem-body"><div class="mem-title">${escHtml(e.title || 'Souvenir supprimé')}</div>` +
        `<div class="mem-sub">supprimé${date ? ' · ' + escHtml(date) : ''}</div></div>` +
        `<button class="mem-btn" onclick="restoreMemory('${id}')">Ré-autoriser</button>`;
    } else {
      const full = e.summary || '';
      const extrait = full.slice(0, 150);
      item.className = 'mem-item';
      item.innerHTML =
        `<div class="mem-body">` +
        `<div class="mem-title">${escHtml(e.title || 'Nouvelle conversation')}</div>` +
        `<div class="mem-sub">${escHtml(date)}</div>` +
        `<div class="mem-excerpt">${escHtml(extrait)}${full.length > 150 ? '…' : ''}</div>` +
        `</div>` +
        `<button class="mem-btn danger" onclick="deleteMemory('${id}')">Supprimer</button>`;
    }
    wrap.appendChild(item);
  }
}

function deleteMemory(id) { suppressSummary(id); renderMemoryList(); }

// Ré-autorisation. Si le résumé est conservé sous la tombstone → retour
// instantané. Sinon, régénération avec loader inline sur l'item concerné.
async function restoreMemory(id) {
  const entry = getSummaryEntry(id);
  if (entry && entry.summary) {        // état d'avant préservé : instantané
    restoreSummary(id);
    renderMemoryList();
    return;
  }

  const conv = loadConversation(id);
  if (!conv || !hasSubstance(conv.messages)) {   // rien à régénérer
    restoreSummary(id);
    renderMemoryList();
    return;
  }

  const item = $('memory-list').querySelector('.mem-item[data-id="' + id + '"]');
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
  renderMemoryList();
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

function renderToolsList() {
  const wrap = $('tools-list');
  const defs = toolDefinitions();
  if (!defs.length) {
    wrap.innerHTML = '<div class="mem-empty">Aucun outil enregistré.</div>';
    return;
  }
  wrap.innerHTML = '';
  for (const d of defs) {
    const fn = d.function;
    const props = (fn.parameters && fn.parameters.properties) || {};
    const req = (fn.parameters && fn.parameters.required) || [];
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

    item.innerHTML =
      '<div class="tool-name">' + escHtml(fn.name) + '</div>' +
      '<div class="tool-desc">' + escHtml(fn.description) + '</div>' +
      paramsHtml;
    wrap.appendChild(item);
  }
}

function setMemItemLoading(item, label) {
  const btn = item.querySelector('.mem-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = '<span class="spin"></span>' + escHtml(label);
}
