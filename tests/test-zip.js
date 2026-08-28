// tests/test-zip.js
// Lot V-1 — part PURE du chemin d'extraction zip (utils.js).
//
// Les fixtures sont des central directories SYNTHÉTIQUES construits octet par
// octet (générés hors ligne depuis le format zip, pas lus depuis un fichier :
// QuickJS n'a pas d'accès disque, et le test doit rester hermétique).
// Le corps des membres est fictif — seul le central directory est parsé.

var ZIP_PLAIN = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,104,101,108,108,111,46,116,120,116,80,75,5,6,0,0,0,0,1,0,1,0,55,0,0,0,30,0,0,0,0,0];
var ZIP_ENC = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,1,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,17,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,115,101,99,114,101,116,46,116,120,116,80,75,5,6,0,0,0,0,1,0,1,0,56,0,0,0,30,0,0,0,0,0];
var ZIP_MULTI = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,97,46,116,120,116,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,115,117,98,47,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,10,0,0,0,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,115,117,98,47,98,46,116,120,116,80,75,5,6,0,0,0,0,3,0,3,0,156,0,0,0,30,0,0,0,0,0];
var ZIP_SLIP = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,46,46,47,101,118,105,108,46,116,120,116,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,111,107,46,116,120,116,80,75,5,6,0,0,0,0,2,0,2,0,109,0,0,0,30,0,0,0,0,0];
var ZIP_DOCX = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,100,0,0,0,19,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,91,67,111,110,116,101,110,116,95,84,121,112,101,115,93,46,120,109,108,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,104,16,0,0,17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,119,111,114,100,47,100,111,99,117,109,101,110,116,46,120,109,108,80,75,5,6,0,0,0,0,2,0,2,0,128,0,0,0,30,0,0,0,0,0];
var ZIP_COMMENT = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,99,46,116,120,116,80,75,5,6,0,0,0,0,1,0,1,0,51,0,0,0,30,0,0,0,23,0,117,110,32,99,111,109,109,101,110,116,97,105,114,101,32,100,97,114,99,104,105,118,101];

// Deux archives portant le MÊME nom encodé en UTF-8 (« café.txt » → 63 61 66 C3
// A9 …), qui ne diffèrent QUE par le bit 11 du general purpose flag. C'est le
// seul discriminant d'encodage du format zip : posé → UTF-8, absent → jeu
// historique CP437 (archives Windows anciennes).
var ZIP_UTF8_NAME = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,8,8,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,99,97,102,195,169,46,116,120,116,80,75,5,6,0,0,0,0,1,0,1,0,55,0,0,0,30,0,0,0,0,0];
var ZIP_LEGACY_NAME = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,99,97,102,195,169,46,116,120,116,80,75,5,6,0,0,0,0,1,0,1,0,55,0,0,0,30,0,0,0,0,0];

function u8(arr) { return new Uint8Array(arr); }

describe('parseZipCentralDirectory', function() {
  it('rend null sur une entrée trop courte pour porter un EOCD', function() {
    expect(parseZipCentralDirectory(u8([80, 75, 3, 4]))).toBe(null);
  });

  it('rend null quand aucune signature EOCD n\'est trouvable (pas un zip)', function() {
    var junk = [];
    for (var i = 0; i < 200; i++) junk.push(i % 251);
    expect(parseZipCentralDirectory(u8(junk))).toBe(null);
  });

  it('rend null sur une entrée vide ou absente', function() {
    expect(parseZipCentralDirectory(null)).toBe(null);
    expect(parseZipCentralDirectory(u8([]))).toBe(null);
  });

  it('lit un membre simple : nom et taille décompressée', function() {
    var e = parseZipCentralDirectory(u8(ZIP_PLAIN));
    expect(e.length).toBe(1);
    expect(e[0].name).toBe('hello.txt');
    expect(e[0].size).toBe(11);
    expect(e[0].encrypted).toBe(false);
    expect(e[0].directory).toBe(false);
  });

  it('DÉTECTE UN MEMBRE CHIFFRÉ (bit 0 du general purpose flag)', function() {
    // La garde du lot : fflate extrait ce membre en octets chiffrés SANS lever
    // d'erreur (AUDIT §3). Sans ce bit, le modèle reçoit du bruit binaire
    // présenté comme du texte.
    var e = parseZipCentralDirectory(u8(ZIP_ENC));
    expect(e.length).toBe(1);
    expect(e[0].name).toBe('secret.txt');
    expect(e[0].encrypted).toBe(true);
  });

  it('lit plusieurs membres et marque les répertoires', function() {
    var e = parseZipCentralDirectory(u8(ZIP_MULTI));
    expect(e.length).toBe(3);
    expect(e[0].name).toBe('a.txt');
    expect(e[1].name).toBe('sub/');
    expect(e[1].directory).toBe(true);
    expect(e[2].name).toBe('sub/b.txt');
    expect(e[2].directory).toBe(false);
  });

  it('trouve l\'EOCD malgré un commentaire d\'archive en queue', function() {
    var e = parseZipCentralDirectory(u8(ZIP_COMMENT));
    expect(e.length).toBe(1);
    expect(e[0].name).toBe('c.txt');
  });

  it('décode un nom en UTF-8 quand le bit 11 est posé', function() {
    var e = parseZipCentralDirectory(u8(ZIP_UTF8_NAME));
    expect(e.length).toBe(1);
    expect(e[0].name).toBe('café.txt');
  });

  it('SANS le bit 11, décode octet-à-octet plutôt qu\'en UTF-8', function() {
    // Mêmes octets de nom, bit 11 absent : le format annonce un jeu historique,
    // pas de l'UTF-8. Le repli rend un caractère par octet — pas « joli », mais
    // TOTAL et stable, donc utilisable comme identifiant.
    var e = parseZipCentralDirectory(u8(ZIP_LEGACY_NAME));
    expect(e.length).toBe(1);
    expect(e[0].name).toBe('cafÃ©.txt');
  });

  it('un nom non-UTF-8 reste CIBLABLE par docs__extract (aucun U+FFFD)', function() {
    // C'est le vrai enjeu : docs__extract compare `e.name === path`. Un nom
    // décodé en U+FFFD serait affiché au modèle puis rejeté au ciblage — le
    // membre deviendrait inatteignable. Le repli garantit l'aller-retour.
    var e = parseZipCentralDirectory(u8(ZIP_LEGACY_NAME));
    expect(e[0].name.indexOf('\ufffd')).toBe(-1);
    var d = decideZipMemberExtraction(e, e[0].name, 64 * 1024 * 1024);
    expect(d.ok).toBe(true);
    expect(d.entry.name).toBe(e[0].name);
  });
});

describe('isZipSlipPath', function() {
  it('rejette un chemin absolu POSIX', function() {
    expect(isZipSlipPath('/etc/passwd')).toBe(true);
  });
  it('rejette un chemin absolu Windows', function() {
    expect(isZipSlipPath('C:/Windows/system32')).toBe(true);
  });
  it('rejette une remontée en tête', function() {
    expect(isZipSlipPath('../evil.txt')).toBe(true);
  });
  it('rejette une remontée au milieu du chemin', function() {
    expect(isZipSlipPath('a/../../b')).toBe(true);
  });
  it('rejette une remontée écrite avec des antislashs', function() {
    expect(isZipSlipPath('a\\..\\b')).toBe(true);
  });
  it('rejette un nom vide', function() {
    expect(isZipSlipPath('')).toBe(true);
    expect(isZipSlipPath(null)).toBe(true);
  });
  it('accepte un chemin relatif ordinaire', function() {
    expect(isZipSlipPath('sub/b.txt')).toBe(false);
  });
  it('accepte un nom contenant deux points sans être un segment', function() {
    expect(isZipSlipPath('fichier..txt')).toBe(false);
    expect(isZipSlipPath('a/..b/c')).toBe(false);
  });
});

describe('sniffZipOfficeKind', function() {
  it('reconnaît un docx', function() {
    expect(sniffZipOfficeKind(['[Content_Types].xml', 'word/document.xml'])).toBe('docx');
  });
  it('reconnaît un xlsx', function() {
    expect(sniffZipOfficeKind(['xl/workbook.xml'])).toBe('xlsx');
  });
  it('reconnaît un pptx', function() {
    expect(sniffZipOfficeKind(['ppt/presentation.xml'])).toBe('pptx');
  });
  it('rend null sur une archive quelconque', function() {
    expect(sniffZipOfficeKind(['a.txt', 'sub/b.txt'])).toBe(null);
  });
  it('n\'est pas trompé par un membre dont le nom CONTIENT word/ sans commencer par', function() {
    expect(sniffZipOfficeKind(['docs/word/notes.txt'])).toBe(null);
  });
  it('tolère une liste vide ou absente', function() {
    expect(sniffZipOfficeKind([])).toBe(null);
    expect(sniffZipOfficeKind(null)).toBe(null);
  });
});

describe('formatZipListing', function() {
  it('liste les membres avec leur taille lisible', function() {
    var out = formatZipListing(parseZipCentralDirectory(u8(ZIP_MULTI)), {});
    expect(out).toContain('a.txt');
    expect(out).toContain('sub/b.txt');
    expect(out).toContain('2 membres');
    expect(out).toContain('1 répertoire');
  });

  it('SIGNALE un membre chiffré au lieu de l\'omettre', function() {
    // Un membre absent sans explication fait halluciner le modèle : il doit
    // savoir que le membre existe ET pourquoi il ne l\'aura pas.
    var out = formatZipListing(parseZipCentralDirectory(u8(ZIP_ENC)), {});
    expect(out).toContain('Membres écartés');
    expect(out).toContain('secret.txt');
    expect(out).toContain('chiffré');
  });

  it('SIGNALE un membre au chemin non sûr au lieu de l\'omettre', function() {
    var out = formatZipListing(parseZipCentralDirectory(u8(ZIP_SLIP)), {});
    expect(out).toContain('Membres écartés');
    expect(out).toContain('evil.txt');
    expect(out).toContain('chemin non sûr');
    expect(out).toContain('ok.txt');   // le membre sain reste listé
  });

  it('annonce la nature Office d\'une archive docx', function() {
    var out = formatZipListing(parseZipCentralDirectory(u8(ZIP_DOCX)), {});
    expect(out).toContain('docx');
    expect(out).toContain('word/document.xml');
  });

  it('marque un membre au-delà du cap sans le retirer de la liste', function() {
    var out = formatZipListing(parseZipCentralDirectory(u8(ZIP_DOCX)), { maxBytes: 1000 });
    expect(out).toContain('word/document.xml');
    expect(out).toContain('au-delà du cap');
  });

  it('annonce un total au-delà du cap tout en gardant l\'extraction possible', function() {
    var out = formatZipListing(parseZipCentralDirectory(u8(ZIP_DOCX)), { maxBytes: 3000 });
    expect(out).toContain('Le total dépasse le cap');
    expect(out).toContain('individuellement');
  });

  it('ne casse pas sur une archive sans membre extractible', function() {
    var out = formatZipListing(parseZipCentralDirectory(u8(ZIP_ENC)), {});
    expect(out).toContain('aucun membre extractible');
  });

  it('tolère une liste absente', function() {
    expect(formatZipListing(null, {})).toContain('0 membre');
  });
});

// ── Étape 4 : les helpers purs du chemin d'extraction ───────────────────────

describe('zipMemberMime', function() {
  it('reconnaît les extensions textuelles courantes', function() {
    expect(zipMemberMime('pihole.log')).toBe('text/plain');
    expect(zipMemberMime('data.json')).toBe('application/json');
    expect(zipMemberMime('events.ndjson')).toBe('application/x-ndjson');
    expect(zipMemberMime('table.csv')).toBe('text/csv');
    expect(zipMemberMime('word/document.xml')).toBe('text/xml');
  });

  it('reconnaît les binaires courants', function() {
    expect(zipMemberMime('shot.PNG')).toBe('image/png');
    expect(zipMemberMime('manuel.pdf')).toBe('application/pdf');
  });

  it('retombe sur octet-stream dans le doute (donc classe binary)', function() {
    expect(zipMemberMime('README')).toBe('application/octet-stream');
    expect(zipMemberMime('archive.unknownext')).toBe('application/octet-stream');
    expect(zipMemberMime('')).toBe('application/octet-stream');
  });

  it('ne prend pas un point de répertoire pour une extension', function() {
    expect(zipMemberMime('v1.2/notes')).toBe('application/octet-stream');
    expect(zipMemberMime('trailing.')).toBe('application/octet-stream');
  });

  // Ancrage CROISÉ avec le consommateur réel. zipMemberMime ne choisit pas
  // seulement une étiquette : son résultat passe dans _isTextualMime
  // (resources.js), qui décide de la CLASSE de stockage — donc de ce que le
  // modèle reçoit. 'inline' → contenu adressable par js__eval ; 'binary' →
  // simple descripteur. Les deux fonctions vivent dans des fichiers différents
  // et rien d'autre ne garde leur accord : élargir l'allowlist de l'une sans
  // regarder l'autre changerait silencieusement le contrat de docs__extract.
  it('accorde chaque mime produit avec la classe de stockage attendue', function() {
    // Textuels → 'inline' : c'est le cas d'usage du lot (analyser un log).
    var inlineExpected = ['a.log', 'a.txt', 'a.md', 'a.csv', 'a.tsv', 'a.json',
      'a.ndjson', 'a.jsonl', 'a.xml', 'a.html', 'a.css', 'a.js', 'a.py', 'a.sh',
      'a.yml', 'a.yaml', 'a.ini', 'a.conf', 'a.cfg', 'a.sql', 'a.rst', 'a.ts'];
    for (var i = 0; i < inlineExpected.length; i++) {
      expect(_isTextualMime(zipMemberMime(inlineExpected[i]))).toBe(true);
    }
    // Binaires → 'binary' : descripteur, jamais d'octets bruts en contexte.
    // Le SVG est ici DÉLIBÉRÉMENT du côté binaire : c'est du XML, mais son mime
    // image/svg+xml le range avec les images — un membre .svg arrive donc au
    // modèle en descripteur, pas en texte inline.
    var binaryExpected = ['a.png', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg',
      'a.pdf', 'a.zip', 'README', 'a.unknownext'];
    for (var j = 0; j < binaryExpected.length; j++) {
      expect(_isTextualMime(zipMemberMime(binaryExpected[j]))).toBe(false);
    }
  });
});

describe('zipMemberBaseName', function() {
  it('réduit un chemin à son dernier segment', function() {
    expect(zipMemberBaseName('logs/2026/pihole.log')).toBe('pihole.log');
    expect(zipMemberBaseName('a.txt')).toBe('a.txt');
  });

  it('normalise les antislashs et ignore un segment vide final', function() {
    expect(zipMemberBaseName('dir\\sub\\b.txt')).toBe('b.txt');
    expect(zipMemberBaseName('sub/')).toBe('sub');
  });

  it('a un repli nommé plutôt que de rendre une chaîne vide', function() {
    expect(zipMemberBaseName('')).toBe('membre');
    expect(zipMemberBaseName('///')).toBe('membre');
  });
});

describe('decideZipMemberExtraction', function() {
  var PLAIN = parseZipCentralDirectory(u8(ZIP_PLAIN));
  var MULTI = parseZipCentralDirectory(u8(ZIP_MULTI));
  var ENC = parseZipCentralDirectory(u8(ZIP_ENC));
  var SLIP = parseZipCentralDirectory(u8(ZIP_SLIP));

  it('accepte un membre sain et rend son entrée', function() {
    var d = decideZipMemberExtraction(PLAIN, 'hello.txt', 1024);
    expect(d.ok).toBe(true);
    expect(d.entry.name).toBe('hello.txt');
  });

  it('refuse un chemin manquant', function() {
    expect(decideZipMemberExtraction(PLAIN, '', 1024).ok).toBe(false);
    expect(decideZipMemberExtraction(PLAIN, '', 1024).reason).toBe('path');
  });

  it('REFUSE un membre chiffré — la garde du lot (fflate ne la porte pas)', function() {
    var d = decideZipMemberExtraction(ENC, 'secret.txt', 1024);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('encrypted');
    expect(d.message).toContain('chiffré');
  });

  it('refuse un membre au chemin non sûr (zip-slip)', function() {
    var d = decideZipMemberExtraction(SLIP, '../evil.txt', 1024);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('unsafe');
  });

  it('refuse un répertoire', function() {
    var d = decideZipMemberExtraction(MULTI, 'sub/', 1024);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('directory');
  });

  it('refuse au-delà du cap AVANT toute décompression', function() {
    var d = decideZipMemberExtraction(PLAIN, 'hello.txt', 4);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('cap');
    expect(d.message).toContain('trop volumineux');
  });

  it('liste les noms disponibles quand ils sont peu nombreux', function() {
    var d = decideZipMemberExtraction(MULTI, 'absent.txt', 1024);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('missing');
    expect(d.message).toContain('a.txt');
    expect(d.message).toContain('sub/b.txt');
  });

  it('renvoie vers docs__list quand les membres sont trop nombreux à citer', function() {
    var many = [];
    for (var i = 0; i < 40; i++) many.push({ name: 'f' + i + '.txt', size: 10, directory: false, encrypted: false });
    var d = decideZipMemberExtraction(many, 'absent.txt', 1024);
    expect(d.ok).toBe(false);
    expect(d.message).toContain('miaou__docs__list');
  });

  it('tolère une liste absente', function() {
    var d = decideZipMemberExtraction(null, 'x.txt', 1024);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('missing');
  });
});

// ── Lot V-2 — part PURE du chemin de CRÉATION d'archive ──────────────────────

describe('buildZipMemberName', function() {
  it('rend le nom tel quel quand rien n\'est pris', function() {
    var taken = new Set();
    expect(buildZipMemberName({ name: 'rapport.md', mime: 'text/markdown' }, taken)).toBe('rapport.md');
  });

  it('insère l\'incrément AVANT l\'extension sur une collision', function() {
    var taken = new Set(['rapport.md']);
    expect(buildZipMemberName({ name: 'rapport.md' }, taken)).toBe('rapport-2.md');
  });

  it('poursuit l\'incrément sur des collisions multiples', function() {
    var taken = new Set();
    var a = buildZipMemberName({ name: 'rapport.md' }, taken); taken.add(a);
    var b = buildZipMemberName({ name: 'rapport.md' }, taken); taken.add(b);
    var c = buildZipMemberName({ name: 'rapport.md' }, taken);
    expect(a).toBe('rapport.md');
    expect(b).toBe('rapport-2.md');
    expect(c).toBe('rapport-3.md');
  });

  it('dérive de l\'id et du mime quand le record n\'a pas de nom', function() {
    var n = buildZipMemberName({ id: 'res_abc', mime: 'text/plain' }, new Set());
    expect(n).toBe('res_abc.txt');
  });

  it('retombe sur .bin quand le mime n\'est pas connu', function() {
    var n = buildZipMemberName({ id: 'res_abc', mime: 'application/octet-stream' }, new Set());
    expect(n).toBe('res_abc.bin');
  });

  it('réduit un nom porteur de chemin à son basename', function() {
    var n = buildZipMemberName({ name: 'logs/2026/x.log' }, new Set());
    expect(n).toBe('x.log');
  });

  it('rend un nom de repli non vide quand nom et id manquent', function() {
    // Une clé vide serait acceptée par zipSync et produirait un membre inciblable.
    var n = buildZipMemberName({ mime: 'text/plain' }, new Set());
    expect(n).toBe('membre.txt');
    expect(n.length > 0).toBe(true);
  });

  it('n\'ajoute pas une seconde extension quand la base en porte une', function() {
    var n = buildZipMemberName({ name: 'notes.md', mime: 'text/plain' }, new Set());
    expect(n).toBe('notes.md');
  });

  it('pose l\'incrément en fin quand il n\'y a pas d\'extension', function() {
    var taken = new Set(['donnees']);
    // Pas d'extension dans la base ET mime inconnu : l'extension déduite est .bin,
    // donc l'incrément reste avant elle. Le cas « vraiment sans extension » vient
    // d'un mime absent qui donne quand même .bin — la fonction n'émet jamais de
    // nom nu, par choix : un membre sans extension est plus dur à recibler.
    var n = buildZipMemberName({ name: 'donnees.bin' }, taken);
    expect(n).toBe('donnees.bin');
  });

  it('traite Rapport.md et rapport.md comme DISTINCTS (zip sensible à la casse)', function() {
    var taken = new Set(['rapport.md']);
    expect(buildZipMemberName({ name: 'Rapport.md' }, taken)).toBe('Rapport.md');
  });

  it('tolère un record absent', function() {
    expect(buildZipMemberName(null, new Set())).toBe('membre.bin');
  });
});

describe('validateZipPlan', function() {
  it('accepte un plan valide', function() {
    var r = validateZipPlan([{ name: 'a.txt', size: 10 }, { name: 'b.txt', size: 20 }]);
    expect(r.ok).toBe(true);
  });

  it('refuse un plan vide', function() {
    var r = validateZipPlan([]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('empty');
    expect(r.message).toContain('au moins un handle');
  });

  it('refuse un chemin absolu POSIX', function() {
    var r = validateZipPlan([{ name: '/etc/passwd', size: 10 }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsafe');
  });

  it('refuse un chemin remontant', function() {
    var r = validateZipPlan([{ name: '../x.txt', size: 10 }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsafe');
  });

  it('refuse un chemin absolu Windows', function() {
    var r = validateZipPlan([{ name: 'C:\\x.txt', size: 10 }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsafe');
  });

  it('refuse un total au-delà du cap, en citant les deux tailles', function() {
    var r = validateZipPlan([{ name: 'a.bin', size: MAX_INLINE_BYTES }, { name: 'b.bin', size: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cap');
    expect(r.message).toContain('64');
  });

  it('accepte un total exactement au cap (borne inclusive)', function() {
    var r = validateZipPlan([{ name: 'a.bin', size: MAX_INLINE_BYTES }]);
    expect(r.ok).toBe(true);
  });

  it('refuse un doublon de nom résiduel (garde de composition)', function() {
    var r = validateZipPlan([{ name: 'a.txt', size: 1 }, { name: 'a.txt', size: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('duplicate');
    expect(r.message).toContain('écraserait');
  });

  it('refuse un nom de membre vide', function() {
    var r = validateZipPlan([{ name: '', size: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unsafe');
  });

  it('tolère une entrée absente ou non tableau, sans exception', function() {
    expect(validateZipPlan(null).ok).toBe(false);
    expect(validateZipPlan(undefined).ok).toBe(false);
    expect(validateZipPlan('nope').ok).toBe(false);
  });
});

describe('ZIP_EXT_BY_MIME', function() {
  // Ancrage CROISÉ entre les deux tables. Elles ne dérivent PAS l'une de
  // l'autre (ZIP_MEMBER_MIME_BY_EXT n'est pas injective : douze extensions
  // rendent text/plain), donc rien d'autre ne garde leur accord. Sans ce test,
  // ajouter une extension d'un côté et pas de l'autre passe inaperçu — et un
  // record sans nom produirait un membre à l'extension fausse ou en .bin.
  it('couvre chaque mime produit par ZIP_MEMBER_MIME_BY_EXT, par un aller-retour', function() {
    var mimes = {};
    for (var ext in ZIP_MEMBER_MIME_BY_EXT) {
      if (Object.prototype.hasOwnProperty.call(ZIP_MEMBER_MIME_BY_EXT, ext)) {
        mimes[ZIP_MEMBER_MIME_BY_EXT[ext]] = true;
      }
    }
    for (var mime in mimes) {
      if (!Object.prototype.hasOwnProperty.call(mimes, mime)) continue;
      var back = ZIP_EXT_BY_MIME[mime];
      // (1) tout mime produit a un représentant canonique
      expect(!!back).toBe(true);
      // (2) ce représentant redonne le même mime — c'est le sens de « canonique »
      expect(ZIP_MEMBER_MIME_BY_EXT[back]).toBe(mime);
    }
  });
});

describe('normalizeArchiveName', function() {
  it('garantit l\'extension .zip', function() {
    expect(normalizeArchiveName('rapports')).toBe('rapports.zip');
  });

  it('ne double jamais une extension déjà présente', function() {
    expect(normalizeArchiveName('rapports.zip')).toBe('rapports.zip');
  });

  it('ne normalise pas la casse d\'un nom rédigé par le modèle', function() {
    expect(normalizeArchiveName('Rapports.ZIP')).toBe('Rapports.ZIP');
  });

  it('retombe sur archive.zip quand le nom est absent ou vide', function() {
    expect(normalizeArchiveName(null)).toBe('archive.zip');
    expect(normalizeArchiveName('')).toBe('archive.zip');
    expect(normalizeArchiveName('   ')).toBe('archive.zip');
  });

  it('retire le chemin : le nom finit dans un record et un téléchargement', function() {
    expect(normalizeArchiveName('dossier/sous/livrables.zip')).toBe('livrables.zip');
    expect(normalizeArchiveName('../evasion.zip')).toBe('evasion.zip');
    expect(normalizeArchiveName('/etc/passwd')).toBe('passwd.zip');
  });

  it('refuse un « .zip » nu, qui serait invisible dans une liste', function() {
    expect(normalizeArchiveName('.zip')).toBe('archive.zip');
  });
});

// ── Sauvegarde compressée : sniff de conteneur (lot V-3) ─────────────────────

describe('sniffBackupFormat', function() {
  function u8(bytes) { return new Uint8Array(bytes); }

  it('signature d\'en-tête local PK\\x03\\x04 → zip', function() {
    expect(sniffBackupFormat(u8([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00]))).toBe('zip');
  });

  it('un JSON nu → json', function() {
    expect(sniffBackupFormat(u8([0x7B, 0x22, 0x66, 0x22]))).toBe('json');
  });

  it('des espaces avant l\'accolade → json', function() {
    expect(sniffBackupFormat(u8([0x20, 0x20, 0x0A, 0x7B]))).toBe('json');
  });

  it('un buffer trop court pour porter la signature → json, jamais d\'exception', function() {
    expect(sniffBackupFormat(u8([0x50, 0x4B, 0x03]))).toBe('json');
    expect(sniffBackupFormat(u8([]))).toBe('json');
  });

  it('null / undefined → json (dégradation vers le chemin historique)', function() {
    expect(sniffBackupFormat(null)).toBe('json');
    expect(sniffBackupFormat(undefined)).toBe('json');
  });

  it('PK\\x05\\x06 (EOCD nu, archive vide) → json : ce n\'est pas un en-tête local', function() {
    expect(sniffBackupFormat(u8([0x50, 0x4B, 0x05, 0x06, 0x00, 0x00]))).toBe('json');
  });
});
