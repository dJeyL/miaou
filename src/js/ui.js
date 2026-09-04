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
  { emoji: '🥖', title: 'À la baguette.',         sub: 'No pain, no gain.' },
  { emoji: '🐈', title: 'Miaou.',                 sub: 'Ça veut dire « je t\'écoute », en chat.' },
  { emoji: '🧵', title: 'Nouveau fil.',           sub: 'Tire dessus, on verra ce qui vient avec.' },
  { emoji: '🎬', title: 'Moteur.',                sub: 'À toi de dire action.' },
  { emoji: '🧩', title: 'Pièce manquante.',       sub: 'Cherchons la forme.' },
  { emoji: '♟️', title: 'À ton tour.',            sub: 'J\'ai trois coups d\'avance. Ou je bluffe.' },
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
// résumé peut survivre sans la conversation, cf. conv__get). Dans ce cas,
// rendu en texte barré NON cliquable plutôt qu'un lien mort — pas de
// post-traitement DOM, juste du Markdown ~~...~~.
// `opts.asPlainText` (défaut false, écran inchangé) : pour l'export standalone
// (brief G, règles de contenu) où le lien `#miaou-conv:` ne résout jamais hors MIAOU — rend
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

// Sanitisation du HTML issu de marked (campagne relecture 2026-07) : le
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

// ── Rendu Mermaid (lot E) ────────────────────────────────────────────────
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
// épinglée @0.32.0 comme Mermaid @11.12.0. Détail : AUDIT-L, section spike.
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

// ── fflate : décodage zip natif pour docs__list / docs__extract (lot V-1) ─────
// Artefact tranché à l'audit V (AUDIT §1) : build UMD 32 ko, posant `self.fflate`
// quand ni `module` ni `define` ne sont présents → compatible « pas de modules ES »
// (contrainte dure MIAOU). Hébergé sur jsdelivr et non cdnjs comme marked/Prism :
// cdnjs ne sert PAS fflate (api.cdnjs.com → 404 « Library not found », vérifié) ;
// le précédent QuickJS rend jsdelivr non exceptionnel ici. Le même fichier couvre
// unzip ET zip (`unzipSync`, `zipSync`, `strToU8`) : V-2 (création d'archive)
// n'aura ni second script ni changement d'artefact. Version épinglée comme
// mermaid@11.12.0 et quickjs-emscripten@0.32.0.
const FFLATE_CDN = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
let _fflatePromise = null;

// Lazy-load calqué sur ensureQuickJs — PAS sur ensureMermaid : ici l'échec se
// PROPAGE (rejet) au lieu de se dégrader en silence. Une extraction demandée qui
// ne peut pas tourner doit le dire ; le handler docs__* la remonte en erreur
// d'outil propre. Promesse mémoïsée, reset-on-reject (hygiène des caches async).
// Garde post-onload symétrique de celle de QuickJS : le global ET la fonction
// attendue, pas seulement le script chargé.
function ensureFflate() {
  if (_fflatePromise) return _fflatePromise;
  _fflatePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = FFLATE_CDN;
    s.onload = () => {
      // TOUTES les fonctions consommées, pas seulement celle du premier
      // appelant : docs__extract lit (unzipSync), docs__pack écrit (zipSync,
      // lot V-2), l'export de sauvegarde encode son manifeste (strToU8, lot
      // V-3). Un build CDN partiel échouerait sinon tardivement, dans un
      // handler async, au lieu d'échouer au chargement — exactement le mode de
      // défaillance tardif que cette garde existe pour empêcher. Ajouter un
      // consommateur d'une nouvelle fonction fflate = ajouter sa ligne ici.
      if (!window.fflate || typeof window.fflate.unzipSync !== 'function'
          || typeof window.fflate.zipSync !== 'function'
          || typeof window.fflate.strToU8 !== 'function') {
        reject(new Error('fflate absent ou incomplet après chargement')); return;
      }
      resolve(window.fflate);
    };
    s.onerror = () => reject(new Error('échec de chargement fflate (CDN)'));
    document.head.appendChild(s);
  });
  _fflatePromise.catch(() => { _fflatePromise = null; });   // reset sur rejet → retry possible
  return _fflatePromise;
}

// ── pdf.js : lecture PDF native pour docs__list / docs__read (lot V-4) ───────
// VERSION GELÉE à 3.11.174, et ce n'est pas un choix de confort : pdf.js 4.x et
// 5.x n'existent plus qu'en modules ES (vérifié au spike — `pdf.min.mjs` est le
// seul build proposé, la variante `legacy/` comprise). La contrainte dure MIAOU
// « pas de modules ES » fige donc la dépendance sur la dernière UMD publiée.
// Cette branche ne suivra pas l'amont ; le jour où MIAOU accepterait un module
// ES, la question se rouvre. Épinglée comme mermaid@11.12.0, fflate@0.8.2 et
// quickjs-emscripten@0.32.0.
const PDFJS_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER_CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
let _pdfjsPromise = null;

// Lazy-load calqué sur ensureFflate (échec PROPAGÉ, promesse mémoïsée,
// reset-on-reject, garde post-onload sur TOUTES les fonctions consommées), avec
// une différence de CONTRAT : cette fonction résout « pdf.js PRÊT, worker
// compris », jamais « le script est chargé ». Aucun appelant ne pose workerSrc
// lui-même — même discipline qu'ensureQuickJs, qui résout le module WASM
// compilé et pas le script.
//
// Le worker RÉEL est une décision du lot (V-4 décision 1), pas un raffinement.
// L'alternative — le « fake worker » (workerSrc = '') — parse dans le THREAD
// PRINCIPAL : 1 106 ms pour 3 pages au spike, donc des dizaines de secondes de
// gel sur un rapport de 200 pages. Pendant ce gel, une génération en vol
// (piège 28) se figerait avec l'UI. Le lot T a passé beaucoup d'énergie à rendre
// les générations non bloquantes ; réintroduire un gel par le côté serait une
// régression architecturale, pas un désagrément.
//
// Le détour par blob: est obligatoire : un worker ne peut pas être chargé
// cross-origin depuis un CDN via workerSrc direct. Le fetch + createObjectURL
// contourne, et c'est aussi la seule voie qui reste compatible d'une page
// file:// — MIAOU est un fichier HTML unique, souvent ouvert en local.
// Coût assumé : +1,09 Mo et une requête de plus au PREMIER PDF ouvert.
function ensurePdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_CDN;
    s.onload = () => {
      const lib = window.pdfjsLib;
      // Le global ET tout ce qu'on consomme : getDocument pour ouvrir,
      // GlobalWorkerOptions pour poser le worker. Un build CDN partiel doit
      // échouer ICI, pas plus tard dans un handler async (leçon V-3, où strToU8
      // manquait à la garde de fflate).
      if (!lib || typeof lib.getDocument !== 'function' || !lib.GlobalWorkerOptions) {
        reject(new Error('pdf.js absent ou incomplet après chargement')); return;
      }
      // Worker en blob:. L'échec se propage comme le reste : un PDF qu'on ne
      // peut pas ouvrir doit le dire, jamais retomber en silence sur un parsing
      // main thread qui gèlerait l'onglet.
      fetch(PDFJS_WORKER_CDN)
        .then(r => (r.ok ? r.blob() : Promise.reject(new Error('HTTP ' + r.status))))
        .then(b => {
          lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b);
          resolve(lib);
        })
        .catch(e => reject(new Error('échec de chargement du worker pdf.js : ' + ((e && e.message) || e))));
    };
    s.onerror = () => reject(new Error('échec de chargement pdf.js (CDN)'));
    document.head.appendChild(s);
  });
  _pdfjsPromise.catch(() => { _pdfjsPromise = null; });   // reset sur rejet → retry possible
  return _pdfjsPromise;
}

// ── SheetJS : lecture Excel native pour docs__list / docs__read (lot V-5) ────
// VERSION GELÉE à 0.18.5, et pour une raison différente de pdf.js : SheetJS a
// QUITTÉ npm. 0.18.5 est la dernière version publiée sur le registre ; le projet
// distribue depuis sur son propre CDN. Épingler 0.18.5 via jsdelivr est stable
// (npm ne réécrit pas une version publiée) et garde le patron des cinq autres
// artefacts — mais cette branche ne recevra aucun correctif. Si un .xlsx réel
// refuse de s'ouvrir, la question se rouvre, et le fallback mcp_docs existe
// précisément pour que ce ne soit pas bloquant.
const SHEETJS_CDN = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
let _sheetjsPromise = null;

// Même contrat qu'ensureFflate et ensurePdfJs (échec PROPAGÉ, promesse mémoïsée,
// reset-on-reject, garde post-onload sur TOUTES les fonctions consommées), en
// plus simple : SheetJS n'a pas de worker à câbler, donc « le script chargé » et
// « la bibliothèque prête » coïncident ici — ce qui n'était PAS le cas de pdf.js.
//
// Vérifié au spike plutôt que supposé : SheetJS ne DÉTACHE PAS le buffer qu'on
// lui passe (byteLength intact après read, deuxième lecture du même buffer OK).
// Le u8.slice() défensif d'openPdfDocument n'a donc pas à être reproduit ici —
// et cette phrase existe pour que le prochain ne le rajoute pas « par symétrie ».
function ensureSheetJs() {
  if (_sheetjsPromise) return _sheetjsPromise;
  _sheetjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SHEETJS_CDN;
    s.onload = () => {
      const lib = window.XLSX;
      // Le global ET tout ce qu'on consomme : read pour ouvrir, utils.sheet_to_csv
      // pour rendre. Un build CDN partiel doit échouer ICI (leçon V-3).
      if (!lib || typeof lib.read !== 'function' || !lib.utils
          || typeof lib.utils.sheet_to_csv !== 'function') {
        reject(new Error('SheetJS absent ou incomplet après chargement')); return;
      }
      resolve(lib);
    };
    s.onerror = () => reject(new Error('échec de chargement SheetJS (CDN)'));
    document.head.appendChild(s);
  });
  _sheetjsPromise.catch(() => { _sheetjsPromise = null; });   // reset sur rejet → retry possible
  return _sheetjsPromise;
}

// mammoth (lot V-5, étape 2) — lecture des .docx. Contrairement à SheetJS,
// mammoth est toujours publié sur npm : 1.11.0 est une version courante et non
// une branche gelée, l'épinglage est ici du conservatisme ordinaire.
const MAMMOTH_CDN = 'https://cdn.jsdelivr.net/npm/mammoth@1.11.0/mammoth.browser.min.js';
let _mammothPromise = null;

// Même contrat que les trois précédents. Comme SheetJS et à la différence de
// pdf.js : pas de worker (« script chargé » = « lib prête »), et le buffer n'est
// PAS détaché — mesuré au spike (byteLength intact, deuxième conversion du même
// buffer OK), donc pas de u8.slice() défensif à recopier « par symétrie ».
//
// La garde post-onload porte sur convertToHtml, et sur elle seule : c'est la
// seule API consommée. extractRawText et convertToMarkdown ont été ÉCARTÉES au
// spike — la première perd les tableaux, la seconde les aplatit cellule par
// cellule tout en sur-échappant. Les vérifier ici laisserait croire qu'on peut
// s'en servir.
function ensureMammoth() {
  if (_mammothPromise) return _mammothPromise;
  _mammothPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MAMMOTH_CDN;
    s.onload = () => {
      const lib = window.mammoth;
      if (!lib || typeof lib.convertToHtml !== 'function') {
        reject(new Error('mammoth absent ou incomplet après chargement')); return;
      }
      resolve(lib);
    };
    s.onerror = () => reject(new Error('échec de chargement mammoth (CDN)'));
    document.head.appendChild(s);
  });
  _mammothPromise.catch(() => { _mammothPromise = null; });   // reset sur rejet → retry possible
  return _mammothPromise;
}

// Passe de rendu : transforme chaque bloc ```mermaid de `scope` en diagramme.
// Appelée à la FINALISATION uniquement — finalizeAssistant et buildMsg, JAMAIS
// streamInto (source partielle = flicker + erreurs de parse en cascade).
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
      `<button class="msg-regen" hidden title="Régénérer la réponse" onclick="regenerateResponse()">` +
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

// Corps replié d'une réponse d'agent (X-1e). `<details>` NATIF, fermé par
// défaut : un compte rendu d'agent est long (tâche confiée, identifiant, outils
// en échec, puis la réponse entière) et il arrive au milieu du fil du parent,
// entre deux messages qui, eux, sont la conversation. Le laisser déplié noie
// l'échange dans le rapport d'un travail déjà fait.
//
// L'en-tête est imbriqué DANS le <summary> (pas en frère) : c'est ce qui donne
// une zone de clic couvrant tout le bandeau, repli comme dépli, SANS JS
// (project_details_summary_collapse_click_zone). Marqueur natif retiré en CSS,
// remplacé par un chevron qui pivote.
//
// Le libellé porte l'intent — ce que le modèle avait confié à l'agent — plutôt
// qu'un « Réponse d'agent » générique : replié, c'est la seule chose lisible,
// et c'est la question à laquelle le bloc répond. Statut à côté, depuis la même
// table que le bandeau (AGENT_STATUS_UI_LABELS) : un résultat partiel ou en
// erreur doit se voir sans déplier.
function agentResultBodyHtml(content, agentResult) {
  const a = agentResult || {};
  const intent = a.intent || 'Agent';
  const label = AGENT_STATUS_UI_LABELS[a.status] || '';
  return (
    `<details class="agent-result-box">` +
    `<summary>` +
    `<div class="agent-result-head">` +
    `<svg class="agent-result-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>` +
    `<svg class="agent-result-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 13h.01M15 13h.01M9 17h6"/></svg>` +
    `<span class="agent-result-intent">${escHtml(intent)}</span>` +
    (label ? `<span class="agent-result-status">${escHtml(label)}</span>` : '') +
    `</div>` +
    `</summary>` +
    `<div class="body">${renderUserMd(content)}</div>` +
    `</details>`
  );
}

// `agentResult` (X-1e) : le message user porte une réponse d'agent
// (buildAgentResultEntry, agents.js) plutôt qu'une saisie humaine. Il n'est pas
// éditable — son texte est le compte rendu d'un travail qui a réellement eu
// lieu, dans une conversation qui existe encore et que le bouton de retour
// permet d'aller lire. Le réécrire ferait diverger le fil du parent de ce que
// l'agent a effectivement produit, sans que rien ne le signale : deux versions
// d'un même résultat, celle du parent et celle de l'agent, et aucun moyen de
// savoir laquelle est la vraie. On retire donc le bouton ici ET on ferme
// enterEditMode (les deux voies ensemble — fermer la seule affordance visible
// laisserait passer un appel direct, et le clavier).
function buildMsg(role, content, model, reasoning, ts, server, truncated, attachments, agentResult) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  if (role === 'user') {
    if (ts) wrap.dataset.ts = ts;
    if (agentResult) wrap.classList.add('agent-result');
    wrap.innerHTML =
      `<div class="bubble">` +
      renderMsgAttachments(attachments, currentConvId) +
      (agentResult
        ? agentResultBodyHtml(content, agentResult)
        : `<div class="body">${renderUserMd(content)}</div>`) +
      `</div>` +
      `<div class="msg-user-footer">` +
      `<div class="msg-user-actions">` +
      (agentResult ? '' :
      `<button class="msg-edit" title="Éditer" onclick="onEditMsg(this)">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
      `</button>`) +
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
  // Pictogramme « œil » — aperçu sandboxé des blocs html/svg (lot E, préviz sandboxée).
  // Métaphore réservée à cet usage (vocabulaire d'icônes).
  const svgEye = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;
  // Pictogramme « page » — conversion d'un bloc markdown en page HTML (lot R).
  // Distinct de la flèche de téléchargement (qui rend le contenu BRUT) : ici on
  // produit un document mis en forme. Métaphore réservée à cet usage.
  const svgPage = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>`;

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
      // Aperçu sandboxé : clic EXPLICITE uniquement, jamais automatique.
      (isPreviewableLang(lang) ? `<button class="code-preview-btn" title="Aperçu">${svgEye}</button>` : '') +
      // Conversion en page HTML (lot R) : même geste que le convertisseur des
      // réglages, appliqué au contenu du bloc. Markdown seulement.
      (isMarkdownLang(lang) ? `<button class="code-md-html" title="Convertir en page HTML">${svgPage}</button>` : '') +
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
    // Conversion en page HTML (lot R) : réutilise convertMarkdownToHtmlFile,
    // exactement comme la zone de dépôt des réglages — un seul chemin de
    // conversion, pas de second rendu à faire dériver. Le nom de sortie vient
    // du data-filename du bloc s'il existe, sinon du titre h1 du markdown,
    // sinon d'un repli neutre (mdHtmlFileName pose l'extension .html).
    const mdBtn = head.querySelector('.code-md-html');
    if (mdBtn) mdBtn.onclick = async () => {
      if (mdBtn.disabled) return;
      const md = code ? code.textContent : '';
      const rawName = code ? code.getAttribute('data-filename') : '';
      const fallback = (extractMdTitle(md).title || 'document') + '.md';
      mdBtn.disabled = true;
      try {
        await convertMarkdownToHtmlFile(md, rawName || fallback);
      } finally {
        mdBtn.disabled = false;
      }
    };
    pre.insertBefore(head, pre.firstChild);
  });

  // Dans decoratePre et non chez ses appelants : c'est déjà LE point de passage
  // du markdown rendu, donc tout nouveau site de rendu hérite du porteur sans
  // qu'on ait à y penser. No-op sur les scopes qui construisent un <pre> à la
  // main (bloc de code d'une ressource, aperçu de prompt) : aucun `.body table`
  // à y trouver.
  wrapWideTables(scope);
}

// Enveloppe chaque tableau rendu dans un porteur, seul moyen de le laisser
// déborder de la colonne de lecture EN RESTANT CENTRÉ : le débordement veut une
// marge horizontale négative, le centrage veut `margin-inline: auto`, et un même
// élément ne peut pas porter les deux — la seconde écrase la première. Le
// porteur prend l'élargissement, le tableau se centre dedans (cf. .table-bleed,
// chat.css).
//
// Aucune mesure, aucun seuil : le CSS décide seul si le tableau consomme le
// débordement offert, donc rien à ré-exécuter au redimensionnement de la fenêtre
// ni au changement de largeur de colonne.
//
// Idempotent : les chemins de rendu repassent sur un même scope (finalize après
// streaming, re-rendu de fil) — un tableau déjà enveloppé est laissé tel quel.
function wrapWideTables(scope) {
  if (!scope) return;
  scope.querySelectorAll('.body table').forEach(function(table) {
    const parent = table.parentNode;
    if (!parent || (parent.classList && parent.classList.contains('table-bleed'))) return;
    const holder = document.createElement('div');
    holder.className = 'table-bleed';
    parent.insertBefore(holder, table);
    holder.appendChild(table);
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
// Silhouette de robot (tête carrée + antenne) — métaphore RÉSERVÉE aux agents
// (lot X-1) : une métaphore = un usage. Distincte de la clé à molette (outil
// MCP) et de l'œil (lecture de conversation) : un agent n'est ni l'un ni
// l'autre, c'est un tiers à qui on confie une tâche.
const ICON_AGENT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 13h.01M15 13h.01M9 17h6"/></svg>';
// Triangle d'alerte — métaphore RÉSERVÉE à l'échec d'outil (kind tool_failed) :
// ne pas la réemployer ailleurs (vocabulaire d'icônes : une métaphore = un usage).
// L'outil MCP en échec garde SON icône (clé à molette) + la couleur d'erreur ;
// ce triangle est pour les échecs natifs, qui n'ont pas d'icône propre.
const ICON_ALERT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
// Même tracé que `.code-dl` (decoratePre) — vocabulaire d'icônes, flèche vers
// le bas = télécharger, réservée à cet usage (A3-2, bouton lightbox mode image).
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
// Métaphore image (cadre + montagne) — RÉSERVÉE à une image PRODUITE par MIAOU
// (page PDF rendue, lot V-8). Vocabulaire d'icônes : une métaphore = un usage.
// NE PAS la confondre avec ICON_EYE, qui porte la CONSULTATION (conversation_read,
// resource_presented, recall d'une pièce jointe) : l'œil dit « on te remontre »,
// là où le rendu FABRIQUE une image qui n'existait pas.
const ICON_IMAGE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';

// Métaphore « loupe » — RÉSERVÉE à l'inspection du détail d'un appel d'outil
// (lot Z). Vocabulaire d'icônes : une métaphore = un usage. Distincte
// d'ICON_EYE, qui dit « on te remontre un contenu » (conversation_read,
// resource_presented) : la loupe dit « on décortique ce qui s'est passé » —
// arguments envoyés, résultat reçu, méta d'appel.
const ICON_INSPECT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>';

// Métaphore « clé » — RÉSERVÉE au refus d'autorisation d'un serveur MCP
// (campagne AB). Vocabulaire d'icônes : une métaphore = un usage. Une clé, pas
// un cadenas : le cadenas dit « c'est fermé » (un état), la clé dit « voici de
// quoi ouvrir » (une action) — et c'est bien une action qu'on propose ici.
// Distincte d'ICON_ALERT, qui signale une anomalie subie : un refus
// d'autorisation n'est pas une panne, c'est une étape prévue du parcours.
const ICON_KEY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.8 12.2 21 2"/><path d="m17 6 3 3"/><path d="m14 9 3 3"/></svg>';

// Séparateur › coloré (teinte accent) partagé par tous les acks à deux segments
// (breadcrumb MCP, détail replié, ou simple label "Action › cible") — générique,
// pas réservé aux outils MCP — classe CSS générique `.ack-sep`.
function appendAckSep(el) {
  const sep = document.createElement('span');
  sep.className = 'ack-sep';
  sep.textContent = '›';
  el.appendChild(sep);
}

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
            onclick: () => selectConv(m.convId),
          })
        : document.createTextNode(m.title || 'sans titre');
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Conversation consultée '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' '));
          detail.appendChild(titleNode);
        });
      } else {
        el.appendChild(document.createTextNode('Conversation consultée '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' « '));
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
        detail.appendChild(document.createTextNode('Appel '));
        appendAckSep(detail);
        detail.appendChild(document.createTextNode(' '));
        segs.forEach((seg, i) => {
          if (i > 0) appendAckSep(detail);
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
    label: m => 'Ressource enregistrée : ' + (m.resourceName || m.id || '?') +
      (m.size != null ? ' (' + humanSize(m.size) + ')' : ''),
    renderLabel: (m, el) => {
      const build = target => {
        target.appendChild(document.createTextNode('Ressource enregistrée '));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + (m.resourceName || m.id || '?') +
          (m.size != null ? ' (' + humanSize(m.size) + ')' : '')));
      };
      // DEUX POSTURES pour ce kind, distinguées par la seule présence d'`intent`
      // (mesuré, pas déduit) : ack UNIQUE d'un outil que le modèle a appelé
      // (resource__create) → il le porte ; SOUS-PRODUIT de _storeBlock derrière
      // un autre outil (docs__pack, docs__read as_resource, fetch_url) → il ne le
      // porte pas, l'intent est allé à l'ack principal poussé après lui.
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  // Lot Y — écriture incrémentale. MÊME icône que resource_stored (ICON_PACKAGE) :
  // c'est la même métaphore « ranger dans une ressource », l'action se distingue
  // par le libellé, pas par une deuxième métaphore de la même famille
  // (project_icon_metaphor_vocabulary). Pas d'undo, comme resource_stored.
  // `appendedLen` (ajouté) et `size` (total après ajout) sont TOUS DEUX affichés :
  // seul le couple dit ce qui vient de se passer.
  //
  // `ok === false` (lot Y) ne veut PAS dire « l'écriture a échoué » — _appendBlock
  // est atomique — mais « le calcul qui l'a produite s'est interrompu », donc la
  // ressource est incomplète. D'où un suffixe qui S'AJOUTE au décompte au lieu de
  // le remplacer, contrairement au « (refusé) » de js_eval/docs_pack : ce qui a
  // été écrit avant l'interruption est précisément ce qui a été SAUVÉ, l'effacer
  // de l'affichage cacherait l'information utile. ackIsError fait le rouge.
  resource_appended: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Ressource complétée : ' + (m.resourceName || m.id || '?') +
      (m.appendedLen != null ? ' (+' + m.appendedLen + ' car.' +
        (m.size != null ? ', ' + humanSize(m.size) + ' au total' : '') +
        (m.ok === false ? ', interrompu' : '') + ')'
        : (m.ok === false ? ' (interrompu)' : '')),
    renderLabel: (m, el) => {
      const tail = (m.appendedLen != null ? ' (+' + m.appendedLen + ' car.' +
        (m.size != null ? ', ' + humanSize(m.size) + ' au total' : '') +
        (m.ok === false ? ', interrompu' : '') + ')'
        : (m.ok === false ? ' (interrompu)' : ''));
      const build = target => {
        target.appendChild(document.createTextNode('Ressource complétée '));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + (m.resourceName || m.id || '?') + tail));
      };
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  resource_presented: {
    destination: 'user',
    undo: null,
    icon: ICON_EYE,
    label: m => 'Ressource présentée : ' + (m.resourceName || m.id || '?'),
    renderLabel: (m, el) => {
      const build = target => {
        target.appendChild(document.createTextNode('Ressource présentée '));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + (m.resourceName || m.id || '?')));
      };
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  // Rappel d'une pièce jointe de message (miaou__recall_attachment, brief A).
  // Même posture que resource_presented (lecture, pas d'undo) mais lookup par
  // attId (conversation-scoped), pas id de ressource — cf. placeToolAck.
  // DEUX PRODUCTEURS pour ce kind, distingués par `origin` (lot V-8) :
  //   - recall_attachment : l'utilisateur avait joint le fichier, le modèle le
  //     RAPPELLE (métaphore œil, « on te remontre ») ;
  //   - docs__render_page (origin: 'docs_render') : MIAOU PRODUIT l'image d'une
  //     page de PDF, elle n'existait pas avant (métaphore image).
  // Le kind est commun DÉLIBÉRÉMENT : c'est lui que resolveRecallImages
  // (resources.js) reconnaît pour ré-injecter les pixels aux envois ultérieurs,
  // et un second kind obligerait à maintenir deux prédicats de ré-injection en
  // parallèle. `origin` ne gouverne QUE l'affichage — jamais le routage.
  attachment_recalled: {
    destination: 'user',
    undo: null,
    icon: m => (m && m.origin === 'docs_render') ? ICON_IMAGE : ICON_EYE,
    label: m => (m && m.origin === 'docs_render')
      ? docsRenderAckLabel(m)                                  // docs.js, pur
      : 'Pièce jointe rappelée : ' + (m.resourceName || m.attId || '?'),
    renderLabel: (m, el) => {
      const render = m && m.origin === 'docs_render';
      const head = (render ? docsRenderAckHead(m) : 'Pièce jointe rappelée') + ' ';
      const cible = render
        ? (m.sourceName || m.resourceName || '?')
        : (m.resourceName || m.attId || '?');
      const build = target => {
        target.appendChild(document.createTextNode(head));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + cible));
      };
      // Intention du modèle au niveau 1, libellé dérivé replié au niveau 2 —
      // patron des 19 autres lignes de la table (cf. docs_read juste au-dessus).
      // Cette ligne en était la SEULE exception, antérieurement à V-8 : le
      // `miaou_intent` arrivait bien sur l'ack (callTool + ACK_COPY_FIELDS) mais
      // n'était jamais affiché, alors qu'il l'était dans l'export.
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
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
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
        });
      } else {
        el.appendChild(document.createTextNode('Skill consultée '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
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
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
        });
      } else {
        el.appendChild(document.createTextNode(verb + ' '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + (m.title || m.slug || '?')));
      }
    },
  },
  // Consultation de l'aide MIAOU par le modèle (miaou__about) : informatif, pas
  // d'undo (lecture — même posture que skill_read).
  about_read: {
    destination: 'user',
    undo: null,
    icon: ICON_BOOK,
    label: m => 'Aide consultée : ' + (m.topic || 'apercu'),
    renderLabel: (m, el) => {
      const topic = m.topic || 'apercu';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Aide consultée '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + topic));
        });
      } else {
        el.appendChild(document.createTextNode('Aide consultée '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + topic));
      }
    },
  },
  // Recherche de mots-clefs dans l'aide MIAOU (miaou__about_search) : même
  // posture que about_read (lecture, pas d'undo) ; libellé porte la requête
  // et le nombre de sujets trouvés (pattern pluriel de files_list).
  about_search: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m =>
      'Aide cherchée « ' + (m.query || '') + ' » : ' + (
        m.count === 0 ? 'aucun résultat'
      : m.count === 1 ? '1 sujet trouvé'
      : (m.count != null ? m.count : '?') + ' sujets trouvés'),
    renderLabel: (m, el) => {
      const countText =
          m.count === 0 ? 'aucun résultat'
        : m.count === 1 ? '1 sujet trouvé'
        : (m.count != null ? m.count : '?') + ' sujets trouvés';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Aide cherchée « ' + (m.query || '') + ' » '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + countText));
        });
      } else {
        el.appendChild(document.createTextNode('Aide cherchée « ' + (m.query || '') + ' » '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + countText));
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
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + name));
        });
      } else {
        el.appendChild(document.createTextNode('Fichier consulté '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + name));
      }
    },
  },
  // Promotion d'une pièce jointe vers la bibliothèque (miaou__files__promote) :
  // informatif seulement, PAS d'undo — la promotion est déjà consent-gated en
  // amont (ask_confirmation, voie B), un undo ici confondrait consentement et
  // réversibilité (« undo n'est pas consentement »).
  file_promote: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Fichier ajouté à la bibliothèque : ' + (m.resourceName || m.id || '?'),
    renderLabel: (m, el) => {
      const build = target => {
        target.appendChild(document.createTextNode('Fichier ajouté à la bibliothèque '));
        appendAckSep(target);
        target.appendChild(document.createTextNode(' ' + (m.resourceName || m.id || '?')));
      };
      if (m.intent) renderIntentTwoLevel(el, m.intent, null, build);
      else build(el);
    },
  },
  // Compute sandboxé sur un blob client (miaou__js__eval, lot L) : informatif,
  // pas d'undo (pur compute, aucune écriture d'état). Le code exécuté N'est PAS
  // rendu dans le thread (brief §3 : la doctrine no-silent-action vise les
  // écritures d'état inférées, pas le compute pur) — il n'est capté que dans
  // l'ack pour l'export (champ `code`, cf. formatToolAcksHtml). La ligne de
  // thread annonce seulement les entrées (résumées par jsEvalHandlesSummary,
  // utils.js — pur et partagé avec l'export) et l'issue.
  js_eval: {
    destination: 'user',
    undo: null,
    icon: ICON_CODE,
    label: m => 'Code exécuté sur ' + jsEvalHandlesSummary(m.inputHandles) +
      (m.ok === false ? ' (refusé)' : (m.outLen != null ? ' → ' + m.outLen + ' car.' : '')),
    renderLabel: (m, el) => {
      const tail = m.ok === false ? ' (refusé)' : (m.outLen != null ? ' → ' + m.outLen + ' car.' : '');
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Code exécuté sur '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + jsEvalHandlesSummary(m.inputHandles) + tail));
        });
      } else {
        el.appendChild(document.createTextNode('Code exécuté sur '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + jsEvalHandlesSummary(m.inputHandles) + tail));
      }
    },
  },
  // Listing d'un document (miaou__docs__list, lot V-1, élargi V-4) : lecture
  // pure, pas d'undo — rien n'est décompressé ni stocké. Pattern de pluriel de
  // files_list. Le verbe et l'unité suivent le FORMAT : « Archive listée … 3
  // membres » pour un zip, « Document listé … 12 pages » pour un PDF. Un ack
  // qui dirait « Archive » sur un PDF apprendrait faux à l'utilisateur — et
  // c'est la seule trace qu'il ait de ce que le modèle a ouvert.
  docs_list: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m => docsListAckHead(m) + ' : ' + (m.resourceName || m.handle || '?') +
      ' — ' + docsListAckCount(m),
    renderLabel: (m, el) => {
      const countText = docsListAckCount(m);
      const name = m.resourceName || m.handle || '?';
      const head = docsListAckHead(m) + ' ';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode(head));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + name + ' — ' + countText));
        });
      } else {
        el.appendChild(document.createTextNode(head));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + name + ' — ' + countText));
      }
    },
  },
  // Lecture paginée (miaou__docs__read, lot V-4). Kind DISTINCT de docs_list :
  // l'utilisateur doit lire « Pages 2-5 lues », pas « Document listé » — ce
  // n'est pas la même opération et la trace est ce qu'il en voit.
  // Sans as_resource, rien n'est stocké (lecture pure) ; avec, la ressource
  // créée est tracée par l'ack resource_stored de _storeBlock, comme
  // docs_extract. Pas d'undo dans les deux cas.
  docs_read: {
    destination: 'user',
    undo: null,
    icon: ICON_LIST,
    label: m => docsReadAckLabel(m),
    renderLabel: (m, el) => {
      const name = m.resourceName || m.handle || '?';
      const head = docsReadAckHead(m) + ' ';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode(head));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + name));
        });
      } else {
        el.appendChild(document.createTextNode(head));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + name));
      }
    },
  },
  // Extraction d'un membre d'archive (miaou__docs__extract, lot V-1) : informatif,
  // pas d'undo (la ressource créée est un artefact de travail, comme un
  // resource__create — l'ack resource_stored de _storeBlock la trace déjà). Un
  // refus métier (membre chiffré, trop gros, introuvable) arrive ici avec
  // ok:false → rendu rouge par ackIsError, alors que le result modèle reste un
  // texte non-isError : l'échec n'existe QUE dans l'ack (même posture que js_eval).
  docs_extract: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Membre extrait : ' + (m.path || '?') +
      (m.ok === false ? ' (refusé)' : (m.size != null ? ' — ' + humanSize(m.size) : '')),
    renderLabel: (m, el) => {
      const tail = m.ok === false ? ' (refusé)' : (m.size != null ? ' — ' + humanSize(m.size) : '');
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Membre extrait '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + (m.path || '?') + tail));
        });
      } else {
        el.appendChild(document.createTextNode('Membre extrait '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + (m.path || '?') + tail));
      }
    },
  },
  // Création d'archive (miaou__docs__pack, lot V-2) : même posture que
  // docs_extract — informatif, pas d'undo, et un refus métier (plan vide,
  // doublon, cap, nom non sûr) arrive avec ok:false → rouge par ackIsError,
  // alors que le result modèle reste un texte non-isError.
  // ICÔNE : ICON_PACKAGE, déjà la métaphore de « des octets deviennent une
  // ressource » (resource_stored, docs_extract, file_promote) — docs__pack en
  // est le cas exact, aucune métaphore à inventer.
  // Le BOUTON DE TÉLÉCHARGEMENT du zip n'est PAS ici : il vient de l'ack
  // resource_stored que _storeBlock pousse en plus (ackDownloadTarget →
  // .ack-dl). Deux acks par appel réussi, comme docs__extract.
  docs_pack: {
    destination: 'user',
    undo: null,
    icon: ICON_PACKAGE,
    label: m => 'Archive créée : ' + (m.resourceName || '?') +
      (m.ok === false ? ' (refusée)'
        : ' — ' + (m.count === 1 ? '1 membre' : (m.count != null ? m.count : '?') + ' membres') +
          (m.size != null ? ', ' + humanSize(m.size) : '')),
    renderLabel: (m, el) => {
      const tail = m.ok === false ? ' (refusée)'
        : ' — ' + (m.count === 1 ? '1 membre' : (m.count != null ? m.count : '?') + ' membres') +
          (m.size != null ? ', ' + humanSize(m.size) : '');
      const name = m.resourceName || '?';
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, null, detail => {
          detail.appendChild(document.createTextNode('Archive créée '));
          appendAckSep(detail);
          detail.appendChild(document.createTextNode(' ' + name + tail));
        });
      } else {
        el.appendChild(document.createTextNode('Archive créée '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + name + tail));
      }
    },
  },
  // Échec d'un outil NATIF (miaou__*) : kind générique, poussé par toolFail()
  // (tools.js) au point de sortie en erreur du handler. Avant ce kind, un handler
  // en échec (« Souvenir introuvable », « Handle manquant »…) retournait sa chaîne
  // sans pousser d'ack : le modèle voyait l'erreur en tool result, mais l'appel
  // était TOTALEMENT invisible dans le fil (pas d'ack blanc — pas d'ack du tout).
  // Toujours en erreur (`error: true`, posé par toolFail) → rendu rouge via
  // ackIsError. Pas d'undo : rien ne s'est produit, il n'y a rien à annuler.
  // Les échecs MCP distants ne passent PAS par ici : ils gardent leur kind
  // mcp_call (avec leur breadcrumb) et sont colorés par `error`.
  tool_failed: {
    destination: 'user',
    undo: null,
    icon: ICON_ALERT,
    label: m => 'Échec : ' + (m.name || 'outil') + (m.message ? ' — ' + m.message : ''),
    renderLabel: (m, el) => {
      const detailText = (m.name || 'outil') + (m.message ? ' — ' + m.message : '');
      // Avec intent : l'intention du modèle en niveau 1 (ce qu'il VOULAIT faire),
      // le nom d'outil + le message d'échec en niveau 2 (pourquoi ça a raté).
      if (m.intent) {
        renderIntentTwoLevel(el, m.intent, detailText);
      } else {
        el.appendChild(document.createTextNode('Échec '));
        appendAckSep(el);
        el.appendChild(document.createTextNode(' ' + detailText));
      }
    },
  },
  // ── Agents (lot X-1) ────────────────────────────────────────────────────
  // Quatre kinds, un par outil agent__*. L'ack est FIGÉ au moment de l'appel
  // (nature d'un ack) : celui du spawn dit « lancé », pas « en cours » — le
  // suivi live d'un agent qui travaille est porté par la pastille du parent
  // (badges, étape 7), pas par cet ack. L'enrichir pour qu'il reflète l'état
  // courant est l'objet de X-3, avec sa spec ; ne pas l'anticiper ici.
  //
  // `title` porte l'`intent` rédigé par le modèle — un agent n'étant jamais
  // titré, c'est le seul libellé disponible. Il est rendu tel quel, JAMAIS
  // normalisé (la casse appartient au modèle).
  // `convId` rend le libellé cliquable : ouvrir le fil de l'agent est un geste
  // de débogage rare mais légitime (décision 8, capacité sans publicité).
  agent_spawn: {
    destination: 'user',
    undo: null,
    icon: ICON_AGENT,
    label: m => 'Agent lancé : « ' + (m.title || 'sans libellé') + ' »',
    renderLabel: (m, el) => renderAgentAckLabel(m, el, 'Agent lancé'),
  },
  agent_status: {
    destination: 'user',
    undo: null,
    icon: ICON_AGENT,
    label: m => 'État d\'agent consulté : « ' + (m.title || 'sans libellé') + ' »',
    renderLabel: (m, el) => renderAgentAckLabel(m, el, 'État d\'agent consulté'),
  },
  agent_result: {
    destination: 'user',
    undo: null,
    icon: ICON_AGENT,
    label: m => 'Résultat d\'agent relu : « ' + (m.title || 'sans libellé') + ' »',
    renderLabel: (m, el) => renderAgentAckLabel(m, el, 'Résultat d\'agent relu'),
  },
  agent_abort: {
    destination: 'user',
    undo: null,
    icon: ICON_AGENT,
    label: m => 'Agent interrompu : « ' + (m.title || 'sans libellé') + ' »',
    renderLabel: (m, el) => renderAgentAckLabel(m, el, 'Agent interrompu'),
  },
};

// Rendu partagé des quatre acks agent (lot X-1) : verbe + libellé cliquable
// vers le fil de l'agent. Une seule formule — quatre copies divergeraient sur
// le point exact (la cliquabilité) qui fait la valeur de l'affordance.
// Même motif que conversation_read, dont il reprend `.ack-conv-link`.
function renderAgentAckLabel(m, el, verb) {
  const text = m.title || 'sans libellé';
  const node = m.convId
    ? Object.assign(document.createElement('a'), {
        className: 'ack-conv-link',
        href: 'javascript:void(0)',
        textContent: text,
        onclick: () => selectConv(m.convId),
      })
    : document.createTextNode(text);
  if (m.intent) {
    renderIntentTwoLevel(el, m.intent, null, detail => {
      detail.appendChild(document.createTextNode(verb + ' '));
      appendAckSep(detail);
      detail.appendChild(document.createTextNode(' '));
      detail.appendChild(node);
    });
  } else {
    el.appendChild(document.createTextNode(verb + ' '));
    appendAckSep(el);
    el.appendChild(document.createTextNode(' « '));
    el.appendChild(node);
    el.appendChild(document.createTextNode(' »'));
  }
}

// Wrapper exposé pour les tests (aucun call-site app — buildToolAck utilise
// spec.label directement) : résout le label depuis ACK_KINDS.
function ackLabel(kind, m) {
  const spec = ACK_KINDS[kind];
  return spec ? spec.label(m) : 'Action effectuée';
}

// Téléchargement de la ressource désignée par un ack (lot V). Cible produite
// par `ackDownloadTarget` (utils.js, prédicat unique). Deux résolutions selon
// `by`, jamais fusionnées : une ressource IDB se relit par id — cache session
// d'abord, puis `getResource` (IDB) pour survivre à un cache froid après reload
// — tandis qu'un attachment ne se résout QUE par le cache session
// (getCachedRecordByAttId n'a pas d'équivalent IDB indexé par attId ; le cache
// est peuplé à l'ouverture de la conversation par loadConversationResources).
// Échec = feedback visuel discret sur le bouton, jamais d'alert ni de throw :
// une ressource peut légitimement avoir été évincée ou supprimée.
async function downloadAckResource(target, btn) {
  if (!target || (btn && btn.disabled)) return;
  if (btn) btn.disabled = true;
  try {
    let record = null;
    if (target.by === 'resource') {
      record = (typeof getCachedRecord === 'function' && getCachedRecord(target.id)) || null;
      if (!record) { try { record = await getResource(target.id); } catch (e) { record = null; } }
    } else if (target.by === 'attachment') {
      record = (typeof getCachedRecordByAttId === 'function'
        ? getCachedRecordByAttId(target.attId, target.convId) : null);
    }
    if (!record || !record.data) { markAckDlUnavailable(btn); return; }
    // Nom au mieux : celui du record (figé au stockage) prioritaire sur celui de
    // l'ack (copie, potentiellement plus ancienne), extension dérivée du mime.
    downloadFile(
      resourceDownloadName(record.name || target.name, record.mime || target.mime),
      record.data, record.mime || 'application/octet-stream');
  } finally {
    if (btn && !btn.classList.contains('unavailable')) btn.disabled = false;
  }
}

// Feedback d'indisponibilité : le bouton reste en place (l'ack, lui, est
// toujours vrai — la ressource A été enregistrée) mais devient inerte et le dit
// au survol. Pas de retrait du DOM : ferait disparaître une affordance sous le
// curseur, et le record peut redevenir disponible après réouverture de la conv.
function markAckDlUnavailable(btn) {
  if (!btn) return;
  btn.classList.add('unavailable');
  btn.disabled = true;
  btn.title = 'Ressource non disponible';
}

// Bouton loupe d'un ack. Extrait de `buildToolAck` (lot Z-2) parce qu'il a un
// SECOND site d'appel : la rétro-application au DOM quand l'ack a été peint
// AVANT d'être enrichi (cf. `refreshAckInspectAffordance`). Le dupliquer ferait
// diverger la classe, le titre, l'icône ou — plus grave — le stopPropagation.
//
// Le listener est posé SUR LE NŒUD, jamais en délégation au niveau du groupe :
// en mode compact un seul .tool-ack est dans le DOM, les autres sont DÉTACHÉS
// et ne vivent que comme valeurs de `ackNodeOf` (WeakMap). Une délégation ne
// verrait jamais les acks masqués — c'est-à-dire précisément les appels
// intermédiaires d'un enchaînement, le cas d'usage qui a motivé le lot. Les
// nœuds détachés survivent intacts, listeners compris.
//
// La closure capture l'ENTRÉE elle-même, jamais `m.id` : cet id n'est pas
// unique (un create et un delete du même souvenir le partagent). Elle capture
// la RÉFÉRENCE, donc un enrichissement ultérieur par `Object.assign` sur cette
// même entrée est vu par l'inspecteur à l'ouverture — c'est ce qui rend la
// rétro-application correcte sans re-poser de listener.
// Comme `.ack-dl`, ce bouton est délibérément ABSENT des exports (piège 21) :
// _formatToolCallHtml construit son markup indépendamment et ne l'émet pas.
function _appendAckInspectBtn(wrap, m) {
  const insp = document.createElement('button');
  insp.className = 'ack-inspect';
  insp.title = 'Inspecter l\'appel';
  insp.innerHTML = ICON_INSPECT;   // SVG statique author-controlled uniquement
  insp.addEventListener('click', ev => {
    // Le bouton est un frère de `.ack-label`, pas un descendant de
    // `.mcp-intent-row` : le listener de groupe (ensureAckGroup) filtre sur
    // cette row et ne verrait pas ce clic. stopPropagation est là comme
    // garde de frontière — pour qu'ajouter demain un écouteur en bulle sur
    // `.ack-panels` ou `.tool-ack` ne fasse pas basculer le groupe au
    // passage, alors que le geste demandé est « inspecter », pas « replier ».
    ev.stopPropagation();
    openToolInspector(m);
  });
  // Ordre des icônes : la loupe vient APRÈS le téléchargement mais AVANT
  // `.ack-undo`/`.ack-resolved`, pour que la colonne d'icônes reste alignée
  // d'un ack à l'autre dans un groupe déplié. En rétro-application le wrap est
  // déjà complet : `appendChild` la mettrait derrière « annuler ». D'où
  // l'insertion AVANT le premier de ces deux-là quand il existe.
  const after = wrap.querySelector('.ack-undo, .ack-resolved');
  if (after) wrap.insertBefore(insp, after);
  else wrap.appendChild(insp);
  return insp;
}

// Fait apparaître la loupe sur un ack DÉJÀ PEINT qui vient d'être enrichi.
// `buildToolAck` décide de l'affordance au moment où l'ack est créé ; or un ack
// MCP est rendu par `onEarlyAcks` AVANT le round-trip réseau, donc avant que
// `onEnrichLastAck` ne pose `args`/`result` — la loupe n'apparaissait qu'après
// avoir quitté et rouvert la conversation (le reload relit l'entrée enrichie).
// Idempotente : ne repose rien si le bouton est déjà là. Sans effet si le nœud
// est absent (génération détachée : l'entrée est enrichie quand même, et le
// rendu à l'attache lira le prédicat à jour).
function refreshAckInspectAffordance(node, entry) {
  if (!node || !entry) return;
  if (!ackHasInspectableDetail(entry)) return;
  if (node.querySelector('.ack-inspect')) return;
  _appendAckInspectBtn(node, entry);
}

// Lien « Autoriser » d'un ack portant un refus d'autorisation (campagne AB).
//
// S'écarte du gabarit icône-seule de `.ack-dl`/`.ack-inspect`, et c'est
// délibéré : ces deux-là agissent SUR l'ack (télécharger sa ressource,
// inspecter son détail) et se lisent d'un pictogramme. Ici l'action est
// SORTANTE — elle quitte MIAOU pour un tiers — et l'utilisateur doit lire vers
// où il part avant de cliquer. Une icône seule ne peut pas porter cette
// information ; l'origine en clair, si.
//
// Construction par API DOM, `href` posé par PROPRIÉTÉ : cette URL vient du
// réseau, et la passer par une template string la mettrait sur un chemin
// string→HTML, c'est-à-dire précisément la voie que le piège 21 réserve à
// `formatToolAcksHtml`. Ici il n'y a aucune raison d'en ouvrir une seconde.
//
// `rel="noopener noreferrer"` : `noopener` coupe l'accès à `window.opener`
// depuis la page ouverte ; `noreferrer` évite en plus de lui annoncer d'où
// vient le clic — un serveur d'autorisation légitime n'en a pas besoin, et un
// serveur hostile n'a pas à l'apprendre.
function _appendAckAuthorizeLink(wrap, target) {
  const box = document.createElement('span');
  box.className = 'ack-authorize';

  // La clé précède le libellé : dans une ligne rouge, le mot « Autoriser » seul
  // se noie dans le texte d'erreur, alors que le pictogramme accroche l'œil.
  // Elle est DANS le lien, pas à côté : c'est la même cible de clic, et deux
  // éléments cliquables voisins pour une seule action se manquent au pointeur.
  const icon = document.createElement('span');
  icon.className = 'ack-authorize-icon';
  icon.innerHTML = ICON_KEY;   // SVG statique author-controlled uniquement

  const link = document.createElement('a');
  link.className = 'ack-authorize-link';
  link.appendChild(icon);
  link.href = target.url;              // propriété, jamais interpolation
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  // appendChild, PAS textContent : celui-ci écraserait l'icône insérée juste
  // au-dessus. Nœud texte, donc frontière XSS identique.
  link.appendChild(document.createTextNode('Autoriser'));
  link.title = target.upstream
    ? 'Autoriser l\'accès à ' + target.upstream + ' sur ' + target.origin
    : 'Autoriser l\'accès sur ' + target.origin;
  box.appendChild(link);

  const origin = document.createElement('span');
  origin.className = 'ack-authorize-origin';
  origin.textContent = target.origin;   // textContent : frontière XSS standard
  box.appendChild(origin);

  // Même position que la loupe dans la colonne d'icônes, et pour la même
  // raison : rester alignée d'un ack à l'autre dans un groupe déplié.
  const after = wrap.querySelector('.ack-undo, .ack-resolved');
  if (after) wrap.insertBefore(box, after);
  else wrap.appendChild(box);
  return box;
}

// Fait apparaître le lien sur un ack DÉJÀ PEINT qui vient d'être enrichi —
// même différé que `refreshAckInspectAffordance`, et pour la même cause : un
// ack MCP est peint par `onEarlyAcks` AVANT le round-trip, donc avant que le
// refus n'existe. Idempotente ; sans effet si le nœud est absent (génération
// détachée — l'entrée est mutée quand même, le rendu à l'attache lira le
// prédicat à jour).
// URL configurée du serveur MCP d'où vient un ack, ou `null`. Impure (elle lit
// le stockage), donc hors d'`ackAuthorizationTarget`, qui doit rester pure et
// testable — et ses DEUX appelants passent par ici plutôt que de recomposer le
// lookup, sans quoi un ack rendrait un lien là où l'autre n'en rendrait pas.
//
// Résolu à l'AFFICHAGE, jamais figé sur l'ack : c'est la config du moment qui
// dit comment on joint le serveur aujourd'hui, et un ack relu dans six mois doit
// pointer là où l'utilisateur a mis son proxy depuis, pas là où il était.
function _ackMcpServerUrl(entry) {
  if (!entry || !entry.mcpServer) return null;
  const srv = getMcpServer(entry.mcpServer);
  return (srv && srv.url) || null;
}

function refreshAckAuthorizationAffordance(node, entry) {
  if (!node || !entry) return;
  const target = ackAuthorizationTarget(entry, _ackMcpServerUrl(entry));
  if (!target) return;
  if (node.querySelector('.ack-authorize')) return;
  _appendAckAuthorizeLink(node, target);
}

function buildToolAck(m) {
  const kind = ackKindOf(m);
  const spec = ACK_KINDS[kind] || { undo: null, icon: '', label: () => 'Action effectuée' };

  const wrap = document.createElement('div');
  wrap.className = 'tool-ack ack-' + (kind || 'unknown') +
    (m.resolved ? ' resolved' : '') +
    (ackIsError(m) ? ' ack-error' : '') +
    (m.intent ? ' has-intent' : '');
  if (m.id) wrap.dataset.ackId = m.id;

  if (spec.icon) {
    // `icon` accepte une FONCTION depuis V-8 (comme `label` le fait déjà) : un
    // kind dont deux producteurs méritent deux métaphores l'aiguille sur l'ack
    // (attachment_recalled : rappel vs page rendue). La garde de sécurité est
    // intacte — la fonction CHOISIT parmi les constantes ICON_* de ce fichier,
    // elle n'en fabrique aucune : rien d'origine modèle n'entre jamais ici.
    const svg = (typeof spec.icon === 'function') ? spec.icon(m) : spec.icon;
    if (svg) {
      const iconEl = document.createElement('span');
      iconEl.className = 'ack-icon';
      iconEl.innerHTML = svg;   // SVG statique author-controlled uniquement
      wrap.appendChild(iconEl);
    }
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

  // Téléchargement de la ressource désignée par l'ack (lot V). Placé APRÈS le
  // label et AVANT `undo` : c'est une action sur la cible de l'ack, pas sur
  // l'ack lui-même. Il précède aussi la loupe d'inspection (lot Z) : quand les
  // deux sont là, l'ordre fixe met la loupe en DERNIÈRE position, donc à la
  // même abscisse d'un ack à l'autre — une colonne d'icônes alignée dans un
  // groupe déplié, là où l'ordre inverse la décalait sur les seules lignes
  // porteuses d'un téléchargement. Les trois kinds concernés sont énumérés par
  // `ackDownloadTarget` (utils.js) — prédicat UNIQUE, partagé avec le rendu de
  // la liste de fichiers d'espace ; ne jamais tester `kind` en dur ici.
  // Toujours affiché quand l'ack désigne une ressource : les bytes vivent en
  // IDB, pas dans l'ack, et le cache session peut être froid après un reload —
  // la disponibilité réelle n'est connue qu'au clic (résolution async).
  // Ce bouton est délibérément ABSENT des exports (piège 21) : un HTML
  // standalone n'a ni IDB ni globals MIAOU. Cf. docs/tools.md.
  const dlTarget = ackDownloadTarget(m);
  if (dlTarget) {
    const dl = document.createElement('button');
    dl.className = 'ack-dl';
    dl.title = 'Télécharger';
    dl.innerHTML = ICON_DOWNLOAD;   // SVG statique author-controlled uniquement
    dl.addEventListener('click', () => downloadAckResource(dlTarget, dl));
    wrap.appendChild(dl);
  }
  // Inspection du détail de l'appel (lot Z) : arguments, résultat, code. Gated
  // par le prédicat UNIQUE `ackHasInspectableDetail` (utils.js) — jamais un
  // test de kind ici, même doctrine que `ackDownloadTarget` juste en dessous.
  // Un ack legacy (sans args/result/code) n'affiche pas le bouton : rien à
  // montrer, donc pas d'affordance qui ouvrirait un panneau vide.
  //
  // Le listener est posé SUR LE NŒUD, jamais en délégation au niveau du groupe :
  // en mode compact un seul .tool-ack est dans le DOM, les autres sont DÉTACHÉS
  // et ne vivent que comme valeurs de `ackNodeOf` (WeakMap). Une délégation ne
  // verrait jamais les acks masqués — c'est-à-dire précisément les appels
  // intermédiaires d'un enchaînement, le cas d'usage qui a motivé le lot. Les
  // nœuds détachés survivent intacts, listeners compris.
  //
  // La closure capture l'ENTRÉE elle-même, jamais `m.id` : cet id n'est pas
  // unique (un create et un delete du même souvenir le partagent, cf. plus bas).
  // Comme `.ack-dl`, ce bouton est délibérément ABSENT des exports (piège 21) :
  // _formatToolCallHtml construit son markup indépendamment et ne l'émet pas.
  if (ackHasInspectableDetail(m)) _appendAckInspectBtn(wrap, m);
  // Lien d'autorisation (campagne AB) : gated par le prédicat UNIQUE
  // `ackAuthorizationTarget` (utils.js), jamais un test de kind ni de code ici —
  // même doctrine que ses deux voisines au-dessus. Le prédicat re-valide l'URL
  // À CHAQUE AFFICHAGE, ce qui couvre aussi les acks relus depuis le stockage
  // (ou écrits par une version antérieure) : la garde ne serait pas une garde
  // si elle ne s'appliquait qu'aux acks de la session courante.
  //
  // Comme `.ack-dl` et `.ack-inspect`, ABSENT des exports (piège 21) : un HTML
  // standalone n'a ni la fraîcheur ni le contexte pour qu'un lien d'autorisation
  // y ait un sens, et ce serait un lien externe cliquable dans un fichier qui
  // circule. _formatToolCallHtml construit son markup indépendamment et ne
  // l'émet pas — vérifié, pas supposé (cf. tests d'export).
  const authTarget = ackAuthorizationTarget(m, _ackMcpServerUrl(m));
  if (authTarget) _appendAckAuthorizeLink(wrap, authTarget);
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
  // DOM (renderIntentTwoLevel, self-contained) ; on écoute en bulle sur .ack-panels
  // pour resynchroniser l'état de GROUPE — donc l'héritage à l'ack suivant, ET la
  // valeur que renderAckGroup réapplique au retour en compact (applySlotExpanded)
  // — sans toucher à la signature de renderIntentTwoLevel/buildToolAck.
  //
  // Écouter sur `panels` (parent commun) et non sur `slot` seul : en mode liste
  // le nœud visible vit dans `.ack-list`, donc un toggle fait là-bas ne bullait
  // pas jusqu'ici, `slotExpanded` restait périmé, et le retour en compact
  // écrasait l'expand manuel de l'utilisateur (applySlotExpanded réapplique
  // l'état de groupe, source unique). Le filtre reste le nœud de l'ack VISIBLE :
  // toggler un ack plus ancien dans la liste ne concerne pas le slot compact.
  panels.addEventListener('click', (ev) => {
    if (!ev.target.closest('.mcp-intent-row')) return;
    const visible = ackGroupVisibleAck(group.state);
    const visibleNode = visible && ackNodeOf.get(visible);
    if (!visibleNode || !visibleNode.contains(ev.target)) return;
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
    group.slot.classList.remove('animating');
    group.slot.style.height = '';
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
  // La hauteur du slot est ÉPINGLÉE en px AVANT l'append puis transitionnée
  // vers celle de l'entrant : sans ça, le slot (height auto) mesurerait
  // sortant+entrant pendant l'anim puis retomberait au retrait du sortant —
  // aller-retour de hauteur qui faisait sautiller l'autoscroll collé en bas.
  // Toutes les mesures sont des hauteurs EXTÉRIEURES : .tool-ack porte des
  // marges verticales (non collapsées dans le track flex) qu'offsetHeight
  // ignore — épingler offsetHeight nu faisait perdre 6px au départ puis les
  // reprenait au cleanup (height:'' → auto), wobble inverse du sautillement.
  // Départ = hauteur auto courante du slot ; cible = boîte de marge de
  // l'entrant ; translation = écart d'offsetTop (exact marges comprises,
  // offsetParent = .ack-slot, position:relative).
  const outgoing = prevNode;
  const hStart = group.slot.offsetHeight;
  group.slot.style.height = hStart + 'px';
  group.track.appendChild(node);
  const dist = node.offsetTop - outgoing.offsetTop;
  const mcs = getComputedStyle(node);
  const hEnd = node.offsetHeight + (parseFloat(mcs.marginTop) || 0) + (parseFloat(mcs.marginBottom) || 0);
  group.slot.classList.add('animating');
  group.track.classList.add('animating');
  group.track.style.transform = 'translateY(-' + dist + 'px)';
  group.slot.style.height = hEnd + 'px';
  const onEnd = function() {
    group.track.removeEventListener('transitionend', onEnd);
    if (outgoing.parentNode === group.track) outgoing.remove();
    group.track.classList.remove('animating');
    group.track.style.transform = '';
    group.slot.classList.remove('animating');
    group.slot.style.height = '';
    renderAckGroup(group);   // resync badge/attrs, ne touche plus au track (déjà propre)
  };
  group.track.addEventListener('transitionend', onEnd, { once: true });
}

function placeToolAck(wrap, entry, animate) {
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
  // `ackImageIsDisplayable` (utils.js, pur) est le prédicat PARTAGÉ avec
  // l'export (exportableAckImageKey) : une page de PDF rendue pour le modèle
  // (origin 'docs_render') n'est affichée sur AUCUNE des deux surfaces — l'ack
  // et son bouton de téléchargement suffisent. Jamais un filtre réécrit ici.
  if (kindNow === 'attachment_recalled' && entry.attId && wrap &&
      ackImageIsDisplayable(entry)) {
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
    const wrap = buildMsg(m.role, shown, m.model, m.reasoning, m.ts, m.server, m.truncated, m.attachments, m.agentResult);
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
  reindexThreadDom();   // toutes les bulles viennent d'être (re)construites depuis msgs
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
  // Un agent n'est jamais titré (lot X-1) : offrir « Régénérer le titre » y
  // écrirait un `title` que convLabel préférerait ensuite à l'agentIntent —
  // deux libellés concurrents pour la même conversation, celui des acks et
  // celui de la topbar, qui divergeraient en silence. Même raison que
  // l'éditabilité fermée (setTitleEditableForConv) : les deux voies d'écriture
  // du titre se ferment ensemble, sinon fermer l'une déplace juste le problème.
  const isAgent = isAgentConversation(loadConversation(currentConvId));
  const retitleBtn = document.querySelector('.conv-retitle-btn');
  if (retitleBtn) retitleBtn.hidden = !hasAssistant || isAgent;
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
  reindexThreadDom();   // l'entrée assistant vient d'être poussée (cf. call-sites main.js)
  if (follow) scrollBottom(true);
}

// Finalisation d'un tour en ÉCHEC (400 backend, exception réseau, non-convergence).
// N'existe que pour l'affichage : ce message n'est jamais persisté ni exporté.
// Rendu en texte brut échappé (le message peut porter un JSON multi-ligne, cf.
// erreurs de backend) dans un .msg-error dédié — surtout PAS via renderMd, qui
// mangerait la mise en forme et imposerait un italique. Style : rouge désaturé,
// plus petit, non-italique (chat.css).
function finalizeAssistantError(wrap, msg) {
  cancelStreamRender();
  cancelReasoningRender();
  stopWaiter();
  const follow = isAtBottom();
  const body = wrap.querySelector('.body');
  body.className = 'body msg-error';
  body.textContent = String(msg);
  const copyBtn = wrap.querySelector('.msg-copy');
  if (copyBtn) copyBtn.setAttribute('hidden', '');
  const dlBtn = wrap.querySelector('.msg-dl');
  if (dlBtn) dlBtn.setAttribute('hidden', '');
  syncLastAssistantActions();
  if (follow) scrollBottom(true);
}

// ── Édition d'un message utilisateur ────────────────────────────────────────
// Réindexation autoritaire DOM → currentThread. Chaque bulle `.msg` reçoit
// `data-thread-idx` = l'index RÉEL de son entrée dans currentThread (les
// tool-ack ne produisent pas de `.msg` autonome : ils sont sautés). C'est LA
// source de vérité de l'appariement bulle↔entrée — jamais un recomptage par
// call-site (l'ancien msgIndex appariait « n-ième .msg ↔ n-ième non-ack », qui
// désalignait silencieusement dès qu'un `.msg` DOM et une entrée divergeaient
// en nombre/ordre : édition d'un message qui chargeait la mauvaise entrée). À
// rappeler après toute mutation qui change la correspondance (renderThread,
// ajout live, finalisation, suppression). Garde de divergence : si le nombre de
// `.msg` ne correspond pas au nombre d'entrées non-ack, on le signale (console)
// — un mapping partiel vaut mieux qu'un mapping faux et muet.
function reindexThreadDom() {
  const msgs = $('thread').querySelectorAll('.msg');
  const nonAck = [];
  for (let i = 0; i < currentThread.length; i++) {
    if (!isAckRole(currentThread[i].role)) nonAck.push(i);
  }
  if (msgs.length !== nonAck.length && typeof console !== 'undefined') {
    console.warn('[miaou] reindexThreadDom: ' + msgs.length + ' bulle(s) .msg pour ' +
      nonAck.length + ' entrée(s) non-ack — appariement partiel');
  }
  const n = Math.min(msgs.length, nonAck.length);
  for (let k = 0; k < n; k++) msgs[k].dataset.threadIdx = nonAck[k];
  // Bulles en excès (jamais censé arriver) : pas d'attribut → msgIndex renvoie -1.
  for (let k = n; k < msgs.length; k++) delete msgs[k].dataset.threadIdx;
}

// Traduit une bulle `.msg` en index currentThread. Lit `data-thread-idx` posé
// par reindexThreadDom ; re-réindexe d'abord si l'attribut manque (bulle créée
// après la dernière passe, ou conversation d'avant l'introduction de l'attribut).
function msgIndex(wrap) {
  if (!wrap || !wrap.classList || !wrap.classList.contains('msg')) return -1;
  if (wrap.dataset.threadIdx == null) reindexThreadDom();
  const n = wrap.dataset.threadIdx == null ? -1 : Number(wrap.dataset.threadIdx);
  return Number.isInteger(n) ? n : -1;
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
  // Réponse d'agent : non éditable (cf. buildMsg). Deuxième voie fermée, pas un
  // doublon de la première — le bouton absent ne protège que le clic.
  if (m && m.agentResult) return;
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
// plus permissif que l'injection automatique), ou enfin appartenance à
// `contentHits`. null si requête vide.
//
// `contentHits` (U-3) est l'ensemble des ids dont le CONTENU matche, précalculé
// en async par `collectContentSearchHits` (storage.js) : depuis le passage des
// conversations en IDB, une conversation froide n'a pas ses `messages` en RAM,
// et le scan de contenu ne peut plus se faire ici. Le prédicat reste synchrone —
// c'est ce qui permet à `renderConvList` et à la palette de ne pas changer.
// Argument OMIS = pas de scan de contenu (titre et résumé seulement) ; c'est le
// comportement des appelants qui ne veulent pas payer la lecture, et celui du
// premier rendu avant que la passe async ait rendu la main.
function searchConversations(query, contentHits) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  const qTokens = tokenize(q);
  // Un seul instantané des résumés, capturé par la closure : le prédicat est
  // appelé une fois par conversation, sans relire le cache à chaque appel.
  const summaries = loadSummaries();
  return c => {
    if ((c.title || '').toLowerCase().includes(q)) return true;
    const entry = summaries[c.id];
    if (entry && !entry.suppressed && entry.summary && scoreSummary(qTokens, entry) >= 1) return true;
    return !!(contentHits && contentHits.has(c.id));
  };
}

// Debounce de la recherche (CONV_SEARCH_DEBOUNCE_MS) : le filtre reconstruit
// toute la liste ET joue son animation d'entrée, deux gestes qu'on ne veut pas
// à chaque frappe. Ce qui est temporisé est le RÉSULTAT (filtre + render) ; le
// bouton d'effacement, lui, reflète la présence de texte dans le champ, pas le
// résultat — il reste donc immédiat, sinon il traînerait derrière la frappe.
// Le timer est un état de module annulable : clearConvSearch DOIT l'annuler,
// sans quoi une frappe suivie d'un effacement dans la fenêtre de debounce
// verrait le timer en vol réappliquer l'ancien filtre APRÈS la remise à null.
const CONV_SEARCH_DEBOUNCE_MS = 150;
let _convSearchTimer = null;
// Jeton de séquence de la passe de scan de contenu (U-3). Le scan est async
// (lecture IDB) : deux frappes rapprochées peuvent avoir leurs passes en vol
// simultanément, et rien ne garantit qu'elles rendent la main dans l'ordre.
// Sans jeton, la plus lente écraserait le résultat de la plus récente et la
// liste afficherait le filtre d'une requête abandonnée
// (cf. `project_await_reentrancy_guard`). Même geste que `_openConvSeq`.
let _convSearchSeq = 0;

function cancelConvSearchDebounce() {
  if (_convSearchTimer !== null) { clearTimeout(_convSearchTimer); _convSearchTimer = null; }
  // Invalide aussi toute passe de scan en vol : un effacement du champ ne doit
  // pas voir un filtre réapparaître quand la lecture IDB rend la main.
  _convSearchSeq++;
}

function onConvSearch() {
  const input = $('conv-search');
  $('search-clear').classList.toggle('show', !!input.value);
  cancelConvSearchDebounce();
  _convSearchTimer = setTimeout(async () => {
    _convSearchTimer = null;
    // Relecture du champ DANS le timer, jamais une valeur figée à l'armement :
    // la frappe a pu continuer (doctrine « relire l'état après l'attente »,
    // même esprit que le piège 24).
    const query = $('conv-search').value;
    const seq = ++_convSearchSeq;
    // Premier rendu SANS attendre la lecture IDB : titre et résumé suffisent à
    // remplir la liste immédiatement. Le scan de contenu la complète ensuite.
    // Sans ce rendu intermédiaire, la liste resterait figée sur l'ancien filtre
    // pendant toute la lecture — perceptible sur un gros historique.
    convSearchFilter = searchConversations(query);
    animateNextConvList();
    renderConvList();
    const hits = await collectContentSearchHits(query);
    if (seq !== _convSearchSeq) return;   // requête abandonnée entre-temps
    if (!hits.size) return;               // rien à ajouter : pas de re-rendu
    convSearchFilter = searchConversations(query, hits);
    animateNextConvList();
    renderConvList();
  }, CONV_SEARCH_DEBOUNCE_MS);
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
  cancelConvSearchDebounce();
  convSearchFilter = null;
  animateNextConvList();
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

// Déclenché par l'item du menu Space. Pas de vérification ici sur le
// nombre de Spaces disponibles : renderSpaceMenu masque déjà l'item si
// loadSpaces().length < 2 (aucune destination possible).
// Préselectionne la conversation actuellement affichée (si présente dans le
// Space actif) : geste le plus probable en entrant en mode déplacement.
function enterMoveMode() {
  _moveMode = true;
  // EXCLURE DE LA PRÉSÉLECTION, PUIS GRISER — dans cet ordre (lot X-1).
  // Une conversation dont un agent tourne ne peut pas être déplacée : son
  // enfant resterait dans l'ancien Espace, ce qui est exactement la violation
  // d'herméticité que le piège 18 interdit (un agent orphelin de référentiel).
  // Sans l'exclusion, la conversation affichée — présélectionnée par défaut —
  // apparaîtrait COCHÉE ET GRISÉE : une sélection que l'utilisateur ne peut pas
  // retirer, dans une barre annonçant « 1 conversation » et un bouton qui
  // échouerait. `renderMoveBar` compte `_moveSelection.size`, donc l'ensemble
  // vide y retombe naturellement sur le cas ordinaire « rien de sélectionné ».
  _moveSelection = (currentConvId && !hasWorkingAgent(currentConvId))
    ? new Set([currentConvId]) : new Set();
  renderConvList();
  renderMoveBar();
}

// Sortie du mode, quelle qu'en soit la cause (Cancel, move effectué, envoi
// d'un message). Un seul point de sortie, ré-utilisé partout : évite
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

function convItemEl(c, convs) {
  const el = document.createElement('div');
  el.className = 'conv' + (c.id === currentConvId ? ' active' : '') + (c.pinned ? ' pinned' : '');
  el.onclick = () => selectConv(c.id);
  const checked = _moveSelection.has(c.id) ? ' checked' : '';
  // Case GRISÉE si un agent de cette conversation tourne (lot X-1) :
  // la déplacer laisserait son enfant dans l'ancien Espace — l'agent orphelin
  // de référentiel que le piège 18 interdit. `hasWorkingAgent` est LE prédicat,
  // le même que celui de l'exclusion de présélection (enterMoveMode) et de la
  // pastille : pas un second balayage.
  // Le titre porte la RAISON : une case inerte sans explication se lit comme un
  // bug (« pourquoi je ne peux pas cocher celle-là ? »).
  const agentBusy = hasWorkingAgent(c.id, convs);
  const lockAttrs = agentBusy
    ? ' disabled title="Un agent de cette conversation travaille : elle ne peut pas être déplacée pour l\'instant."'
    : '';
  // convLabel, pas `c.title` nu (lot AA) : c'était la dernière des surfaces de
  // libellé restée hors du prédicat. Elle y gagne l'extrait provisoire — la
  // branche `agentIntent` y est morte par construction (renderConvList filtre
  // sur isRootConversation, un agent n'atteint jamais cette ligne), ce qui ne
  // dispense pas le prédicat de la porter : elle sert aux deux autres surfaces.
  const lbl = convLabel(c);
  const titleCls = 'conv-title' + (lbl.provisional ? ' provisional' : '');
  el.innerHTML =
    `<input type="checkbox" class="conv-select" onclick="event.stopPropagation();toggleConvSelection('${c.id}',this.checked)"${checked}${lockAttrs}>
     <div class="conv-body">
       <div class="${titleCls}">${escHtml(lbl.text || 'Nouvelle conversation')}</div>
       <div class="conv-date" title="${escHtml(formatFullDateFr(c.updatedAt || c.timestamp))}">${escHtml(relativeWhen(c.updatedAt || c.timestamp))}</div>
     </div>
     <div class="conv-actions">
       <button class="conv-pin" title="${c.pinned ? 'Désépingler' : 'Épingler'}" onclick="event.stopPropagation();togglePin('${c.id}')">${PIN_SVG}</button>
       <button class="conv-del" title="Supprimer" onclick="event.stopPropagation();onConvDel(this,'${c.id}')">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
       </button>
     </div>`;
  // Pastille d'activité (lot T-2) posée en DOM plutôt qu'en template string :
  // applyActivityBadge est LE seul point d'écriture, partagé par les quatre
  // surfaces — concaténer des classes ici ferait un deuxième chemin, qui
  // dériverait. renderConvList reconstruit tout à chaque appel, aucun état DOM
  // à préserver (piège 11 : la fonction reste sans argument, elle dérive l'état
  // du registre elle-même).
  el.insertBefore(activityBadgeEl(convBadgeState(c.id, convs)), el.querySelector('.conv-actions'));
  return el;
}

function sectionEl(label) {
  const s = document.createElement('div');
  s.className = 'conv-section';
  s.textContent = label;
  return s;
}

// Animation d'entrée de la liste (opt-in explicite, one-shot). renderConvList
// est appelée très souvent pour des raisons qui ne changent PAS le contenu
// visible de la liste (titrage async, pastille d'activité, épinglage, mode
// sélection) : animer à chaque appel ferait clignoter la sidebar en permanence.
// Seuls les gestes qui remplacent réellement le jeu d'items arment le flag
// (bascule de Space, recherche). Il est consommé — et remis à false — par le
// render suivant, quel qu'il soit : un flag armé ne peut pas survivre pour être
// joué au mauvais moment. L'anim elle-même est du CSS pur (.conv-list.enter),
// donc déjà neutralisée par le kill-switch reduced-motion (base.css) sans gate
// JS supplémentaire.
const CONV_ENTER_STAGGER_MAX = 12;
let _convListAnim = false;

function animateNextConvList() { _convListAnim = true; }

function renderConvList() {
  const list = $('conv-list');
  const animate = _convListAnim;
  _convListAnim = false;
  list.classList.remove('enter');
  list.innerHTML = '';
  list.classList.toggle('select-mode', _moveMode);
  // Deux filtres qui COMPOSENT, jamais un prédicat qui répond aux deux questions
  // (piège 18) : l'appartenance au Space actif, et « est-ce une racine ? ».
  // L'exclusion des agents (lot X-1, exclusion 3 de 3ter) est ORTHOGONALE à
  // l'herméticité — les mélanger donnerait le prédicat à double sens que le
  // piège 18 interdit. La recherche (convSearchFilter, plein texte comprise)
  // s'applique ensuite : elle ne peut donc jamais ramener un agent.
  // `everyConv` porte AUSSI les agents : c'est la liste que convBadgeState
  // propage à hasWorkingAgent pour retrouver les enfants d'un parent. La liste
  // affichée (`all`), elle, en est expurgée — passer `all` ferait chercher les
  // enfants dans une liste dont ils sont exclus par construction, et aucun
  // parent ne porterait jamais la pastille de son agent.
  const everyConv = listAllConversations();
  const all = everyConv.filter(c => c.spaceId === activeSpaceId && isRootConversation(c));
  $('conv-search').disabled = all.length === 0;
  let convs = all;
  if (convSearchFilter) convs = convs.filter(convSearchFilter);

  // Section « Épinglé » en tête (au singulier, choix assumé), si au moins une.
  const pinned = convs.filter(c => c.pinned);
  if (pinned.length) {
    list.appendChild(sectionEl('Épinglé'));
    for (const c of pinned) list.appendChild(convItemEl(c, everyConv));
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
    list.appendChild(convItemEl(c, everyConv));
  }

  if (animate) {
    // `--i` porte le rang pour l'échelonnement, plafonné (ANIM_STAGGER_MAX) :
    // sans plafond, une liste de 200 conversations donnerait plusieurs secondes
    // de cascade — au-delà du plafond tout le reste démarre ensemble, et comme
    // ces items sont hors écran, la coupure ne se voit pas.
    const items = list.children;
    for (let i = 0; i < items.length; i++) {
      items[i].style.setProperty('--i', Math.min(i, CONV_ENTER_STAGGER_MAX));
    }
    // Reflow forcé avant la pose de la classe : sans lui, le navigateur peut
    // regrouper le remove/add du même frame et l'animation ne rejouerait pas
    // sur deux renders animés consécutifs (deux recherches à la suite).
    void list.offsetWidth;
    list.classList.add('enter');
  }
}

// Barre contextuelle de destination : n'apparaît qu'à ≥1 conversation cochée, en mode
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
  const destinations = sortedSpacesByName(loadSpaces()).filter(s => s.id !== activeSpaceId).map(s => ({ value: s.id, label: s.name || '' }));
  let pill = null;
  if (destinations.length) {
    pill = cfgPillSelect('move-bar-dest', destinations, destinations[0].value, null);
    row.appendChild(pill.root);
  }

  // Groupés pour que les deux boutons restent solidaires face à la pilule de
  // destination : le groupe est en flex-shrink: 0, c'est la pilule qui absorbe
  // le manque de place en tronquant (la barre ne passe jamais à la ligne).
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

// ── Largeur de la colonne centrale (thread + composer) ──────────────────────
// Trois crans multiplicateurs appliqués à la largeur de lecture d'origine, que
// le CSS porte comme --col. Le cran 0 EST la largeur historique : c'est le
// plancher, jamais un réglage « réduit » — d'où un « – » désactivé au repos
// plutôt qu'un cran plus étroit qui n'a jamais existé.
// Le pas est stocké en INDEX, pas en pixels : le jour où la largeur de base
// bouge dans base.css, les crans suivent sans migration de réglage — un
// sidebarWidth en pixels, lui, resterait figé sur l'ancienne base.
const COL_WIDTH_STEPS = [1, 1.25, 1.5];
const COL_WIDTH_FALLBACK_BASE = 720;   // filet si --col est illisible (jamais en usage nominal)

// La largeur de base est LUE sur :root, jamais recopiée : base.css en est la
// seule source. On la lit avant toute surcharge et on la mémorise — surcharger
// --col sur #app la rendrait ensuite indistinguable de la base au prochain
// appel, et chaque cran se multiplierait par le précédent.
let _colWidthBase = 0;
function colWidthBase() {
  if (!_colWidthBase) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--col'));
    _colWidthBase = Number.isFinite(v) && v > 0 ? v : COL_WIDTH_FALLBACK_BASE;
  }
  return _colWidthBase;
}

// Pur : borne un index de cran, quelle que soit la saleté du réglage persisté
// (chaîne, négatif, cran retiré depuis). Number.isFinite et non `||` : 0 est
// l'index NOMINAL ici, un `||` le remplacerait silencieusement par le défaut.
function clampColWidthStep(step, count) {
  const n = (typeof count === 'number' && count > 0) ? count : COL_WIDTH_STEPS.length;
  const i = Math.round(Number(step));
  if (!Number.isFinite(i)) return 0;
  return Math.max(0, Math.min(n - 1, i));
}

let _colWidthStep = 0;

// Applique le cran : surcharge --col sur #app (et non :root) pour rester
// homogène avec --sidebar-w, et pour que l'export — qui lit des tokens sur
// :root — ne voie jamais cette largeur d'écran (cf. THEME_TOKENS, --col exclu).
function applyColWidth(step) {
  _colWidthStep = clampColWidthStep(step);
  const app = $('app');
  if (app) app.style.setProperty('--col', Math.round(colWidthBase() * COL_WIDTH_STEPS[_colWidthStep]) + 'px');
  syncColWidthUI();
  return _colWidthStep;
}

// Les deux boutons sont désactivés en butée : le contrôle dit alors de
// lui-même où on se trouve dans la course, sans compteur ni libellé.
function syncColWidthUI() {
  const dec = $('col-width-dec'), inc = $('col-width-inc');
  if (dec) dec.disabled = _colWidthStep <= 0;
  if (inc) inc.disabled = _colWidthStep >= COL_WIDTH_STEPS.length - 1;
}

function nudgeColWidth(delta) {
  const next = clampColWidthStep(_colWidthStep + delta);
  if (next === _colWidthStep) return;   // butée : rien à persister ni à diffuser
  applyColWidth(next);
  saveSettings({ colWidth: next });   // persistance immédiate, modèle selectTheme
}

// `label` : soit une chaîne (titre définitif — applyGeneratedTitle), soit
// l'objet {text, provisional} de convLabel (lot AA). Les deux formes sont
// admises parce que les deux appelants ont des besoins différents : un titrage
// qui vient d'aboutir SAIT qu'il n'est pas provisoire, l'ouverture d'une
// conversation doit le demander au prédicat.
function setTitle(label) {
  const o = (label && typeof label === 'object') ? label : { text: label || '', provisional: false };
  const el = $('conv-title');
  el.textContent = o.text || '';
  el.classList.toggle('provisional', !!o.provisional);
  // L'onglet reçoit l'extrait BRUT, sans marque de provisoire : il n'a pas
  // d'italique, et distinguer les conversations entre plusieurs onglets prime
  // sur signaler le statut du titre.
  document.title = (o.text || 'Nouvelle conversation') + ' — MIAOU';
}

// Éditabilité DURABLE du titre, gouvernée par la nature de la conversation
// (lot X-1) : un agent n'est jamais renommé à la main. À ne pas confondre avec
// setTitleEditable (main.js), verrou TRANSITOIRE le temps d'un titrage async —
// les deux écrivent sur le même attribut, mais celui-ci est reposé à chaque
// ouverture de conversation, donc il gagne au switch, ce qui est le bon ordre :
// un agent n'est de toute façon jamais titré, donc jamais verrouillé par
// l'autre chemin.
function setTitleEditableForConv(conv) {
  const el = $('conv-title');
  if (!el) return;
  el.contentEditable = isAgentConversation(conv) ? 'false' : 'true';
}

// Bandeau de parenté d'agent : la voie de RETOUR vers la conversation qui a
// lancé l'agent (l'aller étant les acks agent__*, renderAgentAckLabel).
// Masqué sur toute conversation racine — c'est-à-dire presque toujours.
//
// Le parent est relu à CHAQUE appel plutôt que mémorisé : il peut avoir été
// renommé (ou supprimé) depuis le spawn. S'il a disparu, on affiche quand même
// le bandeau, sans lien : l'information « ceci est un agent » reste vraie et
// utile, et un lien mort serait pire qu'une absence de lien.
function syncAgentBanner(conv) {
  const el = $('agent-banner');
  if (!el) return;
  // Le bouton de topbar est piloté depuis ICI, par le MÊME appel et le MÊME
  // parent relu (lot X-1c) : deux surfaces qui répondent à la même question
  // (« d'où vient ce fil, et où revient-on ? ») ne doivent pas dériver leur
  // réponse de deux formules — c'est la discipline de `convLabel` et de
  // `spaceConvIds`. En particulier, un parent supprimé doit fermer les DEUX
  // affordances, sinon le bouton mènerait à une conversation inexistante
  // pendant que le bandeau dit « conversation supprimée ».
  const btn = document.querySelector('.conv-parent-btn');
  if (!isAgentConversation(conv)) {
    el.classList.remove('show');
    if (btn) { btn.hidden = true; btn.onclick = null; }
    return;
  }
  const link = $('agent-banner-link');
  // Statut (X-1e) : le bandeau explique pourquoi le composer est fermé quand
  // l'agent a fini. Sans lui, la lecture seule serait un composer grisé sans
  // cause lisible — l'utilisateur croirait à une panne. `running` ne s'affiche
  // pas : un agent au travail a son composer ouvert, il n'y a rien à expliquer,
  // et la pastille d'activité le dit déjà.
  const statusEl = $('agent-banner-status');
  if (statusEl) {
    const st = agentStatus(conv.id);
    const label = (st !== 'running' && AGENT_STATUS_UI_LABELS[st]) || '';
    statusEl.textContent = label ? ' — ' + label : '';
  }
  const parent = loadConversation(conv.parentConvId);
  if (parent) {
    // `.text` seul : le bandeau n'italise pas le provisoire — le libellé du
    // parent y est une information d'orientation, pas un titre en attente, et
    // le `title` d'attribut qui en dérive est du texte brut.
    const label = convLabel(parent).text || 'Nouvelle conversation';
    link.textContent = label;
    link.onclick = () => selectConv(parent.id, true);
    link.style.pointerEvents = '';
    if (btn) {
      btn.hidden = false;
      // `title` porte le NOM du parent : le bouton est une icône seule, et le
      // bandeau qui porte ce nom en clair défile hors de vue dès qu'on descend
      // dans le fil. Sans lui, l'affordance permanente serait muette sur sa
      // destination.
      btn.title = 'Retour à « ' + label + ' »';
      btn.setAttribute('aria-label', btn.title);
      // Cible relue à CHAQUE appel, jamais figée : un agent peut être réouvert
      // après que son parent a été renommé, et syncAgentBanner est rappelée à
      // chaque ouverture de conversation.
      btn.onclick = () => selectConv(parent.id, true);
    }
  } else {
    link.textContent = 'conversation supprimée';
    link.onclick = null;
    link.style.pointerEvents = 'none';
    // Parent supprimé : le bouton disparaît plutôt que de rester inerte. Une
    // affordance permanente qui ne fait rien au clic est pire qu'absente ; le
    // bandeau, lui, reste pour EXPLIQUER pourquoi (il porte le texte).
    if (btn) { btn.hidden = true; btn.onclick = null; }
  }
  el.classList.add('show');
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

// `stopping` (optionnel) : la génération qu'on affiche (s'il y en a une) a
// déjà reçu un Stop pas encore honoré (gen.stopRequested, cf. main.js). ui.js
// ne lit pas le registre de générations lui-même (pas de dépendance inverse
// vers main.js) : c'est à l'appelant de le porter. Absent/false → pas d'attente
// en cours, comportement historique.
function setSending(on, stopping) {
  sending = on;
  setComposerStreaming(on);
  const send = $('send-btn');
  // Pendant l'envoi le bouton devient « stop » (cliquable) ; sinon il dépend du
  // seul état configuré. Une confirmation en attente NE bloque pas l'envoi : la
  // saisie libre vaut réponse/correction et lève le widget (dismiss-on-send).
  if (send) send.disabled = on ? false : !configured;
  // APRÈS la ligne ci-dessus : un stop différé rebranché (retour sur une
  // conversation dont gen.stopRequested est déjà vrai) doit garder le bouton
  // désactivé — setStopping doit avoir le dernier mot sur `disabled`, sinon la
  // ligne ci-dessus le réactive juste après l'avoir désactivé.
  setStopping(on && !!stopping);
  // Export de conversation masqué pendant le streaming (contenu incomplet).
  const convDl = document.querySelector('.conv-dl-btn');
  if (convDl) convDl.disabled = on;
  const retitleBtn = document.querySelector('.conv-retitle-btn');
  if (retitleBtn) retitleBtn.disabled = on;
  syncLastAssistantActions();   // le bouton régénérer disparaît pendant un stream
  // Readonly relay (lot J) : PLUS piloté ici depuis T-1a. `sending` n'est
  // qu'un reflet de l'écran (« la conv AFFICHÉE génère-t-elle ? ») et change
  // aussi sur un simple changement de conversation — il ne peut donc plus
  // servir de point d'appariement -started/-ended. Le relais suit désormais le
  // cycle de vie de la génération (registerGeneration/unregisterGeneration,
  // main.js), qui reste un point de fin unique par conversation.
  // Le drain des actions de synchro différées (lot J) n'est PLUS déclenché
  // ici depuis T-1a : setSending change aussi sur un simple changement de
  // conversation, ce qui drainerait alors qu'une génération mute encore un
  // thread. Il suit désormais la fin d'une génération (unregisterGeneration).
}

// Readonly cross-onglets (lot J) : un pair génère sur la conv affichée →
// verrouiller les entrées et mutations LOCALES (composer, édition, suppression,
// régénération) pour empêcher une seconde génération concurrente silencieuse.
// Lecture + scroll restent permis. Piloté par une classe sur <body>
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
    // Menus de modèle/raisonnement DÉJÀ ouverts quand le verrou tombe (X-1f) :
    // le cas arrive pour de bon — on regarde un agent finir, menu déployé. La
    // garde d'ouverture ne les concerne plus une fois ouverts ; sans cette
    // fermeture ils resteraient déployés et cliquables au-dessus d'un composer
    // mort. Le rail d'interjections est re-rendu pour la même raison : sa
    // légende et ses affordances dépendent du verrou.
    for (const id of ['composer-model-menu', 'composer-reasoning-menu']) {
      const m = $(id);
      if (m) m.classList.remove('show');
    }
  } else {
    // Ne pas ré-activer si une génération LOCALE est en cours (le composer sert
    // alors de « stop ») ni si l'app n'est pas configurée. Ni si un stop est en
    // attente (_stopping) : sinon ce chemin (ex. openConversation →
    // applyReadonlyState, APRÈS setSending) réactive le bouton juste après que
    // setStopping l'ait désactivé — même bug que celui corrigé dans setSending,
    // trouvé ici par la vérif bout-en-bout (verify-stop-deferred.mjs).
    if (ta) ta.disabled = sending ? false : !configured;
    if (send) send.disabled = _stopping ? true : (sending ? false : !configured);
  }
}

// Lecture du verrou, pour les appelants qui doivent REFUSER une action plutôt
// que la tenter sur un composer inerte (X-1f : l'édition d'une puce
// d'interjection reflue vers la textarea — verrouillée, elle détruirait la puce
// en échange d'un texte non modifiable). `_convReadonly` reste privé : un seul
// écrivain (setConvReadonly), des lecteurs par cette fonction.
function isComposerReadonly() {
  return _convReadonly;
}

// Bascule l'apparence du bouton du composer entre « envoyer » et « stop ».
function setComposerStreaming(on) {
  const send = $('send-btn');
  if (!send) return;
  send.classList.toggle('streaming', on);
  send.title = on ? 'Arrêter' : 'Envoyer';
  // Mode file (lot Q) : le placeholder annonce la mise en file pendant la
  // génération — l'affordance principale du mécanisme, avec le rail de puces.
  const ta = $('composer-text');
  if (ta) ta.placeholder = on ? 'Le modèle travaille — Entrée ajoute à la file…' : 'Message…';
}

// Stop cliqué pendant un tour d'outils (gen.abort momentanément null, cf.
// abortStream/main.js) : l'arrêt est pris en compte mais différé jusqu'à la
// frontière de tour suivante. Le bouton se désactive et change d'apparence —
// pas seulement de title — pour qu'un second clic soit IMPOSSIBLE plutôt que
// simplement sans effet (l'utilisateur ne doit pas pouvoir croire qu'il n'a
// pas cliqué assez fort). Levé par setSending(false) (fin de génération) ou
// par le rebranchement d'écran sur une génération qui a déjà fini d'honorer
// la demande. `_stopping` (variable de module, même statut que `sending`/
// `_convReadonly`) est consultée par tout autre chemin qui recalcule
// `send.disabled` après coup (setConvReadonly) — sans elle, ce chemin
// réactiverait le bouton juste après que setStopping l'ait désactivé.
let _stopping = false;
function setStopping(on) {
  _stopping = !!on;
  const send = $('send-btn');
  if (!send) return;
  send.classList.toggle('stopping', on);
  if (on) {
    send.disabled = true;
    send.title = 'Arrêt en cours…';
  } else if (send.classList.contains('streaming')) {
    send.disabled = false;
    send.title = 'Arrêter';
  }
}
function setConnDot(state) {
  const dot = $('conn-dot');
  if (dot) dot.className = 'dot ' + (state || '');
}

// Active ou désactive l'état « confirmation en attente ». Le composer reste
// ÉDITABLE (brief §4.5 : la saisie libre vaut réponse/correction) : on se borne
// à poser l'overlay qui dim l'arrière-plan et la classe .confirming qui élève
// composer + carte au-dessus du dim (effet spotlight, clic possible). Posé/
// retiré par showConfirmation (primitif de confirmation).
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
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    // Mode file (lot Q) : pendant une génération, Entrée met la saisie en file
    // d'interjection (drainée à la frontière de tour, cf. main.js) — jamais
    // d'envoi direct concurrent. Le bouton du composer reste le stop
    // (onSendBtn inchangé).
    if (sending) enqueueInterjection();
    else sendMessage();
  }
}

// ── Rail d'interjections (lot Q, clefé par conversation depuis X-1e) ─────────
// Rendu DOM du rail des messages en file pendant une génération. L'état vit
// dans main.js (_pendingInterjections, Map<convId, items[]>) ; ces fonctions ne
// font que refléter/animer. SVG statiques author-controlled (innerHTML sûr) ;
// le texte des puces passe par textContent (frontière XSS). Câblage des clics :
// editInterjection/cancelInterjection (main.js), retrouvés par l'id en dataset.
//
// Le rail montre la file de la conversation AFFICHÉE, et elle seule — c'est la
// réponse visible à « qui va recevoir ça ? ». Appelé à chaque changement de
// conversation (openConversation/resetToEmpty) : sans cet appel, les puces
// d'un fil restaient à l'écran sur le suivant, sur une conversation qui ne
// générait pas et n'avait aucun drain à venir (constat de test X-1).
function renderInterjectionRail() {
  const rail = $('ij-rail');
  const chips = $('ij-chips');
  if (!rail || !chips) return;
  const items = (typeof interjectionsFor === 'function') ? interjectionsFor(currentConvId) : [];
  rail.hidden = items.length === 0;
  // Lecture seule (X-1f) : la file d'un agent qui a fini son travail avant le
  // drain reste là, sans destinataire. Le rail SURVIT — c'est ce qui empêche le
  // texte de disparaître sans que l'utilisateur le voie — mais il cesse de
  // promettre un point d'étape qui ne viendra pas, et l'édition n'est plus
  // offerte (le composer où elle refluerait est verrouillé, cf.
  // editInterjection). Restent lire, copier, annuler.
  const ro = isComposerReadonly();
  rail.classList.toggle('ij-rail-stranded', ro);
  const cap = $('ij-caption-text');
  if (cap) {
    if (ro) {
      cap.textContent = items.length <= 1
        ? 'jamais transmise — la conversation s’est terminée avant'
        : items.length + ' interjections jamais transmises — la conversation s’est terminée avant';
    } else {
      cap.textContent = items.length <= 1
        ? 'sera transmise au prochain point d’étape'
        : items.length + ' interjections, fusionnées et transmises au prochain point d’étape';
    }
  }
  // Purge des puces qui ne sont plus dans la file rendue — d'abord, avant tout
  // ajout. La réconciliation d'origine n'ajoutait que les manquantes : avec une
  // file par conversation, celles du fil précédent s'accumuleraient sans que
  // rien ne les retire (elles n'ont pas d'animation de sortie à jouer, elles
  // changent simplement de destinataire). Retrait SEC, pas dismissInterjectionChip :
  // ces puces ne partent pas, elles cessent d'être à l'écran.
  const keep = new Set(items.map(it => it.id));
  for (const el of Array.from(chips.children)) {
    if (!keep.has(el.dataset.ijId)) el.remove();
  }
  // Réconciliation minimale : n'ajoute que les puces manquantes (par id), pour
  // ne pas rejouer l'animation d'entrée des puces déjà présentes à chaque appel.
  const present = new Set(Array.from(chips.children).map(c => c.dataset.ijId));
  for (const item of items) {
    if (present.has(item.id)) continue;
    chips.appendChild(buildInterjectionChip(item));
  }
}

function buildInterjectionChip(item) {
  const el = document.createElement('div');
  el.className = 'ij-chip';
  el.dataset.ijId = item.id;
  el.innerHTML =
    '<span class="ij-glyph"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 20l1.1-4.1a8.3 8.3 0 0 1-1-4A8.4 8.4 0 0 1 12 3.5a8.4 8.4 0 0 1 9 8z"/><path d="M12 8v4l2.5 1.5"/></svg></span>' +
    '<span class="ij-text"></span>' +
    '<span class="ij-hint">cliquer pour éditer</span>' +
    '<button class="ij-copy" title="Copier" aria-label="Copier cette interjection"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg></button>' +
    '<button class="ij-x" title="Annuler" aria-label="Annuler cette interjection"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
  el.querySelector('.ij-text').textContent = item.literal;
  // Copie : la seule voie de récupération quand l'édition est fermée (composer
  // verrouillé d'un agent terminé). Offerte en permanence — un texte tapé se
  // récupère aussi quand tout va bien.
  el.querySelector('.ij-copy').addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.classList.contains('ij-draining')) return;
    const btn = e.currentTarget;
    const svgCopy = btn.innerHTML;
    navigator.clipboard.writeText(item.literal).then(() => {
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => { btn.innerHTML = svgCopy; }, 1400);
    });
  });
  el.querySelector('.ij-x').addEventListener('click', (e) => {
    e.stopPropagation();
    if (el.classList.contains('ij-draining')) return;   // en vol de drain : figée
    cancelInterjection(item.id);
  });
  el.addEventListener('click', () => {
    if (el.classList.contains('ij-draining')) return;
    editInterjection(item.id);
  });
  return el;
}

// Fige les puces d'un batch en cours de drain (état non interactif) : pendant
// dans le splice synchrone de takePendingInterjections, AVANT tout await —
// l'invariant de réentrance rendu visible.
function markInterjectionChipsDraining(ids) {
  const chips = $('ij-chips');
  if (!chips) return;
  for (const id of ids) {
    const el = chips.querySelector('[data-ij-id="' + CSS.escape(id) + '"]');
    if (el) el.classList.add('ij-draining');
  }
}

// Retire une puce du DOM avec l'animation de sortie choisie : 'up' (décollage
// vers le fil, drain réussi) ou 'down' (plongée vers le composer, annulation/
// édition/reflux). Idempotent : puce déjà partie = no-op. Nettoie le rail si
// vide après la transition.
function dismissInterjectionChip(id, dir) {
  const chips = $('ij-chips');
  if (!chips) return;
  const el = chips.querySelector('[data-ij-id="' + CSS.escape(id) + '"]');
  if (!el) return;
  el.classList.add(dir === 'up' ? 'ij-away' : 'ij-down');
  const remove = () => {
    el.remove();
    if (!chips.children.length) { const rail = $('ij-rail'); if (rail) rail.hidden = true; }
  };
  if (motionReduced()) { remove(); return; }
  let done = false;
  const fin = () => { if (done) return; done = true; remove(); };
  el.addEventListener('transitionend', fin, { once: true });
  setTimeout(fin, 400);   // filet si transitionend ne tire pas (kill-switch, onglet masqué)
}

// ── Pièces jointes : drag & drop + chips ────────────────────────────────────
// Zone de drop unique = toute la colonne chat (#main-col : topbar + messages
// + composer, hors sidebar/drawers, siblings de .main sous #app). .input-wrap
// n'a délibérément AUCUN handler propre : il est un descendant de #main-col,
// donc un drop sur la barre de saisie y bulle déjà. Un handler local en plus
// attachait le fichier deux fois (une par handler du chemin de bulle).
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
// SAUF pour l'action de promotion (voie 2, lot Cbis), qui n'est pertinente
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
// l'espace actif (voie 2, lot Cbis) : action explicite en un clic, PAS de
// gate (contrairement à la promotion modèle — c'est déjà un consentement).
// Copie bytes+méta ; l'attachment d'origine reste intact (mêmes sémantiques
// que la promotion modèle, storeLibraryFile). Description absente (le trigger la
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
    // Trigger de description fire-and-forget : aucun écran Space ouvert ici pour afficher un
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
// Inspecteur d'appel d'outil (lot Z). `trackDrawer` transmet les arguments,
// donc `openToolInspector(entry)` garde sa signature. Sans cette registration,
// Escape fermerait le drawer du dessous et laisserait celui-ci ouvert.
const _tInspect = trackDrawer(openToolInspector, closeToolInspector);
openToolInspector = _tInspect.open; closeToolInspector = _tInspect.close;

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
// Scan de contenu du submode « conversation » (U-3). Le rendu de la palette est
// synchrone et rejoué à chaque frappe ; la lecture IDB, elle, ne l'est pas. On
// mémorise donc `{ query, hits }` — la requête AVEC le résultat, jamais le
// résultat seul : sans la requête, un Set arrivé en retard serait appliqué à une
// autre frappe (cf. `project_cache_key_must_be_identity_not_handy_attribute`,
// même esprit — l'identité du résultat est la requête qui l'a produit).
let _cmdkContentHits = null;
let _cmdkContentTimer = null;
let _cmdkContentSeq = 0;

// Débounce + passe de scan de contenu pour le submode conversation. Appelée à
// chaque frappe ; le rendu immédiat (titre/résumé) a déjà eu lieu, celui-ci
// n'arrive qu'en complément. Sans debounce, chaque frappe déclencherait une
// lecture IDB complète — la palette n'en avait pas besoin tant que tout était
// synchrone, elle en a besoin maintenant.
function scheduleCmdkContentScan(query) {
  if (_cmdkContentTimer !== null) { clearTimeout(_cmdkContentTimer); _cmdkContentTimer = null; }
  _cmdkContentSeq++;
  const q = (query || '').trim();
  if (!q) { _cmdkContentHits = null; return; }
  const seq = _cmdkContentSeq;
  _cmdkContentTimer = setTimeout(async () => {
    _cmdkContentTimer = null;
    const hits = await collectContentSearchHits(q);
    // Jeton de séquence : la palette a pu se fermer, changer de mode, ou la
    // frappe continuer pendant la lecture (`project_await_reentrancy_guard`).
    if (seq !== _cmdkContentSeq || !_cmdkOpen || _cmdkMode !== 'conv') return;
    _cmdkContentHits = { query: q, hits: hits };
    if (!hits.size) return;   // rien à ajouter : pas de re-rendu
    renderCommandList($('cmdk-input').value);
  }, CONV_SEARCH_DEBOUNCE_MS);
}

function cancelCmdkContentScan() {
  if (_cmdkContentTimer !== null) { clearTimeout(_cmdkContentTimer); _cmdkContentTimer = null; }
  _cmdkContentSeq++;
  _cmdkContentHits = null;
}

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
// Items du sous-mode « modèle » de la palette : mêmes couples serveur/modèle que
// le sélecteur du composer (tous les serveurs non désactivés déjà en cache — la
// palette ne déclenche pas de fetch, elle liste ce qui est connu). Le nom du
// serveur apparaît en note dès qu'il y a plus d'un serveur sélectionnable.
function cmdkModelItems(query) {
  const q = (query || '').toLowerCase();
  const cur = activeModel();
  const activeId = (activeApiServer() || {}).id;
  const servers = listSelectableApiServers();
  const multi = servers.length > 1;
  const items = [];
  servers.forEach(s => {
    const e = _modelsEntryOf(s);
    (e.models || []).forEach(m => {
      if (q && m.toLowerCase().indexOf(q) < 0) return;
      items.push({
        label: m,
        note: multi ? (s.name || s.url) : '',
        current: (m === cur && s.id === activeId),
        run: () => { closeCommandPalette(); pickComposerModel(m, s.id); },
      });
    });
  });
  return items;
}

const COMMANDS = [
  { id: 'new', key: 'n', label: 'Nouvelle conversation', keywords: ['new', 'conversation', 'nouveau'],
    run: () => { closeCommandPalette(); newConversation(); } },
  { id: 'search-conv', key: 'f', label: 'Rechercher une conversation', keywords: ['search', 'historique', 'find', 'chercher'],
    run: () => enterCmdkSubmode('conv') },
  { id: 'switch-model', key: 'm', label: 'Changer de modèle', keywords: ['model', 'modèle', 'switch'],
    enabled: () => cmdkModelItems('').length > 0,
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
  if (_cmdkMode === 'model') return cmdkModelItems(query);
  if (_cmdkMode === 'skill') {
    return matchSkillCompletions(query).map(s => ({
      label: s.name || s.slug, note: s.name ? ('/' + s.slug) : '',
      run: () => { closeCommandPalette(); insertSkillIntoComposer(s.slug); },
    }));
  }
  if (_cmdkMode === 'space') {
    const spaces = sortedSpacesByName(loadSpaces())
      .filter(s => !query || (s.name || '').toLowerCase().indexOf(query.toLowerCase()) >= 0);
    const active = getActiveSpaceId();
    return spaces.map(s => ({
      label: s.name || '(sans nom)', current: s.id === active,
      run: () => { closeCommandPalette(); pickSpace(s.id); },
    }));
  }
  if (_cmdkMode === 'conv') {
    return cmdkConvItems(query);
  }
  return [];
}

// Submode « recherche conversation » : CROSS-Space (décision Julien), mais
// les conversations du Space actif passent en tête même à score inférieur
// (rankConvResults). Réutilise le prédicat de la sidebar (searchConversations)
// pour la logique de match (titre/résumé/contenu) ; score léger local (titre =
// 3, autre = 1) suffisant pour départager dans un groupe de Space. Chaque ligne
// annotée du nom de son Space. Ouvrir une conv d'un autre Space suit le Space
// (followSpace) avant selectConv, pour ne pas afficher un fil hors du Space actif.
function cmdkConvItems(query) {
  const q = (query || '').trim();
  if (!q) return [];
  // `_cmdkContentHits` : résultat de la passe de scan de contenu pour CETTE
  // requête (U-3), ou null tant qu'elle n'a pas rendu la main. Le rendu de la
  // palette reste synchrone ; c'est la passe qui redemande un rendu quand elle
  // aboutit (cf. scheduleCmdkContentScan).
  const pred = searchConversations(q, _cmdkContentHits && _cmdkContentHits.query === q
    ? _cmdkContentHits.hits : null);
  if (!pred) return [];
  const ql = q.toLowerCase();
  const spaceNames = new Map(loadSpaces().map(s => [s.id, s.name || '']));
  const active = getActiveSpaceId();
  // La recherche de la palette est cross-Space (exception sanctionnée, lot F),
  // mais elle ne remonte JAMAIS un agent (lot X-1, exclusion 3 de 3ter) :
  // « pas trouvable » et « pas atteignable » sont deux choses distinctes — le
  // parent, lui, court-circuite par id (conv__get / agent__*).
  const scored = listAllConversations()
    .filter(isRootConversation)
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
  // Changer de mode vide le champ : tout scan de contenu en vol devient sans
  // objet, et son résultat ne doit pas s'appliquer au mode d'arrivée.
  cancelCmdkContentScan();
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
    // Emplacement de GAUCHE, largeur fixe : il porte la touche de raccourci en
    // mode racine, et la COCHE de l'élément courant dans les sous-modes (modèle,
    // espace) — les deux ne coexistent jamais (un sous-mode n'a pas de touches).
    // Span vide réservé sinon, pour aligner les labels verticalement.
    const keyEl = document.createElement('span');
    keyEl.className = 'cmdk-item-key';
    if (it.keyLabel) {
      keyEl.textContent = it.keyLabel;
    } else if (it.current) {
      keyEl.textContent = '✓';
      keyEl.classList.add('cmdk-item-current');
    } else {
      keyEl.classList.add('cmdk-item-key-empty');
    }
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
  cancelCmdkContentScan();
  const overlay = $('cmdk-overlay');
  if (overlay) overlay.hidden = true;
  // Restaure le focus au composer. Fallback : élément focus avant.
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
      // Complément asynchrone (U-3) : le scan de contenu ne peut plus se faire
      // dans le rendu synchrone ci-dessus. Armé seulement dans le submode qui en
      // dépend ; il redemande un rendu quand il aboutit.
      if (_cmdkMode === 'conv') scheduleCmdkContentScan(input.value);
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

// ── Sélecteur serveur/modèle du composer ────────────────────────────────────
// Le sélecteur liste les modèles de TOUS les serveurs API non désactivés, pas
// seulement de l'actif. Cache de session (pas de persistance) indexé par **id de
// serveur**, jamais par URL : deux serveurs peuvent partager une URL et ne
// différer que par la clef d'API (même endpoint, droits d'accès distincts, donc
// listes de modèles distinctes) — une clef par URL ferait servir à l'un la liste
// de l'autre. L'id est déjà l'identité partout ailleurs (`activeApiServer().id`,
// `pickComposerModel`, `retryServerModels`) ; pas de clef composite (URL+clef ou
// son hash), qui n'ajouterait rien et ferait transiter la clef d'API dans un nom
// de propriété.
// Une entrée porte `{ id, stamp, models, error, pending }` — `error` mémorise
// l'échec pour l'afficher dans le menu (en-tête de groupe cliquable pour
// réessayer, cf. brief). `stamp` = empreinte de l'endpoint (URL + clef) au
// moment du fetch : l'id SURVIT à l'édition d'une carte, donc sans cette
// vérification une modification d'URL ou de clef laisserait en place la liste de
// l'ANCIEN endpoint.
const _modelsById = Object.create(null);

// Empreinte d'endpoint d'un serveur. Le séparateur `\n` n'apparaît ni dans une
// URL ni dans une clef saisie sur une ligne d'input : pas de collision entre
// (url `a`, clef `b`) et (url `a\nb`, clef vide).
function _serverStamp(server) {
  const o = server || {};
  return ((o.url || '').trim()) + '\n' + (o.key || '');
}

// Entrée de cache d'un serveur, réinitialisée si son endpoint a changé depuis le
// dernier fetch (édition de carte : même id, autre URL ou autre clef).
function _modelsEntry(server) {
  const id = (server && server.id) || '';
  const stamp = _serverStamp(server);
  let e = _modelsById[id];
  if (e && e.stamp !== stamp) e = null;   // endpoint modifié : l'ancienne liste ne vaut plus
  if (!e) { e = _modelsById[id] = { id, stamp, models: null, error: null, pending: null }; }
  return e;
}

// Lecture seule pour le rendu (menu, palette) : ne crée aucune entrée et ne
// ressuscite pas une liste devenue obsolète. Renvoie toujours un objet, les
// appelants lisent `.models`/`.error`/`.pending`.
function _modelsEntryOf(server) {
  const e = _modelsById[(server && server.id) || ''];
  return (e && e.stamp === _serverStamp(server)) ? e : {};
}

// Charge (ou renvoie depuis le cache) la liste d'un serveur. `force` relance un
// fetch même après échec (bouton « réessayer »). Ne rejette jamais : l'échec est
// mémorisé dans l'entrée, à charge de l'appelant de re-rendre.
function loadServerModels(server, force) {
  const url = ((server && server.url) || '').trim();
  if (!url) return Promise.resolve([]);
  const e = _modelsEntry(server);
  if (e.models && !force) return Promise.resolve(e.models);
  if (e.pending && !force) return e.pending;
  if (e.error && !force) return Promise.resolve([]);
  e.error = null;
  e.pending = fetchModels({ url, key: server.key })
    .then(models => { e.models = models; e.error = null; return models; })
    .catch(err => { e.models = null; e.error = String((err && err.message) || err || 'échec'); return []; })
    .then(models => { e.pending = null; return models; });
  return e.pending;
}

// Compat : liste du serveur ACTIF (utilisée par la visibilité du sélecteur et
// par prefetchModels au démarrage).
function loadModelsCached() {
  const s = activeApiServer();
  if (!s) return Promise.resolve([]);
  return loadServerModels(s);
}

function activeServerModels() {
  const s = activeApiServer();
  return (s && _modelsEntryOf(s).models) || null;
}

// Charge en parallèle les listes de tous les serveurs sélectionnables dont on
// n'a pas encore de résultat. Appelé à l'ouverture du menu : le serveur actif
// est déjà en cache (prefetchModels), les autres arrivent puis re-rendent.
function loadAllServerModels(force) {
  const servers = listSelectableApiServers();
  const todo = servers.filter(s => {
    const e = _modelsEntryOf(s);
    return force || (!e.models && !e.error && !e.pending);
  });
  if (!todo.length) return Promise.resolve(false);
  return Promise.all(todo.map(s => loadServerModels(s, force))).then(() => true);
}

// Met à jour les libellés de modèle (pastille topbar + bouton composer) sur le
// modèle effectif, et la visibilité du sélecteur composer (réglage activé ET
// liste disponible pour le serveur actif — sinon fallback silencieux, le
// sélecteur n'apparaît pas).
// Budget en caractères pour le libellé du bouton de modèle du composer.
// Le sélecteur ne doit pas dépasser ~55% de la rangée : au-delà, il pousse les
// pilules raisonnement et contexte hors de la ligne. La largeur disponible est
// MESURÉE (pas devinée), puis convertie en caractères via la largeur d'un glyphe
// mono à 11px (~0,6em) après déduction du chrome du bouton (icône, chevron,
// gaps, paddings ≈ 52px). Renvoie 0 quand la mesure n'est pas exploitable
// (élément absent, composer masqué, appel avant layout) : shortenModelLabel
// laisse alors le nom intact.
const COMPOSER_MODEL_MAX_RATIO = 0.55;
const COMPOSER_MODEL_BTN_CHROME_PX = 52;
const COMPOSER_MODEL_CHAR_PX = 11 * 0.6;

// Budget du libellé de la pilule topbar (`.model-pill`, chat.css). Même besoin
// que le composer — un nom long doit perdre son AUTEUR avant sa fin — mais pas
// la même mécanique de mesure : la pilule a une `max-width` FIXE (210px), elle
// ne suit aucune rangée redimensionnable. Le budget est donc constant, et un
// ResizeObserver n'aurait rien à observer.
//
// Sans cette abréviation, `text-overflow: ellipsis` coupait bien le libellé
// mais par la FIN, en gardant l'auteur : `hf.co/unsloth/gemma-3-4b…` montrait
// l'hébergeur et masquait le modèle, soit exactement l'information utile.
// Le CSS reste en place — il rattrape le cas où l'abréviation ne suffit pas —
// mais il n'est plus le seul recours.
//
// 210px de pilule moins son chrome (paddings 10+10, gap 7, point 7) ≈ 176px de
// texte, convertis en caractères par la largeur d'un glyphe mono à 10.5px
// (~0,6em), comme au composer. Ces valeurs sont RECOPIÉES du CSS : les changer
// là-bas sans les changer ici ne casse rien de visible (le CSS tronque encore),
// ça déplace juste le seuil d'abréviation.
const TOPBAR_MODEL_TEXT_PX = 210 - 34;
const TOPBAR_MODEL_CHAR_PX = 10.5 * 0.6;
const TOPBAR_MODEL_MAX_CHARS = Math.floor(TOPBAR_MODEL_TEXT_PX / TOPBAR_MODEL_CHAR_PX);

function composerModelLabelBudget() {
  const row = $('composer-selectors');
  const rowWidth = row ? row.clientWidth : 0;
  if (!rowWidth) return 0;
  const textPx = rowWidth * COMPOSER_MODEL_MAX_RATIO - COMPOSER_MODEL_BTN_CHROME_PX;
  if (textPx <= 0) return 0;
  return Math.floor(textPx / COMPOSER_MODEL_CHAR_PX);
}

// Le budget dépend d'une LARGEUR : il faut le recalculer quand la rangée change
// de taille (fenêtre redimensionnée, sidebar tirée, ouverture d'un drawer).
// ResizeObserver couvre les trois d'un coup, sans se brancher sur le drag de la
// sidebar ni sur un resize de fenêtre qui raterait le cas sidebar.
let _composerSelectorsRO = null;

function initComposerModelLabelFit() {
  const row = $('composer-selectors');
  if (!row || typeof ResizeObserver === 'undefined' || _composerSelectorsRO) return;
  _composerSelectorsRO = new ResizeObserver(() => {
    const compLabel = $('composer-model-label');
    if (!compLabel) return;
    // Recalcul du seul libellé : syncModelUI referait aussi le test de
    // visibilité (lecture de réglages + listes de serveurs) à chaque frame de
    // redimensionnement, pour rien.
    const m = activeModel() || 'modèle';
    compLabel.textContent = shortenModelLabel(m, composerModelLabelBudget());
    compLabel.title = m;
  });
  _composerSelectorsRO.observe(row);
}

function syncModelUI() {
  const m = activeModel() || 'modèle';
  // Pilule topbar : même abréviation que le bouton composer (auteur retiré,
  // puis fin tronquée), avec le nom complet en title pour rester récupérable.
  const top = $('model-label');
  if (top) {
    top.textContent = shortenModelLabel(m, TOPBAR_MODEL_MAX_CHARS);
    top.title = m;
  }
  // Bouton composer : nom ABRÉGÉ (auteur retiré, puis fin tronquée) — le nom
  // complet reste dans la liste déroulée ET en title, pour rester récupérable.
  const compLabel = $('composer-model-label');
  if (compLabel) {
    compLabel.textContent = shortenModelLabel(m, composerModelLabelBudget());
    compLabel.title = m;
  }
  const box = $('composer-model');
  if (box) {
    // Visible dès que le réglage est actif ET qu'il y a quelque chose à proposer :
    // soit la liste du serveur actif est chargée, soit un autre serveur est
    // sélectionnable (sa liste sera chargée à l'ouverture du menu). Sans ce
    // second cas, un serveur actif injoignable masquerait un sélecteur qui a
    // pourtant des modèles à offrir ailleurs.
    const models = activeServerModels();
    const others = listSelectableApiServers().filter(s => s.id !== (activeApiServer() || {}).id);
    const show = !!(loadSettings().showModelSelector && ((models && models.length) || others.length));
    box.hidden = !show;
  }
}

function toggleComposerModelMenu() {
  const menu = $('composer-model-menu');
  if (!menu) return;
  if (menu.classList.contains('show')) { menu.classList.remove('show'); return; }
  // Lecture seule (X-1f) : ce sélecteur choisit le modèle du PROCHAIN envoi —
  // sur un fil qui n'en acceptera plus aucun, il ne décide de rien. Refus à
  // l'OUVERTURE, pas seulement en CSS : `pointer-events: none` ne couvre ni le
  // clavier ni un appel programmatique. La fermeture (menu déjà ouvert) reste
  // permise inconditionnellement — au-dessus de cette ligne, exprès.
  if (isComposerReadonly()) return;
  renderComposerModelOptions();   // ancre déjà la ligne active dans la vue
  menu.classList.add('show');
  // Les serveurs non actifs sont interrogés à l'ouverture, pas au démarrage :
  // re-rendu à l'arrivée des réponses, si le menu est toujours ouvert. Le
  // re-rendu préserve la position visuelle de la ligne active (cf.
  // renderComposerModelOptions) : la liste ne saute pas sous le curseur.
  loadAllServerModels(false).then(changed => {
    if (changed && menu.classList.contains('show')) renderComposerModelOptions();
  });
}

// Réessaie la liste d'un serveur depuis l'en-tête de groupe en erreur.
function retryServerModels(serverId) {
  const s = getApiServer(serverId);
  if (!s) return;
  renderComposerModelOptions();   // reflète l'état « en cours »
  loadServerModels(s, true).then(() => {
    const menu = $('composer-model-menu');
    if (menu && menu.classList.contains('show')) renderComposerModelOptions();
  });
}

// Re-rendu du menu SANS déplacer ce que l'utilisateur a sous les yeux. Le menu
// est réécrit en entier à chaque arrivée de liste d'un serveur non actif (et à
// chaque retry) : sans ancrage, `scrollTop` retombe à 0 et la ligne active
// disparaît sous le pli. On ré-ancre sur l'élément sélectionné en préservant son
// décalage VISUEL (distance au haut du menu), pas seulement sa visibilité : la
// liste ne glisse pas sous le curseur quand des groupes s'insèrent AVANT lui.
// Repli sur le `scrollTop` brut quand il n'y a pas de ligne sélectionnée (aucun
// modèle actif dans la liste, ou premier rendu).
function renderComposerModelOptions() {
  const menu = $('composer-model-menu');
  if (!menu) return;
  const prevSel = menu.querySelector('.model-opt.selected');
  // Décalage de la ligne active par rapport au haut de la zone scrollable, tel
  // qu'il est perçu à l'écran juste avant réécriture.
  const prevOffset = prevSel ? (prevSel.offsetTop - menu.scrollTop) : null;
  const prevScroll = menu.scrollTop;
  renderComposerModelOptionsInner();
  const nextSel = menu.querySelector('.model-opt.selected');
  if (nextSel && prevOffset !== null) {
    menu.scrollTop = nextSel.offsetTop - prevOffset;
  } else if (nextSel) {
    // Premier rendu (ou apparition de la sélection) : amener la ligne active
    // dans la vue, sans forcer si elle y est déjà (`block: 'nearest'`).
    nextSel.scrollIntoView({ block: 'nearest' });
  } else {
    menu.scrollTop = prevScroll;
  }
}

function renderComposerModelOptionsInner() {
  const menu = $('composer-model-menu');
  const cur = activeModel();
  const activeId = (activeApiServer() || {}).id;
  const servers = listSelectableApiServers();
  menu.innerHTML = '';
  // Groupes visuels seulement s'il y a plusieurs serveurs : à un seul serveur,
  // l'en-tête n'apporte rien et le menu garde son apparence historique.
  const grouped = servers.length > 1;
  servers.forEach(s => {
    const e = _modelsEntryOf(s);
    if (grouped) menu.appendChild(buildModelGroupHeader(s, e));
    const models = e.models || [];
    if (!models.length) {
      if (e.error) menu.appendChild(buildModelGroupNote(s, 'Liste indisponible — réessayer'));
      else if (e.pending) menu.appendChild(buildModelGroupNote(s, 'Interrogation…'));
      else if (e.models) menu.appendChild(buildModelGroupNote(s, 'Aucun modèle exposé'));
      return;
    }
    models.forEach(m => {
      // « Sélectionné » = le couple (serveur actif, modèle courant) : le même nom
      // de modèle exposé par deux serveurs ne doit cocher que celui en usage.
      const isSel = m === cur && s.id === activeId;
      const o = document.createElement('div');
      o.className = 'model-opt' + (isSel ? ' selected' : '');
      o.innerHTML = `<span>${escHtml(m)}</span><span class="check">✓</span>`;
      o.onmousedown = (ev) => { ev.preventDefault(); pickComposerModel(m, s.id); };
      menu.appendChild(o);
    });
  });
}

function buildModelGroupHeader(server, entry) {
  const h = document.createElement('div');
  h.className = 'model-group' + (entry && entry.error ? ' has-error' : '');
  const n = document.createElement('span');
  n.className = 'model-group-name';
  n.textContent = server.name || server.url || 'Serveur';
  h.appendChild(n);
  return h;
}

// Ligne d'état sous un en-tête de groupe. En erreur, elle est cliquable et
// relance le fetch pour ce serveur.
function buildModelGroupNote(server, label) {
  const d = document.createElement('div');
  d.className = 'model-group-note';
  d.textContent = label;
  const e = _modelsEntryOf(server);
  if (e.error) {
    d.classList.add('is-error');
    d.onmousedown = (ev) => { ev.preventDefault(); retryServerModels(server.id); };
  }
  return d;
}

// Sélection d'un modèle dans le composer. Si le modèle appartient à un autre
// serveur, on bascule le serveur ACTIF (décision Julien 2026-08-21 : pas
// d'override de serveur par conversation) — l'ordre compte, le serveur d'abord
// puis le modèle, sinon setConvModel persisterait un modèle sur l'ancien
// endpoint le temps d'un rendu.
function pickComposerModel(m, serverId) {
  const activeId = (activeApiServer() || {}).id;
  if (serverId && serverId !== activeId) {
    setActiveApiServerId(serverId);
    renderApiServersIfOpen();
    syncActiveApiServerUI();
    syncConfigured();
  }
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
  if (isComposerReadonly()) return;   // cf. toggleComposerModelMenu (X-1f)
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
    || $('set-intent-tracing').checked !== !!s.intentTracing
    || $('set-early-title').checked !== !!s.earlyTitle
    || $('set-retitle-after-reply').checked !== effectiveRetitleAfterReply(s)
    || $('set-describe-files').checked !== (s.describeFiles !== false)
    || $('set-export-interactive').checked !== (s.exportInteractive !== false)
    || $('set-contextwindow').value !== (s.contextWindow || '');
}

// Active « Enregistrer » seulement si quelque chose est à enregistrer. Appelé
// par délégation input/change sur le drawer (câblée dans init) et explicitement
// par les chemins programmatiques qui n'émettent pas d'événement
// (pickSettingsReasoningEffort, selectSummaryInjectionMode, onSaveSettings).
function updateSettingsDirty() {
  syncRetitleUI();   // libellé/éditabilité du retitrage AVANT la comparaison (il peut forcer la case)
  const btn = $('save-settings-btn');
  if (btn) btn.disabled = !settingsFormDirty();
}

// Le réglage « titre après la première réponse » est SUBORDONNÉ au titrage
// précoce, et sa présentation change avec lui — pas seulement son état :
//
// - précoce OFF : la case décrit l'EXISTANT (le niveau 3 titre en fin
//   d'échange, il l'a toujours fait). Cochée et NON MODIFIABLE : la décocher
//   ouvrirait un cas « aucun titrage du tout » que personne n'a demandé et qui
//   ramènerait « Nouvelle conversation » à demeure.
// - précoce ON : la case gouverne un vrai choix, celui de RÉGÉNÉRER un titre
//   déjà écrit. D'où le changement de libellé — « régénéré » dit qu'un titre
//   sera écrasé, ce que « Titre après la première réponse » ne dit pas.
//
// Appelée depuis updateSettingsDirty, donc sur le MÊME chemin que la délégation
// input/change du drawer : la bascule de `set-early-title` la déclenche sans
// handler dédié, et openSettings en hérite aussi.
const RETITLE_LABEL_ALONE = 'Titre après la première réponse';
const RETITLE_LABEL_AFTER_EARLY = 'Titre régénéré après la première réponse';
const RETITLE_HINT_ALONE = "Le titre est généré en fin d'échange, quand la réponse est connue.";
const RETITLE_HINT_AFTER_EARLY = "Remplace le titre écrit à l'envoi par un titre tenant compte de la réponse.";

function syncRetitleUI() {
  const cb = $('set-retitle-after-reply');
  if (!cb) return;
  const early = $('set-early-title').checked;
  if (!early) cb.checked = true;   // sans titrage précoce, le niveau 3 titre toujours
  cb.disabled = !early;
  // Le grisage porte sur la LIGNE entière (libellé compris), pas sur le seul
  // interrupteur : cf. .check-row.is-locked, drawers.css.
  const row = cb.closest('.check-row');
  if (row) row.classList.toggle('is-locked', !early);
  const lbl = $('set-retitle-label');
  if (lbl) lbl.textContent = early ? RETITLE_LABEL_AFTER_EARLY : RETITLE_LABEL_ALONE;
  const hint = $('set-retitle-hint');
  if (hint) hint.textContent = early ? RETITLE_HINT_AFTER_EARLY : RETITLE_HINT_ALONE;
}

// ── État des lieux du stockage (drawer Paramètres › Données) ────────────────
// Rendu du rapport produit par collectStorageReport(). Le chiffre principal est
// la somme MESURÉE par MIAOU (exacte), rapportée au quota du navigateur ;
// estimate().usage n'est pas utilisé (cf. la note en tête de la section « État
// des lieux du stockage », storage.js). Tout est du texte construit ici, jamais
// d'origine modèle.
const STORAGE_REPORT_LABELS = {
  conversations: 'Conversations',
  summaries: 'Résumés',
  resources: 'Fichiers et pièces jointes',
  skills: 'Skills',
  settings: 'Réglages, souvenirs, espaces',
};

function renderStorageReport(report) {
  const totalEl = $('storage-report-total');
  const detailEl = $('storage-report-detail');
  if (!totalEl || !detailEl) return;
  totalEl.innerHTML = '<strong>' + escHtml(humanSize(report.measured)) + '</strong> utilisés' +
    (report.quota
      ? ' <span class="storage-quota">sur ' + escHtml(humanSize(report.quota)) +
        ' disponibles' + (report.percent != null ? ' (' + report.percent + '\u00a0%)' : '') + '</span>'
      : '');
  let html = '';
  for (const key of Object.keys(STORAGE_REPORT_LABELS)) {
    const bytes = report.detail[key] || 0;
    html += '<span>' + escHtml(STORAGE_REPORT_LABELS[key]) + '</span>' +
      '<span class="storage-bytes">' + escHtml(humanSize(bytes)) + '</span>';
  }
  detailEl.innerHTML = html;
}

// Déclenché à chaque ouverture du drawer (les chiffres bougent entre deux
// ouvertures). Un jeton de séquence fait abandonner un rendu devenu obsolète si
// le drawer est refermé puis rouvert pendant la mesure (même discipline que
// _openConvSeq, cf. piège 24 : l'état est relu APRÈS l'await).
let _storageReportSeq = 0;
function refreshStorageReport() {
  const totalEl = $('storage-report-total');
  const detailEl = $('storage-report-detail');
  if (!totalEl || !detailEl) return;
  const seq = ++_storageReportSeq;
  totalEl.textContent = 'Mesure en cours…';
  detailEl.innerHTML = '';
  collectStorageReport().then(function(report) {
    if (seq !== _storageReportSeq) return;
    renderStorageReport(report);
  }).catch(function() {
    if (seq !== _storageReportSeq) return;
    totalEl.textContent = 'Mesure indisponible.';
  });
}

function openSettings() {
  const s = loadSettings();
  setSummaryInjectionModeUI(s.summaryInjectionMode);   // valeur courante (peut changer via la bannière)
  setThemeUI(s.theme || 'system');
  setPaletteUI(s.palette || 'ambre');
  setFontsUI(s.fonts || 'graphite');
  setMotionUI(s.motion || 'system');
  $('set-intent-tracing').checked = !!s.intentTracing;
  $('set-early-title').checked = !!s.earlyTitle;
  $('set-retitle-after-reply').checked = effectiveRetitleAfterReply(s);
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
  refreshStorageReport();  // asynchrone : le bloc se remplit après ouverture
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

// Jumeau côté export (lot V-3). `exportAllData` n'avait AUCUN chemin d'erreur
// avant V-3 : tout y était synchrone-après-await. Le passage au conteneur zip
// introduit `ensureFflate`, qui peut légitimement échouer (CDN indisponible,
// hors-ligne). Un bouton « Exporter les données » muet — sur l'assurance-vie de
// l'application — est le pire silence possible. Décision Julien : un message,
// jamais un repli silencieux vers le .json non compressé, qui produirait un
// fichier différent de ce que l'utilisateur croit avoir.
function showExportDataError(msg) {
  const err = $('export-data-err');
  if (!err) return;
  if (!msg) { err.setAttribute('hidden', ''); err.textContent = ''; return; }
  err.textContent = msg;
  err.removeAttribute('hidden');
}

// Affiche le récapitulatif d'un import valide (counts de validateImportPayload)
// et câble le bouton d'application sur armThenRun. `onApply` est appelé au
// second clic (confirmation) — l'appelant (main.js) porte l'effet de bord.
function renderImportSummary(counts, onApply) {
  resetImportDataUI();
  const sum = $('import-data-summary');
  if (!sum) return;
  sum.innerHTML =
    `<div>${counts.conversations} conversation(s), ${counts.summaries} résumé(s), ` +
    `${counts.memories} souvenir(s), ${counts.skills} skill(s), ` +
    `${counts.resources} ressource(s), ${counts.servers} serveur(s), ` +
    `${counts.spaces} espace(s).</div>`;
  // Sauvegarde v3 partiellement abîmée : les ressources dont le membre manque
  // sont importées vides plutôt que de faire échouer tout l'import. Le dire ICI,
  // avant le clic d'application — après, il serait trop tard pour renoncer.
  if (counts.missingResourceData) {
    const warn = document.createElement('div');
    warn.className = 'import-summary-warn';
    warn.textContent = counts.missingResourceData + ' ressource(s) sans données dans l\'archive : ' +
      'elles seront importées vides.';
    sum.appendChild(warn);
  }
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

// ── Palettes (axe orthogonal au thème clair/sombre, lot S-a) ────────────────
const PALETTES = ['ambre', 'encre', 'foret'];
const PALETTE_HINTS = {
  ambre: "Orange chaud sur gris froids (palette d'origine).",
  encre: "Bleu franc sur bleu-nuit, gris-bleu en clair.",
  foret: "Vert jade sur gris-vert profonds, lin en clair.",
};

let pendingPalette = 'ambre';
// Ambre est le DÉFAUT : pas d'attribut posé (le bloc :root de base.css la
// porte), même logique que « pas de classe pour l'état nominal ». Une valeur
// inconnue (réglage corrompu, palette retirée) retombe sur ambre plutôt que de
// laisser un data-palette orphelin qui ne matcherait aucune règle.
function applyPalette(palette) {
  const p = PALETTES.indexOf(palette) >= 0 ? palette : 'ambre';
  if (p === 'ambre') document.documentElement.removeAttribute('data-palette');
  else document.documentElement.setAttribute('data-palette', p);
}

function setPaletteUI(palette) {
  pendingPalette = PALETTES.indexOf(palette) >= 0 ? palette : 'ambre';
  document.querySelectorAll('#palette-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingPalette);
  });
  const hint = $('palette-hint');
  if (hint) hint.textContent = PALETTE_HINTS[pendingPalette] || '';
}

function selectPalette(palette) {
  setPaletteUI(palette);
  applyPalette(palette);
  saveSettings({ palette });   // persistance immédiate, modèle selectTheme
}

// ── Lots de fontes (axe orthogonal à la palette et au thème, lot S-b) ───────
// Sans et mono vont par PAIRE : elles sont choisies pour s'accorder, comme les
// deux teintes d'une palette. Les six familles sont préchargées par l'@import
// unique de base.css, donc la bascule ne déclenche aucun fetch ni FOUT.
const FONT_LOTS = ['graphite', 'atelier', 'chaleur'];
const FONT_HINTS = {
  graphite: "Hanken Grotesk et JetBrains Mono — l'aspect d'origine.",
  atelier:   "Source Sans 3 et Source Code Pro — dessinées comme une même famille.",
  chaleur:   "Figtree et Fira Code — plus rond, mono à ligatures.",
};

// Familles par lot — utilisées par le préchargement. Doivent rester alignées
// sur les blocs :root[data-fonts] de base.css ET sur le <link> du <head> :
// une famille listée ici mais absente du <link> ne se chargerait jamais.
const FONT_LOT_FAMILIES = {
  graphite: { sans: 'Hanken Grotesk', mono: 'JetBrains Mono' },
  atelier:  { sans: 'Source Sans 3',  mono: 'Source Code Pro' },
  chaleur:  { sans: 'Figtree',        mono: 'Fira Code' },
};

let pendingFonts = 'graphite';
// « graphite » est le DÉFAUT : pas d'attribut posé (le bloc :root le porte),
// même doctrine que la palette ambre. Une valeur inconnue retombe dessus
// plutôt que de laisser un data-fonts orphelin qui ne matcherait aucune règle.
function applyFonts(fonts) {
  const f = FONT_LOTS.indexOf(fonts) >= 0 ? fonts : 'graphite';
  if (f === 'graphite') document.documentElement.removeAttribute('data-fonts');
  else document.documentElement.setAttribute('data-fonts', f);
}

function setFontsUI(fonts) {
  pendingFonts = FONT_LOTS.indexOf(fonts) >= 0 ? fonts : 'graphite';
  document.querySelectorAll('#fonts-mode .seg').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-mode') === pendingFonts);
  });
  const hint = $('fonts-hint');
  if (hint) hint.textContent = FONT_HINTS[pendingFonts] || '';
}

// Précharge les familles des lots NON actifs. Le <link> du <head> déclare les
// six @font-face, mais un navigateur ne télécharge un .woff2 que lorsqu'un
// glyphe le réclame : sans ça, basculer de lot déclenchait deux fetchs et un
// saut visuel. document.fonts.load() force le téléchargement sans rien rendre.
// Appelé après l'init, pendant que l'overlay de boot masque encore l'écran :
// le coût est invisible, et toute bascule ultérieure est instantanée.
// Silencieux par construction (préchargement opportuniste) : hors ligne ou
// Google Fonts injoignable, on retombe sur le comportement d'avant.
function prefetchFontLots() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  const families = [];
  for (const lot of FONT_LOTS) {
    if (lot === pendingFonts) continue;   // le lot actif se charge tout seul
    const spec = FONT_LOT_FAMILIES[lot];
    if (spec) families.push(spec.sans, spec.mono);
  }
  for (const fam of families) {
    // Les deux graisses réellement utilisées : charger « 400 » ne rapatrie pas
    // le fichier du 600 (un poids = un fichier).
    document.fonts.load(`400 1rem "${fam}"`).catch(() => {});
    document.fonts.load(`600 1rem "${fam}"`).catch(() => {});
  }
}

function selectFonts(fonts) {
  setFontsUI(fonts);
  applyFonts(fonts);
  saveSettings({ fonts });   // persistance immédiate, modèle selectTheme
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
  rerenderCurrentThread();   // jamais renderThread nu : cf. lot T-1b (bulle vive)
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
  intent_doctrine: '#f2a65a', skills_doctrine: '#f2c85a',
  codeblock_doctrine: '#e05ac9', user_prompt: '#e07a9e', context_date_model: '#9aa5b1', memories: '#e0605a',
  summaries: '#e0955a', skills_context: '#8bc98b', space_library: '#3ea8d9',
  thread: '#4a90d9', attachment_images: '#d9974a',
};

// Manifeste effectif : dernier envoi réel s'il existe, sinon simulation
// à froid. Ne recalcule PAS depuis zéro à chaque appel du compteur : la
// simulation est bon marché (fonctions pures déjà utilisées à l'envoi), mais
// PAS de polling — appelée seulement aux points de l'audit (send, switch conv,
// save settings, switch Space).
function effectiveContextManifest() {
  return _lastContextManifest || computeContextManifestNow();
}

// Compteur compact du composer. Câblé aux points send-relevant (audit
// §5b), jamais à l'oninput du textarea (draft exclu v1).
function syncContextCounter() {
  const el = $('ctx-counter-label');
  if (!el) return;
  const m = effectiveContextManifest();
  const win = contextWindowFor(activeModel());
  // Pilule = photo du dernier envoi réel (lot Bbis) : sans `≈` quand
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

  // Liseré de cache sur la pilule elle-même : même donnée que la barre de
  // l'inspecteur (usageDerived), pour un aperçu sans ouvrir le drawer.
  const cacheEl = $('ctx-counter-cache');
  if (cacheEl) {
    const ud = usageDerived(m.apiUsage);
    if (ud.cachedTokens != null && ud.cachedRatio != null) {
      const pct = Math.max(0, Math.min(100, ud.cachedRatio * 100));
      cacheEl.style.width = pct + '%';
      cacheEl.title = ud.cachedTokens + ' tok servis par le cache (' + Math.round(pct) + '%)';
      cacheEl.hidden = false;
    } else {
      cacheEl.hidden = true;
    }
  }

  // Drawer déjà ouvert (ex. laissé ouvert pendant une boucle d'outils ou un
  // streaming) : le rafraîchir en même temps que la pilule, sinon son contenu
  // reste figé sur l'état au moment de l'ouverture jusqu'à une fermeture/
  // réouverture manuelle.
  const drawer = $('ctx-drawer');
  if (drawer && drawer.classList.contains('show')) renderContextInspector();
}

// ── Inspecteur d'appel d'outil (lot Z) ───────────────────────────────────────
// Détail complet d'UN appel, ouvert depuis la loupe d'un ack. Les données sont
// déjà persistées sur l'entrée (`args`/`result`/`code`/`ts`/`server`/`intent`,
// ACK_COPY_FIELDS) : rien n'est collecté ici, on ne fait que présenter.
//
// FRONTIÈRE DE SÛRETÉ (piège 21) : tout ce qu'on affiche est d'origine MODÈLE
// ou SERVEUR DISTANT. Ce fichier devient le second chemin string→HTML à risque
// du projet après formatToolAcksHtml. Règle sans exception ici : `textContent`,
// ou `escHtml` dans un <pre>. JAMAIS `renderMd` (qui laisse passer le HTML
// d'origine modèle), jamais d'interpolation en template string.

// Ack couramment affiché — l'ENTRÉE elle-même, jamais un id (non unique).
// Sert au rafraîchissement asynchrone du volet ressource : quand la résolution
// IDB revient, on ne peint que si l'utilisateur regarde toujours le même appel.
let _inspectEntry = null;

function openToolInspector(entry) {
  _inspectEntry = entry || null;
  renderToolInspector(entry);
  $('inspect-drawer').classList.add('show');
  $('inspect-backdrop').classList.add('show');
}

function closeToolInspector() {
  $('inspect-drawer').classList.remove('show');
  $('inspect-backdrop').classList.remove('show');
  _inspectEntry = null;
}

// Titre de section d'un volet. Les volets sont EMPILÉS verticalement, jamais
// des onglets (décision d'ouverture) : on lit une fiche d'appel de haut en bas.
function _inspectSection(parent, title) {
  const sec = document.createElement('section');
  sec.className = 'inspect-section';
  const h = document.createElement('h4');
  h.className = 'inspect-section-title';
  h.textContent = title;
  sec.appendChild(h);
  parent.appendChild(sec);
  return sec;
}

// Préfixe de nommage des téléchargements de CE panneau : dernier segment du nom
// d'outil (`splunk__search` → `search`, `miaou__js__eval` → `eval`). UNE seule
// formule, appelée par tous les blocs — sans elle, deux appels d'outils
// différents proposeraient tous deux `query.txt` et se marcheraient dessus dans
// le dossier de téléchargements. Le segment final suffit à discriminer : le
// préfixe de serveur alourdirait le nom sans lever d'ambiguïté réelle.
// Repli sur le kind quand l'ack n'a pas de nom (ack legacy) ; '' si rien.
function _inspectNamePrefix(m) {
  const seg = String((m && m.name) || '').split('__').filter(Boolean).pop();
  return seg || ackKindOf(m) || '';
}

// Compose le nom d'un bloc : `<préfixe>-<quoi>`, ou `<quoi>` nu si l'ack ne
// donne aucun préfixe. Jamais de concaténation à la main sur un site d'appel.
function _inspectBlockName(m, what) {
  const p = _inspectNamePrefix(m);
  return p ? p + '-' + what : what;
}

// Bloc de code : <pre><code class="language-…">. `textContent` pose le texte —
// donc AUCUN parsing HTML, la frontière la plus stricte possible. Prism
// réécrit ensuite le contenu en spans à partir de ce texte déjà neutralisé.
// `decoratePre` ajoute copier/télécharger, et pour html/svg le bouton d'aperçu
// sandboxé (iframe sans allow-same-origin, piège 23 — chemin existant, aucune
// seconde voie de rendu ouverte ici).
// `name` (optionnel) alimente le `data-filename` que `decoratePre` lit pour
// nommer le téléchargement du bloc : sans lui, tout snippet sort en
// « miaou-snippet.<ext> », y compris quand on sait très bien ce qu'il est (le
// paramètre `query` d'un appel, le fichier `resultat.json` d'une ressource).
// Le nom traverse `sanitizeDownloadName` chez decoratePre — il peut donc venir
// du modèle sans précaution supplémentaire ici.
function _inspectCodeBlock(parent, text, lang, name) {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.className = 'language-' + (lang || 'text');
  if (name) code.setAttribute('data-filename', name);
  code.textContent = text == null ? '' : String(text);
  pre.appendChild(code);
  parent.appendChild(pre);
  decoratePre(parent);
  // Grammaire chargée à la demande PUIS colorisation : un callback sur
  // highlightElement ne suffit pas (cf. ensurePrismGrammar).
  if (typeof ensurePrismGrammar === 'function') {
    ensurePrismGrammar(lang).then(() => highlightUnder(parent)).catch(() => {});
  } else {
    highlightUnder(parent);
  }
  return pre;
}

// Ligne « clé : valeur » d'un volet. Une valeur MULTILIGNE passe en bloc plein
// format (inspectValueShape) : une requête SPL ou un JSON collé en argument est
// illisible replié sur une ligne.
function _inspectField(parent, key, value, m) {
  const shape = inspectValueShape(value);
  const row = document.createElement('div');
  row.className = 'inspect-field';
  const k = document.createElement('span');
  k.className = 'inspect-key';
  k.textContent = key;
  row.appendChild(k);
  if (shape.mode === 'inline') {
    const v = document.createElement('span');
    v.className = 'inspect-val';
    v.textContent = shape.text;
    row.appendChild(v);
    parent.appendChild(row);
  } else {
    parent.appendChild(row);
    // Nom du bloc = clé du paramètre, préfixée de l'outil (`search-query.txt`) :
    // la clé dit ce que c'est, le préfixe dit d'où ça vient. L'extension est
    // dérivée de la langue par decoratePre.
    _inspectCodeBlock(parent, shape.text, shape.lang, _inspectBlockName(m, key));
  }
  // Renvoie la ligne : `_inspectResourcePanel` en réserve certaines pour les
  // remplir après résolution du record (lot Z-2).
  return row;
}

// Réécrit la valeur d'une ligne posée par `_inspectField`. `textContent`, jamais
// d'HTML : la valeur vient d'un record d'origine modèle/serveur (piège 21).
// Sans effet si la ligne n'a pas de valeur inline (cas bloc).
function _inspectFieldSetValue(row, text) {
  const v = row && row.querySelector('.inspect-val');
  if (v) v.textContent = String(text);
}

// Volet « ressource » : ce qu'un ack désigne au-delà de son texte aplati. Le
// `result` ne porte que le texte (flattenToolResult) ; les blocs non-texte ont
// été internés en ressource IDB, et c'est `ackDownloadTarget` qui sait laquelle.
//
// Deux temps, délibérément : on peint TOUT DE SUITE ce que l'ack sait déjà
// (nom, id, mime, taille) puis on enrichit quand le record est résolu. Les
// octets vivent en IDB et le cache session peut être froid après un reload :
// bloquer l'ouverture du drawer sur un await ferait payer la latence à chaque
// consultation, y compris celles qui ne regardent que les arguments.
function _inspectResourcePanel(parent, m, target) {
  const sec = _inspectSection(parent, 'Ressource');
  // Valeurs de l'ack : disponibles sans I/O, mais ce sont des COPIES, prises au
  // moment de l'ack. Le record fait foi dès qu'il arrive (cf. plus bas).
  // Les champs de l'ACK ne sont une copie que pour les kinds `resource_*`. Un
  // `mcp_call` désignant une ressource par `[resource_ref:…]` (lot Z-2) n'a ni
  // nom, ni mime, ni taille : le volet n'afficherait qu'un identifiant nu, là
  // où le fil annonce « photo-labrador.png (1.5 MB) ». Les lignes manquantes
  // sont donc RÉSERVÉES ici, à leur place définitive, et remplies à la
  // résolution du record — qui les a, et qui fait foi de toute façon. Les créer
  // dans le `.then` les rejetterait toutes en fin de volet, derrière
  // l'identifiant, alors que le nom est ce qu'on lit en premier.
  const late = {};
  const name = m.resourceName || target.name || '';
  if (name) _inspectField(sec, 'nom', name, m);
  else late.nom = _inspectField(sec, 'nom', '…', m);
  _inspectField(sec, 'identifiant', target.by === 'resource' ? target.id : target.attId, m);
  if (m.mime) _inspectField(sec, 'type', m.mime, m);
  else late.type = _inspectField(sec, 'type', '…', m);
  if (m.size != null) _inspectField(sec, 'taille', humanSize(m.size), m);
  else late.taille = _inspectField(sec, 'taille', '…', m);

  const dl = document.createElement('button');
  dl.className = 'drawer-btn inspect-dl';
  dl.textContent = 'Télécharger';
  // Réutilise le chemin de téléchargement des acks : cache→IDB, nommage par
  // `resourceDownloadName` (assainissement PUIS extension depuis le mime), et
  // `markAckDlUnavailable` si le record a disparu. Rien de dupliqué ici.
  dl.addEventListener('click', () => downloadAckResource(target, dl));
  sec.appendChild(dl);

  const preview = document.createElement('div');
  preview.className = 'inspect-preview';
  sec.appendChild(preview);

  _inspectResolveRecord(target).then(record => {
    // Fenêtre d'await : l'utilisateur a pu fermer le drawer ou ouvrir un AUTRE
    // appel pendant la résolution. On compare l'ENTRÉE (identité d'objet), pas
    // un id — deux acks peuvent partager le même `m.id`.
    if (_inspectEntry !== m) return;
    if (!record || !record.data) {
      const gone = document.createElement('p');
      gone.className = 'inspect-empty';
      gone.textContent = 'Contenu non disponible dans ce navigateur (ressource purgée ou produite ailleurs).';
      preview.appendChild(gone);
      return;
    }
    // Le record est figé au stockage ; l'ack en est une copie potentiellement
    // plus ancienne. Même doctrine que downloadAckResource : le record prime.
    const mime = record.mime || m.mime || '';
    const size = record.size != null ? record.size
      : (record.data && record.data.byteLength != null ? record.data.byteLength : m.size);
    // Remplissage des lignes réservées : le record fait foi.
    if (late.nom) _inspectFieldSetValue(late.nom, record.name || '(sans nom)');
    if (late.type) _inspectFieldSetValue(late.type, mime || '(inconnu)');
    if (late.taille) _inspectFieldSetValue(late.taille, size != null ? humanSize(size) : '(inconnue)');
    const p = inspectResourcePresentation(mime, size);
    if (p.mode === 'thumbnail') {
      _inspectThumbnail(preview, record);
      return;
    }
    if (p.mode === 'descriptor') {
      const note = document.createElement('p');
      note.className = 'inspect-empty';
      // Refus EXPLICITE au-delà du cap, jamais un extrait qui se ferait passer
      // pour le tout : c'est exactement le défaut de l'export tronqué que cet
      // inspecteur existe pour corriger.
      note.textContent = (p.reason === 'too-big')
        ? 'Ressource trop volumineuse pour être prévisualisée (' + humanSize(size) +
          ') — utilise le téléchargement.'
        : 'Contenu binaire : pas de prévisualisation, téléchargement disponible.';
      preview.appendChild(note);
      return;
    }
    // Textuel (JSON, CSV, texte…) ou SVG. Le SVG passe par le MÊME chemin : sa
    // source est colorisée, et `decoratePre` y ajoute de lui-même le bouton
    // d'aperçu (langue `svg`), qui rend dans l'iframe sandbox — les deux
    // façons demandées, sans seconde voie de rendu.
    let text;
    try { text = utf8Decode(record.data); }
    catch (e) { text = null; }
    if (text == null) {
      const bad = document.createElement('p');
      bad.className = 'inspect-empty';
      bad.textContent = 'Contenu illisible en texte — téléchargement disponible.';
      preview.appendChild(bad);
      return;
    }
    // Un JSON stocké en ressource mérite la même mise en forme qu'un résultat
    // JSON : ré-indenté s'il parse, brut sinon.
    const shaped = (p.lang === 'json') ? inspectResultShape(text) : { text, lang: p.lang };
    // Une ressource a un vrai nom (figé au stockage) : c'est LUI qu'on propose,
    // pas un nom dérivé de l'appel — il est déjà spécifique et porte son
    // extension, le préfixer n'ajouterait rien. Le repli, lui, se préfixe comme
    // les autres blocs.
    _inspectCodeBlock(preview, shaped.text, shaped.lang,
      record.name || name || _inspectBlockName(m, 'ressource'));
  }).catch(() => { /* résolution ratée : le descripteur et le bouton restent */ });
}

// Résolution du record désigné, par la clé de SA famille : un id de ressource
// IDB et un attId scopé conversation ne se résolvent pas dans le même store —
// les aplatir ferait interroger le mauvais.
function _inspectResolveRecord(target) {
  if (target.by === 'attachment') {
    return Promise.resolve(
      typeof getCachedRecordByAttId === 'function'
        ? getCachedRecordByAttId(target.attId, target.convId) : null);
  }
  const cached = (typeof getCachedRecord === 'function' && getCachedRecord(target.id)) || null;
  if (cached) return Promise.resolve(cached);
  return getResource(target.id).catch(() => null);
}

// Vignette d'une image bitmap, cliquable vers la lightbox plein écran (même
// chemin que les images du fil : openLightboxWith, singleton à init paresseuse).
function _inspectThumbnail(parent, record) {
  const img = document.createElement('img');
  img.className = 'inspect-thumb';
  img.src = 'data:' + record.mime + ';base64,' + arrayBufferToBase64(record.data);
  img.alt = record.name || 'ressource image';
  img.title = 'Agrandir';
  img.addEventListener('click', () => {
    const full = document.createElement('img');
    full.src = img.src;
    // Dimensions RÉELLES de l'image avant celles du record : `openLightboxWith`
    // pose une boîte de taille fixe que le contenu remplit, donc un w/h faux
    // ÉTIRE l'image (la vignette, elle, n'impose rien et reste juste — c'est ce
    // qui rend l'écart visible au clic seulement).
    // Les champs `w`/`h` ne sont pas universels : ils sont figés au stockage
    // pour une pièce jointe, mais un binaire interné depuis un résultat d'outil
    // (`_storeBlock` via `[resource_ref:…]`, lot Z-2) n'en a pas — on retombait
    // alors sur le repli 800×600, un ratio arbitraire.
    // `naturalWidth`/`naturalHeight` sont disponibles sans attendre : la
    // vignette est chargée, c'est ce clic qui le prouve. Le repli du record
    // reste derrière pour un cas où l'image ne serait pas décodable.
    const w = img.naturalWidth || record.w || 800;
    const h = img.naturalHeight || record.h || 600;
    openLightboxWith(full, w, h, record.name || '', 'image');
  });
  parent.appendChild(img);
}

function renderToolInspector(m) {
  const body = $('inspect-body');
  if (!body) return;
  body.textContent = '';
  if (!m) return;

  // ── En-tête : breadcrumb du nom d'outil + intention déclarée ──────────────
  // `appendAckSep` est le séparateur › du projet, explicitement générique et
  // non réservé au MCP : on le réutilise plutôt que de recoder un chevron.
  const head = document.createElement('div');
  head.className = 'inspect-head';
  const crumb = document.createElement('div');
  crumb.className = 'inspect-crumb';
  const segs = String(m.name || '').split('__').filter(Boolean);
  if (segs.length) {
    segs.forEach((seg, i) => {
      if (i > 0) appendAckSep(crumb);
      const c = document.createElement('code');
      c.textContent = seg;
      crumb.appendChild(c);
    });
  } else {
    crumb.textContent = ackKindOf(m) || 'appel';
  }
  head.appendChild(crumb);
  if (ackIsError(m)) {
    const bad = document.createElement('span');
    bad.className = 'inspect-badge-error';
    bad.textContent = 'en échec';
    head.appendChild(bad);
  }
  body.appendChild(head);
  if (m.intent) {
    const it = document.createElement('p');
    it.className = 'inspect-intent';
    it.textContent = m.intent;
    body.appendChild(it);
  }

  // ── Requête ───────────────────────────────────────────────────────────────
  const req = _inspectSection(body, 'Requête');
  // Le code js__eval en JavaScript colorisé, jamais en string JSON : c'est le
  // cas qui a motivé le lot.
  if (m.code != null) _inspectCodeBlock(req, m.code, 'javascript', _inspectBlockName(m, 'code'));
  if (m.args != null && typeof m.args === 'object') {
    const keys = Object.keys(m.args);
    if (!keys.length) {
      const none = document.createElement('p');
      none.className = 'inspect-empty';
      none.textContent = 'Aucun argument.';
      req.appendChild(none);
    }
    // `miaou_intent` est déjà affiché en tête (il est strippé des args envoyés
    // au serveur, mais reste dans l'objet enrichi) : ne pas le répéter ici.
    // `code` non plus, déjà rendu en bloc juste au-dessus.
    keys.forEach(k => {
      if (k === 'miaou_intent' && m.intent) return;
      if (k === 'code' && m.code != null) return;
      _inspectField(req, k, m.args[k], m);
    });
  } else if (m.args != null) {
    _inspectField(req, 'arguments', m.args, m);
  } else if (m.code == null) {
    const none = document.createElement('p');
    none.className = 'inspect-empty';
    none.textContent = 'Aucun argument enregistré pour cet appel.';
    req.appendChild(none);
  }

  // ── Réponse ───────────────────────────────────────────────────────────────
  const res = _inspectSection(body, 'Réponse');
  if (m.result != null) {
    // Détacher d'abord la note de présentation que MIAOU a concaténée pour le
    // modèle : elle n'est pas la réponse de l'outil, et la laisser empêcherait
    // inspectResultShape de reconnaître un JSON (cf. splitToolResultNote).
    const split = splitToolResultNote(m.result);
    const shape = inspectResultShape(split.text);
    if (shape.text === '') {
      const empty = document.createElement('p');
      empty.className = 'inspect-empty';
      empty.textContent = 'Réponse vide.';
      res.appendChild(empty);
    } else if (resultIsOnlyResourceRefs(shape.text)) {
      // Résultat réduit à des `[resource_ref:…]` : le marqueur est CONSERVÉ
      // (l'inspecteur montre ce que l'outil a littéralement renvoyé), mais pas
      // en <pre> — un bloc de code avec en-tête de langue et boutons
      // copier/télécharger pour 26 caractères d'identifiant donne à un
      // marqueur le poids visuel d'un contenu, alors que le contenu est juste
      // en dessous, dans son volet. Registre du fil, qui affiche « Ressource
      // enregistrée › nom » et non le marqueur.
      const ref = document.createElement('p');
      ref.className = 'inspect-ref';
      ref.textContent = shape.text;
      res.appendChild(ref);
    } else {
      _inspectCodeBlock(res, shape.text, shape.lang, _inspectBlockName(m, 'resultat'));
    }
    // Note SOUS le bloc : elle commente ce qui précède, et la placer au-dessus
    // repousserait le contenu — qui est ce qu'on vient inspecter.
    if (split.note) {
      const n = document.createElement('p');
      n.className = 'inspect-note';
      n.textContent = split.note;
      res.appendChild(n);
    }
  } else {
    const none = document.createElement('p');
    none.className = 'inspect-empty';
    none.textContent = 'Aucun résultat enregistré pour cet appel.';
    res.appendChild(none);
  }

  // ── Ressource(s) désignée(s) par l'ack ────────────────────────────────────
  // Désignation par `ackInspectResourceTargets` (utils.js) : les kinds
  // `resource_*` via `ackDownloadTarget`, ET les `[resource_ref:…]` du résultat
  // d'un `mcp_call` — sans quoi l'inspecteur d'un appel ayant produit une image
  // n'en montrait que la référence. Jamais une liste de kinds réécrite ici.
  // Toutes les cibles, dans l'ordre : n'en peindre qu'une masquerait les
  // suivantes en silence.
  ackInspectResourceTargets(m).forEach(t => _inspectResourcePanel(body, m, t));

  // ── Méta ──────────────────────────────────────────────────────────────────
  const meta = _inspectSection(body, 'Méta');
  if (m.name) _inspectField(meta, 'outil', m.name, m);
  if (m.server) _inspectField(meta, 'serveur', m.server, m);
  const kind = ackKindOf(m);
  if (kind) _inspectField(meta, 'type', kind, m);
  if (m.ts) {
    _inspectField(meta, 'horodatage',
      new Date(m.ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'medium' }), m);
  }
  _inspectField(meta, 'issue', ackIsError(m) ? 'échec' : 'succès', m);
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
    // même proratisée) ; seul le TOTAL perd le `≈` quand m.real (lot Bbis).
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

// Scopée au Space actif (piège 18) : la liste raconte la MÊME histoire que
// l'injection, qui filtre déjà par `spaceConvIds` (searchSummaries, api.js).
// Afficher un résumé d'un autre Space ferait miroiter une entrée qui n'entrera
// jamais dans le contexte et dont la conversation n'est pas atteignable d'ici.
// Corollaire : le Space de chaque entrée n'a plus à être affiché (il est
// constant), et « Ouvrir » peut appeler `selectConv` sans `followSpace`.
function renderSummaryList() {
  const wrap = $('summary-list');
  wrap.innerHTML = '';
  const all = loadSummaries();
  const convs = loadConversations();
  const idsInSpace = spaceConvIds(activeSpaceId, convs);
  const ids = Object.keys(all).filter(id => idsInSpace.has(id));
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
      const sub = ['supprimé', date].filter(Boolean).join(' · ');
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
      const sub = date;
      item.className = 'mem-item';
      item.onclick = () => toggleSummaryExpand(id);
      item.innerHTML =
        `<div class="mem-header">` +
        `<div class="mem-meta"><div class="mem-title">${escHtml(e.title || 'Nouvelle conversation')}</div>` +
        `<div class="mem-sub">${escHtml(sub)}</div></div>` +
        `<button class="drawer-btn" onclick="event.stopPropagation();openSummaryConv('${id}')">Ouvrir</button>` +
        `<button class="drawer-btn danger" onclick="event.stopPropagation();deleteSummaryItem('${id}')">Supprimer</button>` +
        `</div>` +
        `<div class="mem-excerpt">${escHtml(extrait)}${full.length > 150 ? '…' : ''}</div>` +
        `<div class="mem-full">${escHtml(full)}${kws}</div>`;
    }
    wrap.appendChild(item);
  }
}

function deleteSummaryItem(id) { suppressSummary(id); renderSummaryList(); }

// Ouvre la conversation d'un résumé depuis le drawer. La liste étant scopée au
// Space actif, la conversation y est par construction : pas de `followSpace`.
// Ne ferme AUCUN drawer (décision Julien) : ce drawer s'empile volontiers sur
// Paramètres (`_drawerStack`), donc n'en fermer qu'un déboucherait sur celui du
// dessous — le fil resterait masqué. C'est tout ou rien ; on choisit rien, et
// l'utilisateur ferme au backdrop ou à Escape quand il veut voir la conversation.
function openSummaryConv(id) {
  selectConv(id, true);
}

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

  // Réchauffage AVANT lecture (lot U-1) : une conversation évincée de l'étage 2
  // sort de loadConversation avec `messages: []`, donc sans substance — la
  // tombstone était levée sans rien régénérer, en silence. Même précaution
  // qu'openConversation, qui warm avant de projeter son thread.
  await warmConversation(id);
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

// Sous-drawer « Voir les outils exposés » : groupé par namespace, nom NU
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
  // Ordre d'affichage en trois familles, pour ne PAS entrelacer l'interne et le
  // distant (sinon le tri alpha mêle `miaou › conv` et `mcp › brave`) :
  //   0. « miaou » nu (outils internes plats) — toujours en tête ;
  //   1. sous-namespaces internes `miaou__*` (memory, conv, resource…), alpha ;
  //   2. serveurs MCP distants (préfixe ≠ miaou), alpha.
  // Tri purement présentationnel : groupByNamespace reste en ordre d'apparition.
  const nsFamily = ns => ns === 'miaou' ? 0 : (ns.indexOf('miaou__') === 0 ? 1 : 2);
  const nsSortKey = ns => ns.split('__').filter(Boolean).join(' ');
  const groups = groupByNamespace(list).slice().sort(function(a, b) {
    const fa = nsFamily(a.namespace), fb = nsFamily(b.namespace);
    if (fa !== fb) return fa - fb;
    return nsSortKey(a.namespace).localeCompare(nsSortKey(b.namespace));
  });
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
    // Tri alpha par nom nu, purement présentationnel (comme le tri des
    // namespaces ci-dessus) : groupByNamespace reste en ordre d'apparition.
    const sorted = g.tools.slice().sort((a, b) => a.bareName.localeCompare(b.bareName));
    for (const t of sorted) bodyInner.appendChild(buildToolItem(t.bareName, t.def));
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

// ── Spaces / « Espaces » (sélecteur sidebar + écran, lot C) ────────
// Sélecteur pilule + .model-menu générique (règle projet : jamais de <select>
// natif), pattern le plus proche du sélecteur de modèle composer. Chaque ligne
// bascule le Space actif au clic ; un petit bouton crayon ouvre l'écran Space
// (renommage, description, souvenirs, suppression) sans changer de Space.

// Libellé pilule + badge topbar (masqué en default Space) — à
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
  syncActivityBadges();
  syncAgentCount();
}

// Applique un état de badge ('working' | 'unread' | null) sur un porteur. Un
// seul point d'écriture DOM pour les quatre surfaces (ligne de conversation,
// ligne d'Espace, sélecteur replié, hamburger) : l'apparence est entièrement
// portée par le CSS, ce qui garantit qu'aucune surface ne dérive.
function applyActivityBadge(el, state) {
  if (!el) return;
  el.classList.toggle('working', state === 'working');
  el.classList.toggle('unread', state === 'unread');
  el.hidden = !state;
}

// Crée le porteur de pastille. La classe .waiter-dot est REPRISE telle quelle
// (spec T-2) : ce n'est pas « le même genre de chose » que la pastille du
// patienteur, c'est littéralement le même objet, même sémantique (« ça
// travaille »), même token de couleur (--accent, qui suit palette ET thème sans
// un octet de configuration). Une métaphore = un usage.
function activityBadgeEl(state) {
  const dot = document.createElement('span');
  dot.className = 'waiter-dot activity-dot';
  applyActivityBadge(dot, state);
  return dot;
}

// Surfaces qui ne sont PAS reconstruites à chaque changement d'état (le
// sélecteur replié et le hamburger vivent en permanence dans le DOM) : elles
// ont besoin d'un point de synchronisation explicite.
//
// Il n'existe AUCUN événement à observer pour la visibilité de la sidebar
// (classe `sidebar-open` sur #app, posée par toggleSidebar/closeSidebarMobile/
// closeSidebarViaEscape) : la synchronisation est appelée depuis ces trois
// fonctions, jamais depuis un observateur de classe.
// Compteur d'agents en vol (lot T-2bis). Dérivé du REGISTRE, jamais de
// `sending` : ce dernier est un reflet d'écran depuis T-1 et bascule sur un
// simple changement de conversation (piège 28).
//
// La règle d'apparition vit dans resolveAgentCount (utils.js, pure et testée) :
// le compteur ne parle que quand il apprend quelque chose — une génération
// unique qu'on regarde arriver est déjà signalée par le composer en mode stop.
function syncAgentCount() {
  const el = $('agent-count');
  if (!el) return;
  const n = resolveAgentCount(_activeGenerations.size, isGenerating(currentConvId));
  el.hidden = !n;
  const label = $('agent-count-label');
  if (label) label.textContent = formatAgentCountLabel(n);
}

function syncActivityBadges() {
  // Sélecteur d'espaces replié : « y a-t-il de l'activité AILLEURS ? » — d'où
  // l'exclusion de l'Espace actif. Le corollaire à ne pas rater est que cette
  // pastille n'est PAS un porteur privilégié de l'Espace courant : au dépliage,
  // elle ne reste à côté de son libellé que s'il a lui-même du working/unread.
  const trigger = $('space-select-btn');
  if (trigger) {
    let dot = trigger.querySelector('.activity-dot');
    // Insérée AVANT le chevron, pas appendée : le chevron ferme la ligne, une
    // pastille après lui se lirait comme un second contrôle.
    if (!dot) { dot = activityBadgeEl(null); trigger.insertBefore(dot, trigger.querySelector('.chev')); }
    applyActivityBadge(dot, aggregateBadgeState(activeSpaceId));
  }
  // Hamburger : agrège TOUT, Espace actif compris. Seul indicateur
  // disponible sidebar repliée — il dit « il y a quelque chose à voir
  // là-dedans ». Sidebar OUVERTE, il s'efface : l'information est alors lisible
  // à sa source (liste de gauche, sélecteur), la redonder au point d'entrée
  // ferait clignoter deux objets pour un seul fait.
  //
  // Ce masquage est porté par le CSS (`.app.sidebar-open` — même mécanique que
  // .topbar-brand et .topbar-space-badge, déjà conditionnés à l'état replié),
  // PAS par un test JS : sans quoi il faudrait rappeler cette fonction depuis
  // toggleSidebar/closeSidebarMobile/closeSidebarViaEscape, alors qu'aucun
  // événement n'existe pour l'observer. Laisser la cascade s'en charger supprime
  // le besoin de ces trois câblages.
  const burger = $('sidebar-toggle');
  if (burger) {
    let dot = burger.querySelector('.activity-dot');
    if (!dot) { dot = activityBadgeEl(null); burger.appendChild(dot); }
    applyActivityBadge(dot, aggregateBadgeState(null));
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
  fitSpaceMenuHeight();
  menu.classList.add('show');
}

// Plafond de hauteur posé à CHAQUE ouverture, jamais une fois pour toutes : la
// place sous le bouton dépend de la hauteur du viewport, qui bouge (fenêtre
// redimensionnée, clavier mobile). Mesure prise sur le BOUTON, pas sur le menu
// — le menu est encore invisible (visibility: hidden) et surtout on veut la
// place disponible SOUS l'ancre, indépendamment du contenu déjà rendu.
function fitSpaceMenuHeight() {
  const menu = $('space-menu');
  const btn = $('space-select-btn');
  if (!menu || !btn) return;
  const vh = window.innerHeight || 0;
  const h = spaceMenuMaxHeight(btn.getBoundingClientRect().bottom, vh);
  // 0 = mesure inexploitable : on retire toute surcharge et on laisse le
  // plafond CSS de base reprendre la main plutôt que de poser une valeur fausse.
  menu.style.maxHeight = h ? h + 'px' : '';
}

function renderSpaceMenu() {
  const menu = $('space-menu');
  if (!menu) return;
  menu.innerHTML = '';
  const spaces = sortedSpacesByName(loadSpaces());
  for (const s of spaces) {
    const opt = document.createElement('div');
    opt.className = 'model-opt' + (s.id === activeSpaceId ? ' selected' : '');
    opt.innerHTML =
      `<span class="space-opt-name">${escHtml(s.name || '')}</span>` +
      `<button type="button" class="space-opt-edit" title="Modifier l'espace">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>` +
      `</button>` +
      `<span class="check">✓</span>`;
    // Pastille par ligne d'Espace : la RÈGLE EST UNIQUE — chaque Espace
    // effectivement concerné la porte. « Déplacement » et « dédoublement » ne
    // sont pas deux traitements au choix mais les deux apparences de cette même
    // règle selon le nombre d'Espaces concernés.
    opt.insertBefore(activityBadgeEl(spaceBadgeState(s.id)),
                     opt.querySelector('.space-opt-edit'));
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

  // Déclencheur du mode déplacement (brief Cter) : masqué sans destination
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
  // symétrique à la sortie du mode sélection (changer d'intention met fin au mode sélection).
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
  // Armé AVANT resetToEmpty : c'est lui qui appelle renderConvList sur ce
  // chemin (pas d'appel direct ici), et c'est ce render-là qu'on veut animer.
  animateNextConvList();
  resetToEmpty();
  syncSpaceUI();
  resetSpaceTab();
  $('space-menu').classList.remove('show');
  summarizeIfNeeded(leaving);
  armIdleSummaryTimer();
  if (isMobileLayout()) closeSidebarMobile();
}

// Variante de pickSpace pour le « follow » post-déplacement (brief Cter) :
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
  animateNextConvList();
  renderConvList();
  _lastContextManifest = null;   // la conv suivie change de Space : contexte affiché périmé (piège 16/18)
  syncContextCounter();
  armIdleSummaryTimer();
}

// Crée le Space, bascule dessus immédiatement (sinon l'utilisateur reste dans
// l'ancien Space en éditant à l'aveugle celui qu'il vient de créer), puis
// ouvre son écran avec le nom pré-sélectionné (focus + select) pour que la
// première frappe remplace directement le nom générique.
// Le Space est persisté AVANT l'ouverture de l'écran (pickSpace exige un Space
// existant) : abandonner l'écran sans enregistrer laisserait donc un « Nouvel
// espace » fantôme. `_spaceDraftId` marque ce Space comme provisoire ; il est
// consommé par onSaveSpaceScreen (premier enregistrement = le Space devient
// réel) et honoré par closeSpaceScreen (sortie sans save = rollback). Ne PAS
// remplacer ce mécanisme par un report du upsertSpace après saisie : la bascule
// immédiate est une spec (éditer le Space courant, pas à l'aveugle depuis
// l'ancien).
let _spaceDraftId = null;

function createSpaceAndOpen() {
  const id = genSpaceId();
  const previous = activeSpaceId;
  upsertSpace({ id, name: 'Nouvel espace' });
  _spaceDraftId = id;
  _spaceDraftPrevSpaceId = previous;
  pickSpace(id);
  openSpaceScreen(id);
  const nameInput = $('space-name-input');
  if (nameInput) { nameInput.focus(); nameInput.select(); }
}

// Space actif au moment de la création — cible du retour si le brouillon est
// abandonné (ne jamais retomber sur DEFAULT_SPACE_ID en dur : l'utilisateur
// serait déplacé hors du Space d'où il vient).
let _spaceDraftPrevSpaceId = null;

// Annule un brouillon de Space jamais enregistré : suppression sèche (aucune
// cascade — un Space créé il y a quelques secondes n'a ni conversation, ni
// souvenir, ni fichier) puis retour au Space d'origine. No-op si le Space
// courant n'est pas un brouillon.
function discardSpaceDraftIfAny() {
  const id = _spaceDraftId;
  if (!id) return;
  _spaceDraftId = null;
  const back = _spaceDraftPrevSpaceId || DEFAULT_SPACE_ID;
  _spaceDraftPrevSpaceId = null;
  deleteSpaceEntry(id);
  if (activeSpaceId === id) pickSpace(getSpace(back) ? back : DEFAULT_SPACE_ID);
  renderSpaceMenu();
  syncSpaceUI();
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

// Point de sortie UNIQUE de l'écran (croix, backdrop, Escape via trackDrawer) :
// le rollback du brouillon s'y greffe une seule fois, pas sur chaque câblage.
// onSaveSpaceScreen consomme _spaceDraftId avant d'appeler ici, donc un
// enregistrement ne déclenche jamais la suppression.
function closeSpaceScreen() {
  $('space-drawer').classList.remove('show');
  $('space-backdrop').classList.remove('show');
  _spaceScreenId = null;
  discardSpaceDraftIfAny();
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
  // Enregistrement réussi : le brouillon devient un Space réel. Consommé AVANT
  // closeSpaceScreen (qui rollbacke tout brouillon encore marqué).
  if (_spaceDraftId === _spaceScreenId) { _spaceDraftId = null; _spaceDraftPrevSpaceId = null; }
  upsertSpace(Object.assign({}, space, {
    name: _spaceScreenId === DEFAULT_SPACE_ID ? (space.name || 'Général') : name,
    description: $('space-description-input').value,
  }));
  renderSpaceMenu();
  syncSpaceUI();
  closeSpaceScreen();
}

// Libellé du bouton de suppression AVEC comptes (piège 18 : passe par
// spaceConvIds, jamais un filtre c.spaceId réécrit localement). Async (lot
// Cbis) : le compte fichiers vient d'IDB (getResourcesBySpace).
async function spaceDeleteLabel(id) {
  const convCount = spaceConvIds(id, loadConversations()).size;
  const memCount = loadMemories().filter(m => (m.scope || DEFAULT_SPACE_ID) === id && !m.suppressed).length;
  const fileCount = (await getResourcesBySpace(id)).length;
  return `Supprimer (${convCount} conv., ${memCount} souvenir${memCount > 1 ? 's' : ''}, ${fileCount} fichier${fileCount > 1 ? 's' : ''})`;
}

// Libellé du bouton de suppression, posé dès l'ouverture de l'écran (pas
// seulement recalculé au clic) : l'utilisateur doit voir l'impact avant même
// d'armer le bouton, pas seulement lire « Supprimer cet espace ». La première
// peinture peut afficher un compte fichiers en retard d'un tick, comme le
// reste du cache session library (cf. piège 18/CLAUDE.md).
async function syncSpaceDeleteLabel(id) {
  const btn = $('space-delete-btn');
  if (!btn) return;
  btn.textContent = await spaceDeleteLabel(id);
}

// Suppression d'un Space : arm-then-run (même pattern que la poubelle sidebar),
// cascade = boucle deleteConv sur les conversations du Space + purge des
// souvenirs scopés + purge des fichiers de bibliothèque (lot Cbis) ; les
// souvenirs profile restent intacts. Le default Space n'a pas de bouton
// (masqué dans openSpaceScreen) — rien à protéger ici.
async function onDeleteSpaceScreen() {
  const btn = $('space-delete-btn');
  if (!_spaceScreenId || _spaceScreenId === DEFAULT_SPACE_ID) return;
  const id = _spaceScreenId;
  const label = await spaceDeleteLabel(id);
  armThenRun(btn, async () => {
    const wasActive = id === activeSpaceId;
    for (const convId of spaceConvIds(id, loadConversations())) {
      deleteConv(convId);
    }
    for (const m of loadMemories().filter(m => (m.scope || DEFAULT_SPACE_ID) === id)) {
      forgetMemory(m.id);
    }
    for (const f of await getResourcesBySpace(id)) {
      await deleteResource(f.id);
    }
    deleteSpaceEntry(id);
    // Suppression explicite d'un Space encore à l'état de brouillon (créé puis
    // supprimé sans passer par Enregistrer) : désarmer le drapeau, sinon le
    // closeSpaceScreen ci-dessous rejouerait un rollback sur un id déjà supprimé.
    if (_spaceDraftId === id) { _spaceDraftId = null; _spaceDraftPrevSpaceId = null; }
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

// ── Sous-drawer « Serveurs MCP » (cartes éditables) ───────────────────
function openMcpServers() {
  renderMcpServers();
  $('mcp-drawer').classList.add('show');
  $('mcp-backdrop').classList.add('show');
}
function closeMcpServers() {
  $('mcp-drawer').classList.remove('show');
  $('mcp-backdrop').classList.remove('show');
}
// Drawer « Serveurs API » ouvert ? (bascule du serveur actif depuis le sélecteur
// composer : la carte « Actif » doit suivre si le drawer est visible.)
function renderApiServersIfOpen() {
  if ($('api-drawer') && $('api-drawer').classList.contains('show')) renderApiServers();
}

// Pastille de topbar « des serveurs attendent une autorisation ».
//
// Le prédicat d'apparition ET le libellé viennent d'une fonction pure et testée
// (`resolveAuthorizationPending`), cette fonction ne fait qu'appliquer — même
// séparation que `syncAgentCount`/`resolveAgentCount`.
//
// Appelée depuis les DEUX fonctions de rendu des cartes MCP plutôt que depuis
// chacun des points qui mutent l'état (connexion, déconnexion, sauvegarde,
// suppression, toggle, boot, revérification au focus). Ces points sont nombreux
// et convergent tous vers un rendu : s'y accrocher est un point de passage
// obligé, alors qu'en câbler sept laisserait le huitième mentir en silence.
function syncAuthorizationPending() {
  const el = $('auth-pending');
  if (!el) return;
  const pending = resolveAuthorizationPending(mcpStatusSnapshot());
  el.hidden = !pending.visible;
  const label = $('auth-pending-label');
  if (label) label.textContent = pending.label;
}

function renderMcpServersIfOpen() {
  // La pastille se synchronise INCONDITIONNELLEMENT, contrairement aux cartes :
  // elle vit en topbar, hors du drawer, et n'a aucune raison d'attendre qu'on
  // l'ouvre. C'est même son intérêt — signaler sans qu'on soit allé voir. D'où
  // cet appel ici EN PLUS de celui de `renderMcpServers` : le drawer fermé,
  // celle-ci ne tourne pas, et le boot passe précisément par là.
  syncAuthorizationPending();
  if ($('mcp-drawer') && $('mcp-drawer').classList.contains('show')) renderMcpServers();
}

// Drawer skills ouvert ? (synchro multi-onglets, lot J : re-render du drawer sur
// réception `skills-updated` seulement s'il est visible.)
function isSkillsDrawerOpen() {
  const el = $('skills-drawer');
  return !!(el && el.classList.contains('show'));
}

function renderMcpServers() {
  // Ici et pas seulement dans `renderMcpServersIfOpen` : six sites appellent
  // celle-ci directement (sauvegarde, suppression, toggle, ouverture du
  // drawer, rehydratation multi-onglets), et n'accrocher que l'autre en
  // laisserait la moitié sans mise à jour.
  syncAuthorizationPending();
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
// au fil de la saisie d'URL (pré-remplissage, jamais override).
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

  // Pill de statut — masquée si désactivé. L'état ET le libellé viennent du
  // prédicat pur `mcpStatusPill` : les composer ici rendrait le quatrième état
  // (« connecté, mais des upstreams attendent ») invisible au test.
  const viewStatus = document.createElement('div');
  viewStatus.className = 'mcp-status';
  const liveStatus = (!isNew && server.enabled !== false) ? getMcpStatus(originalName) : null;
  const pill = mcpStatusPill(liveStatus);
  if (pill) {
    if (pill.tone !== 'connecting') viewStatus.classList.add(pill.tone);
    viewStatus.textContent = pill.text;
  }
  viewRow.appendChild(viewStatus);

  // Bouton Modifier — pattern .drawer-btn de la gestion des souvenirs
  const modBtn = document.createElement('button');
  modBtn.className = 'drawer-btn';
  modBtn.textContent = 'Modifier';
  modBtn.addEventListener('click', () => card.classList.add('is-editing'));
  viewRow.appendChild(modBtn);

  viewSection.appendChild(viewRow);

  // Une ligne par upstream à autoriser (lot AB-5). Sous la pill, parce qu'elles
  // en détaillent le compte : la pill dit combien, ces lignes disent lesquels et
  // offrent l'action. Avec N upstreams, N lignes — MIAOU raisonne en serveur
  // configuré, le proxy en upstreams agrégés, et c'est ce décalage qui interdit
  // un booléen ici.
  const pendingUpstreams = (liveStatus && Array.isArray(liveStatus.unauthorizedUpstreams))
    ? liveStatus.unauthorizedUpstreams : [];
  for (const up of pendingUpstreams) {
    const row = document.createElement('div');
    row.className = 'mcp-upstream-row';

    const label = document.createElement('span');
    label.className = 'mcp-upstream-name';
    label.textContent = up.name;
    row.appendChild(label);

    // BOUTON, pas un lien nu : l'affordance de l'ack est discrète parce qu'elle
    // s'insère dans une ligne d'erreur, ici on veut une action franche. Et son
    // origine n'a pas à être affichée pour être vérifiée — elle vient de l'URL
    // que l'utilisateur a lui-même saisie sur cette carte, visible juste
    // au-dessus, pas d'un tiers.
    const authUrl = composeAuthorizationUrl(server.url, up.authorizePath);
    if (authUrl) {
      const btn = document.createElement('button');
      btn.className = 'drawer-btn mcp-authorize-btn';
      btn.textContent = 'Autoriser';
      btn.addEventListener('click', () => window.open(authUrl, '_blank', 'noopener'));
      row.appendChild(btn);
    } else {
      // Chemin absent ou refusé par la garde de composition : on garde la
      // ligne, sans action. Savoir qu'il faut autoriser reste utile même sans
      // savoir où cliquer — même doctrine que l'ack sans lien.
      const note = document.createElement('span');
      note.className = 'mcp-upstream-note';
      note.textContent = 'accès à autoriser';
      row.appendChild(note);
    }
    viewSection.appendChild(row);
  }

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
  // ne l'écrase jamais ; serveur existant → touché d'office.
  const transport = cfgPillSelect('mcp-transport', [
    { value: 'streamable-http', label: 'streamable-http' },
    { value: 'sse', label: 'sse' },
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
  // Le libellé « sse » reste nu dans la pilule (harmonisation des dropdowns) :
  // l'avertissement « différé » vit dans le hint du champ, pas dans l'option —
  // `sse` lève à l'usage (mcpRpc, tools.js), l'info ne doit pas disparaître.
  editSection.appendChild(cfgField('Transport', transport.root,
    'streamable-http seul est implémenté ; sse est différé.'));
  editSection.appendChild(cfgField('Jeton d\'autorisation', tokenI, 'Stocké en clair (localStorage) — usage non-prod encouragé.'));
  editSection.appendChild(cfgField('Timeout (ms)', tmoI));
  editSection.appendChild(cfgField('Outils autorisés', allowI));
  editSection.appendChild(cfgField('Outils masqués', denyI));

  // Toggle en mode édition (.mcp-enabled lu par onSaveMcpCard)
  editSection.appendChild(cfgToggleRow('mcp-enabled', server.enabled !== false, 'Activé').row);

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
  wrap.insertBefore(buildApiCard({ id: '', name: '', url: '', key: '', model: '', disabled: false }, true, false), wrap.firstChild);
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
  } else if (server.disabled) {
    // Mis de côté : on dit l'état ET on garde la transition (c'est la seule voie
    // pour réactiver un serveur sans passer par l'édition de la carte).
    const viewStatus = document.createElement('div');
    viewStatus.className = 'api-status disabled';
    viewStatus.textContent = '○ Mis de côté';
    viewRow.appendChild(viewStatus);
    const useBtn = document.createElement('button');
    useBtn.className = 'drawer-btn';
    useBtn.textContent = 'Utiliser ce serveur';
    useBtn.addEventListener('click', () => onUseApiServer(originalId));
    viewRow.appendChild(useBtn);
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

  // Flag vision manuel (brief A2) : mitigation du silent-failure Ollama
  // (un modèle sans projecteur vision accepte l'image sans erreur puis lit le
  // placeholder [img-0] comme du texte). Réglé par (serveur, modèle courant) ;
  // « Sans vision » remplace proactivement les parts image par un descripteur.
  // Valeur initiale sur le modèle actuellement saisi. `.api-vision` (hidden)
  // porte 'on'/'off', lu par onSaveApiCard. Pas de select natif (cfgPillSelect).
  const visionPill = cfgPillSelect('api-vision', [
    { value: 'on', label: 'Activée' },
    { value: 'off', label: 'Sans vision' },
  ], serverModelVisionEnabled(server, server.model) ? 'on' : 'off');
  // Le flag suit le modèle : changer de modèle réévalue l'état affiché depuis la
  // map `vision` du serveur (un modèle non encore réglé retombe sur « activées »).
  modelI.addEventListener('change', () => {
    visionPill.setValue(serverModelVisionEnabled(server, modelI.value.trim()) ? 'on' : 'off');
  });
  editSection.appendChild(cfgField('Vision (images)', visionPill.root,
    'Si ce modèle ne sait pas lire les images, choisir « Sans vision » : MIAOU enverra un descripteur textuel à la place.'));

  // Flag `disabled` : un serveur mis de côté n'est plus interrogé pour peupler le
  // sélecteur serveur/modèle du composer, ni retenu comme repli d'activeApiServer().
  // Il reste activable explicitement depuis cette carte. `.api-disabled` (hidden)
  // porte 'on'/'off', lu par onSaveApiCard.
  const enabledPill = cfgPillSelect('api-disabled', [
    { value: 'on', label: 'Actif' },
    { value: 'off', label: 'De côté' },
  ], server.disabled ? 'off' : 'on');
  editSection.appendChild(cfgField('Disponibilité', enabledPill.root,
    'Mis de côté : ce serveur n\'apparaît plus dans le sélecteur serveur/modèle du composer.'));

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
  clearComposerError();
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

// Canal d'erreur GÉNÉRIQUE du composer : une ligne sous la zone de saisie, pour
// tout refus qui doit rester visible sans modale ni toast. Nommé d'après la
// SURFACE, pas d'après le premier appelant — il s'est appelé
// `showComposerSkillError` jusqu'au lot X-1f, hérité de la validation de slash-
// skills, alors qu'il portait déjà des refus sans rapport (dont, brièvement, le
// « cette conversation est celle d'un agent » que X-1f a retiré). Un canal
// nommé d'après un de ses usages invite chaque nouvel appelant à se demander
// s'il a le droit de s'en servir, ou à en ouvrir un deuxième.
//
// Distinct de `showComposerAttachError` (main.js), et ce n'est pas un oubli :
// leurs cycles de vie diffèrent. Celui-ci est purgé à chaque frappe
// (`onComposerInput`) parce que ses refus portent sur le TEXTE en cours ; celui
// des pièces jointes survit à la frappe, son objet étant la pile d'attachements.
// Les fusionner ferait qu'écrire une lettre efface un refus d'attache.
function showComposerError(msg) {
  const el = $('composer-error');
  if (el) { el.textContent = msg; el.removeAttribute('hidden'); }
}
function clearComposerError() {
  const el = $('composer-error');
  if (el) { el.setAttribute('hidden', ''); el.textContent = ''; }
}

// ── Cascade de rendu des blocs NON-text d'un résultat d'outil distant ────
// Placés DANS la bulle assistant, avant le corps (comme les acks). Éphémères :
// jamais persistés, disparaissent au reload. DOM-safe : textContent ou
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
  // Nom proposé au téléchargement : le bloc est construit par MIAOU (pas une
  // fence du modèle), donc `filename=` n'existe pas — on pose nous-mêmes le
  // data-filename que decoratePre lira, dérivé du nom de la ressource et de son
  // mime via le nommeur PARTAGÉ resourceDownloadName (mêmes règles que le
  // téléchargement d'une ressource depuis son ack : un seul jeu de règles de
  // nommage, jamais deux). Sans lui, decoratePre retombait sur
  // « miaou-snippet.txt », qui perd et le nom et l'extension.
  const dlName = resourceDownloadName(resource.uri, resource.mimeType);
  if (dlName) code.setAttribute('data-filename', dlName);
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
  if (m.indexOf('csv') >= 0) return 'csv';
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
//    écran Space = scope de ce Space, lot C) ────────────────────────
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

// Promotion Space → profile (UI-only, lot C) : réécrit le scope en
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

// ── Bibliothèque de fichiers d'espace (lot Cbis) ─────────────────────────
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
      `</div>` +
      // Téléchargement en GLYPHE dans l'en-tête (pas un bouton texte) : la
      // colonne latérale fait ~210 px utiles, un troisième bouton texte faisait
      // wrapper la rangée sur deux lignes. L'en-tête est déjà le porteur
      // d'actions des cartes (cf. les cartes de résumé) et surplombe
      // directement le nom ; on ne le pose PAS dans `.mem-content`, qui est en
      // `word-break: break-word` — un nom long y ferait flotter l'icône à une
      // position imprévisible. Même glyphe que l'ack (ICON_DOWNLOAD).
      `<button class="mem-dl" title="Télécharger" onclick="onDownloadSpaceFile(this,'${e.id}')">${ICON_DOWNLOAD}</button>` +
      `</div>` +
      `<div class="mem-content">${escHtml(e.name)}</div>` +
      descriptionLine +
      `<div class="drawer-btns" id="file-btns-${e.id}">` +
      `<button class="drawer-btn" onclick="onRegenerateFileDescription(this,'${e.id}','${spaceId}')">${e.description ? 'Régénérer la description' : 'Générer une description'}</button>` +
      `<button class="drawer-btn danger" onclick="onDeleteSpaceFile(this,'${e.id}','${spaceId}')">Supprimer</button>` +
      `</div>`;
    wrap.appendChild(item);
  }
}

// Statut de description par carte : « description en cours… » pendant le
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
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Régénérer la description'; }
  } else if (status === 'failed') {
    if (line) line.textContent = '';
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Générer une description'; }
  }
}

// Action manuelle « Régénérer la description » — force le calcul même si le
// toggle est OFF ou qu'une description existe déjà (contrairement au trigger
// d'ingestion).
async function onRegenerateFileDescription(btn, fileId, spaceId) {
  await describeFileIfNeeded(fileId, (status) => {
    if (status === 'done') {
      getResource(fileId).then(rec => setFileDescriptionStatus(fileId, 'done', rec && rec.description));
    } else {
      setFileDescriptionStatus(fileId, status);
    }
  }, true);
}

// Téléchargement d'un fichier de bibliothèque (lot V). L'entrée listée porte la
// méta, pas forcément les bytes : `getResource` (IDB) est la source, le cache
// session n'est qu'un raccourci — même posture que downloadAckResource, dont on
// réutilise le nommage (`resourceDownloadName`) pour ne pas avoir deux règles
// de nom de fichier. Pas de vérification de Space ici : l'id vient de la liste
// déjà scopée par `getResourcesBySpace` (piège 18, herméticité).
async function onDownloadSpaceFile(btn, fileId) {
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  try {
    let record = (typeof getCachedRecord === 'function' && getCachedRecord(fileId)) || null;
    if (!record) { try { record = await getResource(fileId); } catch (e) { record = null; } }
    if (!record || !record.data) {
      // Bouton icône : l'indisponibilité passe par la même classe `unavailable`
      // que l'ack (markAckDlUnavailable) — pas de libellé à réécrire, et un
      // seul vocabulaire visuel entre les deux surfaces.
      if (btn) {
        btn.classList.add('unavailable');
        btn.title = 'Fichier non disponible';
      }
      return;
    }
    downloadFile(
      resourceDownloadName(record.name, record.mime),
      record.data, record.mime || 'application/octet-stream');
  } finally {
    if (btn && !btn.classList.contains('unavailable')) btn.disabled = false;
  }
}

function onSpaceFilesUploadClick() {
  const input = $('space-file-input');
  if (input) { input.value = ''; input.click(); }
}

// Upload direct (voie 1) : mêmes caps que le composer (ingestLibraryFile,
// main.js), mais aucune notion d'attId/conversation ici — chaque fichier
// rejoint directement la bibliothèque du Space actif (onglet sidebar,
// indépendant de l'écran Space qui peut être fermé). Chemin d'ingestion UNIQUE
// des deux entrées utilisateur (bouton « Ajouter un fichier » et drag&drop sur
// le panneau) : une seule séquence ingestion → re-render → trigger de description.
async function ingestLibraryFiles(fileList) {
  const files = Array.from(fileList || []);
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
  // Trigger de description après le re-render (statut par carte visible dès le premier tick) :
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

async function onSpaceFilesSelected(input) {
  await ingestLibraryFiles(input.files);
}

// Drag&drop de fichiers vers la bibliothèque de l'espace (onglet « Fichiers »
// de la sidebar). La zone est le panneau entier (#space-files-panel, `flex: 1`
// — toute la hauteur sous les onglets), pattern .dragover identique au composer
// et au drawer skills. La condition « seulement en mode bibliothèque » est
// STRUCTURELLE, pas un test JS : le panneau porte `hidden` sur les deux autres
// onglets, il ne reçoit alors aucun événement de drag — rien à resynchroniser
// depuis selectSpaceTab. Aucun filtre de type ici (contrairement au drawer
// skills, restreint au .md) : la bibliothèque accepte les mêmes familles que le
// composer, et le tri par caps est déjà celui d'ingestLibraryFile.
function onSpaceFilesDragOver(e) {
  e.preventDefault();
  const dz = $('space-files-panel');
  if (dz) dz.classList.add('dragover');
}
function onSpaceFilesDragLeave(e) {
  const dz = $('space-files-panel');
  if (dz && (!e.relatedTarget || !dz.contains(e.relatedTarget))) dz.classList.remove('dragover');
}
function onSpaceFilesDrop(e) {
  e.preventDefault();
  const dz = $('space-files-panel');
  if (dz) dz.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (files && files.length) ingestLibraryFiles(files);
}

// Suppression d'un fichier de bibliothèque : arm-then-run (même pattern que
// la poubelle sidebar/mémoire), pas de tombstone — le brief ne prévoit pas
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
// bodyHtml : contenu HTML AUTHOR-CONTROLLED UNIQUEMENT (posé en innerHTML sans
// échappement) — jamais de donnée modèle brute ici sans escHtml au préalable.
// L'unique appelant actuel (onHalt, main.js) passe ''.
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
  '--ok', '--err', '--err-soft',
  '--r', '--r-sm', '--ease',
  '--sans', '--mono',
  '--topbar-bg', '--scrollbar-thumb-hover', '--table-stripe',
  '--code-bg', '--code-head-bg', '--code-inline-color',
];

// Lit les valeurs RÉSOLUES (thème effectif, data-theme déjà tranché light|dark)
// via getComputedStyle — voie runtime tranchée (audit §5) : zéro modif
// build.py, capture automatiquement toute évolution des valeurs de tokens
// (mais PAS l'ajout d'un nouveau nom : cf. THEME_TOKENS ci-dessus).
function readThemeTokens() {
  const cs = getComputedStyle(document.documentElement);
  return THEME_TOKENS.map(name => name + ':' + cs.getPropertyValue(name).trim() + ';').join('');
}

// Sérialise les DEUX jeux de tokens pour que l'export interactif puisse
// basculer de thème (bouton posé par EXPORT_SCRIPT) — même forme que
// theme-light.css et PRISM_THEME_CSS : `:root` porte le sombre, le clair
// surcharge sous `html[data-theme="light"]`. PAS de @media
// (prefers-color-scheme) : theme-light.css proscrit explicitement ce doublon
// (« UNE seule variante ») et l'export s'aligne. Conséquence assumée
// (arbitrage Julien) : un export NON interactif reste figé sur le thème actif
// à l'export, sans suivi de l'OS — statu quo, pas une régression.
//
// Les tokens du thème inactif ne sont lisibles QUE sur documentElement : les
// sélecteurs sont ancrés sur `html`, un élément détaché ou hors écran portant
// data-theme ne les résout pas (spike tranché). D'où la bascule temporaire de
// l'attribut, ENTIÈREMENT SYNCHRONE (aucun await entre bascule et restauration
// → aucun repaint intercalé, invisible) et sous try/finally. On touche
// l'attribut EN DIRECT, jamais via applyTheme (hooks Mermaid/accueil) ni
// selectTheme (persistance + broadcast multi-onglets, piège 24).
// Construit le sélecteur « thème clair » d'un export pour une cible donnée.
// UNE seule formule, partagée par les tokens et par les surcharges Prism —
// deux formules divergentes redonneraient le bug « l'icône change mais pas les
// couleurs ». La case (#theme-switch) est la source de vérité ; `:has()` permet
// de remonter jusqu'à un ancêtre de la cible, donc de fonctionner SANS
// JavaScript (visionneuses type Quick Look iOS).
function exportLightSelector(target) {
  return target === 'body'
    ? 'body:has(#theme-switch:checked)'
    : 'body:has(#theme-switch:checked) ' + target;
}

// PRISM_THEME_CSS est écrite avec des préfixes `html[data-theme="light"]`
// (hérités du lot G, et toujours la forme utilisée par l'app à l'écran). Dans
// l'EXPORT, l'attribut n'est plus la source de vérité : on réécrit ces préfixes
// vers la case. Réécriture à l'usage plutôt que constante en dur → la copie
// figée du thème Prism reste lisible et resynchronisable telle quelle
// (dette assumée documentée), et une seule formule gouverne le thème clair.
function prismThemeCssForExport() {
  return PRISM_THEME_CSS.replace(/html\[data-theme="light"\] /g,
                                 exportLightSelector('body') + ' ');
}

function serializeThemeTokens() {
  const root = document.documentElement;
  const active = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  const activeCss = readThemeTokens();
  let otherCss;
  try {
    root.setAttribute('data-theme', active === 'light' ? 'dark' : 'light');
    otherCss = readThemeTokens();
  } finally {
    root.setAttribute('data-theme', active);
  }
  const darkCss = active === 'dark' ? activeCss : otherCss;
  const lightCss = active === 'light' ? activeCss : otherCss;
  // Les tokens sont portés par `body`, PAS `:root` : la bascule sans JS repose
  // sur une case à cocher (#theme-switch, premier enfant de body) et un
  // sélecteur de frère — un frère ne peut pas remonter jusqu'à <html>. Depuis
  // body les variables héritent à tout le document, ce qui revient au même.
  //
  // Deux voies de surcharge claire, volontairement redondantes :
  //  - `body:has(#theme-switch:checked)` : fonctionne **sans JavaScript**
  //    (visionneuses type Quick Look iOS, qui n'exécutent aucun script).
  //    `:has()` évite d'énumérer les frères de la case — sinon tout nouveau
  //    bloc de premier niveau devrait être ajouté à la liste, et le fond de
  //    `body` lui-même resterait non couvert.
  //  - `html[data-theme="light"] body` : posée par EXPORT_SCRIPT quand le JS
  //    tourne (et par buildExportHtml pour le thème d'ouverture).
  // La case reflète le thème d'export à la génération ; le JS, quand il est
  // présent, la garde synchronisée avec l'attribut.
  // La CASE est la seule source de vérité du thème dans l'export — pas
  // l'attribut. Un `html[data-theme]` figé par buildExportHtml gagnerait sur
  // elle en permanence : sans JS pour le mettre à jour, le clic changeait
  // l'icône mais pas les couleurs (bug constaté). L'attribut n'est donc plus
  // posé du tout ; EXPORT_SCRIPT le reflète pour Prism (cf. exportLightSelector).
  return 'body{' + darkCss + '}' + exportLightSelector('body') + '{' + lightCss + '}';
}

// Copie figée de prism-tomorrow.min.css (thème Prism dark chargé depuis le
// CDN, cf. index.html) + les overrides Prism clair de theme-light.css.
// Dette assumée (docs/exports.md) : à resynchroniser si le thème Prism CDN
// change. Pas de <link> CDN dans l'export (zéro-JS) : les <span> de
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
/* Sur mobile, le zoom 0.9 (confortable sur grand écran, où il donne de l'air à
   une colonne de 900px) rend le texte trop petit : on revient à 100 % sous le
   point de rupture 767px, le même que responsive.css. Retour Julien après test
   sur mobile. Indissociable du <meta viewport> ajouté au même lot dans
   buildExportHtml : sans lui cette media query ne se déclencherait jamais. */
@media (max-width: 767px) {
  html { zoom: 1; }
  .export-body { padding: 16px 14px; }
  .export-topbar { padding: 12px 14px; }
  .export-footer { padding: 16px 14px; }
}
body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.5; margin: 0; }
/* Scrollbars : copie des règles de base.css (EXPORT_CSS est une feuille figée,
   rien ne s'y propage — cf. piège 22). Utile surtout aux blocs de code, dont le
   <code> scrolle horizontalement quand une ligne déborde ; sans ça WebKit y
   pose sa barre par défaut, épaisse et hors palette. Les deux tokens employés
   (--border-2, --scrollbar-thumb-hover) sont déjà dans THEME_TOKENS, donc
   sérialisés pour les DEUX thèmes : la barre suit la bascule claire/sombre.
   scrollbar-color/-width est la voie standard (seule que Firefox comprenne) ;
   elle n'a pas d'état :hover, d'où le pouce figé sur --border-2 côté Firefox. */
* { scrollbar-width: thin; scrollbar-color: var(--border-2) transparent; }
::-webkit-scrollbar { width: 7px; height: 7px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-2); border-radius: 10px; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
.export-topbar-wrap { border-bottom: 1px solid var(--border); }
/* Le padding droit RÉSERVE la place du bouton de thème : celui-ci est en
   position:fixed (contrainte du sélecteur :has(), cf. serializeThemeTokens) donc
   hors du flux — sans cette réserve, un titre long passe DESSOUS et se fait
   amputer (constaté sur iPhone). 34px de bouton + 16px de marge + respiration.
   La variante tactile (bouton 40px) ajoute sa propre réserve plus bas. */
.export-topbar { max-width: 900px; margin: 0 auto; padding: 14px 20px; padding-right: 66px; box-sizing: border-box; display: flex; align-items: center; gap: 10px; }
.export-logo { width: 44px; height: 44px; flex-shrink: 0; }
/* Le cartouche ne porte plus que logo + titre (la date est passée au footer,
   décision Julien) : plus de marge basse, plus de règle .export-meta. */
.export-title { font-size: 16px; font-weight: 600; margin: 0; }
.export-body { max-width: 900px; margin: 0 auto; padding: 20px; box-sizing: border-box; }
/* Sans cartouche (Markdown sans titre h1), le corps est le premier élément de
   la page : il lui faut sa propre respiration en haut, celle que la barre de
   séparation du cartouche apporte sinon. */
.export-body:first-child { padding-top: 40px; }
.export-footer-wrap { border-top: 1px solid var(--border); }
.export-footer { max-width: 900px; margin: 0 auto; padding: 20px; font-size: 11px; color: var(--text-3); box-sizing: border-box; }
/* Le lien du dépôt se signale par la couleur d'accent, sans soulignement de
   base : dans un footer gris de 11px, l'orange tranche assez pour être lu
   comme lien. Le soulignement n'apparaît qu'au survol, pour accuser le
   ciblage. (Une variante « couleur héritée + pointillé permanent » a été
   essayée puis abandonnée : le pointillé était visuellement bruyant et son
   espacement n'est pas réglable en CSS standard.) */
.export-brand { color: var(--accent); text-decoration: none; }
.export-brand:hover { text-decoration: underline; text-underline-offset: 2px; }
.msg { display: flex; flex-direction: column; }
.msg.user { align-items: flex-end; margin: 24px 0 10px; }
.msg.user .bubble { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r); padding: 8px 13px; max-width: 80%; word-break: break-word; text-align: left; }
.msg.user .bubble .body { font-size: 13.5px; line-height: 1.6; }
/* Reponse d'agent repliee (X-1e). details natif : le repli fonctionne dans un
   export NON interactif, aucun JS requis. Meme markup qu'a l'ecran
   (agentResultBodyHtml partagee), mais feuille distincte — piege 22. */
.msg.user.agent-result { align-items: stretch; }
.msg.user.agent-result .msg-user-footer { justify-content: flex-end; }
.msg.user.agent-result .bubble { max-width: 100%; background: transparent; border: none; padding: 0; }
.agent-result-box { border: 1px solid var(--border); border-radius: var(--r); background: var(--surface); }
.agent-result-box > summary { cursor: pointer; list-style: none; display: block; }
.agent-result-box > summary::-webkit-details-marker { display: none; }
.agent-result-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 13px; }
.agent-result-box[open] > summary .agent-result-head { border-bottom: 1px solid var(--border); }
.agent-result-box > summary:hover .agent-result-head { background: var(--surface-2); border-radius: var(--r); }
.agent-result-box[open] > summary:hover .agent-result-head { border-radius: var(--r) var(--r) 0 0; }
.agent-result-chevron { flex: 0 0 auto; opacity: .7; transition: transform .15s ease; }
.agent-result-box[open] .agent-result-chevron { transform: rotate(90deg); }
.agent-result-icon { flex: 0 0 auto; opacity: .8; }
.agent-result-intent { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-result-status { flex: 0 0 auto; color: var(--text-2); font-size: 12px; }
.msg.user.agent-result .body { padding: 10px 12px; font-size: 13.5px; line-height: 1.6; }
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
/* Débordement centré des grands tableaux — portage de chat.css (.table-bleed),
   PAS une propagation : EXPORT_CSS est figée, les deux jeux de règles évoluent
   séparément. Le porteur est posé par wrapWideTables, partagée avec l'écran.
   Bornes différentes ici, et c'est tout ce qui change : pas de sidebar ni de
   --col, la colonne est .export-body et la place disponible se lit directement
   sur le viewport, sans container query. Les 860px sont sa largeur de CONTENU
   (900 de box moins 2x20 de padding, box-sizing: border-box) : prendre 900
   décalerait tout de 20px de chaque côté et ferait déborder même un tableau qui
   tient dans la colonne. Les 40px retranchés du viewport sont la gouttière qui
   empêche le tableau de coller au bord de la fenêtre. */
.table-bleed { --table-bleed: max(0px, calc(100vw - 40px - 860px)); margin: 12px calc(var(--table-bleed, 0px) / -2); width: calc(100% + var(--table-bleed, 0px)); }
.body table { display: block; width: fit-content; min-width: calc(100% - var(--table-bleed, 0px)); max-width: 100%; margin: 0 auto; overflow-x: auto; border-collapse: collapse; font-size: 13px; }
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
.tool-trace-summary-text { display: block; color: var(--text-2); margin-bottom: 4px; }
.tool-trace ul { list-style: none; margin: 6px 0 0; padding: 4px 0 4px 10px; border-left: 2px solid var(--accent-bd); }
.tool-trace li { margin-bottom: 6px; padding-top: 6px; }
.tool-trace li:first-child { padding-top: 0; border-top: none; }
.tool-trace li + li { border-top: 1px solid var(--border); }
.tool-trace code { font-family: var(--mono); font-size: 11.5px; }
/* Code exécuté par js__eval (lot L) : bloc <pre> COMPLET dans la trace d'outil,
   seule trace du code (absent du thread live). EXPORT_CSS est une feuille figée
   qui ne suit PAS chat/tools/composer.css (piège 22) — règle dédiée ici. */
.tool-ack-code { margin: 4px 0 2px; padding: 8px 10px; background: var(--code-bg); border: 1px solid var(--border); border-radius: 5px; overflow-x: auto; white-space: pre; }
.tool-ack-code code { font-family: var(--mono); font-size: 11px; line-height: 1.5; color: var(--text-2); }
/* Trois paliers (lot N) : replié, .tool-trace ne montre QUE le compteur
   (summary externe) ; ouvert, .tool-trace-toggle apparaît sur la liste
   d'intents (état par défaut du groupe de radios) ; cliquer dessus bascule
   au détail JSON, cliquer sur le détail JSON revient aux intents — cycle
   piloté par une paire de radios masqués + labels cliquables, PAS par un
   second <details> (un <details> imbriqué ne serait pas réinitialisé par le
   DOM à la fermeture du parent, cul-de-sac sur JSON — cf. formatToolAcksHtml,
   utils.js). Zéro JS, fonctionne même en export statique. */
.tool-trace-toggle { margin-top: 4px; }
.tt-radio { position: absolute; opacity: 0; pointer-events: none; }
.tt-view { display: block; cursor: pointer; }
.tt-view-json { display: none; }
/* 2ᵉ radio (id="ttj…", label for="tti…" = clic pour REVENIR aux intents)
   coché → son frère immédiat .tt-view-intents disparaît, .tt-view-json
   (frère suivant) apparaît. Ordre DOM figé par formatToolAcksHtml : radio
   intents, radio json, label intents, label json — ne pas réordonner sans
   ajuster ce sélecteur. */
.tt-radio + .tt-radio:checked ~ .tt-view-intents { display: none; }
.tt-radio + .tt-radio:checked ~ .tt-view-json { display: block; }
.tool-ack-preview-list { display: flex; flex-direction: column; gap: 3px; }
.tool-ack-preview { display: flex; align-items: baseline; gap: 8px; padding: 4px 0 4px 10px; border-left: 2px solid var(--accent-bd); }
.tool-ack-preview .ack-icon { flex-shrink: 0; display: inline-flex; align-items: center; align-self: center; color: var(--accent); }
.tool-ack-preview .ack-label { flex: 1; overflow-wrap: break-word; }
.tool-ack-preview.ack-error .ack-icon { color: var(--err); }
.tool-ack-preview.ack-error .ack-label { color: var(--err-soft); }
.tool-trace .ack-head-error, .tool-trace .ack-head-error code { color: var(--err-soft); }
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
/* Document Markdown converti (lot R) : réutilise la classe .body pour toute la
   typographie, n'ajoute que ce qui lui est propre. Les h1 restants dans le
   corps (le premier est consommé par le cartouche, cf. extractMdTitle) sont
   remontés en taille : dans un document autonome ils structurent la lecture,
   là où dans une bulle de chat ils restaient discrets.
   ATTENTION : EXPORT_CSS est un template literal — jamais de backtick dans
   ces commentaires, il clôt la chaîne et casse le chargement du fichier. */
.md-doc { font-size: 14px; line-height: 1.68; color: var(--text); }
.md-doc h1 { font-size: 21px; margin: 24px 0 10px; }
.md-doc h2 { font-size: 17px; margin: 22px 0 9px; }
.md-doc > *:first-child { margin-top: 0; }
/* Bascule de thème (export interactif uniquement) : le bouton est créé par
   EXPORT_SCRIPT, ces règles restent inertes en export statique. Fixe en coin
   bas-droite, discret au repos, révélé au survol — l'export est un document de
   lecture, pas une app. */
/* Bascule de thème SANS JavaScript (lot R révisé) : case masquée + label.
   La case doit rester focusable au clavier — d'où opacity/position plutôt que
   display:none, qui la sortirait de l'ordre de tabulation. */
#theme-switch { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
/* Le label est en tête de body (contrainte du sélecteur :has / frère) mais doit
   s'afficher dans le cartouche : on le cale en fixed sur la même ligne que la
   topbar. Sans cartouche il occupe la même place, en haut à droite du document
   — dans les deux cas il reste accessible au scroll. */
/* Aligné sur la COLONNE de lecture (900px centrés), pas sur le bord du
   viewport : sur grand écran, un right:16px le laissait flotter à ~270px du
   cartouche, visuellement désolidarisé. left:50% + une demi-colonne le cale au
   bord droit de la colonne ; min() le ramène au bord de l'écran quand le
   viewport est plus étroit que la colonne (mobile).
   Pas de backtick ici : EXPORT_CSS est un template literal (piège 22). */
.theme-switch-label { position: fixed; top: 16px; left: min(100vw - 50px, 50% + 450px); z-index: 10; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--border-2); border-radius: 50%; background: var(--surface-2); color: var(--text-3); cursor: pointer; opacity: 0.55; transition: opacity var(--ease), color var(--ease), border-color var(--ease); }
.theme-switch-label:hover { opacity: 1; color: var(--text); border-color: var(--accent-bd); }
#theme-switch:focus-visible + .theme-switch-label { opacity: 1; color: var(--text); border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
.theme-switch-label svg { width: 17px; height: 17px; }
/* Une seule icône visible : elle montre la DESTINATION. Décochée = sombre →
   soleil ; cochée = clair → lune. */
.theme-switch-label .ts-moon { display: none; }
#theme-switch:checked + .theme-switch-label .ts-sun { display: none; }
#theme-switch:checked + .theme-switch-label .ts-moon { display: block; }
/* Sur écran tactile il n'y a PAS de survol : le bouton resterait indéfiniment à
   demi-effacé et passe pour absent (retour Julien après test sur mobile). On le
   rend pleinement visible d'emblée, et un peu plus grand pour la cible tactile
   (34px est en dessous des 44px recommandés au doigt). */
@media (pointer: coarse) {
  .theme-switch-label { opacity: 1; color: var(--text-2); width: 40px; height: 40px; }
  .theme-switch-label svg { width: 19px; height: 19px; }
  /* Bouton plus gros → réserve plus large dans le cartouche. */
  .export-topbar { padding-right: 72px; }
}
@media print { .theme-switch-label { display: none; } }
`;

// Script inline OPTIONNEL de l'export (progressive enhancement, zéro-JS révisé —
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
  // Bascule de thème : les DEUX jeux de tokens sont embarqués par
  // serializeThemeTokens (:root sombre + html[data-theme="light"]), il suffit
  // donc de basculer l'attribut. LIMITE CONNUE : les SVG Mermaid embarqués
  // (embedExportMermaid) portent un <style> interne aux couleurs RÉSOLUES à
  // l'export — ils ne suivent pas la bascule et gardent leur thème d'origine.
  // Les recolorer imposerait d'embarquer Mermaid dans l'export (hors sujet) ;
  // limite assumée, cf. docs/exports.md.
  //
  // Le bouton est du HTML STATIQUE (case + label, cf. buildExportHtml) et la
  // bascule fonctionne SANS ce script — c'est le point du lot R révisé (les
  // visionneuses type Quick Look iOS n'exécutent aucun script). Ce bloc n'ajoute
  // que ce qui exige du JS : la PERSISTANCE du choix d'un chargement à l'autre.
  // Il ne pose AUCUN attribut de thème : la case est seule source de vérité,
  // tokens et couleurs Prism sont gouvernés par le sélecteur :has() sur elle.
  // (Pas de backtick dans ce commentaire : EXPORT_SCRIPT est un template
  // literal, piège 22.)
  // UNE seule clef pour TOUS les exports (pas de suffixe de chemin) : le choix
  // clair/sombre est une préférence de lecture, pas un attribut du document —
  // la refaire à chaque nouvel export n'a pas de sens, et une entrée par fichier
  // encrassait le localStorage sans rien apporter.
  var THEME_KEY = 'miaou-export-theme';
  var sw = document.getElementById('theme-switch');
  if (sw) {
    try {
      var saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') sw.checked = (saved === 'light');
    } catch (e) {}
    sw.addEventListener('change', function () {
      try { localStorage.setItem(THEME_KEY, sw.checked ? 'light' : 'dark'); } catch (e) {}
    });
  }
})();
`;

// Assemblage PUR du squelette HTML (testable QuickJS) : le styleCss est
// composé par l'appelant (tokens runtime non purs), buildExportHtml se
// contente de l'insérer. scriptTag est composé par l'appelant (vide si
// settings.exportInteractive est false → export strictement statique, ou
// <script>EXPORT_SCRIPT</script> sinon — progressive enhancement, zéro-JS révisé
// brief G). Zéro <link> (Prism inliné, pas de CDN).
// Icônes de la bascule de thème des exports. Les DEUX sont dans le markup ;
// le CSS n'en montre qu'une selon l'état de la case (soleil quand on est en
// sombre, lune quand on est en clair — l'icône montre la DESTINATION). Ce sont
// les mêmes tracés que ceux qu'utilisait EXPORT_SCRIPT avant qu'on passe au
// markup statique, gardés identiques pour ne pas dévier du vocabulaire d'icônes.
const THEME_SWITCH_SUN_SVG = '<svg class="ts-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
const THEME_SWITCH_MOON_SVG = '<svg class="ts-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

// `title` null/vide → AUCUN cartouche d'en-tête (Markdown converti sans titre
// de niveau 1, lot R) : ni logo, ni titre, ni date. Le footer, lui, est
// systématique.
//
// `verb` distingue les deux producteurs de documents : l'export de
// conversation dit « Exporté le … » / « Généré par MIAOU », le convertisseur
// Markdown dit « Converti le … » / « Converti par MIAOU ». Un seul paramètre
// pilote les deux endroits pour qu'ils ne puissent pas diverger.
// `footer` est SCINDÉ (préfixe + nom) parce que seul le mot « MIAOU » porte le
// lien vers le dépôt : une chaîne d'un bloc obligerait à la redécouper au rendu.
const EXPORT_VERBS = {
  export:  { meta: 'Exporté',  footerPrefix: 'Généré par ' },
  convert: { meta: 'Converti', footerPrefix: 'Converti par ' },
};

// Le mot « MIAOU » du footer d'export : lien vers le dépôt si BUILD_REPO_URL
// est non vide (défaut : dépôt public — cf. storage.js), simple texte sinon.
// `escHtml` sur l'URL bien qu'elle soit d'origine BUILD et jamais modèle : le
// chemin string→HTML de l'export ne souffre pas d'exception gratuite (piège 21).
// Partie PURE (testable) : la décision lien/texte à partir d'une URL déjà
// résolue. `exportBrandHtml` n'est que le point de lecture de la constante de
// build, qui, elle, est figée au chargement et donc intestable telle quelle.
function brandHtmlFor(url) {
  if (typeof url !== 'string' || !url) return 'MIAOU';
  return '<a class="export-brand" href="' + escHtml(url) +
    '" target="_blank" rel="noopener">MIAOU</a>';
}
function exportBrandHtml() { return brandHtmlFor(BUILD_REPO_URL); }
function buildExportHtml({ title, dateDisplay, theme, styleCss, bodyHtml, scriptTag, kind }) {
  const hasHeader = !!(title && String(title).trim());
  const docTitle = hasHeader ? title : 'Document';
  const verbs = EXPORT_VERBS[kind] || EXPORT_VERBS.export;
  const verb = verbs.meta;
  const ogDesc = hasHeader
    ? title + ' — ' + verb.toLowerCase() + ' depuis MIAOU le ' + dateDisplay
    : 'Document ' + verb.toLowerCase() + ' depuis MIAOU le ' + dateDisplay;
  // PAS de data-theme sur <html> : dans l'export, la CASE (#theme-switch) est la
  // seule source de vérité du thème. Un attribut figé ici gagnerait sur elle en
  // permanence — sans JS pour le mettre à jour, le clic changeait l'icône mais
  // pas les couleurs (bug constaté au lot R). Le thème d'ouverture est porté par
  // l'état initial de la case, plus bas.
  return '<!doctype html>\n' +
    '<html>\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    // Sans viewport, un mobile rend la page à ~980px puis la réduit : le texte
    // paraît minuscule ET les media queries mobiles ne se déclenchent jamais
    // (lot R — l'export n'en avait aucun jusque-là).
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + escHtml(docTitle) + '</title>\n' +
    // Favicon : même logo que la sidebar (LOGO_SRC, source unique, main.js) —
    // statique, indépendant du réglage exportInteractive/EXPORT_SCRIPT.
    '<link rel="icon" href="' + escHtml(LOGO_SRC) + '">\n' +
    // Métadonnées Open Graph : pilotent la preview de lien dans Teams/Slack/
    // Discord (sinon ils pêchent au hasard un texte de la page — typiquement
    // le footer « Généré par MIAOU »). L'image (logo data-URI) est
    // généralement ignorée par ces crawlers qui exigent une URL fetchable, mais
    // coût nul. Titre + description restent, eux, honorés même sur pièce jointe.
    '<meta name="description" content="' + escHtml(ogDesc) + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:site_name" content="MIAOU">\n' +
    '<meta property="og:title" content="' + escHtml(docTitle) + '">\n' +
    '<meta property="og:description" content="' + escHtml(ogDesc) + '">\n' +
    '<meta property="og:image" content="' + escHtml(LOGO_SRC) + '">\n' +
    '<style>' + styleCss + '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    // Bascule de thème SANS JavaScript (lot R, révisé) : une case masquée en
    // tête de body + un <label for> cliquable. Le CSS bascule via
    // `body:has(#theme-switch:checked)`. Fonctionne dans les visionneuses qui
    // n'exécutent pas de script (Quick Look iOS) — c'est tout l'intérêt.
    // Cochée = thème CLAIR, d'où l'état initial dérivé du thème d'export.
    // EXPORT_SCRIPT, quand il tourne, garde case et attribut synchronisés et
    // ajoute la persistance ; sans lui, la bascule marche quand même.
    '<input type="checkbox" id="theme-switch"' + (theme === 'light' ? ' checked' : '') + '>\n' +
    '<label class="theme-switch-label" for="theme-switch" title="Changer de thème" role="button" aria-label="Changer de thème">' +
    THEME_SWITCH_SUN_SVG + THEME_SWITCH_MOON_SVG +
    '</label>\n' +
    (hasHeader
      ? '<div class="export-topbar-wrap">' +
        '<div class="export-topbar">' +
        '<img class="export-logo" src="' + LOGO_SRC + '" alt="">' +
        '<p class="export-title">' + escHtml(title) + '</p>' +
        '</div>\n' +
        '</div>\n'
      : '') +
    '<div class="export-body">' + bodyHtml + '</div>\n' +
    // Footer systématique, et SEUL porteur de la date (décision Julien) : le
    // cartouche ne garde que logo + titre. Un seul endroit, quel que soit le
    // type de document et qu'il y ait un cartouche ou non.
    '<div class="export-footer-wrap"><div class="export-footer">' +
    escHtml(verbs.footerPrefix) + exportBrandHtml() +
    ' le ' + escHtml(dateDisplay) +
    '</div></div>\n' +
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
      // Réponse d'agent (X-1e) : même repli qu'à l'écran, et il fonctionne dans
      // l'export SANS JS — <details> est natif, l'export interactif n'est pas
      // requis. Le HTML est produit par la MÊME fonction que le live
      // (agentResultBodyHtml) : deux formules donneraient deux structures, donc
      // deux CSS à maintenir en parallèle, et c'est exactement la dérive que le
      // piège 22 décrit (EXPORT_CSS ne suit pas chat.css — raison de plus pour
      // que le MARKUP, lui, soit partagé). Son escHtml sur intent/statut est
      // impératif ici : ces chaînes sont d'origine MODÈLE (piège 21).
      const bodyHtml = m.agentResult
        ? agentResultBodyHtml(shown || '', m.agentResult)
        : '<div class="body">' + renderUserMd(shown || '') + '</div>';
      if (m.agentResult) msgEl.className += ' agent-result';
      msgEl.innerHTML = '<div class="bubble">' + attHtml + bodyHtml + '</div>' + tsHtml;
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
  // Même porteur qu'à l'écran, posé par la MÊME fonction : le débordement
  // centré des grands tableaux est une décision de présentation qui vaut aussi
  // pour un export lu sur grand écran. Seules les bornes changent (EXPORT_CSS
  // les calcule sur .export-body et le viewport, faute de sidebar et de --col).
  wrapWideTables(container);
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

// ── Conversion Markdown → HTML (lot R) ───────────────────────────────────────
// Convertit un .md quelconque (fichier de l'utilisateur, PAS du contenu modèle)
// en document HTML autonome au format des exports de conversation.
//
// TROISIÈME chemin string→HTML (piège 21), assumé et documenté : ni renderMd
// (qui applique resolveConvRefs — des références de conversation n'ont aucun
// sens dans un .md externe, et transformeraient un `#123` en lien mort), ni
// renderUserMd (qui échappe les `<`, alors qu'un .md peut légitimement porter
// du HTML inline). On passe donc marked directement, MAIS la sortie traverse
// sanitizeHtml/DOMPurify comme les deux autres : c'est ce qui rend ce chemin
// sûr, et toute évolution ici doit conserver cette passe.
//
// `breaks: FALSE` ici, contrairement à renderMd/renderUserMd (écran). Ces deux-là
// rendent des messages de CHAT, tapés au fil de l'eau, où « une ligne = une
// ligne » est le bon comportement. Un fichier .md est un DOCUMENT : il est
// presque toujours enroulé à ~80 colonnes, et ces retours ne sont pas
// sémantiques — les rendre en <br> reproduit la largeur du fichier source au
// lieu de laisser le texte se réenrouler (retour Julien). Comportement
// CommonMark standard : un retour simple est un espace, une ligne vide sépare
// deux paragraphes, deux espaces en fin de ligne forcent un <br>.
// Colorise les blocs de code d'un fragment DÉTACHÉ, grammaires comprises.
//
// Piège vérifié au spike : passer un callback à Prism.highlightElement NE SUFFIT
// PAS. L'autoloader demande bien la grammaire manquante (requête observée, 200),
// mais le callback est rappelé APRÈS que le bloc a déjà été rendu sans elle —
// résultat : requête réussie, `Prism.languages.python` absent, zéro token. Il
// faut donc PRÉCHARGER les grammaires, puis coloriser.
//
// Ce cas ne se pose pas dans l'export de conversation : ses blocs ont déjà été
// coloriés à l'écran, grammaires chargées de longue date.
const MD_HIGHLIGHT_TIMEOUT_MS = 5000;
// Charge un composant de grammaire par <script>, une seule fois par langage.
// Échec (CDN injoignable, langage inexistant) → résolution quand même : le bloc
// sortira non colorié, la conversion n'échoue jamais pour ça.
const _prismGrammarLoads = {};
function loadPrismGrammar(lang) {
  if (!lang || !window.Prism) return Promise.resolve();
  if (Prism.languages[lang]) return Promise.resolve();
  const base = (Prism.plugins && Prism.plugins.autoloader && Prism.plugins.autoloader.languages_path) || '';
  if (!base) return Promise.resolve();
  if (_prismGrammarLoads[lang]) return _prismGrammarLoads[lang];
  _prismGrammarLoads[lang] = new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, MD_HIGHLIGHT_TIMEOUT_MS);
    const s = document.createElement('script');
    s.src = base + 'prism-' + lang + '.min.js';
    s.onload = () => { clearTimeout(timer); finish(); };
    s.onerror = () => { clearTimeout(timer); finish(); };
    document.head.appendChild(s);
  }).then(() => {
    // Hygiène de cache async : un échec ne doit pas empoisonner la session —
    // si la grammaire n'est pas arrivée, la prochaine conversion retentera.
    if (!Prism.languages[lang]) delete _prismGrammarLoads[lang];
  });
  return _prismGrammarLoads[lang];
}
async function highlightMarkdownDocCode(container) {
  if (!highlightEnabled || !window.Prism || !Prism.highlightElement) return;
  const blocks = Array.from(container.querySelectorAll('code[class*="language-"]'));
  if (!blocks.length) return;
  const langOf = el => {
    const m = (el.className || '').match(/language-([\w-]+)/);
    return m ? m[1] : '';
  };
  // Précharge les grammaires manquantes (dédupliquées) AVANT de coloriser.
  const langs = Array.from(new Set(blocks.map(langOf).filter(Boolean)));
  await Promise.all(langs.map(loadPrismGrammar));
  // Colorisation synchrone : les grammaires disponibles le sont maintenant,
  // celles qui ont échoué laisseront simplement leur bloc non colorié.
  for (const el of blocks) {
    try { Prism.highlightElement(el, false); } catch (e) { /* bloc laissé brut */ }
  }
}

async function renderMarkdownDocBody(md) {
  const container = document.createElement('div');
  // Classe `.body` RÉUTILISÉE telle quelle : toutes les règles typographiques
  // d'EXPORT_CSS (titres, listes, tableaux, blockquote, code) y sont attachées
  // sans dépendre de `.msg.assistant`. Inventer une seconde classe la
  // dupliquerait et la ferait dériver (piège 22). `.md-doc` ne porte que le peu
  // qui est propre au document converti (taille de base, titre de niveau 1).
  container.className = 'body md-doc';
  // Le fallback (marked absent, CDN injoignable) suit la MÊME convention que le
  // chemin nominal : ligne vide = nouveau paragraphe, retour simple = espace.
  // Sinon le rendu diverge selon que le CDN a répondu ou non.
  container.innerHTML = window.marked
    ? sanitizeHtml(marked.parse(String(md || ''), { breaks: false }))
    : plainTextToParagraphs(String(md || ''));
  // Mêmes passes que renderExportBody, dans le même ordre : coloration, puis
  // en-têtes de blocs de code, puis Mermaid (qui déménage les <pre> concernés).
  // MAIS coloration ATTENDUE ici (highlightMarkdownDocCode), pas le
  // highlightAllUnder synchrone de renderExportBody : les blocs d'un .md sont
  // NEUFS, leur grammaire n'a jamais été chargée, et l'autoloader Prism la
  // récupère en asynchrone — lire outerHTML juste après rendait un code non
  // colorié (bloc correct, zéro token). Dans l'export de conversation le
  // problème ne se pose pas : les mêmes blocs ont déjà été coloriés à l'écran.
  await highlightMarkdownDocCode(container);
  decorateExportPre(container);
  await embedExportMermaid(container);
  return container.outerHTML;
}

// Point d'entrée de la conversion : prend le TEXTE d'un .md et son nom de
// fichier, produit le HTML complet et le télécharge. Séparé du handler d'UI
// pour rester appelable depuis un verify sans passer par un vrai <input file>.
async function convertMarkdownToHtmlFile(mdText, sourceName) {
  const { title, body } = extractMdTitle(mdText);
  const now = Date.now();
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const styleCss = serializeThemeTokens() + EXPORT_CSS + prismThemeCssForExport();
  const bodyHtml = await renderMarkdownDocBody(body);
  const s = loadSettings();
  const scriptTag = (s.exportInteractive !== false)
    ? '<script>' + EXPORT_SCRIPT.replace(/<\//g, '<\\/') + '</' + 'script>\n'
    : '';
  const html = buildExportHtml({
    title,                       // null → aucun cartouche (spec)
    dateDisplay: exportDateDisplay(now),
    kind: 'convert',
    theme, styleCss, bodyHtml, scriptTag,
  });
  downloadFile(mdHtmlFileName(sourceName), html, 'text/html');
  return html;
}

// ── Conversion Markdown : câblage UI (réglages » Outils & extensions) ────────
// Handlers globaux référencés en attributs inline dans index.html (cf. CLAUDE.md) :
// onMdConvertPick / onMdConvertInput / onMdConvertDragOver / onMdConvertDragLeave /
// onMdConvertDrop. Renommer ici sans mettre à jour index.html casse en silence.
// Réutilise isMarkdownFile (drawer skills) : même filtre, pas de second prédicat.
function setMdConvertStatus(msg, isError) {
  const el = $('md-convert-status');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('md-convert-status--error', !!isError);
}
// Verrou de réentrance : la conversion est async (passe Mermaid + CDN), un
// second dépôt pendant ce temps produirait deux téléchargements concurrents.
// Même motif que _exportingHtml.
let _convertingMd = false;
async function runMdConversion(file) {
  if (!file || _convertingMd) return;
  _convertingMd = true;
  try {
    setMdConvertStatus('Conversion de « ' + file.name +' »…', false);
    const text = await file.text();
    await convertMarkdownToHtmlFile(text, file.name);
    setMdConvertStatus('Converti : ' + mdHtmlFileName(file.name), false);
  } catch (e) {
    setMdConvertStatus('Échec de la conversion : ' + (e && e.message ? e.message : 'erreur inconnue'), true);
  } finally {
    _convertingMd = false;
  }
}
function onMdConvertPick() {
  const input = $('md-convert-input');
  if (input) input.click();
}
function onMdConvertInput(e) {
  const input = e && e.target;
  const file = input && input.files && input.files[0];
  // Réinitialise la valeur : sans ça, re-choisir LE MÊME fichier ne relance
  // aucun change (valeur inchangée) — piège classique de <input type=file>.
  if (input) input.value = '';
  if (file) runMdConversion(file);
}
function onMdConvertDragOver(e) {
  e.preventDefault();
  const dz = $('md-convert-zone');
  if (dz) dz.classList.add('dragover');
}
function onMdConvertDragLeave(e) {
  const dz = $('md-convert-zone');
  if (dz && (!e.relatedTarget || !dz.contains(e.relatedTarget))) dz.classList.remove('dragover');
}
function onMdConvertDrop(e) {
  e.preventDefault();
  const dz = $('md-convert-zone');
  if (dz) dz.classList.remove('dragover');
  const files = e.dataTransfer && e.dataTransfer.files;
  if (!files || !files.length) return;
  const file = Array.from(files).find(isMarkdownFile);
  // Ici, contrairement au drawer skills, un mauvais fichier mérite un retour :
  // l'utilisateur a visé une zone dédiée, le silence passerait pour un bug.
  if (!file) { setMdConvertStatus('Fichier ignoré : seuls les .md sont convertis.', true); return; }
  runMdConversion(file);
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
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const now = Date.now();
    const dateDisplay = exportDateDisplay(now);
    const styleCss = serializeThemeTokens() + EXPORT_CSS + prismThemeCssForExport();
    const bodyHtml = await runBackgroundTask('export HTML…',
      () => renderExportBody(currentThread, currentConvId));
    if (bodyHtml == null) return;
    // Script optionnel (progressive enhancement, zéro-JS révisé). Échappement défensif
    // de </ pour ne pas clore prématurément le <script> porteur (même parade que
    // build.py sur __MIAOU_CONFIG__), même si EXPORT_SCRIPT n'en contient pas.
    const s = loadSettings();
    const scriptTag = (s.exportInteractive !== false)
      ? '<script>' + EXPORT_SCRIPT.replace(/<\//g, '<\\/') + '</' + 'script>\n'
      : '';
    const html = buildExportHtml({ title, dateDisplay, theme, styleCss, bodyHtml, scriptTag, kind: 'export' });
    const sizeBytes = new Blob([html]).size;
    if (sizeBytes > EXPORT_HTML_SIZE_WARN) {
      const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
      if (!confirm('Fichier volumineux (~' + mb + ' Mo), continuer ?')) return;
    }
    downloadFile(exportConvFilename(title, now, 'html'), html, 'text/html');
  } finally {
    _exportingHtml = false;
  }
}
