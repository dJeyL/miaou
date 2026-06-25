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
