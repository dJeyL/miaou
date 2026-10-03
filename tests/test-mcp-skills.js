// tests/test-mcp-skills.js — purs des skills servies par un serveur MCP.
// Les chemins réseau (skills/list, skills/get, resources/read) ne sont pas
// couverts ici : ils se vérifient contre un vrai serveur.

function asciiBytes(s) { return new Uint8Array(utf8Encode(s)); }
function repeatA(n) { var s = ''; for (var i = 0; i < n; i++) s += 'a'; return s; }

// Exemple de la spec, à l'octet : contenus et empreintes repris des constantes
// SPEC_* de miaou-mcp-servers (tests/test_skills.py), qui les vérifient côté
// serveur. Partager les vecteurs fait de ces tests une preuve croisée : les deux
// implémentations calculent la même chose sur les mêmes octets.
var SPEC_SKILL_MD = '---\nname: pdf-processing\ndescription: Extract, fill, and assemble PDF documents\n' +
  '---\n\n# PDF processing\n\nChoose the matching template from `templates/`.\n';
var SPEC_INVOICE = '# Invoice\n\nCustomer:\nAmount:\n';
var SPEC_PURCHASE_ORDER = '# Purchase order\n\nSupplier:\nItems:\n';
var SPEC_CREDIT_NOTE = '# Credit note\n\nInvoice:\nCredit amount:\n';
var SPEC_FRONTMATTER = { name: 'pdf-processing', description: 'Extract, fill, and assemble PDF documents' };

describe('sha256Hex : vecteurs FIPS 180-2', function() {
  it('chaîne vide', function() {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('« abc »', function() {
    expect(sha256Hex(asciiBytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('448 bits, deux blocs', function() {
    expect(sha256Hex(asciiBytes('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

describe('sha256Hex : frontières de bloc (références calculées par Node crypto)', function() {
  // 55 octets tiennent avec le bourrage dans UN bloc, 56 en exigent deux : c'est
  // là qu'un calcul de longueur complétée se trompe.
  var cases = [
    [55, '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
    [56, 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    [63, '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34'],
    [64, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
    [65, '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0'],
    [1000, '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3'],
  ];
  cases.forEach(function(c) {
    it(c[0] + ' octets', function() { expect(sha256Hex(asciiBytes(repeatA(c[0])))).toBe(c[1]); });
  });
  it('accepte un tableau d\'entiers comme un Uint8Array', function() {
    expect(sha256Hex([0x61, 0x62, 0x63])).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('sha256Hex : exemple de la spec (vecteurs SPEC_* du serveur)', function() {
  it('SKILL.md', function() {
    expect('sha256:' + sha256Hex(asciiBytes(SPEC_SKILL_MD))).toBe('sha256:99b737495721155ece826d57521e2d66141ebdc1344a400487481ea2642ab19e');
  });
  it('templates/invoice.md', function() {
    expect('sha256:' + sha256Hex(asciiBytes(SPEC_INVOICE))).toBe('sha256:61f4ea6d2c75fde1b4977219e7e3107d491c3c26aefb6686e84d6281c088d9ee');
  });
  it('templates/purchase-order.md', function() {
    expect('sha256:' + sha256Hex(asciiBytes(SPEC_PURCHASE_ORDER))).toBe('sha256:f2ff774b1737ff3dec81c47946f9976f18a1a9f69dda0a81f22eabd95173c158');
  });
  it('templates/credit note.md', function() {
    expect('sha256:' + sha256Hex(asciiBytes(SPEC_CREDIT_NOTE))).toBe('sha256:766bffa8d4908ce897e1727ca22e4bf0fa796620b35218ce2132a124545626f1');
  });
});

describe('mcpResourceContentBytes', function() {
  it('un `text` est ré-encodé en UTF-8 (accents, guillemets, emoji)', function() {
    var b = mcpResourceContentBytes({ uri: 'skill://x/SKILL.md', text: 'Règle — « non contractuel » 🐱\n' });
    expect(b.length).toBe(38);
    expect(sha256Hex(b)).toBe('168c42a38e415678ab2860300d0fed1fbb0d02227363c73db7b15b4c6e3658e4');
  });
  it('un `text` garde son BOM : il fait partie des octets hachés', function() {
    var b = mcpResourceContentBytes({ text: '\uFEFF---\nname: x\n' });
    expect(b.length).toBe(15);
    expect(sha256Hex(b)).toBe('69fc529c4bb8635cdfee8c7959b59c35dffae4640b27015b46dfa02b1eb4420d');
  });
  it('un `blob` est décodé du base64', function() {
    var b = mcpResourceContentBytes({ blob: 'AP+ACg3+/w==' });
    expect(Array.prototype.slice.call(b)).toEqual([0, 255, 128, 10, 13, 254, 255]);
    expect(sha256Hex(b)).toBe('39320ee0fa5f88746395d3060988ecb7f0ae29b9fd8064eb39c2e7ba9e3b3257');
  });
  it('rend null sans `text` ni `blob`', function() {
    expect(mcpResourceContentBytes({ uri: 'skill://x/SKILL.md' })).toBe(null);
    expect(mcpResourceContentBytes(null)).toBe(null);
    expect(mcpResourceContentBytes({ text: 42 })).toBe(null);
  });
});

describe('verifyMcpSkillFile', function() {
  var good = { uri: 'skill://pdf-processing/SKILL.md', digest: 'sha256:99b737495721155ece826d57521e2d66141ebdc1344a400487481ea2642ab19e', size: 151 };
  it('accepte les octets décrits par l\'entrée', function() {
    expect(verifyMcpSkillFile(asciiBytes(SPEC_SKILL_MD), good)).toBe(null);
  });
  it('taille différente : refus « size », tranché avant le hachage', function() {
    var r = verifyMcpSkillFile(asciiBytes(SPEC_SKILL_MD + 'x'), good);
    expect(r.code).toBe('size');
    expect(r.expected).toBe(151);
    expect(r.actual).toBe(152);
  });
  it('même taille, octet changé : refus « digest »', function() {
    var r = verifyMcpSkillFile(asciiBytes(SPEC_SKILL_MD.replace('Extract', 'Extrakt')), good);
    expect(r.code).toBe('digest');
    expect(r.expected).toBe(good.digest);
  });
  it('empreinte mal formée : refus « manifest » (majuscules, préfixe absent, autre algorithme)', function() {
    var hex = '99b737495721155ece826d57521e2d66141ebdc1344a400487481ea2642ab19e';
    expect(verifyMcpSkillFile(asciiBytes(SPEC_SKILL_MD), { size: 151, digest: 'sha256:' + hex.toUpperCase() }).code).toBe('manifest');
    expect(verifyMcpSkillFile(asciiBytes(SPEC_SKILL_MD), { size: 151, digest: hex }).code).toBe('manifest');
    expect(verifyMcpSkillFile(asciiBytes(SPEC_SKILL_MD), { size: 151, digest: 'sha512:' + hex }).code).toBe('manifest');
  });
  it('taille absente ou non entière : refus « manifest »', function() {
    expect(verifyMcpSkillFile(asciiBytes(SPEC_SKILL_MD), { digest: good.digest }).code).toBe('manifest');
    expect(verifyMcpSkillFile(asciiBytes(SPEC_SKILL_MD), { digest: good.digest, size: '151' }).code).toBe('manifest');
  });
  it('aucun octet : refus « content »', function() {
    expect(verifyMcpSkillFile(null, good).code).toBe('content');
  });
});

describe('parseMcpSkillFrontmatter : sous-ensemble accepté', function() {
  it('le SKILL.md de l\'exemple de la spec', function() {
    var r = parseMcpSkillFrontmatter(SPEC_SKILL_MD);
    expect(r.ok).toBe(true);
    expect(r.fields.name).toEqual({ kind: 'plain', text: 'pdf-processing' });
    expect(r.fields.description.text).toBe('Extract, fill, and assemble PDF documents');
  });
  it('guillemets simples et doubles, échappements, commentaires', function() {
    var r = parseMcpSkillFrontmatter('---\n# commentaire\nname: x\n' +
      'description: "Dit \\"oui\\"\\tpuis \\u00e9 # pas un commentaire" # commentaire\n' +
      'license: \'l\'\'apostrophe\'\n' +
      'compatibility: Python 3 # fin\n' +
      '\n---\ncorps\n');
    expect(r.ok).toBe(true);
    expect(r.fields.description).toEqual({ kind: 'quoted', text: 'Dit "oui"\tpuis é # pas un commentaire' });
    expect(r.fields.license).toEqual({ kind: 'quoted', text: 'l\'apostrophe' });
    expect(r.fields.compatibility).toEqual({ kind: 'plain', text: 'Python 3' });
  });
  it('metadata sur un niveau, CRLF et BOM tolérés', function() {
    var r = parseMcpSkillFrontmatter('\uFEFF---\r\nname: x\r\ndescription: y\r\nmetadata:\r\n  author: Julien\r\n  version: "1.0"\r\n---\r\n');
    expect(r.ok).toBe(true);
    expect(r.fields.metadata.kind).toBe('map');
    expect(r.fields.metadata.entries.author).toEqual({ kind: 'plain', text: 'Julien' });
    expect(r.fields.metadata.entries.version).toEqual({ kind: 'quoted', text: '1.0' });
  });
  it('un deux-points sans espace reste dans la valeur (URL)', function() {
    var r = parseMcpSkillFrontmatter('---\nname: x\nhomepage: https://exemple.org/a\n---\n');
    expect(r.fields.homepage.text).toBe('https://exemple.org/a');
  });
});

describe('parseMcpSkillFrontmatter : refus qui nomment le champ', function() {
  function refused(src) { var r = parseMcpSkillFrontmatter(src); expect(r.ok).toBe(false); return r; }
  it('pas de frontmatter, ou non refermé', function() {
    expect(refused('# titre\n').field).toBe(null);
    expect(refused('---\nname: x\n').reason).toContain('refermé');
  });
  it('liste sous une clé', function() {
    expect(refused('---\nname: x\nallowed-tools:\n  - Read\n---\n').field).toBe('allowed-tools');
  });
  it('liste en ligne', function() {
    expect(refused('---\nname: x\nallowed-tools: [Read, Grep]\n---\n').field).toBe('allowed-tools');
  });
  it('bloc multiligne', function() {
    expect(refused('---\nname: x\ndescription: |\n  ligne\n---\n').field).toBe('description');
    expect(refused('---\nname: x\ndescription: >-\n  ligne\n---\n').field).toBe('description');
  });
  it('valeur nue poursuivie sur la ligne suivante', function() {
    expect(refused('---\nname: x\ndescription: début\n  suite\n---\n').field).toBe('description');
  });
  it('objet imbriqué hors metadata', function() {
    expect(refused('---\nname: x\nauthor:\n  nom: J\n---\n').field).toBe('author');
  });
  it('metadata imbriqué au-delà d\'un niveau', function() {
    expect(refused('---\nname: x\nmetadata:\n  a:\n    b: c\n---\n').field).toBe('metadata.a');
    expect(refused('---\nname: x\nmetadata:\n  a: b\n    c: d\n---\n').field).toBe('metadata');
  });
  it('metadata vide', function() {
    expect(refused('---\nname: x\nmetadata:\n---\n').field).toBe('metadata');
  });
  it('clé en double, à la racine comme dans metadata', function() {
    expect(refused('---\nname: x\nname: y\n---\n').field).toBe('name');
    expect(refused('---\nname: x\nmetadata:\n  a: 1\n  a: 2\n---\n').field).toBe('metadata.a');
  });
  it('ancre, alias, étiquette', function() {
    expect(refused('---\nname: &n x\n---\n').field).toBe('name');
    expect(refused('---\nname: *n\n---\n').field).toBe('name');
    expect(refused('---\nversion: !!str 1\n---\n').field).toBe('version');
  });
  it('deux-points suivi d\'une espace dans une valeur nue', function() {
    expect(refused('---\nname: x\ndescription: Usage: lire\n---\n').field).toBe('description');
  });
  it('chaîne entre guillemets non refermée, ou suivie de texte', function() {
    expect(refused('---\ndescription: "début\n  fin"\n---\n').field).toBe('description');
    expect(refused('---\ndescription: "a" b\n---\n').field).toBe('description');
  });
  it('échappement inconnu', function() {
    expect(refused('---\ndescription: "a\\qb"\n---\n').field).toBe('description');
  });
  it('valeur vide', function() {
    expect(refused('---\nname: x\nlicense:\n---\n').field).toBe('license');
  });
  it('tabulation d\'indentation', function() {
    expect(refused('---\nname: x\nmetadata:\n\ta: b\n---\n').field).toBe('metadata');
  });
  it('clé entre guillemets', function() {
    expect(refused('---\n"name": x\n---\n').reason).toContain('guillemets');
  });
});

describe('mcpFrontmatterScalarMatches : scalaires normalisés', function() {
  function plain(t) { return { kind: 'plain', text: t }; }
  function quoted(t) { return { kind: 'quoted', text: t }; }
  it('nombre typé par le serveur', function() {
    expect(mcpFrontmatterScalarMatches(plain('1.0'), 1)).toBe(true);
    expect(mcpFrontmatterScalarMatches(plain('1_000'), 1000)).toBe(true);
    expect(mcpFrontmatterScalarMatches(plain('0x1F'), 31)).toBe(true);
    expect(mcpFrontmatterScalarMatches(plain('2'), 3)).toBe(false);
  });
  it('booléen typé par le serveur', function() {
    expect(mcpFrontmatterScalarMatches(plain('true'), true)).toBe(true);
    expect(mcpFrontmatterScalarMatches(plain('no'), false)).toBe(true);
    expect(mcpFrontmatterScalarMatches(plain('true'), false)).toBe(false);
  });
  it('null', function() {
    expect(mcpFrontmatterScalarMatches(plain('~'), null)).toBe(true);
    expect(mcpFrontmatterScalarMatches(plain('rien'), null)).toBe(false);
  });
  it('une valeur entre guillemets n\'égale qu\'une chaîne', function() {
    expect(mcpFrontmatterScalarMatches(quoted('1.0'), '1.0')).toBe(true);
    expect(mcpFrontmatterScalarMatches(quoted('1.0'), 1)).toBe(false);
    expect(mcpFrontmatterScalarMatches(quoted('true'), true)).toBe(false);
  });
  it('un objet ou une liste de l\'entrée n\'égale aucun scalaire', function() {
    expect(mcpFrontmatterScalarMatches(plain('a'), ['a'])).toBe(false);
    expect(mcpFrontmatterScalarMatches(plain('a'), { a: 1 })).toBe(false);
  });
});

describe('verifyMcpSkillFrontmatter', function() {
  it('accepte l\'exemple de la spec contre son entrée', function() {
    expect(verifyMcpSkillFrontmatter(SPEC_SKILL_MD, SPEC_FRONTMATTER)).toBe(null);
  });
  it('accepte des valeurs typées par le serveur, metadata compris', function() {
    var src = '---\nname: x\ndescription: y\nversion: 1.0\nbeta: true\nmetadata:\n  rev: 2\n  owner: "équipe"\n---\n';
    expect(verifyMcpSkillFrontmatter(src, { name: 'x', description: 'y', version: 1, beta: true, metadata: { rev: 2, owner: 'équipe' } })).toBe(null);
  });
  it('valeur différente : nomme le champ', function() {
    var r = verifyMcpSkillFrontmatter(SPEC_SKILL_MD, { name: 'pdf-processing', description: 'Autre chose' });
    expect(r.field).toBe('description');
    expect(r.reason).toContain('différente');
  });
  it('champ en plus d\'un côté ou de l\'autre', function() {
    expect(verifyMcpSkillFrontmatter(SPEC_SKILL_MD, { name: 'pdf-processing', description: SPEC_FRONTMATTER.description, license: 'MIT' }).field).toBe('license');
    expect(verifyMcpSkillFrontmatter('---\nname: x\ndescription: y\nlicense: MIT\n---\n', { name: 'x', description: 'y' }).field).toBe('license');
  });
  it('sous-clé de metadata absente, en plus ou différente', function() {
    var src = '---\nname: x\nmetadata:\n  a: b\n---\n';
    expect(verifyMcpSkillFrontmatter(src, { name: 'x', metadata: { a: 'b', c: 'd' } }).field).toBe('metadata.c');
    expect(verifyMcpSkillFrontmatter(src, { name: 'x', metadata: {} }).field).toBe('metadata.a');
    expect(verifyMcpSkillFrontmatter(src, { name: 'x', metadata: { a: 'z' } }).field).toBe('metadata.a');
    expect(verifyMcpSkillFrontmatter(src, { name: 'x', metadata: 'b' }).field).toBe('metadata');
  });
  it('un fichier illisible est un échec, et le champ fautif est nommé', function() {
    var r = verifyMcpSkillFrontmatter('---\nname: x\nallowed-tools: [Read]\n---\n', { name: 'x', 'allowed-tools': ['Read'] });
    expect(r.field).toBe('allowed-tools');
  });
  it('entrée sans frontmatter exploitable', function() {
    expect(verifyMcpSkillFrontmatter(SPEC_SKILL_MD, null).field).toBe(null);
    expect(verifyMcpSkillFrontmatter(SPEC_SKILL_MD, ['name']).field).toBe(null);
  });
});

// ── Étape catalogue ──────────────────────────────────────────────────────────

// Forme mesurée sur le proxy de miaou-mcp-servers (bench), à l'URI près.
var BENCH_ENTRY = {
  uri: 'skill://bench/bench/SKILL.md',
  frontmatter: { name: 'bench', description: 'Règle de restitution.' },
  resources: [{ uri: 'skill://bench/bench/SKILL.md', digest: 'sha256:b149e50776662f9ca2711d0ab550f56de33582603c73c32a25e10bffa1231b89', size: 315 }],
};

describe('mcpDeclaresSkillsExtension', function() {
  it('présence de la clé, valeur vide comprise (forme mesurée)', function() {
    expect(mcpDeclaresSkillsExtension({ capabilities: { extensions: { 'io.modelcontextprotocol/skills': {} } } })).toBe(true);
  });
  it('faux sans extensions, sans capacités, ou en legacy', function() {
    expect(mcpDeclaresSkillsExtension({ capabilities: { resources: {}, tools: {} } })).toBe(false);
    expect(mcpDeclaresSkillsExtension({ capabilities: { extensions: { 'autre/ext': {} } } })).toBe(false);
    expect(mcpDeclaresSkillsExtension({})).toBe(false);
    expect(mcpDeclaresSkillsExtension(null)).toBe(false);
  });
});

describe('_meta des outils listés', function() {
  var gated = { name: 'bench__echo', _meta: { 'miaou/requiresSkill': 'skill://bench/bench/SKILL.md' } };
  var fallback = { name: 'read_skill', _meta: { 'miaou/skillsFallback': true } };
  it('mcpToolRequiresSkill lit l\'URI, et seulement une URI skill://', function() {
    expect(mcpToolRequiresSkill(gated)).toBe('skill://bench/bench/SKILL.md');
    expect(mcpToolRequiresSkill({ _meta: { 'miaou/requiresSkill': 'bench' } })).toBe(null);
    expect(mcpToolRequiresSkill({ name: 'x' })).toBe(null);
  });
  it('le repli est reconnu à sa marque, jamais à son nom', function() {
    expect(mcpToolIsSkillsFallback(fallback)).toBe(true);
    expect(mcpToolIsSkillsFallback({ name: 'read_skill' })).toBe(false);
    expect(mcpToolIsSkillsFallback({ name: 'lire', _meta: { 'miaou/skillsFallback': true } })).toBe(true);
  });
  it('masqué seulement si l\'extension est déclarée', function() {
    expect(shouldHideMcpTool(fallback, true)).toBe(true);
    expect(shouldHideMcpTool(fallback, false)).toBe(false);
    expect(shouldHideMcpTool(gated, true)).toBe(false);
  });
});

describe('mcpSkillEntryFromResult', function() {
  it('déballe `skill` (skills/get) et laisse une entrée nue (skills/list)', function() {
    expect(mcpSkillEntryFromResult({ ttlMs: 1, skill: BENCH_ENTRY }).uri).toBe(BENCH_ENTRY.uri);
    expect(mcpSkillEntryFromResult(BENCH_ENTRY).uri).toBe(BENCH_ENTRY.uri);
    expect(mcpSkillEntryFromResult(null)).toBe(null);
  });
});

describe('normalizeMcpSkillEntry', function() {
  function withRes(res) { return Object.assign({}, BENCH_ENTRY, { resources: res }); }
  it('entrée valide : répertoire, name, manifeste', function() {
    var n = normalizeMcpSkillEntry(BENCH_ENTRY);
    expect(n.entry.dir).toBe('skill://bench/bench/');
    expect(n.entry.name).toBe('bench');
    expect(n.entry.dynamic).toBe(false);
    expect(n.entry.resources.length).toBe(1);
  });
  it('entrée de l\'exemple de la spec, annexes comprises', function() {
    var n = normalizeMcpSkillEntry({
      uri: 'skill://pdf-processing/SKILL.md', frontmatter: SPEC_FRONTMATTER,
      resources: [
        { uri: 'skill://pdf-processing/SKILL.md', digest: 'sha256:99b737495721155ece826d57521e2d66141ebdc1344a400487481ea2642ab19e', size: 151 },
        { uri: 'skill://pdf-processing/templates/invoice.md', digest: 'sha256:61f4ea6d2c75fde1b4977219e7e3107d491c3c26aefb6686e84d6281c088d9ee', size: 29 },
      ],
    });
    expect(n.entry.resources.length).toBe(2);
  });
  it('skill dynamique : pas de manifeste', function() {
    var n = normalizeMcpSkillEntry(withRes('dynamic'));
    expect(n.entry.dynamic).toBe(true);
    expect(n.entry.resources).toBe(null);
  });
  it('refus nommés', function() {
    expect(normalizeMcpSkillEntry(withRes(undefined)).problem).toContain('manifeste');
    expect(normalizeMcpSkillEntry(withRes('autre')).problem).toContain('manifeste');
    expect(normalizeMcpSkillEntry(withRes([])).problem).toContain('SKILL.md');
    expect(normalizeMcpSkillEntry(withRes([{ uri: 'skill://autre/x.md', digest: BENCH_ENTRY.resources[0].digest, size: 1 }])).problem).toContain('hors du répertoire');
    expect(normalizeMcpSkillEntry(withRes([BENCH_ENTRY.resources[0], BENCH_ENTRY.resources[0]])).problem).toContain('deux fois');
    expect(normalizeMcpSkillEntry(withRes([{ uri: BENCH_ENTRY.uri, digest: 'sha256:abc', size: 1 }])).problem).toContain('empreinte');
    expect(normalizeMcpSkillEntry(Object.assign({}, BENCH_ENTRY, { uri: 'skill://bench/autre/SKILL.md' })).problem).toContain('dernier segment');
    expect(normalizeMcpSkillEntry(Object.assign({}, BENCH_ENTRY, { uri: 'https://x/SKILL.md' })).problem).toContain('URI');
    expect(normalizeMcpSkillEntry(Object.assign({}, BENCH_ENTRY, { frontmatter: { name: 'bench' } })).problem).toContain('description');
  });
  it('bornes de la spec : 512 fichiers, 16 Mio', function() {
    var many = [BENCH_ENTRY.resources[0]];
    for (var i = 0; i < MCP_SKILL_MAX_FILES; i++) many.push({ uri: 'skill://bench/bench/f' + i + '.md', digest: BENCH_ENTRY.resources[0].digest, size: 1 });
    expect(normalizeMcpSkillEntry(withRes(many)).problem).toContain('512');
    var big = [BENCH_ENTRY.resources[0], { uri: 'skill://bench/bench/gros.bin', digest: BENCH_ENTRY.resources[0].digest, size: MCP_SKILL_MAX_TOTAL_BYTES }];
    expect(normalizeMcpSkillEntry(withRes(big)).problem).toContain('16 Mio');
    var exact = [{ uri: BENCH_ENTRY.uri, digest: BENCH_ENTRY.resources[0].digest, size: MCP_SKILL_MAX_TOTAL_BYTES }];
    expect(normalizeMcpSkillEntry(withRes(exact)).entry.name).toBe('bench');
  });
});

describe('mcpSkillCatalogueFrom', function() {
  it('garde une entrée invalide avec son problème, nommée au mieux', function() {
    var cat = mcpSkillCatalogueFrom([BENCH_ENTRY, { uri: 'skill://x/y/SKILL.md', frontmatter: { name: 'y', description: 'd' } }]);
    expect(cat.length).toBe(2);
    expect(cat[0].problem).toBe(undefined);
    expect(cat[1].name).toBe('y');
    expect(cat[1].problem).toContain('manifeste');
  });
  it('liste absente : catalogue vide', function() {
    expect(mcpSkillCatalogueFrom(undefined)).toEqual([]);
  });
});

describe('mcpSkillForUri', function() {
  var outer = normalizeMcpSkillEntry({ uri: 'skill://a/SKILL.md', frontmatter: { name: 'a', description: '' },
    resources: [{ uri: 'skill://a/SKILL.md', digest: BENCH_ENTRY.resources[0].digest, size: 1 }] }).entry;
  var inner = normalizeMcpSkillEntry({ uri: 'skill://a/b/SKILL.md', frontmatter: { name: 'b', description: '' },
    resources: [{ uri: 'skill://a/b/SKILL.md', digest: BENCH_ENTRY.resources[0].digest, size: 1 }] }).entry;
  it('SKILL.md d\'une skill', function() {
    var r = mcpSkillForUri([outer, inner], 'skill://a/b/SKILL.md');
    expect(r.entry.name).toBe('b');
    expect(r.isSkillMd).toBe(true);
  });
  it('annexe : le répertoire le plus profond gagne', function() {
    expect(mcpSkillForUri([outer, inner], 'skill://a/b/ref.md').entry.name).toBe('b');
    expect(mcpSkillForUri([outer, inner], 'skill://a/ref.md').entry.name).toBe('a');
    expect(mcpSkillForUri([outer, inner], 'skill://a/ref.md').isSkillMd).toBe(false);
  });
  it('rien hors catalogue, ni pour une entrée invalide', function() {
    expect(mcpSkillForUri([outer], 'skill://z/SKILL.md')).toBe(null);
    expect(mcpSkillForUri([{ uri: 'skill://z/SKILL.md', name: 'z', problem: 'x' }], 'skill://z/SKILL.md')).toBe(null);
  });
});

describe('rewriteMcpUpstreamToolPrefixes', function() {
  it('préfixe de carte sur les noms d\'outils entre accents graves', function() {
    var body = '- `bench` (skill://bench/bench/SKILL.md), obligatoire avant tout appel d\'un outil `bench__…` : x\n' +
      'Voir `bench__echo` et `bench__add`, pas les outils bench.';
    expect(rewriteMcpUpstreamToolPrefixes(body, 'proxy', 'bench')).toBe(
      '- `bench` (skill://bench/bench/SKILL.md), obligatoire avant tout appel d\'un outil `proxy__bench__…` : x\n' +
      'Voir `proxy__bench__echo` et `proxy__bench__add`, pas les outils bench.');
  });
  it('n\'atteint ni un autre upstream ni un jeton qui ne fait que contenir le préfixe', function() {
    expect(rewriteMcpUpstreamToolPrefixes('`web__fetch` `x_bench__y`', 'proxy', 'bench')).toBe('`web__fetch` `x_bench__y`');
  });
  it('appliquée par mcpInstructionSectionsForServer, pas à un serveur unitaire', function() {
    var secs = mcpInstructionSectionsForServer('proxy', 'préambule\n\n## bench\n\nAvant `bench__echo`, lire.');
    expect(secs[0].body).toBe('Avant `proxy__bench__echo`, lire.');
    var solo = mcpInstructionSectionsForServer('srv', 'Avant `srv__x`, lire.');
    expect(solo[0].body).toBe('Avant `srv__x`, lire.');
  });
});

// ── Étape approbations ───────────────────────────────────────────────────────

var BENCH_NORM = normalizeMcpSkillEntry(BENCH_ENTRY).entry;
var DYN_NORM = normalizeMcpSkillEntry(Object.assign({}, BENCH_ENTRY, {
  uri: 'skill://gen/gen/SKILL.md', frontmatter: { name: 'gen', description: 'variable' }, resources: 'dynamic' })).entry;

describe('mcpSkillManifestMatches', function() {
  var a = { uri: 'skill://s/SKILL.md', digest: BENCH_ENTRY.resources[0].digest, size: 1 };
  var b = { uri: 'skill://s/b.md', digest: BENCH_ENTRY.resources[0].digest, size: 2 };
  it('même ensemble, ordre indifférent', function() {
    expect(mcpSkillManifestMatches([a, b], [b, a])).toBe(true);
  });
  it('fichier ajouté, retiré, empreinte ou taille changées : écart', function() {
    expect(mcpSkillManifestMatches([a], [a, b])).toBe(false);
    expect(mcpSkillManifestMatches([a, b], [a])).toBe(false);
    expect(mcpSkillManifestMatches([a], [Object.assign({}, a, { size: 9 })])).toBe(false);
    expect(mcpSkillManifestMatches([a], [Object.assign({}, a, { digest: 'sha256:' + new Array(65).join('0') })])).toBe(false);
    expect(mcpSkillManifestMatches(null, [a])).toBe(false);
  });
});

describe('approbations : table persistée', function() {
  it('approuver, désapprouver, sans muter la source', function() {
    var src = {};
    var t = approveMcpSkill(src, 'proxy', BENCH_NORM, 42);
    expect(src).toEqual({});
    expect(t.proxy.bench.uri).toBe(BENCH_ENTRY.uri);
    expect(t.proxy.bench.manifest).toEqual(BENCH_ENTRY.resources);
    expect(t.proxy.bench.approvedAt).toBe(42);
    var u = disapproveMcpSkill(t, 'proxy', 'bench');
    expect(t.proxy.bench.uri).toBe(BENCH_ENTRY.uri);
    expect(u).toEqual({});
  });
  it('une skill dynamique ne se persiste pas', function() {
    expect(approveMcpSkill({}, 'proxy', DYN_NORM, 1)).toEqual({});
  });
  it('renommage : les approbations suivent la carte', function() {
    var t = approveMcpSkill({}, 'proxy', BENCH_NORM, 1);
    var r = renameMcpSkillApprovals(t, 'proxy', 'banc');
    expect(r.proxy).toBe(undefined);
    expect(r.banc.bench.uri).toBe(BENCH_ENTRY.uri);
  });
  it('renommage d\'une carte sans approbation : rien ne survit sous le nouveau nom', function() {
    var t = approveMcpSkill({}, 'banc', BENCH_NORM, 1);
    expect(renameMcpSkillApprovals(t, 'proxy', 'banc')).toEqual({});
  });
  it('suppression de carte', function() {
    var t = approveMcpSkill(approveMcpSkill({}, 'a', BENCH_NORM, 1), 'b', BENCH_NORM, 1);
    var r = removeMcpSkillApprovals(t, 'a');
    expect(Object.keys(r)).toEqual(['b']);
  });
});

describe('mcpSkillApprovalState', function() {
  var appr = approveMcpSkill({}, 'proxy', BENCH_NORM, 1).proxy.bench;
  it('approuvée, à approuver, modifiée', function() {
    expect(mcpSkillApprovalState(BENCH_NORM, appr, null)).toBe('approved');
    expect(mcpSkillApprovalState(BENCH_NORM, null, null)).toBe('pending');
    var changed = normalizeMcpSkillEntry(Object.assign({}, BENCH_ENTRY, {
      resources: [Object.assign({}, BENCH_ENTRY.resources[0], { size: 316 })] })).entry;
    expect(mcpSkillApprovalState(changed, appr, null)).toBe('changed');
  });
  it('même manifeste sous une autre URI : modifiée', function() {
    expect(mcpSkillApprovalState(BENCH_NORM, Object.assign({}, appr, { uri: 'skill://x/bench/SKILL.md' }), null)).toBe('changed');
  });
  it('dynamique : approbation de session seulement', function() {
    expect(mcpSkillApprovalState(DYN_NORM, null, null)).toBe('session-pending');
    expect(mcpSkillApprovalState(DYN_NORM, null, DYN_NORM.uri)).toBe('session-approved');
  });
  it('invalide', function() {
    expect(mcpSkillApprovalState({ name: 'x', problem: 'p' }, null, null)).toBe('invalid');
  });
  it('seuls approved et session-approved autorisent le chargement', function() {
    var all = ['approved', 'pending', 'changed', 'absent', 'session-approved', 'session-pending', 'invalid'];
    expect(all.filter(mcpSkillStateAllowsLoad)).toEqual(['approved', 'session-approved']);
  });
  it('chaque état a son libellé', function() {
    var all = ['approved', 'pending', 'changed', 'absent', 'session-approved', 'session-pending', 'invalid'];
    expect(all.filter(function(s) { return !MCP_SKILL_STATE_LABELS[s]; })).toEqual([]);
  });
});

describe('mcpSkillRows', function() {
  var appr = approveMcpSkill({}, 'proxy', BENCH_NORM, 1).proxy;
  it('une rangée par skill présentée, puis les approbations absentes', function() {
    var other = Object.assign({}, appr.bench, { uri: 'skill://old/old/SKILL.md', description: 'ancienne' });
    var rows = mcpSkillRows([BENCH_NORM, DYN_NORM], Object.assign({ old: other }, appr), {}, []);
    expect(rows.map(function(r) { return r.name + ':' + r.state; })).toEqual(['bench:approved', 'gen:session-pending', 'old:absent']);
    expect(rows[2].description).toBe('ancienne');
  });
  it('catalogue illisible : les approbations restent visibles, absentes', function() {
    expect(mcpSkillRows(null, appr, {}, []).map(function(r) { return r.state; })).toEqual(['absent']);
  });
  it('homonymie avec une skill locale signalée', function() {
    expect(mcpSkillRows([BENCH_NORM], {}, {}, ['bench'])[0].collision).toBe(true);
    expect(mcpSkillRows([BENCH_NORM], {}, {}, ['autre'])[0].collision).toBe(false);
  });
  it('approbation de session lue par carte', function() {
    var sess = {}; sess[DYN_NORM.name] = DYN_NORM.uri;
    expect(mcpSkillRows([DYN_NORM], {}, sess, [])[0].state).toBe('session-approved');
  });
});

describe('mcpSkillsAwaitingApproval (toast de démarrage)', function() {
  var invalid = { uri: 'skill://z/z/SKILL.md', name: 'z', problem: 'p' };
  it('présentes, valides, non dynamiques, à approuver ou modifiées', function() {
    var statuses = {
      proxy: { state: 'ok', skillCatalogue: [BENCH_NORM, DYN_NORM, invalid] },
      down: { state: 'error', skillCatalogue: [BENCH_NORM] },
      other: { state: 'ok', skillCatalogue: null },
    };
    expect(mcpSkillsAwaitingApproval(statuses, {})).toEqual([{ card: 'proxy', name: 'bench' }]);
  });
  it('une skill approuvée qui revient n\'y apparaît pas ; une absente non plus', function() {
    var appr = approveMcpSkill({}, 'proxy', BENCH_NORM, 1);
    expect(mcpSkillsAwaitingApproval({ proxy: { state: 'ok', skillCatalogue: [BENCH_NORM] } }, appr)).toEqual([]);
    expect(mcpSkillsAwaitingApproval({ proxy: { state: 'ok', skillCatalogue: [] } }, appr)).toEqual([]);
  });
});

describe('approbations de session', function() {
  it('posées, renommées, retirées avec la carte', function() {
    setMcpSkillSessionApproval('p', 'gen', 'skill://gen/gen/SKILL.md');
    expect(mcpSkillSessionApprovalsFor('p').gen).toBe('skill://gen/gen/SKILL.md');
    renameMcpSkillSessionApprovals('p', 'q');
    expect(mcpSkillSessionApprovalsFor('p')).toEqual({});
    expect(mcpSkillSessionApprovalsFor('q').gen).toBe('skill://gen/gen/SKILL.md');
    removeMcpSkillSessionApprovals('q');
    expect(mcpSkillSessionApprovalsFor('q')).toEqual({});
  });
});

describe('approbations : stockage et synchro', function() {
  it('lecture défensive, écriture relue fraîche', function() {
    localStorage.removeItem(MCP_SKILL_APPROVALS_KEY);
    expect(loadMcpSkillApprovals()).toEqual({});
    localStorage.setItem(MCP_SKILL_APPROVALS_KEY, '[1]');
    expect(loadMcpSkillApprovals()).toEqual({});
    localStorage.setItem(MCP_SKILL_APPROVALS_KEY, JSON.stringify(approveMcpSkill({}, 'a', BENCH_NORM, 1)));
    updateMcpSkillApprovals(function(all) { return approveMcpSkill(all, 'b', BENCH_NORM, 2); });
    expect(Object.keys(loadMcpSkillApprovals()).sort()).toEqual(['a', 'b']);
    localStorage.removeItem(MCP_SKILL_APPROVALS_KEY);
  });
  it('un pair relit la clé sur l\'événement storage', function() {
    expect(storageEventDecision(MCP_SKILL_APPROVALS_KEY, '{}', '{"a":{}}')).toEqual({ action: 'apply-settings', keys: ['mcp-skill-approvals'] });
  });
});

// ── Étape lecture ────────────────────────────────────────────────────────────

var SPEC_ENTRY_RAW = {
  uri: 'skill://pdf-processing/SKILL.md', frontmatter: SPEC_FRONTMATTER,
  resources: [
    { uri: 'skill://pdf-processing/SKILL.md', digest: 'sha256:99b737495721155ece826d57521e2d66141ebdc1344a400487481ea2642ab19e', size: 151 },
    { uri: 'skill://pdf-processing/templates/invoice.md', digest: 'sha256:61f4ea6d2c75fde1b4977219e7e3107d491c3c26aefb6686e84d6281c088d9ee', size: 29 },
  ],
};
var SPEC_NORM = normalizeMcpSkillEntry(SPEC_ENTRY_RAW).entry;

describe('resolveMcpSkillServer / resolveSkillReadTarget', function() {
  var cats = { proxy: [BENCH_NORM, SPEC_NORM], autre: [SPEC_NORM], mort: null };
  it('slug seul : skill locale', function() {
    expect(resolveSkillReadTarget({ slug: ' bench ' }, cats)).toEqual({ kind: 'local', slug: 'bench' });
  });
  it('serveur donné par la carte, ou par un préfixe d\'outil carte__upstream', function() {
    expect(resolveSkillReadTarget({ server: 'proxy', uri: BENCH_ENTRY.uri }, cats).card).toBe('proxy');
    expect(resolveSkillReadTarget({ server: 'proxy__bench', uri: BENCH_ENTRY.uri }, cats).card).toBe('proxy');
  });
  it('serveur absent : déduit de l\'URI si une seule carte la sert', function() {
    var t = resolveSkillReadTarget({ uri: BENCH_ENTRY.uri }, cats);
    expect(t.card).toBe('proxy');
    expect(t.isSkillMd).toBe(true);
  });
  it('serveur absent et URI servie par deux cartes : refus qui les nomme', function() {
    var t = resolveSkillReadTarget({ uri: SPEC_NORM.uri }, cats);
    expect(t.error).toContain('« autre », « proxy »');
  });
  it('serveur inconnu : refus qui liste les serveurs à skills', function() {
    expect(resolveSkillReadTarget({ server: 'x', uri: BENCH_ENTRY.uri }, cats).error).toContain('« autre », « mort », « proxy »');
  });
  it('un slug n\'emporte pas une uri : uri présente = skill MCP', function() {
    expect(resolveSkillReadTarget({ slug: 'bench', uri: BENCH_ENTRY.uri }, cats).kind).toBe('mcp');
  });
  it('annexe : rattachée à sa skill', function() {
    var t = resolveSkillReadTarget({ server: 'proxy', uri: 'skill://pdf-processing/templates/invoice.md' }, cats);
    expect(t.isSkillMd).toBe(false);
    expect(t.entry.name).toBe('pdf-processing');
  });
  it('URI invalide, hors catalogue, catalogue illisible', function() {
    expect(resolveSkillReadTarget({ server: 'proxy', uri: 'https://x' }, cats).error).toContain('URI');
    expect(resolveSkillReadTarget({ server: 'proxy', uri: 'skill://z/SKILL.md' }, cats).error).toContain('ne sert pas');
    expect(resolveSkillReadTarget({ server: 'mort', uri: BENCH_ENTRY.uri }, cats).error).toContain('pas pu être lu');
  });
});

describe('mcpSkillHintForSlug', function() {
  it('oriente vers la lecture distante, arguments exacts', function() {
    var t = mcpSkillHintForSlug('bench', { proxy: [BENCH_NORM] });
    expect(t).toContain('Aucune skill locale « bench »');
    expect(t).toContain('server « proxy » et uri « skill://bench/bench/SKILL.md »');
  });
  it('rien si aucun serveur ne sert ce nom', function() {
    expect(mcpSkillHintForSlug('autre', { proxy: [BENCH_NORM] })).toBe(null);
  });
});

describe('formatMcpSkillForModel', function() {
  it('étiquette d\'origine, contenu, annexes en URI absolues', function() {
    var t = formatMcpSkillForModel({ card: 'proxy', uri: SPEC_NORM.uri, entry: SPEC_NORM, text: 'CORPS', isSkillMd: true });
    expect(t.indexOf('[Skill MCP « pdf-processing », servie par le serveur MCP « proxy »')).toBe(0);
    expect(t).toContain('pas une skill locale');
    expect(t).toContain('\n\nCORPS\n\n');
    expect(t).toContain('- skill://pdf-processing/templates/invoice.md');
  });
  it('sans annexe : pas de note ; annexe : étiquette propre, pas de note', function() {
    expect(formatMcpSkillForModel({ card: 'p', uri: BENCH_NORM.uri, entry: BENCH_NORM, text: 'x', isSkillMd: true })).toContain('approuvée par l\'utilisateur');
    expect(formatMcpSkillForModel({ card: 'p', uri: BENCH_NORM.uri, entry: BENCH_NORM, text: 'x', isSkillMd: true }).indexOf('Fichiers annexes')).toBe(-1);
    var a = formatMcpSkillForModel({ card: 'p', uri: 'skill://pdf-processing/templates/invoice.md', entry: SPEC_NORM, text: 'x', isSkillMd: false });
    expect(a.indexOf('[Fichier annexe de la skill MCP « pdf-processing »')).toBe(0);
    expect(a.indexOf('Fichiers annexes')).toBe(-1);
  });
  it('dynamique : dit non vérifiable', function() {
    expect(formatMcpSkillForModel({ card: 'p', uri: DYN_NORM.uri, entry: DYN_NORM, text: 'x', isSkillMd: true })).toContain('non vérifiable');
  });
});

describe('ackSatisfiesSkillRead : deux espaces de noms qui ne se croisent pas', function() {
  var local = { kind: 'skill_read', slug: 'bench' };
  var mcp = { kind: 'skill_read', server: 'proxy', uri: BENCH_ENTRY.uri, title: 'bench' };
  var id = { server: 'proxy', uri: BENCH_ENTRY.uri };
  it('slug local / identité MCP', function() {
    expect(ackSatisfiesSkillRead(local, 'bench')).toBe(true);
    expect(ackSatisfiesSkillRead(mcp, id)).toBe(true);
  });
  it('une lecture MCP ne satisfait pas le slug homonyme, ni l\'inverse', function() {
    expect(ackSatisfiesSkillRead(mcp, 'bench')).toBe(false);
    expect(ackSatisfiesSkillRead(local, id)).toBe(false);
  });
  it('autre carte, autre URI, annexe, échec : rien', function() {
    expect(ackSatisfiesSkillRead(mcp, { server: 'autre', uri: BENCH_ENTRY.uri })).toBe(false);
    expect(ackSatisfiesSkillRead(mcp, { server: 'proxy', uri: 'skill://x/SKILL.md' })).toBe(false);
    expect(ackSatisfiesSkillRead({ kind: 'skill_file_read', server: 'proxy', uri: BENCH_ENTRY.uri }, id)).toBe(false);
    expect(ackSatisfiesSkillRead(Object.assign({ error: true }, mcp), id)).toBe(false);
  });
  it('skillReadSince accepte l\'identité MCP, frontière de compaction comprise', function() {
    var ack = Object.assign({ role: 'tool-ack' }, mcp);
    expect(skillReadSince(id, [ack], [])).toBe(true);
    expect(skillReadSince(id, [ack, { role: 'compaction', content: 'r' }], [])).toBe(false);
    expect(skillReadSince(id, [], [mcp])).toBe(true);
  });
});

// Montage d'un serveur « proxy » connecté qui sert bench, avec `mcpRpc` stubé
// par méthode. Rend une fonction de démontage.
function mountSkillServer(opts) {
  var o = opts || {};
  var savedRpc = mcpRpc;
  var calls = [];
  localStorage.setItem('miaou-mcp-servers', JSON.stringify([{ name: 'proxy', url: 'http://x/mcp', enabled: true }]));
  _remoteStatus.proxy = { state: 'ok', skillsDeclared: true, skillCatalogue: o.catalogue || [BENCH_NORM] };
  var body = o.body != null ? o.body : 'BODY';
  mcpRpc = function(server, method, params) {
    calls.push(method + ' ' + (params && params.uri || ''));
    if (method === 'skills/get') return Promise.resolve({ skill: o.entry || BENCH_ENTRY });
    if (method === 'resources/read') return Promise.resolve({ contents: [{ uri: params.uri, text: o.textFor ? o.textFor(params.uri) : body }] });
    return Promise.resolve({});
  };
  return { calls: calls, done: function() {
    mcpRpc = savedRpc;
    delete _remoteStatus.proxy;
    localStorage.removeItem('miaou-mcp-servers');
    localStorage.removeItem(MCP_SKILL_APPROVALS_KEY);
    removeMcpSkillSessionApprovals('proxy');
    clearPendingToolAcks();
  } };
}

// Un SKILL.md dont l'entrée, le contenu et l'empreinte concordent.
var REAL_MD = '---\nname: bench\ndescription: Règle de restitution.\n---\n\n# bench\n\nSignaler le banc.\n';
var REAL_BYTES = new Uint8Array(utf8Encode(REAL_MD));
var REAL_ENTRY = { uri: BENCH_ENTRY.uri, frontmatter: { name: 'bench', description: 'Règle de restitution.' },
  resources: [{ uri: BENCH_ENTRY.uri, digest: 'sha256:' + sha256Hex(REAL_BYTES), size: REAL_BYTES.length }] };
var REAL_NORM = normalizeMcpSkillEntry(REAL_ENTRY).entry;

describe('miaou__skills__read sur une skill MCP', function() {
  it('slug local manquant : orienté vers la skill MCP homonyme', function() {
    var m = mountSkillServer({});
    try {
      expect(flattenToolResult(callTool('miaou__skills__read', { slug: 'bench' }))).toContain('server « proxy » et uri « skill://bench/bench/SKILL.md »');
    } finally { m.done(); }
  });
  it('non approuvée : refus qui nomme la skill à approuver et où, n\'interdit pas les outils, et AUCUNE lecture de contenu', function() {
    var m = mountSkillServer({ entry: REAL_ENTRY, catalogue: [REAL_NORM], body: REAL_MD });
    try {
      var r = flattenToolResult(runAsync(callTool('miaou__skills__read', { server: 'proxy', uri: BENCH_ENTRY.uri })));
      expect(r).toContain('n\'est pas approuvée');
      expect(r).toContain('C\'est la SKILL que l\'utilisateur doit approuver, pas le serveur');
      expect(r).toContain('bouton Approuver sur la ligne de la skill « bench »');
      expect(r.indexOf('aucun appel')).toBe(-1);
      expect(m.calls).toEqual(['skills/get skill://bench/bench/SKILL.md']);
    } finally { m.done(); }
  });
  it('approuvée et conforme : contenu étiqueté, ack skill_read avec server et uri, sans slug', function() {
    var m = mountSkillServer({ entry: REAL_ENTRY, catalogue: [REAL_NORM], body: REAL_MD });
    try {
      saveMcpSkillApprovals(approveMcpSkill({}, 'proxy', REAL_NORM, 1));
      var r = flattenToolResult(runAsync(callTool('miaou__skills__read', { server: 'proxy__bench', uri: BENCH_ENTRY.uri })));
      expect(r).toContain('[Skill MCP « bench », servie par le serveur MCP « proxy »');
      expect(r).toContain('Signaler le banc.');
      var ack = getPendingToolAcks().filter(function(a) { return a.kind === 'skill_read'; })[0];
      expect(ack.server).toBe('proxy');
      expect(ack.uri).toBe(BENCH_ENTRY.uri);
      expect(ack.slug).toBe(undefined);
    } finally { m.done(); }
  });
  it('approuvée mais contenu non conforme : refus, rien chargé, approbation retirée', function() {
    var m = mountSkillServer({ entry: REAL_ENTRY, catalogue: [REAL_NORM], body: REAL_MD.replace('banc', 'bank') });
    try {
      saveMcpSkillApprovals(approveMcpSkill({}, 'proxy', REAL_NORM, 1));
      var r = flattenToolResult(runAsync(callTool('miaou__skills__read', { server: 'proxy', uri: BENCH_ENTRY.uri })));
      expect(r).toContain('ne correspond pas');
      expect(r.indexOf('Signaler')).toBe(-1);
      expect(loadMcpSkillApprovals()).toEqual({});
      expect(getPendingToolAcks().filter(function(a) { return a.kind === 'skill_read'; }).length).toBe(0);
    } finally { m.done(); }
  });
  it('approuvée, manifeste changé depuis : refus « a changé »', function() {
    var m = mountSkillServer({ entry: REAL_ENTRY, catalogue: [REAL_NORM], body: REAL_MD });
    try {
      saveMcpSkillApprovals(approveMcpSkill({}, 'proxy', BENCH_NORM, 1));   // autre empreinte
      var r = flattenToolResult(runAsync(callTool('miaou__skills__read', { server: 'proxy', uri: BENCH_ENTRY.uri })));
      expect(r).toContain('a changé depuis');
    } finally { m.done(); }
  });
});

describe('miaou__skills__read sur une annexe', function() {
  var SPEC_ANNEX = 'skill://pdf-processing/templates/invoice.md';
  function mount() {
    return mountSkillServer({ entry: SPEC_ENTRY_RAW, catalogue: [SPEC_NORM],
      textFor: function(u) { return u === SPEC_ANNEX ? SPEC_INVOICE : SPEC_SKILL_MD; } });
  }
  it('refusée tant que le SKILL.md n\'a pas été chargé', function() {
    var m = mount();
    try {
      saveMcpSkillApprovals(approveMcpSkill({}, 'proxy', SPEC_NORM, 1));
      var r = flattenToolResult(runAsync(callTool('miaou__skills__read', { server: 'proxy', uri: SPEC_ANNEX })));
      expect(r).toContain('lis d\'abord la skill elle-même');
      expect(m.calls).toEqual([]);
    } finally { m.done(); }
  });
  it('lue après le SKILL.md, vérifiée, ack skill_file_read distinct', function() {
    var m = mount();
    try {
      saveMcpSkillApprovals(approveMcpSkill({}, 'proxy', SPEC_NORM, 1));
      var first = flattenToolResult(runAsync(callTool('miaou__skills__read', { server: 'proxy', uri: SPEC_NORM.uri })));
      expect(first).toContain('- ' + SPEC_ANNEX);
      var r = flattenToolResult(runAsync(callTool('miaou__skills__read', { server: 'proxy', uri: SPEC_ANNEX })));
      expect(r).toContain('[Fichier annexe de la skill MCP « pdf-processing »');
      expect(r).toContain('Customer:');
      var kinds = getPendingToolAcks().map(function(a) { return a.kind; });
      expect(kinds).toEqual(['skill_read', 'skill_file_read']);
    } finally { m.done(); }
  });
});

describe('schéma de miaou__skills__read composé', function() {
  function readDef() { return toolDefinitions().filter(function(t) { return t.function.name === 'miaou__skills__read'; })[0].function; }
  it('statique sans serveur de skills', function() {
    var d = readDef();
    expect(d.parameters.required).toEqual(['slug']);
    expect(d.parameters.properties.uri).toBe(undefined);
  });
  it('server et uri dès qu\'un serveur connecté sert des skills, slug plus requis', function() {
    _remoteStatus.proxy = { state: 'ok', skillsDeclared: true, skillCatalogue: [] };
    try {
      var d = readDef();
      expect(Object.keys(d.parameters.properties).filter(function(k) { return k !== 'miaou_intent'; })).toEqual(['slug', 'server', 'uri']);
      expect(d.parameters.required).toBe(undefined);
    } finally { delete _remoteStatus.proxy; }
  });
});

// ── Étape garde ──────────────────────────────────────────────────────────────

describe('mcpRemoteSkillGateRefusal (pur)', function() {
  var id = BENCH_ENTRY.uri;
  var cats = { proxy: [BENCH_NORM] };
  var readAck = { role: 'tool-ack', kind: 'skill_read', server: 'proxy', uri: id, title: 'bench' };
  it('refus tant que la skill n\'est pas lue, avec les arguments exacts', function() {
    var r = mcpRemoteSkillGateRefusal('proxy', id, cats, [], []);
    expect(r).toContain('lis d\'abord la skill MCP « bench »');
    expect(r).toContain('server « proxy » et uri « ' + id + ' »');
    expect(r).toContain('Rien n\'a été fait');
  });
  it('passe après lecture, dans le fil ou dans le lot', function() {
    expect(mcpRemoteSkillGateRefusal('proxy', id, cats, [readAck], [])).toBe(null);
    expect(mcpRemoteSkillGateRefusal('proxy', id, cats, [], [readAck])).toBe(null);
  });
  it('une lecture avant la dernière compaction ne compte plus', function() {
    expect(mcpRemoteSkillGateRefusal('proxy', id, cats, [readAck, { role: 'compaction', content: 'r' }], [])).toContain('Refusé');
  });
  it('la lecture d\'une skill locale homonyme ne compte pas', function() {
    expect(mcpRemoteSkillGateRefusal('proxy', id, cats, [{ role: 'tool-ack', kind: 'skill_read', slug: 'bench' }], [])).toContain('Refusé');
  });
  it('garde ouverte : outil non gardé, extension non déclarée, catalogue illisible, skill absente ou invalide', function() {
    expect(mcpRemoteSkillGateRefusal('proxy', null, cats, [], [])).toBe(null);
    expect(mcpRemoteSkillGateRefusal('proxy', id, {}, [], [])).toBe(null);
    expect(mcpRemoteSkillGateRefusal('proxy', id, { proxy: null }, [], [])).toBe(null);
    expect(mcpRemoteSkillGateRefusal('proxy', 'skill://z/z/SKILL.md', cats, [], [])).toBe(null);
    expect(mcpRemoteSkillGateRefusal('proxy', id, { proxy: [{ uri: id, name: 'bench', problem: 'x' }] }, [], [])).toBe(null);
  });
});

describe('garde distante dans callTool', function() {
  function mount() {
    var m = mountSkillServer({});
    _remoteTools.proxy = [{ name: 'proxy__bench__echo', description: '', inputSchema: { type: 'object', properties: {} },
      requiresSkill: BENCH_ENTRY.uri }];
    return { calls: m.calls, done: function() { delete _remoteTools.proxy; m.done(); } };
  }
  it('refus SANS appel au serveur, ack tool_failed au nom complet, intent conservé', function() {
    var m = mount();
    try {
      var r = callTool('proxy__bench__echo', { text: 'x', miaou_intent: 'Tester' });
      expect(r.isError).toBe(true);
      expect(flattenToolResult(r)).toContain('lis d\'abord la skill MCP « bench »');
      expect(m.calls).toEqual([]);
      var ack = getPendingToolAcks()[0];
      expect(ack.kind).toBe('tool_failed');
      expect(ack.name).toBe('proxy__bench__echo');
      expect(ack.intent).toBe('Tester');
    } finally { m.done(); }
  });
  it('passe quand la lecture est dans le lot en cours', function() {
    var m = mount();
    try {
      _pendingToolAcks.push({ kind: 'skill_read', server: 'proxy', uri: BENCH_ENTRY.uri, title: 'bench' });
      runAsync(callTool('proxy__bench__echo', { text: 'x' }));
      expect(m.calls).toEqual(['tools/call ']);
    } finally { m.done(); }
  });
});

describe('withSkillReaderIfGated : outils distants', function() {
  var remote = [{ name: 'proxy__bench__echo', requiresSkill: BENCH_ENTRY.uri }, { name: 'proxy__web__fetch' }];
  it('un outil distant gardé emmène miaou__skills__read', function() {
    expect(withSkillReaderIfGated(['proxy__bench__echo'], TOOLS, remote)).toEqual(['proxy__bench__echo', 'miaou__skills__read']);
  });
  it('un outil distant non gardé, non', function() {
    expect(withSkillReaderIfGated(['proxy__web__fetch'], TOOLS, remote)).toEqual(['proxy__web__fetch']);
  });
  it('sans définitions distantes, comportement d\'avant', function() {
    expect(withSkillReaderIfGated(['proxy__bench__echo'], TOOLS)).toEqual(['proxy__bench__echo']);
  });
});

describe('stripSkillFrontmatterForDisplay', function() {
  it('retire le frontmatter et les lignes vides qui suivent', function() {
    expect(stripSkillFrontmatterForDisplay(SPEC_SKILL_MD)).toBe('# PDF processing\n\nChoose the matching template from `templates/`.\n');
  });
  it('BOM et CRLF tolérés', function() {
    expect(stripSkillFrontmatterForDisplay('﻿---\r\nname: x\r\n---\r\n\r\nCorps')).toBe('Corps');
  });
  it('sans frontmatter, ou frontmatter non refermé : texte intact', function() {
    expect(stripSkillFrontmatterForDisplay('# Titre\n')).toBe('# Titre\n');
    expect(stripSkillFrontmatterForDisplay('---\nname: x\n')).toBe('---\nname: x\n');
  });
});

describe('mcpSkillListEntries / miaou__skills__list', function() {
  it('entrées MCP sans slug, avec server et uri, valides seulement', function() {
    var e = mcpSkillListEntries({ proxy: [BENCH_NORM, { uri: 'skill://z/z/SKILL.md', name: 'z', problem: 'p' }], mort: null });
    expect(e).toEqual([{ name: 'bench', description: 'Règle de restitution.', source: 'mcp', server: 'proxy', uri: BENCH_ENTRY.uri }]);
  });
  it('miaou__skills__list les ajoute en queue, JSON intact', function() {
    _remoteStatus.proxy = { state: 'ok', skillsDeclared: true, skillCatalogue: [BENCH_NORM] };
    try {
      var list = JSON.parse(flattenToolResult(callTool('miaou__skills__list', {})));
      var last = list[list.length - 1];
      expect(last.source).toBe('mcp');
      expect(last.slug).toBe(undefined);
      expect(last.server).toBe('proxy');
    } finally { delete _remoteStatus.proxy; clearPendingToolAcks(); }
  });
  it('sans serveur de skills, aucune entrée MCP', function() {
    var list = JSON.parse(flattenToolResult(callTool('miaou__skills__list', {})));
    expect(list.filter(function(x) { return x.source === 'mcp'; }).length).toBe(0);
    clearPendingToolAcks();
  });
});

describe('skills MCP approuvées dans <miaou_skills_context>', function() {
  var INVALID = { uri: 'skill://z/z/SKILL.md', name: 'z', problem: 'p' };
  it('mcpSkillContextEntries : approuvées et approuvées pour la session seulement', function() {
    var cats = { proxy: [BENCH_NORM, DYN_NORM, INVALID], mort: null };
    expect(mcpSkillContextEntries(cats, {}, {})).toEqual([]);
    var appr = approveMcpSkill({}, 'proxy', BENCH_NORM, 1);
    expect(mcpSkillContextEntries(cats, appr, {}).map(function(e) { return e.name; })).toEqual(['bench']);
    var both = mcpSkillContextEntries(cats, appr, { proxy: { gen: DYN_NORM.uri } });
    expect(both.map(function(e) { return e.name; })).toEqual(['bench', 'gen']);
    expect(both[0]).toEqual({ name: 'bench', description: 'Règle de restitution.', server: 'proxy', uri: BENCH_NORM.uri });
  });
  it('approbation périmée (manifeste changé) : absente', function() {
    var appr = approveMcpSkill({}, 'proxy', BENCH_NORM, 1);
    appr.proxy.bench.manifest = [{ uri: BENCH_NORM.uri, digest: 'autre', size: 1 }];
    expect(mcpSkillContextEntries({ proxy: [BENCH_NORM] }, appr, {})).toEqual([]);
  });
  function withServed(approve, fn) {
    _remoteStatus.proxy = { state: 'ok', skillsDeclared: true, skillCatalogue: [BENCH_NORM] };
    if (approve) saveMcpSkillApprovals(approveMcpSkill({}, 'proxy', BENCH_NORM, 1));
    try { fn(); } finally {
      delete _remoteStatus.proxy;
      localStorage.removeItem(MCP_SKILL_APPROVALS_KEY);
      setSkillsCache([]);
    }
  }
  it('bloc et doctrine émis pour une skill MCP approuvée seule, avec ses arguments de lecture', function() {
    setSkillsCache([]);
    withServed(true, function() {
      var b = buildSkillsContextBlock();
      expect(b).toContain('miaou_skills_context');
      expect(b).toContain('[server: proxy] [uri: ' + BENCH_NORM.uri + '] bench — Règle de restitution.');
      expect(b).toContain('lis-les avec miaou__skills__read en passant ces deux valeurs');
      var d = skillDoctrinePrompt();
      expect(d).toContain('server et uri');
    });
  });
  it('skill MCP à approuver : ni bloc ni doctrine', function() {
    setSkillsCache([]);
    withServed(false, function() {
      expect(buildSkillsContextBlock()).toBe('');
      expect(skillDoctrinePrompt()).toBe('');
    });
  });
  it('locales d\'abord, puis MCP ; doctrine locale inchangée sans MCP', function() {
    setSkillsCache([{ slug: 'loc', name: 'Locale', autotrigger: true }]);
    expect(skillDoctrinePrompt()).toBe(SKILL_DOCTRINE_BASE + SKILL_DOCTRINE_CONFIRM_OFF + SKILL_DOCTRINE_TAIL);
    expect(buildSkillsContextBlock().indexOf('[server:')).toBe(-1);
    withServed(true, function() {
      var b = buildSkillsContextBlock();
      expect(b.indexOf('[slug: loc]') >= 0).toBe(true);
      expect(b.indexOf('[slug: loc]') < b.indexOf('[server: proxy]')).toBe(true);
    });
  });
});
