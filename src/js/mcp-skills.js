/* ── mcp-skills.js ──────────────────────────────────────────────────────────
   Skills servies par un serveur MCP (extension `io.modelcontextprotocol/skills`,
   texte normatif : `specification/stable/skills.mdx` du dépôt
   `modelcontextprotocol/ext-skills`). Distinct de skills.js, qui porte les
   skills LOCALES (IDB, drawer, slash) : une skill MCP n'est jamais stockée, elle
   est lue à la demande chez son serveur, vérifiée, puis rendue au modèle.

   Ce fichier ne porte que des purs, testés en QuickJS (tests/test-mcp-skills.js).
   Les chemins réseau qui les emploient vivent avec leurs voisins (mcp.js pour le
   transport, tools.js pour la lecture et la garde).

   Intégrité. La spec impose de vérifier tout fichier lu contre l'entrée de
   manifeste qui le décrit (taille, puis empreinte SHA-256 des octets bruts), et
   de comparer le frontmatter du SKILL.md, champ par champ, au `frontmatter` de
   l'entrée. Tout écart vaut échec, et le contenu n'est pas utilisé. Une
   empreinte n'est PAS un ancrage de confiance (elle vient du même serveur que
   le contenu) : elle prouve la cohérence entre ce qui a été approuvé et ce qui
   est lu, rien de plus.
   ───────────────────────────────────────────────────────────────────────── */

// ── SHA-256 ──────────────────────────────────────────────────────────────────
//
// En JS pur et SYNCHRONE, pour les mêmes raisons qui écartent `crypto.subtle`
// de `fnv1aBytes` (docs.js) : pas de secure context en `file://` partout, API
// asynchrone injoignable depuis le runner QuickJS. Ici la propriété
// cryptographique est exigée par la spec (empreinte publiée par le serveur),
// donc pas de raccourci vers un hash maison. Une skill pèse au plus 16 Mio
// (borne de la spec) : un passage linéaire suffit.

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// Empreinte SHA-256 d'une suite d'octets (Uint8Array, ou tableau d'entiers),
// en 64 caractères hexadécimaux minuscules.
function sha256Hex(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const len = src.length;
  // Message complété : 0x80, des zéros, puis la longueur en BITS sur 64 bits
  // gros-boutiste. Une longueur en octets tient sous 2^53 : la moitié haute
  // se calcule par division, jamais par un décalage qui tronquerait à 32 bits.
  const total = Math.ceil((len + 9) / 64) * 64;
  const m = new Uint8Array(total);
  m.set(src);
  m[len] = 0x80;
  const hi = Math.floor(len / 0x20000000);
  const lo = (len * 8) >>> 0;
  m[total - 8] = hi >>> 24; m[total - 7] = (hi >>> 16) & 0xff; m[total - 6] = (hi >>> 8) & 0xff; m[total - 5] = hi & 0xff;
  m[total - 4] = lo >>> 24; m[total - 3] = (lo >>> 16) & 0xff; m[total - 2] = (lo >>> 8) & 0xff; m[total - 1] = lo & 0xff;

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] = ((m[j] << 24) | (m[j + 1] << 16) | (m[j + 2] << 8) | m[j + 3]) | 0;
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  let out = '';
  for (const v of [h0, h1, h2, h3, h4, h5, h6, h7]) out += ('00000000' + (v >>> 0).toString(16)).slice(-8);
  return out;
}

// ── Octets d'un contenu `resources/read` ─────────────────────────────────────
//
// L'empreinte porte sur les octets BRUTS du fichier. Un contenu `text` est
// ré-encodé en UTF-8 (mesuré sur le proxy : le SKILL.md de bench, accentué,
// retrouve exactement son empreinte), un `blob` est décodé du base64. Rend
// null pour tout le reste : un contenu sans octets ne se vérifie pas, donc ne
// se charge pas.
function mcpResourceContentBytes(content) {
  if (!content || typeof content !== 'object') return null;
  if (typeof content.text === 'string') return new Uint8Array(utf8Encode(content.text));
  if (typeof content.blob === 'string') return new Uint8Array(base64ToArrayBuffer(content.blob));
  return null;
}

// ── Vérification d'un fichier contre son entrée de manifeste ─────────────────
//
// Forme exigée par la spec : `sha256:` suivi de 64 hexadécimaux MINUSCULES. Une
// entrée qui s'en écarte (autre algorithme, majuscules, préfixe absent) n'est
// pas vérifiable : c'est un échec, pas un cas à tolérer.
const MCP_SKILL_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

// Rend null si `bytes` correspond à `resource` ({uri, digest, size}), sinon
// `{ code, expected, actual }` :
//   'manifest' — entrée sans taille entière ou à l'empreinte mal formée ;
//   'content'  — aucun octet (contenu illisible) ;
//   'size'     — tailles différentes, tranché AVANT de hacher (la spec en fait
//                un échec équivalent, inutile de calculer l'empreinte) ;
//   'digest'   — empreintes différentes.
function verifyMcpSkillFile(bytes, resource) {
  const r = resource || {};
  if (!Number.isInteger(r.size) || r.size < 0 || typeof r.digest !== 'string' || !MCP_SKILL_DIGEST_RE.test(r.digest)) {
    return { code: 'manifest', expected: null, actual: null };
  }
  if (!bytes || typeof bytes.length !== 'number') return { code: 'content', expected: r.size, actual: null };
  if (bytes.length !== r.size) return { code: 'size', expected: r.size, actual: bytes.length };
  const digest = 'sha256:' + sha256Hex(bytes);
  if (digest !== r.digest) return { code: 'digest', expected: r.digest, actual: digest };
  return null;
}

// ── Frontmatter STRICT d'un SKILL.md ─────────────────────────────────────────
//
// Distinct de `parseSkillFrontmatter` (skills.js), qui sert l'import de skills
// LOCALES et doit rester tolérant : celui-ci lit un sous-ensemble YAML étroit et
// REFUSE tout le reste en nommant le champ, parce qu'un champ qu'on ne sait pas
// lire ne peut pas être comparé à l'entrée, et qu'une comparaison impossible
// vaut échec de vérification (décidé : parseur maison, sans bibliothèque).
//
// Sous-ensemble lu, celui du format Agent Skills :
//   - clés racine `clé: valeur`, valeur scalaire sur UNE ligne : nue, entre
//     guillemets simples ('' pour une apostrophe) ou doubles (échappements
//     usuels), suivie au plus d'un commentaire ` # …` ;
//   - `metadata:` seul, suivi de sous-clés indentées d'un même retrait, chacune
//     à valeur scalaire (un niveau, chaîne → chaîne) ;
//   - lignes vides et commentaires pleins.
// Refusé : valeur vide, valeur sur plusieurs lignes, blocs `|` et `>`, listes,
// objets imbriqués hors `metadata` ou au-delà d'un niveau, formes en ligne
// `[…]`/`{…}`, ancres, alias, étiquettes, clés entre guillemets ou en double,
// tabulations d'indentation.
//
// Rend `{ ok: true, fields }`, où chaque champ vaut `{ kind: 'plain'|'quoted',
// text }` ou, pour `metadata`, `{ kind: 'map', entries: { clé: scalaire } }` ;
// ou `{ ok: false, field, reason }`, `field` étant le nom du champ fautif
// (`metadata.<clé>` pour une sous-clé, null quand le défaut précède tout champ).
function parseMcpSkillFrontmatter(text) {
  let s = String(text == null ? '' : text);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const lines = s.split(/\r?\n/);
  const fail = (field, reason) => ({ ok: false, field: field, reason: reason });
  if (!/^---[ \t]*$/.test(lines[0])) return fail(null, 'le fichier ne commence pas par un frontmatter (---)');
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) { end = i; break; }
  }
  if (end < 0) return fail(null, 'frontmatter non refermé (--- manquant)');

  const fields = {};
  let lastKey = null;      // dernier champ racine lu, pour nommer une ligne indentée orpheline
  let mapKey = null;       // champ racine dont on lit les sous-clés (`metadata` seulement)
  let mapIndent = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (/^\s*(#.*)?$/.test(line)) continue;
    const indent = /^ */.exec(line)[0].length;
    if (line.charAt(indent) === '\t') return fail(mapKey || lastKey, 'tabulation dans l\'indentation');
    const body = line.slice(indent);
    if (indent > 0) {
      if (!mapKey) return fail(lastKey, 'valeur sur plusieurs lignes, liste ou objet imbriqué');
      if (mapIndent === null) mapIndent = indent;
      else if (indent !== mapIndent) return fail(mapKey, 'imbrication au-delà d\'un niveau, ou retrait incohérent');
      if (/^-(\s|$)/.test(body)) return fail(mapKey, 'liste');
      const kv = splitMcpFrontmatterLine(body);
      if (kv.error) return fail(mapKey, kv.error);
      const name = mapKey + '.' + kv.key;
      const entries = fields[mapKey].entries;
      if (Object.prototype.hasOwnProperty.call(entries, kv.key)) return fail(name, 'clé en double');
      if (kv.value === '') return fail(name, 'valeur vide, ou objet imbriqué au-delà d\'un niveau');
      const sc = parseMcpFrontmatterScalar(kv.value);
      if (sc.error) return fail(name, sc.error);
      entries[kv.key] = sc;
      continue;
    }
    mapKey = null;
    mapIndent = null;
    if (/^-(\s|$)/.test(body)) return fail(lastKey, 'liste à la racine du frontmatter');
    const kv = splitMcpFrontmatterLine(body);
    if (kv.error) return fail(null, kv.error);
    if (Object.prototype.hasOwnProperty.call(fields, kv.key)) return fail(kv.key, 'clé en double');
    lastKey = kv.key;
    if (kv.value === '') {
      if (kv.key !== 'metadata') return fail(kv.key, 'valeur vide, liste ou objet imbriqué (seul metadata porte des sous-clés)');
      fields.metadata = { kind: 'map', entries: {} };
      mapKey = 'metadata';
      continue;
    }
    const sc = parseMcpFrontmatterScalar(kv.value);
    if (sc.error) return fail(kv.key, sc.error);
    fields[kv.key] = sc;
  }
  if (fields.metadata && fields.metadata.kind === 'map' && !Object.keys(fields.metadata.entries).length) {
    return fail('metadata', 'valeur vide');
  }
  return { ok: true, fields: fields };
}

// Sépare `clé: valeur` (ligne sans son retrait). La clé s'arrête au premier
// deux-points suivi d'une espace ou de la fin de ligne, comme en YAML ; une
// valeur qui commence par `#` est un commentaire, donc vide. Rend `{ key,
// value }` ou `{ error }`.
function splitMcpFrontmatterLine(body) {
  if (/^["']/.test(body)) return { error: 'clé entre guillemets' };
  if (/^[?&*!|>%@`\[{]/.test(body)) return { error: 'clé complexe, ancre, alias ou étiquette' };
  let idx = -1;
  for (let i = 0; i < body.length; i++) {
    if (body.charAt(i) === ':' && (i + 1 === body.length || body.charAt(i + 1) === ' ')) { idx = i; break; }
  }
  if (idx <= 0) return { error: 'ligne sans « clé: valeur »' };
  const key = body.slice(0, idx).replace(/\s+$/, '');
  if (!key) return { error: 'clé vide' };
  let value = body.slice(idx + 1).trim();
  if (value.charAt(0) === '#') value = '';
  return { key: key, value: value };
}

// Lit un scalaire sur une ligne (sans le retrait ni la clé). Rend `{ kind,
// text }` ou `{ error }`. Une valeur entre guillemets est une chaîne, toujours ;
// une valeur nue garde son TEXTE, le typage (nombre, booléen, null) étant
// tranché à la comparaison contre l'entrée, qui l'a fait côté serveur.
function parseMcpFrontmatterScalar(raw) {
  const v = String(raw);
  const c = v.charAt(0);
  if (c === '"' || c === '\'') {
    let out = '';
    let i = 1;
    let closed = false;
    while (i < v.length) {
      const ch = v.charAt(i);
      if (c === '\'') {
        if (ch === '\'') {
          if (v.charAt(i + 1) === '\'') { out += '\''; i += 2; continue; }
          closed = true; i++; break;
        }
        out += ch; i++; continue;
      }
      if (ch === '"') { closed = true; i++; break; }
      if (ch !== '\\') { out += ch; i++; continue; }
      const e = v.charAt(i + 1);
      const simple = { '\\': '\\', '"': '"', '/': '/', 'n': '\n', 't': '\t', 'r': '\r', '0': '\0', ' ': ' ' };
      if (Object.prototype.hasOwnProperty.call(simple, e)) { out += simple[e]; i += 2; continue; }
      const width = e === 'x' ? 2 : e === 'u' ? 4 : e === 'U' ? 8 : 0;
      const hex = width ? v.slice(i + 2, i + 2 + width) : '';
      if (!width || !new RegExp('^[0-9a-fA-F]{' + width + '}$').test(hex)) return { error: 'échappement non pris en charge dans une chaîne entre guillemets' };
      const cp = parseInt(hex, 16);
      if (cp > 0x10FFFF) return { error: 'échappement hors de la plage Unicode' };
      out += String.fromCodePoint(cp);
      i += 2 + width;
    }
    if (!closed) return { error: 'chaîne entre guillemets non refermée (valeur sur plusieurs lignes ?)' };
    const rest = v.slice(i);
    if (rest && !/^\s*$/.test(rest) && !/^\s+#/.test(rest)) return { error: 'texte après une chaîne entre guillemets' };
    return { kind: 'quoted', text: out };
  }
  if (c === '|' || c === '>') return { error: 'bloc multiligne (| ou >)' };
  if (c === '[' || c === '{') return { error: 'liste ou objet en ligne' };
  if (c === '&' || c === '*') return { error: 'ancre ou alias' };
  if (c === '!') return { error: 'étiquette de type' };
  if (c === '%' || c === '@' || c === '`') return { error: 'caractère réservé en tête de valeur' };
  if (/^[-?:](\s|$)/.test(v)) return { error: 'liste ou clé complexe' };
  const hash = v.search(/\s#/);
  const text = (hash >= 0 ? v.slice(0, hash) : v).replace(/\s+$/, '');
  if (/:(\s|$)/.test(text)) return { error: 'deux-points suivi d\'une espace dans une valeur sans guillemets' };
  return { kind: 'plain', text: text };
}

// Booléens YAML : ceux de YAML 1.2 et ceux de 1.1 (PyYAML, côté serveur, les
// type encore). Une liste large ne relâche rien : elle ne fait que reconnaître
// une valeur que le serveur a DÉJÀ typée booléenne dans l'entrée.
const MCP_YAML_BOOLEANS = {
  'true': true, 'True': true, 'TRUE': true, 'false': false, 'False': false, 'FALSE': false,
  'yes': true, 'Yes': true, 'YES': true, 'no': false, 'No': false, 'NO': false,
  'on': true, 'On': true, 'ON': true, 'off': false, 'Off': false, 'OFF': false,
};

// Un scalaire lu dans le fichier correspond-il à la valeur JSON de l'entrée ?
// Comparaison en scalaires NORMALISÉS : le serveur a typé son YAML (`version:
// 1.0` arrive en nombre 1, `true` en booléen), le parseur rend du texte.
// Une valeur entre guillemets n'égale qu'une chaîne identique.
function mcpFrontmatterScalarMatches(scalar, value) {
  if (!scalar || (scalar.kind !== 'plain' && scalar.kind !== 'quoted')) return false;
  if (scalar.kind === 'quoted') return typeof value === 'string' && value === scalar.text;
  const t = scalar.text;
  if (typeof value === 'string') return value === t;
  if (typeof value === 'boolean') return Object.prototype.hasOwnProperty.call(MCP_YAML_BOOLEANS, t) && MCP_YAML_BOOLEANS[t] === value;
  if (typeof value === 'number') {
    if (!/^[-+]?(0x[0-9a-fA-F_]+|0o[0-7_]+|[0-9][0-9_]*(\.[0-9_]*)?([eE][-+]?[0-9]+)?|\.[0-9][0-9_]*([eE][-+]?[0-9]+)?)$/.test(t)) return false;
    const n = Number(t.replace(/_/g, '').replace(/^\+/, ''));
    return !isNaN(n) && n === value;
  }
  if (value === null) return /^(~|null|Null|NULL)$/.test(t);
  return false;
}

// Compare les champs lus (`parseMcpSkillFrontmatter(...).fields`) au
// `frontmatter` de l'entrée, champ par champ, dans les deux sens : un champ
// présent d'un côté seulement est un écart. Rend null, ou `{ field, reason }`.
function compareMcpSkillFrontmatter(fields, entryFrontmatter) {
  const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  if (!isObj(entryFrontmatter)) return { field: null, reason: 'frontmatter de l\'entrée absent ou illisible' };
  const f = fields || {};
  for (const k of Object.keys(entryFrontmatter)) {
    if (!has(f, k)) return { field: k, reason: 'déclaré par l\'entrée, absent du fichier' };
  }
  for (const k of Object.keys(f)) {
    if (!has(entryFrontmatter, k)) return { field: k, reason: 'présent dans le fichier, absent de l\'entrée' };
    const mine = f[k];
    const theirs = entryFrontmatter[k];
    if (mine.kind === 'map') {
      if (!isObj(theirs)) return { field: k, reason: 'objet dans le fichier, autre chose dans l\'entrée' };
      for (const sk of Object.keys(theirs)) {
        if (!has(mine.entries, sk)) return { field: k + '.' + sk, reason: 'déclaré par l\'entrée, absent du fichier' };
      }
      for (const sk of Object.keys(mine.entries)) {
        if (!has(theirs, sk)) return { field: k + '.' + sk, reason: 'présent dans le fichier, absent de l\'entrée' };
        if (!mcpFrontmatterScalarMatches(mine.entries[sk], theirs[sk])) return { field: k + '.' + sk, reason: 'valeur différente de l\'entrée' };
      }
      continue;
    }
    if (!mcpFrontmatterScalarMatches(mine, theirs)) return { field: k, reason: 'valeur différente de l\'entrée' };
  }
  return null;
}

// Vérification de frontmatter exigée après la lecture d'un SKILL.md : parse
// strict, puis comparaison à l'entrée. Rend null, ou `{ field, reason }` —
// illisible et différent se traitent pareil (échec, rien de chargé).
function verifyMcpSkillFrontmatter(text, entryFrontmatter) {
  const parsed = parseMcpSkillFrontmatter(text);
  if (!parsed.ok) return { field: parsed.field, reason: parsed.reason };
  return compareMcpSkillFrontmatter(parsed.fields, entryFrontmatter);
}

// ── Catalogue : capacité, entrées, `_meta` des outils ────────────────────────
//
// Le catalogue d'un serveur est la liste de ses ENTRÉES (`skills/list`) :
// métadonnées seulement, frontmatter et manifeste. Aucun contenu n'est lu à la
// connexion (« Lazy Retrieval » de la spec) ; le SKILL.md d'une skill l'est à
// son chargement, une annexe à sa lecture.

const MCP_SKILLS_EXTENSION_ID = 'io.modelcontextprotocol/skills';

// Bornes de la spec, par skill : un hôte DOIT accepter jusque-là, et PEUT
// refuser au-delà en le disant. MIAOU refuse au-delà.
const MCP_SKILL_MAX_FILES = 512;
const MCP_SKILL_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

// Pages de `skills/list` suivies au plus par connexion. Le proxy de
// miaou-mcp-servers ne pagine pas ; un serveur qui renverrait un curseur sans
// fin ne doit pas retenir la connexion.
const MCP_SKILLS_LIST_MAX_PAGES = 20;

// Clés `_meta` d'outil posées par miaou-mcp-servers (contrat publié par le
// serveur, préfixe `miaou/` comme les autres extensions privées).
const MCP_REQUIRES_SKILL_META_KEY = 'miaou/requiresSkill';
const MCP_SKILLS_FALLBACK_META_KEY = 'miaou/skillsFallback';

// Le serveur déclare-t-il l'extension dans son DiscoverResult ? La valeur
// publiée est un objet VIDE (mesuré) : seule la présence de la clé compte.
// L'extension n'existe qu'en ère moderne ; un InitializeResult legacy ne la
// porte jamais, donc ce prédicat y rend faux sans cas particulier.
function mcpDeclaresSkillsExtension(result) {
  const caps = result && result.capabilities;
  const ext = caps && caps.extensions;
  return !!(ext && typeof ext === 'object' && Object.prototype.hasOwnProperty.call(ext, MCP_SKILLS_EXTENSION_ID));
}

// URI de la skill exigée par un outil listé (`tools/list`), ou null. L'URI est
// relative au serveur qui liste l'outil.
function mcpToolRequiresSkill(tool) {
  const v = tool && tool._meta && tool._meta[MCP_REQUIRES_SKILL_META_KEY];
  return (typeof v === 'string' && v.indexOf('skill://') === 0) ? v : null;
}

// L'outil listé est-il le repli de lecture des skills (`read_skill` chez
// miaou-mcp-servers) ? Reconnu à sa MARQUE, jamais à son nom : un autre serveur
// peut nommer le sien autrement, ou nommer `read_skill` un outil sans rapport.
function mcpToolIsSkillsFallback(tool) {
  return !!(tool && tool._meta && tool._meta[MCP_SKILLS_FALLBACK_META_KEY] === true);
}

// Masquer un outil listé : seulement le repli, et seulement chez un serveur qui
// déclare l'extension — MIAOU lit alors les skills lui-même. Sans l'extension
// (legacy, serveur ancien), le repli est le SEUL chemin de lecture : il reste.
function shouldHideMcpTool(tool, extensionDeclared) {
  return !!extensionDeclared && mcpToolIsSkillsFallback(tool);
}

// Une entrée telle que la rend `skills/get` est enveloppée sous `skill` ; un
// élément de `skills/list` est nu (mesuré sur le proxy). Rend l'entrée nue.
function mcpSkillEntryFromResult(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.skill && typeof result.skill === 'object') return result.skill;
  return result;
}

// Valide une entrée et la normalise en `{ uri, dir, name, description,
// frontmatter, resources, dynamic }` (`resources` vaut un tableau de `{uri,
// digest, size}`, ou null si `dynamic`). Rend `{ entry }` ou `{ problem }`,
// ce dernier en français, lisible par l'utilisateur comme par le modèle.
// La spec interdit de charger une entrée invalide ; elle reste néanmoins au
// catalogue (avec son problème), pour que la fiche serveur dise pourquoi.
function normalizeMcpSkillEntry(raw) {
  const e = raw || {};
  const uri = typeof e.uri === 'string' ? e.uri : '';
  if (uri.indexOf('skill://') !== 0 || !/\/SKILL\.md$/.test(uri)) return { problem: 'URI de skill invalide' };
  const dir = uri.slice(0, uri.length - 'SKILL.md'.length);
  const segs = dir.slice('skill://'.length).split('/').filter(Boolean);
  const fm = e.frontmatter;
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return { problem: 'frontmatter absent' };
  if (typeof fm.name !== 'string' || !fm.name) return { problem: 'frontmatter sans name' };
  if (typeof fm.description !== 'string') return { problem: 'frontmatter sans description' };
  if (!segs.length || segs[segs.length - 1] !== fm.name) return { problem: 'le dernier segment de l\'URI ne vaut pas le name' };
  const base = { uri: uri, dir: dir, name: fm.name, description: fm.description, frontmatter: fm };
  if (e.resources === 'dynamic') return { entry: Object.assign(base, { resources: null, dynamic: true }) };
  if (!Array.isArray(e.resources)) return { problem: 'manifeste absent ou illisible' };
  if (e.resources.length > MCP_SKILL_MAX_FILES) return { problem: 'plus de ' + MCP_SKILL_MAX_FILES + ' fichiers' };
  const seen = {};
  let total = 0;
  const resources = [];
  for (const r of e.resources) {
    if (!r || typeof r.uri !== 'string' || r.uri.indexOf(dir) !== 0) return { problem: 'fichier hors du répertoire de la skill' };
    if (!MCP_SKILL_DIGEST_RE.test(r.digest || '') || !Number.isInteger(r.size) || r.size < 0) return { problem: 'empreinte ou taille mal formée' };
    if (seen[r.uri]) return { problem: 'fichier listé deux fois' };
    seen[r.uri] = true;
    total += r.size;
    resources.push({ uri: r.uri, digest: r.digest, size: r.size });
  }
  if (!seen[uri]) return { problem: 'le manifeste ne liste pas SKILL.md' };
  if (total > MCP_SKILL_MAX_TOTAL_BYTES) return { problem: 'plus de 16 Mio au total' };
  return { entry: Object.assign(base, { resources: resources, dynamic: false }) };
}

// Catalogue d'un serveur depuis les pages de `skills/list` : une entrée par
// élément, normalisée, ou `{ uri, name, problem }` quand elle est invalide
// (name lu au mieux, pour que la fiche puisse la nommer).
function mcpSkillCatalogueFrom(items) {
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const n = normalizeMcpSkillEntry(raw);
    if (n.entry) { out.push(n.entry); continue; }
    const fm = raw && raw.frontmatter;
    out.push({
      uri: raw && typeof raw.uri === 'string' ? raw.uri : '',
      name: fm && typeof fm.name === 'string' ? fm.name : '',
      description: fm && typeof fm.description === 'string' ? fm.description : '',
      problem: n.problem,
    });
  }
  return out;
}

// Entrée du catalogue qui couvre `uri` : la skill dont c'est le SKILL.md, sinon
// celle dont le répertoire contient l'URI (le plus profond gagne, une skill
// imbriquée étant aussi un fichier de son englobante). Rend `{ entry, isSkillMd }`
// ou null. Une entrée invalide ne couvre rien.
function mcpSkillForUri(catalogue, uri) {
  const list = (Array.isArray(catalogue) ? catalogue : []).filter(e => e && !e.problem);
  const u = String(uri || '');
  const own = list.find(e => e.uri === u);
  if (own) return { entry: own, isSkillMd: true };
  let best = null;
  for (const e of list) {
    if (u.indexOf(e.dir) === 0 && u.length > e.dir.length && (!best || e.dir.length > best.dir.length)) best = e;
  }
  return best ? { entry: best, isSkillMd: false } : null;
}

// ── Préfixes d'outils dans les consignes d'un agrégateur ─────────────────────
//
// Une section `## <upstream>` d'un proxy nomme ses outils `<upstream>__…`,
// juste pour un client qui lui parle en direct ; MIAOU les expose
// `<carte>__<upstream>__…`. Tout jeton ENTRE ACCENTS GRAVES qui commence par
// `<upstream>__` reçoit donc le préfixe de carte. Borné aux accents graves :
// un texte libre qui cite l'upstream en prose (« les outils bench ») ne bouge
// pas, une URI non plus. Couvre le bloc des skills généré par le proxy comme le
// texte libre de l'upstream, sans dépendre de la forme du bloc.
function rewriteMcpUpstreamToolPrefixes(body, card, upstream) {
  const text = typeof body === 'string' ? body : '';
  if (!card || !upstream) return text;
  const lead = upstream + '__';
  return text.replace(/`([^`\n]+)`/g, (m, tok) => (tok.indexOf(lead) === 0 ? '`' + card + '__' + tok + '`' : m));
}

// ── Approbations ─────────────────────────────────────────────────────────────
//
// Une skill MCP n'est JAMAIS chargée sans approbation de l'utilisateur, donnée
// skill par skill dans la fiche du serveur (le refus de lecture couvre ainsi
// l'interdit d'exécution implicite de la spec : une skill non chargée ne fait
// rien exécuter). Toute skill y est soumise, même celles qui n'exécutent rien.
//
// Persistée (localStorage `miaou-mcp-skill-approvals`, storage.js) sous la
// forme `{ <carte>: { <name>: { uri, manifest, description, approvedAt } } }`,
// et LIÉE AU MANIFESTE : même ensemble d'URI avec mêmes empreintes et tailles =
// approuvée, tout écart = à réapprouver. Une approbation ne tombe que sur un
// geste (Désapprouver), la suppression de la carte, ou un manifeste changé —
// jamais parce que la skill manque à `skills/list` : un upstream tombé ne
// présente plus ses skills, et elles reviendront avec lui.
//
// Une skill `dynamic` n'a pas d'empreinte : son approbation ne peut pas être
// liée au contenu, donc elle n'est pas persistée. Elle vaut pour la session de
// l'onglet, en mémoire, et n'est pas diffusée aux autres onglets.

// Même ensemble de fichiers, mêmes empreintes, mêmes tailles, dans n'importe
// quel ordre.
function mcpSkillManifestMatches(approved, current) {
  if (!Array.isArray(approved) || !Array.isArray(current) || approved.length !== current.length) return false;
  const byUri = {};
  for (const r of approved) {
    if (!r || typeof r.uri !== 'string' || byUri[r.uri]) return false;
    byUri[r.uri] = r;
  }
  for (const r of current) {
    const a = r && byUri[r.uri];
    if (!a || a.digest !== r.digest || a.size !== r.size) return false;
  }
  return true;
}

// Approbation persistée d'une skill (entrée normalisée, non dynamique) : rend
// une NOUVELLE table, la source n'est pas mutée.
function approveMcpSkill(all, card, entry, now) {
  const next = Object.assign({}, all || {});
  if (!card || !entry || entry.dynamic || !Array.isArray(entry.resources)) return next;
  next[card] = Object.assign({}, next[card] || {});
  next[card][entry.name] = {
    uri: entry.uri,
    manifest: entry.resources.map(r => ({ uri: r.uri, digest: r.digest, size: r.size })),
    description: entry.description || '',
    approvedAt: now || 0,
  };
  return next;
}

function disapproveMcpSkill(all, card, name) {
  const next = Object.assign({}, all || {});
  if (!next[card] || !Object.prototype.hasOwnProperty.call(next[card], name)) return next;
  next[card] = Object.assign({}, next[card]);
  delete next[card][name];
  if (!Object.keys(next[card]).length) delete next[card];
  return next;
}

// Suppression d'une carte : ses approbations partent avec elle (la spec
// recommande de retirer ce qui est attaché à un serveur qu'on retire).
function removeMcpSkillApprovals(all, card) {
  const next = Object.assign({}, all || {});
  delete next[card];
  return next;
}

// Renommage d'une carte : c'est le même serveur, renommé par l'utilisateur ;
// ses approbations le suivent plutôt que de faire tout réapprouver. Une table
// déjà présente sous le nouveau nom (carte supprimée puis recréée) est
// remplacée, l'ancienne carte étant la seule dont le contenu a été vu.
function renameMcpSkillApprovals(all, oldCard, newCard) {
  const next = Object.assign({}, all || {});
  if (!oldCard || !newCard || oldCard === newCard) return next;
  if (Object.prototype.hasOwnProperty.call(next, oldCard)) next[newCard] = next[oldCard];
  else delete next[newCard];
  delete next[oldCard];
  return next;
}

// État d'une skill du catalogue au regard des approbations :
//   'invalid'          — entrée invalide, jamais chargeable ;
//   'approved'         — approbation persistée au manifeste courant ;
//   'changed'          — approbation persistée, manifeste différent ;
//   'pending'          — jamais approuvée ;
//   'session-approved' — dynamique, approuvée pour la session ;
//   'session-pending'  — dynamique, pas encore approuvée dans cet onglet.
// `approval` : l'enregistrement persisté de cette skill ou null ; `sessionUri` :
// l'URI approuvée pour la session, ou null.
function mcpSkillApprovalState(entry, approval, sessionUri) {
  if (!entry || entry.problem) return 'invalid';
  if (entry.dynamic) return sessionUri === entry.uri ? 'session-approved' : 'session-pending';
  if (!approval) return 'pending';
  return (approval.uri === entry.uri && mcpSkillManifestMatches(approval.manifest, entry.resources)) ? 'approved' : 'changed';
}

// Approuvée au sens du chargement : seuls ces deux états laissent lire.
function mcpSkillStateAllowsLoad(state) {
  return state === 'approved' || state === 'session-approved';
}

// Rangées de la fiche d'un serveur : une par skill du catalogue, puis une par
// approbation dont la skill n'est pas présentée actuellement (état 'absent',
// désapprouvable). `catalogue` peut être null (liste illisible) : seules les
// approbations sont alors montrées, comme absentes. `localSlugs` : les slugs des
// skills locales, pour signaler une homonymie (une skill MCP ne remplace jamais
// une locale : le slug lit toujours la locale).
function mcpSkillRows(catalogue, approvals, session, localSlugs) {
  const appr = approvals || {};
  const sess = session || {};
  const locals = Array.isArray(localSlugs) ? localSlugs : [];
  const rows = [];
  const presented = {};
  for (const e of Array.isArray(catalogue) ? catalogue : []) {
    const approval = Object.prototype.hasOwnProperty.call(appr, e.name) ? appr[e.name] : null;
    const state = mcpSkillApprovalState(e, approval, sess[e.name] || null);
    presented[e.name] = true;
    rows.push({
      name: e.name, uri: e.uri, description: e.description || '', state: state,
      dynamic: !!e.dynamic, problem: e.problem || null, collision: locals.indexOf(e.name) >= 0,
    });
  }
  for (const name of Object.keys(appr).sort()) {
    if (presented[name]) continue;
    const a = appr[name] || {};
    rows.push({
      name: name, uri: a.uri || '', description: a.description || '', state: 'absent',
      dynamic: false, problem: null, collision: locals.indexOf(name) >= 0,
    });
  }
  return rows;
}

// Skills à (ré)approuver pour le toast de démarrage : PRÉSENTES, valides, non
// dynamiques (une dynamique serait à approuver à chaque rechargement — elle ne
// se signale qu'au refus de lecture), à l'état 'pending' ou 'changed'.
// `statuses` : `{ <carte>: { state, skillCatalogue } }` (forme de
// `_remoteStatus`). Rend `[{ card, name }]`, triée.
function mcpSkillsAwaitingApproval(statuses, approvals) {
  const out = [];
  const all = approvals || {};
  for (const card of Object.keys(statuses || {}).sort()) {
    const st = statuses[card];
    if (!st || st.state !== 'ok' || !Array.isArray(st.skillCatalogue)) continue;
    const appr = all[card] || {};
    for (const e of st.skillCatalogue) {
      if (!e || e.problem || e.dynamic) continue;
      const state = mcpSkillApprovalState(e, Object.prototype.hasOwnProperty.call(appr, e.name) ? appr[e.name] : null, null);
      if (state === 'pending' || state === 'changed') out.push({ card: card, name: e.name });
    }
  }
  return out;
}

// Approbations de session des skills dynamiques : `{ <carte>: { <name>: uri } }`,
// en mémoire, propres à l'onglet. Lues et écrites par fonctions seulement (un
// `let` de portée fichier ne franchit pas la frontière dans le runner).
let _mcpSkillSessionApprovals = {};
function mcpSkillSessionApprovalsFor(card) { return _mcpSkillSessionApprovals[card] || {}; }
function setMcpSkillSessionApproval(card, name, uri) {
  if (!card || !name) return;
  _mcpSkillSessionApprovals[card] = Object.assign({}, _mcpSkillSessionApprovals[card] || {});
  if (uri) _mcpSkillSessionApprovals[card][name] = uri;
  else delete _mcpSkillSessionApprovals[card][name];
}
function renameMcpSkillSessionApprovals(oldCard, newCard) {
  if (!oldCard || !newCard || oldCard === newCard) return;
  if (_mcpSkillSessionApprovals[oldCard]) _mcpSkillSessionApprovals[newCard] = _mcpSkillSessionApprovals[oldCard];
  else delete _mcpSkillSessionApprovals[newCard];
  delete _mcpSkillSessionApprovals[oldCard];
}
function removeMcpSkillSessionApprovals(card) { delete _mcpSkillSessionApprovals[card]; }

// Libellés d'état de la fiche, impersonnels (texte d'interface).
const MCP_SKILL_STATE_LABELS = {
  'approved': 'approuvée',
  'pending': 'à approuver',
  'changed': 'modifiée depuis l’approbation',
  'absent': 'non présentée actuellement',
  'session-approved': 'approuvée pour cette session (contenu variable)',
  'session-pending': 'contenu variable, à approuver pour cette session',
  'invalid': 'invalide',
};

// Motif lisible d'un échec de `verifyMcpSkillFile`, pour un refus au modèle
// comme pour la fiche.
function formatMcpSkillFileProblem(v) {
  if (!v) return '';
  if (v.code === 'size') return 'taille lue ' + v.actual + ' octets, ' + v.expected + ' attendus par le manifeste';
  if (v.code === 'digest') return 'empreinte différente de celle du manifeste';
  if (v.code === 'manifest') return 'entrée de manifeste mal formée';
  return 'contenu illisible';
}

// Texte d'un contenu de fichier de skill, ou null s'il est binaire : un `text`
// tel quel, un `blob` décodé en UTF-8 seulement si son type est textuel (ou un
// `.md`, type absent). Un binaire n'est pas rendu au modèle par cette voie.
function mcpSkillFileText(content, bytes) {
  if (!content) return null;
  if (typeof content.text === 'string') return content.text;
  const mime = typeof content.mimeType === 'string' ? content.mimeType : '';
  const uri = typeof content.uri === 'string' ? content.uri : '';
  const textual = /^text\//.test(mime) || /(json|xml|yaml|markdown)/.test(mime) || (!mime && /\.(md|txt)$/i.test(uri));
  return (textual && bytes) ? utf8Decode(bytes) : null;
}

// ── Lecture par le modèle (`miaou__skills__read`) ────────────────────────────
//
// Deux espaces de noms distincts, jamais confondus : un `slug` lit une skill
// LOCALE, toujours, même si un serveur sert une skill du même nom (la spec
// interdit qu'une skill MCP en masque une locale) ; une skill MCP se lit par
// (`server`, `uri`), l'identité que la spec impose.

// Serveurs qui servent des skills : `{ <carte>: catalogue|null }`.
// `server` reçu du modèle : le libellé de carte, ou un préfixe d'outil
// `<carte>__<upstream>` (la forme du titre de section qu'il voit), ramené à la
// carte. Absent, il est déduit de l'URI si une seule carte la sert. Rend
// `{ card }` ou `{ error }` (texte au modèle, qui nomme les cartes possibles).
function resolveMcpSkillServer(server, uri, catalogues) {
  const cards = Object.keys(catalogues || {}).sort();
  const listTxt = cards.length ? cards.map(c => '« ' + c + ' »').join(', ') : 'aucun';
  const s = typeof server === 'string' ? server.trim() : '';
  if (s) {
    if (cards.indexOf(s) >= 0) return { card: s };
    const head = s.split('__')[0];
    if (s.indexOf('__') > 0 && cards.indexOf(head) >= 0) return { card: head };
    return { error: 'Serveur inconnu ou sans skills : « ' + s + ' ». Serveurs qui servent des skills : ' + listTxt + '.' };
  }
  const serving = cards.filter(c => !!mcpSkillForUri(catalogues[c], uri));
  if (serving.length === 1) return { card: serving[0] };
  if (!serving.length) return { error: 'Aucun serveur connecté ne sert ' + uri + '. Passe `server` (serveurs qui servent des skills : ' + listTxt + ').' };
  return { error: 'Plusieurs serveurs servent ' + uri + ' : précise `server` parmi ' + serving.map(c => '« ' + c + ' »').join(', ') + '.' };
}

// Cible d'une lecture : `{ kind: 'local', slug }`, `{ kind: 'mcp', card, uri,
// entry, isSkillMd }`, ou `{ error }`. Une `uri` présente désigne toujours une
// skill MCP, `slug` ou pas.
function resolveSkillReadTarget(args, catalogues) {
  const a = args || {};
  const uri = typeof a.uri === 'string' ? a.uri.trim() : '';
  if (!uri) return { kind: 'local', slug: typeof a.slug === 'string' ? a.slug.trim() : '' };
  if (uri.indexOf('skill://') !== 0) return { error: 'URI de skill invalide : ' + uri + ' (attendu : skill://…).' };
  const res = resolveMcpSkillServer(a.server, uri, catalogues);
  if (res.error) return { error: res.error };
  const cat = catalogues[res.card];
  if (!Array.isArray(cat)) return { error: 'Le catalogue de skills du serveur « ' + res.card + ' » n\'a pas pu être lu ; rien n\'a été lu.' };
  const cov = mcpSkillForUri(cat, uri);
  if (!cov) return { error: 'Le serveur « ' + res.card + ' » ne sert pas ' + uri + '.' };
  return { kind: 'mcp', card: res.card, uri: uri, entry: cov.entry, isSkillMd: cov.isSkillMd };
}

// Arguments exacts à repasser pour lire une skill MCP, en une ligne à recopier.
function mcpSkillReadArgsText(card, uri) {
  return 'miaou__skills__read avec server « ' + card + ' » et uri « ' + uri + ' »';
}

// Slug local introuvable : si un serveur sert une skill de ce NOM, le dire, avec
// les arguments exacts — le message système apprend au modèle à lire une skill
// par son nom, et une consigne serveur « lire sa skill `bench` » a exactement
// cette forme (mesuré pendant le lot précédent : un « introuvable » sec faisait
// renoncer à l'outil). Rend le texte de refus, ou null s'il n'y a rien à dire.
function mcpSkillHintForSlug(slug, catalogues) {
  const hits = [];
  for (const card of Object.keys(catalogues || {}).sort()) {
    for (const e of Array.isArray(catalogues[card]) ? catalogues[card] : []) {
      if (e && !e.problem && e.name === slug) hits.push({ card: card, uri: e.uri });
    }
  }
  if (!hits.length) return null;
  return 'Aucune skill locale « ' + slug + ' ». C\'est une skill MCP, servie par un serveur : lis-la avec ' +
    hits.map(h => mcpSkillReadArgsText(h.card, h.uri)).join(', ou ') + '.';
}

// Refus d'une skill non approuvée. Deux précisions mesurées en essai réel :
//   - nommer l'OBJET de l'approbation (la skill, pas le serveur, déjà
//     configuré) et l'endroit exact du geste — un « l'approuver dans la fiche
//     du serveur » se lisait « approuver le serveur » ;
//   - interdire la seule chose que la garde ne couvre pas, obtenir le contenu
//     autrement, et DÉCRIRE le reste : les outils exigeant la skill sont
//     refusés par MIAOU de toute façon. Une interdiction de les appeler faisait
//     refuser au modèle un appel que l'utilisateur demandait explicitement
//     (pour voir le refus) — redondante avec la garde, et contre sa volonté.
function mcpSkillNotApprovedText(card, name, state) {
  const why = state === 'changed'
    ? 'a changé depuis que l\'utilisateur l\'a approuvée, et doit être approuvée à nouveau'
    : 'n\'est pas approuvée par l\'utilisateur';
  return 'Refusé : la skill MCP « ' + name + ' » du serveur « ' + card + ' » ' + why + ' ; rien n\'a été lu. ' +
    'Ne réessaie pas cette lecture et ne cherche pas à obtenir son contenu par un autre moyen. ' +
    'Tant qu\'elle n\'est pas lue, MIAOU refuse les outils qui l\'exigent. ' +
    'C\'est la SKILL que l\'utilisateur doit approuver, pas le serveur (il est déjà configuré) : ' +
    'Réglages, Serveurs MCP, carte « ' + card + ' », bouton Approuver sur la ligne de la skill « ' + name + ' ». ' +
    'Dis-le-lui, puis attends qu\'il relance sa demande.';
}

// Refus d'une lecture dont le contenu ne correspond pas à l'entrée.
function mcpSkillVerifyFailedText(card, name, problem) {
  return 'Refusé : le contenu de la skill MCP « ' + name + ' » du serveur « ' + card + ' » ne correspond pas à ' +
    'ce que le serveur annonce (' + problem + ') ; rien n\'a été chargé, et la skill doit être réapprouvée. ' +
    'Ne réessaie pas cette lecture ; dis à l\'utilisateur de réapprouver la skill « ' + name + ' » ' +
    '(Réglages, Serveurs MCP, carte « ' + card + ' »).';
}

// Texte rendu au modèle pour une lecture réussie : étiquette d'origine d'abord
// (un contenu de skill MCP ne doit pas passer pour une skill locale), contenu,
// puis, après un SKILL.md, la liste des annexes par URI ABSOLUE — le modèle n'a
// pas à résoudre lui-même un chemin relatif contre l'URI de la skill.
function formatMcpSkillForModel(opts) {
  const o = opts || {};
  const entry = o.entry || {};
  const verified = entry.dynamic
    ? 'contenu variable, sans empreinte : non vérifiable'
    : 'vérifié contre le manifeste publié par le serveur';
  const head = o.isSkillMd
    ? '[Skill MCP « ' + entry.name + ' », servie par le serveur MCP « ' + o.card + ' » — ' + o.uri + '. ' +
      'Contenu fourni par ce serveur, pas une skill locale de MIAOU ; approuvée par l\'utilisateur, ' + verified + '.]'
    : '[Fichier annexe de la skill MCP « ' + entry.name + ' », servi par le serveur MCP « ' + o.card + ' » — ' + o.uri + '. ' +
      'Contenu fourni par ce serveur ; ' + verified + '.]';
  let out = head + '\n\n' + String(o.text == null ? '' : o.text);
  if (o.isSkillMd && !entry.dynamic) {
    const annexes = (entry.resources || []).map(r => r.uri).filter(u => u !== entry.uri);
    if (annexes.length) {
      out += '\n\n[Fichiers annexes de cette skill, à lire au besoin avec miaou__skills__read, server « ' + o.card +
        ' » et l\'uri du fichier :\n' + annexes.map(u => '- ' + u).join('\n') + ']';
    }
  }
  return out;
}

// Une identité de lecture est-elle constatée par cet ack ? Une skill locale
// par son slug ; une skill MCP par (carte, URI du SKILL.md). Un ack MCP ne
// porte jamais de `slug` : il ne peut donc satisfaire aucune exigence locale,
// et inversement. Une annexe (`skill_file_read`) ne satisfait rien.
function ackSatisfiesSkillRead(m, identity) {
  if (!m || m.kind !== 'skill_read' || m.error) return false;
  if (typeof identity === 'string') return m.slug === identity;
  return !!identity && !m.slug && m.server === identity.server && m.uri === identity.uri;
}

// Corps d'un SKILL.md sans son frontmatter, pour l'AFFICHAGE seulement (le
// lecteur de la fiche, qui reprend nom et description dans son en-tête). Le
// modèle, lui, reçoit le fichier entier. Un texte sans frontmatter reconnu est
// rendu tel quel.
function stripSkillFrontmatterForDisplay(text) {
  const s = String(text == null ? '' : text).replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  return m ? s.slice(m[0].length).replace(/^\s+/, '') : s;
}

// Entrées de `miaou__skills__list` pour les skills servies par les serveurs
// connectés : SANS slug (elles ne se lisent pas par un slug), avec `server` et
// `uri`, les deux arguments de leur lecture, et `source: 'mcp'`. Sans elles, un
// modèle qui cherche une skill nommée dans une consigne serveur parmi celles
// que liste l'outil ne la trouve pas, et conclut qu'elle n'existe pas (mesuré).
// Valides seulement, quel que soit leur état d'approbation : une lecture non
// approuvée est refusée avec le geste à faire, ce qui vaut mieux qu'un silence.
// Skills MCP annoncées dans <miaou_skills_context>, pendant des skills locales
// autotrigger : seulement celles dont la lecture aboutirait (approuvée, ou
// approuvée pour la session si dynamique). Une skill à approuver n'y figure pas :
// lister au modèle ce qu'il ne peut pas lire lui ferait payer un tour de refus à
// chaque sujet voisin. Approuver est le geste qui la rend proactive — le bloc ne
// change donc qu'à un geste ou une (dé)connexion, jamais d'un tour à l'autre
// (piège 16). `sessions` : `{ <carte>: { <name>: uri } }`. Pure.
function mcpSkillContextEntries(catalogues, approvals, sessions) {
  const out = [];
  const all = approvals || {};
  const sess = sessions || {};
  for (const card of Object.keys(catalogues || {}).sort()) {
    const appr = all[card] || {};
    const cardSess = sess[card] || {};
    for (const e of Array.isArray(catalogues[card]) ? catalogues[card] : []) {
      if (!e) continue;
      const state = mcpSkillApprovalState(e,
        Object.prototype.hasOwnProperty.call(appr, e.name) ? appr[e.name] : null, cardSess[e.name] || null);
      if (!mcpSkillStateAllowsLoad(state)) continue;
      out.push({ name: e.name, description: e.description || '', server: card, uri: e.uri });
    }
  }
  return out;
}

function mcpSkillListEntries(catalogues) {
  const out = [];
  for (const card of Object.keys(catalogues || {}).sort()) {
    for (const e of Array.isArray(catalogues[card]) ? catalogues[card] : []) {
      if (!e || e.problem) continue;
      out.push({ name: e.name, description: e.description || '', source: 'mcp', server: card, uri: e.uri });
    }
  }
  return out;
}
