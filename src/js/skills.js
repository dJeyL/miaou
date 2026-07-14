/* ── skills.js ─────────────────────────────────────────────────────────────
   Skills MIAOU (stage 1) : fragments Markdown réutilisables, injectables soit
   par slash-commande (`/slug`, injection déterministe figée côté client), soit
   via les outils `miaou__skills__list` / `miaou__skills__read` (chemin modèle).

   Deux couches :
   1. Helpers purs + cache mémoire (QuickJS-testables) : validation de slug,
      parsing slash, synchronisation du cache avec les CRUD.
   2. Couche IDB (navigateur uniquement) : store `skills` (clé `slug`), partage
      la base `miaou` v2 via openResourceDB() (resources.js).

   Schéma d'enregistrement IDB : { slug, name, description, enabled, content,
   autotrigger }. Le cache mémoire NE contient PAS `content` (chargé depuis IDB
   à l'invocation seulement) : il alimente l'autocomplétion du composer, qui
   filtre à chaque frappe et ne peut pas attendre IDB. cf. brief stage 1.

   Stage 2 ajoute `autotrigger` (bool, défaut false — OPPOSÉ à `enabled`) : un
   skill enabled+autotrigger est listé chaque tour dans le contexte dynamique
   (cf. main.js, getAutotriggerSkillsMeta), pour découverte proactive par le
   modèle sans appel préalable à miaou__skills__list. Pas de bump de version
   IDB : schemaless, les enregistrements existants en sont simplement dépourvus
   (absence == false).
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

// Dérive un slug valide (charset validateSkillSlug) à partir d'un nom libre :
// minuscules, espaces/séparateurs → tiret, caractères hors charset retirés.
function slugifySkillName(name) {
  return String(name == null ? '' : name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Parse un cartouche frontmatter (```---\nclé: valeur\n---```) en tête d'un
// contenu de skill collé (format Claude Code, cf. untracked/example-skill.md).
// Ne reconnaît que les 3 clés utiles au formulaire MIAOU : `name`, `description`,
// `disable-model-invocation`. Retourne null si aucun cartouche détecté en tête
// (pas de bloc `---`/`---`) ; sinon { name, description, disableModelInvocation }
// où chaque champ est `null` si la clé est absente du cartouche (l'appelant ne
// touche pas au champ formulaire correspondant). Pur, ne modifie jamais le texte
// source : le cartouche reste dans le contenu collé (décision explicite Julien).
function parseSkillFrontmatter(text) {
  const s = String(text == null ? '' : text);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(s);
  if (!m) return null;
  const out = { name: null, description: null, disableModelInvocation: null };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].trim().toLowerCase();
    const val = kv[2].trim().replace(/^["']|["']$/g, '');
    if (key === 'name') out.name = val;
    else if (key === 'description') out.description = val;
    else if (key === 'disable-model-invocation') out.disableModelInvocation = /^true$/i.test(val);
  }
  return out;
}

// Décide du routage d'un import de fichier .md dans le drawer skills (drag&drop
// ou copier-coller Finder/Explorateur, cf. docs/skills.md) : `fm` est le résultat
// de parseSkillFrontmatter (ou null si aucun cartouche). Règles :
//  - pas de cartouche, ou cartouche sans `name` → création (slug dérivé du name
//    quand présent quand même — cas cartouche partiel — sinon slug vide, laissé
//    à la saisie manuelle).
//  - cartouche avec `name` dont le slug slugifié matche un slug EXISTANT →
//    édition de CE slug (bascule sur la card déjà en base).
//  - sinon → création, slug pré-rempli par le name slugifié.
// Pur, ne lit ni n'écrit aucun store — l'appelant (main.js) route ensuite vers
// la card DOM correspondante.
function resolveSkillDropTarget(fm, existingSlugs) {
  const slugs = Array.isArray(existingSlugs) ? existingSlugs : [];
  const name = fm && fm.name != null ? fm.name : '';
  const slug = name ? slugifySkillName(name) : '';
  if (slug && slugs.indexOf(slug) >= 0) return { mode: 'edit', slug };
  return { mode: 'create', slug };
}

// Trouve TOUTES les occurrences de trigger `/slug` dans un texte : en position 0,
// ou immédiatement précédées d'un espace/saut de ligne (frontière de mot — exclut
// `https://`, `and/or`, etc.). Retourne un tableau ordonné par position croissante :
// [{ start, end, slug, atStart }] (start/end = bornes du `/slug` dans le texte,
// end exclusif ; atStart = vrai si start === 0). Pur — aucune résolution cache/IDB.
// Partagé par l'autocomplétion (composer + édition) ET resolveSend (multi-skill).
function findSlashTriggers(text) {
  const s = String(text == null ? '' : text);
  const re = /\/([a-zA-Z0-9_-]*)/g;
  const out = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    const start = m.index;
    const prev = start > 0 ? s[start - 1] : null;
    if (start === 0 || (prev != null && /\s/.test(prev))) {
      out.push({ start, end: start + 1 + m[1].length, slug: m[1], atStart: start === 0 });
    }
  }
  return out;
}

// Assemble le contenu d'un message user à partir du littéral tapé et des skills
// résolus (un ou plusieurs, dans l'ordre d'apparition). `resolved` est un tableau
// [{ slug, content }]. Chaque corps non vide est appendé en fin de message, encadré
// par des marqueurs `--- skill: slug ---` pour que le modèle distingue sans
// ambiguïté quel contenu appartient à quel `/slug`. Frozen au moment de l'envoi :
// le résultat est stocké tel quel dans l'historique (jamais re-résolu au reload).
// DISTINCT de buildContextBlock (miaou_context, recalculé à chaque tour).
function bakeSkillMessage(literalText, resolved) {
  const lit = String(literalText == null ? '' : literalText);
  const list = Array.isArray(resolved) ? resolved : [];
  const blocks = [];
  for (const r of list) {
    const body = String(!r || r.content == null ? '' : r.content).trim();
    if (!body) continue;
    blocks.push('--- skill: ' + r.slug + ' ---\n' + body + '\n--- /skill: ' + r.slug + ' ---');
  }
  if (!blocks.length) return lit;
  return lit + '\n\n' + blocks.join('\n\n');
}

// ── Cache mémoire (méta seulement : slug, name, description, enabled) ─────────
// Tableau d'ordre d'insertion stable. Muté par les CRUD IDB ET directement par
// les tests (synchronisation cache/IDB vérifiée sans IDB réel).

let _skillsCache = [];

function _skillMeta(rec) {
  return { slug: rec.slug, name: rec.name || '', description: rec.description || '', enabled: rec.enabled !== false, autotrigger: rec.autotrigger === true };
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

// Méta d'une skill par slug (depuis le cache mémoire, synchrone). null si absent.
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

// Skills enabled ET autotrigger (méta {slug, name, description}, même forme que
// miaou__skills__list, mais fonction DISTINCTE — ne touche pas à ce tool ni à son
// filtre). Pour l'injection dynamique <miaou_skills_context> (main.js), recalculée
// à chaque tour depuis le cache courant. [] si aucun match (l'appelant omet le bloc).
function getAutotriggerSkillsMeta() {
  return listEnabledSkills()
    .filter(s => s.autotrigger === true)
    .map(s => ({ slug: s.slug, name: s.name, description: s.description }));
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
    autotrigger: record.autotrigger === true,
  };
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('skills', 'readwrite');
      const req = tx.objectStore('skills').put(rec);
      req.onsuccess = function() { upsertSkillCache(rec); resolve(rec.slug); };
      tx.oncomplete = function() { syncPost('skills-updated', {}); };   // post-commit (piège 24)
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// Supprime une skill (hard delete, pas de tombstone — action administrative
// explicite, cf. brief) PUIS retire du cache mémoire.
function deleteSkillDb(slug) {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('skills', 'readwrite');
      const req = tx.objectStore('skills').delete(slug);
      req.onsuccess = function() { removeSkillCache(slug); resolve(); };
      tx.oncomplete = function() { syncPost('skills-updated', {}); };   // post-commit (piège 24)
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// Bascule l'état `enabled` d'une skill en IDB + cache. Retourne le nouvel état
// (bool) ou null si la skill est absente.
function toggleSkillEnabled(slug) {
  return getSkillRecord(slug).then(function(rec) {
    if (!rec) return null;
    rec.enabled = rec.enabled === false;   // inverse (absent === true → false)
    return putSkill(rec).then(function() { return rec.enabled; });
  });
}

// Récupère le contenu Markdown d'une skill ACTIVÉE depuis IDB. Renvoie null si
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
