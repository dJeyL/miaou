// ── MIAOU servi en http(s) : service worker (cf. docs/pwa.md) ────────────────
// En file://, rien de ce fichier ne s'active : ni service worker, ni
// installation. La page servie (typiquement par le proxy MCP, sous /app/) gagne
// un lancement proxy coupé et l'installation en application.

// LE prédicat « page servie » : http(s), jamais file://. Pur, testé.
function isServedProtocol(protocol) {
  return protocol === 'http:' || protocol === 'https:';
}

function pageIsServed() {
  return typeof location !== 'undefined' && isServedProtocol(location.protocol);
}

// La page tourne-t-elle dans la fenêtre d'une application installée ?
function isStandaloneDisplay() {
  return typeof window !== 'undefined' && !!window.matchMedia
    && window.matchMedia('(display-mode: standalone)').matches;
}

// Enregistre sw.js, voisin de miaou.html : sa portée par défaut est son dossier
// (/app/ derrière le proxy), sans en-tête Service-Worker-Allowed. Un contexte
// non sécurisé (accès par l'IP du LAN en http clair) n'expose pas l'API : rien
// à faire, l'appli marche comme avant. Échec silencieux en console seulement —
// un sw.js absent (dist/ servi par autre chose que le build complet) ne
// concerne pas l'utilisateur.
function registerServiceWorker() {
  if (!pageIsServed() || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(function (e) {
    console.warn('[miaou] service worker non enregistré', e);
  });
}

// ── Détection de nouvelle version ────────────────────────────────────────────
// build.py écrit dans dist/version.json l'empreinte du contenu de miaou.html,
// la même que BUILD_ID (storage.js). Relu sans cache aux signaux de retour
// (visibilitychange, focus — main.js), au plus une fois par
// VERSION_CHECK_MIN_INTERVAL_MS. Une empreinte différente = une nouvelle
// version est servie : toast persistant, action « Recharger ». Proxy coupé,
// fichier absent ou illisible : silence, ce n'est pas un état à signaler.
// Actif dès que la page est servie, installée ou dans un onglet ; jamais en
// file://, où il n'y a rien à relire.
const VERSION_CHECK_MIN_INTERVAL_MS = 120000;
const VERSION_FETCH_TIMEOUT_MS = 5000;
let _lastVersionCheck = 0;
let _announcedBuild = '';

// Pur : faut-il relire version.json maintenant ?
function shouldCheckVersion(served, buildId, lastCheck, now, minIntervalMs) {
  if (!served || !buildId) return false;
  return !lastCheck || now - lastCheck >= minIntervalMs;
}

// Pur : l'empreinte servie (contenu de version.json, déjà parsé), si elle
// désigne une AUTRE version que celle qui tourne ; '' sinon. Toute forme
// inattendue vaut « rien à signaler ».
function servedNewerBuild(localId, served) {
  const id = served && typeof served.build === 'string' ? served.build.trim() : '';
  return id && localId && id !== localId ? id : '';
}

async function checkForNewVersion() {
  const now = Date.now();
  if (!shouldCheckVersion(pageIsServed(), BUILD_ID, _lastVersionCheck, now, VERSION_CHECK_MIN_INTERVAL_MS)) return;
  _lastVersionCheck = now;
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, VERSION_FETCH_TIMEOUT_MS);
  let served = null;
  try {
    const r = await fetch('version.json', { cache: 'no-store', signal: ctrl.signal });
    if (r.ok) served = await r.json();
  } catch (e) {
    return;   // proxy coupé, délai dépassé, JSON illisible : silence
  } finally {
    clearTimeout(timer);
  }
  const id = servedNewerBuild(BUILD_ID, served);
  // Une annonce par version : fermé à la croix, le toast ne revient pas à
  // chaque retour dans la fenêtre — seulement si une AUTRE version paraît.
  if (!id || id === _announcedBuild) return;
  _announcedBuild = id;
  showToast({ key: 'app-update', level: 'info', theme: 'update', persistent: true,
    text: 'Nouvelle version de MIAOU disponible.',
    action: { label: 'Recharger', run: reloadForNewVersion } });
}

// Pur : pourquoi un rechargement perdrait-il quelque chose ? '' si rien.
// `state` = { generating, queued, draft, attachments } (nombres / booléen).
// Les générations comptent les réponses, les agents et une compaction en cours
// (toutes au registre) ; la file d'interjections et le brouillon ne sont
// persistés nulle part, un rechargement les perdrait en silence.
function reloadBlockReason(state) {
  const s = state || {};
  if (s.generating > 0) return 'Génération en cours : recharger l\'interromprait. Recharger une fois terminée.';
  if (s.queued > 0) return 'Des messages attendent dans la file : recharger les perdrait. Recharger une fois envoyés.';
  if (s.draft || s.attachments > 0) return 'Un message est en cours de rédaction : recharger le perdrait. L\'envoyer ou l\'effacer d\'abord.';
  return '';
}

function reloadBlockState() {
  let queued = 0;
  _pendingInterjections.forEach(function (list) { queued += (list && list.length) || 0; });
  const composer = document.getElementById('composer-text');
  return {
    generating: _activeGenerations.size,
    queued: queued,
    draft: !!(composer && composer.value.trim()),
    attachments: pendingAttachments.length,
  };
}

// Action du toast de mise à jour. Rend `false` quand elle refuse : le toast
// reste (toasts.js), un second toast dit ce qu'il faut attendre.
function reloadForNewVersion() {
  const why = reloadBlockReason(reloadBlockState());
  if (why) {
    showToast({ key: 'app-update-wait', level: 'info', theme: 'update', text: why });
    return false;
  }
  location.reload();
}

// ── Installation (réglages › Application) ────────────────────────────────────
// Chromium (Chrome, Edge) annonce qu'une installation est possible par
// `beforeinstallprompt`, qu'on diffère pour le déclencher depuis le bouton.
// Firefox n'installe pas d'application web, Safari macOS passe par son menu :
// là, une ligne dit comment faire. En file://, l'installation est impossible ;
// une sonde cherche si le proxy MCP sert MIAOU, pour y inviter.
let _installPrompt = null;   // BeforeInstallPromptEvent différé
let _appInstalled = false;   // `appinstalled` reçu dans cette session
let _servedAppUrl = '';      // file:// : URL de la version servie, trouvée par la sonde

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    _installPrompt = e;
    syncInstallSurface();
  });
  window.addEventListener('appinstalled', function () {
    _installPrompt = null;
    _appInstalled = true;
    syncInstallSurface();
  });
}

// ── Ctrl+N : nouvelle fenêtre MIAOU (fenêtre installée, hors macOS) ──────────
// Sur macOS, la fenêtre installée a sa barre de menus et Cmd+N y ouvre déjà une
// fenêtre de l'appli : rien à faire. Ailleurs (Windows, Linux), Chrome garde
// Ctrl+N pour lui et ouvre une fenêtre de NAVIGATEUR. Dans une fenêtre
// d'application, Chromium ne réserve pas ses raccourcis : la page reçoit la
// touche et peut l'intercepter. Dans un onglet ou en file://, la touche ne
// parvient pas à la page — et le prédicat l'écarte de toute façon.
// Sur macOS, Ctrl+N reste à l'édition de texte (ligne suivante, emacs).

// Pur : ce keydown doit-il ouvrir une nouvelle fenêtre MIAOU ?
function isNewAppWindowShortcut(e, standalone, isMac) {
  if (!standalone || isMac || !e) return false;
  if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return false;
  return e.key === 'n' || e.key === 'N';
}

// Comment ouvrir la fenêtre : 'popup' (fenêtre d'application, à la taille de
// la fenêtre courante) ou 'tab' (window.open nu, que Chromium peut envoyer
// dans un onglet du navigateur). Modifiable depuis la console pour comparer.
let _newAppWindowMode = 'popup';

function openNewAppWindow() {
  const url = location.origin + location.pathname;
  if (_newAppWindowMode === 'tab') {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const w = window.outerWidth || 1200;
  const h = window.outerHeight || 800;
  window.open(url, '_blank', 'popup,noopener,width=' + w + ',height=' + h);
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('keydown', function (e) {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
    if (!isNewAppWindowShortcut(e, isStandaloneDisplay(), isMac)) return;
    e.preventDefault();
    openNewAppWindow();
  });
}

// Pur : ce que montre la catégorie « Application ».
//   ctx = { served, secure, standalone, installed, canPrompt, servedUrl }
//   → { hint, install (bouton), openServed (bouton) }
function installSurfaceState(ctx) {
  const c = ctx || {};
  if (!c.served) {
    if (c.servedUrl) {
      return { hint: 'Ouvert depuis un fichier, MIAOU ne s\'installe pas. Le proxy MCP le sert aussi, à '
        + c.servedUrl + ' : cette version-là s\'installe comme une application.', install: false, openServed: true };
    }
    return { hint: 'Ouvert depuis un fichier, MIAOU ne s\'installe pas. Servi par le proxy MCP (clé miaou_dist de sa configuration), il s\'installe comme une application.',
      install: false, openServed: false };
  }
  if (c.standalone) return { hint: 'MIAOU tourne ici en application installée.', install: false, openServed: false };
  if (c.installed) return { hint: 'MIAOU est installé : il s\'ouvre depuis le menu des applications du système.', install: false, openServed: false };
  if (!c.secure) {
    return { hint: 'L\'installation exige une connexion sécurisée : https, ou une adresse locale (localhost, 127.0.0.1). Une adresse du réseau local en http ne suffit pas.',
      install: false, openServed: false };
  }
  if (c.canPrompt) {
    return { hint: 'Installé, MIAOU s\'ouvre dans sa propre fenêtre, avec son icône, depuis le menu des applications du système.',
      install: true, openServed: false };
  }
  return { hint: 'Ce navigateur ne propose pas d\'installation ici, ou MIAOU est déjà installé. Chrome et Edge : icône d\'installation dans la barre d\'adresse, ou menu › Installer. Safari sur macOS : Fichier › Ajouter au Dock. Firefox n\'installe pas d\'application web.',
    install: false, openServed: false };
}

function syncInstallSurface() {
  const hint = document.getElementById('install-hint');
  if (!hint) return;
  const st = installSurfaceState({
    served: pageIsServed(),
    secure: typeof window !== 'undefined' && window.isSecureContext === true,
    standalone: isStandaloneDisplay(),
    installed: _appInstalled,
    canPrompt: !!_installPrompt,
    servedUrl: _servedAppUrl,
  });
  hint.textContent = st.hint;
  document.getElementById('install-btn').hidden = !st.install;
  document.getElementById('served-app-btn').hidden = !st.openServed;
}

async function onInstallClick() {
  const p = _installPrompt;
  if (!p) return;
  _installPrompt = null;   // un événement ne sert qu'une fois
  try {
    p.prompt();
    await p.userChoice;
  } catch (e) {
    console.warn('[miaou] installation', e);
  }
  syncInstallSurface();
}

function openServedApp() {
  if (_servedAppUrl) window.open(_servedAppUrl, '_blank', 'noopener');
}

// ── file:// : la version servie existe-t-elle ? ──────────────────────────────
// Candidats : les origines http(s) des serveurs MCP configurés, suffixées de
// /app/ (chemin fixe côté proxy). Une réponse de <candidat>version.json lisible
// prouve d'un coup que le proxy répond ET qu'il sert MIAOU. C'est le sens
// inverse de ce qu'interdit le seed MCP (rien n'est dérivé de location pour les
// serveurs) : ici une URL MCP sert à TROUVER l'appli, pour l'affichage seul.
const SERVED_APP_PROBE_TIMEOUT_MS = 3000;
const SERVED_APP_TOAST_SESSION_KEY = 'miaou-served-app-toast';

// Pur : URL de base /app/ candidates, dédoublonnées, dans l'ordre des serveurs.
function servedAppCandidates(servers) {
  const out = [];
  (Array.isArray(servers) ? servers : []).forEach(function (s) {
    // Origine lue par motif et non par `new URL` : absent du moteur des tests.
    const m = /^(https?):\/\/([^\/?#\s]+)/i.exec(String((s && s.url) || '').trim());
    if (!m) return;
    const base = m[1].toLowerCase() + '://' + m[2].toLowerCase() + '/app/';
    if (out.indexOf(base) === -1) out.push(base);
  });
  return out;
}

async function probeServedApp() {
  if (typeof location === 'undefined' || location.protocol !== 'file:') return;
  for (const base of servedAppCandidates(loadMcpServers())) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, SERVED_APP_PROBE_TIMEOUT_MS);
    try {
      const r = await fetch(base + 'version.json', { cache: 'no-store', signal: ctrl.signal });
      const j = r.ok ? await r.json() : null;
      if (j && typeof j.build === 'string' && j.build) { _servedAppUrl = base; break; }
    } catch (e) {
      // proxy absent ou qui ne sert pas MIAOU : candidat suivant
    } finally {
      clearTimeout(timer);
    }
  }
  if (!_servedAppUrl) return;
  syncInstallSurface();
  let shown = false;
  try { shown = sessionStorage.getItem(SERVED_APP_TOAST_SESSION_KEY) === '1'; } catch (e) { /* stockage de session refusé */ }
  if (shown) return;
  try { sessionStorage.setItem(SERVED_APP_TOAST_SESSION_KEY, '1'); } catch (e) { /* idem */ }
  showToast({ key: 'served-app', level: 'info', theme: 'services',
    text: 'MIAOU est aussi servi par le proxy MCP, où il s\'installe comme une application.',
    action: { label: 'Réglages › Application', run: function () { openSettingsCategory('application'); } } });
}
