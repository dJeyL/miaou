// tests/test-resources.js — helpers purs de resources.js (QuickJS-testables)
// IDB, fetch, navigator.storage : non testés ici (navigateur uniquement).

// ── generateResourceId ────────────────────────────────────────────────────────

describe('generateResourceId', function() {
  it('commence par res_', function() {
    expect(generateResourceId(Math.random).startsWith('res_')).toBeTruthy();
  });
  it('est déterministe avec rand injecté', function() {
    var rand = function() { return 0.5; };
    var a = generateResourceId(rand);
    var b = generateResourceId(rand);
    expect(a).toBe(b);
  });
  it('varie avec des rand différents', function() {
    var a = generateResourceId(function() { return 0.1; });
    var b = generateResourceId(function() { return 0.9; });
    expect(a === b).toBeFalsy();
  });
});

// ── generateFileId (lot Cbis — bibliothèque de fichiers d'espace) ────────────

describe('generateFileId', function() {
  it('commence par file_', function() {
    expect(generateFileId(Math.random).startsWith('file_')).toBeTruthy();
  });
  it('préfixe distinct de generateResourceId et de storeAttachment (att_)', function() {
    var rand = function() { return 0.5; };
    expect(generateFileId(rand).startsWith('res_')).toBeFalsy();
    expect(generateFileId(rand).startsWith('att_')).toBeFalsy();
  });
  it('déterministe avec rand injecté', function() {
    var rand = function() { return 0.5; };
    expect(generateFileId(rand)).toBe(generateFileId(rand));
  });
});

// ── libraryRefFromId / parseLibraryRef (ref modèle file-<id>) ────────────────

describe('libraryRefFromId / parseLibraryRef', function() {
  it('libraryRefFromId : file_<hex> → file-<hex>', function() {
    expect(libraryRefFromId('file_1a2b3c')).toBe('file-1a2b3c');
  });
  it('round-trip : parseLibraryRef(libraryRefFromId(id)) === id', function() {
    var id = 'file_' + 'deadbeef';
    expect(parseLibraryRef(libraryRefFromId(id))).toBe(id);
  });
  it('parseLibraryRef : ref malformée → null', function() {
    expect(parseLibraryRef('att-1')).toBe(null);
    expect(parseLibraryRef('file_abc')).toBe(null);   // underscore, pas tiret
    expect(parseLibraryRef('')).toBe(null);
    expect(parseLibraryRef('bogus')).toBe(null);
  });
});

// ── capFileDescription (D7 — cap longueur description) ───────────────────────

describe('capFileDescription', function() {
  it('description courte → inchangée', function() {
    expect(capFileDescription('Une description courte.')).toBe('Une description courte.');
  });
  it('trim des espaces superflus', function() {
    expect(capFileDescription('  texte  ')).toBe('texte');
  });
  it('description absente/vide → chaîne vide', function() {
    expect(capFileDescription(undefined)).toBe('');
    expect(capFileDescription('')).toBe('');
  });
  it('description trop longue → tronquée avec ellipsis, pas de coupure en plein mot', function() {
    var long = new Array(Math.ceil(FILE_DESCRIPTION_MAX_CHARS / 9) + 20).join('mot long ');
    var capped = capFileDescription(long);
    expect(capped.length <= FILE_DESCRIPTION_MAX_CHARS + 1).toBeTruthy();
    expect(capped.endsWith('…')).toBeTruthy();
    expect(capped.indexOf(' …') === -1).toBeTruthy(); // pas d'espace juste avant l'ellipsis
  });
});

// ── normalizeLibraryRecord (D1 — champs figés du schéma) ─────────────────────

describe('normalizeLibraryRecord', function() {
  it('champs minimaux, sans source/description', function() {
    var r = normalizeLibraryRecord({ id: 'file_a', spaceId: 'space-1', name: 'doc.txt', mime: 'text/plain', size: 100, createdAt: 1000 });
    expect(r.id).toBe('file_a');
    expect(r.spaceId).toBe('space-1');
    expect(r.kind).toBe('library');
    expect(r.name).toBe('doc.txt');
    expect(r.mime).toBe('text/plain');
    expect(r.size).toBe(100);
    expect(r.createdAt).toBe(1000);
    expect('source' in r).toBeFalsy();
    expect('description' in r).toBeFalsy();
  });
  it('source et description présents si fournis', function() {
    var r = normalizeLibraryRecord({ id: 'file_b', spaceId: 's1', name: 'a', mime: 'text/plain', size: 1, createdAt: 1, source: 'conv-1', description: 'Description.' });
    expect(r.source).toBe('conv-1');
    expect(r.description).toBe('Description.');
  });
  it('description passée par capFileDescription', function() {
    var long = new Array(50).join('mot long ');
    var r = normalizeLibraryRecord({ id: 'file_c', spaceId: 's1', name: 'a', mime: 'text/plain', size: 1, createdAt: 1, description: long });
    expect(r.description).toBe(capFileDescription(long));
  });
  it('name/mime par défaut si absents', function() {
    var r = normalizeLibraryRecord({ id: 'file_d', spaceId: 's1', size: 0, createdAt: 1 });
    expect(r.name).toBe('file');
    expect(r.mime).toBe('application/octet-stream');
  });
});

// ── buildLibraryManifestBlock (D4 — manifeste contexte, byte-stable) ─────────

describe('buildLibraryManifestBlock', function() {
  it('bibliothèque vide/absente → chaîne vide, pas de bloc', function() {
    expect(buildLibraryManifestBlock([])).toBe('');
    expect(buildLibraryManifestBlock(null)).toBe('');
    expect(buildLibraryManifestBlock(undefined)).toBe('');
  });
  it('une entrée sans description → intro générique + une ligne file-<id> — name (mime, size)', function() {
    var out = buildLibraryManifestBlock([{ id: 'file_a1', name: 'doc.txt', mime: 'text/plain', size: 1024, createdAt: 1 }]);
    expect(out).toBe('Fichiers disponibles dans cet espace :\nfile-a1 — doc.txt (text/plain, ' + humanSize(1024) + ')');
  });
  it('nom d\'espace fourni → intro le nomme', function() {
    var out = buildLibraryManifestBlock([{ id: 'file_a1', name: 'doc.txt', mime: 'text/plain', size: 1024, createdAt: 1 }], 'Projet X');
    expect(out.split('\n')[0]).toBe('Fichiers disponibles dans l\'espace Projet X :');
  });
  it('une entrée avec description → même ligne (format A4)', function() {
    var out = buildLibraryManifestBlock([{ id: 'file_b2', name: 'rapport.pdf', mime: 'application/pdf', size: 5000, createdAt: 1, description: 'Description du rapport.' }]);
    expect(out.split('\n')[1]).toBe('file-b2 — rapport.pdf (application/pdf, ' + humanSize(5000) + ') — Description du rapport.');
  });
  it('tri déterministe par createdAt puis id', function() {
    var entries = [
      { id: 'file_z', name: 'z.txt', mime: 'text/plain', size: 1, createdAt: 100 },
      { id: 'file_a', name: 'a.txt', mime: 'text/plain', size: 1, createdAt: 50 },
      { id: 'file_m', name: 'm.txt', mime: 'text/plain', size: 1, createdAt: 50 },
    ];
    var out = buildLibraryManifestBlock(entries);
    var lines = out.split('\n');
    expect(lines[1].indexOf('a.txt') >= 0).toBeTruthy();
    expect(lines[2].indexOf('m.txt') >= 0).toBeTruthy();
    expect(lines[3].indexOf('z.txt') >= 0).toBeTruthy();
  });
  it('byte-stabilité : deux appels avec les mêmes entrées produisent le même bloc', function() {
    var entries = [{ id: 'file_x', name: 'x.txt', mime: 'text/plain', size: 10, createdAt: 1, description: 'S.' }];
    expect(buildLibraryManifestBlock(entries)).toBe(buildLibraryManifestBlock(entries));
  });
  it('ne mute pas le tableau reçu (tri sur une copie)', function() {
    var entries = [
      { id: 'file_b', name: 'b', mime: 'text/plain', size: 1, createdAt: 2 },
      { id: 'file_a', name: 'a', mime: 'text/plain', size: 1, createdAt: 1 },
    ];
    buildLibraryManifestBlock(entries);
    expect(entries[0].id).toBe('file_b');
  });
});

// ── humanSize ─────────────────────────────────────────────────────────────────

describe('humanSize', function() {
  it('0 → "0 B"', function() { expect(humanSize(0)).toBe('0 B'); });
  it('512 → "512 B"', function() { expect(humanSize(512)).toBe('512 B'); });
  it('1023 → "1023 B"', function() { expect(humanSize(1023)).toBe('1023 B'); });
  it('1024 → "1.0 KB"', function() { expect(humanSize(1024)).toBe('1.0 KB'); });
  it('1536 → "1.5 KB"', function() { expect(humanSize(1536)).toBe('1.5 KB'); });
  it('1048576 → "1.0 MB"', function() { expect(humanSize(1048576)).toBe('1.0 MB'); });
  it('2415919104 → "2.3 GB"', function() {
    expect(humanSize(2415919104)).toBe('2.3 GB');
  });
});

// ── formatResourceDescriptor ──────────────────────────────────────────────────

describe('formatResourceDescriptor', function() {
  it('produit le bon format', function() {
    var d = formatResourceDescriptor({ id: 'res_abc', mime: 'image/png', name: 'diagram.png', size: 2411724 });
    expect(d).toContain('id=res_abc');
    expect(d).toContain('mime=image/png');
    expect(d).toContain('name="diagram.png"');
    expect(d).toContain('MB');
  });
  it('ne contient aucun contenu temporel relatif', function() {
    var d = formatResourceDescriptor({ id: 'res_x', mime: 'image/png', name: 'x.png', size: 100 });
    expect(d.indexOf('ago')).toBe(-1);
    expect(d.indexOf('hier')).toBe(-1);
    expect(d.indexOf('aujourd')).toBe(-1);
    // ne doit pas contenir d'horodatage absolu non plus (pas de timestamp dans le descripteur)
    expect(d.indexOf('2025')).toBe(-1);
    expect(d.indexOf('2026')).toBe(-1);
  });
});

// ── base64 round-trip ─────────────────────────────────────────────────────────

describe('base64 round-trip', function() {
  function roundTrip(bytes) {
    var ab = new ArrayBuffer(bytes.length);
    var arr = new Uint8Array(ab);
    for (var i = 0; i < bytes.length; i++) arr[i] = bytes[i];
    var b64 = arrayBufferToBase64(ab);
    var back = new Uint8Array(base64ToArrayBuffer(b64));
    if (back.length !== bytes.length) throw new Error('longueur différente : ' + back.length + ' vs ' + bytes.length);
    for (var j = 0; j < bytes.length; j++) {
      if (back[j] !== bytes[j]) throw new Error('octet ' + j + ' différent : ' + back[j] + ' vs ' + bytes[j]);
    }
  }

  it('tableau vide', function() { roundTrip([]); });
  it('1 octet (0x00)', function() { roundTrip([0x00]); });
  it('2 octets (0x00 0xFF)', function() { roundTrip([0x00, 0xFF]); });
  it('3 octets (0x00 0x01 0xFF)', function() { roundTrip([0x00, 0x01, 0xFF]); });
  it('4 octets (frontière padding)', function() { roundTrip([0x01, 0x02, 0x03, 0x04]); });
  it('padding 1 (2 octets)', function() { roundTrip([0xAB, 0xCD]); });
  it('padding 2 (1 octet)', function() { roundTrip([0xFF]); });
  it('séquence 0x00/0xFF alternée (8 octets)', function() {
    roundTrip([0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x00, 0xFF]);
  });
  it('séquence 0x00 à 0x0F', function() {
    roundTrip([0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]);
  });
});

// ── utf8 encode/decode round-trip ─────────────────────────────────────────────

describe('utf8 round-trip', function() {
  function trip(s) {
    var encoded = utf8Encode(s);
    var decoded = utf8Decode(encoded);
    if (decoded !== s) throw new Error('attendu ' + JSON.stringify(s) + ', reçu ' + JSON.stringify(decoded));
  }

  it('ASCII simple', function() { trip('hello world'); });
  it('chaîne vide', function() { trip(''); });
  it('accents (é à ü)', function() { trip('café naïf über'); });
  it('JSON', function() { trip('{"clé": "valeur", "n": 42}'); });
  it('emoji', function() { trip('🎉 😀 🌍'); });
  it('mixte ASCII + accents + emoji', function() { trip('Bonjour 🌟 vous avez été choisi'); });
  it('caractères CJK', function() { trip('你好世界'); });
  it('null byte (U+0000)', function() { trip(String.fromCharCode(0)); });
});

// ── _isTextualMime ───────────────────────────────────────────────────────────

describe('_isTextualMime', function() {
  it('text/plain → true', function() {
    expect(_isTextualMime('text/plain')).toBe(true);
  });

  it('text/csv → true', function() {
    expect(_isTextualMime('text/csv')).toBe(true);
  });

  it('application/json → true (allowlist)', function() {
    expect(_isTextualMime('application/json')).toBe(true);
  });

  it('application/xml → true (allowlist)', function() {
    expect(_isTextualMime('application/xml')).toBe(true);
  });

  it('application/x-ndjson → true (allowlist)', function() {
    expect(_isTextualMime('application/x-ndjson')).toBe(true);
  });

  it('application/csv → true (allowlist)', function() {
    expect(_isTextualMime('application/csv')).toBe(true);
  });

  it('APPLICATION/JSON (casse) → true', function() {
    expect(_isTextualMime('APPLICATION/JSON')).toBe(true);
  });

  it('text/plain; charset=utf-8 → true (suffixe toléré)', function() {
    expect(_isTextualMime('text/plain; charset=utf-8')).toBe(true);
  });

  it('application/pdf → false', function() {
    expect(_isTextualMime('application/pdf')).toBe(false);
  });

  it('image/png → false', function() {
    expect(_isTextualMime('image/png')).toBe(false);
  });

  it('application/octet-stream → false', function() {
    expect(_isTextualMime('application/octet-stream')).toBe(false);
  });

  it('null → false', function() {
    expect(_isTextualMime(null)).toBe(false);
  });

  it('undefined → false', function() {
    expect(_isTextualMime(undefined)).toBe(false);
  });

  it('chaîne vide → false', function() {
    expect(_isTextualMime('')).toBe(false);
  });

  it('garbage non-string → false', function() {
    expect(_isTextualMime(42)).toBe(false);
  });
});

// ── extractResultParts ────────────────────────────────────────────────────────

describe('extractResultParts', function() {
  it('résultat vide → liste vide', function() {
    var p = extractResultParts({});
    expect(p.length).toBe(0);
  });

  it('text-only → passthrough', function() {
    var p = extractResultParts({ content: [{ type: 'text', text: 'bonjour' }] });
    expect(p.length).toBe(1);
    expect(p[0].action).toBe('passthrough');
  });

  it('image base64 → store_binary', function() {
    var p = extractResultParts({
      content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }]
    });
    expect(p.length).toBe(1);
    expect(p[0].action).toBe('store_binary');
    expect(p[0].mime).toBe('image/png');
    expect(p[0].fromBase64).toBe('AAAA');
  });

  it('audio → store_binary', function() {
    var p = extractResultParts({
      content: [{ type: 'audio', data: 'BBBB', mimeType: 'audio/mp3' }]
    });
    expect(p[0].action).toBe('store_binary');
    expect(p[0].mime).toBe('audio/mp3');
  });

  it('resource avec blob → store_binary', function() {
    var p = extractResultParts({
      content: [{ type: 'resource', resource: { blob: 'CCCC', mimeType: 'application/pdf', uri: '/a/doc.pdf' } }]
    });
    expect(p[0].action).toBe('store_binary');
    expect(p[0].mime).toBe('application/pdf');
    expect(p[0].name).toBe('doc.pdf');
    expect(p[0].fromBase64).toBe('CCCC');
    expect(p[0].originUrl).toBe('/a/doc.pdf');   // uri du blob → originUrl (lot K §4.1)
  });

  it('web__fetch_resource (2 blocs) → descripteur passthrough + blob store_binary avec originUrl', function() {
    // Contrat de transfert K-server : [TextContent(descripteur), EmbeddedResource(blob)].
    var p = extractResultParts({
      content: [
        { type: 'text', text: 'Resource transférée au client : application/pdf, 1234 octets, depuis https://ex.com/f.pdf.' },
        { type: 'resource', resource: { blob: 'RAW==', mimeType: 'application/pdf', uri: 'https://ex.com/f.pdf' } },
      ]
    });
    expect(p[0].action).toBe('passthrough');   // le descripteur va au modèle intact
    expect(p[1].action).toBe('store_binary');
    expect(p[1].fromBase64).toBe('RAW==');
    expect(p[1].originUrl).toBe('https://ex.com/f.pdf');
    expect(p[1].name).toBe('f.pdf');
  });

  it('image base64 sans uri → store_binary, originUrl null', function() {
    var p = extractResultParts({
      content: [{ type: 'image', data: 'IMG', mimeType: 'image/png' }]
    });
    expect(p[0].action).toBe('store_binary');
    expect(p[0].originUrl == null).toBe(true);   // pas d'origine web pour une image d'outil
  });

  it('resource avec text JSON → store_inline (IDB) + texte brut au modèle', function() {
    var p = extractResultParts({
      content: [{ type: 'resource', resource: { text: '{"a":1}', mimeType: 'application/json', uri: '/data.json' } }]
    });
    expect(p[0].action).toBe('store_inline');
    expect(p[0].mime).toBe('application/json');
    expect(p[0].text).toBe('{"a":1}');
    expect(p[0].name).toBe('data.json');
  });

  it('resource avec text sans uri → store_inline', function() {
    var p = extractResultParts({
      content: [{ type: 'resource', resource: { text: 'hello', mimeType: 'text/plain' } }]
    });
    expect(p[0].action).toBe('store_inline');
  });

  it('resource_link → passthrough', function() {
    var p = extractResultParts({
      content: [{ type: 'resource_link', uri: 'https://example.com/file' }]
    });
    expect(p[0].action).toBe('passthrough');
  });

  it('mixte : text + image + resource_text', function() {
    var p = extractResultParts({
      content: [
        { type: 'text', text: 'intro' },
        { type: 'image', data: 'IDAT', mimeType: 'image/png' },
        { type: 'resource', resource: { text: '{"result":true}', mimeType: 'application/json' } },
      ]
    });
    expect(p.length).toBe(3);
    expect(p[0].action).toBe('passthrough');
    expect(p[1].action).toBe('store_binary');
    expect(p[2].action).toBe('store_inline');
  });

  it('mime absent sur image → image/png par défaut', function() {
    var p = extractResultParts({ content: [{ type: 'image', data: 'AAAA' }] });
    expect(p[0].mime).toBe('image/png');
  });

  it('resource blob avec mimeType textuel (docs__extract, lot M) → store_inline_from_bytes', function() {
    var p = extractResultParts({
      content: [{ type: 'resource', resource: { blob: 'RVhU', mimeType: 'text/plain', uri: 'data.json' } }]
    });
    expect(p[0].action).toBe('store_inline_from_bytes');
    expect(p[0].mime).toBe('text/plain');
    expect(p[0].name).toBe('data.json');
    expect(p[0].fromBase64).toBe('RVhU');
  });

  it('resource blob avec mimeType application/json → store_inline_from_bytes', function() {
    var p = extractResultParts({
      content: [{ type: 'resource', resource: { blob: 'eyJhIjoxfQ==', mimeType: 'application/json', uri: 'zip-member:att-1/data.json' } }]
    });
    expect(p[0].action).toBe('store_inline_from_bytes');
    expect(p[0].mime).toBe('application/json');
  });

  it('resource blob avec mimeType binaire (application/pdf) → reste store_binary', function() {
    var p = extractResultParts({
      content: [{ type: 'resource', resource: { blob: 'CCCC', mimeType: 'application/pdf', uri: '/a/doc.pdf' } }]
    });
    expect(p[0].action).toBe('store_binary');
  });

  it('resource blob sans mimeType (défaut octet-stream) → reste store_binary', function() {
    var p = extractResultParts({
      content: [{ type: 'resource', resource: { blob: 'CCCC', uri: '/a/doc.bin' } }]
    });
    expect(p[0].action).toBe('store_binary');
    expect(p[0].mime).toBe('application/octet-stream');
  });

  it('resource.text (store_inline) reste inchangé même si mimeType textuel', function() {
    var p = extractResultParts({
      content: [{ type: 'resource', resource: { text: 'hello', mimeType: 'text/plain', uri: '/a.txt' } }]
    });
    expect(p[0].action).toBe('store_inline');
  });
});

// ── formatInlineHandleForModel (handle js__eval, lot M) ──────────────────────
// Contrat de non-régression du bug lot M initial : le handle émis au tour
// d'extraction pour un blob inline res_… ne doit JAMAIS porter de marqueur
// [resource_ref:…] (qui serait ré-inliné en texte complet au tour suivant par
// assembleToolResultForModel → explosion de contexte), et doit porter l'id res_…
// pour js__eval.

describe('formatInlineHandleForModel', function() {
  it('ne contient JAMAIS de marqueur [resource_ref: (non ré-inlinable — cœur du fix lot M)', function() {
    var rec = { id: 'res_abc', class: 'inline', mime: 'application/json', name: 'data.json', size: 4200 };
    var h = formatInlineHandleForModel('res_abc', 'application/json', rec);
    expect(h.indexOf('[resource_ref:') >= 0).toBeFalsy();
  });

  it('porte l\'id res_… pour js__eval', function() {
    var rec = { id: 'res_abc', class: 'inline', mime: 'application/json', name: 'data.json', size: 4200 };
    var h = formatInlineHandleForModel('res_abc', 'application/json', rec);
    expect(h.indexOf('res_abc') >= 0).toBeTruthy();
    expect(h.indexOf('js__eval') >= 0).toBeTruthy();
  });

  it('mentionne blob=<id> et reste compact (taille lisible, pas le contenu)', function() {
    var rec = { id: 'res_x', class: 'inline', mime: 'text/csv', name: 'rows.csv', size: 1048576 };
    var h = formatInlineHandleForModel('res_x', 'text/csv', rec);
    expect(h.indexOf('blob=res_x') >= 0).toBeTruthy();
    expect(h.indexOf('1.0 MB') >= 0).toBeTruthy();   // humanSize, pas les octets
  });

  it('fallback sans rec en cache : descripteur minimal sur id + mime, toujours sans ref', function() {
    var h = formatInlineHandleForModel('res_late', 'text/plain', null);
    expect(h.indexOf('res_late') >= 0).toBeTruthy();
    expect(h.indexOf('text/plain') >= 0).toBeTruthy();
    expect(h.indexOf('[resource_ref:') >= 0).toBeFalsy();
  });

  it('un ref inline reste, LUI, ré-inliné par assembleToolResultForModel (contraste : le handle M n\'en produit pas)', function() {
    // Preuve que la résolution générique EST bien le vecteur qu'on évite :
    // un [resource_ref:] vers un record inline décode tout le contenu.
    var buf = utf8Encode('MEMBRE_ENTIER_DU_ZIP');
    _resourceCache['res_m1'] = { id: 'res_m1', class: 'inline', mime: 'text/plain',
      name: 'm.txt', size: buf.byteLength, data: buf };
    expect(assembleToolResultForModel('[resource_ref:res_m1]')).toBe('MEMBRE_ENTIER_DU_ZIP');
    // …tandis que le handle réellement émis par la branche M ne s'expanse pas :
    var handle = formatInlineHandleForModel('res_m1', 'text/plain', _resourceCache['res_m1']);
    expect(assembleToolResultForModel(handle)).toBe(handle);   // aucun marqueur → inchangé
    delete _resourceCache['res_m1'];
  });
});

// ── assembleToolResultForModel ────────────────────────────────────────────────

describe('assembleToolResultForModel', function() {
  it('chaîne sans ref → passthrough', function() {
    expect(assembleToolResultForModel('bonjour')).toBe('bonjour');
  });

  it('chaîne vide → chaîne vide', function() {
    expect(assembleToolResultForModel('')).toBe('');
  });

  it('ref inconnue → message d\'indisponibilité', function() {
    var r = assembleToolResultForModel('[resource_ref:res_unknown]');
    expect(r.indexOf('not available') >= 0 || r.indexOf('unavailable') >= 0 || r.indexOf('resource') >= 0).toBeTruthy();
  });

  it('ref inline connue → contenu UTF-8 décodé', function() {
    // Simuler un enregistrement dans le cache
    var content = '{"key":"value"}';
    var buf = utf8Encode(content);
    _resourceCache['res_test1'] = { id: 'res_test1', class: 'inline', mime: 'application/json',
      name: 'test.json', size: buf.byteLength, data: buf };
    var result = assembleToolResultForModel('[resource_ref:res_test1]');
    expect(result).toBe(content);
    delete _resourceCache['res_test1'];
  });

  it('ref binary connue → descripteur statique', function() {
    var ab = new ArrayBuffer(100);
    _resourceCache['res_img1'] = { id: 'res_img1', class: 'binary', mime: 'image/png',
      name: 'photo.png', size: 100, data: ab };
    var result = assembleToolResultForModel('[resource_ref:res_img1]');
    expect(result.indexOf('res_img1') >= 0).toBeTruthy();
    expect(result.indexOf('image/png') >= 0).toBeTruthy();
    expect(result.indexOf('photo.png') >= 0).toBeTruthy();
    delete _resourceCache['res_img1'];
  });

  it('multiples refs dans une chaîne', function() {
    var buf = utf8Encode('texte_a');
    _resourceCache['res_a'] = { id: 'res_a', class: 'inline', mime: 'text/plain', name: 'a.txt', size: 7, data: buf };
    var buf2 = utf8Encode('texte_b');
    _resourceCache['res_b'] = { id: 'res_b', class: 'inline', mime: 'text/plain', name: 'b.txt', size: 7, data: buf2 };
    var s = 'intro [resource_ref:res_a] milieu [resource_ref:res_b] fin';
    var result = assembleToolResultForModel(s);
    expect(result).toBe('intro texte_a milieu texte_b fin');
    delete _resourceCache['res_a'];
    delete _resourceCache['res_b'];
  });

  it('chaîne sans marqueur de ref ne déclenche pas de substitution', function() {
    var result = assembleToolResultForModel('[resource autre format]');
    expect(result).toBe('[resource autre format]');
  });
});

// ── resolveRecallImages (brief A2 / D3 voie b) ────────────────────────────────
describe('resolveRecallImages', function() {
  function ackRecall(over) {
    return Object.assign({ role: 'tool-ack', kind: 'attachment_recalled',
      attId: 'att-1', mime: 'image/jpeg', convId: 'c1' }, over);
  }

  it('ack image avec record en cache → recallImage = dataUrl reconstruite', function() {
    var ab = new ArrayBuffer(3);
    new Uint8Array(ab).set([1, 2, 3]);
    _resourceCache['res_att1'] = { id: 'res_att1', attId: 'att-1', conversationId: 'c1',
      class: 'binary', mime: 'image/jpeg', name: 'p.jpg', data: ab };
    var out = resolveRecallImages([{ role: 'user', content: 'q' }, ackRecall()]);
    var expected = 'data:image/jpeg;base64,' + arrayBufferToBase64(ab);
    expect(out[1].recallImage).toBe(expected);
    // ne mute pas l'entrée d'origine (copie)
    delete _resourceCache['res_att1'];
  });

  it('record absent du cache → ack inchangé, pas de recallImage', function() {
    var out = resolveRecallImages([ackRecall({ attId: 'att-99' })]);
    expect(out[0].recallImage).toBeFalsy();
  });

  it('ack attachment_recalled non-image → ignoré', function() {
    var out = resolveRecallImages([ackRecall({ mime: 'text/plain' })]);
    expect(out[0].recallImage).toBeFalsy();
  });

  it('messages ordinaires et autres acks → passthrough', function() {
    var t = [{ role: 'user', content: 'q' },
             { role: 'tool-ack', kind: 'mcp_call', name: 'srv__x' }];
    var out = resolveRecallImages(t);
    expect(out[0]).toBe(t[0]);
    expect(out[1]).toBe(t[1]);
  });
});

// ── classifyAttachmentKind (pièces jointes, brief A / D1) ─────────────────────

describe('classifyAttachmentKind', function() {
  it('mime image/* → image, quelle que soit l\'extension', function() {
    expect(classifyAttachmentKind('photo.png', 'image/png')).toBe('image');
    expect(classifyAttachmentKind('photo.weird', 'image/jpeg')).toBe('image');
  });
  it('extensions texte connues → text', function() {
    expect(classifyAttachmentKind('notes.txt', 'text/plain')).toBe('text');
    expect(classifyAttachmentKind('readme.md', '')).toBe('text');
    expect(classifyAttachmentKind('data.csv', '')).toBe('text');
    expect(classifyAttachmentKind('app.log', '')).toBe('text');
    expect(classifyAttachmentKind('script.py', '')).toBe('text');
    expect(classifyAttachmentKind('main.js', '')).toBe('text');
    expect(classifyAttachmentKind('style.css', '')).toBe('text');
  });
  it('extension inconnue, mime non-image → binary', function() {
    expect(classifyAttachmentKind('archive.zip', 'application/zip')).toBe('binary');
    expect(classifyAttachmentKind('doc.pdf', 'application/pdf')).toBe('binary');
  });
  it('sans extension, sans mime → binary', function() {
    expect(classifyAttachmentKind('Makefile', '')).toBe('binary');
  });
  it('extension en majuscules reconnue (insensible à la casse)', function() {
    expect(classifyAttachmentKind('NOTES.TXT', '')).toBe('text');
  });
  it('mime image/* prioritaire sur une extension texte homonyme improbable', function() {
    expect(classifyAttachmentKind('scan.txt', 'image/png')).toBe('image');
  });
});

// ── allocateAttId (pièces jointes, brief A / D1) ──────────────────────────────

describe('allocateAttId', function() {
  it('premier appel (compteur 0/undefined) → att-1', function() {
    expect(allocateAttId(0).id).toBe('att-1');
    expect(allocateAttId(undefined).id).toBe('att-1');
  });
  it('incrémente le compteur retourné', function() {
    var a = allocateAttId(0);
    expect(a.counter).toBe(1);
    var b = allocateAttId(a.counter);
    expect(b.id).toBe('att-2');
    expect(b.counter).toBe(2);
  });
  it('séquence monotone sur plusieurs appels', function() {
    var counter = 0;
    var ids = [];
    for (var i = 0; i < 5; i++) {
      var alloc = allocateAttId(counter);
      counter = alloc.counter;
      ids.push(alloc.id);
    }
    expect(ids.join(',')).toBe('att-1,att-2,att-3,att-4,att-5');
  });
  it('ne réutilise jamais un id déjà alloué même en repartant d\'un compteur élevé (troncature)', function() {
    // Simule : 3 attachments alloués (compteur=3), message tronqué par édition,
    // mais le compteur PERSISTE (jamais réinitialisé) — le prochain attachment
    // doit être att-4, pas att-1 (pas de collision avec les entrées IDB orphelines).
    var afterTruncation = allocateAttId(3);
    expect(afterTruncation.id).toBe('att-4');
  });
});

// ── formatAttachmentDescriptor (brief A lot 2, D2 — byte-stable) ──────────────

describe('formatAttachmentDescriptor', function() {
  it('format exact, avec miaou__recall_attachment', function() {
    var d = formatAttachmentDescriptor({ attId: 'att-3', name: 'diagram.png', w: 1280, h: 960, size: 219136 });
    expect(d).toBe('[attachment att-3: image "diagram.png", 1280x960, ' + humanSize(219136) +
      ' — content available via miaou__recall_attachment]');
  });
  it('dérivé uniquement des champs figés (name/w/h/size) — jamais des octets', function() {
    // Deux appels avec les mêmes champs figés produisent EXACTEMENT le même
    // descripteur (byte-stable), peu importe tout autre état.
    var att = { attId: 'att-1', name: 'photo.jpg', w: 800, h: 600, size: 45000 };
    expect(formatAttachmentDescriptor(att)).toBe(formatAttachmentDescriptor(att));
  });
});

// ── formatTextAttachmentBlock (D3) ────────────────────────────────────────────

describe('formatTextAttachmentBlock', function() {
  it('en-tête avec attId et nom, contenu fencé', function() {
    var block = formatTextAttachmentBlock({ attId: 'att-2', name: 'notes.txt' }, 'ligne1\nligne2');
    expect(block).toBe('[attachment att-2: file "notes.txt"]\n```\nligne1\nligne2\n```');
  });
  it('texte vide/absent → fence vide, pas de crash', function() {
    var block = formatTextAttachmentBlock({ attId: 'att-1', name: 'x.txt' }, undefined);
    expect(block).toBe('[attachment att-1: file "x.txt"]\n```\n\n```');
  });
});

// ── formatBinaryAttachmentDescriptor (brief H — générique, byte-stable) ──────

describe('formatBinaryAttachmentDescriptor', function() {
  it('format exact, note neutre (aucun outil mentionné)', function() {
    var d = formatBinaryAttachmentDescriptor({ attId: 'att-4', name: 'rapport.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 219136 });
    expect(d).toBe('[attachment att-4: file "rapport.docx", application/vnd.openxmlformats-officedocument.wordprocessingml.document, ' +
      humanSize(219136) + ' — binary content, not inlined]');
  });
  it('mime absent → fallback application/octet-stream', function() {
    var d = formatBinaryAttachmentDescriptor({ attId: 'att-1', name: 'x.bin', size: 10 });
    expect(d.indexOf('application/octet-stream') >= 0).toBeTruthy();
  });
  it('dérivé uniquement des champs figés — byte-stable entre deux appels identiques', function() {
    var att = { attId: 'att-2', name: 'archive.zip', mime: 'application/zip', size: 4096 };
    expect(formatBinaryAttachmentDescriptor(att)).toBe(formatBinaryAttachmentDescriptor(att));
  });
  it('générique : même format quel que soit le type de fichier (pas de cas particulier docx)', function() {
    var docx = formatBinaryAttachmentDescriptor({ attId: 'att-1', name: 'a.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 100 });
    var bin = formatBinaryAttachmentDescriptor({ attId: 'att-1', name: 'a.bin', mime: 'application/octet-stream', size: 100 });
    expect(docx.indexOf(' — binary content, not inlined]') >= 0).toBeTruthy();
    expect(bin.indexOf(' — binary content, not inlined]') >= 0).toBeTruthy();
  });
});

// ── buildAttachedMessageContent (D2/D3/H — construction au tour d'attache) ───

describe('buildAttachedMessageContent', function() {
  it('texte seul, aucun attachment → string (pas de content parts inutiles)', function() {
    var c = buildAttachedMessageContent('bonjour', [], []);
    expect(c).toBe('bonjour');
  });
  it('attachment texte seul → string = texte + bloc fencé, pas de tableau', function() {
    var c = buildAttachedMessageContent('regarde ce fichier', [{ att: { attId: 'att-1', name: 'a.txt' }, text: 'contenu' }], []);
    expect(typeof c).toBe('string');
    expect(c.indexOf('regarde ce fichier') === 0).toBeTruthy();
    expect(c.indexOf('[attachment att-1: file "a.txt"]') >= 0).toBeTruthy();
  });
  it('attachment image → tableau de content parts OpenAI, une part par image', function() {
    var c = buildAttachedMessageContent('vois cette image', [], [{ att: { attId: 'att-1' }, dataUrl: 'data:image/png;base64,AAA' }]);
    expect(Array.isArray(c)).toBeTruthy();
    expect(c.length).toBe(2);
    expect(c[0].type).toBe('text');
    expect(c[0].text).toBe('vois cette image');
    expect(c[1].type).toBe('image_url');
    expect(c[1].image_url.url).toBe('data:image/png;base64,AAA');
  });
  it('plusieurs images → une part image_url par image, ordre préservé', function() {
    var c = buildAttachedMessageContent('', [], [
      { att: { attId: 'att-1' }, dataUrl: 'data:image/png;base64,AAA' },
      { att: { attId: 'att-2' }, dataUrl: 'data:image/jpeg;base64,BBB' },
    ]);
    expect(c.length).toBe(3);
    expect(c[1].image_url.url).toBe('data:image/png;base64,AAA');
    expect(c[2].image_url.url).toBe('data:image/jpeg;base64,BBB');
  });
  it('texte + attachment texte + image → text part inclut le texte tapé et le bloc fencé', function() {
    var c = buildAttachedMessageContent('titre', [{ att: { attId: 'att-1', name: 'a.txt' }, text: 'X' }],
      [{ att: { attId: 'att-2' }, dataUrl: 'data:image/png;base64,ZZZ' }]);
    expect(Array.isArray(c)).toBeTruthy();
    expect(c[0].text.indexOf('titre') === 0).toBeTruthy();
    expect(c[0].text.indexOf('[attachment att-1: file "a.txt"]') >= 0).toBeTruthy();
  });
  it('attachment binaire seul → string = texte + descripteur, pas de tableau (brief H)', function() {
    var c = buildAttachedMessageContent('voici un fichier', [], [], [{ attId: 'att-1', name: 'rapport.docx', mime: 'application/msword', size: 5000 }]);
    expect(typeof c).toBe('string');
    expect(c.indexOf('voici un fichier') === 0).toBeTruthy();
    expect(c.indexOf('[attachment att-1: file "rapport.docx"') >= 0).toBeTruthy();
    expect(c.indexOf('binary content, not inlined') >= 0).toBeTruthy();
  });
  it('binaire + image → text part inclut le descripteur binaire, image reste une part séparée', function() {
    var c = buildAttachedMessageContent('titre', [], [{ att: { attId: 'att-2' }, dataUrl: 'data:image/png;base64,ZZZ' }],
      [{ attId: 'att-1', name: 'a.zip', mime: 'application/zip', size: 100 }]);
    expect(Array.isArray(c)).toBeTruthy();
    expect(c[0].text.indexOf('[attachment att-1: file "a.zip"') >= 0).toBeTruthy();
    expect(c[1].type).toBe('image_url');
  });
  it('byte-stabilité tour d\'attache : descripteur binaire identique via buildAttachedMessageContent et formatBinaryAttachmentDescriptor direct', function() {
    var att = { attId: 'att-3', name: 'x.pdf', mime: 'application/pdf', size: 777 };
    var c = buildAttachedMessageContent('', [], [], [att]);
    expect(c.indexOf(formatBinaryAttachmentDescriptor(att)) >= 0).toBeTruthy();
  });
});

// ── prefixTextInContentParts (dispatchSend — injection <miaou_context>) ──────

describe('prefixTextInContentParts', function() {
  it('préfixe la première part texte existante', function() {
    var parts = [{ type: 'text', text: 'bonjour' }, { type: 'image_url', image_url: { url: 'data:x' } }];
    var out = prefixTextInContentParts(parts, 'CTX\n\n');
    expect(out[0].text).toBe('CTX\n\nbonjour');
    expect(out[1].image_url.url).toBe('data:x');
  });
  it('aucune part texte → en crée une en tête', function() {
    var parts = [{ type: 'image_url', image_url: { url: 'data:x' } }];
    var out = prefixTextInContentParts(parts, 'CTX\n\n');
    expect(out.length).toBe(2);
    expect(out[0].type).toBe('text');
    expect(out[0].text).toBe('CTX\n\n');
    expect(out[1].type).toBe('image_url');
  });
  it('ne mute pas le tableau reçu', function() {
    var parts = [{ type: 'text', text: 'a' }];
    prefixTextInContentParts(parts, 'X');
    expect(parts[0].text).toBe('a');
  });
});

// ── collapseAttachedMessageContent (D2 — réécriture UNIQUE parts→descripteur) ─

describe('collapseAttachedMessageContent', function() {
  it('content déjà string → renvoyée telle quelle (idempotence / garde rejeu)', function() {
    expect(collapseAttachedMessageContent('déjà réécrit', [{ kind: 'image', attId: 'att-1' }])).toBe('déjà réécrit');
  });
  it('parts texte + une image → texte + une ligne de descripteur', function() {
    var parts = [{ type: 'text', text: 'voici' }, { type: 'image_url', image_url: { url: 'data:...' } }];
    var atts = [{ attId: 'att-1', name: 'diagram.png', mime: 'image/png', size: 219136, kind: 'image', w: 1280, h: 960 }];
    var out = collapseAttachedMessageContent(parts, atts);
    expect(typeof out).toBe('string');
    expect(out.indexOf('voici') === 0).toBeTruthy();
    expect(out.indexOf('[attachment att-1: image "diagram.png", 1280x960') >= 0).toBeTruthy();
    expect(out.indexOf('base64') >= 0).toBeFalsy();   // zéro base64 résiduel
  });
  it('plusieurs images → une ligne de descripteur par image, dans l\'ordre des attachments', function() {
    var parts = [
      { type: 'text', text: 'deux images' },
      { type: 'image_url', image_url: { url: 'data:AAA' } },
      { type: 'image_url', image_url: { url: 'data:BBB' } },
    ];
    var atts = [
      { attId: 'att-1', name: 'a.png', mime: 'image/png', size: 1000, kind: 'image', w: 10, h: 10 },
      { attId: 'att-2', name: 'b.png', mime: 'image/png', size: 2000, kind: 'image', w: 20, h: 20 },
    ];
    var out = collapseAttachedMessageContent(parts, atts);
    var idxA = out.indexOf('[attachment att-1:');
    var idxB = out.indexOf('[attachment att-2:');
    expect(idxA >= 0 && idxB > idxA).toBeTruthy();
  });
  it('attachments non-image (text/binary) ignorés dans les descripteurs (pas de ligne)', function() {
    var parts = [{ type: 'text', text: 'x' }];
    var atts = [{ attId: 'att-1', name: 'notes.txt', kind: 'text' }];
    var out = collapseAttachedMessageContent(parts, atts);
    expect(out).toBe('x');
  });
  it('parts multiples de type text sont concaténées avant les descripteurs', function() {
    var parts = [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }];
    var out = collapseAttachedMessageContent(parts, []);
    expect(out).toBe('A\n\nB');
  });
  it('brief H : attachment binaire seul (déjà string dès buildAttachedMessageContent) → no-op, descripteur préservé', function() {
    var att = { attId: 'att-1', name: 'rapport.docx', mime: 'application/msword', size: 5000 };
    var content = buildAttachedMessageContent('salut', [], [], [att]);
    var out = collapseAttachedMessageContent(content, [Object.assign({ kind: 'binary' }, att)]);
    expect(out).toBe(content);
    expect(out.indexOf('binary content, not inlined') >= 0).toBeTruthy();
  });
  it('brief H : binaire + image → descripteur binaire déjà dans la part texte, pas dupliqué par collapse', function() {
    var parts = [
      { type: 'text', text: 'voici\n\n[attachment att-1: file "a.zip", application/zip, 100 B — binary content, not inlined]' },
      { type: 'image_url', image_url: { url: 'data:AAA' } },
    ];
    var atts = [
      { attId: 'att-1', name: 'a.zip', kind: 'binary' },
      { attId: 'att-2', name: 'b.png', mime: 'image/png', size: 10, kind: 'image', w: 1, h: 1 },
    ];
    var out = collapseAttachedMessageContent(parts, atts);
    var firstIdx = out.indexOf('[attachment att-1:');
    var lastIdx = out.lastIndexOf('[attachment att-1:');
    expect(firstIdx >= 0 && firstIdx === lastIdx).toBeTruthy();   // une seule occurrence, pas de doublon
    expect(out.indexOf('[attachment att-2:') >= 0).toBeTruthy();  // le descripteur image, lui, est bien ajouté par collapse
  });
});

// ── Cache session (_resourceCache) — getCachedRecordByAttId / getCachedLibraryEntriesBySpace ──
// Pas de reset public (clearResourceSessionCache supprimée au lot 2) : ids distincts par test.

describe('getCachedRecordByAttId (scan linéaire, double filtre attId + conversationId)', function() {
  it('match exact (attId + conversationId)', function() {
    _cacheRecord({ id: 'r1', attId: 'att-e1', conversationId: 'conv-e1' });
    var rec = getCachedRecordByAttId('att-e1', 'conv-e1');
    expect(rec.id).toBe('r1');
  });
  it('match attId avec conversationId omis → renvoie le premier attId qui matche', function() {
    _cacheRecord({ id: 'r2', attId: 'att-e2', conversationId: 'conv-e2' });
    var rec = getCachedRecordByAttId('att-e2');
    expect(rec.id).toBe('r2');
  });
  it('attId présent mais conversationId différent → null', function() {
    _cacheRecord({ id: 'r3', attId: 'att-e3', conversationId: 'conv-e3' });
    expect(getCachedRecordByAttId('att-e3', 'conv-autre')).toBe(null);
  });
  it('attId absent → null', function() {
    expect(getCachedRecordByAttId('att-inconnu-e4')).toBe(null);
  });
});

describe('getCachedLibraryEntriesBySpace (filtre kind===library ET spaceId)', function() {
  it('cache mêlant attachments et library d\'espaces différents → ne renvoie que ceux du spaceId demandé', function() {
    _cacheRecord({ id: 'att-x1', attId: 'att-x1' });   // attachment, kind absent
    _cacheRecord({ id: 'lib-x1', kind: 'library', spaceId: 'sp-e1' });
    _cacheRecord({ id: 'lib-x2', kind: 'library', spaceId: 'sp-e2' });
    var entries = getCachedLibraryEntriesBySpace('sp-e1');
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe('lib-x1');
  });
  it('spaceId sans fichier → []', function() {
    expect(getCachedLibraryEntriesBySpace('sp-e-vide')).toEqual([]);
  });
});
