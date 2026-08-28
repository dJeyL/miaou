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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  'slug', 'created',                      // skills (created : write = création vs modification)
  'topic', 'query',                      // aide (about_read, about_search)
  'handle', 'ok', 'outLen', 'code',      // js__eval (lot L) — handle, succès, taille sortie, code exécuté
  'path',                                 // docs__extract (lot V-1) — chemin du membre extrait dans l'archive
  'selector',                             // docs__read (lot V-4) — plage d'unités lue (« 2-5 »)
  'message',                             // tool_failed — message d'échec d'un outil natif (toolFail)
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

// Prédicat UNIQUE « cet ack rend compte d'un échec ? » — source de vérité du
// rendu en erreur, partagée par le thread live (buildToolAck, ui.js) et les DEUX
// exports (_formatToolCallMd / _formatToolCallHtml). Deux signaux, jamais
// fusionnés dans l'objet persisté :
//   - `error: true` : posé par callRemoteTool (tools.js) sur les acks MCP
//     distants (isError du serveur, ou throw/timeout du transport).
//   - `ok === false` : posé par le handler js__eval (lot L) — refus de cap ET
//     plantage guest. Côté MODÈLE ces deux cas ne sont volontairement PAS des
//     isError (result texte cadré, pour laisser le modèle se re-cibler sans
//     couper la boucle d'outils) : l'échec n'existe donc QUE dans l'ack, d'où
//     ce second signal. Tester `m.error` seul laissait ces acks en blanc.
// `ok` est explicitement `false` (pas absent) : `!m.ok` serait faux positif sur
// tous les acks qui ne portent pas le champ.
function ackIsError(m) {
  if (!m) return false;
  if (m.error) return true;
  if (m.ok === false) return true;
  return false;
}

// Prédicat UNIQUE « cet ack désigne-t-il une ressource téléchargeable ? »
// (lot V). Source de vérité du bouton de téléchargement des acks
// (`buildToolAck`, ui.js) — ne jamais réécrire une liste de kinds ailleurs.
// Renvoie une CIBLE typée, pas un id nu : les deux familles ne se résolvent pas
// par la même clé (`resource_*` par id de ressource IDB, `attachment_recalled`
// par attId scopé à une conversation — cf. getCachedRecordByAttId), et
// aplatir les deux dans un seul champ ferait résoudre le mauvais store.
// `null` quand l'ack ne désigne rien de téléchargeable, ou qu'il lui manque sa
// clé (ack legacy, champ absent de ACK_COPY_FIELDS à l'époque de l'écriture).
// Pure, testable en QuickJS.
function ackDownloadTarget(m) {
  if (!m) return null;
  const kind = ackKindOf(m);
  const name = m.resourceName || '';
  const mime = m.mime || '';
  if (kind === 'resource_stored' || kind === 'resource_presented') {
    return m.id ? { by: 'resource', id: m.id, name, mime } : null;
  }
  if (kind === 'attachment_recalled') {
    return m.attId ? { by: 'attachment', attId: m.attId, convId: m.convId || null, name, mime } : null;
  }
  return null;
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

// Auto-grandissement d'un <textarea> jusqu'à une hauteur max. 168px DOIT
// rester synchronisé avec `max-height` de #composer-text (composer.css) —
// deux constantes en dur, aucune source unique côté build.
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

// Seuil de longueur de requête sous lequel on NE scanne PAS le contenu des
// messages : le bruit d'un substring de 1-2 caractères domine le signal (« ab »
// matcherait la moitié de l'historique). Titre et résumé, eux, restent scannés
// dès le premier caractère. Vit ici (pur) parce que le seuil gouverne à la fois
// le prédicat de rendu et la passe de scan asynchrone (U-3) : une seule valeur.
const CONTENT_SCAN_MIN_CHARS = 3;

// Le contenu d'UNE conversation contient-il `q` (déjà en minuscules) ?
// Pur et sans IDB : la passe async (`collectContentSearchHits`, storage.js) lit
// les records, ce prédicat décide. C'est lui qui porte l'invariant de ce qui est
// scanné — sorti en pur exprès plutôt que noyé dans du code IDB non testable
// (cf. `project_extract_pure_helper_over_idb_stub`).
//
// Deux exclusions, héritées du prédicat synchrone d'avant U-3 :
//   - les acks (tool-ack/memory-ack) portent des `result` potentiellement
//     énormes et hors-sujet, ainsi que le champ `reasoning` (pas du contenu
//     adressé à l'utilisateur) ;
//   - côté user, on scanne le littéral tapé (`displayText`), jamais le corps
//     baké d'une slash-skill (que `content` porte aussi).
function convContentMatches(conv, q) {
  if (!conv || !Array.isArray(conv.messages) || !q) return false;
  for (const m of conv.messages) {
    if (isAckRole(m.role)) continue;
    const text = m.role === 'user' ? (m.displayText ?? m.content) : m.content;
    if (typeof text === 'string' && text.toLowerCase().includes(q)) return true;
  }
  return false;
}

// ── Command palette : scoring / filtrage / tri (fonctions pures, lot F) ─────
// La palette (Ctrl/Cmd+K) filtre une liste de commandes déclaratives
// `{id, label, keywords[]}` à la frappe. Scoring distinct de scoreSummary
// (résumés) : ici substring + word-boundary sur label + keywords (brief F, D3 —
// pas de lib fuzzy). Tout ce bloc est pur → testé QuickJS ; le registre lui-même
// (run()/enabled(), effets de bord DOM) vit dans ui.js.

// Score d'une commande pour une requête déjà tokenisée. Pour chaque token :
// - match en début de mot (word-boundary) du label → +3
// - substring interne du label → +2
// - match d'un keyword (exact ou préfixe) → +2
// - substring interne d'un keyword → +1
// Un token sans aucun match n'annule PAS le score (recouvrement, pas conjonction
// stricte) mais un score global de 0 signifie « aucun match » côté filterCommands.
// Requête vide (aucun token) → score 0 (l'appelant conserve alors l'ordre du registre).
function scoreCommand(queryTokens, cmd) {
  const label = String(cmd.label || '').toLowerCase();
  const kws = (cmd.keywords || []).map(k => String(k).toLowerCase());
  // Mots du label pour la détection de frontière (préfixe de mot).
  const labelWords = label.match(/[\p{L}\p{N}]+/gu) || [];
  let score = 0;
  for (const t of queryTokens) {
    if (labelWords.some(w => w.startsWith(t))) score += 3;
    else if (label.indexOf(t) >= 0) score += 2;
    else if (kws.some(k => k === t || k.startsWith(t))) score += 2;
    else if (kws.some(k => k.indexOf(t) >= 0)) score += 1;
  }
  return score;
}

// Filtre + trie une liste de commandes pour une requête brute. Requête vide →
// liste inchangée (ordre du registre préservé). Sinon : score chaque commande,
// garde score > 0, tri score décroissant STABLE (départage par index d'origine).
// N'évalue PAS enabled() — le filtrage de disponibilité se fait en amont
// (impur, côté ui.js) : cette fonction reste pure.
function filterCommands(commands, query) {
  const list = commands || [];
  const qTokens = tokenize(query || '');
  if (!qTokens.length) return list.slice();
  return list
    .map((cmd, i) => ({ cmd, i, score: scoreCommand(qTokens, cmd) }))
    .filter(x => x.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map(x => x.cmd);
}

// Tri des résultats du submode « recherche de conversation » (brief F, D2 —
// décision Julien 2026-07-11 : recherche CROSS-Space, mais les conversations du
// Space actif passent EN TÊTE même si elles scorent moins). Clef à deux niveaux :
// (1) Space actif d'abord, (2) score décroissant, (3) ordre d'origine stable.
// Entrées déjà scorées `{spaceId, score, ...}` — pur, aucun accès storage.
function rankConvResults(results, activeSpaceId) {
  return (results || [])
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const aActive = a.r.spaceId === activeSpaceId ? 0 : 1;
      const bActive = b.r.spaceId === activeSpaceId ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      const ds = (b.r.score || 0) - (a.r.score || 0);
      if (ds) return ds;
      return a.i - b.i;
    })
    .map(x => x.r);
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

// Nom de fichier d'export d'une conversation : miaou-<slug>-<AAAA-MM-JJ>.<ext>.
// UNE seule formule pour les deux exports (Markdown et HTML standalone) — ils
// ont divergé une fois (le MD sortait un `<slug>.md` nu, sans préfixe ni date),
// écart né de la formule recopiée à un seul des deux endroits. Toute évolution
// du gabarit se fait ici, jamais dans l'appelant.
function exportConvFilename(title, now, ext) {
  return 'miaou-' + slugTitle(title) + '-' + exportDateStamp(now) + '.' + ext;
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

// ── Conversion Markdown → HTML (lot R) ───────────────────────────────────────
// Extrait le titre de niveau 1 EN TÊTE de document, s'il existe : il alimente
// le cartouche d'en-tête de l'export et est RETIRÉ du corps (sinon il
// apparaîtrait deux fois). Sans h1 en tête, pas de cartouche du tout (spec
// Julien) — d'où le `title: null` retourné, distinct d'une chaîne vide.
//
// « En tête » = premier contenu non blanc, en tolérant un front-matter YAML
// (délimité par ---) qu'on retire au passage : un .md exporté depuis un autre
// outil en porte souvent un, et le laisser produirait un tableau parasite en
// tête de rendu.
//
// Seule la forme ATX (`# Titre`) est reconnue, pas Setext (`Titre\n=====`) :
// forme marginale, et la reconnaître obligerait à distinguer un souligné d'une
// ligne horizontale. Un Setext reste rendu normalement dans le corps, il ne
// devient juste pas le titre du cartouche.
function extractMdTitle(md) {
  let body = String(md == null ? '' : md);
  // Front-matter YAML : uniquement s'il ouvre le document.
  body = body.replace(/^﻿/, '');
  const fm = /^[ \t]*---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(body);
  if (fm) body = body.slice(fm[0].length);
  // Premier contenu non blanc : doit être un h1 ATX pour donner un titre.
  const m = /^(?:[ \t]*\r?\n)*[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*(?:\r?\n|$)/.exec(body);
  if (!m) return { title: null, body: body.replace(/^(?:[ \t]*\r?\n)+/, '') };
  const title = m[1].trim();
  if (!title) return { title: null, body: body.replace(/^(?:[ \t]*\r?\n)+/, '') };
  return { title, body: body.slice(m[0].length).replace(/^(?:[ \t]*\r?\n)+/, '') };
}

// Repli de rendu quand marked n'est pas chargé (CDN injoignable) : découpe en
// paragraphes sur les lignes VIDES et réenroule les retours simples en espaces —
// même convention CommonMark que le chemin nominal (`breaks: false`), pour que le
// rendu ne dépende pas de la disponibilité du CDN. Échappe tout : l'entrée est un
// fichier utilisateur, jamais interprétée comme du HTML sur ce chemin.
function plainTextToParagraphs(text) {
  const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const blocks = src.split(/\n[ \t]*\n+/);
  const html = blocks
    .map(b => b.replace(/\n/g, ' ').trim())
    .filter(b => b.length)
    .map(b => '<p>' + escHtml(b) + '</p>')
    .join('');
  return html;
}

// Nom du fichier HTML produit à partir du nom du .md source : on remplace la
// seule extension .md/.markdown finale, sans toucher au reste du nom (« notes
// v2.md » → « notes v2.html »). Le titre h1 éventuel n'intervient PAS (spec
// Julien : le nom suit le fichier source). Nom vide/absent → repli neutre.
function mdHtmlFileName(sourceName) {
  const raw = String(sourceName == null ? '' : sourceName).trim()
    .replace(/[\\/]/g, '_')            // jamais de séparateur de chemin
    .replace(/[\x00-\x1f\x7f]/g, '')   // caractères de contrôle
    .replace(/^\.+/, '');              // pas de fichier caché ni de ../
  if (!raw) return 'document.html';
  return raw.replace(/\.(?:md|markdown)$/i, '') + '.html';
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
  const n = sanitizeFileStem(name);
  if (!n) return '';
  if (hasFileExt(n)) return n;
  return n + '.' + langExt(lang);
}

// Coeur d'assainissement, SANS suffixage d'extension — extrait de
// sanitizeDownloadName (lot V) pour être partagé avec resourceDownloadName, qui
// dérive son extension d'un mime et non d'un langage. Sépare les deux
// responsabilités : nettoyer un nom hostile / choisir une extension. Le strip
// des points de tête vient APRÈS celui des séparateurs, pour que '../x' ne
// laisse pas de fichier caché. Pure, testable en QuickJS.
function sanitizeFileStem(name) {
  return String(name || '')
    .replace(/[\/\\]/g, '_')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .trim();
}

// « Ce nom porte-t-il déjà une extension ? » — prédicat unique, partagé par les
// deux nommeurs de téléchargement pour qu'ils ne divergent jamais.
function hasFileExt(n) {
  return /\.[^.\/\\]+$/.test(String(n || ''));
}

// Correspondance type MIME → extension de fichier (lot V, téléchargement de
// ressources). Complément de LANG_TO_EXT, qui part d'un langage de fence : ici
// la source est le `mime` figé sur le record IDB. Table volontairement courte
// (les cas courants), avec deux replis génériques avant le défaut :
// `image/<x>` → `<x>` (couvre png/gif/webp/avif… sans les énumérer) et un
// suffixe `+xml`/`+json` réduit à sa base. Pure, testable en QuickJS.
const MIME_TO_EXT = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'text/css': 'css',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/javascript': 'js',
  'text/javascript': 'js',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

function mimeExt(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (!m) return 'bin';
  if (MIME_TO_EXT[m]) return MIME_TO_EXT[m];
  const slash = m.indexOf('/');
  if (slash < 0) return 'bin';
  let sub = m.slice(slash + 1);
  const plus = sub.lastIndexOf('+');
  if (plus > 0) sub = sub.slice(plus + 1);          // application/foo+json → json
  if (m.slice(0, slash) === 'image') return sub;    // image/webp → webp
  return MIME_TO_EXT[m.slice(0, slash) + '/' + sub] || sub || 'bin';
}

// Nom de fichier proposé au téléchargement d'une ressource IDB (lot V). Le nom
// stocké est d'origine MODÈLE ou OUTIL : il peut être vide, absurde, ou sans
// extension (contrairement à un attachment utilisateur, qui vient d'un vrai
// fichier). D'où l'assainissement `sanitizeDownloadName` — mais son extension
// de repli dérive d'un LANGAGE, hors sujet ici : on la court-circuite en
// suffixant nous-mêmes depuis le mime AVANT de l'appeler. Repli générique
// `ressource.<ext>` si le nom est vide ou ne survit pas à l'assainissement.
// Pure, testable en QuickJS.
function resourceDownloadName(name, mime) {
  const ext = mimeExt(mime);
  // Assainir AVANT de suffixer, jamais l'inverse : sur un nom réduit à des
  // points ('...'), suffixer d'abord produirait '....csv', que le strip de
  // points de tête ramène à '.csv' — un fichier CACHÉ, sans nom. Et on passe
  // par sanitizeFileStem plutôt que sanitizeDownloadName : cette dernière
  // suffixerait '.txt' (langExt) avant qu'on ait pu placer l'extension du mime.
  const n = sanitizeFileStem(name);
  if (!n) return 'ressource.' + ext;
  return hasFileExt(n) ? n : n + '.' + ext;
}

// ── Rendu Mermaid (lot E) : helpers purs ─────────────────────────────────────
// Détection du langage mermaid sur la classe language-* posée par le renderer
// marked custom (via parseCodeFenceInfo) — seule source de vérité de langue,
// comme decoratePre (ui.js). Pure, testable en QuickJS.
function isMermaidLang(lang) {
  return String(lang || '').toLowerCase() === 'mermaid';
}

// Thème Mermaid dérivé du data-theme RÉSOLU (light|dark) posé par applyTheme
// (ui.js) — 'default' est le thème clair de Mermaid. Pure, testable ; toute
// valeur non-'dark' (y compris absente) retombe sur le thème clair, cohérent
// avec le fallback de applyTheme.
function mermaidThemeFor(resolved) {
  return resolved === 'dark' ? 'dark' : 'default';
}

// Nettoie la source mermaid AVANT parse/render : retire les balises HTML de mise
// en forme inline (b/i/em/strong/u/mark/small) que le modèle glisse parfois dans
// les labels malgré la doctrine (CODEBLOCK_DOCTRINE). En htmlLabels:false, ces
// balises ne sont PAS interprétées : elles s'affichent littéralement (« <b>x</b> »)
// dans les <text> SVG. On les strippe pour ne garder que le texte ; <br/> est
// PRÉSERVÉ (seule balise reconnue par Mermaid comme saut de ligne). Convertit
// aussi les séquences backslash-n LITTÉRALES (deux caractères \ et n dans le
// texte, pas un vrai saut de ligne) en <br/> : malgré la doctrine, les modèles
// en glissent régulièrement dans les labels — mermaid ne les interprète pas et
// ça casse le parse ou s'affiche tel quel. Ne touche PAS aux vrais retours à la
// ligne (\r\n/\n réels), qui délimitent les instructions mermaid. Défense en
// profondeur côté application, indépendante de l'obéissance du modèle.
// N'altère JAMAIS code.textContent (source de vérité) : appliquée uniquement à la
// chaîne passée à mermaid.render. Pure, testable en QuickJS.
function sanitizeMermaidSource(src) {
  return String(src == null ? '' : src)
    .replace(/<\/?(?:b|i|em|strong|u|mark|small)\s*>/gi, '')
    .replace(/\\n/g, '<br/>');
}

// Nom de fichier pour l'export image d'un diagramme Mermaid (lot E3) : le
// data-filename du fence, assaini par sanitizeDownloadName, extension
// REMPLACÉE par celle de l'image demandée (un data-filename de bloc mermaid
// porte typiquement .mmd — on télécharge une image, pas la source) ; nom
// générique miaou-diagram.<ext> si absent ou vide après assainissement.
// Pure, testable en QuickJS.
function diagramImageName(rawName, ext) {
  const n = sanitizeDownloadName(rawName, '');
  if (!n) return 'miaou-diagram.' + ext;
  return n.replace(/\.[^.]+$/, '') + '.' + ext;
}

// ── Préviz sandboxée HTML/SVG (lot E, D2) : helpers purs ─────────────────────
// Langues éligibles au bouton « Aperçu » : html et svg SEULEMENT (pas de
// runner JS, pas de transpile — non-goals du brief). xml/xhtml exclus
// volontairement : trop ambigus pour promettre un rendu.
function isPreviewableLang(lang) {
  const l = String(lang || '').toLowerCase();
  return l === 'html' || l === 'svg';
}

// Langues éligibles au bouton « Convertir en HTML » d'un bloc de code (lot R,
// point 4) : markdown seulement. Même geste que le convertisseur des réglages,
// appliqué au contenu d'un bloc affiché à l'écran — sans passer par un fichier.
// Pure, testable en QuickJS.
function isMarkdownLang(lang) {
  const l = String(lang || '').toLowerCase();
  return l === 'markdown' || l === 'md';
}

// Document srcdoc de l'iframe de préviz. html → passthrough BYTE-IDENTIQUE
// (le contenu est déjà un document ou fragment HTML, le navigateur complète) ;
// svg → enveloppé dans un document HTML minimal (un SVG nu n'est pas un
// document HTML valide pour srcdoc, et il peut porter <script> : il s'exécute,
// mais confiné dans la sandbox — c'est le contrat D2). Pure, déterministe.
function buildPreviewSrcdoc(lang, code) {
  const src = String(code == null ? '' : code);
  if (String(lang || '').toLowerCase() === 'svg') {
    return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
           '<body style="margin:0">' + src + '</body></html>';
  }
  return src;
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

// ── js__eval : briques pures du sandbox de compute (lot L) ────────────────────
// Substrat de la primitive guest lines() : découpe un texte en lignes sur \n,
// après normalisation des fins de ligne CRLF/CR → LF. Le dernier fragment sans
// \n final est conservé (une ligne non terminée compte). Un texte vide donne
// [''] (une ligne vide), cohérent avec String.split. Pure, QuickJS-testable ;
// référence qui PIN le comportement du prélude guest lines() (réécrit en
// string pure dans tools.js, cf. piège 25 — surface guest fermée à la seule
// __miaou_text()).
function splitLines(text) {
  const s = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return s.split('\n');
}

// Garde de cap d'output (lot L, §3 du brief — REFUS explicite, pas troncature).
// Mesure la longueur de la sortie marshalée depuis le guest et décide si elle
// tient sous le cap. Retourne {ok:true, len, cap} si len <= cap, sinon
// {ok:false, len, cap} : l'appelant transforme le cas ok:false en message de
// refus (« ta sortie fait N chars > cap M, réduis-la »), JAMAIS en troncature
// silencieuse. Pure, QuickJS-testable, isolée du marshaling VM.
function checkOutputCap(str, cap) {
  const len = String(str == null ? '' : str).length;
  return { ok: len <= cap, len: len, cap: cap };
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

// Résout un nom d'appel vers son nom canonique d'outil INTERNE, ou null si l'outil
// n'est pas interne (→ serveur MCP distant). Le REGISTRE tranche, pas la forme du
// nom : depuis que des outils internes portent un sous-namespace (`memory__create`,
// `conv__get`, `resource__present`, lot P), parseToolName ne peut plus distinguer
// `memory__update` (interne) de `server__tool` (distant) — les deux ont un `__`.
// On accepte le nom NU (`memory__create`) comme le nom préfixé (`miaou__memory__create`) :
// dans les deux cas, on cherche le nom nu dans `tools` (registre TOOLS, entrées `{name}`).
// Pur (cf. D1) : aucune dépendance à l'état, testable sans stub.
function resolveInternalToolName(name, tools) {
  const s = String(name || '');
  const bare = s.indexOf('miaou__') === 0 ? s.slice('miaou__'.length) : s;
  const hit = (tools || []).some(t => t && t.name === bare);
  return hit ? bare : null;
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

// Palier calendaire d'un ts par rapport à `now` (both epoch ms), partagé par
// sectionFor (en-tête de section sidebar) et relativeWhen (libellé de date) —
// un seul calcul des bornes today/hier/7j/30j, formatages distincts au-dessus.
// `now` injecté pour QuickJS. Découpage CALENDAIRE (via _startOfDay), pas une
// fenêtre glissante de 24 h. Retourne { bucket, startOfToday, day, daysAgo } où
// bucket ∈ 'today'|'yesterday'|'week'|'month'|'older' et daysAgo = nombre de
// jours calendaires écoulés (0 = aujourd'hui), utile aux libellés « il y a N j ».
function calendarBucket(ts, now) {
  const day = 86400000;
  const startOfToday = _startOfDay(new Date(now));
  if (!ts) return { bucket: 'older', startOfToday, day, daysAgo: Infinity };
  let bucket;
  if (ts >= startOfToday) bucket = 'today';
  else if (ts >= startOfToday - day) bucket = 'yesterday';
  else if (ts >= startOfToday - 7 * day) bucket = 'week';
  else if (ts >= startOfToday - 30 * day) bucket = 'month';
  else bucket = 'older';
  const daysAgo = Math.floor((startOfToday - ts) / day) + 1;
  return { bucket, startOfToday, day, daysAgo };
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

// Variante avec heure : YYYY-MM-DD-HHMM (heure locale), pour le nom de fichier
// de l'export global (exportAllData) — même logique de pad qu'exportDateStamp,
// pas de dé-duplication d'un pad inline dans main.js.
function exportDateTimeStamp(now) {
  const d = new Date(now);
  const p = n => (n < 10 ? '0' : '') + n;
  return exportDateStamp(now) + '-' + p(d.getHours()) + p(d.getMinutes());
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

// Offset de zone locale au format ISO 8601 (+HH:MM / -HH:MM / Z), sans Intl :
// `getTimezoneOffset()` rend des MINUTES À SOUSTRAIRE de l'heure locale pour
// obtenir UTC — le signe est donc INVERSÉ par rapport à la notation ISO
// (Europe/Paris en été : offset -120, notation +02:00).
function isoOffset(d) {
  const off = -d.getTimezoneOffset();
  if (off === 0) return 'Z';
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  const h = Math.floor(abs / 60), m = abs % 60;
  return sign + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

// Horodatage ISO 8601 en heure LOCALE avec offset explicite (2026-06-26T14:30+02:00).
// Distinct de `Date#toISOString` (qui normalise en UTC) : on garde l'heure du
// mur, celle que l'utilisateur a vécue, et l'offset dit dans quel référentiel
// elle se lit.
function isoLocalStamp(ts) {
  const d = new Date(ts);
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + isoOffset(d);
}

// Préfixe d'horodatage absolu pour les résultats d'outils réinjectés cross-turn.
// La valeur est figée à l'instant de l'appel ; le modèle en infère l'ancienneté
// via le "now" déjà présent dans <miaou_context>. NE PAS recalculer à chaque
// envoi (mutation → busterait le KV cache de tout le préfixe history).
//
// Format ISO 8601 avec offset, PAS la date française de `formatFullDateFr` : ce
// préfixe est un canal machine→machine (jamais affiché à l'utilisateur), et un
// horodatage sans zone y est un piège actif. Le corps du résultat vient d'un
// outil quelconque et peut porter ses propres heures dans un TOUT AUTRE
// référentiel (cas payé : un MCP météo renvoyant de l'UTC, préfixé d'une heure
// locale muette → le modèle mélangeait les deux). L'offset rend le préfixe
// auto-descriptif, sans dépendre du `now` de <miaou_context> ni d'une doctrine
// qui demanderait au modèle de deviner.
function stampTs(ts, result) {
  var s = result != null ? String(result) : '';
  if (!ts) return s;
  return '[Résultat du ' + isoLocalStamp(ts) + ']\n' + s;
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
  // Un backtick dans le contenu fermerait prématurément le code span inline
  // (tous les call-sites enveloppent le retour dans `...`) : neutralisé par
  // une apostrophe courbe, visuellement proche, sans risque de collision.
  s = s.replace(/`/g, '´');
  return s.length > max ? s.slice(0, max) + '...' : s;
}

// Représentation textuelle d'un appel d'outil pour l'export (un seul ack,
// déjà enrichi : args/result présents). `m.name` peut être préfixé
// (`miaou__memory__create`) ou breadcrumb distant (`server__tool`) — affiché tel quel.
function _formatToolCallMd(m) {
  const lines = [];
  const head = m.intent ? '`' + m.name + '` — ' + m.intent : '`' + m.name + '`';
  lines.push(head);
  if (m.args != null) lines.push('   Arguments : `' + _truncMd(JSON.stringify(m.args), EXPORT_ARGS_MAX) + '`');
  if (ackIsError(m)) {
    lines.push('   Résultat (erreur) : `' + _truncMd(m.result, EXPORT_RESULT_MAX) + '`');
  } else if (m.result != null) {
    lines.push('   Résultat : `' + _truncMd(m.result, EXPORT_RESULT_MAX) + '`');
  }
  if (m.kind === 'resource_presented') {
    const name = _truncMd(m.resourceName || m.id || '?', EXPORT_RESNAME_MAX);
    lines.push('   Ressource présentée automatiquement : `' + name + '`' +
      (m.mime ? ' (' + m.mime + ')' : '') + ' — non incluse dans cet export');
  }
  // js__eval (lot L) : le code exécuté est capté dans l'ack (champ `code`),
  // rendu ici COMPLET (non tronqué comme les args) dans un fence — c'est la
  // seule trace du code, invisible dans le thread live (brief §3). `handle` et
  // `outLen` donnent le contexte (sur quoi, taille du résultat).
  if (m.kind === 'js_eval' && m.code != null) {
    lines.push('   Handle : `' + _truncMd(m.handle || '?', EXPORT_RESNAME_MAX) + '`' +
      (m.outLen != null ? ' — sortie ' + m.outLen + ' car.' : ''));
    lines.push('   Code exécuté :');
    lines.push('   ```js');
    String(m.code).split('\n').forEach(cl => lines.push('   ' + cl));
    lines.push('   ```');
  }
  return lines;
}

// Bloc Markdown (blockquote) pour un groupe d'acks enrichis d'un même tour.
// Un seul appel → "Outil appelé :" ; plusieurs → "n outils appelés :" en liste
// numérotée — compteur en toutes lettres, JAMAIS entre parenthèses (même formule
// que le summary de l'export HTML, cf. formatToolAcksHtml).
function formatToolAcksMd(acks) {
  if (!acks || !acks.length) return '';
  const lines = [];
  if (acks.length === 1) {
    const inner = _formatToolCallMd(acks[0]);
    lines.push('> **Outil appelé :** ' + inner[0]);
    for (let i = 1; i < inner.length; i++) lines.push('>    ' + inner[i]);
  } else {
    lines.push('> **' + acks.length + ' outils appelés :**');
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
  lines.push(ackIsError(m) ? '<span class="ack-head-error">' + head + '</span>' : head);
  if (m.args != null) {
    lines.push('<br>Arguments : <code>' + escHtml(_truncMd(JSON.stringify(m.args), EXPORT_ARGS_MAX)) + '</code>');
  }
  if (ackIsError(m)) {
    lines.push('<br>Résultat (erreur) : <code>' + escHtml(_truncMd(m.result, EXPORT_RESULT_MAX)) + '</code>');
  } else if (m.result != null) {
    lines.push('<br>Résultat : <code>' + escHtml(_truncMd(m.result, EXPORT_RESULT_MAX)) + '</code>');
  }
  if (m.kind === 'resource_presented') {
    const name = escHtml(_truncMd(m.resourceName || m.id || '?', EXPORT_RESNAME_MAX));
    lines.push('<br>Ressource présentée automatiquement : <code>' + name + '</code>' +
      (m.mime ? ' (' + escHtml(m.mime) + ')' : '') + ' — non incluse dans cet export');
  }
  // js__eval (lot L) : `code` et `handle` sont d'origine MODÈLE → escHtml
  // impératif (piège 21, cette fonction est l'unique chemin string→HTML à
  // risque de l'export). Code rendu COMPLET dans un <pre> (seule trace du code,
  // absent du thread live, brief §3), pas tronqué contrairement aux args.
  if (m.kind === 'js_eval' && m.code != null) {
    lines.push('<br>Handle : <code>' + escHtml(_truncMd(m.handle || '?', EXPORT_RESNAME_MAX)) + '</code>' +
      (m.outLen != null ? ' — sortie ' + escHtml(String(m.outLen)) + ' car.' : ''));
    lines.push('<br>Code exécuté :<pre class="tool-ack-code"><code>' + escHtml(String(m.code)) + '</code></pre>');
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
  const cls = ackIsError(m) ? 'tool-ack-preview ack-error' : 'tool-ack-preview';
  return '<div class="' + cls + '"><span class="ack-icon">' + EXPORT_ACK_ICON + '</span>' +
    '<span class="ack-label">' + text + '</span></div>';
}

// Compteur local (sœur de _mermaidUid, ui.js) — ids de groupe de radios uniques
// par appel, jamais référencé hors de cette fonction. Pas de dépendance
// cross-fichier (frontière du test runner, cf. CLAUDE.md).
let _toolTraceUid = 0;

// Bloc HTML pour un groupe d'acks enrichis d'un même tour — sœur HTML de
// formatToolAcksMd, même seuils/politique. Fermé par défaut (cohérent avec le
// reasoning, cf. brief G D1/§10). Trois paliers (lot N, écran dégonflé en
// usage agentique → export allégé à son tour) :
//   1. replié : SEUL le compteur est visible ("n outil(s) appelé(s)").
//   2. 1er clic (<details class="tool-trace">) : liste des intents (previews).
//   3. clic sur la liste d'intents : bascule vers le détail JSON (<ul>).
//   4. clic sur le détail JSON : REVIENT à la liste d'intents (cycle, pas de
//      cul-de-sac) — <details> natif ne permettant qu'un <summary> par palier,
//      le cycle intents↔JSON est porté par une paire de radios masqués +
//      labels cliquables (:checked ~), zéro JS, fonctionne même en export
//      statique (exportInteractive: false). Fermer/rouvrir le <details>
//      externe NE réinitialise PAS ce choix (les radios, contrairement à un
//      <details> imbriqué, ne sont pas remis à zéro par le DOM) — assumé :
//      le vrai besoin était une porte de sortie cliquable, pas la remise à
//      zéro au collapse (tranché avec Julien).
function formatToolAcksHtml(acks) {
  if (!acks || !acks.length) return '';
  const n = acks.length;
  const summary = n === 1 ? '1 outil appelé' : n + ' outils appelés';
  const previews = acks.map(_formatToolCallPreviewHtml).join('');
  let inner;
  if (n === 1) {
    inner = '<li>' + _formatToolCallHtml(acks[0]) + '</li>';
  } else {
    inner = acks.map(m => '<li>' + _formatToolCallHtml(m) + '</li>').join('');
  }
  const uid = 'tt' + (++_toolTraceUid) + Math.random().toString(36).slice(2, 8);
  const radioName = 'ttr' + uid;
  const idIntents = 'tti' + uid;
  const idJson = 'ttj' + uid;
  return '<details class="tool-trace">' +
    '<summary><span class="tool-trace-summary-text">' + summary + '</span></summary>' +
    '<div class="tool-trace-toggle">' +
    '<input type="radio" class="tt-radio" name="' + radioName + '" id="' + idIntents + '" checked>' +
    '<input type="radio" class="tt-radio" name="' + radioName + '" id="' + idJson + '">' +
    '<label class="tt-view tt-view-intents" for="' + idJson + '">' +
    '<div class="tool-ack-preview-list">' + previews + '</div>' +
    '</label>' +
    '<label class="tt-view tt-view-json" for="' + idIntents + '">' +
    '<ul>' + inner + '</ul>' +
    '</label>' +
    '</div>' +
    '</details>';
}

// Sélection PURE (testée QuickJS) des acks porteurs d'une image à ré-émettre
// dans l'export HTML (lot Gbis), miroir des règles de placeToolAck (ui.js) :
//   resource_presented → lookup par record id ;
//   resource_stored    → idem (le filtre class !== 'inline' se fait APRÈS le
//                        lookup dans renderExportBody, on ne connaît pas la
//                        classe ici — comme en live) ;
//   attachment_recalled → lookup par attId (conversation-scoped).
// Le gate anti-doublon D8 du live (getPendingToolBlocks().length === 0) n'a pas
// de sens à l'export (aucune file pendante) : non transposé (cf. AUDIT-Gbis §3).
// Retourne { by: 'id' } | { by: 'attId' } | null ; le lookup cache + filtre
// image/classe reste dans renderExportBody (seul à avoir getCachedRecord*).
function exportableAckImageKey(ack) {
  const kind = ackKindOf(ack);
  if (kind === 'resource_presented' || kind === 'resource_stored') {
    return ack.id ? { by: 'id' } : null;
  }
  if (kind === 'attachment_recalled') {
    return ack.attId ? { by: 'attId' } : null;
  }
  return null;
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

// Marqueur d'id public d'un tool result, exposé au modèle en tête du content
// réinjecté par expandThread (lot O, décision B1). Dérivé UNIQUEMENT de l'id de
// tool_call (`_hashId9(prefix + '\x00' + k)`) → byte-stable d'un tour à l'autre :
// il agrandit le préfixe KV d'un montant constant sans l'invalider. Source
// unique côté émission (expandThread) ET côté résolution (findAckByCallId) —
// jamais réécrire ce format d'un seul côté (dérive de ciblage muette).
function formatCallMarker(id) { return '[call:' + id + ']\n'; }

// Regroupe les acks ENRICHIS de `thread` en tours [assistant+tool_calls, tool…],
// avec l'id de tool_call dérivé pour chaque ack. SOURCE UNIQUE de la logique de
// groupement/dérivation d'id, partagée par expandThread (émission) et
// findAckByCallId (résolution O-2). Pur, testable QuickJS. Chaque élément :
// { acks: [ack…], ids: [callId…], start, end, assistantText }.
// `end` est l'index (exclusif) du dernier ack du groupe dans `thread`.
function enrichedAckGroups(thread) {
  var groups = [];
  var i = 0;
  while (i < thread.length) {
    var m = thread[i];
    if (isAckRole(m.role) && m.args != null) {
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
      // Acks groupés → préfixe = valeur de `group` (source api.js, commence par
      // 'g', unique par tour). Acks « solo » legacy (sans `group`, d'avant le
      // groupement) → préfixe positionnel `solo:<start>` : `start` (index du
      // groupe dans le thread) est unique par thread, donc pas de collision
      // d'ids entre plusieurs solos d'un même fil (un préfixe 'solo' constant
      // faisait dériver LE MÊME id pour tous — tool_call_id dupliqués côté
      // payload, ciblage `findAckByCallId` sur le mauvais ack, piège 26). Ne
      // collisionne pas avec l'espace 'g…' des groupes réels. Change les ids
      // émis pour ces vieux threads legacy : marqueurs `[call:]` non persistés
      // (pas de casse de données), seul le KV cache de ces fils est invalidé une
      // fois. Source unique émission/résolution (enrichedAckGroups), piège 26a.
      var prefix = grp != null ? grp : 'solo:' + i;
      groups.push({
        acks: groupAcks,
        ids: groupAcks.map(function(_, k) { return _hashId9(prefix + '\x00' + k); }),
        start: i,
        end: j,
        assistantText: groupAcks[0].assistantText != null ? groupAcks[0].assistantText : null,
      });
      i = j;
    } else {
      i++;
    }
  }
  return groups;
}

// Retrouve l'ack de `thread` dont l'expansion produit le tool_call_id `callId`
// (avec ou sans préfixe `call:`). Rejoue enrichedAckGroups — MÊME dérivation que
// l'émission, jamais dupliquée. Renvoie { ack, group, k, callId } ou null.
// Pur, testable QuickJS (lot O-2).
function findAckByCallId(thread, callId) {
  var target = String(callId || '').replace(/^\[?call:/, '').replace(/\]$/, '').trim();
  if (!target) return null;
  var groups = enrichedAckGroups(thread || []);
  for (var g = 0; g < groups.length; g++) {
    for (var k = 0; k < groups[g].ids.length; k++) {
      if (groups[g].ids[k] === target) {
        return { ack: groups[g].acks[k], group: groups[g], k: k, callId: target };
      }
    }
  }
  return null;
}

// Reconstruit un tableau de messages OpenAI depuis currentThread.
// Acks ENRICHIS (args + result présents) → paire [assistant+tool_calls, tool…].
// Acks legacy (sans args) → élagués comme avant (compat ascendante).
// Si le premier ack d'un groupe porte assistantText, le message assistant
// standalone qui le précède immédiatement est absorbé dans le content de
// l'assistant expansé pour éviter la duplication.
function expandThread(thread) {
  var out = [];
  // Groupes pré-calculés par enrichedAckGroups (source unique de la dérivation
  // d'id, partagée avec findAckByCallId) : on les indexe par leur `start`.
  var byStart = {};
  var allGroups = enrichedAckGroups(thread);
  for (var gi = 0; gi < allGroups.length; gi++) byStart[allGroups[gi].start] = allGroups[gi];
  var i = 0;
  while (i < thread.length) {
    var m = thread[i];
    if (isAckRole(m.role)) {
      if (m.args != null) {
        var group = byStart[i];
        var groupAcks = group.acks;
        var ids = group.ids;
        var j = group.end;
        var assistantText = group.assistantText;
        // Absorber le standalone assistant précédent si son content correspond
        if (assistantText && out.length &&
            out[out.length - 1].role === 'assistant' &&
            out[out.length - 1].content === assistantText &&
            !out[out.length - 1].tool_calls) {
          out.pop();
        }
        out.push({
          role: 'assistant',
          content: assistantText || null,
          tool_calls: groupAcks.map(function(a, k) {
            return { id: ids[k], type: 'function',
                     function: { name: a.name, arguments: JSON.stringify(a.args) } };
          }),
        });
        for (var k = 0; k < groupAcks.length; k++) {
          // Préfixe [call:<id>] (byte-stable, dérivé du seul id) devant le
          // content réinjecté : expose l'id de ce tool result au modèle pour
          // qu'il puisse le cibler via resource__from_result (lot O-2). Ajouté à
          // l'ÉMISSION uniquement, jamais stocké dans l'ack.
          out.push({ role: 'tool', tool_call_id: ids[k],
                     content: formatCallMarker(ids[k]) + stampTs(groupAcks[k].ts, groupAcks[k].result) });
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
    } else if (m.role === 'assistant' && (m.content == null || String(m.content).trim() === '')) {
      // Assistant à content BLANC : jamais émis. Un assistant sans content ni
      // tool_calls est REJETÉ par les backends stricts (400 « Assistant message
      // must have either content or tool_calls ») — et les tool_calls sont
      // reconstruits depuis les groupes d'acks, jamais portés par ces entrées.
      // Deux sources connues : la bulle `_acksOnly` matérialisée au drain d'une
      // interjection (lot Q — hôte DOM des acks du tour interrompu, le groupe
      // qui précède a déjà produit son assistant+tool_calls) et la bulle vide
      // d'un stop avant le premier token (onFinal 'aborted' sans contenu,
      // main.js — affordance « Régénérer » côté UI, aucune valeur payload).
      // L'élagage se fait à l'ÉMISSION : l'entrée reste dans le thread (rendu,
      // affordances, fidélité live/reload), elle ne part juste jamais sur le fil.
      i++;
    } else {
      out.push({ role: m.role, content: m.content });
      i++;
    }
  }
  return out;
}

// ── Interjections mid-génération (lot Q) — helpers purs ─────────────────────
// Fusion des littéraux d'un même drain en UN message user (arbitrage lot Q :
// jamais N messages user consécutifs). Jointure par ligne vide : un `/slug` en
// tête d'un littéral non-premier reste détecté par findSlashTriggers (frontière
// \s, dont \n) et bake donc normalement au drain.
function joinInterjectionLiterals(literals) {
  return (literals || [])
    .map(function (s) { return String(s == null ? '' : s).trim(); })
    .filter(Boolean)
    .join('\n\n');
}

// Entrée currentThread d'une interjection drainée : message user AUTHENTIQUE
// (jamais _synthetic — l'injection <miaou_context> doit pouvoir le viser au
// tour suivant), content = ce qui part réellement sur le fil (baké si skill),
// displayText = littéral tapé dès qu'ils divergent (doctrine invariant n°1).
// Byte-stabilité : content stocké tel qu'envoyé → expandThread rejoue à
// l'identique aux envois suivants.
function buildInterjectionEntry(literal, content, ts) {
  const entry = { role: 'user', content: content, ts: ts };
  if (content !== literal) entry.displayText = literal;
  return entry;
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

  pushEntry('identity_blurb', 'Identité MIAOU', sp.identity);
  pushEntry('root_prompt', 'Prompt racine (outils)', sp.root);   // DOCS_DOCTRINE y est comptée depuis V-1 (plus de part `docs` séparée)
  pushEntry('tools_system', 'Liste des outils (system)', sp.toolsSystem);
  pushEntry('intent_doctrine', 'Doctrine intent', sp.intent);
  pushEntry('skills_doctrine', 'Doctrine skills', sp.skills);
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
    const tk = Math.ceil(chars / 4);   // même arrondi qu'estimateTokens, sans son allocation
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

// Nombre max d'extraits renvoyés par topic par searchHelpContent — un
// mot-clef générique (« fichier », « conversation ») peut avoir 10+
// occurrences dans une section ; sans plafond la réponse de l'outil about_search
// explose. Au-delà, `truncated: true` signale au modèle qu'il reste des
// occurrences non montrées (il doit alors lire la section entière via `about`).
const HELP_SEARCH_MAX_EXCERPTS = 5;

// Cherche des mots-clefs dans les sections d'aide (help.md → HELP_CONTENT).
// Pure, testable QuickJS — ne lit aucun global, `helpContent` arrive en
// argument. Matching en ET : un topic n'est retourné que si TOUS les mots-clefs
// y apparaissent (insensible à la casse) — un OU noierait le résultat dès 2-3
// mots courants. Un extrait par OCCURRENCE de mot-clef (pas juste la première
// du premier mot-clef) : un extrait centré sur le 1er hit peut rater le
// passage pertinent si un autre mot-clef de la requête apparaît plus loin dans
// la section (payé en usage réel — Mistral concluant à tort à l'absence d'une
// fonctionnalité documentée plus bas). Fenêtres qui se chevauchent fusionnées
// en un seul extrait ; plafond HELP_SEARCH_MAX_EXCERPTS, au-delà `truncated: true`.
function searchHelpContent(helpContent, query) {
  const keywords = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!helpContent || keywords.length === 0) return [];

  const EXCERPT_RADIUS = 100;
  const results = [];
  Object.keys(helpContent).forEach((topic) => {
    const text = String(helpContent[topic] || '');
    const lower = text.toLowerCase();
    if (!keywords.every((kw) => lower.indexOf(kw) !== -1)) return;

    // Toutes les occurrences de tous les mots-clefs, en fenêtres [start, end).
    const windows = [];
    keywords.forEach((kw) => {
      let from = 0;
      let idx;
      while ((idx = lower.indexOf(kw, from)) !== -1) {
        windows.push([Math.max(0, idx - EXCERPT_RADIUS), Math.min(text.length, idx + kw.length + EXCERPT_RADIUS)]);
        from = idx + kw.length;
      }
    });
    windows.sort((a, b) => a[0] - b[0]);

    // Fusion des fenêtres qui se chevauchent ou se touchent.
    const merged = [];
    windows.forEach((w) => {
      const last = merged[merged.length - 1];
      if (last && w[0] <= last[1]) {
        last[1] = Math.max(last[1], w[1]);
      } else {
        merged.push(w.slice());
      }
    });

    const truncated = merged.length > HELP_SEARCH_MAX_EXCERPTS;
    const kept = merged.slice(0, HELP_SEARCH_MAX_EXCERPTS);
    const excerpts = kept.map(([start, end]) =>
      (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : ''));

    results.push({ topic, excerpts, truncated });
  });
  return results;
}

// Abrège un nom de modèle pour l'affichage du bouton sélecteur du composer,
// où un nom long ("<auteur>/<modèle>:<variante>") pousse les pilules effort et
// tokens hors de la ligne. Deux paliers, dans cet ordre :
//   1. retrait du segment d'auteur (tout ce qui précède le DERNIER '/') ;
//   2. si ça ne suffit toujours pas, troncature de la FIN, remplacée par '…'.
// `maxChars` est un budget en caractères (dérivé d'une mesure de largeur côté
// appelant, cf. composerModelLabelBudget dans ui.js). Le nom complet reste
// affiché tel quel dans la liste déroulée : cette fonction ne sert QUE au
// libellé du bouton.
// Pure : pas de DOM, testable sous QuickJS.
function shortenModelLabel(name, maxChars) {
  const full = String(name == null ? '' : name);
  const max = Math.floor(Number(maxChars));
  // Budget absent/absurde (mesure impossible, appel avant layout) → nom intact :
  // mieux vaut une pilule large qu'un libellé mutilé au hasard.
  if (!isFinite(max) || max <= 0) return full;
  if (full.length <= max) return full;

  // Palier 1 : l'auteur saute en entier. On coupe au DERNIER '/' pour absorber
  // les chemins à plusieurs segments (hf.co/<auteur>/<modèle>).
  const slash = full.lastIndexOf('/');
  const stripped = slash >= 0 ? full.slice(slash + 1) : full;
  if (stripped.length <= max) return stripped;

  // Palier 2 : troncature de fin. Le '…' occupe une place dans le budget ; en
  // dessous de 2 caractères il ne reste rien de signifiant, on renvoie le seul
  // '…' plutôt qu'une chaîne vide.
  if (max < 2) return '…';
  return stripped.slice(0, max - 1) + '…';
}

// Plafond de hauteur du menu déroulant d'Espaces, en pixels. La base
// `.model-menu` borne à 220px — justifié pour une liste de MODÈLES (un serveur
// Ollama en expose des centaines), inutilement serré pour des Espaces, dont le
// nombre reste humain : au-delà de ~7, un scroll apparaissait alors que la
// sidebar avait de la place à revendre.
// On rend ici la place réellement disponible sous le bouton : du bas de
// l'ancre jusqu'au bas du viewport, moins une marge de respiration.
// `SPACE_MENU_MIN_H` évite l'aberration d'un menu écrasé à quelques pixels
// quand le bouton est bas dans un viewport très court (le scroll interne
// reprend alors la main, ce qui est le comportement correct).
// Pure : arithmétique seule, le DOM est lu par l'appelant.
const SPACE_MENU_GAP_PX = 16;
const SPACE_MENU_MIN_H = 160;

function spaceMenuMaxHeight(anchorBottom, viewportHeight) {
  const bottom = Number(anchorBottom);
  const vh = Number(viewportHeight);
  // Mesure inexploitable (menu jamais ouvert, appel avant layout) → 0, que
  // l'appelant traduit en « ne pose rien », laissant le plafond CSS de base.
  if (!isFinite(bottom) || !isFinite(vh) || vh <= 0) return 0;
  return Math.max(SPACE_MENU_MIN_H, Math.floor(vh - bottom - SPACE_MENU_GAP_PX));
}

// ── Badges d'activité (lot T-2) — résolution pure ───────────────────────────
// Deux états mutuellement exclusifs dans le temps sur une même conversation :
// 'working' (une génération est en vol) puis 'unread' (elle a fini pendant que
// l'utilisateur regardait ailleurs). Sur les surfaces d'AGRÉGATION (sélecteur
// d'espaces replié, hamburger), on n'affiche qu'UNE pastille, dans l'état
// gagnant — jamais un troisième état visuel « unread + working » : ce serait un
// vocabulaire supplémentaire, qui n'existerait qu'en agrégation. Le détail se
// lit au dépliage, où chaque ligne porte son propre état.
//
// Pure exprès (spec T-2) : la règle de résolution est la seule chose qu'on
// puisse se tromper à réécrire localement, elle est donc testable seule.
// Tolère n'importe quel itérable de chaînes, y compris des valeurs nulles
// (une surface sans état) — elles ne pèsent pas.
function resolveActivityBadge(states) {
  let working = false;
  for (const s of (states || [])) {
    if (s === 'unread') return 'unread';   // gagne toujours, inutile de continuer
    if (s === 'working') working = true;
  }
  return working ? 'working' : null;
}

// Compteur d'agents en cours (lot T-2bis) — règle d'apparition pure.
// Le compteur ne parle que quand il APPREND quelque chose : une génération
// unique qu'on regarde arriver est déjà signalée par le composer en mode stop,
// l'annoncer une seconde fois en haut à droite serait du bruit.
//
// `total` = nombre de générations en vol (_activeGenerations.size)
// `screenOwned` = la conversation AFFICHÉE génère-t-elle ?
//
// Le nombre rendu est TOUJOURS le total, jamais « total - 1 » : afficher
// « 2 agents » alors que trois tournent serait un piège à confusion. La règle
// porte sur le seuil d'APPARITION, pas sur le comptage.
function resolveAgentCount(total, screenOwned) {
  const n = Number(total);
  if (!isFinite(n) || n <= 0) return 0;
  if (n === 1 && screenOwned) return 0;
  return Math.floor(n);
}

// Libellé de la pilule. Séparé du calcul pour rester testable sans DOM, et
// parce que le mot est un choix produit (Julien : « je tiens à Agent »).
function formatAgentCountLabel(n) {
  const c = Math.floor(Number(n) || 0);
  return c <= 0 ? '' : c + (c > 1 ? ' agents' : ' agent');
}

// ── Cap d'octets tenus en RAM (lot V-1) ──────────────────────────────────────
// Famille « octets tenus en RAM et adressables par un handle » : blob
// texte/binary d'un attachment, fichier de bibliothèque d'espace, et membre
// d'archive décompressé par docs__extract. Nom générique VOULU — la constante a
// remplacé l'ancien cap propre aux attachments quand le zip natif est devenu un
// troisième producteur d'octets soumis au même plafond.
//
// Déclarée ici (premier fichier du build) et non dans main.js : elle est lue
// depuis tools.js, qui est chargé AVANT main.js. Référencée UNIQUEMENT dans des
// corps de fonction (contrainte de portée inter-fichiers du test runner, cf.
// CLAUDE.md).
//
// Sa contrepartie aval est JS_EVAL_MEM_BYTES (tools.js), qui doit rester
// largement supérieure : un text() sur un blob de cette taille, plus une copie
// dans le code du modèle, vit dans la VM. Les désynchroniser recréerait la
// contradiction garde d'entrée / capacité aval déjà payée — un test d'ancrage
// sur la source réelle garde le rapport (run_build_unit_tests).
const MAX_INLINE_BYTES = 64 * 1024 * 1024;   // 64 Mo

// ── Archives zip : helpers purs (lot V-1) ────────────────────────────────────
// Le chemin d'extraction natif (fflate, ui.js/tools.js) n'est pas testable en
// QuickJS : il charge une lib CDN et lit IndexedDB. Ces quatre fonctions sont
// la part PURE de ce chemin — et c'est là que vivent les gardes, précisément
// pour qu'elles soient testables (mémoire project_extract_pure_helper_over_idb_stub).

// Signatures little-endian du format zip.
const ZIP_EOCD_SIG = 0x06054b50;   // End Of Central Directory
const ZIP_CDFH_SIG = 0x02014b50;   // Central Directory File Header

// Lectures little-endian sur un Uint8Array (pas de DataView : évite de dépendre
// du byteOffset d'une vue sur un buffer partagé).
function _zipU16(u8, p) { return u8[p] | (u8[p + 1] << 8); }
function _zipU32(u8, p) {
  return (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16)) + u8[p + 3] * 16777216;
}

// Décodage d'un nom de membre, sans TextDecoder (absent de QuickJS).
//
// Le format zip connaît DEUX encodages de nom, discriminés par le bit 11 du
// general purpose flag (« language encoding flag », APPNOTE 6.3.2) :
//   - bit 11 posé → UTF-8 (tout zip moderne : Info-ZIP, macOS, 7-Zip récents) ;
//   - bit 11 absent → jeu historique CP437 (archives Windows anciennes).
// Décoder un nom CP437 comme de l'UTF-8 rend du mojibake ou des U+FFFD, et le
// chemin devient INEXPLOITABLE : docs__extract compare `e.name === path` à
// l'identique, un nom mal décodé ne peut plus être ciblé. D'où la bifurcation.
//
// Le repli « latin-ish » (octet → même point de code) n'est pas CP437 exact —
// la vraie table diverge au-dessus de 0x7F (0x82 y vaut « é », pas « ‚ »). Il
// est retenu quand même parce qu'il est TOTAL et STABLE : chaque octet donne un
// caractère, distinct, et le nom reste un identifiant fidèle à comparer à
// lui-même. C'est ce qui compte ici — le nom sert à cibler un membre, pas à
// être joli. Une vraie table CP437 n'améliorerait que l'affichage.
function _zipDecodeName(u8, start, len, utf8) {
  let s = '';
  let i = start;
  const end = start + len;
  if (!utf8) {
    // Repli octet-à-octet : total, jamais de perte, jamais de U+FFFD.
    for (; i < end; i++) s += String.fromCharCode(u8[i]);
    return s;
  }
  while (i < end) {
    const c = u8[i];
    if (c < 0x80) { s += String.fromCharCode(c); i += 1; }
    else if (c < 0xe0 && i + 1 < end) {
      s += String.fromCharCode(((c & 0x1f) << 6) | (u8[i + 1] & 0x3f)); i += 2;
    } else if (c < 0xf0 && i + 2 < end) {
      s += String.fromCharCode(((c & 0x0f) << 12) | ((u8[i + 1] & 0x3f) << 6) | (u8[i + 2] & 0x3f));
      i += 3;
    } else if (i + 3 < end) {
      const cp = ((c & 0x07) << 18) | ((u8[i + 1] & 0x3f) << 12) |
                 ((u8[i + 2] & 0x3f) << 6) | (u8[i + 3] & 0x3f);
      const v = cp - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      i += 4;
    } else { s += '�'; i += 1; }
  }
  return s;
}

// Parse le CENTRAL DIRECTORY d'une archive zip → [{name, encrypted, size,
// compressedSize, directory}, …], ou `null` si l'EOCD est introuvable (pas un
// zip, ou tronqué).
//
// RAISON D'ÊTRE — la garde de chiffrement. fflate ne détecte PAS les membres
// protégés par mot de passe : vérifié par exécution sur un `zip -P`, il rend des
// octets chiffrés en prétendant avoir extrait du texte, SANS lever d'exception
// (AUDIT lot V §3). Le modèle recevrait du bruit binaire présenté comme du
// contenu de log. `filter` (le seul hook fflate avant décompression) n'expose
// que name/size/originalSize/compression — jamais le general purpose flag.
// Le lire nous-mêmes dans le central directory est le seul chemin.
//
// `size` (taille décompressée) est un champ DÉCLARATIF, donc falsifiable :
// il sert de garde PRÉVENTIVE (refuser avant d'allouer), jamais de vérité
// unique — le serveur mcp_docs avait la même prudence.
function parseZipCentralDirectory(u8) {
  if (!u8 || typeof u8.length !== 'number' || u8.length < 22) return null;

  // L'EOCD fait 22 octets + un commentaire de 0 à 65535 : balayer depuis la fin.
  let eocd = -1;
  const floor = Math.max(0, u8.length - 22 - 65535);
  for (let p = u8.length - 22; p >= floor; p--) {
    if (_zipU32(u8, p) === ZIP_EOCD_SIG) { eocd = p; break; }
  }
  if (eocd < 0) return null;

  const count = _zipU16(u8, eocd + 10);
  const cdOff = _zipU32(u8, eocd + 16);
  if (cdOff >= u8.length) return null;

  const entries = [];
  let p = cdOff;
  for (let k = 0; k < count; k++) {
    if (p + 46 > u8.length || _zipU32(u8, p) !== ZIP_CDFH_SIG) break;
    const gp = _zipU16(u8, p + 8);
    const csize = _zipU32(u8, p + 20);
    const size = _zipU32(u8, p + 24);
    const nlen = _zipU16(u8, p + 28);
    const elen = _zipU16(u8, p + 30);
    const clen = _zipU16(u8, p + 32);
    if (p + 46 + nlen > u8.length) break;
    const name = _zipDecodeName(u8, p + 46, nlen, (gp & 0x800) !== 0);   // bit 11 = nom UTF-8
    entries.push({
      name: name,
      encrypted: (gp & 1) === 1,   // bit 0 du general purpose flag
      size: size,
      compressedSize: csize,
      directory: name.charAt(name.length - 1) === '/',
    });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

// Garde zip-slip. Côté client il n'y a AUCUNE écriture disque (tout reste en
// mémoire, adressé par handle) : le risque n'est donc pas l'écrasement de
// fichier mais le ciblage ambigu d'un membre et la confusion d'affichage.
// La garde reste, et un membre rejeté est SIGNALÉ dans le listing, jamais
// silencieusement omis (un trou sans explication fait halluciner le modèle).
function isZipSlipPath(name) {
  const s = String(name == null ? '' : name).replace(/\\/g, '/');
  if (!s) return true;
  if (s.charAt(0) === '/') return true;              // absolu POSIX
  if (/^[a-zA-Z]:/.test(s)) return true;             // absolu Windows (C:…)
  const parts = s.split('/');
  for (const seg of parts) {
    if (seg === '..') return true;
  }
  return false;
}

// Sniff Office : un .docx/.xlsx/.pptx EST un zip. Sert à ANNONCER la nature de
// l'archive dans le listing, JAMAIS à refuser l'ouverture (décision lot V).
function sniffZipOfficeKind(names) {
  const list = names || [];
  let hasWord = false, hasXl = false, hasPpt = false;
  for (const n of list) {
    const s = String(n || '');
    if (s.indexOf('word/') === 0) hasWord = true;
    else if (s.indexOf('xl/') === 0) hasXl = true;
    else if (s.indexOf('ppt/') === 0) hasPpt = true;
  }
  if (hasWord) return 'docx';
  if (hasXl) return 'xlsx';
  if (hasPpt) return 'pptx';
  return null;
}

// ── Lot V-4 — le pur du chemin « document natif » ───────────────────────────

// Type de document reconnu AUX OCTETS. Rend 'pdf' | 'zip' | 'docx' | 'xlsx' |
// 'pptx' | null. C'est le point d'unification annoncé par le PLAN V-4 §2.1 :
// docs__list ne peut plus se contenter de « parseZipCentralDirectory rend null
// donc ce n'est pas une archive » dès qu'il y a deux familles de format.
//
// Précédent suivi : sniffBackupFormat (V-3) — un conteneur se reconnaît à ses
// octets, un point unique par axe de variation, et le sniff ne fait qu'orienter
// (c'est le parseur en aval qui dit « c'en est vraiment un »).
//
// Ni le mime du record ni l'extension ne sont consultés : le mime d'un
// attachment vient du navigateur, celui d'un membre de zip d'une table
// d'extensions (ZIP_MEMBER_MIME_BY_EXT) — tous deux DÉCLARATIFS, donc
// falsifiables. `name` n'est accepté qu'en paramètre pour garder la signature
// stable si un départage à égalité devenait nécessaire ; il ne décide rien
// aujourd'hui, et ce silence est délibéré (même prudence que « jamais
// file_size seul » du central directory, V-1).
//
// Un zip Office rend son type Office ('docx'/'xlsx'/'pptx'), jamais 'zip' :
// c'est ce qui permettra à DOC_READERS de router un .docx vers son lecteur
// dédié en V-5, alors qu'il reste ouvrable comme archive aujourd'hui.
function sniffDocumentKind(u8, name) {
  if (!u8 || typeof u8.length !== 'number' || u8.length < 4) return null;
  if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return 'pdf';   // %PDF
  if (u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) {               // PK\x03\x04
    const entries = parseZipCentralDirectory(u8);
    if (!entries) return null;   // signature de zip mais central directory illisible
    const names = [];
    for (const e of entries) { if (e && e.name) names.push(e.name); }
    return sniffZipOfficeKind(names) || 'zip';
  }
  return null;
}

// Selector d'unité 'N' ou 'N-M', 1-indexé INCLUSIF, borné à [1, total].
// Portage de _parse_range (mcp_docs/formats.py) avec un seul écart de forme :
// le serveur LÈVE sur selector invalide, ici on rend { ok:false, message } —
// facture de decideZipMemberExtraction, et un pur qui ne jette pas reste
// testable en QuickJS sans harnais d'exception.
//
// La `notice` de clamp est le FMT4 déjà payé côté serveur : un '5-100' sur un
// document de 10 pages servait silencieusement 5-10, et le modèle concluait que
// le document s'arrêtait là. Le clamp reste (refuser serait pire), mais il se
// dit.
//
// Le format attendu est répété dans CHAQUE message d'erreur : le modèle écrit
// 'page 3' et se fait refuser (mémoire project_docs_read_selector_format) — un
// refus qui ne rappelle pas la forme attendue coûte un tour de plus.
function parsePageSelector(selector, total) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  if (!n) return { ok: false, message: 'Document sans aucune unité lisible.' };
  const raw = String(selector == null ? '' : selector).trim();
  if (!raw) return { ok: false, message: "Selector manquant (attendu 'N' ou 'N-M', par exemple '3' ou '2-5')." };

  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(raw);
  if (!m) {
    return { ok: false, message: "Selector invalide : '" + raw +
      "' (attendu 'N' ou 'N-M', par exemple '3' ou '2-5' — pas de mot, pas de préfixe)." };
  }
  const wantStart = parseInt(m[1], 10);
  const wantEnd = m[2] === undefined ? wantStart : parseInt(m[2], 10);

  const start = Math.max(1, wantStart);
  const end = Math.min(n, wantEnd);
  if (start > end) {
    return { ok: false, message: "Selector invalide : '" + raw + "' (document de " + n +
      ' unité(s) — la plage demandée est hors document ou inversée).' };
  }
  const notice = (start !== wantStart || end !== wantEnd)
    ? '\n\n[Plage ramenée à ' + start + '-' + end + ' (demandé : ' + raw + ', document de ' + n + ' unité(s))]'
    : '';
  return { ok: true, start: start, end: end, notice: notice, total: n };
}

// Texte du listing PDF rendu au modèle. Calqué sur pdf_list (formats.py) mais
// homogène avec formatZipListing, qui est la référence de forme côté MIAOU :
// une ligne d'en-tête qui dit la nature et le volume, puis le détail.
//
// Les métadonnées sont un GAIN net sur le serveur (qui ne rend que le compte de
// pages et le sommaire) : le producteur en particulier oriente la lecture — un
// PDF sorti de PowerPoint ne se lit pas comme un rapport LaTeX. Elles ne sont
// annoncées que si elles portent quelque chose, jamais en champs vides.
//
// Le « (pas de sommaire) » du serveur est conservé : une absence dite vaut mieux
// qu'une absence silencieuse, que le modèle lirait comme un oubli de l'outil.
// Reconstitution du texte d'une page PDF depuis les items de getTextContent().
// PUR : prend le tableau d'items, rend une chaîne — pdf.js n'entre pas ici.
//
// LE PIÈGE, vérifié au spike : pdf.js ne met AUCUN séparateur entre les items.
// La sortie brute d'un `items.map(it => it.str).join('')` était « …ZEBRE0.Deuxieme
// ligne… », deux phrases collées. pymupdf, lui, rend des retours à la ligne :
// sans traitement, le texte natif serait MOINS lisible que celui du serveur —
// une régression de capacité, pas un détail cosmétique.
//
// `hasEOL` (présent en 3.x) porte l'information et a été confirmé sur un PDF
// réel de 8 pages. Le repli par comparaison d'ordonnée (`transform[5]`) reste
// là pour les items qui ne le portent pas : un changement de ligne se voit à un
// saut vertical, et le seuil se dérive de la hauteur de l'item plutôt que d'être
// une constante en dur (une police de 6 pt et une de 24 pt ne sautent pas de la
// même distance).
function joinPdfTextItems(items) {
  const list = items || [];
  let out = '';
  let prevY = null;
  for (const it of list) {
    if (!it) continue;
    const str = String(it.str == null ? '' : it.str);
    const tr = it.transform;
    const y = (tr && typeof tr[5] === 'number') ? tr[5] : null;
    const h = Math.abs(Number(it.height) || 0);

    if (it.hasEOL === undefined && prevY !== null && y !== null) {
      // Repli : saut vertical supérieur à la moitié de la hauteur de ligne.
      const seuil = (h || 10) * 0.5;
      if (Math.abs(prevY - y) > seuil) out += '\n';
    }
    out += str;
    if (it.hasEOL) out += '\n';
    if (y !== null) prevY = y;
  }
  return out;
}

// Texte rendu au modèle pour une lecture de pages PDF. PUR : reçoit les pages
// DÉJÀ extraites, jamais un objet pdf.js.
//
// Les en-têtes « --- Page N --- » sont ceux du serveur, et ils comptent :
// sans eux, un modèle qui lit une plage ne sait pas où passe la frontière et
// attribue une phrase à la mauvaise page.
//
// LES PAGES VIDES SONT SIGNALÉES, jamais rendues comme un blanc. Une page sans
// texte extractible est presque toujours une page SCANNÉE (image sans couche
// texte) : sans notice, le modèle reçoit du vide et conclut que le document ne
// dit rien — exactement le mode de défaillance du zip chiffré de V-1, du
// silence pris pour une réponse. La notice dit ce qui se passe ET ce qu'il
// reste possible de faire, sans promettre ce que MIAOU ne sait pas faire.
function formatPdfRead(pages, opts) {
  const o = opts || {};
  const list = pages || [];
  const parts = [];
  const empty = [];
  for (const p of list) {
    const num = Math.floor(Number(p && p.page) || 0);
    const text = String((p && p.text) || '').trim();
    if (!text) empty.push(num);
    parts.push('--- Page ' + num + ' ---\n' + text);
  }
  let out = parts.join('\n\n');
  if (empty.length) {
    const quoi = empty.length === list.length
      ? 'Aucune page de cette plage ne porte de texte extractible'
      : 'Page(s) sans texte extractible : ' + empty.join(', ');
    out += '\n\n[' + quoi + '. Ces pages sont probablement SCANNÉES (image sans ' +
      "couche texte) : MIAOU ne fait pas d'OCR. Dis-le plutôt que de conclure que le " +
      'document est vide.]';
  }
  if (o.notice) out += String(o.notice);
  return out;
}

// Libellés des acks docs__list / docs__read. PURS et sortis du registre d'acks
// (ui.js) pour une raison précise : chaque kind y duplique sa logique entre
// `label` (chaîne) et `renderLabel` (DOM), et c'est exactement là qu'un libellé
// dérive — la version texte et la version DOM finissent par ne plus dire la
// même chose. Une seule source, appelée deux fois.
//
// L'ack ne porte pas le TYPE du document (il n'a jamais eu à le porter) : on le
// déduit du nom du record, qui est ce que l'utilisateur voit de toute façon.
// C'est une heuristique d'AFFICHAGE, jamais de routage — le routage, lui, se
// fait aux octets (sniffDocumentKind). Se tromper ici coûte un mot inexact dans
// une trace, pas une mauvaise lecture.
function docsListAckHead(m) {
  const name = String((m && m.resourceName) || '');
  return /\.pdf$/i.test(name) ? 'Document listé' : 'Archive listée';
}

function docsListAckCount(m) {
  const n = m ? m.count : null;
  const name = String((m && m.resourceName) || '');
  // « page » est féminin, « membre » masculin : l'accord de « aucun/aucune »
  // suit l'unité. Détail, mais un ack se lit à chaque appel d'outil.
  const isPage = /\.pdf$/i.test(name);
  const unit = isPage ? 'page' : 'membre';
  if (n === 0) return (isPage ? 'aucune ' : 'aucun ') + unit;
  if (n === 1) return '1 ' + unit;
  return (n != null ? n : '?') + ' ' + unit + 's';
}

// « Pages 2-5 lues » / « Page 3 lue ». Le selector de l'ack est déjà normalisé
// par le handler (bornes effectivement servies, pas la demande brute) : ce qui
// s'affiche est ce qui a été lu, y compris après un clamp.
function docsReadAckHead(m) {
  const sel = String((m && m.selector) || '').trim();
  const parts = sel.split('-');
  const plural = parts.length > 1 && parts[0] !== parts[1];
  if (!sel) return 'Document lu';
  return 'Page' + (plural ? 's ' : ' ') + (plural ? sel : parts[0]) + (plural ? ' lues' : ' lue');
}

function docsReadAckLabel(m) {
  return docsReadAckHead(m) + ' : ' + ((m && (m.resourceName || m.handle)) || '?');
}

// Nom du record produit par docs__read(as_resource: true) : « rapport.pdf » +
// pages 2-5 → « rapport-p2-5.txt ». Le nom est ce que l'utilisateur voit dans la
// bibliothèque et au téléchargement, et ce par quoi il reconnaît DE QUOI vient
// un extrait — d'où la plage dans le nom plutôt qu'un compteur anonyme.
// L'extension devient .txt : le record est du texte, quel que soit le format
// d'origine (même geste que zipMemberBaseName, qui nomme pour l'interface).
function pdfReadResourceName(sourceName, start, end) {
  let base = String(sourceName == null ? '' : sourceName).replace(/\\/g, '/');
  const parts = base.split('/');
  base = '';
  for (let i = parts.length - 1; i >= 0; i--) { if (parts[i]) { base = parts[i]; break; } }
  base = base.replace(/\.[A-Za-z0-9]{1,8}$/, '') || 'document';
  const a = Math.floor(Number(start) || 0);
  const b = Math.floor(Number(end) || 0);
  const suffix = (a && b) ? (a === b ? '-p' + a : '-p' + a + '-' + b) : '';
  return base + suffix + '.txt';
}

// Libellé des formats ouverts NATIVEMENT, rendu au modèle dans le message de
// refus. Dérivé de la table de dispatch (DOC_READERS, tools.js) et jamais d'une
// chaîne recopiée : la formule « ne gère à ce jour que le zip » était en dur
// depuis V-1 et aurait menti dès le premier format ajouté — or c'est le message
// sur lequel le modèle décide s'il doit chercher un outil serveur (mémoire
// project_help_md_confabulation_move_and_memory_read : une doctrine périmée est
// le mode de défaillance le plus cher du projet).
//
// Pur pour rester testable : docsUnsupportedFormatMessage, elle, lit
// _remoteTools et ne l'est pas.
function formatNativeDocKindsLabel(kinds) {
  const list = [];
  for (const k of (kinds || [])) {
    const s = String(k || '').trim();
    if (s && list.indexOf(s) < 0) list.push(s);
  }
  if (!list.length) return 'aucun format';
  if (list.length === 1) return 'le ' + list[0];
  return 'les ' + list.slice(0, -1).join(', ') + ' et ' + list[list.length - 1];
}

function formatPdfListing(info) {
  const o = info || {};
  const pages = Math.max(0, Math.floor(Number(o.pages) || 0));
  const title = String(o.title == null ? '' : o.title).trim();
  const author = String(o.author == null ? '' : o.author).trim();
  const producer = String(o.producer == null ? '' : o.producer).trim();
  const outline = o.outline || [];

  let head = 'PDF — ' + pages + (pages > 1 ? ' pages' : ' page');
  if (title) head += ', « ' + title + ' »';
  if (author) head += (title ? ' (' + author + ')' : ', ' + author);
  const out = [head];
  if (producer) out.push('Produit par : ' + producer);

  if (outline.length) {
    out.push('Sommaire :');
    for (const it of outline) {
      if (!it) continue;
      const lvl = Math.max(1, Math.floor(Number(it.level) || 1));
      const page = Math.floor(Number(it.page) || 0);
      const label = String(it.title == null ? '' : it.title).trim();
      if (!label) continue;
      out.push(new Array(lvl).join('  ') + '- ' + (page ? 'p.' + page + ' ' : '') + label);
    }
  } else {
    out.push('(pas de sommaire)');
  }
  return out.join('\n');
}

// Texte du listing rendu au modèle. `opts.maxBytes` (cap d'inline) sert
// uniquement à ANNONCER qu'un membre dépasse : le listing ne refuse rien, il
// décrit — c'est docs__extract qui refuse. Un total décompressé au-delà du cap
// est signalé sans empêcher l'extraction membre par membre.
function formatZipListing(entries, opts) {
  const o = opts || {};
  const list = entries || [];
  const maxBytes = Number(o.maxBytes) || 0;
  const lines = [];
  const rejected = [];
  let total = 0, files = 0, dirs = 0;

  for (const e of list) {
    if (e.directory) { dirs++; continue; }
    files++;
    total += Number(e.size) || 0;
    if (e.encrypted) {
      rejected.push(e.name + ' — chiffré (protégé par mot de passe), non extractible');
      continue;
    }
    if (isZipSlipPath(e.name)) {
      rejected.push(e.name + ' — chemin non sûr (absolu ou remontant), refusé');
      continue;
    }
    let line = e.name + '  ' + humanSize(e.size);
    if (maxBytes && Number(e.size) > maxBytes) {
      line += '  [au-delà du cap d\'extraction]';
    }
    lines.push(line);
  }

  const out = [];
  const kind = sniffZipOfficeKind(list.map(function(e) { return e.name; }));
  out.push('Archive zip' + (kind ? ' — document Office (' + kind + '), membres XML bruts' : '') +
    ' : ' + files + (files > 1 ? ' membres' : ' membre') +
    (dirs ? ', ' + dirs + (dirs > 1 ? ' répertoires' : ' répertoire') : '') +
    ', ' + humanSize(total) + ' décompressés au total.');
  if (maxBytes && total > maxBytes) {
    out.push('Le total dépasse le cap d\'extraction, mais chaque membre reste extractible individuellement s\'il tient sous le cap.');
  }
  out.push('');
  if (lines.length) out.push(lines.join('\n'));
  else out.push('(aucun membre extractible)');
  if (rejected.length) {
    out.push('');
    out.push('Membres écartés :');
    out.push(rejected.join('\n'));
  }
  return out.join('\n');
}

// Type MIME d'un membre d'archive, déduit de son extension. Aucun mapping de ce
// genre n'existait dans le dépôt (vérifié) : les autres producteurs d'octets
// reçoivent leur mime du serveur MCP ou du File API du navigateur, un membre de
// zip n'a que son nom. Le mime décide ensuite de la CLASSE de stockage via
// _isTextualMime (resources.js) — d'où l'allowlist volontairement resserrée :
// dans le doute, application/octet-stream, donc classe 'binary', donc descripteur
// au lieu d'un inline. Se tromper vers le binaire est réversible (le modèle
// re-cible) ; se tromper vers l'inline injecterait des octets bruts.
//
// L'accord de cette table avec _isTextualMime (resources.js) — le consommateur
// qui traduit le mime en CLASSE de stockage — est gardé par un test croisé
// (tests/test-zip.js) : les deux vivent dans des fichiers différents, et
// élargir l'une sans regarder l'autre changerait en silence ce que le modèle
// reçoit. Un cas contre-intuitif y est figé : le .svg est du XML mais son mime
// image/svg+xml le range du côté BINAIRE, donc descripteur et non texte inline.
const ZIP_MEMBER_MIME_BY_EXT = {
  txt: 'text/plain', log: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  tsv: 'text/tab-separated-values', json: 'application/json', ndjson: 'application/x-ndjson',
  jsonl: 'application/x-ndjson', xml: 'text/xml', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript', ts: 'text/plain', py: 'text/plain',
  sh: 'text/plain', yml: 'text/plain', yaml: 'text/plain', ini: 'text/plain',
  conf: 'text/plain', cfg: 'text/plain', sql: 'text/plain', rst: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', zip: 'application/zip',
};
function zipMemberMime(name) {
  const s = String(name == null ? '' : name);
  const dot = s.lastIndexOf('.');
  const slash = s.lastIndexOf('/');
  if (dot <= slash || dot === s.length - 1) return 'application/octet-stream';
  const ext = s.slice(dot + 1).toLowerCase();
  return ZIP_MEMBER_MIME_BY_EXT[ext] || 'application/octet-stream';
}

// Nom court d'un membre pour le record stocké : `logs/2026/pihole.log` →
// `pihole.log`. Le chemin complet reste dans l'ack (champ `path`) ; le record,
// lui, porte un nom lisible côté interface (bibliothèque, téléchargement).
function zipMemberBaseName(name) {
  const s = String(name == null ? '' : name).replace(/\\/g, '/');
  const parts = s.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]) return parts[i];
  }
  return 'membre';
}

// Décide du sort d'un membre visé par docs__extract, à partir des SEULES données
// du central directory. Pure et testable : c'est ici que vivent les quatre refus
// du chemin d'extraction, avant toute allocation (garde préventive, AUDIT §2 —
// on ne décompresse jamais pour découvrir après coup que c'était trop gros).
// Retourne { ok:true, entry } ou { ok:false, reason, message } — `message` est le
// texte rendu au modèle, cadré pour qu'il se re-cible dans le même tour.
function decideZipMemberExtraction(entries, path, maxBytes) {
  const list = entries || [];
  const want = String(path == null ? '' : path);
  if (!want) return { ok: false, reason: 'path', message: 'Chemin de membre manquant.' };

  let entry = null;
  for (const e of list) {
    if (e && e.name === want) { entry = e; break; }
  }
  if (!entry) {
    // Membre introuvable : lister les noms si peu nombreux (le modèle se
    // re-cible dans le tour), sinon renvoyer vers docs__list — recopier 400
    // noms dans un tool result coûterait plus que l'appel qu'on veut éviter.
    const names = [];
    for (const e of list) { if (e && !e.directory) names.push(e.name); }
    const tail = names.length && names.length <= 20
      ? ' Membres disponibles : ' + names.join(', ') + '.'
      : ' Appelle miaou__docs__list sur cette archive pour obtenir les chemins exacts.';
    return { ok: false, reason: 'missing', message: 'Membre introuvable : ' + want + '.' + tail };
  }
  if (entry.directory) {
    return { ok: false, reason: 'directory',
      message: 'Ce chemin désigne un répertoire, pas un fichier : ' + want + '.' };
  }
  // Garde du lot (AUDIT §3) : fflate extrait un membre chiffré SANS lever
  // d'erreur, en rendant des octets bruts que le modèle lirait comme du texte.
  if (entry.encrypted) {
    return { ok: false, reason: 'encrypted',
      message: 'Membre chiffré (archive protégée par mot de passe) : ' + want +
        '. MIAOU ne peut pas le déchiffrer — son contenu extrait serait du bruit binaire.' };
  }
  if (isZipSlipPath(entry.name)) {
    return { ok: false, reason: 'unsafe',
      message: 'Chemin de membre non sûr (absolu ou remontant), refusé : ' + want + '.' };
  }
  const cap = Number(maxBytes) || 0;
  if (cap && Number(entry.size) > cap) {
    // REFUS explicite, jamais troncature (doctrine du cap js__eval, piège 25).
    return { ok: false, reason: 'cap',
      message: 'Membre trop volumineux : ' + humanSize(entry.size) + ' décompressés, ' +
        'au-delà de la limite de ' + humanSize(cap) + '. Cible un membre plus petit.' };
  }
  return { ok: true, entry: entry };
}

// ── Archives zip : création (lot V-2) ────────────────────────────────────────
// Part PURE du chemin de création (docs__pack, tools.js) : le nom de membre et
// la validation du plan. Même discipline qu'en V-1 — les gardes vivent dans le
// pur pour être testables sans stub IDB ni lib CDN.

// Extension canonique par mime. Table SÉPARÉE de ZIP_MEMBER_MIME_BY_EXT, pas
// une inversion : celle-ci n'est PAS injective (douze extensions rendent
// text/plain), donc l'inverser programmatiquement donnerait le dernier
// représentant itéré — text/plain → rst, absurde. Deux tables écrites à la main
// sont plus honnêtes qu'une dérivation qui n'en est pas une ; leur accord est
// gardé par un test croisé (tests/test-zip.js), sur le modèle exact du contrat
// zipMemberMime × _isTextualMime livré en clôture V-1. Ajouter une extension
// d'un côté sans l'autre casse ce test — c'est son seul rôle.
const ZIP_EXT_BY_MIME = {
  'text/plain': 'txt', 'text/markdown': 'md', 'text/csv': 'csv',
  'text/tab-separated-values': 'tsv', 'application/json': 'json',
  'application/x-ndjson': 'jsonl', 'text/xml': 'xml', 'text/html': 'html',
  'text/css': 'css', 'text/javascript': 'js', 'image/png': 'png',
  'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'application/pdf': 'pdf', 'application/zip': 'zip',
};

// Nom de membre d'archive dérivé d'un record, dédupliqué contre `taken` (Set).
//
// La déduplication N'EST PAS cosmétique : zipSync prend un objet { nom: octets },
// donc deux membres homonymes s'écrasent SILENCIEUSEMENT — propriété de l'objet
// JS, pas de fflate. Or deux ressources produites dans la même conversation
// portent très souvent le même nom (rapport.md, sortie.txt).
//
// Le nom produit est un IDENTIFIANT : c'est par lui que docs__list puis
// docs__extract reciblent le membre (comparaison stricte e.name === path). Il
// doit donc faire l'ALLER-RETOUR par _zipDecodeName — leçon payée en clôture V-1
// sur les noms non-UTF-8, où un nom qui ne revient pas à l'identique rend le
// membre inatteignable. zipSync encode en UTF-8 et pose le bit 11, donc la
// branche UTF-8 est prise et l'aller-retour est structurellement sûr ; on s'en
// tient malgré tout à ce que le nom d'origine porte, sans jamais le ré-encoder.
function buildZipMemberName(record, taken) {
  const rec = record || {};
  const set = taken && typeof taken.has === 'function' ? taken : null;

  // Base : le nom du record, sinon son id. Le chemin est retiré par la fonction
  // qui le fait déjà (V-1), jamais une seconde découpe écrite ici.
  let base = String(rec.name == null ? '' : rec.name).trim();
  if (!base) base = String(rec.id == null ? '' : rec.id).trim();
  base = base ? zipMemberBaseName(base) : '';
  if (!base || base === '.' || base === '..') base = 'membre';

  // Extension : déduite du mime seulement si la base n'en porte pas déjà.
  const dot = base.lastIndexOf('.');
  const hasExt = dot > 0 && dot < base.length - 1;
  let stem = base, ext = '';
  if (hasExt) {
    stem = base.slice(0, dot);
    ext = base.slice(dot + 1);
  } else {
    const mime = String(rec.mime == null ? '' : rec.mime).toLowerCase().split(';')[0].trim();
    ext = ZIP_EXT_BY_MIME[mime] || 'bin';
  }

  // Déduplication : l'incrément s'insère AVANT l'extension (rapport-2.md), jamais
  // après — rapport.md-2 perdrait l'association d'extension et serait illisible.
  // La casse n'est PAS normalisée : le zip est sensible à la casse, et Rapport.md
  // face à rapport.md sont deux membres distincts.
  const join = function(s) { return ext ? s + '.' + ext : s; };
  let candidate = join(stem);
  if (!set) return candidate;
  let n = 2;
  while (set.has(candidate)) {
    candidate = join(stem + '-' + n);
    n++;
  }
  return candidate;
}

// Nom du FICHIER d'archive produit (pas d'un membre), rédigé par le modèle donc
// jamais pris tel quel. Trois garanties, dans cet ordre :
//   - le chemin est retiré (zipMemberBaseName) : le nom finit dans un record et
//     dans un téléchargement, un `../` ou un `/etc/` n'y a aucun sens ;
//   - l'extension .zip est garantie, sans jamais la doubler (« a.zip » reste
//     « a.zip », jamais « a.zip.zip ») : le record porte le mime application/zip,
//     un nom qui le contredirait tromperait l'utilisateur au téléchargement ;
//   - un nom vide ou réduit à néant par le nettoyage retombe sur archive.zip.
// La casse n'est pas normalisée (« Rapport.ZIP » garde la sienne) — jamais
// normaliser la casse d'un champ rédigé par le modèle.
function normalizeArchiveName(name) {
  let s = String(name == null ? '' : name).trim();
  s = s ? zipMemberBaseName(s) : '';
  if (!s || s === '.' || s === '..') return 'archive.zip';
  if (/\.zip$/i.test(s)) {
    // « .zip » nu : le stem est vide, le nom serait invisible dans une liste.
    return s.length > 4 ? s : 'archive.zip';
  }
  return s + '.zip';
}

// Garde de dernier ressort sur le plan d'archive — [{ name, size }], pas les
// octets. Retourne { ok:true } ou { ok:false, reason, message }, même forme que
// decideZipMemberExtraction : `message` est le texte rendu au modèle, cadré pour
// qu'il se re-cible dans le même tour.
//
// Le doublon est refusé ICI bien que buildZipMemberName soit censé l'avoir
// évité : les deux fonctions composent, et une composition non gardée est
// exactement ce qui a coûté le contrat zipMemberMime × _isTextualMime en V-1.
// L'écrasement silencieux étant le mode de défaillance visé, la garde reste.
//
// Le cap porte sur le total NON COMPRESSÉ, en AMONT : c'est le pic RAM (les
// entrées sont déjà en mémoire, zipSync construit la sortie par-dessus). Refuser
// APRÈS compression aurait déjà payé le coût mémoire qu'on prétend éviter —
// inverse exact de la garde préventive de V-1.
function validateZipPlan(entries) {
  const list = Array.isArray(entries) ? entries : null;
  if (!list || !list.length) {
    return { ok: false, reason: 'empty',
      message: 'Aucune ressource à archiver : passe au moins un handle.' };
  }

  const seen = {};
  let total = 0;
  for (const e of list) {
    const name = String(e && e.name != null ? e.name : '');
    if (!name) {
      return { ok: false, reason: 'unsafe', message: 'Nom de membre vide, refusé.' };
    }
    if (isZipSlipPath(name)) {
      return { ok: false, reason: 'unsafe',
        message: 'Nom de membre non sûr (absolu ou remontant), refusé : ' + name + '.' };
    }
    if (Object.prototype.hasOwnProperty.call(seen, name)) {
      return { ok: false, reason: 'duplicate',
        message: 'Deux membres porteraient le même nom dans l\'archive : ' + name +
          '. Un nom en écraserait l\'autre silencieusement.' };
    }
    seen[name] = true;
    total += Number(e && e.size) || 0;
  }

  const cap = MAX_INLINE_BYTES;
  if (total > cap) {
    return { ok: false, reason: 'cap',
      message: 'Archive trop volumineuse : ' + humanSize(total) + ' à compresser, ' +
        'au-delà de la limite de ' + humanSize(cap) + '. Archive moins de ressources à la fois.' };
  }
  return { ok: true };
}

// ── Sauvegarde compressée : sniff de conteneur (lot V-3) ─────────────────────
// Un fichier de sauvegarde arrive désormais sous DEUX conteneurs : le `.zip`
// v3 (manifeste + un membre d'octets bruts par ressource) et le `.json` nu des
// versions v1/v2, toujours acceptées — un utilisateur a des sauvegardes
// anciennes, et importer un fichier d'une version antérieure EST le seul chemin
// de migration qui reste dans l'application.
//
// Le conteneur se reconnaît aux OCTETS (signature d'en-tête local `PK\x03\x04`),
// jamais à l'extension ni au type MIME annoncé par le navigateur : les deux sont
// fournis par l'environnement et un fichier renommé passerait à côté.
//
// Dégradation systématique vers 'json' — jamais d'exception, y compris sur
// `null`, un buffer vide ou une signature partielle. Le chemin JSON est le
// chemin HISTORIQUE : y retomber rend la même erreur qu'avant V-3 (« JSON
// invalide »), alors qu'une exception ici laisserait l'interface muette.
//
// Le sniff dit « ça ressemble à un zip » ; c'est `parseZipCentralDirectory` qui
// dit « c'en est un ». Un fichier tronqué passe le sniff et doit échouer plus
// loin, avec un message actionnable — pas ici.
//
// Cas frontière figé par test : `PK\x05\x06` (EOCD nu, archive vide) n'est PAS
// un en-tête local, donc pas notre format.
function sniffBackupFormat(u8) {
  if (!u8 || typeof u8.length !== 'number' || u8.length < 4) return 'json';
  if (u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) return 'zip';
  return 'json';
}
