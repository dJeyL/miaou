// tests/test-docs.js
// Lot V-4 — part PURE du chemin « document natif » (utils.js) : reconnaissance
// de type aux octets, selector d'unité, mise en forme du listing PDF.
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
    expect(docsReadAckHead({ selector: '2-5' })).toBe('Pages 2-5 lues');
  });

  it('une page unique se dit au singulier, sans répéter le numéro', function() {
    expect(docsReadAckHead({ selector: '3' })).toBe('Page 3 lue');
    expect(docsReadAckHead({ selector: '3-3' })).toBe('Page 3 lue');
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
