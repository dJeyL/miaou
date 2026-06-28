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

// ── Codec base64 (hand-rolled, sans atob/btoa — QuickJS-testable) ──────────

const _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0,
          b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += _B64[b0 >> 2];
    out += _B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += (i + 1 < bytes.length) ? _B64[((b1 & 0xf) << 2) | (b2 >> 6)] : '=';
    out += (i + 2 < bytes.length) ? _B64[b2 & 0x3f] : '=';
  }
  return out;
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

// ── IDB layer (navigateur uniquement — non QuickJS-testable) ─────────────────
// Transaction discipline : un seul await par opération, uniquement sur des
// requêtes IDB (pas de fetch ni de Promise étrangère dans une transaction).

let _resourceDbPromise = null;
let _persistenceRequested = false;

function openResourceDB() {
  if (_resourceDbPromise) return _resourceDbPromise;
  _resourceDbPromise = new Promise(function(resolve, reject) {
    const req = indexedDB.open('miaou', 1);
    req.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('resources')) {
        const store = db.createObjectStore('resources', { keyPath: 'id' });
        store.createIndex('by_conversation', 'conversationId', { unique: false });
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

// ── Opérations haut-niveau ────────────────────────────────────────────────────

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
async function internResourcesFromResult(result, conversationId, now, rand) {
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
        // Texte/JSON : stocker en IDB pour le re-rendu au rechargement, mais passer
        // le texte brut au modèle (pas de ref — fiable sans dépendance au cache session).
        await _storeBlock(r.mimeType || 'text/plain', name,
          utf8Encode(r.text), 'inline', conversationId, theNow, theRand);
        newContent.push({ type: 'text', text: r.text });
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
