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
