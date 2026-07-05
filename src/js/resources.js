/* ── resources.js ────────────────────────────────────────────────────────────
   Stockage hybride de ressources (binaires et textuelles) issues des outils MCP.
   Deux sections :
   1. Helpers purs (QuickJS-testables, dépendances injectées).
   2. Couche IDB (navigateur uniquement) + cache de session + opérations haut-niveau.
   ──────────────────────────────────────────────────────────────────────────── */

// ── Helpers purs (QuickJS-testables) ─────────────────────────────────────────

// Classe d'une ressource selon son MIME : « inline » (texte/JSON réinjecté au
// modèle à chaque tour) ou « binary » (seul un descripteur parvient au modèle).
// Inline set : text/* et application/json. Tout le reste → binary.
function classifyMime(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (m === 'application/json') return 'inline';
  if (m.startsWith('text/')) return 'inline';
  return 'binary';
}

// Taille lisible en anglais. Aucune dépendance Intl (testable sous QuickJS).
function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(1) + ' GB';
}

// Descripteur statique envoyé au modèle pour les ressources binaires.
// Déterministe, SANS composante temporelle (le modèle infère l'ancienneté via
// le prefixe stampTs, et on ne veut pas casser le KV cache).
function formatResourceDescriptor(rec) {
  return '[resource id=' + rec.id + ' mime=' + rec.mime +
    ' name="' + (rec.name || '') + '" size=' + humanSize(rec.size) + ']';
}

// Génère un identifiant de ressource depuis un `rand` injecté (testable).
function generateResourceId(rand) {
  return 'res_' + Math.floor((typeof rand === 'function' ? rand() : Math.random()) * 1e12).toString(36);
}

// ── Pièces jointes (composer) — helpers purs (QuickJS-testables) ────────────
// D1 (brief A) : classification kind + allocation d'id conversation-scopée.
// Constantes ajustables regroupées ici, en un seul endroit.

// Extensions → 'text' (contenu lisible, injectable tel quel). Liste fermée,
// ajustable : txt/md/csv/log + extensions de code source courantes.
const ATTACHMENT_TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'csv', 'log', 'json', 'yaml', 'yml', 'xml', 'ini', 'toml',
  'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp',
  'cs', 'php', 'sh', 'bash', 'sql', 'html', 'css', 'scss', 'vue', 'swift', 'kt',
];

// Classe une pièce jointe selon son mime et/ou son extension de fichier.
// Priorité : mime image/* → 'image' ; sinon extension dans la liste texte →
// 'text' ; sinon 'binary'. Pure, ne dépend pas du contenu du fichier (le cap
// 200 kB texte→binary est appliqué séparément, après lecture — cf. D3).
function classifyAttachmentKind(name, mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (m.startsWith('image/')) return 'image';
  const dot = String(name || '').lastIndexOf('.');
  const ext = dot >= 0 ? String(name).slice(dot + 1).toLowerCase() : '';
  if (ATTACHMENT_TEXT_EXTENSIONS.indexOf(ext) >= 0) return 'text';
  return 'binary';
}

// Alloue le prochain attId conversation-scopé, séquentiel (att-1, att-2, …).
// Reçoit le compteur courant (persisté sur la conversation, `conv.attSeq`,
// jamais réinitialisé/décrémenté même après troncature par édition — les
// enregistrements IDB orphelins restent, cf. piège 12 / non-goal du brief).
// Pure : ne touche à aucun stockage, l'appelant persiste `nextCounter`.
function allocateAttId(counter) {
  const n = (Number(counter) || 0) + 1;
  return { id: 'att-' + n, counter: n };
}

// ── Pièces jointes (composer) — envoi au modèle et politique de persistance
// (LOT 2, brief A / D2-D3-D5) ────────────────────────────────────────────────
// Descripteur BYTE-STABLE d'une image jointe, calculé UNE FOIS depuis les
// champs FIGÉS du schéma attachment (name, w, h, size) — jamais recalculé
// depuis les octets. Format exact acté (le brief écrit `present_resource`,
// collision de nom avec l'outil existant res_… — décision : nom distinct
// `miaou__recall_attachment`, cf. audit/brief lot 2) :
//   [attachment att-3: image "diagram.png", 1280x960, 214 kB — content available via miaou__recall_attachment]
// Réutilise humanSize (déjà en usage pour les ressources) plutôt que d'ajouter
// un second formateur de taille : son rendu ("1.5 KB", majuscules, un point)
// diverge du style de l'exemple du brief ("214 kB", k minuscule) — écart
// assumé et signalé (cf. rapport de lot), pas de reformattage ad hoc ici.
function formatAttachmentDescriptor(att) {
  return '[attachment ' + att.attId + ': image "' + (att.name || '') + '", ' +
    att.w + 'x' + att.h + ', ' + humanSize(att.size) +
    ' — content available via miaou__recall_attachment]';
}

// Bloc texte injecté pour un attachment kind:'text' (D3) : fence avec en-tête
// nom de fichier, PERSISTÉ TEL QUEL (pas de descripteur, pas de rewrite
// ultérieur — texte cheap, KV cache préservé). `text` = contenu déjà décodé
// (UTF-8) du fichier.
function formatTextAttachmentBlock(att, text) {
  return '[attachment ' + att.attId + ': file "' + (att.name || '') + '"]\n' +
    '```\n' + String(text || '') + '\n```';
}

// Descripteur pour un attachment kind:'binary' (brief H) : GÉNÉRIQUE (émis pour
// tout binaire, pas seulement les types qu'un serveur MCP docs sait ouvrir),
// dérivé des champs FIGÉS du schéma (attId, name, mime, size) — jamais des
// octets, aucun timestamp (invariant #2, piège #17 CLAUDE.md) → byte-stable
// tour d'attache == tours suivants. Note NEUTRE (ne mentionne aucun outil) :
// c'est docsDoctrinePrompt() (tools.js), conditionnelle, qui porte le « comment »
// — un binaire non-docx et un serveur docs absent doivent produire un
// descripteur STRICTEMENT identique, aucune branche ici.
function formatBinaryAttachmentDescriptor(att) {
  return '[attachment ' + att.attId + ': file "' + (att.name || '') + '", ' +
    (att.mime || 'application/octet-stream') + ', ' + humanSize(att.size) +
    ' — binary content, not inlined]';
}

// Construit le CONTENU du message user au tour d'attache (D2/D3/H) : texte
// tapé + blocs texte injectés (fence, D3) + descripteurs binaires (H) forment
// la partie 'text' ; chaque attachment kind:'image' devient une part
// 'image_url' distincte (content parts OpenAI). `textAttachments` :
// [{att, text}] déjà lus (D3, appelant fournit le texte décodé).
// `imageAttachments` : [{att, dataUrl}] — dataUrl déjà préparée par l'appelant
// (base64 + mime, cf. arrayBufferToBase64) : pure, ne touche à aucun
// stockage/cache ici. `binaryAttachments` (brief H) : [att] — pas de contenu à
// lire (aucun octet envoyé), un binaire n'a pas de phase content-parts : son
// descripteur est stable dès ce tour, comme le texte D3 (pas de rewrite
// ultérieur pour lui, cf. collapseAttachedMessageContent qui le régénère à
// l'identique par idempotence de format, pas par rewrite réel).
// Retourne soit une string (aucune image jointe : pas de content parts inutiles,
// un message texte simple reste un message texte simple) soit un tableau de
// content parts `[{type:'text',text},{type:'image_url',image_url:{url}}, …]`.
function buildAttachedMessageContent(literalText, textAttachments, imageAttachments, binaryAttachments) {
  const blocks = [String(literalText || '')];
  for (const ta of (textAttachments || [])) {
    blocks.push(formatTextAttachmentBlock(ta.att, ta.text));
  }
  for (const att of (binaryAttachments || [])) {
    blocks.push(formatBinaryAttachmentDescriptor(att));
  }
  const textPart = blocks.join('\n\n');
  if (!imageAttachments || !imageAttachments.length) return textPart;
  const parts = [{ type: 'text', text: textPart }];
  for (const ia of imageAttachments) {
    parts.push({ type: 'image_url', image_url: { url: ia.dataUrl } });
  }
  return parts;
}

// Préfixe du texte dynamique (skills context + <miaou_context>, main.js
// dispatchSend) DANS un tableau de content parts : insère dans la première
// part 'text' existante (préfixée), ou crée une part 'text' en tête si aucune
// n'existe (cas dégénéré : un message tout-images sans texte tapé). Les autres
// parts (image_url) sont conservées telles quelles, dans leur ordre. Pure,
// ne mute pas le tableau reçu.
function prefixTextInContentParts(parts, prefix) {
  const out = parts.map(p => Object.assign({}, p));
  const firstTextIdx = out.findIndex(p => p && p.type === 'text');
  if (firstTextIdx >= 0) {
    out[firstTextIdx].text = prefix + (out[firstTextIdx].text || '');
  } else {
    out.unshift({ type: 'text', text: prefix });
  }
  return out;
}

// Réécriture UNIQUE parts→descripteur (D2, politique de persistance) : un
// message user dont `content` est un tableau de content parts (tour d'attache)
// est collapsé en une string finale = la ou les parts texte concaténées + une
// ligne de descripteur PAR image attachment (dans l'ordre des attachments
// kind:'image' du message, pas dans l'ordre des parts — le descripteur est
// dérivé du schéma `attachments`, jamais des octets image_url eux-mêmes).
// IDEMPOTENTE : si `content` est déjà une string, renvoyée telle quelle (garde
// contre un rejeu de la réécriture, cf. chemin abort). Pure : ne mute rien,
// l'appelant réassigne `msg.content`.
// Un binaire (brief H) n'a pas de phase content-parts (aucun octet en
// image_url) : son descripteur vit dans la part 'text' de `content` dès
// buildAttachedMessageContent et voyage donc DÉJÀ dans `textParts` ci-dessous
// — rien à ajouter ici pour lui (contrairement à l'image, qui doit regagner
// son descripteur puisque sa part image_url, elle, est droppée au collapse).
function collapseAttachedMessageContent(content, attachments) {
  if (typeof content === 'string') return content;   // déjà réécrit : no-op
  if (!Array.isArray(content)) return content;
  const textParts = content.filter(p => p && p.type === 'text').map(p => p.text || '');
  const text = textParts.join('\n\n');
  const imgAtts = (attachments || []).filter(a => a && a.kind === 'image');
  const descriptors = imgAtts.map(formatAttachmentDescriptor);
  return descriptors.length ? (text + '\n\n' + descriptors.join('\n')) : text;
}

// ── Codec base64 (hand-rolled, sans atob/btoa — QuickJS-testable) ──────────

const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
  // Accumulation par morceaux + join : la concaténation de string caractère par
  // caractère est quadratique en pratique sur les gros buffers (images de
  // plusieurs Mo) ; ici chaque quantum de 3 octets produit UNE entrée de
  // tableau, aplatie en une seule passe.
  const out = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0,
          b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out.push(
      _B64[b0 >> 2] +
      _B64[((b0 & 3) << 4) | (b1 >> 4)] +
      ((i + 1 < bytes.length) ? _B64[((b1 & 0xf) << 2) | (b2 >> 6)] : '=') +
      ((i + 2 < bytes.length) ? _B64[b2 & 0x3f] : '=')
    );
  }
  return out.join('');
}

function base64ToArrayBuffer(b64) {
  const s = String(b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  const len = Math.floor(s.length * 3 / 4) - pad;
  const buf = new ArrayBuffer(len);
  const bytes = new Uint8Array(buf);
  // table de décodage
  const tbl = {};
  for (let i = 0; i < _B64.length; i++) tbl[_B64[i]] = i;
  let idx = 0;
  for (let i = 0; i < s.length; i += 4) {
    const n = ((tbl[s[i]] || 0) << 18) | ((tbl[s[i + 1]] || 0) << 12) |
              ((tbl[s[i + 2]] || 0) << 6) | (tbl[s[i + 3]] || 0);
    if (idx < len) bytes[idx++] = (n >> 16) & 0xff;
    if (idx < len) bytes[idx++] = (n >> 8) & 0xff;
    if (idx < len) bytes[idx++] = n & 0xff;
  }
  return buf;
}

// ── Codec UTF-8 (hand-rolled, sans TextEncoder/TextDecoder — QuickJS-testable)

function utf8Encode(str) {
  const s = String(str == null ? '' : str);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1);
      if (lo >= 0xDC00 && lo <= 0xDFFF) { cp = 0x10000 + (cp - 0xD800) * 0x400 + (lo - 0xDC00); i++; }
    }
    if (cp < 0x80) {
      bytes.push(cp);
    } else if (cp < 0x800) {
      bytes.push(0xC0 | (cp >> 6), 0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      bytes.push(0xE0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    } else {
      bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F),
                 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    }
  }
  const ab = new ArrayBuffer(bytes.length);
  const arr = new Uint8Array(ab);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes[i];
  return ab;
}

function utf8Decode(buf) {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp;
    if (b < 0x80) { cp = b; i++; }
    else if ((b & 0xE0) === 0xC0) { cp = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F); i += 2; }
    else if ((b & 0xF0) === 0xE0) {
      cp = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F); i += 3;
    } else {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) |
           ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F); i += 4;
    }
    if (cp >= 0x10000) {
      cp -= 0x10000;
      s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
    } else {
      s += String.fromCharCode(cp);
    }
  }
  return s;
}

// ── Partitionnement d'un résultat MCP (helper pur, QuickJS-testable) ─────────
// Retourne un tableau de parts : { action, block, mime?, name?, text?, fromBase64? }
// action : 'store_binary' | 'store_inline' | 'passthrough'
//
// DÉCISION FLAGGÉE (cf. brief §5 decision note) :
// Les blocs {type:"text"} sont laissés en passthrough en V1 (seuil conservatif).
// Seuls les blocs resource (avec .text ou .blob) et image/audio sont stockés.
// Le seuil agressif (tout text→store) est déféré.
function extractResultParts(mcpResult) {
  const parts = [];
  const content = (mcpResult && Array.isArray(mcpResult.content)) ? mcpResult.content : [];
  for (const block of content) {
    if (!block) { parts.push({ action: 'passthrough', block }); continue; }

    if (block.type === 'image' && block.data) {
      parts.push({ action: 'store_binary', block,
        mime: block.mimeType || 'image/png', name: 'image', fromBase64: block.data });
    } else if (block.type === 'audio' && block.data) {
      parts.push({ action: 'store_binary', block,
        mime: block.mimeType || 'audio/mpeg', name: 'audio', fromBase64: block.data });
    } else if (block.type === 'resource') {
      const r = block.resource || {};
      const name = (r.uri && r.uri.split('/').pop()) || 'resource';
      if (r.blob != null) {
        parts.push({ action: 'store_binary', block,
          mime: r.mimeType || 'application/octet-stream', name, fromBase64: r.blob });
      } else if (r.text != null) {
        parts.push({ action: 'store_inline', block,
          mime: r.mimeType || 'text/plain', name, text: r.text });
      } else {
        parts.push({ action: 'passthrough', block });
      }
    } else {
      // {type:'text'}, {type:'resource_link'}, inconnu → passthrough
      parts.push({ action: 'passthrough', block });
    }
  }
  return parts;
}

// ── Session cache ─────────────────────────────────────────────────────────────
// Stocke les enregistrements IDB complets en mémoire pour accès synchrone.
// Peuplé au chargement d'une conversation (loadConversationResources) et à chaque
// putResource. L'ArrayBuffer data y est directement accessible pour utf8Decode et
// arrayBufferToBase64 (present_resource synchrone).

let _resourceCache = {};

function getCachedRecord(id) { return _resourceCache[id] || null; }
function _cacheRecord(rec) { _resourceCache[rec.id] = rec; }
function _uncacheRecord(id) { delete _resourceCache[id]; }
function clearResourceSessionCache() { _resourceCache = {}; }

// Lookup par attId (conversation-scoped), pour le rendu des vignettes de la
// bulle utilisateur (fallback gracieux si le blob n'est pas/plus en cache —
// conversation pas encore rechargée, ou entrée orpheline après édition).
// Scan linéaire du cache session : nombre d'attachments par conversation
// toujours petit (cap 4 images/message), pas besoin d'un second index.
function getCachedRecordByAttId(attId, conversationId) {
  for (const key in _resourceCache) {
    const rec = _resourceCache[key];
    if (rec && rec.attId === attId && (!conversationId || rec.conversationId === conversationId)) return rec;
  }
  return null;
}

// ── Helpers de référence ──────────────────────────────────────────────────────
// Format : "[resource_ref:res_xyz]" — détectable par regex, ne contient pas de ]
// dans l'id car base36 n'utilise pas ce caractère.

function _makeResourceRef(id) { return '[resource_ref:' + id + ']'; }

// Substitue tous les [resource_ref:…] dans une chaîne par leur contenu réel.
// Inline → UTF-8 decode ; binary → descripteur statique. Synchrone (session cache).
// Byte-identique d'un tour à l'autre car le contenu est figé à la création.
function assembleToolResultForModel(resultStr) {
  if (!resultStr || typeof resultStr !== 'string') return resultStr || '';
  return resultStr.replace(/\[resource_ref:([^\]]+)\]/g, function(match, id) {
    const rec = getCachedRecord(id);
    if (!rec) return '[resource not available: ' + id + ']';
    if (rec.class === 'inline') return utf8Decode(rec.data);
    return formatResourceDescriptor({ id: rec.id, mime: rec.mime, name: rec.name, size: rec.size });
  });
}

// Pre-pass sur currentThread : résout les refs dans entry.result avant expandThread.
// Produit une copie shallow du thread avec les refs expansées — ne mute pas currentThread.
// Utilisé dans dispatchSend. isAckRole est défini dans utils.js (chargé avant).
function resolveResourceRefs(thread) {
  return thread.map(function(m) {
    if (!isAckRole(m.role) || m.result == null) return m;
    const s = String(m.result);
    if (s.indexOf('[resource_ref:') < 0) return m;
    const resolved = assembleToolResultForModel(s);
    if (resolved === s) return m;
    return Object.assign({}, m, { result: resolved });
  });
}

// Pre-pass (brief A2 / D3, voie (b)) : pour chaque ack attachment_recalled dont
// le record est une IMAGE, reconstruit la dataUrl base64 depuis le cache session
// et la pose sur une COPIE de l'ack (champ `recallImage`), à charge d'expandThread
// (utils.js, pur) d'émettre le message user synthétique porteur de la part image.
// Reconstruit à chaque envoi depuis le record FIGÉ (byte-stable, cf. piège 17) :
// `recallImage` n'est jamais persisté (absent d'ACK_COPY_FIELDS), seul `attId`
// l'est. Ne mute pas le thread reçu. Un ack dont l'attId n'est plus en cache
// (record purgé) est laissé tel quel : pas de part image → expandThread n'émet
// rien, seul le tool result textuel subsiste (dégradation propre).
function resolveRecallImages(thread) {
  return thread.map(function(m) {
    if (!isAckRole(m.role) || m.kind !== 'attachment_recalled' || !m.attId) return m;
    if (!m.mime || m.mime.indexOf('image/') !== 0) return m;
    const rec = getCachedRecordByAttId(m.attId, m.convId || null);
    if (!rec || !rec.data) return m;
    const dataUrl = 'data:' + rec.mime + ';base64,' + arrayBufferToBase64(rec.data);
    return Object.assign({}, m, { recallImage: dataUrl });
  });
}

// ── IDB layer (navigateur uniquement — non QuickJS-testable) ─────────────────
// Transaction discipline : un seul await par opération, uniquement sur des
// requêtes IDB (pas de fetch ni de Promise étrangère dans une transaction).

let _resourceDbPromise = null;
let _persistenceRequested = false;

function openResourceDB() {
  if (_resourceDbPromise) return _resourceDbPromise;
  _resourceDbPromise = new Promise(function(resolve, reject) {
    // v2 : ajout du store `skills` (cf. skills.js). onupgradeneeded est idempotent
    // (contains-check par store) → migration v1→v2 sans toucher `resources`.
    const req = indexedDB.open('miaou', 2);
    req.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('resources')) {
        const store = db.createObjectStore('resources', { keyPath: 'id' });
        store.createIndex('by_conversation', 'conversationId', { unique: false });
      }
      if (!db.objectStoreNames.contains('skills')) {
        db.createObjectStore('skills', { keyPath: 'slug' });
      }
    };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e.target.error); };
  });
  return _resourceDbPromise;
}

function putResource(record) {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('resources', 'readwrite');
      const req = tx.objectStore('resources').put(record);
      req.onsuccess = function() { resolve(record.id); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

function getResource(id) {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('resources', 'readonly');
      const req = tx.objectStore('resources').get(id);
      req.onsuccess = function(e) { resolve(e.target.result || null); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

function getResourcesByConversation(convId) {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('resources', 'readonly');
      const req = tx.objectStore('resources').index('by_conversation').getAll(convId);
      req.onsuccess = function(e) { resolve(e.target.result || []); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

function deleteResource(id) {
  _uncacheRecord(id);
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('resources', 'readwrite');
      const req = tx.objectStore('resources').delete(id);
      req.onsuccess = function() { resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

function deleteResourcesByConversation(convId) {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('resources', 'readwrite');
      const idx = tx.objectStore('resources').index('by_conversation');
      const req = idx.openCursor(IDBKeyRange.only(convId));
      req.onsuccess = function(e) {
        const cursor = e.target.result;
        if (cursor) { _uncacheRecord(cursor.value.id); cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

function requestPersistence() {
  if (_persistenceRequested) return;
  _persistenceRequested = true;
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(function() {});
  }
}

// Lit tous les enregistrements du store `resources` (méta + data ArrayBuffer).
// Sur le modèle de getAllSkillRecords (skills.js). Utilisé par l'export complet
// (feature E) : l'appelant convertit ensuite `data` en base64.
function getAllResources() {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction('resources', 'readonly');
      const req = tx.objectStore('resources').getAll();
      req.onsuccess = function(e) { resolve(e.target.result || []); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// Vide intégralement un store IDB (skills ou resources). Utilisé par l'import
// complet (feature E, remplacement destructif) avant réinsertion. Générique :
// ne connaît pas le schéma du store, juste son nom.
function clearIdbStore(storeName) {
  return openResourceDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      const tx = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onsuccess = function() { resolve(); };
      tx.onerror = function(e) { reject(e.target.error); };
    });
  });
}

// ── Opérations haut-niveau ────────────────────────────────────────────────────

// Stocke une pièce jointe utilisateur (composer) dans le store IDB `resources`
// existant, avec `conversationId` (GC gratuit via deleteResourcesByConversation)
// ET `attId` (id conversation-scopé, cf. allocateAttId). À la différence de
// _storeBlock : PAS d'ack `resource_stored` — un attachment n'est pas un
// résultat d'outil, rien à annoncer dans le fil. `class` suit `classifyMime`
// (inline pour un texte, binary pour image/binaire) ; `dims` (optionnel,
// {w,h}) pour une image, figées à l'attache (cf. D2, byte-stable au lot 2).
// Retourne l'enregistrement stocké en cas de succès, null sinon.
async function storeAttachment(attId, mime, name, data, cls, conversationId, now, rand, dims) {
  const id = 'att_' + generateResourceId(rand).slice(4);
  const record = {
    id, attId, conversationId: conversationId || null,
    class: cls, mime: String(mime || 'application/octet-stream'),
    name: String(name || 'attachment'), size: data.byteLength,
    createdAt: now, data,
  };
  if (dims && dims.w && dims.h) { record.w = dims.w; record.h = dims.h; }
  try {
    await putResource(record);
    _cacheRecord(record);
    requestPersistence();
    return record;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] storeAttachment:', e && e.message);
    return null;
  }
}

// Stocke un bloc individuel dans IDB + session cache ; pousse l'ack resource_stored.
// Retourne l'id généré en cas de succès, null sinon.
async function _storeBlock(mime, name, data, cls, conversationId, now, rand) {
  const id = generateResourceId(rand);
  const record = {
    id, conversationId: conversationId || null,
    class: cls, mime: String(mime || 'application/octet-stream'),
    name: String(name || 'resource'), size: data.byteLength,
    createdAt: now, data,
  };
  try {
    await putResource(record);
    _cacheRecord(record);
    requestPersistence();
    // _pendingToolAcks est déclaré dans tools.js ; accessible en runtime (même scope).
    _pendingToolAcks.push({ kind: 'resource_stored', id, resourceName: record.name, mime: record.mime, size: record.size });
    return id;
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] _storeBlock:', e && e.message);
    return null;
  }
}

// Intercepte un résultat d'outil MCP brut :
// - resource text/JSON → passe le texte brut au modèle (fiable, sans IDB, sans ref).
// - binaires (image, audio, blob) → stocke en IDB, remplace par une ref + note
//   "présentée" pour que le modèle sache que la ressource est déjà affichée.
// Les blocs D8 restent dans _pendingToolBlocks pour le rendu visuel immédiat.
// Appelé depuis api.js après await callTool, avant flattenToolResult.
async function internResourcesFromResult(result, conversationId, now, rand, saveInline) {
  if (!result || !Array.isArray(result.content)) return;
  const theNow = (typeof now === 'function') ? now() : (now || Date.now());
  const theRand = (typeof rand === 'function') ? rand : Math.random;

  const PRESENTED_NOTE = '\nLa ressource a été présentée à l\'utilisateur dans l\'interface.';
  const newContent = [];

  for (const block of result.content) {
    if (!block) { newContent.push(block); continue; }

    let id = null;

    if (block.type === 'image' && block.data) {
      id = await _storeBlock(block.mimeType || 'image/png', 'image',
        base64ToArrayBuffer(block.data), 'binary', conversationId, theNow, theRand);
    } else if (block.type === 'audio' && block.data) {
      id = await _storeBlock(block.mimeType || 'audio/mpeg', 'audio',
        base64ToArrayBuffer(block.data), 'binary', conversationId, theNow, theRand);
    } else if (block.type === 'resource') {
      const r = block.resource || {};
      const name = (r.uri && r.uri.split('/').pop()) || 'resource';
      if (r.blob != null) {
        id = await _storeBlock(
          r.mimeType || 'application/octet-stream', name,
          base64ToArrayBuffer(r.blob), 'binary', conversationId, theNow, theRand);
      } else if (r.text != null) {
        // Texte/JSON : retire le bloc du queue D8 — pas d'affichage automatique
        // côté UI (vrai quel que soit le réglage).
        if (typeof retainPendingToolBlocks === 'function') {
          retainPendingToolBlocks(b =>
            !(b.type === 'resource' && b.resource != null &&
              b.resource.text != null && b.resource.blob == null));
        }
        if (saveInline) {
          // Stocker en IDB (persistance, accès via present_resource). Le modèle
          // reçoit le contenu brut + le descripteur avec l'ID (pour qu'il puisse
          // appeler present_resource si besoin), sans note « présentée ».
          const storedId = await _storeBlock(r.mimeType || 'text/plain', name,
            utf8Encode(r.text), 'inline', conversationId, theNow, theRand);
          const rec = storedId ? getCachedRecord(storedId) : null;
          const desc = rec ? ('\n' + formatResourceDescriptor(rec)) : '';
          newContent.push({ type: 'text', text: r.text + desc });
        } else {
          // Réglage désactivé : le modèle reçoit le texte brut, sans ressource ni ID.
          newContent.push({ type: 'text', text: r.text });
        }
        continue;
      }
    }
    // {type:'text'} et {type:'resource_link'} → passthrough

    if (id) {
      newContent.push({ type: 'text', text: _makeResourceRef(id) + PRESENTED_NOTE });
    } else {
      newContent.push(block);
    }
  }

  result.content = newContent;
}

// Peuple le session cache depuis IDB pour une conversation donnée.
// Fire-and-forget : appelé dans openConversation, sans await.
async function loadConversationResources(convId) {
  try {
    const records = await getResourcesByConversation(convId);
    for (const rec of records) _cacheRecord(rec);
  } catch (e) {
    if (typeof console !== 'undefined') console.warn('[miaou] loadConversationResources:', e && e.message);
  }
}

// Construit un bloc D8 (format _pendingToolBlocks) depuis un enregistrement en
// session cache. Réutilise les chemins de rendu existants (renderToolBlock).
// Retourne null si le type n'est pas présentable.
function makeResourcePresentBlock(record) {
  if (!record || !record.data) return null;
  if (record.mime && record.mime.startsWith('image/')) {
    return { type: 'image', data: arrayBufferToBase64(record.data), mimeType: record.mime };
  }
  if (record.class === 'inline') {
    return { type: 'resource', resource: { text: utf8Decode(record.data), mimeType: record.mime } };
  }
  // binary non-image → téléchargement
  return { type: 'resource', resource: {
    blob: arrayBufferToBase64(record.data), mimeType: record.mime, uri: record.name,
  }};
}
