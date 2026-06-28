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

// ── classifyMime ──────────────────────────────────────────────────────────────

describe('classifyMime', function() {
  it('application/json → inline', function() {
    expect(classifyMime('application/json')).toBe('inline');
  });
  it('text/plain → inline', function() {
    expect(classifyMime('text/plain')).toBe('inline');
  });
  it('text/html → inline', function() {
    expect(classifyMime('text/html')).toBe('inline');
  });
  it('image/png → binary', function() {
    expect(classifyMime('image/png')).toBe('binary');
  });
  it('audio/mpeg → binary', function() {
    expect(classifyMime('audio/mpeg')).toBe('binary');
  });
  it('application/pdf → binary', function() {
    expect(classifyMime('application/pdf')).toBe('binary');
  });
  it('vide → binary', function() {
    expect(classifyMime('')).toBe('binary');
  });
  it('ignore les paramètres MIME (;charset=...)', function() {
    expect(classifyMime('text/plain; charset=utf-8')).toBe('inline');
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
