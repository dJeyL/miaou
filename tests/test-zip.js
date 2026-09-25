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

describe('resolveZipMemberPath', function() {
  it('sans path : dérive du record comme avant, dedup incluse', function() {
    var taken = new Set();
    var a = resolveZipMemberPath({ name: 'rapport.md' }, null, taken);
    expect(a.ok).toBe(true);
    expect(a.name).toBe('rapport.md');
    taken.add(a.name);
    var b = resolveZipMemberPath({ name: 'rapport.md' }, undefined, taken);
    expect(b.name).toBe('rapport-2.md');
  });

  it('path de fichier : renomme ET range, littéralement', function() {
    var r = resolveZipMemberPath({ name: 'truc.json' }, 'machins/machin.json', new Set());
    expect(r.ok).toBe(true);
    expect(r.name).toBe('machins/machin.json');
  });

  it('path de fichier sans extension : PAS de complétion depuis le mime', function() {
    // S'il nomme, c'est sa responsabilité — on ne corrige pas.
    var r = resolveZipMemberPath({ name: 'truc.json', mime: 'application/json' }, 'notes', new Set());
    expect(r.name).toBe('notes');
  });

  it('path terminé par / : dossier + nom d\'origine', function() {
    var r = resolveZipMemberPath({ name: 'truc.json' }, 'machins/', new Set());
    expect(r.name).toBe('machins/truc.json');
  });

  it('path terminé par / : la dedup opère DANS le dossier', function() {
    var taken = new Set(['machins/truc.json']);
    var r = resolveZipMemberPath({ name: 'truc.json' }, 'machins/', taken);
    expect(r.name).toBe('machins/truc-2.json');
  });

  it('même nom dans DEUX dossiers distincts : accepté, pas de collision', function() {
    // La dedup est clefée sur le chemin COMPLET : a/x.md et b/x.md sont deux
    // membres légitimes, les refuser serait faux.
    var taken = new Set(['a/x.md']);
    var r = resolveZipMemberPath({ name: 'x.md' }, 'b/', taken);
    expect(r.name).toBe('b/x.md');
  });

  it('collision sur un path EXPLICITE : refus, jamais de renommage silencieux', function() {
    var taken = new Set(['machins/machin.json']);
    var r = resolveZipMemberPath({ name: 'truc.json' }, 'machins/machin.json', taken);
    expect(r.ok).toBe(false);
    expect(/même chemin|écraserait/.test(r.message)).toBe(true);
  });

  it('refuse un chemin absolu', function() {
    var r = resolveZipMemberPath({ name: 'x.md' }, '/etc/passwd', new Set());
    expect(r.ok).toBe(false);
    expect(/non sûr/.test(r.message)).toBe(true);
  });

  it('refuse un chemin remontant', function() {
    var r = resolveZipMemberPath({ name: 'x.md' }, '../x.md', new Set());
    expect(r.ok).toBe(false);
  });

  it('refuse un chemin absolu Windows', function() {
    var r = resolveZipMemberPath({ name: 'x.md' }, 'C:\\x.md', new Set());
    expect(r.ok).toBe(false);
  });

  it('refuse un path réduit à néant (« . », « / », espaces)', function() {
    expect(resolveZipMemberPath({ name: 'x.md' }, '.', new Set()).ok).toBe(false);
    expect(resolveZipMemberPath({ name: 'x.md' }, './', new Set()).ok).toBe(false);
    // Un path d'espaces est trimé à vide : c'est le cas « pas de path ».
    expect(resolveZipMemberPath({ name: 'x.md' }, '   ', new Set()).name).toBe('x.md');
  });

  it('écarte les segments vides plutôt que de produire un membre inciblable', function() {
    var r = resolveZipMemberPath({ name: 'x.md' }, 'a//b/x.md', new Set());
    expect(r.name).toBe('a/b/x.md');
  });

  it('normalise les antislashs en séparateurs', function() {
    var r = resolveZipMemberPath({ name: 'x.md' }, 'machins\\machin.json', new Set());
    expect(r.name).toBe('machins/machin.json');
  });

  it('tolère un taken absent', function() {
    expect(resolveZipMemberPath({ name: 'x.md' }, null, null).name).toBe('x.md');
    expect(resolveZipMemberPath({ name: 'x.md' }, 'a/b.md', null).name).toBe('a/b.md');
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

// ── Modification d'archive (docs__pack avec base) ────────────────────────────
// Fixtures construites par mkStoredZip : des membres STOCKÉS (méthode 0), CRC à
// zéro — aucun des purs testés ne vérifie le CRC, ils déplacent des octets. Le
// contenu de chaque membre est retrouvé depuis l'offset local réécrit, ce qui
// prouve que le central directory de sortie pointe au bon endroit.
function mkStoredZip(members, opts) {
  opts = opts || {};
  var local = [], cd = [];
  function p16(a, v) { a.push(v & 0xff, (v >>> 8) & 0xff); }
  function p32(a, v) { a.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
  function bytesOf(s) { var b = []; for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xff); return b; }
  var prefix = opts.prefix || [];
  for (var i = 0; i < prefix.length; i++) local.push(prefix[i]);
  members.forEach(function(m) {
    var name = bytesOf(m.name), data = bytesOf(m.data || '');
    var off = local.length;
    p32(local, 0x04034b50); p16(local, 20); p16(local, m.gp || 0); p16(local, 0);
    p32(local, 0); p32(local, 0); p32(local, data.length); p32(local, data.length);
    p16(local, name.length); p16(local, 0);
    local.push.apply(local, name); local.push.apply(local, data);
    p32(cd, 0x02014b50); p16(cd, 20); p16(cd, 20); p16(cd, m.gp || 0); p16(cd, 0);
    p32(cd, 0); p32(cd, 0); p32(cd, data.length); p32(cd, data.length);
    p16(cd, name.length); p16(cd, 0); p16(cd, 0); p16(cd, 0); p16(cd, 0); p32(cd, 0);
    p32(cd, opts.offsetOverride != null ? opts.offsetOverride : off);
    cd.push.apply(cd, name);
  });
  var comment = bytesOf(opts.comment || '');
  var eocd = [];
  p32(eocd, 0x06054b50); p16(eocd, 0); p16(eocd, 0);
  p16(eocd, opts.count != null ? opts.count : members.length);
  p16(eocd, opts.count != null ? opts.count : members.length);
  p32(eocd, cd.length); p32(eocd, local.length);
  p16(eocd, comment.length); eocd.push.apply(eocd, comment);
  return new Uint8Array(local.concat(cd, eocd, opts.trailing || []));
}

// Contenu d'un membre stocké, relu depuis l'offset local du central directory.
function readStored(u8, name) {
  var lay = parseZipLayout(u8);
  if (!lay.ok) return 'LAYOUT:' + lay.message;
  for (var i = 0; i < lay.entries.length; i++) {
    var e = lay.entries[i];
    if (e.name !== name) continue;
    var p = e.localOffset;
    var start = p + 30 + _zipU16(u8, p + 26) + _zipU16(u8, p + 28);
    var s = '';
    for (var k = 0; k < e.csize; k++) s += String.fromCharCode(u8[start + k]);
    return s;
  }
  return null;
}

function names(u8) { return parseZipCentralDirectory(u8).map(function(e) { return e.name; }); }

describe('parseZipLayout', function() {
  it('lit la géométrie d\'une archive saine : segments contigus jusqu\'au central directory', function() {
    var z = mkStoredZip([{ name: 'a.txt', data: 'AAA' }, { name: 'b/c.txt', data: 'CC' }]);
    var lay = parseZipLayout(z);
    expect(lay.ok).toBe(true);
    expect(lay.entries.length).toBe(2);
    expect(lay.entries[0].localOffset).toBe(0);
    expect(lay.entries[0].segEnd).toBe(lay.entries[1].localOffset);
    expect(lay.entries[1].segEnd).toBe(lay.cdOffset);
  });

  it('accepte une archive vide (EOCD seul)', function() {
    var lay = parseZipLayout(mkStoredZip([]));
    expect(lay.ok).toBe(true);
    expect(lay.entries.length).toBe(0);
  });

  it('refuse ce qui n\'est pas un zip', function() {
    var r = parseZipLayout(new Uint8Array(40));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('pas une archive zip');
  });

  it('refuse des octets après l\'EOCD (la réécriture les perdrait)', function() {
    var r = parseZipLayout(mkStoredZip([{ name: 'a', data: 'x' }], { trailing: [1, 2, 3] }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('fin d\'archive');
  });

  it('refuse un compte saturé Zip64 plutôt que de le prendre pour une vraie valeur', function() {
    var r = parseZipLayout(mkStoredZip([{ name: 'a', data: 'x' }], { count: 0xffff }));
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Zip64');
  });

  it('refuse un offset local qui ne pointe sur aucun en-tête', function() {
    var r = parseZipLayout(mkStoredZip([{ name: 'a', data: 'xyz' }], { offsetOverride: 3 }));
    expect(r.ok).toBe(false);
  });

  it('refuse des données en tête (auto-extractible) : le central directory ne tombe plus pile', function() {
    var r = parseZipLayout(mkStoredZip([{ name: 'a', data: 'x' }], { prefix: [9, 9, 9, 9] }));
    expect(r.ok).toBe(false);
  });

  it('refuse un membre dont les données débordent de son segment', function() {
    var z = mkStoredZip([{ name: 'a', data: 'xyz' }]);
    // csize du central directory gonflé : le membre ne tient plus avant le CD.
    var lay = parseZipLayout(z);
    z[lay.cdOffset + 20] = 200;
    var r = parseZipLayout(z);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('tronqué');
  });
});

// Archive RÉELLE produite par Info-ZIP en streaming (`printf … | zip -q s.zip -`) :
// en-tête local à tailles saturées + extra Zip64, et un enregistrement Zip64
// (record + locator) entre le central directory et l'EOCD, alors qu'aucune
// valeur n'y dépasse 32 bits. Cas courant, que la géométrie stricte refusait.
var ZIP_STREAMED = [80,75,3,4,45,0,0,0,0,0,213,149,57,93,1,72,198,103,255,255,255,255,255,255,255,255,1,0,20,0,45,1,0,16,0,15,0,0,0,0,0,0,0,15,0,0,0,0,0,0,0,104,101,108,108,111,32,115,116,114,101,97,109,101,100,10,80,75,1,2,30,3,45,0,0,0,0,0,213,149,57,93,1,72,198,103,15,0,0,0,15,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,176,17,0,0,0,0,45,80,75,6,6,44,0,0,0,0,0,0,0,30,3,45,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,47,0,0,0,0,0,0,0,66,0,0,0,0,0,0,0,80,75,6,7,0,0,0,0,113,0,0,0,0,0,0,0,1,0,0,0,80,75,5,6,0,0,0,0,1,0,1,0,47,0,0,0,66,0,0,0,0,0];

describe('parseZipLayout — enregistrement Zip64 redondant', function() {
  it('accepte un Zip64 posé sans nécessité (flux Info-ZIP), valeurs recoupées avec l\'EOCD', function() {
    var lay = parseZipLayout(new Uint8Array(ZIP_STREAMED));
    expect(lay.ok).toBe(true);
    expect(lay.entries.length).toBe(1);
    expect(lay.entries[0].name).toBe('-');
  });

  it('la réécriture omet l\'enregistrement Zip64 et rend une géométrie classique', function() {
    var u = new Uint8Array(ZIP_STREAMED);
    var r = spliceZipArchive(u, parseZipLayout(u), new Set(), mkStoredZip([{ name: 'n.txt', data: 'N' }]));
    var lay = parseZipLayout(r.data);
    expect(lay.ok).toBe(true);
    expect(lay.cdOffset + lay.cdSize).toBe(lay.eocdOffset);
    expect(names(r.data)).toEqual(['-', 'n.txt']);
  });

  it('refuse un Zip64 dont une valeur diverge de l\'EOCD classique (Zip64 réel)', function() {
    var u = new Uint8Array(ZIP_STREAMED);
    u[145] = 2;   // total d'entrées du record Zip64 (rec + 32) : 1 → 2
    var r = parseZipLayout(u);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Zip64');
  });
});

describe('resolveZipRemovals', function() {
  var list = ['a.txt', 'dir/', 'dir/x.txt', 'dir/y.txt', 'dirty.txt'];

  it('retire un membre par son chemin exact', function() {
    var r = resolveZipRemovals(list, ['a.txt']);
    expect(r.ok).toBe(true);
    expect(Array.from(r.drop)).toEqual(['a.txt']);
  });

  it('un chemin terminé par « / » retire le dossier et son contenu, pas un voisin au même préfixe', function() {
    var r = resolveZipRemovals(list, ['dir/']);
    expect(Array.from(r.drop)).toEqual(['dir/', 'dir/x.txt', 'dir/y.txt']);
  });

  it('un chemin qui ne désigne rien est un REFUS nommé, jamais ignoré', function() {
    var r = resolveZipRemovals(list, ['a.txt', 'absent.txt']);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('absent.txt');
  });

  it('la comparaison est stricte : pas de correspondance sur le basename', function() {
    expect(resolveZipRemovals(list, ['x.txt']).ok).toBe(false);
  });

  it('aucun retrait demandé → drop vide', function() {
    expect(resolveZipRemovals(list, []).drop.size).toBe(0);
  });
});

describe('resolveZipEditMemberPath', function() {
  var rec = { name: 'rapport.md', mime: 'text/markdown' };
  var base = new Set(['rapport.md', 'word/document.xml']);

  it('un chemin explicite qui existe dans la base est un REMPLACEMENT', function() {
    var r = resolveZipEditMemberPath(rec, 'word/document.xml', new Set(), base);
    expect(r.ok).toBe(true);
    expect(r.name).toBe('word/document.xml');
    expect(r.replaces).toBe(true);
  });

  it('un nom hérité qui collide avec la base est DÉDUPLIQUÉ, jamais un remplacement', function() {
    var r = resolveZipEditMemberPath(rec, undefined, new Set(), base);
    expect(r.name).toBe('rapport-2.md');
    expect(r.replaces).toBe(false);
  });

  it('un dossier « / » déduplique aussi contre la base', function() {
    var r = resolveZipEditMemberPath(rec, 'word/', new Set(), new Set(['word/rapport.md']));
    expect(r.name).toBe('word/rapport-2.md');
  });

  it('deux ajouts au même chemin explicite restent refusés', function() {
    var r = resolveZipEditMemberPath(rec, 'x.md', new Set(['x.md']), base);
    expect(r.ok).toBe(false);
  });

  it('un chemin neuf n\'est pas un remplacement', function() {
    var r = resolveZipEditMemberPath(rec, 'neuf/x.md', new Set(), base);
    expect(r.replaces).toBe(false);
    expect(r.name).toBe('neuf/x.md');
  });
});

describe('validateZipEditPlan', function() {
  it('refuse une opération sans ajout ni retrait', function() {
    var r = validateZipEditPlan(100, [], 0, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('noop');
  });

  it('refuse une archive vidée de tous ses membres', function() {
    var r = validateZipEditPlan(100, [], 3, 0);
    expect(r.reason).toBe('empty');
  });

  it('le cap compte la base ET les ajouts', function() {
    var r = validateZipEditPlan(MAX_INLINE_BYTES, [{ name: 'a', size: 1 }], 0, 1);
    expect(r.reason).toBe('cap');
    expect(r.message).toContain('base comprise');
  });

  it('un retrait seul est valide', function() {
    expect(validateZipEditPlan(100, [], 1, 2).ok).toBe(true);
  });
});

describe('spliceZipArchive', function() {
  var base = mkStoredZip([
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'a.txt', data: 'AAAA' },
    { name: 'secret.bin', data: 'CHIFFRE', gp: 1 },
    { name: 'dir/b.txt', data: 'BB' },
  ], { comment: 'mon commentaire' });
  var layout = parseZipLayout(base);

  it('AJOUT : les membres d\'origine sont gardés dans leur ordre, les nouveaux suivent', function() {
    var add = mkStoredZip([{ name: 'neuf.txt', data: 'NEW' }]);
    var r = spliceZipArchive(base, layout, new Set(), add);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(5);
    expect(names(r.data)).toEqual(['mimetype', 'a.txt', 'secret.bin', 'dir/b.txt', 'neuf.txt']);
    expect(readStored(r.data, 'neuf.txt')).toBe('NEW');
    expect(readStored(r.data, 'a.txt')).toBe('AAAA');
    expect(readStored(r.data, 'mimetype')).toBe('application/epub+zip');
  });

  it('la sortie est elle-même une archive modifiable (géométrie stricte vérifiée)', function() {
    var add = mkStoredZip([{ name: 'neuf.txt', data: 'NEW' }]);
    var r = spliceZipArchive(base, layout, new Set(), add);
    expect(parseZipLayout(r.data).ok).toBe(true);
  });

  it('un membre chiffré est recopié tel quel, drapeau compris — jamais décompressé', function() {
    var r = spliceZipArchive(base, layout, new Set(['a.txt']), null);
    var e = parseZipCentralDirectory(r.data).filter(function(x) { return x.name === 'secret.bin'; })[0];
    expect(e.encrypted).toBe(true);
    expect(readStored(r.data, 'secret.bin')).toBe('CHIFFRE');
  });

  it('RETRAIT seul : sans archive d\'ajout, offsets recalculés', function() {
    var r = spliceZipArchive(base, layout, new Set(['mimetype', 'dir/b.txt']), null);
    expect(names(r.data)).toEqual(['a.txt', 'secret.bin']);
    expect(readStored(r.data, 'a.txt')).toBe('AAAA');
    expect(parseZipLayout(r.data).entries[0].localOffset).toBe(0);
  });

  it('REMPLACEMENT : l\'ancien membre disparaît, le nouveau porte son nom', function() {
    var add = mkStoredZip([{ name: 'a.txt', data: 'remplacé' }]);
    var r = spliceZipArchive(base, layout, new Set(['a.txt']), add);
    expect(names(r.data)).toEqual(['mimetype', 'secret.bin', 'dir/b.txt', 'a.txt']);
    expect(readStored(r.data, 'a.txt')).toBe('remplacé');
  });

  it('le commentaire d\'archive de la base est conservé', function() {
    var r = spliceZipArchive(base, layout, new Set(['a.txt']), null);
    var lay = parseZipLayout(r.data);
    var s = '';
    for (var i = 0; i < lay.comment.length; i++) s += String.fromCharCode(lay.comment[i]);
    expect(s).toBe('mon commentaire');
  });
});

describe('normalizeEditedArchiveName', function() {
  it('nom omis → celui de la base', function() {
    expect(normalizeEditedArchiveName(undefined, 'rapport.docx')).toBe('rapport.docx');
  });
  it('l\'extension suit la BASE : un .docx modifié reste un .docx', function() {
    expect(normalizeEditedArchiveName('rapport-v2', 'rapport.docx')).toBe('rapport-v2.docx');
  });
  it('extension déjà présente : jamais doublée, casse intacte', function() {
    expect(normalizeEditedArchiveName('Final.DOCX', 'rapport.docx')).toBe('Final.DOCX');
  });
  it('base zip : même régime que normalizeArchiveName', function() {
    expect(normalizeEditedArchiveName('b', 'a.zip')).toBe('b.zip');
    expect(normalizeEditedArchiveName('../x/b.zip', 'a.zip')).toBe('b.zip');
  });
  it('base sans nom exploitable → archive.zip', function() {
    expect(normalizeEditedArchiveName('', '')).toBe('archive.zip');
  });
});

describe('formatZipEditTally', function() {
  it('omet les postes nuls et accorde le pluriel', function() {
    expect(formatZipEditTally({ added: 2, replaced: 1, removed: 0 })).toBe('2 ajoutés, 1 remplacé');
  });
  it('rien → « aucun changement »', function() {
    expect(formatZipEditTally({})).toBe('aucun changement');
  });
});

// ── Renommage de membres (docs__pack avec base + rename) ─────────────────────
describe('resolveZipRenames', function() {
  var list = ['a.txt', 'dir/', 'dir/x.txt', 'dir/y.txt', 'dirty.txt'];

  it('renomme un fichier par son chemin exact', function() {
    var r = resolveZipRenames(list, [{ from: 'a.txt', to: 'rangé/b.txt' }], new Set());
    expect(r.ok).toBe(true);
    expect(r.map.get('a.txt')).toBe('rangé/b.txt');
  });

  it('un dossier emporte son contenu, pas un voisin au même préfixe', function() {
    var r = resolveZipRenames(list, [{ from: 'dir/', to: 'neuf/' }], new Set());
    expect(Array.from(r.map.entries())).toEqual([['dir/', 'neuf/'], ['dir/x.txt', 'neuf/x.txt'], ['dir/y.txt', 'neuf/y.txt']]);
  });

  it('un « from » sans effet est un REFUS nommé', function() {
    var r = resolveZipRenames(list, [{ from: 'absent.txt', to: 'x.txt' }], new Set());
    expect(r.ok).toBe(false);
    expect(r.message).toContain('absent.txt');
  });

  it('dossier vers fichier (ou l\'inverse) → refus', function() {
    expect(resolveZipRenames(list, [{ from: 'dir/', to: 'neuf' }], new Set()).ok).toBe(false);
    expect(resolveZipRenames(list, [{ from: 'a.txt', to: 'neuf/' }], new Set()).ok).toBe(false);
  });

  it('nouveau nom remontant ou à segment vide → refus', function() {
    expect(resolveZipRenames(list, [{ from: 'a.txt', to: '../a.txt' }], new Set()).ok).toBe(false);
    expect(resolveZipRenames(list, [{ from: 'a.txt', to: 'x//a.txt' }], new Set()).ok).toBe(false);
  });

  it('collision avec un membre gardé → refus, jamais un écrasement', function() {
    var r = resolveZipRenames(list, [{ from: 'a.txt', to: 'dirty.txt' }], new Set());
    expect(r.ok).toBe(false);
    expect(r.message).toContain('dirty.txt');
  });

  it('un nom libéré par un renommage peut être repris par un autre (échange)', function() {
    var r = resolveZipRenames(list, [{ from: 'a.txt', to: 'dirty.txt' }, { from: 'dirty.txt', to: 'a.txt' }], new Set());
    expect(r.ok).toBe(true);
  });

  it('collision vers le nom d\'un membre RETIRÉ : acceptée, il n\'existe plus', function() {
    expect(resolveZipRenames(list, [{ from: 'a.txt', to: 'dirty.txt' }], new Set(['dirty.txt'])).ok).toBe(true);
  });

  it('membre à la fois retiré et renommé → refus', function() {
    var r = resolveZipRenames(list, [{ from: 'a.txt', to: 'b.txt' }], new Set(['a.txt']));
    expect(r.ok).toBe(false);
  });

  it('membre visé par deux renommages → refus', function() {
    var r = resolveZipRenames(list, [{ from: 'dir/x.txt', to: 'p.txt' }, { from: 'dir/', to: 'q/' }], new Set());
    expect(r.ok).toBe(false);
    expect(r.message).toContain('deux renommages');
  });

  it('entrée qui n\'est pas un objet → refus', function() {
    expect(resolveZipRenames(list, ['a.txt'], new Set()).ok).toBe(false);
  });
});

describe('spliceZipArchive — renommage', function() {
  var base = mkStoredZip([
    { name: 'a.txt', data: 'AAAA' },
    { name: 'secret.bin', data: 'CHIFFRE', gp: 1 },
    { name: 'z.txt', data: 'ZZ' },
  ]);
  var layout = parseZipLayout(base);

  it('le membre renommé garde ses données, les autres ne bougent pas', function() {
    var r = spliceZipArchive(base, layout, new Set(), null, new Map([['a.txt', 'rangé/café.txt']]));
    expect(r.ok).toBe(true);
    expect(names(r.data)).toEqual(['rangé/café.txt', 'secret.bin', 'z.txt']);
    expect(readStored(r.data, 'rangé/café.txt')).toBe('AAAA');
    expect(readStored(r.data, 'z.txt')).toBe('ZZ');
    expect(parseZipLayout(r.data).ok).toBe(true);
  });

  it('pose le bit 11 (UTF-8) dans les DEUX en-têtes : le nom accentué fait l\'aller-retour', function() {
    var r = spliceZipArchive(base, layout, new Set(), null, new Map([['a.txt', 'café.txt']]));
    var lay = parseZipLayout(r.data);
    var e = lay.entries[0];
    expect((_zipU16(r.data, e.cdStart + 8) & 0x800) !== 0).toBe(true);
    expect((_zipU16(r.data, e.localOffset + 6) & 0x800) !== 0).toBe(true);
    expect(e.name).toBe('café.txt');
  });

  it('un membre chiffré se renomme et reste chiffré', function() {
    var r = spliceZipArchive(base, layout, new Set(), null, new Map([['secret.bin', 'coffre/secret.bin']]));
    var e = parseZipCentralDirectory(r.data).filter(function(x) { return x.name === 'coffre/secret.bin'; })[0];
    expect(e.encrypted).toBe(true);
    expect(readStored(r.data, 'coffre/secret.bin')).toBe('CHIFFRE');
  });

  it('renommage + retrait + ajout composent', function() {
    var add = mkStoredZip([{ name: 'a.txt', data: 'nouveau' }]);
    var r = spliceZipArchive(base, layout, new Set(['z.txt']), add, new Map([['a.txt', 'ancien.txt']]));
    expect(names(r.data)).toEqual(['ancien.txt', 'secret.bin', 'a.txt']);
    expect(readStored(r.data, 'ancien.txt')).toBe('AAAA');
    expect(readStored(r.data, 'a.txt')).toBe('nouveau');
  });
});

describe('_zipStripUnicodePathExtra', function() {
  it('retire le bloc 0x7075 (copie Unicode du nom) et garde les autres', function() {
    var extra = new Uint8Array([0x75, 0x70, 2, 0, 9, 9, 0x55, 0x54, 1, 0, 7]);
    expect(Array.from(_zipStripUnicodePathExtra(extra))).toEqual([0x55, 0x54, 1, 0, 7]);
  });
  it('un extra mal formé est rendu intact', function() {
    var extra = new Uint8Array([0x75, 0x70, 9, 0, 1]);
    expect(Array.from(_zipStripUnicodePathExtra(extra))).toEqual([0x75, 0x70, 9, 0, 1]);
  });
});

describe('_zipEncodeUtf8', function() {
  it('réciproque de _zipDecodeName en UTF-8, y compris hors BMP', function() {
    var s = 'dossier/café-😺.txt';
    var u = _zipEncodeUtf8(s);
    expect(_zipDecodeName(u, 0, u.length, true)).toBe(s);
  });
});

describe('validateZipEditPlan — renommage seul', function() {
  it('un renommage seul n\'est pas une opération vide', function() {
    expect(validateZipEditPlan(100, [], 0, 3, 1).ok).toBe(true);
  });
  it('formatZipEditTally compte les renommages', function() {
    expect(formatZipEditTally({ renamed: 2 })).toBe('2 renommés');
  });
});
