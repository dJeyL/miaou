/* ── skills.js ─────────────────────────────────────────────────────────────
   Skills MIAOU (stage 1) : fragments Markdown réutilisables, injectables soit
   par slash-commande (`/slug`, injection déterministe figée côté client), soit
   via les outils `miaou__skills__list` / `miaou__skills__read` (chemin modèle).

   Deux couches :
   1. Helpers purs + cache mémoire (QuickJS-testables) : validation de slug,
      parsing slash, synchronisation du cache avec les CRUD.
   2. Couche IDB (navigateur uniquement) : store `skills` (clé `slug`), partage
      la base `miaou` v2 via openResourceDB() (resources.js).

   Schéma d'enregistrement IDB : { slug, name, description, enabled, content }.
   Le cache mémoire NE contient PAS `content` (chargé depuis IDB à l'invocation
   seulement) : il alimente l'autocomplétion du composer, qui filtre à chaque
   frappe et ne peut pas attendre IDB. cf. brief stage 1.
   ──────────────────────────────────────────────────────────────────────────── */

// ── Helpers purs (QuickJS-testables) ─────────────────────────────────────────

const SKILL_SLUG_MAX = 48;

// Valide un slug de skill (clé d'invocation `/slug` ET clé d'objet IDB).
// Contraintes : non vide, pas d'espace, pas de `/`, charset contraint, longueur
// raisonnable, unicité. Retourne une chaîne d'erreur (français) ou null si valide.
function validateSkillSlug(slug, existingSlugs) {
  const s = String(slug == null ? '' : slug).trim();
  if (!s) return 'Slug requis.';
  if (s.length > SKILL_SLUG_MAX) return 'Slug trop long (max ' + SKILL_SLUG_MAX + ' caractères).';
  if (/\s/.test(s)) return 'Le slug ne peut pas contenir d\'espace.';
  if (s.indexOf('/') >= 0) return 'Le slug ne peut pas contenir « / ».';
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return 'Caractères autorisés : lettres, chiffres, tiret, underscore.';
  if (Array.isArray(existingSlugs) && existingSlugs.indexOf(s) >= 0) return 'Ce slug est déjà utilisé.';
  return null;
}

// Parse un message composer en commande slash : si le texte commence par
// `/<slug>` (slug = charset valide), retourne { slug, rest } (rest = reste du
// texte après le slug, espaces de tête retirés). Sinon null. Pur — la résolution
// (cache, enabled, contenu IDB) se fait ailleurs.
function parseSlashCommand(text) {
  const s = String(text == null ? '' : text);
  const m = /^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/.exec(s);
  if (!m) return null;
  return { slug: m[1], rest: (m[2] || '').trim() };
}

// Assemble le contenu d'un message user à partir du littéral tapé et du corps du
// skill injecté. Frozen au moment de l'envoi : le résultat est stocké tel quel
// dans l'historique (jamais re-résolu au reload). DISTINCT de buildContextBlock
// (miaou_context, recalculé à chaque tour) — ne pas mutualiser.
function bakeSkillMessage(literalText, skillContent) {
  const lit = String(literalText == null ? '' : literalText);
  const body = String(skillContent == null ? '' : skillContent).trim();
  if (!body) return lit;
  return lit + '\n\n' + body;
}

// ── Cache mémoire (méta seulement : slug, name, description, enabled) ─────────
// Tableau d'ordre d'insertion stable. Muté par les CRUD IDB ET directement par
// les tests (synchronisation cache/IDB vérifiée sans IDB réel).

let _skillsCache = [];

function _skillMeta(rec) {
  return { slug: rec.slug, name: rec.name || '', description: rec.description || '', enabled: rec.enabled !== false };
}

// Remplace tout le cache (chargement initial depuis IDB).
function setSkillsCache(list) {
  _skillsCache = (Array.isArray(list) ? list : []).map(_skillMeta);
  return _skillsCache;
}

// Insère ou remplace une entrée par slug (préserve la position si déjà présente).
function upsertSkillCache(meta) {
  const m = _skillMeta(meta || {});
  const i = _skillsCache.findIndex(x => x.slug === m.slug);
  if (i >= 0) _skillsCache[i] = m; else _skillsCache.push(m);
  return m;
}

function removeSkillCache(slug) {
  _skillsCache = _skillsCache.filter(x => x.slug !== slug);
}

// Méta d'un skill par slug (depuis le cache mémoire, synchrone). null si absent.
function getSkillMeta(slug) {
  return _skillsCache.find(x => x.slug === slug) || null;
}

// Tous les skills (méta), dans l'ordre d'insertion — pour le drawer de gestion.
function listAllSkillsCache() {
  return _skillsCache.slice();
}

// Skills ACTIVÉS uniquement (méta) — pour l'autocomplétion et miaou__skills__list.
function listEnabledSkills() {
  return _skillsCache.filter(x => x.enabled !== false);
}

// Filtre les skills activés dont le slug (ou le name) matche un préfixe de saisie.
// Pour l'autocomplétion du composer (après `/`). Pur, synchrone.
function matchSkillCompletions(query) {
  const q = String(query == null ? '' : query).toLowerCase();
  return listEnabledSkills().filter(s =>
    s.slug.toLowerCase().indexOf(q) >= 0 ||
    (s.name && s.name.toLowerCase().indexOf(q) >= 0));
}

// ── Couche IDB (navigateur uniquement — non QuickJS-testable) ─────────────────
// Partage la base `miaou` (v2) via openResourceDB() de resources.js. Discipline :
// un seul await par opération, uniquement sur des requêtes IDB.

// Lit tous les enregistrements (méta + content) du store.
function getAllSkillRecords() {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('skills', 'readonly');
      const req = tx.objectStore('skills').getAll();
      req.onsuccess = function(e) { resolve(e.target.result || []); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// Lit un enregistrement complet par slug. null si absent.
function getSkillRecord(slug) {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('skills', 'readonly');
      const req = tx.objectStore('skills').get(slug);
      req.onsuccess = function(e) { resolve(e.target.result || null); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// Écrit (insert/replace) un enregistrement skill complet en IDB PUIS synchronise
// le cache mémoire (méta). Retourne le slug.
function putSkill(record) {
  const rec = {
    slug: String(record.slug || '').trim(),
    name: String(record.name || ''),
    description: String(record.description || ''),
    enabled: record.enabled !== false,
    content: String(record.content || ''),
  };
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('skills', 'readwrite');
      const req = tx.objectStore('skills').put(rec);
      req.onsuccess = function() { upsertSkillCache(rec); resolve(rec.slug); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// Supprime un skill (hard delete, pas de tombstone — action administrative
// explicite, cf. brief) PUIS retire du cache mémoire.
function deleteSkillDb(slug) {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('skills', 'readwrite');
      const req = tx.objectStore('skills').delete(slug);
      req.onsuccess = function() { removeSkillCache(slug); resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// Bascule l'état `enabled` d'un skill en IDB + cache. Retourne le nouvel état
// (bool) ou null si le skill est absent.
function toggleSkillEnabled(slug) {
  return getSkillRecord(slug).then(function(rec) {
    if (!rec) return null;
    rec.enabled = rec.enabled === false;   // inverse (absent === true → false)
    return putSkill(rec).then(function() { return rec.enabled; });
  });
}

// Récupère le contenu Markdown d'un skill ACTIVÉ depuis IDB. Renvoie null si
// absent ou désactivé (l'appelant traite le cas erreur). Async — appelé à
// l'invocation seulement (slash ou miaou__skills__read).
function getSkillContent(slug) {
  return getSkillRecord(slug).then(function(rec) {
    if (!rec || rec.enabled === false) return null;
    return String(rec.content || '');
  });
}

// Peuple le cache mémoire depuis IDB au démarrage (fire-and-forget dans init).
// Échec silencieux (IDB indisponible) → cache vide, autocomplétion/outils inertes.
async function loadSkillsCache() {
  try {
    const records = await getAllSkillRecords();
    setSkillsCache(records);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] loadSkillsCache:', e && e.message);
  }
}
