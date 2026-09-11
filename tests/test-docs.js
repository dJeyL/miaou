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

  // Lot V-8 : le sommaire porte ses numéros. Le cas MIXTE est le seul nouveau
  // — une destination non résoluble laisse son entrée sans numéro, à côté
  // d'entrées qui en ont. Avant V-8 toutes les entrées étaient à 0 ; ce test
  // garde la dégradation PAR ENTRÉE (jamais pour le sommaire entier).
  it('une entrée sans numéro garde son titre à côté d\'entrées numérotées', function() {
    var s = formatPdfListing({ pages: 20, outline: [
      { level: 1, title: 'Résolue', page: 3 },
      { level: 1, title: 'Non résoluble', page: 0 },
      { level: 2, title: 'Fille résolue', page: 7 }
    ] });
    expect(s.indexOf('- p.3 Résolue') > -1).toBe(true);
    expect(s.indexOf('- Non résoluble') > -1).toBe(true);
    expect(s.indexOf('  - p.7 Fille résolue') > -1).toBe(true);
    // Le titre non résolu ne doit PAS hériter d'un « p.0 » ni d'un « p.NaN ».
    expect(s.indexOf('p.0') > -1).toBe(false);
    expect(s.indexOf('NaN') > -1).toBe(false);
  });
});

// Lot V-8 — les deux décisions pures extraites de resolveOutlinePage (async,
// donc hors QuickJS : c'est l'arithmétique et les cas limites qui sont testés
// ici, pas l'enchaînement d'awaits).
describe('destIsResolvable', function() {
  it('un tableau non vide dont le premier élément existe est résoluble', function() {
    expect(destIsResolvable([{ num: 12, gen: 0 }, 'XYZ', 0, 780, 0])).toBe(true);
  });

  it('une destination NOMMÉE absente rend null → non résoluble', function() {
    expect(destIsResolvable(null)).toBe(false);
    expect(destIsResolvable(undefined)).toBe(false);
  });

  it('un tableau vide (lien externe) n\'est pas résoluble', function() {
    expect(destIsResolvable([])).toBe(false);
  });

  it('une chaîne non résolue n\'est pas une destination exploitable', function() {
    expect(destIsResolvable('sect3')).toBe(false);
  });

  it('un tableau dont la référence est nulle n\'est pas résoluble', function() {
    expect(destIsResolvable([null, 'XYZ'])).toBe(false);
  });
});

describe('docsRenderAckHead / docsRenderAckLabel', function() {
  it('« Page 3 rendue en image » sur un PDF', function() {
    expect(docsRenderAckHead({ sourceName: 'rapport.pdf', selector: '3' }))
      .toBe('Page 3 rendue en image');
  });

  it('le label porte le document SOURCE, pas le PNG produit', function() {
    var l = docsRenderAckLabel({ sourceName: 'rapport.pdf', resourceName: 'rapport-p3.png', selector: '3' });
    expect(l).toBe('Page 3 rendue en image : rapport.pdf');
  });

  // LE test qui empêche le littéral 'Page ' de revenir : le mot vient de
  // DOC_ACK_UNITS, donc un nom hors table retombe sur le défaut (mémoire
  // project_hardcoded_value_survives_until_second_occupant).
  it('le mot d\'unité vient de la table, jamais d\'un littéral', function() {
    // .pptx → « Slide » dans DOC_ACK_UNITS.
    expect(docsRenderAckHead({ sourceName: 'deck.pptx', selector: '2' }))
      .toBe('Slide 2 rendue en image');
    // nom hors table → défaut (« Membre », masculin) : l'accord suit.
    expect(docsRenderAckHead({ sourceName: 'archive.zip', selector: '1' }))
      .toBe('Membre 1 rendu en image');
  });

  it('sans selector, l\'en-tête reste lisible', function() {
    expect(docsRenderAckHead({ sourceName: 'rapport.pdf' }))
      .toBe('Page rendue en image');
  });

  it('un ack vide ne jette pas', function() {
    expect(typeof docsRenderAckLabel({})).toBe('string');
    expect(typeof docsRenderAckLabel(null)).toBe('string');
  });
});

describe('dataUrlBase64Payload', function() {
  it('extrait la charge après le préfixe', function() {
    expect(dataUrlBase64Payload('data:image/png;base64,AAECAw==')).toBe('AAECAw==');
  });

  // Le préfixe contient des lettres valides en base64 (« dataimagepngbase ») :
  // le passer à base64ToArrayBuffer décalerait tout le flux d'octets.
  it('une chaîne sans préfixe base64 rend une charge VIDE, jamais la chaîne entière', function() {
    expect(dataUrlBase64Payload('data:image/png,AAECAw')).toBe('');
    expect(dataUrlBase64Payload('AAECAw==')).toBe('');
    expect(dataUrlBase64Payload('')).toBe('');
    expect(dataUrlBase64Payload(null)).toBe('');
  });
});

describe('pdfRenderResourceName', function() {
  it('remplace l\'extension, jamais ne l\'accole', function() {
    expect(pdfRenderResourceName('rapport.pdf', 3)).toBe('rapport-p3.png');
  });

  it('un nom sans extension reste propre', function() {
    expect(pdfRenderResourceName('rapport', 12)).toBe('rapport-p12.png');
  });

  it('un nom absent ne produit pas « undefined »', function() {
    expect(pdfRenderResourceName(null, 1)).toBe('document-p1.png');
  });
});

describe('outlinePageFromIndex', function() {
  it('l\'index 0-based devient un numéro 1-based', function() {
    expect(outlinePageFromIndex(0)).toBe(1);
    expect(outlinePageFromIndex(41)).toBe(42);
  });

  it('un index non numérique retombe sur 0, jamais « p.NaN »', function() {
    expect(outlinePageFromIndex(null)).toBe(0);
    expect(outlinePageFromIndex(undefined)).toBe(0);
    expect(outlinePageFromIndex('douze')).toBe(0);
  });

  it('un index négatif retombe sur 0', function() {
    expect(outlinePageFromIndex(-1)).toBe(0);
  });

  // 0 est la valeur « pas de numéro » de formatPdfListing : le contrat des deux
  // fonctions doit rester lisible ensemble (mémoire
  // project_pure_functions_compose_unguarded_contract).
  it('la valeur de repli est celle que formatPdfListing traite comme absente', function() {
    var s = formatPdfListing({ pages: 3, outline: [
      { level: 1, title: 'X', page: outlinePageFromIndex(null) }
    ] });
    expect(s.indexOf('- X') > -1).toBe(true);
    expect(s.indexOf('p.') > -1).toBe(false);
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

  // Lot V-8 : la notice ne s'arrête plus au constat, elle porte l'ISSUE.
  it('la notice offre le rendu image comme suite', function() {
    var s = formatPdfRead([{ page: 1, text: '' }]);
    expect(s.indexOf('miaou__docs__render_page') > -1).toBe(true);
  });

  // La suite est offerte À L'INDICATIF. Ce test garde le RETOUR de la condition
  // « si tu as la vision », qui a fait refuser l'outil à un modèle qui l'avait :
  // un modèle n'a pas d'introspection fiable sur ses modalités, et une condition
  // qu'il ne peut pas évaluer le pousse à la branche prudente.
  it('la notice ne conditionne pas la suite à une auto-évaluation de la vision', function() {
    var s = formatPdfRead([{ page: 1, text: '' }]);
    expect(/[Ss]i tu as la vision/.test(s)).toBe(false);
    // Le repli reste offert, mais sur un fait constatable APRÈS coup.
    expect(s.indexOf('Si tu ne parviens pas à la lire') > -1).toBe(true);
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

describe('formatSheetCell — formules et fusions (AC-3)', function() {
  it('w PRIME sur v : sans ça les dates redeviennent des nombres', function() {
    // LA non-régression du lot. sheet_to_csv rendait déjà w ; un rendu maison
    // qui prendrait v afficherait 46174 là où le document dit « Jun-26 ».
    expect(formatSheetCell({ t: 'n', v: 46174, w: 'Jun-26' })).toBe('Jun-26');
    expect(formatSheetCell({ t: 'n', v: 0.7083333333357587, w: '5:00:00 PM' })).toBe('5:00:00 PM');
  });

  it('v sert de repli quand w est absent ou vide', function() {
    expect(formatSheetCell({ t: 'n', v: 27 })).toBe('27');
    expect(formatSheetCell({ t: 's', v: 'texte', w: '' })).toBe('texte');
  });

  it('une formule est annoncée APRÈS sa valeur', function() {
    expect(formatSheetCell({ v: 27, w: '27', f: "COUNTIF('Autre feuille'!F:F,B7)" }))
      .toBe("27 [=COUNTIF('Autre feuille'!F:F,B7)]");
  });

  it('le cas où les deux annotations se croisent : formule ET date formatée', function() {
    // E15 de la fixture : w='5:00:00 PM', v=0.708…, f='E12-E9'. Le formatage
    // Excel est trompeur pour une durée, mais c'est ce que le document dit —
    // l'annotation de formule donne au modèle de quoi le comprendre.
    expect(formatSheetCell({ v: 0.7083333333357587, w: '5:00:00 PM', f: 'E12-E9' }))
      .toBe('5:00:00 PM [=E12-E9]');
  });

  it('une formule sans valeur calculée sort quand même', function() {
    expect(formatSheetCell({ f: 'SUM(A1:A9)' })).toBe('[=SUM(A1:A9)]');
  });

  it('une formule trop longue est tronquée et le DIT', function() {
    var long = 'IF(' + new Array(200).join('X') + ')';
    var out = formatSheetCell({ v: 1, w: '1', f: long });
    expect(out.indexOf('…]') >= 0).toBe(true);
    expect(out.length < long.length).toBe(true);
  });

  it('une case masquée par une fusion n\'est PAS une case vide', function() {
    // Le CSV rendait les deux comme une colonne vide : « absente » et « vide »
    // étaient indistinguables, c'est la perte que le lot corrige.
    expect(formatSheetCell({ masked: true })).toBe('↳');
    expect(formatSheetCell(null)).toBe('');
  });

  it('un pipe dans une valeur est échappé : il casserait la grille', function() {
    expect(formatSheetCell({ v: 'a|b', w: 'a|b' })).toBe('a\\|b');
  });

  it('un saut de ligne dans une cellule ne casse pas la ligne du tableau', function() {
    expect(formatSheetCell({ w: 'deux\nlignes' })).toBe('deux lignes');
  });
});

describe('formatMergeRanges — signaler, jamais propager (AC-3)', function() {
  it('sans fusion, aucune note', function() {
    expect(formatMergeRanges([])).toBe('');
    expect(formatMergeRanges(null)).toBe('');
  });

  it('les plages sont énumérées et le marqueur est expliqué', function() {
    var out = formatMergeRanges(['B17:E17', 'B28:E31']);
    expect(out.indexOf('2 plages fusionnées') >= 0).toBe(true);
    expect(out.indexOf('B17:E17, B28:E31') >= 0).toBe(true);
    expect(out.indexOf('↳') >= 0).toBe(true);
  });

  it('le singulier est accordé', function() {
    expect(formatMergeRanges(['B17:E17']).indexOf('1 plage fusionnée') >= 0).toBe(true);
  });

  it('au-delà du cap, le COMPTE seul — mais jamais le silence', function() {
    var many = [];
    for (var i = 1; i <= 20; i++) many.push('A' + i + ':C' + i);
    var out = formatMergeRanges(many, 12);
    expect(out.indexOf('20 plages fusionnées') >= 0).toBe(true);
    expect(out.indexOf('trop nombreuses') >= 0).toBe(true);
    expect(out.indexOf('A1:C1') >= 0).toBe(false);
  });

  it('une plage en bornes 0-based est écrite comme partout ailleurs', function() {
    // Même écriture que le selector et la notice de clamp : une seule
    // convention de plage dans tout le fichier.
    expect(formatMergeRanges([{ s: { r: 16, c: 1 }, e: { r: 16, c: 4 } }])
      .indexOf('B17:E17') >= 0).toBe(true);
  });
});

describe('formatXlsxSheet — le rendu pipe (AC-3)', function() {
  var GRID = {
    rows: [
      [{ w: 'Verdict' }, { w: 'Nombre' }],
      [{ w: 'NA' }, { v: 27, w: '27', f: "COUNTIF('Autre'!F:F,B7)" }],
    ],
    merges: [],
  };

  it('les colonnes sont séparées par un pipe, comme le docx et le pptx', function() {
    var out = formatXlsxSheet(GRID, { sheet: 'S', ref: 'B2:C3' });
    expect(out.indexOf('Verdict | Nombre') >= 0).toBe(true);
    expect(out.indexOf("NA | 27 [=COUNTIF('Autre'!F:F,B7)]") >= 0).toBe(true);
  });

  it('l\'en-tête porte le nom de la feuille ET la plage servie', function() {
    var out = formatXlsxSheet(GRID, { sheet: 'Synthèse', ref: 'B2:C3' });
    expect(out.indexOf('Feuille « Synthèse » (B2:C3)') >= 0).toBe(true);
  });

  it('une ligne entièrement vide reste une ligne : la géométrie est une information', function() {
    var out = formatXlsxSheet({ rows: [[{ w: 'a' }], [null], [{ w: 'b' }]] }, { sheet: 'S' });
    var body = out.split('\n').slice(1);
    expect(body.length).toBe(3);
    expect(body[1]).toBe('');
  });

  it('une plage sans aucune cellule le DIT, jamais un blanc', function() {
    var out = formatXlsxSheet({ rows: [] }, { sheet: 'S', ref: 'A1:B2' });
    expect(out.indexOf('aucune cellule remplie') >= 0).toBe(true);
  });

  it('le cap de lignes se dit et propose la suite', function() {
    var rows = [];
    for (var i = 0; i < 5; i++) rows.push([{ w: String(i) }]);
    var out = formatXlsxSheet({ rows: rows }, { sheet: 'S', maxRows: 2 });
    expect(out.indexOf('3 ligne(s) non affichée(s)') >= 0).toBe(true);
    expect(out.indexOf('as_resource') >= 0).toBe(true);
  });

  it('maxRows à 0 ne borne rien : une plage explicite est une intention', function() {
    var rows = [];
    for (var i = 0; i < 5; i++) rows.push([{ w: String(i) }]);
    expect(formatXlsxSheet({ rows: rows }, { sheet: 'S', maxRows: 0 })
      .indexOf('non affichée') >= 0).toBe(false);
  });

  it('la note de fusion survit à la troncature : elle décrit la feuille', function() {
    // Un modèle qui n'a reçu que les premières lignes a D'AUTANT PLUS besoin de
    // savoir que des fusions structurent ce qu'il lit.
    var rows = [];
    for (var i = 0; i < 5; i++) rows.push([{ w: String(i) }]);
    var out = formatXlsxSheet({ rows: rows, merges: ['B28:E31'] }, { sheet: 'S', maxRows: 2 });
    expect(out.indexOf('non affichée') >= 0).toBe(true);
    expect(out.indexOf('B28:E31') >= 0).toBe(true);
  });

  it('la notice de clamp est reportée en toute fin', function() {
    var out = formatXlsxSheet(GRID, { sheet: 'S', notice: '\n\n[Plage ramenée à B2:C3]' });
    expect(out.indexOf('[Plage ramenée à B2:C3]') >= 0).toBe(true);
  });

  it('une feuille sans fusion ne porte AUCUNE note : rien ne change pour elle', function() {
    var out = formatXlsxSheet(GRID, { sheet: 'S', ref: 'B2:C3' });
    expect(out.indexOf('fusionnée') >= 0).toBe(false);
    expect(out.indexOf('↳') >= 0).toBe(false);
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

describe('ooxmlRelationshipMap — l\'ordre des attributs n\'est pas garanti', function() {
  it('lit Id/Target quel que soit leur ordre dans la balise', function() {
    const xml = '<Relationships>' +
      '<Relationship Id="rId1" Type="x/slide" Target="slides/slide1.xml"/>' +
      '<Relationship Target="slides/slide2.xml" Id="rId2" Type="x/slide"/>' +
      '</Relationships>';
    const map = ooxmlRelationshipMap(xml);
    expect(map.rId1.target).toBe('slides/slide1.xml');
    expect(map.rId2.target).toBe('slides/slide2.xml');
  });

  it('une Relationship sans Target est ignorée plutôt que rendue à moitié', function() {
    const map = ooxmlRelationshipMap('<Relationship Id="rId9" Type="x"/>');
    expect(map.rId9 === undefined).toBe(true);
  });
});

describe('ooxmlResolveTarget', function() {
  it('remonte les .. relatifs à la pièce porteuse', function() {
    expect(ooxmlResolveTarget('ppt/slides', '../notesSlides/notesSlide2.xml'))
      .toBe('ppt/notesSlides/notesSlide2.xml');
  });

  it('un target sans .. se colle à la base', function() {
    expect(ooxmlResolveTarget('ppt', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
  });

  it('un target absolu perd son slash de tête', function() {
    expect(ooxmlResolveTarget('ppt', '/ppt/slides/slide3.xml')).toBe('ppt/slides/slide3.xml');
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
    // Forme mesurée sur un deck réel (une shape = un libellé + une personne,
    // sur deux a:p) : à plat, elle donnerait « Pilotage », « », « des  »,
    // « Risques » — du bruit à la place d'un repère. Les valeurs ci-dessous
    // sont NEUTRES : les fixtures sont des documents à ne pas divulguer, et un
    // test n'a pas besoin de contenu authentique pour garder une forme.
    const blocks = ['Pilotage des Risques\nAlex Durand', 'Conformité\nCamille Petit'];
    expect(pptxSlideExcerpt(blocks, 90))
      .toBe('Pilotage des Risques Alex Durand · Conformité Camille Petit');
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
    expect(pptxSlideLabel({ title: '', blocks: ['Trajectoire budgétaire'] }))
      .toBe('Trajectoire budgétaire');
  });

  it('sans titre NI texte, le libellé le dit', function() {
    expect(pptxSlideLabel({ title: '', blocks: [] })).toBe('(slide sans texte)');
  });
});

// ── Ancres d'images PowerPoint (lot AC-1) ──────────────────────────────────
// pptxShapeBlocks prend un Document (DOMParser, absent de QuickJS) et reste
// donc intestable ici : tout ce qui DÉCIDE en a été sorti en pures sur chaînes,
// et c'est ce qui suit. Le parcours DOM est couvert par verify-pptx-native.mjs.

describe('ooxmlImageLabel — le libellé est un bonus, jamais l\'ancre', function() {
  it('un descr informatif est retenu tel quel', function() {
    expect(ooxmlImageLabel('Blockchain')).toBe('Blockchain');
  });

  it('un descr auto-généré par Office est RETIRÉ, pas affiché', function() {
    // « Une image contenant dessin » est du bruit : 13 occurrences identiques
    // dans la fixture mesurée. Un libellé faux coûte plus qu'un libellé absent.
    expect(ooxmlImageLabel('Une image contenant dessin\n\nDescription générée automatiquement'))
      .toBe('');
  });

  it('un descr absent ou vide ne rend jamais « undefined »', function() {
    expect(ooxmlImageLabel(null)).toBe('');
    expect(ooxmlImageLabel(undefined)).toBe('');
    expect(ooxmlImageLabel('   ')).toBe('');
  });

  it('les blancs internes d\'un descr multi-ligne sont normalisés', function() {
    expect(ooxmlImageLabel('Diagramme\n  d\'interconnexion')).toBe('Diagramme d\'interconnexion');
  });
});

describe('formatImageAnchor', function() {
  it('le chemin est copiable tel quel, le libellé entre guillemets', function() {
    expect(formatImageAnchor('ppt/media/image7.png', 'Blockchain'))
      .toBe('[image: ppt/media/image7.png — « Blockchain »]');
  });

  it('sans libellé, l\'ancre reste utile — c\'est le chemin qui porte', function() {
    expect(formatImageAnchor('ppt/media/image12.png', ''))
      .toBe('[image: ppt/media/image12.png]');
  });

  it('sans chemin, pas d\'ancre du tout', function() {
    expect(formatImageAnchor('', 'Blockchain')).toBe('');
    expect(formatImageAnchor(null, null)).toBe('');
  });
});

describe('pptxDedupeImageRefs — le doublon PNG/SVG des icônes Office', function() {
  it('le jumeau SVG désigné par svgBlip est écarté, le raster reste', function() {
    // Un comptage naïf de ppt/media/ doublerait les images : 120 SVG pour
    // 121 PNG sur la slide mesurée.
    const refs = [
      { path: 'ppt/media/image1.png', svgPath: 'ppt/media/image2.svg' },
      { path: 'ppt/media/image2.svg', svgPath: '' },
    ];
    const out = pptxDedupeImageRefs(refs);
    expect(out.length).toBe(1);
    expect(out[0].path).toBe('ppt/media/image1.png');
  });

  it('une même pièce répétée sur la slide ne sort qu\'une fois', function() {
    const refs = [
      { path: 'ppt/media/logo.png', svgPath: '' },
      { path: 'ppt/media/logo.png', svgPath: '' },
    ];
    expect(pptxDedupeImageRefs(refs).length).toBe(1);
  });

  it('un ref sans chemin est ignoré plutôt que rendu à moitié', function() {
    expect(pptxDedupeImageRefs([{ path: '', svgPath: '' }]).length).toBe(0);
    expect(pptxDedupeImageRefs(null).length).toBe(0);
  });
});

describe('capImageAnchors — 241 médias sur une slide mesurée', function() {
  it('sous le cap, rien n\'est ajouté', function() {
    expect(capImageAnchors(['a', 'b'], 24).length).toBe(2);
  });

  it('au-dessus, la troncature est ANNONCÉE avec son compte', function() {
    // Jamais une troncature muette : un modèle qui ignore qu'il manque des
    // images conclut sur ce qu'il voit.
    const many = [];
    for (let i = 0; i < 30; i++) many.push('[image: ppt/media/image' + i + '.png]');
    const out = capImageAnchors(many, 24);
    expect(out.length).toBe(25);
    expect(out[24]).toBe('[6 autres images sur cette slide, non listées.]');
  });

  it('une seule image omise se dit au singulier', function() {
    const many = [];
    for (let i = 0; i < 25; i++) many.push('x');
    expect(capImageAnchors(many, 24)[24]).toBe('[1 autre image sur cette slide, non listée.]');
  });
});

describe('pptxBlockText / pptxSlideExcerpt — le typage des blocs (AC-1)', function() {
  it('un bloc typé rend son texte, jamais « [object Object] »', function() {
    // String({}) rend une chaîne NON VIDE : un extrait pollué passerait toute
    // assertion qui se contente de vérifier qu'il n'est pas vide.
    expect(pptxBlockText({ type: 'text', text: 'Pilotage des Risques' })).toBe('Pilotage des Risques');
    expect(pptxBlockText('chaîne nue')).toBe('chaîne nue');
    expect(pptxBlockText(null)).toBe('');
  });

  it('les ancres d\'images sont EXCLUES de l\'extrait de listing', function() {
    // L'extrait sert à CHOISIR une slide ; 241 chemins de fichiers n'y aident
    // pas (AC-1 §2.5).
    const blocks = [
      { type: 'image', text: '[image: ppt/media/image1.png — « Blockchain »]' },
      { type: 'text', text: 'Trajectoire budgétaire' },
    ];
    expect(pptxSlideExcerpt(blocks, 90)).toBe('Trajectoire budgétaire');
  });

  it('une slide qui ne porte QUE des images n\'a pas d\'extrait', function() {
    const blocks = [{ type: 'image', text: '[image: ppt/media/image1.png]' }];
    expect(pptxSlideExcerpt(blocks, 90)).toBe('');
    expect(pptxSlideLabel({ title: '', blocks: blocks })).toBe('(slide sans texte)');
  });
});

// ── Ancres d'images Word (lot AC-2) ────────────────────────────────────────
// openDocxDocument branche mammoth et fflate (ni l'un ni l'autre sous QuickJS) :
// tout ce qui DÉCIDE en est sorti en pur sur chaînes et sur octets, et c'est ce
// qui suit. Les exemples sont NEUTRES — les fixtures de untracked/test-files/
// sont des documents à ne pas divulguer, et une forme se porte aussi bien par
// un exemple inventé.

describe('fnv1aBytes — le hash d\'appariement, non cryptographique par décision', function() {
  const bytes = (s) => {
    const out = [];
    for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
    return out;
  };

  it('rend les vecteurs FNV-1a 32 bits de référence', function() {
    // Vecteurs standard : si un « nettoyage » futur change l'algorithme, ces
    // trois valeurs tombent — c'est le but. Le hash n'a pas à être FNV, mais il
    // doit rester STABLE, sinon un annuaire construit avant ne matche plus.
    expect(fnv1aBytes(bytes(''))).toBe(2166136261);
    expect(fnv1aBytes(bytes('a'))).toBe(3826002220);
    expect(fnv1aBytes(bytes('abc'))).toBe(440920331);
  });

  it('reste dans les 32 bits non signés, jamais de négatif', function() {
    // Le décalage << 24 produit un négatif sans le >>> 0 final, et une clé
    // négative d'un côté et positive de l'autre ne matcherait jamais.
    const h = fnv1aBytes(bytes('miaou'));
    expect(h >= 0).toBe(true);
    expect(h <= 4294967295).toBe(true);
    expect(h === Math.floor(h)).toBe(true);
  });

  it('deux contenus différents donnent deux hashs différents', function() {
    expect(fnv1aBytes(bytes('image-a')) === fnv1aBytes(bytes('image-b'))).toBe(false);
  });

  it('une entrée absente ou vide ne lève pas', function() {
    expect(fnv1aBytes(null)).toBe(2166136261);
    expect(fnv1aBytes([])).toBe(2166136261);
  });
});

describe('mediaMatchKey — la clé est (taille, hash), jamais le hash seul', function() {
  it('compose les deux, pour qu\'une collision 32 bits ne suffise pas à apparier', function() {
    expect(mediaMatchKey(3366, 123)).toBe('3366:123');
  });

  it('deux pièces de même hash mais de tailles différentes ont des clés distinctes', function() {
    expect(mediaMatchKey(100, 7) === mediaMatchKey(200, 7)).toBe(false);
  });

  it('une taille absente ne rend jamais « NaN: »', function() {
    expect(mediaMatchKey(null, 7)).toBe('0:7');
    expect(mediaMatchKey(undefined, 7)).toBe('0:7');
  });
});

describe('docxExtractImages — l\'image vit DANS un <p>, pas au premier niveau', function() {
  it('extrait l\'ancre et rend le fragment privé de son <img>', function() {
    const r = docxExtractImages('<strong><img alt="Schéma" src="word/media/image5.png" /></strong>');
    expect(r.anchors.length).toBe(1);
    expect(r.anchors[0]).toBe('[image: word/media/image5.png — « Schéma »]');
    expect(r.rest.indexOf('<img') < 0).toBe(true);
  });

  it('le texte qui entourait l\'image est CONSERVÉ', function() {
    // Cas non exercé par les fixtures (leurs images sont seules dans leur
    // paragraphe) : couvert défensivement, pas mesuré.
    const r = docxExtractImages('avant <img alt="" src="word/media/image1.png" /> après');
    expect(r.anchors.length).toBe(1);
    expect(htmlFragmentToInlineText(r.rest)).toBe('avant après');
  });

  it('plusieurs images dans un même paragraphe sortent DANS L\'ORDRE', function() {
    const r = docxExtractImages(
      '<img alt="" src="word/media/image1.png" /><img alt="" src="word/media/image2.png" />');
    expect(r.anchors.length).toBe(2);
    expect(r.anchors[0]).toBe('[image: word/media/image1.png]');
    expect(r.anchors[1]).toBe('[image: word/media/image2.png]');
  });

  it('un alt auto-généré par Office est retiré, comme côté pptx', function() {
    const r = docxExtractImages(
      '<img alt="Une image contenant dessin&#10;&#10;Description générée automatiquement" ' +
      'src="word/media/image9.png" />');
    expect(r.anchors[0]).toBe('[image: word/media/image9.png]');
  });

  it('un alt encodé est DÉCODÉ : sinon le libellé sort avec ses entités', function() {
    const r = docxExtractImages('<img alt="Gateway &amp; API" src="word/media/image3.png" />');
    expect(r.anchors[0]).toBe('[image: word/media/image3.png — « Gateway & API »]');
  });

  it('pièce non retrouvée : l\'ancre le DIT, plutôt que de disparaître', function() {
    // « Il y a une image ici » reste une information même sans son chemin.
    const sans = docxExtractImages('<img alt="Logo" src="" />');
    expect(sans.anchors[0]).toBe('[image : « Logo »]');
    const nu = docxExtractImages('<img src="" />');
    expect(nu.anchors[0]).toBe('[image sans référence retrouvée]');
  });

  it('un fragment sans image ne touche à rien', function() {
    const r = docxExtractImages('<strong>texte</strong>');
    expect(r.anchors.length).toBe(0);
    expect(r.rest).toBe('<strong>texte</strong>');
  });
});

describe('docxHtmlToBlocks — les ancres d\'images (AC-2)', function() {
  it('l\'ancre est un bloc TYPÉ « image », à sa place dans le flux', function() {
    const b = docxHtmlToBlocks(
      '<h1>T</h1><p><strong><img alt="Schéma" src="word/media/image5.png" /></strong></p><p>suite</p>');
    expect(b.length).toBe(3);
    expect(b[0].type).toBe('heading');
    expect(b[1].type).toBe('image');
    expect(b[1].text).toBe('[image: word/media/image5.png — « Schéma »]');
    expect(b[2].type).toBe('para');
    expect(b[2].text).toBe('suite');
  });

  it('un paragraphe qui ne portait QUE l\'image ne laisse pas de bloc vide', function() {
    const b = docxHtmlToBlocks('<p><img alt="" src="word/media/image1.png" /></p>');
    expect(b.length).toBe(1);
    expect(b[0].type).toBe('image');
  });

  it('l\'ancre appartient à la SECTION qui la porte', function() {
    const s = docxSections(docxHtmlToBlocks(
      '<h1>A</h1><p><img alt="" src="word/media/image1.png" /></p><h1>B</h1><p>x</p>'));
    expect(s[0].text.indexOf('word/media/image1.png') > 0).toBe(true);
    expect(s[1].text.indexOf('word/media/image1.png') < 0).toBe(true);
  });

  it('au-delà du cap, le dépassement est ANNONCÉ avec son compte', function() {
    let html = '';
    for (let i = 0; i < 30; i++) {
      html += '<p><img alt="" src="word/media/image' + i + '.png" /></p>';
    }
    const b = docxHtmlToBlocks(html);
    const imgs = b.filter((x) => x.type === 'image');
    // 24 ancres + la notice, jamais 30 et jamais 24 muettes.
    expect(imgs.length).toBe(25);
    expect(imgs[24].text).toBe('[6 autres images dans ce document, non listées.]');
  });

  it('une seule image omise se dit au singulier', function() {
    let html = '';
    for (let i = 0; i < 25; i++) html += '<p><img alt="" src="word/media/i' + i + '.png" /></p>';
    const imgs = docxHtmlToBlocks(html).filter((x) => x.type === 'image');
    expect(imgs[24].text).toBe('[1 autre image dans ce document, non listée.]');
  });

  it('un document SANS image ne porte aucun bloc image ni aucune notice', function() {
    // Non-régression : le chemin docx est partagé par des documents sans
    // aucune image, et convertImage change la sortie de mammoth pour TOUS.
    const b = docxHtmlToBlocks('<h1>T</h1><p>corps</p><table><tr><td>x</td></tr></table>');
    expect(b.filter((x) => x.type === 'image').length).toBe(0);
    expect(b.length).toBe(3);
  });
});

describe('formatPptxListing', function() {
  const slides = [
    { title: 'Organigramme', blocks: ['x'], hasNotes: true },
    { title: '', blocks: ['Pilotage des Risques\nAlex Durand'], hasNotes: false },
  ];

  it('numérote dans l\'ordre de présentation et rend le selector attendu', function() {
    const out = formatPptxListing(slides, {});
    expect(out.indexOf('1. Organigramme') >= 0).toBe(true);
    expect(out.indexOf('2. Pilotage des Risques Alex Durand') >= 0).toBe(true);
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

  it('la notice ANNONCE les ancres d\'images au lieu de les taire (AC-1)', function() {
    // Une slide sans texte porte désormais des ancres : taire la capacité
    // ferait conclure le modèle à une impasse (mémoire
    // project_model_facing_text_indicative_and_reachable — un silence vaut
    // interdiction). Aucune fixture e2e ne peut exercer ce chemin : la notice
    // ne tombe que si la slide n'a NI corps NI notes, et aucun des trois decks
    // disponibles n'en porte une telle. D'où ce test sur entrée construite.
    const out = formatPptxRead([{ number: 1, text: '' }], {});
    expect(out.indexOf('[image: ppt/media/…]') >= 0).toBe(true);
    expect(out.indexOf('archive') >= 0).toBe(true);
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

// ── Ancres d'images Excel (lot AC-4) ───────────────────────────────────────
// SheetJS n'expose ni drawings ni médias, et ne tourne pas sous QuickJS : tout
// ce qui DÉCIDE est sorti en pur sur chaînes, et c'est ce qui suit. Les extraits
// XML sont INVENTÉS — les fixtures de untracked/test-files/ sont des documents à
// ne pas divulguer, et une forme se porte aussi bien par un exemple construit.
// Les valeurs de col/row sont choisies pour exercer la base 0 et les passages de
// dizaine, pas pour reproduire un classeur réel.

describe('parseXlsxDrawingAnchors — les trois formes du schéma DrawingML', function() {
  const twoCell = (col1, row1, col2, row2, rid) =>
    '<xdr:twoCellAnchor editAs="oneCell">' +
    '<xdr:from><xdr:col>' + col1 + '</xdr:col><xdr:colOff>9525</xdr:colOff>' +
    '<xdr:row>' + row1 + '</xdr:row><xdr:rowOff>19050</xdr:rowOff></xdr:from>' +
    '<xdr:to><xdr:col>' + col2 + '</xdr:col><xdr:colOff>0</xdr:colOff>' +
    '<xdr:row>' + row2 + '</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>' +
    '<xdr:pic><xdr:blipFill><a:blip r:embed="' + rid + '"/></xdr:blipFill></xdr:pic>' +
    '</xdr:twoCellAnchor>';

  it('rend la plage A1 d\'un twoCellAnchor, col/row étant en BASE 0', function() {
    // col 4 / row 3 → E4 : la base 0 est le piège du format, et un off-by-one
    // y produirait une plage plausible et fausse.
    const out = parseXlsxDrawingAnchors('<xdr:wsDr>' + twoCell(4, 3, 4, 14, 'rId1') + '</xdr:wsDr>');
    expect(out.length).toBe(1);
    expect(out[0].embed).toBe('rId1');
    expect(out[0].range).toBe('E4:E15');
  });

  it('tient le passage de dizaine des colonnes (AA, pas AB)', function() {
    // Le décalage classique de la base 26 bijective ne se voit qu'au-delà de Z :
    // aucune fixture jouet ne l'exerce, donc il est vérifié ici.
    const out = parseXlsxDrawingAnchors(twoCell(26, 0, 27, 4, 'rId9'));
    expect(out[0].range).toBe('AA1:AB5');
  });

  it('ignore les colOff/rowOff, qui déplacent l\'image DANS sa cellule', function() {
    const out = parseXlsxDrawingAnchors(twoCell(2, 32, 4, 41, 'rId2'));
    expect(out[0].range).toBe('C33:E42');
  });

  it('un oneCellAnchor rend sa CELLULE d\'ancrage, jamais une plage inventée', function() {
    // Il porte une taille en EMU, pas un `to` : convertir en cellules
    // demanderait les largeurs réelles des colonnes. On annonce le point
    // d'ancrage seul.
    const xml = '<xdr:oneCellAnchor>' +
      '<xdr:from><xdr:col>3</xdr:col><xdr:row>7</xdr:row></xdr:from>' +
      '<xdr:ext cx="914400" cy="914400"/>' +
      '<xdr:pic><xdr:blipFill><a:blip r:embed="rId4"/></xdr:blipFill></xdr:pic>' +
      '</xdr:oneCellAnchor>';
    const out = parseXlsxDrawingAnchors(xml);
    expect(out.length).toBe(1);
    expect(out[0].range).toBe('D8');
  });

  it('un absoluteAnchor est rendu SANS position plutôt qu\'avec une position fausse', function() {
    const xml = '<xdr:absoluteAnchor>' +
      '<xdr:pos x="100" y="200"/><xdr:ext cx="914400" cy="914400"/>' +
      '<xdr:pic><xdr:blipFill><a:blip r:embed="rId5"/></xdr:blipFill></xdr:pic>' +
      '</xdr:absoluteAnchor>';
    const out = parseXlsxDrawingAnchors(xml);
    expect(out.length).toBe(1);
    expect(out[0].embed).toBe('rId5');
    expect(out[0].range).toBe('');
  });

  it('garde l\'ordre du document sur des formes mélangées', function() {
    const xml = '<xdr:wsDr>' + twoCell(0, 0, 1, 1, 'rIdA') +
      '<xdr:absoluteAnchor><a:blip r:embed="rIdB"/></xdr:absoluteAnchor>' +
      twoCell(5, 5, 6, 6, 'rIdC') + '</xdr:wsDr>';
    const out = parseXlsxDrawingAnchors(xml);
    expect(out.length).toBe(3);
    expect(out[0].embed).toBe('rIdA');
    expect(out[1].embed).toBe('rIdB');
    expect(out[2].embed).toBe('rIdC');
  });

  it('un a:blip sans r:embed (image LIÉE) ne rend aucune ancre', function() {
    // Une ancre sans pièce à atteindre serait un chemin que le modèle ne peut
    // pas suivre — même règle qu'au pptx.
    const xml = '<xdr:twoCellAnchor>' +
      '<xdr:from><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:from>' +
      '<xdr:to><xdr:col>2</xdr:col><xdr:row>2</xdr:row></xdr:to>' +
      '<xdr:pic><xdr:blipFill><a:blip r:link="rId8"/></xdr:blipFill></xdr:pic>' +
      '</xdr:twoCellAnchor>';
    expect(parseXlsxDrawingAnchors(xml).length).toBe(0);
  });

  it('reprend le descr du nœud porteur, avec la règle de libellé partagée', function() {
    // Aucune fixture du dépôt n'exerce ce chemin : les deux images mesurées ont
    // un descr VIDE, donc leurs ancres sortent nues, et c'est correct. Le format
    // l'autorise pourtant et d'autres classeurs en portent — d'où l'entrée
    // construite plutôt qu'une assertion sur fixture qui passerait par vacuité.
    const xml = '<xdr:twoCellAnchor>' +
      '<xdr:from><xdr:col>0</xdr:col><xdr:row>0</xdr:row></xdr:from>' +
      '<xdr:to><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:to>' +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Image 1" descr="Courbe de charge"/>' +
      '</xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>' +
      '</xdr:twoCellAnchor>';
    expect(parseXlsxDrawingAnchors(xml)[0].label).toBe('Courbe de charge');
  });

  it('écarte un descr AUTO-GÉNÉRÉ, comme les deux autres formats', function() {
    const xml = '<xdr:twoCellAnchor>' +
      '<xdr:from><xdr:col>0</xdr:col><xdr:row>0</xdr:row></xdr:from>' +
      '<xdr:to><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:to>' +
      '<xdr:pic><xdr:nvPicPr>' +
      '<xdr:cNvPr descr="Une image contenant dessin&#10;&#10;Description générée automatiquement"/>' +
      '</xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>' +
      '</xdr:twoCellAnchor>';
    expect(parseXlsxDrawingAnchors(xml)[0].label).toBe('');
  });

  it('« name » n\'est JAMAIS un libellé, même sans descr', function() {
    const xml = '<xdr:twoCellAnchor>' +
      '<xdr:from><xdr:col>0</xdr:col><xdr:row>0</xdr:row></xdr:from>' +
      '<xdr:to><xdr:col>1</xdr:col><xdr:row>1</xdr:row></xdr:to>' +
      '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Image 1"/></xdr:nvPicPr>' +
      '<xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic>' +
      '</xdr:twoCellAnchor>';
    expect(parseXlsxDrawingAnchors(xml)[0].label).toBe('');
  });

  it('LE CAS DÉGÉNÉRÉ : un drawing présent mais VIDE ne rend rien', function() {
    // Mesuré sur une fixture sans image : le classeur porte bien un
    // xl/drawings/drawing1.xml, mais sans enfant et sans xl/media/. Un drawing
    // présent ne prouve donc PAS qu'il y a des images.
    expect(parseXlsxDrawingAnchors('<xdr:wsDr></xdr:wsDr>').length).toBe(0);
    expect(parseXlsxDrawingAnchors('').length).toBe(0);
    expect(parseXlsxDrawingAnchors(null).length).toBe(0);
  });
});

describe('partitionXlsxAnchors — annoncer ce qui a été lu, compter le reste', function() {
  const a = (range) => ({ embed: 'rId1', path: 'xl/media/image1.png', label: '', range: range });

  it('une ancre dans la plage servie est annoncée', function() {
    const p = partitionXlsxAnchors([a('E4:E15')], 'B2:E31');
    expect(p.inside.length).toBe(1);
    expect(p.outside).toBe(0);
  });

  it('une ancre hors de la plage servie est COMPTÉE, jamais annoncée', function() {
    const p = partitionXlsxAnchors([a('C33:E42')], 'A1:C10');
    expect(p.inside.length).toBe(0);
    expect(p.outside).toBe(1);
  });

  it('l\'intersection est un CHEVAUCHEMENT, pas une inclusion', function() {
    // Une image à cheval sur la bordure est visible dans ce qu'on sert : c'est
    // le prédicat de sheetToMatrix pour les fusions, et deux prédicats
    // d'intersection sur la même feuille divergeraient.
    const p = partitionXlsxAnchors([a('C8:E12')], 'A1:C10');
    expect(p.inside.length).toBe(1);
  });

  it('une ancre SANS plage est comptée hors plage, pas supposée dedans', function() {
    const p = partitionXlsxAnchors([a('')], 'A1:C10');
    expect(p.inside.length).toBe(0);
    expect(p.outside).toBe(1);
  });

  it('tolère une liste absente et une plage illisible', function() {
    expect(partitionXlsxAnchors(null, 'A1:C10').inside.length).toBe(0);
    expect(partitionXlsxAnchors([a('A1:B2')], '').outside).toBe(1);
  });
});

describe('formatXlsxAnchorNote — la note de fin, et son silence', function() {
  const a = (path, range, label) => ({ path: path, range: range, label: label || '' });

  it('une ancre porte son chemin ET sa plage', function() {
    const out = formatXlsxAnchorNote({ inside: [a('xl/media/image1.png', 'E4:E15')], outside: 0 });
    expect(out).toContain('[image: xl/media/image1.png]');
    expect(out).toContain('ancrée sur E4:E15');
  });

  it('le libellé est repris quand il existe', function() {
    // Aucune fixture du dépôt n'en porte côté Excel (descr vides) : ce contrôle
    // est la SEULE couverture du cas, d'où l'entrée construite.
    const out = formatXlsxAnchorNote({ inside: [a('xl/media/image2.png', 'C3:D4', 'Schéma')], outside: 0 });
    expect(out).toContain('« Schéma »');
  });

  it('une ancre sans plage sort sans mention de position', function() {
    const out = formatXlsxAnchorNote({ inside: [a('xl/media/image3.png', '')], outside: 0 });
    expect(out).toContain('[image: xl/media/image3.png]');
    expect(out.indexOf('ancrée sur') < 0).toBe(true);
  });

  it('le compte hors plage est DIT, y compris quand rien n\'est annoncé', function() {
    // Le silence vaudrait « il n'y a pas d'image », qui est faux.
    const out = formatXlsxAnchorNote({ inside: [], outside: 2 });
    expect(out).toContain('2 images');
    expect(out).toContain('hors de la plage lue');
    expect(out).toContain('aucune ne recouvre ce qui précède');
  });

  it('accorde le singulier du compte hors plage', function() {
    const out = formatXlsxAnchorNote({ inside: [a('xl/media/image1.png', 'A1:B2')], outside: 1 });
    expect(out).toContain('1 image');
    expect(out).toContain('est ancrée');
  });

  it('RIEN à dire → chaîne vide, jamais une note à blanc', function() {
    expect(formatXlsxAnchorNote({ inside: [], outside: 0 })).toBe('');
    expect(formatXlsxAnchorNote(null)).toBe('');
  });

  it('le cap borne l\'énumération et ANNONCE le reste', function() {
    // Aucune fixture ne l'exerce (la seule illustrée porte deux images) : garde
    // de principe vérifiée sur entrée construite, comme ses homologues.
    const many = [];
    for (let i = 0; i < 30; i++) many.push(a('xl/media/image' + i + '.png', 'A' + (i + 1)));
    const out = formatXlsxAnchorNote({ inside: many, outside: 0 }, 24);
    expect(out).toContain('6 autres images sur cette feuille, non listées.');
  });
});

describe('pdfAnchorBand — les ordonnées PDF partent du BAS (AC-5)', function() {
  it('une image haute sur la page se dit « haut de page »', function() {
    // Mesure test.pdf p2 : bandeau à y=464, hauteur 40, page de 540.
    // 540 - (464 + 20) = 56 depuis le haut, soit 10 % → haut.
    expect(pdfAnchorBand(464, 40, 540)).toBe('haut de page');
  });

  it('une image basse se dit « bas de page », jamais l\'inverse', function() {
    // LE PIÈGE de l'étape : lire y comme un écart depuis le haut rendrait
    // exactement la réponse opposée sur ces deux cas.
    expect(pdfAnchorBand(37, 92, 540)).toBe('bas de page');
  });

  it('une image centrée se dit « milieu de page »', function() {
    expect(pdfAnchorBand(250, 40, 540)).toBe('milieu de page');
  });

  it('sans hauteur de page exploitable, aucune bande n\'est affirmée', function() {
    // Une bande dérivée d'une division par zéro serait une affirmation fausse.
    expect(pdfAnchorBand(100, 10, 0)).toBe('');
    expect(pdfAnchorBand(100, 10, null)).toBe('');
  });
});

describe('formatPdfImageAnchor — signaler sans rien à extraire (AC-5)', function() {
  it('l\'ancre porte (page, rang), la taille et la couverture', function() {
    // Mesure test.pdf p1 image 2 : 681x681 natif peint en 407x407 sur 960x540.
    expect(formatPdfImageAnchor(
      { rank: 2, w: 407, h: 407, covPct: 32, band: 'milieu de page' }, 1))
      .toBe('[image: page 1, image 2 — 407×407, 32 % de la page, milieu de page]');
  });

  it('une image minuscule est annoncée à 1 %, jamais à 0 %', function() {
    // Les pastilles de 36x29 de la fixture tombent sous le demi-point : les
    // annoncer à « 0 % de la page » les dirait inexistantes alors qu'elles
    // sont là.
    expect(formatPdfImageAnchor({ rank: 3, w: 36, h: 29, covPct: 0.2, band: 'haut de page' }, 4))
      .toBe('[image: page 4, image 3 — 36×29, 1 % de la page, haut de page]');
  });

  it('sans bande, l\'ancre reste utile — la couverture porte', function() {
    expect(formatPdfImageAnchor({ rank: 1, w: 100, h: 50, covPct: 5, band: '' }, 2))
      .toBe('[image: page 2, image 1 — 100×50, 5 % de la page]');
  });
});

describe('formatPdfPageAnchorNote — groupées en fin de page (AC-5)', function() {
  it('une page sans image ne produit AUCUNE note', function() {
    expect(formatPdfPageAnchorNote([], 3)).toBe('');
    expect(formatPdfPageAnchorNote(null, 3)).toBe('');
  });

  it('les ancres suivent le texte, séparées par une ligne vide', function() {
    const out = formatPdfPageAnchorNote(
      [{ rank: 1, w: 196, h: 40, covPct: 2, band: 'haut de page' }], 7);
    expect(out).toBe('\n\n[image: page 7, image 1 — 196×40, 2 % de la page, haut de page]');
  });

  it('le cap annonce son dépassement, en parlant de « cette page »', function() {
    // Une notice qui parlerait de slide dans un PDF serait fausse au moment
    // précis où le modèle a besoin de savoir ce qui manque.
    const many = [];
    for (let i = 0; i < 26; i++) many.push({ rank: i + 1, w: 10, h: 10, covPct: 1, band: '' });
    const lines = formatPdfPageAnchorNote(many, 2).split('\n');
    expect(lines[lines.length - 1]).toBe('[2 autres images sur cette page, non listées.]');
  });
});
