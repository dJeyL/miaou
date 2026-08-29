// tests/test-docs.js
// Lot V-4 — part PURE du chemin « document natif » (docs.js depuis V-7, où le
// domaine a reçu son fichier) : reconnaissance de type aux octets, selector
// d'unité, mise en forme du listing PDF.
//
// Même posture de fixture que test-zip.js : les archives sont des central
// directories SYNTHÉTIQUES construits octet par octet (QuickJS n'a pas d'accès
// disque, le test doit rester hermétique). Les deux fixtures zip reprises ici
// sont celles de test-zip.js — chaque fichier de test est évalué SÉPARÉMENT par
// le runner, une variable d'un autre fichier n'y est pas visible.

var DOC_ZIP_PLAIN = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,11,0,0,0,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,104,101,108,108,111,46,116,120,116,80,75,5,6,0,0,0,0,1,0,1,0,55,0,0,0,30,0,0,0,0,0];
var DOC_ZIP_DOCX = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,100,0,0,0,19,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,91,67,111,110,116,101,110,116,95,84,121,112,101,115,93,46,120,109,108,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,104,16,0,0,17,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,119,111,114,100,47,100,111,99,117,109,101,110,116,46,120,109,108,80,75,5,6,0,0,0,0,2,0,2,0,128,0,0,0,30,0,0,0,0,0];

function du8(arr) { return new Uint8Array(arr); }

// « %PDF-1.7\n » — seuls les quatre premiers octets décident.
var PDF_HEAD = [0x25,0x50,0x44,0x46,0x2D,0x31,0x2E,0x37,0x0A];

describe('sniffDocumentKind', function() {
  it('un en-tête %PDF → pdf', function() {
    expect(sniffDocumentKind(du8(PDF_HEAD), 'rapport.pdf')).toBe('pdf');
  });

  it('le nom ne décide rien : des octets PDF sous un nom .zip restent pdf', function() {
    expect(sniffDocumentKind(du8(PDF_HEAD), 'archive.zip')).toBe('pdf');
  });

  it('un zip ordinaire → zip', function() {
    expect(sniffDocumentKind(du8(DOC_ZIP_PLAIN), 'logs.zip')).toBe('zip');
  });

  it('un zip à membre word/ → docx, jamais zip (routage V-5)', function() {
    expect(sniffDocumentKind(du8(DOC_ZIP_DOCX), 'note.docx')).toBe('docx');
  });

  it('le nom ne décide rien non plus dans l\'autre sens : un docx nommé .zip reste docx', function() {
    expect(sniffDocumentKind(du8(DOC_ZIP_DOCX), 'truc.zip')).toBe('docx');
  });

  it('signature zip mais central directory illisible → null, jamais une exception', function() {
    expect(sniffDocumentKind(du8([0x50,0x4B,0x03,0x04,0x00,0x00,0x00,0x00]), 'tronque.zip')).toBe(null);
  });

  it('du texte quelconque → null', function() {
    expect(sniffDocumentKind(du8([0x7B,0x22,0x61,0x22,0x3A,0x31,0x7D]), 'data.json')).toBe(null);
  });

  it('trop court pour porter une signature → null', function() {
    expect(sniffDocumentKind(du8([0x25,0x50,0x44]), 'x.pdf')).toBe(null);
    expect(sniffDocumentKind(du8([]), 'vide')).toBe(null);
  });

  it('null / undefined → null (dégradation, jamais d\'exception)', function() {
    expect(sniffDocumentKind(null, 'x')).toBe(null);
    expect(sniffDocumentKind(undefined, 'x')).toBe(null);
  });
});

describe('formatNativeDocKindsLabel', function() {
  it('un seul format', function() {
    expect(formatNativeDocKindsLabel(['zip'])).toBe('le zip');
  });

  it('deux formats sont joints par « et »', function() {
    expect(formatNativeDocKindsLabel(['zip', 'pdf'])).toBe('les zip et pdf');
  });

  it('trois formats ou plus : virgules puis « et »', function() {
    expect(formatNativeDocKindsLabel(['zip', 'pdf', 'docx'])).toBe('les zip, pdf et docx');
  });

  it('les doublons sont écrasés (le zip ne doit pas s\'annoncer deux fois)', function() {
    expect(formatNativeDocKindsLabel(['zip', 'zip', 'pdf'])).toBe('les zip et pdf');
  });

  it('une liste vide se dit, elle ne rend pas une phrase tronquée', function() {
    expect(formatNativeDocKindsLabel([])).toBe('aucun format');
    expect(formatNativeDocKindsLabel(null)).toBe('aucun format');
  });

  it('les entrées vides sont ignorées', function() {
    expect(formatNativeDocKindsLabel(['zip', '', null, '  '])).toBe('le zip');
  });
});

describe('parsePageSelector', function() {
  it('\'N\' → une unité unique', function() {
    var r = parsePageSelector('3', 10);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(3);
    expect(r.end).toBe(3);
    expect(r.notice).toBe('');
  });

  it('\'N-M\' → plage inclusive', function() {
    var r = parsePageSelector('2-5', 10);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(2);
    expect(r.end).toBe(5);
    expect(r.notice).toBe('');
  });

  it('la plage entière du document ne produit aucune notice', function() {
    var r = parsePageSelector('1-10', 10);
    expect(r.ok).toBe(true);
    expect(r.notice).toBe('');
  });

  it('un dépassement haut est CLAMPÉ et la notice le dit (FMT4)', function() {
    var r = parsePageSelector('5-100', 10);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(5);
    expect(r.end).toBe(10);
    expect(r.notice.indexOf('ramenée à 5-10') > -1).toBe(true);
    expect(r.notice.indexOf('demandé : 5-100') > -1).toBe(true);
  });

  it('un dépassement bas est clampé à 1 avec notice', function() {
    var r = parsePageSelector('0-3', 10);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(1);
    expect(r.end).toBe(3);
    expect(r.notice.indexOf('ramenée à 1-3') > -1).toBe(true);
  });

  it('une plage entièrement hors document est REFUSÉE, jamais clampée en vide', function() {
    var r = parsePageSelector('50-60', 10);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf('10 unité(s)') > -1).toBe(true);
  });

  it('une plage inversée est refusée', function() {
    expect(parsePageSelector('7-3', 10).ok).toBe(false);
  });

  it('\'page 3\' est refusé, et le refus RAPPELLE la forme attendue', function() {
    var r = parsePageSelector('page 3', 10);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf("'N' ou 'N-M'") > -1).toBe(true);
  });

  it('les autres formes invalides sont refusées', function() {
    expect(parsePageSelector('3,5', 10).ok).toBe(false);
    expect(parsePageSelector('-3', 10).ok).toBe(false);
    expect(parsePageSelector('3-', 10).ok).toBe(false);
    expect(parsePageSelector('', 10).ok).toBe(false);
    expect(parsePageSelector(null, 10).ok).toBe(false);
  });

  it('les espaces autour du tiret et aux bords sont tolérés', function() {
    var r = parsePageSelector(' 2 - 4 ', 10);
    expect(r.ok).toBe(true);
    expect(r.start).toBe(2);
    expect(r.end).toBe(4);
  });

  it('un document sans unité refuse tout selector', function() {
    expect(parsePageSelector('1', 0).ok).toBe(false);
  });
});

describe('formatPdfListing', function() {
  it('compte de pages et sommaire, comme le serveur', function() {
    var s = formatPdfListing({ pages: 12, outline: [
      { level: 1, title: 'Chapitre A', page: 1 },
      { level: 1, title: 'Chapitre B', page: 4 }
    ] });
    expect(s.indexOf('PDF — 12 pages') > -1).toBe(true);
    expect(s.indexOf('Sommaire :') > -1).toBe(true);
    expect(s.indexOf('- p.1 Chapitre A') > -1).toBe(true);
    expect(s.indexOf('- p.4 Chapitre B') > -1).toBe(true);
  });

  it('l\'absence de sommaire est DITE, jamais silencieuse', function() {
    var s = formatPdfListing({ pages: 3 });
    expect(s.indexOf('(pas de sommaire)') > -1).toBe(true);
  });

  it('un niveau imbriqué est indenté', function() {
    var s = formatPdfListing({ pages: 5, outline: [
      { level: 1, title: 'Racine', page: 1 },
      { level: 2, title: 'Fille', page: 2 }
    ] });
    expect(s.indexOf('\n- p.1 Racine') > -1).toBe(true);
    expect(s.indexOf('\n  - p.2 Fille') > -1).toBe(true);
  });

  it('titre et auteur enrichissent l\'en-tête quand ils existent', function() {
    var s = formatPdfListing({ pages: 8, title: 'Sprint Review', author: 'NS3' });
    expect(s.indexOf('PDF — 8 pages, « Sprint Review » (NS3)') > -1).toBe(true);
  });

  it('un auteur sans titre reste lisible', function() {
    var s = formatPdfListing({ pages: 2, author: 'NS3' });
    expect(s.indexOf('PDF — 2 pages, NS3') > -1).toBe(true);
  });

  it('le producteur est annoncé sur sa propre ligne', function() {
    var s = formatPdfListing({ pages: 2, producer: 'Microsoft® PowerPoint®' });
    expect(s.indexOf('\nProduit par : Microsoft® PowerPoint®') > -1).toBe(true);
  });

  it('des métadonnées vides ne produisent AUCUN champ vide', function() {
    var s = formatPdfListing({ pages: 4, title: '', author: '   ', producer: null });
    expect(s.indexOf('PDF — 4 pages\n') > -1).toBe(true);
    expect(s.indexOf('«') > -1).toBe(false);
    expect(s.indexOf('Produit par') > -1).toBe(false);
  });

  it('une seule page se dit au singulier', function() {
    expect(formatPdfListing({ pages: 1 }).indexOf('PDF — 1 page\n') > -1).toBe(true);
  });

  it('une entrée de sommaire sans titre est ignorée, jamais rendue en puce vide', function() {
    var s = formatPdfListing({ pages: 3, outline: [
      { level: 1, title: '', page: 1 },
      { level: 1, title: 'Vrai', page: 2 }
    ] });
    expect(s.indexOf('- p.2 Vrai') > -1).toBe(true);
    expect(s.indexOf('- p.1 ') > -1).toBe(false);
  });

  it('info absent → pas d\'exception', function() {
    expect(formatPdfListing(null).indexOf('PDF — 0 page') > -1).toBe(true);
  });
});

describe('joinPdfTextItems', function() {
  it('hasEOL pose le saut de ligne (le piège des phrases collées)', function() {
    var out = joinPdfTextItems([
      { str: 'Premiere ligne.', hasEOL: true },
      { str: 'Deuxieme ligne.', hasEOL: true }
    ]);
    expect(out).toBe('Premiere ligne.\nDeuxieme ligne.\n');
  });

  it('des items de la MÊME ligne ne sont pas séparés', function() {
    var out = joinPdfTextItems([
      { str: 'Bonjour ', hasEOL: false },
      { str: 'le monde', hasEOL: true }
    ]);
    expect(out).toBe('Bonjour le monde\n');
  });

  it('sans hasEOL, un saut d\'ordonnée est détecté', function() {
    var out = joinPdfTextItems([
      { str: 'Haut', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'Bas', transform: [1, 0, 0, 1, 0, 680], height: 12 }
    ]);
    expect(out).toBe('Haut\nBas');
  });

  it('sans hasEOL, une même ordonnée ne coupe pas', function() {
    var out = joinPdfTextItems([
      { str: 'Meme ', transform: [1, 0, 0, 1, 0, 700], height: 12 },
      { str: 'ligne', transform: [1, 0, 0, 1, 40, 700], height: 12 }
    ]);
    expect(out).toBe('Meme ligne');
  });

  it('le seuil suit la hauteur : un petit corps saute de moins', function() {
    var out = joinPdfTextItems([
      { str: 'a', transform: [1, 0, 0, 1, 0, 700], height: 4 },
      { str: 'b', transform: [1, 0, 0, 1, 0, 697], height: 4 }
    ]);
    expect(out).toBe('a\nb');
  });

  it('liste vide ou absente → chaîne vide, jamais d\'exception', function() {
    expect(joinPdfTextItems([])).toBe('');
    expect(joinPdfTextItems(null)).toBe('');
  });

  it('un item nul est ignoré', function() {
    expect(joinPdfTextItems([null, { str: 'ok' }])).toBe('ok');
  });
});

describe('formatPdfRead', function() {
  it('chaque page porte son en-tête (sinon le modèle attribue mal les phrases)', function() {
    var s = formatPdfRead([
      { page: 2, text: 'Texte deux' },
      { page: 3, text: 'Texte trois' }
    ]);
    expect(s.indexOf('--- Page 2 ---\nTexte deux') > -1).toBe(true);
    expect(s.indexOf('--- Page 3 ---\nTexte trois') > -1).toBe(true);
  });

  it('une page vide est SIGNALÉE, jamais rendue comme un blanc', function() {
    var s = formatPdfRead([
      { page: 1, text: 'Du texte' },
      { page: 2, text: '   ' }
    ]);
    expect(s.indexOf('Page(s) sans texte extractible : 2') > -1).toBe(true);
    expect(s.indexOf('SCANN') > -1).toBe(true);
  });

  it('toutes les pages vides : le message le dit autrement', function() {
    var s = formatPdfRead([{ page: 1, text: '' }, { page: 2, text: '' }]);
    expect(s.indexOf('Aucune page de cette plage ne porte de texte extractible') > -1).toBe(true);
  });

  it('la notice explique quoi faire, sans promettre d\'OCR', function() {
    var s = formatPdfRead([{ page: 1, text: '' }]);
    expect(s.indexOf("MIAOU ne fait pas d'OCR") > -1).toBe(true);
    expect(s.indexOf('plutôt que de conclure que le document est vide') > -1).toBe(true);
  });

  it('aucune page vide → aucune notice de page vide', function() {
    var s = formatPdfRead([{ page: 1, text: 'Plein' }]);
    expect(s.indexOf('SCANN') > -1).toBe(false);
  });

  it('la notice de clamp est ajoutée en queue quand elle existe', function() {
    var s = formatPdfRead([{ page: 1, text: 'x' }], { notice: '\n\n[Plage ramenée à 1-1]' });
    expect(s.indexOf('[Plage ramenée à 1-1]') > -1).toBe(true);
  });

  it('liste vide → pas d\'exception', function() {
    expect(typeof formatPdfRead([])).toBe('string');
    expect(typeof formatPdfRead(null)).toBe('string');
  });
});

describe('pdfReadResourceName', function() {
  it('une plage se lit dans le nom', function() {
    expect(pdfReadResourceName('rapport.pdf', 2, 5)).toBe('rapport-p2-5.txt');
  });

  it('une page unique ne répète pas le numéro', function() {
    expect(pdfReadResourceName('rapport.pdf', 3, 3)).toBe('rapport-p3.txt');
  });

  it('le chemin est réduit au nom de base', function() {
    expect(pdfReadResourceName('docs/2026/bilan.pdf', 1, 2)).toBe('bilan-p1-2.txt');
  });

  it('un nom sans extension reste utilisable', function() {
    expect(pdfReadResourceName('bilan', 1, 1)).toBe('bilan-p1.txt');
  });

  it('un nom absent retombe sur un nom générique', function() {
    expect(pdfReadResourceName('', 1, 1)).toBe('document-p1.txt');
    expect(pdfReadResourceName(null, 1, 1)).toBe('document-p1.txt');
  });

  it('sans plage, pas de suffixe bancal', function() {
    expect(pdfReadResourceName('rapport.pdf', 0, 0)).toBe('rapport.txt');
  });
});

describe('libellés d\'ack docs__list / docs__read', function() {
  it('un zip est une « archive » à « membres »', function() {
    expect(docsListAckHead({ resourceName: 'logs.zip' })).toBe('Archive listée');
    expect(docsListAckCount({ resourceName: 'logs.zip', count: 3 })).toBe('3 membres');
  });

  it('un pdf est un « document » à « pages » (un ack qui dit « archive » apprendrait faux)', function() {
    expect(docsListAckHead({ resourceName: 'rapport.pdf' })).toBe('Document listé');
    expect(docsListAckCount({ resourceName: 'rapport.pdf', count: 12 })).toBe('12 pages');
  });

  it('le singulier et le zéro sont accordés dans les deux unités', function() {
    expect(docsListAckCount({ resourceName: 'a.zip', count: 1 })).toBe('1 membre');
    expect(docsListAckCount({ resourceName: 'a.zip', count: 0 })).toBe('aucun membre');
    expect(docsListAckCount({ resourceName: 'a.pdf', count: 1 })).toBe('1 page');
    expect(docsListAckCount({ resourceName: 'a.pdf', count: 0 })).toBe('aucune page');
  });

  it('un compte absent ne rend pas « undefined »', function() {
    expect(docsListAckCount({ resourceName: 'a.zip' })).toBe('? membres');
  });

  it('une lecture de plage se dit au pluriel', function() {
    expect(docsReadAckHead({ selector: '2-5', sourceName: 'rapport.pdf' })).toBe('Pages 2-5 lues');
  });

  it('une page unique se dit au singulier, sans répéter le numéro', function() {
    expect(docsReadAckHead({ selector: '3', sourceName: 'rapport.pdf' })).toBe('Page 3 lue');
    expect(docsReadAckHead({ selector: '3-3', sourceName: 'rapport.pdf' })).toBe('Page 3 lue');
  });

  it('le libellé complet porte le nom du document', function() {
    expect(docsReadAckLabel({ selector: '2-5', resourceName: 'rapport.pdf' }))
      .toBe('Pages 2-5 lues : rapport.pdf');
  });

  it('sans selector, le libellé reste lisible', function() {
    expect(docsReadAckHead({})).toBe('Document lu');
    expect(docsReadAckLabel({ handle: 'att-1' })).toBe('Document lu : att-1');
  });
});

// ── Lot V-5, étape 1 : le PUR du chemin Excel ───────────────────────────────
// Ce qui est testé ici décide, ce qui ne l'est pas rend. SheetJS n'entre jamais
// dans ce fichier : l'ouverture du classeur et le rendu CSV sont couverts par
// le verify Playwright sur classeur réel.

describe('colonnes Excel (base 26 bijective)', function() {
  it('les 26 premières colonnes', function() {
    expect(colLetterToIndex('A')).toBe(0);
    expect(colLetterToIndex('Z')).toBe(25);
  });

  it('AA est la 27e colonne, pas la 28e — la base 26 bijective n\'a pas de zéro', function() {
    expect(colLetterToIndex('AA')).toBe(26);
    expect(colLetterToIndex('AB')).toBe(27);
    expect(colLetterToIndex('AZ')).toBe(51);
    expect(colLetterToIndex('BA')).toBe(52);
  });

  it('le décalage ne se voit qu\'au-delà de Z : une fixture jouet ne l\'attraperait pas', function() {
    expect(colIndexToLetter(26)).toBe('AA');
    expect(colIndexToLetter(701)).toBe('ZZ');
    expect(colIndexToLetter(702)).toBe('AAA');
  });

  it('l\'aller-retour est stable sur toute la plage utile', function() {
    var ok = true;
    for (var i = 0; i < 800; i++) { if (colLetterToIndex(colIndexToLetter(i)) !== i) ok = false; }
    expect(ok).toBe(true);
  });

  it('ce qui n\'est pas une colonne rend -1, jamais une valeur plausible', function() {
    expect(colLetterToIndex('A1')).toBe(-1);
    expect(colLetterToIndex('')).toBe(-1);
    expect(colLetterToIndex('é')).toBe(-1);
  });
});

describe('parseA1Range', function() {
  it('une plage ordinaire, en indices 0-based comme decode_range de SheetJS', function() {
    var r = parseA1Range('A1:C10');
    expect(r.s.c).toBe(0); expect(r.s.r).toBe(0);
    expect(r.e.c).toBe(2); expect(r.e.r).toBe(9);
  });

  it('une origine qui n\'est PAS A1 (le cas du classeur réel : B2:E31)', function() {
    var r = parseA1Range('B2:E31');
    expect(r.s.c).toBe(1); expect(r.s.r).toBe(1);
    expect(r.e.c).toBe(4); expect(r.e.r).toBe(30);
  });

  it('une cellule seule est une plage d\'une cellule', function() {
    var r = parseA1Range('B2');
    expect(formatA1Range(r)).toBe('B2:B2');
  });

  it('les $ des références absolues sont tolérés : un humain les emporte en copiant', function() {
    expect(formatA1Range(parseA1Range('$B$2:$E$31'))).toBe('B2:E31');
  });

  it('la casse ne décide rien', function() {
    expect(formatA1Range(parseA1Range('b2:e31'))).toBe('B2:E31');
  });

  it('une plage écrite à l\'envers est normalisée, pas refusée : elle est sans ambiguïté', function() {
    expect(formatA1Range(parseA1Range('E31:B2'))).toBe('B2:E31');
  });

  it('ce qui n\'est pas une plage rend null, jamais une exception', function() {
    expect(parseA1Range('Feuille1')).toBe(null);
    expect(parseA1Range('')).toBe(null);
    expect(parseA1Range('A0:B2')).toBe(null);
    expect(parseA1Range('1:5')).toBe(null);
    expect(parseA1Range(null)).toBe(null);
  });

  it('l\'aller-retour texte est stable', function() {
    expect(formatA1Range(parseA1Range('AA10:AC12'))).toBe('AA10:AC12');
  });
});

describe('parseSheetSelector', function() {
  var NAMES = ['Synthèse', 'Tri 75 correctifs'];

  it('un nom seul désigne la feuille entière', function() {
    var r = parseSheetSelector('Synthèse', NAMES);
    expect(r.ok).toBe(true);
    expect(r.sheet).toBe('Synthèse');
    expect(r.range).toBe(null);
  });

  it('un nom suivi d\'une plage rend les deux', function() {
    var r = parseSheetSelector('Synthèse!B2:E10', NAMES);
    expect(r.ok).toBe(true);
    expect(r.sheet).toBe('Synthèse');
    expect(r.rangeText).toBe('B2:E10');
  });

  it('le découpage se fait au PREMIER « ! », comme le split("!", 1) du serveur', function() {
    // Le split au premier « ! » est celui du serveur. Conséquence assumée :
    // une feuille dont le nom contient un « ! » n'est pas adressable AVEC une
    // plage (le séparateur est ambigu par construction). Mais elle reste
    // adressable par son nom exact, grâce au repli — sans lui, elle ne le
    // serait par AUCUN selector, ce qui est le trou du serveur.
    var r = parseSheetSelector('Alerte!!A1:B2', ['Alerte!']);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf('Alerte') >= 0).toBe(true);

    var direct = parseSheetSelector('Alerte!', ['Alerte!']);
    expect(direct.ok).toBe(true);
    expect(direct.sheet).toBe('Alerte!');
  });

  it('une feuille inconnue NOMME les feuilles disponibles : le modèle doit pouvoir se re-cibler', function() {
    var r = parseSheetSelector('Feuil1', NAMES);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf('Synthèse') >= 0).toBe(true);
    expect(r.message.indexOf('Tri 75 correctifs') >= 0).toBe(true);
  });

  it('la casse est rattrapée quand une seule feuille correspond', function() {
    var r = parseSheetSelector('synthèse', NAMES);
    expect(r.ok).toBe(true);
    expect(r.sheet).toBe('Synthèse');
  });

  it('la correspondance exacte prime sur celle insensible à la casse', function() {
    var r = parseSheetSelector('data', ['DATA', 'data']);
    expect(r.ok).toBe(true);
    expect(r.sheet).toBe('data');
  });

  it('une casse ambiguë ne tranche pas au hasard', function() {
    var r = parseSheetSelector('Data', ['DATA', 'data']);
    expect(r.ok).toBe(false);
  });

  it('un selector vide rappelle la forme attendue ET les feuilles', function() {
    var r = parseSheetSelector('', NAMES);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf('Synthèse') >= 0).toBe(true);
    expect(r.message.indexOf('A1:C10') >= 0).toBe(true);
  });

  it('une plage mal formée est refusée en le disant, sans toucher à la feuille', function() {
    var r = parseSheetSelector('Synthèse!pas-une-plage', NAMES);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf('A1:C10') >= 0).toBe(true);
  });

  it('un classeur sans feuille ne prétend pas en trouver une', function() {
    expect(parseSheetSelector('X', []).ok).toBe(false);
  });
});

describe('restrictSheetRange — la garde du format', function() {
  it('sans plage demandée, on sert la feuille entière', function() {
    var r = restrictSheetRange('B2:E31', null);
    expect(r.ref).toBe('B2:E31');
    expect(r.notice).toBe('');
  });

  it('une plage incluse est servie telle quelle, sans notice', function() {
    var r = restrictSheetRange('B2:E31', parseA1Range('C3:D5'));
    expect(r.ref).toBe('C3:D5');
    expect(r.notice).toBe('');
  });

  it('LE PIÈGE MESURÉ : A1:Z999 sur une feuille B2:E31 est ramené, pas déroulé', function() {
    // Sans intersection, SheetJS rend 999 LIGNES dont ~970 vides (mesuré au
    // spike sur le classeur réel) : le modèle recevrait du vide en croyant
    // avoir sa plage.
    var r = restrictSheetRange('B2:E31', parseA1Range('A1:Z999'));
    expect(r.ref).toBe('B2:E31');
    expect(r.notice.indexOf('ramenée') >= 0).toBe(true);
  });

  it('le clamp se DIT, et dit les trois plages (demandée, servie, feuille)', function() {
    var r = restrictSheetRange('B2:E31', parseA1Range('A1:C10'));
    expect(r.ref).toBe('B2:C10');
    expect(r.notice.indexOf('B2:C10') >= 0).toBe(true);
    expect(r.notice.indexOf('A1:C10') >= 0).toBe(true);
    expect(r.notice.indexOf('B2:E31') >= 0).toBe(true);
  });

  it('une plage entièrement hors feuille est un ÉCHEC, jamais un rendu vide', function() {
    // Rendre une chaîne vide ferait conclure « la feuille est vide » à tort.
    var r = restrictSheetRange('A1:B3', parseA1Range('D1:F9'));
    expect(!!r.fail).toBe(true);
    expect(r.fail.indexOf('A1:B3') >= 0).toBe(true);
  });

  it('un !ref illisible échoue au lieu de deviner', function() {
    expect(!!restrictSheetRange('', null).fail).toBe(true);
    expect(!!restrictSheetRange('n\'importe quoi', null).fail).toBe(true);
  });
});

describe('formatXlsxListing', function() {
  var SHEETS = [
    { name: 'Synthèse', ref: 'B2:E31', rows: 30, cols: 4 },
    { name: 'Tri 75 correctifs', ref: 'A1:G76', rows: 76, cols: 7 },
  ];

  it('annonce le nombre de feuilles', function() {
    expect(formatXlsxListing(SHEETS).indexOf('2 feuilles') >= 0).toBe(true);
  });

  it('donne la dimension de chaque feuille — sans elle le modèle demande A1:Z100 au jugé', function() {
    var out = formatXlsxListing(SHEETS);
    expect(out.indexOf('B2:E31') >= 0).toBe(true);
    expect(out.indexOf('30 lignes × 4 colonnes') >= 0).toBe(true);
  });

  it('rappelle la forme du selector : c\'est ce que le modèle doit écrire ensuite', function() {
    expect(formatXlsxListing(SHEETS).indexOf('NomDeFeuille!A1:C10') >= 0).toBe(true);
  });

  it('le singulier est accordé', function() {
    var out = formatXlsxListing([{ name: 'S', ref: 'A1:A1', rows: 1, cols: 1 }]);
    expect(out.indexOf('1 feuille') >= 0).toBe(true);
    expect(out.indexOf('1 ligne × 1 colonne') >= 0).toBe(true);
  });

  it('une feuille vide est dite vide, pas omise', function() {
    expect(formatXlsxListing([{ name: 'Vide', ref: '' }]).indexOf('(vide)') >= 0).toBe(true);
  });
});

describe('formatXlsxRead', function() {
  it('l\'en-tête porte le nom de la feuille ET la plage servie', function() {
    var out = formatXlsxRead('a,b\n1,2\n', { sheet: 'Synthèse', ref: 'B2:C3' });
    expect(out.indexOf('Feuille « Synthèse » (B2:C3)') >= 0).toBe(true);
  });

  it('le saut de ligne final du CSV ne compte pas pour une ligne', function() {
    var out = formatXlsxRead('a,b\n1,2\n', { sheet: 'S', ref: 'A1:B2', maxRows: 2 });
    expect(out.indexOf('non affichée') >= 0).toBe(false);
  });

  it('au-delà du cap, la troncature se DIT et propose la suite', function() {
    var out = formatXlsxRead('1\n2\n3\n4\n5\n', { sheet: 'S', ref: 'A1:A5', maxRows: 2 });
    expect(out.indexOf('3 ligne(s) non affichée(s)') >= 0).toBe(true);
    expect(out.indexOf('as_resource') >= 0).toBe(true);
    expect(out.indexOf('S!A3') >= 0).toBe(true);
  });

  it('maxRows à 0 ne borne rien : une plage explicite est une intention', function() {
    var out = formatXlsxRead('1\n2\n3\n4\n5\n', { sheet: 'S', ref: 'A1:A5', maxRows: 0 });
    expect(out.indexOf('non affichée') >= 0).toBe(false);
  });

  it('une plage sans cellule remplie le DIT, jamais un blanc', function() {
    var out = formatXlsxRead('', { sheet: 'S', ref: 'A1:B2' });
    expect(out.indexOf('aucune cellule remplie') >= 0).toBe(true);
  });

  it('la notice de clamp est reportée en fin de sortie', function() {
    var out = formatXlsxRead('a\n', { sheet: 'S', ref: 'A1:A1', notice: '\n\n[Plage ramenée à A1:A1]' });
    expect(out.indexOf('[Plage ramenée à A1:A1]') >= 0).toBe(true);
  });
});

describe('docReadResourceName / slugifyResourceSuffix', function() {
  it('une feuille ne se nomme pas comme des pages', function() {
    expect(docReadResourceName('classeur.xlsx', '-Synthese-B2-E31')).toBe('classeur-Synthese-B2-E31.txt');
  });

  it('pdfReadResourceName reste inchangé : il dérive du même facteur commun', function() {
    expect(pdfReadResourceName('rapport.pdf', 2, 5)).toBe('rapport-p2-5.txt');
    expect(pdfReadResourceName('rapport.pdf', 3, 3)).toBe('rapport-p3.txt');
  });

  it('un nom de feuille saisi par un humain devient un morceau de nom de fichier', function() {
    expect(slugifyResourceSuffix('Tri 75 correctifs B2:E31')).toBe('-Tri-75-correctifs-B2-E31');
  });

  it('les accents survivent : ils sont légitimes dans un nom de fichier', function() {
    expect(slugifyResourceSuffix('Synthèse')).toBe('-Synthèse');
  });

  it('un suffixe vide ne laisse pas de tiret orphelin', function() {
    expect(slugifyResourceSuffix('')).toBe('');
    expect(slugifyResourceSuffix('///')).toBe('');
    expect(docReadResourceName('classeur.xlsx', '')).toBe('classeur.txt');
  });

  it('un suffixe très long est borné : c\'est un nom de fichier', function() {
    var long = slugifyResourceSuffix(new Array(120).join('a'));
    expect(long.length <= 41).toBe(true);
  });
});

describe('libellés d\'ack — les unités ajoutées par V-5', function() {
  it('un classeur est un « classeur » à « feuilles »', function() {
    expect(docsListAckHead({ resourceName: 'compta.xlsx' })).toBe('Classeur listé');
    expect(docsListAckCount({ resourceName: 'compta.xlsx', count: 3 })).toBe('3 feuilles');
  });

  it('« feuille » est féminin : « aucune », jamais « aucun » (piège payé en V-4)', function() {
    expect(docsListAckCount({ resourceName: 'a.xlsx', count: 0 })).toBe('aucune feuille');
    expect(docsListAckCount({ resourceName: 'a.xlsx', count: 1 })).toBe('1 feuille');
  });

  it('un selector NON numérique est une unité nommée, pas une page', function() {
    expect(docsReadAckHead({ selector: 'Synthèse!B2:E31', sourceName: 'compta.xlsx' }))
      .toBe('Feuille Synthèse!B2:E31 lue');
    expect(docsReadAckHead({ selector: 'Synthèse', sourceName: 'compta.xlsx' }))
      .toBe('Feuille Synthèse lue');
  });

  it('les pages continuent de se dire comme avant : la forme du selector décide', function() {
    expect(docsReadAckHead({ selector: '2-5', sourceName: 'r.pdf' })).toBe('Pages 2-5 lues');
    expect(docsReadAckHead({ selector: '3', sourceName: 'r.pdf' })).toBe('Page 3 lue');
  });

  it('le libellé complet d\'une feuille porte le nom du classeur', function() {
    expect(docsReadAckLabel({ selector: 'Synthèse!B2:E31', resourceName: 'compta.xlsx',
      sourceName: 'compta.xlsx' })).toBe('Feuille Synthèse!B2:E31 lue : compta.xlsx');
  });
});

describe('decodeHtmlEntities', function() {
  it('décode le jeu que mammoth émet réellement', function() {
    expect(decodeHtmlEntities('a &lt;b&gt; c')).toBe('a <b> c');
    expect(decodeHtmlEntities('Gateway &amp; styles')).toBe('Gateway & styles');
    expect(decodeHtmlEntities('&quot;cite&quot;')).toBe('"cite"');
  });

  it('décode les formes numériques, décimale et hexadécimale', function() {
    expect(decodeHtmlEntities('l&#39;essai')).toBe("l'essai");
    expect(decodeHtmlEntities('&#x2014; tiret')).toBe('— tiret');
  });

  it('laisse intact ce qui n\'est pas une entité connue', function() {
    expect(decodeHtmlEntities('R&D &unknown; 100%')).toBe('R&D &unknown; 100%');
  });

  it('&amp;lt; ne se décode PAS deux fois (sinon un < littéral du document deviendrait une balise)', function() {
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;');
  });
});

describe('htmlFragmentToInlineText', function() {
  it('retire les balises et rend une seule ligne', function() {
    expect(htmlFragmentToInlineText('<p><strong>Statut</strong></p>')).toBe('Statut');
  });

  it('une cellule à PLUSIEURS paragraphes se joint par un espace, jamais par un saut de ligne', function() {
    // Cas mesuré sur la fixture réelle, et même majoritaire : un \n ici
    // casserait la ligne « a | b | c » qui l'entoure.
    expect(htmlFragmentToInlineText('<p>un</p><p>deux</p>')).toBe('un deux');
  });

  it('<br> devient un espace', function() {
    expect(htmlFragmentToInlineText('<p>un<br>deux</p>')).toBe('un deux');
  });

  it('décode les entités du fragment', function() {
    expect(htmlFragmentToInlineText('<p>Gateway &amp; API</p>')).toBe('Gateway & API');
  });
});

describe('htmlTableToText', function() {
  it('rend « a | b | c », une ligne par <tr>', function() {
    const html = '<table><tr><td><p>a</p></td><td><p>b</p></td></tr>' +
      '<tr><td><p>c</p></td><td><p>d</p></td></tr></table>';
    expect(htmlTableToText(html)).toBe('a | b\nc | d');
  });

  it('thead et tbody sont traversés sans distinction : l\'en-tête est la première ligne', function() {
    const html = '<table><thead><tr><th><p>H1</p></th><th><p>H2</p></th></tr></thead>' +
      '<tbody><tr><td><p>v1</p></td><td><p>v2</p></td></tr></tbody></table>';
    expect(htmlTableToText(html)).toBe('H1 | H2\nv1 | v2');
  });

  it('une cellule vide reste une colonne vide (l\'alignement des lignes est l\'information)', function() {
    const html = '<table><tr><td><p>a</p></td><td></td><td><p>c</p></td></tr></table>';
    expect(htmlTableToText(html)).toBe('a |  | c');
  });
});

describe('docxHtmlToBlocks', function() {
  it('rend les blocs DANS L\'ORDRE DU DOCUMENT, tableaux compris', function() {
    // C'est le gain structurel sur le serveur : python-docx expose paragraphes
    // et tables en deux collections séparées, d'où son label « (tableaux) ».
    const html = '<h1>T</h1><p>para</p><table><tr><td>x</td></tr></table><h2>S</h2><p>fin</p>';
    const b = docxHtmlToBlocks(html);
    expect(b.length).toBe(5);
    expect(b[0].type).toBe('heading');
    expect(b[0].level).toBe(1);
    expect(b[1].type).toBe('para');
    expect(b[2].type).toBe('table');
    expect(b[3].type).toBe('heading');
    expect(b[3].level).toBe(2);
  });

  it('décode le titre : sans ça, AUCUN selector ne pourrait viser cette section', function() {
    // Cas réel de la fixture : « 3. Gateway &amp; styles d'API ».
    const b = docxHtmlToBlocks('<h2>3. Gateway &amp; styles</h2>');
    expect(b[0].text).toBe('3. Gateway & styles');
  });

  it('une liste devient des puces « - »', function() {
    const b = docxHtmlToBlocks('<ul><li>un</li><li>deux</li></ul>');
    expect(b.length).toBe(1);
    expect(b[0].type).toBe('list');
    expect(b[0].text).toBe('- un\n- deux');
  });

  it('les blocs vides sont écartés, pas rendus comme du blanc', function() {
    const b = docxHtmlToBlocks('<p></p><p>  </p><p>vrai</p>');
    expect(b.length).toBe(1);
    expect(b[0].text).toBe('vrai');
  });

  it('un document sans aucune balise connue rend une liste vide, sans planter', function() {
    expect(docxHtmlToBlocks('').length).toBe(0);
    expect(docxHtmlToBlocks(null).length).toBe(0);
  });
});

describe('docxSections', function() {
  it('un h2 ne ferme pas un h1 : la section porte ses sous-parties', function() {
    // Règle portée telle quelle du serveur (_docx_sections) : bornage au
    // prochain heading de niveau INFÉRIEUR OU ÉGAL.
    const b = docxHtmlToBlocks('<h1>A</h1><p>a1</p><h2>A.1</h2><p>a2</p><h1>B</h1><p>b1</p>');
    const s = docxSections(b);
    expect(s.length).toBe(3);
    expect(s[0].label).toBe('A');
    expect(s[0].text.indexOf('a2') > 0).toBe(true);    // la sous-section EST dedans
    expect(s[0].text.indexOf('b1') < 0).toBe(true);    // le h1 suivant la ferme
    expect(s[1].label).toBe('A.1');
    expect(s[2].label).toBe('B');
  });

  it('le texte avant le premier heading est « (préambule) »', function() {
    const b = docxHtmlToBlocks('<p>avant</p><h1>T</h1><p>apres</p>');
    const s = docxSections(b);
    expect(s.length).toBe(2);
    expect(s[0].label).toBe('(préambule)');
    expect(s[0].text).toBe('avant');
  });

  it('un document SANS aucun heading est une seule section « (corps) »', function() {
    const b = docxHtmlToBlocks('<p>un</p><p>deux</p>');
    const s = docxSections(b);
    expect(s.length).toBe(1);
    expect(s[0].label).toBe('(corps)');
    expect(s[0].text).toBe('un\n\ndeux');
  });

  it('le heading est REPRIS dans le texte de sa section, en markdown', function() {
    const s = docxSections(docxHtmlToBlocks('<h2>Titre</h2><p>corps</p>'));
    expect(s[0].text).toBe('## Titre\n\ncorps');
  });

  it('un tableau appartient à la section qui le porte', function() {
    const b = docxHtmlToBlocks('<h1>A</h1><table><tr><td>x</td><td>y</td></tr></table><h1>B</h1>');
    const s = docxSections(b);
    expect(s[0].text.indexOf('x | y') > 0).toBe(true);
    expect(s[1].text.indexOf('x | y') < 0).toBe(true);
  });

  it('un document vide ne rend aucune section', function() {
    expect(docxSections([]).length).toBe(0);
  });
});

describe('resolveDocxSection', function() {
  const sections = docxSections(docxHtmlToBlocks(
    '<h1>Checklist</h1><p>x</p><h2>0. Déjà établi</h2><p>y</p>' +
    '<h2>3. Gateway &amp; styles</h2><p>z</p>'));

  it('le titre exact résout', function() {
    const r = resolveDocxSection('0. Déjà établi', sections);
    expect(r.ok).toBe(true);
    expect(r.section.label).toBe('0. Déjà établi');
  });

  it('un titre porteur d\'une entité se vise par son texte DÉCODÉ', function() {
    // Le modèle recopie ce que le listing lui a montré : « & », pas « &amp; ».
    const r = resolveDocxSection('3. Gateway & styles', sections);
    expect(r.ok).toBe(true);
  });

  it('la casse et les espaces répétés sont tolérés (un titre recopié traverse une tokenisation)', function() {
    const r = resolveDocxSection('0.   DÉJÀ ÉTABLI', sections);
    expect(r.ok).toBe(true);
    expect(r.section.label).toBe('0. Déjà établi');
  });

  it('un préfixe NON AMBIGU résout : un titre long se recopie tronqué', function() {
    const r = resolveDocxSection('0. Déjà', sections);
    expect(r.ok).toBe(true);
  });

  it('un préfixe AMBIGU est rendu au modèle, jamais tranché à sa place', function() {
    const s2 = docxSections(docxHtmlToBlocks('<h1>Annexe A</h1><p>x</p><h1>Annexe B</h1><p>y</p>'));
    const r = resolveDocxSection('Annexe', s2);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf('ambigu') >= 0).toBe(true);
    expect(r.message.indexOf('Annexe A') > 0).toBe(true);
  });

  it('l\'échec NOMME les sections disponibles, pour que le modèle se re-cible dans le tour', function() {
    const r = resolveDocxSection('Inexistant', sections);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf('Checklist') > 0).toBe(true);
    expect(r.message.indexOf('0. Déjà établi') > 0).toBe(true);
  });

  it('un document sans section le dit, plutôt que de rendre une liste vide', function() {
    const r = resolveDocxSection('quoi que ce soit', []);
    expect(r.ok).toBe(false);
    expect(r.message.indexOf('aucune section') > 0).toBe(true);
  });
});

describe('formatDocxListing', function() {
  const sections = docxSections(docxHtmlToBlocks('<h1>A</h1><p>x</p><h2>A.1</h2><p>y</p>'));

  it('une ligne par section, indentée par niveau', function() {
    const out = formatDocxListing(sections, { tables: 0 });
    expect(out.indexOf('Document Word — 2 sections') === 0).toBe(true);
    expect(out.indexOf('\n- A\n') > 0).toBe(true);
    expect(out.indexOf('\n  - A.1') > 0).toBe(true);
  });

  it('les tableaux sont annoncés : un document tabulaire ne doit pas passer pour dix paragraphes', function() {
    const out = formatDocxListing(sections, { tables: 10 });
    expect(out.indexOf('Tableaux : 10 tableaux') > 0).toBe(true);
  });

  it('le listing rappelle comment écrire le selector', function() {
    expect(formatDocxListing(sections, {}).indexOf('miaou__docs__read') > 0).toBe(true);
  });

  it('un document vide le dit', function() {
    const out = formatDocxListing([], {});
    expect(out.indexOf('sans texte extractible') > 0).toBe(true);
  });
});

describe('formatDocxRead', function() {
  it('en-tête nommant la section servie, puis le corps', function() {
    const out = formatDocxRead({ label: 'Intro', text: 'corps' }, {});
    expect(out).toBe('--- Section « Intro » ---\ncorps');
  });

  it('une section vide le DIT, plutôt que de rendre un blanc', function() {
    const out = formatDocxRead({ label: 'Vide', text: '' }, {});
    expect(out.indexOf('aucun texte') > 0).toBe(true);
  });

  it('la troncature se dit et propose les deux suites', function() {
    const out = formatDocxRead({ label: 'S', text: 'abcdefghij' }, { maxChars: 4 });
    expect(out.indexOf('abcd') > 0).toBe(true);
    expect(out.indexOf('6 caractère(s) non affiché(s)') > 0).toBe(true);
    expect(out.indexOf('as_resource') > 0).toBe(true);
  });

  it('sans cap, rien n\'est tronqué', function() {
    const out = formatDocxRead({ label: 'S', text: 'abcdefghij' }, { maxChars: 0 });
    expect(out.indexOf('non affiché') < 0).toBe(true);
  });
});

describe('libellés d\'ack — la section docx (V-5 étape 2)', function() {
  it('« section » est féminin', function() {
    expect(docsListAckCount({ resourceName: 'a.docx', count: 0 })).toBe('aucune section');
    expect(docsListAckCount({ resourceName: 'a.docx', count: 3 })).toBe('3 sections');
  });

  it('une section se dit « Section », PAS « Feuille » : le mot vient de la table', function() {
    expect(docsReadAckHead({ selector: 'Introduction', sourceName: 'note.docx' }))
      .toBe('Section Introduction lue');
    expect(docsReadAckHead({ selector: 'Synthèse', sourceName: 'compta.xlsx' }))
      .toBe('Feuille Synthèse lue');
  });

  it('en as_resource, le mot vient de sourceName — resourceName est l\'extrait .txt produit', function() {
    // Sans sourceName, l'extrait « compta-Synthese.txt » ne matche aucune ligne
    // de la table et le mot retombait sur le défaut.
    expect(docsReadAckHead({ selector: 'Synthèse', resourceName: 'compta-Synthese.txt',
      sourceName: 'compta.xlsx' })).toBe('Feuille Synthèse lue');
  });
});

// ── PowerPoint (lot V-5, étape 3) ──────────────────────────────────────────
// Le parsing XML n'est pas ici (DOMParser absent de QuickJS, décision 3) : ces
// tests portent sur ce qui DÉCIDE — l'ordre réel des slides, la liaison aux
// notes, le repli d'extrait, la mise en forme.

describe('pptxRelationshipMap — l\'ordre des attributs n\'est pas garanti', function() {
  it('lit Id/Target quel que soit leur ordre dans la balise', function() {
    const xml = '<Relationships>' +
      '<Relationship Id="rId1" Type="x/slide" Target="slides/slide1.xml"/>' +
      '<Relationship Target="slides/slide2.xml" Id="rId2" Type="x/slide"/>' +
      '</Relationships>';
    const map = pptxRelationshipMap(xml);
    expect(map.rId1.target).toBe('slides/slide1.xml');
    expect(map.rId2.target).toBe('slides/slide2.xml');
  });

  it('une Relationship sans Target est ignorée plutôt que rendue à moitié', function() {
    const map = pptxRelationshipMap('<Relationship Id="rId9" Type="x"/>');
    expect(map.rId9 === undefined).toBe(true);
  });
});

describe('pptxResolveTarget', function() {
  it('remonte les .. relatifs à la pièce porteuse', function() {
    expect(pptxResolveTarget('ppt/slides', '../notesSlides/notesSlide2.xml'))
      .toBe('ppt/notesSlides/notesSlide2.xml');
  });

  it('un target sans .. se colle à la base', function() {
    expect(pptxResolveTarget('ppt', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
  });

  it('un target absolu perd son slash de tête', function() {
    expect(pptxResolveTarget('ppt', '/ppt/slides/slide3.xml')).toBe('ppt/slides/slide3.xml');
  });
});

describe('pptxSlideOrder — LA garde critique du format', function() {
  const rels = '<Relationships>' +
    '<Relationship Id="rId1" Type="t/slide" Target="slides/slide1.xml"/>' +
    '<Relationship Id="rId2" Type="t/slide" Target="slides/slide2.xml"/>' +
    '<Relationship Id="rId3" Type="t/slide" Target="slides/slide3.xml"/>' +
    '</Relationships>';
  const fb = ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml'];

  it('l\'ordre de sldIdLst prime sur le numéro de fichier', function() {
    // Une slide déplacée dans PowerPoint : le sldIdLst dit 3, 1, 2. Trier par
    // numéro de fichier rendrait « slide 3 » en croyant lire la troisième.
    const pres = '<p:sldIdLst><p:sldId id="256" r:id="rId3"/>' +
      '<p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId2"/></p:sldIdLst>';
    const out = pptxSlideOrder(pres, rels, fb);
    expect(out.join(',')).toBe('ppt/slides/slide3.xml,ppt/slides/slide1.xml,ppt/slides/slide2.xml');
  });

  it('l\'ordre naturel est rendu tel quel — un cas qui passe ne dispense pas de la garde', function() {
    const pres = '<p:sldIdLst><p:sldId r:id="rId1"/><p:sldId r:id="rId2"/><p:sldId r:id="rId3"/></p:sldIdLst>';
    expect(pptxSlideOrder(pres, rels, fb).join(',')).toBe(fb.join(','));
  });

  it('une pièce présente dans le zip mais hors sldIdLst n\'est pas de la présentation', function() {
    const pres = '<p:sldIdLst><p:sldId r:id="rId1"/><p:sldId r:id="rId2"/></p:sldIdLst>';
    const out = pptxSlideOrder(pres, rels, fb);
    expect(out.length).toBe(2);
    expect(out.indexOf('ppt/slides/slide3.xml') < 0).toBe(true);
  });

  it('sans presentation.xml exploitable, repli sur le fallback plutôt que rien', function() {
    expect(pptxSlideOrder('', rels, fb).join(',')).toBe(fb.join(','));
    expect(pptxSlideOrder('<p:sldIdLst/>', rels, fb).join(',')).toBe(fb.join(','));
  });

  it('un r:id qui ne résout dans aucune relation est sauté, pas rendu brut', function() {
    const pres = '<p:sldIdLst><p:sldId r:id="rId99"/><p:sldId r:id="rId2"/></p:sldIdLst>';
    expect(pptxSlideOrder(pres, rels, fb).join(',')).toBe('ppt/slides/slide2.xml');
  });
});

describe('pptxNotesTarget — la liaison notes passe par les rels, jamais par le numéro', function() {
  it('trouve la pièce de notes par le TYPE de la relation', function() {
    // notesSlide2.xml est la note de CETTE slide, quel que soit son numéro :
    // apparier notesSlideN à slideN au jugé serait le même piège que l'ordre.
    const rels = '<Relationships>' +
      '<Relationship Id="rId1" Type="http://x/relationships/slideLayout" Target="../slideLayouts/slideLayout7.xml"/>' +
      '<Relationship Id="rId5" Type="http://x/relationships/notesSlide" Target="../notesSlides/notesSlide2.xml"/>' +
      '</Relationships>';
    expect(pptxNotesTarget(rels)).toBe('ppt/notesSlides/notesSlide2.xml');
  });

  it('une slide sans notes rend la chaîne vide', function() {
    const rels = '<Relationships><Relationship Id="rId1" Type="http://x/relationships/slideLayout" Target="../slideLayouts/slideLayout6.xml"/></Relationships>';
    expect(pptxNotesTarget(rels)).toBe('');
  });

  it('ne confond pas notesSlide avec notesMaster', function() {
    const rels = '<Relationships><Relationship Id="rId1" Type="http://x/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/></Relationships>';
    expect(pptxNotesTarget(rels)).toBe('');
  });
});

describe('pptxSlideExcerpt / pptxSlideLabel — le repli quand le titre manque', function() {
  it('l\'extrait vient des BLOCS, pas du balayage plat des runs', function() {
    // À plat, cette slide donnerait « Centre », « », « de  », « Cyberdéfense » :
    // du bruit à la place d'un repère (mesuré sur le deck réel).
    const blocks = ['Centre Opérationnel de Cyberdéfense\nMickaël MARTINEZ', 'Risques IT\nMarc GUIDAT'];
    expect(pptxSlideExcerpt(blocks, 90))
      .toBe('Centre Opérationnel de Cyberdéfense Mickaël MARTINEZ · Risques IT Marc GUIDAT');
  });

  it('l\'extrait est borné et coupe sur un mot entier', function() {
    const out = pptxSlideExcerpt(['abcdef ghijkl mnopqr stuvwx'], 15);
    expect(out.length <= 16).toBe(true);
    expect(out.slice(-1)).toBe('…');
    expect(out.indexOf('mnopq') < 0).toBe(true);
  });

  it('le titre est PRÉFÉRÉ à l\'extrait quand il existe', function() {
    expect(pptxSlideLabel({ title: 'Organigramme', blocks: ['du texte'] })).toBe('Organigramme');
  });

  it('sans titre, le libellé est l\'extrait — jamais « (sans titre) »', function() {
    // 6 slides titrées sur 71 dans le deck réel : le listing du serveur répond
    // « (sans titre) » soixante-cinq fois, ce qui ne permet pas de choisir.
    expect(pptxSlideLabel({ title: '', blocks: ['Direction financière'] }))
      .toBe('Direction financière');
  });

  it('sans titre NI texte, le libellé le dit', function() {
    expect(pptxSlideLabel({ title: '', blocks: [] })).toBe('(slide sans texte)');
  });
});

describe('formatPptxListing', function() {
  const slides = [
    { title: 'Organigramme', blocks: ['x'], hasNotes: true },
    { title: '', blocks: ['Risques IT\nMarc GUIDAT'], hasNotes: false },
  ];

  it('numérote dans l\'ordre de présentation et rend le selector attendu', function() {
    const out = formatPptxListing(slides, {});
    expect(out.indexOf('1. Organigramme') >= 0).toBe(true);
    expect(out.indexOf('2. Risques IT Marc GUIDAT') >= 0).toBe(true);
    expect(out.indexOf('Présentation PowerPoint — 2 slides') >= 0).toBe(true);
  });

  it('marque les slides porteuses de notes et les annonce', function() {
    const out = formatPptxListing(slides, {});
    expect(out.indexOf('1. Organigramme  [notes]') >= 0).toBe(true);
    expect(out.indexOf('Notes de présentateur : 1 slide en porte') >= 0).toBe(true);
  });

  it('sans notes du tout, aucune ligne de notes', function() {
    const out = formatPptxListing([{ title: 'A', blocks: [], hasNotes: false }], {});
    expect(out.indexOf('Notes de présentateur') < 0).toBe(true);
  });

  it('une présentation vide le dit', function() {
    const out = formatPptxListing([], {});
    expect(out.indexOf('présentation vide') >= 0).toBe(true);
  });
});

describe('formatPptxRead', function() {
  it('un en-tête par slide, avec son titre quand il existe', function() {
    const out = formatPptxRead([{ number: 3, title: 'Bilan', text: 'du texte' }], {});
    expect(out.indexOf('--- Slide 3 — Bilan ---') >= 0).toBe(true);
    expect(out.indexOf('du texte') >= 0).toBe(true);
  });

  it('les notes sont SÉPARÉES du corps par un intertitre explicite', function() {
    // Sans lui, le modèle attribue au public ce qui était destiné au
    // présentateur (décision 5).
    const out = formatPptxRead([{ number: 2, title: '', text: 'corps', notes: 'le propos' }], {});
    expect(out.indexOf('--- Notes de présentateur (slide 2) ---') >= 0).toBe(true);
    expect(out.indexOf('corps') < out.indexOf('le propos')).toBe(true);
  });

  it('une slide sans texte ni notes déclenche la notice, qui écarte la conclusion « vide »', function() {
    const out = formatPptxRead([{ number: 1, text: '' }], {});
    expect(out.indexOf('Aucune slide de cette plage ne porte de texte') >= 0).toBe(true);
    expect(out.indexOf("MIAOU ne fait pas d'OCR") >= 0).toBe(true);
  });

  it('sur une plage partiellement vide, les slides muettes sont NOMMÉES', function() {
    const out = formatPptxRead([
      { number: 1, text: 'a' }, { number: 2, text: '' }, { number: 3, text: '' },
    ], {});
    expect(out.indexOf('Slide(s) sans texte : 2, 3') >= 0).toBe(true);
  });

  it('une slide muette au corps mais porteuse de notes n\'est PAS comptée vide', function() {
    const out = formatPptxRead([{ number: 4, text: '', notes: 'tout est ici' }], {});
    expect(out.indexOf('sans texte') < 0).toBe(true);
  });
});

describe('pptxReadResourceName', function() {
  it('une slide se suffixe -sN, pas -pN : deux extraits du même deck ne se recouvrent pas', function() {
    expect(pptxReadResourceName('deck.pptx', 3, 3)).toBe('deck-s3.txt');
    expect(pptxReadResourceName('deck.pptx', 2, 5)).toBe('deck-s2-5.txt');
    expect(pdfReadResourceName('deck.pptx', 2, 5)).toBe('deck-p2-5.txt');
  });
});

describe('libellés d\'ack — la slide (V-5 étape 3)', function() {
  it('« slide » est féminin', function() {
    expect(docsListAckCount({ resourceName: 'a.pptx', count: 0 })).toBe('aucune slide');
    expect(docsListAckCount({ resourceName: 'a.pptx', count: 71 })).toBe('71 slides');
  });

  it('un selector NUMÉRIQUE de pptx se dit « Slide », pas « Page »', function() {
    // Le mot était en dur à « Page » sur la branche numérique depuis V-4,
    // l'unique format à selector numérique d'alors : la ligne pptx de la table
    // portait déjà « Slide » sans que rien ne l'atteigne.
    expect(docsReadAckHead({ selector: '3', sourceName: 'deck.pptx' })).toBe('Slide 3 lue');
    expect(docsReadAckHead({ selector: '2-5', sourceName: 'deck.pptx' })).toBe('Slides 2-5 lues');
  });

  it('le PDF ne régresse pas — même branche, mot pris dans la même table', function() {
    expect(docsReadAckHead({ selector: '3', sourceName: 'r.pdf' })).toBe('Page 3 lue');
    expect(docsReadAckHead({ selector: '2-5', sourceName: 'r.pdf' })).toBe('Pages 2-5 lues');
  });

  it('en as_resource, le mot vient de sourceName — le .txt produit ne dit plus le format', function() {
    expect(docsReadAckHead({ selector: '2-5', resourceName: 'deck-s2-5.txt',
      sourceName: 'deck.pptx' })).toBe('Slides 2-5 lues');
  });

  it('le défaut masculin s\'accorde aussi : un membre se lit « lu »', function() {
    expect(docsReadAckHead({ selector: '3', sourceName: 'archive.zip' })).toBe('Membre 3 lu');
  });
});


// ── Lot V-7 : rapatriés depuis test-zip.js ──────────────────────────────────
// sniffZipOfficeKind et formatZipListing ont suivi leur code dans docs.js — un
// test du domaine « documents » n'a plus sa place dans le fichier de la
// mécanique zip. Les trois fixtures ci-dessous sont reprises de test-zip.js
// (chaque fichier de test est évalué SÉPARÉMENT par le runner : rien n'y est
// partagé, la duplication est structurelle, pas un oubli).
var DOC_ZIP_ENC = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,1,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,17,0,0,0,10,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,115,101,99,114,101,116,46,116,120,116,80,75,5,6,0,0,0,0,1,0,1,0,56,0,0,0,30,0,0,0,0,0];
var DOC_ZIP_MULTI = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,6,0,0,0,5,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,97,46,116,120,116,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,115,117,98,47,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,10,0,0,0,9,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,115,117,98,47,98,46,116,120,116,80,75,5,6,0,0,0,0,3,0,3,0,156,0,0,0,30,0,0,0,0,0];
var DOC_ZIP_SLIP = [80,75,3,4,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,5,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,46,46,47,101,118,105,108,46,116,120,116,80,75,1,2,20,0,20,0,0,0,8,0,0,0,0,0,0,0,0,0,0,0,0,0,3,0,0,0,6,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,111,107,46,116,120,116,80,75,5,6,0,0,0,0,2,0,2,0,109,0,0,0,30,0,0,0,0,0];

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
    var out = formatZipListing(parseZipCentralDirectory(du8(DOC_ZIP_MULTI)), {});
    expect(out).toContain('a.txt');
    expect(out).toContain('sub/b.txt');
    expect(out).toContain('2 membres');
    expect(out).toContain('1 répertoire');
  });

  it('SIGNALE un membre chiffré au lieu de l\'omettre', function() {
    // Un membre absent sans explication fait halluciner le modèle : il doit
    // savoir que le membre existe ET pourquoi il ne l\'aura pas.
    var out = formatZipListing(parseZipCentralDirectory(du8(DOC_ZIP_ENC)), {});
    expect(out).toContain('Membres écartés');
    expect(out).toContain('secret.txt');
    expect(out).toContain('chiffré');
  });

  it('SIGNALE un membre au chemin non sûr au lieu de l\'omettre', function() {
    var out = formatZipListing(parseZipCentralDirectory(du8(DOC_ZIP_SLIP)), {});
    expect(out).toContain('Membres écartés');
    expect(out).toContain('evil.txt');
    expect(out).toContain('chemin non sûr');
    expect(out).toContain('ok.txt');   // le membre sain reste listé
  });

  it('annonce la nature Office d\'une archive docx', function() {
    var out = formatZipListing(parseZipCentralDirectory(du8(DOC_ZIP_DOCX)), {});
    expect(out).toContain('docx');
    expect(out).toContain('word/document.xml');
  });

  it('marque un membre au-delà du cap sans le retirer de la liste', function() {
    var out = formatZipListing(parseZipCentralDirectory(du8(DOC_ZIP_DOCX)), { maxBytes: 1000 });
    expect(out).toContain('word/document.xml');
    expect(out).toContain('au-delà du cap');
  });

  it('annonce un total au-delà du cap tout en gardant l\'extraction possible', function() {
    var out = formatZipListing(parseZipCentralDirectory(du8(DOC_ZIP_DOCX)), { maxBytes: 3000 });
    expect(out).toContain('Le total dépasse le cap');
    expect(out).toContain('individuellement');
  });

  it('ne casse pas sur une archive sans membre extractible', function() {
    var out = formatZipListing(parseZipCentralDirectory(du8(DOC_ZIP_ENC)), {});
    expect(out).toContain('aucun membre extractible');
  });

  it('tolère une liste absente', function() {
    expect(formatZipListing(null, {})).toContain('0 membre');
  });
});
