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

// ── Téléchargement côté client ───────────────────────────────────────────────
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
  return (tools || []).filter(t => {
    const bare = t && t.name;
    if (deny.indexOf(bare) >= 0) return false;        // denylist gagne
    if (allow.length && allow.indexOf(bare) < 0) return false;
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
        var ids = groupAcks.map(function(_, k) { return 'tc_' + prefix + '_' + k; });
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
