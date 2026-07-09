'use strict';

/* ── utils.js ──────────────────────────────────────────────────────────────
   Fonctions pures (ou quasi pures) : échappement, helpers DOM élémentaires,
   tokenisation, scoring, parsing défensif. Aucune logique réseau/persistance.
   Tout est en déclarations `function` ou `const` de portée script : le build
   concatène ces fichiers dans un seul <script>, l'ordre des dépendances est
   garanti par build.py.
   ────────────────────────────────────────────────────────────────────────── */

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Acks d'outils (journal client persistant des appels d'outils) ────────────
// Reconnaît le rôle d'ack neuf ('tool-ack') et l'ancien ('memory-ack', jamais
// réécrit — pas de migration silencieuse).
function isAckRole(role) { return role === 'tool-ack' || role === 'memory-ack'; }

// Dérive le kind canonique : entrée neuve (kind) ou legacy (ackType → memory_*).
function ackKindOf(m) {
  if (m.kind) return m.kind;
  if (m.ackType) return 'memory_' + m.ackType; // legacy : 'create'|'update'|'delete'
  return null;
}

// Whitelist UNIQUE des champs d'une entrée tool-ack, partagée par les quatre
// sites de copie (onEarlyAcks/onToolAcks pour le rendu live, openConversation/
// persistCurrent pour la persistance — main.js). Historique : trois copies
// manuelles divergentes, un champ oublié cassait silencieusement le rendu ou
// la persistance (payé avec convId/slug). Ajouter un champ = UNE ligne ici.
// `error`/`resolved` sont copiés en sémantique truthy (jamais `false` explicite
// en storage) ; tous les autres en présence (`!= null`).
const ACK_COPY_FIELDS = [
  'kind', 'ackType',                     // kind canonique / legacy (jamais réécrit)
  'id', 'content', 'prevContent',        // souvenirs (create/update/delete)
  'title', 'count', 'convId',            // lectures d'historique
  'server', 'name', 'intent',            // MCP / traçage d'intention
  'resourceName', 'mime', 'size',        // ressources IDB
  'attId',                                // pièces jointes (recall_attachment)
  'slug',                                // skills
  'args', 'result', 'ts', 'group', 'assistantText',   // réinjection cross-turn
];

function copyAckFields(src, dst) {
  for (const f of ACK_COPY_FIELDS) {
    if (src[f] != null) dst[f] = src[f];
  }
  if (src.error) dst.error = true;
  if (src.resolved) dst.resolved = true;
  return dst;
}

// Place le caret en fin de contenu d'un élément contenteditable.
function placeCaretEnd(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// Auto-grandissement d'un <textarea> jusqu'à une hauteur max.
function autoGrow(el) {
  el.style.height = 'auto';
  el.style.overflowY = 'hidden';
  const h = Math.min(el.scrollHeight, 168);
  el.style.height = h + 'px';
  el.style.overflowY = h >= 168 ? 'auto' : 'hidden';
}

// ── Tokenisation / scoring (recherche mémoire) ──────────────────────────────

const STOPWORDS = new Set([
  // français
  'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'à', 'en',
  'dans', 'pour', 'sur', 'avec', 'que', 'qui', 'quoi', 'dont', 'où', 'ce',
  'cet', 'cette', 'ces', 'je', 'tu', 'il', 'elle', 'on', 'nous', 'vous',
  'ils', 'elles', 'se', 'sa', 'son', 'ses', 'mon', 'ma', 'mes', 'ton', 'ta',
  'tes', 'au', 'aux', 'par', 'pas', 'ne', 'plus', 'est', 'sont', 'être',
  'avoir', 'fait', 'comme', 'mais', 'donc', 'car', 'si', 'leur', 'leurs',
  'tout', 'tous', 'toute', 'toutes', 'cela', 'ceci',
  // anglais courant (les modèles répondent parfois en anglais)
  'the', 'and', 'or', 'for', 'with', 'that', 'this', 'are', 'was', 'you',
  'your', 'from', 'have', 'has', 'not', 'but', 'can', 'will', 'into',
]);

function tokenize(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

// Recouvrement pondéré : un keyword vaut 2, un mot du texte/titre vaut 1.
function scoreSummary(queryTokens, summary) {
  const kw  = new Set((summary.keywords || []).map(k => String(k).toLowerCase()));
  const txt = new Set(tokenize((summary.summary || '') + ' ' + (summary.title || '')));
  let score = 0;
  for (const t of queryTokens) {
    if (kw.has(t)) score += 2;
    else if (txt.has(t)) score += 1;
  }
  return score;
}

// ── Références de conversation dans le texte du modèle ──────────────────────
// Le modèle cite une conversation passée via [conv_ref:ID] ou [conv_ref:ID|Titre]
// (doctrine CONV_REF_DOCTRINE, tools.js) plutôt que d'exposer l'ID brut. Extrait
// tous les marqueurs présents dans une chaîne — fonction pure, le titre est
// optionnel (résolu côté appelant si absent, via l'index des résumés).
// N'utilise pas de lookahead/lookbehind variable : split sur le SEUL séparateur
// `|`, le titre peut donc contenir `:` sans ambiguïté mais jamais `|` ni `]`.
const CONV_REF_RE = /\[conv_ref:([^\|\]]+)(?:\|([^\]]*))?\]/g;

function parseConvRefs(text) {
  const out = [];
  const re = new RegExp(CONV_REF_RE.source, 'g');
  let m;
  while ((m = re.exec(String(text))) !== null) {
    out.push({ match: m[0], id: m[1], title: m[2] || null });
  }
  return out;
}

// ── Téléchargement côté client ───────────────────────────────────────────────
// Slug de nom de fichier depuis un titre de conversation. Les lettres
// accentuées sont translittérées vers leur équivalent ASCII (NFD + suppression
// des diacritiques) avant le remplacement en tirets, pour que "café" donne
// "cafe" et non "caf". Fallback si le titre est vide ou ne contient que des
// caractères non alphanumériques.
function slugTitle(title) {
  return String(title || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'miaou-conversation';
}

// Crée un Blob, génère une URL objet éphémère, déclenche le téléchargement via
// un <a download> invisible, puis révoque l'URL. Fonctionne sous file:// et derrière
// un reverse-proxy (Caddy). N'est pas un outil LLM — appelé uniquement par des
// handlers de boutons.
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Correspondance langage de bloc de code → extension de fichier.
const LANG_TO_EXT = {
  python: 'py', py: 'py',
  javascript: 'js', js: 'js',
  typescript: 'ts', ts: 'ts',
  jsx: 'jsx', tsx: 'tsx',
  bash: 'sh', sh: 'sh', shell: 'sh', zsh: 'sh',
  json: 'json',
  yaml: 'yaml', yml: 'yml',
  html: 'html', xml: 'xml',
  css: 'css', scss: 'scss',
  sql: 'sql',
  markdown: 'md', md: 'md',
  rust: 'rs', rs: 'rs',
  go: 'go',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', h: 'h',
  java: 'java',
  kotlin: 'kt', kt: 'kt',
  ruby: 'rb', rb: 'rb',
  php: 'php',
  toml: 'toml', ini: 'ini',
  dockerfile: 'dockerfile',
};

function langExt(lang) {
  return LANG_TO_EXT[(lang || '').toLowerCase()] || 'txt';
}

// Parse l'info string d'une fence markdown enrichie (ex. "python filename=foo.py")
// en { lang, filename }. Le premier segment non-espace est le langage (comme le
// renderer par défaut de marked, ^\S*), débarrassé d'une éventuelle virgule
// terminale (tolérance à l'ancienne forme cassée "python, filename=…", testée et
// rejetée par Julien — cf. untracked/brief-codeblock-filename.md). Le filename
// est cherché dans le reste via filename=valeur ou filename="valeur entre guillemets"
// (guillemets retirés). '' si absent. Pure, sans effet de bord — appelée par le
// renderer custom marked (ui.js) et testable seule en QuickJS.
function parseCodeFenceInfo(info) {
  const raw = (info || '').match(/^\S*/)[0];
  const lang = raw.replace(/,$/, '');
  const rest = (info || '').slice(raw.length);
  const m = rest.match(/\bfilename=("([^"]*)"|(\S+))/);
  const filename = m ? (m[2] !== undefined ? m[2] : m[3]) : '';
  return { lang, filename };
}

// Assainit un nom de fichier proposé par le modèle pour le téléchargement d'un
// codeblock : retire tout séparateur de chemin et les caractères de contrôle —
// on écrit un nom de fichier, jamais un chemin (defense-in-depth, pas de directory
// traversal possible côté downloadFile qui n'écrit que via <a download>, mais un
// nom "../../etc/passwd" resterait un nom absurde à proposer). Suffixe l'extension
// dérivée de `lang` (langExt) si le nom n'en a aucune — la doctrine (CODEBLOCK_DOCTRINE)
// demande au modèle de la fournir, ce suffixe est un filet de sécurité. '' si le
// nom assaini est vide (fallback à l'appelant : nom générique miaou-snippet.<ext>).
function sanitizeDownloadName(name, lang) {
  let n = String(name || '')
    .replace(/[\/\\]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .trim();
  if (!n) return '';
  if (!/\.[^.\/\\]+$/.test(n)) n += '.' + langExt(lang);
  return n;
}

// Décode une chaîne base64 en Uint8Array (octets bruts) pour matérialiser un
// Blob binaire côté client (cf. cascade de rendu D8.3 : téléchargement éphémère
// d'un bloc binaire renvoyé par un outil distant). atob existe en navigateur ;
// fonction pure, pas de dépendance DOM.
function b64ToBytes(b64) {
  const bin = atob(String(b64 || ''));
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Agrégation MCP : nommage, namespaces, filtres (fonctions pures) ───────────
// Le préfixe est une VUE sur le nom canonique, jamais un stockage : tout outil
// exposé au modèle est `prefix__name`. parseToolName splitte sur le PREMIER `__`
// seulement — un toolName distant peut lui-même contenir `__`, un split naïf le
// corromprait. Pas de séparateur → préfixe vide et le nom entier en toolName.
function parseToolName(name) {
  const s = String(name || '');
  const i = s.indexOf('__');
  if (i < 0) return { serverPrefix: '', toolName: s };
  return { serverPrefix: s.slice(0, i), toolName: s.slice(i + 2) };
}

// Regroupe une liste d'outils canoniques par namespace. Le namespace est formé de
// TOUS les segments sauf le dernier ; le bareName est uniquement le dernier segment.
// Ex : `bench__djeyl__echo` → namespace=`bench__djeyl`, bareName=`echo`.
// Projection pure (cf. D2) : rien n'est stocké, le sous-drawer dérive l'affichage.
// Retourne [{ namespace, tools: [{ bareName, def }] }] dans l'ordre d'apparition.
function groupByNamespace(tools) {
  const order = [];
  const map = {};
  for (const def of (tools || [])) {
    const segs = String(def.name || '').split('__').filter(Boolean);
    const bareName = segs.length > 1 ? segs[segs.length - 1] : (segs[0] || '');
    const nsKey = segs.length > 1 ? segs.slice(0, -1).join('__') : '';
    const ns = nsKey || 'miaou';
    if (!map[ns]) { map[ns] = []; order.push(ns); }
    map[ns].push({ bareName, def });
  }
  return order.map(ns => ({ namespace: ns, tools: map[ns] }));
}

// Devine le transport MCP d'après le chemin d'URL (cf. D4). PRÉ-REMPLISSAGE
// uniquement, jamais un override : l'appelant ne s'en sert que si le champ
// transport n'est pas explicitement renseigné. `/sse` → 'sse', sinon (dont
// `/mcp`) → 'streamable-http' par défaut.
function guessMcpTransport(url) {
  const u = String(url || '');
  if (/\/sse\/?($|\?)/.test(u)) return 'sse';
  return 'streamable-http';
}

// Valide le `name` local d'un serveur MCP (devient le préfixe d'outil envoyé au
// modèle). Charset contraint, pas d'espace, pas de `__` (réservé au séparateur),
// `miaou` interdit (anti-usurpation des outils internes), unicité. Retourne une
// chaîne d'erreur (français) ou null si valide.
function validateMcpServerName(name, existingNames) {
  const n = String(name || '').trim();
  if (!n) return 'Nom requis.';
  if (n === 'miaou') return 'Le nom « miaou » est réservé aux outils internes.';
  if (n.indexOf('__') >= 0) return 'Le nom ne peut pas contenir « __ » (séparateur réservé).';
  if (!/^[a-zA-Z0-9_-]+$/.test(n)) return 'Caractères autorisés : lettres, chiffres, tiret, underscore.';
  if (Array.isArray(existingNames) && existingNames.indexOf(n) >= 0) return 'Ce nom est déjà utilisé.';
  return null;
}

// Filtre les outils d'un serveur au moment du merge (cf. D7). allowlist/denylist
// portent sur le nom NU de l'outil (tel que renvoyé par tools/list, avant préfixe).
// denylist gagne en cas de conflit ; allowlist vide → tout passe ; denylist retire.
// Fonction pure : reçoit les listes déjà normalisées en tableaux de noms nus.
function filterMcpTools(tools, allowlist, denylist) {
  const allow = Array.isArray(allowlist) ? allowlist.filter(Boolean) : [];
  const deny  = Array.isArray(denylist)  ? denylist.filter(Boolean)  : [];
  function matchesValue(bare, v) {
    if (v.indexOf('*') >= 0) {
      const re = new RegExp('^' + v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      const parts = bare.split('__');
      return parts.some((_, i) => re.test(parts.slice(i).join('__')));
    }
    return bare === v || bare.endsWith('__' + v);
  }
  function matches(bare, list) {
    return list.some(v => matchesValue(bare, v));
  }
  return (tools || []).filter(t => {
    const bare = t && t.name;
    if (matches(bare, deny)) return false;            // denylist gagne
    if (allow.length && !matches(bare, allow)) return false;
    return true;
  });
}

// Normalise un champ texte de filtre (saisi en CSV/lignes) en tableau de noms nus.
function parseToolFilterList(raw) {
  return String(raw || '')
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── Horodatages des messages ─────────────────────────────────────────────────

const SHOW_YEAR_AFTER_DAYS = 183; // ≈ 6 mois ; augmenter à 365 pour 12 mois

const FR_DAYS_ABBR = ['dim','lun','mar','mer','jeu','ven','sam'];
const FR_DAYS_FULL = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const FR_MONTHS_FULL = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

// Formate HH:MM à partir d'un objet Date, sans Intl (deterministe, testable sous QuickJS).
function _tsHHMM(d) {
  const h = d.getHours(), m = d.getMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// Minuit local (DST-safe) : new Date(y,m,d) évite les soustractions brutes d'epoch.
function _startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Horodatage court par tiers calendaires (cf. brief D5). `now` est injecté (epoch ms)
// pour être testable de façon déterministe sous QuickJS. Renvoie '' si ts est absent.
// - même jour calendaire → "08:54"
// - veille               → "hier à 17:28"
// - récent (< SHOW_YEAR_AFTER_DAYS) → "mar 25/09 à 14:30"
// - ancien               → "mar 25/09/2023 à 14:30"
// "Hier" est un écart calendaire (minuit/minuit), pas une fenêtre glissante de 24h.
function formatMessageTime(ts, now) {
  if (!ts || !now) return '';
  const d = new Date(ts);
  const n = new Date(now);
  const startOfToday = _startOfDay(n);
  const startOfYesterday = startOfToday - 86400000;
  const hhmm = _tsHHMM(d);
  if (ts >= startOfToday) return hhmm;
  if (ts >= startOfYesterday) return 'hier à ' + hhmm;
  const startOfMsgDay = _startOfDay(d);
  const daysDiff = Math.floor((startOfToday - startOfMsgDay) / 86400000);
  const dayName = FR_DAYS_ABBR[d.getDay()];
  const dd = (d.getDate() < 10 ? '0' : '') + d.getDate();
  const mm = (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
  if (daysDiff >= SHOW_YEAR_AFTER_DAYS) {
    return dayName + ' ' + dd + '/' + mm + '/' + d.getFullYear() + ' à ' + hhmm;
  }
  return dayName + ' ' + dd + '/' + mm + ' à ' + hhmm;
}

// Date relative, sans composante horaire. `now` injecté (epoch ms) pour QuickJS.
// Tiers : aujourd'hui / hier / avant-hier / "3 mars" / "12 janvier 2024".
// Math.round (pas floor) : traversée DST spring/autumn → écart réel 23h ou 25h,
// round absorbe le ±1h et donne l'écart calendaire exact.
function formatDateRelative(ts, now) {
  if (!ts || !now) return '';
  const d = new Date(ts);
  const n = new Date(now);
  const daysDiff = Math.round((_startOfDay(n) - _startOfDay(d)) / 86400000);
  if (daysDiff <= 0) return "aujourd'hui";
  if (daysDiff === 1) return 'hier';
  if (daysDiff === 2) return 'avant-hier';
  const day = d.getDate();
  const month = FR_MONTHS_FULL[d.getMonth()];
  if (daysDiff >= SHOW_YEAR_AFTER_DAYS) return day + ' ' + month + ' ' + d.getFullYear();
  return day + ' ' + month;
}

// Horodatage complet en français pour les tooltips de la sidebar (cf. brief D6).
// Ex : "jeudi 26 juin 2026 à 14:30". Toujours avec l'année.
function formatFullDateFr(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return FR_DAYS_FULL[d.getDay()] + ' ' + d.getDate() + ' ' +
    FR_MONTHS_FULL[d.getMonth()] + ' ' + d.getFullYear() + ' à ' + _tsHHMM(d);
}

// Horodatage déterministe YYYY-MM-DD (heure locale), sans Intl/toLocale, pour
// les noms de fichiers d'export (brief G, D5).
function exportDateStamp(now) {
  const d = new Date(now);
  const mm = (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
  const dd = (d.getDate() < 10 ? '0' : '') + d.getDate();
  return d.getFullYear() + '-' + mm + '-' + dd;
}

// Horodatage déterministe dd/mm/yyyy (heure locale) pour l'affichage dans
// l'export HTML standalone (.export-meta) — distinct de exportDateStamp
// (YYYY-MM-DD, réservé au nom de fichier).
function exportDateDisplay(now) {
  const d = new Date(now);
  const mm = (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1);
  const dd = (d.getDate() < 10 ? '0' : '') + d.getDate();
  return dd + '/' + mm + '/' + d.getFullYear();
}

// ── Reconstruction du payload API depuis currentThread ───────────────────────

// Préfixe d'horodatage absolu pour les résultats d'outils réinjectés cross-turn.
// La valeur est figée à l'instant de l'appel ; le modèle en infère l'ancienneté
// via le "now" déjà présent dans <miaou_context>. NE PAS recalculer à chaque
// envoi (mutation → busteRait le KV cache de tout le préfixe history).
function stampTs(ts, result) {
  var s = result != null ? String(result) : '';
  if (!ts) return s;
  return '[Résultat du ' + formatFullDateFr(ts) + ']\n' + s;
}

// ── Export Markdown : traces d'appels d'outils ───────────────────────────────
// Seuils de troncature pour l'export (lisibilité du .md, pas de limite côté
// modèle/stockage — ceux-ci restent intacts en mémoire et en storage).
const EXPORT_ARGS_MAX = 300;
const EXPORT_RESULT_MAX = 300;
const EXPORT_RESNAME_MAX = 60;

function _truncMd(s, max) {
  s = s == null ? '' : String(s);
  // Un contenu multiligne dans un code span `...` inline casse le rendu
  // Markdown (les backticks ne s'étendent pas sur plusieurs lignes) : on
  // rend les sauts de ligne visibles au lieu de les laisser tels quels.
  s = s.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n').replace(/\r/g, '\\n');
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// Représentation textuelle d'un appel d'outil pour l'export (un seul ack,
// déjà enrichi : args/result présents). `m.name` peut être préfixé
// (`miaou__create_memory`) ou breadcrumb distant (`server__tool`) — affiché tel quel.
function _formatToolCallMd(m) {
  const lines = [];
  const head = m.intent ? '`' + m.name + '` — ' + m.intent : '`' + m.name + '`';
  lines.push(head);
  if (m.args != null) lines.push('   Arguments : `' + _truncMd(JSON.stringify(m.args), EXPORT_ARGS_MAX) + '`');
  if (m.error) {
    lines.push('   Résultat (erreur) : `' + _truncMd(m.result, EXPORT_RESULT_MAX) + '`');
  } else if (m.result != null) {
    lines.push('   Résultat : `' + _truncMd(m.result, EXPORT_RESULT_MAX) + '`');
  }
  if (m.kind === 'resource_presented') {
    const name = _truncMd(m.resourceName || m.id || '?', EXPORT_RESNAME_MAX);
    lines.push('   Ressource présentée automatiquement : `' + name + '`' +
      (m.mime ? ' (' + m.mime + ')' : '') + ' — non incluse dans cet export');
  }
  return lines;
}

// Bloc Markdown (blockquote) pour un groupe d'acks enrichis d'un même tour.
// Un seul appel → "Outil appelé :" ; plusieurs → "Outils appelés (n) :" en liste numérotée.
function formatToolAcksMd(acks) {
  if (!acks || !acks.length) return '';
  const lines = [];
  if (acks.length === 1) {
    const inner = _formatToolCallMd(acks[0]);
    lines.push('> **Outil appelé :** ' + inner[0]);
    for (let i = 1; i < inner.length; i++) lines.push('>    ' + inner[i]);
  } else {
    lines.push('> **Outils appelés (' + acks.length + ') :**');
    acks.forEach((m, idx) => {
      const inner = _formatToolCallMd(m);
      lines.push('> ' + (idx + 1) + '. ' + inner[0]);
      for (let i = 1; i < inner.length; i++) lines.push('>    ' + inner[i]);
    });
  }
  // Saut de ligne forcé (2 espaces de fin) sur chaque ligne sauf la dernière :
  // sans ça, des lignes "> " consécutives sans paragraphe vide entre elles
  // sont fusionnées par le parser Markdown (intent et "Arguments" collés sur
  // la même ligne rendue).
  return lines.map((l, i) => i < lines.length - 1 ? l + '  ' : l).join('\n');
}

// Représentation HTML d'un appel d'outil pour l'export standalone (brief G,
// D3). Même politique que _formatToolCallMd (troncature, resource_presented
// nom+mime sans binaire) mais en <li> HTML. escHtml systématique : m.name,
// m.intent, args JSON et result sont des chaînes d'origine modèle/outil —
// seul chemin string→HTML de l'export (cf. CLAUDE.md, piège dédié).
function _formatToolCallHtml(m) {
  const lines = [];
  const head = m.intent
    ? '<code>' + escHtml(m.name) + '</code> — ' + escHtml(m.intent)
    : '<code>' + escHtml(m.name) + '</code>';
  lines.push(head);
  if (m.args != null) {
    lines.push('<br>Arguments : <code>' + escHtml(_truncMd(JSON.stringify(m.args), EXPORT_ARGS_MAX)) + '</code>');
  }
  if (m.error) {
    lines.push('<br>Résultat (erreur) : <code>' + escHtml(_truncMd(m.result, EXPORT_RESULT_MAX)) + '</code>');
  } else if (m.result != null) {
    lines.push('<br>Résultat : <code>' + escHtml(_truncMd(m.result, EXPORT_RESULT_MAX)) + '</code>');
  }
  if (m.kind === 'resource_presented') {
    const name = escHtml(_truncMd(m.resourceName || m.id || '?', EXPORT_RESNAME_MAX));
    lines.push('<br>Ressource présentée automatiquement : <code>' + name + '</code>' +
      (m.mime ? ' (' + escHtml(m.mime) + ')' : '') + ' — non incluse dans cet export');
  }
  return lines.join('');
}

// Icône générique (clé plate) pour la preview repliée d'un ack dans l'export —
// une seule icône pour tous les kinds (pas de dépendance à ACK_KINDS, défini
// dans ui.js, hors de portée depuis utils.js — cf. CLAUDE.md, frontière de
// fichiers du test runner).
const EXPORT_ACK_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';

// Ligne de preview d'un ack, visible tant que le <details> est replié — imite
// .tool-ack du thread live (bordure + icône + intent), sans la richesse
// interactive (undo/expand) hors de propos pour un export figé. Fallback sur
// le nom d'outil si m.intent est absent.
function _formatToolCallPreviewHtml(m) {
  const text = m.intent ? escHtml(m.intent) : '<code>' + escHtml(m.name) + '</code>';
  return '<div class="tool-ack-preview"><span class="ack-icon">' + EXPORT_ACK_ICON + '</span>' +
    '<span class="ack-label">' + text + '</span></div>';
}

// Bloc HTML (<details class="tool-trace">) pour un groupe d'acks enrichis
// d'un même tour — sœur HTML de formatToolAcksMd, même seuils/politique.
// Fermé par défaut (cohérent avec le reasoning, cf. brief G D1/§10).
// Repliée : une ligne de preview par ack façon .tool-ack (bordure+icône+intent
// ou fallback nom d'outil). Dépliée : le détail actuel (nom, arguments,
// résultat) remplace les previews — basculé en CSS via [open] (EXPORT_CSS).
function formatToolAcksHtml(acks) {
  if (!acks || !acks.length) return '';
  const summary = acks.length === 1 ? 'Outil appelé' : 'Outils appelés (' + acks.length + ')';
  const previews = acks.map(_formatToolCallPreviewHtml).join('');
  let inner;
  if (acks.length === 1) {
    inner = '<li>' + _formatToolCallHtml(acks[0]) + '</li>';
  } else {
    inner = acks.map(m => '<li>' + _formatToolCallHtml(m) + '</li>').join('');
  }
  return '<details class="tool-trace">' +
    '<summary><span class="tool-trace-summary-text">' + summary + '</span>' +
    '<div class="tool-ack-preview-list">' + previews + '</div>' +
    '<ul>' + inner + '</ul>' +
    '</summary>' +
    '</details>';
}

// DJB2 → base36, tronqué/paddé à exactement 9 chars [0-9a-z].
// Utilisé pour générer des tool_call_id déterministes et compatibles avec les
// backends qui imposent [a-zA-Z0-9] longueur 9 (ex. Mistral).
function _hashId9(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  return h.toString(36).padStart(9, '0').substring(0, 9);
}

// Texte exploitable d'un message pour titrage/résumé (generateTitle/
// generateSummary, api.js) : `displayText` (littéral tapé, slash-skill) en
// priorité, sinon `content` — mais `content` peut être un tableau de content
// parts (tour d'attache avec image, brief A lot 2) : une concaténation
// implicite `role + ': ' + content` stringifierait maladroitement un tel
// tableau (« [object Object] »). N'extrait QUE la/les part(s) texte ; les
// images n'ont pas de représentation textuelle ici (titrage/résumé n'ont pas
// besoin de voir l'image, seulement le texte qui l'accompagne). Pure.
function messageTextForSummary(m) {
  if (m.displayText != null) return m.displayText;
  const c = m.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(p => p && p.type === 'text').map(p => p.text || '').join('\n\n');
  return c || '';
}

// Reconstruit un tableau de messages OpenAI depuis currentThread.
// Acks ENRICHIS (args + result présents) → paire [assistant+tool_calls, tool…].
// Acks legacy (sans args) → élagués comme avant (compat ascendante).
// Si le premier ack d'un groupe porte assistantText, le message assistant
// standalone qui le précède immédiatement est absorbé dans le content de
// l'assistant expansé pour éviter la duplication.
function expandThread(thread) {
  var out = [];
  var i = 0;
  while (i < thread.length) {
    var m = thread[i];
    if (isAckRole(m.role)) {
      if (m.args != null) {
        var grp = m.group;
        var groupAcks = [m];
        var j = i + 1;
        if (grp != null) {
          while (j < thread.length && isAckRole(thread[j].role) &&
                 thread[j].args != null && thread[j].group === grp) {
            groupAcks.push(thread[j]);
            j++;
          }
        }
        var assistantText = groupAcks[0].assistantText != null ? groupAcks[0].assistantText : null;
        // Absorber le standalone assistant précédent si son content correspond
        if (assistantText && out.length &&
            out[out.length - 1].role === 'assistant' &&
            out[out.length - 1].content === assistantText &&
            !out[out.length - 1].tool_calls) {
          out.pop();
        }
        var prefix = grp != null ? grp : 'solo';
        var ids = groupAcks.map(function(_, k) { return _hashId9(prefix + '\x00' + k); });
        out.push({
          role: 'assistant',
          content: assistantText || null,
          tool_calls: groupAcks.map(function(a, k) {
            return { id: ids[k], type: 'function',
                     function: { name: a.name, arguments: JSON.stringify(a.args) } };
          }),
        });
        for (var k = 0; k < groupAcks.length; k++) {
          out.push({ role: 'tool', tool_call_id: ids[k],
                     content: stampTs(groupAcks[k].ts, groupAcks[k].result) });
        }
        // Brief A2 / D3, voie (b) : un recall d'IMAGE ré-injecte les pixels via
        // un message user SYNTHÉTIQUE inséré APRÈS tous les tool results du
        // groupe (séquence assistant→tools→user bien formée). La dataUrl est
        // posée par le pré-pass resolveRecallImages (resources.js) — absente si
        // le record n'est plus en cache, auquel cas rien n'est émis. Content
        // parts OpenAI, même forme que le tour d'attache (voie F2-prouvée).
        for (var r = 0; r < groupAcks.length; r++) {
          if (groupAcks[r].recallImage) {
            // `_synthetic` : marque ce message user comme NON authentique (ni
            // saisi ni édité par l'utilisateur). Suspect S1 (brief A2) : le
            // calcul de lastUserIdx (dispatchSend, main.js) doit l'exclure, sinon
            // l'injection <miaou_context> se poserait dessus au lieu du vrai
            // dernier message user (cas d'un thread finissant sur un recall).
            out.push({ role: 'user', _synthetic: true, content: [
              { type: 'text', text: '[Contenu de la pièce jointe ' + (groupAcks[r].attId || '') + ' ré-injecté :]' },
              { type: 'image_url', image_url: { url: groupAcks[r].recallImage } },
            ] });
          }
        }
        i = j;
      } else {
        i++;   // ack legacy non enrichi : élagué
      }
    } else {
      out.push({ role: m.role, content: m.content });
      i++;
    }
  }
  return out;
}

// ── Parsing défensif du JSON de résumé ──────────────────────────────────────
// Le modèle enrobe parfois sa réponse de fences ```json … ```. On nettoie,
// puis on tente JSON.parse ; en cas d'échec on renvoie null sans planter.
function parseSummaryJSON(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  const tryParse = (str) => {
    try { const o = JSON.parse(str); return (o && typeof o === 'object') ? o : null; }
    catch (e) { return null; }
  };

  let obj = tryParse(s);
  if (obj) return obj;

  // Repli : extraire le premier objet {…} noyé dans de la prose ou suivi de texte.
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) obj = tryParse(s.slice(first, last + 1));
  return obj;
}

// ── Context inspector (brief B) ─────────────────────────────────────────────
// Heuristique unique, source unique (D2) : un vrai tokenizer ou un total
// rapporté par l'API pourra remplacer ce calcul sans toucher les call-sites.
function estimateTokens(str) {
  return Math.ceil((str || '').length / 4);
}

// Estimation conventionnelle, volontairement grossière (D3) : la vision est
// dépendante du modèle et inconnaissable côté client ; on affiche une ligne
// séparée labellisée "très approximatif" plutôt que de compter le base64 en
// chars/4 (qui exploserait le total sans rapport avec le coût réel).
const IMAGE_TOKENS_ESTIMATE = 768;

// Seuil d'alerte (D5) : au-delà de ce ratio d'occupation de la fenêtre de
// contexte connue, la jauge passe ambre.
const CONTEXT_WINDOW_WARN_RATIO = 0.8;

// Construit le manifeste de contexte (D1) : une entrée par bloc logique, plus
// les totaux. Pure, testable QuickJS — ne lit AUCUN global (settings, TOOLS,
// currentThread…), tout arrive en arguments. Les deux call-sites (assemblage
// réel dans dispatchSend, simulation à froid via computeContextManifestNow)
// doivent lui passer des pièces déjà calculées par les mêmes fonctions pures
// (systemMessageParts, buildContextBlock, expandThread, toolDefinitions) pour
// ne jamais dupliquer la logique d'assemblage (audit §0/§6).
//
// `sysParts` : { root, toolsSystem, intent, skills, docs, codeblock, user } (systemMessageParts()).
// `dynParts` : { contextDateModel, memories, summaries, skillsContext } — chaque
//   sous-bloc DÉJÀ formaté en string (ou '' si absent).
// `threadMsgs` : array {role, content} (content string ou array de content-parts).
// `toolDefsJson` : string = JSON.stringify(toolDefinitions()), ou '' si aucun outil.
// `apiUsage` : {prompt_tokens, completion_tokens, total_tokens} ou null (réservé, non-goal v1).
function buildContextManifest(sysParts, dynParts, threadMsgs, toolDefsJson, apiUsage) {
  const sp = sysParts || {};
  const dp = dynParts || {};
  const entries = [];

  const pushEntry = (source, label, str) => {
    const s = str || '';
    if (!s) return;
    entries.push({ source, label, chars: s.length, tokens: estimateTokens(s) });
  };

  pushEntry('root_prompt', 'Prompt racine (outils)', sp.root);
  pushEntry('tools_system', 'Liste des outils (system)', sp.toolsSystem);
  pushEntry('intent_doctrine', 'Doctrine intent', sp.intent);
  pushEntry('skills_doctrine', 'Doctrine skills', sp.skills);
  pushEntry('docs_doctrine', 'Doctrine docs', sp.docs);
  pushEntry('codeblock_doctrine', 'Doctrine codeblock', sp.codeblock);
  pushEntry('user_prompt', 'Prompt utilisateur (+ Space)', sp.user);

  pushEntry('context_date_model', 'Date/modèle/Space', dp.contextDateModel);
  pushEntry('memories', 'Souvenirs', dp.memories);
  pushEntry('summaries', 'Résumés injectés', dp.summaries);
  pushEntry('skills_context', 'Contexte skills (autotrigger)', dp.skillsContext);
  pushEntry('space_library', 'Fichiers d\'espace', dp.library);

  if (toolDefsJson) {
    entries.push({
      source: 'tool_definitions', label: 'Définitions d\'outils (JSON)',
      chars: toolDefsJson.length, tokens: estimateTokens(toolDefsJson),
    });
  }

  // Thread : agrégat + sous-comptes par rôle (brief D1). Les parts image ne
  // sont JAMAIS comptées en chars (le base64 exploserait le total) : une seule
  // ligne agrégée `attachment_images` = imageCount × IMAGE_TOKENS_ESTIMATE (D3).
  let threadChars = 0, threadTokens = 0, imageCount = 0;
  const byRole = {};
  (threadMsgs || []).forEach(m => {
    if (!m) return;
    let chars = 0;
    if (Array.isArray(m.content)) {
      m.content.forEach(part => {
        if (!part) return;
        if (part.type === 'image_url') imageCount++;
        else if (typeof part.text === 'string') chars += part.text.length;
      });
    } else if (typeof m.content === 'string') {
      chars = m.content.length;
    }
    threadChars += chars;
    const tk = estimateTokens('x'.repeat(chars));   // même arrondi que pushEntry
    threadTokens += tk;
    const role = m.role || 'other';
    if (!byRole[role]) byRole[role] = { chars: 0, tokens: 0 };
    byRole[role].chars += chars;
    byRole[role].tokens += tk;
  });
  if (threadChars > 0) {
    entries.push({
      source: 'thread', label: 'Historique (agrégat)',
      chars: threadChars, tokens: threadTokens,
      byRole: Object.keys(byRole).map(r => Object.assign({ role: r }, byRole[r])),
    });
  }

  if (imageCount > 0) {
    const imgTokens = imageCount * IMAGE_TOKENS_ESTIMATE;
    entries.push({
      source: 'attachment_images', label: 'Images jointes',
      chars: 0, tokens: imgTokens, images: imageCount,
    });
  }

  const totalChars = entries.reduce((a, e) => a + (e.chars || 0), 0);
  const totalTokens = entries.reduce((a, e) => a + (e.tokens || 0), 0);

  return { entries, totalChars, totalTokens, imageCount, apiUsage: apiUsage || null };
}

// Calibre un manifeste ESTIMÉ (chars/4) sur l'usage réel rapporté par l'API
// (Bbis). Pure, QuickJS-testable. Fallback = manifeste inchangé si `usage` est
// absent/incomplet ou si le manifeste n'a rien à mettre à l'échelle — jamais
// d'erreur, même posture que reasoning_effort/vision (tolérance null).
//
// La ligne `attachment_images` est EXCLUE du facteur ET du scaling (décision
// PLAN-Bbis §Bbis-2) : c'est une constante conventionnelle « très
// approximatif », pas une estimation chars/4 — la mélanger au calibrage la
// ferait paraître doublement fausse. Le `prompt_tokens` réel inclut déjà le
// coût vision réel (non ventilable côté client) ; la ligne reste affichée à
// part, en estimé, hors budget texte réel.
function scaleManifestToUsage(manifest, usage) {
  const m = manifest || { entries: [], totalChars: 0, totalTokens: 0, imageCount: 0, apiUsage: null };
  if (!usage || usage.prompt_tokens == null) return m;

  const imagesEntry = (m.entries || []).find(e => e.source === 'attachment_images');
  const imageTokens = imagesEntry ? (imagesEntry.tokens || 0) : 0;
  const scalableTokens = (m.totalTokens || 0) - imageTokens;
  if (scalableTokens <= 0) return m;

  const factor = usage.prompt_tokens / scalableTokens;
  let scaledSum = 0;
  let biggestIdx = -1, biggestTokens = -1;
  const entries = (m.entries || []).map((e, i) => {
    if (e.source === 'attachment_images') return e;   // exclue, cf. commentaire ci-dessus
    const tokens = Math.round((e.tokens || 0) * factor);
    if (e.tokens > biggestTokens) { biggestTokens = e.tokens; biggestIdx = i; }
    scaledSum += tokens;
    return Object.assign({}, e, { tokens });
  });

  // Résidu d'arrondi reporté sur la plus grosse ligne (source, pas la copie
  // déjà poussée dans `entries`) pour que Σ(entries.tokens hors images) ===
  // usage.prompt_tokens exactement.
  const residual = usage.prompt_tokens - scaledSum;
  if (residual !== 0 && biggestIdx >= 0) {
    entries[biggestIdx] = Object.assign({}, entries[biggestIdx], {
      tokens: entries[biggestIdx].tokens + residual,
    });
  }

  return Object.assign({}, m, {
    entries,
    totalTokens: usage.prompt_tokens + imageTokens,
    apiUsage: usage,
    real: true,
  });
}

// Extrait les compteurs dérivés de l'usage API en un objet simple, nulls
// tolérés partout (Bbis) — évite au code de rendu de re-décoder
// `prompt_tokens_details.cached_tokens` inline.
function usageDerived(usage) {
  if (!usage) return { inTokens: null, outTokens: null, cachedTokens: null, cachedRatio: null };
  const inTokens = usage.prompt_tokens != null ? usage.prompt_tokens : null;
  const outTokens = usage.completion_tokens != null ? usage.completion_tokens : null;
  const cachedTokens = usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens != null
    ? usage.prompt_tokens_details.cached_tokens : null;
  const cachedRatio = (cachedTokens != null && inTokens) ? cachedTokens / inTokens : null;
  return { inTokens, outTokens, cachedTokens, cachedRatio };
}
